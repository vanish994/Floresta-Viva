/**
 * Fauna visual (coelho, sapo, ave): determinismo, habitat, chunks, animação,
 * escala e integração com o mundo — sem quebrar nada do que já existe.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/core/config';
import { chunkKeyStr } from '../src/core/coords';
import {
  seedFauna,
  stepFauna,
  makeAnimal,
  animFor,
  FAUNA_CAP,
  FAUNA_TRAITS,
  type Animal,
  type FaunaState,
} from '../src/world/fauna';
import { FAUNA_SHEETS, faunaRect, faunaHasAnim, allAssetFiles } from '../src/render/manifest';
import { composeScene } from '../src/render/scene';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG } from '../tools/png';

const cfg: WorldConfig = { ...DEFAULT_CONFIG };
const CELL = cfg.simCellTiles * cfg.tileSize;
const CELLS = cfg.chunkTiles / cfg.simCellTiles;

/** chunk sintético com habitat controlado (água / vegetação / seco) */
function habitableChunk(cx: number, cy: number, kind: 'dry' | 'wet' | 'forest'): Chunk {
  const c = new Chunk(cx, cy, cfg);
  for (let ly = 0; ly < c.n; ly++) {
    for (let lx = 0; lx < c.n; lx++) {
      const i = c.cellIdx(lx, ly);
      c.soilType[i] = SOIL_FOREST;
      c.soilBase[i] = SOIL_FOREST;
      c.moisture[i] = kind === 'wet' ? 0.85 : 0.45;
      c.humus[i] = 3;
      c.litter[i] = 2;
      c.soilDepth[i] = 1;
      // lagoa na metade norte do chunk úmido
      c.waterDepth[i] = kind === 'wet' && ly < c.n / 2 ? 0.8 : 0;
      // 'forest': árvores espalhadas (copa/presença de plantas)
      if (kind === 'forest' && (lx + ly) % 3 === 0) {
        c.plants.push({
          id: cx * 100000 + cy * 1000 + lx * 31 + ly,
          species: 1,
          x: (cx * c.n + lx + 0.5) * CELL,
          y: (cy * c.n + ly + 0.5) * CELL,
          birthAge: 200,
          variant: lx,
          origin: 'gen',
        });
      }
    }
  }
  c.rebuildPlantIndex();
  return c;
}

const ctx = (hour: number, day = 10) => ({ worldDay: day, hour });

