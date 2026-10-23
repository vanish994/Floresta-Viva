/**
 * Extrai a COBRA da prancha fornecida (`tools/data/snake-reference.png`) e gera
 * a spritesheet em pixel art usada pelo pipeline de fauna do jogo.
 *
 * A prancha é uma folha de apresentação: fundo quadriculado, caixas de rótulo
 * azul-acinzentadas e a cobra em verde/marrom. Aqui:
 *  - pixels do animal são separados por saturação (fundo e rótulos são cinza);
 *  - cada frame é detectado por componentes conexos (não por grade fixa);
 *  - os frames são reduzidos por média de área com ESCALA ÚNICA por espécie
 *    (sem distorcer), quantizados e com alpha binário (pixel art sem halo);
 *  - as linhas viram as animações: idle, move, attack, hide, hurt, death, sleep.
 *
 * Uso: npx tsx tools/extract-snake-sprites.ts
 * Saída: assets/Animals/snake.png + snake.json e .tmp/fauna/snake_sheet.png
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = join(ROOT, 'tools/data/snake-reference.png');
const OUT_DIR = join(ROOT, '.tmp/fauna');

/** ordem das linhas na prancha → nome da animação no jogo */
const ROW_NAMES = ['idle', 'move', 'attack', 'hide', 'death', 'hurt', 'sleep'] as const;
/** duração (ms) de cada animação no jogo */
const FRAME_MS: Record<string, number> = {
  idle: 240, move: 120, attack: 90, hide: 260, hurt: 120, death: 160, sleep: 380,
};
/** altura alvo do frame enrolado (idle) em pixels de jogo — escala única */
const TARGET_COIL_H = 17;

/** pixel pertence à cobra? (fundo quadriculado e rótulos são acromáticos) */
function isSnakePixel(img: RGBAImage, x: number, y: number): boolean {
  const i = (y * img.width + x) * 4;
  if (img.data[i + 3] < 16) return false;
  const r = img.data[i];
  const g = img.data[i + 1];
  const b = img.data[i + 2];
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  if (mn > 150) return false; // fundo claro do xadrez
  if (b > g + 8 && b > r + 8) return false; // caixas de rótulo azuladas
  return mx - mn > 34; // verde/marrom da cobra (fundo/rótulo são cinza)
}

/** saturação de um pixel (usada para escolher a cor "de miolo" no downsample) */
function saturation(img: RGBAImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
}

interface Box {
  x0: number; y0: number; x1: number; y1: number; w: number; h: number; cx: number; cy: number; n: number;
}

/** componentes conexos (dilatação 1 px) → cada serpente é um blob */
function blobs(img: RGBAImage): Box[] {
  const W = img.width;
  const H = img.height;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isSnakePixel(img, x, y)) mask[y * W + x] = 1;
  const dilated = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) dilated[ny * W + nx] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(W * H);
  const out: Box[] = [];
  for (let p = 0; p < W * H; p++) {
    if (!dilated[p] || seen[p]) continue;
    const stack = [p];
    seen[p] = 1;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
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
          if (dilated[r] && !seen[r]) {
            seen[r] = 1;
            stack.push(r);
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    // filtra rótulos pequenos e ruído
    if (w < 30 || h < 20 || n < 300) continue;
    out.push({ x0, y0, x1, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, n });
  }
  return out;
}

