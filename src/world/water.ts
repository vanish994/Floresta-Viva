/**
 * Física da água superficial — volume por célula, conservação de massa e
 * acoplamento com chuva, solo, vegetação e terreno.
 *
 * Modelo adotado (shallow-water de poços, estável em tempo real):
 *
 *  - Potencial hidráulico `head = elevação_do_solo + profundidade`.
 *  - O escoamento entre células vizinhas é calculado pela lei de Manning
 *    (v ∝ R^(2/3)·S^(1/2)/n), com distância real entre células, rugosidade do
 *    solo, vegetação e a lâmina efetiva acima da soleira entre as duas células.
 *  - Cada transferência é limitada por dois critérios físicos:
 *      1. equalização de superfície: no máximo metade do desnível de `head`;
 *      2. fração máxima da água disponível na origem.
 *    Isso garante profundidades não-negativas e impede oscilação em terreno
 *    plano (a transferência tende a zero quando Δhead → 0).
 *  - Todos os fluxos de um subpasso são calculados sobre um snapshot
 *    (`waterDepth` + `waterDelta`) e aplicados depois. Nenhuma célula gasta
 *    água que já saiu e a ordem de varredura não altera o resultado.
 *  - O solver trabalha com todos os chunks carregados de uma vez, resolvendo
 *    vizinhos na borda via `region.cellAt` — não existe "parede" entre chunks.
 *  - Fontes e sumidouros são contabilizados separadamente no orçamento:
 *    chuva/escoamento (`surfaceInput`), recarga do lençol, evaporação,
 *    infiltração e drenagem profunda.
 *
 * A velocidade resultante (`flowX`,`flowY`, m/s) é derivada dos próprios
 * volumes transferidos e alimenta a renderização, a erosão e o arrancamento de
 * vegetação. Não há animação independente do estado físico.
 */
import type { WorldConfig } from '../core/config';
import { clamp, hash2 } from '../core/rng';
import { Chunk } from './chunk';
import { DX8, DY8 } from './hydro';
import { SPECIES } from './flora';
import { plantSize } from './ecology';
import type { Climate } from './climate';

const SQRT2 = Math.SQRT2;
const MIN_DEPTH = 1e-5;

/** rugosidade Manning por tipo de solo (areia, argila, rocha, floresta, aluvial) */
const SOIL_ROUGHNESS = [0.012, 0.024, 0.006, 0.032, 0.018];
/** condutividade hidráulica saturada aproximada (m de lâmina por hora de jogo) */
export const SOIL_KSAT = [0.12, 0.02, 0.006, 0.05, 0.04];
/** capacidadede de armazenamento do solo: metros de água por unidade de umidade */
const DEFAULT_SOIL_WATER_CAPACITY = 0.35;

export interface WaterBudget {
  /** chuva + escoamento superficial que entrou na lâmina (m³) */
  rain: number;
  /** recarga do lençol em rios/lagos (m³) */
  springs: number;
  /** evaporação de água aberta (m³) */
  evaporation: number;
  /** infiltração da lâmina para o solo (m³) */
  infiltration: number;
  /** drenagem profunda / alívio de segurança (m³) */
  drainage: number;
  /** perdas em bordas abertas do mundo (m³) — hoje 0: bordas são paredes */
  boundary: number;
}

/** pressão hidrostática (kPa) na base da lâmina: ρ·g·h */
export function waterPressureKPa(cfg: WorldConfig, depthMeters: number): number {
  return (1000 * 9.81 * Math.max(0, depthMeters)) / 1000;
}

export const createWaterBudget = (): WaterBudget => ({
  rain: 0,
  springs: 0,
  evaporation: 0,
  infiltration: 0,
  drainage: 0,
  boundary: 0,
});

export function accumulateBudget(target: WaterBudget, source: WaterBudget): void {
  target.rain += source.rain;
  target.springs += source.springs;
  target.evaporation += source.evaporation;
  target.infiltration += source.infiltration;
  target.drainage += source.drainage;
  target.boundary += source.boundary;
}

