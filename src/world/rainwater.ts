/**
 * Água de chuva dinâmica: transforma chuva intensa em água superficial visível.
 *
 * A hidrologia permanente continua vindo do gerador. Este passo só acrescenta
 * água temporária quando a chuva é forte, usando a mesma grade e direção de
 * fluxo já existentes no Chunk. Quando a chuva para, o stepWater existente
 * continua responsável por infiltração e evaporação.
 */
import type { WorldConfig } from '../core/config';
import type { Climate } from './climate';
import type { Chunk } from './chunk';
import { DX8, DY8 } from './hydro';

export function stepRainwater(chunk: Chunk, cfg: WorldConfig, climate: Climate, hours: number, worldDay: number): void {
  const rain = climate.rainIntensity(worldDay);
  if (rain < 0.55) return;

  const n = chunk.n;
  const intensity = rain * hours;
  const added = new Float32Array(n * n);

  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const flow = chunk.flowDir[i];

      // Depressões/baixadas seguram mais água e viram poças que podem crescer
      // para lagoas temporárias durante uma sequência de chuva forte.
      if (flow < 0) {
        added[i] += intensity * 0.045;
      } else {
        // Chuva forte mantém uma lâmina fina no caminho natural de escoamento.
        added[i] += intensity * 0.010;
      }

      // Uma lâmina já existente recebe mais água durante tempestades seguidas.
      if (chunk.waterDepth[i] > 0.08) added[i] += intensity * 0.012;
    }
  }

  // Propaga uma parte da chuva para jusante, formando filetes/córregos
  // conectados em vez de poças isoladas.
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const flow = chunk.flowDir[i];
      if (flow < 0) continue;
      const nx = lx + DX8[flow], ny = ly + DY8[flow];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = chunk.cellIdx(nx, ny);
      added[j] += intensity * 0.018;
    }
  }

  for (let i = 0; i < n * n; i++) {
    if (added[i] <= 0) continue;
    chunk.waterDepth[i] = Math.min(3.4, chunk.waterDepth[i] + added[i]);
  }

  // Mantém o passo determinístico e independente do FPS.
  void cfg;
  chunk.dirty = true;
}
