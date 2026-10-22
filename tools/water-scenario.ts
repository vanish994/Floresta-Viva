/**
 * Cenário reproduzível de validação da física da água (headless).
 *
 * Monta a mesma condição inicial sempre:
 *   - uma encosta descendente a leste,
 *   - um canal no meio (cota mais baixa),
 *   - uma depressão a jusante no canal,
 *   - água inicial no canal e na depressão,
 *   - uma árvore intolerante a inundação e um salgueiro na margem do canal.
 *
 * Roda a física por N horas e imprime volumes, profundidades por ponto e o
 * orçamento de massa (chuva, nascentes, evaporação, infiltração, drenagem).
 *
 * Uso:
 *   npx tsx tools/water-scenario.ts
 *   npx tsx tools/water-scenario.ts --hours 12 --rain 1
 */
import { Chunk, SOIL_CLAY } from '../src/world/chunk';
import { DEFAULT_CONFIG } from '../src/core/config';
import { speciesIndex } from '../src/world/flora';
import {
  stepWaterPhysics,
  totalWaterVolume,
  type WaterBudget,
  type WaterRegion,
} from '../src/world/water';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const cfg = { ...DEFAULT_CONFIG };
const hours = Number(arg('hours', '10'));
const rainRate = Number(arg('rain', '0')); // m/h injetados por célula (chuva forte)

const N = cfg.chunkTiles / cfg.simCellTiles;
const cellPx = cfg.simCellTiles * cfg.tileSize;

const chunk = new Chunk(0, 0, cfg);
for (let ly = 0; ly < N; ly++) {
  for (let lx = 0; lx < N; lx++) {
    const i = chunk.cellIdx(lx, ly);
    const channel = ly >= 7 && ly <= 9;
    const depression = channel && lx >= 11 && lx <= 13;
    chunk.elev[i] = 20 - lx * 0.55 - (channel ? 1.2 : 0) - (depression ? 1.4 : 0);
    chunk.waterDepth[i] = channel && lx >= 2 && lx <= 10 ? 0.45 : depression ? 1.2 : 0;
    chunk.waterBase[i] = chunk.waterDepth[i];
    chunk.waterKind[i] = channel ? 2 : 0;
    chunk.soilType[i] = SOIL_CLAY;
    chunk.soilDepth[i] = 1;
    chunk.moisture[i] = 0.45;
  }
}
for (const [id, species, lx, ly] of [
  [501, speciesIndex('ipe_amarelo'), 9, 8],
  [502, speciesIndex('salgueiro'), 9, 7],
] as const) {
  chunk.plants.push({
    id,
    species,
    x: (lx + 0.5) * cellPx,
    y: (ly + 0.5) * cellPx,
    birthAge: 200,
    variant: id % 997,
    origin: 'gen',
  });
}
chunk.rebuildPlantIndex();

const region: WaterRegion = {
  cfg,
  waterChunks: () => [chunk],
  cellAt: (gx, gy) => (gx >= 0 && gy >= 0 && gx < N && gy < N ? chunk : null),
};

const points: Array<[string, number, number]> = [
  ['montante (2,8)', 2, 8],
  ['canal (8,8)', 8, 8],
  ['depressão (12,8)', 12, 8],
  ['jusante (15,8)', 15, 8],
  ['margem seca (8,4)', 8, 4],
];

function snapshot(label: string) {
  const volume = totalWaterVolume([chunk], cfg);
  const rows = points.map(([name, lx, ly]) => {
    const i = chunk.cellIdx(lx, ly);
    return {
      ponto: name,
      elev: chunk.elev[i].toFixed(2),
      lamina: chunk.waterDepth[i].toFixed(3),
      velocidade: Math.hypot(chunk.flowX[i], chunk.flowY[i]).toFixed(3),
    };
  });
  console.log(`\n== ${label} ==`);
  console.log(`volume total: ${volume.toFixed(1)} m³`);
  console.table(rows);
  return volume;
}

const v0 = snapshot('antes');
const budget: WaterBudget = {
  rain: 0,
  springs: 0,
  evaporation: 0,
  infiltration: 0,
  drainage: 0,
  boundary: 0,
};
const step = 0.02;
const steps = Math.max(1, Math.round(hours / step));
for (let s = 0; s < steps; s++) {
  if (rainRate > 0) for (let i = 0; i < N * N; i++) chunk.surfaceInput[i] += rainRate * step;
  stepWaterPhysics(region, step, {
    temperature: 26,
    daylight: 0.9,
    worldHours: s * step,
    sources: { springs: false },
    budget,
  });
}
const v1 = snapshot('depois');

const area = cfg.waterCellMeters ** 2;
console.log('\n== orçamento de massa (m³) ==');
console.table(
  Object.entries(budget).map(([k, v]) => ({ processo: k, m3: v.toFixed(1) })),
);
const expected = v0 + budget.rain + budget.springs - budget.evaporation - budget.infiltration - budget.drainage - budget.boundary;
console.log(`\nfechamento: antes ${v0.toFixed(2)} + entradas - saídas = ${expected.toFixed(2)} | depois ${v1.toFixed(2)}`);
console.log(`erro relativo de conservação: ${(Math.abs(expected - v1) / Math.max(1, v0) * 100).toFixed(4)}%`);
console.log(`árvores removidas: ${chunk.removedPlants.size} de ${chunk.plants.length} (area ${area} m²/célula)`);
