/**
 * Erosão, transporte de sedimentos, deposição e formação de margens arenosas.
 *
 * Tudo deriva do estado REAL da água (`flowX/flowY`, `waterDepth`), do relevo
 * (`elev`,`slope`), do solo (`soilType`,`sand`,`litter`,`humus`) e da vegetação
 * (`canopyCoverAt`, `rootDepth`). Nenhuma parte usa `flowDir` pré-calculada nem
 * a animação da correnteza como se fosse dado físico.
 *
 * Modelo:
 *  1. Desagregação (detachment): excesso de velocidade sobre uma velocidade
 *     crítica que depende da textura, da cobertura de copa, da matéria orgânica
 *     e das raízes. Só é erodido o que a carga suspensa local ainda consegue
 *     transportar (limite de capacidade) — nada de criar sedimento do nada.
 *  2. Transporte: a carga suspensa avança na direção real da velocidade, em
 *     buffers de snapshot (uma carga não é movida duas vezes no mesmo
 *     subpasso), atravessando fronteiras de chunk via `cellAt`.
 *  3. Deposição: quando a capacidade de transporte cai (correnteza mais lenta,
 *     lâmina mais rasa, água parada), o excedente assenta. O material grosso
 *     (areia) assenta primeiro, com correnteza moderada; os finos só assentam
 *     em água quase parada (lagos/depressões) — por isso bancos de areia se
 *     formam em margens e curvas, e lama se acumula em áreas profundas.
 *  4. Mistura superficial: a deposição/erosão mistura a fração de areia da
 *     camada superficial (`sand`), que classifica o solo com histerese e
 *     alimenta a renderização.
 *
 * Conservação: cada metro de elevação removido vira carga suspensa; cada metro
 * depositado sai da carga. `delta de elevação + carga` é constante (o orçamento
 * em `SedimentBudget` fecha com `lost = 0`).
 */
import type { WorldConfig } from '../core/config';
import { clamp, hash2, smoothstep } from '../core/rng';
import { Chunk, SOIL_ALLUVIAL, SOIL_CLAY, SOIL_FOREST, SOIL_ROCK, SOIL_SAND } from './chunk';
import { SPECIES } from './flora';
import { canopyCoverAt, plantSize } from './ecology';

/** Interface do mundo usada pela morfologia (testável com chunks sintéticos). */
export interface SedimentRegion {
  cfg: WorldConfig;
  /** chunks ativos que participam da simulação */
  sedimentChunks(): Iterable<Chunk>;
  /** célula global → chunk (null se descarregado) */
  cellAt(cellX: number, cellY: number): Chunk | null;
  /** aplica delta de elevação normalizada e devolve o aplicado */
  addDelta(cellX: number, cellY: number, dNorm: number): number;
  /** delta de elevação normalizada acumulado (erosão negativa) */
  getDelta(cellX: number, cellY: number): number;
}

/** erodibilidade relativa por textura (areia, argila, rocha, florestal, aluvial) */
const SOIL_ERODIBILITY = [1.6, 0.5, 0.12, 0.7, 0.95];
/** velocidade crítica de desagregação (m/s), solo nu */
const SOIL_CRITICAL_SPEED = [0.035, 0.09, 0.2, 0.07, 0.05];
/** fração de areia da superfície por textura de origem */
export const SOIL_SAND_BASE = [0.85, 0.1, 0.03, 0.15, 0.35];

export interface SedimentBudget {
  /** material removido do leito (m somados por célula) */
  eroded: number;
  /** material depositado (m somados por célula) */
  deposited: number;
  /** material movido entre células (m equivalentes) */
  transported: number;
  /** material que não pôde ser aplicado e voltou para a carga (m) */
  retained: number;
  /** perda inexplicada (deve ser sempre 0) */
  lost: number;
  /** árvores derrubadas pela exposição de raízes */
  uprooted: number;
  /** células que passaram a solo arenoso neste passo */
  newSandCells: number;
}

export const createSedimentBudget = (): SedimentBudget => ({
  eroded: 0,
  deposited: 0,
  transported: 0,
  retained: 0,
  lost: 0,
  uprooted: 0,
  newSandCells: 0,
});

export function accumulateSedimentBudget(target: SedimentBudget, source: SedimentBudget): void {
  target.eroded += source.eroded;
  target.deposited += source.deposited;
  target.transported += source.transported;
  target.retained += source.retained;
  target.lost += source.lost;
  target.uprooted += source.uprooted;
  target.newSandCells += source.newSandCells;
}

