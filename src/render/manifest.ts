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
  small: [[32, 51, 32, 45], [96, 49, 32, 47], [160, 48, 32, 48], [224, 45, 31, 51], [288, 50, 32, 46]],
  big: [[34, 9, 60, 55], [97, 9, 61, 55], [161, 4, 61, 60], [228, 1, 58, 63], [289, 4, 61, 60]],
  bigger: [[36, 0, 88, 128], [131, 1, 90, 127], [228, 2, 83, 126], [328, 0, 76, 128], [420, 2, 83, 126]],
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

// --- fauna visual: coelho, sapo e ave (spritesheets gerados do reference) ----
/**
 * Cada espécie é uma spritesheet com uma animação por linha; grupos de frames
 * redesenhados por `tools/extract-fauna-sprites.ts`. O tamanho da célula vem do
 * arquivo `.json` ao lado do PNG (mesma pasta, mesmo nome).
 */
export interface FaunaSheet {
  file: string;
  cellW: number;
  cellH: number;
  maxFrames: number;
  rows: Record<string, number>;
  frameMs: Record<string, number>;
}

export const FAUNA_SHEETS: Record<'rabbit' | 'frog' | 'bird' | 'snake', FaunaSheet> = {
  rabbit: {
    file: 'Animals/rabbit.png',
    cellW: 21, cellH: 17, maxFrames: 6,
    rows: { idle: 0, walk: 1, run: 2, jump: 3, eat: 4, sleep: 5 },
    frameMs: { idle: 260, walk: 150, run: 100, jump: 110, eat: 190, sleep: 420 },
  },
  frog: {
    file: 'Animals/frog.png',
    cellW: 27, cellH: 15, maxFrames: 5,
    rows: { idle: 0, jump: 1, swim: 2, eat: 3, sleep: 4 },
    frameMs: { idle: 300, jump: 140, swim: 150, eat: 220, sleep: 460 },
  },
  bird: {
    file: 'Animals/bird.png',
    cellW: 19, cellH: 14, maxFrames: 5,
    rows: { idle: 0, fly: 1, land: 2, eat: 3, sleep: 4 },
    frameMs: { idle: 260, fly: 90, land: 130, eat: 200, sleep: 440 },
  },
  // predador: spritesheet extraída da prancha fornecida (7 animações, até 11 frames)
  snake: {
    file: 'Animals/snake.png',
    cellW: 41, cellH: 20, maxFrames: 11,
    rows: { idle: 0, move: 1, attack: 2, hide: 3, death: 4, hurt: 5, sleep: 6 },
    frameMs: { idle: 240, move: 120, attack: 90, hide: 260, death: 160, hurt: 120, sleep: 380 },
  },
};

/** recorte de um quadro da fauna (linha da animação × coluna do frame) */
export function faunaRect(sheet: FaunaSheet, anim: string, frame: number): Rect {
  const row = sheet.rows[anim] ?? 0;
  const count = sheet.rows[anim] !== undefined
    ? Math.max(1, Math.min(sheet.maxFrames, countFor(sheet, anim)))
    : 1;
  const col = ((frame % count) + count) % count;
  return [col * sheet.cellW, row * sheet.cellH, sheet.cellW, sheet.cellH];
}

/** nº de frames de uma animação (mantido fora do JSON para ficar tipado) */
const FAUNA_FRAMES: Record<string, Record<string, number>> = {
  rabbit: { idle: 6, walk: 6, run: 5, jump: 5, eat: 6, sleep: 5 },
  frog: { idle: 4, jump: 4, swim: 5, eat: 4, sleep: 4 },
  bird: { idle: 5, fly: 4, land: 4, eat: 4, sleep: 4 },
  snake: { idle: 11, move: 11, attack: 8, hide: 9, death: 7, hurt: 7, sleep: 8 },
};

function countFor(sheet: FaunaSheet, anim: string): number {
  const key = sheet.file.includes('rabbit')
    ? 'rabbit'
    : sheet.file.includes('frog')
      ? 'frog'
      : sheet.file.includes('snake')
        ? 'snake'
        : 'bird';
  return FAUNA_FRAMES[key]?.[anim] ?? sheet.maxFrames;
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
  set.add(FRUIT_SHEET);
  set.add(SEED_SHEET);
  set.add(INSECT_SHEET);
  for (const sheet of Object.values(FAUNA_SHEETS)) set.add(sheet.file);
  for (const s of Object.values(SPRITES)) set.add(s.file);
  return [...set];
}
