/**
 * Extrai as spritesheets DIRECIONAIS (N/S/L/O) de cobra, sapo e coelho a partir
 * das pranchas fornecidas em `tools/data/*-dir-reference.png`.
 *
 * As pranchas são material de apresentação (fundo cinza/xadrez, brilho, sombra,
 * títulos, divisórias e legendas). Nada disso vai para o jogo. O extrator:
 *  - MEDE a grade no PNG (não presume coordenadas): faixas de animação pela
 *    projeção da máscara, runs de coluna dentro de cada faixa e os 3 maiores
 *    vãos = quebra entre os blocos das 4 direções;
 *  - usa uma máscara de COR (verde/marrom) — fundo, brilho, chips azuis de
 *    rótulo e divisórias ficam fora;
 *  - auto-recorta o bicho, reduz por média de área até a altura de jogo,
 *    quantiza as cores e aplica alpha binário (pixel art sem antialias);
 *  - corrige a direção OESTE quando a prancha repetiu a arte da LESTE
 *    (decisão por espécie, aplicada nas linhas da folha);
 *  - empacota uma spritesheet por espécie com uma linha por `anim:dir`, alinhada
 *    pela base (o ponto de contato fica no chão).
 *
 * Uso: npx tsx tools/extract-direction-sprites.ts [--only rabbit,frog,snake]
 * Saída: assets/Animals/{rabbit,frog,snake}.png + .json
 *        docs/imagens/sprites_direcionais.png (contato visual para conferência)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Dir = 'n' | 's' | 'e' | 'w';

interface BoardSpec {
  kind: 'snake' | 'frog' | 'rabbit';
  file: string;
  /** nomes das linhas, de cima para baixo (a grade em si é medida no PNG) */
  anims: string[];
  /** largura/altura finais da célula no jogo */
  cellW: number;
  cellH: number;
  /** altura do bicho no jogo (mantém a escala relativa atual) */
  targetH: number;
  /** retângulo da grade de sprites (fora dele é rótulo/painel/rodapé) */
  area: { x0: number; y0: number; x1: number; y1: number };
}

const BOARDS: BoardSpec[] = [
  {
    kind: 'snake',
    file: 'snake-dir-reference.png',
    anims: ['idle', 'walk', 'run', 'jump', 'strike', 'coil', 'hiss', 'sleep', 'hurt', 'death'],
    cellW: 30, cellH: 21, targetH: 19,
    area: { x0: 108, y0: 108, x1: 1526, y1: 1000 },
  },
  {
    kind: 'frog',
    file: 'frog-dir-reference.png',
    anims: ['idle', 'walk', 'run', 'jump', 'eat', 'sleep', 'hurt', 'death'],
    cellW: 24, cellH: 19, targetH: 16,
    area: { x0: 95, y0: 110, x1: 1522, y1: 978 },
  },
  {
    kind: 'rabbit',
    file: 'rabbit-dir-reference.png',
    anims: ['idle', 'walk', 'run', 'jump', 'eat', 'sleep', 'hurt', 'death'],
    cellW: 24, cellH: 21, targetH: 18,
    area: { x0: 120, y0: 108, x1: 1222, y1: 978 },
  },
];

const DIRS: Dir[] = ['n', 's', 'e', 'w'];
const FRAMES = 4;
/** níveis de cor (pixel art) */
const LEVELS = 9;

interface Box { x0: number; y0: number; x1: number; y1: number; n: number }

/**
 * Máscara do bicho: pixel COLORIDO (croma alto) do animal. O contorno escuro
 * entra depois por dilatação — assim fundo cinza/xadrez, brilho e sombra da
 * prancha (todos dessaturados) não viram sprite.
 */
function colorMask(img: RGBAImage): Uint8Array {
  const m = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 120) continue;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 60) continue;
      const chroma = (mx - mn) / mx;
      // azul (chips de rótulo, barras de direção, molduras) não é bicho
      if (b > g + 8 && b > r + 8) continue;
      if (chroma > 0.2) m[y * img.width + x] = 1;
    }
  }
  return m;
}