export interface SedimentOptions {
  /** dia de jogo (idade das plantas/copa) */
  worldDay?: number;
  /** horas totais de jogo (hash determinístico de eventos) */
  worldHours?: number;
  /** intensidade de chuva atual 0..1 (rainsplash + solo exposto) */
  rainIntensity?: number;
  /** liga/desliga interação com vegetação */
  vegetation?: boolean;
  budget?: SedimentBudget;
}

const DEFAULTS = { worldDay: 0, worldHours: 0, rainIntensity: 0, vegetation: true } as const;

/** textura inicial de areia para um tipo de solo gerado */
export const sandBaseOf = (soil: number): number => SOIL_SAND_BASE[soil] ?? 0.2;

const ZERO_COVER = new Float32Array(256);

interface ChunkActivity {
  wet: boolean;
  loaded: boolean;
}

/** leitura única por chunk: há água? há carga suspensa? (evita laços inúteis) */
function scanActivity(chunks: Chunk[]): Map<Chunk, ChunkActivity> {
  const out = new Map<Chunk, ChunkActivity>();
  for (const chunk of chunks) {
    let wet = false;
    let loaded = false;
    const cells = chunk.n * chunk.n;
    for (let i = 0; i < cells; i++) {
      if (chunk.waterDepth[i] > 0.01) wet = true;
      if (chunk.sediment[i] > 1e-9) loaded = true;
      if (wet && loaded) break;
    }
    out.set(chunk, { wet, loaded });
  }
  return out;
}

function sortChunks(iterable: Iterable<Chunk>): Chunk[] {
  const chunks = Array.from(iterable);
  chunks.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return chunks;
}

/** altura da célula vizinha, atravessando chunks quando possível */
function elevAt(region: SedimentRegion, chunk: Chunk, gx: number, gy: number, fallback: number): number {
  const n = chunk.n;
  const lx = gx - chunk.cx * n;
  const ly = gy - chunk.cy * n;
  if (lx >= 0 && ly >= 0 && lx < n && ly < n) return chunk.elev[ly * n + lx];
  const other = region.cellAt(gx, gy);
  if (!other) return fallback;
  return other.elev[(gy - other.cy * other.n) * other.n + (gx - other.cx * other.n)];
}

/** recalcula declividade/aspecto de uma célula alterada (inclui vizinhos de outro chunk) */
function refreshSlope(region: SedimentRegion, chunk: Chunk, i: number): void {
  const n = chunk.n;
  const lx = i % n;
  const ly = (i / n) | 0;
  const gx = chunk.cx * n + lx;
  const gy = chunk.cy * n + ly;
  const e = chunk.elev[i];
  const dx = elevAt(region, chunk, gx + 1, gy, e) - e;
  const dy = elevAt(region, chunk, gx, gy + 1, e) - e;
  chunk.slope[i] = Math.sqrt(dx * dx + dy * dy);
  if (dx !== 0 || dy !== 0) chunk.aspect[i] = Math.atan2(dy, dx);
}

/**
 * Passo de morfologia fluvial: erosão → transporte → deposição.
 * `hours` é o intervalo de jogo coberto (normalmente `periodErosionHours`),
 * dividido internamente em subpassos para estabilidade.
 */
export function stepErosion(
  region: SedimentRegion,
  hours: number,
  options: SedimentOptions = {},
): SedimentBudget {
  const budget = options.budget ?? createSedimentBudget();
  const cfg = region.cfg;
  if (!(hours > 0)) return budget;
  const chunks = sortChunks(region.sedimentChunks());
  if (chunks.length === 0) return budget;

  const opts = { ...DEFAULTS, ...options };
  const substeps = Math.min(
    Math.max(1, cfg.erosionMaxSubsteps),
    Math.max(1, Math.ceil(hours / Math.max(0.25, cfg.erosionSubstepHours))),
  );
  const dt = hours / substeps;

  // proteção pela vegetação é praticamente constante num passo: mapas cacheados
  const cover = new Map<Chunk, Float32Array>();
  const roots = new Map<Chunk, Float32Array>();
  const empty = new Float32Array(chunks[0].n * chunks[0].n);
  const mapBudget = { remaining: 10 };
  for (const chunk of chunks) {
    if (!opts.vegetation) {
      cover.set(chunk, empty);
      roots.set(chunk, empty);
      continue;
    }
    const maps = plantMaps(chunk, cfg, opts.worldDay, mapBudget);
    cover.set(chunk, maps.cover);
    roots.set(chunk, maps.roots);
  }

  const active = new Set(chunks);
  const activity = scanActivity(chunks);
  // com chuva, o impacto direto também desagrega células secas e inclinadas
  const splashPossible = (opts.rainIntensity ?? 0) >= 0.15;
  for (let s = 0; s < substeps; s++) {
    for (const chunk of chunks) {
      const act = activity.get(chunk)!;
      if (!act.wet && !splashPossible) continue;
      erodeBed(region, chunk, dt, opts, cover.get(chunk)!, roots.get(chunk)!, budget);
    }
    transportAndDeposit(region, chunks, active, activity, dt, cfg, budget);
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.n * chunk.n; i++) {
        if (!chunk.terrainDirty[i]) continue;
        chunk.terrainDirty[i] = 0;
        refreshSlope(region, chunk, i);
      }
    }
  }
  for (const chunk of chunks) chunk.dirty = true;
  return budget;
}

