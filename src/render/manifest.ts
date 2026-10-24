// GERADO AUTOMATICAMENTE por tools/gen-manifest.mjs — não editar à mão.
// Bounding boxes reais medidas nos PNGs do pacote "Harmonious 2D Pixel Art Pack".
export type Rect = [x: number, y: number, w: number, h: number];

export interface SpriteDef {
  file: string;
  frames: Rect[];
  /** ponto de ancoragem: 'bottom' = base do sprite (pivô no solo), 'tile' = célula inteira */
  anchor: 'bottom' | 'tile';
  frameMs?: number;
}

export const TREE_RECTS = {
  small: [[32, 51, 32, 45], [96, 49, 32, 47], [160, 48, 32, 48], [224, 45, 32, 51], [288, 50, 32, 46]],
  // recortes medidos por componente de alpha (copa + tronco), união das 5
  // variantes sazonais: as árvores médias têm 87–96 px de altura
  big: [[34, 8, 61, 88], [97, 8, 61, 88], [161, 3, 61, 93], [228, 0, 60, 96], [289, 3, 61, 93]],
  bigger: [[36, 0, 88, 128], [131, 1, 90, 127], [228, 2, 83, 126], [328, 0, 79, 128], [420, 2, 83, 126]],
} as Record<'small' | 'big' | 'bigger', Rect[]>;

export const TREE_FILES = {
  small: {
    normal: 'Trees/Small_Trees/NormalTrees.png',
    autumn: 'Trees/Small_Trees/AutumnTrees.png',
    winter: 'Trees/Small_Trees/WinterTrees.png',
    snow: 'Trees/Small_Trees/WinterTreeswSnow.png',
    vines: 'Trees/Small_Trees/TreeswVines.png',
  },
  big: {
    normal: 'Trees/Big_Trees/Big_NormalTrees.png',
    autumn: 'Trees/Big_Trees/Big_AutumnTrees.png',
    winter: 'Trees/Big_Trees/Big_WinterTrees.png',
    snow: 'Trees/Big_Trees/Big_WinterTreeswSnow.png',
    vines: 'Trees/Big_Trees/Big_TreeswVines.png',
  },
  bigger: {
    normal: 'Trees/Bigger_Trees/Bigger_NormalTrees.png',
    autumn: 'Trees/Bigger_Trees/Bigger_AutumnTrees.png',
    winter: 'Trees/Bigger_Trees/Bigger_WinterTrees.png',
    snow: 'Trees/Bigger_Trees/Bigger_WinterTreeswSnow.png',
    vines: 'Trees/Bigger_Trees/Bigger_TreeswVines.png',
  },
};

export const CLIFF_SOUTH: Rect[] = [[128, 417, 32, 31], [224, 417, 32, 31], [256, 417, 32, 31], [288, 417, 32, 31], [320, 417, 32, 31], [352, 417, 32, 31], [384, 417, 32, 31], [416, 417, 32, 31], [448, 417, 32, 31], [480, 417, 32, 31], [512, 417, 32, 31], [544, 417, 32, 31], [576, 417, 32, 31], [608, 417, 32, 31], [640, 417, 32, 31], [672, 417, 32, 31], [768, 417, 32, 31]];
export const CLIFF_DIAG: Rect[] = [[101, 320, 27, 28], [800, 320, 27, 26], [133, 352, 27, 27], [768, 352, 27, 27], [168, 384, 24, 27], [197, 416, 27, 27]];
export const CLIFF_PLATEAU: Rect = [480, 193, 32, 31];

const F = (file: string, frames: Rect[], anchor: 'bottom' | 'tile' = 'bottom', frameMs?: number): SpriteDef =>
  frameMs === undefined ? { file, frames, anchor } : { file, frames, anchor, frameMs };

export const GROUND_TILES = {
  grass: [96, 32, 32, 32],
  dirt: [160, 32, 32, 32],
  sand: [160, 32, 32, 32],
  snow: [32, 32, 32, 32],
  ice: [32, 96, 32, 32],
} satisfies Record<string, Rect>;
export const GROUND_TILES_FILE = 'Miscellaneous/tiles.png';

