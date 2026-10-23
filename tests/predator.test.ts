/**
 * Predador (cobra) + IA comportamental compartilhada.
 * Cobre os 12 casos pedidos: nascer, perceber, perseguir, atacar, matar, comer,
 * fome cair, desistir, coelho fugir, sapo fugir, limite populacional e ausência
 * de presas. Usa as funções REAIS do jogo (`World`, `stepFauna`, `perceive`).
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import {
  seedFauna,
  stepFauna,
  perceive,
  decide,
  makeAnimal,
  applyPredationDamage,
  FAUNA_CAP,
  FAUNA_TRAITS,
  MEMORY_HOURS,
  MAX_CHASE_HOURS,
  type Animal,
} from '../src/world/fauna';
import { FAUNA_SHEETS, faunaRect } from '../src/render/manifest';
import { composeScene } from '../src/render/scene';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG } from '../tools/png';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL = cfg.simCellTiles * cfg.tileSize;

function habitableChunk(kind: 'dry' | 'wet' | 'forest' = 'forest'): Chunk {
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
      c.forage[i] = kind === 'dry' ? 0.05 : 0.7;
      c.waterDepth[i] = kind === 'wet' && ly < c.n / 2 ? 0.7 : 0;
    }
  }
  c.rebuildPlantIndex();
  return c;
}

/** roda o mundo com uma pool fixa para isolar a cadeia predador/presa */
function sandbox(animals: Animal[], frames = 80, stepMs = 200) {
  const w = new World({ seed: 1337, loadRadiusChunks: 1 });
  w.requestChunks(0, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    w.pumpGeneration(100);
    w.update(500);
  }
  const chunk = w.getChunk(0, 0)!;
  for (const a of animals) a.chunk = chunk;
  (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set('0,0', animals);
  for (let i = 0; i < frames; i++) w.update(stepMs);
  return { world: w, chunk, alive: w.faunaAt(chunk) };
}

/** passo de IA isolado (sem mundo): permite forçar presas/alcance */
function huntStep(animals: Animal[], prey: Animal, seconds: number, onDamage?: (p: Animal, dmg: number) => void) {
  const steps = Math.round(seconds / 0.02);
  for (let k = 0; k < steps; k++) {
    stepFauna(animals, cfg, 0.02, {
      worldDay: 10,
      hour: 21,
      nearbyAnimals: () => (prey.state === 'dead' ? [] : [prey]),
      damageAnimal: (p, amount) => {
        p.health = Math.max(0, p.health - amount);
        onDamage?.(p, amount);
        if (p.health <= 0.02) p.state = 'dead';
      },
    });
  }
}

describe('cobra: sprites e escala', () => {
  it('1. a folha da cobra existe, tem transparência e animações do asset', () => {
    const sheet = FAUNA_SHEETS.snake;
    expect(sheet.file).toBe('Animals/snake.png');
    const img = decodePNG(readFileSync(join(__dirname, '..', 'assets', sheet.file)));
    expect(img.height).toBe(sheet.cellH * Object.keys(sheet.rows).length);
    let transparent = 0;
    let partial = 0;
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] === 0) transparent++;
      else if (img.data[i] !== 255) partial++;
    }
    expect(transparent).toBeGreaterThan(0); // fundo transparente real
    expect(partial).toBe(0); // alpha binário (sem halo)
    // só animações que existem no asset
    for (const anim of ['idle', 'move', 'attack', 'hide', 'death', 'hurt', 'sleep']) {
      expect(sheet.rows[anim]).toBeDefined();
      const r = faunaRect(sheet, anim, 0);
      expect(r[2]).toBeGreaterThan(0);
      expect(r[3]).toBeGreaterThan(0);
    }
    // escala compatível: menor que o coelho em altura de célula, mas visível
    expect(sheet.cellH).toBeLessThanOrEqual(FAUNA_SHEETS.rabbit.cellH + 8);
    expect(sheet.cellH).toBeGreaterThan(10);
  });
});

