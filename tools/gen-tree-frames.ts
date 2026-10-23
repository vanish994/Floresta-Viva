/**
 * Mede TODOS os spritesheets de árvore e grava os recortes reais usados pelo
 * render (união das 5 variantes: normal/autumn/winter/snow/vines).
 *
 * Problema que isso resolve: os recortes viviam escritos à mão no manifesto e
 * estavam menores que o sprite — nas árvores de porte médio (`big`) o recorte
 * parava em ~55–63 px de altura e o render desenhava só a copa, sem tronco.
 *
 * Cada sprite é uma componente conexa de alpha (não uma grade fixa): assim o
 * recorte inclui copa + tronco e nunca invade o sprite vizinho.
 *
 * Uso: npx tsx tools/gen-tree-frames.ts
 * Escreve: tools/data/tree-frames.json e o bloco TREE_RECTS em src/render/manifest.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type Rect = [x: number, y: number, w: number, h: number];

const SHEETS: Record<'small' | 'big' | 'bigger', Record<string, string>> = {
  small: {
    normal: 'Trees/Small_Trees/NormalTrees.png',
    autumn: 'Trees/Small_Trees/AutumnTrees.png',
    winter: 'Trees/Small_Trees/WinterTrees.png',
    snow: 'Trees/Small_Trees/WinterTreeswSnow.png',
    vines: 'Trees/Small_Trees/TreeswVines.png',
  },
  big: {
    normal: 'Trees/Big_Trees/Big_NormalTrees.png',
    autumn: 'Trees/Big_Trees/Big_AutumnTrees.png',
    winter: 'Trees/Big_Trees/Big_WinterTrees.png',
    snow: 'Trees/Big_Trees/Big_WinterTreeswSnow.png',
    vines: 'Trees/Big_Trees/Big_TreeswVines.png',
  },
  bigger: {
    normal: 'Trees/Bigger_Trees/Bigger_NormalTrees.png',
    autumn: 'Trees/Bigger_Trees/Bigger_AutumnTrees.png',
    winter: 'Trees/Bigger_Trees/Bigger_WinterTrees.png',
    snow: 'Trees/Bigger_Trees/Bigger_WinterTreeswSnow.png',
    vines: 'Trees/Bigger_Trees/Bigger_TreeswVines.png',
  },
};

interface Box {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** componentes conexas de alpha (um sprite = uma componente) */
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

function unionAll(boxes: Box[][]): Rect[] {
  const count = Math.max(...boxes.map((b) => b.length));
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const list = boxes.map((b) => b[i]).filter(Boolean);
    const x0 = Math.min(...list.map((b) => b.x0));
    const y0 = Math.min(...list.map((b) => b.y0));
    const x1 = Math.max(...list.map((b) => b.x0 + b.w));
    const y1 = Math.max(...list.map((b) => b.y0 + b.h));
    rects.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return rects;
}

function main(): void {
  const data: Record<string, Rect[]> = {
    small: [],
    big: [],
    bigger: [],
  };
  for (const size of ['small', 'big', 'bigger'] as const) {
    const perLook = Object.values(SHEETS[size]).map((f) => sprites(f));
    data[size] = unionAll(perLook);
    console.log(
      `${size}: ${data[size].length} sprites, alturas ${data[size].map((r) => r[3]).join('/')} (antes: ` +
        `${size === 'small' ? '45–51' : size === 'big' ? '55–63 ← cortava o tronco' : '126–128'})`,
    );
  }

  // 1) fonte de dados (usada pelo gerador de manifesto)
  writeFileSync(join(ROOT, 'tools/data/tree-frames.json'), `${JSON.stringify(data, null, 2)}\n`);

  // 2) manifesto (cópia direta, como o gen-manifest faria)
  const manifestPath = join(ROOT, 'src/render/manifest.ts');
  let manifest = readFileSync(manifestPath, 'utf8');
  const block = `export const TREE_RECTS = {
  small: [${data.small.map((r) => `[${r.join(', ')}]`).join(', ')}],
  // recortes medidos por componente de alpha (copa + tronco), união das 5
  // variantes sazonais: as árvores médias têm 87–96 px de altura
  big: [${data.big.map((r) => `[${r.join(', ')}]`).join(', ')}],
  bigger: [${data.bigger.map((r) => `[${r.join(', ')}]`).join(', ')}],
} as Record<'small' | 'big' | 'bigger', Rect[]>;`;
  const start = manifest.indexOf('export const TREE_RECTS = {');
  const end = manifest.indexOf("} as Record<'small' | 'big' | 'bigger', Rect[]>;", start);
  if (start < 0 || end < 0) throw new Error('bloco TREE_RECTS não encontrado no manifesto');
  manifest = manifest.slice(0, start) + block + manifest.slice(end + "} as Record<'small' | 'big' | 'bigger', Rect[]>;".length);
  writeFileSync(manifestPath, manifest);
  console.log('gravado tools/data/tree-frames.json e src/render/manifest.ts');
}

main();