// --- tileset alternativo: pack gratuito, recolorido para o idioma do jogo ----
// Gerado por `tools/extract-pack-tiles.ts` (área 32px + harmonize). O jogo
// escolhe entre os dois no manifesto; nada da física/IA muda.
export type TilesetId = 'harmonious' | 'pixellab';

/** variantes por tipo: o `groundVariant` do tile (0..3) escolhe pelo hash */
export const PACK_GROUND: Record<'grass' | 'dirt' | 'sand' | 'snow', Rect[]> = {
  grass: [[0, 0, 32, 32], [32, 0, 32, 32], [64, 0, 32, 32], [96, 0, 32, 32]],
  dirt: [[128, 0, 32, 32], [160, 0, 32, 32]],
  sand: [[192, 0, 32, 32], [224, 0, 32, 32]],
  // ordem gerada por `tools/extract-pack-tiles.ts` (coluna = índice na folha)
  snow: [[256, 0, 32, 32]],
};
export const PACK_GROUND_FILE = 'Ground/pack_tiles.png';
export const PACK_WATER_FILE = 'Water/pack_water.png';
export const PACK_WATER_DEEP_FILE = 'Water/pack_water_deep.png';
/** 4 quadros de superfície (o render usa a velocidade real para o ritmo) */
export const PACK_WATER_FRAMES = 4;

// Tilesets Wang importados do pack PixelLab. A seleção usa os tiles de preenchimento
// (todos os cantos na mesma camada) até o render calcular as transições Wang.
export const PIXELLAB_GROUND_FILES = {
  grass: 'Tilesets/pixellab/03_chao_grama.png',
  dirt: 'Tilesets/pixellab/02_margem_chao_floresta.png',
  sand: 'Tilesets/pixellab/02_margem_chao_floresta.png',
} as const;
export const PIXELLAB_GROUND_RECTS: Record<'grass' | 'dirt' | 'sand', Rect> = {
  grass: [0, 96, 32, 32],
  dirt: [0, 96, 32, 32],
  sand: [64, 32, 32, 32],
};

/**
 * Tileset ativo — UM ponto de decisão no render (nada de flag espalhada).
 * `setActiveTileset` existe para o comparador A/B (`tools/tileset-compare.ts`)
 * e para o teste de consistência; o jogo usa o padrão abaixo.
 */
let activeTileset: TilesetId = 'harmonious';
export const DEFAULT_TILESET: TilesetId = 'harmonious';
export function setActiveTileset(id: TilesetId): void {
  activeTileset = id;
}
export function activeTilesetId(): TilesetId {
  return activeTileset;
}

/** recorte de chão do tileset ativo: variante pela hash do tile */
export function groundRect(kind: 'grass' | 'dirt' | 'sand' | 'snow', variant: number): { file: string; rect: Rect } {
  if (activeTileset === 'pixellab' && kind !== 'snow') {
    return { file: PIXELLAB_GROUND_FILES[kind], rect: PIXELLAB_GROUND_RECTS[kind] };
  }
  return { file: GROUND_TILES_FILE, rect: GROUND_TILES[kind] };
}

// --- ecossistema: frutos, sementes e insetos ---------------------------------
/** folha de frutos: 8 colunas × 16 px; cada fruto ocupa 2 células (maduro, verde) */
export const FRUIT_SHEET = 'Fruits/fruits.png';
export const FRUIT_SHEET_COLS = 8;
/** ordem dos frutos na folha — mesma de `FRUIT_ORDER` em world/ecosystem.ts */
export const FRUIT_SHEET_ORDER = [
  'maca', 'pera', 'cereja', 'ameixa', 'uva', 'acai', 'amora', 'framboesa',
  'mirtilo', 'gooseberry', 'cassis', 'physalis', 'morango',
] as const;
/**
 * Recorte de um fruto na folha. O gerador desenha primeiro a versão MADURA e
 * depois a verde (célula par = maduro, ímpar = verde).
 */
