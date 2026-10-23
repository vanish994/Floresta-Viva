/**
 * Ecossistema vivo: fenologia (floração → polinização → fruto), queda de frutos,
 * sementes, herbivoria e insetos (polinizadores, pragas e predadores).
 *
 * Regras de projeto:
 *  - não há segundo sistema de clima/solo/saúde: usamos `climate`, `moisture`,
 *    `stress`, `canopyCoverAt` e `plantHealth` que já existem;
 *  - cada planta guarda apenas o estado que o save precisa (fenologia + pragas);
 *    insetos são agentes leves reconstruídos pelo ecossistema;
 *  - frutos maduros CAEM: a chance cresce com o tempo na planta, varia por
 *    espécie e pela estação, e o fruto passa a viver no chão (coleta/consumo/
 *    decomposição/semente).
 */
import type { WorldConfig } from '../core/config';
import { clamp, hash2 } from '../core/rng';
import { Chunk } from './chunk';
import { SPECIES, plantRecordById, type PlantRecord } from './flora';
import { plantHealth, plantSize } from './ecology';
import type { Climate } from './climate';

// ---------------------------------------------------------------------------
// catálogo de frutos
// ---------------------------------------------------------------------------

export interface FruitDef {
  id: string;
  name: string;
  /** classe de tamanho: define os pixels desenhados sobre a copa */
  size: 'big' | 'medium' | 'small' | 'tiny';
  /** fração do tempo de maturação em que fica verde */
  greenShare: number;
}

export const FRUITS: Record<string, FruitDef> = {
  maca: { id: 'maca', name: 'Maçã', size: 'big', greenShare: 0.55 },
  pera: { id: 'pera', name: 'Pera', size: 'big', greenShare: 0.55 },
  cereja: { id: 'cereja', name: 'Cereja', size: 'medium', greenShare: 0.45 },
  ameixa: { id: 'ameixa', name: 'Ameixa', size: 'medium', greenShare: 0.5 },
  uva: { id: 'uva', name: 'Uva', size: 'medium', greenShare: 0.5 },
  acai: { id: 'acai', name: 'Açaí', size: 'medium', greenShare: 0.5 },
  amora: { id: 'amora', name: 'Amora', size: 'small', greenShare: 0.45 },
  framboesa: { id: 'framboesa', name: 'Framboesa', size: 'small', greenShare: 0.45 },
  mirtilo: { id: 'mirtilo', name: 'Mirtilo', size: 'small', greenShare: 0.45 },
  gooseberry: { id: 'gooseberry', name: 'Gooseberry', size: 'small', greenShare: 0.45 },
  cassis: { id: 'cassis', name: 'Cassis', size: 'small', greenShare: 0.45 },
  physalis: { id: 'physalis', name: 'Physalis', size: 'small', greenShare: 0.5 },
  morango: { id: 'morango', name: 'Morango', size: 'tiny', greenShare: 0.4 },
};

/** ordem estável das espécies de fruto na folha de sprites */
export const FRUIT_ORDER: string[] = [
  'maca', 'pera', 'cereja', 'ameixa', 'uva', 'acai', 'amora', 'framboesa',
  'mirtilo', 'gooseberry', 'cassis', 'physalis', 'morango',
];

/** pixels do fruto sobre a copa, por porte (árvore grande → fruto visível) */
export const FRUIT_PIXELS: Record<FruitDef['size'], number> = {
  big: 7,
  medium: 5,
  small: 4,
  tiny: 3,
};

// ---------------------------------------------------------------------------
// fenologia da planta (estado persistido)
// ---------------------------------------------------------------------------

export type PhenoStage = 'vegetative' | 'flowering' | 'green' | 'ripe';

export interface FruitSlot {
  /** 0..1 — estágio dentro do slot: 0 = flor aberta, 1 = maduro */
  age: number;
  /** foi polinizada (sem isso o slot não vira fruto) */
  pollinated: boolean;
  /** horas de jogo na planta depois de maduro (define a chance de cair) */
  ripeHours: number;
  /** posição relativa no interior da copa (-1..1) */
  ox: number;
  oy: number;
  /** variação por fruto: muda o tempo de queda */
  holdBias: number;
}

/** fruto caído no chão (persistido no save do chunk) */
export interface GroundFruit {
  id: number;
  /** id do fruto no catálogo */
  fruit: string;
  species: number;
  x: number;
  y: number;
  /** horas de jogo no chão */
  ageHours: number;
  /** chave determinística para o sorteio da semente */
  seedKey: number;
  /** pequeno deslocamento inicial (animação de queda) */
  dropOffset: number;
  slot: FruitSlot;
}

/** semente no solo, aguardando condições de germinação */
export interface SeedEntry {
  x: number;
  y: number;
  species: number;
  /** horas desde que a semente ficou viável no solo */
  ageHours: number;
  seedKey: number;
}

export interface PlantPhenology {
  stage: PhenoStage;
  /** horas acumuladas no estágio corrente */
  timer: number;
  flowers: number;
  fruits: FruitSlot[];
  /** pressão de herbivoria 0..1 (lagartas) */
  pests: number;
  /** horas de dormência sazonal restantes */
  dormant: number;
}

export const MAX_FLOWERS = 6;
/** duração da antese (horas de jogo): 0,5 dia = 12 min reais */
export const FLOWERING_HOURS = 12;
/** fruto no chão: tempo até decompor/virar semente (horas de jogo) */
export const GROUND_FRUIT_HOURS = 48;
/** semente viável no solo (horas de jogo) */
export const SEED_LIFE_HOURS = 24 * 12;
/** teto de mudas por chunk (evita crescimento explosivo por sementes) */
export const RECRUIT_CAP = 10;
/** teto de sementes no banco do chunk */
export const SEED_BED_CAP = 24;
/** chance de polinização pelo vento (baixa: a visita do inseto é o que importa) */
export const WIND_POLLINATION = 0.04;
/** horas que uma flor visitada guarda a "memória" da polinização */
export const FLOWER_VISIT_HOURS = 6;

