/**
 * Gera os sprites de frutos, sementes e insetos do ecossistema em pixel art
 * (32×32 compatível com o Harmonious): sem antialiasing, transparência real e
 * paleta natural. Determinístico — rodar de novo produz o mesmo arquivo.
 *
 * Uso: npx tsx tools/gen-eco-sprites.ts
 *
 * Saída:
 *   assets/Fruits/fruits.png    grade 16×16: frutos verdes e maduros
 *   assets/Fruits/seeds.png     grade 8×8: sementes
 *   assets/Insects/insects.png  grade 12×12: abelha, borboleta, joaninha, lagarta
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function blank(w: number, h: number): RGBAImage {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function px(img: RGBAImage, x: number, y: number, c: RGB, a = 255): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  // "over" simples (o pixel superior vence quando opaco)
  if (a >= 255) {
    img.data[i] = c[0];
    img.data[i + 1] = c[1];
    img.data[i + 2] = c[2];
    img.data[i + 3] = 255;
    return;
  }
  const sa = a / 255;
  const da = img.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  img.data[i] = (c[0] * sa + img.data[i] * da * (1 - sa)) / (oa || 1);
  img.data[i + 1] = (c[1] * sa + img.data[i + 1] * da * (1 - sa)) / (oa || 1);
  img.data[i + 2] = (c[2] * sa + img.data[i + 2] * da * (1 - sa)) / (oa || 1);
  img.data[i + 3] = oa * 255;
}

/** elipse pixelada com sombreado em 3 tons (escuro/medio/claro) */
function blob(
  img: RGBAImage,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dark: RGB,
  mid: RGB,
  light: RGB,
  offset = { x: 0, y: 0 },
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / (rx + 0.001);
      const ny = (y + 0.5 - cy) / (ry + 0.001);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      // luz vem de cima-esquerda
      const lit = -nx * 0.55 - ny * 0.75;
      const c = d > 0.88 ? dark : lit > 0.28 ? light : mid;
      px(img, x + offset.x, y + offset.y, c);
    }
  }
}

/** folha pequena (2–3 px) no topo do fruto */
function leaf(img: RGBAImage, x: number, y: number, up = true): void {
  const dark = hex('#2f6b34');
  const light = hex('#5c9e46');
  px(img, x, y, dark);
  px(img, x + 1, y, light);
  if (up) px(img, x + 1, y - 1, light);
}

function stem(img: RGBAImage, x: number, y: number, len = 2): void {
  const brown = hex('#6b4a2a');
  for (let k = 0; k < len; k++) px(img, x, y - k, brown);
}

type FruitPainter = (img: RGBAImage, ox: number, oy: number, ripe: boolean) => void;

const GREEN: Record<string, RGB> = {
  dark: hex('#3f6b2c'),
  mid: hex('#5c8f38'),
  light: hex('#7fae4a'),
};

function roundFruit(
  palette: { dark: string; mid: string; light: string },
  rx: number,
  ry: number,
  opts: { leaf?: boolean; stem?: boolean; spots?: boolean } = {},
): FruitPainter {
  return (img, ox, oy, ripe) => {
    const cx = ox + 8;
    const cy = oy + 9;
    const p = ripe
      ? { dark: hex(palette.dark), mid: hex(palette.mid), light: hex(palette.light) }
      : { dark: GREEN.dark, mid: GREEN.mid, light: GREEN.light };
    if (opts.stem !== false) stem(img, cx, cy - ry + 1, 2);
    blob(img, cx, cy, rx, ry, p.dark, p.mid, p.light);
    // brilho pequeno (luz da cena)
    px(img, cx - rx * 0.35, cy - ry * 0.4, p.light);
    px(img, cx - rx * 0.35 + 1, cy - ry * 0.4, p.light);
    if (opts.spots) {
      // pintas claras (morango/physalis) só quando maduro
      if (ripe) {
        for (const [dx, dy] of [
          [-2, -1],
          [1, 0],
          [-1, 2],
          [2, 2],
        ]) {
          px(img, cx + dx, cy + dy, hex('#ffe9a8'));
        }
      }
    }
    if (opts.leaf) leaf(img, cx, cy - ry - 1);
  };
}

function clusterFruit(
  palette: { dark: string; mid: string; light: string },
  count: number,
  r: number,
): FruitPainter {
  return (img, ox, oy, ripe) => {
    const p = ripe
      ? { dark: hex(palette.dark), mid: hex(palette.mid), light: hex(palette.light) }
      : { dark: GREEN.dark, mid: GREEN.mid, light: GREEN.light };
    const spots: Array<[number, number]> = [
      [-3, 3],
      [1, 4],
      [-1, 0],
      [3, 1],
      [-4, -1],
      [2, -3],
    ];
    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const [dx, dy] = spots[i];
      blob(img, ox + 8 + dx, oy + 9 + dy, r, r, p.dark, p.mid, p.light);
    }
    stem(img, ox + 8, oy + 9 - 4, 2);
    leaf(img, ox + 8, oy + 4);
  };
}

