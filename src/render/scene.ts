/**
 * Composição da cena (pura, sem DOM): mundo + câmera + tempo → lista de ops.
 *
 * A composição visual segue a escala territorial → paisagem → detalhes:
 * o chão reflete bioma/umidade/relevo, as árvores vêm dos campos de densidade
 * (bosques, bordas irregulares, clareiras) e os detalhes só existem onde o
 * micro-sítio permite. Nada é sorteado por tile isolado.
 */
import type { World } from '../world/world';
import type { Chunk } from '../world/chunk';
import { SPECIES, type PlantRecord } from '../world/flora';
import { plantSize } from '../world/ecology';
import { clamp, hash2 } from '../core/rng';
import {
  SPRITES, TREE_FILES, TREE_RECTS, GROUND_TILES, GROUND_TILES_FILE, CLIFF_SOUTH, CLIFF_DIAG, type Rect,
  FRUIT_SHEET, SEED_SHEET, INSECT_SHEET, fruitRect, seedRect, insectRect,
  FAUNA_SHEETS, faunaRect, faunaFrameCount, faunaHasAnim,
} from './manifest';
import {
  agentView,
  CORPSE_HOURS,
  CORPSE_DECAY_HOURS,
  type Animal,
  type FaunaAnim,
} from '../world/fauna';
import { FRUITS, FRUIT_PIXELS, MAX_FLOWERS, phenoOf, type Insect } from '../world/ecosystem';
import type { Op, SceneOps } from './ops';
import { SEASONS } from '../world/climate';

export type DebugMode =
  | null | 'chunks' | 'elevation' | 'moisture' | 'flow' | 'current' | 'soil' | 'veg' | 'water'
  | 'sand' | 'sediment' | 'eco' | 'nutrients';

export interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayerView {
  x: number;
  y: number;
  moving: boolean;
  frame: number;
  female: boolean;
  facing: 1 | -1;
  /** nadando em água profunda (desenho com o corpo submerso) */
  swimming?: boolean;
  /** 0..1 fração do corpo submersa */
  submerge?: number;
  /** fôlego 0..1 */
  stamina?: number;
  /** fase da braçada (rad) */
  swimPhase?: number;
  /** velocidade atual em px/s (intensidade da esteira) */
  speed?: number;
}

export interface SceneOptions {
  timeMs: number;
  player?: PlayerView;
  debug?: DebugMode;
}

const CLIFF_FILE = 'Cliffs/Cliffs_Grass.png';

