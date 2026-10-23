/**
 * Fauna: pontos de integração bem definidos + um processo real e pequeno.
 *
 * O pacote gráfico não possui sprites de animais, então não inventamos fauna
 * visual falsa. O que existe de fato:
 *  - um modelo determinístico de atividade de fauna (aves/frugívoros) por
 *    célula, derivado de recursos reais (frutas/copas, água, abrigo, hora do
 *    dia e estação);
 *  - esse modelo alimenta a dispersão de sementes (zoocoria) no recrutamento,
 *    ou seja, a fauna já altera o mundo de verdade;
 *  - interfaces (`FaunaAgent`, `FaunaSystem`) prontas para agentes visuais
 *    futuros (alimentação, reprodução, migração, carcaças, fezes).
 */
import type { Chunk } from './chunk';
import type { Insect } from './ecosystem';
import type { WorldConfig } from '../core/config';
import { clamp, hash2 } from '../core/rng';
import { canopyCoverAt } from './ecology';

export interface FaunaAgent {
  id: number;
  species: string;
  x: number;
  y: number;
  /** necessidades: alimento, água, abrigo */
  hunger: number;
  thirst: number;
  active: boolean;
  diurnal: boolean;
}

export interface FaunaSystem {
  /** agentes presentes num chunk (podem ser renderizados no futuro) */
  agents(chunk: Chunk): FaunaAgent[];
  /** passo de simulação (movimento, alimentação, reprodução...) */
  step(chunk: Chunk, hours: number, worldDay: number, hour: number): void;
}

/**
 * Atividade de fauna 0..1 numa célula: precisa de alimento (copa/frutas),
 * água por perto e abrigo; varia com hora (diurno/noturno) e estação.
 */
export function faunaActivity(
  chunk: Chunk,
  cfg: WorldConfig,
  lx: number,
  ly: number,
  worldDay: number,
  hour: number,
): number {
  void cfg;
  const cover = canopyCoverAt(chunk, cfg, lx, ly, worldDay);
  const i = chunk.cellIdx(lx, ly);
  const water = chunk.waterDepth[i] > 0.05 || chunk.moisture[i] > 0.45 ? 1 : 0.3;
  const diurnal = clamp(Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.5 + 0.6, 0.15, 1);
  const seasonFactor = 0.6 + 0.4 * clamp(1 - Math.abs(((worldDay % 28) / 28) * 4 - 1.5) / 2, 0, 1);
  const site = hash2(911, chunk.cx * 100 + lx, chunk.cy * 100 + ly, 401);
  return clamp(cover * 0.7 + 0.3, 0, 1) * water * diurnal * seasonFactor * (0.5 + 0.5 * site);
}

/** bônus de dispersão de sementes por zoocoria (usa atividade de fauna) */
export function animalDispersalBonus(
  chunk: Chunk,
  cfg: WorldConfig,
  lx: number,
  ly: number,
  worldDay: number,
  hour: number,
): number {
  return faunaActivity(chunk, cfg, lx, ly, worldDay, hour) * 0.6;
}

/**
 * Implementação mínima de referência do sistema de fauna: sem agentes
 * visuais, apenas registra que a interface existe e é utilizável.
 * Quando houver sprites de animais, basta implementar `agents`/`step`.
 */
export class NullFauna implements FaunaSystem {
  agents(_chunk: Chunk): FaunaAgent[] {
    return [];
  }
  step(_chunk: Chunk, _hours: number, _worldDay: number, _hour: number): void {
    /* sem agentes visuais nesta versão — ver docs/ARQUITETURA.md */
  }
}

// ===========================================================================
// Fauna visual: coelho, sapo e ave pequena
// ===========================================================================
//
// Os agentes são leves e determinísticos: nascem de uma seed por chunk, andam
// por estados simples (idle/wander/seek/eat/flee/rest) e usam os dados que o
// mundo JÁ produz (umidade, profundidade de água, copa, frutos no chão, insetos,
// hora e estação). Nada de pathfinding: o movimento é local, com colisão leve
// contra água profunda (coelho/ave não entram) e contra a margem (sapo prefere
// a água).
//
// Performance: só existem agentes perto do jogador (pool por chunk, sem save) e
// a população distante continua sendo representada pelo modelo abstrato
// `faunaActivity` acima (que já alimenta a zoocoria).

export type FaunaKind = 'rabbit' | 'frog' | 'bird';

