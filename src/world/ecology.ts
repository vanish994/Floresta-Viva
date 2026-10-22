/**
 * Ecologia: passos de simulação com frequências distintas.
 *
 *  - água/umidade: passos curtos e frequentes
 *  - crescimento, decomposição, nutrientes: passos médios
 *  - erosão/geologia: passos longos
 *
 * Todos os balanços são fechados: decomposição recicla o que existe,
 * intemperismo é a única entrada de P, lixiviação é saída — nada é criado
 * infinitamente por erro numérico (ver testes de conservação).
 */
import type { WorldConfig } from '../core/config';
import { clamp, hash2, smoothstep } from '../core/rng';
import { Chunk, SOIL_ALLUVIAL, SOIL_FOREST, SOIL_ROCK, SOIL_SAND } from './chunk';
import { SPECIES, type PlantRecord } from './flora';
import type { Climate } from './climate';
import { DX8, DY8 } from './hydro';
import { animalDispersalBonus } from './fauna';

export interface Neighborhood {
  /** célula vizinha global (pode cair em outro chunk); null se indisponível */
  cellAt(cellX: number, cellY: number): Chunk | null;
}

export const plantAge = (p: PlantRecord, worldDay: number): number => p.birthAge + worldDay;

export function plantHealth(p: PlantRecord, chunk: Chunk, cfg: WorldConfig, worldDay: number): number {
  const lx = clamp(Math.floor(p.x / (cfg.simCellTiles * cfg.tileSize)) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly = clamp(Math.floor(p.y / (cfg.simCellTiles * cfg.tileSize)) - chunk.cy * chunk.n, 0, chunk.n - 1);
  const stress = chunk.stress[chunk.cellIdx(lx, ly)];
  const age = plantAge(p, worldDay);
  const sp = SPECIES[p.species];
  const senescence = smoothstep(sp.longevity * 0.8, sp.longevity, age);
  return clamp(1 - stress * 0.55 - senescence * 0.8, 0.05, 1);
}

export function plantSize(p: PlantRecord, chunk: Chunk, cfg: WorldConfig, worldDay: number): number {
  const sp = SPECIES[p.species];
  const age = plantAge(p, worldDay);
  if (age <= 0) return 0;
  const health = plantHealth(p, chunk, cfg, worldDay);
  const grow = 1 - Math.exp((-age / sp.maturityAge) * 1.6);
  return clamp(grow, 0, 1) * (0.55 + 0.45 * health);
}

/** cobertura de copa 0..1 numa célula (soma das copas das plantas próximas) */
export function canopyCoverAt(chunk: Chunk, cfg: WorldConfig, lx: number, ly: number, worldDay: number): number {
  void cfg;
  let cover = 0;
  const R = 3;
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      const nx = lx + ox, ny = ly + oy;
      if (nx < 0 || ny < 0 || nx >= chunk.n || ny >= chunk.n) continue;
      for (const p of chunk.plantsInCell(nx, ny)) {
        const sp = SPECIES[p.species];
        const dist = Math.hypot(ox, oy);
        if (dist > sp.canopy) continue;
        const size = plantSize(p, chunk, cfg, worldDay);
        if (size < 0.08) continue;
        cover += size * (1 - dist / (sp.canopy + 0.5)) * 0.5;
      }
    }
  }
  return clamp(cover, 0, 1);
}

const INFILTRATION = [0.85, 0.45, 0.6, 0.55, 0.35]; // arenoso, argiloso, rochoso, florestal, aluvial
const RETENTION = [0.45, 0.9, 0.35, 1.15, 0.8];