/** componentes conexas (gap de 3 px une contorno, asa e pata ao corpo) */
function blobs(img: RGBAImage, mask: Uint8Array, minPixels: number): Box[] {
  const W = img.width, H = img.height;
  const seen = new Uint8Array(W * H);
  const out: Box[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (seen[p] || !mask[p]) continue;
      const stack = [p];
      seen[p] = 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % W, qy = (q / W) | 0;
        if (qx < x0) x0 = qx;
        if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy;
        if (qy > y1) y1 = qy;
        n++;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = qx + dx, ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const r = ny * W + nx;
            if (!seen[r] && mask[r]) {
              seen[r] = 1;
              stack.push(r);
            }
          }
        }
      }
      if (n >= minPixels) out.push({ x0, y0, x1, y1, n });
    }
  }
  return out;
}

/** k-means 1-D (agrupa as coordenadas dos sprites nas colunas/linhas da grade) */
function cluster1d(values: number[], k: number, iters = 80): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  let centers = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * (sorted.length - 1))]);
  for (let it = 0; it < iters; it++) {
    const groups: number[][] = Array.from({ length: k }, () => []);
    for (const v of values) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = Math.abs(v - centers[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      groups[bi].push(v);
    }
    centers = groups.map((g, i) => (g.length ? g.reduce((a, b) => a + b, 0) / g.length : centers[i]));
  }
  return centers.sort((a, b) => a - b);
}

interface CellGrid {
  cells: Map<string, Box>; // "col,row" → bbox do sprite (px do bordo)
  cols: number;
  rows: number;
  mask: Uint8Array;
}

/**
 * Descobre a grade real da prancha: as células NÃO estão em passo perfeito
 * (é uma prancha de apresentação), então cada sprite é localizado pelo próprio
 * desenho e depois encaixado na coluna/linha mais próxima.
 */
/**
 * Grade real da prancha. Cada célula é localizada pelo DESENHO, não por
 * coordenada fixa (as colunas/linhas da prancha não estão em passo uniforme):
 *  1. faixas horizontais = animações (projeção da máscara);
 *  2. componentes conexas (gap de 3 px) = bichos — divisórias finas e chips são
 *     descartados pelo tamanho;
 *  3. os centros são encaixados numa série de 16 posições (4 direções × 4
 *     quadros) e cada componente vai para o encaixe mais próximo.
 */