const newPheno = (): PlantPhenology => ({
  stage: 'vegetative',
  timer: 0,
  flowers: 0,
  fruits: [],
  pests: 0,
  dormant: 0,
});

export function phenoOf(plant: PlantRecord): PlantPhenology {
  if (!plant.pheno) plant.pheno = newPheno();
  return plant.pheno;
}

/** "saúde" combinada: idade/estresse existentes + pragas novas (0..1) */
export function fruitPlantHealth(plant: PlantRecord, chunk: Chunk, cfg: WorldConfig, worldDay: number): number {
  const base = plantHealth(plant, chunk, cfg, worldDay);
  const pests = plant.pheno?.pests ?? 0;
  // pragas fortes comprometem a saúde (≤45%), mas não zeram a planta
  return clamp(base * (1 - pests * 0.45), 0.05, 1);
}

/** planta pode frutificar? (adulta, viva, com fruto definido e estação ok) */
export function canFruit(plant: PlantRecord, chunk: Chunk, cfg: WorldConfig, worldDay: number): boolean {
  const sp = SPECIES[plant.species];
  if (!sp.fruit) return false;
  if (chunk.removedPlants.has(plant.id)) return false;
  const size = plantSize(plant, chunk, cfg, worldDay);
  const mature = plant.birthAge + worldDay >= sp.maturityAge * 0.5;
  if (size < 0.45 && !mature) return false; // jovem ainda não frutifica
  return fruitPlantHealth(plant, chunk, cfg, worldDay) > 0.2;
}

function seasonFactor(sp: (typeof SPECIES)[number], season: number): number {
  return sp.fruitingSeason[clamp(season, 0, 3)] ?? 0;
}

// ---------------------------------------------------------------------------
// estado ecológico por chunk (sobrevive a unload/reload no mundo infinito)
// ---------------------------------------------------------------------------

/** estado ecológico serializável de um chunk (plantas + chão + pragas) */
export interface EcoSnapshot {
  /** hora de jogo em que o snapshot foi tirado */
  hour: number;
  plants: Map<number, PlantPhenology>;
  groundFruits: GroundFruit[];
  seedBed: SeedEntry[];
  pestPressure: number;
  /**
   * Plantas que nasceram pela simulação (mudas de semente) e ids removidos
   * (árvores derrubadas pelo jogador/erosão). Sem isso, um chunk descarregado
   * perderia as mudas e as árvores cortadas voltariam ao ser regenerado.
   */
  recruited: PlantRecord[];
  removed: number[];
}

/**
 * Captura o estado ecológico do chunk no instante `hour`.
 *
 * Memória: só entram plantas com estado NÃO padrão (floração, fruto, praga) e
 * as de fruto/praga entram primeiro — um chunk tem ~470 plantas e o arquivo
 * pode guardar 192 chunks; guardar tudo custaria dezenas de MB.
 */
export function snapshotEco(chunk: Chunk, hour: number): EcoSnapshot {
  const plants = new Map<number, PlantPhenology>();
  const store = (plant: PlantRecord, p: PlantPhenology) => {
    if (plants.size >= ECO_SNAPSHOT_MAX_PLANTS) return;
    plants.set(plant.id, {
      stage: p.stage,
      timer: p.timer,
      flowers: p.flowers,
      pests: p.pests,
      dormant: p.dormant,
      fruits: p.fruits.map((f) => ({ ...f })),
    });
  };
  const important: PlantRecord[] = [];
  const rest: PlantRecord[] = [];
  for (const plant of chunk.livePlants()) {
    const p = plant.pheno;
    if (!p) continue;
    const trivial = p.stage === 'vegetative' && p.fruits.length === 0 && p.flowers === 0 && p.pests < 0.01;
    if (trivial) continue;
    if (p.fruits.length > 0 || p.pests > 0.05) important.push(plant);
    else rest.push(plant);
  }
  for (const plant of important) store(plant, plant.pheno!);
  for (const plant of rest) store(plant, plant.pheno!);
  return {
    hour,
    plants,
    groundFruits: chunk.groundFruits.map((g) => ({ ...g, slot: { ...g.slot } })),
    seedBed: chunk.seedBed.map((s) => ({ ...s })),
    pestPressure: chunk.pestPressure,
    recruited: chunk.recruitedPlants.slice(0, ECO_SNAPSHOT_MAX_RECRUITS).map((p) => ({ ...p })),
    removed: [...chunk.removedPlants].slice(-ECO_SNAPSHOT_MAX_REMOVED),
  };
}

/** devolve o estado ecológico ao chunk recém-gerado (sem duplicar nada) */
export function restoreEco(chunk: Chunk, snap: EcoSnapshot): void {
  chunk.groundFruits = snap.groundFruits.map((g) => ({ ...g, slot: { ...g.slot } }));
  chunk.seedBed = snap.seedBed.map((s) => ({ ...s }));
  chunk.pestPressure = snap.pestPressure;
  // árvores derrubadas continuam derrubadas
  for (const id of snap.removed) chunk.removedPlants.add(id);
  // mudas continuam no mundo (sem duplicar as que já existem na geração)
  if (snap.recruited.length > 0) {
    const known = new Set<number>();
    for (const p of chunk.plants) known.add(p.id);
    for (const p of chunk.recruitedPlants) known.add(p.id);
    for (const p of snap.recruited) {
      if (known.has(p.id) || chunk.removedPlants.has(p.id)) continue;
      chunk.recruitedPlants.push({ ...p, pheno: undefined });
      known.add(p.id);
    }
    chunk.rebuildPlantIndex();
  }
  chunk.ecoDirty = true;
  if (snap.plants.size === 0) return;
  for (const plant of chunk.livePlants()) {
    const saved = snap.plants.get(plant.id);
    if (!saved) continue;
    plant.pheno = {
      stage: saved.stage,
      timer: saved.timer,
      flowers: saved.flowers,
      pests: saved.pests,
      dormant: saved.dormant,
      fruits: saved.fruits.map((f) => ({ ...f })),
    };
  }
  chunk.ecoDirty = true;
}

