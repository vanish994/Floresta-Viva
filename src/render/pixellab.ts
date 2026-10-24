/**
 * Tilesets Wang do pack Floresta completa — PixelLab.
 * Cada folha é 4×4 (16 tiles 32×32); `corners` mapeia NW/NE/SW/SE (1=upper)
 * para o recorte medido nos metadados oficiais do próprio pack.
 */
import lake from '../../assets/Tilesets/pixellab/01_lago_margem.json';
import forest from '../../assets/Tilesets/pixellab/02_margem_chao_floresta.json';
import grass from '../../assets/Tilesets/pixellab/03_chao_grama.json';
import rock from '../../assets/Tilesets/pixellab/04_grama_relevo.json';
import stream from '../../assets/Tilesets/pixellab/05_grama_riacho.json';
import type { Rect } from './manifest';

export type PixelLabSheetId = 'lake' | 'forest' | 'grass' | 'rock' | 'stream';
export interface PixelLabSheet {
  id: PixelLabSheetId;
  file: string;
  corners: Record<string, Rect>;
}

type WangMetadata = { file: string; corners: Record<string, number[]> };
const sheet = (id: PixelLabSheetId, json: WangMetadata): PixelLabSheet => ({
  id,
  file: json.file,
  corners: Object.fromEntries(Object.entries(json.corners).map(([key, r]) => [key, r as Rect])),
});

export const PIXELLAB_WANG: Record<PixelLabSheetId, PixelLabSheet> = {
  lake: sheet('lake', lake),
  forest: sheet('forest', forest),
  grass: sheet('grass', grass),
  rock: sheet('rock', rock),
  stream: sheet('stream', stream),
};

/** chave canônica de cantos NW, NE, SW, SE (1=upper). */
export function wangCornerKey(bits: readonly [boolean, boolean, boolean, boolean]): string {
  return bits.map((b) => b ? '1' : '0').join('');
}

/**
 * Escolhe a transição adjacente que melhor representa quatro níveis
 * (0 água, 1 lama, 2 folhiço, 3 grama, 4 rocha). Se os 4 cantos são iguais,
 * usa o interior do nível correspondente. Em um salto de vários níveis, escolhe
 * o par com menor perda; isso evita procurar um recorte que não existe.
 */
export function wangTransition(levels: readonly [number, number, number, number]): {
  sheet: PixelLabSheetId;
  key: string;
} {
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const ids: PixelLabSheetId[] = ['lake', 'forest', 'grass', 'rock'];
  if (lo === hi) {
    const pair = Math.max(0, Math.min(3, lo));
    return { sheet: ids[pair], key: lo === pair ? '0000' : '1111' };
  }
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k < 4; k++) {
    const cost = levels.reduce((sum, v) => sum + Math.abs(v - Math.max(k, Math.min(k + 1, v))), 0);
    if (cost < bestCost) {
      best = k;
      bestCost = cost;
    }
  }
  return { sheet: ids[best], key: levels.map((v) => v > best ? '1' : '0').join('') };
}

/** a água corrente é um ramal próprio: lower=grama, upper=riacho. */
export function streamCornerKey(bits: readonly [boolean, boolean, boolean, boolean]): string {
  return wangCornerKey(bits);
}