export function composeScene(world: World, cam: Camera, opts: SceneOptions): SceneOps {
  const cfg = world.cfg;
  const ops: Op[] = [];
  const T = cfg.tileSize;
  const tx0 = Math.floor(cam.x / T) - 1;
  const ty0 = Math.floor(cam.y / T) - 1;
  const tx1 = Math.ceil((cam.x + cam.w) / T) + 1;
  const ty1 = Math.ceil((cam.y + cam.h) / T) + 1;

  const dayFloat = world.clock.dayFloat;
  const hour = world.clock.hour;
  const season = world.climate.seasonIndex(dayFloat);
  const sky = world.climate.sky(dayFloat, hour);
  // cobertura de neve: depende da máxima do dia (neve não some ao meio-dia)
  const tempMax = world.climate.temperature(dayFloat, 15, 0.3);
  const snowy = tempMax < 7.5;
  const sunAz = ((hour - 12) / 12) * Math.PI; // leste→oeste aproximado
  const sunLx = Math.cos(sunAz), sunLy = -0.55;

  let tileCount = 0;
  let spriteCount = 0;

  const at = (tx: number, ty: number): { chunk: Chunk; ci: number } | null => {
    const n = cfg.chunkTiles / cfg.simCellTiles;
    const cx = Math.floor(tx / cfg.chunkTiles);
    const cy = Math.floor(ty / cfg.chunkTiles);
    const chunk = world.getChunk(cx, cy);
    if (!chunk) return null;
    const lx = Math.floor(tx / cfg.simCellTiles) - cx * n;
    const ly = Math.floor(ty / cfg.simCellTiles) - cy * n;
    if (lx < 0 || ly < 0 || lx >= n || ly >= n) return null;
    return { chunk, ci: chunk.cellIdx(lx, ly) };
  };

  // fundo (vazios ainda não carregados)
  ops.push({ k: 'fill', x: 0, y: 0, w: cam.w, h: cam.h, r: 24, g: 30, b: 24, a: 1 });

  // ---------- chão ----------
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const a = at(tx, ty);
      if (!a) continue;
      const { chunk, ci } = a;
      const sx = tx * T - cam.x;
      const sy = ty * T - cam.y;
      const soil = chunk.soilType[ci];
      const moist = chunk.moisture[ci];
      const depth = chunk.waterDepth[ci];
      const sand = chunk.sand[ci];
      // areia é um ESTADO FÍSICO contínuo (fração de areia da superfície): o
      // chão recebe uma camada de areia com alpha proporcional, com variação
      // por tile apenas para dar textura — sem trocar o tile inteiro, o que
      // produzia um xadrez de areia/grama.
      // legibilidade: um depósito arenoso de 2 cm já tinge a margem; areia
      // classificada (solo 0) mostra o tapete completo
      const layerP = clamp(chunk.sandLayer[ci] / (cfg.sandMinLayerMeters * 1.5), 0, 1);
      const sandP = clamp(Math.max(layerP * 0.9, (sand - 0.34) / 0.3), 0, 1);
      const sandJitter = 0.75 + 0.25 * hash2(cfg.seed, tx, ty, 137);
      let ground: Rect = GROUND_TILES.grass;
      if (snowy) ground = GROUND_TILES.snow;
      else if (soil === 0 && moist < 0.4) ground = GROUND_TILES.sand;
      else if (soil === 2 && moist < 0.3) ground = GROUND_TILES.dirt;
      ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: ground[0], sy: ground[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T });
      tileCount++;
      if (!snowy && sandP > 0.02) {
        const sandA = clamp(sandP * sandJitter, 0, 1);
        ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: GROUND_TILES.sand[0], sy: GROUND_TILES.sand[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T, alpha: sandA });
        // areia clara: o tile do pacote é o mesmo da terra, então clareamos
        ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 226, g: 199, b: 138, a: sandA * 0.42 });
        if (sandP > 0.45 && hash2(cfg.seed, Math.floor(tx / 3), Math.floor(ty / 3), 138) > 0.55) {
          ops.push({ k: 'fill', x: sx + 6, y: sy + T - 9, w: T - 12, h: 2, r: 196, g: 168, b: 108, a: sandA * 0.25 });
        }
      }

      // variação sutil por tile (evita repetição óbvia)
      const v = chunk.groundVariant[chunk.tileIdx(tx - cx0(chunk, cfg, tx), ty - cy0(chunk, cfg, ty))] ?? 0;
      if (v === 1) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 0, g: 0, b: 0, a: 0.05 });
      else if (v === 2) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 255, g: 255, b: 200, a: 0.04 });

      // trilha natural (solo batido)
      const ti = chunk.tileIdx(tx - cx0(chunk, cfg, tx), ty - cy0(chunk, cfg, ty));
      const trail = chunk.trail[ti];
      if (trail > 40 && depth < 0.1) {
        const alpha = clamp(trail / 255, 0, 1) * (snowy ? 0.35 : 0.9);
        ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: GROUND_TILES.dirt[0], sy: GROUND_TILES.dirt[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T, alpha });
      }

      // hillshade: relevo lido pela luz (encostas claras/escuras)
      const slope = chunk.slope[ci];
      if (slope > 0.25) {
        const facing = Math.cos(chunk.aspect[ci] - Math.atan2(sunLy, sunLx));
        const s = clamp(facing * slope * 0.16, -0.22, 0.22);
        if (s > 0) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 255, g: 246, b: 214, a: s });
        else ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 20, g: 26, b: 20, a: -s });
      }

      // manchas de tonalidade do chão (quebra a repetição do tile único)
      if (!snowy) {
        const bp = hash2(cfg.seed, Math.floor(tx / 4), Math.floor(ty / 4), 161);
        const bp2 = hash2(cfg.seed, Math.floor(tx / 9), Math.floor(ty / 9), 162);
        if (bp < 0.34) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 18, g: 58, b: 22, a: 0.16 });
        else if (bp2 > 0.7) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 186, g: 220, b: 122, a: 0.1 });
      } else if (hash2(cfg.seed, Math.floor(tx / 5), Math.floor(ty / 5), 163) < 0.4) {
        ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 210, g: 224, b: 240, a: 0.12 });
      }

      // borda molhada / praia junto à água (inclusive em tiles vizinhos à água)
      if (depth <= 0.3) {
        let near = depth > 0.02 ? 2 : 0;
        let nearDeep = depth > 0.25 ? 2 : 0;
        const nbs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [ox, oy] of nbs) {
          const b = at(tx + ox, ty + oy);
          if (!b) continue;
          if (b.chunk.waterDepth[b.ci] > 0.03) near++;
          if (b.chunk.waterDepth[b.ci] > 0.25) nearDeep++;
        }
        if (near > 0) {
          const deep = nearDeep > 0;
          // areia molhada é mais escura (linha d'água legível na praia)
          if (!snowy && sandP > 0.2 && (depth > 0 || moist > 0.72)) {
            ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 96, g: 82, b: 52, a: 0.14 * sandP });
          }
          // barranco erodido: o terreno REALMENTE rebaixou ali (delta persistido),
          // em coordenadas de CÉLULA (a morfologia trabalha nessa grade)
          const cellX = Math.floor(tx / cfg.simCellTiles);
          const cellY = Math.floor(ty / cfg.simCellTiles);
          const erosion = -world.getDelta(cellX, cellY);
          if (!snowy && erosion > 0.0015) {
            const scarA = clamp((erosion - 0.0015) / 0.02, 0, 0.55);
            ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: GROUND_TILES.dirt[0], sy: GROUND_TILES.dirt[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T, alpha: scarA });
          }
          if (deep) ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 62, g: 50, b: 34, a: Math.min(0.42, 0.14 + nearDeep * 0.11) });
        }
      }

      // penhascos (bordas íngremes) — tiles reais do sheet de cliffs
      const cliff = chunk.cliff[ti];
      if (cliff & 1) {
        const r = CLIFF_SOUTH[Math.floor(hash2(cfg.seed, tx, ty, 131) * CLIFF_SOUTH.length)];
        ops.push({ k: 'blit', img: CLIFF_FILE, sx: r[0], sy: r[1], sw: r[2], sh: r[3], dx: sx, dy: sy + (T - r[3]), dw: r[2], dh: r[3] });
      } else if (cliff & 2) {
        const r = CLIFF_DIAG[Math.floor(hash2(cfg.seed, tx, ty, 132) * CLIFF_DIAG.length)];
        ops.push({ k: 'blit', img: CLIFF_FILE, sx: r[0], sy: r[1], sw: r[2], sh: r[3], dx: sx, dy: sy + (T - r[3]), dw: r[2], dh: r[3] });
      } else if (cliff & 4) {
        const r = CLIFF_DIAG[Math.floor(hash2(cfg.seed, ty, tx, 133) * CLIFF_DIAG.length)];
        ops.push({ k: 'blit', img: CLIFF_FILE, sx: r[0], sy: r[1], sw: r[2], sh: r[3], dx: sx + (T - r[2]), dy: sy + (T - r[3]), dw: r[2], dh: r[3], flip: true });
      }
    }
  }

  // ---------- água (profundidade interpolada por tile → margens suaves) ----------
  const depthAtTile = (tx: number, ty: number): number => {
    // bilinear sobre a grade de células (contínua entre chunks)
    const fx = (tx + 0.5) / cfg.simCellTiles - 0.5;
    const fy = (ty + 0.5) / cfg.simCellTiles - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const dx = fx - x0, dy = fy - y0;
    const g = (cx: number, cy: number): number => {
      const a = at(cx * cfg.simCellTiles, cy * cfg.simCellTiles);
      return a ? a.chunk.waterDepth[a.ci] : 0;
    };
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, dx), lerp(c, d, dx), dy);
  };
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const a = at(tx, ty);
      const dCell = a ? a.chunk.waterDepth[a.ci] : 0;
      const d = depthAtTile(tx, ty);
      if (d <= 0.02 && dCell <= 0.02) continue;
      const sx = tx * T - cam.x;
      const sy = ty * T - cam.y;
      const kind = a ? a.chunk.waterKind[a.ci] : 0;
      // calibrado para a lâmina FÍSICA (m): 3 cm já tinge, 25 cm fica opaco
      const alpha = clamp((d - 0.025) / 0.22, 0, 1);
      if (alpha <= 0.02) continue;
      // velocidade REAL do solver (m/s): orienta a animação e os filetes
      const vx = a ? a.chunk.flowX[a.ci] : 0;
      const vy = a ? a.chunk.flowY[a.ci] : 0;
      const speed = Math.hypot(vx, vy);
      // água parada tem superfície estável; correnteza acelera os quadros
      const frameMs = 420 / (0.6 + Math.min(2.5, speed * 12));
      const frameIdx = Math.floor(opts.timeMs / frameMs) % 4;
      const mid = SPRITES.water_mid.frames[frameIdx];
      ops.push({ k: 'blit', img: SPRITES.water_mid.file, sx: mid[0], sy: mid[1], sw: mid[2], sh: mid[3], dx: sx, dy: sy, dw: T, dh: T, alpha: alpha * 0.92 * (snowy ? 0.85 : 1) });
      const deepA = smoothstepLocal(0.35, 1.1, d);
      if (deepA > 0.02) {
        const deep = SPRITES.water_deep.frames[frameIdx];
        ops.push({ k: 'blit', img: SPRITES.water_deep.file, sx: deep[0], sy: deep[1], sw: deep[2], sh: deep[3], dx: sx, dy: sy, dw: T, dh: T, alpha: deepA });
      }
      // Profundidade legível: água rasa mantém o brilho; água funda ganha
      // uma camada azul-escura e uma faixa de luz na superfície.
      if (d > 0.18) {
        const depthShade = smoothstepLocal(0.18, 1.2, d);
        ops.push({ k: 'fill', x: sx, y: sy, w: T, h: T, r: 5, g: 28, b: 58, a: depthShade * 0.34 });
        if (d > 0.6 && hash2(cfg.seed, tx, ty, 173) > 0.66) {
          ops.push({ k: 'fill', x: sx + 3, y: sy + 4, w: Math.max(4, T - 8), h: 1, r: 190, g: 226, b: 245, a: 0.14 + depthShade * 0.12 });
        }
      }
      // linha d'água: escurece a borda do lado da terra
      if (alpha > 0.15) {
        const nbs: Array<[number, number, number, number]> = [[1, 0, 0, 0], [-1, 0, T - 5, 0], [0, 1, 0, 0], [0, -1, 0, T - 5]];
        for (const [ox, oy, ex, ey] of nbs) {
          const b = at(tx + ox, ty + oy);
          const bd = b ? b.chunk.waterDepth[b.ci] : 0;
          // só na margem real (vizinhança seca) — evita grade entre células molhadas
          if (bd <= 0.02) {
            const horiz = ox !== 0;
            ops.push({
              k: 'fill',
              x: sx + (horiz ? ex : 0),
              y: sy + (horiz ? 0 : ey),
              w: horiz ? 5 : T,
              h: horiz ? T : 5,
              r: 34, g: 56, b: 66, a: 0.18,
            });
          }
        }
      }
      tileCount++;
      if (speed > 0.015 && d > 0.04) {
        // filetes na direção e com a intensidade do escoamento real.
        // A fase avança mais rápido onde a correnteza é mais forte.
        const ux = vx / speed;
        const uy = vy / speed;
        const flowNorm = clamp(speed / 0.1, 0, 1.8);
        const phaseBase = (opts.timeMs / 1400) * (0.35 + flowNorm * 1.6);
        const phase = ((phaseBase + hash2(cfg.seed, tx, ty, 172) * 4) % 1 + 1) % 1;
        const travel = (phase - 0.5) * T * 0.85;
        const streakAlpha = flowNorm * (0.14 + alpha * 0.26) * (snowy ? 0.8 : 1);
        const cx = sx + T / 2 + ux * travel;
        const cy = sy + T / 2 + uy * travel;
        for (let k = -1; k <= 1; k++) {
          // três pontos alinhados ao vetor de fluxo (traço curto e coerente)
          const px = cx + ux * k * 5 + uy * 4;
          const py = cy + uy * k * 5 - ux * 4;
          if (px < sx + 1 || py < sy + 1 || px > sx + T - 3 || py > sy + T - 3) continue;
          ops.push({ k: 'fill', x: px, y: py, w: 2, h: 2, r: 218, g: 242, b: 255, a: streakAlpha });
        }
        // espuma: só em correnteza forte com lâmina suficiente
        if (speed > 0.085 && d > 0.3) {
          const foam = clamp((speed - 0.085) * 4, 0, 0.3) * (snowy ? 0.8 : 1);
          const fx = sx + 4 + hash2(cfg.seed, tx, ty, 174) * (T - 10);
          const fy = sy + 4 + hash2(cfg.seed, ty, tx, 175) * (T - 10);
          ops.push({ k: 'fill', x: fx, y: fy, w: 3, h: 2, r: 236, g: 249, b: 255, a: foam });
        }
      }
    }
  }

  // ---------- sprites com profundidade  }

  // ---------- sprites com profundidade (ordenados por y da base) ----------
  interface Item {
    y: number;
    emit: () => void;
  }
  const items: Item[] = [];

  const pushDecor = (chunk: Chunk, d: { kind: string; x: number; y: number; variant: number; flip: boolean; layer: 0 | 1 }) => {
    const def = SPRITES[d.kind];
    if (!def) return;
    // estação: arbustos e flores mudam ou somem no inverno
    let kind = d.kind;
    if (kind.startsWith('bush')) {
      if (snowy) kind = 'bush_winter';
      else if (season === 2) kind = 'bush_autumn';
    }
    if ((kind.startsWith('flower') || kind.startsWith('sflower') || kind.startsWith('grass')) && (snowy || season === 3)) return;
    const def2 = SPRITES[kind] ?? def;
    const frame = def2.frames[d.variant % def2.frames.length];
    const animFrame = def2.frameMs ? def2.frames[(d.variant + Math.floor(opts.timeMs / def2.frameMs)) % def2.frames.length] : frame;
    const r = def2.frameMs ? animFrame : frame;
    const sx = Math.round(d.x - cam.x - r[2] / 2);
    const sy = Math.round(d.y - cam.y - r[3] + 4);
    items.push({
      y: d.y + (d.layer === 0 ? -1000 : 0),
      emit: () => {
        ops.push({ k: 'blit', img: def2.file, sx: r[0], sy: r[1], sw: r[2], sh: r[3], dx: sx, dy: sy, dw: r[2], dh: r[3], flip: d.flip });
        spriteCount++;
      },
    });
  };

  const seenChunks = new Set<Chunk>();
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const a = at(tx, ty);
      if (!a || seenChunks.has(a.chunk)) continue;
      seenChunks.add(a.chunk);
      const chunk = a.chunk;
      for (const d of chunk.decor) {
        if (chunk.removedDecor.size && chunk.removedDecor.has(d.x * 100000 + d.y)) continue;
        if (d.x < cam.x - 64 || d.x > cam.x + cam.w + 64 || d.y < cam.y - 96 || d.y > cam.y + cam.h + 96) continue;
        pushDecor(chunk, d);
      }
      for (const p of chunk.livePlants()) {
        if (p.x < cam.x - 96 || p.x > cam.x + cam.w + 96 || p.y < cam.y - 200 || p.y > cam.y + cam.h + 96) continue;
        items.push({
          y: p.y,
          emit: () => {
            const ctx = { world, chunk, plant: p, cam, opts, season, snowy };
            emitTree(world, chunk, p, cam, opts, season, snowy, (op) => { ops.push(op); spriteCount++; });
            // floração e frutos acompanham a copa (desenhados depois da árvore,
            // com âncora na mesma base — parecem parte da planta, não ícones)
            emitFlowers(ctx, (op) => { ops.push(op); spriteCount++; });
            emitFruitsOnPlant(ctx, (op) => { ops.push(op); spriteCount++; });
          },
        });
      }
      // frutos caídos no chão e sementes: entram na ordenação por y (chão)
      for (const gf of chunk.groundFruits) {
        if (gf.x < cam.x - 32 || gf.x > cam.x + cam.w + 32 || gf.y < cam.y - 32 || gf.y > cam.y + cam.h + 32) continue;
        items.push({
          y: gf.y,
          emit: () => {
            const def = FRUITS[gf.fruit] ?? FRUITS.maca;
            const px = FRUIT_PIXELS[def.size];
            const r = fruitRect(gf.fruit, true);
            const bob = Math.min(1.5, gf.dropOffset);
            ops.push({
              k: 'blit', img: FRUIT_SHEET,
              sx: r[0], sy: r[1], sw: r[2], sh: r[3],
              dx: Math.round(gf.x - cam.x - px / 2),
              dy: Math.round(gf.y - cam.y - px + bob),
              dw: px, dh: px,
            });
            // sombra de contato (indica que está no chão)
            ops.push({ k: 'fill', x: Math.round(gf.x - cam.x - px / 2), y: Math.round(gf.y - cam.y), w: px, h: 1, r: 24, g: 32, b: 20, a: 0.25 });
            spriteCount++;
            // frutos velhos ganham marcas de decomposição
            if (gf.ageHours > 24 * 4) {
              ops.push({ k: 'fill', x: Math.round(gf.x - cam.x - 1), y: Math.round(gf.y - cam.y - 2), w: 2, h: 1, r: 60, g: 45, b: 25, a: 0.5 });
            }
          },
        });
      }
      for (const seed of chunk.seedBed) {
        if (seed.x < cam.x - 16 || seed.x > cam.x + cam.w + 16 || seed.y < cam.y - 16 || seed.y > cam.y + cam.h + 16) continue;
        items.push({
          y: seed.y,
          emit: () => {
            const r = seedRect(FRUIT_SHEET_ORDER_FOR_SEEDS(seed.species));
            ops.push({
              k: 'blit', img: SEED_SHEET,
              sx: r[0], sy: r[1], sw: r[2], sh: r[3],
              dx: Math.round(seed.x - cam.x - 3),
              dy: Math.round(seed.y - cam.y - 5),
              dw: 6, dh: 6,
            });
            spriteCount++;
          },
        });
      }
    }
  }

  // ---------- insetos (pool do mundo, perto do jogador) ----------
  const insectLists: Array<{ chunk: Chunk; list: Insect[] }> = [];
  {
    const n = cfg.chunkTiles / cfg.simCellTiles;
    const cx0 = Math.floor(tx0 / cfg.chunkTiles);
    const cx1 = Math.floor(tx1 / cfg.chunkTiles);
    const cy0 = Math.floor(ty0 / cfg.chunkTiles);
    const cy1 = Math.floor(ty1 / cfg.chunkTiles);
    void n;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = world.getChunk(cx, cy);
        if (!chunk) continue;
        const list = world.insectsAt(chunk);
        if (list.length) insectLists.push({ chunk, list });
      }
    }
  }
  for (const { list } of insectLists) {
    for (const insect of list) {
      items.push({
        y: insect.y,
        emit: () => emitInsect(insect, cam, opts.timeMs, (op) => { ops.push(op); spriteCount++; }),
      });
    }
  }

  // ---------- fauna visual (coelho, sapo, ave) ----------
  for (let cy = Math.floor(ty0 / cfg.chunkTiles); cy <= Math.floor(ty1 / cfg.chunkTiles); cy++) {
    for (let cx = Math.floor(tx0 / cfg.chunkTiles); cx <= Math.floor(tx1 / cfg.chunkTiles); cx++) {
      const chunk = world.getChunk(cx, cy);
      if (!chunk) continue;
      for (const animal of world.faunaAt(chunk)) {
        if (animal.x < cam.x - 48 || animal.x > cam.x + cam.w + 48) continue;
        if (animal.y < cam.y - 64 || animal.y > cam.y + cam.h + 48) continue;
        items.push({
          y: animal.y,
          emit: () => emitAnimal(animal, cam, opts.timeMs, (op) => { ops.push(op); spriteCount++; }),
        });
      }
    }
  }

  if (opts.player) {
    const pv = opts.player;
    items.push({
      y: pv.y,
      emit: () => {
        const moving = pv.swimming ? pv.moving || (pv.speed ?? 0) > 12 : pv.moving;
        const def = moving ? (pv.female ? SPRITES.player_f_move : SPRITES.player_move) : pv.female ? SPRITES.player_f_idle : SPRITES.player_idle;
        const frame = def.frames[pv.frame % def.frames.length];
        const flip = pv.facing === -1;
        const swimming = pv.swimming === true;
        let dx = Math.round(pv.x - cam.x - frame[2] / 2);
        let dy = Math.round(pv.y - cam.y - frame[3] + 2);
        let sw = frame[2];
        let sh = frame[3];
        let dw = frame[2];
        let dh = frame[3];

        if (swimming) {
          // o corpo entra na água: o sprite afunda e a parte de baixo é cortada
          // na linha d'água (largura/altura proporcionais, sem esticar)
          const submerge = clamp(pv.submerge ?? 0.25, 0, 0.6);
          const bob = Math.sin(pv.swimPhase ?? opts.timeMs / 400) * 1.5;
          const sink = 3 + submerge * 12;
          dy = Math.round(pv.y - cam.y - frame[3] + 2 + sink + bob);
          const visible = clamp(1 - submerge, 0.45, 1);
          const cut = Math.max(6, Math.round(frame[3] * visible));
          sh = Math.max(6, Math.round(frame[3] * visible));
          dh = cut;
          sw = frame[2];
          dw = frame[2];
          // sombra/água sobre a parte submersa: escurece a base visível
          ops.push({
            k: 'fill',
            x: dx,
            y: dy + dh - 4,
            w: dw,
            h: 4,
            r: 24, g: 78, b: 104, a: 0.35,
          });
        }

        ops.push({ k: 'blit', img: def.file, sx: frame[0], sy: frame[1], sw, sh, dx, dy, dw, dh, flip });
        spriteCount++;

        if (swimming) {
          // ondulação em volta do corpo (3 faixas curtas, alinhadas ao eixo)
          const cx = Math.round(pv.x - cam.x);
          const waterY = dy + dh;
          const pulse = 0.55 + 0.45 * Math.sin((pv.swimPhase ?? 0) * 2);
          const rip = clamp(pulse, 0, 1) * 0.5;
          ops.push({ k: 'fill', x: cx - 11, y: waterY - 2, w: 22, h: 2, r: 214, g: 238, b: 250, a: 0.22 * rip });
          ops.push({ k: 'fill', x: cx - 16, y: waterY + 1, w: 32, h: 1, r: 190, g: 222, b: 242, a: 0.26 * rip });
          ops.push({ k: 'fill', x: cx - 7, y: waterY + 3, w: 14, h: 1, r: 190, g: 222, b: 242, a: 0.2 * rip });

          // braçadas: respingos curtos alternando de lado, no ritmo da fase
          const phase = pv.swimPhase ?? 0;
          const stroke = Math.abs(Math.sin(phase));
          if (stroke > 0.25) {
            const side = Math.sin(phase) > 0 ? -1 : 1;
            const reach = 7 + stroke * 4;
            ops.push({
              k: 'fill',
              x: cx + side * reach - 1,
              y: waterY - 3,
              w: 3,
              h: 2,
              r: 235, g: 248, b: 255,
              a: 0.3 * stroke,
            });
            ops.push({
              k: 'fill',
              x: cx - side * (reach * 0.55) - 1,
              y: waterY - 1,
              w: 2,
              h: 1,
              r: 235, g: 248, b: 255,
              a: 0.22 * stroke,
            });
          }

          // esteira: rastro atrás de quem está se deslocando na água
          const spd = pv.speed ?? 0;
          if (spd > 20) {
            const dir = pv.facing === -1 ? 1 : -1;
            const strength = clamp((spd - 20) / 130, 0, 1);
            for (let k = 0; k < 3; k++) {
              const off = 10 + k * 7;
              const a = strength * (0.24 - k * 0.055);
              if (a <= 0.01) continue;
              ops.push({
                k: 'fill',
                x: cx + dir * off - 4,
                y: waterY - 1 + k,
                w: 9 + k * 2,
                h: 1,
                r: 226, g: 244, b: 255,
                a,
              });
            }
          }
        }
      },
    });
  }

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.emit();

  // ---------- clima visível ----------
  const rain = world.climate.precipitationNow();
  if (rain > 0.05) {
    const n = Math.floor(rain * 70);
    for (let i = 0; i < n; i++) {
      const rx = Math.floor(hash2(991, i, Math.floor(opts.timeMs / 70), 151) * cam.w);
      const ry = Math.floor(hash2(992, i, Math.floor(opts.timeMs / 70), 152) * cam.h);
      ops.push({ k: 'fill', x: rx, y: ry, w: 1, h: 7, r: 190, g: 210, b: 235, a: 0.35 });
    }
  }

  // ---------- iluminação ----------
  const light = sky.light;
  if (light < 0.999) {
    // cor do céu: amanhecer/entardecer quentes, noite azulada
    const twilight = clamp(1 - Math.abs(sky.sinElevation) / 0.25, 0, 1);
    const r = Math.round(lerp(38, 255, twilight * 0.55));
    const g = Math.round(lerp(48, 176, twilight * 0.45));
    const b = Math.round(lerp(96, 120, twilight * 0.2));
    ops.push({ k: 'tint', r, g, b, strength: (1 - light) * 0.8 });
    if (opts.player) {
      ops.push({
        k: 'dark',
        a: (1 - light) * 0.55,
        lx: opts.player.x - cam.x,
        ly: opts.player.y - cam.y - 14,
        radius: 150 + light * 300,
      });
    } else {
      ops.push({ k: 'dark', a: (1 - light) * 0.5, lx: -9999, ly: -9999, radius: 1 });
    }
  }

  // ---------- depuração ----------
  if (opts.debug && opts.debug !== 'chunks') {
    const n = cfg.chunkTiles / cfg.simCellTiles;
    const cell = cfg.simCellTiles * T;
    for (let ty = ty0; ty <= ty1; ty += cfg.simCellTiles) {
      for (let tx = tx0; tx <= tx1; tx += cfg.simCellTiles) {
        const a = at(tx, ty);
        if (!a) continue;
        const { chunk, ci } = a;
        const [r, g, b] = heatColor(opts.debug, chunk, ci);
        ops.push({ k: 'fill', x: tx * T - cam.x, y: ty * T - cam.y, w: cell, h: cell, r, g, b, a: 0.42 });
      }
    }
    void n;
  }
  if (opts.debug === 'chunks') {
    for (let cy = Math.floor(ty0 / cfg.chunkTiles); cy <= Math.floor(ty1 / cfg.chunkTiles); cy++) {
      for (let cx = Math.floor(tx0 / cfg.chunkTiles); cx <= Math.floor(tx1 / cfg.chunkTiles); cx++) {
        const x = cx * cfg.chunkTiles * T - cam.x;
        const y = cy * cfg.chunkTiles * T - cam.y;
        ops.push({ k: 'fill', x, y, w: cfg.chunkTiles * T, h: 2, r: 255, g: 80, b: 80, a: 0.8 });
        ops.push({ k: 'fill', x, y, w: 2, h: cfg.chunkTiles * T, r: 255, g: 80, b: 80, a: 0.8 });
      }
    }
  }

  return { ops, tiles: tileCount, sprites: spriteCount };
}

