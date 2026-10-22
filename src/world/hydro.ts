/**
 * Hidrologia determinística e independente de ordem de carregamento.
 *
 * Modelo (simplificado, estável e documentado):
 *  - D8 (oito direções) sobre o potencial hidráulico head = max(elevação, nível d'água de lago).
 *  - Área de contribuição (acumulação) calculada em múltiplas escalas: um passo
 *    grosso cobre uma região ampla e "semeia" o anel externo da janela fina, de
 *    modo que um rio que nasce a centenas de células de distância continua sendo
 *    o mesmo rio em todos os chunks que atravessa.
 *  - Lagos: células cuja elevação fica abaixo do lençol freático climático.
 *  - Rios: largura/profundidade contínuas em função da acumulação e declividade
 *    (sem flips binários que poderiam aparecer nas bordas de chunk).
 */
import type { WorldConfig } from '../core/config';
import type { WorldFields, DeltaAt } from './fields';
import { clamp, smoothstep } from '../core/rng';

export const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

export interface HydroSolution {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** direção de fluxo D8 (0..7) ou -1 */
  flowDir: Int8Array;
  /** área de contribuição em células equivalentes finas */
  acc: Float32Array;
  /** lâmina d'água parada/lago + canal de rio (m) */
  waterDepth: Float32Array;
  /** 1 = lago, 2 = rio/córrego, 3 = ambos */
  waterKind: Uint8Array;
  /** elevação usada (com deltas), m */
  head: Float32Array;
}

const COARSE = 8;