/** passo rápido: chuva, interceptação, infiltração, escoamento, evaporação, transpiração */
export function stepWater(
  chunk: Chunk,
  cfg: WorldConfig,
  climate: Climate,
  hours: number,
  worldDay: number,
  nb: Neighborhood,
): void {
  const n = chunk.n;
  const rain = climate.rainIntensity(climate.cfg.startDayOfYear + worldDay) * hours * 1.1; // mm等效
  const gx0 = chunk.cx * n, gy0 = chunk.cy * n;
  const outflow = new Float32Array(n * n);
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const canopy = canopyCoverAt(chunk, cfg, lx, ly, worldDay);
      const intercepted = rain * canopy * 0.35;
      const through = rain - intercepted;
      const soil = chunk.soilType[i];
      const infil = through * INFILTRATION[soil] * clamp(chunk.soilDepth[i], 0.2, 1.4);
      const runoff = Math.max(0, through - infil);
      const storage = RETENTION[soil] * chunk.soilDepth[i];
      let m = chunk.moisture[i] + (infil * 0.06) / storage;
      // evaporação + transpiração (mais forte com luz/calor e sem cobertura)
      const temp = climate.temperature(worldDay, (worldDay % 1) * 24, chunk.elev[i] / cfg.elevationRange);
      const evap = hours * (0.004 + 0.004 * clamp(temp / 30, 0, 1)) * (1 - canopy * 0.6) * (1 - chunk.waterDepth[i]);
      const transp = hours * 0.006 * canopy * clamp(temp / 25, 0.2, 1.2);
      m -= evap + transp;
      // percolação profunda (drenagem) — saída lenta, não some: vira fluxo subterrâneo
      m -= hours * 0.004 * m * (soil === SOIL_SAND ? 1.6 : soil === SOIL_ROCK ? 1.2 : 0.7);
      chunk.moisture[i] = clamp(m, 0.02, 1);
      if (runoff > 1e-5) outflow[i] = runoff;
    }
  }
  // roteia o escoamento superficial pela direção de fluxo (D8) — uma passada
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const r = outflow[i];
      if (r <= 0) continue;
      const d = chunk.flowDir[i];
      if (d < 0) {
        chunk.waterDepth[i] = Math.min(3.4, chunk.waterDepth[i] + r * 0.004);
        continue;
      }
      const nx = lx + DX8[d], ny = ly + DY8[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) {
        // fronteira: entrega ao chunk vizinho se disponível (continuidade)
        const other = nb.cellAt(gx0 + nx, gy0 + ny);
        if (other) {
          const ox = gx0 + nx - other.cx * n, oy = gy0 + ny - other.cy * n;
          other.waterDepth[other.cellIdx(ox, oy)] = Math.min(3.4, other.waterDepth[other.cellIdx(ox, oy)] + r * 0.004);
          other.dirty = true;
        }
        continue;
      }
      const j = chunk.cellIdx(nx, ny);
      const soil = chunk.soilType[j];
      const reinfil = r * 0.35 * INFILTRATION[soil];
      chunk.moisture[j] = clamp(chunk.moisture[j] + (reinfil * 0.06) / RETENTION[soil], 0.02, 1);
      chunk.waterDepth[j] = Math.min(3.4, chunk.waterDepth[j] + (r - reinfil) * 0.004);
    }
  }
  // lagos/canais relaxam para o nível de equilíbrio sazonal (sem oscilar por frame)
  const seasonWet = climate.seasonWetness(worldDay);
  for (let i = 0; i < n * n; i++) {
    const kind = chunk.waterKind[i];
    if (kind & 1) {
      const target = Math.max(0.1, chunk.waterDepth[i] * (0.85 + 0.3 * seasonWet));
      chunk.waterDepth[i] += (target - chunk.waterDepth[i]) * clamp(hours * 0.02, 0, 0.5);
    } else if (chunk.waterDepth[i] > 0 && !(kind & 2)) {
      // água empojada temporária seca
      chunk.waterDepth[i] = Math.max(0, chunk.waterDepth[i] - hours * 0.02);
    }
  }
  chunk.dirty = true;
  chunk.soilDirty = true;
}

