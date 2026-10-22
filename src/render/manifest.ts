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
// Os recortes diagonais antigos produziam triângulos roxos em grade.
// Mantemos a geração dos flags no mundo, mas não desenhamos esses recortes
// até que o atlas de cantos seja mapeado com transparência e escala corretas.
export const CLIFF_DIAG: Rect[] = [];
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
  rock_1: F('Miscellaneous/rocks.png', [[142, 46, 18, 18]]),
  rock_2: F('Miscellaneous/rocks.png', [[160, 46, 18, 18]]),
  rock_3: F('Miscellaneous/rocks.png', [[206, 38, 18, 26]]),
  rock_4: F('Miscellaneous/rocks.png', [[224, 40, 19, 24]]),
  rock_5: F('Miscellaneous/rocks.png', [[138, 64, 22, 30]]),
  rock_6: F('Miscellaneous/rocks.png', [[201, 64, 23, 31]]),
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
  for (const s of Object.values(SPRITES)) set.add(s.file);
  return [...set];
}
