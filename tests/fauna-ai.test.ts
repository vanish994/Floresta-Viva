/**
 * IA comportamental da fauna: atividade por horário, bote com dano único,
 * cooldown, fuga por espécie, dieta e independência de FPS.
 *
 * Usa as funções reais (`activityAt`, `perceive`, `decide`, `stepFauna`,
 * `World`) — nada é reimplementado no teste.
 */
import { describe, expect, it } from 'vitest';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { World } from '../src/world/world';
import { speciesIndex } from '../src/world/flora';
import {
  activityAt,
  perceive,
  decide,
  stepFauna,
  seedFauna,
  makeAnimal,
  applyPredationDamage,
  ATTACK_COOLDOWN_HOURS,
  STRIKE_WINDOW_HOURS,
  MAX_CHASE_HOURS,
  FAUNA_TRAITS,
  FAUNA_CAP,
  type Animal,
  type FaunaState,
} from '../src/world/fauna';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL = cfg.simCellTiles * cfg.tileSize;

function chunk(kind: 'dry' | 'wet' | 'forest' = 'forest'): Chunk {
  const c = new Chunk(0, 0, cfg);
  for (let ly = 0; ly < c.n; ly++) {
    for (let lx = 0; lx < c.n; lx++) {
      const i = c.cellIdx(lx, ly);
      c.soilType[i] = SOIL_FOREST;
      c.soilBase[i] = SOIL_FOREST;
      c.moisture[i] = 0.6;
      c.humus[i] = 3;
      c.litter[i] = 2;
      c.soilDepth[i] = 1;
      c.forage[i] = kind === 'dry' ? 0.03 : 0.75;
      c.waterDepth[i] = kind === 'wet' && ly < c.n / 2 ? 0.75 : 0;
    }
  }
  c.rebuildPlantIndex();
  return c;
}

/** roda N passos determinísticos de 0.02 h de jogo */
function run(
  animals: Animal[],
  steps: number,
  hour: number,
  opts: Partial<Parameters<typeof stepFauna>[3]> = {},
  dt = 0.02,
): void {
  for (let k = 0; k < steps; k++) {
    stepFauna(animals, cfg, dt, { worldDay: 10, hour, ...opts });
  }
}

describe('atividade por horário (curva, não "if night")', () => {
  it('1. cada espécie tem o seu pico e a curva muda ao longo do dia', () => {
    const rabbitMorning = activityAt('rabbit', 9);
    const rabbitNight = activityAt('rabbit', 2);
    expect(rabbitMorning).toBeGreaterThan(rabbitNight); // coelho é diurno

    const birdDawn = activityAt('bird', 7);
    const birdNight = activityAt('bird', 2);
    expect(birdDawn).toBeGreaterThan(birdNight);
    expect(birdNight).toBeLessThan(0.15); // ave quase não atua de noite

    const frogNight = activityAt('frog', 23);
    const frogNoon = activityAt('frog', 12);
    expect(frogNight).toBeGreaterThan(frogNoon); // sapo é noturno
    expect(frogNoon).toBeLessThan(0.4);

    const snakeDusk = activityAt('snake', 19);
    const snakeNoon = activityAt('snake', 13);
    expect(snakeDusk).toBeGreaterThan(snakeNoon); // cobra caça no crepúsculo
    // todas as curvas ficam em 0..1 e são contínuas na virada do dia
    for (const kind of ['rabbit', 'frog', 'bird', 'snake'] as const) {
      for (let h = 0; h < 24; h += 0.5) {
        const a = activityAt(kind, h);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(activityAt(kind, 23.9) - activityAt(kind, 0.1))).toBeLessThan(0.12);
    }
  });

  it('2. a atividade governa o sono: coelho dorme de madrugada, sapo não', () => {
    const c = chunk();
    const rabbit = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.2 });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 6 * CELL, y: 6 * CELL, hunger: 0.2, thirst: 0 });
    run([rabbit, frog], 3, 2);
    expect(rabbit.state).toBe('sleep');
    expect(frog.state).not.toBe('sleep');

    // de manhã o coelho acorda
    run([rabbit], 3, 9);
    expect(rabbit.state).not.toBe('sleep');
  });

  it('3. fome urgente sobrepõe o sono (animal não morre dormindo)', () => {
    const c = chunk();
    const rabbit = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.95 });
    run([rabbit], 2, 2);
    expect(rabbit.state).not.toBe('sleep');
  });
});