export function fruitRect(id: string, ripe: boolean): Rect {
  const idx = FRUIT_SHEET_ORDER.indexOf(id as (typeof FRUIT_SHEET_ORDER)[number]);
  const cell = (idx < 0 ? 0 : idx) * 2 + (ripe ? 0 : 1);
  const col = cell % FRUIT_SHEET_COLS;
  const row = Math.floor(cell / FRUIT_SHEET_COLS);
  return [col * 16, row * 16, 16, 16];
}

export const SEED_SHEET = 'Fruits/seeds.png';
/** ordem das sementes na folha (8×8 cada) */
export const SEED_ORDER = ['maca', 'cereja', 'uva', 'framboesa'] as const;
export function seedRect(id: string): Rect {
  const idx = SEED_ORDER.indexOf(id as (typeof SEED_ORDER)[number]);
  return [(idx < 0 ? 0 : idx) * 8, 0, 8, 8];
}

export const INSECT_SHEET = 'Insects/insects.png';
/** ordem dos insetos na folha (2 frames de 12×12 cada) */
export const INSECT_ORDER = ['bee', 'butterfly', 'ladybug', 'caterpillar'] as const;
export function insectRect(kind: string, frame: 0 | 1): Rect {
  const idx = INSECT_ORDER.indexOf(kind as (typeof INSECT_ORDER)[number]);
  const col = (idx < 0 ? 0 : idx) * 2 + frame;
  return [col * 12, 0, 12, 12];
}

// --- fauna visual: coelho, sapo, ave e cobra ---------------------------------
/**
 * Direção no plano (top-down). N = costas, S = frente, L = direita, O = esquerda.
 * As folhas direcionais têm uma linha por `anim:dir`; o coelho tem as 4 direções
 * desenhadas, o sapo e a cobra também (a prancha fornece as 4 colunas).
 */
export type Facing4 = 'n' | 's' | 'e' | 'w';

export interface FaunaSheet {
  file: string;
  cellW: number;
  cellH: number;
  maxFrames: number;
  /** linha da animação: `idle` (folha de direção única) ou `idle:s` */
  rows: Record<string, number>;
  frameMs: Record<string, number>;
  /** direções disponíveis (ausente = folha de direção única, usa flip) */
  dirs?: Facing4[];
  /**
   * Tradução de animação LÓGICA → linha da folha. Serve para estados que não
   * têm arte própria na prancha nova (ex.: sapo nadando usa a linha `walk`,
   * com a ondulação desenhada no render) — nunca inventa quadro.
   */
  alias?: Record<string, string>;
}