/** passo médio: liteira, decomposição, nutrientes, crescimento, reprodução, morte */
export function stepBio(
  chunk: Chunk,
  cfg: WorldConfig,
  climate: Climate,
  hours: number,
  worldDay: number,
): { recruits: PlantRecord[]; deaths: number[] } {
  const n = chunk.n;
  const recruits: PlantRecord[] = [];
  const deaths: number[] = [];
  const gx0 = chunk.cx * n, gy0 = chunk.cy * n;
  const season = climate.seasonIndex(worldDay);
  const temp = climate.temperature(worldDay, 12, 0.3);

  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const canopy = canopyCoverAt(chunk, cfg, lx, ly, worldDay);
      const moist = chunk.moisture[i];

      // --- estresse hídrico: seca = umidade abaixo da demanda ---
      const demand = 0.28 + canopy * 0.2 + clamp(temp / 40, 0, 0.3);
      const deficit = clamp(demand - moist, 0, 1);
      const flood = smoothstep(0.55, 0.9, moist) * (1 - canopy);
      chunk.stress[i] = clamp(chunk.stress[i] + hours * (deficit * 0.05 + flood * 0.03) - hours * 0.02 * clamp(moist - demand, 0, 1), 0, 2);

      // --- liteira: queda de folhas contínua + pulso sazonal das decíduas ---
      let litterIn = 0;
      let biomass = 0;
      for (const p of chunk.plantsInCell(lx, ly)) {
        const sp = SPECIES[p.species];
        const size = plantSize(p, chunk, cfg, worldDay);
        biomass += size;
        const seasonalPulse = sp.deciduous && season === 2 ? 3.2 : sp.deciduous && season === 3 ? 0.6 : 1;
        litterIn += hours * 0.004 * sp.litterRate * size * seasonalPulse;
      }
      chunk.litter[i] = clamp(chunk.litter[i] + litterIn, 0, 12);

      // --- decomposição: liteira → húmus + nutrientes liberados ---
      const microbeEnv = clamp(smoothstep(0.08, 0.35, moist) * (1 - smoothstep(0.9, 1, moist)) * clamp((temp - 2) / 26, 0.05, 1.2), 0, 1.2);
      chunk.microbe[i] = clamp(chunk.microbe[i] + hours * 0.01 * (microbeEnv - chunk.microbe[i]), 0.02, 1);
      const decom = chunk.litter[i] * chunk.microbe[i] * hours * 0.006;
      chunk.litter[i] -= decom;
      const humified = decom * 0.42; // fração que vira húmus estável
      chunk.humus[i] = clamp(chunk.humus[i] + humified, 0, 20);
      // mineralização devolve N/P/K na proporção da liteira (não cria matéria)
      const mineral = decom * 0.58;
      chunk.nAvail[i] += mineral * 0.10;
      chunk.pAvail[i] += mineral * 0.012;
      chunk.kAvail[i] += mineral * 0.05;

      // --- imobilização microbiana: microbes seguram N quando há muita liteira fresca ---
      const immob = hours * 0.002 * chunk.microbe[i] * clamp(chunk.litter[i] - chunk.humus[i] * 0.3, 0, 4);
      const immobN = Math.min(chunk.nAvail[i], immob * 0.08);
      chunk.nAvail[i] -= immobN;

      // --- intemperismo: única entrada nova de P (lenta, depende de rocha) ---
      const weather = hours * 0.00035 * (chunk.soilType[i] === SOIL_ROCK ? 2.2 : 1) * clamp(temp / 20, 0.2, 1.3);
      chunk.pAvail[i] += weather;

      // --- absorção pela vegetação (competição implícita por biomassa) ---
      const uptake = biomass * hours * 0.004;
      const nUp = Math.min(chunk.nAvail[i], uptake * 0.09);
      const pUp = Math.min(chunk.pAvail[i], uptake * 0.011);
      const kUp = Math.min(chunk.kAvail[i], uptake * 0.045);
      chunk.nAvail[i] -= nUp;
      chunk.pAvail[i] -= pUp;
      chunk.kAvail[i] -= kUp;
      // o que a planta absorveu volta como liteira ao longo do tempo (ciclo fechado)

      // --- lixiviação: chuva intensa arrasta N (saída do sistema local) ---
      const leach = hours * 0.0015 * clamp(moist - 0.7, 0, 0.3) * chunk.nAvail[i];
      chunk.nAvail[i] -= leach;

      // --- pH deriva lentamente com húmus e chuva ---
      chunk.pH[i] = clamp(chunk.pH[i] - hours * 0.0004 * chunk.humus[i] * 0.1 + hours * 0.0002, 4.2, 8);

      // --- recrutamento: pressão de sementes das plantas maduras vizinhas ---
      let pressure = 0;
      const DR = Math.min(6, Math.ceil(SPECIES.reduce((m, s2) => Math.max(m, s2.dispersal), 0)));
      for (let oy = -DR; oy <= DR; oy++) {
        for (let ox = -DR; ox <= DR; ox++) {
          const nx2 = lx + ox, ny2 = ly + oy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= n || ny2 >= n) continue;
          for (const p of chunk.plantsInCell(nx2, ny2)) {
            const sp = SPECIES[p.species];
            const age = plantAge(p, worldDay);
            if (age < sp.maturityAge) continue;
            const d = Math.hypot(ox, oy);
            if (d > sp.dispersal) continue;
            pressure += sp.seedRate * (1 - d / (sp.dispersal + 0.5));
          }
        }
      }
      const light = 1 - canopy;
      if (pressure > 0.05 && chunk.waterDepth[i] < 0.25) {
        let best = -1, bestScore = 0;
        for (let sp = 0; sp < SPECIES.length; sp++) {
          const s = speciesFitLocal(sp, moist, chunk.soilType[i], light, temp);
          if (s > bestScore) {
            bestScore = s;
            best = sp;
          }
        }
        const open = smoothstep(0.15, 0.5, light) + (best >= 0 ? SPECIES[best].shadeTolerance * (1 - light) : 0);
        // zoocoria: a fauna presente aumenta a chegada de sementes
        const zoo = 1 + animalDispersalBonus(chunk, cfg, lx, ly, worldDay, (worldDay % 1) * 24);
        const chance = pressure * bestScore * open * zoo * hours * 0.002;
        if (best >= 0 && hash2(cfg.seed ^ 0x77, gx0 + lx + Math.floor(worldDay) * 31, gy0 + ly, 101) < chance) {
          const jx = hash2(cfg.seed, gx0 + lx, gy0 + ly, 102);
          const jy = hash2(cfg.seed, gx0 + lx, gy0 + ly, 103);
          recruits.push({
            id: Math.floor(hash2(cfg.seed, gx0 + lx, gy0 + ly, 104 + (Math.floor(worldDay) % 97)) * 0x7fffffff),
            species: best,
            x: (gx0 + lx + jx * 0.9) * cfg.simCellTiles * cfg.tileSize,
            y: (gy0 + ly + jy * 0.9) * cfg.simCellTiles * cfg.tileSize,
            birthAge: -worldDay, // nasce agora: idade = birthAge + worldDay = 0
            variant: Math.floor(jx * 997),
            origin: 'recruit',
          });
        }
      }

      // --- mortalidade por estresse prolongado ---
      if (chunk.stress[i] > 1.25) {
        for (const p of chunk.plantsInCell(lx, ly)) {
          if (!chunk.removedPlants.has(p.id) && hash2(cfg.seed, p.id % 100000, Math.floor(worldDay), 105) < hours * 0.004 * chunk.stress[i]) {
            deaths.push(p.id);
            chunk.litter[i] = clamp(chunk.litter[i] + 1.6, 0, 12); // morte vira matéria orgânica
          }
        }
      }

      // --- solo florestal se desenvolve sob copa estabelecida ---
      if (canopy > 0.45 && chunk.soilType[i] !== SOIL_ROCK && chunk.soilType[i] !== SOIL_ALLUVIAL && chunk.humus[i] > 3.2) {
        chunk.soilType[i] = SOIL_FOREST;
      }
    }
  }
  chunk.dirty = true;
  chunk.soilDirty = true;
  return { recruits, deaths };
}

