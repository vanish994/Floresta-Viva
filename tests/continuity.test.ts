import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { generateChunk } from '../src/world/gen';

function ctxOf(w: World) {
  return { cfg: w.cfg, fields: w.fields, climate: w.climate, deltaAt: w.deltaAt };
}

describe('continuidade entre chunks', () => {
  it('relevo e água coincidem com o campo global nas bordas', () => {
    const w = new World({ seed: 2024 });
    const a = generateChunk(ctxOf(w), 2, 2);
    const b = generateChunk(ctxOf(w), 3, 2);
    const n = a.n;
    for (let ly = 0; ly < n; ly++) {
      const gx = 3 * n; // primeira célula do chunk B
      const gy = 2 * n + ly;
      const fromB = b.elev[b.cellIdx(0, ly)];
      const fromField = w.fields.elevation(gx, gy, w.deltaAt);
      expect(Math.abs(fromB - fromField)).toBeLessThan(1e-4);
      const fromA = a.elev[a.cellIdx(n - 1, ly)];
      const fromFieldA = w.fields.elevation(gx - 1, gy, w.deltaAt);
      expect(Math.abs(fromA - fromFieldA)).toBeLessThan(1e-4);
      // sem degrau artificial: diferença entre células vizinhas de chunks distintos
      // é da mesma ordem das diferenças internas
      const jump = Math.abs(fromB - fromA);
      expect(jump).toBeLessThan(6); // metros por célula (limite generoso de encosta)
    }
  });

  it('rios não apresentam cortes nas bordas (profundidade contínua)', () => {
    const w = new World({ seed: 555 });
    const a = generateChunk(ctxOf(w), 0, 0);
    const b = generateChunk(ctxOf(w), 1, 0);
    const n = a.n;
    let crossings = 0;
    for (let ly = 0; ly < n; ly++) {
      const da = a.waterDepth[a.cellIdx(n - 1, ly)];
      const db = b.waterDepth[b.cellIdx(0, ly)];
      if (da > 0.12 || db > 0.12) {
        crossings++;
        expect(Math.abs(da - db)).toBeLessThan(0.6);
      }
    }
    // garante que o teste exercitou pelo menos uma travessia de rio/lago
    expect(crossings).toBeGreaterThan(0);
  });

  it('nenhuma planta ou decoração duplicada nas fronteiras', () => {
    const w = new World({ seed: 31337 });
    const chunks = [generateChunk(ctxOf(w), 0, 0), generateChunk(ctxOf(w), 1, 0), generateChunk(ctxOf(w), 0, 1), generateChunk(ctxOf(w), 1, 1)];
    const ids = new Set<number>();
    const pos: Array<[number, number]> = [];
    for (const c of chunks) {
      for (const p of c.plants) {
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
        pos.push([p.x, p.y]);
      }
    }
    // sem coincidências exatas de posição
    const seen = new Set<string>();
    for (const [x, y] of pos) {
      const k = `${x},${y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('transição de vegetação através da borda é gradual (densidade contínua)', () => {
    const w = new World({ seed: 808 });
    const n = w.cfg.chunkTiles / w.cfg.simCellTiles;
    const gx = 4 * n;
    const gy = 4 * n;
    const dens: number[] = [];
    for (let i = -6; i < 6; i++) dens.push(w.fields.forestDensity(gx + i, gy, w.climate.meanWetness()));
    for (let i = 1; i < dens.length; i++) {
      expect(Math.abs(dens[i] - dens[i - 1])).toBeLessThan(0.35);
    }
  });
});