/** deslocamentos pré-computados (dx, dy, fator de sombra) por raio de copa */
const canopyOffsetCache = new Map<number, number[]>();
function canopyOffsets(radius: number): number[] {
  const key = Math.round(radius * 10) / 10;
  const cached = canopyOffsetCache.get(key);
  if (cached) return cached;
  const out: number[] = [];
  const reach = Math.ceil(key);
  const r2 = key * key;
  for (let oy = -reach; oy <= reach; oy++) {
    for (let ox = -reach; ox <= reach; ox++) {
      const d2 = ox * ox + oy * oy;
      if (d2 > r2) continue;
      out.push(ox, oy, 1 - Math.sqrt(d2) / (key + 0.5));
    }
  }
  canopyOffsetCache.set(key, out);
  return out;
}

/**
 * Mapas de copa/raízes por célula, construídos por "splat" a partir das plantas
 * (uma chamada a `plantSize` por planta, não por célula) e cacheados por chunk.
 * Vegetação muda devagar: o cache é reconstruído a cada 6 h de jogo e sempre que
 * o índice de plantas é refeito (`rebuildPlantIndex`).
 */
function plantMaps(
  chunk: Chunk,
  cfg: WorldConfig,
  worldDay: number,
  budget?: { remaining: number },
): { cover: Float32Array; roots: Float32Array } {
  const cells = chunk.n * chunk.n;
  // a copa muda devagar (dias): 1 reconstrução por dia de jogo, ou quando o
  // índice de plantas é refeito (árvore derrubada/recrutada). O orçamento
  // espalha as reconstruções por alguns passos para não travar um quadro.
  const stamp = Math.floor(worldDay);
  const fresh = chunk.coverStamp === stamp && chunk.coverCache && chunk.rootCache;
  if (fresh) return { cover: chunk.coverCache!, roots: chunk.rootCache! };
  if (budget) {
    if (budget.remaining <= 0 && chunk.coverCache && chunk.rootCache) {
      return { cover: chunk.coverCache, roots: chunk.rootCache };
    }
    budget.remaining -= 1;
  }
  const cover = new Float32Array(cells);
  const roots = new Float32Array(cells);
  for (const p of chunk.livePlants()) {
    const sp = SPECIES[p.species];
    const size = plantSize(p, chunk, cfg, worldDay);
    if (size < 0.08) continue;
    const lx = clamp(Math.floor(p.x / (cfg.simCellTiles * cfg.tileSize)) - chunk.cx * chunk.n, 0, chunk.n - 1);
    const ly = clamp(Math.floor(p.y / (cfg.simCellTiles * cfg.tileSize)) - chunk.cy * chunk.n, 0, chunk.n - 1);
    const ci = chunk.cellIdx(lx, ly);
    roots[ci] = Math.max(roots[ci], clamp((sp.rootDepth * size) / 1.5, 0, 1));
    const offsets = canopyOffsets(sp.canopy);
    for (let k = 0; k < offsets.length; k += 3) {
      const nx = lx + offsets[k];
      const ny = ly + offsets[k + 1];
      if (nx < 0 || ny < 0 || nx >= chunk.n || ny >= chunk.n) continue;
      cover[ny * chunk.n + nx] += size * offsets[k + 2] * 0.5;
    }
  }
  for (let i = 0; i < cells; i++) if (cover[i] > 1) cover[i] = 1;
  chunk.coverCache = cover;
  chunk.rootCache = roots;
  chunk.coverStamp = stamp;
  return { cover, roots };
}