function cx0(chunk: Chunk, cfg: { chunkTiles: number }, tx: number): number {
  void tx;
  return chunk.cx * cfg.chunkTiles;
}
function cy0(chunk: Chunk, cfg: { chunkTiles: number }, ty: number): number {
  void ty;
  return chunk.cy * cfg.chunkTiles;
}

/** semente desenhada para a espécie (cai no primeiro art disponível) */
function FRUIT_SHEET_ORDER_FOR_SEEDS(species: number): string {
  const sp = SPECIES[species];
  const fruit = sp?.fruit;
  if (fruit === 'maca' || fruit === 'cereja' || fruit === 'uva') return fruit;
  if (fruit) return 'framboesa';
  return 'maca';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstepLocal(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Geometria do sprite da árvore (mesma conta usada no desenho). Frutos e flores
 * são ancorados NESTE retângulo, para caírem dentro da copa e não no tronco.
 */
export interface TreeGeometry {
  size: number;
  dw: number;
  dh: number;
  /** topo da copa (px de mundo) */
  topY: number;
  /** base do tronco (px de mundo) */
  baseY: number;
  /** centro horizontal (px de mundo) */
  cx: number;
}

export function treeGeometry(world: World, chunk: Chunk, p: PlantRecord, season: number, snowy: boolean): TreeGeometry | null {
  const cfg = world.cfg;
  const sp = SPECIES[p.species];
  const size = plantSize(p, chunk, cfg, world.clock.dayFloat);
  if (size <= 0.03) return null;
  const lookKey = (['spring', 'summer', 'autumn', 'winter'] as const)[season];
  let look = sp.look[lookKey];
  if (snowy && look !== 'snow' && sp.deciduous) look = 'winter';
  if (snowy && !sp.deciduous && season === 3) look = 'snow';
  const rects = TREE_RECTS[sp.size];
  const r = rects[p.variant % rects.length];
  const scale = (0.42 + 0.58 * clamp(size, 0, 1)) * (sp.size === 'bigger' ? 1 : sp.size === 'big' ? 0.92 : 0.8);
  const dw = Math.round(r[2] * scale);
  const dh = Math.round(r[3] * scale);
  return { size, dw, dh, topY: p.y - dh + 2, baseY: p.y + 2, cx: p.x };
}

function emitTree(
  world: World,
  chunk: Chunk,
  p: PlantRecord,
  cam: Camera,
  opts: SceneOptions,
  season: number,
  snowy: boolean,
  push: (op: Op) => void,
): void {
  const cfg = world.cfg;
  const sp = SPECIES[p.species];
  const size = plantSize(p, chunk, cfg, world.clock.dayFloat);
  if (size <= 0.03) return;
  const lookKey = (['spring', 'summer', 'autumn', 'winter'] as const)[season];
  let look = sp.look[lookKey];
  if (snowy && look !== 'snow' && sp.deciduous) look = 'winter';
  if (snowy && !sp.deciduous && season === 3) look = 'snow';
  const file = TREE_FILES[sp.size][look];
  const rects = TREE_RECTS[sp.size];
  const r = rects[p.variant % rects.length];
  const scale = (0.42 + 0.58 * clamp(size, 0, 1)) * (sp.size === 'bigger' ? 1 : sp.size === 'big' ? 0.92 : 0.8);
  const dw = Math.round(r[2] * scale);
  const dh = Math.round(r[3] * scale);
  const dx = Math.round(p.x - cam.x - dw / 2);
  const dy = Math.round(p.y - cam.y - dh + 2);
  push({ k: 'blit', img: file, sx: r[0], sy: r[1], sw: r[2], sh: r[3], dx, dy, dw, dh, flip: p.variant % 2 === 0 });
}

interface PlantDrawContext {
  world: World;
  chunk: Chunk;
  plant: PlantRecord;
  cam: Camera;
  opts: SceneOptions;
  season: number;
  snowy: boolean;
}

/**
 * Flores sobre a copa: só nas plantas que estão de fato florindo (fenologia).
 * A posição usa a âncora da copa e um jitter determinístico por flor — nada de
 * todas as flores no mesmo pixel.
 */
function emitFlowers(ctx: PlantDrawContext, push: (op: Op) => void): void {
  const pheno = ctx.plant.pheno;
  if (!pheno || pheno.stage !== 'flowering' || pheno.flowers <= 0) return;
  if (pheno.dormant > 0) return;
  const sp = SPECIES[ctx.plant.species];
  const geo = treeGeometry(ctx.world, ctx.chunk, ctx.plant, ctx.season, ctx.snowy);
  if (!geo || geo.size < 0.25) return;
  const count = Math.min(pheno.flowers, MAX_FLOWERS);
  const sprite = sp.size === 'small' ? SPRITES.sflower_a : SPRITES.flower_a;
  const frame = sprite.frames[Math.floor(ctx.opts.timeMs / (sprite.frameMs ?? 400)) % sprite.frames.length];
  for (let k = 0; k < count; k++) {
    const r1 = hash2(ctx.world.cfg.seed ^ 0x71f, ctx.plant.id + k, pheno.flowers, 640);
    const r2 = hash2(ctx.world.cfg.seed ^ 0x71f, ctx.plant.id - k, pheno.flowers, 641);
    // dentro do retângulo da copa: topo + 20%..55% da altura desenhada
    const x = geo.cx + (r1 - 0.5) * geo.dw * 0.62;
    const y = geo.topY + geo.dh * (0.2 + 0.35 * r2);
    const scale = sp.size === 'small' ? 0.5 : 0.62;
    const dw = Math.max(4, Math.round(frame[2] * scale));
    const dh = Math.max(4, Math.round(frame[3] * scale));
    push({
      k: 'blit', img: sprite.file,
      sx: frame[0], sy: frame[1], sw: frame[2], sh: frame[3],
      dx: Math.round(x - ctx.cam.x - dw / 2),
      dy: Math.round(y - ctx.cam.y - dh),
      dw, dh,
    });
  }
}

/**
 * Frutos na copa: verdes enquanto amadurecem, maduros depois. O tamanho em
 * pixels vem do porte do fruto (árvore grande → fruto visível); a posição é
 * distribuída pela copa pela âncora de cada fruto.
 */
function emitFruitsOnPlant(ctx: PlantDrawContext, push: (op: Op) => void): void {
  const pheno = ctx.plant.pheno;
  if (!pheno || pheno.fruits.length === 0) return;
  const sp = SPECIES[ctx.plant.species];
  if (!sp.fruit) return;
  const def = FRUITS[sp.fruit];
  if (!def) return;
  const geo = treeGeometry(ctx.world, ctx.chunk, ctx.plant, ctx.season, ctx.snowy);
  if (!geo || geo.size < 0.2) return;
  const px = Math.max(3, Math.round(FRUIT_PIXELS[def.size] * (0.7 + 0.45 * geo.size)));
  for (const fruit of pheno.fruits) {
    const ripe = fruit.age >= 1;
    const r = fruitRect(sp.fruit, ripe);
    // pendurado NA COPA: ox/oy (-1..1) mapeiam para dentro da silhueta
    // desenhada (20%..80% da largura, 30%..65% da altura a partir do topo),
    // e o fruto é desenhado DEPOIS da árvore para aparecer sobre as folhas
    const x = geo.cx + fruit.ox * geo.dw * 0.3;
    const y = geo.topY + geo.dh * (0.3 + 0.35 * (fruit.oy * 0.5 + 0.5));
    // fruto imaturo fica menor (cresce até amadurecer)
    const grow = ripe ? 1 : 0.6 + 0.4 * fruit.age;
    const dw = Math.max(3, Math.round(px * grow));
    const dh = dw;
    push({
      k: 'blit', img: FRUIT_SHEET,
      sx: r[0], sy: r[1], sw: r[2], sh: r[3],
      dx: Math.round(x - ctx.cam.x - dw / 2),
      dy: Math.round(y - ctx.cam.y - dh),
      dw, dh,
    });
    // brilho sutil no maduro (leitura à distância sem inventar cor forte)
    if (ripe && def.size === 'big') {
      push({
        k: 'fill',
        x: Math.round(x - ctx.cam.x - dw / 2),
        y: Math.round(y - ctx.cam.y - dh),
        w: 1, h: 1, r: 255, g: 244, b: 214, a: 0.5,
      });
    }
  }
}

/** inseto: sprite de 2 frames, com sombra/altura de voo (polinizadores voam) */
function emitInsect(insect: Insect, cam: Camera, timeMs: number, push: (op: Op) => void): void {
  const flying = insect.kind === 'bee' || insect.kind === 'butterfly';
  const frame: 0 | 1 = Math.floor((timeMs / (flying ? 90 : 220) + insect.phase) % 2) as 0 | 1;
  const r = insectRect(insect.kind, frame);
  const px = flying ? 10 : 11;
  const hover = flying ? Math.sin(timeMs / 180 + insect.phase) * 1.6 : 0;
  const dx = Math.round(insect.x - cam.x - px / 2);
  const dy = Math.round(insect.y - cam.y - px - 6 + hover);
  push({
    k: 'blit', img: INSECT_SHEET,
    sx: r[0], sy: r[1], sw: r[2], sh: r[3],
    dx, dy, dw: px, dh: px,
    flip: Math.cos(insect.phase * 0.3) < 0,
  });
  if (flying) {
    // sombra no chão: dá altura de voo sem inventar física
    push({ k: 'fill', x: dx + 3, y: Math.round(insect.y - cam.y + 2), w: 5, h: 1, r: 20, g: 26, b: 16, a: 0.22 });
  }
  if (insect.pollen) {
    push({ k: 'fill', x: dx + px - 3, y: dy + 1, w: 2, h: 2, r: 244, g: 214, b: 92, a: 0.9 });
  }
}

/**
 * Desenha um animal no MESMO pipeline dos sprites (mesma câmera, mesmo y-sort,
 * mesma iluminação). Escala nativa 1:1 do pixel art — coelho 21×17, sapo 27×15,
 * ave 19×14, cobra 41×20 — sem esticar para preencher o tile de 32 px.
 *
 * A IA já produz os estados; aqui eles ficam VISÍVEIS:
 *  - fuga: poeira atrás de quem corre (coelho/sapo);
 *  - sapo nadando: ondulação curta + linha d'água sobre o corpo;
 *  - ave: sombra menor/mais clara separada do corpo (altura de voo);
 *  - sono: dois "z" pequenos piscando;
 *  - bote da cobra: brilho no focinho durante o ataque;
 *  - dor: sobressalto (pose) + faíscas de impacto;
 *  - morte: carcaça imóvel, sem sombra, mancha no chão e restos (decomposição).
 *
 * LOD: longe do centro da câmera o animal usa só o quadro estático (sem
 * efeitos), mantendo a animação detalhada apenas para quem está perto.
 */
function emitAnimal(animal: Animal, cam: Camera, timeMs: number, push: (op: Op) => void): void {
  const sheet = FAUNA_SHEETS[animal.kind];
  const view = agentView(animal, timeMs, (a) => faunaFrameCount(animal.kind, a));
  // fallback seguro: se a folha não tem a linha, desenha idle (nunca inventa frame)
  const anim: FaunaAnim = faunaHasAnim(animal.kind, view.anim) ? view.anim : 'idle';
  const cx = cam.x + cam.w / 2;
  const cy = cam.y + cam.h / 2;
  const near = Math.hypot(animal.x - cx, animal.y - cy) < 420;
  const rect = faunaRect(sheet, anim, near ? view.frame : 0);

  const dead = animal.state === 'dead';
  // 0..1 — quanto a carcaça já se decompôs (CORPSE_HOURS = tempo total no mundo)
  const decay = dead ? clamp((animal.corpseHours ?? 0) / CORPSE_HOURS, 0, 1) : 0;
  // último terço da carcaça: desaparece aos poucos (já virou solo)
  const fade = dead && decay > 0.6 ? clamp(1 - (decay - 0.6) / 0.4, 0.15, 1) : 1;

  const dw = rect[2];
  const dh = rect[3];
  const dx = Math.round(animal.x - cam.x - dw / 2);
  const dy = Math.round(animal.y - cam.y - dh - view.hover);
  const gx = Math.round(animal.x - cam.x);
  const gy = Math.round(animal.y - cam.y);

  push({
    k: 'blit',
    img: sheet.file,
    sx: rect[0], sy: rect[1], sw: rect[2], sh: rect[3],
    dx, dy, dw, dh,
    flip: view.facing === -1,
    alpha: fade,
  });

  // sombra de contato: dá peso ao bicho. Carcaça não tem sombra — tem mancha.
  // Fora do raio detalhado (LOD) o animal é desenhado "chapado", sem sombra.
  if (near && !dead) {
    const shadowW = view.hover > 0 ? 8 : Math.round(dw * 0.45);
    push({
      k: 'fill',
      x: Math.round(animal.x - cam.x - shadowW / 2),
      y: gy - 1,
      w: shadowW, h: view.hover > 0 ? 1 : 2,
      r: 24, g: 30, b: 20, a: view.hover > 0 ? 0.14 : 0.24,
    });
  } else if (near) {
    // mancha no chão (não é sombra): duas faixas, a de baixo mais estreita,
    // e a mancha cresce conforme o corpo se decompõe
    const stainW = Math.round(dw * (0.45 + 0.35 * decay));
    const stainA = Math.min(0.55, 0.2 + decay * 0.3) * fade;
    push({
      k: 'fill',
      x: gx - Math.round(stainW / 2),
      y: gy - 1,
      w: stainW, h: 1,
      r: 46, g: 36, b: 24, a: stainA,
    });
    push({
      k: 'fill',
      x: gx - Math.round(stainW * 0.3),
      y: gy,
      w: Math.round(stainW * 0.6), h: Math.max(1, Math.round(decay * 2)),
      r: 38, g: 30, b: 20, a: stainA * 0.8,
    });
  }

  if (near) {
    // --- sapo na água: ondulação (não parece que está andando sobre ela) ---
    if (anim === 'swim') {
      push({
        k: 'fill',
        x: dx, y: dy + Math.round(dh * 0.55),
        w: dw, h: Math.max(1, Math.round(dh * 0.45)),
        r: 30, g: 86, b: 120, a: 0.3,
      });
      const ripple = 0.35 + 0.25 * Math.sin(timeMs / 260 + animal.quirk * 6);
      push({ k: 'fill', x: gx - 11, y: gy - 2, w: 22, h: 1, r: 200, g: 228, b: 245, a: 0.3 * ripple });
      push({ k: 'fill', x: gx - 7, y: gy + 1, w: 14, h: 1, r: 200, g: 228, b: 245, a: 0.22 * ripple });
    }

    // --- sono: dois "z" minúsculos (leitura imediata de descanso) ----------
    // desenhados como 3 traços de 1 px: topo, diagonal, base — não é sprite novo
    if (anim === 'sleep' && !dead) {
      const tick = Math.floor(timeMs / 620) % 2;
      const zs: Array<[number, number, number]> = [[5, 4, 0.6], [9, 8, 0.4]];
      for (const [ox, oy, a] of zs) {
        const zx = gx + ox;
        const zy = gy - dh - oy - tick;
        push({ k: 'fill', x: zx, y: zy, w: 3, h: 1, r: 230, g: 238, b: 245, a });
        push({ k: 'fill', x: zx + 1, y: zy + 1, w: 1, h: 1, r: 230, g: 238, b: 245, a });
        push({ k: 'fill', x: zx, y: zy + 2, w: 3, h: 1, r: 230, g: 238, b: 245, a });
      }
    }

    // --- fuga: poeira levantada atrás de quem corre no chão -----------------
    if (!dead && (anim === 'run' || anim === 'jump') && animal.kind !== 'bird' && Math.hypot(animal.vx, animal.vy) > 20) {
      const kick = Math.abs(Math.sin(animal.animPhase * 2.2));
      if (kick > 0.45) {
        const back = view.facing === -1 ? 1 : -1;
        const a = 0.22 * kick;
        push({ k: 'fill', x: gx + back * Math.round(dw * 0.3), y: gy - 2, w: 2, h: 1, r: 196, g: 176, b: 132, a });
        push({ k: 'fill', x: gx + back * Math.round(dw * 0.55), y: gy - 4, w: 1, h: 1, r: 196, g: 176, b: 132, a: a * 0.7 });
      }
    }

    // --- dor: pose de sobressalto + faíscas de impacto ---------------------
    if (!dead && (animal.hurtTimer ?? 0) > 0) {
      const blink = Math.sin(timeMs / 70) > 0 ? 1 : 0.45;
      const ox = Math.round(hash2(animal.id, 7, 3, 1101) * 8) - 4;
      const oy = Math.round(hash2(animal.id, 8, 3, 1102) * 6) - 3;
      push({ k: 'fill', x: gx + ox, y: dy + Math.round(dh * 0.35) + oy, w: 2, h: 2, r: 244, g: 92, b: 74, a: 0.6 * blink });
      push({ k: 'fill', x: gx - ox, y: dy + Math.round(dh * 0.6) - oy, w: 1, h: 1, r: 255, g: 214, b: 170, a: 0.55 * blink });
    }

    // --- bote da cobra: brilho no focinho no instante do ataque ------------
    if (anim === 'attack' && !dead) {
      const tick = Math.sin(timeMs / 45) > 0 ? 1 : 0;
      const fx = gx + (view.facing === -1 ? -Math.round(dw * 0.32) : Math.round(dw * 0.32));
      push({ k: 'fill', x: fx, y: dy + Math.round(dh * 0.5), w: 2, h: 1, r: 250, g: 226, b: 168, a: tick ? 0.75 : 0.35 });
    }

    // --- carcaça: restos escuros e moscas (decomposição visível) -----------
    if (dead) {
      if (decay > CORPSE_DECAY_HOURS) {
        const sx = Math.round(hash2(animal.id, 11, 5, 1111) * 8) - 4;
        const sy = Math.round(hash2(animal.id, 12, 5, 1112) * 4) - 2;
        push({ k: 'fill', x: gx + sx, y: dy + Math.round(dh * 0.55) + sy, w: 2, h: 2, r: 38, g: 30, b: 20, a: 0.55 * fade });
        push({ k: 'fill', x: gx - sx, y: dy + Math.round(dh * 0.75) - sy, w: 2, h: 1, r: 38, g: 30, b: 20, a: 0.45 * fade });
      }
      if (decay > 0.6) {
        const fly = Math.floor(timeMs / 420) % 2;
        push({ k: 'fill', x: gx + 5 + fly, y: dy + 2 - fly * 2, w: 1, h: 1, r: 216, g: 206, b: 150, a: 0.5 * fade });
        push({ k: 'fill', x: gx - 6 + fly * 2, y: dy + 5, w: 1, h: 1, r: 216, g: 206, b: 150, a: 0.4 * fade });
      }
    }
  }
}

function heatColor(mode: string, chunk: Chunk, ci: number): [number, number, number] {
  switch (mode) {
    case 'elevation': {
      const t = clamp(chunk.elev[ci] / 60, 0, 1);
      return [Math.round(40 + t * 215), Math.round(80 + t * 120), Math.round(200 - t * 160)];
    }
    case 'moisture': {
      const t = chunk.moisture[ci];
      return [Math.round(200 - t * 160), Math.round(160 - t * 60), Math.round(60 + t * 195)];
    }
    case 'flow': {
      const t = clamp(Math.log10(1 + chunk.acc[ci]) / 3, 0, 1);
      return [Math.round(40 + t * 215), Math.round(60 + t * 90), Math.round(220)];
    }
    case 'current': {
      const speed = Math.hypot(chunk.flowX[ci], chunk.flowY[ci]);
      const t = clamp(speed / 2.5, 0, 1);
      return [Math.round(30 + t * 225), Math.round(90 + t * 40), Math.round(230 - t * 190)];
    }
    case 'soil': {
      const cols: [number, number, number][] = [[230, 200, 120], [170, 90, 50], [130, 130, 130], [70, 120, 60], [150, 130, 90]];
      return cols[chunk.soilType[ci]] ?? [255, 0, 255];
    }
    case 'veg': {
      const t = clamp(chunk.litter[ci] / 6, 0, 1);
      return [Math.round(60 + t * 60), Math.round(120 + t * 135), Math.round(60 + t * 40)];
    }
    case 'water': {
      const t = clamp(chunk.waterDepth[ci] / 2, 0, 1);
      return [20, Math.round(120 - t * 60), Math.round(120 + t * 135)];
    }
    case 'sand': {
      // fração de areia da superfície: azul (nada) → amarelo (praia)
      const t = clamp(chunk.sand[ci], 0, 1);
      return [Math.round(40 + t * 200), Math.round(90 + t * 130), Math.round(190 - t * 130)];
    }
    case 'eco': {
      // verde = florindo, amarelo = frutos maduros, vermelho = pragas
      const pheno = chunk.plantsInCell(ci % chunk.n, (ci / chunk.n) | 0);
      let flower = 0, ripe = 0, pests = 0;
      for (const p of pheno) {
        const ph = p.pheno;
        if (!ph) continue;
        if (ph.stage === 'flowering') flower++;
        ripe += ph.fruits.filter((f) => f.age >= 1).length;
        pests = Math.max(pests, ph.pests);
      }
      return [
        Math.round(60 + pests * 190),
        Math.round(70 + Math.min(1, flower / 3) * 170),
        Math.round(60 + Math.min(1, ripe / 4) * 120),
      ];
    }
    case 'sediment': {
      // carga suspensa relativa ao máximo configurado
      const t = clamp(chunk.sediment[ci] / 0.004, 0, 1);
      return [Math.round(60 + t * 180), Math.round(60 + t * 40), Math.round(60 - t * 20)];
    }
    case 'nutrients': {
      const t = clamp(chunk.nAvail[ci] / 1.2, 0, 1);
      return [Math.round(200 * t + 40), Math.round(200 * t + 40), Math.round(80 * t + 40)];
    }
    default:
      return [255, 255, 255];
  }
}

export const SEASON_LABEL = SEASONS;
