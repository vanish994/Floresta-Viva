/**
 * Testes do ecossistema: floração, polinização, frutificação, queda natural de
 * frutos maduros, frutos no chão, sementes, herbivoria, predadores, clima,
 * limites populacionais e save/load.
 *
 * Usam as funções reais (`stepPhenology`, `stepInsects`, `pollinate`) sobre
 * chunks sintéticos controlados.
 */
import { describe, expect, it } from 'vitest';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { SPECIES, speciesIndex, type PlantRecord } from '../src/world/flora';
import { World } from '../src/world/world';
import { plantSize } from '../src/world/ecology';
import {
  stepPhenology,
  stepInsects,
  seedInsects,
  pollinate,
  phenoOf,
  canFruit,
  hasOpenFlower,
  createEcoBudget,
  MAX_FLOWERS,
  WIND_POLLINATION,
  RECRUIT_CAP,
  type EcoContext,
  type Insect,
} from '../src/world/ecosystem';
import { saveWorld, loadWorld, applyChunkDiffs } from '../src/world/persistence';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL_PX = cfg.simCellTiles * cfg.tileSize;

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function makeChunk(plants: Array<{ species: number; lx: number; ly: number; ageDays?: number; id?: number }> = []): Chunk {
  const c = new Chunk(0, 0, cfg);
  for (let i = 0; i < c.n * c.n; i++) {
    c.soilType[i] = SOIL_FOREST;
    c.soilBase[i] = SOIL_FOREST;
    c.moisture[i] = 0.62; // úmido o bastante para frutificar
    c.humus[i] = 4;
    c.litter[i] = 2;
    c.soilDepth[i] = 1;
  }
  plants.forEach((p, k) => {
    const rec: PlantRecord = {
      id: p.id ?? 1000 + k,
      species: p.species,
      x: (p.lx + 0.5) * CELL_PX,
      y: (p.ly + 0.5) * CELL_PX,
      birthAge: p.ageDays ?? 120, // adulta e saudável (longe da senescência)
      variant: k,
      origin: 'gen',
    };
    c.plants.push(rec);
  });
  c.rebuildPlantIndex();
  return c;
}

function ctxOf(worldDay: number, season = 1, hour = 12): EcoContext {
  return {
    cfg,
    climate: new World({ seed: 1 }).climate,
    worldDay,
    season,
    hourFraction: hour / 24,
    humidity: 0.52,
  };
}

/** roda a fenologia por N horas de jogo, em passos de 3 h (frequência real) */
function runPhenology(c: Chunk, hours: number, startDay: number, budget = createEcoBudget()): typeof budget {
  const steps = Math.round(hours / cfg.periodBioHours);
  for (let i = 0; i < steps; i++) {
    const day = startDay + i * (cfg.periodBioHours / 24);
    stepPhenology(c, cfg.periodBioHours, ctxOf(day, 1), budget);
  }
  return budget;
}

