/**
 * Regressão do recorte das árvores: cada retângulo de `TREE_RECTS` precisa
 * conter o sprite INTEIRO (copa + tronco) de todas as variantes sazonais.
 *
 * O bug corrigido: os recortes de porte médio (`big`) tinham 55–63 px de altura,
 * enquanto o sprite tem 87–96 px — o render desenhava só a copa, sem tronco.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TREE_FILES, TREE_RECTS, type Rect } from '../src/render/manifest';
import { decodePNG } from '../tools/png';

const ROOT = join(__dirname, '..');

interface Box {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** componentes conexas de alpha: um sprite de árvore = uma componente */
function sprites(file: string): Box[] {
  const img = decodePNG(readFileSync(join(ROOT, 'assets', file)));
  const W = img.width;
  const H = img.height;
  const fg = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (img.data[p * 4 + 3] > 16) fg[p] = 1;
  const seen = new Uint8Array(W * H);
  const out: Box[] = [];
  for (let p = 0; p < W * H; p++) {
    if (!fg[p] || seen[p]) continue;
    const stack = [p];
    seen[p] = 1;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % W;
      const y = (q / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      n++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (fg[r] && !seen[r]) {
            seen[r] = 1;
            stack.push(r);
          }
        }
      }
    }
    if (n > 200) out.push({ x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

const covers = (rect: Rect, box: Box): boolean =>
  box.x0 >= rect[0] &&
  box.y0 >= rect[1] &&
  box.x0 + box.w <= rect[0] + rect[2] &&
  box.y0 + box.h <= rect[1] + rect[3];

describe('recorte das árvores (copa + tronco)', () => {
  it('todo sprite de árvore cabe inteiro no seu retângulo (todas as variantes)', () => {
    const failures: string[] = [];
    for (const size of ['small', 'big', 'bigger'] as const) {
      const rects = TREE_RECTS[size];
      for (const [look, file] of Object.entries(TREE_FILES[size])) {
        sprites(file as string).forEach((box, i) => {
          const rect = rects[i % rects.length];
          if (!covers(rect, box)) {
            failures.push(`${size}/${look}#${i}: sprite ${box.w}x${box.h} não cabe em [${rect.join(', ')}]`);
          }
        });
      }
    }
    expect(failures).toEqual([]);
  });

  it('as árvores médias têm recorte alto o bastante para o tronco (>= 80 px)', () => {
    // antes da correção: 55–63 px → só a copa era desenhada
    for (const rect of TREE_RECTS.big) {
      expect(rect[3]).toBeGreaterThanOrEqual(80);
      expect(rect[3]).toBeLessThanOrEqual(120); // e sem invadir o vizinho
    }
  });

  it('recortes não se sobrepõem na folha (nada de pegar o sprite vizinho)', () => {
    for (const size of ['small', 'big', 'bigger'] as const) {
      const rects = [...TREE_RECTS[size]].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < rects.length; i++) {
        const prev = rects[i - 1];
        const cur = rects[i];
        expect(cur[0]).toBeGreaterThanOrEqual(prev[0] + prev[2] - 1);
      }
    }
  });
});
