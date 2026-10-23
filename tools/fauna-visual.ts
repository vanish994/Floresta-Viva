/**
 * Teste visual da fauna: compõe uma cena com as MESMAS ops do jogo, mostrando
 * coelho, sapo e ave em estados diferentes, com escala relativa ao personagem.
 *
 * Uso: npx tsx tools/fauna-visual.ts [--out .tmp/fauna]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';
import { sanitizeShadow } from '../src/render/sanitize';
import { SoftwareRenderer, type SpriteSource } from './software';
import { allAssetFiles } from '../src/render/manifest';
import { composeScene } from '../src/render/scene';
import { World } from '../src/world/world';
import { seedFauna, type Animal } from '../src/world/fauna';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const outDir = arg('out', '.tmp/fauna');

class FileSprites implements SpriteSource {
  private cache = new Map<string, RGBAImage | null>();
  get(file: string): RGBAImage | null {
    if (this.cache.has(file)) return this.cache.get(file)!;
    try {
      const img = decodePNG(readFileSync(join(ROOT, 'assets', file)));
      sanitizeShadow(img.data);
      this.cache.set(file, img);
      return img;
    } catch {
      this.cache.set(file, null);
      return null;
    }
  }
}

function main(): void {
  mkdirSync(join(ROOT, outDir), { recursive: true });
  const sprites = new FileSprites();
  const renderer = new SoftwareRenderer(sprites);
  const world = new World({ seed: 1337 });
  world.requestChunks(0, 0, 0, 0);
  world.pumpGeneration(200);
  for (let i = 0; i < 4; i++) world.update(0);
  const chunk = world.getChunk(0, 0)!;

  // cenário controlado: sem vegetação gerada, para ler os animais
  for (const p of chunk.plants) chunk.removedPlants.add(p.id);
  chunk.plants = [];
  chunk.decor = [];
  chunk.rebuildPlantIndex();

  const cell = world.cfg.simCellTiles * world.cfg.tileSize;
  const animals = seedFauna(chunk, world.cfg, 4, 12, []);
  // posiciona um de cada espécie lado a lado, em estados diferentes
  const baseX = chunk.cx * 16 * cell + 6 * cell;
  const baseY = chunk.cy * 16 * cell + 9 * cell;
  const showcase: Animal[] = [];
  const pick = (kind: Animal['kind']) => animals.find((a) => a.kind === kind);
  const make = (kind: Animal['kind'], dx: number, state: Animal['state'], extra: Partial<Animal> = {}): Animal => {
    const src = pick(kind);
    return {
      ...(src ?? {
        id: kind.length * 7, kind, chunk, x: 0, y: 0, vx: 0, vy: 0, state: 'idle', timer: 0,
        facing: 1 as const, animPhase: 0, hunger: 0.4, energy: 0.8, tx: 0, ty: 0, quirk: 0.6, hover: 0,
      }),
      id: kind.length * 100 + Math.round(dx),
      x: baseX + dx,
      y: baseY + (extra.y ?? 0),
      state,
      animPhase: 2,
      facing: 1,
      ...extra,
    };
  };
  showcase.push(make('rabbit', 0, 'idle'));
  showcase.push(make('rabbit', 46, 'wander'));
  showcase.push(make('rabbit', 92, 'eat'));
  showcase.push(make('frog', 150, 'idle'));
  showcase.push(make('frog', 196, 'swim'));
  showcase.push(make('bird', 250, 'idle'));
  showcase.push(make('bird', 300, 'fly', { hover: 14 }));
  const faunaMap = (world as unknown as { faunaByChunk: Map<string, Animal[]> }).faunaByChunk;
  faunaMap.set('0,0', showcase);

  const cam = { x: baseX - 40, y: baseY - 90, w: 420, h: 120 };
  const scene = composeScene(world, cam, {
    timeMs: 1200,
    player: { x: baseX - 20, y: baseY + 6, moving: false, frame: 0, female: false, facing: 1 },
  });
  const img: RGBAImage = { width: cam.w, height: cam.h, data: new Uint8ClampedArray(cam.w * cam.h * 4) };
  renderer.render(img, scene.ops);

  // ampliação 4× para inspeção de escala/pixel
  const S = 4;
  const zoom: RGBAImage = { width: cam.w * S, height: cam.h * S, data: new Uint8ClampedArray(cam.w * S * cam.h * S * 4) };
  for (let y = 0; y < zoom.height; y++) {
    for (let x = 0; x < zoom.width; x++) {
      const si = (Math.floor(y / S) * cam.w + Math.floor(x / S)) * 4;
      const di = (y * zoom.width + x) * 4;
      zoom.data[di] = img.data[si];
      zoom.data[di + 1] = img.data[si + 1];
      zoom.data[di + 2] = img.data[si + 2];
      zoom.data[di + 3] = 255;
    }
  }
  writeFileSync(join(ROOT, outDir, 'fauna.png'), encodePNG(img));
  writeFileSync(join(ROOT, outDir, 'fauna_zoom.png'), encodePNG(zoom));
  console.log(`cena: ${scene.sprites} sprites, ${scene.ops.length} ops | animais ${showcase.length}`);
  console.log(`assets: ${allAssetFiles().length} (inclui fauna)`);
  console.log(`gravado: ${join(outDir, 'fauna.png')} e fauna_zoom.png`);
}

main();