/**
 * Avança o estado ecológico de um chunk que ficou fora de carga por `hours`
 * horas de jogo. Usa passos grossos e limitados (continuidade, não exatidão):
 * o mundo "continua" enquanto o jogador está longe, sem custo por chunk/frame.
 */
export function fastForwardEco(
  chunk: Chunk,
  snap: EcoSnapshot,
  hours: number,
  ctx: EcoContext,
  budget: EcoBudget = createEcoBudget(),
): EcoBudget {
  restoreEco(chunk, snap);
  const elapsed = Math.min(Math.max(0, hours), FF_MAX_HOURS);
  if (elapsed <= 0) return budget;
  const steps = Math.min(FF_MAX_STEPS, Math.max(1, Math.ceil(elapsed / FF_STEP_HOURS)));
  const dt = elapsed / steps;
  const dayPerHour = 1 / 24;
  for (let k = 0; k < steps; k++) {
    const stepCtx: EcoContext = {
      ...ctx,
      worldDay: ctx.worldDay + (elapsed - dt * (steps - k)) * dayPerHour,
      season: ctx.climate.seasonIndex(ctx.worldDay + (elapsed - dt * (steps - k)) * dayPerHour),
    };
    stepPhenology(chunk, dt, stepCtx, budget);
  }
  return budget;
}

/** teto de plantas com estado guardadas por snapshot (memória do arquivo) */
export const ECO_SNAPSHOT_MAX_PLANTS = 220;
/** teto de mudas e de ids removidos guardados por snapshot */
export const ECO_SNAPSHOT_MAX_RECRUITS = 64;
export const ECO_SNAPSHOT_MAX_REMOVED = 256;

/** teto de tempo "recuperado" ao voltar a um chunk (evita saltos absurdos) */
export const FF_MAX_HOURS = 24 * 20;
/** passo máximo de recuperação e número máximo de passos (custo limitado) */
export const FF_STEP_HOURS = 6;
export const FF_MAX_STEPS = 8;

// ---------------------------------------------------------------------------
// passo fenológico (por chunk, frequência da biologia)
// ---------------------------------------------------------------------------

export interface EcoContext {
  cfg: WorldConfig;
  climate: Climate;
  worldDay: number;
  season: number;
  /** fração do dia já passada (0..1) — pragas e polinizadores são diurnos */
  hourFraction: number;
  humidity: number;
}

export interface EcoBudget {
  /** polinizações efetivadas neste passo */
  pollinated: number;
  /** frutos que ficaram maduros */
  ripened: number;
  /** frutos que caíram neste passo */
  fallen: number;
  /** sementes produzidas por frutos no chão */
  seeds: number;
  /** plantas que passaram a florir */
  flowered: number;
}

export const createEcoBudget = (): EcoBudget => ({
  pollinated: 0,
  ripened: 0,
  fallen: 0,
  seeds: 0,
  flowered: 0,
});

/**
 * Avança a fenologia de todas as plantas de um chunk por `hours` horas de jogo.
 * É a MESMA frequência do passo de biologia (3 h), então não há novo laço caro.
 */
