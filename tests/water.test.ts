/**
 * Testes da física da água: conservação, escoamento por gravidade, depressões,
 * transbordamento, chuva, sumidouros, vegetação, chunks e estabilidade.
 *
 * Os testes usam a MESMA função do jogo (`stepWaterPhysics`), sobre chunks
 * construídos manualmente para que as condições iniciais sejam exatas.
 */
import { describe, expect, it } from 'vitest';
import { Chunk, SOIL_CLAY, SOIL_SAND } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import {
  stepWaterPhysics,
  applyFlowImpacts,
  totalWaterVolume,
  type WaterPhysicsOptions,
  type WaterRegion,
} from '../src/world/water';
import { SPECIES, speciesIndex, type PlantRecord } from '../src/world/flora';
import { generateChunk } from '../src/world/gen';
import { saveWorld, loadWorld, applyChunkDiffs } from '../src/world/persistence';
import { World } from '../src/world/world';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };

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

const CLOSED: WaterPhysicsOptions = {
  sources: { springs: false },
  sinks: { evaporation: false, infiltration: false, drainage: false },
  vegetation: false,
};

interface CellSpec {
  elev: number;
  depth?: number;
  base?: number;
  kind?: number;
  soil?: number;
  moisture?: number;
}

function makeChunk(
  cx: number,
  cy: number,
  spec: (lx: number, ly: number, gx: number, gy: number) => CellSpec,
): Chunk {
  const c = new Chunk(cx, cy, cfg);
  for (let ly = 0; ly < c.n; ly++) {
    for (let lx = 0; lx < c.n; lx++) {
      const i = c.cellIdx(lx, ly);
      const s = spec(lx, ly, cx * c.n + lx, cy * c.n + ly);
      c.elev[i] = s.elev;
      c.waterDepth[i] = s.depth ?? 0;
      c.waterBase[i] = s.base ?? s.depth ?? 0;
      c.waterKind[i] = s.kind ?? 0;
      c.soilType[i] = s.soil ?? SOIL_CLAY;
      c.soilDepth[i] = 1;
      c.moisture[i] = s.moisture ?? 0.45;
    }
  }
  c.rebuildPlantIndex();
  return c;
}

function regionOf(chunks: Chunk[], config: WorldConfig = cfg): WaterRegion {
  const map = new Map<string, Chunk>();
  for (const c of chunks) map.set(`${c.cx},${c.cy}`, c);
  const n = chunks[0].n;
  return {
    cfg: config,
    waterChunks: () => chunks,
    cellAt: (gx: number, gy: number) => map.get(`${Math.floor(gx / n)},${Math.floor(gy / n)}`) ?? null,
  };
}

const volume = (chunks: Chunk[], config: WorldConfig = cfg) => totalWaterVolume(chunks, config);

function centerOfMassX(c: Chunk): number {
  let w = 0;
  let s = 0;
  for (let i = 0; i < c.waterDepth.length; i++) {
    w += c.waterDepth[i];
    s += c.waterDepth[i] * (i % c.n);
  }
  return w > 0 ? s / w : 0;
}

function addPlant(c: Chunk, id: number, species: number, lx: number, ly: number, worldDay = 200): void {
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const p: PlantRecord = {
    id,
    species,
    x: (c.cx * c.n + lx + 0.5) * cellPx,
    y: (c.cy * c.n + ly + 0.5) * cellPx,
    birthAge: worldDay,
    variant: id % 997,
    origin: 'gen',
  };
  c.plants.push(p);
  c.rebuildPlantIndex();
}

function maxSpeed(c: Chunk): number {
  let max = 0;
  for (let i = 0; i < c.n * c.n; i++) max = Math.max(max, Math.hypot(c.flowX[i], c.flowY[i]));
  return max;
}