/** agrupa por linha (gap vertical > 20 px = outra linha) */
function groupRows(list: Box[]): Box[][] {
  const sorted = [...list].sort((a, b) => a.cy - b.cy);
  const rows: Box[][] = [];
  let cur: Box[] = [];
  for (const b of sorted) {
    if (cur.length === 0) {
      cur.push(b);
      continue;
    }
    const avg = cur.reduce((s, c) => s + c.cy, 0) / cur.length;
    if (Math.abs(b.cy - avg) > 22) {
      rows.push(cur);
      cur = [b];
    } else cur.push(b);
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/**
 * Reduz com escala uniforme. Como a cobra é pequena na prancha (≈1,2 px de
 * arte por pixel de jogo), a média de área lavaria as cores: aqui usamos
 * AMOSTRAGEM POR PONTO (nearest) no centro do bloco — é o que mantém o padrão
 * de escamas e o contorno do pixel art nítidos. Transparência vem de o próprio
 * ponto central ser fundo; o alpha final é binário.
 */
function downscale(img: RGBAImage, box: Box, scale: number, outW: number, outH: number): RGBAImage {
  const out: RGBAImage = { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
  for (let oy = 0; oy < outH; oy++) {
    const sy = box.y0 + Math.min(box.h - 1, Math.floor((oy + 0.5) / scale));
    for (let ox = 0; ox < outW; ox++) {
      const sx = box.x0 + Math.min(box.w - 1, Math.floor((ox + 0.5) / scale));
      if (sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      // ponto de fundo: tenta 1 vizinho para não abrir buracos no corpo
      let src = isSnakePixel(img, sx, sy) ? si : -1;
      if (src < 0) {
        for (let dy = -1; dy <= 1 && src < 0; dy++) {
          for (let dx = -1; dx <= 1 && src < 0; dx++) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
            if (isSnakePixel(img, nx, ny)) src = (ny * img.width + nx) * 4;
          }
        }
      }
      if (src < 0) continue;
      const o = (oy * outW + ox) * 4;
      out.data[o] = img.data[src];
      out.data[o + 1] = img.data[src + 1];
      out.data[o + 2] = img.data[src + 2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** pixel art: cores quantizadas e alpha binário (sem halo) */
function pixelize(img: RGBAImage, levels = 7): RGBAImage {
  const out: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const step = 255 / (levels - 1);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] / 255 < 0.42) {
      out.data[i + 3] = 0;
      continue;
    }
    out.data[i] = Math.round(Math.round(out.data[i] / step) * step);
    out.data[i + 1] = Math.round(Math.round(out.data[i + 1] / step) * step);
    out.data[i + 2] = Math.round(Math.round(out.data[i + 2] / step) * step);
    out.data[i + 3] = 255;
  }
  return out;
}

function main(): void {
  if (!existsSync(REFERENCE)) throw new Error(`referência ausente: ${REFERENCE}`);
  const ref = decodePNG(readFileSync(REFERENCE));
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(ROOT, 'assets/Animals'), { recursive: true });

  const rows = groupRows(blobs(ref)).map((r) => [...r].sort((a, b) => a.x0 - b.x0));
  console.log(`linhas detectadas: ${rows.length} → ${rows.map((r) => r.length + ' frames').join(', ')}`);

  // escala única por espécie: usa a altura média dos frames enrolados (idle)
  const coil = rows[0] ?? [];
  const coilH = coil.reduce((s, b) => s + b.h, 0) / Math.max(1, coil.length);
  const scale = TARGET_COIL_H / Math.max(1, coilH);
  console.log(`altura enrolada na prancha ~${coilH.toFixed(0)}px → escala ${scale.toFixed(3)}`);

  interface Anim {
    id: string;
    frames: RGBAImage[];
    ms: number;
  }
  const anims: Anim[] = [];
  rows.forEach((row, idx) => {
    const id = ROW_NAMES[idx];
    if (!id) return;
    const frames: RGBAImage[] = [];
    for (const box of row) {
      const outW = Math.max(4, Math.round(box.w * scale));
      const outH = Math.max(4, Math.round(box.h * scale));
      frames.push(pixelize(downscale(ref, box, scale, outW, outH)));
    }
    if (frames.length) anims.push({ id, frames, ms: FRAME_MS[id] ?? 160 });
  });

  // célula fixa (maior frame) para recorte por grade no manifesto
  let cellW = 0;
  let cellH = 0;
  for (const a of anims) {
    for (const f of a.frames) {
      cellW = Math.max(cellW, f.width);
      cellH = Math.max(cellH, f.height);
    }
  }
  const maxFrames = Math.max(...anims.map((a) => a.frames.length));
  const sheet: RGBAImage = {
    width: cellW * maxFrames,
    height: cellH * anims.length,
    data: new Uint8ClampedArray(cellW * maxFrames * cellH * anims.length * 4),
  };
  const report: Record<string, number> = {};
  const framesMs: Record<string, number> = {};
  anims.forEach((anim, row) => {
    report[anim.id] = anim.frames.length;
    framesMs[anim.id] = anim.ms;
    anim.frames.forEach((frame, col) => {
      // alinhamento pela base (pivô no chão, como coelho/sapo/ave)
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

  writeFileSync(join(ROOT, 'assets/Animals/snake.png'), encodePNG(sheet));
  writeFileSync(
    join(ROOT, 'assets/Animals/snake.json'),
    `${JSON.stringify({ cell: [cellW, cellH], maxFrames, anims: report, frameMs: framesMs }, null, 2)}\n`,
  );

  // folha de contato 6× (fundo quadriculado) para inspeção
  const S = 6;
  const preview: RGBAImage = {
    width: sheet.width * S,
    height: sheet.height * S,
    data: new Uint8ClampedArray(sheet.width * S * sheet.height * S * 4),
  };
  for (let y = 0; y < preview.height; y++) {
    for (let x = 0; x < preview.width; x++) {
      const si = (Math.floor(y / S) * sheet.width + Math.floor(x / S)) * 4;
      const di = (y * preview.width + x) * 4;
      const checker = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 70 : 96;
      const a = sheet.data[si + 3] / 255;
      preview.data[di] = sheet.data[si] * a + checker * (1 - a);
      preview.data[di + 1] = sheet.data[si + 1] * a + checker * (1 - a);
      preview.data[di + 2] = sheet.data[si + 2] * a + checker * (1 - a);
      preview.data[di + 3] = 255;
    }
  }
  writeFileSync(join(OUT_DIR, 'snake_sheet.png'), encodePNG(preview));

  console.log(
    `snake: célula ${cellW}x${cellH} | ${JSON.stringify(report)} → ${sheet.width}x${sheet.height}\n` +
      `gravado assets/Animals/snake.png (+json) e .tmp/fauna/snake_sheet.png`,
  );
}

main();
