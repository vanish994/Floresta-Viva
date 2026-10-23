/**
 * Extrai os tiles de CHÃO e ÁGUA do pack gratuito ("Free asset pack") para
 * folhas de 32×32 no idioma visual do Harmonious.
 *
 * O que este extrator NÃO faz: colar as pranchas de apresentação no jogo. As
 * pranchas têm 200–280 px por tile, fundo escuro, títulos e margens em 2,5D —
 * nada disso serve. O pipeline é:
 *
 *  1. lê o `.zip` do pack direto do repositório (sem duplicar 17 MB em assets/);
 *  2. localiza cada TILE pelo desenho (projeção de luminância: os tiles são
 *     retângulos claros sobre fundo quase preto), sem presumir coordenadas;
 *  3. reduz cada tile para 32×32 por média de área (preserva o desenho e evita
 *     serrilhado) — o mundo usa 32 px, não 220;
 *  4. "recolore para casar" com o Harmonious: dessatura levemente, comprime o
 *     contraste em torno da média e quantiza a paleta (pixel art sem gradiente);
 *  5. empacota folhas estáveis (uma coluna por tile/quadro) + JSON com os
 *     recortes, para o manifesto ler sem recalcular nada.
 *
 * Uso: npx tsx tools/extract-pack-tiles.ts
 * Saída:
 *   assets/Ground/pack_tiles.png      (10 tiles 32×32: grama ×5, terra ×2, areia ×2, neve ×1)
 *   assets/Ground/pack_tiles.json
 *   assets/Water/pack_water.png       (4 quadros 32×32 — água média)
 *   assets/Water/pack_water_deep.png  (4 quadros 32×32 — água funda, mesma arte escurecida)
 *   assets/Water/pack_water.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { decodePNG, encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** pack gratuito enviado pelo autor do projeto (fica fora de `assets/`) */
const PACK_ZIP = 'Free asset pack, thank u so much!.zip';
const TILE = 32;

// --- leitor mínimo de ZIP (deflate/stored) ----------------------------------
/** entradas do ZIP: nome → bytes (sem precisar extrair o pacote inteiro) */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End Of Central Directory: varre de trás para frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP inválido: EOCD não encontrado');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido: entrada corrompida');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    // cabeçalho local: nome e extra têm comprimentos próprios
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
  }
  return out;
}

// --- grade de tiles da prancha ----------------------------------------------
interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Tiles de uma prancha: retângulos CLAROS separados por fundo escuro.
 * A linha é escolhida pelo índice (as pranchas têm o mesmo esquema: título,
 * depois linhas de tiles) e cada tile é medido, não presumido.
 */
function tileRows(img: RGBAImage): TileBox[][] {
  const lum = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
  };
  // perfil horizontal: linhas com muito conteúdo claro = faixas de tiles
  const rows: number[] = [];
  for (let y = 0; y < img.height; y++) {
    let c = 0;
    for (let x = 0; x < img.width; x++) if (lum(x, y) > 55) c++;
    rows.push(c);
  }
  const bands: Array<[number, number]> = [];
  let st = -1;
  for (let y = 0; y <= img.height; y++) {
    const on = y < img.height && rows[y] > img.width * 0.3;
    if (on && st < 0) st = y;
    if ((!on || y === img.height) && st >= 0) {
      if (y - st >= 60) bands.push([st, y - 1]);
      st = -1;
    }
  }
  return bands.map(([y0, y1]) => {
    const cols: number[] = [];
    for (let x = 0; x < img.width; x++) {
      let c = 0;
      for (let y = y0; y <= y1; y++) if (lum(x, y) > 55) c++;
      cols.push(c);
    }
    const runs: Array<[number, number]> = [];
    st = -1;
    for (let x = 0; x <= img.width; x++) {
      const on = x < img.width && cols[x] > (y1 - y0) * 0.35;
      if (on && st < 0) st = x;
      if ((!on || x === img.width) && st >= 0) {
        if (x - st >= 80) runs.push([st, x - 1]);
        st = -1;
      }
    }
    return runs.map(([x0, x1]) => {
      let top = y1;
      let bot = y0;
      for (let y = y0; y <= y1; y++) {
        let c = 0;
        for (let x = x0; x <= x1; x++) if (lum(x, y) > 55) c++;
        if (c > (x1 - x0) * 0.35) {
          if (y < top) top = y;
          if (y > bot) bot = y;
        }
      }
      return { x: x0, y: top, w: x1 - x0 + 1, h: bot - top + 1 };
    });
  });
}