export type FaunaAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'eat'
  | 'sleep'
  | 'fly'
  | 'land'
  | 'swim';

/** intenção do agente (traduzida em animação no render) */
export type FaunaState =
  | 'idle'
  | 'wander'
  | 'seek_food'
  | 'eat'
  | 'flee'
  | 'rest'
  | 'sleep'
  | 'seek_water'
  | 'swim'
  | 'fly'
  | 'land';

export interface FaunaAgentView {
  id: number;
  kind: FaunaKind;
  x: number;
  y: number;
  state: FaunaState;
  anim: FaunaAnim;
  frame: number;
  facing: 1 | -1;
  /** espaço acima do chão (voo da ave) em px */
  hover: number;
  /** escala visual 1 = tamanho nativo do spritesheet */
  scale: number;
  /** true quando o jogador está perto o bastante para detalhar */
  detailed: boolean;
}

export interface Animal {
  id: number;
  kind: FaunaKind;
  /** chunk dono (o agente nasce e pertence a ele) */
  chunk: Chunk;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: FaunaState;
  /** tempo no estado atual (h de jogo) */
  timer: number;
  facing: 1 | -1;
  /** fase da animação (segundos de jogo acumulados andando) */
  animPhase: number;
  /** 0..1 — fome/sede acumuladas (barato: só alimenta a escolha de estado) */
  hunger: number;
  /** energia: cai voando/correndo, sobe comendo/descansando */
  energy: number;
  /** alvo atual (px) */
  tx: number;
  ty: number;
  /** variação individual determinística 0..1 */
  quirk: number;
  /** altura de voo da ave (px) */
  hover: number;
}

/** traços por espécie: habitat, velocidade, raio de ação e rotina */
interface FaunaTraits {
  kind: FaunaKind;
  /** fracção de presença em cada habitat (0..1) */
  speed: number;
  /** raio de caminhada por passo de simulação (px) */
  step: number;
  /** raio de busca de comida/água (células) */
  searchCells: number;
  /** diurno? (sapo é mais ativo à noite) */
  diurnal: boolean;
  /** precisa de água por perto? */
  needsWater: boolean;
  /** evita água funda? (coelho não nada; sapo nada) */
  avoidsDeepWater: boolean;
  /** voa? (ave) */
  flying: boolean;
}

export const FAUNA_TRAITS: Record<FaunaKind, FaunaTraits> = {
  rabbit: {
    kind: 'rabbit', speed: 26, step: 9, searchCells: 2, diurnal: true,
    needsWater: false, avoidsDeepWater: true, flying: false,
  },
  frog: {
    kind: 'frog', speed: 14, step: 6, searchCells: 2, diurnal: false,
    needsWater: true, avoidsDeepWater: false, flying: false,
  },
  bird: {
    kind: 'bird', speed: 34, step: 12, searchCells: 3, diurnal: true,
    needsWater: false, avoidsDeepWater: true, flying: true,
  },
};

/** tetos por chunk (mobile-first) */
export const FAUNA_CAP: Record<FaunaKind, number> = { rabbit: 3, frog: 3, bird: 2 };

const CELL_PX_STD = 64;

function cellPxOf(cfg: WorldConfig): number {
  return cfg.simCellTiles * cfg.tileSize;
}

/** amostra barata do ambiente na posição do agente */
interface Spot {
  water: number;
  moisture: number;
  canopy: number;
  fruits: number;
  insects: number;
  /** existe córrego/lago por perto? */
  nearWater: boolean;
}