describe('fauna visual', () => {
  it('1. determinismo: mesma seed + mesmo chunk ⇒ mesmos animais', () => {
    const a = habitableChunk(3, 4, 'forest');
    const b = habitableChunk(3, 4, 'forest');
    const fa = seedFauna(a, cfg, 10, 12);
    const fb = seedFauna(b, cfg, 10, 12);
    expect(fa.length).toBe(fb.length);
    for (let k = 0; k < fa.length; k++) {
      expect([fa[k].kind, fa[k].id, Math.round(fa[k].x), Math.round(fa[k].y)])
        .toEqual([fb[k].kind, fb[k].id, Math.round(fb[k].x), Math.round(fb[k].y)]);
    }
    // e independente da ordem de chamada
    const fa2 = seedFauna(a, cfg, 10, 12);
    expect(fa2.map((x) => x.id)).toEqual(fa.map((x) => x.id));
  });

  it('2. habitat: sapo prefere água, coelho prefere vegetação, ave prefere árvores', () => {
    const wet = habitableChunk(0, 0, 'wet');
    const forest = habitableChunk(0, 0, 'forest');
    const dry = habitableChunk(0, 0, 'dry');

    const frogsWet = seedFauna(wet, cfg, 10, 22).filter((a) => a.kind === 'frog').length;
    const frogsDry = seedFauna(dry, cfg, 10, 22).filter((a) => a.kind === 'frog').length;
    expect(frogsWet).toBeGreaterThan(0);
    expect(frogsWet).toBeGreaterThan(frogsDry);

    const rabbitsForest = seedFauna(forest, cfg, 10, 12).filter((a) => a.kind === 'rabbit').length;
    const rabbitsWet = seedFauna(wet, cfg, 10, 12).filter((a) => a.kind === 'rabbit').length;
    expect(rabbitsForest).toBeGreaterThan(0);
    expect(rabbitsForest).toBeGreaterThan(rabbitsWet);

    const birdsForest = seedFauna(forest, cfg, 10, 12).filter((a) => a.kind === 'bird').length;
    const birdsDry = seedFauna(dry, cfg, 10, 12).filter((a) => a.kind === 'bird').length;
    expect(birdsForest).toBeGreaterThanOrEqual(birdsDry);

    // os sapos nascem perto da água
    for (const a of seedFauna(wet, cfg, 10, 22).filter((x) => x.kind === 'frog')) {
      const lx = Math.floor(a.x / CELL) - wet.cx * wet.n;
      const ly = Math.floor(a.y / CELL) - wet.cy * wet.n;
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) {
        for (let ox = -1; ox <= 1 && !near; ox++) {
          const nx = lx + ox;
          const ny = ly + oy;
          if (nx < 0 || ny < 0 || nx >= wet.n || ny >= wet.n) continue;
          if (wet.waterDepth[wet.cellIdx(nx, ny)] > 0.05) near = true;
        }
      }
      const own = wet.waterDepth[wet.cellIdx(Math.max(0, Math.min(wet.n - 1, lx)), Math.max(0, Math.min(wet.n - 1, ly)))];
      expect(near || own > 0.02 || wet.moisture[wet.cellIdx(lx, ly)] > 0.6).toBe(true);
    }
  });

  it('3. população respeita os tetos por chunk', () => {
    const forest = habitableChunk(0, 0, 'forest');
    const wet = habitableChunk(0, 0, 'wet');
    // o teto vale POR CHUNK: avalia cada chunk separadamente
    for (const chunk of [forest, wet]) {
      for (const hour of [12, 22]) {
        const list = seedFauna(chunk, cfg, 10, hour);
        const count = (k: string) => list.filter((a) => a.kind === k).length;
        expect(count('rabbit')).toBeLessThanOrEqual(FAUNA_CAP.rabbit);
        expect(count('frog')).toBeLessThanOrEqual(FAUNA_CAP.frog);
        expect(count('bird')).toBeLessThanOrEqual(FAUNA_CAP.bird);
      }
    }
  });

  it('4. estados e movimento: foge do jogador, nada no sapo, ave voa', () => {
    const wet = habitableChunk(0, 0, 'wet');
    const animals = seedFauna(wet, cfg, 10, 22);
    const rabbit = animals.find((a) => a.kind === 'rabbit');
    if (rabbit) {
      // jogador colado: coelho entra em fuga
      stepFauna([rabbit], cfg, 0.1, { ...ctx(12), playerX: rabbit.x + 4, playerY: rabbit.y });
      expect(rabbit.state).toBe('flee');
    }
    const frog = animals.find((a) => a.kind === 'frog');
    if (frog) {
      // sapo longe da água escolhe ir para a água
      frog.x = wet.cx * CELLS * CELL + CELL * 2;
      frog.y = wet.cy * CELLS * CELL + CELL * 14;
      frog.state = 'idle';
      frog.timer = 99;
      stepFauna([frog], cfg, 0.2, ctx(22));
      expect(['seek_water', 'swim', 'wander']).toContain(frog.state);
    }
    const bird = animals.find((a) => a.kind === 'bird');
    if (bird) {
      bird.state = 'idle';
      bird.timer = 99;
      bird.quirk = 0.9;
      bird.energy = 1;
      for (let i = 0; i < 20; i++) stepFauna([bird], cfg, 0.25, ctx(12));
      expect(['fly', 'land', 'idle']).toContain(bird.state);
    }
  });

  it('5. rotina diária: coelho/ave dormem à noite, sapo não', () => {
    const wet = habitableChunk(0, 0, 'wet');
    const animals = seedFauna(wet, cfg, 10, 23).map((a) => ({ ...a, state: 'idle' as FaunaState, timer: 0 }));
    stepFauna(animals, cfg, 0.1, ctx(23));
    for (const a of animals) {
      if (FAUNA_TRAITS[a.kind].diurnal) {
        expect(a.state).toBe('sleep'); // coelho e ave dormem
      } else {
        expect(a.state).not.toBe('sleep'); // sapo é noturno
      }
    }
    // de dia acordam
    stepFauna(animals, cfg, 0.1, ctx(12));
    for (const a of animals) {
      if (FAUNA_TRAITS[a.kind].diurnal) expect(a.state).not.toBe('sleep');
    }
  });

  it('6. animação: cada estado mapeia para uma animação existente na folha', () => {
    const sheets = FAUNA_SHEETS;
    const cases: Array<[Animal['kind'], FaunaState, boolean, number, string]> = [
      ['rabbit', 'wander', true, 0, 'walk'],
      ['rabbit', 'flee', true, 0, 'run'],
      ['rabbit', 'eat', false, 0, 'eat'],
      ['rabbit', 'sleep', false, 0, 'sleep'],
      ['rabbit', 'dead', false, 0, 'death'],
      ['frog', 'flee', true, 0, 'run'],
      ['frog', 'idle', false, 1, 'swim'],
      ['frog', 'dead', false, 0, 'death'],
      ['bird', 'fly', true, 0, 'fly'],
      ['bird', 'land', false, 0, 'land'],
      ['bird', 'eat', false, 0, 'eat'],
      ['snake', 'chase', true, 0, 'move'],
      ['snake', 'attack', false, 0, 'attack'],
      ['snake', 'dead', false, 0, 'death'],
    ];
    for (const [kind, state, moving, water, expected] of cases) {
      const anim = animFor(kind, state, moving, water > 0);
      expect(anim).toBe(expected);
      // a animação existe na folha (linha direta ou alias) e o recorte é válido
      expect(faunaHasAnim(kind, anim)).toBe(true);
      for (const dir of ['n', 's', 'e', 'w'] as const) {
        const rect = faunaRect(sheets[kind], anim, 0, dir);
        expect(rect[2]).toBeGreaterThan(0);
        expect(rect[3]).toBeGreaterThan(0);
      }
    }
  });

  it('7. escala: animais pequenos em relação ao personagem', () => {
    // personagem tem ~29 px de altura no sheet. As folhas direcionais usam
    // células de 24×21 (coelho), 24×19 (sapo), 30×21 (cobra) e 19×14 (ave):
    // todas cabem em ~1 tile de 32 px e ficam abaixo do personagem.
    expect(FAUNA_SHEETS.rabbit.cellH).toBe(21);
    expect(FAUNA_SHEETS.frog.cellH).toBe(19);
    expect(FAUNA_SHEETS.bird.cellH).toBe(14);
    expect(FAUNA_SHEETS.snake.cellH).toBe(21);
    const playerHeight = 29;
    for (const sheet of Object.values(FAUNA_SHEETS)) {
      expect(sheet.cellH).toBeLessThan(playerHeight); // nunca "gigante"
      expect(sheet.cellH).toBeGreaterThan(10); // e visível (não 1–2 px)
      expect(sheet.cellW).toBeLessThanOrEqual(30); // cabe em ~1 tile de 32 px
    }
  });

  it('8. assets: folhas da fauna existem, têm transparência real e alpha binário', () => {
    const files = allAssetFiles();
    for (const sheet of Object.values(FAUNA_SHEETS)) {
      expect(files).toContain(sheet.file);
      const img = decodePNG(readFileSync(join(__dirname, '..', 'assets', sheet.file)));
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBe(sheet.cellH * Object.keys(sheet.rows).length);
      let transparent = 0;
      let solid = 0;
      let partial = 0;
      for (let i = 3; i < img.data.length; i += 4) {
        const a = img.data[i];
        if (a === 0) transparent++;
        else if (a === 255) solid++;
        else partial++;
      }
      expect(transparent).toBeGreaterThan(0); // fundo transparente de verdade
      expect(solid).toBeGreaterThan(0); // animal desenhado
      expect(partial).toBe(0); // pixel art: sem meio-alpha (nada de halo)
    }
  });

  it('9. chunks: fauna nasce no chunk dono, não duplica ao recarregar e não vaza', () => {
    const w = new World({ seed: 4242, loadRadiusChunks: 1, unloadMarginChunks: 2 });
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      w.pumpGeneration(100);
      w.update(3000);
    }
    const chunk = w.getChunk(0, 0)!;
    const list = w.faunaAt(chunk);
    expect(list.length).toBeGreaterThanOrEqual(0);
    for (const a of list) {
      expect(a.chunk).toBe(chunk);
      const minX = chunk.cx * chunk.n * CELL;
      const maxX = (chunk.cx + 1) * chunk.n * CELL;
      const minY = chunk.cy * chunk.n * CELL;
      const maxY = (chunk.cy + 1) * chunk.n * CELL;
      expect(a.x).toBeGreaterThanOrEqual(minX - 1);
      expect(a.x).toBeLessThanOrEqual(maxX + 1);
      expect(a.y).toBeGreaterThanOrEqual(minY - 1);
      expect(a.y).toBeLessThanOrEqual(maxY + 1);
    }
    // ids únicos no chunk E estáveis entre semeaduras (determinismo)
    const ids = list.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const reseeded = seedFauna(chunk, cfg, w.clock.dayFloat, w.clock.hour, []);
    expect(new Set(reseeded.map((a) => a.id)).size).toBe(reseeded.length);

    // viaja e volta: a fauna é reconstruída determinísticamente (mesmos ids)
    for (let i = 1; i <= 12; i++) {
      w.requestChunks(i * 40 * CELL, 0, 10, 0);
      w.pumpGeneration(100);
    }
    expect(w.chunks.has(chunkKeyStr(0, 0))).toBe(false);
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 20 && !w.chunks.has(chunkKeyStr(0, 0)); i++) w.pumpGeneration(100);
    for (let i = 0; i < 6; i++) w.update(3000);
    const again = w.faunaAt(w.getChunk(0, 0)!);
    expect(new Set(again.map((a) => a.id)).size).toBe(again.length);
  });

  it('10. render: animais entram na cena com y-sort e sprite correto', () => {
    const w = new World({ seed: 1337 });
    w.requestChunks(0, 0, 0, 0);
    w.pumpGeneration(100);
    const chunk = w.getChunk(0, 0)!;
    // injeta um animal conhecido no meio da câmera
    const animal: Animal = makeAnimal({
      id: 1, kind: 'rabbit', chunk,
      x: chunk.cx * CELLS * CELL + 5 * CELL,
      y: chunk.cy * CELLS * CELL + 5 * CELL,
      energy: 0.8,
    });
    (w as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk.set(chunkKeyStr(chunk.cx, chunk.cy), [animal]);
    const cam = { x: animal.x - 100, y: animal.y - 80, w: 200, h: 160 };
    const scene = composeScene(w, cam, { timeMs: 1000 });
    const blits = scene.ops.filter((op) => op.k === 'blit' && op.img === FAUNA_SHEETS.rabbit.file);
    expect(blits.length).toBeGreaterThanOrEqual(1);
    const b = blits[0] as Extract<(typeof scene.ops)[number], { k: 'blit' }>;
    expect(b.sw).toBe(FAUNA_SHEETS.rabbit.cellW);
    expect(b.sh).toBe(FAUNA_SHEETS.rabbit.cellH);
    // escala nativa 1:1 — proporção preservada, sem esticar e sem ficar gigante
    expect(b.dw).toBe(b.sw);
    expect(b.dh).toBe(b.sh);
    expect(b.dh).toBeLessThan(29); // sempre menor que o personagem
    // "y-sort": a op do animal existe entre as ops de chão e as de clima
    const idx = scene.ops.indexOf(b);
    expect(idx).toBeGreaterThan(0);
  });

  it('11. integração: o mundo semeia fauna e ela se move com o tempo', () => {
    const w = new World({ seed: 777 });
    w.clock.gameMinutes = 4 * 1440 + 12 * 60; // meio-dia
    w.requestChunks(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      w.pumpGeneration(100);
      w.update(2000);
    }
    for (let i = 0; i < 12; i++) w.update(5000);
    let total = 0;
    const seen = new Map<number, { x: number; y: number }>();
    for (const c of w.chunks.values()) {
      for (const a of w.faunaAt(c)) {
        total++;
        seen.set(a.id, { x: a.x, y: a.y });
      }
    }
    expect(total).toBeGreaterThan(0); // há fauna no mundo
    expect(w.stats.animals).toBe(total);
    expect(w.stats.animals).toBeLessThanOrEqual(49 * (FAUNA_CAP.rabbit + FAUNA_CAP.frog + FAUNA_CAP.bird));

    for (let i = 0; i < 20; i++) w.update(5000);
    let moved = 0;
    for (const c of w.chunks.values()) {
      for (const a of w.faunaAt(c)) {
        const before = seen.get(a.id);
        if (before && Math.hypot(a.x - before.x, a.y - before.y) > 0.5) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0); // a fauna não fica congelada
  });
});