// --- redução + recoloração (o "casar com o Harmonious") ---------------------
/**
 * Recuo de 4,5% em cada lado: os tiles da prancha têm moldura/sombra de
 * apresentação (borda escura). Sem o recuo essa borda entra no sprite e vira
 * uma grade visível no mundo.
 */
function inset(box: TileBox, frac = 0.045): TileBox {
  const dx = Math.max(1, Math.round(box.w * frac));
  const dy = Math.max(1, Math.round(box.h * frac));
  return { x: box.x + dx, y: box.y + dy, w: box.w - dx * 2, h: box.h - dy * 2 };
}

/** média de área até 32×32 (mantém o desenho, sem serrilhar) */
function downscale(rawBox: TileBox, src: RGBAImage, out = TILE): RGBAImage {
  const box = inset(rawBox);
  const o: RGBAImage = { width: out, height: out, data: new Uint8ClampedArray(out * out * 4) };
  for (let oy = 0; oy < out; oy++) {
    const sy0 = box.y + Math.floor((oy * box.h) / out);
    const sy1 = Math.max(sy0 + 1, box.y + Math.floor(((oy + 1) * box.h) / out));
    for (let ox = 0; ox < out; ox++) {
      const sx0 = box.x + Math.floor((ox * box.w) / out);
      const sx1 = Math.max(sx0 + 1, box.x + Math.floor(((ox + 1) * box.w) / out));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      }
      const d = (oy * out + ox) * 4;
      o.data[d] = r / n;
      o.data[d + 1] = g / n;
      o.data[d + 2] = b / n;
      o.data[d + 3] = 255;
    }
  }
  return o;
}

/** média e desvio por canal (RGBA, ignora alpha) */
export function stats(img: RGBAImage): { mean: [number, number, number]; sd: [number, number, number] } {
  const n = img.width * img.height;
  const mean: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < img.data.length; i += 4) {
    mean[0] += img.data[i];
    mean[1] += img.data[i + 1];
    mean[2] += img.data[i + 2];
  }
  mean[0] /= n;
  mean[1] /= n;
  mean[2] /= n;
  const sd: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < img.data.length; i += 4) {
    for (let k = 0; k < 3; k++) sd[k] += (img.data[i + k] - mean[k]) ** 2;
  }
  sd[0] = Math.sqrt(sd[0] / n);
  sd[1] = Math.sqrt(sd[1] / n);
  sd[2] = Math.sqrt(sd[2] / n);
  return { mean, sd };
}

/**
 * Casamento de tom: leva a textura do pack para a paleta do tile de referência
 * do jogo (média e desvio por canal). É o que faz o pack "falar a mesma
 * língua": o desenho (tufos, grão, ondas) é do pack; a cor é a do jogo.
 *
 *   out = (v − média_pack) · min(sd_ref/sd_pack, 1.35) + média_ref
 *
 * O desvio do pack é maior (textura mais dura), então o fator é limitado para
 * não reintroduzir o ruído que a redução para 32 px já suavizou.
 */
export function matchTone(img: RGBAImage, ref: { mean: [number, number, number]; sd: [number, number, number] }): RGBAImage {
  const src = stats(img);
  const o: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const gain: [number, number, number] = [1, 1, 1];
  for (let k = 0; k < 3; k++) {
    // piso 0.5: sem ele a textura do pack era praticamente apagada (o desvio
    // dele é ~5× o do tile do jogo) e o chão virava uma cor chapada
    gain[k] = src.sd[k] > 0.5 ? Math.max(0.72, Math.min(1.35, ref.sd[k] / src.sd[k])) : 1;
  }
  for (let i = 0; i < o.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = (o.data[i + k] - src.mean[k]) * gain[k] + ref.mean[k];
      o.data[i + k] = Math.max(0, Math.min(255, v));
    }
    o.data[i + 3] = 255;
  }
  return o;
}

