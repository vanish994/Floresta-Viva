/**
 * Conversões entre espaços de coordenadas. Toda a geração usa coordenadas
 * GLOBAIS — chunks são apenas janelas de armazenamento/renderização.
 *
 * Espaços:
 *  - world px: pixels contínuos do mundo (posição do personagem)
 *  - tile: células gráficas de tileSize px
 *  - cell: células de simulação ambiental (simCellTiles tiles)
 *  - chunk: blocos de chunkTiles tiles
 */
import type { WorldConfig } from './config';

export interface ChunkKey {
  cx: number;
  cy: number;
}

export const chunkKeyStr = (cx: number, cy: number): string => `${cx},${cy}`;
export const parseChunkKey = (k: string): ChunkKey => {
  const [cx, cy] = k.split(',').map(Number);
  return { cx, cy };
};

export const tileToChunk = (tx: number, cfg: WorldConfig): number => Math.floor(tx / cfg.chunkTiles);
export const chunkToTile = (cx: number, cfg: WorldConfig): number => cx * cfg.chunkTiles;
export const cellToTile = (cell: number, cfg: WorldConfig): number => cell * cfg.simCellTiles;
export const tileToCell = (tile: number, cfg: WorldConfig): number => Math.floor(tile / cfg.simCellTiles);
export const pxToTile = (px: number, cfg: WorldConfig): number => Math.floor(px / cfg.tileSize);
export const tileToPx = (t: number, cfg: WorldConfig): number => t * cfg.tileSize;

export const cellsPerChunk = (cfg: WorldConfig): number => cfg.chunkTiles / cfg.simCellTiles;

export function chunkOfTile(tx: number, ty: number, cfg: WorldConfig): ChunkKey {
  return { cx: tileToChunk(tx, cfg), cy: tileToChunk(ty, cfg) };
}

export function chunkOfPx(x: number, y: number, cfg: WorldConfig): ChunkKey {
  return chunkOfTile(pxToTile(x, cfg), pxToTile(y, cfg), cfg);
}

/** índice local da célula dentro do chunk */
export function localCell(cx: number, cy: number, cfg: WorldConfig, cellX: number, cellY: number) {
  const n = cellsPerChunk(cfg);
  return { lx: cellX - cx * n, ly: cellY - cy * n, n };
}

export const cellIndex = (lx: number, ly: number, n: number): number => ly * n + lx;

/** itera chunks num raio (ordem espiral por distância) */
export function chunksInRadius(cx: number, cy: number, radius: number): ChunkKey[] {
  const out: ChunkKey[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) out.push({ cx: cx + dx, cy: cy + dy });
  out.sort((a, b) => {
    const da = (a.cx - cx) ** 2 + (a.cy - cy) ** 2;
    const db = (b.cx - cx) ** 2 + (b.cy - cy) ** 2;
    return da - db;
  });
  return out;
}
