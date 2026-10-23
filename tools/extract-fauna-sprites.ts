/**
 * Extrai a fauna (coelho, sapo, ave) da folha de referência fornecida e gera
 * spritesheets em pixel art, com transparência real, no tamanho do jogo.
 *
 * A folha original é uma prancha de apresentação: tem fundo, brilhos, sombras
 * suaves, títulos, caixas e legendas. Aqui:
 *  - cada célula de animação é recortada na grade conhecida e auto-trimada pelo
 *    miolo do sprite (a sombra suave em volta é descartada);
 *  - o recorte é reduzido por média de área até a altura de jogo (coelho ~16 px,
 *    sapo/ave ~13 px), o que preserva o sombreado sem serrilhar;
 *  - as cores são quantizadas (pixel art) e o alpha é binário (sem halo);
 *  - as animações viram linhas de uma spritesheet por espécie.
 *
 * Uso: npx tsx tools/extract-fauna-sprites.ts
 * Entrada: tools/data/fauna-reference.png (a prancha fornecida)
 * Saída:   assets/Animals/rabbit.png, frog.png, bird.png + .tmp/fauna/sheet.png
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = join(ROOT, 'tools/data/fauna-reference.png');

/** cor do fundo da prancha (amostrada do canto superior esquerdo) */
const BG: [number, number, number] = [38, 48, 56];
/** distância mínima do fundo para um pixel pertencer ao animal */
const SOLID_DIST = 52;


interface RowSpec {
  anim: string;
  /** banda vertical da linha na prancha */
  y0: number;
  y1: number;
  /** passo horizontal entre frames */
  pitch: number;
  frames: number;
}

interface SpeciesSpec {
  id: string;
  x0: number;
  x1: number;
  targetH: number;
  rows: RowSpec[];
}

/**
 * Grade lida da prancha (1536×1024) por projeção de linhas/colunas, já com os
 * rótulos e as seções de variação/filhote/ícone descartados.
 */
const SPECIES: SpeciesSpec[] = [
  {
    id: 'rabbit',
    x0: 8,
    x1: 330,
    targetH: 17,
    rows: [
      { anim: 'idle', y0: 81, y1: 141, pitch: 49.6, frames: 6 },
      { anim: 'walk', y0: 169, y1: 223, pitch: 49.6, frames: 6 },
      { anim: 'run', y0: 257, y1: 315, pitch: 49.6, frames: 6 },
      { anim: 'jump', y0: 355, y1: 414, pitch: 49.6, frames: 5 },
      { anim: 'eat', y0: 459, y1: 502, pitch: 51.0, frames: 6 },
      { anim: 'sleep', y0: 545, y1: 589, pitch: 51.6, frames: 5 },
    ],
  },
  {
    id: 'frog',
    x0: 500,
    x1: 806,
    targetH: 15,
    rows: [
      { anim: 'idle', y0: 108, y1: 162, pitch: 58, frames: 4 },
      { anim: 'jump', y0: 192, y1: 252, pitch: 58, frames: 4 },
      { anim: 'swim', y0: 291, y1: 333, pitch: 58, frames: 5 },
      { anim: 'eat', y0: 385, y1: 433, pitch: 58, frames: 4 },
      { anim: 'sleep', y0: 504, y1: 541, pitch: 58, frames: 4 },
    ],
  },
  {
    id: 'bird',
    x0: 1015,
    x1: 1320,
    targetH: 14,
    rows: [
      { anim: 'idle', y0: 97, y1: 141, pitch: 49, frames: 5 },
      { anim: 'fly', y0: 179, y1: 247, pitch: 49, frames: 4 },
      { anim: 'land', y0: 303, y1: 354, pitch: 49, frames: 4 },
      { anim: 'eat', y0: 417, y1: 463, pitch: 49, frames: 4 },
      { anim: 'sleep', y0: 525, y1: 571, pitch: 49, frames: 4 },
    ],
  },
];

/** duração de cada animação (ms por quadro), usada no manifesto */
const FRAME_MS: Record<string, number> = {
  idle: 260, walk: 150, run: 100, jump: 110, eat: 190, sleep: 420,
  fly: 90, land: 130, swim: 150,
};

interface Blob {
  x0: number; y0: number; x1: number; y1: number;
  w: number; h: number; n: number; cx: number; cy: number;
}

/** conecta os pixels do animal (dilatação de 2 px une asas/patas ao corpo) */

/** agrupa blobs em linhas de animação (gap vertical > 16 px = outra linha) */

/** projeção de colunas dentro de uma banda: devolve os frames (runs separados) */

function loadReference(): RGBAImage {
  if (!existsSync(REFERENCE)) {
    throw new Error(`referência ausente: ${REFERENCE}`);
  }
  return decodePNG(readFileSync(REFERENCE));
}