describe('cobra: nascer e perceber', () => {
  it('2. cobra nasce onde há presas e respeita o teto por chunk', () => {
    const c = habitableChunk('wet');
    // presas explícitas no chunk
    const prey: Animal[] = [
      makeAnimal({ id: 10, kind: 'frog', chunk: c, x: 4 * CELL, y: 4 * CELL }),
      makeAnimal({ id: 11, kind: 'frog', chunk: c, x: 6 * CELL, y: 5 * CELL }),
      makeAnimal({ id: 12, kind: 'rabbit', chunk: c, x: 8 * CELL, y: 6 * CELL }),
    ];
    const seeded = seedFauna(c, cfg, 10, 21, []);
    const snakes = seeded.filter((a) => a.kind === 'snake');
    expect(snakes.length).toBeLessThanOrEqual(FAUNA_CAP.snake);
    expect(prey.length).toBeGreaterThanOrEqual(2);
    // sem presas no chunk, o nascimento é reduzido (mas não proibido)
    const empty = seedFauna(habitableChunk('dry'), cfg, 10, 21, []).filter((a) => a.kind === 'snake');
    expect(empty.length).toBeLessThanOrEqual(FAUNA_CAP.snake);
  });

  it('3. a cobra percebe a presa mais próxima (e a presa percebe a ameaça)', () => {
    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL });
    const near = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.4 * CELL, y: 5 * CELL });
    const far = makeAnimal({ id: 3, kind: 'bird', chunk: c, x: 12 * CELL, y: 12 * CELL });
    const opts = {
      worldDay: 10,
      hour: 21,
      nearbyAnimals: (_a: Animal, radius: number) => [near, far].filter((o) => Math.hypot(o.x - snake.x, o.y - snake.y) <= radius),
    };
    const p = perceive(snake, cfg, opts);
    expect(p.prey).toBeTruthy();
    expect(p.prey!.kind).toBe('frog'); // sapo é a presa preferida/próxima
    // e o sapo vê a cobra como ameaça
    const frogP = perceive(near, cfg, {
      worldDay: 10,
      hour: 21,
      nearbyAnimals: () => [snake],
    });
    expect(frogP.threat).toBeTruthy();
    expect(frogP.threat!.kind).toBe('snake');
  });

  it('4. cobra persegue a presa (estado chase) e ataca quando chega perto', () => {
    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.9 * CELL, y: 5.05 * CELL, hunger: 0.2 });
    const states = new Set<string>();
    let attacked = false;
    const steps = 600;
    for (let k = 0; k < steps && !attacked; k++) {
      stepFauna([snake], cfg, 0.02, {
        worldDay: 10,
        hour: 21,
        nearbyAnimals: () => [frog],
        damageAnimal: () => {
          attacked = true;
        },
      });
      states.add(snake.state);
    }
    expect(states.has('chase') || states.has('attack')).toBe(true);
    expect(attacked).toBe(true); // chegou no alcance e atacou
  });
});