export function stepPhenology(
  chunk: Chunk,
  hours: number,
  ctx: EcoContext,
  budget: EcoBudget,
  visits?: Map<number, number>,
): void {
  const { cfg, worldDay, season } = ctx;
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const n = chunk.n;

  for (const plant of chunk.livePlants()) {
    const sp = SPECIES[plant.species];
    const pheno = phenoOf(plant);
    const lx = clamp(Math.floor(plant.x / cellPx) - chunk.cx * n, 0, n - 1);
    const ly = clamp(Math.floor(plant.y / cellPx) - chunk.cy * n, 0, n - 1);
    const i = chunk.cellIdx(lx, ly);
    const moist = chunk.moisture[i];
    const health = fruitPlantHealth(plant, chunk, cfg, worldDay);
    // porte pela maturidade (uma árvore adulta pode ser "jovem" em tamanho
    // visual dependendo da idade de geração; o critério é a idade/maturidade)
    const size = plantSize(plant, chunk, cfg, worldDay);
    const mature = plant.birthAge + worldDay >= sp.maturityAge * 0.5;
    const vigor = clamp(Math.max(size, mature ? 0.7 : size), 0, 1);
    const seasonF = seasonFactor(sp, season);

    // --- pragas: pressão da lagarta (cai com predador e saúde) ------------
    // A herbivoria pressupõe folhagem: fora da estação/em planta vigorosa a
    // pressão é baixa; sem joaninha ela cresce e derruba floração e frutos.
    const predators = chunk.predators?.[i] ?? 0;
    const herbivoreChance = 0.012 * Math.max(0.25, seasonF);
    pheno.pests = clamp(
      pheno.pests + hours * (herbivoreChance * (1 - predators) * (1 - pheno.pests) - 0.02 * predators - 0.008 * pheno.pests),
      0,
      1,
    );

    if (pheno.dormant > 0) {
      pheno.dormant = Math.max(0, pheno.dormant - hours);
      continue;
    }
    if (!sp.fruit) {
      // espécies sem fruto: só mantêm a pressão de pragas (as flores decorativas
      // das espécies ornamentais continuam sendo as do render)
      continue;
    }

    // condições ambientais: água, temperatura e saúde da planta governam a floração
    const dry = moist < sp.waterNeed * 0.65;
    const winter = season === 3;
    if (winter || dry) {
      // verão/inverno: fora de estação a planta não abre flor
      if (pheno.stage !== 'vegetative') pheno.stage = 'vegetative';
      pheno.dormant = hours;
      continue;
    }

    switch (pheno.stage) {
      case 'vegetative': {
        pheno.timer += hours;
        const ready = pheno.timer > 3;
        if (!ready) break;
        // floração exige vigor e saúde mínimos (herbivoria/doença impede)
        const chance = clamp(seasonF * health * (0.35 + 0.65 * moist) * clamp(vigor, 0.3, 1), 0, 1);
        if (health < 0.3 || vigor < 0.4) break;
        const roll = hash2(cfg.seed ^ 0x51f3, plant.id % 100000, Math.floor(worldDay / 3) + 1, 611);
        if (roll < chance) {
          pheno.stage = 'flowering';
          pheno.timer = 0;
          pheno.flowers = Math.max(
            1,
            Math.round(MAX_FLOWERS * seasonF * health * (0.5 + 0.5 * vigor)),
          );
          pheno.fruits = [];
          budget.flowered++;
        } else {
          pheno.timer = 0;
        }
        break;
      }
      case 'flowering': {
        pheno.timer += hours;
        // tempo de antese: 2–3 dias; pragas encurtam/derrubam flores
        if (pheno.pests > 0.6 && pheno.flowers > 0) {
          if (hash2(cfg.seed ^ 0x9a1, plant.id, Math.floor(pheno.timer), 612) < pheno.pests * 0.02) {
            pheno.flowers--;
          }
        }
        if (pheno.timer < FLOWERING_HOURS) break;
        // fecha a florada: cada flor pode ter sido polinizada por um inseto
        const pollinated = pheno.fruits.length;
        const openFlowers = Math.max(0, pheno.flowers - pollinated);
        if (openFlowers > 0) {
          const slots = Math.min(sp.maxFruits - pheno.fruits.length, openFlowers);
          // as flores VISITADAS por um polinizador viram fruto com chance alta;
          // as não visitadas dependem do vento (baixa, nunca automática)
          let visited = Math.max(0, Math.floor(visits?.get(plant.id) ?? 0));
          for (let k = 0; k < slots; k++) {
            const roll = hash2(cfg.seed ^ 0x77a1, plant.id + k, Math.floor(worldDay), 613);
            if (visited > 0) {
              visited--;
              if (roll < 0.9) {
                pheno.fruits.push(makeSlot(plant, cfg, k, worldDay));
                budget.pollinated++;
              }
            } else if (roll < WIND_POLLINATION) {
              pheno.fruits.push(makeSlot(plant, cfg, k, worldDay));
              budget.pollinated++;
            }
          }
        }
        pheno.stage = pheno.fruits.length > 0 ? 'green' : 'vegetative';
        pheno.timer = 0;
        pheno.flowers = 0;
        break;
      }
      case 'green': {
        pheno.timer += hours;
        const ripenHours = Math.max(6, sp.fruitRipenDays * 24);
        let green = 0;
        for (const slot of pheno.fruits) {
          const before = slot.age;
          const growth = (hours / ripenHours) * clamp(0.55 + 0.45 * health, 0.3, 1.2) * clamp(0.6 + 0.4 * moist, 0.4, 1.1);
          slot.age = clamp(slot.age + growth, 0, 1);
          if (before < 1 && slot.age >= 1) budget.ripened++;
          if (slot.age < 1) green++;
        }
        if (green === 0) {
          pheno.stage = 'ripe';
          pheno.timer = 0;
        }
        break;
      }
      case 'ripe': {
        pheno.timer += hours;
        for (const slot of pheno.fruits) slot.ripeHours += hours;
        // queda: a chance cresce com o tempo que o fruto passa maduro na planta.
        // O tempo de permanência varia por espécie (maçã segura mais que cereja)
        // e por fruto (holdBias), então não há um instante fixo para todos.
        const holdDays = sp.fruitHoldDays * (0.7 + 0.6 * clamp(1 - health, 0, 1));
        for (let k = pheno.fruits.length - 1; k >= 0; k--) {
          const slot = pheno.fruits[k];
          const holdHours = Math.max(6, holdDays * 24 * slot.holdBias);
          const ageFactor = clamp(slot.ripeHours / holdHours, 0, 3);
          const rain = ctx.climate.rainIntensity(ctx.worldDay) >= 0.5 ? 1.5 : 1;
          // risco por passo: a chance de cair em relação ao tempo que já passou
          // maduro — quanto mais tempo na planta, maior a chance (nunca 100%
          // de uma vez, e sempre variável por fruto)
          const hazard = (hours / holdHours) * (0.45 + ageFactor * ageFactor);
          const chance = clamp(1 - Math.exp(-hazard * rain), 0, 0.95);
          const roll = hash2(cfg.seed ^ 0x2b7, plant.id + k, Math.floor(pheno.timer) + 7, 614);
          if (roll < chance) {
            dropFruit(chunk, plant, slot, cfg, ctx);
            pheno.fruits.splice(k, 1);
            budget.fallen++;
          }
        }
        if (pheno.fruits.length === 0) {
          pheno.stage = 'vegetative';
          pheno.timer = 0;
        }
        break;
      }
    }
  }

  // --- frutos no chão: decomposição → semente ----------------------------
  // qualquer mudança de fenologia/frutos/pragas precisa ir para o save
  if (budget.flowered || budget.pollinated || budget.ripened || budget.fallen || budget.seeds) {
    chunk.ecoDirty = true;
  }
  if (chunk.groundFruits.length > 0 || chunk.seedBed.length > 0) chunk.ecoDirty = true;

  if (chunk.groundFruits.length > 0) {
    const keep: typeof chunk.groundFruits = [];
    for (const gf of chunk.groundFruits) {
      gf.ageHours += hours;
      const decomposeAfter = GROUND_FRUIT_HOURS;
      if (gf.ageHours >= decomposeAfter) {
        // chance de deixar uma semente viável no solo
        const roll = hash2(cfg.seed ^ 0x4c1, gf.seedKey, Math.floor(gf.ageHours), 615);
        if (roll < 0.45) {
          if (chunk.seedBed.length < SEED_BED_CAP) {
            chunk.seedBed.push({ x: gf.x, y: gf.y, species: gf.species, ageHours: 0, seedKey: gf.seedKey });
          }
          budget.seeds++;
        }
        // o restante vira matéria orgânica (liteira) na célula
        const ci = chunk.cellIdx(
          clamp(Math.floor(gf.x / cellPx) - chunk.cx * n, 0, n - 1),
          clamp(Math.floor(gf.y / cellPx) - chunk.cy * n, 0, n - 1),
        );
        chunk.litter[ci] = Math.min(16, chunk.litter[ci] + 0.7);
        chunk.soilDirty = true;
        continue;
      }
      keep.push(gf);
    }
    chunk.groundFruits = keep;
  }

  // --- sementes no solo: germinam com umidade e sorte --------------------
  if (chunk.seedBed.length > 0) {
    const keep: typeof chunk.seedBed = [];
    for (const seed of chunk.seedBed) {
      seed.ageHours += hours;
      const ci = chunk.cellIdx(
        clamp(Math.floor(seed.x / cellPx) - chunk.cx * n, 0, n - 1),
        clamp(Math.floor(seed.y / cellPx) - chunk.cy * n, 0, n - 1),
      );
      const moist = chunk.moisture[ci];
      const germ = moist > 0.35 && chunk.waterDepth[ci] < 0.25;
      if (seed.ageHours > 24 && germ && chunk.recruitedPlants.length < RECRUIT_CAP) {
        const roll = hash2(cfg.seed ^ 0x7d3, seed.seedKey, Math.floor(seed.ageHours), 616);
        if (roll < 0.08) {
          spawnSeedling(chunk, seed, cfg);
          budget.seeds++;
          continue;
        }
      }
      if (seed.ageHours > SEED_LIFE_HOURS) continue; // semente inviável
      keep.push(seed);
    }
    chunk.seedBed = keep;
  }
}

