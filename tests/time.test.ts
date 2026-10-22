import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { GameClock } from '../src/world/climate';

describe('tempo, astronomia e estações', () => {
  it('o ciclo diário dura exatamente 24 minutos reais', () => {
    const w = new World({ seed: 1 });
    const clock = new GameClock(w.climate, 0);
    const day0 = clock.day;
    clock.advance(24 * 60 * 1000);
    expect(clock.day).toBe(day0 + 1);
    // e meio dia em 12 minutos
    const clock2 = new GameClock(w.climate, 0);
    clock2.advance(12 * 60 * 1000);
    expect(clock2.hour).toBeCloseTo(12, 5);
  });

  it('1 minuto de jogo = 1 segundo real (24 min/dia)', () => {
    const w = new World({ seed: 1 });
    const clock = new GameClock(w.climate, 0);
    clock.advance(1000);
    expect(clock.gameMinutes).toBeCloseTo(1, 5);
  });

  it('nascer/pôr do sol próximos de 06:00/18:00 no equinócio', () => {
    const w = new World({ seed: 1 });
    // procura um dia com declinação ~0
    let best = 0, bestDec = 99;
    for (let d = 0; d < w.cfg.daysPerYear * 4; d++) {
      const dec = Math.abs(w.climate.declination(d));
      if (dec < bestDec) {
        bestDec = dec;
        best = d;
      }
    }
    const sky = w.climate.sky(best, 12);
    expect(Math.abs(sky.sunriseHour - 6)).toBeLessThan(0.35);
    expect(Math.abs(sky.sunsetHour - 18)).toBeLessThan(0.35);
  });

  it('a duração do dia varia com a estação (inclinação axial)', () => {
    const w = new World({ seed: 1 });
    let summer = 0, winter = 0;
    for (let d = 0; d < w.cfg.daysPerYear; d++) {
      const season = w.climate.seasonIndex(d);
      const len = w.climate.sky(d, 12).dayLengthHours;
      if (season === 1) summer = Math.max(summer, len);
      if (season === 3) winter = Math.min(winter || 99, len);
    }
    expect(summer - winter).toBeGreaterThan(1.5);
  });

  it('transições de luz são suaves (sem saltos abruptos)', () => {
    const w = new World({ seed: 1 });
    let prev = w.climate.sky(3, 0).light;
    let maxJump = 0;
    for (let m = 0; m < 1440; m += 5) {
      const l = w.climate.sky(3, m / 60).light;
      maxJump = Math.max(maxJump, Math.abs(l - prev));
      prev = l;
    }
    expect(maxJump).toBeLessThan(0.12); // amostras de 5 min; um ciclo binário daria salto ~1
  });

  it('estações avançam de forma determinística e configurável', () => {
    const a = new World({ seed: 1, startDayOfYear: 0 });
    const b = new World({ seed: 1, startDayOfYear: 0 });
    expect(a.climate.seasonIndex(37.5)).toBe(b.climate.seasonIndex(37.5));
    expect(a.climate.seasonName(0)).toBe('primavera');
    const per = a.cfg.daysPerYear / 4;
    expect(a.climate.seasonIndex(per)).toBe(1);
    expect(a.climate.seasonIndex(per * 2)).toBe(2);
    expect(a.climate.seasonIndex(per * 3)).toBe(3);
  });

  it('processos ambientais não dependem da taxa de quadros', () => {
    const a = new World({ seed: 11 });
    const b = new World({ seed: 11 });
    a.requestChunks(0, 0, 0, 0);
    b.requestChunks(0, 0, 0, 0);
    a.pumpGeneration(100);
    b.pumpGeneration(100);
    // mesmo tempo de jogo (2 h) com passos de frame diferentes
    for (let i = 0; i < 1200; i++) a.update(100);
    for (let i = 0; i < 240; i++) b.update(500);
    const ca = a.getChunk(0, 0)!;
    const cb = b.getChunk(0, 0)!;
    expect(Math.abs(ca.moisture[ca.cellIdx(4, 4)] - cb.moisture[cb.cellIdx(4, 4)])).toBeLessThan(0.05);
  });
});