/** 1. desagregação do leito pelo escoamento e pelo impacto da chuva */
function erodeBed(
  region: SedimentRegion,
  chunk: Chunk,
  dt: number,
  opts: { worldDay: number; rainIntensity: number },
  cover: Float32Array,
  roots: Float32Array,
  budget: SedimentBudget,
): void {
  const cfg = region.cfg;
  const n = chunk.n;
  const range = cfg.elevationRange;
  const gx0 = chunk.cx * n;
  const gy0 = chunk.cy * n;
  const rain = clamp(opts.rainIntensity, 0, 1);

  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const depth = chunk.waterDepth[i];
      const speed = Math.sqrt(chunk.flowX[i] * chunk.flowX[i] + chunk.flowY[i] * chunk.flowY[i]);
      const slope = chunk.slope[i];
      // exposição: correnteza sobre o leito ou chuva batendo em solo inclinado
      if (depth < 0.015 && rain < 0.15) continue;
      if (slope < 0.02) continue;
      const room = cfg.sedimentMaxLoad - chunk.sediment[i];
      if (room <= 1e-9) continue; // carga já saturada: o leito não cede mais

      const soil = chunk.soilType[i];
      const sand = chunk.sand[i];
      const organic = clamp((chunk.litter[i] + chunk.humus[i] * 0.5) / 6, 0, 1);
      const vegetation = clamp(cover[i], 0, 1);

      // resistência: textura + copa + matéria orgânica + raízes
      const erodibility =
        SOIL_ERODIBILITY[soil] * (1 - sand) + SOIL_ERODIBILITY[SOIL_SAND] * sand;
      const vCrit =
        SOIL_CRITICAL_SPEED[soil] *
        (1 + 0.9 * vegetation + 0.5 * organic + 1.1 * roots[i]);

      const excess = speed - vCrit;
      if (excess <= 0) {
        // só impacto de chuva pode desagregar quando a correnteza é insuficiente
        if (rain < 0.15) continue;
      }
      const flowTerm =
        excess > 0
          ? Math.pow(excess, 1.4) * Math.sqrt(Math.max(0, depth)) * (0.35 + 0.65 * clamp(slope, 0, 2))
          : 0;
      // chuva: desagregação por impacto direto (protegida por copa e serrapilheira)
      const splashTerm =
        rain * smoothstep(0.06, 1.2, slope) * (1 - 0.85 * vegetation) * (1 - 0.5 * organic) * 0.05;

      let rate = cfg.erosionRate * erodibility * (flowTerm + splashTerm); // m/h
      if (!(rate > 0) || !isFinite(rate)) continue;
      rate = Math.min(rate, cfg.erosionMaxRatePerHour);

      let dz = rate * dt; // metros de rebaixamento neste subpasso
      // não retirar mais do que a lâmina (o leito seco não é lavado por correnteza)
      dz = Math.min(dz, Math.max(0, depth) + rain * 0.002);
      // e nunca mais do que a capacidade de carga restante
      dz = Math.min(dz, room * range);
      if (!(dz > 1e-9)) continue;

      const applied = region.addDelta(gx0 + lx, gy0 + ly, -dz / range); // normalizado, negativo
      const erodedM = -applied * range;
      if (!(erodedM > 0)) continue;
      chunk.elev[i] -= erodedM;
      chunk.terrainDirty[i] = 1;
      chunk.sediment[i] = Math.min(cfg.sedimentMaxLoad, chunk.sediment[i] + erodedM / range);
      budget.eroded += erodedM;

      // o material removido expõe o subsolo: a textura tende ao material de origem
      // e o depósito arenoso superficial é lavado junto
      const mix = Math.min(1, erodedM / Math.max(0.02, cfg.sandLayerMeters));
      chunk.sand[i] = clamp(sand + (chunk.sandBase[i] - sand) * mix, 0, 1);
      chunk.sandLayer[i] = Math.max(0, chunk.sandLayer[i] - erodedM * 0.5);
    }
  }
}

