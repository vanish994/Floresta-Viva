/**
 * Ponto de entrada do jogo: loop com passo de simulação separado do passo de
 * renderização, streaming de chunks, HUD e modo de depuração.
 */
import { World } from './world/world';
import { Climate, SEASONS } from './world/climate';
import { Player } from './game/player';
import { Input } from './game/input';
import { TouchControls } from './game/touch';
import { CanvasRenderer } from './render/CanvasRenderer';
import { composeScene, type DebugMode } from './render/scene';
import { allAssetFiles } from './render/manifest';
import { saveWorld, loadWorld, clearSave, applyChunkDiffs } from './world/persistence';
import { seedFromString } from './core/rng';
import { hash2 } from './core/rng';
import { SPECIES } from './world/flora';

const DEBUG_MODES: DebugMode[] = [null, 'chunks', 'elevation', 'moisture', 'flow', 'current', 'soil', 'veg', 'water', 'sand', 'sediment', 'nutrients'];

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input();
input.attach(window);

const el = (id: string) => document.getElementById(id) as HTMLElement;

let world: World;
let player = new Player();
let debugIdx = 0;
let lastSave = 0;
let fps = 60;

const renderer = new CanvasRenderer();
const touch = new TouchControls();

const isSmallScreen = () => Math.min(window.innerWidth, window.innerHeight) < 560;

function resize() {
  const w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  canvas.width = Math.max(320, Math.floor(w));
  canvas.height = Math.max(240, Math.floor(h));
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);
resize();

function createWorld(seed: number, load: boolean) {
  world = new World(
    isSmallScreen()
      ? { seed, loadRadiusChunks: 2, lookaheadChunks: 1, maxChunkGenPerFrame: 1, waterActiveRadiusChunks: 1 }
      : { seed },
  );
  world.onChunkGenerated = (c) => applyChunkDiffs(world, c);
  player = new Player();
  if (load) {
    const res = loadWorld(world);
    if (res.applied) {
      player.x = world.playerX;
      player.y = world.playerY;
      el('hud-save').textContent = 'save carregado';
    } else {
      player.place(world);
      el('hud-save').textContent = res.reason ?? '';
    }
  } else {
    player.place(world);
  }
  world.playerX = player.x;
  world.playerY = player.y;
  (document.getElementById('seed-input') as HTMLInputElement).value = String(seed);
}

createWorld(1337, true);

function newWorldFromInput() {
  const raw = (document.getElementById('seed-input') as HTMLInputElement).value.trim();
  const seed = raw === '' ? Math.floor(Math.random() * 1e9) : /^\d+$/.test(raw) ? Number(raw) : seedFromString(raw);
  clearSave();
  createWorld(seed, false);
  el('hud-save').textContent = 'mundo novo';
}

document.getElementById('btn-new')!.addEventListener('click', newWorldFromInput);
document.getElementById('btn-save')!.addEventListener('click', () => {
  const ok = saveWorld(world);
  el('hud-save').textContent = ok ? 'salvo ✓' : 'falha ao salvar';
});
document.getElementById('btn-debug')!.addEventListener('click', () => {
  debugIdx = (debugIdx + 1) % DEBUG_MODES.length;
});
document.getElementById('btn-pause')!.addEventListener('click', () => {
  world.clock.paused = !world.clock.paused;
});
document.getElementById('btn-char')!.addEventListener('click', () => {
  player.female = !player.female;
});
const rainButton = document.getElementById('btn-rain');
if (rainButton) {
  rainButton.addEventListener('click', () => {
    const enabled = rainButton.getAttribute('aria-pressed') !== 'true';
    world.climate.setRainOverride(enabled);
    rainButton.textContent = enabled ? '☀ parar chuva' : '🌧 chuva';
    rainButton.setAttribute('aria-pressed', String(enabled));
  });
}
const hud = document.getElementById('hud')!;
const btnHud = document.getElementById('btn-hud')!;
btnHud.addEventListener('click', () => {
  hud.classList.toggle('collapsed');
  btnHud.textContent = hud.classList.contains('collapsed') ? '+' : '–';
});
if (isSmallScreen()) {
  hud.classList.add('collapsed');
  btnHud.textContent = '+';
}
window.addEventListener('beforeunload', () => saveWorld(world));

const assetBase = './';
const spriteTotal = allAssetFiles().length;
renderer.load(allAssetFiles(), assetBase).then(() => {
  el('loading').style.display = 'none';
  if (renderer.failedFiles.length > 0) showSpriteError(renderer.failedFiles.length);
  requestAnimationFrame(loop);
});

function showSpriteError(n: number) {
  const box = document.createElement('div');
  box.id = 'sprite-error';
  box.innerHTML = `<p>não consegui baixar ${n} sprite(s).<br/>toque para recarregar.</p>`;
  box.addEventListener('pointerdown', () => location.reload());
  document.body.appendChild(box);
}

window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

let last = performance.now();