/** texto da prancha: cinza claro, baixa saturação (títulos, rótulos, legendas) */
function isLabel(img: RGBAImage, x: number, y: number): boolean {
  const i = (y * img.width + x) * 4;
  const r = img.data[i];
  const g = img.data[i + 1];
  const b = img.data[i + 2];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx - mn < 22 && mx > 110;
}

function distFromBg(img: RGBAImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  const dr = img.data[i] - BG[0];
  const dg = img.data[i + 1] - BG[1];
  const db = img.data[i + 2] - BG[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** bbox do miolo do sprite (ignora brilho/sombra suaves em volta) */
function trimBox(img: RGBAImage, x0: number, y0: number, w: number, h: number) {
  let ax0 = 1e9;
  let ay0 = 1e9;
  let ax1 = -1;
  let ay1 = -1;
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= img.height) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= img.width) continue;
      if (img.data[(y * img.width + x) * 4 + 3] < 16) continue;
      if (distFromBg(img, x, y) < SOLID_DIST) continue;
      if (isLabel(img, x, y)) continue; // textos e legendas da prancha
      if (x < ax0) ax0 = x;
      if (y < ay0) ay0 = y;
      if (x > ax1) ax1 = x;
      if (y > ay1) ay1 = y;
    }
  }
  if (ax1 < 0) return null;
  return { x: ax0, y: ay0, w: ax1 - ax0 + 1, h: ay1 - ay0 + 1 };
}

/** reduz por média de área (mantém o sombreado, evita aliasing) */
function downscale(img: RGBAImage, x0: number, y0: number, w: number, h: number, outW: number, outH: number): RGBAImage {
  const out: RGBAImage = { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
  for (let oy = 0; oy < outH; oy++) {
    const sy0 = y0 + Math.floor((oy * h) / outH);
    const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((oy + 1) * h) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const sx0 = x0 + Math.floor((ox * w) / outW);
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((ox + 1) * w) / outW));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
          const i = (sy * img.width + sx) * 4;
          const dist = distFromBg(img, sx, sy);
          if (img.data[i + 3] < 16 || dist < SOLID_DIST) continue; // fundo/brilho não conta
          if (isLabel(img, sx, sy)) continue; // texto não entra no sprite
          const alpha = img.data[i + 3] / 255;
          r += img.data[i] * alpha;
          g += img.data[i + 1] * alpha;
          b += img.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (oy * outW + ox) * 4;
      if (n === 0 || a <= 0) continue;
      out.data[o] = r / a;
      out.data[o + 1] = g / a;
      out.data[o + 2] = b / a;
      // cobertura: quantos pixels do bloco eram do animal (alpha binário depois)
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** paleta por quantização uniforme + alpha binário (pixel art sem halo) */
function pixelize(img: RGBAImage, levels: number): RGBAImage {
  const out: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const step = 255 / (levels - 1);
  for (let i = 0; i < out.data.length; i += 4) {
    const cov = out.data[i + 3] / 255;
    if (cov < 0.42) {
      out.data[i + 3] = 0; // fora do animal: transparente de verdade (sem halo)
      continue;
    }
    out.data[i] = Math.round(Math.round(out.data[i] / step) * step);
    out.data[i + 1] = Math.round(Math.round(out.data[i + 1] / step) * step);
    out.data[i + 2] = Math.round(Math.round(out.data[i + 2] / step) * step);
    out.data[i + 3] = 255;
  }
  return out;
}

interface PackedAnim {
  id: string;
  frames: RGBAImage[];
}

/** centros horizontais dos frames de uma linha (runs divididos pelo passo) */
function frameCenters(
  img: RGBAImage,
  top: number,
  bottom: number,
  x0: number,
  x1: number,
  pitch: number,
  maxFrames: number,
): number[] {
  const cols = new Int32Array(x1 - x0 + 1);
  for (let y = top; y <= bottom; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 16) continue;
      if (distFromBg(img, x, y) < SOLID_DIST) continue;
      if (isLabel(img, x, y)) continue;
      cols[x - x0]++;
    }
  }
  const runs: Array<[number, number]> = [];
  let st = -1;
  for (let i = 0; i <= cols.length; i++) {
    const on = i < cols.length && cols[i] > 0;
    if (on && st < 0) st = i;
    if (!on && st >= 0) {
      if (i - st >= 6) runs.push([x0 + st, x0 + i - 1]);
      st = -1;
    }
  }
  const centers: number[] = [];
  for (const [a, b] of runs) {
    const w = b - a + 1;
    if (w > pitch * 1.55) {
      const n = Math.min(4, Math.max(2, Math.round(w / pitch)));
      for (let k = 0; k < n; k++) centers.push(a + (w / n) * (k + 0.5));
    } else {
      centers.push((a + b) / 2);
    }
  }
  return centers.slice(0, maxFrames);
}