/**
 * Harmonious = pastel e de baixo contraste. Aqui o tile do pack é aproximado
 * desse idioma:
 *  - dessatura 14% (mistura com a luminância);
 *  - comprime o contraste em 16% em torno da média do próprio tile;
 *  - quantiza em `levels` degraus (pixel art, sem gradiente fotográfico).
 * O desenho (tufos de grama, grão da areia, ondas) continua visível — o que
 * muda é a "força" da cor, que é o que fazia o pack brigar com o resto.
 */
export function harmonize(img: RGBAImage, opts: { saturation?: number; contrast?: number; levels?: number } = {}): RGBAImage {
  const sat = opts.saturation ?? 0.86;
  const contrast = opts.contrast ?? 0.84;
  const levels = opts.levels ?? 12;
  const o: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  let mean = 0;
  for (let i = 0; i < o.data.length; i += 4) mean += (o.data[i] + o.data[i + 1] + o.data[i + 2]) / 3;
  mean /= o.data.length / 4;
  const step = 255 / (levels - 1);
  for (let i = 0; i < o.data.length; i += 4) {
    const l = 0.299 * o.data[i] + 0.587 * o.data[i + 1] + 0.114 * o.data[i + 2];
    for (let k = 0; k < 3; k++) {
      // dessaturação
      let v = o.data[i + k] + (l - o.data[i + k]) * (1 - sat);
      // compressão de contraste em torno da média
      v = mean + (v - mean) * contrast;
      // quantização
      v = Math.round(v / step) * step;
      o.data[i + k] = Math.max(0, Math.min(255, v));
    }
    o.data[i + 3] = 255;
  }
  return o;
}

/** quadro "fundo": mesma arte, mais escura e azulada (profundidade da água) */
function deepen(img: RGBAImage): RGBAImage {
  const o: RGBAImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < o.data.length; i += 4) {
    o.data[i] = Math.max(0, o.data[i] * 0.62);
    o.data[i + 1] = Math.max(0, o.data[i + 1] * 0.74);
    o.data[i + 2] = Math.max(0, o.data[i + 2] * 0.9);
    o.data[i + 3] = 255;
  }
  return o;
}

/**
 * Um tile de CHÃO plano é uma textura uniforme: não tem bloco de terra escuro
 * embaixo (tiles em 2,5D das pranchas) nem "ilha" com borda. Mede-se a fração
 * de pixels escuros na faixa inferior e a variação de luminância por faixa:
 * chão plano tem pouca coisa escura e variação parecida em cima e embaixo.
 */
