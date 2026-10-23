/**
 * Testes de natação: entrar na água profunda, vadeo, correnteza, fôlego e
 * colisões. Usam o `Player` real do jogo sobre chunks sintéticos injetados no
 * mundo, para controlar exatamente profundidade, correnteza e relevo.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Player, SWIM_DEPTH_M, WADE_DEPTH_M } from '../src/game/player';
import { Chunk, SOIL_ALLUVIAL } from '../src/world/chunk';
import type { PlantRecord } from '../src/world/flora';
import { speciesIndex } from '../src/world/flora';
import { composeScene } from '../src/render/scene';

interface CellSpec {
  depth?: number;
  vx?: number;
  vy?: number;
  elev?: number;
  slope?: number;
}

/**
 * Cria `cols` chunks sintéticos em linha (cx = 0..cols-1) e os registra no mundo
 * (assim `world.cellAt` enxerga a região). `spec` recebe coordenadas GLOBAIS.
 */
function worldWith(
  spec: (lx: number, ly: number, gx: number) => CellSpec,
  cols = 1,
): { world: World; chunk: Chunk; chunks: Chunk[] } {
  const world = new World({ seed: 99 });
  const chunks: Chunk[] = [];
  for (let cx = 0; cx < cols; cx++) {
    const chunk = new Chunk(cx, 0, world.cfg);
    for (let ly = 0; ly < chunk.n; ly++) {
      for (let lx = 0; lx < chunk.n; lx++) {
        const i = chunk.cellIdx(lx, ly);
        const s = spec(lx, ly, cx * chunk.n + lx);
        chunk.elev[i] = s.elev ?? 10;
        chunk.slope[i] = s.slope ?? 0.2;
        chunk.waterDepth[i] = s.depth ?? 0;
        chunk.flowX[i] = s.vx ?? 0;
        chunk.flowY[i] = s.vy ?? 0;
        chunk.waterKind[i] = (s.depth ?? 0) > 0.05 ? 2 : 0;
        chunk.soilType[i] = SOIL_ALLUVIAL;
        chunk.soilBase[i] = SOIL_ALLUVIAL;
        chunk.soilDepth[i] = 1;
        chunk.moisture[i] = 0.6;
      }
    }
    chunk.rebuildPlantIndex();
    chunk.ready = true;
    world.chunks.set(`${cx},0`, chunk);
    chunks.push(chunk);
  }
  return { world, chunk: chunks[0], chunks };
}

const CELL_PX = 64;

/** roda `seconds` segundos com passo fixo de 1/60 s (determinístico) */
function run(player: Player, world: World, axis: { x: number; y: number }, seconds: number): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) player.update(world, dt, axis);
}

function placeAt(player: Player, cellX: number, cellY: number): void {
  player.x = (cellX + 0.5) * CELL_PX;
  player.y = (cellY + 0.5) * CELL_PX;
}