function detectGrid(img: RGBAImage, cols: number, rows: number, area: BoardSpec['area']): CellGrid {
  const mask = colorMask(img);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x < area.x0 || x > area.x1 || y < area.y0 || y > area.y1) mask[y * img.width + x] = 0;
    }
  }

  // 1) faixas horizontais
  const profY = new Array<number>(img.height).fill(0);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (mask[y * img.width + x]) profY[y]++;
  }
  const bands: Array<[number, number]> = [];
  let st = -1;
  for (let y = 0; y <= img.height; y++) {
    const on = y < img.height && profY[y] > 12;
    if (on && st < 0) st = y;
    if ((!on || y === img.height) && st >= 0) {
      if (y - st >= 20) bands.push([st, y - 1]);
      st = -1;
    }
  }
  // 2) dentro de cada faixa, os bichos são RUNS separados por coluna. Runs são
  //    imunes ao problema de "dilatação que une vizinhos" e cada célula da
  //    prancha é um run. O passo entre quadros e o respiro entre blocos de
  //    direção são medidos (a prancha não tem passo uniforme).
  const cells = new Map<string, Box>();
  bands.forEach(([y0, y1], r) => {
    if (r >= rows) return;
    const prof = new Array<number>(img.width).fill(0);
    for (let x = 0; x < img.width; x++) {
      let c = 0;
      for (let y = y0; y <= y1; y++) if (mask[y * img.width + x]) c++;
      prof[x] = c;
    }
    const runs: Array<[number, number]> = [];
    st = -1;
    for (let x = 0; x <= img.width; x++) {
      const on = x < img.width && prof[x] > 1;
      if (on && st < 0) st = x;
      if ((!on || x === img.width) && st >= 0) {
        if (x - st >= 10) runs.push([st, x - 1]);
        st = -1;
      }
    }
    if (runs.length === 0) return;
    const centers = runs.map(([a, b]) => (a + b) / 2);
    const gaps = centers.slice(1).map((v, i) => v - centers[i]);
    // Exatamente 3 quebras de bloco por faixa (4 direções). São os 3 maiores
    // vãos entre células — usar "maior vão" é imune à variação do passo.
    const breakIdx = gaps
      .map((g, i) => ({ g, i }))
      .sort((a, b) => b.g - a.g)
      .slice(0, Math.max(0, cols / 4 - 1))
      .map((x) => x.i)
      .sort((a, b) => a - b);
    const slots = new Map<number, Array<[number, number]>>();
    if (runs.length === cols && breakIdx.length === cols / 4 - 1) {
      // caminho normal: 16 células, 3 quebras ⇒ encaixe direto
      let slot = 0;
      runs.forEach((run, i) => {
        if (breakIdx.includes(i - 1) && i > 0) slot = Math.ceil((slot + 1) / 4) * 4;
        else if (i > 0) slot++;
        const arr = slots.get(slot) ?? [];
        arr.push(run);
        slots.set(slot, arr);
      });
    } else {
      // faixa com célula faltando: estima passo e encaixa pelo vizinho mais próximo
      const sorted = [...gaps].sort((a, b) => a - b);
      const pitch = sorted.length ? sorted[Math.floor(sorted.length / 3)] : (area.x1 - area.x0) / cols;
      const first = centers[0];
      const slotPos = (k: number) => first + k * pitch + Math.floor(k / 4) * pitch * 0.15;
      runs.forEach((run) => {
        const cx = (run[0] + run[1]) / 2;
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < cols; k++) {
          const d = Math.abs(slotPos(k) - cx);
          if (d < bestD) { bestD = d; best = k; }
        }
        const arr = slots.get(best) ?? [];
        arr.push(run);
        slots.set(best, arr);
      });
    }
    for (const [slot, list] of slots) {
      const x0 = Math.min(...list.map(([a]) => a));
      const x1 = Math.max(...list.map(([, b]) => b));
      let y0b = 1e9, y1b = -1, n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!mask[y * img.width + x]) continue;
          if (y < y0b) y0b = y;
          if (y > y1b) y1b = y;
          n++;
        }
      }
      if (y1b < 0) continue;
      cells.set(`${slot},${r}`, { x0, y0: y0b, x1, y1: y1b, n });
    }
  });
  return { cells, cols, rows, mask };
}

/** true se o pixel pertence ao bicho: colorido ou contorno escuro colado nele */
function spritePixelPixels(grid: CellGrid, img: RGBAImage, box: Box): (x: number, y: number) => boolean {
  // dilata a máscara colorida em 2 px: inclui o contorno preto do sprite
  const W = img.width;
  const local = new Set<number>();
  for (let y = Math.max(0, box.y0 - 1); y <= Math.min(img.height - 1, box.y1 + 1); y++) {
    for (let x = Math.max(0, box.x0 - 1); x <= Math.min(img.width - 1, box.x1 + 1); x++) {
      if (!grid.mask[y * W + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
          local.add(ny * W + nx);
        }
      }
    }
  }
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    const p = y * W + x;
    if (grid.mask[p]) return true;
    if (!local.has(p)) return false;
    const i = p * 4;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    return Math.max(r, g, b) < 110; // contorno/sombra escura do próprio sprite
  };
}