function isFlatGroundImage(t: RGBAImage): boolean {
  let dark = 0;
  let darkBottom = 0;
  const bandMean: number[] = [];
  for (let by = 0; by < 4; by++) {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor((by * t.height) / 4); y < Math.floor(((by + 1) * t.height) / 4); y++) {
      for (let x = 0; x < t.width; x++) {
        const i = (y * t.width + x) * 4;
        const l = 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
        if (l < 95) {
          dark++;
          if (by === 3) darkBottom++;
        }
        sum += l;
        n++;
      }
    }
    bandMean.push(sum / n);
  }
  const total = t.width * t.height;
  // 2,5D: bloco escuro grande na base; ilha: borda escura em toda a volta
  if (darkBottom / (t.width * (t.height / 4)) > 0.22) return false;
  if (dark / total > 0.18) return false;
  // contraste vertical: chão plano não "clareia" muito de cima para baixo
  const spread = Math.max(...bandMean) - Math.min(...bandMean);
  if (spread >= 46) return false;

  // tile de praia (metade areia, metade mar): muito azul/ciano não é chão
  let wet = 0;
  for (let i = 0; i < t.data.length; i += 4) {
    const r = t.data[i];
    const g = t.data[i + 1];
    const b = t.data[i + 2];
    if (b > r + 55 && b > g + 25 && b > 110) wet++;
  }
  if (wet / total > 0.12) return false;
  // moldura: chão em tile não tem borda (a borda viraria uma grade na tela)
  let ring = 0;
  let ringN = 0;
  let core = 0;
  let coreN = 0;
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const i = (y * t.width + x) * 4;
      const l = 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
      const edge = x === 0 || y === 0 || x === t.width - 1 || y === t.height - 1;
      if (edge) {
        ring += l;
        ringN++;
      } else {
        core += l;
        coreN++;
      }
    }
  }
  if (Math.abs(ring / ringN - core / coreN) >= 26) return false;

  // uniformidade por quadrante: tile de transição (areia + mar, grama + terra)
  // tem quadrantes muito diferentes — no mundo isso viraria um xadrez
  const quad: number[] = [0, 0, 0, 0];
  const qn: number[] = [0, 0, 0, 0];
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const i = (y * t.width + x) * 4;
      const q = (y < t.height / 2 ? 0 : 2) + (x < t.width / 2 ? 0 : 1);
      quad[q] += 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
      qn[q]++;
    }
  }
  const qm = quad.map((v, i) => v / qn[i]);
  return Math.max(...qm) - Math.min(...qm) < 30;
}

type Tuple = { box: TileBox; img: RGBAImage };

/**
 * Quanto um tile é "chão plano" (0 = perfeito). Penaliza borda/moldura,
 * metade de cima diferente da de baixo (tile de transição), água e blocos
 * escuros. Escolher por PONTUAÇÃO é mais robusto do que um limite binário:
 * a prancha de praia, por exemplo, tem só 1 tile realmente plano.
 */
function flatnessScore(t: RGBAImage, wetPenalty = 400): number {
  const total = t.width * t.height;
  const lum = (i: number) => 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
  let ring = 0, ringN = 0, core = 0, coreN = 0, dark = 0, wet = 0;
  const quad = [0, 0, 0, 0], qn = [0, 0, 0, 0];
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const i = (y * t.width + x) * 4;
      const l = lum(i);
      if (l < 95) dark++;
      if (t.data[i + 2] > t.data[i] + 55 && t.data[i + 2] > t.data[i + 1] + 25 && t.data[i + 2] > 110) wet++;
      const edge = x === 0 || y === 0 || x === t.width - 1 || y === t.height - 1;
      if (edge) { ring += l; ringN++; } else { core += l; coreN++; }
      const q = (y < t.height / 2 ? 0 : 2) + (x < t.width / 2 ? 0 : 1);
      quad[q] += l;
      qn[q]++;
    }
  }
  const qm = quad.map((v, i) => v / qn[i]);
  return (
    Math.abs(ring / ringN - core / coreN) * 2 +
    (Math.max(...qm) - Math.min(...qm)) * 1.5 +
    (dark / total) * 200 +
    (wet / total) * wetPenalty
  );
}

/**
 * Melhores tiles de uma faixa, em ordem de "planura".
 * `wetPenalty` é 0 para a prancha de água (lá o azul É o conteúdo) e alto para
 * chão (um tile de praia meio mar não pode virar chão).
 * `maxScore` é a régua de aceitação: varia por prancha porque a de neve tem
 * bisel claro na borda (score naturalmente mais alto).
 */
function flatTiles(
  img: RGBAImage,
  row: number,
  limit: number,
  maxScore = 26,
  wetPenalty = 400,
): Tuple[] {
  const rows = tileRows(img);
  const scored = (rows[row] ?? [])
    .map((box) => {
      const t = harmonize(downscale(box, img));
      return { box, img: t, score: flatnessScore(t, wetPenalty) };
    })
    .sort((a, b) => a.score - b.score);
  return scored.filter((s) => s.score <= maxScore).slice(0, limit).map(({ box, img }) => ({ box, img }));
}