function makeSlot(plant: PlantRecord, cfg: WorldConfig, k: number, worldDay: number): FruitSlot {
  const r1 = hash2(cfg.seed ^ 0x1234, plant.id + k, Math.floor(worldDay), 617);
  const r2 = hash2(cfg.seed ^ 0x1234, plant.id - k, Math.floor(worldDay), 618);
  const r3 = hash2(cfg.seed ^ 0x1234, plant.id * 7 + k, Math.floor(worldDay), 619);
  return {
    age: 0,
    pollinated: true,
    ripeHours: 0,
    ox: (r1 - 0.5) * 2,
    oy: (r2 - 0.5) * 2,
    holdBias: 0.8 + r3 * 0.5,
  };
}

/** fruto maduro cai: sai da copa e passa a viver no chão (com deslocamento) */
function dropFruit(chunk: Chunk, plant: PlantRecord, slotData: FruitSlot, cfg: WorldConfig, ctx: EcoContext): void {
  const sp = SPECIES[plant.species];
  if (!sp.fruit) return;
  const r = hash2(cfg.seed ^ 0x9e12, plant.id, Math.floor(ctx.worldDay * 24) + chunk.groundFruits.length, 620);
  const a = r * Math.PI * 2;
  const dist = 8 + r * 22; // cai perto, com pequeno espalhamento natural
  // o fruto pertence ao chunk da planta-mãe: a posição é contida na área do
  // chunk para não existir fruto "fora do dono" (render/save coerentes)
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const minX = chunk.cx * cellPx + 2;
  const maxX = (chunk.cx + 1) * cellPx - 2;
  const minY = chunk.cy * cellPx + 2;
  const maxY = (chunk.cy + 1) * cellPx - 2;
  const x = clamp(plant.x + Math.cos(a) * dist, minX, maxX);
  const y = clamp(plant.y + Math.sin(a) * dist * 0.5 + 6, minY, maxY);
  chunk.groundFruits.push({
    id: hash2(cfg.seed, plant.id + chunk.groundFruits.length, Math.floor(ctx.worldDay), 621),
    fruit: sp.fruit,
    species: plant.species,
    x,
    y,
    ageHours: 0,
    seedKey: plant.id * 31 + chunk.groundFruits.length,
    dropOffset: 0,
    slot: { ...slotData },
  });
  // limite de frutos no chão por chunk (performance/memória)
  if (chunk.groundFruits.length > 48) chunk.groundFruits.splice(0, chunk.groundFruits.length - 48);
}

function spawnSeedling(chunk: Chunk, seed: { x: number; y: number; species: number; seedKey: number }, cfg: WorldConfig): void {
  const id = Math.floor(hash2(cfg.seed ^ 0x5eed, seed.seedKey, Math.floor(seed.x), 622) * 0x7fffffff);
  if (chunk.removedPlants.has(id)) return;
  const exists = chunk.recruitedPlants.some((p) => p.id === id) || chunk.plants.some((p) => p.id === id);
  if (exists) return;
  chunk.recruitedPlants.push({
    id,
    species: seed.species,
    x: seed.x,
    y: seed.y,
    birthAge: 0, // nasce agora: a idade cresce com o tempo de jogo
    variant: Math.floor(hash2(cfg.seed, seed.seedKey, 7, 623) * 997),
    origin: 'recruit',
  });
  chunk.dirty = true;
  chunk.rebuildPlantIndex();
}

