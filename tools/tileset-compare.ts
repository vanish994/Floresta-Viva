/**
 * Comparação A/B do tileset: renderiza a MESMA cena com o tileset antigo
 * (Harmonious) e com o do pack, usando `composeScene` + `SoftwareRenderer`
 * (as mesmas ops do jogo). Serve para decidir/ver o efeito sem abrir o jogo.
 *
 * Uso: npx tsx tools/tileset-compare.ts [--seed 1337] [--out docs/imagens]
 * Saída: docs/imagens/tileset_antes_depois.png (esquerda antigo, direita pack)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';
import { sanitizeShadow } from '../src/render/sanitize';
import { SoftwareRenderer, type SpriteSource } from './software';
import { World } from '../src/world/world';
import { composeScene } from '../src/render/scene';
import * as manifest from '../src/render/manifest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seed = Number(arg('seed', '1337'));
const outDir = arg('out', 'docs/imagens');

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

const W = 480;
const H = 320;

function renderScene(tileset: manifest.TilesetId): RGBAImage {
  // o manifesto expõe o tileset ativo; o comparador troca via `select`
  manifest.setActiveTileset(tileset);
  const world = new World({ seed });
  world.requestChunks(0, 0, 0, 0);
  world.pumpGeneration(400);
  for (let i = 0; i < 6; i++) world.update(0);
  const cam = { x: world.playerX - W / 2, y: world.playerY - H / 2, w: W, h: H };
  const scene = composeScene(world, cam, { timeMs: 0 });
  const img: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  new SoftwareRenderer(new FileSprites()).render(img, scene.ops);
  console.log(`  ${tileset}: ${scene.tiles} tiles, ${scene.sprites} sprites, ${scene.ops.length} ops`);
  return img;
}

function main(): void {
  console.log(`comparando tilesets (seed ${seed}, câmera ${W}×${H})`);
  const before = renderScene('harmonious');
  const after = renderScene('pack');
  manifest.setActiveTileset('pack'); // padrão do jogo

  const gap = 10;
  const out: RGBAImage = { width: W * 2 + gap * 3, height: H + gap * 2, data: new Uint8ClampedArray((W * 2 + gap * 3) * (H + gap * 2) * 4) };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 18; out.data[i + 1] = 20; out.data[i + 2] = 18; out.data[i + 3] = 255;
  }
  const put = (src: RGBAImage, dx: number) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        const di = ((gap + y) * out.width + dx + x) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
  };
  put(before, gap);
  put(after, gap * 2 + W);
  mkdirSync(join(ROOT, outDir), { recursive: true });
  writeFileSync(join(ROOT, outDir, 'tileset_antes_depois.png'), encodePNG(out));
  console.log(`gravado: ${join(outDir, 'tileset_antes_depois.png')} (esquerda: Harmonious | direita: pack)`);
}

main();