/** 2 e 3. transporte da carga suspensa + deposição onde a capacidade cai */
function transportAndDeposit(
  region: SedimentRegion,
  chunks: Chunk[],
  active: Set<Chunk>,
  activity: Map<Chunk, ChunkActivity>,
  dt: number,
  cfg: WorldConfig,
  budget: SedimentBudget,
): void {
  const range = cfg.elevationRange;
  const depositFractionMax = clamp(cfg.sedimentDepositionPerHour * dt, 0, 0.9);

  // snapshot + deltas: uma carga não é movida duas vezes no mesmo subpasso
  for (const chunk of chunks) {
    chunk.sedimentScratch.set(chunk.sediment);
    chunk.sedimentDelta.fill(0);
  }

  for (const chunk of chunks) {
    const act = activity.get(chunk)!;
    // a carga só pode vir do próprio chunk (erosão/deposição deste subpasso)
    if (!act.loaded && chunk.sedimentDelta.every((v) => v === 0)) {
      let any = false;
      for (let i = 0; i < chunk.n * chunk.n; i++) {
        if (chunk.sedimentScratch[i] > 1e-12) {
          any = true;
          break;
        }
      }
      if (!any) continue;
    }
    const n = chunk.n;
    const gx0 = chunk.cx * n;
    const gy0 = chunk.cy * n;
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const load = chunk.sedimentScratch[i];
        if (!(load > 1e-12)) continue;

        const depth = chunk.waterDepth[i];
        const vx = chunk.flowX[i];
        const vy = chunk.flowY[i];
        const speed = Math.sqrt(vx * vx + vy * vy);

        // capacidade de transporte: cai com velocidade e com a lâmina
        const capacity =
          cfg.sedimentCapacity *
          Math.pow(Math.max(0, speed), 1.5) *
          Math.sqrt(Math.max(0, depth) + 0.02);

        let remaining = load;
        // sedimentação só acontece onde a correnteza perdeu força (margens,
        // curvas, remansos); canal rápido permanece erosivo e não assoreia.
        // Água rasa deposita mais fácil: é assim que bancos de areia crescem.
        const slack = clamp((0.18 - speed) / 0.18, 0, 1);
        const shallowBoost = 1 + clamp((0.35 - depth) / 0.35, 0, 1) * 1.5;
        if (load > capacity && slack > 0) {
          const want = Math.min(load - capacity, depositFractionMax * slack * shallowBoost);
          if (want > 1e-12) {
            const applied = Math.max(0, region.addDelta(gx0 + lx, gy0 + ly, want));
            if (applied > 0) {
              chunk.sedimentDelta[i] -= applied;
              chunk.elev[i] += applied * range;
              chunk.terrainDirty[i] = 1;
              remaining -= applied;
              budget.deposited += applied * range;
              mixSand(chunk, i, depositSandShare(speed, depth), applied * range, cfg);
            }
          }
        }
        if (!(remaining > 1e-12)) continue;

        // transporte: fração da carga avança uma célula na direção da velocidade
        const frac = clamp(speed / Math.max(1e-3, cfg.sedimentTransportSpeed), 0, 1);
        if (!(frac > 0)) continue;
        const amount = remaining * frac;
        if (!(amount > 1e-12)) continue;

        let dirX = 0;
        let dirY = 0;
        if (speed > 1e-6) {
          const ux = vx / speed;
          const uy = vy / speed;
          if (Math.abs(ux) >= Math.abs(uy)) dirX = Math.sign(ux);
          else dirY = Math.sign(uy);
        } else if (chunk.flowDir[i] >= 0) {
          const d = chunk.flowDir[i];
          dirX = [1, 1, 0, -1, -1, -1, 0, 1][d];
          dirY = [0, 1, 1, 1, 0, -1, -1, -1][d];
        }
        if (dirX === 0 && dirY === 0) dirX = 1;

        const tgx = gx0 + lx + dirX;
        const tgy = gy0 + ly + dirY;
        // caminho rápido: destino dentro do próprio chunk (evita chave de string)
        const insideX = lx + dirX;
        const insideY = ly + dirY;
        const neighbour =
          insideX >= 0 && insideY >= 0 && insideX < n && insideY < n
            ? chunk
            : region.cellAt(tgx, tgy);
        // só transporta para um chunk ATIVO: se ele não é simulado, a carga
        // ficaria presa em um buffer que ninguém aplica (perda de massa)
        const target = neighbour && active.has(neighbour) ? neighbour : null;
        if (target) {
          const j = target.cellIdx(tgx - target.cx * n, tgy - target.cy * n);
          chunk.sedimentDelta[i] -= amount;
          target.sedimentDelta[j] += amount;
          budget.transported += amount * range;
        } else {
          // borda sem chunk carregado: deposita aqui (nada de perder carga)
          const applied = Math.max(0, region.addDelta(gx0 + lx, gy0 + ly, amount));
          if (applied > 0) {
            chunk.sedimentDelta[i] -= applied;
            chunk.elev[i] += applied * range;
            chunk.terrainDirty[i] = 1;
            budget.deposited += applied * range;
            mixSand(chunk, i, 0.4, applied * range, cfg);
          }
        }
      }
    }
  }

  // aplica as variações de carga (com limites numéricos explícitos)
  for (const chunk of chunks) {
    const n = chunk.n;
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const next = chunk.sedimentScratch[i] + chunk.sedimentDelta[i];
        chunk.sedimentDelta[i] = 0;
        if (next < 0) {
          budget.lost += -next * range;
          chunk.sediment[i] = 0;
          continue;
        }
        if (next > cfg.sedimentMaxLoad) {
          // saturação: a água não carrega mais nada — o excedente assenta aqui
          const excess = next - cfg.sedimentMaxLoad;
          const applied = Math.max(0, region.addDelta(chunk.cx * n + lx, chunk.cy * n + ly, excess));
          if (applied > 0) {
            chunk.elev[i] += applied * range;
            chunk.terrainDirty[i] = 1;
            budget.deposited += applied * range;
            mixSand(chunk, i, 0.3, applied * range, cfg);
          }
          const stuck = excess - applied;
          if (stuck > 1e-12) budget.retained += stuck * range;
          chunk.sediment[i] = cfg.sedimentMaxLoad;
          continue;
        }
        chunk.sediment[i] = next;
      }
    }
  }

  // água quase parada (lagos, depressões): os finos assentam mesmo sem excesso
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.n * chunk.n; i++) {
      const load = chunk.sediment[i];
      if (load <= 1e-12) continue;
      const speed = Math.sqrt(chunk.flowX[i] * chunk.flowX[i] + chunk.flowY[i] * chunk.flowY[i]);
      if (speed > 0.006) continue;
      const drop = Math.min(load, load * depositFractionMax * 0.5);
      if (!(drop > 1e-12)) continue;
      const gx = chunk.cx * chunk.n + (i % chunk.n);
      const gy = chunk.cy * chunk.n + ((i / chunk.n) | 0);
      const applied = Math.max(0, region.addDelta(gx, gy, drop));
      if (applied > 0) {
        chunk.elev[i] += applied * range;
        chunk.terrainDirty[i] = 1;
        chunk.sediment[i] -= applied;
        budget.deposited += applied * range;
        mixSand(chunk, i, 0, applied * range, cfg); // água parada: só finos
      }
    }
  }
}