export function solveHydrology(
  fields: WorldFields,
  cfg: WorldConfig,
  deltaAt: DeltaAt,
  climateWetness: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  margin = 28,
): HydroSolution {
  const mw = w + margin * 2;
  const mh = h + margin * 2;
  const fx0 = x0 - margin;
  const fy0 = y0 - margin;

  // --- elevação fina ---
  const elev = new Float32Array(mw * mh);
  const wt = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const gx = fx0 + x, gy = fy0 + y;
      const e = fields.elevation(gx, gy, deltaAt);
      elev[y * mw + x] = e;
      wt[y * mw + x] = fields.waterTable(gx, gy, climateWetness) * cfg.elevationRange;
    }
  }

  // --- passo grosso: região ampla para capturar bacias distantes ---
  const cm = Math.ceil(margin * 1.5 / COARSE) + 2;
  const cw = Math.ceil(mw / COARSE) + cm * 2;
  const ch = Math.ceil(mh / COARSE) + cm * 2;
  const cx0 = fx0 - cm * COARSE;
  const cy0 = fy0 - cm * COARSE;
  const cHead = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const gx = cx0 + x * COARSE + COARSE / 2;
      const gy = cy0 + y * COARSE + COARSE / 2;
      const e = fields.elevation(gx, gy, deltaAt);
      const wtl = fields.waterTable(gx, gy, climateWetness) * cfg.elevationRange;
      cHead[y * cw + x] = Math.max(e, wtl);
    }
  }
  const cAcc = new Float32Array(cw * ch);
  const cDir = new Int8Array(cw * ch).fill(-1);
  flowAndAccumulate(cHead, cAcc, cDir, cw, ch, COARSE * COARSE, null);

  // --- semente de montante no anel externo da janela fina ---
  const seed = new Float32Array(mw * mh);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const d = cDir[y * cw + x];
      if (d < 0) continue;
      const nx = x + DX8[d], ny = y + DY8[d];
      const insideSrc = x >= cm && y >= cm && x < cw - cm && y < ch - cm;
      const insideDst = nx >= cm && ny >= cm && nx < cw - cm && ny < ch - cm;
      if (insideSrc || !insideDst) continue; // só transições de fora para dentro
      // distribui a montante grossa pelas células finas da célula grossa de destino
      const baseX = (cx0 + nx * COARSE + COARSE / 2) - fx0;
      const baseY = (cy0 + ny * COARSE + COARSE / 2) - fy0;
      const amount = cAcc[y * cw + x] / (COARSE * COARSE);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const px = baseX + ox, py = baseY + oy;
          if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
          seed[py * mw + px] += amount * (ox === 0 && oy === 0 ? 0.4 : 0.0667);
        }
      }
    }
  }

  // --- passo fino ---
  const head = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) head[i] = Math.max(elev[i], wt[i]);
  const acc = new Float32Array(mw * mh);
  const dir = new Int8Array(mw * mh).fill(-1);
  flowAndAccumulate(head, acc, dir, mw, mh, 1, seed);

  // --- recorte da janela útil + classificação ---
  const out: HydroSolution = {
    x0, y0, w, h,
    flowDir: new Int8Array(w * h),
    acc: new Float32Array(w * h),
    waterDepth: new Float32Array(w * h),
    waterKind: new Uint8Array(w * h),
    head: new Float32Array(w * h),
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y + margin) * mw + (x + margin);
      const di = y * w + x;
      out.flowDir[di] = dir[si];
      out.acc[di] = acc[si];
      out.head[di] = head[si];
      const lake = elev[si] < wt[si] - 0.02;
      const lakeDepth = lake ? Math.min(3.4, (wt[si] - elev[si]) * 3.0) : 0;
      // canal: profundidade contínua em função de vazão (acc) e declividade
      const stream = smoothstep(cfg.streamThreshold * 0.6, cfg.streamThreshold * 1.3, acc[si]);
      const river = smoothstep(cfg.riverThreshold * 0.65, cfg.riverThreshold * 1.4, acc[si]);
      const channel = stream * (0.3 + 0.6 * river) * (0.6 + 0.4 * clamp(1.4 - head[si] / cfg.elevationRange, 0.4, 1));
      out.waterDepth[di] = Math.max(lakeDepth, channel);
      out.waterKind[di] = (lake ? 1 : 0) | (stream > 0.3 ? 2 : 0);
      // margens: alarga o canal para células vizinhas de cota próxima (rios de 2-3 células)
      if (stream > 0.6) {
        for (let d8 = 0; d8 < 8; d8 += 2) {
          const bx = x + DX8[d8], by = y + DY8[d8];
          if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
          const bi = by * w + bx;
          if (elev[bi] - elev[si] < 0.9 && elev[bi] >= wt[bi] - 0.02) {
            const bank = 0.34 * stream;
            if (out.waterDepth[bi] < bank) out.waterDepth[bi] = bank;
            out.waterKind[bi] |= 2;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Roteamento D8 + acumulação por ordem topológica (head decrescente).
 * `initArea` é a área própria de cada célula; `seed` adiciona montante externa.
 */
export function flowAndAccumulate(
  head: Float32Array,
  acc: Float32Array,
  dir: Int8Array,
  w: number,
  h: number,
  initArea: number,
  seed: Float32Array | null,
): void {
  const n = w * h;
  for (let i = 0; i < n; i++) acc[i] = initArea + (seed ? seed[i] * initArea : 0);
  // ordena índices por head decrescente (radix-ish via sort simples; janelas pequenas)
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // ordenação por bucket quantizado evita O(n log n) pesado e é determinística
  const buckets = 1024;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (head[i] < min) min = head[i];
    if (head[i] > max) max = head[i];
  }
  const range = max - min || 1;
  const counts = new Int32Array(buckets + 1);
  const bOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const b = buckets - Math.floor(((head[i] - min) / range) * buckets);
    bOf[i] = b;
    counts[b]++;
  }
  const starts = new Int32Array(buckets + 1);
  for (let b = 0; b < buckets; b++) starts[b + 1] = starts[b] + counts[b];
  const cursor = starts.slice();
  for (let i = 0; i < n; i++) order[cursor[bOf[i]]++] = i;

  for (let k = 0; k < n; k++) {
    const i = order[k];
    const x = i % w, y = (i / w) | 0;
    let best = -1, bestHead = head[i] - 1e-9;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nh = head[ny * w + nx];
      // diagonal custa sqrt(2) de distância → exige desnível maior (estabilidade)
      const penalty = d % 2 === 1 ? 0.0005 : 0;
      if (nh < bestHead - penalty) {
        bestHead = nh;
        best = d;
      }
    }
    dir[i] = best;
    if (best >= 0) {
      const nx = x + DX8[best], ny = y + DY8[best];
      acc[ny * w + nx] += acc[i];
    }
  }
}