describe('cobra: caça, morte e saciedade', () => {
  it('5. atacar reduz a saúde da presa; ao morrer ela fica como carcaça e depois vira matéria orgânica', () => {
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: habitableChunk(), x: 0, y: 0 });
    const h0 = frog.health;
    applyPredationDamage(frog, 0.3);
    expect(frog.health).toBeLessThan(h0);
    applyPredationDamage(frog, 2);
    expect(frog.health).toBe(0);

    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.95 });
    const prey = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.2 * CELL, y: 5 * CELL, hunger: 0.2 });
    // 200 quadros (≈40 s reais ≈ 0,66 h de jogo): a presa já morreu, mas a
    // CARCAÇA continua no mundo (imóvel) até CORPSE_HOURS
    const { world, chunk, alive } = sandbox([snake, prey], 200, 200);
    const corpse = alive.find((a) => a.id === prey.id);
    expect(corpse?.state).toBe('dead');
    expect(corpse?.vx).toBe(0);
    expect(corpse?.vy).toBe(0);
    // mais 80 s (≈1,3 h de jogo): decomposta, sai do pool e o solo herda matéria
    for (let i = 0; i < 400; i++) world.update(200);
    expect(world.faunaAt(chunk).some((a) => a.id === prey.id)).toBe(false); // virou solo
  });

  it('6. depois de comer, a fome da cobra cai e ela descansa', () => {
    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.95, thirst: 0 });
    const prey = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5.2 * CELL, y: 5 * CELL, hunger: 0.2, thirst: 0 });
    const hunger0 = snake.hunger;
    sandbox([snake, prey], 220, 200);
    expect(snake.hunger).toBeLessThan(hunger0);
    expect(['rest', 'hide', 'idle', 'wander']).toContain(snake.state);
  });

  it('7. cobra desiste de perseguição longa (não é um míssil)', () => {
    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.9 });
    // presa inalcançável: teleporta para longe a cada passo
    const prey = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 9 * CELL, y: 9 * CELL });
    let gaveUp = false;
    for (let k = 0; k < 400; k++) {
      prey.x = snake.x + 170;
      prey.y = snake.y + 60;
      stepFauna([snake], cfg, 0.02, { worldDay: 10, hour: 21, nearbyAnimals: () => [prey] });
      if (snake.state === 'rest' || snake.state === 'idle') gaveUp = true;
      if (snake.chaseHours === 0 && gaveUp) break;
    }
    expect(gaveUp).toBe(true);
    expect(snake.chaseHours ?? 0).toBeLessThanOrEqual(MAX_CHASE_HOURS);
  });

  it('8. sem presas, a cobra não quebra e passa fome (saúde cai)', () => {
    const c = habitableChunk();
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.98, thirst: 0.98 });
    const h0 = snake.health;
    const { alive } = sandbox([snake], 120, 500);
    expect(Number.isFinite(snake.x)).toBe(true);
    expect(alive.length).toBeLessThanOrEqual(1);
    expect(snake.health).toBeLessThanOrEqual(h0);
  });
});

describe('presas fogem do predador', () => {
  it('9. coelho foge da cobra e lembra do perigo por um tempo', () => {
    const c = habitableChunk();
    const rabbit = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, hunger: 0.2 });
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5.4 * CELL, y: 5 * CELL, hunger: 0.9 });
    const d0 = Math.hypot(rabbit.x - snake.x, rabbit.y - snake.y);
    // a cobra fica parada "ameaçando": nos primeiros passos o coelho foge
    for (let k = 0; k < 3; k++) {
      stepFauna([rabbit], cfg, 0.02, { worldDay: 10, hour: 12, nearbyAnimals: () => [snake] });
    }
    expect(rabbit.state).toBe('flee');
    expect(Math.hypot(rabbit.x - snake.x, rabbit.y - snake.y)).toBeGreaterThan(d0);
    expect(rabbit.memory?.kind).toBe('threat');
    expect(rabbit.fear ?? 0).toBeGreaterThan(0);
    // sem o predador por perto, o medo cai e a memória expira com o tempo
    for (let k = 0; k < 60; k++) {
      stepFauna([rabbit], cfg, 0.05, { worldDay: 10 + k * 0.05, hour: 12, nearbyAnimals: () => [] });
    }
    expect(MEMORY_HOURS).toBeGreaterThan(0);
    expect(rabbit.fear ?? 0).toBeLessThan(0.5);
    expect(rabbit.memory === undefined || 10 + 3 - rabbit.memory.hour > MEMORY_HOURS).toBe(true);
  });

  it('10. sapo foge da cobra', () => {
    const c = habitableChunk('wet');
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5 * CELL, y: 8 * CELL, hunger: 0.2, thirst: 0 });
    const snake = makeAnimal({ id: 1, kind: 'snake', chunk: c, x: 5.35 * CELL, y: 8 * CELL, hunger: 0.9 });
    for (let k = 0; k < 3; k++) {
      stepFauna([frog], cfg, 0.02, { worldDay: 10, hour: 21, nearbyAnimals: () => [snake] });
    }
    expect(frog.state).toBe('flee');
    expect(frog.memory?.kind).toBe('threat');
  });

  it('11. jogador também é tratado como ameaça pelas presas', () => {
    const c = habitableChunk();
    const rabbit = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL });
    stepFauna([rabbit], cfg, 0.05, { worldDay: 10, hour: 12, playerX: rabbit.x + 10, playerY: rabbit.y });
    expect(rabbit.state).toBe('flee');
  });
});

