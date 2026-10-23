/**
 * Validação visual headless: renderiza a cena REAL (mesmas ops do jogo) com os
 * sprites reais do pacote e exporta PNGs, além de mapas dos campos do mundo
 * (relevo, fluxo, umidade, solo, água, densidade de floresta) para inspecionar
 * continuidade entre chunks e a forma da rede hidrográfica.
 *
 * Uso:
 *   npx tsx tools/preview.ts --seed 1337 --day 3 --hour 10 --out .tmp/previews
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, type RGBAImage } from './png';
import { sanitizeShadow } from '../src/render/sanitize';
import { SoftwareRenderer, type SpriteSource } from './software';
import { allAssetFiles } from '../src/render/manifest';
import { composeScene, type DebugMode } from '../src/render/scene';
import { World } from '../src/world/world';
import { Player } from '../src/game/player';
import { clamp } from '../src/core/rng';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

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

function main() {
  const seed = Number(arg('seed', '1337'));
  const day = Number(arg('day', '4'));
  const hour = Number(arg('hour', '10'));
  const outDir = arg('out', '.tmp/previews');
  const W = Number(arg('w', '768'));
  const H = Number(arg('h', '512'));
  const debug = arg('debug', '') as DebugMode | '';
  const simHours = Number(arg('sim', '0')); // horas de jogo simuladas antes de renderizar
  const rain = arg('rain', '') === '1'; // força chuva máxima durante a simulação
  const swimView = arg('swim', '') === '1'; // posiciona o personagem dentro da água
  let cellC = Number(arg('cell', '0'));
  const find = arg('find', '');
  let useFound = false;
  let foundX = 0;
  let foundY = 0;
  mkdirSync(join(ROOT, outDir), { recursive: true });

  const sprites = new FileSprites();
  // pré-carrega (valida que o manifesto referencia arquivos existentes)
  let missing = 0;
  for (const f of allAssetFiles()) if (!sprites.get(f)) { missing++; console.error('ASSET FALTANDO:', f); }
  console.log(`assets carregados: ${allAssetFiles().length - missing}/${allAssetFiles().length}`);

  const world = new World({ seed });
  world.clock.gameMinutes = day * 1440 + hour * 60;
  if (rain) world.climate.setRainOverride(true);
  const cellPx = world.cfg.simCellTiles * world.cfg.tileSize;
  const centerX = cellC * cellPx + cellPx / 2;
  const centerY = cellC * cellPx + cellPx / 2;

  // --find water|forest|open: procura um ponto interessante perto da origem
  if (find) {
    world.requestChunks(cellPx / 2, cellPx / 2, 0, 0);
    world.pumpGeneration(400);
    let best = -1, bx = 0, by = 0;
    for (const c of world.chunks.values()) {
      for (let ly = 0; ly < c.n; ly++) for (let lx = 0; lx < c.n; lx++) {
        const i = c.cellIdx(lx, ly);
        const gx = c.cx * c.n + lx, gy = c.cy * c.n + ly;
        let score = -1;
        const dry = c.waterDepth[i] < 0.1 ? 1 : 0;
        if (find === 'water') score = c.waterDepth[i] + (c.waterKind[i] & 2 ? 0.4 : 0);
        else if (find === 'forest') score = world.fields.forestDensity(gx, gy, world.climate.meanWetness()) * dry;
        else if (find === 'open') score = (1 - world.fields.forestDensity(gx, gy, world.climate.meanWetness())) * dry;
        else if (find === 'river') score = (c.waterKind[i] & 2 ? c.acc[i] / 200 : 0) * (c.waterDepth[i] < 1.2 ? 1 : 0.3);
        if (score > best) { best = score; bx = gx; by = gy; }
      }
    }
    cellC = 0;
    foundX = bx;
    foundY = by;
    useFound = true;
    console.log(`ponto '${find}' encontrado em célula (${bx},${by}) score ${best.toFixed(2)}`);
    world.chunks.clear();
  }

  const t0 = Date.now();
  world.requestChunks(useFound ? foundX * cellPx : centerX, useFound ? foundY * cellPx : centerY, 0, 0);
  const made = world.pumpGeneration(400);
  const genMs = Date.now() - t0;
  console.log(`chunks gerados: ${made.length} em ${genMs} ms (${(genMs / Math.max(1, made.length)).toFixed(1)} ms/chunk)`);
  // atualiza a simulação alguns passos para o estado ecológico existir
  for (let i = 0; i < 6; i++) world.update(0);
  if (simHours > 0) {
    // 30 s reais = 0,5 h de jogo; a física da água roda em passos fixos
    const steps = Math.round((simHours / 0.5) * 1);
    const v0 = [...world.chunks.values()].reduce((a, c) => a + c.waterVolume(world.cfg.waterCellMeters), 0);
    for (let i = 0; i < steps; i++) world.update(30000);
    const v1 = [...world.chunks.values()].reduce((a, c) => a + c.waterVolume(world.cfg.waterCellMeters), 0);
    console.log(
      `água: ${simHours} h simuladas | volume ${(v0 / 1000).toFixed(1)}k → ${(v1 / 1000).toFixed(1)}k m³ | ` +
        `chuva ${(world.waterBudget.rain / 1000).toFixed(1)}k | nascentes ${(world.waterBudget.springs / 1000).toFixed(1)}k | ` +
        `evap ${(world.waterBudget.evaporation / 1000).toFixed(1)}k | infiltração ${(world.waterBudget.infiltration / 1000).toFixed(1)}k`,
    );
  }

  const camX = useFound ? foundX * cellPx : centerX;
  const camY = useFound ? foundY * cellPx : centerY;
  const cam = { x: camX - W / 2, y: camY - H / 2, w: W, h: H };
  // personagem opcional: em `--swim 1` ele é posicionado na água encontrada,
  // com o MESMO Player do jogo (profundidade/correnteza reais definem a pose)
  let playerView: ReturnType<Player['view']> | undefined;
  if (swimView) {
    const player = new Player();
    player.x = camX;
    player.y = camY;
    player.update(world, 1 / 60, { x: 1, y: 0 });
    playerView = player.view();
    console.log(
      `personagem: nadando=${playerView.swimming} lâmina=${player.water.depth.toFixed(2)} m ` +
        `corrente=${player.water.currentSpeed.toFixed(3)} m/s fôlego=${(playerView.stamina ?? 0).toFixed(2)}`,
    );
  }
  const tc0 = Date.now();
  const scene = composeScene(world, cam, {
    timeMs: 0,
    player: playerView ?? { x: camX, y: camY + 40, moving: false, frame: 0, female: false, facing: 1 },
    debug: debug || null,
  });
  const composeMs = Date.now() - tc0;
  const target: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const tr0 = Date.now();
  new SoftwareRenderer(sprites).render(target, scene.ops);
  const renderMs = Date.now() - tr0;
  console.log(`cena: ${scene.tiles} tiles, ${scene.sprites} sprites, ${scene.ops.length} ops | compose ${composeMs} ms | render ${renderMs} ms`);

  const outName = `scene_seed${seed}_d${day}h${hour}${find ? `_${find}` : ''}${debug ? `_${debug}` : ''}.png`;
  writeFileSync(join(ROOT, outDir, outName), encodePNG(target));
  console.log('gravado:', join(outDir, outName));

  // ---- mapas de campo (continuidade + hidrologia) ----
  const CELLS = 96;
  const PX = 4;
  const panels: Array<[string, (w: World, cx: number, cy: number) => [number, number, number]]> = [
    ['elevacao', (w, x, y) => { const t = clamp(w.fields.elevation(x, y, w.deltaAt) / 60, 0, 1); return [40 + t * 215, 90 + t * 130, 200 - t * 170]; }],
    ['fluxo', (w, x, y) => { const c = w.getChunk(Math.floor(x / 16), Math.floor(y / 16)); if (!c) return [0, 0, 0]; const lx = x - Math.floor(x / 16) * 16, ly = y - Math.floor(y / 16) * 16; const acc = c.acc[c.cellIdx(lx, ly)]; const t = clamp(Math.log10(1 + acc) / 3.2, 0, 1); return [20 + t * 60, 40 + t * 80, 90 + t * 165]; }],
    ['agua', (w, x, y) => { const c = w.getChunk(Math.floor(x / 16), Math.floor(y / 16)); if (!c) return [30, 30, 30]; const lx = x - Math.floor(x / 16) * 16, ly = y - Math.floor(y / 16) * 16; const d = c.waterDepth[c.cellIdx(lx, ly)]; return d > 0.1 ? [30, 90, 220] : [40 + d * 200, 60 + d * 200, 60 + d * 160]; }],
    ['umidade', (w, x, y) => { const c = w.getChunk(Math.floor(x / 16), Math.floor(y / 16)); if (!c) return [0, 0, 0]; const lx = x - Math.floor(x / 16) * 16, ly = y - Math.floor(y / 16) * 16; const m = c.moisture[c.cellIdx(lx, ly)]; return [200 - m * 160, 160 - m * 40, 60 + m * 195]; }],
    ['solo', (w, x, y) => { const c = w.getChunk(Math.floor(x / 16), Math.floor(y / 16)); if (!c) return [0, 0, 0]; const lx = x - Math.floor(x / 16) * 16, ly = y - Math.floor(y / 16) * 16; const cols: [number, number, number][] = [[230, 200, 120], [170, 90, 50], [130, 130, 130], [70, 120, 60], [150, 130, 90]]; return cols[c.soilType[c.cellIdx(lx, ly)]]; }],
    ['floresta', (w, x, y) => { const d = w.fields.forestDensity(x, y, w.climate.meanWetness()); return [30 + d * 60, 60 + d * 190, 40 + d * 60]; }],
  ];
  const cols = 3, rows = 2;
  const mapW = CELLS * PX * cols, mapH = CELLS * PX * rows;
  const map: RGBAImage = { width: mapW, height: mapH, data: new Uint8ClampedArray(mapW * mapH * 4).fill(255) };
  panels.forEach(([name, fn], pi) => {
    const ox = (pi % cols) * CELLS * PX;
    const oy = Math.floor(pi / cols) * CELLS * PX;
    for (let y = 0; y < CELLS; y++) {
      for (let x = 0; x < CELLS; x++) {
        const [r, g, b] = fn(world, cellC - CELLS / 2 + x, cellC - CELLS / 2 + y);
        for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
          const i = ((oy + y * PX + py) * mapW + ox + x * PX + px) * 4;
          map.data[i] = r; map.data[i + 1] = g; map.data[i + 2] = b; map.data[i + 3] = 255;
        }
      }
    }
    void name;
  });
  const mapName = `map_seed${seed}.png`;
  writeFileSync(join(ROOT, outDir, mapName), encodePNG(map));
  console.log('gravado:', join(outDir, mapName), '(painéis: elevação, fluxo, água, umidade, solo, floresta)');

  // ---- estatísticas ecológicas ----
  let plants = 0, water = 0, cells = 0;
  for (const c of world.chunks.values()) {
    plants += c.plants.length;
    for (let i = 0; i < c.n * c.n; i++) { cells++; if (c.waterDepth[i] > 0.12) water++; }
  }
  console.log(`plantas: ${plants} | células com água: ${water}/${cells} (${((water / cells) * 100).toFixed(1)}%)`);
}

main();
