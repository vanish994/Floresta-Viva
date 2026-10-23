/**
 * Teste visual headless do ecossistema: compõe cenas com as MESMAS ops do jogo
 * para conferir floração, frutos (verde/maduro), frutos no chão, sementes,
 * insetos e escala dos frutos em relação às árvores/arbustos.
 *
 * Uso: npx tsx tools/eco-visual.ts [--out .tmp/eco]
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
import { speciesIndex } from '../src/world/flora';
import { phenoOf, seedInsects } from '../src/world/ecosystem';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const outDir = arg('out', '.tmp/eco');

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
  world.clock.gameMinutes = 4 * 1440 + 12 * 60;
  world.requestChunks(0, 0, 0, 0);
  world.pumpGeneration(200);
  for (let i = 0; i < 4; i++) world.update(0);

  const chunk = world.getChunk(0, 0)!;
  // cenário controlado: remove as plantas geradas e também a decoração do
  // chunk (pedras, grama, tocos) para a leitura ficar limpa
  for (const p of chunk.plants) chunk.removedPlants.add(p.id);
  chunk.plants = [];
  chunk.decor = [];
  chunk.rebuildPlantIndex();
  const mac = speciesIndex('macaneira');
  const embauba = speciesIndex('embauba');
  const cellPx = world.cfg.simCellTiles * world.cfg.tileSize;

  // três plantas com estados distintos, perto do centro da câmera
  const spots = [
    { species: mac, lx: 5, ly: 9, stage: 'flowering' as const },
    { species: mac, lx: 9, ly: 9, stage: 'ripe' as const },
    { species: embauba, lx: 12, ly: 9, stage: 'green' as const },
  ];
  const made: Array<{ id: number; x: number; y: number }> = [];
  for (const spot of spots) {
    const p = {
      id: 90000 + spot.lx * 10 + spot.ly,
      species: spot.species,
      x: (chunk.cx * chunk.n + spot.lx + 0.5) * cellPx,
      y: (chunk.cy * chunk.n + spot.ly + 0.5) * cellPx,
      birthAge: 120,
      variant: spot.lx,
      origin: 'gen' as const,
    };
    chunk.recruitedPlants.push(p);
    const ph = phenoOf(p);
    ph.stage = spot.stage;
    ph.timer = 2;
    ph.dormant = 0;
    if (spot.stage === 'flowering') ph.flowers = 6;
    if (spot.stage === 'green') ph.fruits = [
      { age: 0.35, pollinated: true, ripeHours: 0, ox: -0.5, oy: -0.2, holdBias: 1 },
      { age: 0.6, pollinated: true, ripeHours: 0, ox: 0.4, oy: 0.1, holdBias: 1 },
      { age: 0.8, pollinated: true, ripeHours: 0, ox: 0, oy: -0.5, holdBias: 1 },
    ];
    if (spot.stage === 'ripe') ph.fruits = [
      { age: 1, pollinated: true, ripeHours: 6, ox: -0.55, oy: -0.25, holdBias: 1 },
      { age: 1, pollinated: true, ripeHours: 9, ox: 0.45, oy: -0.1, holdBias: 1 },
      { age: 1, pollinated: true, ripeHours: 3, ox: 0.1, oy: 0.35, holdBias: 1 },
      { age: 1, pollinated: true, ripeHours: 12, ox: -0.2, oy: 0.5, holdBias: 1 },
    ];
    made.push({ id: p.id, x: p.x, y: p.y });
  }
  chunk.rebuildPlantIndex();

  // frutos no chão e sementes ao lado da macieira de frutos maduros
  const anchor = made[1];
  for (let k = 0; k < 4; k++) {
    chunk.groundFruits.push({
      id: k,
      fruit: 'maca',
      species: mac,
      x: anchor.x - 18 + k * 12,
      y: anchor.y + 8 + (k % 2) * 6,
      ageHours: 6 + k * 3,
      seedKey: k,
      dropOffset: 0,
      slot: { age: 1, pollinated: true, ripeHours: 0, ox: 0, oy: 0, holdBias: 1 },
    });
  }
  chunk.seedBed.push({ x: anchor.x + 30, y: anchor.y + 10, species: mac, ageHours: 4, seedKey: 1 });

  // insetos: abelhas na florada, joaninha e lagarta na planta com frutos
  const insects = seedInsects(chunk, world.cfg, 12, 4);
  const bees = insects.filter((i) => i.kind === 'bee').slice(0, 3);
  for (const bee of bees) {
    bee.x = made[0].x + (Math.random() - 0.5) * 30;
    bee.y = made[0].y - 20 - Math.random() * 12;
    bee.state = 'seek-flower';
    bee.pollen = Math.random() > 0.5;
    bee.targetId = made[0].id;
  }
  const lady = insects.find((i) => i.kind === 'ladybug');
  if (lady) {
    lady.x = made[1].x + 10;
    lady.y = made[1].y + 2;
  }
  const worm = insects.find((i) => i.kind === 'caterpillar');
  if (worm) {
    worm.x = made[2].x - 12;
    worm.y = made[2].y + 4;
  }
  (world as unknown as { insectsByChunk: Map<string, typeof insects> }).insectsByChunk.set('0,0', insects);

  // câmera fechada nas três plantas do cenário (as da copa densa somem atrás das vizinhas)
  // câmera cobrindo as três plantas do cenário (flor, frutos, verde)
  // tripé de inspeção: flor (esq), frutos maduros (meio), frutos verdes (dir)
  const cam = {
    x: made[0].x - 45,
    y: made[0].y - 110,
    w: made[2].x - made[0].x + 110,
    h: 150,
  };
  const scene = composeScene(world, cam, { timeMs: 1200, debug: null });
  const img: RGBAImage = { width: cam.w, height: cam.h, data: new Uint8ClampedArray(cam.w * cam.h * 4) };
  renderer.render(img, scene.ops);
  const file = join(ROOT, outDir, 'ecossistema.png');
  writeFileSync(file, encodePNG(img));

  // ampliação 3× (inspeção de detalhe: fruto, flor, inseto)
  const S = 3;
  const zoom: RGBAImage = { width: img.width * S, height: img.height * S, data: new Uint8ClampedArray(img.width * S * img.height * S * 4) };
  for (let y = 0; y < zoom.height; y++) {
    for (let x = 0; x < zoom.width; x++) {
      const si = (Math.floor(y / S) * img.width + Math.floor(x / S)) * 4;
      const di = (y * zoom.width + x) * 4;
      zoom.data[di] = img.data[si];
      zoom.data[di + 1] = img.data[si + 1];
      zoom.data[di + 2] = img.data[si + 2];
      zoom.data[di + 3] = 255;
    }
  }
  writeFileSync(join(ROOT, outDir, 'ecossistema_zoom.png'), encodePNG(zoom));
  console.log(
    `cena: ${scene.sprites} sprites, ${scene.ops.length} ops | insetos ${insects.length} | ` +
      `flores ${made.length ? 'sim' : 'não'} | frutos no chão ${chunk.groundFruits.length}`,
  );
  console.log(`gravado: ${file}`);
  console.log(`assets carregados: ${allAssetFiles().length}`);
}

main();