describe('cobra: emboscada, bote único e cooldown', () => {
  it('4. cobra detecta a presa e prefere o sapo quando há escolha', () => {
    const c = chunk('wet');
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    // distâncias comparáveis: o sapo está um pouco mais longe, mas é preferido
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 6 * CELL, y: 5 * CELL });
    const rabbit = makeAnimal({ id: 3, kind: 'rabbit', chunk: c, x: 5.9 * CELL, y: 5 * CELL });
    const p = perceive(snake, cfg, {
      worldDay: 10,
      hour: 19,
      nearbyAnimals: () => [frog, rabbit],
    });
    expect(p.prey).toBeTruthy();
    expect(p.prey!.kind).toBe('frog');
    expect(FAUNA_TRAITS.snake.prey![0]).toBe('frog');
  });

  it('5. o bote aplica dano UMA vez por investida (nunca por tick)', () => {
    const c = chunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.15 * CELL, y: 5 * CELL, health: 1 });
    const hits: number[] = [];
    // 40 passos bem curtos: antes isso geraria dezenas de danos
    for (let k = 0; k < 40; k++) {
      stepFauna([snake], cfg, 0.002, {
        worldDay: 10,
        hour: 19,
        nearbyAnimals: () => [frog],
        damageAnimal: (_p, amount) => hits.push(amount),
      });
    }
    expect(hits.length).toBe(1); // um bote = um dano
    expect(hits[0]).toBeCloseTo(FAUNA_TRAITS.snake.attackDamage!, 6);
  });

  it('6. o cooldown impede ataque contínuo (dano volta depois da janela)', () => {
    const c = chunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.95 });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.1 * CELL, y: 5 * CELL, health: 1 });
    // a presa "aguenta" (não morre) para medirmos o ritmo dos botes
    const hitAt: number[] = [];
    let t = 0;
    for (let k = 0; k < 400; k++) {
      stepFauna([snake], cfg, 0.01, {
        worldDay: 10,
        hour: 19,
        nearbyAnimals: () => [frog],
        damageAnimal: () => {
          hitAt.push(t);
          frog.health = 1; // mantém viva: mede o intervalo dos botes
        },
      });
      t += 0.01;
    }
    expect(hitAt.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hitAt.length; i++) {
      // entre dois botes passa pelo menos o cooldown
      expect(hitAt[i] - hitAt[i - 1]).toBeGreaterThanOrEqual(ATTACK_COOLDOWN_HOURS - 1e-9);
    }
    expect(STRIKE_WINDOW_HOURS).toBeLessThan(ATTACK_COOLDOWN_HOURS);
  });

  it('7. a janela do bote é curta (o estado attack não fica preso)', () => {
    const c = chunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.1 * CELL, y: 5 * CELL });
    let attackSteps = 0;
    let total = 0;
    for (let k = 0; k < 100; k++) {
      stepFauna([snake], cfg, 0.01, {
        worldDay: 10,
        hour: 19,
        nearbyAnimals: () => [frog],
        damageAnimal: () => {
          frog.health = 1;
        },
      });
      if (snake.state === 'attack') attackSteps++;
      total++;
    }
    expect(attackSteps).toBeGreaterThan(0); // chegou a atacar
    expect(attackSteps / total).toBeLessThan(0.35); // mas não fica travado
  });
});