// ---------------------------------------------------------------------------
// polinização por insetos
// ---------------------------------------------------------------------------

/**
 * Registra a visita de um polinizador a uma flor da planta: a flor vira um
 * fruto em desenvolvimento (verde). Retorna true se a flor foi fertilizada.
 */
export function pollinate(
  plant: PlantRecord,
  cfg: WorldConfig,
  worldDay: number,
  amount = 1,
  pollenCompatible = true,
): boolean {
  const sp = SPECIES[plant.species];
  if (!sp.fruit) return false;
  const pheno = phenoOf(plant);
  if (pheno.stage !== 'flowering' || pheno.flowers <= 0) return false;
  if (pheno.fruits.length >= sp.maxFruits) return false;
  // pólen de outra planta da mesma espécie é mais eficaz que autopolinização
  const chance = pollenCompatible ? 0.85 : 0.35;
  const roll = hash2(cfg.seed ^ 0xfeed, plant.id, pheno.fruits.length + Math.floor(worldDay * 24), 624);
  if (roll > chance) return false;
  for (let k = 0; k < amount; k++) {
    if (pheno.fruits.length >= sp.maxFruits || pheno.flowers <= pheno.fruits.length) break;
    pheno.fruits.push(makeSlot(plant, cfg, k, worldDay));
  }
  if (pheno.fruits.length >= pheno.flowers) {
    // todas as flores fertilizadas: a planta amadurece já como fruto verde
    pheno.stage = 'green';
    pheno.timer = 0;
  }
  return true;
}

/** planta pronta para receber visitas (flor aberta e com néctar) */
export function hasOpenFlower(plant: PlantRecord): boolean {
  const pheno = plant.pheno;
  if (!pheno || pheno.stage !== 'flowering' || pheno.flowers <= 0) return false;
  return pheno.fruits.length < pheno.flowers;
}

// ---------------------------------------------------------------------------
// insetos: agentes leves em pool (sem entidade por inseto no save)
// ---------------------------------------------------------------------------

export type InsectKind = 'bee' | 'butterfly' | 'ladybug' | 'caterpillar';
export type InsectState = 'wander' | 'seek-flower' | 'seek-plant' | 'seek-prey' | 'feeding';

export interface Insect {
  id: number;
  kind: InsectKind;
  chunk: Chunk;
  x: number;
  y: number;
  state: InsectState;
  /** alvo atual (planta) */
  targetId: number;
  /** pólen carregado (só polinizadores) */
  pollen: boolean;
  /** espécie da última flor visitada (para compatibilidade de pólen) */
  pollenSpecies: number;
  energy: number;
  /** fase de voo para o desenho */
  phase: number;
  cooldown: number;
}

export interface InsectOptions {
  /** densidade alvo por chunk (máximo de agentes por tipo) */
  maxPerChunk: { bee: number; butterfly: number; ladybug: number; caterpillar: number };
}

/** cria insetos para um chunk de forma determinística a partir da flora local */
export function seedInsects(chunk: Chunk, cfg: WorldConfig, hour: number, day: number): Insect[] {
  const out: Insect[] = [];
  const cellPx = cfg.simCellTiles * cfg.tileSize;
  const n = chunk.n;
  let flowers = 0;
  let plants = 0;
  for (const plant of chunk.livePlants()) {
    plants++;
    if (hasOpenFlower(plant)) flowers++;
  }
  if (plants === 0) return out;
  const night = hour < 6 || hour > 19;
  // polinizadores dependem de flores (ciclo positivo/negativo do prompt)
  const beeCount = night ? 0 : Math.min(3, Math.round(flowers * 0.5));
  const butterflyCount = night ? 0 : Math.min(2, Math.round(flowers * 0.3));
  // herbívoros seguem a disponibilidade de folhas; predadores seguem a presa
  const caterpillarCount = Math.min(3, Math.round(plants * 0.02) + (flowers > 0 ? 1 : 0));
  const ladybugCount = Math.min(2, Math.round(caterpillarCount * 0.6));

  const pick = (kind: InsectKind, count: number) => {
    for (let k = 0; k < count; k++) {
      const r = hash2(cfg.seed ^ 0x1a2b, chunk.cx * 31 + k, chunk.cy * 17 + Math.floor(day), 630);
      const lx = Math.floor(r * n);
      const ly = Math.floor(hash2(cfg.seed ^ 0x1a2b, chunk.cx * 13 + k, chunk.cy * 7 + Math.floor(day), 631) * n);
      out.push({
        id: Math.floor(hash2(cfg.seed, chunk.cx * 100 + k, chunk.cy * 100 + kind.length, 632) * 0x7fffffff),
        kind,
        chunk,
        x: (chunk.cx * n + lx + 0.5) * cellPx,
        y: (chunk.cy * n + ly + 0.5) * cellPx,
        state: 'wander',
        targetId: -1,
        pollen: false,
        pollenSpecies: -1,
        energy: 0.6 + hash2(cfg.seed, k, chunk.cx, 633) * 0.4,
        phase: r * Math.PI * 2,
        cooldown: 0,
      });
    }
  };
  pick('bee', beeCount);
  pick('butterfly', butterflyCount);
  pick('caterpillar', caterpillarCount);
  pick('ladybug', ladybugCount);
  return out;
}

export interface InsectStepOptions {
  worldDay: number;
  hour: number;
  /** true para simular em detalhe (perto do jogador) */
  detailed: boolean;
  budget: EcoBudget;
  /** chunks vizinhos carregados (permite polinizar na fronteira) */
  neighbors?: ChunkLookup;
}

/** distância de busca (px) — insetos não procuram o mundo inteiro */
const SEARCH_RADIUS = 220;

