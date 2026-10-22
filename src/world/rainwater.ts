/**
 * Água de chuva dinâmica: transforma chuva intensa em água superficial visível.
 *
 * A hidrologia permanente continua vindo do gerador. Este passo acrescenta
 * água temporária na mesma grade do Chunk e permite que tempestades fortes
 * façam rios/canais transbordarem para as células mais baixas ao redor.
 * Quando a chuva para, o stepWater existente continua responsável por
 * infiltração e evaporação da água temporária.
 */
import type { WorldConfig } from '../core/config';
import type { Climate } from './climate';
import type { Chunk } from './chunk';
import { DX8, DY8 } from './hydro';

const STORM_START = 0.55;
const FLOOD_LEVEL = 0.16;
const LAKE_OVERFLOW_LEVEL = 0.42;
const MAX_TEMPORARY_DEPTH = 1.6;

export function stepRainwater(chunk: Chunk, cfg: WorldConfig, climate: Climate, hours: number, worldDay: number): void {
  const rain = climate.rainIntensity(worldDay);
  if (rain < STORM_START) return;

  const n = chunk.n;
  const intensity = rain * hours;
  const storm = (rain - STORM_START) / (1 - STORM_START);
  const added = new Float32Array(n * n);

  // Chuva forte cria lâmina superficial e concentra mais água nas baixadas.
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const flow = chunk.flowDir[i];
      const kind = chunk.waterKind[i];

      if (flow < 0) {
        // Depressões acumulam água e podem virar lagoas temporárias.
        added[i] += intensity * (0.055 + storm * 0.035);
      } else {
        // O caminho natural de escoamento recebe uma lâmina fina.
        added[i] += intensity * (0.012 + storm * 0.018);
      }

      // Canais e lagoas existentes recebem prioridade durante a tempestade.
      if (chunk.waterDepth[i] > FLOOD_LEVEL) {
        added[i] += intensity * (0.015 + storm * 0.025);
      }
      if (kind & 1) added[i] += intensity * storm * 0.025;
      if (kind & 2) added[i] += intensity * storm * 0.035;
    }
  }

  // Primeira concentração: uma parte do escoamento segue a direção de fluxo.
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const flow = chunk.flowDir[i];
      if (flow < 0) continue;
      const nx = lx + DX8[flow], ny = ly + DY8[flow];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = chunk.cellIdx(nx, ny);
      added[j] += intensity * (0.018 + storm * 0.028);
    }
  }

  for (let i = 0; i < n * n; i++) {
    if (added[i] <= 0) continue;
    chunk.waterDepth[i] = Math.min(MAX_TEMPORARY_DEPTH, chunk.waterDepth[i] + added[i]);
  }

  // Enchente: durante a tempestade, água acima do nível de retenção escapa
  // para vizinhos mais baixos. Isso alarga visualmente rios e faz lagoas
  // transbordarem para o terreno ao redor sem transformar essas células em
  // corpos d'água permanentes.
  if (storm > 0.05) {
    const overflow = new Float32Array(n * n);

    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const kind = chunk.waterKind[i];
        const threshold = (kind & 1) ? LAKE_OVERFLOW_LEVEL : (kind & 2) ? FLOOD_LEVEL : FLOOD_LEVEL;
        const excess = chunk.waterDepth[i] - threshold;
        if (excess <= 0) continue;

        let best = -1;
        let bestDrop = 0;
        for (let d = 0; d < 8; d++) {
          const nx = lx + DX8[d], ny = ly + DY8[d];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = chunk.cellIdx(nx, ny);
          const drop = chunk.elev[i] - chunk.elev[j];
          if (drop > bestDrop) {
            bestDrop = drop;
            best = j;
          }
        }

        // Se não houver vizinho mais baixo, a direção de fluxo natural ainda
        // pode receber parte do excesso em uma área plana.
        if (best < 0) {
          const flow = chunk.flowDir[i];
          if (flow >= 0) {
            const nx = lx + DX8[flow], ny = ly + DY8[flow];
            if (nx >= 0 && ny >= 0 && nx < n && ny < n) best = chunk.cellIdx(nx, ny);
          }
        }

        if (best >= 0) overflow[best] += Math.min(excess * (0.16 + storm * 0.22), 0.24);
      }
    }

    for (let i = 0; i < n * n; i++) {
      if (overflow[i] <= 0) continue;
      chunk.waterDepth[i] = Math.min(MAX_TEMPORARY_DEPTH, chunk.waterDepth[i] + overflow[i]);
    }
  }

  void cfg;
  chunk.dirty = true;
}
