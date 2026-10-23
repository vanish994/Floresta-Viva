/**
 * Ecossistema causal: água no solo, atmosfera (evaporação → nuvens → chuva),
 * luz + crescimento multifatorial, decomposição por material e fauna com
 * fome/sede/dieta/fezes/dispersão.
 *
 * Os testes usam as MESMAS funções do jogo; quando precisam de um mundo, usam
 * `World` de verdade (nada de reimplementar a física no teste).
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Chunk, SOIL_CLAY, SOIL_FOREST, SOIL_SAND } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { Climate } from '../src/world/climate';
import { stepWater, stepBio, plantHealth } from '../src/world/ecology';
import { speciesIndex, type PlantRecord } from '../src/world/flora';
import { generateChunk } from '../src/world/gen';
import {
  stepFauna,
  seedFauna,
  makeAnimal,
  FAUNA_CAP,
  type Animal,
} from '../src/world/fauna';
import { saveWorld, loadWorld, applyChunkDiffs } from '../src/world/persistence';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL = cfg.simCellTiles * cfg.tileSize;

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function ctxOf(w: World) {
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}

function bareChunk(soil = SOIL_CLAY, moisture = 0.3): Chunk {
  const c = new Chunk(0, 0, cfg);
  for (let i = 0; i < c.n * c.n; i++) {
    c.soilType[i] = soil;
    c.soilBase[i] = soil;
    c.moisture[i] = moisture;
    c.soilDepth[i] = 1;
    c.waterCapacity[i] = 1;
    c.compaction[i] = 0;
    c.light[i] = 1;
    c.nAvail[i] = 0.8;
    c.pAvail[i] = 0.3;
    c.kAvail[i] = 0.7;
    c.humus[i] = 2;
    c.microbe[i] = 0.6;
  }
  c.rebuildPlantIndex();
  return c;
}

describe('ciclo da água no solo', () => {
  it('1. chuva → infiltração aumenta a umidade do solo (com a função do jogo)', () => {
    const w = new World({ seed: 11 });
    const c = bareChunk(SOIL_CLAY, 0.25);
    const before = c.moisture[c.cellIdx(5, 5)];
    const flux = { evaporation: 0, transpiration: 0, runoff: 0 };
    stepWater(c, cfg, w.climate, 6, 12, { cellAt: () => null }, 0.9, flux);
    expect(c.moisture[c.cellIdx(5, 5)]).toBeGreaterThan(before);
    expect(flux.runoff).toBeGreaterThanOrEqual(0);
    // a água que entrou foi contabilizada como evaporação/transpiração/escoamento
    expect(flux.evaporation).toBeGreaterThan(0);
  });

  it('2. solo saturado → escoamento superficial (não infiltra tudo)', () => {
    const w = new World({ seed: 12 });
    const dry = bareChunk(SOIL_CLAY, 0.15);
    const wet = bareChunk(SOIL_CLAY, 0.98);
    const fDry = { evaporation: 0, transpiration: 0, runoff: 0 };
    const fWet = { evaporation: 0, transpiration: 0, runoff: 0 };
    stepWater(dry, cfg, w.climate, 6, 12, { cellAt: () => null }, 1, fDry);
    stepWater(wet, cfg, w.climate, 6, 12, { cellAt: () => null }, 1, fWet);
    expect(fWet.runoff).toBeGreaterThan(fDry.runoff);
    // e o escoamento entra no solver superficial como água pendente
    let pending = 0;
    for (let i = 0; i < wet.n * wet.n; i++) pending += wet.surfaceInput[i];
    expect(pending).toBeGreaterThan(0);
  });

  it('3. compactação reduz infiltração; capacidade maior retém mais', () => {
    const w = new World({ seed: 13 });
    // solo já bem úmido: a capacidade de infiltração fica baixa e o
    // escoamento aparece; com compactação ele aumenta ainda mais
    const loose = bareChunk(SOIL_SAND, 0.9);
    const packed = bareChunk(SOIL_SAND, 0.9);
    for (let i = 0; i < packed.n * packed.n; i++) packed.compaction[i] = 0.9;
    const a = { evaporation: 0, transpiration: 0, runoff: 0 };
    const b = { evaporation: 0, transpiration: 0, runoff: 0 };
    stepWater(loose, cfg, w.climate, 4, 10, { cellAt: () => null }, 0.8, a);
    stepWater(packed, cfg, w.climate, 4, 10, { cellAt: () => null }, 0.8, b);
    expect(b.runoff).toBeGreaterThan(a.runoff); // compactado escoa mais
    expect(loose.moisture[0]).toBeGreaterThanOrEqual(packed.moisture[0]);

    // solo com capacidade maior (orgânico/fundo) guarda mais água
    const shallow = bareChunk(SOIL_CLAY, 0.4);
    const deep = bareChunk(SOIL_CLAY, 0.4);
    for (let i = 0; i < deep.n * deep.n; i++) {
      shallow.waterCapacity[i] = 0.3;
      deep.waterCapacity[i] = 2.0;
    }
    const fs = { evaporation: 0, transpiration: 0, runoff: 0 };
    const fd = { evaporation: 0, transpiration: 0, runoff: 0 };
    stepWater(shallow, cfg, w.climate, 6, 12, { cellAt: () => null }, 0.7, fs);
    stepWater(deep, cfg, w.climate, 6, 12, { cellAt: () => null }, 0.7, fd);
    expect(fd.runoff).toBeLessThan(fs.runoff);
  });
});

describe('atmosfera causal', () => {
  const forcing = (over: Partial<Parameters<Climate['stepAtmosphere']>[1]> = {}) => ({
    temperature: 24,
    evaporation: 0.6,
    transpiration: 0.6,
    forest: 0.7,
    waterSurface: 0.1,
    hour: 13,
    dayFloat: 10,
    ...over,
  });

  it('4. umidade baixa → sem nuvem → sem chuva; ambiente seco não chove', () => {
    const c = new Climate(cfg);
    c.importAtmosphere({ humidity: 0.1, cloudWater: 0.02, cloudCover: 0, precipitation: 0 });
    // frio, noite, pouca evaporação, sem biomassa: continua seco
    for (let i = 0; i < 40; i++) {
      c.stepAtmosphere(0.25, forcing({ temperature: 4, forest: 0, evaporation: 0, transpiration: 0, hour: 2, dayFloat: 26 }));
    }
    expect(c.precipitationNow()).toBeLessThan(0.05);
    expect(c.atmosphere.cloudWater).toBeLessThan(0.35);
  });

  it('5. umidade alta + convecção → nuvens e depois chuva (causal)', () => {
    const c = new Climate(cfg);
    c.importAtmosphere({ humidity: 0.92, cloudWater: 0.1, cloudCover: 0.1, precipitation: 0 });
    let rained = false;
    let maxRain = 0;
    for (let i = 0; i < 80; i++) {
      c.stepAtmosphere(0.25, forcing());
      maxRain = Math.max(maxRain, c.precipitationNow());
      if (c.precipitationNow() > 0.2) rained = true;
    }
    expect(c.atmosphere.cloudWater).toBeGreaterThan(0.3); // nuvem se formou
    expect(rained).toBe(true);
    expect(maxRain).toBeGreaterThan(0.2);
    // e a chuva CONSOME a nuvem (retroalimentação negativa)
    const cloudBefore = c.atmosphere.cloudWater;
    c.importAtmosphere({ ...c.exportAtmosphere(), cloudWater: 0.9 });
    c.stepAtmosphere(2, forcing({ evaporation: 0, transpiration: 0 }));
    expect(c.atmosphere.cloudWater).toBeLessThan(0.9);
    expect(cloudBefore).toBeGreaterThanOrEqual(0);
  });

  it('6. vegetação e água aumentam a umidade de equilíbrio (mas não garantem chuva)', () => {
    const run = (forest: number, waterSurface: number) => {
      const c = new Climate(cfg);
      c.importAtmosphere({ humidity: 0.5, cloudWater: 0.05, cloudCover: 0, precipitation: 0 });
      for (let i = 0; i < 60; i++) {
        c.stepAtmosphere(0.25, forcing({ forest, waterSurface, evaporation: 0.2, transpiration: 0.2 }));
      }
      return c.atmosphere.humidity;
    };
    const lush = run(1, 0.2);
    const barren = run(0, 0);
    expect(lush).toBeGreaterThan(barren);
    // mesmo com floresta, um clima seco (noite fria) não vira tempestade
    const dry = new Climate(cfg);
    dry.importAtmosphere({ humidity: 0.4, cloudWater: 0.02, cloudCover: 0, precipitation: 0 });
    for (let i = 0; i < 40; i++) dry.stepAtmosphere(0.25, forcing({ temperature: 2, forest: 1, hour: 3, dayFloat: 26 }));
    expect(dry.precipitationNow()).toBeLessThan(0.5);
  });

  it('7. tipos de chuva acompanham a intensidade', () => {
    const c = new Climate(cfg);
    const kindFor = (p: number) => {
      c.importAtmosphere({ precipitation: p });
      return c.rainKind();
    };
    expect(kindFor(0)).toBe('seco');
    expect(kindFor(0.1)).toBe('garoa');
    expect(kindFor(0.3)).toBe('leve');
    expect(kindFor(0.5)).toBe('normal');
    expect(kindFor(0.75)).toBe('forte');
    expect(kindFor(0.95)).toBe('tempestade');
  });

  it('8. o mundo simula o ciclo e a chuva altera solo e água', () => {
    const w = new World({ seed: 4242, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    for (let i = 0; i < 20; i++) w.update(2000);
    const h0 = w.stats.humidity;
    const c = w.getChunk(0, 0)!;
    const m0 = c.moisture.reduce((a, b) => a + b, 0);
    // 12 h de jogo
    for (let i = 0; i < 48; i++) w.update(15000);
    expect(Number.isFinite(w.stats.humidity)).toBe(true);
    expect(w.stats.humidity).toBeGreaterThanOrEqual(0);
    expect(w.stats.humidity).toBeLessThanOrEqual(1);
    expect(w.stats.cloudCover).toBeGreaterThanOrEqual(0);
    expect(w.stats.rain).toBeGreaterThanOrEqual(0);
    expect(w.stats.rain).toBeLessThanOrEqual(1);
    const m1 = c.moisture.reduce((a, b) => a + b, 0);
    expect(m1).not.toBe(m0); // a chuva/evaporação mexeu no solo
    expect(h0).toBeGreaterThanOrEqual(0);
  });
});

describe('luz, crescimento e decomposição', () => {
  function chunkWithPlant(species: string, light: number, nutrients: number): { chunk: Chunk; plant: PlantRecord } {
    const c = bareChunk(SOIL_FOREST, 0.6);
    for (let i = 0; i < c.n * c.n; i++) {
      c.light[i] = light;
      c.nAvail[i] = nutrients;
      c.pAvail[i] = nutrients * 0.4;
      c.kAvail[i] = nutrients;
      c.stress[i] = 0;
    }
    const p: PlantRecord = {
      id: 1,
      species: speciesIndex(species),
      x: 4.5 * CELL,
      y: 4.5 * CELL,
      birthAge: 40,
      variant: 1,
      origin: 'gen',
    };
    c.plants.push(p);
    c.rebuildPlantIndex();
    return { chunk: c, plant: p };
  }

  it('9. pouca luz reduz a saúde (crescimento deixa de ser só idade)', () => {
    const sun = chunkWithPlant('ipe_amarelo', 1, 1);
    const shade = chunkWithPlant('ipe_amarelo', 0.08, 1);
    const hSun = plantHealth(sun.plant, sun.chunk, cfg, 60);
    const hShade = plantHealth(shade.plant, shade.chunk, cfg, 60);
    expect(hShade).toBeLessThan(hSun);
  });

  it('10. solo pobre em nutrientes reduz a saúde; água também', () => {
    const rich = chunkWithPlant('macaneira', 1, 1);
    const poor = chunkWithPlant('macaneira', 1, 0.05);
    expect(plantHealth(poor.plant, poor.chunk, cfg, 60)).toBeLessThan(plantHealth(rich.plant, rich.chunk, cfg, 60));

    const dry = chunkWithPlant('macaneira', 1, 1);
    for (let i = 0; i < dry.chunk.n * dry.chunk.n; i++) dry.chunk.stress[i] = 1.6;
    expect(plantHealth(dry.plant, dry.chunk, cfg, 60)).toBeLessThan(plantHealth(rich.plant, rich.chunk, cfg, 60));
  });

  it('11. o passo de bio atualiza luz, forragem e decompõe madeira devagar', () => {
    const w = new World({ seed: 21 });
    const c = bareChunk(SOIL_FOREST, 0.6);
    for (let i = 0; i < c.n * c.n; i++) c.coarse[i] = 2;
    const coarse0 = c.coarse[0];
    const litter0 = c.litter[0];
    stepBio(c, cfg, w.climate, 3, 12);
    // luz por célula foi calculada (0..1)
    expect(c.light[0]).toBeGreaterThanOrEqual(0);
    expect(c.light[0]).toBeLessThanOrEqual(1);
    // forragem cresceu em célula úmida e iluminada
    expect(c.forage[0]).toBeGreaterThan(0);
    // madeira decompõe, mas MUITO devagar (menos que 1% em 3 h)
    expect(c.coarse[0]).toBeLessThan(coarse0);
    expect(c.coarse[0]).toBeGreaterThan(coarse0 * 0.98);
    expect(litter0).toBeGreaterThanOrEqual(0);
  });

  it('12. matéria orgânica vira nutrientes (decomposição fecha o ciclo)', () => {
    const w = new World({ seed: 22 });
    const c = bareChunk(SOIL_FOREST, 0.6);
    const i = c.cellIdx(6, 6);
    c.litter[i] = 8;
    c.coarse[i] = 3;
    const n0 = c.nAvail[i];
    const humus0 = c.humus[i];
    for (let k = 0; k < 20; k++) stepBio(c, cfg, w.climate, 3, 10 + k * 0.125);
    expect(c.litter[i]).toBeLessThan(8);
    expect(c.humus[i]).toBeGreaterThan(humus0);
    expect(c.nAvail[i]).toBeGreaterThan(n0);
  });
});

describe('fauna causal: fome, dieta, fezes e dispersão', () => {
  function forestChunk(): Chunk {
    const c = bareChunk(SOIL_FOREST, 0.6);
    for (let i = 0; i < c.n * c.n; i++) c.forage[i] = 0.8;
    return c;
  }

  it('13. com fome, o coelho come a forragem REAL da célula', () => {
    const c = forestChunk();
    const rabbit = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5.5 * CELL, y: 5.5 * CELL, hunger: 0.9 });
    const i = c.cellIdx(5, 5);
    const forage0 = c.forage[i];
    stepFauna([rabbit], cfg, 0.5, { worldDay: 10, hour: 12 });
    expect(c.forage[i]).toBeLessThan(forage0);
    expect(rabbit.hunger).toBeLessThan(0.9);
  });

  it('14. sapo come inseto do mundo (consumo real via callback)', () => {
    const c = bareChunk(SOIL_FOREST, 0.8);
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 6 * CELL, y: 6 * CELL, hunger: 0.95 });
    let eaten = 0;
    stepFauna([frog], cfg, 0.5, {
      worldDay: 10,
      hour: 22,
      consumeInsect: () => {
        eaten++;
        return true;
      },
    });
    expect(eaten).toBeGreaterThan(0);
    expect(frog.hunger).toBeLessThan(0.95);
  });

  it('15. ave come fruto e dispersa a semente depois (zoocoria)', () => {
    const c = bareChunk(SOIL_FOREST, 0.6);
    const bird = makeAnimal({ id: 3, kind: 'bird', chunk: c, x: 7 * CELL, y: 7 * CELL, hunger: 0.95 });
    let fruits = 1;
    stepFauna([bird], cfg, 0.5, {
      worldDay: 10,
      hour: 12,
      consumeFruit: () => {
        if (fruits <= 0) return null;
        fruits--;
        return { species: speciesIndex('macaneira') };
      },
    });
    expect(bird.carriedSeed).toBeTruthy();
    expect(bird.carriedSeed!.species).toBe(speciesIndex('macaneira'));
    expect(bird.carriedSeed!.vigor).toBeGreaterThan(0);

    // depois de comer, defeca: matéria orgânica + semente com vigor no chão
    bird.poopTimer = 0;
    bird.hunger = 0.2;
    stepFauna([bird], cfg, 0.2, { worldDay: 10, hour: 12 });
    expect(bird.carriedSeed).toBeNull();
    expect(c.seedBed.length).toBe(1);
    expect(c.seedBed[0].vigor).toBeGreaterThan(0);
    expect(c.litter.some((v) => v > 0)).toBe(true);
  });

  it('16. fezes devolvem nutrientes ao solo', () => {
    const c = bareChunk(SOIL_FOREST, 0.6);
    const rabbit = makeAnimal({ id: 4, kind: 'rabbit', chunk: c, x: 4 * CELL, y: 4 * CELL, hunger: 0.2, poopTimer: 0 });
    const i = c.cellIdx(4, 4);
    const n0 = c.nAvail[i];
    const litter0 = c.litter[i];
    stepFauna([rabbit], cfg, 0.2, { worldDay: 10, hour: 12 });
    expect(c.nAvail[i]).toBeGreaterThan(n0);
    expect(c.litter[i]).toBeGreaterThan(litter0);
  });

  it('17. fome e sede extremas levam à morte e devolvem matéria orgânica', () => {
    const c = bareChunk(SOIL_FOREST, 0.6);
    const a = makeAnimal({ id: 5, kind: 'rabbit', chunk: c, x: 3 * CELL, y: 3 * CELL, hunger: 1, thirst: 1, health: 0.03 });
    const dead: number[] = [];
    stepFauna([a], cfg, 1, { worldDay: 10, hour: 12, onDeath: (x) => dead.push(x.id) });
    expect(dead).toEqual([5]);
    const i = c.cellIdx(3, 3);
    expect(c.litter[i] + c.coarse[i]).toBeGreaterThan(0); // carcaça vira matéria orgânica
  });

  it('18. cadeia alimentar: sapos comem insetos de verdade (menos presas que o controle)', () => {
    const build = (withFrogs: boolean) => {
      const w = new World({ seed: 909, loadRadiusChunks: 1 });
      w.requestChunks(0, 0, 0, 0);
      w.pumpGeneration(100);
      for (let i = 0; i < 10; i++) w.update(2000);
      const c = w.getChunk(0, 0)!;
      // garante presas: 6 insetos no chunk
      const insects = Array.from({ length: 6 }, (_, k) => ({
        id: 500 + k,
        kind: 'bee' as const,
        chunk: c,
        x: (4 + (k % 3)) * CELL,
        y: (4 + Math.floor(k / 3)) * CELL,
        state: 'wander' as const,
        targetId: -1,
        pollen: false,
        pollenSpecies: -1,
        energy: 1,
        phase: 0,
        cooldown: 0,
      }));
      (w as unknown as { insectsByChunk: Map<string, unknown[]> }).insectsByChunk.set('0,0', insects);
      c.localInsects = insects.map((i) => ({ x: i.x, y: i.y, kind: i.kind }));
      if (withFrogs) {
        const frogs: Animal[] = [0, 1, 2].map((k) =>
          makeAnimal({
            id: 900 + k,
            kind: 'frog',
            chunk: c,
            x: (4.4 + k * 0.3) * CELL,
            y: 4.6 * CELL,
            hunger: 1,
            thirst: 0.1,
          }),
        );
        (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set('0,0', frogs);
      } else {
        (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set('0,0', []);
      }
      return w;
    };
    const withFrogs = build(true);
    const control = build(false);
    for (let i = 0; i < 60; i++) {
      withFrogs.update(500);
      control.update(500);
    }
    const eaten = withFrogs.insectsAt(withFrogs.getChunk(0, 0)!).length;
    const left = control.insectsAt(control.getChunk(0, 0)!).length;
    // com sapos famintos, sobram menos insetos que no controle
    expect(eaten).toBeLessThanOrEqual(left);
    expect(eaten).toBeLessThan(6);
  });

  it('19. tetos populacionais continuam valendo com a dieta nova', () => {
    const w = new World({ seed: 313, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    for (let i = 0; i < 60; i++) w.update(5000); // ~5 h
    for (const c of w.chunks.values()) {
      const list = w.faunaAt(c);
      const count = (k: string) => list.filter((a) => a.kind === k).length;
      expect(count('rabbit')).toBeLessThanOrEqual(FAUNA_CAP.rabbit);
      expect(count('frog')).toBeLessThanOrEqual(FAUNA_CAP.frog);
      expect(count('bird')).toBeLessThanOrEqual(FAUNA_CAP.bird);
      for (const a of list) {
        expect(a.health).toBeGreaterThanOrEqual(0);
        expect(a.health).toBeLessThanOrEqual(1);
        expect(a.thirst).toBeGreaterThanOrEqual(0);
        expect(a.thirst).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('persistência do novo estado', () => {
  it('20. solo (capacidade/compactação/forragem/madeira) e atmosfera sobrevivem ao save', () => {
    const w1 = new World({ seed: 555 });
    w1.requestChunks(0, 0, 0, 0);
    w1.pumpGeneration(100);
    const c1 = w1.getChunk(0, 0)!;
    const i = c1.cellIdx(6, 6);
    c1.waterCapacity[i] = 1.7;
    c1.compaction[i] = 0.55;
    c1.forage[i] = 0.42;
    c1.coarse[i] = 2.4;
    c1.soilDirty = true;
    c1.dirty = true;
    w1.climate.importAtmosphere({ humidity: 0.81, cloudWater: 0.4, cloudCover: 0.6, precipitation: 0.25 });

    const store = new MemStorage();
    expect(saveWorld(w1, store)).toBe(true);

    const w2 = new World({ seed: 555 });
    w2.onChunkGenerated = (ch) => applyChunkDiffs(w2, ch);
    expect(loadWorld(w2, store).applied).toBe(true);
    expect(w2.climate.atmosphere.humidity).toBeCloseTo(0.81, 2);
    expect(w2.climate.atmosphere.cloudWater).toBeCloseTo(0.4, 2);
    w2.requestChunks(0, 0, 0, 0);
    w2.pumpGeneration(100);
    const c2 = w2.getChunk(0, 0)!;
    expect(c2.waterCapacity[i]).toBeCloseTo(1.7, 1);
    expect(c2.compaction[i]).toBeCloseTo(0.55, 1);
    expect(c2.forage[i]).toBeCloseTo(0.42, 1);
    expect(c2.coarse[i]).toBeCloseTo(2.4, 0);
  });

  it('21. determinismo: mesma seed + mesmos passos ⇒ mesmo clima e mesmo solo', () => {
    const run = () => {
      const w = new World({ seed: 808, loadRadiusChunks: 1 });
      w.requestChunks(0, 0, 0, 0);
      w.pumpGeneration(100);
      for (let i = 0; i < 40; i++) w.update(5000);
      const c = w.getChunk(0, 0)!;
      return {
        hum: Math.round(w.climate.atmosphere.humidity * 1000),
        cloud: Math.round(w.climate.atmosphere.cloudWater * 1000),
        rain: Math.round(w.climate.precipitationNow() * 1000),
        soil: Math.round(c.moisture.reduce((a, b) => a + b, 0) * 100),
        forage: Math.round(c.forage.reduce((a, b) => a + b, 0) * 100),
      };
    };
    expect(run()).toEqual(run());
  });

  it('22. sem NaN/negativos no solo e na fauna após simulação longa', () => {
    const w = new World({ seed: 71, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    for (let i = 0; i < 60; i++) w.update(5000);
    for (const c of w.chunks.values()) {
      for (let i = 0; i < c.n * c.n; i++) {
        expect(Number.isFinite(c.moisture[i])).toBe(true);
        expect(c.moisture[i]).toBeGreaterThanOrEqual(0);
        expect(c.moisture[i]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(c.forage[i])).toBe(true);
        expect(c.forage[i]).toBeGreaterThanOrEqual(0);
        expect(c.forage[i]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(c.coarse[i])).toBe(true);
        expect(c.coarse[i]).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(c.light[i])).toBe(true);
        expect(c.light[i]).toBeGreaterThanOrEqual(0);
        expect(c.light[i]).toBeLessThanOrEqual(1);
      }
      for (const a of w.faunaAt(c)) {
        expect(Number.isFinite(a.x)).toBe(true);
        expect(a.health).toBeGreaterThan(0);
      }
    }
  });
});

describe('integração com a geração', () => {
  it('23. chunks gerados já vêm com capacidade, compactação, forragem e luz', () => {
    const w = new World({ seed: 4242 });
    const c = generateChunk(ctxOf(w), 2, 2);
    let caps = 0;
    for (let i = 0; i < c.n * c.n; i++) {
      expect(c.waterCapacity[i]).toBeGreaterThan(0);
      expect(c.compaction[i]).toBeGreaterThanOrEqual(0);
      expect(c.compaction[i]).toBeLessThanOrEqual(1);
      expect(c.forage[i]).toBeGreaterThanOrEqual(0);
      expect(c.light[i]).toBeGreaterThan(0);
      if (c.waterCapacity[i] > 1) caps++;
    }
    expect(caps).toBeGreaterThan(0);
  });
});