/** reduz por média de área (mantém o sombreado, evita serrilhado) */
function downscale(img: RGBAImage, box: Box, outW: number, outH: number, solid: (x: number, y: number) => boolean): RGBAImage {
  const out: RGBAImage = { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  for (let oy = 0; oy < outH; oy++) {
    const sy0 = box.y0 + Math.floor((oy * bh) / outH);
    const sy1 = Math.max(sy0 + 1, box.y0 + Math.floor(((oy + 1) * bh) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const sx0 = box.x0 + Math.floor((ox * bw) / outW);
      const sx1 = Math.max(sx0 + 1, box.x0 + Math.floor(((ox + 1) * bw) / outW));
      let r = 0, g = 0, b = 0, cov = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++;
          if (!solid(sx, sy)) continue;
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3] / 255;
          r += img.data[i] * a;
          g += img.data[i + 1] * a;
          b += img.data[i + 2] * a;
          cov += a;
        }
      }
      const o = (oy * outW + ox) * 4;
      if (cov <= 0.2 || cov / Math.max(1, n) < 0.38) continue;
      out.data[o] = r / cov;
      out.data[o + 1] = g / cov;
      out.data[o + 2] = b / cov;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** quantiza as cores e mantém alpha binário (sem halo) */
function pixelize(img: RGBAImage): RGBAImage {
  const step = 255 / (LEVELS - 1);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(Math.round(img.data[i + k] / step) * step);
    img.data[i + 3] = 255;
  }
  return img;
}

interface ExtractedFrame { img: RGBAImage }

/** extrai um quadro já reduzido (a base é alinhada no empacotamento) */
function extractFrame(grid: CellGrid, img: RGBAImage, spec: BoardSpec, col: number, row: number): ExtractedFrame | null {
  const box = grid.cells.get(`${col},${row}`);
  if (!box) return null;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  if (bw < 8 || bh < 8) return null;
  let th = spec.targetH;
  let tw = Math.round((bw * th) / bh);
  const maxW = spec.cellW - 2;
  if (tw > maxW) {
    tw = maxW;
    th = Math.round((bh * tw) / bw);
  }
  if (tw < 4 || th < 4) return null;
  const solid = spritePixelPixels(grid, img, box);
  // a bbox precisa incluir o contorno (escuro) colado no bicho
  let x0 = box.x0, y0 = box.y0, x1 = box.x1, y1 = box.y1;
  for (let guard = 0; guard < 2; guard++) {
    const grown = { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(img.width - 1, x1 + 1), y1: Math.min(img.height - 1, y1 + 1), n: box.n };
    const s2 = spritePixelPixels(grid, img, grown);
    let nx0 = 1e9, ny0 = 1e9, nx1 = -1, ny1 = -1;
    for (let y = grown.y0; y <= grown.y1; y++) {
      for (let x = grown.x0; x <= grown.x1; x++) {
        if (!s2(x, y)) continue;
        if (x < nx0) nx0 = x;
        if (y < ny0) ny0 = y;
        if (x > nx1) nx1 = x;
        if (y > ny1) ny1 = y;
      }
    }
    if (nx1 < 0) break;
    if (nx0 === x0 && ny0 === y0 && nx1 === x1 && ny1 === y1) break;
    x0 = nx0; y0 = ny0; x1 = nx1; y1 = ny1;
  }
  const tight: Box = { x0, y0, x1, y1, n: box.n };
  const th2 = Math.round((th * (tight.y1 - tight.y0 + 1)) / (box.y1 - box.y0 + 1));
  const tw2 = Math.round((tw * (tight.x1 - tight.x0 + 1)) / (box.x1 - box.x0 + 1));
  if (tw2 < 4 || th2 < 4) return null;
  const output = pixelize(downscale(img, tight, Math.min(maxW, tw2), Math.max(4, Math.min(spec.cellH - 2, th2)), spritePixelPixels(grid, img, tight)));
  void solid;
  return { img: output };
}

/**
 * Correção de direção: em algumas pranchas a coluna OESTE foi desenhada com a
 * mesma arte da LESTE (o bicho "anda para a direita" mesmo indo para a
 * esquerda). Aqui isso é medido nas células já extraídas:
 *  - se OESTE ≈ LESTE (e NÃO ≈ espelho de LESTE) → OESTE é espelhada;
 *  - se OESTE ≈ espelho de LESTE → a prancha já resolveu, fica como está.
 * O espelhamento é aplicado nos pixels, então a folha final tem arte coerente
 * (o render não precisa compensar nada).
 */
function mirrorImage(img: RGBAImage): RGBAImage {
  const out: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.length) };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const di = (y * img.width + (img.width - 1 - x)) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/** silhueta+cor normalizada em 24×24 (compara formas de tamanhos diferentes) */
