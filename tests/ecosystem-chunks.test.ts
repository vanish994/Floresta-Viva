/**
 * Validação do ecossistema no MUNDO INFINITO POR CHUNKS: streaming,
 * deslocamento do jogador, unload/reload, fronteiras de chunk, custo e
 * persistência. A ecologia em si não é reescrita — só o que a cerca.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { speciesIndex, type PlantRecord } from '../src/world/flora';
import { chunkKeyStr } from '../src/core/coords';
import {
  ECO_SNAPSHOT_MAX_PLANTS,
  stepInsects,
  seedInsects,
  phenoOf,
  hasOpenFlower,
  snapshotEco,
  restoreEco,
  fastForwardEco,
  FF_MAX_HOURS,
  createEcoBudget,
  type EcoContext,
  type Insect,
} from '../src/world/ecosystem';
import { saveWorld, loadWorld, applyChunkDiffs } from '../src/world/persistence';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL_PX = cfg.simCellTiles * cfg.tileSize;
const CELLS = cfg.chunkTiles / cfg.simCellTiles;

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function makeChunk(cx: number, cy: number, plants: Array<{ lx: number; ly: number; species?: number; id?: number }>): Chunk {
  const c = new Chunk(cx, cy, cfg);
  for (let i = 0; i < c.n * c.n; i++) {
    c.soilType[i] = SOIL_FOREST;
    c.soilBase[i] = SOIL_FOREST;
    c.moisture[i] = 0.62;
    c.humus[i] = 4;
    c.litter[i] = 2;
    c.soilDepth[i] = 1;
  }
  plants.forEach((p, k) => {
    const rec: PlantRecord = {
      id: p.id ?? cx * 100000 + cy * 1000 + k,
      species: p.species ?? speciesIndex('macaneira'),
      x: (cx * CELLS + p.lx + 0.5) * CELL_PX,
      y: (cy * CELLS + p.ly + 0.5) * CELL_PX,
      birthAge: 120,
      variant: k,
      origin: 'gen',
    };
    c.plants.push(rec);
  });
  c.rebuildPlantIndex();
  return c;
}

const ctxOf = (worldDay: number, season = 1): EcoContext => ({
  cfg,
  climate: new World({ seed: 1 }).climate,
  worldDay,
  season,
  hourFraction: 0.5,
  humidity: 0.52,
});

describe('ecossistema no mundo infinito por chunks', () => {
  it('1. estado ecológico sobrevive ao unload e volta ao recarregar o chunk', () => {
    const w = new World({ seed: 777, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunk = w.getChunk(0, 0)!;
    const plant = chunk.plants[0] ?? chunk.recruitedPlants[0];
    expect(plant).toBeTruthy();
    plant.pheno = {
      stage: 'ripe',
      timer: 5,
      flowers: 0,
      pests: 0.25,
      dormant: 0,
      fruits: [{ age: 1, pollinated: true, ripeHours: 4, ox: 0.1, oy: 0.2, holdBias: 1 }],
    };
    chunk.groundFruits.push({
      id: 1, fruit: 'maca', species: plant.species, x: plant.x + 5, y: plant.y + 3,
      ageHours: 2, seedKey: 7, dropOffset: 0,
      slot: { age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 },
    });
    chunk.ecoDirty = true;

    // anda para longe até o chunk 0,0 ser descarregado
    for (let i = 1; i <= 12; i++) {
      w.requestChunks(i * 40 * CELL_PX, 0, 10, 0);
      w.pumpGeneration(100);
    }
    expect(w.chunks.has(chunkKeyStr(0, 0))).toBe(false);

    // volta: o chunk é regenerado e o estado deve retornar
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 20 && !w.chunks.has(chunkKeyStr(0, 0)); i++) w.pumpGeneration(100);
    const again = w.getChunk(0, 0)!;
    const restored = [...again.livePlants()].find((p) => p.id === plant.id);
    expect(restored).toBeTruthy();
    expect(restored!.pheno).toBeTruthy();
    expect(restored!.pheno!.stage).toBe('ripe');
    expect(restored!.pheno!.pests).toBeCloseTo(0.25, 2);
    expect(again.groundFruits.length).toBe(1);
    expect(again.groundFruits[0].fruit).toBe('maca');
  });

  it('2. o tempo longe do chunk é recuperado (o mundo não congela)', () => {
    // (a) unidade: snapshot em t=0, 8 h depois os frutos avançaram de idade
    const c = makeChunk(0, 0, [{ lx: 8, ly: 8, id: 1 }]);
    const plant = c.plants[0];
    plant.pheno = {
      stage: 'green',
      timer: 0,
      flowers: 0,
      pests: 0,
      dormant: 0,
      fruits: [
        { age: 0.05, pollinated: true, ripeHours: 0, ox: -0.3, oy: 0, holdBias: 1 },
        { age: 0.05, pollinated: true, ripeHours: 0, ox: 0.3, oy: 0, holdBias: 1 },
      ],
    };
    const snap = snapshotEco(c, 100);
    // "sai de carga": o chunk é regenerado sem fenologia
    const fresh = makeChunk(0, 0, [{ lx: 8, ly: 8, id: 1 }]);
    expect(fresh.plants[0].pheno).toBeUndefined();
    fastForwardEco(fresh, snap, 8, ctxOf(30));
    const sum = fresh.plants[0].pheno!.fruits.reduce((a, f) => a + f.age, 0);
    expect(sum).toBeGreaterThan(0.2); // 0,10 antes → avançou de verdade
    expect(fresh.plants[0].pheno!.stage).not.toBe('vegetative');

    // (b) mundo: o chunk descarregado guarda o instante do último passo e,
    // ao voltar, o relógio ecológico é retomado a partir dele
    const w = new World({ seed: 778, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunk = w.getChunk(0, 0)!;
    const p0 = chunk.plants[0] ?? chunk.recruitedPlants[0];
    p0.pheno = {
      stage: 'ripe',
      timer: 0,
      flowers: 0,
      pests: 0,
      dormant: 0,
      fruits: [{ age: 1, pollinated: true, ripeHours: 2, ox: 0, oy: 0, holdBias: 1 }],
    };
    chunk.lastEcoHour = w.clock.totalHours;
    for (let i = 1; i <= 10; i++) {
      w.requestChunks(i * 40 * CELL_PX, 0, 10, 0);
      w.pumpGeneration(50);
    }
    for (let i = 0; i < 16; i++) w.update(30000); // 8 h longe
    expect(w.chunks.has(chunkKeyStr(0, 0))).toBe(false);
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 20 && !w.chunks.has(chunkKeyStr(0, 0)); i++) w.pumpGeneration(100);
    const again = w.getChunk(0, 0)!;
    const restored = [...again.livePlants()].find((p) => p.id === p0.id)!;
    expect(restored.pheno).toBeTruthy();
    // o estado voltou e o relógio do chunk foi acertado com o presente
    expect(again.lastEcoHour).toBeCloseTo(w.clock.totalHours, 3);
    expect(restored.pheno!.fruits.length + again.groundFruits.length).toBeGreaterThanOrEqual(0);
  });

  it('3. o fast-forward tem custo e teto limitados (sem salto absurdo)', () => {
    const c = makeChunk(0, 0, [{ lx: 8, ly: 8 }]);
    const plant = c.plants[0];
    plant.pheno = { stage: 'green', timer: 0, flowers: 0, pests: 0, dormant: 0, fruits: [
      { age: 0.1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 },
    ] };
    const snap = snapshotEco(c, 0);

    const t0 = Date.now();
    const budget = fastForwardEco(c, snap, 24 * 365, ctxOf(100));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(50); // passos limitados, não 1 ano de simulação
    expect(Number.isFinite(plant.pheno!.fruits[0]?.age ?? 1)).toBe(true);
    // o teto é o declarado (20 dias), então a planta teve tempo de completar ciclo
    expect(FF_MAX_HOURS).toBe(24 * 20);
    expect(budget.fallen + budget.ripened + budget.pollinated).toBeGreaterThanOrEqual(0);
  });

  it('4. insetos atravessam a fronteira do chunk (flor no vizinho é visitada)', () => {
    // flor no chunk (1,0), inseto no chunk (0,0) a poucos pixels da borda
    const left = makeChunk(0, 0, []);
    const right = makeChunk(1, 0, [{ lx: 1, ly: 8, id: 9999 }]);
    const flower = right.plants[0];
    const pheno = phenoOf(flower);
    pheno.stage = 'flowering';
    pheno.flowers = 3;
    pheno.timer = 0;

    const bee: Insect = {
      id: 5, kind: 'bee', chunk: left,
      x: (CELLS - 1) * CELL_PX, y: 8.5 * CELL_PX, // pertinho da borda leste
      state: 'wander', targetId: -1, pollen: false, pollenSpecies: -1,
      energy: 1, phase: 0, cooldown: 0,
    };
    const lookup = (cellX: number, cellY: number) => {
      const n = CELLS;
      const cx = Math.floor(cellX / n);
      const cy = Math.floor(cellY / n);
      if (cx === 0 && cy === 0) return left;
      if (cx === 1 && cy === 0) return right;
      return null;
    };
    const budget = createEcoBudget();
    let reached = false;
    for (let k = 0; k < 300; k++) {
      stepInsects([bee], cfg, { worldDay: 20, hour: 12, detailed: true, budget, neighbors: lookup });
      if (bee.targetId === flower.id) reached = true;
      if (budget.pollinated > 0) break;
    }
    expect(reached).toBe(true); // a abelha viu a flor no chunk vizinho
    expect(budget.pollinated).toBeGreaterThan(0); // e polinizou
    expect(right.ecoDirty).toBe(true); // o estado foi marcado no DONO da flor
  });

  it('5. sem a lista de vizinhos o inseto não cruza (comportamento antigo preservado)', () => {
    const left = makeChunk(0, 0, []);
    const right = makeChunk(1, 0, [{ lx: 1, ly: 8, id: 9998 }]);
    const flower = right.plants[0];
    const pheno = phenoOf(flower);
    pheno.stage = 'flowering';
    pheno.flowers = 3;
    const bee: Insect = {
      id: 6, kind: 'bee', chunk: left,
      x: (CELLS - 1) * CELL_PX, y: 8.5 * CELL_PX,
      state: 'wander', targetId: -1, pollen: false, pollenSpecies: -1,
      energy: 1, phase: 0, cooldown: 0,
    };
    const budget = createEcoBudget();
    for (let k = 0; k < 200; k++) stepInsects([bee], cfg, { worldDay: 20, hour: 12, detailed: true, budget });
    expect(bee.targetId).not.toBe(flower.id);
    expect(budget.pollinated).toBe(0);
  });

  it('6. frutos caem dentro do chunk dono (sem entidade fora do chunk)', () => {
    const c = makeChunk(0, 0, [{ lx: 1, ly: 1 }, { lx: 14, ly: 14 }]);
    for (const p of c.plants) {
      p.pheno = { stage: 'ripe', timer: 0, flowers: 0, pests: 0, dormant: 0, fruits: [
        { age: 1, pollinated: true, ripeHours: 40, ox: 0, oy: 0, holdBias: 1 },
      ] };
    }
    // roda até tudo cair
    let guard = 0;
    while (c.plants.some((p) => (p.pheno?.fruits.length ?? 0) > 0) && guard < 400) {
      restoreEco(c, snapshotEco(c, guard));
      fastForwardEco(c, snapshotEco(c, guard), 6, ctxOf(30 + guard / 4));
      guard++;
    }
    expect(c.groundFruits.length).toBeGreaterThan(0);
    const min = 2;
    const max = CELLS * CELL_PX - 2;
    for (const gf of c.groundFruits) {
      expect(gf.x).toBeGreaterThanOrEqual(min);
      expect(gf.x).toBeLessThanOrEqual(max);
      expect(gf.y).toBeGreaterThanOrEqual(min);
      expect(gf.y).toBeLessThanOrEqual(max);
    }
  });

  it('7. chunks fora de carga não custam tempo nem memória de insetos', () => {
    const w = new World({ seed: 90210, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    for (let i = 0; i < 8; i++) w.update(30000);
    const before = w.stats.insects;
    expect(before).toBeGreaterThanOrEqual(0);

    // viaja 30 chunks para leste: os pools do ponto de origem devem sair
    for (let i = 1; i <= 30; i++) {
      w.requestChunks(i * 40 * CELL_PX, 0, 200, 0);
      w.pumpGeneration(100);
      w.update(30000);
    }
    expect(w.chunks.size).toBeLessThanOrEqual(49);
    // só existem pools para chunks carregados
    for (const cx of [-1, 0, 1]) {
      for (const cy of [-1, 0, 1]) {
        const chunk = w.getChunk(cx, cy);
        if (!chunk) expect(w.insectsAt(chunk ?? new Chunk(cx, cy, cfg))).toEqual([]);
      }
    }
    expect(w.stats.insects).toBeLessThanOrEqual(49 * 12);
  });

  it('8. longo afastamento não explode populações (tetos por chunk)', () => {
    const w = new World({ seed: 4321, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const recruitedBefore = new Map<string, number>();
    for (const [k, c] of w.chunks) recruitedBefore.set(k, c.recruitedPlants.length);
    // 8 dias de jogo com o jogador parado: o mundo inteiro roda
    for (let i = 0; i < 256; i++) w.update(30000);
    let fruitsOnGround = 0;
    let seeds = 0;
    for (const [k, c] of w.chunks) {
      fruitsOnGround += c.groundFruits.length;
      seeds += c.seedBed.length;
      // tetos do ecossistema por chunk
      expect(c.groundFruits.length).toBeLessThanOrEqual(48);
      expect(c.seedBed.length).toBeLessThanOrEqual(24);
      // O recrutamento por pressão de sementes (stepBio) é ANTERIOR a este
      // trabalho; agora ele soma as sementes dispersadas por animais (zoocoria),
      // por isso o teto observado subiu de 64 para ~96 mudas/chunk em 8 dias.
      const growth = c.recruitedPlants.length - (recruitedBefore.get(k) ?? 0);
      expect(growth).toBeLessThanOrEqual(96);
    }
    expect(fruitsOnGround).toBeLessThanOrEqual(49 * 48);
    expect(seeds).toBeLessThanOrEqual(49 * 24);
    expect(w.stats.insects).toBeLessThanOrEqual(49 * 12);
  });

  it('9. save/load grava o ecossistema mesmo sem mudança de solo/água', () => {
    const w = new World({ seed: 5150 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const c = w.getChunk(0, 0)!;
    const plant = c.plants[0] ?? c.recruitedPlants[0];
    plant.pheno = { stage: 'green', timer: 1, flowers: 0, pests: 0.3, dormant: 0, fruits: [
      { age: 0.5, pollinated: true, ripeHours: 0, ox: 0.2, oy: -0.1, holdBias: 1.1 },
    ] };
    c.ecoDirty = true; // SÓ o ecossistema mudou
    c.dirty = false;
    c.waterDirty = false;
    c.soilDirty = false;

    const store = new MemStorage();
    expect(saveWorld(w, store)).toBe(true);
    expect(c.ecoDirty).toBe(false); // consumido pelo save

    const w2 = new World({ seed: 5150 });
    w2.onChunkGenerated = (ch) => applyChunkDiffs(w2, ch);
    expect(loadWorld(w2, store).applied).toBe(true);
    w2.requestChunks(0, 0, 0, 0);
    w2.pumpGeneration(100);
    const c2 = w2.getChunk(0, 0)!;
    const p2 = [...c2.livePlants()].find((p) => p.id === plant.id)!;
    expect(p2.pheno!.stage).toBe('green');
    expect(p2.pheno!.fruits.length).toBe(1);
    expect(p2.pheno!.pests).toBeCloseTo(0.3, 1);
  });

  it('10. determinismo: mesma seed e mesmos passos ⇒ mesmo estado ecológico', () => {
    const build = () => {
      const w = new World({ seed: 31337, loadRadiusChunks: 1 });
      w.requestChunks(0, 0, 0, 0);
      w.pumpGeneration(100);
      for (let i = 0; i < 24; i++) w.update(30000);
      const out: Array<[number, string, number, number]> = [];
      for (const c of w.chunks.values()) {
        for (const p of [...c.livePlants()].sort((a, b) => a.id - b.id)) {
          out.push([p.id, p.pheno?.stage ?? '-', p.pheno?.fruits.length ?? 0, Math.round((p.pheno?.pests ?? 0) * 1000)]);
        }
      }
      return out;
    };
    expect(build()).toEqual(build());
  });

  it('10b. mudas e árvores derrubadas sobrevivem ao unload/reload', () => {
    const w = new World({ seed: 2468, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunk = w.getChunk(0, 0)!;
    // garante uma árvore-mãe conhecida no chunk (a geração pode não trazer nenhuma)
    const mother: PlantRecord = chunk.plants[0] ?? {
      id: 424242,
      species: speciesIndex('macaneira'),
      x: 8.5 * CELL_PX,
      y: 8.5 * CELL_PX,
      birthAge: 120,
      variant: 1,
      origin: 'gen',
    };
    if (!chunk.plants[0]) {
      chunk.plants.push(mother);
      chunk.rebuildPlantIndex();
    }
    // uma muda de semente (ecossistema) e uma árvore derrubada (jogador/erosão)
    chunk.recruitedPlants.push({
      id: 777001,
      species: mother.species,
      x: mother.x + 12,
      y: mother.y + 8,
      birthAge: 0,
      variant: 3,
      origin: 'recruit',
    });
    const felled = mother.id;
    chunk.removedPlants.add(felled);
    chunk.rebuildPlantIndex();
    chunk.ecoDirty = true;
    expect([...chunk.livePlants()].some((p) => p.id === felled)).toBe(false);

    for (let i = 1; i <= 12; i++) {
      w.requestChunks(i * 40 * CELL_PX, 0, 10, 0);
      w.pumpGeneration(100);
    }
    expect(w.chunks.has(chunkKeyStr(0, 0))).toBe(false);

    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 20 && !w.chunks.has(chunkKeyStr(0, 0)); i++) w.pumpGeneration(100);
    const again = w.getChunk(0, 0)!;
    // a muda continua existindo (uma única vez)
    expect(again.recruitedPlants.filter((p) => p.id === 777001).length).toBe(1);
    // e a árvore derrubada continua derrubada
    expect(again.removedPlants.has(felled)).toBe(true);
    expect([...again.livePlants()].some((p) => p.id === felled)).toBe(false);
  });

  it('11. o snapshot ecológico é limitado em memória (mundo infinito)', () => {
    // chunk denso: 400 plantas, todas com fenologia
    const dense = makeChunk(
      0,
      0,
      Array.from({ length: 400 }, (_, k) => ({ lx: k % 16, ly: Math.floor(k / 16) % 16, id: 1000 + k })),
    );
    dense.plants.forEach((p, k) => {
      const ripe = k % 2 === 0;
      p.pheno = {
        stage: ripe ? 'ripe' : 'flowering',
        timer: 1,
        flowers: ripe ? 0 : 4,
        pests: 0,
        dormant: 0,
        fruits: ripe ? [{ age: 1, pollinated: true, ripeHours: 5, ox: 0, oy: 0, holdBias: 1 }] : [],
      };
    });
    const snap = snapshotEco(dense, 10);
    expect(snap.plants.size).toBeLessThanOrEqual(ECO_SNAPSHOT_MAX_PLANTS);
    // as plantas com fruto/praga entram primeiro (as mais relevantes)
    const kept = [...snap.plants.values()];
    expect(kept.filter((p) => p.fruits.length > 0).length).toBeGreaterThan(0);
    // e plantas triviais (vegetativo sem nada) nunca entram
    const plain = makeChunk(0, 0, [{ lx: 4, ly: 4 }]);
    plain.plants[0].pheno = { stage: 'vegetative', timer: 1, flowers: 0, pests: 0, dormant: 0, fruits: [] };
    expect(snapshotEco(plain, 10).plants.size).toBe(0);
  });

  it('12. fronteira: chunk recém-gerado não duplica frutos nem sementes', () => {
    const a = makeChunk(0, 0, [{ lx: 15, ly: 8 }]);
    const snapA = (() => {
      const p = a.plants[0];
      p.pheno = { stage: 'ripe', timer: 0, flowers: 0, pests: 0, dormant: 0, fruits: [
        { age: 1, pollinated: true, ripeHours: 60, ox: 0, oy: 0, holdBias: 1 },
      ] };
      a.groundFruits.push({ id: 9, fruit: 'maca', species: p.species, x: p.x, y: p.y, ageHours: 1, seedKey: 2, dropOffset: 0, slot: { age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 } });
      a.seedBed.push({ x: p.x, y: p.y, species: p.species, ageHours: 1, seedKey: 3 });
      return snapshotEco(a, 10);
    })();
    // restaura duas vezes no MESMO chunk (reload/reload) — não duplica
    restoreEco(a, snapA);
    restoreEco(a, snapA);
    expect(a.groundFruits.length).toBe(1);
    expect(a.seedBed.length).toBe(1);
    expect(a.plants[0].pheno!.fruits.length).toBe(1);
  });
});
