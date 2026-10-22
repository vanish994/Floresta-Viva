import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { chunkKeyStr } from '../src/core/coords';

describe('chunks: streaming, desempenho e memória', () => {
  it('gera o mundo ao redor do personagem com orçamento por frame', () => {
    const w = new World({ seed: 21 });
    w.requestChunks(0, 0, 0, 0);
    let made = 0;
    for (let i = 0; i < 5 && w.chunks.size < 49; i++) made += w.pumpGeneration(2).length;
    expect(made).toBeLessThanOrEqual(10); // orçamento respeitado (2 por chamada)
    for (let i = 0; i < 60 && w.chunks.size < 49; i++) w.pumpGeneration(2);
    expect(w.chunks.size).toBe(49);
  });

  it('tempo de geração por chunk fica dentro do orçamento (< 60 ms)', () => {
    const w = new World({ seed: 22 });
    w.requestChunks(64 * 32, 64 * 32, 0, 0);
    const t0 = Date.now();
    const made = w.pumpGeneration(25);
    const per = (Date.now() - t0) / made.length;
    expect(per).toBeLessThan(60);
  });

  it('chunks distantes são descarregados e a memória fica limitada', () => {
    const w = new World({ seed: 23 });
    const cellPx = w.cfg.simCellTiles * w.cfg.tileSize;
    const max = 2 * (w.cfg.loadRadiusChunks + w.cfg.unloadMarginChunks) + 1;
    for (let i = 0; i < 12; i++) {
      w.requestChunks(i * 40 * cellPx, i * 7 * cellPx, 10, 0);
      w.pumpGeneration(100);
    }
    expect(w.chunks.size).toBeLessThanOrEqual(max * max);
    // o chunk inicial foi descarregado após viajar bastante
    expect(w.chunks.has(chunkKeyStr(0, 0))).toBe(false);
  });

  it('lookahead carrega chunks à frente do movimento', () => {
    const w = new World({ seed: 24 });
    const cellPx = w.cfg.simCellTiles * w.cfg.tileSize;
    w.requestChunks(0, 0, 200, 0);
    w.pumpGeneration(200);
    const r = w.cfg.loadRadiusChunks;
    const ahead = w.getChunk(r + 1, 0);
    const behind = w.getChunk(-r - 2, 0);
    expect(ahead).toBeDefined();
    expect(behind).toBeUndefined();
  });

  it('simulação em múltiplas frequências avança relógios independentes', () => {
    const w = new World({ seed: 25 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const c = w.getChunk(0, 0)!;
    const w0 = c.lastWaterHour, b0 = c.lastBioHour, e0 = c.lastErosionHour;
    // 30 h de jogo: água (0.5 h), bio (3 h) e erosão (24 h) devem rodar
    for (let i = 0; i < 30; i++) w.update(60000);
    expect(c.lastWaterHour).toBeGreaterThan(w0);
    expect(c.lastBioHour).toBeGreaterThan(b0);
    expect(c.lastErosionHour).toBeGreaterThan(e0);
    expect(c.lastWaterHour - w0).toBeGreaterThan(c.lastErosionHour - e0);
  });
});