/** cacho alongado (uva/acai): bagos em triângulo invertido */
function bunchFruit(
  palette: { dark: string; mid: string; light: string },
  r: number,
): FruitPainter {
  return (img, ox, oy, ripe) => {
    const p = ripe
      ? { dark: hex(palette.dark), mid: hex(palette.mid), light: hex(palette.light) }
      : { dark: GREEN.dark, mid: GREEN.mid, light: GREEN.light };
    const rows = [3, 3, 2, 1];
    let y = oy + 4;
    for (let row = 0; row < rows.length; row++) {
      const n = rows[row];
      for (let i = 0; i < n; i++) {
        const x = ox + 8 + (i - (n - 1) / 2) * (r * 2 + 0.4);
        blob(img, x, y, r, r, p.dark, p.mid, p.light);
      }
      y += r * 1.7;
    }
    stem(img, ox + 8, oy + 3, 2);
    leaf(img, ox + 8, oy + 2);
  };
}

const FRUITS: Array<{ id: string; paint: FruitPainter }> = [
  { id: 'maca', paint: roundFruit({ dark: '#7c1f2a', mid: '#b8323c', light: '#e2565c' }, 5, 4.4, { leaf: true }) },
  { id: 'pera', paint: roundFruit({ dark: '#8a7418', mid: '#c3a52a', light: '#e4cd55' }, 4, 5, { leaf: true }) },
  { id: 'cereja', paint: clusterFruit({ dark: '#7d1420', mid: '#b32532', light: '#e04a52' }, 3, 2) },
  { id: 'ameixa', paint: roundFruit({ dark: '#4a2b56', mid: '#6d3f7d', light: '#9161a1' }, 4, 4.6, { leaf: true }) },
  { id: 'uva', paint: bunchFruit({ dark: '#3c2a58', mid: '#5a3f7a', light: '#7f5fa2' }, 2) },
  { id: 'acai', paint: bunchFruit({ dark: '#2c1d3a', mid: '#47305a', light: '#6a4c80' }, 2) },
  { id: 'amora', paint: clusterFruit({ dark: '#3a1638', mid: '#5b2453', light: '#824070' }, 4, 2) },
  { id: 'framboesa', paint: clusterFruit({ dark: '#7a1b2c', mid: '#b12b40', light: '#d94f5f' }, 4, 2) },
  { id: 'mirtilo', paint: clusterFruit({ dark: '#1f2f52', mid: '#33497a', light: '#4f6ba6' }, 3, 2) },
  { id: 'gooseberry', paint: clusterFruit({ dark: '#4d5a1e', mid: '#7d8f31', light: '#a8bb55' }, 3, 2) },
  { id: 'cassis', paint: clusterFruit({ dark: '#5a1220', mid: '#8a2233', light: '#b04150' }, 4, 2) },
  { id: 'physalis', paint: roundFruit({ dark: '#8a6416', mid: '#c1932a', light: '#e6bc57' }, 3.6, 4, { spots: true }) },
  { id: 'morango', paint: roundFruit({ dark: '#8e1c22', mid: '#c9333a', light: '#ee5a5f' }, 4, 4.2, { spots: true, leaf: true }) },
];