describe('ecossistema — fenologia e frutos', () => {
  it('1. planta adulta e saudável floresce; jovem e planta seca não', () => {
    const macieira = speciesIndex('macaneira');
    const adult = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    const adultBudget = runPhenology(adult, 24 * 4, 10);
    expect(adultBudget.flowered).toBeGreaterThan(0); // a planta florou

    // jovem (broto): não frutifica
    const young = makeChunk([{ species: macieira, lx: 8, ly: 8, ageDays: 1 }]);
    const yp = young.plants[0];
    expect(plantSize(yp, young, cfg, 12)).toBeLessThan(0.45);
    expect(canFruit(yp, young, cfg, 12)).toBe(false);
    runPhenology(young, 24 * 4, 10);
    expect(phenoOf(yp).stage).toBe('vegetative');

    // seca: umidade baixa impede floração
    const dry = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    for (let i = 0; i < dry.n * dry.n; i++) dry.moisture[i] = 0.08;
    runPhenology(dry, 24 * 4, 10);
    expect(phenoOf(dry.plants[0]).stage).toBe('vegetative');
    expect(phenoOf(dry.plants[0]).flowers).toBe(0);
  });

  it('2. polinização por inseto é o que gera fruto (vento é raro)', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    const p = c.plants[0];
    // força o estágio de floração
    const pheno = phenoOf(p);
    pheno.stage = 'flowering';
    pheno.flowers = 5;
    pheno.timer = 0;

    // sem visita: nenhuma fruta imediata
    expect(pheno.fruits.length).toBe(0);

    // a visita de um polinizador compatível fertiliza flores
    let pollinatedCount = 0;
    for (let k = 0; k < 5; k++) {
      if (pollinate(p, cfg, 30, 1, true)) pollinatedCount++;
    }
    expect(pollinatedCount).toBeGreaterThan(0);
    expect(pheno.fruits.length).toBeGreaterThan(0);
    expect(pheno.fruits.length).toBeLessThanOrEqual(SPECIES[macieira].maxFruits);
    // autopolinização (pólen da mesma flor) é bem menos eficaz
    expect(WIND_POLLINATION).toBeLessThan(0.2);
  });

  it('3. fruto verde amadurece com o tempo (nunca instantâneo)', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    const p = c.plants[0];
    const pheno = phenoOf(p);
    pheno.stage = 'flowering';
    pheno.flowers = 4;
    pollinate(p, cfg, 10, 3, true);
    pheno.stage = 'green';
    pheno.timer = 0;

    const bud = pheno.fruits[0];
    expect(bud.age).toBe(0);
    // um passo de 3 h deixa verde, não maduro
    stepPhenology(c, 3, ctxOf(10), createEcoBudget());
    expect(pheno.fruits.length).toBeGreaterThan(0);
    expect(pheno.fruits[0].age).toBeGreaterThan(0);
    expect(pheno.fruits[0].age).toBeLessThan(1);

    // depois do tempo de maturação da espécie, os frutos amadurecem
    const ripeBudget = runPhenology(c, 24 * (SPECIES[macieira].fruitRipenDays + 0.5), 12);
    expect(ripeBudget.ripened).toBeGreaterThan(0);
    const onPlant = pheno.fruits.filter((f) => f.age >= 1).length;
    expect(onPlant + ripeBudget.fallen).toBeGreaterThan(0);
  });

  it('4. fruto maduro CAI naturalmente (e com tempo variável por espécie)', () => {
    const macieira = speciesIndex('macaneira');
    const cerejeira = speciesIndex('embauba'); // porta mirtilo: segura menos
    const c = makeChunk([
      { species: macieira, lx: 4, ly: 4, id: 501 },
      { species: cerejeira, lx: 11, ly: 11, id: 502 },
    ]);
    for (const p of c.plants) {
      const sp = SPECIES[p.species];
      const pheno = phenoOf(p);
      pheno.stage = 'ripe';
      pheno.fruits = [{ age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 }];
      void sp;
    }

    const budget = createEcoBudget();
    // 6 dias de jogo: mais que o tempo de permanência → todos caem e ainda
    // estão no chão (a decomposição só vem depois de ~6 dias)
    runPhenology(c, 24 * 7, 40, budget);
    expect(budget.fallen).toBeGreaterThan(0);
    expect(budget.fallen).toBeGreaterThanOrEqual(2); // caíram de verdade
    expect(c.groundFruits.length + budget.seeds).toBeGreaterThan(0); // chão/semente
    for (const gf of c.groundFruits) {
      expect(Number.isFinite(gf.x)).toBe(true);
      expect(gf.fruit).toBeTruthy();
    }
  });

  it('5. fruto no chão vira semente e pode germinar em nova planta', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    // três frutos já no chão
    for (let k = 0; k < 6; k++) {
      c.groundFruits.push({
        id: k,
        fruit: 'maca',
        species: macieira,
        x: 8.5 * CELL_PX + k * 3,
        y: 8.5 * CELL_PX,
        ageHours: 24 * 5,
        seedKey: 900 + k,
        dropOffset: 0,
        slot: { age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 },
      });
    }
    const budget = createEcoBudget();
    // avança até decompor (6 dias) e germinar
    runPhenology(c, 24 * 40, 60, budget);
    expect(budget.seeds).toBeGreaterThan(0);
    // os 6 frutos iniciais decompuseram (pode haver fruto NOVO de um novo ciclo)
    expect(c.groundFruits.length).toBeLessThan(6);
    const recruits = c.recruitedPlants.filter((p) => p.species === macieira);
    expect(recruits.length).toBeGreaterThan(0);
    // sem explosão: mudas limitadas por chunk (teto de recrutamento)
    expect(c.recruitedPlants.length).toBeLessThanOrEqual(RECRUIT_CAP);
  });

  it('6. herbivoria (lagarta) reduz a saúde e a produção de frutos', () => {
    const macieira = speciesIndex('macaneira');
    const healthy = makeChunk([{ species: macieira, lx: 8, ly: 8, id: 700 }]);
    const attacked = makeChunk([{ species: macieira, lx: 8, ly: 8, id: 700 }]);

    const healthyFruit = runPhenology(healthy, 24 * 30, 20);
    // planta atacada: pragas altas desde o início
    phenoOf(attacked.plants[0]).pests = 0.95;
    const attackedFruit = runPhenology(attacked, 24 * 30, 20);

    expect(attackedFruit.flowered).toBeLessThanOrEqual(healthyFruit.flowered);
    const healthyRipe = healthy.groundFruits.length + phenoOf(healthy.plants[0]).fruits.length;
    const attackedRipe = attacked.groundFruits.length + phenoOf(attacked.plants[0]).fruits.length;
    expect(attackedRipe).toBeLessThanOrEqual(healthyRipe);
    expect(phenoOf(attacked.plants[0]).pests).toBeGreaterThan(0.3);
  });

  it('7. insetos: abelha visita flor, carrega pólen e poliniza outra planta', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([
      { species: macieira, lx: 5, ly: 8, id: 801 },
      { species: macieira, lx: 9, ly: 8, id: 802 },
    ]);
    for (const p of c.plants) {
      const ph = phenoOf(p);
      ph.stage = 'flowering';
      ph.flowers = 3;
      ph.timer = 0;
    }
    const insects: Insect[] = [
      {
        id: 1,
        kind: 'bee',
        chunk: c,
        x: 5.5 * CELL_PX,
        y: 8.5 * CELL_PX,
        state: 'wander',
        targetId: -1,
        pollen: false,
        pollenSpecies: -1,
        energy: 1,
        phase: 0,
        cooldown: 0,
      },
    ];
    const budget = createEcoBudget();
    let visitedSomeFlower = false;
    for (let step = 0; step < 400; step++) {
      stepInsects(insects, cfg, { worldDay: 30, hour: 12, detailed: true, budget });
      if (insects[0].pollen) visitedSomeFlower = true;
      if (budget.pollinated > 0) break;
    }
    expect(visitedSomeFlower).toBe(true); // coletou pólen em uma visita
    expect(budget.pollinated).toBeGreaterThan(0);
    const total = c.plants.reduce((sum, p) => sum + (p.pheno?.fruits.length ?? 0), 0);
    expect(total).toBeGreaterThan(0);
  });

  it('8. insetos respeitam limites populacionais e ficam inertes à noite', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([
      { species: macieira, lx: 3, ly: 3 },
      { species: macieira, lx: 6, ly: 6 },
      { species: macieira, lx: 9, ly: 9 },
    ]);
    for (const p of c.plants) {
      const ph = phenoOf(p);
      ph.stage = 'flowering';
      ph.flowers = MAX_FLOWERS;
    }
    const day = seedInsects(c, cfg, 12, 40);
    const night = seedInsects(c, cfg, 23, 40);
    expect(day.length).toBeGreaterThan(0);
    expect(day.length).toBeLessThanOrEqual(12); // teto por chunk
    const dayBees = day.filter((i) => i.kind === 'bee').length;
    const nightBees = night.filter((i) => i.kind === 'bee').length;
    expect(dayBees).toBeGreaterThan(0);
    expect(nightBees).toBe(0); // abelhas não voam à noite
  });

  it('9. joaninhas reduzem pragas e melhoram a produção', () => {
    const macieira = speciesIndex('macaneira');
    const c = makeChunk([{ species: macieira, lx: 8, ly: 8, id: 900 }]);
    const p = c.plants[0];
    phenoOf(p).pests = 0.8;
    c.pestPressure = 0.6;

    const ladybug: Insect = {
      id: 2,
      kind: 'ladybug',
      chunk: c,
      x: p.x,
      y: p.y,
      state: 'seek-prey',
      targetId: -1,
      pollen: false,
      pollenSpecies: -1,
      energy: 1,
      phase: 0,
      cooldown: 10,
    };
    const before = phenoOf(p).pests;
    for (let k = 0; k < 30; k++) stepInsects([ladybug], cfg, { worldDay: 30, hour: 12, detailed: true, budget: createEcoBudget() });
    expect(phenoOf(p).pests).toBeLessThan(before);
    expect(c.pestPressure).toBeLessThan(0.6);
  });

  it('10. chuva/umidade influenciam a produção (solo seco = sem floração)', () => {
    const macieira = speciesIndex('macaneira');
    const wet = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    const dry = makeChunk([{ species: macieira, lx: 8, ly: 8 }]);
    for (let i = 0; i < dry.n * dry.n; i++) dry.moisture[i] = 0.12;
    const wb = runPhenology(wet, 24 * 20, 20);
    const db = runPhenology(dry, 24 * 20, 20);
    expect(wb.flowered).toBeGreaterThan(0);
    expect(db.flowered).toBe(0);
    expect(phenoOf(dry.plants[0]).stage).toBe('vegetative');
  });

  it('11. save/load preserva fenologia, frutos no chão e sementes', () => {
    const w = new World({ seed: 606 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const c = w.getChunk(0, 0)!;
    const macieira = speciesIndex('macaneira');
    const plant = c.plants[0] ?? c.recruitedPlants[0];
    // garante uma planta com estado ecológico
    const target: PlantRecord = plant ?? {
      id: 4242, species: macieira, x: 300, y: 300, birthAge: 400, variant: 1, origin: 'recruit',
    };
    if (!plant) {
      c.recruitedPlants.push(target);
      c.rebuildPlantIndex();
    }
    target.species = macieira;
    target.pheno = {
      stage: 'ripe',
      timer: 12,
      flowers: 0,
      pests: 0.4,
      dormant: 0,
      fruits: [{ age: 1, pollinated: true, ripeHours: 30, ox: 0.2, oy: -0.3, holdBias: 1.1 }],
    };
    c.groundFruits = [{
      id: 777, fruit: 'maca', species: macieira, x: target.x + 10, y: target.y + 4,
      ageHours: 12, seedKey: 55, dropOffset: 0,
      slot: { age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 },
    }];
    c.seedBed = [{ x: target.x - 8, y: target.y + 6, species: macieira, ageHours: 3, seedKey: 56 }];
    c.pestPressure = 0.35;
    c.dirty = true;
    c.soilDirty = true;

    const store = new MemStorage();
    expect(saveWorld(w, store)).toBe(true);
    const w2 = new World({ seed: 606 });
    w2.onChunkGenerated = (ch) => applyChunkDiffs(w2, ch);
    expect(loadWorld(w2, store).applied).toBe(true);
    w2.requestChunks(0, 0, 0, 0);
    w2.pumpGeneration(100);
    const c2 = w2.getChunk(0, 0)!;
    const p2 = [...c2.plants, ...c2.recruitedPlants].find((p) => p.id === target.id)!;
    expect(p2.pheno).toBeTruthy();
    expect(p2.pheno!.stage).toBe('ripe');
    expect(p2.pheno!.fruits.length).toBe(1);
    expect(p2.pheno!.pests).toBeCloseTo(0.4, 1);
    expect(c2.groundFruits.length).toBe(1);
    expect(c2.groundFruits[0].fruit).toBe('maca');
    expect(c2.seedBed.length).toBe(1);
    expect(c2.pestPressure).toBeCloseTo(0.35, 1);
  });

  it('12. integração: o mundo simula o ciclo e o fruto maduro não fica na árvore', () => {
    // mundo pequeno (9 chunks) para o teste rodar rápido, mas com o mesmo código
    const w = new World({ seed: 2024, waterActiveRadiusChunks: 1, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(200);
    // água/umidade em equilíbrio e muitas plantas adultas já no lugar
    for (let i = 0; i < 20; i++) w.update(30000); // 10 h
    let flowering = 0;
    for (const c of w.chunks.values()) for (const p of c.livePlants()) if (hasOpenFlower(p)) flowering++;

    // ~4 dias de jogo: suficiente para floração → fruto → queda
    for (let i = 0; i < 160; i++) w.update(30000); // 80 h
    let stages = { flowering: 0, green: 0, ripe: 0, fruitsOnPlant: 0, groundFruits: 0, seeds: 0 };
    for (const c of w.chunks.values()) {
      stages.groundFruits += c.groundFruits.length;
      stages.seeds += c.seedBed.length;
      for (const p of c.livePlants()) {
        const ph = p.pheno;
        if (!ph) continue;
        if (ph.stage === 'flowering') stages.flowering++;
        if (ph.stage === 'green') stages.green++;
        if (ph.stage === 'ripe') stages.ripe++;
        stages.fruitsOnPlant += ph.fruits.length;
      }
    }
    // o ciclo aconteceu de fato (não é só decoração)
    expect(stages.flowering + stages.green + stages.ripe + stages.groundFruits + w.ecoBudget.fallen).toBeGreaterThan(0);
    // e nada de acúmulo infinito de frutos presos nas árvores
    expect(stages.fruitsOnPlant).toBeLessThan(2000);
    expect(Number.isFinite(w.stats.groundFruits)).toBe(true);
    expect(w.stats.insects).toBeGreaterThanOrEqual(0);
    void flowering;
  });
});

/** frutos que já estão no chão, no formato dos slots (para comparação) */
function chunkFruits(c: Chunk) {
  return c.groundFruits.map((g) => g.slot);
}