// --- empacotamento -----------------------------------------------------------
function pack(tiles: RGBAImage[], name: string): { img: RGBAImage; rects: Array<[number, number, number, number]> } {
  const img: RGBAImage = { width: TILE * tiles.length, height: TILE, data: new Uint8ClampedArray(TILE * tiles.length * TILE * 4) };
  const rects: Array<[number, number, number, number]> = [];
  tiles.forEach((t, k) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const si = (y * t.width + x) * 4;
        const di = (y * img.width + k * TILE + x) * 4;
        img.data[di] = t.data[si];
        img.data[di + 1] = t.data[si + 1];
        img.data[di + 2] = t.data[si + 2];
        img.data[di + 3] = 255;
      }
    }
    rects.push([k * TILE, 0, TILE, TILE]);
  });
  void name;
  return { img, rects };
}

function metrics(t: RGBAImage) {
  let dark = 0, darkBottom = 0, wet = 0, ring = 0, ringN = 0, core = 0, coreN = 0;
  const bandMean: number[] = [];
  for (let by = 0; by < 4; by++) {
    let sum = 0, n = 0;
    for (let y = Math.floor((by * t.height) / 4); y < Math.floor(((by + 1) * t.height) / 4); y++) {
      for (let x = 0; x < t.width; x++) {
        const i = (y * t.width + x) * 4;
        const l = 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
        if (l < 95) { dark++; if (by === 3) darkBottom++; }
        sum += l; n++;
      }
    }
    bandMean.push(sum / n);
  }
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    const i = (y * t.width + x) * 4;
    const r = t.data[i], g = t.data[i+1], b = t.data[i+2];
    const l = 0.299*r + 0.587*g + 0.114*b;
    if (b > r + 55 && b > g + 25 && b > 110) wet++;
    const edge = x === 0 || y === 0 || x === t.width-1 || y === t.height-1;
    if (edge) { ring += l; ringN++; } else { core += l; coreN++; }
  }
  const total = t.width*t.height;
  return {
    dark: dark/total, darkBottom: darkBottom/(t.width*(t.height/4)), wet: wet/total,
    spread: Math.max(...bandMean)-Math.min(...bandMean), ring: Math.abs(ring/ringN - core/coreN),
  };
}