function speciesFitLocal(sp: number, moisture: number, soil: number, light: number, temp: number): number {
  const s = SPECIES[sp];
  const water = 1 - clamp(Math.abs(moisture - s.waterNeed) / 0.5, 0, 1);
  const soilF = s.soilAffinity[soil === 3 || soil === 4 ? 1 : soil] ?? 0.5;
  const lightF = 1 - clamp(Math.abs(light - s.lightNeed) / 0.85, 0, 1);
  const tempF = clamp(1 - Math.abs(temp - s.tempOpt) / 15, 0, 1) * (temp > s.tempMin ? 1 : 0);
  return water * 0.35 + soilF * 0.2 + lightF * 0.25 + tempF * 0.2;
}

export interface ErosionSink {
  addDelta(cellX: number, cellY: number, dNorm: number): void;
  getDelta(cellX: number, cellY: number): number;
}

/** passo lento: erosão, transporte e deposição de sedimentos (escreve deltas persistentes) */
export function stepErosion(
  chunk: Chunk,
  cfg: WorldConfig,
  hours: number,
  worldDay: number,
  sink: ErosionSink,
): void {
  const n = chunk.n;
  const gx0 = chunk.cx * n, gy0 = chunk.cy * n;
  const moves: Array<[number, number, number]> = [];
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const d = chunk.flowDir[i];
      if (d < 0) continue;
      const acc = chunk.acc[i];
      const slope = chunk.slope[i];
      const cover = canopyCoverAt(chunk, cfg, lx, ly, worldDay);
      const resist = (0.35 + 0.65 * cover) * (chunk.soilType[i] === SOIL_ROCK ? 2.4 : chunk.soilType[i] === SOIL_SAND ? 0.7 : 1);
      const flow = clamp(acc / cfg.riverThreshold, 0, 4) * clamp(chunk.waterDepth[i] + 0.15, 0, 1.5);
      const capacity = hours * 0.00002 * flow * slope * (1 / resist);
      if (capacity <= 1e-7) continue;
      const nx = lx + DX8[d], ny = ly + DY8[d];
      const nslope = nx >= 0 && ny >= 0 && nx < n && ny < n ? chunk.slope[chunk.cellIdx(nx, ny)] : slope * 0.5;
      const deposit = nslope < slope * 0.55 ? 0.7 : nslope < slope ? 0.35 : 0.1; // deposição onde a energia cai
      moves.push([lx, ly, Math.min(capacity, 0.0006)]);
      void deposit;
    }
  }
  for (const [lx, ly, amount] of moves) {
    const i = chunk.cellIdx(lx, ly);
    const d = chunk.flowDir[i];
    const gx = gx0 + lx, gy = gy0 + ly;
    sink.addDelta(gx, gy, -amount);
    const nx = lx + DX8[d], ny = ly + DY8[d];
    const tgx = gx0 + nx, tgy = gy0 + ny;
    // parte deposita a jusante, parte segue suspensa (aproximação: 60% deposita)
    sink.addDelta(tgx, tgy, amount * 0.6);
    sink.addDelta(tgx + DX8[d], tgy + DY8[d], amount * 0.2);
  }
  chunk.dirty = true;
}
