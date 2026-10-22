import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { generateChunk } from '../src/world/gen';
import { hash2, seedFromString, ValueNoise } from '../src/core/rng';

const mk = (seed = 1337) => new World({ seed });

describe('determinismo por seed e coordenadas globais', () => {
  it('hashes e ruído são funções puras das entradas', () => {
    expect(hash2(7, 10, 20, 3)).toBe(hash2(7, 10, 20, 3));
    expect(hash2(7, 10, 21, 3)).not.toBe(hash2(7, 10, 20, 3));
    const n1 = new ValueNoise(99);
    const n2 = new ValueNoise(99);
    expect(n1.fbm2(3.7, -8.2, 4)).toBe(n2.fbm2(3.7, -8.2, 4));
  });

  it('seed textual é estável', () => {
    expect(seedFromString('floresta')).toBe(seedFromString('floresta'));
    expect(seedFromString('floresta')).not.toBe(seedFromString('floresta '));
  });

  it('o mesmo chunk gerado duas vezes é idêntico (todos os campos)', () => {
    const a = generateChunk(ctx(1337), 3, -2);
    const b = generateChunk(ctx(1337), 3, -2);
    expect(Array.from(a.elev)).toEqual(Array.from(b.elev));
    expect(Array.from(a.waterDepth)).toEqual(Array.from(b.waterDepth));
    expect(Array.from(a.soilType)).toEqual(Array.from(b.soilType));
    expect(a.plants.map((p) => [p.id, p.x, p.y, p.species])).toEqual(b.plants.map((p) => [p.id, p.x, p.y, p.species]));
    expect(a.decor.map((d) => [d.kind, d.x, d.y])).toEqual(b.decor.map((d) => [d.kind, d.x, d.y]));
  });

  it('a ordem de carregamento não altera o chunk (vizinhos antes ou depois)', () => {
    // mundo A: gera o chunk alvo primeiro
    const wa = mk(42);
    const targetA = generateChunk(ctxOf(wa), 5, 5);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) generateChunk(ctxOf(wa), 5 + dx, 5 + dy);
    // mundo B: gera vizinhos primeiro
    const wb = mk(42);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) generateChunk(ctxOf(wb), 5 + dx, 5 + dy);
    const targetB = generateChunk(ctxOf(wb), 5, 5);
    expect(Array.from(targetA.elev)).toEqual(Array.from(targetB.elev));
    expect(Array.from(targetA.waterDepth)).toEqual(Array.from(targetB.waterDepth));
    expect(Array.from(targetA.acc)).toEqual(Array.from(targetB.acc));
    expect(targetA.plants.length).toBe(targetB.plants.length);
  });

  it('descarregar e recarregar não muda o estado gerado', () => {
    const w = mk(777);
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const before = w.getChunk(0, 0)!;
    const snapshot = Array.from(before.elev).concat(Array.from(before.waterDepth));
    w.chunks.delete('0,0');
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const after = w.getChunk(0, 0)!;
    expect(Array.from(after.elev).concat(Array.from(after.waterDepth))).toEqual(snapshot);
  });

  it('seeds diferentes produzem mundos diferentes', () => {
    const a = generateChunk(ctx(1), 0, 0);
    const b = generateChunk(ctx(2), 0, 0);
    expect(Array.from(a.elev)).not.toEqual(Array.from(b.elev));
  });
});

function ctx(seed: number) {
  const w = new World({ seed });
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}
function ctxOf(w: World) {
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}