function main(): void {
  const ref = loadReference();
  const tmpDir = join(ROOT, '.tmp/fauna');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(ROOT, 'assets/Animals'), { recursive: true });

  const preview: Array<{ label: string; img: RGBAImage }> = [];

  for (const species of SPECIES) {
    const packed: Array<{ id: string; frames: RGBAImage[]; ms: number }> = [];
    for (const rowSpec of species.rows) {
      const frames: RGBAImage[] = [];
      const top = Math.max(0, rowSpec.y0 - 2);
      const height = rowSpec.y1 - rowSpec.y0 + 5;
      // centros dos frames medidos na projeção de colunas da linha: quando dois
      // sprites se tocam, o "run" largo é dividido pelo passo da espécie
      for (const center of frameCenters(ref, top, rowSpec.y1, species.x0, species.x1, rowSpec.pitch, rowSpec.frames)) {
        const w = Math.round(rowSpec.pitch) + 2;
        const box = trimBox(ref, Math.round(center - w / 2), top, w, height);
        if (!box) continue;
        const outH = species.targetH;
        const outW = Math.max(4, Math.round((box.w / box.h) * outH));
        const small = downscale(ref, box.x, box.y, box.w, box.h, outW, outH);
        frames.push(pixelize(small, 7));
      }
      if (frames.length) packed.push({ id: rowSpec.anim, frames, ms: FRAME_MS[rowSpec.anim] ?? 200 });
    }

    let cellW = 0;
    let cellH = 0;
    for (const a of packed) {
      for (const f of a.frames) {
        cellW = Math.max(cellW, f.width);
        cellH = Math.max(cellH, f.height);
      }
    }
    const maxFrames = Math.max(...packed.map((a) => a.frames.length));
    const sheet: RGBAImage = {
      width: cellW * maxFrames,
      height: cellH * packed.length,
      data: new Uint8ClampedArray(cellW * maxFrames * cellH * packed.length * 4),
    };
    const report: Record<string, number> = {};
    const framesMs: Record<string, number> = {};
    packed.forEach((anim, row) => {
      report[anim.id] = anim.frames.length;
      framesMs[anim.id] = anim.ms;
      anim.frames.forEach((frame, col) => {
        // alinhamento pela BASE (pivô no chão, como árvores e personagem)
        const dx = col * cellW + Math.floor((cellW - frame.width) / 2);
        const dy = row * cellH + (cellH - frame.height);
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            const si = (y * frame.width + x) * 4;
            if (frame.data[si + 3] === 0) continue;
            const di = ((dy + y) * sheet.width + dx + x) * 4;
            sheet.data[di] = frame.data[si];
            sheet.data[di + 1] = frame.data[si + 1];
            sheet.data[di + 2] = frame.data[si + 2];
            sheet.data[di + 3] = 255;
          }
        }
      });
    });
    writeFileSync(join(ROOT, `assets/Animals/${species.id}.png`), encodePNG(sheet));
    writeFileSync(
      join(ROOT, `assets/Animals/${species.id}.json`),
      JSON.stringify({ cell: [cellW, cellH], maxFrames, anims: report, frameMs: framesMs }, null, 2),
    );
    preview.push({ label: species.id, img: sheet });
    console.log(`${species.id}: célula ${cellW}x${cellH} | ${JSON.stringify(report)} → ${sheet.width}x${sheet.height}`);
  }

  // folha de contato 6× (fundo quadriculado) para inspeção visual
  const S = 6;
  let w = 0;
  let h = 0;
  for (const p of preview) {
    w = Math.max(w, p.img.width * S);
    h += p.img.height * S + 8;
  }
  const sheetOut: RGBAImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  let oy = 0;
  for (const p of preview) {
    for (let y = 0; y < p.img.height * S; y++) {
      for (let x = 0; x < p.img.width * S; x++) {
        const si = (Math.floor(y / S) * p.img.width + Math.floor(x / S)) * 4;
        const di = ((oy + y) * w + x) * 4;
        const checker = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 70 : 96;
        const a = p.img.data[si + 3] / 255;
        sheetOut.data[di] = p.img.data[si] * a + checker * (1 - a);
        sheetOut.data[di + 1] = p.img.data[si + 1] * a + checker * (1 - a);
        sheetOut.data[di + 2] = p.img.data[si + 2] * a + checker * (1 - a);
        sheetOut.data[di + 3] = 255;
      }
    }
    oy += p.img.height * S + 8;
  }
  writeFileSync(join(tmpDir, 'sheet.png'), encodePNG(sheetOut));
  console.log('folha de contato: .tmp/fauna/sheet.png');
}

main();
