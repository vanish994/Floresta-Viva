/**
 * Persistência em localStorage com versionamento e diffs.
 *
 * A seed + versão do gerador reconstroem tudo que é determinístico; só o que
 * MUDOU é salvo: deltas de terreno, plantas removidas/recrutadas, estado de
 * solo de chunks modificados, relógio e posição do jogador.
 */
import type { World } from './world';
import { Chunk } from './chunk';
import { chunkKeyStr } from '../core/coords';
import type { PlantRecord } from './flora';

const KEY = 'floresta-viva:save:v1';
export const SAVE_VERSION = 2;

interface ChunkDiff {
  removed: number[];
  recruits: PlantRecord[];
  /** solo quantizado (somente se modificado): um byte por campo por célula */
  soil?: number[];
  /** lâmina d'água quantizada (0..255 → 0..12 m) */
  water?: number[];
  /** componentes de velocidade quantizadas (-4..4 m/s em 0..255) */
  flow?: number[];
  /** fração de areia da superfície (0..255) — margens e bancos */
  sand?: number[];
  /** classificação do solo (0..4) alterada por erosão/deposição */
  types?: number[];
  /** espessura do depósito arenoso em 0..255 → 0..0,5 m (passo ~2 mm) */
  layer?: number[];
}

interface SaveData {
  version: number;
  generatorVersion: number;
  seed: number;
  clockMinutes: number;
  player: { x: number; y: number };
  deltas: [string, number][];
  chunks: Record<string, ChunkDiff>;
  savedAt: number;
}

const SOIL_FIELDS = ['moisture', 'litter', 'humus', 'nAvail', 'pAvail', 'kAvail', 'pH', 'microbe', 'stress'] as const;
const SOIL_SCALE = [1, 12, 20, 2, 1, 2, 10, 1, 2]; // faixas máximas de cada campo para quantização 0..255

