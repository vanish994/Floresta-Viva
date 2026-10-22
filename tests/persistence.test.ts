import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { saveWorld, loadWorld, applyChunkDiffs, clearSave } from '../src/world/persistence';
import { generateChunk } from '../src/world/gen';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

function ctxOf(w: World) {
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}

describe('persistência', () => {
  it('save/load preserva alterações de vegetação e solo entre sessões', () => {
    const store = new MemStorage();
    const w1 = new World({ seed: 1234 });
    w1.onChunkGenerated = (c) => applyChunkDiffs(w1, c);
    w1.requestChunks(0, 0, 0, 0);
    w1.pumpGeneration(100);
    const c1 = w1.getChunk(0, 0)!;
    const removed = c1.plants[0]?.id;
    if (removed !== undefined) c1.removedPlants.add(removed);
    c1.moisture[c1.cellIdx(2, 2)] = 0.77;
    c1.soilDirty = true;
    c1.dirty = true;
    w1.playerX = 500;
    w1.playerY = -300;
    w1.clock.gameMinutes = 4321;
    expect(saveWorld(w1, store)).toBe(true);

    // nova sessão, mesmo seed
    const w2 = new World({ seed: 1234 });
    w2.onChunkGenerated = (c) => applyChunkDiffs(w2, c);
    const res = loadWorld(w2, store);
    expect(res.applied).toBe(true);
    expect(w2.clock.gameMinutes).toBe(4321);
    expect(w2.playerX).toBe(500);
    w2.requestChunks(0, 0, 0, 0);
    w2.pumpGeneration(100);
    const c2 = w2.getChunk(0, 0)!;
    if (removed !== undefined) expect(c2.removedPlants.has(removed)).toBe(true);
    expect(c2.moisture[c2.cellIdx(2, 2)]).toBeCloseTo(0.77, 1);
  });

  it('deltas de terreno (erosão/alterações) sobrevivem ao reload', () => {
    const store = new MemStorage();
    const w1 = new World({ seed: 77 });
    w1.addDelta(10, 10, -0.05);
    expect(saveWorld(w1, store)).toBe(true);
    const w2 = new World({ seed: 77 });
    loadWorld(w2, store);
    expect(w2.getDelta(10, 10)).toBeCloseTo(-0.05, 6);
    expect(w2.deltaAt(10, 10)).toBeCloseTo(-0.05, 6);
  });

  it('save de outro seed/gerador não é aplicado (carregamento seguro)', () => {
    const store = new MemStorage();
    const w1 = new World({ seed: 1 });
    w1.clock.gameMinutes = 999;
    saveWorld(w1, store);
    const w2 = new World({ seed: 2 });
    const res = loadWorld(w2, store);
    expect(res.applied).toBe(false);
    expect(w2.clock.gameMinutes).not.toBe(999);
  });

  it('clearSave remove o estado', () => {
    const store = new MemStorage();
    saveWorld(new World({ seed: 3 }), store);
    clearSave(store);
    expect(loadWorld(new World({ seed: 3 }), store).applied).toBe(false);
  });

  it('chunk regenerado após unload reaplica os diffs', () => {
    const w = new World({ seed: 4 });
    let c = generateChunk(ctxOf(w), 0, 0);
    let key = '0,0';
    for (let cx = 0; cx < 6 && c.plants.length === 0; cx++) {
      c = generateChunk(ctxOf(w), cx, 1);
      key = `${cx},1`;
    }
    expect(c.plants.length).toBeGreaterThan(0);
    const id = c.plants[0].id;
    w.pendingDiffs = { [key]: { removed: [id], recruits: [], soil: undefined } };
    const fresh = generateChunk(ctxOf(w), c.cx, c.cy);
    applyChunkDiffs(w, fresh);
    expect(fresh.removedPlants.has(id)).toBe(true);
    expect([...fresh.livePlants()].some((p) => p.id === id)).toBe(false);
  });
});