export interface WaterSinks {
  evaporation?: boolean;
  infiltration?: boolean;
  drainage?: boolean;
}

export interface WaterSources {
  /** recarga do lençol freático (rios/lagos) */
  springs?: boolean;
}

export interface WaterPhysicsOptions {
  climate?: Climate;
  /** temperatura do ar (°C) usada na evaporação */
  temperature?: number;
  /** luz diurna 0..1 (evaporação) */
  daylight?: number;
  /** horas totais de jogo (determinismo dos eventos de vegetação) */
  worldHours?: number;
  sources?: WaterSources;
  sinks?: WaterSinks;
  /** liga/desliga o acoplamento com vegetação (estresse e arrancamento) */
  vegetation?: boolean;
  /**
   * Borda aberta: água que sai da região ativa segue para jusante e é
   * contabilizada em `budget.boundary` (não fica presa como parede).
   * Necessário no jogo para não represar rios na borda do streaming.
   */
  openBoundary?: boolean;
  /** acumula o orçamento neste objeto em vez de criar um novo */
  budget?: WaterBudget;
}

/** Interface mínima do mundo/chunks usada pelo solver (testável isoladamente). */
export interface WaterRegion {
  cfg: WorldConfig;
  /** chunks carregados que participam da simulação */
  waterChunks(): Iterable<Chunk>;
  /** célula global → chunk que a contém (null se descarregado) */
  cellAt(cellX: number, cellY: number): Chunk | null;
}

export interface WaterImpacts {
  uprooted: number;
  floodedCells: number;
}

const defaultSources = (o: WaterPhysicsOptions): Required<WaterSources> => ({
  springs: o.sources?.springs ?? true,
});
const defaultSinks = (o: WaterPhysicsOptions): Required<WaterSinks> => ({
  evaporation: o.sinks?.evaporation ?? true,
  infiltration: o.sinks?.infiltration ?? true,
  drainage: o.sinks?.drainage ?? true,
});

/**
 * Avança a física da água por `hours` horas de jogo.
 * Internamente subdivide em passos fixos (`waterStepHours`) para estabilidade.
 */
export function stepWaterPhysics(
  region: WaterRegion,
  hours: number,
  opts: WaterPhysicsOptions = {},
): WaterBudget {
  const budget = opts.budget ?? createWaterBudget();
  if (!(hours > 0)) return budget;
  const cfg = region.cfg;
  const chunks = sortChunks(region.waterChunks());
  if (chunks.length === 0) return budget;

  const baseStep = Math.max(1e-4, cfg.waterStepHours);
  const substeps = Math.min(cfg.waterMaxSubsteps, Math.max(1, Math.ceil(hours / baseStep)));
  const dt = hours / substeps;
  const sources = defaultSources(opts);
  const sinks = defaultSinks(opts);

  const active = new Set(chunks);
  for (let s = 0; s < substeps; s++) {
    substep(region, chunks, active, dt, opts, sources, sinks, budget);
  }
  if (opts.vegetation !== false) {
    applyFlowImpacts(chunks, cfg, hours, opts.worldHours ?? 0);
  }
  return budget;
}

function sortChunks(iterable: Iterable<Chunk>): Chunk[] {
  const chunks = Array.from(iterable);
  chunks.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return chunks;
}