/**
 * Mistura a textura da camada superficial com o material depositado e acumula
 * a espessura do depósito arenoso. É esse depósito (e não um sorteio) que
 * permite a célula ser classificada como areia — sem fonte de sedimento, nada
 * de areia.
 */
/**
 * Composição do material que assenta: areia predomina onde a correnteza perde
 * força com pouca lâmina (barras e praias); em água funda e parada assentam
 * mais finos + matéria orgânica (lama de lago).
 */
function depositSandShare(speed: number, depth: number): number {
  return clamp(
    0.78 - 0.45 * smoothstep(0.02, 0.16, speed) - 0.3 * smoothstep(0.25, 1.0, depth),
    0.12,
    0.85,
  );
}

function mixSand(chunk: Chunk, i: number, sandShare: number, thicknessMeters: number, cfg: WorldConfig): void {
  const w = clamp(thicknessMeters / Math.max(0.01, cfg.sandLayerMeters), 0, 1);
  if (!(w > 0)) return;
  const next = clamp(chunk.sand[i] + (sandShare - chunk.sand[i]) * w, 0, 1);
  // rocha exposta não vira praia: o embasamento limita a fração de areia
  chunk.sand[i] = chunk.soilType[i] === SOIL_ROCK ? Math.min(next, 0.5) : next;
  chunk.sandLayer[i] = Math.min(2, chunk.sandLayer[i] + thicknessMeters * sandShare);
}

/**
 * Passo de margem: contato com a água, seleção de finos (lavagem), recuperação
 * do solo sob vegetação, classificação com histerese e exposição de raízes.
 *
 * É barato e roda em frequência curta para que a margem responda ao nível da
 * água durante a partida (bancos de areia "aparecem" sem esperar 24 h).
 */
