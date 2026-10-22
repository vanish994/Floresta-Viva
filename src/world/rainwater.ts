/**
 * Água superficial dinâmica: chuva, correnteza, transbordamento e impacto
 * físico sobre a vegetação. A hidrologia-base continua sendo gerada por D8.
 */
import type { WorldConfig } from '../core/config';
import type { Climate } from './climate';
import type { Chunk } from './chunk';
import { SPECIES } from './flora';
import { DX8, DY8 } from './hydro';

const STORM_START = 0.55;
const FLOOD_LEVEL = 0.16;
const LAKE_OVERFLOW_LEVEL = 0.42;
const MAX_TEMPORARY_DEPTH = 1.6;

export function stepRainwater(chunk: Chunk, cfg: WorldConfig, climate: Climate, hours: number, worldDay: number): void {
  const rain = climate.rainIntensity(worldDay);
  const n = chunk.n;
  const count = n * n;
  const intensity = rain * hours;
  const storm = rain <= STORM_START ? 0 : (rain - STORM_START) / (1 - STORM_START);
  const added = new Float32Array(count);

  // Chuva moderada também alimenta os canais; tempestades acrescentam mais água.
  if (rain > 0.05) {
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const flow = chunk.flowDir[i];
        const kind = chunk.waterKind[i];
        if (flow < 0) added[i] += intensity * (0.018 + storm * 0.055);
        else added[i] += intensity * (0.006 + storm * 0.02);
        if (chunk.waterDepth[i] > FLOOD_LEVEL) added[i] += intensity * (0.01 + storm * 0.025);
        if (kind & 1) added[i] += intensity * storm * 0.025;
        if (kind & 2) added[i] += intensity * storm * 0.035;
      }
    }
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const flow = chunk.flowDir[i];
        if (flow < 0) continue;
        const nx = lx + DX8[flow], ny = ly + DY8[flow];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        added[chunk.cellIdx(nx, ny)] += intensity * (0.01 + storm * 0.03);
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (added[i] > 0) chunk.waterDepth[i] = Math.min(MAX_TEMPORARY_DEPTH, chunk.waterDepth[i] + added[i]);
  }

  // Correnteza com efeito real: transporta parte da lâmina para jusante usando
  // a direção D8, com velocidade maior em canais profundos e de grande vazão.
  // O snapshot evita que a ordem de varredura mova a mesma água várias vezes.
  const before = chunk.waterDepth.slice();
  const delta = new Float32Array(count);
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const flow = chunk.flowDir[i];
      if (flow < 0 || before[i] < 0.08) continue;
      const nx = lx + DX8[flow], ny = ly + DY8[flow];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = chunk.cellIdx(nx, ny);
      const downhill = Math.max(0, chunk.elev[i] - chunk.elev[j]);
      const discharge = Math.min(0.38, 0.07 + Math.min(0.18, chunk.acc[i] / Math.max(1, cfg.riverThreshold) * 0.08)
        + Math.min(0.13, before[i] * 0.08 + downhill * 0.025));
      const transported = Math.min(before[i] * discharge, Math.max(0, MAX_TEMPORARY_DEPTH - before[j]));
      delta[i] -= transported;
      delta[j] += transported;
    }
  }
  for (let i = 0; i < count; i++) {
    chunk.waterDepth[i] = Math.max(0, Math.min(MAX_TEMPORARY_DEPTH, chunk.waterDepth[i] + delta[i]));
  }

  // Transbordamento: excesso de água escapa para vizinhos mais baixos.
  if (storm > 0.05) {
    const overflow = new Float32Array(count);
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const kind = chunk.waterKind[i];
        const threshold = (kind & 1) ? LAKE_OVERFLOW_LEVEL : FLOOD_LEVEL;
        const excess = chunk.waterDepth[i] - threshold;
        if (excess <= 0) continue;
        let best = -1, bestDrop = 0;
        for (let d = 0; d < 8; d++) {
          const nx = lx + DX8[d], ny = ly + DY8[d];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = chunk.cellIdx(nx, ny);
          const drop = chunk.elev[i] - chunk.elev[j];
          if (drop > bestDrop) { bestDrop = drop; best = j; }
        }
        if (best < 0 && chunk.flowDir[i] >= 0) {
          const d = chunk.flowDir[i], nx = lx + DX8[d], ny = ly + DY8[d];
          if (nx >= 0 && ny >= 0 && nx < n && ny < n) best = chunk.cellIdx(nx, ny);
        }
        if (best >= 0) {
          const moved = Math.min(excess * (0.12 + storm * 0.2), 0.2);
          overflow[i] -= moved;
          overflow[best] += moved;
        }
      }
    }
    for (let i = 0; i < count; i++) {
      if (overflow[i] !== 0) chunk.waterDepth[i] = Math.max(0, Math.min(MAX_TEMPORARY_DEPTH, chunk.waterDepth[i] + overflow[i]));
    }
  }

  // Enchente forte e corrente rápida podem derrubar árvores vulneráveis.
  // A remoção entra no conjunto persistente de diffs e atualiza o índice espacial.
  let uprooted = false;
  for (const plant of chunk.livePlants()) {
    const lx = Math.min(n - 1, Math.max(0, Math.floor(plant.x / (cfg.simCellTiles * cfg.tileSize)) - chunk.cx * n));
    const ly = Math.min(n - 1, Math.max(0, Math.floor(plant.y / (cfg.simCellTiles * cfg.tileSize)) - chunk.cy * n));
    const i = chunk.cellIdx(lx, ly);
    const depth = chunk.waterDepth[i];
    if (depth < 0.72) continue;
    const sp = SPECIES[plant.species];
    const flow = chunk.flowDir[i];
    const currentStrength = (flow >= 0 ? 0.45 + Math.min(1, chunk.acc[i] / Math.max(1, cfg.riverThreshold)) : 0.15)
      * Math.min(1.5, depth);
    const vulnerability = 1 - sp.floodTolerance;
    if (currentStrength < 0.62 || vulnerability <= 0.05) continue;
    // Probabilidade baixa por passo; sobe com profundidade/velocidade e cai
    // para espécies adaptadas a margens alagáveis e árvores de raízes profundas.
    const rootProtection = Math.min(0.55, sp.rootDepth * 0.28);
    const chance = Math.min(0.28, hours * 0.006 * vulnerability * currentStrength * (1 - rootProtection));
    const roll = hashPlant(plant.id, Math.floor(worldDay * 24), chunk.cx, chunk.cy);
    if (roll < chance) {
      chunk.removedPlants.add(plant.id);
      chunk.litter[i] = Math.min(12, chunk.litter[i] + 1.6);
      uprooted = true;
    }
  }
  if (uprooted) chunk.rebuildPlantIndex();
  chunk.dirty = true;
}

function hashPlant(id: number, step: number, cx: number, cy: number): number {
  let x = (id ^ Math.imul(step + 1, 0x45d9f3b) ^ Math.imul(cx + 31, 0x27d4eb2d) ^ Math.imul(cy + 17, 0x165667b1)) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0x100000000;
}
