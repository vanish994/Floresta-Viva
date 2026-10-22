/**
 * Cenário reproduzível de erosão/sedimentação (headless).
 *
 * Monta sempre a mesma condição inicial:
 *   - encosta descendente a leste,
 *   - canal com correnteza forte (trecho erodido),
 *   - remanso a jusante (trecho onde a correnteza perde força → deposição),
 *   - margem aluvial molhada (formação de faixa de areia),
 *   - rocha exposta na cabeceira (não deve virar areia),
 *   - duas árvores na margem (salgueiro tolerante + ipê vulnerável).
 *
 * Imprime, antes e depois:
 *   - elevação do canal e do remanso (m),
 *   - fração de areia / espessura do depósito na margem,
 *   - células areia, carga suspensa, erosão/deposição acumuladas,
 *   - orçamento de massa fechado (erodido − depositado = carga em trânsito).
 *
 * Uso:
 *   npx tsx tools/erosion-scenario.ts
 *   npx tsx tools/erosion-scenario.ts --hours 168 --rain 0.6
 */
import { Chunk, SOIL_ALLUVIAL, SOIL_CLAY, SOIL_ROCK } from '../src/world/chunk';
import { DEFAULT_CONFIG } from '../src/core/config';
import { speciesIndex } from '../src/world/flora';
import {
  stepErosion,
  stepBanks,
  createSedimentBudget,
  sandBaseOf,
  type SedimentRegion,
} from '../src/world/sediment';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const cfg = { ...DEFAULT_CONFIG };
const hours = Number(arg('hours', '72'));
const rain = Number(arg('rain', '0.3'));
const N = cfg.chunkTiles / cfg.simCellTiles;
const cellPx = cfg.simCellTiles * cfg.tileSize;

const chunk = new Chunk(0, 0, cfg);
const channel = (ly: number) => ly >= 6 && ly <= 9;
const pool = (lx: number) => lx >= 10;

for (let ly = 0; ly < N; ly++) {
  for (let lx = 0; lx < N; lx++) {
    const i = chunk.cellIdx(lx, ly);
    const chan = channel(ly);
    const isPool = chan && pool(lx);
    chunk.elev[i] = 18 - lx * 0.45 - (chan ? 0.8 : 0) - (isPool ? 0.6 : 0);
    chunk.slope[i] = chan ? (isPool ? 0.12 : 0.7) : 0.5;
    const soil = ly < 3 ? SOIL_ROCK : chan || ly < 12 ? SOIL_ALLUVIAL : SOIL_CLAY;
    chunk.soilType[i] = soil;
    chunk.soilBase[i] = soil;
    chunk.sandBase[i] = sandBaseOf(soil);
    chunk.sand[i] = chunk.sandBase[i];
    chunk.soilDepth[i] = 1;
    chunk.moisture[i] = 0.5;
    chunk.humus[i] = 1.5;
    chunk.litter[i] = 1.2;
    chunk.waterDepth[i] = chan ? (isPool ? 0.4 : 0.45) : 0;
    chunk.flowX[i] = chan ? (isPool ? 0.01 : 0.14) : 0;
    chunk.waterKind[i] = chan ? 2 : 0;
  }
}
for (const [id, species, lx, ly] of [
  [501, speciesIndex('salgueiro'), 4, 6],
  [502, speciesIndex('ipe_amarelo'), 4, 5],
] as const) {
  chunk.plants.push({
    id,
    species,
    x: (lx + 0.5) * cellPx,
    y: (ly + 0.5) * cellPx,
    birthAge: 400,
    variant: id % 997,
    origin: 'gen',
  });
}
chunk.rebuildPlantIndex();