const INSECTS: Array<{ id: string; paint: (img: RGBAImage, ox: number, oy: number, frame: number) => void }> = [
  {
    id: 'bee',
    paint: (img, ox, oy, frame) => {
      const body = hex('#e0b52c');
      const dark = hex('#2c2418');
      const wing = hex('#dfeff7');
      const wingA = frame === 0 ? 220 : 150;
      // asas
      px(img, ox + 4, oy + 3, wing, wingA);
      px(img, ox + 5, oy + 3, wing, wingA);
      px(img, ox + 3, oy + 4, wing, wingA);
      px(img, ox + 7, oy + 4, wing, wingA);
      // corpo listrado
      for (let x = 3; x <= 8; x++) {
        const c = x % 2 === 0 ? dark : body;
        px(img, ox + x, oy + 5, c);
        px(img, ox + x, oy + 6, c);
      }
      px(img, ox + 2, oy + 5, dark);
      px(img, ox + 9, oy + 5, dark);
      px(img, ox + 8, oy + 4, hex('#f2d873'));
    },
  },
  {
    id: 'butterfly',
    paint: (img, ox, oy, frame) => {
      const wing = hex(frame === 0 ? '#e08a2e' : '#d9791f');
      const wingDark = hex('#7a3f12');
      const spot = hex('#f7e6b0');
      const spread = frame === 0 ? 1 : 0;
      for (let y = 2; y <= 7; y++) {
        for (let x = 1; x <= 10; x++) {
          const dx = Math.abs(x - 5.5);
          const dy = Math.abs(y - 5);
          if (dx < 2 + spread - dy * 0.35 && dy < 3.5) {
            px(img, ox + x, oy + y, dy > 2.4 || dx > 3.4 ? wingDark : wing);
          }
        }
      }
      px(img, ox + 5, oy + 4, spot);
      px(img, ox + 6, oy + 4, spot);
      // corpo e antenas
      for (let y = 3; y <= 8; y++) px(img, ox + 5, oy + y, hex('#2b2118'));
      px(img, ox + 4, oy + 2, hex('#2b2118'));
      px(img, ox + 6, oy + 2, hex('#2b2118'));
    },
  },
  {
    id: 'ladybug',
    paint: (img, ox, oy, frame) => {
      const red = hex('#c62b26');
      const dark = hex('#241c18');
      const legs = frame === 0 ? 0 : 1;
      blob(img, ox + 5.5, oy + 6, 3.4, 2.6, hex('#7d1714'), red, hex('#e04b3f'));
      // cabeça
      px(img, ox + 3, oy + 5, dark);
      px(img, ox + 3, oy + 6, dark);
      // divisão das asas e pintas
      for (let y = 5; y <= 8; y++) px(img, ox + 5, oy + y, dark);
      px(img, ox + 7, oy + 5, dark);
      px(img, ox + 7, oy + 7, dark);
      px(img, ox + 4, oy + 7, dark);
      // pernas
      for (let k = 0; k < 2; k++) {
        px(img, ox + 3 + k * 5, oy + 9 + legs, dark);
        px(img, ox + 4 + k * 4, oy + 2 - legs, dark);
      }
    },
  },
  {
    id: 'caterpillar',
    paint: (img, ox, oy, frame) => {
      const body = hex(frame === 0 ? '#7cb342' : '#6aa338');
      const dark = hex('#3f6b22');
      const light = hex('#a5d46a');
      for (let i = 0; i < 5; i++) {
        const y = oy + 7 - (i === 4 ? 1 : 0);
        const x = ox + 2 + i * 2;
        px(img, x, y, body);
        px(img, x, y + 1, body);
        px(img, x + 1, y, i % 2 === 0 ? light : body);
        px(img, x, y + 2, dark);
      }
      // cabeça e olho
      px(img, ox + 11, oy + 6, dark);
      px(img, ox + 12, oy + 6, hex('#1e1a12'));
      px(img, ox + 11, oy + 5, light);
    },
  },
];

const SEEDS: Array<{ id: string; color: string }> = [
  { id: 'seed_maca', color: '#6b4a2a' },
  { id: 'seed_cereja', color: '#8a3b28' },
  { id: 'seed_uva', color: '#5a4a2a' },
  { id: 'seed_baga', color: '#7a2a34' },
];

function main(): void {
  // ---- frutos: 8 colunas × N linhas de 16×16, maduros e verdes ------------
  const cols = 8;
  const rows = Math.ceil((FRUITS.length * 2) / cols);
  const fruits = blank(cols * 16, rows * 16);
  FRUITS.forEach((fruit, idx) => {
    const cell = idx * 2;
    const ox = (cell % cols) * 16;
    const oy = Math.floor(cell / cols) * 16;
    fruit.paint(fruits, ox, oy, true);
    const ox2 = ((cell + 1) % cols) * 16;
    const oy2 = Math.floor((cell + 1) / cols) * 16;
    fruit.paint(fruits, ox2, oy2, false);
  });
  mkdirSync(join(ROOT, 'assets/Fruits'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/Fruits/fruits.png'), encodePNG(fruits));

  // ---- sementes: 8×8 em linha --------------------------------------------
  const seeds = blank(SEEDS.length * 8, 8);
  SEEDS.forEach((seed, i) => {
    const ox = i * 8;
    const base = hex(seed.color);
    const light = hex('#a8845a');
    // semente = amêndoa pequena com brilho
    blob(seeds, ox + 4, 4.5, 2, 2.6, base, base, light);
    px(seeds, ox + 3, 3, light);
  });
  writeFileSync(join(ROOT, 'assets/Fruits/seeds.png'), encodePNG(seeds));

  // ---- insetos: 2 frames cada, 12×12 --------------------------------------
  const insects = blank(INSECTS.length * 2 * 12, 12);
  INSECTS.forEach((insect, idx) => {
    for (let frame = 0; frame < 2; frame++) {
      insect.paint(insects, (idx * 2 + frame) * 12, 0, frame);
    }
  });
  mkdirSync(join(ROOT, 'assets/Insects'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/Insects/insects.png'), encodePNG(insects));

  console.log(
    `frutos: ${FRUITS.length * 2} células ${cols}×${rows} (${fruits.width}×${fruits.height})\n` +
      `sementes: ${SEEDS.length} (${seeds.width}×8)\n` +
      `insetos: ${INSECTS.length} tipos × 2 frames (${insects.width}×12)`,
  );
}

main();