function shapeOf(img: RGBAImage): Float32Array | null {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const N = 24;
  const m = new Float32Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const px = x0 + Math.round((gx / (N - 1)) * (x1 - x0));
      const py = y0 + Math.round((gy / (N - 1)) * (y1 - y0));
      const i = (py * img.width + px) * 4;
      m[gy * N + gx] = img.data[i + 3] === 0 ? 0 : (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    }
  }
  return m;
}

function shapeDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** espelha a direção OESTE quando ela veio igual à LESTE */
function fixWestDirection(frames: Map<string, ExtractedFrame[]>, kind: string): void {
  let sameEast = 0;
  let mirrorEast = 0;
  for (const [key, list] of frames) {
    if (!key.endsWith(':w')) continue;
    const east = frames.get(key.replace(':w', ':e'));
    if (!east) continue;
    for (let i = 0; i < Math.min(list.length, east.length); i++) {
      const a = shapeOf(list[i].img);
      const b = shapeOf(east[i].img);
      if (!a || !b) continue;
      sameEast += shapeDistance(a, b);
      mirrorEast += shapeDistance(a, shapeOf(mirrorImage(east[i].img))!);
    }
  }
  if (sameEast === 0) return;
  if (sameEast < mirrorEast * 0.6) {
    for (const [key, list] of frames) {
      if (!key.endsWith(':w')) continue;
      for (const f of list) f.img = mirrorImage(f.img);
    }
    console.log(`  ${kind}: direção OESTE vinha igual à LESTE (${sameEast.toFixed(0)} vs ${mirrorEast.toFixed(0)}) → espelhada`);
  } else {
    console.log(`  ${kind}: direção OESTE já é arte própria (${sameEast.toFixed(0)} vs ${mirrorEast.toFixed(0)}) → mantida`);
  }
}

function packSheet(frames: Map<string, ExtractedFrame[]>, spec: BoardSpec) {
  const rows = [...frames.keys()];
  const W = spec.cellW * FRAMES;
  const H = spec.cellH * rows.length;
  const sheet: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const rowIndex: Record<string, number> = {};
  rows.forEach((key, r) => {
    rowIndex[key] = r;
    const list = frames.get(key)!;
    list.forEach((f, c) => {
      // base alinhada: o último pixel do bicho fica na base da célula - 1
      const dx = c * spec.cellW + Math.floor((spec.cellW - f.img.width) / 2);
      const dy = r * spec.cellH + (spec.cellH - 1 - f.img.height);
      for (let y = 0; y < f.img.height; y++) {
        for (let x = 0; x < f.img.width; x++) {
          const si = (y * f.img.width + x) * 4;
          if (f.img.data[si + 3] === 0) continue;
          const tx = dx + x, ty = dy + y;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const di = (ty * W + tx) * 4;
          sheet.data[di] = f.img.data[si];
          sheet.data[di + 1] = f.img.data[si + 1];
          sheet.data[di + 2] = f.img.data[si + 2];
          sheet.data[di + 3] = 255;
        }
      }
    });
  });
  return { sheet, rowIndex };
}