export const FAUNA_SHEETS: Record<'rabbit' | 'frog' | 'bird' | 'snake', FaunaSheet> = {
  // 4 direções desenhadas: N (costas), S (frente), L e O
  rabbit: {
    file: 'Animals/rabbit.png',
    cellW: 24, cellH: 21, maxFrames: 4,
    dirs: ['n', 's', 'e', 'w'],
    rows: {
      'idle:n': 0, 'idle:s': 1, 'idle:e': 2, 'idle:w': 3,
      'walk:n': 4, 'walk:s': 5, 'walk:e': 6, 'walk:w': 7,
      'run:n': 8, 'run:s': 9, 'run:e': 10, 'run:w': 11,
      'jump:n': 12, 'jump:s': 13, 'jump:e': 14, 'jump:w': 15,
      'eat:n': 16, 'eat:s': 17, 'eat:e': 18, 'eat:w': 19,
      'sleep:n': 20, 'sleep:s': 21, 'sleep:e': 22, 'sleep:w': 23,
      'hurt:n': 24, 'hurt:s': 25, 'hurt:e': 26, 'hurt:w': 27,
      'death:n': 28, 'death:s': 29, 'death:e': 30, 'death:w': 31,
    },
    frameMs: { idle: 260, walk: 150, run: 100, jump: 110, eat: 190, sleep: 420, hurt: 120, death: 220 },
  },
  frog: {
    file: 'Animals/frog.png',
    cellW: 24, cellH: 19, maxFrames: 4,
    dirs: ['n', 's', 'e', 'w'],
    rows: {
      'idle:n': 0, 'idle:s': 1, 'idle:e': 2, 'idle:w': 3,
      'walk:n': 4, 'walk:s': 5, 'walk:e': 6, 'walk:w': 7,
      'run:n': 8, 'run:s': 9, 'run:e': 10, 'run:w': 11,
      'jump:n': 12, 'jump:s': 13, 'jump:e': 14, 'jump:w': 15,
      'eat:n': 16, 'eat:s': 17, 'eat:e': 18, 'eat:w': 19,
      'sleep:n': 20, 'sleep:s': 21, 'sleep:e': 22, 'sleep:w': 23,
      'hurt:n': 24, 'hurt:s': 25, 'hurt:e': 26, 'hurt:w': 27,
      'death:n': 28, 'death:s': 29, 'death:e': 30, 'death:w': 31,
    },
    frameMs: { idle: 300, walk: 170, run: 120, jump: 140, eat: 220, sleep: 460, hurt: 120, death: 220 },
    // a prancha nova não tem quadro de natação: nada com a passada da linha walk
    // + ondulação/linha d'água desenhadas no render (o comportamento não muda)
    alias: { swim: 'walk', fly: 'jump', land: 'idle', move: 'walk', attack: 'eat', hide: 'sleep' },
  },
  // ave: folha antiga (uma direção, sem dor/morte) — segue com flip horizontal
  // e as animações que existem; o alias cobre os estados que ela não tem
  bird: {
    file: 'Animals/bird.png',
    cellW: 19, cellH: 14, maxFrames: 5,
    rows: { idle: 0, fly: 1, land: 2, eat: 3, sleep: 4 },
    frameMs: { idle: 260, fly: 90, land: 130, eat: 200, sleep: 440 },
    alias: {
      death: 'sleep', hurt: 'fly', rest: 'sleep', move: 'idle', walk: 'idle',
      run: 'fly', jump: 'fly', attack: 'eat', hide: 'sleep', swim: 'idle',
    },
  },
  // predador: 10 animações × 4 direções (idle/walk/run/jump/strike/coil/hiss/sleep/hurt/death)
  snake: {
    file: 'Animals/snake.png',
    cellW: 30, cellH: 21, maxFrames: 4,
    dirs: ['n', 's', 'e', 'w'],
    rows: {
      'idle:n': 0, 'idle:s': 1, 'idle:e': 2, 'idle:w': 3,
      'walk:n': 4, 'walk:s': 5, 'walk:e': 6, 'walk:w': 7,
      'run:n': 8, 'run:s': 9, 'run:e': 10, 'run:w': 11,
      'jump:n': 12, 'jump:s': 13, 'jump:e': 14, 'jump:w': 15,
      'strike:n': 16, 'strike:s': 17, 'strike:e': 18, 'strike:w': 19,
      'coil:n': 20, 'coil:s': 21, 'coil:e': 22, 'coil:w': 23,
      'hiss:n': 24, 'hiss:s': 25, 'hiss:e': 26, 'hiss:w': 27,
      'sleep:n': 28, 'sleep:s': 29, 'sleep:e': 30, 'sleep:w': 31,
      'hurt:n': 32, 'hurt:s': 33, 'hurt:e': 34, 'hurt:w': 35,
      'death:n': 36, 'death:s': 37, 'death:e': 38, 'death:w': 39,
    },
    frameMs: {
      idle: 240, walk: 150, run: 120, jump: 130, strike: 90,
      coil: 300, hiss: 120, sleep: 380, hurt: 120, death: 200,
    },
    // recuo/observação usam as poses existentes (nada de quadro inventado)
    alias: { move: 'walk', hide: 'coil', attack: 'strike', rest: 'coil' },
  },
};