export function stepBanks(
  region: SedimentRegion,
  hours: number,
  options: SedimentOptions = {},
): SedimentBudget {
  const budget = options.budget ?? createSedimentBudget();
  const cfg = region.cfg;
  if (!(hours > 0)) return budget;
  const chunks = sortChunks(region.sedimentChunks());
  if (chunks.length === 0) return budget;
  const opts = { ...DEFAULTS, ...options };
  const coverHereByChunk = new Map<Chunk, Float32Array>();

  // máscara de água por chunk: vizinhança interna é lida direto do buffer
  const wetMask = new Map<Chunk, Uint8Array>();
  for (const chunk of chunks) {
    const mask = new Uint8Array(chunk.n * chunk.n);
    for (let i = 0; i < mask.length; i++) mask[i] = chunk.waterDepth[i] > 0.01 ? 1 : 0;
    wetMask.set(chunk, mask);
  }

  for (const chunk of chunks) {
    const n = chunk.n;
    const mask = wetMask.get(chunk)!;
    if (opts.vegetation) {
      const maps = plantMaps(chunk, cfg, opts.worldDay, { remaining: 10 });
      coverHereByChunk.set(chunk, maps.cover);
    }
    const coverHere = opts.vegetation ? coverHereByChunk.get(chunk)! : ZERO_COVER;
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const depth = chunk.waterDepth[i];
        // contato com água: própria lâmina ou vizinhança (margem molhada)
        let wet = mask[i] === 1;
        if (!wet) {
          if (lx > 0 && mask[i - 1]) wet = true;
          else if (lx < n - 1 && mask[i + 1]) wet = true;
          else if (ly > 0 && mask[i - n]) wet = true;
          else if (ly < n - 1 && mask[i + n]) wet = true;
          else if (lx === 0 || ly === 0 || lx === n - 1 || ly === n - 1) {
            // borda do chunk: consulta o vizinho (sem costura)
            const gx = chunk.cx * n + lx;
            const gy = chunk.cy * n + ly;
            const nbs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of nbs) {
              const other = region.cellAt(gx + dx, gy + dy);
              if (!other) continue;
              const j = other.cellIdx(gx + dx - other.cx * n, gy + dy - other.cy * n);
              if (other.waterDepth[j] > 0.02) {
                wet = true;
                break;
              }
            }
          }
        }

        const decay = Math.exp(-hours / Math.max(1, cfg.shoreMemoryHours));
        chunk.shoreHours[i] = wet
          ? Math.min(400, chunk.shoreHours[i] + hours)
          : chunk.shoreHours[i] * decay;

        if (chunk.soilCooldown[i] > 0) chunk.soilCooldown[i] = Math.max(0, chunk.soilCooldown[i] - hours);

        const speed = Math.sqrt(chunk.flowX[i] * chunk.flowX[i] + chunk.flowY[i] * chunk.flowY[i]);
        const coverHere01 = clamp(coverHere[i], 0, 1);
        const organic = clamp((chunk.litter[i] + chunk.humus[i] * 0.5) / 6, 0, 1);
        const protection = clamp(coverHere01 * 0.7 + organic * 0.3, 0, 1);

        if (wet) {
          // lavagem seletiva: a correnteza leva os finos e deixa a fração grossa.
          // Só ocorre em solos que JÁ têm areia (aluvial/arenoso) e depois de um
          // contato sustentado com a água; o teto fica abaixo do limiar de
          // classificação, então isso nunca alterna o tipo de solo sozinho.
          if (
            chunk.sandBase[i] >= 0.3 &&
            chunk.shoreHours[i] >= cfg.shoreHoursForSand &&
            chunk.slope[i] <= cfg.bankMaxSlope &&
            speed > 0.012 &&
            depth > 0.015
          ) {
            const target = Math.min(cfg.sandWinnowCap, chunk.sandBase[i] + 0.35);
            if (chunk.sand[i] < target) {
              const rate =
                cfg.sandWinnowRate *
                hours *
                clamp((speed - 0.008) / 0.08, 0, 1) *
                (1 - 0.7 * protection);
              chunk.sand[i] += (target - chunk.sand[i]) * (1 - Math.exp(-rate));
            }
          }
        } else if (
          opts.vegetation &&
          chunk.soilBase[i] !== SOIL_SAND &&
          chunk.soilBase[i] !== SOIL_ROCK &&
          coverHere01 > 0.3
        ) {
          // vegetação estabelecida recoloniza a margem: a areia vai sendo
          // incorporada à camada orgânica (sem praias eternas). Só atua em
          // células que ficaram MAIS arenosas que o material de origem, para
          // não "desarear" toda a planície aluvial do mundo.
          const target = chunk.sandBase[i] * 0.85;
          if (chunk.sand[i] > target) {
            const rate = cfg.sandRecoveryRate * hours * coverHere01;
            chunk.sand[i] += (target - chunk.sand[i]) * (1 - Math.exp(-rate));
            // a vegetação incorpora o depósito: espessura de areia diminui
            chunk.sandLayer[i] = Math.max(0, chunk.sandLayer[i] * Math.exp(-rate));
          }
        }

        chunk.sand[i] = clamp(chunk.sand[i], 0, 1);
        classifySoil(chunk, i, cfg, wet, coverHere01, budget);
      }
    }

    if (opts.vegetation) exposeRoots(region, chunk, cfg, hours, opts, budget);
    chunk.dirty = true;
    chunk.soilDirty = true;
  }
  return budget;
}