/**
 * Correção de direção OESTE — feita nas LINHAS da folha (é exatamente o que o
 * jogo desenha, sem depender de recorte/alinhamento).
 *
 * Algumas pranchas repetem a arte da LESTE na coluna OESTE (o bicho continua
 * virado para a direita). Aqui, por animação:
 *  - se OESTE ≈ LESTE e ≠ espelho de LESTE → a linha OESTE é espelhada;
 *  - se OESTE já é o espelho de LESTE → fica como está (arte própria).
 */
function fixWestRows(
  sheet: RGBAImage,
  rows: Record<string, number>,
  spec: BoardSpec,
): { mirrored: string[]; kept: string[] } {
  const mirrored: string[] = [];
  const kept: string[] = [];
  const cellOf = (row: number) => {
    const m = new Float32Array(spec.cellW * spec.cellH);
    for (let y = 0; y < spec.cellH; y++) {
      for (let x = 0; x < spec.cellW; x++) {
        const i = ((row * spec.cellH + y) * sheet.width + x) * 4;
        m[y * spec.cellW + x] = sheet.data[i + 3] === 0 ? 0 : (sheet.data[i] + sheet.data[i + 1] + sheet.data[i + 2]) / 3;
      }
    }
    return m;
  };
  const mirrorOf = (a: Float32Array) => {
    const o = new Float32Array(a.length);
    for (let y = 0; y < spec.cellH; y++) {
      for (let x = 0; x < spec.cellW; x++) o[y * spec.cellW + (spec.cellW - 1 - x)] = a[y * spec.cellW + x];
    }
    return o;
  };
  const dist = (a: Float32Array, b: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };
  // Decisão POR ESPÉCIE (não por animação): uma prancha inteira repete ou não
  // a coluna LESTE na OESTE. Animação isolada (sono/morte, poses quase
  // simétricas) não pode decidir sozinha — senão a folha mistura as duas
  // convenções e o bicho "olha" para lados diferentes na mesma andada.
  let votesEast = 0;
  let votesMirror = 0;
  for (const anim of spec.anims) {
    const rowW = rows[`${anim}:w`];
    const rowE = rows[`${anim}:e`];
    if (rowW === undefined || rowE === undefined) continue;
    const sameEast = dist(cellOf(rowW), cellOf(rowE));
    const mirrorEast = dist(cellOf(rowW), mirrorOf(cellOf(rowE)));
    if (sameEast < mirrorEast * 0.7) votesEast++;
    else if (mirrorEast < sameEast * 0.7) votesMirror++;
  }
  const mirrorWholeBoard = votesEast > votesMirror;
  console.log(`  OESTE: votos igual-a-LESTE=${votesEast}, já-espelhada=${votesMirror} → ${mirrorWholeBoard ? 'espelhar a coluna OESTE' : 'manter (já é arte voltada para a esquerda)'}`);
  for (const anim of spec.anims) {
    const rowW = rows[`${anim}:w`];
    const rowE = rows[`${anim}:e`];
    if (rowW === undefined || rowE === undefined) continue;
    if (mirrorWholeBoard) {
      // espelha a linha OESTE inteira (4 quadros)
      for (let y = 0; y < spec.cellH; y++) {
        for (let x = 0; x < Math.floor(spec.cellW / 2); x++) {
          const a = ((rowW * spec.cellH + y) * sheet.width + x) * 4;
          const b = ((rowW * spec.cellH + y) * sheet.width + (spec.cellW - 1 - x)) * 4;
          for (let k = 0; k < 4; k++) {
            const t = sheet.data[a + k];
            sheet.data[a + k] = sheet.data[b + k];
            sheet.data[b + k] = t;
          }
        }
      }
      mirrored.push(anim);
    } else {
      kept.push(anim);
    }
  }
  return { mirrored, kept };
}