/** animações de cada folha (a contagem vale para qualquer direção) */
export const FAUNA_FRAMES: Record<keyof typeof FAUNA_SHEETS, Record<string, number>> = {
  rabbit: { idle: 4, walk: 4, run: 4, jump: 4, eat: 4, sleep: 4, hurt: 4, death: 4 },
  frog: { idle: 4, walk: 4, run: 4, jump: 4, eat: 4, sleep: 4, hurt: 4, death: 4 },
  bird: { idle: 5, fly: 4, land: 4, eat: 4, sleep: 4 },
  snake: {
    idle: 4, walk: 4, run: 4, jump: 4, strike: 4,
    coil: 4, hiss: 4, sleep: 4, hurt: 4, death: 4,
  },
};

/** espécie dona de uma folha (o manifesto nunca duplica essa informação) */
export function faunaKindOf(sheet: FaunaSheet): keyof typeof FAUNA_SHEETS {
  for (const [kind, s] of Object.entries(FAUNA_SHEETS)) if (s === sheet) return kind as keyof typeof FAUNA_SHEETS;
  if (sheet.file.includes('rabbit')) return 'rabbit';
  if (sheet.file.includes('frog')) return 'frog';
  if (sheet.file.includes('snake')) return 'snake';
  return 'bird';
}

/**
 * Linha efetiva de uma animação LÓGICA na direção pedida.
 * Devolve também `flip` quando a arte daquela direção não existe e a linha da
 * direita (L) é espelhada — nunca inventa uma direção.
 */
export function faunaRow(
  sheet: FaunaSheet,
  anim: string,
  dir: Facing4 = 's',
): { row: number; flip: boolean; key: string } | null {
  const base = sheet.alias?.[anim] ?? anim;
  const order: Facing4[] = dir === 'w' ? ['w', 'e'] : [dir];
  for (const d of order) {
    const key = `${base}:${d}`;
    const row = sheet.rows[key];
    if (row !== undefined) return { row, flip: false, key };
  }
  // folha de direção única (ave): espelha para O
  const single = sheet.rows[base];
  if (single !== undefined) return { row: single, flip: dir === 'w', key: base };
  // direção ausente na folha: cai na frente (S) e, por último, na idle
  const south = sheet.rows[`${base}:s`];
  if (south !== undefined) return { row: south, flip: false, key: `${base}:s` };
  const idle = sheet.rows[`idle:${dir}`] ?? sheet.rows.idle ?? sheet.rows['idle:s'];
  if (idle !== undefined) return { row: idle, flip: dir === 'w', key: 'idle' };
  return null;
}

/** a folha tem a animação (direta ou por alias)? */
export function faunaHasAnim(kind: keyof typeof FAUNA_SHEETS, anim: string): boolean {
  const sheet = FAUNA_SHEETS[kind];
  if (!sheet) return false;
  const base = sheet.alias?.[anim] ?? anim;
  if (sheet.rows[base] !== undefined) return true;
  return (sheet.dirs ?? []).some((d) => sheet.rows[`${base}:${d}`] !== undefined);
}

/** nº de frames válido de uma animação (1 se a linha não existir) */
export function faunaFrameCount(kind: keyof typeof FAUNA_SHEETS, anim: string): number {
  const sheet = FAUNA_SHEETS[kind];
  const base = sheet?.alias?.[anim] ?? anim;
  if (!sheet || !faunaHasAnim(kind, anim)) return 1;
  return Math.max(1, Math.min(sheet.maxFrames, FAUNA_FRAMES[kind]?.[base] ?? sheet.maxFrames));
}

/**
 * Recorte de um quadro da fauna: linha da animação × coluna do frame.
 * `dir` escolhe a linha da direção (coelho/sapo/cobra); folhas de direção
 * única ignoram a direção e o chamador usa `faunaRow(...).flip`.
 */
export function faunaRect(sheet: FaunaSheet, anim: string, frame: number, dir: Facing4 = 's'): Rect {
  const resolved = faunaRow(sheet, anim, dir);
  const row = resolved?.row ?? 0;
  const count = faunaFrameCount(faunaKindOf(sheet), anim);
  const col = ((frame % count) + count) % count;
  return [col * sheet.cellW, row * sheet.cellH, sheet.cellW, sheet.cellH];
}