function spotAt(chunk: Chunk, cfg: WorldConfig, x: number, y: number, worldDay: number): Spot {
  const cellPx = cellPxOf(cfg);
  const lx = clamp(Math.floor(x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly = clamp(Math.floor(y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
  const i = chunk.cellIdx(lx, ly);
  let nearWater = chunk.waterDepth[i] > 0.05;
  if (!nearWater) {
    for (let d = 0; d < 4 && !nearWater; d++) {
      const nx = lx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = ly + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= chunk.n || ny >= chunk.n) continue;
      if (chunk.waterDepth[chunk.cellIdx(nx, ny)] > 0.05) nearWater = true;
    }
  }
  // insetos próximos: usa o pool do mundo via lista injetada no chunk
  let insects = 0;
  const nearby = chunk.localInsects;
  if (nearby) {
    const r2 = (cellPx * 2) ** 2;
    for (const ins of nearby) {
      const dx = ins.x - x;
      const dy = ins.y - y;
      if (dx * dx + dy * dy <= r2) insects++;
    }
  }
  const fruitNear = chunk.groundFruits.some((g) => Math.abs(g.x - x) < cellPx * 2 && Math.abs(g.y - y) < cellPx * 2);
  return {
    water: chunk.waterDepth[i],
    moisture: chunk.moisture[i],
    canopy: canopyCoverAt(chunk, cfg, lx, ly, worldDay),
    fruits: fruitNear ? 1 : 0,
    insects,
    nearWater,
  };
}

/**
 * Nasce a fauna de um chunk de forma determinística: a mesma seed + a mesma
 * vegetação/água produzem os mesmos animais, nas mesmas posições.
 */
export function seedFauna(
  chunk: Chunk,
  cfg: WorldConfig,
  worldDay: number,
  hour: number,
  localInsects: Insect[] = [],
): Animal[] {
  const out: Animal[] = [];
  const cellPx = cellPxOf(cfg);
  const night = hour < 6 || hour > 19;
  const n = chunk.n;
  let waterCells = 0;
  let treeCells = 0;
  let grassy = 0;
  for (let i = 0; i < n * n; i++) {
    if (chunk.waterDepth[i] > 0.05) waterCells++;
    if (chunk.moisture[i] > 0.35) grassy++;
  }
  for (const plant of chunk.livePlants()) {
    const lx = clamp(Math.floor(plant.x / cellPx) - chunk.cx * n, 0, n - 1);
    const ly = clamp(Math.floor(plant.y / cellPx) - chunk.cy * n, 0, n - 1);
    if (chunk.waterDepth[chunk.cellIdx(lx, ly)] <= 0.05) treeCells++;
  }
  const total = n * n;

  // densidades determinísticas: habitat define quantos animais aparecem
  const wetShare = waterCells / total;
  const treeShare = treeCells / total;
  const grassShare = grassy / total;
  const fruitShare = chunk.groundFruits.length > 0 ? 1 : 0;

  const place = (kind: FaunaKind, count: number) => {
    for (let k = 0; k < count; k++) {
      // posição por rejeição: respeita o habitat da espécie
      let x = 0;
      let y = 0;
      let ok = false;
      for (let attempt = 0; attempt < 24 && !ok; attempt++) {
        const h1 = hash2(cfg.seed ^ 0x2f1a, chunk.cx * 31 + k, chunk.cy * 17 + attempt, 701);
        const h2 = hash2(cfg.seed ^ 0x2f1a, chunk.cx * 7 + k, chunk.cy * 29 + attempt, 702);
        x = (chunk.cx * n + h1 * n) * cellPx;
        y = (chunk.cy * n + h2 * n) * cellPx;
        const spot = spotAt(chunk, cfg, x, y, worldDay);
        if (kind === 'frog') ok = spot.nearWater || spot.water > 0.02 || spot.moisture > 0.6;
        else if (kind === 'bird') ok = spot.canopy > 0.15 || treeShare > 0.05;
        else ok = spot.water < 0.2 && (spot.canopy > 0.05 || spot.moisture > 0.25 || grassShare > 0.15);
      }
      const quirk = hash2(cfg.seed ^ 0x51b3, chunk.cx * 13 + k, chunk.cy * 11 + kind.length, 703);
      // id estável por (chunk, espécie, índice) — inclui a ESPÉCIE e o canal no
      // hash para que sapo e ave nunca compartilhem id
      const kindIndex = out.filter((a) => a.kind === kind).length;
      const kindCode = kind === 'rabbit' ? 1 : kind === 'frog' ? 2 : 3;
      out.push({
        id: Math.floor(
          hash2(
            cfg.seed ^ (0x77c1 + kindCode * 977),
            chunk.cx * 101 + k + kindCode * 10007,
            chunk.cy * 61 + kindIndex + kindCode * 10009,
            704 + kindCode,
          ) * 0x7fffffff,
        ),
        kind,
        chunk,
        x,
        y,
        vx: 0,
        vy: 0,
        state: night && !FAUNA_TRAITS[kind].diurnal ? 'wander' : 'idle',
        timer: 0,
        facing: quirk > 0.5 ? 1 : -1,
        animPhase: quirk * 4,
        hunger: 0.3 + quirk * 0.3,
        energy: 0.6 + quirk * 0.4,
        tx: x,
        ty: y,
        quirk,
        hover: 0,
      });
    }
  };

  // coelho: vegetação rasteira/arbustos + alimento; evita água funda.
  // A cobertura vegetal do mundo é alta, então o fator é moderado.
  const vegShare = clamp(treeCells / total, 0, 1);
  const rabbitTarget = Math.round(FAUNA_CAP.rabbit * clamp(vegShare * 0.8 + grassShare * 0.6 + fruitShare * 0.3, 0, 1));
  // sapo: água + umidade (nunca longe da margem); precisa de lagoa/córrego
  const frogTarget = Math.round(FAUNA_CAP.frog * clamp(wetShare * 8, 0, 1));
  // ave: árvores + alimento (frutos no chão/insetos)
  const birdTarget = Math.round(FAUNA_CAP.bird * clamp(treeShare * 0.9 + localInsects.length * 0.06, 0, 1));
  place('rabbit', rabbitTarget);
  place('frog', frogTarget);
  place('bird', birdTarget);
  return out;
}

export interface FaunaStepOptions {
  worldDay: number;
  hour: number;
  /** posição do jogador em px (para reação de fuga) */
  playerX?: number;
  playerY?: number;
  /** chunks vizinhos para travessia de fronteira */
  neighbor?: (cellX: number, cellY: number) => Chunk | null;
}

/** mapeia estado → animação disponível no spritesheet da espécie */
export function animFor(kind: FaunaKind, state: FaunaState, moving: boolean, inWater: boolean): FaunaAnim {
  if (kind === 'frog') {
    if (inWater) return 'swim';
    if (state === 'eat') return 'eat';
    if (state === 'sleep' || state === 'rest') return 'sleep';
    if (state === 'flee' || state === 'wander') return moving ? 'jump' : 'idle';
    return 'idle';
  }
  if (kind === 'bird') {
    if (state === 'fly') return 'fly';
    if (state === 'land') return 'land';
    if (state === 'eat') return 'eat';
    if (state === 'sleep' || state === 'rest') return 'sleep';
    return 'idle';
  }
  if (state === 'eat') return 'eat';
  if (state === 'sleep' || state === 'rest') return 'sleep';
  if (state === 'flee') return 'run';
  if (state === 'wander' || state === 'seek_food' || state === 'seek_water') return moving ? 'walk' : 'idle';
  return 'idle';
}

function chooseTarget(animal: Animal, cfg: WorldConfig, opts: FaunaStepOptions): void {
  const traits = FAUNA_TRAITS[animal.kind];
  const chunk = animal.chunk;
  const cellPx = cellPxOf(cfg);
  const reach = traits.searchCells * cellPx;
  const spot = spotAt(chunk, cfg, animal.x, animal.y, opts.worldDay);
  const h = (k: number) => hash2(cfg.seed ^ 0x9e3d, animal.id % 100000, Math.floor(opts.worldDay * 24) + k, 705);

  // prioridade: fugir > comer > beber/entrar na água > vaguear
  let target: { x: number; y: number; state: FaunaState } | null = null;
  if (animal.kind === 'frog' && !spot.nearWater) {
    // procura água na vizinhança
    const best = nearestWater(chunk, cfg, animal.x, animal.y);
    if (best) target = { ...best, state: 'seek_water' };
  }
  if (!target) {
    const fruit = nearestFood(chunk, animal.x, animal.y, reach);
    if (fruit) target = { ...fruit, state: 'seek_food' };
  }
  if (!target) {
    const a = h(1) * Math.PI * 2;
    const d = 12 + h(2) * reach;
    target = {
      x: clamp(animal.x + Math.cos(a) * d, chunk.cx * chunk.n * cellPx, (chunk.cx + 1) * chunk.n * cellPx - 1),
      y: clamp(animal.y + Math.sin(a) * d * 0.7, chunk.cy * chunk.n * cellPx, (chunk.cy + 1) * chunk.n * cellPx - 1),
      state: 'wander',
    };
  }
  animal.tx = target.x;
  animal.ty = target.y;
  animal.state = target.state;
}

/** água mais próxima (busca local por célula molhada) */
function nearestWater(chunk: Chunk, cfg: WorldConfig, x: number, y: number): { x: number; y: number } | null {
  const cellPx = cellPxOf(cfg);
  const lx0 = clamp(Math.floor(x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly0 = clamp(Math.floor(y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= 3 && !best; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = lx0 + ox;
        const ny = ly0 + oy;
        if (nx < 0 || ny < 0 || nx >= chunk.n || ny >= chunk.n) continue;
        if (chunk.waterDepth[chunk.cellIdx(nx, ny)] <= 0.05) continue;
        const wx = (chunk.cx * chunk.n + nx + 0.5) * cellPx;
        const wy = (chunk.cy * chunk.n + ny + 0.5) * cellPx;
        const d = (wx - x) ** 2 + (wy - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: wx, y: wy };
        }
      }
    }
  }
  return best;
}

/** fruto no chão mais próximo dentro do raio */
function nearestFood(chunk: Chunk, x: number, y: number, reach: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = reach * reach;
  for (const gf of chunk.groundFruits) {
    const d = (gf.x - x) ** 2 + (gf.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: gf.x, y: gf.y };
    }
  }
  return best;
}

/**
 * Passo da fauna visual: estados simples, movimento local e reação ao ambiente.
 * `hours` é o intervalo de jogo coberto (a chamada usa passos curtos).
 */
export function stepFauna(animals: Animal[], cfg: WorldConfig, hours: number, opts: FaunaStepOptions): void {
  const h = Math.max(0.001, hours);
  const cellPx = cellPxOf(cfg);
  for (const animal of animals) {
    const traits = FAUNA_TRAITS[animal.kind];
    const chunk = animal.chunk;
    animal.timer += h;
    animal.hunger = clamp(animal.hunger + h * 0.05, 0, 1);
    animal.energy = clamp(animal.energy - h * 0.02, 0, 1);

    // --- noite: dorme (sapo é o contrário) ---------------------------------
    const night = opts.hour < 6 || opts.hour > 19;
    const asleep = traits.diurnal ? night : false;
    if (asleep && animal.state !== 'sleep') {
      animal.state = 'sleep';
      animal.timer = 0;
    }
    if (!asleep && animal.state === 'sleep') {
      animal.state = 'idle';
      animal.timer = 0;
    }

    // --- fuga do jogador (só perturba se estiver perto) --------------------
    if (opts.playerX !== undefined && opts.playerY !== undefined && animal.state !== 'sleep') {
      const dx = animal.x - opts.playerX;
      const dy = animal.y - opts.playerY;
      const d2 = dx * dx + dy * dy;
      if (d2 < 70 * 70) {
        const d = Math.sqrt(d2) || 1;
        animal.state = 'flee';
        animal.timer = 0;
        animal.tx = animal.x + (dx / d) * 60;
        animal.ty = animal.y + (dy / d) * 60;
      }
    }

    // --- escolha de alvo ---------------------------------------------------
    if (animal.state === 'idle' && animal.timer > 1.2 + animal.quirk * 2) {
      chooseTarget(animal, cfg, opts);
      animal.timer = 0;
    } else if (animal.state === 'seek_food' || animal.state === 'seek_water') {
      const arrived = Math.hypot(animal.tx - animal.x, animal.ty - animal.y) < 10;
      if (arrived) {
        animal.state = animal.state === 'seek_water' ? 'swim' : 'eat';
        animal.timer = 0;
      }
    } else if (animal.state === 'eat' || animal.state === 'swim') {
      animal.energy = clamp(animal.energy + h * 0.35, 0, 1);
      animal.hunger = clamp(animal.hunger - h * 0.6, 0, 1);
      if (animal.timer > 2.5) {
        animal.state = 'idle';
        animal.timer = 0;
      }
    } else if (animal.state === 'flee' && animal.timer > 1.6) {
      animal.state = 'idle';
      animal.timer = 0;
    }

    // --- movimento ---------------------------------------------------------
    const moving = animal.state === 'wander' || animal.state === 'seek_food' || animal.state === 'seek_water' || animal.state === 'flee';
    if (moving) {
      const speed = traits.speed * (animal.state === 'flee' ? 2.1 : 1) * (0.6 + animal.energy * 0.6);
      const dx = animal.tx - animal.x;
      const dy = animal.ty - animal.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed * 0.6; // perspectiva: desloca menos em Y
        // colisão leve: não entra em água funda (coelho/ave) nem em terra seca (sapo)
        const nextX = animal.x + vx * h;
        const nextY = animal.y + vy * h;
        const spot = spotAt(chunk, cfg, nextX, nextY, opts.worldDay);
        const blocked =
          (traits.avoidsDeepWater && spot.water > 0.35) ||
          (animal.kind === 'frog' && !spot.nearWater && animal.state !== 'seek_water' && spot.water < 0.02);
        if (!blocked) {
          animal.x = nextX;
          animal.y = nextY;
        } else if (animal.kind === 'rabbit' || animal.kind === 'bird') {
          animal.tx = animal.x - dx * 0.5;
          animal.ty = animal.y - dy * 0.5;
        }
        animal.vx = vx;
        animal.vy = vy;
        animal.facing = vx >= 0 ? 1 : -1;
        animal.animPhase += h * (animal.state === 'flee' ? 10 : 5);
      } else {
        animal.state = 'idle';
        animal.timer = 0;
      }
    } else {
      animal.vx = 0;
      animal.vy = 0;
    }

    // --- ave: voo com altura ----------------------------------------------
    if (animal.kind === 'bird') {
      const wantsFly = animal.state === 'idle' && animal.timer > 4 && animal.quirk > 0.45 && animal.energy > 0.3;
      if (wantsFly) {
        animal.state = 'fly';
        animal.timer = 0;
        animal.tx = clamp(animal.x + (animal.quirk - 0.5) * 140, chunk.cx * chunk.n * cellPx, (chunk.cx + 1) * chunk.n * cellPx - 1);
        animal.ty = clamp(animal.y + (0.5 - animal.quirk) * 90, chunk.cy * chunk.n * cellPx, (chunk.cy + 1) * chunk.n * cellPx - 1);
      }
      if (animal.state === 'fly') {
        const dx = animal.tx - animal.x;
        const dy = animal.ty - animal.y;
        const d = Math.hypot(dx, dy);
        const speed = traits.speed * 1.6;
        if (d > 4) {
          animal.x += (dx / d) * speed * h;
          animal.y += (dy / d) * speed * h;
          animal.facing = dx >= 0 ? 1 : -1;
          animal.animPhase += h * 14;
          animal.hover = 10 + Math.sin(animal.animPhase * 0.6) * 2;
        } else {
          animal.state = 'land';
          animal.timer = 0;
          animal.hover = 0;
        }
      } else if (animal.state === 'land') {
        if (animal.timer > 0.6) {
          animal.state = 'idle';
          animal.timer = 0;
        }
      } else {
        animal.hover = 0;
      }
    }

    // manter o agente na área do chunk dono (a travessia é feita pelo mundo,
    // que transfere o agente quando ele cruza a fronteira)
    const minX = chunk.cx * chunk.n * cellPx + 2;
    const maxX = (chunk.cx + 1) * chunk.n * cellPx - 2;
    const minY = chunk.cy * chunk.n * cellPx + 2;
    const maxY = (chunk.cy + 1) * chunk.n * cellPx - 2;
    animal.x = clamp(animal.x, minX, maxX);
    animal.y = clamp(animal.y, minY, maxY);
  }
}

/** quadro de animação (0..frames-1) para o tempo corrente */
export function animFrame(animal: Animal, anim: FaunaAnim, frames: number, timeMs: number): number {
  if (frames <= 0) return 0;
  if (anim === 'idle' || anim === 'sleep') {
    return Math.floor((timeMs / (anim === 'sleep' ? 700 : 420) + animal.quirk * 4) % frames);
  }
  return Math.floor(animal.animPhase % frames);
}

/** view pronta para o render (sem expor o agente mutável) */
export function agentView(animal: Animal, timeMs: number, framesFor: (a: FaunaAnim) => number): FaunaAgentView {
  const spot = { water: animal.chunk.waterDepth[
    animal.chunk.cellIdx(
      clamp(Math.floor(animal.x / CELL_PX_STD) - animal.chunk.cx * animal.chunk.n, 0, animal.chunk.n - 1),
      clamp(Math.floor(animal.y / CELL_PX_STD) - animal.chunk.cy * animal.chunk.n, 0, animal.chunk.n - 1),
    )
  ] ?? 0 };
  const moving = Math.hypot(animal.vx, animal.vy) > 1;
  const anim = animFor(animal.kind, animal.state, moving, spot.water > 0.25);
  return {
    id: animal.id,
    kind: animal.kind,
    x: animal.x,
    y: animal.y,
    state: animal.state,
    anim,
    frame: animFrame(animal, anim, framesFor(anim), timeMs),
    facing: animal.facing,
    hover: animal.hover,
    scale: 1,
    detailed: true,
  };
}