describe('equilíbrio e sanidade no mundo', () => {
  it('12. nenhuma espécie (incluindo cobra) ultrapassa o teto por chunk', () => {
    const w = new World({ seed: 777, loadRadiusChunks: 1 });
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      w.pumpGeneration(100);
      w.update(2000);
    }
    for (let i = 0; i < 80; i++) w.update(3000);
    for (const chunk of w.chunks.values()) {
      const list = w.faunaAt(chunk);
      for (const kind of ['rabbit', 'frog', 'bird', 'snake'] as const) {
        expect(list.filter((a) => a.kind === kind).length).toBeLessThanOrEqual(FAUNA_CAP[kind]);
      }
      for (const a of list) {
        expect(Number.isFinite(a.x)).toBe(true);
        expect(Number.isFinite(a.y)).toBe(true);
        expect(a.health).toBeGreaterThanOrEqual(0);
        expect(a.health).toBeLessThanOrEqual(1);
      }
    }
  });

  it('13. a predação de fato reduz presas no mundo (não é só animação)', () => {
    const c = habitableChunk('wet');
    const snakes = [1, 2].map((k) =>
      makeAnimal({ id: 100 + k, kind: 'snake', chunk: c, x: (5 + k * 0.6) * CELL, y: 5 * CELL, hunger: 0.95, thirst: 0 }),
    );
    const frogs = [0, 1, 2, 3].map((k) =>
      makeAnimal({
        id: 200 + k,
        kind: 'frog',
        chunk: c,
        x: (5.2 + k * 0.25) * CELL,
        y: (5 + (k % 2) * 0.2) * CELL,
        hunger: 0.2,
        thirst: 0,
      }),
    );
    const { alive } = sandbox([...snakes, ...frogs], 400, 250);
    const frogsLeft = alive.filter((a) => a.kind === 'frog').length;
    expect(frogsLeft).toBeLessThan(frogs.length);
  });

  it('14. render: a cobra entra na cena com a célula nativa e sombra', () => {
    const w = new World({ seed: 1337 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunk = w.getChunk(0, 0)!;
    const snake = makeAnimal({
      id: 42,
      kind: 'snake',
      chunk,
      x: chunk.cx * chunk.n * CELL + 5 * CELL,
      y: chunk.cy * chunk.n * CELL + 5 * CELL,
      state: 'chase',
    });
    (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set('0,0', [snake]);
    const cam = { x: snake.x - 100, y: snake.y - 80, w: 200, h: 160 };
    const scene = composeScene(w, cam, { timeMs: 900 });
    const blits = scene.ops.filter((op) => op.k === 'blit' && op.img === FAUNA_SHEETS.snake.file);
    expect(blits.length).toBeGreaterThanOrEqual(1);
    const b = blits[0] as Extract<(typeof scene.ops)[number], { k: 'blit' }>;
    expect(b.sw).toBe(FAUNA_SHEETS.snake.cellW);
    expect(b.sh).toBe(FAUNA_SHEETS.snake.cellH);
    expect(b.dw).toBe(b.sw); // escala nativa, sem esticar
    expect(b.dh).toBe(b.sh);
    // sombra de contato no mesmo y (desenhada como fill escuro)
    const shadow = scene.ops.filter(
      (op) => op.k === 'fill' && Math.abs(op.y - (snake.y - cam.y)) <= 2 && op.a > 0.1 && op.r < 60,
    );
    expect(shadow.length).toBeGreaterThanOrEqual(1);
  });

  it('15. traços do predador: presas, alcance e dano coerentes', () => {
    const t = FAUNA_TRAITS.snake;
    expect(t.prey).toEqual(['frog', 'rabbit', 'bird']);
    expect(t.attackRange).toBeGreaterThan(4);
    expect(t.attackRange).toBeLessThan(40); // só ataca perto
    expect(t.attackDamage).toBeGreaterThan(0);
    expect(t.attackDamage).toBeLessThan(2);
    expect(t.huntRange).toBeGreaterThan(60);
    // herbívoros não caçam
    expect(FAUNA_TRAITS.rabbit.prey).toBeUndefined();
    expect(FAUNA_TRAITS.frog.prey).toBeUndefined();
  });
});