/** deve espelhar o quadro? (só quando a folha não tem a direção desenhada) */
export function faunaFlip(sheet: FaunaSheet, anim: string, dir: Facing4 = 's'): boolean {
  return faunaRow(sheet, anim, dir)?.flip ?? dir === 'w';
}

export const SPRITES: Record<string, SpriteDef> = {
  water_deep: F('Water/WaterTilesAnimated/Ocean_Water_Anim.png', [[32, 32, 32, 32], [96, 32, 32, 32], [160, 32, 32, 32], [224, 32, 32, 32]], 'bottom', 260),
  water_shallow: F('Water/WaterTilesAnimated/Ocean_Water_40%_Anim.png', [[32, 32, 32, 32], [96, 32, 32, 32], [160, 32, 32, 32], [224, 32, 32, 32]], 'bottom', 260),
  water_mid: F('Water/WaterTilesAnimated/Ocean_Water_60%_Anim.png', [[32, 32, 32, 32], [96, 32, 32, 32], [160, 32, 32, 32], [224, 32, 32, 32]], 'bottom', 260),
  water_river: F('Water/WaterTilesAnimated/River_Water_Anim.png', [[35, 34, 29, 30], [98, 32, 29, 32], [163, 34, 29, 30], [226, 32, 29, 32]], 'bottom', 200),
  water_lake: F('Water/WaterTilesAnimated/Lake_Water_Anim.png', [[35, 34, 29, 30], [98, 32, 29, 32], [163, 34, 29, 30], [226, 32, 29, 32]], 'bottom', 300),
  bush: F('Bushes/Anim_Bush_1.png', [[40, 42, 18, 19], [72, 42, 18, 19]], 'bottom', 340),
  bush2: F('Bushes/Anim_Bush_2.png', [[37, 47, 22, 14], [69, 47, 22, 14]], 'bottom', 380),
  bush3: F('Bushes/Anim_Bush_3.png', [[33, 43, 30, 18], [65, 42, 30, 19]], 'bottom', 300),
  bush_autumn: F('Autumn/A_Bushes/Anim_A_Bush_1.png', [[40, 42, 18, 19], [72, 42, 18, 19]], 'bottom', 340),
  bush_winter: F('Winter/W_Bushes/Anim_W_Bush_1.png', [[40, 42, 18, 19], [72, 42, 18, 19]], 'bottom', 340),
  flower_a: F('Flowers/Anim_Flower_A.png', [[43, 46, 11, 15], [75, 46, 10, 15]], 'bottom', 420),
  flower_b: F('Flowers/Anim_Flower_B.png', [[43, 46, 11, 15], [75, 46, 10, 15]], 'bottom', 460),
  sflower_a: F('Flowers/Anim_S_Flower_A.png', [[43, 49, 10, 7], [75, 49, 11, 7], [107, 49, 11, 7]], 'bottom', 500),
  sflower_b: F('Flowers/Anim_S_Flower_B.png', [[42, 47, 11, 11], [75, 47, 9, 11], [107, 47, 10, 11]], 'bottom', 540),
  sflower_c: F('Flowers/Anim_S_Flower_C.png', [[43, 47, 9, 11], [75, 47, 10, 11], [107, 47, 10, 11]], 'bottom', 480),
  grass_1: F('Grasses/Anim_Grass_1.png', [[42, 40, 14, 21], [73, 40, 13, 21], [104, 40, 14, 21]], 'bottom', 300),
  grass_2: F('Grasses/Anim_Grass_2.png', [[36, 32, 22, 31], [66, 32, 23, 31], [97, 32, 23, 31]], 'bottom', 340),
  grass_3: F('Grasses/Anim_Grass_3.png', [[36, 32, 22, 29], [66, 32, 25, 29], [98, 32, 23, 29]], 'bottom', 380),
  stump_1: F('Miscellaneous/Tree_Stumps_&_Bark.png', [[35, 50, 28, 13]]),
  stump_2: F('Miscellaneous/Tree_Stumps_&_Bark.png', [[72, 48, 14, 13]]),
  stump_3: F('Miscellaneous/Tree_Stumps_&_Bark.png', [[109, 50, 14, 11]]),
  stump_4: F('Miscellaneous/Tree_Stumps_&_Bark.png', [[137, 49, 14, 13]]),
  sticks_1: F('Miscellaneous/sticks_and_pebbles.png', [[40, 44, 18, 12]]),
  sticks_2: F('Miscellaneous/sticks_and_pebbles.png', [[72, 44, 18, 11]]),
  sticks_3: F('Miscellaneous/sticks_and_pebbles.png', [[100, 44, 23, 14]]),
  sticks_4: F('Miscellaneous/sticks_and_pebbles.png', [[136, 41, 24, 21]]),
  sticks_5: F('Miscellaneous/sticks_and_pebbles.png', [[166, 47, 19, 11]]),
  sticks_6: F('Miscellaneous/sticks_and_pebbles.png', [[198, 45, 19, 17]]),
  rock_1: F('Miscellaneous/rocks.png', [[33, 81, 16, 12]]),
  rock_2: F('Miscellaneous/rocks.png', [[66, 72, 27, 18]]),
  rock_3: F('Miscellaneous/rocks.png', [[98, 70, 23, 19]]),
  rock_4: F('Miscellaneous/rocks.png', [[138, 46, 45, 48]]),
  rock_5: F('Miscellaneous/rocks.png', [[201, 38, 49, 57]]),
  rock_6: F('Miscellaneous/rocks.png', [[98, 70, 23, 19]]),
  leaves_1: F('Miscellaneous/fallen_leaves.png', [[70, 43, 18, 15]]),
  leaves_2: F('Miscellaneous/fallen_leaves.png', [[102, 43, 18, 15]]),
  player_move: F('Characters/Male/M_Farmer_Movement.png', [[7, 34, 18, 29], [39, 36, 18, 27], [71, 34, 18, 28], [103, 33, 18, 27], [135, 34, 18, 29], [167, 36, 18, 27], [199, 34, 18, 28], [231, 33, 18, 27]], 'bottom', 110),
  player_idle: F('Characters/Male/M_Farmer_Idle.png', [[7, 34, 18, 28], [39, 34, 18, 28], [71, 33, 18, 29], [103, 33, 18, 29], [135, 34, 18, 28], [167, 34, 18, 28]], 'bottom', 160),
  player_f_move: F('Characters/Female/F_Farmer_Movement.png', [[4, 34, 23, 29], [36, 36, 23, 27], [68, 34, 23, 28], [99, 32, 24, 28], [132, 34, 23, 29], [164, 36, 23, 27], [196, 34, 23, 28], [227, 32, 24, 28]], 'bottom', 110),
  player_f_idle: F('Characters/Female/F_Farmer_Idle.png', [[4, 34, 23, 28], [36, 34, 23, 28], [68, 33, 23, 29], [99, 32, 24, 30], [133, 34, 21, 28], [165, 34, 22, 28]], 'bottom', 160),
};

/** todos os arquivos de imagem referenciados pelo manifesto */
export function allAssetFiles(): string[] {
  const set = new Set<string>([GROUND_TILES_FILE]);
  for (const f of Object.values(TREE_FILES)) for (const p of Object.values(f)) set.add(p as string);
  set.add('Cliffs/Cliffs_Grass.png');
  set.add(PACK_GROUND_FILE);
  set.add(PACK_WATER_FILE);
  set.add(PACK_WATER_DEEP_FILE);
  set.add(PIXELLAB_GROUND_FILES.grass);
  set.add(PIXELLAB_GROUND_FILES.dirt);
  set.add(PIXELLAB_GROUND_FILES.sand);
  set.add('Tilesets/pixellab/05_grama_riacho.png');
  set.add(FRUIT_SHEET);
  set.add(SEED_SHEET);
  set.add(INSECT_SHEET);
  for (const sheet of Object.values(FAUNA_SHEETS)) set.add(sheet.file);
  for (const s of Object.values(SPRITES)) set.add(s.file);
  return [...set];
}