const deltas = new Map<string, number>();
const region: SedimentRegion = {
  cfg,
  sedimentChunks: () => [chunk],
  cellAt: (gx, gy) => (gx >= 0 && gy >= 0 && gx < N && gy < N ? chunk : null),
  addDelta: (gx, gy, d) => {
    const k = `${gx},${gy}`;
    const prev = deltas.get(k) ?? 0;
    const v = Math.max(-0.25, Math.min(0.25, prev + d));
    if (Math.abs(v) < 1e-9) deltas.delete(k);
    else deltas.set(k, v);
    return (deltas.get(k) ?? 0) - prev;
  },
  getDelta: (gx, gy) => deltas.get(`${gx},${gy}`) ?? 0,
};

function snapshot(label: string) {
  let eroded = 0;
  let deposited = 0;
  for (const v of deltas.values()) {
    if (v < 0) eroded += -v;
    else deposited += v;
  }
  let load = 0;
  for (let i = 0; i < N * N; i++) load += chunk.sediment[i];
  const rows = [
    { ponto: 'canal (5,7)', elev: chunk.elev[chunk.cellIdx(5, 7)], areia: chunk.sand[chunk.cellIdx(5, 7)], deposito: chunk.sandLayer[chunk.cellIdx(5, 7)] },
    { ponto: 'remanso (12,7)', elev: chunk.elev[chunk.cellIdx(12, 7)], areia: chunk.sand[chunk.cellIdx(12, 7)], deposito: chunk.sandLayer[chunk.cellIdx(12, 7)] },
    { ponto: 'margem (4,6)', elev: chunk.elev[chunk.cellIdx(4, 6)], areia: chunk.sand[chunk.cellIdx(4, 6)], deposito: chunk.sandLayer[chunk.cellIdx(4, 6)] },
    { ponto: 'rocha (4,1)', elev: chunk.elev[chunk.cellIdx(4, 1)], areia: chunk.sand[chunk.cellIdx(4, 1)], deposito: chunk.sandLayer[chunk.cellIdx(4, 1)] },
  ].map((r) => ({ ponto: r.ponto, elev: r.elev.toFixed(3), areia: r.areia.toFixed(3), deposito_m: r.deposito.toFixed(4) }));
  console.log(`\n== ${label} ==`);
  // conservação: elevação removida (negativa) + depositada + carga em trânsito
  console.log(`massa do terreno + carga: ${(-eroded + deposited + load).toFixed(4)} m (relativo)`);
  console.log(`erosão acumulada: ${(eroded * cfg.elevationRange).toFixed(3)} m | deposição: ${(deposited * cfg.elevationRange).toFixed(3)} m | carga suspensa: ${(load * cfg.elevationRange).toFixed(4)} m`);
  console.log(`células areia: ${chunk.sandCells()} / ${N * N}`);
  console.table(rows);
  return { eroded, deposited, load };
}

const before = snapshot('antes');
const budget = createSedimentBudget();
stepErosion(region, hours, { worldDay: 100, worldHours: 2400, rainIntensity: rain, budget });
stepBanks(region, hours, { worldDay: 100, worldHours: 2400 });
const after = snapshot('depois');

console.log('\n== orçamento de sedimentos ==');
console.table(Object.entries(budget).map(([k, v]) => ({ processo: k, valor: Number(v.toFixed(4)) })));
const balance = -before.eroded + before.deposited + before.load;
const balanceAfter = -after.eroded + after.deposited + after.load;
console.log(`\nfechamento: ${balance.toFixed(6)} → ${balanceAfter.toFixed(6)} (diferença ${(balanceAfter - balance).toExponential(2)})`);
console.log(`orçamento: erodido ${budget.eroded.toFixed(3)} − depositado ${budget.deposited.toFixed(3)} = ${(budget.eroded - budget.deposited).toFixed(3)} m (carga em trânsito)`);
console.log(`perda inexplicada: ${budget.lost.toExponential(2)} | retido por saturação: ${budget.retained.toExponential(2)}`);
console.log(`árvores removidas: ${chunk.removedPlants.size} de ${chunk.plants.length}`);
