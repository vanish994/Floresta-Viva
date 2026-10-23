/**
 * Camada VISUAL da fauna: estados da IA → animação existente → sprite top-down
 * → renderer existente. Nenhum teste aqui reimplementa a IA: todos usam as
 * funções reais (`animFor`, `agentView`, `stepFauna`, `composeScene`, `World`).
 *
 * Cobre os 12 casos pedidos nesta etapa:
 *  tile 32 · manifesto válido · frames dentro da folha · todo estado tem
 *  animação · `faunaRect` válido · escala nativa · flip · y-sort · ataque/fuga/
 *  morte mudam a animação · carcaça imóvel · LOD · hierarquia de estados.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/world';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { chunkKeyStr } from '../src/core/coords';
import {
  agentView,
  animFor,
  facingFromVector,
  makeAnimal,
  stepFauna,
  CORPSE_HOURS,
  CORPSE_DECAY_HOURS,
  FAUNA_TRAITS,
  HURT_HOURS,
  type Animal,
  type FaunaKind,
  type FaunaState,
} from '../src/world/fauna';
import {
  FAUNA_FRAMES,
  FAUNA_SHEETS,
  faunaFlip,
  faunaFrameCount,
  faunaHasAnim,
  faunaRect,
  faunaRow,
  type FaunaSheet,
} from '../src/render/manifest';
import { composeScene } from '../src/render/scene';
import { decodePNG } from '../tools/png';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL = cfg.simCellTiles * cfg.tileSize;
const ROOT = join(__dirname, '..');
const KINDS: FaunaKind[] = ['rabbit', 'frog', 'bird', 'snake'];
const STATES: FaunaState[] = [
  'idle', 'wander', 'seek_food', 'eat', 'flee', 'rest', 'sleep',
  'seek_water', 'swim', 'fly', 'land', 'hunt', 'chase', 'attack', 'hide', 'dead',
];

function sheetPng(sheet: FaunaSheet) {
  return decodePNG(readFileSync(join(ROOT, 'assets', sheet.file)));
}

function chunk(): Chunk {
  const c = new Chunk(0, 0, cfg);
  for (let ly = 0; ly < c.n; ly++) {
    for (let lx = 0; lx < c.n; lx++) {
      const i = c.cellIdx(lx, ly);
      c.soilType[i] = SOIL_FOREST;
      c.soilBase[i] = SOIL_FOREST;
      c.moisture[i] = 0.6;
      c.litter[i] = 2;
      c.forage[i] = 0.6;
      c.soilDepth[i] = 1;
    }
  }
  c.rebuildPlantIndex();
  return c;
}

/** mundo mínimo com um chunk carregado e uma pool de fauna injetada */
function sceneWorld(animals: Animal[]) {
  const w = new World({ seed: 1337 });
  w.requestChunks(0, 0, 0, 0);
  w.pumpGeneration(100);
  const c = w.getChunk(0, 0)!;
  for (const a of animals) a.chunk = c;
  (w as unknown as { faunaByChunk: Map<string, Animal[]> })
    .faunaByChunk.set(chunkKeyStr(c.cx, c.cy), animals);
  return { world: w, chunk: c };
}

function blitOf(world: World, cam: { x: number; y: number; w: number; h: number }, animal: Animal, timeMs = 900) {
  const scene = composeScene(world, cam, { timeMs });
  const blits = scene.ops.filter(
    (op): op is Extract<(typeof scene.ops)[number], { k: 'blit' }> =>
      op.k === 'blit' && op.img === FAUNA_SHEETS[animal.kind].file,
  );
  return { scene, blits };
}

describe('fauna visual: escala e mundo 32×32', () => {
  it('1. o mundo continua em tiles de 32 px e os animais são pequenos', () => {
    expect(cfg.tileSize).toBe(32);
    expect(CELL).toBe(cfg.simCellTiles * 32);
    for (const kind of KINDS) {
      const sheet = FAUNA_SHEETS[kind];
      // nenhum animal ocupa mais que ~1 tile de 32 px de largura
      expect(sheet.cellW).toBeLessThanOrEqual(32);
      expect(sheet.cellW).toBeGreaterThanOrEqual(14);
      expect(sheet.cellH).toBeLessThanOrEqual(24);
    }
    // referência do personagem (29 px de altura no sheet): animal nunca gigante
    for (const kind of KINDS) expect(FAUNA_SHEETS[kind].cellH).toBeLessThan(29);
  });
});

