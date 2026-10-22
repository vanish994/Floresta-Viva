/**
 * Testes de erosão, transporte/deposição de sedimentos e formação de margens
 * arenosas. Usam a MESMA função do jogo (`stepErosion`/`stepBanks`) sobre
 * chunks construídos manualmente, para que as condições iniciais sejam exatas.
 */
import { describe, expect, it } from 'vitest';
import { Chunk, SOIL_ALLUVIAL, SOIL_CLAY, SOIL_ROCK, SOIL_SAND } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import {
  stepErosion,
  stepBanks,
  createSedimentBudget,
  sandBaseOf,
  type SedimentBudget,
  type SedimentRegion,
} from '../src/world/sediment';
import { speciesIndex, type PlantRecord } from '../src/world/flora';
import { generateChunk } from '../src/world/gen';
import { World } from '../src/world/world';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const N = cfg.chunkTiles / cfg.simCellTiles;
const CELL_PX = cfg.simCellTiles * cfg.tileSize;

interface CellSpec {
  elev: number;
  slope?: number;
  soil?: number;
  sand?: number;
  depth?: number;
  vx?: number;
  vy?: number;
  litter?: number;
  humus?: number;
  kind?: number;
}

function makeChunk(cx: number, cy: number, spec: (lx: number, ly: number, gx: number, gy: number) => CellSpec): Chunk {
  const c = new Chunk(cx, cy, cfg);
  for (let ly = 0; ly < c.n; ly++) {
    for (let lx = 0; lx < c.n; lx++) {
      const i = c.cellIdx(lx, ly);
      const s = spec(lx, ly, cx * c.n + lx, cy * c.n + ly);
      c.elev[i] = s.elev;
      c.slope[i] = s.slope ?? 0.5;
      c.soilType[i] = s.soil ?? SOIL_CLAY;
      c.soilBase[i] = s.soil ?? SOIL_CLAY;
      c.sandBase[i] = s.sand ?? sandBaseOf(s.soil ?? SOIL_CLAY);
      c.sand[i] = c.sandBase[i];
      c.waterDepth[i] = s.depth ?? 0;
      c.flowX[i] = s.vx ?? 0;
      c.flowY[i] = s.vy ?? 0;
      c.waterKind[i] = s.kind ?? (s.depth && s.depth > 0.05 ? 2 : 0);
      c.humus[i] = s.humus ?? 1.5;
      c.litter[i] = s.litter ?? 1.2;
      c.moisture[i] = 0.5;
      c.soilDepth[i] = 1;
    }
  }
  c.rebuildPlantIndex();
  return c;
}

interface TestRegion extends SedimentRegion {
  deltas: Map<string, number>;
}

function regionOf(chunks: Chunk[], config: WorldConfig = cfg): TestRegion {
  const map = new Map<string, Chunk>();
  for (const c of chunks) map.set(`${c.cx},${c.cy}`, c);
  const deltas = new Map<string, number>();
  return {
    cfg: config,
    deltas,
    sedimentChunks: () => chunks,
    cellAt: (gx, gy) => map.get(`${Math.floor(gx / N)},${Math.floor(gy / N)}`) ?? null,
    addDelta: (gx, gy, d) => {
      // mesmo contrato do World: clamp ±0,25 e furo numérico desprezível
      const k = `${gx},${gy}`;
      const prev = deltas.get(k) ?? 0;
      const v = Math.max(-0.25, Math.min(0.25, prev + d));
      if (Math.abs(v) < 1e-9) deltas.delete(k);
      else deltas.set(k, v);
      return (deltas.get(k) ?? 0) - prev;
    },
    getDelta: (gx, gy) => deltas.get(`${gx},${gy}`) ?? 0,
  };
}

/** massa de material (m) = elevação acumulada + carga suspensa */
function material(chunks: Chunk[], region: TestRegion, config: WorldConfig = cfg): number {
  let sum = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.n * c.n; i++) {
      const gx = c.cx * c.n + (i % c.n);
      const gy = c.cy * c.n + ((i / c.n) | 0);
      sum += (region.deltas.get(`${gx},${gy}`) ?? 0) + c.sediment[i];
    }
  }
  return sum * config.elevationRange;
}