export function saveWorld(world: World, storage: Storage = localStorage): boolean {
  try {
    const data: SaveData = {
      version: SAVE_VERSION,
      generatorVersion: world.cfg.generatorVersion,
      seed: world.cfg.seed,
      clockMinutes: world.clock.gameMinutes,
      player: { x: world.playerX, y: world.playerY },
      deltas: [...world.terrainDeltas.entries()],
      chunks: {},
      savedAt: Date.now(),
    };
    let count = 0;
    for (const [key, chunk] of world.chunks) {
      if (!chunk.dirty && !chunk.waterDirty) continue;
      if (count > 220) break;
      const diff: ChunkDiff = {
        removed: [...chunk.removedPlants],
        recruits: chunk.recruitedPlants,
      };
      if (chunk.soilDirty) diff.soil = quantizeSoil(chunk);
      if (chunk.waterDirty) {
        diff.water = quantizeWater(chunk);
        diff.flow = quantizeFlow(chunk);
      }
      if (chunk.soilDirty) {
        diff.sand = quantizeSand(chunk);
        diff.types = Array.from(chunk.soilType);
        diff.layer = quantizeLayer(chunk);
      }
      data.chunks[key] = diff;
      count++;
    }
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export interface LoadResult {
  applied: boolean;
  reason?: string;
}

export function loadWorld(world: World, storage: Storage = localStorage): LoadResult {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { applied: false, reason: 'sem save' };
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return { applied: false, reason: 'versão de save incompatível' };
    if (data.seed !== world.cfg.seed || data.generatorVersion !== world.cfg.generatorVersion) {
      return { applied: false, reason: 'seed/gerador diferentes do mundo atual' };
    }
    world.clock.gameMinutes = data.clockMinutes;
    world.playerX = data.player.x;
    world.playerY = data.player.y;
    world.terrainDeltas.clear();
    for (const [k, v] of data.deltas) world.terrainDeltas.set(k, v);
    world.pendingDiffs = data.chunks;
    return { applied: true };
  } catch {
    return { applied: false, reason: 'save corrompido' };
  }
}

export function clearSave(storage: Storage = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}

/** aplica diffs pendentes a um chunk recém-gerado */
export function applyChunkDiffs(world: World, chunk: Chunk): void {
  const diffs = world.pendingDiffs?.[chunkKeyStr(chunk.cx, chunk.cy)];
  if (!diffs) return;
  for (const id of diffs.removed) chunk.removedPlants.add(id);
  for (const r of diffs.recruits) if (!chunk.recruitedPlants.some((p) => p.id === r.id)) chunk.recruitedPlants.push(r);
  if (diffs.soil) dequantizeSoil(chunk, diffs.soil);
  if (diffs.water) dequantizeWater(chunk, diffs.water);
  if (diffs.flow) dequantizeFlow(chunk, diffs.flow);
  if (diffs.types) {
    for (let i = 0; i < chunk.soilType.length; i++) {
      const t = diffs.types[i];
      if (t !== undefined) chunk.soilType[i] = Math.max(0, Math.min(4, t | 0));
    }
  }
  if (diffs.sand) dequantizeSand(chunk, diffs.sand);
  if (diffs.layer) dequantizeLayer(chunk, diffs.layer);
  chunk.waterDirty = false;
  chunk.dirty = false;
}

const WATER_SAVE_DEPTH = 12; // m
const WATER_SAVE_FLOW = 4; // m/s

/** lâmina d'água em 0..255 (12 m) — suficiente para lagos e enchentes */
function quantizeWater(chunk: Chunk): number[] {
  const out: number[] = [];
  for (let i = 0; i < chunk.waterDepth.length; i++) {
    out.push(Math.max(0, Math.min(255, Math.round((chunk.waterDepth[i] / WATER_SAVE_DEPTH) * 255))));
  }
  return out;
}

function dequantizeWater(chunk: Chunk, data: number[]): void {
  for (let i = 0; i < chunk.waterDepth.length; i++) {
    const v = data[i];
    if (v === undefined) continue;
    chunk.waterDepth[i] = (v / 255) * WATER_SAVE_DEPTH;
  }
}

/** vx/vy em bytes (centro 127 = 0 m/s); permite retomar correntezas no reload */
function quantizeFlow(chunk: Chunk): number[] {
  const out: number[] = [];
  const enc = (v: number) =>
    Math.max(0, Math.min(255, Math.round(((v / WATER_SAVE_FLOW) * 0.5 + 0.5) * 255)));
  for (let i = 0; i < chunk.flowX.length; i++) out.push(enc(chunk.flowX[i]), enc(chunk.flowY[i]));
  return out;
}

function dequantizeFlow(chunk: Chunk, data: number[]): void {
  for (let i = 0; i < chunk.flowX.length; i++) {
    const x = data[i * 2];
    const y = data[i * 2 + 1];
    if (x === undefined || y === undefined) continue;
    chunk.flowX[i] = ((x / 255) * 2 - 1) * WATER_SAVE_FLOW;
    chunk.flowY[i] = ((y / 255) * 2 - 1) * WATER_SAVE_FLOW;
  }
}

/** fração de areia (0..1) em um byte */
function quantizeSand(chunk: Chunk): number[] {
  const out: number[] = [];
  for (let i = 0; i < chunk.sand.length; i++) {
    out.push(Math.max(0, Math.min(255, Math.round(chunk.sand[i] * 255))));
  }
  return out;
}

function dequantizeSand(chunk: Chunk, data: number[]): void {
  for (let i = 0; i < chunk.sand.length; i++) {
    const v = data[i];
    if (v === undefined) continue;
    chunk.sand[i] = v / 255;
  }
}

/**
 * Espessura do depósito arenoso num byte. A faixa útil é 0..0,5 m (passo ~2 mm:
 * um depósito de 1 cm — o limiar de classificação — não pode virar 0 no save).
 * Depósitos maiores que 0,5 m são saturados nesse teto (só ocorrem em casos
 * extremos de assoreamento e já estão bem acima do limiar).
 */
const SAND_LAYER_SAVE_MAX = 0.5;

function quantizeLayer(chunk: Chunk): number[] {
  const out: number[] = [];
  for (let i = 0; i < chunk.sandLayer.length; i++) {
    const v = chunk.sandLayer[i];
    out.push(Math.max(0, Math.min(255, Math.round((v / SAND_LAYER_SAVE_MAX) * 255))));
  }
  return out;
}

function dequantizeLayer(chunk: Chunk, data: number[]): void {
  for (let i = 0; i < chunk.sandLayer.length; i++) {
    const v = data[i];
    if (v === undefined) continue;
    chunk.sandLayer[i] = (v / 255) * SAND_LAYER_SAVE_MAX;
  }
}

function quantizeSoil(chunk: Chunk): number[] {
  const out: number[] = [];
  for (let f = 0; f < SOIL_FIELDS.length; f++) {
    const arr = chunk[SOIL_FIELDS[f]];
    for (let i = 0; i < arr.length; i++) {
      out.push(Math.max(0, Math.min(255, Math.round((arr[i] / SOIL_SCALE[f]) * 255))));
    }
  }
  return out;
}

function dequantizeSoil(chunk: Chunk, data: number[]): void {
  const per = chunk.n * chunk.n;
  for (let f = 0; f < SOIL_FIELDS.length; f++) {
    const arr = chunk[SOIL_FIELDS[f]];
    for (let i = 0; i < per; i++) {
      const v = data[f * per + i];
      if (v === undefined) continue;
      arr[i] = (v / 255) * SOIL_SCALE[f];
    }
  }
}