/**
 * Passo dos insetos (visita → pólen → flor compatível → polinização;
 * lagarta come folhas; joaninha reduz pragas). Barato: só raio local.
 */
export function stepInsects(insects: Insect[], cfg: WorldConfig, opts: InsectStepOptions): void {
  const night = opts.hour < 6 || opts.hour > 19;
  for (const insect of insects) {
    const chunk = insect.chunk;
    if (night && (insect.kind === 'bee' || insect.kind === 'butterfly')) {
      // dormem na copa à noite (sem custo de busca)
      insect.energy = clamp(insect.energy - 0.002, 0, 1);
      continue;
    }
    insect.cooldown = Math.max(0, insect.cooldown - 1);
    insect.phase += 0.35;

    const target = insect.targetId >= 0 ? plantByTarget(chunk, insect.targetId, opts.neighbors) : undefined;

    switch (insect.state) {
      case 'wander': {
        moveToward(insect, insect.x + Math.cos(insect.phase) * 18, insect.y + Math.sin(insect.phase * 0.7) * 10);
        if (insect.cooldown > 0) break;
        if (insect.kind === 'bee' || insect.kind === 'butterfly') {
          if (opts.detailed) {
            const flower = findPlant(chunk, insect, (p) => hasOpenFlower(p), opts.neighbors);
            if (flower) {
              insect.targetId = flower.id;
              insect.state = 'seek-flower';
              break;
            }
          }
        } else if (insect.kind === 'caterpillar') {
          const food = findPlant(
            chunk,
            insect,
            (p) => SPECIES[p.species].id !== 'araucaria' && plantSize(p, chunk, cfg, opts.worldDay) > 0.3,
            opts.neighbors,
          );
          if (food) {
            insect.targetId = food.id;
            insect.state = 'seek-plant';
          }
        } else {
          const preyChunk = chunk;
          const prey = (preyChunk.pestPressure ?? 0) > 0.05 ? chunk : null;
          if (prey) {
            insect.state = 'seek-prey';
            insect.targetId = -1;
          }
        }
        insect.cooldown = 30;
        break;
      }
      case 'seek-flower': {
        if (!target || !hasOpenFlower(target)) {
          insect.state = 'wander';
          insect.targetId = -1;
          break;
        }
        const arrived = moveToward(insect, target.x, target.y - 6);
        if (arrived) {
          // a flor pode estar em outro chunk carregado: o estado vai no dono
          const owner = chunkOfPlant(target, chunk, opts.neighbors);
          const sp = SPECIES[target.species];
          const compatible = insect.pollen && insect.pollenSpecies === target.species;
          const ok = pollinate(target, cfg, opts.worldDay, 1, compatible);
          if (ok) opts.budget.pollinated++;
          insect.pollen = true;
          insect.pollenSpecies = target.species;
          insect.energy = clamp(insect.energy + 0.15 * sp.nectar, 0, 1);
          if (owner) owner.ecoDirty = true;
          insect.state = 'wander';
          insect.targetId = -1;
          insect.cooldown = 45;
        }
        break;
      }
      case 'seek-plant': {
        if (!target) {
          insect.state = 'wander';
          break;
        }
        const arrived = moveToward(insect, target.x, target.y - 4);
        if (arrived) {
          // herbivoria: consome folhas → pragas da planta sobem
          const pheno = phenoOf(target);
          pheno.pests = clamp(pheno.pests + 0.05, 0, 1);
          insect.energy = clamp(insect.energy + 0.2, 0, 1);
          const owner = chunkOfPlant(target, chunk, opts.neighbors) ?? chunk;
          owner.pestPressure = clamp((owner.pestPressure ?? 0) + 0.03, 0, 1);
          owner.ecoDirty = true;
          insect.state = 'feeding';
          insect.cooldown = 180;
        }
        break;
      }
      case 'feeding': {
        if (insect.cooldown <= 0) {
          insect.state = 'wander';
          insect.targetId = -1;
        }
        break;
      }
      case 'seek-prey': {
        // joaninha patrulha e reduz a pressão de pragas do chunk
        const before = chunk.pestPressure ?? 0;
        if (before > 0) {
          chunk.pestPressure = Math.max(0, before - 0.02);
          insect.energy = clamp(insect.energy + 0.05, 0, 1);
          // pragas das plantas PRÓXIMAS caem (busca local, não no chunk inteiro)
          const nearby = findNearbyPlants(chunk, insect.x, insect.y, 2, opts.neighbors);
          for (const p of nearby) {
            const pheno = p.pheno;
            if (pheno) pheno.pests = clamp(pheno.pests - 0.02, 0, 1);
          }
        }
        moveToward(insect, insect.x + Math.cos(insect.phase) * 22, insect.y + Math.sin(insect.phase * 1.3) * 12);
        if (insect.cooldown <= 0) {
          insect.state = 'wander';
          insect.cooldown = 60;
        }
        break;
      }
    }
  }
}

function moveToward(insect: Insect, tx: number, ty: number): boolean {
  const dx = tx - insect.x;
  const dy = ty - insect.y;
  const d = Math.hypot(dx, dy);
  if (d < 6) return true;
  const step = Math.min(d, 14);
  insect.x += (dx / d) * step;
  insect.y += (dy / d) * step;
  return false;
}

/**
 * Procura local: varre apenas as células ao redor do inseto (raio em células),
 * usando o índice espacial existente (`plantsInCell`). Evita varrer todas as
 * plantas do chunk a cada passo — custo O(células), não O(plantas).
 */
/** acesso a chunks vizinhos (a fronteira do chunk não é parede para os insetos) */
export type ChunkLookup = (cellX: number, cellY: number) => Chunk | null;

