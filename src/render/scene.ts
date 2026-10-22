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
} from './manifest';
import type { Op, SceneOps } from './ops';
import { SEASONS } from '../world/climate';

export type DebugMode =
  | null | 'chunks' | 'elevation' | 'moisture' | 'flow' | 'soil' | 'veg' | 'water' | 'nutrients';

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
      let ground: Rect = GROUND_TILES.grass;
      if (snowy) ground = GROUND_TILES.snow;
      else if (soil === 0 && moist < 0.4) ground = GROUND_TILES.sand;
      else if (soil === 2 && moist < 0.3) ground = GROUND_TILES.dirt;
      ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: ground[0], sy: ground[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T });
      tileCount++;

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
        let nearLake = 0;
        const nbs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [ox, oy] of nbs) {
          const b = at(tx + ox, ty + oy);
          if (!b) continue;
          if (b.chunk.waterDepth[b.ci] > 0.12) near++;
          if (b.chunk.waterDepth[b.ci] > 0.3) nearDeep++;
          if (b.chunk.waterDepth[b.ci] > 0.3 && b.chunk.waterKind[b.ci] & 1) nearLake++;
        }
        if (near > 0) {
          const lakeShore = nearLake > 0;
          const deep = nearDeep > 0;
          // praia arenosa em lagos; margem de rio vira terra úmida (mais coerente)
          if (lakeShore && !snowy) {
            ops.push({ k: 'blit', img: GROUND_TILES_FILE, sx: GROUND_TILES.sand[0], sy: GROUND_TILES.sand[1], sw: 32, sh: 32, dx: sx, dy: sy, dw: T, dh: T, alpha: clamp(0.4 + nearLake * 0.22, 0, 0.85) });
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
      if (d <= 0.06 && dCell <= 0.06) continue;
      const sx = tx * T - cam.x;
      const sy = ty * T - cam.y;
      const kind = a ? a.chunk.waterKind[a.ci] : 0;
      const alpha = clamp((d - 0.16) / 0.4, 0, 1);
      if (alpha <= 0.02) continue;
      // duas camadas com alpha contínuo → transição rasa→profunda sem degraus duros
      const frameIdx = Math.floor(opts.timeMs / 260) % 4;
      const mid = SPRITES.water_mid.frames[frameIdx];
      ops.push({ k: 'blit', img: SPRITES.water_mid.file, sx: mid[0], sy: mid[1], sw: mid[2], sh: mid[3], dx: sx, dy: sy, dw: T, dh: T, alpha: alpha * 0.92 * (snowy ? 0.85 : 1) });
      const deepA = smoothstepLocal(0.5, 1.3, d);
      if (deepA > 0.02) {
        const deep = SPRITES.water_deep.frames[frameIdx];
        ops.push({ k: 'blit', img: SPRITES.water_deep.file, sx: deep[0], sy: deep[1], sw: deep[2], sh: deep[3], dx: sx, dy: sy, dw: T, dh: T, alpha: deepA });
      }
      // linha d'água: escurece a borda do lado da terra
      if (alpha > 0.15) {
        const nbs: Array<[number, number, number, number]> = [[1, 0, 0, 0], [-1, 0, T - 5, 0], [0, 1, 0, 0], [0, -1, 0, T - 5]];
        for (const [ox, oy, ex, ey] of nbs) {
          const b = at(tx + ox, ty + oy);
          const bd = b ? b.chunk.waterDepth[b.ci] : 0;
          if (bd <= 0.09) {
            const horiz = ox !== 0;
            ops.push({
              k: 'fill',
              x: sx + (horiz ? ex : 0),
              y: sy + (horiz ? 0 : ey),
              w: horiz ? 5 : T,
              h: horiz ? T : 5,
              r: 34, g: 56, b: 66, a: 0.28,
            });
          }
        }
      }
      tileCount++;
      if (kind & 2 && hash2(cfg.seed, tx, ty, 171) > 0.72) {
        ops.push({ k: 'fill', x: sx + 5, y: sy + 9, w: 14, h: 2, r: 226, g: 244, b: 255, a: 0.22 * alpha });
      }
    }
  }

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
        items.push({ y: p.y, emit: () => emitTree(world, chunk, p, cam, opts, season, snowy, (op) => { ops.push(op); spriteCount++; }) });
      }
    }
  }

  if (opts.player) {
    const pv = opts.player;
    items.push({
      y: pv.y,
      emit: () => {
        const def = pv.moving ? (pv.female ? SPRITES.player_f_move : SPRITES.player_move) : pv.female ? SPRITES.player_f_idle : SPRITES.player_idle;
        const frame = def.frames[pv.frame % def.frames.length];
        const dx = Math.round(pv.x - cam.x - frame[2] / 2);
        const dy = Math.round(pv.y - cam.y - frame[3] + 2);
        ops.push({ k: 'blit', img: def.file, sx: frame[0], sy: frame[1], sw: frame[2], sh: frame[3], dx, dy, dw: frame[2], dh: frame[3], flip: pv.facing === -1 });
        spriteCount++;
      },
    });
  }

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.emit();

  // ---------- clima visível ----------
  const rain = world.climate.rainIntensity(dayFloat);
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstepLocal(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
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
    case 'nutrients': {
      const t = clamp(chunk.nAvail[ci] / 1.2, 0, 1);
      return [Math.round(200 * t + 40), Math.round(200 * t + 40), Math.round(80 * t + 40)];
    }
    default:
      return [255, 255, 255];
  }
}

export const SEASON_LABEL = SEASONS;
