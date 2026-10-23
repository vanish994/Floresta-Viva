// Gera src/render/manifest.ts a partir das medições reais dos spritesheets
// (tools/data/frames.json, produzido medindo bounding boxes de alpha com ImageMagick).
// Uso: node tools/gen-manifest.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frames = JSON.parse(readFileSync(join(here, 'data/frames.json'), 'utf8'));

const good = (r) => r && r[2] >= 8 && r[3] >= 8 && r[2] <= 40 && r[3] <= 140;
const pick = (list) => list.filter(good);

const treeFrames = JSON.parse(readFileSync(join(here, 'data/tree-frames.json'), 'utf8'));
const treeRects = {
  small: treeFrames.small,
  big: treeFrames.big,
  bigger: treeFrames.bigger,
};

const cliffSouth = frames.cliff_south.filter((r) => r[2] === 32);
const cliffDiag = frames.cliff_corners
  .filter(([r, c, t]) => t && r >= 10 && t[2] >= 20 && t[2] <= 31 && t[3] >= 20)
  .map(([r, c, t]) => t);

const rect = (r) => `[${r.join(', ')}]`;
const rects = (rs) => rs.map(rect).join(', ');

const seasonFiles = (base) =>
  `{ normal: '${base}/NormalTrees.png' /* etc */, }`;

const L = [];
L.push(`// GERADO AUTOMATICAMENTE por tools/gen-manifest.mjs — não editar à mão.`);
L.push(`// Bounding boxes reais medidas nos PNGs do pacote "Harmonious 2D Pixel Art Pack".`);
L.push(`export type Rect = [x: number, y: number, w: number, h: number];`);
L.push(``);
L.push(`export interface SpriteDef {`);
L.push(`  file: string;`);
L.push(`  frames: Rect[];`);
L.push(`  /** ponto de ancoragem: 'bottom' = base do sprite (pivô no solo), 'tile' = célula inteira */`);
L.push(`  anchor: 'bottom' | 'tile';`);
L.push(`  frameMs?: number;`);
L.push(`}`);
L.push(``);
L.push(`export const TREE_RECTS = {`);
L.push(`  small: [${rects(treeRects.small)}],`);
L.push(`  big: [${rects(treeRects.big)}],`);
L.push(`  bigger: [${rects(treeRects.bigger)}],`);
L.push(`} as Record<'small' | 'big' | 'bigger', Rect[]>;`);
L.push(``);
L.push(`export const TREE_FILES = {`);
L.push(`  small: {`);
L.push(`    normal: 'Trees/Small_Trees/NormalTrees.png',`);
L.push(`    autumn: 'Trees/Small_Trees/AutumnTrees.png',`);
L.push(`    winter: 'Trees/Small_Trees/WinterTrees.png',`);
L.push(`    snow: 'Trees/Small_Trees/WinterTreeswSnow.png',`);
L.push(`    vines: 'Trees/Small_Trees/TreeswVines.png',`);
L.push(`  },`);
L.push(`  big: {`);
L.push(`    normal: 'Trees/Big_Trees/Big_NormalTrees.png',`);
L.push(`    autumn: 'Trees/Big_Trees/Big_AutumnTrees.png',`);
L.push(`    winter: 'Trees/Big_Trees/Big_WinterTrees.png',`);
L.push(`    snow: 'Trees/Big_Trees/Big_WinterTreeswSnow.png',`);
L.push(`    vines: 'Trees/Big_Trees/Big_TreeswVines.png',`);
L.push(`  },`);
L.push(`  bigger: {`);
L.push(`    normal: 'Trees/Bigger_Trees/Bigger_NormalTrees.png',`);
L.push(`    autumn: 'Trees/Bigger_Trees/Bigger_AutumnTrees.png',`);
L.push(`    winter: 'Trees/Bigger_Trees/Bigger_WinterTrees.png',`);
L.push(`    snow: 'Trees/Bigger_Trees/Bigger_WinterTreeswSnow.png',`);
L.push(`    vines: 'Trees/Bigger_Trees/Bigger_TreeswVines.png',`);
L.push(`  },`);
L.push(`};`);
L.push(``);
L.push(`export const CLIFF_SOUTH: Rect[] = [${rects(cliffSouth)}];`);
L.push(`export const CLIFF_DIAG: Rect[] = [${rects(cliffDiag)}];`);
L.push(`export const CLIFF_PLATEAU: Rect = ${rect(frames.cliff_plateau)};`);
L.push(``);
L.push(`const F = (file: string, frames: Rect[], anchor: 'bottom' | 'tile' = 'bottom', frameMs?: number): SpriteDef =>`);
L.push(`  frameMs === undefined ? { file, frames, anchor } : { file, frames, anchor, frameMs };`);
L.push(``);
L.push(`export const GROUND_TILES = {`);
L.push(`  grass: ${rect(frames.tiles.grass)},`);
L.push(`  dirt: ${rect(frames.tiles.dirt)},`);
L.push(`  sand: ${rect(frames.tiles.dirt)},`);
L.push(`  snow: ${rect(frames.tiles.snow)},`);
L.push(`  ice: ${rect(frames.tiles.ice)},`);
L.push(`} satisfies Record<string, Rect>;`);
L.push(`export const GROUND_TILES_FILE = 'Miscellaneous/tiles.png';`);
L.push(``);
L.push(`export const SPRITES: Record<string, SpriteDef> = {`);
const anim = (name, file, fr, ms) =>
  L.push(`  ${name}: F('${file}', [${rects(fr)}], 'bottom', ${ms}),`);
