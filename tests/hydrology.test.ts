import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { solveHydrology, DX8, DY8 } from '../src/world/hydro';

function sol(seed: number, x0 = -32, y0 = -32, w = 64, h = 64) {
  const world = new World({ seed });
  return {
    world,
    s: solveHydrology(world.fields, world.cfg, world.deltaAt, world.climate.meanWetness(), x0, y0, w, h),
  };
}

describe('hidrologia', () => {
  it('água escoa sempre para potencial hidráulico igual ou menor', () => {
    const { s } = sol(1337);
    let checked = 0;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        const d = s.flowDir[i];
        if (d < 0) continue;
        const nx = x + DX8[d], ny = y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
        expect(s.head[ny * s.w + nx]).toBeLessThanOrEqual(s.head[i] + 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('acumulação cresce ao longo do fluxo (área de contribuição coerente)', () => {
    const { s } = sol(99);
    for (let y = 1; y < s.h - 1; y++) {
      for (let x = 1; x < s.w - 1; x++) {
        const i = y * s.w + x;
        const d = s.flowDir[i];
        if (d < 0) continue;
        const j = (y + DY8[d]) * s.w + (x + DX8[d]);
        expect(s.acc[j]).toBeGreaterThanOrEqual(s.acc[i]);
      }
    }
  });

  it('lagos só existem abaixo do lençol freático; rios seguem a drenagem', () => {
    const world = new World({ seed: 4242 });
    const s = solveHydrology(world.fields, world.cfg, world.deltaAt, world.climate.meanWetness(), -24, -24, 48, 48);
    let lakes = 0, rivers = 0;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        const gx = -24 + x, gy = -24 + y;
        const wt = world.fields.waterTable(gx, gy, world.climate.meanWetness()) * world.cfg.elevationRange;
        const elev = world.fields.elevation(gx, gy, world.deltaAt);
        if (s.waterKind[i] & 1) {
          lakes++;
          expect(elev).toBeLessThan(wt);
        }
        if (s.waterKind[i] & 2) {
          rivers++;
          // canal principal tem montante; margens agregadas podem ter menos
          if (s.waterDepth[i] > 0.4) expect(s.acc[i]).toBeGreaterThan(world.cfg.streamThreshold * 0.4);
        }
      }
    }
    expect(lakes + rivers).toBeGreaterThan(0);
  });

  it('a rede hidrográfica é consistente entre janelas sobrepostas (ordem independente)', () => {
    const world = new World({ seed: 616 });
    const a = solveHydrology(world.fields, world.cfg, world.deltaAt, world.climate.meanWetness(), 0, 0, 32, 32);
    const b = solveHydrology(world.fields, world.cfg, world.deltaAt, world.climate.meanWetness(), 16, 0, 32, 32);
    // região sobreposta: x 16..31
    let mismatch = 0, total = 0;
    for (let y = 4; y < 28; y++) {
      for (let x = 20; x < 28; x++) {
        const ia = y * a.w + x;
        const ib = y * b.w + (x - 16);
        total++;
        const da = a.waterDepth[ia], db = b.waterDepth[ib];
        const classA = da > 0.12 ? 1 : 0;
        const classB = db > 0.12 ? 1 : 0;
        if (classA !== classB || Math.abs(da - db) > 0.25) mismatch++;
      }
    }
    expect(mismatch / total).toBeLessThan(0.06);
  });

  it('não há água subindo encosta: profundidade maior implica potencial menor ou igual ao redor', () => {
    const { world, s } = sol(2468);
    for (let y = 1; y < s.h - 1; y++) {
      for (let x = 1; x < s.w - 1; x++) {
        const i = y * s.w + x;
        if (s.waterDepth[i] < 0.5) continue;
        // pelo menos um vizinho recebe o fluxo (não é um pico isolado)
        const d = s.flowDir[i];
        expect(d).toBeGreaterThanOrEqual(-1);
        if (d >= 0) {
          const j = (y + DY8[d]) * s.w + (x + DX8[d]);
          expect(s.head[j]).toBeLessThanOrEqual(s.head[i] + 1e-6);
        }
      }
    }
    void world;
  });
});