function loop(now: number) {
  const dtMs = Math.min(60, now - last);
  last = now;
  const dt = dtMs / 1000;
  fps = fps * 0.92 + (1000 / Math.max(1, dtMs)) * 0.08;

  if (input.consume('KeyQ')) debugIdx = (debugIdx + 1) % DEBUG_MODES.length;
  if (input.consume('KeyP')) world.clock.paused = !world.clock.paused;
  if (input.consume('KeyF') || touch.consumeCut()) cutTree();
  if (input.consume('KeyG') || touch.consumePlant()) plantSeedling();

  const kb = input.axis();
  const tAxis = touch.state.axis;
  const axis = tAxis.x !== 0 || tAxis.y !== 0 ? tAxis : kb;
  player.update(world, dt, axis);
  world.requestChunks(player.x, player.y, player.vx, player.vy);
  world.pumpGeneration();
  world.update(dtMs);

  const camX = Math.round(player.x - canvas.width / 2);
  const camY = Math.round(player.y - canvas.height / 2);
  const scene = composeScene(world, { x: camX, y: camY, w: canvas.width, h: canvas.height }, {
    timeMs: now,
    player: player.view(),
    debug: DEBUG_MODES[debugIdx],
  });
  renderer.render(ctx, scene.ops, canvas.width, canvas.height);

  if (now - lastSave > 20000) {
    lastSave = now;
    if (saveWorld(world)) el('hud-save').textContent = 'auto-save ✓';
  }

  updateHud(scene.ops.length);
  requestAnimationFrame(loop);
}

function cutTree() {
  const cfg = world.cfg;
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const chunk = world.cellAt(Math.floor(player.x / cellPx), Math.floor(player.y / cellPx));
  if (!chunk) return;
  let bestId = -1, bestD = 52 * 52;
  for (const p of chunk.livePlants()) {
    const d = (p.x - player.x) ** 2 + (p.y - 8 - player.y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestId = p.id;
    }
  }
  if (bestId >= 0) {
    chunk.removedPlants.add(bestId);
    chunk.dirty = true;
    chunk.rebuildPlantIndex();
    const lx = Math.floor(player.x / cellPx) - chunk.cx * chunk.n;
    const ly = Math.floor(player.y / cellPx) - chunk.cy * chunk.n;
    const i = chunk.cellIdx(lx, ly);
    chunk.litter[i] = Math.min(12, chunk.litter[i] + 1.5);
    chunk.soilDirty = true;
    el('hud-save').textContent = 'árvore removida';
  }
}

function plantSeedling() {
  const cfg = world.cfg;
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const chunk = world.cellAt(Math.floor(player.x / cellPx), Math.floor(player.y / cellPx));
  if (!chunk) return;
  const lx = Math.floor(player.x / cellPx) - chunk.cx * chunk.n;
  const ly = Math.floor(player.y / cellPx) - chunk.cy * chunk.n;
  const i = chunk.cellIdx(lx, ly);
  if (chunk.waterDepth[i] > 0.2) return;
  let best = 0, bestScore = -1;
  for (let s = 0; s < SPECIES.length; s++) {
    const score = hash2(cfg.seed, s, chunk.cx * 31 + chunk.cy, 300) + SPECIES[s].soilAffinity[chunk.soilType[i] > 2 ? 1 : chunk.soilType[i]];
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  const id = Math.floor(hash2(cfg.seed, player.x | 0, player.y | 0, 301) * 0x7fffffff);
  chunk.recruitedPlants.push({
    id,
    species: best,
    x: player.x + 10,
    y: player.y + 6,
    birthAge: -world.clock.dayFloat,
    variant: Math.floor(hash2(cfg.seed, id % 997, 7, 302) * 997),
    origin: 'recruit',
  });
  chunk.dirty = true;
  chunk.rebuildPlantIndex();
  el('hud-save').textContent = 'muda plantada';
}

function updateHud(ops: number) {
  const c = world.clock;
  const day = c.day;
  const season = world.climate.seasonIndex(c.dayFloat);
  const temp = world.climate.temperature(c.dayFloat, c.hour, 0.3);
  const rain = world.climate.rainIntensity(c.dayFloat);
  el('hud-time').textContent = `${c.label} · dia ${day + 1}`;
  el('hud-season').textContent = `${SEASONS[season]} · ${world.climate.dayOfSeason(c.dayFloat).toFixed(0)}º dia`;
  el('hud-temp').textContent = `${temp.toFixed(1)} °C · ${rain > 0.4 ? 'chuva' : rain > 0.1 ? 'garoa' : 'céu limpo'}`;
  el('hud-seed').textContent = `seed ${world.cfg.seed}`;
  const spr = renderer.failedFiles.length > 0 ? ` · sprites ${renderer.loadedCount}/${spriteTotal} ⚠${renderer.failedFiles.length}` : ` · sprites ${renderer.loadedCount}/${spriteTotal}`;
  const water = world.stats.waterVolume >= 1000 ? `${(world.stats.waterVolume / 1000).toFixed(1)}k m³` : `${world.stats.waterVolume.toFixed(0)} m³`;
  const sediment = world.stats.sandCells;
  el('hud-perf').textContent = `${fps.toFixed(0)} fps · ${world.chunks.size} chunks · ${world.stats.plants} plantas · água ${water} · areia ${sediment} cél. · ${ops} ops · gen ${world.stats.genMs.toFixed(1)} ms · sim ${world.stats.simMs.toFixed(1)} ms${spr}`;
  el('hud-debug').textContent = DEBUG_MODES[debugIdx] ? `debug: ${DEBUG_MODES[debugIdx]}` : 'debug: off (Q alterna)';
  void Climate;
}