/** classificação do solo com histerese + cooldown (sem oscilação areia↔terra) */
function classifySoil(
  chunk: Chunk,
  i: number,
  cfg: WorldConfig,
  wet: boolean,
  cover: number,
  budget: SedimentBudget,
): void {
  const soil = chunk.soilType[i];
  const sand = chunk.sand[i];
  if (chunk.soilCooldown[i] > 0) return;

  // areia exige as duas condições: fração alta E depósito com espessura real
  const hasDeposit = chunk.sandLayer[i] >= cfg.sandMinLayerMeters;
  if (sand >= cfg.sandThreshold && hasDeposit && soil !== SOIL_SAND && soil !== SOIL_ROCK) {
    chunk.soilType[i] = SOIL_SAND;
    chunk.soilCooldown[i] = 48; // h: consolidação mínima antes de reclassificar
    chunk.soilDirty = true;
    budget.newSandCells++;
    return;
  }
  if (soil === SOIL_SAND && sand <= cfg.sandRevertThreshold) {
    const base = chunk.soilBase[i];
    chunk.soilType[i] = wet
      ? SOIL_ALLUVIAL
      : base === SOIL_ROCK
        ? SOIL_CLAY
        : cover > 0.35 && chunk.humus[i] > 2
          ? SOIL_FOREST
          : base;
    chunk.soilCooldown[i] = 48;
    chunk.soilDirty = true;
  }
}

/**
 * Erosão acumulada que expõe raízes: compromete a sustentação da árvore.
 * A remoção usa hash determinístico por (planta, passo) e é limitada por chunk.
 */
function exposeRoots(
  region: SedimentRegion,
  chunk: Chunk,
  cfg: WorldConfig,
  hours: number,
  opts: { worldDay: number; worldHours: number },
  budget: SedimentBudget,
): void {
  const n = chunk.n;
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const range = cfg.elevationRange;
  let removals = 0;
  const maxRemovals = 2;
  const step = Math.floor(opts.worldHours * 1000);

  for (const plant of chunk.livePlants()) {
    if (removals >= maxRemovals) break;
    const lx = clamp(Math.floor(plant.x / cellPx) - chunk.cx * n, 0, n - 1);
    const ly = clamp(Math.floor(plant.y / cellPx) - chunk.cy * n, 0, n - 1);
    const i = chunk.cellIdx(lx, ly);
    const gx = chunk.cx * n + lx;
    const gy = chunk.cy * n + ly;
    const erodedMeters = Math.max(0, -region.getDelta(gx, gy) * range);
    if (erodedMeters <= 0) continue;

    const sp = SPECIES[plant.species];
    const size = plantSize(plant, chunk, cfg, opts.worldDay);
    // raiz normalizada (0..1): raízes profundas precisam de mais solo removido
    // antes de a sustentação ficar comprometida
    const rootNorm = clamp(sp.rootDepth / 1.5, 0, 1);
    // espécies ripárias (tolerantes a inundação) suportam raízes expostas por
    // mais tempo; intolerantes perdem sustentação com menos solo removido
    const threshold = cfg.rootExposureMeters * (0.5 + rootNorm) * (1 + sp.floodTolerance * 1.5);
    const exposed = erodedMeters - threshold;
    if (exposed <= 0) continue;

    const speed = Math.sqrt(chunk.flowX[i] * chunk.flowX[i] + chunk.flowY[i] * chunk.flowY[i]);
    const depth = chunk.waterDepth[i];
    if (depth < 0.03 && speed < 0.03) continue; // raiz exposta sem correnteza: só estresse

    chunk.stress[i] = clamp(chunk.stress[i] + hours * 0.02 * clamp(exposed * 4, 0, 2), 0, 2);
    // resistência: raízes profundas, porte grande e espécie ripária
    const resistance = 0.35 + 0.65 * rootNorm + 0.35 * size + 0.4 * sp.floodTolerance;
    const hazard =
      ((exposed / 0.2) *
        clamp(speed / 0.05, 0, 2) *
        clamp(depth / 0.2, 0, 1.5) *
        hours *
        0.02) /
      Math.max(0.4, resistance);
    if (!(hazard > 0)) continue;
    const roll = hash2(
      cfg.seed ^ 0x2f9a3b,
      (plant.id ^ Math.imul(step + 1, 0x9e3779b1)) | 0,
      (chunk.cx * 73856093) ^ (chunk.cy * 19349663),
      811,
    );
    if (roll < Math.min(0.5, 1 - Math.exp(-hazard))) {
      chunk.removedPlants.add(plant.id);
      chunk.litter[i] = Math.min(16, chunk.litter[i] + 1.2 + size * 1.4);
      chunk.coarse[i] = Math.min(6, chunk.coarse[i] + 0.6 + size * 0.8); // galhos/tronco
      chunk.dirty = true;
      chunk.soilDirty = true;
      budget.uprooted++;
      removals++;
    }
  }
  if (removals > 0) chunk.rebuildPlantIndex();
}