function substep(
  region: WaterRegion,
  chunks: Chunk[],
  active: Set<Chunk>,
  dtHours: number,
  opts: WaterPhysicsOptions,
  sources: Required<WaterSources>,
  sinks: Required<WaterSinks>,
  budget: WaterBudget,
): void {
  const cfg = region.cfg;
  const n = chunks[0].n;
  const area = cfg.waterCellMeters * cfg.waterCellMeters;
  const dtSeconds = dtHours * 60; // 1 h de jogo = 60 s reais (dia de 24 min)
  const evapFactor = evaporationFactor(opts);

  // ---- 1. fontes: chuva/escoamento pendente + recarga do lençol -------------
  // Também marca quais chunks têm água em movimento: chunk seco não entra na
  // varredura de fluxo (prioriza regiões ativas/molhadas).
  const hasWater = new Uint8Array(chunks.length);
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const depth = chunk.waterDepth;
    const input = chunk.surfaceInput;
    const base = chunk.waterBase;
    for (let i = 0; i < n * n; i++) {
      let d = depth[i];
      const incoming = input[i];
      if (incoming > 0) {
        input[i] = 0;
        d += incoming;
        budget.rain += incoming * area;
        chunk.waterDirty = true;
      }
      if (sources.springs) {
        const target = base[i];
        if (target > d + 1e-6) {
          const added = Math.min(target - d, springRate(chunk, i, cfg) * dtHours);
          if (added > 0) {
            d += added;
            budget.springs += added * area;
            chunk.waterDirty = true;
          }
        }
      }
      depth[i] = d;
      if (d > MIN_DEPTH) hasWater[ci] = 1;
    }
  }

  // ---- 2. fluxo: snapshot → deltas, com capacidade por origem ---------------
  for (const chunk of chunks) chunk.waterDelta.fill(0);

  const outVolume = new Float64Array(8);
  const outSpeed = new Float64Array(8);
  const outDir = new Int32Array(8);
  const outTarget: Chunk[] = new Array(8);
  const outIndex = new Int32Array(8);
  const outOpen = new Uint8Array(8);
  const maxDepth = cfg.waterMaxDepth;

  for (let ci = 0; ci < chunks.length; ci++) {
    if (!hasWater[ci]) continue;
    const chunk = chunks[ci];
    const depth = chunk.waterDepth;
    const elev = chunk.elev;
    const delta = chunk.waterDelta;
    const gx0 = chunk.cx * n;
    const gy0 = chunk.cy * n;
    const relax = 1 - Math.exp(-dtSeconds / Math.max(0.05, cfg.waterVelocityRelaxSeconds));
    const decay = Math.exp(-dtSeconds / Math.max(0.05, cfg.waterVelocityRelaxSeconds));

    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const d = depth[i];
        if (!(d > MIN_DEPTH)) {
          // água parada/ausente perde velocidade (não fica "correndo" no vazio)
          chunk.flowX[i] *= decay;
          chunk.flowY[i] *= decay;
          continue;
        }
        const ei = elev[i];
        const surface = ei + d;
        const plantsHere = chunk.plantsInCell(lx, ly).length;
        const roughness = Math.max(
          0.012,
          cfg.waterManningBase +
            SOIL_ROUGHNESS[chunk.soilType[i]] +
            Math.min(cfg.waterManningVegetation, plantsHere * 0.018),
        );
        let count = 0;
        let sumVolume = 0;
        let maxDh = 0;

        for (let dir = 0; dir < 8; dir++) {
          const dx = DX8[dir];
          const dy = DY8[dir];
          const nx = lx + dx;
          const ny = ly + dy;
          let target: Chunk | null;
          let j: number;
          if (nx >= 0 && ny >= 0 && nx < n && ny < n) {
            target = chunk;
            j = ny * n + nx;
          } else {
            // travessia de borda: o vizinho pode estar em outro chunk
            target = region.cellAt(gx0 + nx, gy0 + ny);
            if (!target) continue; // chunk totalmente descarregado = parede
            j = target.cellIdx(gx0 + nx - target.cx * n, gy0 + ny - target.cy * n);
          }
          const open = opts.openBoundary === true && !active.has(target);
          const hj = target.elev[j] + target.waterDepth[j];
          const dh = surface - hj;
          if (dh <= cfg.waterHeadEpsilon) continue;
          const sill = Math.max(ei, target.elev[j]);
          const effectiveDepth = Math.min(d, surface - sill);
          if (effectiveDepth <= MIN_DEPTH) continue;
          const dist = (dir & 1) === 1 ? SQRT2 : 1;
          const slope = dh / (cfg.waterCellMeters * dist);
          const speed = Math.cbrt(effectiveDepth * effectiveDepth) * Math.sqrt(slope) / roughness;
          if (!(speed > 0) || !isFinite(speed)) continue;
          const discharge = speed * effectiveDepth * cfg.waterCellMeters * cfg.waterFlowScale; // m³/s (escala calibrada)
          let volume = discharge * dtSeconds;
          if (!(volume > 0) || !isFinite(volume)) continue;
          // não pode rebaixar a origem abaixo do nível do destino neste subpasso
          volume = Math.min(volume, dh * 0.5 * area);
          if (volume <= 1e-12) continue;
          outVolume[count] = volume;
          outSpeed[count] = Math.min(cfg.waterMaxVelocity, speed * cfg.waterFlowScale);
          outDir[count] = dir;
          outTarget[count] = target;
          outIndex[count] = j;
          outOpen[count] = open ? 1 : 0;
          sumVolume += volume;
          if (dh > maxDh) maxDh = dh;
          count++;
        }

        if (count === 0) {
          chunk.flowX[i] *= decay;
          chunk.flowY[i] *= decay;
          continue;
        }

        // conservação + estabilidade: limite global por célula de origem
        const maxOut = Math.min(
          cfg.waterMaxOutflowFraction * d * area,
          maxDh * 0.5 * area, // equalização de superfície
        );
        const scale = sumVolume > maxOut ? Math.max(0, maxOut) / sumVolume : 1;
        if (!(scale > 0)) {
          chunk.flowX[i] *= decay;
          chunk.flowY[i] *= decay;
          continue;
        }

        let weight = 0;
        let vx = 0;
        let vy = 0;
        for (let k = 0; k < count; k++) {
          const volume = outVolume[k] * scale;
          if (!(volume > 0)) continue;
          const target = outTarget[k];
          const j = outIndex[k];
          const layer = volume / area; // m³ → m de lâmina
          delta[i] -= layer;
          if (outOpen[k]) {
            budget.boundary += volume;
          } else {
            target.waterDelta[j] += layer;
            target.waterDirty = true;
          }
          const speed = outSpeed[k] * scale;
          const dir = outDir[k];
          const dist = (dir & 1) === 1 ? SQRT2 : 1;
          const ux = DX8[dir] / dist;
          const uy = DY8[dir] / dist;
          weight += volume;
          vx += volume * speed * ux;
          vy += volume * speed * uy;
        }
        chunk.waterDirty = true;
        const rawVx = weight > 1e-12 ? vx / weight : 0;
        const rawVy = weight > 1e-12 ? vy / weight : 0;
        // inércia (mistura com o estado anterior) evita direção "piscando"
        chunk.flowX[i] += (clamp(rawVx, -cfg.waterMaxVelocity, cfg.waterMaxVelocity) - chunk.flowX[i]) * relax;
        chunk.flowY[i] += (clamp(rawVy, -cfg.waterMaxVelocity, cfg.waterMaxVelocity) - chunk.flowY[i]) * relax;
      }
    }
  }

  // ---- 3. aplica deltas + sumidouros (evaporação, infiltração, drenagem) ----
  const floodDecay = Math.exp(-dtHours / 6);
  for (const chunk of chunks) {
    const depth = chunk.waterDepth;
    const delta = chunk.waterDelta;
    for (let i = 0; i < n * n; i++) {
      const before = depth[i];
      let d = before + delta[i];
      delta[i] = 0;
      if (!(d > 0) || !isFinite(d)) d = 0;
      if (d > maxDepth) {
        // alívio de segurança: nunca deixa o volume divergir
        budget.drainage += (d - maxDepth) * area;
        d = maxDepth;
      }

      const soil = chunk.soilType[i];
      if (sinks.evaporation && d > 0) {
        const evap = Math.min(d, cfg.waterEvaporationPerHour * evapFactor * dtHours);
        if (evap > 0) {
          d -= evap;
          budget.evaporation += evap * area;
        }
      }
      if (sinks.infiltration && d > 0) {
        const saturation = clamp(chunk.moisture[i], 0, 1);
        // leito de rio/lago é colmatado: infiltra bem menos que a margem seca
        const kind = chunk.waterKind[i];
        const bedSeep = kind & 1 ? 0.2 : kind & 2 ? 0.15 : 1;
        const capacity =
          SOIL_KSAT[soil] *
          dtHours *
          (1 - saturation) *
          (0.5 + 0.5 * clamp(chunk.soilDepth[i] / 1.4, 0, 1)) *
          bedSeep;
        const infiltrated = Math.min(d, Math.max(0, capacity));
        if (infiltrated > 0) {
          d -= infiltrated;
          chunk.moisture[i] = clamp(
            saturation + infiltrated / DEFAULT_SOIL_WATER_CAPACITY,
            0.02,
            1,
          );
          budget.infiltration += infiltrated * area;
          chunk.soilDirty = true;
        }
      }
      if (sinks.drainage && d > 0) {
        const reference = Math.max(chunk.waterBase[i], 0.06);
        if (d > reference) {
          const drain = Math.min(
            d - reference,
            cfg.waterDrainagePerHour * dtHours * (1 + (d - reference)),
          );
          if (drain > 0) {
            d -= drain;
            budget.drainage += drain * area;
          }
        }
      }

      if (d < 0) d = 0;
      if (d > maxDepth) d = maxDepth;
      if (Math.abs(d - before) > 1e-7) chunk.waterDirty = true;
      depth[i] = d;

      if (d > cfg.waterFloodDepth) chunk.floodHours[i] += dtHours;
      else chunk.floodHours[i] *= floodDecay;
    }
  }
}