function main(): void {
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
  const gallery: Array<{ kind: string; sheet: RGBAImage; scale: number }> = [];

  for (const spec of BOARDS) {
    if (only && !only.has(spec.kind)) continue;
    const board = decodePNG(readFileSync(join(ROOT, 'tools/data', spec.file)));
    const grid = detectGrid(board, DIRS.length * FRAMES, spec.anims.length, spec.area);
    const frames = new Map<string, ExtractedFrame[]>();
    let missing = 0;
    let missingCells: string[] | null = null;
    for (let r = 0; r < spec.anims.length; r++) {
      const anim = spec.anims[r];
      for (let di = 0; di < DIRS.length; di++) {
        const dir = DIRS[di];
        const list: ExtractedFrame[] = [];
        for (let c = 0; c < FRAMES; c++) {
          const col = di * FRAMES + c;
          const f = extractFrame(grid, board, spec, col, r);
          if (f) list.push(f);
          else { missing++; (missingCells ??= []).push(`${anim}:${DIRS[di]} f${c}`); }
        }
        if (list.length === 0) {
          console.warn(`  !! ${spec.kind} ${anim}:${dir} vazio — linha omitida`);
          continue;
        }
        // quadro faltante repete o último válido (nunca inventar arte)
        while (list.length < FRAMES) list.push(list[list.length - 1]);
        frames.set(`${anim}:${dir}`, list);
      }
    }
    const { sheet, rowIndex } = packSheet(frames, spec);
    const west = fixWestRows(sheet, rowIndex, spec);
    console.log(
      `  OESTE: ${west.mirrored.length} anim espelhada(s)` +
      (west.mirrored.length ? ` (${west.mirrored.join(', ')})` : '') +
      `, ${west.kept.length} já vinham viradas para a esquerda`,
    );
    writeFileSync(join(ROOT, 'assets/Animals', `${spec.kind}.png`), encodePNG(sheet));
    const anims: Record<string, number> = {};
    for (const anim of spec.anims) anims[anim] = FRAMES;
    const json = {
      cell: [spec.cellW, spec.cellH],
      maxFrames: FRAMES,
      dirs: DIRS,
      anims,
      rows: rowIndex,
      mirroredDirs: { w: west.mirrored },
      source: `tools/data/${spec.file}`,
    };
    writeFileSync(join(ROOT, 'assets/Animals', `${spec.kind}.json`), `${JSON.stringify(json, null, 2)}\n`);
    gallery.push({ kind: spec.kind, sheet, scale: 6 });
    console.log(
      `${spec.kind}: ${sheet.width}×${sheet.height} — ${Object.keys(rowIndex).length} linhas ` +
      `(${spec.anims.length} anim × ${DIRS.length} dir)${missing ? `, ${missing} células vazias: ${missingCells?.slice(0, 12).join(', ')}` : ''}`,
    );
  }

  if (gallery.length) {
    const pad = 6;
    const W = Math.max(...gallery.map((g) => g.sheet.width * g.scale)) + pad * 2;
    const H = gallery.reduce((sum, g) => sum + g.sheet.height * g.scale + pad, pad);
    const out: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 26; out.data[i + 1] = 32; out.data[i + 2] = 28; out.data[i + 3] = 255;
    }
    let oy = pad;
    for (const g of gallery) {
      for (let y = 0; y < g.sheet.height * g.scale; y++) {
        for (let x = 0; x < g.sheet.width * g.scale; x++) {
          const si = (Math.floor(y / g.scale) * g.sheet.width + Math.floor(x / g.scale)) * 4;
          if (g.sheet.data[si + 3] === 0) continue;
          const di = ((oy + y) * W + pad + x) * 4;
          out.data[di] = g.sheet.data[si];
          out.data[di + 1] = g.sheet.data[si + 1];
          out.data[di + 2] = g.sheet.data[si + 2];
          out.data[di + 3] = 255;
        }
      }
      oy += g.sheet.height * g.scale + pad;
    }
    writeFileSync(join(ROOT, 'docs/imagens/sprites_direcionais.png'), encodePNG(out));
    console.log('contato visual: docs/imagens/sprites_direcionais.png');
  }
}

main();
