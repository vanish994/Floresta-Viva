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
export const SAVE_VERSION = 1;

interface ChunkDiff {
  removed: number[];
  recruits: PlantRecord[];
  /** solo quantizado (somente se modificado): um byte por campo por célula */
  soil?: number[];
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
      if (!chunk.dirty) continue;
      if (count > 220) break;
      const diff: ChunkDiff = {
        removed: [...chunk.removedPlants],
        recruits: chunk.recruitedPlants,
      };
      if (chunk.soilDirty) diff.soil = quantizeSoil(chunk);
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
  chunk.dirty = false;
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