function springRate(chunk: Chunk, i: number, cfg: WorldConfig): number {
  const kind = chunk.waterKind[i];
  if (!(kind & 3)) return 0;
  // contribuição local da bacia (acc - montante) — nascente onde ela existe
  const weight = chunk.springWeight[i];
  const river = cfg.waterBaseflowPerHour * weight;
  if (kind & 1) {
    // lagos recebem recarga direta pequena + a vazão que os rios trazem
    return Math.min(cfg.waterLakeSeepagePerHour, 0.02 + river);
  }
  return river;
}

function evaporationFactor(opts: WaterPhysicsOptions): number {
  const temp = opts.temperature ?? 20;
  const daylight = clamp(opts.daylight ?? 0.7, 0, 1);
  const thermal = clamp((temp - 2) / 28, 0.08, 1.8);
  return clamp(thermal * (0.45 + 0.55 * daylight), 0.05, 2.2);
}

/**
 * Eventos de vegetação dependentes da correnteza. Chamado uma vez por passo
 * de física (não por subpasso) para que a taxa dependa de horas reais.
 */
export function applyFlowImpacts(
  chunks: Chunk[],
  cfg: WorldConfig,
  hours: number,
  worldHours: number,
  seed = cfg.seed,
): WaterImpacts {
  const result: WaterImpacts = { uprooted: 0, floodedCells: 0 };
  if (!(hours > 0)) return result;
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const worldDay = worldHours / 24;
  const hashStep = Math.floor(worldHours * 1000);

  for (const chunk of chunks) {
    const n = chunk.n;
    let removedHere = 0;
    let changed = false;
    const maxRemovals = Math.min(6, Math.max(1, Math.ceil(hours * 3)));

    // Estresse por alagamento prolongado: atinge todas as células inundadas,
    // não só as que têm planta (o solo/raízes também sentem).
    for (let i = 0; i < n * n; i++) {
      const depth = chunk.waterDepth[i];
      if (depth <= cfg.waterFloodDepth) continue;
      result.floodedCells++;
      if (chunk.floodHours[i] >= cfg.waterFloodStressHours) {
        // estresse genérico pequeno: a tolerância por espécie é aplicada abaixo
        const severity = clamp((depth - cfg.waterFloodDepth) / 0.8, 0, 1.5);
        chunk.stress[i] = clamp(chunk.stress[i] + hours * 0.003 * severity, 0, 2);
      }
    }

    for (const plant of chunk.livePlants()) {
      if (removedHere >= maxRemovals) break;
      const lx = clamp(Math.floor(plant.x / cellPx) - chunk.cx * n, 0, n - 1);
      const ly = clamp(Math.floor(plant.y / cellPx) - chunk.cy * n, 0, n - 1);
      const i = chunk.cellIdx(lx, ly);
      const depth = chunk.waterDepth[i];
      if (depth <= cfg.waterFloodDepth) continue;
      const speed = Math.hypot(chunk.flowX[i], chunk.flowY[i]);
      if (speed <= cfg.waterUprootSpeed) continue;
      const sp = SPECIES[plant.species];
      const vulnerability = 1 - sp.floodTolerance;
      if (chunk.floodHours[i] >= cfg.waterFloodStressHours) {
        // alagamento prolongado estressa mais quem é intolerante
        const severity = clamp((depth - cfg.waterFloodDepth) / 0.8, 0, 1.5);
        chunk.stress[i] = clamp(
          chunk.stress[i] + hours * 0.008 * severity * vulnerability,
          0,
          2,
        );
      }
      if (vulnerability <= 0.08) continue;
      // arrasto = pressão hidrostática (cresce com a profundidade) × velocidade
      const drag = (waterPressureKPa(cfg, depth) * speed) / 10;
      const depthFactor = clamp((depth - cfg.waterFloodDepth * 0.8) / 0.8, 0, 1.6);
      const speedFactor = clamp((speed - cfg.waterUprootSpeed) / 0.12, 0, 1.6) * clamp(drag, 0, 1.6);
      const size = plantSize(plant, chunk, cfg, worldDay);
      const root = clamp(sp.rootDepth / 1.5, 0.1, 1);
      const resistance = 0.3 + 0.7 * root + 0.4 * size;
      const hazard =
        (cfg.waterUprootRate * hours * vulnerability * depthFactor * speedFactor) /
        Math.max(0.2, resistance);
      if (!(hazard > 0)) continue;
      const chance = Math.min(0.92, 1 - Math.exp(-hazard));
      const roll = hashImpact(seed, plant.id, hashStep, chunk.cx, chunk.cy);
      if (roll < chance) {
        chunk.removedPlants.add(plant.id);
        // árvore derrubada vira detrito/liteira no local (matéria orgânica)
        chunk.litter[i] = Math.min(16, chunk.litter[i] + 1.4 + size * 1.6);
        chunk.soilDirty = true;
        chunk.dirty = true;
        result.uprooted++;
        removedHere++;
        changed = true;
      }
    }

    // Alagamento também encharca o solo (recarga lenta) — ajuda a vegetação
    // ripária e é consistente com a infiltração do solver.
    for (let i = 0; i < n * n; i++) {
      if (chunk.waterDepth[i] <= cfg.waterFloodDepth) continue;
      chunk.moisture[i] = clamp(chunk.moisture[i] + hours * 0.002, 0.02, 1);
    }

    if (changed) chunk.rebuildPlantIndex();
  }
  return result;
}

/** hash determinístico e independente da ordem de varredura dos chunks */
function hashImpact(seed: number, id: number, step: number, cx: number, cy: number): number {
  return hash2(seed ^ 0x5f3759df, (id ^ Math.imul(step + 1, 0x9e3779b1)) | 0, cx * 73856093 ^ cy * 19349663, 907);
}

/** Volume total de água superficial de um conjunto de chunks (m³). */
export function totalWaterVolume(chunks: Iterable<Chunk>, cfg: WorldConfig): number {
  const area = cfg.waterCellMeters * cfg.waterCellMeters;
  let sum = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.waterDepth.length; i++) sum += chunk.waterDepth[i];
  }
  return sum * area;
}

/** Soma da lâmina (m) — útil para relatórios por célula/cenário. */
export function totalWaterDepth(chunks: Iterable<Chunk>): number {
  let sum = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.waterDepth.length; i++) sum += chunk.waterDepth[i];
  }
  return sum;
}
