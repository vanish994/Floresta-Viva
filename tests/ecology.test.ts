import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { generateChunk, speciesSuitability } from '../src/world/gen';
import { stepBio, stepWater, canopyCoverAt } from '../src/world/ecology';
import { speciesIndex } from '../src/world/flora';

function ctxOf(w: World) {
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}

describe('ecologia', () => {
  it('espécies com necessidades diferentes respondem diferente à umidade', () => {
    const salgueiro = speciesIndex('salgueiro');
    const ipe = speciesIndex('ipe_amarelo');
    // seco: ipê (tolerante à seca) vence; encharcado: salgueiro vence
    expect(speciesSuitability(ipe, 0.18, 0, 0.7, 25)).toBeGreaterThan(speciesSuitability(salgueiro, 0.18, 0, 0.7, 25));
    expect(speciesSuitability(salgueiro, 0.88, 1, 0.7, 20)).toBeGreaterThan(speciesSuitability(ipe, 0.88, 1, 0.7, 20));
  });

  it('decomposição transfere matéria da liteira para húmus/nutrientes sem criar massa', () => {
    const w = new World({ seed: 5 });
    const c = generateChunk(ctxOf(w), 0, 0);
    // remove plantas para isolar o processo
    c.plants = [];
    c.recruitedPlants = [];
    const i = c.cellIdx(3, 3);
    c.litter[i] = 4;
    c.humus[i] = 1;
    const n0 = c.nAvail[i], p0 = c.pAvail[i], k0 = c.kAvail[i];
    const carbon0 = c.litter[i] + c.humus[i];
    stepBio(c, w.cfg, w.climate, 6, 10);
    expect(c.litter[i]).toBeLessThan(4);
    expect(c.humus[i]).toBeGreaterThan(1);
    // carbono total não cresce sem entrada (apenas pequena perda por imobilização/respiração implícita)
    expect(c.litter[i] + c.humus[i]).toBeLessThanOrEqual(carbon0 + 1e-9);
    expect(c.nAvail[i]).toBeGreaterThanOrEqual(n0 - 1e-9);
    expect(c.pAvail[i]).toBeGreaterThanOrEqual(p0 - 1e-9);
    expect(c.kAvail[i]).toBeGreaterThanOrEqual(k0 - 1e-9);
  });

  it('nutrientes não crescem infinitamente em simulação longa', () => {
    const w = new World({ seed: 6 });
    const c = generateChunk(ctxOf(w), 1, 1);
    const i = c.cellIdx(4, 4);
    for (let step = 0; step < 400; step++) stepBio(c, w.cfg, w.climate, 3, 10 + step * 0.125);
    expect(c.nAvail[i]).toBeLessThan(50);
    expect(c.pAvail[i]).toBeLessThan(50);
    expect(c.kAvail[i]).toBeLessThan(50);
    expect(c.humus[i]).toBeLessThan(40);
  });

  it('escassez de água aumenta o estresse; umidade adequada o reduz', () => {
    const w = new World({ seed: 7 });
    const dry = generateChunk(ctxOf(w), 2, 2);
    const wet = generateChunk(ctxOf(w), 2, 2);
    const i = dry.cellIdx(5, 5);
    dry.plants = [];
    wet.plants = [];
    for (let k = 0; k < dry.n * dry.n; k++) {
      dry.moisture[k] = 0.08;
      wet.moisture[k] = 0.6;
    }
    for (let s = 0; s < 8; s++) {
      stepBio(dry, w.cfg, w.climate, 3, 20);
      stepBio(wet, w.cfg, w.climate, 3, 20);
    }
    expect(dry.stress[i]).toBeGreaterThan(wet.stress[i]);
    expect(dry.stress[i]).toBeGreaterThan(0.1);
  });

  it('chuva aumenta umidade do solo; evaporação a reduz sem chuva', () => {
    const w = new World({ seed: 8 });
    const c = generateChunk(ctxOf(w), 3, 3);
    c.plants = [];
    for (let k = 0; k < c.n * c.n; k++) c.moisture[k] = 0.3;
    const dry = generateChunk(ctxOf(w), 3, 3);
    dry.plants = [];
    for (let k = 0; k < dry.n * dry.n; k++) dry.moisture[k] = 0.3;
    // escolhe uma célula de terra firme: em célula inundada a chuva entra
    // direto na lâmina (a umidade do solo é tratada pela infiltração do solver)
    const pickDry = (ch: typeof c): number => {
      for (let y = 0; y < ch.n; y++) {
        for (let x = 0; x < ch.n; x++) {
          const idx = ch.cellIdx(x, y);
          if (ch.waterDepth[idx] <= 0.02) return idx;
        }
      }
      return ch.cellIdx(6, 6);
    };
    const i = pickDry(c);
    const di = pickDry(dry);
    const before = c.moisture[i];
    let rainyDay = 0;
    while (w.climate.rainIntensity(rainyDay) < 0.5 && rainyDay < 400) rainyDay += 1;
    let dryDay = 0;
    while (w.climate.rainIntensity(dryDay) > 0.05 && dryDay < 400) dryDay += 1;
    expect(w.climate.rainIntensity(rainyDay)).toBeGreaterThan(0.5);
    stepWater(c, w.cfg, w.climate, 6, rainyDay, { cellAt: () => null });
    stepWater(dry, w.cfg, w.climate, 6, dryDay, { cellAt: () => null });
    expect(c.moisture[i]).toBeGreaterThan(before);
    expect(dry.moisture[di]).toBeLessThan(0.3);
  });

  it('cobertura de copa cria sombra que limita espécies heliófilas no sub-bosque', () => {
    const w = new World({ seed: 9 });
    const c = generateChunk(ctxOf(w), 4, 4);
    void c.cellIdx(8, 8);
    // em floresta densa gerada, alguma célula deve ter copa significativa
    let maxCover = 0, bx = 0, by = 0;
    for (let ly = 0; ly < c.n; ly++) {
      for (let lx = 0; lx < c.n; lx++) {
        const cov = canopyCoverAt(c, w.cfg, lx, ly, 50);
        if (cov > maxCover) {
          maxCover = cov;
          bx = lx;
          by = ly;
        }
      }
    }
    expect(maxCover).toBeGreaterThan(0.3);
    // remover as plantas ao redor reduz a copa (mais luz no sub-bosque)
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      for (const p of c.plantsInCell(bx + ox, by + oy)) c.removedPlants.add(p.id);
    }
    c.rebuildPlantIndex();
    expect(canopyCoverAt(c, w.cfg, bx, by, 50)).toBeLessThan(maxCover);
  });

  it('a retirada de árvores altera o ambiente (menos liteira futura, mais luz)', () => {
    const w = new World({ seed: 10 });
    const c = generateChunk(ctxOf(w), 5, 5);
    const before = canopyCoverAt(c, w.cfg, 8, 8, 60);
    for (const p of [...c.plants]) c.removedPlants.add(p.id);
    c.rebuildPlantIndex();
    const after = canopyCoverAt(c, w.cfg, 8, 8, 60);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBe(0);
  });
});