function main(): void {
  const zip = readZip(readFileSync(join(ROOT, PACK_ZIP)));
  const board = (file: string): RGBAImage => {
    const key = [...zip.keys()].find((k) => k.endsWith(file));
    if (!key) throw new Error(`prancha ausente no pack: ${file}`);
    return decodePNG(zip.get(key)!);
  };

  // referências de tom: os tiles ATUAIS do jogo (é a paleta que queremos casar)
  const gameTiles = decodePNG(readFileSync(join(ROOT, 'assets/Miscellaneous/tiles.png')));
  const gameWater = decodePNG(readFileSync(join(ROOT, 'assets/Water/WaterTilesAnimated/Ocean_Water_60%_Anim.png')));
  const refCrop = (img: RGBAImage, x: number, y: number): { mean: [number, number, number]; sd: [number, number, number] } => {
    const c: RGBAImage = { width: TILE, height: TILE, data: new Uint8ClampedArray(TILE * TILE * 4) };
    for (let yy = 0; yy < TILE; yy++) {
      for (let xx = 0; xx < TILE; xx++) {
        const si = ((y + yy) * img.width + (x + xx)) * 4;
        const di = (yy * TILE + xx) * 4;
        c.data[di] = img.data[si];
        c.data[di + 1] = img.data[si + 1];
        c.data[di + 2] = img.data[si + 2];
        c.data[di + 3] = 255;
      }
    }
    return stats(c);
  };
  const REF = {
    grass: refCrop(gameTiles, 96, 32),
    dirt: refCrop(gameTiles, 160, 32),
    // areia: o jogo NÃO tem tile de areia (usa terra + véu claro no render).
    // A referência é a cor final que o jogador vê: terra clareada pelo véu
    // (226,199,138 a 42%) — sem isso o casamento de tom deixava a praia laranja.
    sand: (() => {
      const base = refCrop(gameTiles, 160, 32);
      const t = 0.42;
      const mix = (v: number, target: number) => v * (1 - t) + target * t;
      return {
        mean: [mix(base.mean[0], 226), mix(base.mean[1], 199), mix(base.mean[2], 138)] as [number, number, number],
        sd: [base.sd[0] * 0.75, base.sd[1] * 0.75, base.sd[2] * 0.75] as [number, number, number],
      };
    })(),
    snow: refCrop(gameTiles, 32, 32),
    water: refCrop(gameWater, 32, 32),
  };
  console.log(`referências (jogo): grama ${REF.grass.mean.map((v) => v.toFixed(0)).join(',')} | água ${REF.water.mean.map((v) => v.toFixed(0)).join(',')}`);

  const grassBoard = board('1. Grass and dirt.png');
  const waterBoard = board('2. Water.png');
  const snowBoard = board('7. Snow.png');
  const beachBoard = board('9. Beach.png');
  const desertBoard = board('8. Desert.png');

  if (process.argv.includes('--score')) {
    for (const [name, b] of [['grama', grassBoard], ['neve', snowBoard], ['areia', beachBoard], ['deserto', desertBoard], ['água', waterBoard]] as const) {
      const rows = tileRows(b);
      console.log(`== ${name}`);
      rows.slice(0, 2).forEach((boxes, r) => boxes.forEach((box, c) => {
        const t = harmonize(downscale(box, b));
        console.log(`  r${r}c${c}: score ${flatnessScore(t).toFixed(1)}`);
      }));
    }
    return;
  }
  if (process.argv.includes('--debug')) {
    for (const [name, b, rows] of [
      ['grama', grassBoard, 2], ['areia', beachBoard, 2], ['neve', snowBoard, 1], ['água', waterBoard, 1],
    ] as const) {
      const t = tileRows(b);
      console.log(`== ${name}`);
      for (let r = 0; r < rows; r++) {
        (t[r] ?? []).forEach((box, c) => {
          const m = metrics(harmonize(downscale(box, b)));
          console.log(`  r${r}c${c}: dark ${m.dark.toFixed(2)} base ${m.darkBottom.toFixed(2)} wet ${m.wet.toFixed(2)} spread ${m.spread.toFixed(0)} ring ${m.ring.toFixed(0)}`);
        });
      }
    }
    return;
  }
  const gRows = tileRows(grassBoard);
  const wRows = tileRows(waterBoard);
  const sRows = tileRows(snowBoard);
  const bRows = tileRows(beachBoard);
  console.log(
    `pranchas: grama ${gRows[0]?.length ?? 0} tiles/linha, água ${wRows[0]?.length ?? 0}, ` +
    `neve ${sRows[0]?.length ?? 0}, areia ${bRows[0]?.length ?? 0}`,
  );

  const groundTiles: Array<[string, RGBAImage]> = [];
  // grama: variações planas da primeira faixa (a com flores é escolhida à parte)
  const grassFlat = flatTiles(grassBoard, 0, 4);
  for (const t of grassFlat) groundTiles.push(['grass', matchTone(t.img, REF.grass)]);
  // terra: variações planas da segunda faixa
  for (const t of flatTiles(grassBoard, 1, 2)) groundTiles.push(['dirt', matchTone(t.img, REF.dirt)]);
  // areia: melhores tiles planos da praia e do deserto (transições ficam fora)
  const sand = [...flatTiles(beachBoard, 0, 2, 22), ...flatTiles(desertBoard, 0, 2, 22)].slice(0, 2);
  for (const t of sand) groundTiles.push(['sand', matchTone(t.img, REF.sand)]);
  // neve: primeira faixa (as demais são bordas/árvores)
  // neve: a prancha tem bisel na borda (score mais alto por natureza), então
  // a régua é mais folgada — mas ainda escolhe o tile mais plano da faixa
  for (const t of flatTiles(snowBoard, 0, 1, 80)) groundTiles.push(['snow', matchTone(t.img, REF.snow)]);
  // grama com flores silvestres: o tile "florido" da prancha de grama
  {
    const rows = tileRows(grassBoard);
    const boxes = rows[0] ?? [];
    for (const b of boxes) {
      const t = harmonize(downscale(b, grassBoard));
      if (!isFlatGroundImage(t)) continue;
      // flores = pixels rosados/amarelos saturados (o resto da grama é verde)
      let flowers = 0;
      for (let i = 0; i < t.data.length; i += 4) {
        const r = t.data[i];
        const g = t.data[i + 1];
        const b = t.data[i + 2];
        if (r > 150 && b > 130 && r > g + 25) flowers++;
      }
      if (flowers > 12) {
        groundTiles.push(['grass_flowers', matchTone(t, REF.grass)]);
        break;
      }
    }
  }

  const ground = pack(groundTiles.map(([, img]) => img), 'ground');
  mkdirSync(join(ROOT, 'assets/Ground'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/Ground/pack_tiles.png'), encodePNG(ground.img));

  const byKind: Record<string, number[]> = {};
  groundTiles.forEach(([kind], i) => {
    (byKind[kind] ??= []).push(i);
  });
  writeFileSync(
    join(ROOT, 'assets/Ground/pack_tiles.json'),
    `${JSON.stringify(
      {
        tile: TILE,
        source: `${PACK_ZIP} → 1. Grass and dirt.png, 7. Snow.png, 9. Beach.png`,
        pipeline: 'área 32px → harmonize(sat 0.86, contraste 0.84, 12 níveis)',
        cells: Object.fromEntries(groundTiles.map(([kind], i) => [i, kind])),
        kinds: byKind,
      },
      null,
      2,
    )}\n`,
  );

  // água: 4 quadros (a folha do pack já traz a animação da superfície)
  const midFrames: RGBAImage[] = [];
  // água: 4 quadros da faixa de superfície (tiles planos; margem/cachoeira ficam fora)
  for (const t of flatTiles(waterBoard, 0, 4, 1e9, 0)) midFrames.push(matchTone(t.img, REF.water));
  while (midFrames.length < 4) {
    midFrames.push(midFrames[midFrames.length - 1] ?? matchTone(harmonize(downscale(wRows[0][0], waterBoard)), REF.water));
  }
  midFrames.length = 4;
  const mid = pack(midFrames, 'water');
  const deep = pack(midFrames.map(deepen), 'water_deep');
  mkdirSync(join(ROOT, 'assets/Water'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/Water/pack_water.png'), encodePNG(mid.img));
  writeFileSync(join(ROOT, 'assets/Water/pack_water_deep.png'), encodePNG(deep.img));
  writeFileSync(
    join(ROOT, 'assets/Water/pack_water.json'),
    `${JSON.stringify(
      {
        tile: TILE,
        frames: 4,
        source: `${PACK_ZIP} → 2. Water.png (linha de superfície)`,
        deep: 'mesma arte com deepen() (0.62/0.74/0.90)',
        mid: mid.rects,
        deepRects: deep.rects,
      },
      null,
      2,
    )}\n`,
  );

  const luma = (img: RGBAImage) => {
    const l: number[] = [];
    for (let i = 0; i < img.data.length; i += 4) l.push((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3);
    const m = l.reduce((a, b) => a + b, 0) / l.length;
    return { mean: m, sd: Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length) };
  };
  const g0 = luma(groundTiles[0][1]);
  const w0 = luma(midFrames[0]);
  console.log(
    `grama 32px: média ${g0.mean.toFixed(1)} desvio ${g0.sd.toFixed(1)} | água: média ${w0.mean.toFixed(1)} desvio ${w0.sd.toFixed(1)}`,
  );
  console.log(`gravado assets/Ground/pack_tiles.png (${ground.img.width}×${ground.img.height})`);
  console.log(`gravado assets/Water/pack_water.png e pack_water_deep.png (${mid.img.width}×${mid.img.height})`);
}

// só roda quando executado direto (o teste importa `readZip`/`harmonize`)
if (process.argv[1] && process.argv[1].endsWith('extract-pack-tiles.ts')) main();