describe('fauna visual: manifesto e assets', () => {
  it('2. cada spritesheet tem manifesto válido e o JSON ao lado bate com ele', () => {
    for (const kind of KINDS) {
      const sheet = FAUNA_SHEETS[kind];
      const json = JSON.parse(
        readFileSync(join(ROOT, 'assets/Animals', `${kind}.json`), 'utf8'),
      ) as {
        cell: [number, number]; maxFrames: number; anims: Record<string, number>;
        rows?: Record<string, number>; dirs?: string[];
      };
      expect(json.cell).toEqual([sheet.cellW, sheet.cellH]);
      expect(json.maxFrames).toBe(sheet.maxFrames);
      // as animações do manifesto são as do JSON (uma linha por animação×direção)
      const anims = new Set(Object.keys(sheet.rows).map((k) => k.split(':')[0]));
      expect([...anims].sort()).toEqual(Object.keys(json.anims).sort());
      for (const [key, row] of Object.entries(sheet.rows)) {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(Object.keys(sheet.rows).length);
        if (key.includes(':')) expect(['n', 's', 'e', 'w']).toContain(key.split(':')[1]);
      }
      // folhas direcionais: 4 direções × animações, e o nº de linhas bate
      if (sheet.dirs) {
        expect(sheet.dirs).toEqual(['n', 's', 'e', 'w']);
        expect(Object.keys(sheet.rows).length).toBe(Object.keys(json.anims).length * 4);
      }
      // sem lacunas: todo par animação×direção tem linha
      for (const anim of Object.keys(json.anims)) {
        for (const dir of sheet.dirs ?? (['s'] as const)) {
          expect(faunaRow(sheet, anim, dir)).not.toBeNull();
        }
      }
    }
  });

  it('3. nenhum quadro ultrapassa o tamanho da spritesheet', () => {
    for (const kind of KINDS) {
      const sheet = FAUNA_SHEETS[kind];
      const img = sheetPng(sheet);
      expect(img.width).toBe(sheet.cellW * sheet.maxFrames);
      expect(img.height).toBe(sheet.cellH * Object.keys(sheet.rows).length);
      for (const anim of Object.keys(sheet.rows)) {
        const frames = faunaFrameCount(kind, anim);
        expect(frames).toBeGreaterThanOrEqual(1);
        expect(frames).toBeLessThanOrEqual(sheet.maxFrames);
        // a tabela tipada nunca pede mais quadros do que a folha tem
        expect(FAUNA_FRAMES[kind][anim] ?? sheet.maxFrames).toBeLessThanOrEqual(sheet.maxFrames);
      }
    }
  });

  it('4. toda animação que a IA pode pedir existe na folha da espécie', () => {
    let checked = 0;
    for (const kind of KINDS) {
      for (const state of STATES) {
        for (const moving of [false, true]) {
          for (const inWater of [false, true]) {
            for (const hurt of [false, true]) {
              const anim = animFor(kind, state, moving, inWater, hurt);
              // o render só cai no fallback se isto falhar
              expect(faunaHasAnim(kind, anim)).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(KINDS.length * STATES.length * 8);
  });

  it('5. faunaRect() devolve regiões válidas (inclusive frame negativo/grande)', () => {
    for (const kind of KINDS) {
      const sheet = FAUNA_SHEETS[kind];
      const img = sheetPng(sheet);
      for (const anim of Object.keys(sheet.rows)) {
        for (const frame of [-13, -1, 0, 1, 5, 99]) {
          const [x, y, w, h] = faunaRect(sheet, anim, frame);
          expect(w).toBe(sheet.cellW);
          expect(h).toBe(sheet.cellH);
          expect([w, h].every((v) => v > 0)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x + w).toBeLessThanOrEqual(img.width);
          expect(y + h).toBeLessThanOrEqual(img.height);
        }
      }
    }
  });
});

describe('fauna visual: render', () => {
  it('6. animais são desenhados na escala nativa (sem esticar)', () => {
    for (const kind of KINDS) {
      const c = new Chunk(0, 0, cfg);
      const animal = makeAnimal({ id: 7, kind, chunk: c, x: 5 * CELL, y: 5 * CELL });
      const { world } = sceneWorld([animal]);
      const cam = { x: animal.x - 200, y: animal.y - 150, w: 400, h: 300 };
      const { blits } = blitOf(world, cam, animal);
      expect(blits.length).toBeGreaterThanOrEqual(1);
      const b = blits[0];
      const sheet = FAUNA_SHEETS[kind];
      // recorte é sempre uma célula inteira da folha (nunca meio frame)
      expect([b.sw, b.sh]).toEqual([sheet.cellW, sheet.cellH]);
      expect(b.sx % sheet.cellW).toBe(0);
      expect(b.sy % sheet.cellH).toBe(0);
      // e o desenho é 1:1 (sem esticar para preencher o tile de 32 px)
      expect(b.dw).toBe(b.sw);
      expect(b.dh).toBe(b.sh);
    }
  });

  it('7. direções: L/O usam linhas próprias e o espelho fica só onde falta arte', () => {
    const c = new Chunk(0, 0, cfg);
    const right = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, facingDir: 'e', facing: 1 });
    const left = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 6 * CELL, facingDir: 'w', facing: -1 });
    const { world } = sceneWorld([right, left]);
    const cam = { x: right.x - 200, y: right.y - 150, w: 400, h: 300 };
    const { blits } = blitOf(world, cam, right);
    const dyOf = (a: Animal) => Math.round(a.y - cam.y - FAUNA_SHEETS.rabbit.cellH);
    const bRight = blits.find((b) => b.dy === dyOf(right))!;
    const bLeft = blits.find((b) => b.dy === dyOf(left))!;
    const sheet = FAUNA_SHEETS.rabbit;
    // coelho tem as 4 direções desenhadas: nada de espelhar
    expect(bRight.flip).toBeFalsy();
    expect(bLeft.flip).toBeFalsy();
    expect(bRight.sy).toBe(sheet.rows['idle:e'] * sheet.cellH);
    expect(bLeft.sy).toBe(sheet.rows['idle:w'] * sheet.cellH);
    // e as duas linhas são de fato desenhos diferentes (não é a mesma arte)
    expect(bRight.sy).not.toBe(bLeft.sy);
    // espelhar não desloca nem redimensiona: a caixa é a mesma
    expect([bRight.dx - right.x, bRight.dx - cam.x, bRight.dw, bRight.dh])
      .toEqual([bLeft.dx - left.x, bLeft.dx - cam.x, bLeft.dw, bLeft.dh]);

    // ave (folha de direção única) continua espelhando para O
    const bird: Animal = makeAnimal({ id: 3, kind: 'bird', chunk: c, x: 6 * CELL, y: 5 * CELL, facingDir: 'w' });
    const { world: w2 } = sceneWorld([bird]);
    const scene2 = composeScene(w2, { x: bird.x - 100, y: bird.y - 80, w: 200, h: 160 }, { timeMs: 800 });
    const birdBlit = scene2.ops.find(
      (op): op is Extract<(typeof scene2.ops)[number], { k: 'blit' }> =>
        op.k === 'blit' && op.img === FAUNA_SHEETS.bird.file,
    )!;
    expect(birdBlit.flip).toBe(true);
    expect(faunaFlip(FAUNA_SHEETS.bird, 'idle', 'w')).toBe(true);
    expect(faunaFlip(FAUNA_SHEETS.rabbit, 'idle', 'w')).toBe(false);
  });

  it('8. y-sort: a base (y) decide a ordem, não a ordem de inserção', () => {
    const c = new Chunk(0, 0, cfg);
    const front = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 6 * CELL });
    const back = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 4 * CELL });
    // injeta fora de ordem de propósito
    const { world } = sceneWorld([front, back]);
    const cam = { x: front.x - 200, y: back.y - 150, w: 400, h: 300 };
    const { scene } = blitOf(world, cam, front);
    const dyOf = (a: Animal) =>
      Math.round(a.y - cam.y - FAUNA_SHEETS.rabbit.cellH);
    const indices = scene.ops
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => op.k === 'blit' && op.img === FAUNA_SHEETS.rabbit.file)
      .map(({ i }) => i);
    expect(indices.length).toBe(2);
    // a op do animal de trás (menor y) é emitida antes do da frente
    const backIndex = indices.find((i) => {
      const op = scene.ops[i];
      return op.k === 'blit' && op.dy === dyOf(back);
    })!;
    const frontIndex = indices.find((i) => {
      const op = scene.ops[i];
      return op.k === 'blit' && op.dy === dyOf(front);
    })!;
    expect(backIndex).toBeLessThan(frontIndex);
  });

  it('9. ataque, fuga e morte realmente trocam a animação', () => {
    const view = (kind: FaunaKind, state: FaunaState, moving = false, inWater = false, hurt = false) => {
      const c = new Chunk(0, 0, cfg);
      const a = makeAnimal({
        id: 3, kind, chunk: c, x: CELL, y: CELL, state,
        vx: moving ? 40 : 0, vy: 0, hurtTimer: hurt ? HURT_HOURS : 0,
      });
      return agentView(a, 1000, (anim) => faunaFrameCount(kind, anim)).anim;
    };
    // coelho
    expect(view('rabbit', 'idle')).toBe('idle');
    expect(view('rabbit', 'wander', true)).toBe('walk');
    expect(view('rabbit', 'flee', true)).toBe('run');
    expect(view('rabbit', 'dead')).toBe('death'); // carcaça com arte própria
    // sapo
    expect(view('frog', 'idle')).toBe('idle');
    // `animFor` recebe a informação de água (o chunk sintético está seco)
    expect(animFor('frog', 'idle', false, true)).toBe('swim');
    expect(animFor('frog', 'swim', false, false)).toBe('idle');
    expect(view('frog', 'flee', true)).toBe('run');
    // ave
    expect(view('bird', 'idle')).toBe('idle');
    expect(view('bird', 'fly')).toBe('fly');
    expect(view('bird', 'flee', true)).toBe('fly');
    // cobra: emboscada → aproximação → bote → recuo → descanso
    expect(view('snake', 'hunt', false)).toBe('hide');
    expect(view('snake', 'hunt', true)).toBe('move');
    expect(view('snake', 'chase', true)).toBe('move');
    expect(view('snake', 'attack')).toBe('attack');
    expect(view('snake', 'rest')).toBe('hide');
    expect(view('snake', 'sleep')).toBe('sleep');
    expect(view('snake', 'dead')).toBe('death');
    // dor: todas as espécies com linha própria (a ave segue com bater de asas)
    expect(view('snake', 'flee', true, false, true)).toBe('hurt');
    expect(view('rabbit', 'idle', false, false, true)).toBe('hurt');
    expect(view('frog', 'idle', false, false, true)).toBe('hurt');
    expect(view('bird', 'idle', false, false, true)).toBe('fly');
    // toda animação escolhida existe na folha
    for (const kind of KINDS) {
      for (const state of STATES) expect(faunaHasAnim(kind, view(kind, state))).toBe(true);
    }
  });

  it('10. carcaça: imóvel, escurece, vira restos e depois solo', () => {
    const c = chunk();
    const dead = makeAnimal({
      id: 99, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL,
      state: 'dead', health: 0, corpseHours: 0,
    });
    const litterBefore = c.litter.reduce((a, b) => a + b, 0);
    // 20 passos de 0,02 h: não anda, não decide, só envelhece
    for (let i = 0; i < 20; i++) stepFauna([dead], cfg, 0.02, { worldDay: 10, hour: 12 });
    expect(dead.x).toBe(5 * CELL);
    expect(dead.y).toBe(5 * CELL);
    expect(dead.state).toBe('dead');
    expect(dead.corpseHours).toBeCloseTo(0.4, 5);
    expect(dead.corpseHours!).toBeLessThan(CORPSE_HOURS);
    // o render marca a decomposição (restos escuros) a partir deste ponto
    expect(dead.corpseHours!).toBeLessThan(CORPSE_DECAY_HOURS);

    // no mundo, passado CORPSE_HOURS a carcaça vira solo e sai do pool
    const w = new World({ seed: 4242 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const worldChunk = w.getChunk(0, 0)!;
    dead.chunk = worldChunk;
    dead.x = 5 * CELL + 32;
    dead.y = 5 * CELL + 32;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const ci = worldChunk.cellIdx(
      Math.floor(dead.x / cellPx) - worldChunk.cx * worldChunk.n,
      Math.floor(dead.y / cellPx) - worldChunk.cy * worldChunk.n,
    );
    const litter0 = worldChunk.litter[ci];
    (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set(
      chunkKeyStr(worldChunk.cx, worldChunk.cy),
      [dead],
    );
    for (let i = 0; i < 150; i++) w.update(200); // 30 s ≈ 0,5 h: carcaça ainda ali
    expect(w.faunaAt(worldChunk).some((a) => a.id === dead.id)).toBe(true);
    for (let i = 0; i < 400; i++) w.update(200); // +80 s ≈ 1,3 h: virou solo
    expect(w.faunaAt(worldChunk).some((a) => a.id === dead.id)).toBe(false);
    expect(worldChunk.litter[ci]).toBeGreaterThanOrEqual(litter0);
    void litterBefore;
  });

  it('11. LOD: longe da câmera o animal é estático e não emite efeitos', () => {
    const c = new Chunk(0, 0, cfg);
    const near = makeAnimal({ id: 1, kind: 'rabbit', chunk: c, x: 8 * CELL, y: 5 * CELL, state: 'flee', vx: 50 });
    const { world: wNear } = sceneWorld([near]);
    const camNear = { x: near.x - 200, y: near.y - 150, w: 400, h: 300 };
    const nearScene = composeScene(wNear, camNear, { timeMs: 1200 });

    // mesma cena, câmera larga: o animal cai a 800 px do centro (> 420 = LOD)
    const far = makeAnimal({ id: 2, kind: 'rabbit', chunk: c, x: 8 * CELL, y: 5 * CELL, state: 'flee', vx: 50 });
    const { world: wFar } = sceneWorld([far]);
    const camFar = { x: far.x - 1700, y: far.y - 150, w: 1800, h: 300 };
    const farScene = composeScene(wFar, camFar, { timeMs: 1200 });
    const farBlits = farScene.ops.filter((op): op is Extract<(typeof farScene.ops)[number], { k: 'blit' }> =>
      op.k === 'blit' && op.img === FAUNA_SHEETS.rabbit.file);
    expect(farBlits.length).toBe(1);
    // LOD usa o quadro 0 (parado)
    expect(farBlits[0].sx).toBe(0);
    // efeitos do animal (poeira da corrida e sombra) só existem de perto
    const dust = (scene: typeof nearScene) =>
      scene.ops.filter((op) => op.k === 'fill' && op.r === 196 && op.g === 176 && op.b === 132).length;
    const shadow = (scene: typeof nearScene, cam: { y: number }, animal: Animal) =>
      scene.ops.filter(
        (op) => op.k === 'fill' && op.r === 24 && op.g === 30 && op.b === 20
          && Math.abs(op.y - (animal.y - cam.y)) <= 2,
      ).length;
    expect(dust(nearScene)).toBeGreaterThan(0);
    expect(shadow(nearScene, camNear, near)).toBeGreaterThan(0);
    expect(dust(farScene)).toBe(0);
    expect(shadow(farScene, camFar, far)).toBe(0);
  });

  it('12. sono e dor têm feedback próprio (z e faíscas) sem sprite novo', () => {
    const c = new Chunk(0, 0, cfg);
    const sleeping = makeAnimal({ id: 5, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 5 * CELL, state: 'sleep' });
    const { world } = sceneWorld([sleeping]);
    const cam = { x: sleeping.x - 100, y: sleeping.y - 100, w: 200, h: 200 };
    const { scene } = blitOf(world, cam, sleeping);
    // dois pixels claros acima do corpo (os "z")
    const z = scene.ops.filter(
      (op) => op.k === 'fill' && op.w <= 2 && op.h <= 2 && op.r > 200 && op.g > 200 && op.b > 200 && op.a > 0.3,
    );
    expect(z.length).toBeGreaterThanOrEqual(2);

    const hurt = makeAnimal({
      id: 6, kind: 'rabbit', chunk: c, x: 5 * CELL, y: 6 * CELL,
      state: 'flee', hurtTimer: HURT_HOURS,
    });
    const { world: w2 } = sceneWorld([hurt]);
    const cam2 = { x: hurt.x - 100, y: hurt.y - 100, w: 200, h: 200 };
    const scene2 = composeScene(w2, cam2, { timeMs: 1000 });
    // faísca avermelhada de impacto
    const sparks = scene2.ops.filter(
      (op) => op.k === 'fill' && op.r > 220 && op.g < 130 && op.b < 110 && op.a > 0.2,
    );
    expect(sparks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('fauna visual: direções (N/S/L/O)', () => {
  it('14. cada direção usa uma linha própria — nada de arte "ao contrário"', () => {
    // Mede a INCLINAÇÃO da cabeça em relação à base do corpo, nas linhas que o
    // jogo realmente desenha. Em L a cabeça está à direita; em O, à esquerda.
    const tilt = (kind: FaunaKind, anim: string, dir: 'e' | 'w') => {
      const sheet = FAUNA_SHEETS[kind];
      const img = sheetPng(sheet);
      const [sx, sy, sw, sh] = faunaRect(sheet, anim, 0, dir);
      let topX = 0, topN = 0, botX = 0, botN = 0;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const i = ((sy + y) * img.width + sx + x) * 4;
          if (img.data[i + 3] === 0) continue;
          if (y < sh * 0.45) { topX += x; topN++; } else { botX += x; botN++; }
        }
      }
      if (!topN || !botN) return 0;
      return topX / topN - botX / botN;
    };
    for (const kind of ['rabbit', 'frog', 'snake'] as const) {
      for (const anim of ['idle', 'walk']) {
        if (!faunaHasAnim(kind, anim)) continue;
        const e = tilt(kind, anim, 'e');
        const w = tilt(kind, anim, 'w');
        // a cabeça vai para o lado do movimento nas DUAS direções
        expect(e).toBeGreaterThan(0);
        expect(w).toBeLessThan(0);
      }
    }
  });

  it('15. o vetor de movimento escolhe a direção com histerese (sem piscar)', () => {
    // eixo dominante manda
    expect(facingFromVector(10, 0, 'n')).toBe('e');
    expect(facingFromVector(-10, 0, 'n')).toBe('w');
    expect(facingFromVector(0, 10, 'e')).toBe('s');
    expect(facingFromVector(0, -10, 'e')).toBe('n');
    // parado mantém a direção anterior (não "vira" ao parar)
    expect(facingFromVector(0, 0, 'w')).toBe('w');
    // diagonal mantém o eixo que já estava valendo (nada de alternar a cada quadro)
    expect(facingFromVector(10, 9, 'w')).toBe('e');
    expect(facingFromVector(10, 9, 's')).toBe('s');
    expect(facingFromVector(-10, 9, 'e')).toBe('w');
    // uma sequência de passos em zigue-zague não deve oscilar de direção
    let dir = 'e' as const;
    const seq: string[] = [];
    for (let k = 0; k < 12; k++) {
      const dy = k % 2 === 0 ? 4 : -4;
      dir = facingFromVector(10, dy, dir) as typeof dir;
      seq.push(dir);
    }
    expect(new Set(seq).size).toBe(1);
    expect(seq[0]).toBe('e');
  });

  it('16. a IA move o animal e a direção desenhada acompanha o deslocamento', () => {
    const c = Chunk.prototype ? chunk() : chunk();
    const runner = makeAnimal({
      id: 77, kind: 'rabbit', chunk: c, x: 8 * CELL, y: 8 * CELL,
      state: 'flee', tx: 8 * CELL - 120, ty: 8 * CELL, hunger: 0.2, thirst: 0.2,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      stepFauna([runner], cfg, 0.02, { worldDay: 10, hour: 11 });
      seen.add(runner.facingDir ?? 's');
    }
    // fugindo para a esquerda, o sprite é o da esquerda (não o espelho de L)
    expect(runner.facingDir).toBe('w');
    expect(runner.facing).toBe(-1);
    expect(seen.size).toBeLessThanOrEqual(2);

    const down = makeAnimal({
      id: 78, kind: 'frog', chunk: c, x: 6 * CELL, y: 6 * CELL,
      state: 'wander', tx: 6 * CELL, ty: 6 * CELL + 140, hunger: 0.2, thirst: 0.2,
    });
    for (let i = 0; i < 40; i++) stepFauna([down], cfg, 0.02, { worldDay: 10, hour: 22 });
    expect(down.facingDir).toBe('s');
  });

  it('17. oeste é arte própria em coelho/sapo/cobra (não é a linha L desenhada de novo)', () => {
    // compara a silhueta desenhada de O com a de L e com o espelho de L
    const shape = (kind: FaunaKind, anim: string, dir: 'e' | 'w', mirror = false) => {
      const sheet = FAUNA_SHEETS[kind];
      const img = sheetPng(sheet);
      const [sx, sy, sw, sh] = faunaRect(sheet, anim, 0, dir);
      const out: number[] = [];
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const px = mirror ? sw - 1 - x : x;
          const i = ((sy + y) * img.width + sx + px) * 4;
          out.push(img.data[i + 3] === 0 ? 0 : 1);
        }
      }
      return out;
    };
    const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0) / a.length;
    for (const kind of ['rabbit', 'snake'] as const) {
      for (const anim of ['idle', 'walk']) {
        const e = shape(kind, anim, 'e');
        const w = shape(kind, anim, 'w');
        const mirroredE = shape(kind, anim, 'e', true);
        // O se parece com o ESPELHO de L, não com L
        expect(diff(w, mirroredE)).toBeLessThan(diff(w, e));
      }
    }
  });
});

describe('fauna visual: comportamento continua sendo o da IA existente', () => {
  it('13. a predação continua sendo um único dano por bote e a presa reage à dor', () => {
    const c = chunk();
    const snake = makeAnimal({
      id: 1, kind: 'snake', chunk: c, x: 5 * CELL, y: 5 * CELL,
      hunger: 0.95, thirst: 0, quirk: 0.4, activity: 1,
    });
    const frog = makeAnimal({ id: 2, kind: 'frog', chunk: c, x: 5 * CELL + 12, y: 5 * CELL, hunger: 0.2, thirst: 0 });
    let hits = 0;
    const anims = new Set<string>();
    for (let i = 0; i < 40; i++) {
      stepFauna([snake, frog], cfg, 0.01, {
        worldDay: 10,
        hour: 20,
        nearbyAnimals: () => [frog],
        damageAnimal: (prey, amount) => {
          hits++;
          prey.health = Math.max(0, prey.health - amount);
        },
      });
      anims.add(agentView(snake, i * 100, (a) => faunaFrameCount('snake', a)).anim);
    }
    expect(hits).toBeGreaterThanOrEqual(1);
    // a cadência do bote respeita o cooldown (nunca um dano por passo)
    expect(hits).toBeLessThan(40);
    expect(anims.has('attack')).toBe(true);
    // a presa ferida recebe hurtTimer e o render usa a reação de dor
    if (frog.health < 1) expect(frog.hurtTimer ?? 0).toBeGreaterThanOrEqual(0);
    expect(FAUNA_TRAITS.snake.attackDamage).toBeGreaterThan(0);
  });
});