function findPlant(
  chunk: Chunk,
  insect: Insect,
  ok: (p: PlantRecord) => boolean,
  neighbor?: ChunkLookup,
): PlantRecord | undefined {
  const cellPx = Math.max(1, chunk.tiles * 32 / chunk.n);
  const lx0 = Math.floor(insect.x / cellPx) - chunk.cx * chunk.n;
  const ly0 = Math.floor(insect.y / cellPx) - chunk.cy * chunk.n;
  const R = 3;
  let best: PlantRecord | undefined;
  let bestD = SEARCH_RADIUS * SEARCH_RADIUS;
  const consider = (owner: Chunk, lx: number, ly: number) => {
    for (const plant of owner.plantsInCell(lx, ly)) {
      if (owner.removedPlants.has(plant.id)) continue;
      if (!ok(plant)) continue;
      const d = (plant.x - insect.x) ** 2 + (plant.y - insect.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = plant;
      }
    }
  };
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      const wx = lx0 + ox;
      const wy = ly0 + oy;
      if (wx >= 0 && wy >= 0 && wx < chunk.n && wy < chunk.n) {
        consider(chunk, wx, wy);
        continue;
      }
      if (!neighbor) continue;
      const other = neighbor(chunk.cx * chunk.n + wx, chunk.cy * chunk.n + wy);
      if (!other || other === chunk) continue;
      const olx = chunk.cx * chunk.n + wx - other.cx * other.n;
      const oly = chunk.cy * chunk.n + wy - other.cy * other.n;
      if (olx < 0 || oly < 0 || olx >= other.n || oly >= other.n) continue;
      consider(other, olx, oly);
    }
  }
  return best;
}

/** plantas em um raio de células ao redor de (x, y) — busca local barata */
export function findNearbyPlants(
  chunk: Chunk,
  x: number,
  y: number,
  cells: number,
  neighbor?: ChunkLookup,
): PlantRecord[] {
  const cellPx = Math.max(1, (chunk.tiles * 32) / chunk.n);
  const lx0 = Math.floor(x / cellPx) - chunk.cx * chunk.n;
  const ly0 = Math.floor(y / cellPx) - chunk.cy * chunk.n;
  const out: PlantRecord[] = [];
  const push = (owner: Chunk, lx: number, ly: number) => {
    for (const p of owner.plantsInCell(lx, ly)) {
      if (!owner.removedPlants.has(p.id)) out.push(p);
    }
  };
  for (let oy = -cells; oy <= cells; oy++) {
    for (let ox = -cells; ox <= cells; ox++) {
      const wx = lx0 + ox;
      const wy = ly0 + oy;
      if (wx >= 0 && wy >= 0 && wx < chunk.n && wy < chunk.n) {
        push(chunk, wx, wy);
        continue;
      }
      if (!neighbor) continue;
      const other = neighbor(chunk.cx * chunk.n + wx, chunk.cy * chunk.n + wy);
      if (!other || other === chunk) continue;
      const olx = chunk.cx * chunk.n + wx - other.cx * other.n;
      const oly = chunk.cy * chunk.n + wy - other.cy * other.n;
      if (olx < 0 || oly < 0 || olx >= other.n || oly >= other.n) continue;
      push(other, olx, oly);
    }
  }
  return out;
}

/** acha a planta alvo em qualquer chunk carregado (a abelha cruza a fronteira) */
function plantByTarget(chunk: Chunk, id: number, neighbor?: ChunkLookup): PlantRecord | undefined {
  const here = plantRecordById(chunk, id);
  if (here) return here;
  if (!neighbor) return undefined;
  const cellPx = Math.max(1, (chunk.tiles * 32) / chunk.n);
  const cx = Math.floor(chunk.cx * chunk.n + chunk.n / 2);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const other = neighbor(
      Math.floor((cx + (dx * chunk.n) / 2)),
      Math.floor(chunk.cy * chunk.n + chunk.n / 2 + (dy * chunk.n) / 2),
    );
    if (!other || other === chunk) continue;
    const found = plantRecordById(other, id);
    if (found) return found;
  }
  void cellPx;
  return undefined;
}

/** chunk dono de uma planta (para gravar pragas/frutos no lugar certo) */
function chunkOfPlant(plant: PlantRecord, chunk: Chunk, neighbor?: ChunkLookup): Chunk | null {
  if (plantRecordById(chunk, plant.id)) return chunk;
  if (!neighbor) return null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const other = neighbor(
      Math.floor(chunk.cx * chunk.n + chunk.n / 2 + (dx * chunk.n)),
      Math.floor(chunk.cy * chunk.n + chunk.n / 2 + (dy * chunk.n)),
    );
    if (!other || other === chunk) continue;
    if (plantRecordById(other, plant.id)) return other;
  }
  return null;
}

/** atualiza os contadores de pragas/predadores do chunk (mapa por célula) */
export function updatePestPressure(chunk: Chunk, insects: Insect[]): void {
  const n = chunk.n;
  if (!chunk.predators) chunk.predators = new Float32Array(n * n);
  else chunk.predators.fill(0);
  const cellPx = 64; // simCellTiles * tileSize padrão; convertido no chamador se mudar
  for (const insect of insects) {
    if (insect.kind !== 'ladybug') continue;
    if (insect.chunk !== chunk) continue;
    const lx = clamp(Math.floor(insect.x / cellPx) - chunk.cx * n, 0, n - 1);
    const ly = clamp(Math.floor(insect.y / cellPx) - chunk.cy * n, 0, n - 1);
    chunk.predators[chunk.cellIdx(lx, ly)] = Math.min(1, chunk.predators[chunk.cellIdx(lx, ly)] + 0.35);
  }
  // a pressão de pragas decai onde há predador
  chunk.pestPressure = clamp((chunk.pestPressure ?? 0) * 0.85, 0, 1);
}