describe('natação em água profunda', () => {
  it('água profunda não bloqueia mais: o personagem entra e nada', () => {
    // oeste seco, leste com 1,2 m de profundidade
    const { world } = worldWith((lx) => ({ depth: lx >= 8 ? 1.2 : 0 }), 2);
    const player = new Player();
    placeAt(player, 6, 8);
    expect(player.swimming).toBe(false);

    run(player, world, { x: 1, y: 0 }, 3);
    expect(player.x).toBeGreaterThan(8 * CELL_PX); // atravessou a margem
    expect(player.swimming).toBe(true);
    expect(player.water.depth).toBeGreaterThan(SWIM_DEPTH_M);
    expect(player.submerge).toBeGreaterThan(0);

    // e continua atravessando o lago (não fica preso na borda)
    run(player, world, { x: 1, y: 0 }, 3);
    expect(player.x).toBeGreaterThan(12 * CELL_PX);
  });

  it('nadar é mais lento que andar em terra', () => {
    const land = worldWith(() => ({}));
    const water = worldWith(() => ({ depth: 1.5 }));
    const a = new Player();
    const b = new Player();
    placeAt(a, 2, 8);
    placeAt(b, 2, 8);
    run(a, land.world, { x: 1, y: 0 }, 1.5);
    run(b, water.world, { x: 1, y: 0 }, 1.5);
    const walked = a.x - (2.5 * CELL_PX);
    const swam = b.x - (2.5 * CELL_PX);
    expect(swam).toBeGreaterThan(10);
    expect(swam).toBeLessThan(walked * 0.75); // nadar rende bem menos
    expect(a.swimming).toBe(false);
    expect(b.swimming).toBe(true);
  });

  it('vadear é intermediário: mais lento que terra, sem nadar', () => {
    const { world } = worldWith(() => ({ depth: 0.3 }));
    const player = new Player();
    placeAt(player, 2, 8);
    run(player, world, { x: 1, y: 0 }, 1.5);
    expect(player.swimming).toBe(false); // 0,30 m < limiar de nado
    expect(player.water.depth).toBeGreaterThan(WADE_DEPTH_M);
    const moved = player.x - 2.5 * CELL_PX;
    // 0,55 de fator de vadeo → bem menos que 150 px/s, mais que nadando
    expect(moved).toBeGreaterThan(60);
    expect(moved).toBeLessThan(190);
  });

  it('a correnteza empurra quem nada (a favor e contra)', () => {
    const flowing = worldWith(() => ({ depth: 1.2, vx: 0.12 }), 2);
    const still = worldWith(() => ({ depth: 1.2 }), 2);

    const drifter = new Player();
    placeAt(drifter, 8, 8);
    run(drifter, flowing.world, { x: 0, y: 0 }, 2);
    const drift = drifter.x - 8.5 * CELL_PX;
    expect(drift).toBeGreaterThan(2); // sem input, a água leva
    expect(drifter.swimming).toBe(true);

    const idle = new Player();
    placeAt(idle, 8, 8);
    run(idle, still.world, { x: 0, y: 0 }, 2);
    expect(Math.abs(idle.x - 8.5 * CELL_PX)).toBeLessThan(0.5);

    // nadar contra a correnteza rende menos que nadar em água parada
    const against = new Player();
    placeAt(against, 14, 8);
    run(against, flowing.world, { x: -1, y: 0 }, 2);
    const againstProgress = 14.5 * CELL_PX - against.x;

    const free = new Player();
    placeAt(free, 14, 8);
    run(free, still.world, { x: -1, y: 0 }, 2);
    const freeProgress = 14.5 * CELL_PX - free.x;
    expect(againstProgress).toBeLessThan(freeProgress);
    expect(againstProgress).toBeGreaterThan(0); // não é arrastado para trás parado
  });

  it('fôlego cai nadando e volta em terra; exausto ainda se move (sem soft-lock)', () => {
    // 4 chunks em linha: espaço suficiente para nadar 40 s sem bater na borda
    const { world } = worldWith(() => ({ depth: 1.4 }), 4);
    const player = new Player();
    placeAt(player, 8, 8);
    expect(player.stamina).toBe(1);
    run(player, world, { x: 1, y: 0 }, 3);
    expect(player.stamina).toBeLessThan(1);
    expect(player.swimming).toBe(true);

    // natação longa esgota o fôlego (e o personagem continua avançando devagar)
    run(player, world, { x: 1, y: 0 }, 40);
    expect(player.stamina).toBe(0);
    expect(player.swimming).toBe(true);

    // ainda é possível voltar para a margem (não fica preso no meio do lago)
    const x0 = player.x;
    run(player, world, { x: 1, y: 0 }, 3);
    expect(player.x).toBeGreaterThan(x0 + 20);

    // em terra o fôlego se recupera rápido
    const dry = worldWith(() => ({}));
    const walker = new Player();
    placeAt(walker, 8, 8);
    walker.stamina = 0;
    run(walker, dry.world, { x: 0, y: 0 }, 4);
    expect(walker.stamina).toBeGreaterThan(0.9);
  });

  it('colisões continuam valendo na água (penhasco e tronco)', () => {
    const jequitiba = speciesIndex('jequitiba');
    const { world, chunk } = worldWith((lx, ly) => {
      // coluna 10 é um paredão submerso; coluna 6 tem um tronco grande
      if (lx === 10) return { depth: 1.5, slope: 3 };
      return { depth: 1.5 };
    });
    const plant: PlantRecord = {
      id: 1,
      species: jequitiba,
      x: 6.5 * CELL_PX,
      y: 8.5 * CELL_PX,
      birthAge: 400,
      variant: 3,
      origin: 'gen',
    };
    chunk.plants.push(plant);
    chunk.rebuildPlantIndex();

    const player = new Player();
    placeAt(player, 4, 8);
    run(player, world, { x: 1, y: 0 }, 3);
    // parou antes do tronco (não atravessa a árvore)
    expect(player.x).toBeLessThan(6.5 * CELL_PX);
    expect(player.swimming).toBe(true);

    // saindo por outra linha (sem tronco), o paredão submerso ainda bloqueia
    const climber = new Player();
    placeAt(climber, 8, 3);
    run(climber, world, { x: 1, y: 0 }, 3);
    expect(climber.x).toBeLessThan(10.5 * CELL_PX);
  });

  it('estável: sem NaN, velocidade limitada e independente do FPS', () => {
    const { world } = worldWith(() => ({ depth: 3.2, vx: 0.9, vy: -0.6 }));
    const a = new Player();
    placeAt(a, 8, 8);
    run(a, world, { x: 1, y: 0.2 }, 4);

    const b = new Player();
    placeAt(b, 8, 8);
    for (let i = 0; i < Math.round(4 / (1 / 30)); i++) b.update(world, 1 / 30, { x: 1, y: 0.2 });

    for (const p of [a, b]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.vx)).toBe(true);
      expect(p.stamina).toBeGreaterThanOrEqual(0);
      expect(p.stamina).toBeLessThanOrEqual(1);
      expect(p.submerge).toBeGreaterThan(0);
      expect(p.submerge).toBeLessThanOrEqual(0.55);
      expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(p.speed * 2.4 + 1e-6);
    }
    // mesma duração, passos diferentes → resultado próximo (tolerância de integração)
    expect(Math.abs(a.x - b.x)).toBeLessThan(9);
    expect(Math.abs(a.y - b.y)).toBeLessThan(9);
  });

  it('determinístico: mesma sequência de entradas ⇒ mesmo resultado', () => {
    const build = () => {
      const { world } = worldWith(() => ({ depth: 1.1, vx: 0.05 }));
      const p = new Player();
      placeAt(p, 4, 4);
      run(p, world, { x: 1, y: 0.3 }, 2);
      run(p, world, { x: -1, y: 0 }, 1);
      return p;
    };
    const p1 = build();
    const p2 = build();
    expect(p1.x).toBe(p2.x);
    expect(p1.y).toBe(p2.y);
    expect(p1.stamina).toBe(p2.stamina);
    expect(p1.swimming).toBe(true);
  });

  it('integração: num mundo gerado dá para nadar num lago e voltar para a margem', () => {
    const world = new World({ seed: 1337, waterActiveRadiusChunks: 1 });
    world.requestChunks(0, 0, 0, 0);
    world.pumpGeneration(200);
    world.update(0);

    // procura a célula mais funda num raio de chunks carregados
    let best = -1;
    let bx = 0;
    let by = 0;
    for (const chunk of world.chunks.values()) {
      for (let ly = 0; ly < chunk.n; ly++) {
        for (let lx = 0; lx < chunk.n; lx++) {
          const d = chunk.waterDepth[chunk.cellIdx(lx, ly)];
          if (d > best) {
            best = d;
            bx = chunk.cx * chunk.n + lx;
            by = chunk.cy * chunk.n + ly;
          }
        }
      }
    }
    expect(best).toBeGreaterThan(SWIM_DEPTH_M); // existe água funda de verdade no mundo

    const player = new Player();
    player.x = (bx + 0.5) * CELL_PX;
    player.y = (by + 0.5) * CELL_PX;
    player.update(world, 1 / 60, { x: 0, y: 0 });
    expect(player.swimming).toBe(true);

    // nada em uma direção qualquer: deve sair do lugar sem travar
    const x0 = player.x;
    const y0 = player.y;
    run(player, world, { x: 1, y: 0 }, 2);
    expect(Math.hypot(player.x - x0, player.y - y0)).toBeGreaterThan(4);

    // com fôlego zerado, ainda consegue se mover (sem soft-lock no meio do lago)
    player.stamina = 0;
    const x1 = player.x;
    run(player, world, { x: 1, y: 0.4 }, 3);
    expect(Math.hypot(player.x - x1, player.y - y0)).toBeGreaterThan(3);
    expect(Number.isFinite(player.x)).toBe(true);
  });

  it('a cena desenha o nadador submerso (sprite cortado + ondulação)', () => {
    const { world } = worldWith(() => ({ depth: 1.4 }));
    const player = new Player();
    placeAt(player, 8, 8);
    run(player, world, { x: 1, y: 0 }, 1);
    const view = player.view();
    expect(view.swimming).toBe(true);

    const scene = composeScene(world, { x: player.x - 200, y: player.y - 150, w: 400, h: 300 }, {
      timeMs: 1000,
      player: view,
    });
    const playerBlits = scene.ops.filter(
      (o) => o.k === 'blit' && (o.img === 'Characters/Male/M_Farmer_Movement.png' || o.img === 'Characters/Male/M_Farmer_Idle.png'),
    );
    expect(playerBlits.length).toBe(1);
    const blit = playerBlits[0] as Extract<(typeof scene.ops)[number], { k: 'blit' }>;
    // a altura desenhada é menor que a altura do frame (corpo cortado na água)
    expect(blit.dh).toBeLessThan(blit.sh + 1);
    expect(blit.dh).toBeLessThan(29);
    // há faixas de ondulação claras (r,g,b ~ 200,230,245)
    const ripples = scene.ops.filter(
      (o) => o.k === 'fill' && o.r >= 180 && o.g >= 215 && o.b >= 235,
    );
    expect(ripples.length).toBeGreaterThanOrEqual(2);

    // em terra o sprite é desenhado inteiro
    const dry = worldWith(() => ({}));
    const walker = new Player();
    placeAt(walker, 8, 8);
    run(walker, dry.world, { x: 0, y: 0 }, 0.2);
    const dryScene = composeScene(dry.world, { x: walker.x - 200, y: walker.y - 150, w: 400, h: 300 }, {
      timeMs: 1000,
      player: walker.view(),
    });
    const dryBlit = dryScene.ops.find(
      (o) => o.k === 'blit' && (o.img === 'Characters/Male/M_Farmer_Idle.png' || o.img === 'Characters/Male/M_Farmer_Movement.png'),
    ) as Extract<(typeof dryScene.ops)[number], { k: 'blit' }>;
    expect(dryBlit.dh).toBe(dryBlit.sh);
  });
});
