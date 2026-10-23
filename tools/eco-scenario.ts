/**
 * Cenário reproduzível do ecossistema: uma macieira adulta em solo úmido com
 * polinizador, lagarta e joaninha. Registra, hora a hora:
 *   floração → visita/polinização → fruto verde → maduro → queda → chão →
 *   semente → muda, e o efeito de pragas e predadores na produção.
 *
 * Uso: npx tsx tools/eco-scenario.ts [--hours 96] [--pests 1] [--predators 1]
 */
import { Chunk, SOIL_FOREST } from '../src/world/chunk';
import { DEFAULT_CONFIG } from '../src/core/config';
import { speciesIndex } from '../src/world/flora';
import { World } from '../src/world/world';
import {
  stepPhenology,
  stepInsects,
  phenoOf,
  createEcoBudget,
  seedInsects,
  type Insect,
} from '../src/world/ecosystem';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const hours = Number(arg('hours', '96'));
const withPests = arg('pests', '0') === '1';
const withLadybugs = arg('predators', '0') === '1';

const cfg = { ...DEFAULT_CONFIG };
const chunk = new Chunk(0, 0, cfg);
for (let i = 0; i < chunk.n * chunk.n; i++) {
  chunk.soilType[i] = SOIL_FOREST;
  chunk.soilBase[i] = SOIL_FOREST;
  chunk.moisture[i] = 0.62;
  chunk.humus[i] = 4;
  chunk.litter[i] = 2;
  chunk.soilDepth[i] = 1;
}
const apple = speciesIndex('macaneira');
const cellPx = cfg.simCellTiles * cfg.tileSize;
chunk.plants.push({
  id: 4242, species: apple, x: 8.5 * cellPx, y: 8.5 * cellPx,
  birthAge: 60, variant: 3, origin: 'gen',
});
chunk.rebuildPlantIndex();
const plant = chunk.plants[0];
const pheno = phenoOf(plant);
if (withPests) pheno.pests = 0.85;

const world = new World({ seed: 1337 });
const budget = createEcoBudget();
/** polinizadores/predadores do cenário: criados quando há flor (como no jogo) */
const insects: Insect[] = [];
const ensureInsects = () => {
  if (insects.length > 0) return;
  if (pheno.flowers === 0 && !withLadybugs && !withPests) return;
  for (const i of seedInsects(chunk, cfg, 12, day)) {
    if (i.kind === 'bee' || i.kind === 'butterfly') insects.push(i);
    else if (withLadybugs && i.kind === 'ladybug') insects.push(i);
  }
};

console.log(
  `cenário: macieira adulta | ${hours} h de jogo | chuva ${world.climate.rainIntensity(30).toFixed(2)} | ` +
    `pragas iniciais ${pheno.pests.toFixed(2)} | insetos ${insects.length}`,
);
const log: Array<Record<string, unknown>> = [];
let day = 30;
for (let h = 0; h < hours; h += 3) {
  day = 30 + h / 24;
  void day;
  const ctx = {
    cfg,
    climate: world.climate,
    worldDay: day,
    season: world.climate.seasonIndex(day),
    hourFraction: 0.5,
    humidity: 0.52,
  };
  stepPhenology(chunk, 3, ctx, budget);
  // insetos: criados quando a flora abre (como no jogo), em passos curtos
  ensureInsects();
  for (let k = 0; k < 12; k++) {
    stepInsects(insects, cfg, { worldDay: day, hour: 12, detailed: true, budget });
  }
  log.push({
    h,
    estágio: pheno.stage,
    flores: pheno.flowers,
    frutos: pheno.fruits.map((f) => f.age.toFixed(2)).join(' ') || '-',
    pragas: pheno.pests.toFixed(2),
    chão: chunk.groundFruits.length,
    sementes: chunk.seedBed.length,
    mudas: chunk.recruitedPlants.length,
  });
}
console.log('\n== linha do tempo (resumo a cada 12 h) ==');
console.table(log.filter((_, i) => i % 4 === 0));
console.log('== orçamento ecológico ==', budget);
console.log(
  `\nresultado: florou ${budget.flowered}× | polinizações ${budget.pollinated} | frutos maduros ${budget.ripened} | ` +
    `caíram ${budget.fallen} | sementes ${budget.seeds}`,
);
console.log(
  `estado final: estágio ${pheno.stage} | frutos na planta ${pheno.fruits.length} | no chão ${chunk.groundFruits.length} | ` +
    `sementes ${chunk.seedBed.length} | mudas ${chunk.recruitedPlants.length} | pragas ${pheno.pests.toFixed(2)}`,
);