describe('perseguição e desistência', () => {
  it('8. cobra não persegue infinitamente (desiste e descansa)', () => {
    const c = chunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    const prey = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 9 * CELL, y: 9 * CELL });
    let gaveUp = false;
    for (let k = 0; k < 1200; k++) {
      // presa sempre no limite do alcance: nunca é pega
      prey.x = snake.x + 150;
      prey.y = snake.y + 40;
      stepFauna([snake], cfg, 0.01, { worldDay: 10, hour: 19, nearbyAnimals: () => [prey] });
      if (snake.state === 'rest' || snake.state === 'hide') gaveUp = true;
      if (gaveUp) break;
    }
    expect(gaveUp).toBe(true);
    expect(snake.chaseHours ?? 0).toBeLessThanOrEqual(MAX_CHASE_HOURS + 0.1);
  });

  it('9. o tempo de perseguição não depende do tamanho do passo (FPS)', () => {
    const chaseFor = (dt: number): number => {
      const c = chunk();
      const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
      const prey = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 9 * CELL, y: 9 * CELL });
      let elapsed = 0;
      for (let k = 0; k < Math.ceil(6 / dt); k++) {
        prey.x = snake.x + 150;
        prey.y = snake.y + 40;
        stepFauna([snake], cfg, dt, { worldDay: 10, hour: 19, nearbyAnimals: () => [prey] });
        elapsed += dt;
        if (snake.state === 'rest' || snake.state === 'hide') break;
      }
      return elapsed;
    };
    const a = chaseFor(0.02); // passo de "30 fps"
    const b = chaseFor(0.005); // passo 4× menor
    // o tempo de desistência é o mesmo em horas de jogo (tolerância de 1 passo)
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    expect(a).toBeGreaterThan(MAX_CHASE_HOURS * 0.7);
  });
});

describe('fuga por espécie', () => {
  it('10. coelho foge cedo (é o mais cauteloso) e lembra do perigo', () => {
    const c = chunk();
    const rabbit = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.2 });
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL + 110, y: 5 * CELL });
    stepFauna([rabbit], cfg, 0.02, { worldDay: 10, hour: 10, nearbyAnimals: () => [snake] });
    expect(rabbit.state).toBe('flee'); // 110 px: já foge
    expect(rabbit.memory?.kind).toBe('threat');
    expect(rabbit.fear ?? 0).toBeGreaterThan(0.2);
  });

  it('11. sapo foge em direção à água quando a cobra aparece', () => {
    const c = chunk('wet');
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5 * CELL, y: 9 * CELL, thirst: 0 });
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5.3 * CELL, y: 9 * CELL });
    const y0 = frog.y;
    const p = perceive(frog, cfg, { worldDay: 10, hour: 21, nearbyAnimals: () => [snake] });
    decide(frog, cfg, { worldDay: 10, hour: 21, nearbyAnimals: () => [snake] }, p, 0.02);
    expect(frog.state).toBe('flee');
    // alvo é a água (metade norte do chunk), não a direção oposta pura
    expect(frog.ty).toBeLessThan(y0);
    run([frog], 10, 21, { nearbyAnimals: () => [snake] });
    expect(frog.y).toBeLessThan(y0);
  });

  it('12. ave escapa voando ao detectar a cobra', () => {
    const c = chunk();
    const bird = makeAnimal({ id: 2, kind: 'bird', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.2 });
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5.2 * CELL, y: 5 * CELL });
    stepFauna([bird], cfg, 0.02, { worldDay: 10, hour: 12, nearbyAnimals: () => [snake] });
    expect(bird.state).toBe('fly');
  });
});