const stat = (name, file, fr) => L.push(`  ${name}: F('${file}', [${rects(fr)}]),`);

anim('water_deep', 'Water/WaterTilesAnimated/Ocean_Water_Anim.png', frames.ocean, 260);
anim('water_shallow', 'Water/WaterTilesAnimated/Ocean_Water_40%_Anim.png', frames.ocean40, 260);
anim('water_mid', 'Water/WaterTilesAnimated/Ocean_Water_60%_Anim.png', frames.ocean60, 260);
anim('water_river', 'Water/WaterTilesAnimated/River_Water_Anim.png', frames.river, 200);
anim('water_lake', 'Water/WaterTilesAnimated/Lake_Water_Anim.png', frames.lake, 300);
anim('bush', 'Bushes/Anim_Bush_1.png', frames.bush, 340);
anim('bush2', 'Bushes/Anim_Bush_2.png', frames.bush2, 380);
anim('bush3', 'Bushes/Anim_Bush_3.png', frames.bush3, 300);
anim('bush_autumn', 'Autumn/A_Bushes/Anim_A_Bush_1.png', frames.bushA, 340);
anim('bush_winter', 'Winter/W_Bushes/Anim_W_Bush_1.png', frames.bushW, 340);
anim('flower_a', 'Flowers/Anim_Flower_A.png', frames.flowerA, 420);
anim('flower_b', 'Flowers/Anim_Flower_B.png', frames.flowerB, 460);
anim('sflower_a', 'Flowers/Anim_S_Flower_A.png', frames.sflowerA, 500);
anim('sflower_b', 'Flowers/Anim_S_Flower_B.png', frames.sflowerB, 540);
anim('sflower_c', 'Flowers/Anim_S_Flower_C.png', frames.sflowerC, 480);
anim('grass_1', 'Grasses/Anim_Grass_1.png', frames.grass1, 300);
anim('grass_2', 'Grasses/Anim_Grass_2.png', frames.grass2, 340);
anim('grass_3', 'Grasses/Anim_Grass_3.png', frames.grass3, 380);
stat('stump_1', 'Miscellaneous/Tree_Stumps_&_Bark.png', frames.stump.slice(0, 1));
stat('stump_2', 'Miscellaneous/Tree_Stumps_&_Bark.png', frames.stump.slice(1, 2));
stat('stump_3', 'Miscellaneous/Tree_Stumps_&_Bark.png', frames.stump.slice(2, 3));
stat('stump_4', 'Miscellaneous/Tree_Stumps_&_Bark.png', frames.stump.slice(3, 4));
stat('sticks_1', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(0, 1));
stat('sticks_2', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(1, 2));
stat('sticks_3', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(2, 3));
stat('sticks_4', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(3, 4));
stat('sticks_5', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(4, 5));
stat('sticks_6', 'Miscellaneous/sticks_and_pebbles.png', frames.sticks.slice(5, 6));
stat('rock_1', 'Miscellaneous/rocks.png', frames.rocks.slice(0, 1));
stat('rock_2', 'Miscellaneous/rocks.png', frames.rocks.slice(1, 2));
stat('rock_3', 'Miscellaneous/rocks.png', frames.rocks.slice(2, 3));
stat('rock_4', 'Miscellaneous/rocks.png', frames.rocks.slice(3, 4));
stat('rock_5', 'Miscellaneous/rocks.png', frames.rocks.slice(4, 5));
stat('rock_6', 'Miscellaneous/rocks.png', frames.rocks.slice(2, 3));
stat('leaves_1', 'Miscellaneous/fallen_leaves.png', frames.leaves.slice(0, 1));
stat('leaves_2', 'Miscellaneous/fallen_leaves.png', frames.leaves.slice(1, 2));
anim('player_move', 'Characters/Male/M_Farmer_Movement.png', frames.charMove, 110);
anim('player_idle', 'Characters/Male/M_Farmer_Idle.png', frames.charIdle, 160);
anim('player_f_move', 'Characters/Female/F_Farmer_Movement.png', frames.fcharMove, 110);
anim('player_f_idle', 'Characters/Female/F_Farmer_Idle.png', frames.fcharIdle, 160);
L.push(`};`);
L.push(``);
L.push(`/** todos os arquivos de imagem referenciados pelo manifesto */`);
L.push(`export function allAssetFiles(): string[] {`);
L.push(`  const set = new Set<string>([GROUND_TILES_FILE]);`);
L.push(`  for (const f of Object.values(TREE_FILES)) for (const p of Object.values(f)) set.add(p as string);`);
L.push(`  set.add('Cliffs/Cliffs_Grass.png');`);
L.push(`  for (const s of Object.values(SPRITES)) set.add(s.file);`);
L.push(`  return [...set];`);
L.push(`}`);

writeFileSync(join(here, '..', 'src', 'render', 'manifest.ts'), L.join('\n') + '\n');
console.log('manifest.ts gerado:', treeRects.small.length, 'small,', treeRects.big.length, 'big,', treeRects.bigger.length, 'bigger,', cliffSouth.length, 'cliff south,', cliffDiag.length, 'cliff diag');
