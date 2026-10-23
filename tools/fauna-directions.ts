/**
 * Contato visual das direções: para cada espécie e animação mostra as quatro
 * direções lado a lado (L, O, O espelhado a partir de L, N, S). Serve para
 * conferir — a olho — que a direção Oeste é arte própria e não um espelho
 * acidental, e que nenhuma coluna está deslocada.
 *
 * Uso: npx tsx tools/fauna-directions.ts
 * Saída: docs/imagens/fauna_direcoes.png
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';
import { FAUNA_SHEETS, faunaRect } from '../src/render/manifest';
import type { Facing4 } from '../src/world/fauna';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 5;
const KINDS = ['rabbit', 'frog', 'snake', 'bird'] as const;
const ANIMS: Record<string, string[]> = {
  rabbit: ['idle', 'walk', 'run', 'eat', 'sleep', 'hurt', 'death'],
  frog: ['idle', 'walk', 'run', 'eat', 'sleep', 'hurt', 'death'],
  snake: ['idle', 'walk', 'run', 'attack', 'hide', 'hurt', 'death'],
  bird: ['idle', 'fly', 'eat'],
};

const images = new Map<string, RGBAImage>();
function sheet(kind: string): RGBAImage {
  if (!images.has(kind)) images.set(kind, decodePNG(readFileSync(join(ROOT, 'assets/Animals', `${kind}.png`))));
  return images.get(kind)!;
}

function blit(dst: RGBAImage, src: RGBAImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, flip: boolean) {
  for (let y = 0; y < sh * SCALE; y++) {
    for (let x = 0; x < sw * SCALE; x++) {
      const px = Math.floor(x / SCALE);
      const py = Math.floor(y / SCALE);
      const sx2 = flip ? sx + sw - 1 - px : sx + px;
      const si = ((sy + py) * src.width + sx2) * 4;
      if (src.data[si + 3] === 0) continue;
      const tx = dx + x, ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const di = (ty * dst.width + tx) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
}

function main(): void {
  const cellW = Math.max(...KINDS.map((k) => FAUNA_SHEETS[k].cellW));
  const cellH = Math.max(...KINDS.map((k) => FAUNA_SHEETS[k].cellH));
  const cw = cellW * SCALE;
  const chh = cellH * SCALE;
  const cols = 5; // L | O | O espelhado de L | N | S
  const totalRows = KINDS.reduce((s, k) => s + ANIMS[k].length, 0) + KINDS.length;
  const W = cols * (cw + 10) + 20;
  const H = totalRows * (chh + 10) + 20;
  const out: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 24; out.data[i + 1] = 30; out.data[i + 2] = 27; out.data[i + 3] = 255;
  }
  let y = 10;
  for (const kind of KINDS) {
    y += chh + 10; // faixa separadora entre espécies
    const src = sheet(kind);
    for (const anim of ANIMS[kind]) {
      const dirs: Facing4[] = ['e', 'w'];
      dirs.forEach((dir, i) => {
        const r = faunaRect(FAUNA_SHEETS[kind], anim, 0, dir);
        blit(out, src, r[0], r[1], r[2], r[3], 10 + i * (cw + 10), y, false);
      });
      // O espelhado a partir de L, para comparação
      const rE = faunaRect(FAUNA_SHEETS[kind], anim, 0, 'e');
      blit(out, src, rE[0], rE[1], rE[2], rE[3], 10 + 2 * (cw + 10), y, true);
      for (const [i, dir] of (['n', 's'] as Facing4[]).entries()) {
        const r = faunaRect(FAUNA_SHEETS[kind], anim, 0, dir);
        blit(out, src, r[0], r[1], r[2], r[3], 10 + (3 + i) * (cw + 10), y, false);
      }
      y += chh + 10;
    }
  }
  writeFileSync(join(ROOT, 'docs/imagens/fauna_direcoes.png'), encodePNG(out));
  console.log(`gravado docs/imagens/fauna_direcoes.png (${W}×${H}) — colunas: L | O | O=espelho de L | N | S`);
}

main();