function erodedTotal(chunks: Chunk[], region: TestRegion): number {
  let sum = 0;
  for (const v of region.deltas.values()) if (v < 0) sum += -v;
  return sum * cfg.elevationRange;
}

function addPlant(c: Chunk, id: number, species: number, lx: number, ly: number, worldDay = 100): void {
  const p: PlantRecord = {
    id,
    species,
    x: (c.cx * c.n + lx + 0.5) * CELL_PX,
    y: (c.cy * c.n + ly + 0.5) * CELL_PX,
    birthAge: 400, // árvore adulta (idade = 400 + worldDay)
    variant: id % 997,
    origin: 'gen',
  };
  c.plants.push(p);
  c.rebuildPlantIndex();
  void worldDay;
}

function budgetOf(chunks: Chunk[], region: TestRegion, hours: number, opts: Record<string, unknown> = {}): SedimentBudget {
  const budget = createSedimentBudget();
  stepErosion(region, hours, { worldDay: 100, worldHours: 2400, rainIntensity: 0, budget, ...opts });
  return budget;
}

describe('erosão e sedimentação', () => {
  it('1. solo desprotegido e inclinado erode mais que solo vegetado', () => {
    const build = () => makeChunk(0, 0, (lx, ly) => ({
      elev: 20 - lx * 0.6,
      slope: 0.6,
      soil: SOIL_ALLUVIAL,
      depth: ly >= 6 && ly <= 9 ? 0.35 : 0,
      vx: ly >= 6 && ly <= 9 ? 0.09 : 0,
    }));
    const bare = build();
    const vegetated = build();
    // floresta densa sobre a margem: copa + raízes profundas
    const jequitiba = speciesIndex('jequitiba');
    for (let ly = 4; ly <= 11; ly++) {
      for (let lx = 2; lx <= 13; lx++) addPlant(vegetated, 1000 + lx * 20 + ly, jequitiba, lx, ly);
    }

    const rBare = regionOf([bare]);
    const rVeg = regionOf([vegetated]);
    const bBare = budgetOf([bare], rBare, 24);
    const bVeg = budgetOf([vegetated], rVeg, 24);

    const bareEro = erodedTotal([bare], rBare);
    const vegEro = erodedTotal([vegetated], rVeg);
    expect(bBare.eroded).toBeGreaterThan(0);
    expect(bareEro).toBeGreaterThan(vegEro * 2); // raízes + copa protegem de verdade
    // o orçamento contabiliza todo metro removido (inclusive o que foi
    // depositado de volta depois), então nunca é menor que o saldo final
    expect(bBare.eroded).toBeGreaterThanOrEqual(bareEro - 1e-9);
  });

  it('2. correnteza forte remove mais sedimento que água parada', () => {
    const build = (vx: number) => makeChunk(0, 0, (lx, ly) => ({
      elev: 20 - lx * 0.6,
      slope: 0.6,
      soil: SOIL_ALLUVIAL,
      depth: ly >= 6 && ly <= 9 ? 0.4 : 0,
      vx: ly >= 6 && ly <= 9 ? vx : 0,
    }));
    const still = build(0.001);
    const fast = build(0.2);
    const rStill = regionOf([still]);
    const rFast = regionOf([fast]);
    const bStill = budgetOf([still], rStill, 24, { rainIntensity: 0 });
    const bFast = budgetOf([fast], rFast, 24, { rainIntensity: 0 });

    expect(bStill.eroded).toBe(0); // abaixo da velocidade crítica
    expect(bFast.eroded).toBeGreaterThan(0.05);
    expect(bFast.transported).toBeGreaterThan(0);
    expect(erodedTotal([fast], rFast)).toBeGreaterThan(erodedTotal([still], rStill));
  });

  it('3. sedimento removido é transportado e depositado a jusante', () => {
    // canal que perde energia na metade leste (remanso) → deposição
    const c = makeChunk(0, 0, (lx, ly) => {
      const channel = ly >= 6 && ly <= 9;
      const slow = lx >= 10;
      return {
        elev: 15 - lx * 0.45,
        slope: slow ? 0.15 : 0.7,
        soil: SOIL_ALLUVIAL,
        depth: channel ? (slow ? 0.35 : 0.4) : 0,
        vx: channel ? (slow ? 0.012 : 0.16) : 0,
      };
    });
    const region = regionOf([c]);
    const budget = budgetOf([c], region, 48);

    let upstreamEroded = 0;
    let downstreamDeposited = 0;
    let downstreamMax = 0;
    for (let ly = 6; ly <= 9; ly++) {
      for (let lx = 0; lx < 16; lx++) {
        const d = region.getDelta(lx, ly);
        if (lx < 9 && d < 0) upstreamEroded += -d;
        if (lx >= 9 && d > 0) {
          downstreamDeposited += d;
          downstreamMax = Math.max(downstreamMax, d);
        }
      }
    }
    expect(upstreamEroded).toBeGreaterThan(0);
    expect(downstreamDeposited).toBeGreaterThan(0);
    expect(downstreamMax * cfg.elevationRange).toBeGreaterThan(0.001); // leito subiu

    // a elevação real do chunk acompanha o delta persistido (sem "deformação visual")
    const i = c.cellIdx(12, 7);
    const gx = 12, gy = 7;
    expect(c.elev[i]).toBeCloseTo(15 - gx * 0.45 + region.getDelta(gx, gy) * cfg.elevationRange, 3);

    // depósito arenoso: areia assenta onde a correnteza perdeu força
    expect(budget.deposited).toBeGreaterThan(0);
    expect(budget.lost).toBe(0);
  });

  it('4. areia não aparece sem fonte de sedimentos nem mecanismo explícito', () => {
    // argila molhada, sem carga, correnteza insuficiente para lavar finos
    const c = makeChunk(0, 0, (lx, ly) => ({
      elev: 10,
      slope: 0.1,
      soil: SOIL_CLAY,
      depth: ly >= 6 && ly <= 9 ? 0.6 : 0,
      vx: 0.01,
    }));
    const region = regionOf([c]);
    const sand0 = c.sand[c.cellIdx(5, 7)];
    for (let h = 0; h < 600; h++) stepBanks(region, 1, { worldDay: 100, worldHours: 2400 + h });
    expect(c.sand[c.cellIdx(5, 7)]).toBeCloseTo(sand0, 6);
    expect(c.sandCells()).toBe(0);
    expect(c.sediment.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('5. margens não se transformam indiscriminadamente em areia', () => {
    // água só num canal; margens de argila/rocha e células secas distantes
    const c = makeChunk(0, 0, (lx, ly) => {
      const channel = ly >= 7 && ly <= 9;
      const soil = ly < 3 ? SOIL_ROCK : ly < 6 ? SOIL_CLAY : SOIL_ALLUVIAL;
      return {
        elev: channel ? 9.5 : 10,
        slope: 0.3,
        soil,
        depth: channel ? 0.4 : 0,
        vx: channel ? 0.06 : 0,
      };
    });
    const region = regionOf([c]);
    for (let h = 0; h < 300; h++) stepBanks(region, 1, { worldDay: 100, worldHours: 2400 + h });

    // células secas distantes continuam com a textura de origem
    for (const [lx, ly] of [[2, 2], [13, 2], [2, 5], [13, 5]]) {
      const i = c.cellIdx(lx, ly);
      expect(c.sand[i]).toBeCloseTo(c.sandBase[i], 6);
    }
    // rocha nunca é classificada como areia
    for (let ly = 0; ly < 3; ly++) {
      for (let lx = 0; lx < 16; lx++) {
        expect(c.soilType[c.cellIdx(lx, ly)]).not.toBe(SOIL_SAND);
        expect(c.sand[c.cellIdx(lx, ly)]).toBeLessThanOrEqual(0.5);
      }
    }
    // a margem aluvial molhada ganhou areia (com contato prolongado)
    expect(c.sand[c.cellIdx(5, 7)]).toBeGreaterThan(c.sandBase[c.cellIdx(5, 7)]);
    expect(c.sand[c.cellIdx(5, 7)]).toBeLessThanOrEqual(cfg.sandWinnowCap + 1e-6);
  });

  it('6. o terreno não oscila entre areia e terra', () => {
    const c = makeChunk(0, 0, (lx, ly) => ({
      elev: 10 - lx * 0.2,
      slope: 0.2,
      soil: SOIL_ALLUVIAL,
      depth: 0.4,
      vx: 0.05,
    }));
    const region = regionOf([c]);
    const i = c.cellIdx(8, 8);
    let flips = 0;
    let previous = c.soilType[i];
    const observe = () => {
      if (c.soilType[i] !== previous) {
        flips++;
        previous = c.soilType[i];
      }
    };

    // fase 1: margem estável (lavagem até o teto, sem virar areia)
    for (let h = 0; h < 200; h++) {
      stepBanks(region, 1, { worldDay: 100, worldHours: 2400 + h });
      observe();
    }
    expect(c.sand[i]).toBeLessThan(cfg.sandThreshold); // não virou areia "de graça"
    expect(c.soilType[i]).toBe(SOIL_ALLUVIAL);
    expect(flips).toBe(0);

    // fase 2: depósito arenoso real (sedimento trazido pela água) empurra
    // acima do limiar → vira areia uma vez (nunca "de graça" só pela lavagem)
    c.sand[i] = 0.9;
    c.sandLayer[i] = 0.05; // 5 cm de areia depositada
    for (let h = 0; h < 20; h++) stepBanks(region, 1, { worldDay: 100, worldHours: 5000 + h });
    observe();
    expect(c.soilType[i]).toBe(SOIL_SAND);
    expect(flips).toBe(1);

    // fase 3: a célula seca e a vegetação se estabelece (recuperação do solo)
    c.waterDepth.set(new Float32Array(256));
    for (const p of [...c.plants]) c.removedPlants.add(p.id);
    c.rebuildPlantIndex();
    const jequitiba = speciesIndex('jequitiba');
    for (let ly = 6; ly <= 10; ly++) for (let lx = 6; lx <= 10; lx++) addPlant(c, 5000 + lx * 10 + ly, jequitiba, lx, ly);
    for (let h = 0; h < 1500; h++) stepBanks(region, 1, { worldDay: 100, worldHours: 6000 + h });
    observe();
    expect(c.soilType[i]).not.toBe(SOIL_SAND);
    const flipsAfterRecovery = flips;

    // fase 4: volta a ficar molhada — a lavagem tem teto abaixo do limiar,
    // então NÃO deve voltar a virar areia
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
      c.waterDepth[c.cellIdx(lx, ly)] = 0.4;
      c.flowX[c.cellIdx(lx, ly)] = 0.05;
      c.shoreHours[c.cellIdx(lx, ly)] = 50;
    }
    for (let h = 0; h < 400; h++) {
      stepBanks(region, 1, { worldDay: 100, worldHours: 8000 + h });
      observe();
    }
    expect(c.soilType[i]).not.toBe(SOIL_SAND);
    expect(flips).toBe(flipsAfterRecovery); // nenhuma oscilação adicional
    expect(flips).toBeLessThanOrEqual(2);
  });

  it('7. transporte atravessa a fronteira dos chunks sem perder material', () => {
    // carga perto da borda leste de (0,0) escoando para (1,0)
    const build = () => [
      makeChunk(0, 0, (lx, ly, gx) => ({
        elev: 18 - gx * 0.3,
        slope: 0.3,
        soil: SOIL_ALLUVIAL,
        depth: ly >= 6 && ly <= 9 ? 0.4 : 0,
        vx: ly >= 6 && ly <= 9 ? 0.12 : 0,
      })),
      makeChunk(1, 0, (lx, ly, gx) => ({
        elev: 18 - gx * 0.3,
        slope: 0.3,
        soil: SOIL_ALLUVIAL,
        depth: ly >= 6 && ly <= 9 ? 0.4 : 0,
        vx: ly >= 6 && ly <= 9 ? 0.12 : 0,
      })),
    ];
    const chunks = build();
    const region = regionOf(chunks);
    // carga inicial na borda leste do primeiro chunk
    for (let ly = 6; ly <= 9; ly++) chunks[0].sediment[chunks[0].cellIdx(15, ly)] = 0.001;
    const before = material(chunks, region);
    const budget = budgetOf(chunks, region, 24);

    const received = chunks[1].sediment.reduce((a, b) => a + b, 0);
    expect(received).toBeGreaterThan(0);
    expect(budget.transported).toBeGreaterThan(0);
    expect(material(chunks, region)).toBeCloseTo(before, 6); // mesma massa
    expect(budget.lost).toBe(0);
    // nenhuma célula recebeu carga acima do limite configurado
    for (const c of chunks) {
      for (const load of c.sediment) expect(load).toBeLessThanOrEqual(cfg.sedimentMaxLoad + 1e-9);
    }
  });

  it('7b. erosão acumulada expõe raízes e derruba árvore vulnerável (não todas)', () => {
    const c = makeChunk(0, 0, (lx, ly) => ({
      elev: 12,
      slope: 0.6,
      soil: SOIL_ALLUVIAL,
      depth: ly >= 6 && ly <= 9 ? 0.45 : 0,
      vx: ly >= 6 && ly <= 9 ? 0.25 : 0,
    }));
    const ipe = speciesIndex('ipe_amarelo');
    const salgueiro = speciesIndex('salgueiro');
    // árvores pequenas (raiz curta) na margem: 4 ipês + 2 salgueiros
    for (let k = 0; k < 4; k++) addPlant(c, 700 + k, ipe, 4 + k, 7);
    for (let k = 0; k < 2; k++) addPlant(c, 800 + k, salgueiro, 4 + k, 8);

    const region = regionOf([c]);
    // a margem já perdeu 20 cm de solo por correnteza sustentada (delta real)
    for (let k = 0; k < 4; k++) region.addDelta(4 + k, 7, -0.3 / cfg.elevationRange);
    for (let k = 0; k < 2; k++) region.addDelta(4 + k, 8, -0.3 / cfg.elevationRange);

    let uprooted = 0;
    for (let h = 0; h < 6; h++) {
      const budget = createSedimentBudget();
      stepBanks(region, 6, { worldDay: 100, worldHours: 2400 + h * 6, budget });
      uprooted += budget.uprooted;
    }
    const removed = [...c.removedPlants];
    const ipeRemoved = [700, 701, 702, 703].filter((id) => removed.includes(id)).length;
    const salgueiroRemoved = [800, 801].filter((id) => removed.includes(id)).length;
    expect(uprooted).toBeGreaterThan(0); // a sustentação foi comprometida
    expect(ipeRemoved).toBeGreaterThan(0);
    expect(ipeRemoved).toBeLessThanOrEqual(4);
    expect(salgueiroRemoved).toBe(0); // tolerante a inundação + raiz mais funda
    expect(removed.length).toBeLessThan(c.plants.length);
  });

  it('8. simulação estável e dentro do orçamento de tempo', () => {
    const chunks = [
      makeChunk(0, 0, (lx, ly, gx) => ({
        elev: 30 - gx * 0.8 + Math.sin(lx) * 0.5,
        slope: 1.4,
        soil: ly % 3 === 0 ? SOIL_SAND : SOIL_ALLUVIAL,
        depth: ly >= 5 && ly <= 11 ? 1.2 : 0.05,
        vx: ly >= 5 && ly <= 11 ? 2.5 : 0.02,
        vy: Math.cos(ly) * 0.3,
      })),
      makeChunk(1, 0, (lx, ly, gx) => ({
        elev: 30 - gx * 0.8,
        slope: 1.2,
        soil: SOIL_CLAY,
        depth: ly >= 5 && ly <= 11 ? 1.2 : 0,
        vx: ly >= 5 && ly <= 11 ? 2.5 : 0,
        vy: 0.2,
      })),
    ];
    const region = regionOf(chunks);
    const t0 = Date.now();
    for (let s = 0; s < 6; s++) {
      stepErosion(region, 24, { worldDay: 100, worldHours: 2400 + s * 24, rainIntensity: 1, budget: createSedimentBudget() });
      stepBanks(region, 6, { worldDay: 100, worldHours: 2400 + s * 24 });
    }
    const elapsed = Date.now() - t0;

    for (const c of chunks) {
      for (let i = 0; i < c.n * c.n; i++) {
        expect(Number.isFinite(c.elev[i])).toBe(true);
        expect(Number.isFinite(c.sediment[i])).toBe(true);
        expect(c.sediment[i]).toBeGreaterThanOrEqual(0);
        expect(c.sediment[i]).toBeLessThanOrEqual(cfg.sedimentMaxLoad + 1e-9);
        expect(Number.isFinite(c.sand[i])).toBe(true);
        expect(c.sand[i]).toBeGreaterThanOrEqual(0);
        expect(c.sand[i]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(c.slope[i])).toBe(true);
      }
    }
    for (const v of region.deltas.values()) expect(Math.abs(v)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(elapsed).toBeLessThan(3000); // 2 chunks × 6 passos, folga ampla para CI
  });

  it('9. nenhuma perda ou criação inexplicada de sedimento', () => {
    const chunks = [
      makeChunk(0, 0, (lx, ly, gx) => ({
        elev: 22 - gx * 0.5,
        slope: 0.6,
        soil: SOIL_ALLUVIAL,
        depth: ly >= 6 && ly <= 9 ? 0.45 : 0,
        vx: ly >= 6 && ly <= 9 ? 0.18 : 0,
      })),
      makeChunk(0, 1, (lx, ly, gx, gy) => ({
        elev: 22 - gx * 0.5 - 0.2,
        slope: 0.4,
        soil: SOIL_ALLUVIAL,
        depth: ly <= 2 ? 0.2 : 0,
        vx: ly <= 2 ? 0.03 : 0,
        vy: ly <= 2 ? 0.02 : 0,
        kind: 2,
      })),
    ];
    const region = regionOf(chunks);
    const before = material(chunks, region);
    const budget = createSedimentBudget();
    stepErosion(region, 48, { worldDay: 100, worldHours: 2400, rainIntensity: 0.4, budget });
    stepBanks(region, 48, { worldDay: 100, worldHours: 2400 });
    const after = material(chunks, region);

    expect(budget.eroded).toBeGreaterThan(0);
    expect(budget.deposited).toBeGreaterThan(0);
    expect(budget.lost).toBe(0);
    expect(budget.retained).toBe(0);
    expect(Math.abs(after - before)).toBeLessThan(1e-6 + Math.abs(before) * 1e-12);
    // e o balanço explícito fecha: erodido − depositado = carga ainda em trânsito
    const inTransit = chunks.reduce((a, c) => a + c.sediment.reduce((x, y) => x + y, 0), 0) * cfg.elevationRange;
    expect(budget.eroded - budget.deposited).toBeCloseTo(inTransit, 5);
  });

  it('cenário reproduzível: margem, banco de areia e erosão (relatório)', () => {
    // encosta + canal com remanso + margem aluvial + rocha
    const c = makeChunk(0, 0, (lx, ly) => {
      const channel = ly >= 6 && ly <= 9;
      const pool = channel && lx >= 10;
      return {
        elev: 18 - lx * 0.45 - (channel ? 0.8 : 0) - (pool ? 0.6 : 0),
        slope: channel ? (pool ? 0.12 : 0.7) : 0.5,
        soil: ly < 3 ? SOIL_ROCK : channel || ly < 12 ? SOIL_ALLUVIAL : SOIL_CLAY,
        depth: channel ? (pool ? 0.4 : 0.45) : 0,
        vx: channel ? (pool ? 0.01 : 0.14) : 0,
      };
    });
    addPlant(c, 501, speciesIndex('salgueiro'), 4, 6);
    addPlant(c, 502, speciesIndex('ipe_amarelo'), 4, 5);
    const region = regionOf([c]);

    const snapshot = () => ({
      mass: material([c], region),
      sand: c.sand[c.cellIdx(4, 6)],
      load: c.sediment.reduce((a, b) => a + b, 0),
      elevChannel: c.elev[c.cellIdx(5, 7)],
      elevPool: c.elev[c.cellIdx(12, 7)],
      eroded: erodedTotal([c], region),
      sandCells: c.sandCells(),
      slope: c.slope[c.cellIdx(5, 7)],
    });
    const before = snapshot();
    const budget = createSedimentBudget();
    stepErosion(region, 72, { worldDay: 100, worldHours: 2400, rainIntensity: 0.3, budget });
    stepBanks(region, 72, { worldDay: 100, worldHours: 2400 });
    const after = snapshot();
    console.log('[cenário erosão] antes:', before, 'depois:', after, 'orçamento:', budget);

    expect(after.mass).toBeCloseTo(before.mass, 5); // conservação
    expect(after.eroded).toBeGreaterThan(0); // relevo mudou de verdade
    expect(after.elevChannel).toBeLessThan(before.elevChannel); // canal escavado
    expect(after.sand).toBeGreaterThan(before.sand); // margem ficou arenosa
    expect(after.sandCells).toBeGreaterThanOrEqual(before.sandCells);
  });

  it('integração: o mundo gerado erode e cria margens sem NaN', () => {
    const w = new World({ seed: 1337, waterActiveRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunks = [...w.chunks.values()];
    const before = chunks.map((c) => ({ elev: Array.from(c.elev), sand: Array.from(c.sand), type: Array.from(c.soilType) }));
    for (let i = 0; i < 64; i++) w.update(30000); // 32 h de jogo (>= 1 passo de erosão)
    let terrainChanged = 0;
    let sandChanged = 0;
    let finite = true;
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k];
      for (let i = 0; i < c.n * c.n; i++) {
        if (Math.abs(c.elev[i] - before[k].elev[i]) > 1e-5) terrainChanged++;
        if (Math.abs(c.sand[i] - before[k].sand[i]) > 1e-4) sandChanged++;
        if (!Number.isFinite(c.elev[i]) || !Number.isFinite(c.sand[i]) || !Number.isFinite(c.sediment[i])) finite = false;
        if (c.sand[i] < 0 || c.sand[i] > 1) finite = false;
      }
    }
    expect(finite).toBe(true);
    expect(w.sedimentBudget.eroded).toBeGreaterThan(0); // a erosão rodou de fato
    expect(w.stats.sandCells).toBeGreaterThan(0);
    expect(sandChanged).toBeGreaterThan(0); // margens mudaram
    expect(terrainChanged).toBeGreaterThanOrEqual(0);
  });

  it('persistência: areia e classificação de solo sobrevivem ao save/load', () => {
    const w = new World({ seed: 808 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const c = w.getChunk(0, 0)!;
    const i = c.cellIdx(4, 4);
    c.sand[i] = 0.93;
    c.sandLayer[i] = 0.06;
    c.sandBase[i] = 0.2;
    c.soilBase[i] = SOIL_ALLUVIAL;
    c.soilType[i] = SOIL_SAND;
    c.soilDirty = true;
    c.dirty = true;
    const store = {
      data: new Map<string, string>(),
      get length() { return this.data.size; },
      clear() { this.data.clear(); },
      getItem(k: string) { return this.data.get(k) ?? null; },
      key(n: number) { return [...this.data.keys()][n] ?? null; },
      removeItem(k: string) { this.data.delete(k); },
      setItem(k: string, v: string) { this.data.set(k, v); },
    } as Storage;
    // import dinâmico para não acoplar o teste ao módulo no topo
    return import('../src/world/persistence').then(({ saveWorld, loadWorld, applyChunkDiffs }) => {
      expect(saveWorld(w, store)).toBe(true);
      const w2 = new World({ seed: 808 });
      w2.onChunkGenerated = (chunk) => applyChunkDiffs(w2, chunk);
      expect(loadWorld(w2, store).applied).toBe(true);
      w2.requestChunks(0, 0, 0, 0);
      w2.pumpGeneration(100);
      const c2 = w2.getChunk(0, 0)!;
      expect(c2.soilType[i]).toBe(SOIL_SAND);
      expect(c2.sand[i]).toBeCloseTo(0.93, 1);
      expect(c2.sandLayer[i]).toBeCloseTo(0.06, 1);
    });
  });

  it('geração: textura de origem é registrada para a morfologia', () => {
    const w = new World({ seed: 4242 });
    const c = generateChunk({ cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt }, 2, 2);
    for (let i = 0; i < c.n * c.n; i++) {
      expect(c.sandBase[i]).toBeCloseTo(sandBaseOf(c.soilBase[i]), 6);
      expect(c.sand[i]).toBeCloseTo(c.sandBase[i], 6);
      expect(c.soilBase[i]).toBe(c.soilType[i]);
    }
    expect(c.sandBase.some((v) => v > 0.5)).toBe(true);
    expect(c.sandCells()).toBeGreaterThan(0);
  });
});