describe('física da água', () => {
  it('1. água em terreno inclinado escoa para as regiões mais baixas', () => {
    const c = makeChunk(0, 0, (lx) => ({ elev: 10 - lx * 0.5, depth: lx < 2 ? 0.8 : 0 }));
    const region = regionOf([c]);
    const v0 = volume([c]);
    const com0 = centerOfMassX(c);
    for (let s = 0; s < 300; s++) stepWaterPhysics(region, 0.02, CLOSED);
    const com1 = centerOfMassX(c);
    expect(com1).toBeGreaterThan(com0 + 3); // a água desceu a encosta
    expect(c.waterDepth[c.cellIdx(0, 8)]).toBeLessThan(0.2); // a origem esvaziou
    expect(c.waterDepth[c.cellIdx(10, 8)]).toBeGreaterThan(0.01); // destino recebeu água
    expect(volume([c]) / v0).toBeCloseTo(1, 5);
  });

  it('2. em terreno plano a água se distribui e não oscila indefinidamente', () => {
    const c = makeChunk(0, 0, (lx, ly) => ({ elev: 5, depth: lx === 7 && ly === 7 ? 1 : 0 }));
    const region = regionOf([c]);
    const v0 = volume([c]);
    // quatro janelas: a variância deve cair sempre (difusão sem oscilação)
    let previousVariance = Infinity;
    for (let phase = 0; phase < 4; phase++) {
      for (let s = 0; s < 2000; s++) stepWaterPhysics(region, 0.02, CLOSED);
      let sum = 0;
      for (let i = 0; i < c.n * c.n; i++) sum += c.waterDepth[i];
      const mean = sum / (c.n * c.n);
      let variance = 0;
      let max = 0;
      for (let i = 0; i < c.n * c.n; i++) {
        variance += (c.waterDepth[i] - mean) ** 2;
        max = Math.max(max, c.waterDepth[i]);
      }
      variance /= c.n * c.n;
      expect(variance).toBeLessThan(previousVariance);
      previousVariance = variance;
      if (phase === 3) expect(max).toBeLessThan(mean * 3.2);
    }
    const mean = v0 / (cfg.waterCellMeters ** 2) / (c.n * c.n);
    expect(mean).toBeGreaterThan(0);
    expect(volume([c]) / v0).toBeCloseTo(1, 5);
    expect(maxSpeed(c)).toBeLessThan(0.001); // praticamente parada: equilíbrio
  });

  it('3. uma depressão acumula água (e não drena pela lateral)', () => {
    const c = makeChunk(0, 0, (lx, ly) => {
      const bowl = lx >= 6 && lx <= 9 && ly >= 6 && ly <= 9;
      return { elev: bowl ? 3 : 7, depth: bowl && lx >= 7 && lx <= 8 && ly >= 7 && ly <= 8 ? 0.8 : 0 };
    });
    const region = regionOf([c]);
    const v0 = volume([c]);
    for (let s = 0; s < 500; s++) stepWaterPhysics(region, 0.02, CLOSED);
    const inside = c.waterDepth[c.cellIdx(7, 7)];
    expect(inside).toBeGreaterThan(0.1);
    // a borda da bacia permanece seca: a água ficou retida
    expect(c.waterDepth[c.cellIdx(5, 7)]).toBe(0);
    expect(volume([c]) / v0).toBeCloseTo(1, 5);
  });

  it('4. uma depressão cheia transborda ao atingir uma saída mais baixa', () => {
    const c = makeChunk(0, 0, (lx, ly) => {
      const bowl = lx >= 6 && lx <= 9 && ly >= 6 && ly <= 9;
      // saída: corredor a leste da bacia numa cota intermediária
      const outlet = ly >= 7 && ly <= 8 && lx >= 10 && lx <= 15;
      const elev = bowl ? 2 : outlet ? 2.6 : 4;
      return { elev, depth: bowl ? 1.8 : 0 };
    });
    const region = regionOf([c]);
    const v0 = volume([c]);
    for (let s = 0; s < 1200; s++) stepWaterPhysics(region, 0.02, CLOSED);
    // a água preencheu a bacia até a cota da saída e seguiu para leste
    expect(c.waterDepth[c.cellIdx(12, 7)]).toBeGreaterThan(0.05);
    expect(c.waterDepth[c.cellIdx(15, 7)]).toBeGreaterThan(0.01);
    expect(volume([c]) / v0).toBeCloseTo(1, 5);
  });

  it('5. conserva o volume total sem chuva, infiltração ou evaporação', () => {
    const chunks = [
      makeChunk(0, 0, (lx, ly) => ({
        elev: 20 - lx * 0.35 - ly * 0.2 + Math.sin(lx * 1.3) * 0.4,
        depth: (lx + ly * 3) % 7 === 0 ? 0.4 : lx === 15 ? 0.2 : 0,
      })),
      makeChunk(1, 0, (lx, ly) => ({
        elev: 14 - lx * 0.35 - ly * 0.2 + Math.sin(lx * 1.3) * 0.4,
        depth: (lx + ly) % 5 === 0 ? 0.3 : 0,
      })),
    ];
    const region = regionOf(chunks);
    const v0 = volume(chunks);
    for (let s = 0; s < 600; s++) stepWaterPhysics(region, 0.02, CLOSED);
    expect(volume(chunks) / v0).toBeCloseTo(1, 5);
  });

  it('6. chuva aumenta o volume de forma previsível', () => {
    const c = makeChunk(0, 0, () => ({ elev: 5, depth: 0 }));
    const region = regionOf([c]);
    const layer = 0.01; // 1 cm em cada célula
    for (let i = 0; i < c.n * c.n; i++) c.surfaceInput[i] = layer;
    const v0 = volume([c]);
    const budget = stepWaterPhysics(region, 0.02, { ...CLOSED });
    const v1 = volume([c]);
    const expected = layer * c.n * c.n * cfg.waterCellMeters ** 2;
    expect(budget.rain).toBeCloseTo(expected, 4);
    expect(v1 - v0).toBeCloseTo(expected, 4);
  });

  it('7. evaporação e infiltração reduzem o volume conforme as regras', () => {
    // evaporação
    const evap = makeChunk(0, 0, () => ({ elev: 5, depth: 0.5, moisture: 0.05 }));
    const evapRegion = regionOf([evap]);
    const vE0 = volume([evap]);
    const budgetE = stepWaterPhysics(evapRegion, 10, {
      sources: { springs: false },
      sinks: { evaporation: true, infiltration: false, drainage: false },
      vegetation: false,
      temperature: 30,
      daylight: 1,
    });
    const lossE = vE0 - volume([evap]);
    expect(lossE).toBeGreaterThan(0);
    expect(Math.abs(budgetE.evaporation - lossE) / lossE).toBeLessThan(1e-4);

    // infiltração em solo arenoso
    const inf = makeChunk(0, 0, () => ({ elev: 5, depth: 0.5, soil: SOIL_SAND, moisture: 0.1 }));
    const infRegion = regionOf([inf]);
    const vI0 = volume([inf]);
    const beforeMoisture = inf.moisture[0];
    const budgetI = stepWaterPhysics(infRegion, 5, {
      sources: { springs: false },
      sinks: { evaporation: false, infiltration: true, drainage: false },
      vegetation: false,
    });
    const lossI = vI0 - volume([inf]);
    expect(lossI).toBeGreaterThan(0);
    expect(Math.abs(budgetI.infiltration - lossI) / lossI).toBeLessThan(1e-4);
    expect(inf.moisture[0]).toBeGreaterThan(beforeMoisture);
  });

  it('8. uma enchente inunda células vizinhas', () => {
    const c = makeChunk(0, 0, (lx, ly) => {
      const channel = ly >= 7 && ly <= 8 && lx >= 4 && lx <= 12;
      return { elev: channel ? 4 : 4.25, depth: lx === 8 && channel ? 2.2 : 0 };
    });
    const region = regionOf([c]);
    const v0 = volume([c]);
    const neighbors = [[8, 6], [8, 9], [7, 7], [9, 7]];
    for (const [x, y] of neighbors) expect(c.waterDepth[c.cellIdx(x, y)]).toBe(0);
    for (let s = 0; s < 400; s++) stepWaterPhysics(region, 0.02, CLOSED);
    const wetted = neighbors.filter(([x, y]) => c.waterDepth[c.cellIdx(x, y)] > 0.01).length;
    expect(wetted).toBeGreaterThanOrEqual(2);
    expect(volume([c]) / v0).toBeCloseTo(1, 5);
  });

  it('9. correnteza intensa arranca planta vulnerável, mas não toda a vegetação', () => {
    const c = makeChunk(0, 0, (lx, ly) => ({
      elev: 5 - lx * 0.1,
      depth: lx === 3 && ly >= 3 && ly <= 6 ? 1.2 : 0,
    }));
    const ipe = speciesIndex('ipe_amarelo');
    const salgueiro = speciesIndex('salgueiro');
    for (let k = 0; k < 4; k++) {
      addPlant(c, 100 + k, ipe, 3, 3 + k); // vulneráveis, no canal
      addPlant(c, 200 + k, salgueiro, 3, 3 + k); // tolerantes, no canal
      addPlant(c, 300 + k, ipe, 10, 2 + k); // secas, fora do canal
    }
    // correnteza forte no canal
    for (let k = 0; k < 4; k++) {
      const i = c.cellIdx(3, 3 + k);
      c.flowX[i] = 2.0;
      c.floodHours[i] = 8;
    }
    for (let step = 0; step < 24; step++) applyFlowImpacts([c], cfg, 1, step + 1);
    const removed = [...c.removedPlants];
    const removedIpeChannel = [100, 101, 102, 103].filter((id) => removed.includes(id)).length;
    const removedDry = [300, 301, 302, 303].filter((id) => removed.includes(id)).length;
    const removedSalgueiro = [200, 201, 202, 203].filter((id) => removed.includes(id)).length;
    expect(removedIpeChannel).toBeGreaterThan(0); // espécie intolerante foi arrancada
    expect(removedIpeChannel).toBeLessThanOrEqual(4);
    expect(removedDry).toBe(0);
    expect(removedSalgueiro).toBe(0); // tolerante à inundação resiste
    // não removeu toda a vegetação: árvores secas e tolerantes permanecem
    expect(removed.length).toBeLessThan(c.plants.length * 0.75);
  });

  it('10. transfere água entre chunks adjacentes sem perder nem duplicar', () => {
    const chunks = [
      makeChunk(0, 0, (lx, ly, gx) => ({ elev: 20 - gx * 0.4, depth: gx === 15 && ly >= 7 && ly <= 9 ? 1 : 0 })),
      makeChunk(1, 0, (lx, ly, gx) => ({ elev: 20 - gx * 0.4, depth: 0 })),
    ];
    const region = regionOf(chunks);
    const v0 = volume(chunks);
    for (let s = 0; s < 400; s++) stepWaterPhysics(region, 0.02, CLOSED);
    let received = 0;
    let lostAtBorder = 0;
    for (let ly = 0; ly < 16; ly++) {
      received += chunks[1].waterDepth[chunks[1].cellIdx(0, ly)];
      lostAtBorder += chunks[0].waterDepth[chunks[0].cellIdx(15, ly)];
    }
    expect(received).toBeGreaterThan(0.05); // atravessou a fronteira
    expect(lostAtBorder).toBeLessThan(1); // a borda de origem escoou
    expect(volume(chunks) / v0).toBeCloseTo(1, 5);
  });

  it('11. não gera NaN, valores negativos ou crescimento infinito', () => {
    const c = makeChunk(0, 0, (lx, ly) => ({
      elev: 10 + Math.sin(lx * 0.7) * 2 + Math.cos(ly * 0.5) * 2,
      depth: (lx * 7 + ly * 13) % 11 === 0 ? 3 + (lx % 4) : 0,
      base: 0.2,
      kind: 0,
      moisture: 0.05,
    }));
    // condições extremas: uma célula mais funda que o limite e entradas de borda
    c.waterDepth[c.cellIdx(0, 0)] = 80;
    const region = regionOf([c]);
    for (let s = 0; s < 400; s++) {
      c.surfaceInput[c.cellIdx(8, 8)] += 0.002;
      stepWaterPhysics(region, 0.05, { temperature: 45, daylight: 1, vegetation: true });
    }
    let finite = true;
    for (let i = 0; i < c.n * c.n; i++) {
      const d = c.waterDepth[i];
      if (!Number.isFinite(d) || d < 0 || d > cfg.waterMaxDepth + 1e-6) finite = false;
      if (!Number.isFinite(c.flowX[i]) || !Number.isFinite(c.flowY[i])) finite = false;
    }
    expect(finite).toBe(true);
    expect(volume([c])).toBeLessThan(1e9);
  });

  it('12. o resultado não depende da ordem dos chunks', () => {
    const build = () => [
      makeChunk(0, 0, (lx, ly, gx) => ({ elev: 18 - gx * 0.3 - ly * 0.1, depth: gx === 15 && ly === 8 ? 0.8 : 0 })),
      makeChunk(1, 0, (lx, ly, gx) => ({ elev: 18 - gx * 0.3 - ly * 0.1, depth: gx === 16 && ly === 7 ? 0.6 : 0 })),
    ];
    const a = build();
    const b = build();
    for (let s = 0; s < 200; s++) {
      stepWaterPhysics(regionOf(a), 0.02, CLOSED);
      stepWaterPhysics(regionOf([b[1], b[0]]), 0.02, CLOSED); // ordem invertida
    }
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < a[k].n * a[k].n; i++) {
        expect(Math.abs(a[k].waterDepth[i] - b[k].waterDepth[i])).toBeLessThan(1e-9);
      }
    }
    // e a ordem das células não é usada para acumular transferências
    expect(volume(a)).toBeCloseTo(volume(b), 6);
  });

  it('cenário reproduzível: encosta + canal + depressão + árvore (volumes registrados)', () => {
    const c = makeChunk(0, 0, (lx, ly) => {
      const channel = ly >= 7 && ly <= 9;
      const depression = channel && lx >= 11 && lx <= 13;
      const elev = 20 - lx * 0.55 - (channel ? 1.2 : 0) - (depression ? 1.4 : 0);
      let depth = 0;
      if (channel && lx >= 2 && lx <= 10) depth = 0.45;
      if (depression) depth = 1.2;
      return { elev, depth, kind: channel ? 2 : 0 };
    });
    addPlant(c, 501, speciesIndex('ipe_amarelo'), 9, 8);
    addPlant(c, 502, speciesIndex('salgueiro'), 9, 7);

    const region = regionOf([c]);
    const v0 = volume([c]);
    const before = {
      volume: v0,
      channel: c.waterDepth[c.cellIdx(8, 8)],
      depression: c.waterDepth[c.cellIdx(12, 8)],
      downstream: c.waterDepth[c.cellIdx(15, 8)],
      comX: centerOfMassX(c),
      maxDepth: c.maxWaterDepth(),
      trees: c.plants.length,
    };

    for (let s = 0; s < 500; s++) stepWaterPhysics(region, 0.02, CLOSED);

    const after = {
      volume: volume([c]),
      channel: c.waterDepth[c.cellIdx(8, 8)],
      depression: c.waterDepth[c.cellIdx(12, 8)],
      downstream: c.waterDepth[c.cellIdx(15, 8)],
      comX: centerOfMassX(c),
      maxDepth: c.maxWaterDepth(),
      trees: c.plants.length - c.removedPlants.size,
    };
    // registro do cenário (aparece na saída dos testes)
    console.log('[cenário água] antes:', before, 'depois:', after);

    expect(after.volume / before.volume).toBeCloseTo(1, 5); // conservação
    expect(after.comX).toBeGreaterThan(before.comX); // escoou para jusante
    expect(after.downstream).toBeGreaterThan(before.downstream); // alcançou a saída
    expect(after.depression).not.toBe(before.depression); // a depressão mudou de nível
    expect(after.trees).toBeLessThanOrEqual(before.trees);
  });

  it('persistência: lâmina e velocidade da água sobrevivem ao save/load', () => {
    const store = new MemStorage();
    const w1 = new World({ seed: 4321 });
    w1.requestChunks(0, 0, 0, 0);
    w1.pumpGeneration(100);
    const c1 = w1.getChunk(0, 0)!;
    const idx = c1.cellIdx(5, 5);
    c1.waterDepth[idx] = 1.23;
    c1.flowX[idx] = 0.42;
    c1.flowY[idx] = -0.17;
    c1.waterDirty = true;
    expect(saveWorld(w1, store)).toBe(true);

    const w2 = new World({ seed: 4321 });
    w2.onChunkGenerated = (c) => applyChunkDiffs(w2, c);
    expect(loadWorld(w2, store).applied).toBe(true);
    w2.requestChunks(0, 0, 0, 0);
    w2.pumpGeneration(100);
    const c2 = w2.getChunk(0, 0)!;
    expect(Math.abs(c2.waterDepth[idx] - 1.23)).toBeLessThan(0.05); // quantizado em 12 m
    expect(Math.abs(c2.flowX[idx] - 0.42)).toBeLessThan(0.05);
    expect(Math.abs(c2.flowY[idx] + 0.17)).toBeLessThan(0.05);
  });

  it('integração: o mundo gerado simula água, registra orçamento e não desestabiliza', () => {
    const w = new World({ seed: 2024, waterActiveRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunks = [...w.chunks.values()];
    const v0 = totalWaterVolume(chunks, w.cfg);
    const before = chunks.map((c) => Array.from(c.waterDepth));
    for (let i = 0; i < 8; i++) w.update(30000); // 4 h de jogo
    const v1 = totalWaterVolume(chunks, w.cfg);
    let changed = 0;
    for (let k = 0; k < chunks.length; k++) {
      for (let i = 0; i < chunks[k].n * chunks[k].n; i++) {
        if (Math.abs(chunks[k].waterDepth[i] - before[k][i]) > 1e-4) changed++;
        expect(Number.isFinite(chunks[k].waterDepth[i])).toBe(true);
        expect(chunks[k].waterDepth[i]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(changed).toBeGreaterThan(0); // a água mudou de verdade
    expect(w.waterBudget.rain + w.waterBudget.springs).toBeGreaterThan(0);
    expect(w.stats.waterVolume).toBeGreaterThan(0);
    expect(Math.abs(v1 - v0)).toBeLessThan(v0 * 5 + 1e6); // sem divergência
  });
});