describe('dieta e recursos reais', () => {
  it('13. sapo caça inseto do pool e ave come fruto (com semente)', () => {
    const c = chunk();
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9, thirst: 0 });
    let insectsEaten = 0;
    run([frog], 3, 22, {
      consumeInsect: () => {
        insectsEaten++;
        return true;
      },
    });
    expect(insectsEaten).toBeGreaterThan(0);
    expect(frog.hunger).toBeLessThan(0.9);

    const bird = makeAnimal({ id: 3, kind: 'bird', chunk: c, x: 6 * CELL, y: 6 * CELL, hunger: 0.95 });
    run([bird], 3, 12, {
      consumeFruit: () => ({ species: speciesIndex('macaneira') }),
    });
    expect(bird.carriedSeed?.species).toBe(speciesIndex('macaneira'));
  });

  it('14. coelho come a forragem real (e ela diminui)', () => {
    const c = chunk();
    const rabbit = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    const i = c.cellIdx(5, 5);
    const before = c.forage[i];
    run([rabbit], 3, 10);
    expect(c.forage[i]).toBeLessThan(before);
    expect(rabbit.hunger).toBeLessThan(0.9);
  });
});

describe('integração, população e determinismo', () => {
  it('15. mundo: caps respeitados, estado finito e fauna presente', () => {
    const w = new World({ seed: 4242, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      w.pumpGeneration(100);
      w.update(2000);
    }
    for (let i = 0; i < 60; i++) w.update(3000);
    let total = 0;
    for (const ch of w.chunks.values()) {
      const list = w.faunaAt(ch);
      total += list.length;
      for (const kind of ['rabbit', 'frog', 'bird', 'snake'] as const) {
        expect(list.filter((a) => a.kind === kind).length).toBeLessThanOrEqual(FAUNA_CAP[kind]);
      }
      for (const a of list) {
        expect(Number.isFinite(a.x)).toBe(true);
        expect(Number.isFinite(a.y)).toBe(true);
        expect(a.health).toBeGreaterThanOrEqual(0);
        expect(a.activity ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(w.stats.animals).toBe(total);
  });

  it('16. determinismo: mesma seed + mesmos passos ⇒ mesmo estado da fauna', () => {
    const snapshot = () => {
      const w = new World({ seed: 777, loadRadiusChunks: 1 });
      w.requestChunks(0, 0, 0, 0);
      for (let i = 0; i < 20; i++) {
        w.pumpGeneration(100);
        w.update(1500);
      }
      const out: Array<[number, string, number, number, number]> = [];
      for (const ch of w.chunks.values()) {
        for (const a of [...w.faunaAt(ch)].sort((x, y) => x.id - y.id)) {
          out.push([a.id, a.state, Math.round(a.x), Math.round(a.y), Math.round((a.health ?? 1) * 100)]);
        }
      }
      return out;
    };
    expect(snapshot()).toEqual(snapshot());
  });

  it('17. sem presas, a cobra não gera erro e sente fome', () => {
    const c = chunk('dry');
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.99, thirst: 0.9 });
    const h0 = snake.health;
    run([snake], 60, 19, { nearbyAnimals: () => [] });
    expect(Number.isFinite(snake.x)).toBe(true);
    expect(snake.health).toBeLessThanOrEqual(h0);
    expect(['idle', 'wander', 'seek_water', 'rest', 'hide', 'sleep']).toContain(snake.state as FaunaState);
  });

  it('18. dano de predação reduz saúde e marca fuga (sem matar de uma vez)', () => {
    const c = chunk();
    const frog = makeAnimal({ id: 1, kind: 'frog', chunk: c, x: 5 * CELL, y: 5 * CELL });
    applyPredationDamage(frog, 0.3);
    expect(frog.health).toBeCloseTo(0.7, 5);
    expect(frog.state).toBe('flee');
    applyPredationDamage(frog, 0);
    expect(frog.health).toBeCloseTo(0.7, 5); // dano 0 não faz nada
  });

  it('19. seedFauna continua determinística e com cobra dentro do cap', () => {
    const c = chunk('wet');
    const a = seedFauna(c, cfg, 10, 21, []);
    const b = seedFauna(c, cfg, 10, 21, []);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.filter((x) => x.kind === 'snake').length).toBeLessThanOrEqual(FAUNA_CAP.snake);
  });
});
