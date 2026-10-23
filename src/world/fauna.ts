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

export type FaunaKind = 'rabbit' | 'frog' | 'bird' | 'snake';

export type FaunaAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'eat'
  | 'sleep'
  | 'fly'
  | 'land'
  | 'swim'
  // cobra: intenções do spritesheet fornecido
  | 'move'
  | 'attack'
  | 'hide'
  | 'hurt'
  | 'death';

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
  | 'land'
  // predador (cobra) e estados compartilhados de IA
  | 'hunt'
  | 'chase'
  | 'attack'
  | 'hide'
  | 'dead';

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
  /** 0..1 — fome acumulada (1 = faminto) */
  hunger: number;
  /** 0..1 — sede acumulada (1 = com muita sede) */
  thirst: number;
  /** 0..1 — saúde; cai com fome/sede extremas e leva à morte */
  health: number;
  /** horas até defecar (fezes devolvem matéria orgânica ao solo) */
  poopTimer: number;
  /** semente ingerida ao comer um fruto (dispersão por zoocoria) */
  carriedSeed: { species: number; vigor: number } | null;
  /** energia: cai voando/correndo, sobe comendo/descansando */
  energy: number;
  /** alvo atual (px) */
  tx: number;
  ty: number;
  /** variação individual determinística 0..1 */
  quirk: number;
  /** altura de voo da ave (px) */
  hover: number;

  // --- IA comportamental (percepção → necessidades → memória → decisão) ---
  /**
   * Memória curta e barata: último alvo/presa e o instante (h de jogo) em que
   * foi visto. Depois de `MEMORY_HOURS` a lembrança expira e o animal volta a
   * explorar em vez de "esquecer" instantaneamente.
   */
  memory?: {
    /** id da criatura lembrada (presa ou ameaça) */
    targetId: number;
    /** posição lembrada */
    x: number;
    y: number;
    /** hora de jogo da última percepção */
    hour: number;
    /** 'prey' = presa perseguida; 'threat' = perigo a evitar */
    kind: 'prey' | 'threat';
  };
  /** duração da perseguição atual (h de jogo) — evita caçar para sempre */
  chaseHours?: number;
  /** 0..1 — medo (sobe com ameaça, cai com o tempo) */
  fear?: number;
  /** horas de jogo restantes até poder dar outro bote */
  strikeCooldown?: number;
  /** evita aplicar dano duas vezes no mesmo bote */
  struckThisLunge?: boolean;
  /** 0..1 atividade do horário (curva da espécie), atualizada a cada passo */
  activity?: number;
  /**
   * horas de jogo restantes de reação à dor. Não é um estado novo: enquanto
   * `hurtTimer > 0` o render usa a linha de dor da espécie (cobra) ou um
   * sobressalto curto (coelho/sapo pulam, ave bate asas) — ver `animFor`.
   */
  hurtTimer?: number;
  /**
   * idade da carcaça (h de jogo) quando `state === 'dead'`. O animal morto
   * continua no mundo, imóvel, até `CORPSE_HOURS`, e só então vira solo.
   */
  corpseHours?: number;
}

/** cria um agente com todos os campos (usado no spawn e em testes/tools) */
export function makeAnimal(partial: Pick<Animal, 'id' | 'kind' | 'chunk' | 'x' | 'y'> & Partial<Animal>): Animal {
  const quirk = partial.quirk ?? 0.5;
  return {
    vx: 0,
    vy: 0,
    state: 'idle',
    timer: 0,
    facing: 1,
    animPhase: quirk * 4,
    hunger: 0.3 + quirk * 0.3,
    thirst: 0.2 + quirk * 0.25,
    health: 1,
    poopTimer: 2 + quirk * 3,
    carriedSeed: null,
    energy: 0.6 + quirk * 0.4,
    tx: partial.x,
    ty: partial.y,
    hover: 0,
    strikeCooldown: 0,
    struckThisLunge: false,
    hurtTimer: 0,
    corpseHours: 0,
    quirk,
    ...partial,
  };
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
  /** predador: espécies que caça (vazio = herbívoro/onívoro) */
  prey?: FaunaKind[];
  /** alcance do ataque (px) — só ataca dentro disso */
  attackRange?: number;
  /** dano por ataque (pontos de saúde) */
  attackDamage?: number;
  /** alcance da percepção de presas (px) */
  huntRange?: number;
}

export const FAUNA_TRAITS: Record<FaunaKind, FaunaTraits> = {
  rabbit: {
    kind: 'rabbit', speed: 62, step: 9, searchCells: 2, diurnal: true,
    needsWater: false, avoidsDeepWater: true, flying: false,
  },
  frog: {
    kind: 'frog', speed: 40, step: 6, searchCells: 2, diurnal: false,
    needsWater: true, avoidsDeepWater: false, flying: false,
  },
  bird: {
    kind: 'bird', speed: 95, step: 12, searchCells: 3, diurnal: true,
    needsWater: false, avoidsDeepWater: true, flying: true,
  },
  snake: {
    // predador de emboscada: base lenta, mas com arranque (bote) na perseguição
    kind: 'snake', speed: 40, step: 7, searchCells: 3, diurnal: false,
    needsWater: false, avoidsDeepWater: true, flying: false,
    // cadeia alimentar: sapo é a presa preferida; coelho/ave são oportunistas
    prey: ['frog', 'rabbit', 'bird'],
    attackRange: 18,
    attackDamage: 0.6,
    huntRange: 190,
  },
};

/** tetos por chunk (mobile-first) */
export const FAUNA_CAP: Record<FaunaKind, number> = { rabbit: 3, frog: 3, bird: 2, snake: 1 };

/**
 * Curva de atividade 0..1 por espécie e hora do dia (0..24).
 *
 * Não é "de dia acorda / de noite dorme": cada espécie tem o seu pico, o que
 * muda velocidade, disposição para caçar/comer e chance de ficar escondida.
 * Crepúsculo usa uma rampa suave (sem degrau em 6 h / 19 h).
 */
export function activityAt(kind: FaunaKind, hour: number): number {
  const t = ((hour % 24) + 24) % 24;
  // janelas em forma de "sino" (cosseno) para cada rotina
  const bell = (center: number, width: number): number => {
    let d = Math.abs(t - center);
    if (d > 12) d = 24 - d; // distância circular
    return clamp(1 - d / width, 0, 1);
  };
  switch (kind) {
    case 'rabbit': {
      // manhã e tarde altas, noite baixa (mas não zero: coelho sai para comer)
      const day = bell(10, 7) * 0.9 + bell(16, 6) * 0.75;
      return clamp(0.12 + day * 0.85, 0.08, 1);
    }
    case 'bird': {
      // pico no amanhecer, alto de tarde, quase nulo à noite
      const morning = bell(7, 4) * 1.0;
      const afternoon = bell(15, 7) * 0.8;
      return clamp(0.05 + Math.max(morning, afternoon) * 0.95, 0.02, 1);
    }
    case 'frog': {
      // baixo de dia, alto no crepúsculo, altíssimo à noite
      const dusk = bell(18.5, 4) * 0.85;
      const night = bell(0, 8) * 1.0;
      return clamp(0.12 + Math.max(dusk, night) * 0.9, 0.08, 1);
    }
    case 'snake': {
      // caça no crepúsculo/amanhecer; moderada à noite; descansa no meio do dia
      const dawn = bell(6, 3.5) * 1.0;
      const dusk = bell(19, 4) * 1.0;
      const night = bell(1, 7) * 0.55;
      const midDay = bell(13, 3) * 0.12;
      return clamp(0.10 + Math.max(dawn, dusk, night, midDay), 0.06, 1);
    }
  }
}

/** memória curta: horas de jogo até a lembrança de presa/ameaça expirar */
export const MEMORY_HOURS = 1.2;
/** tempo máximo de perseguição antes de desistir (h de jogo) */
export const MAX_CHASE_HOURS = 1.5;
/** janela do bote (h de jogo): o estado 'attack' dura isto, um bote só */
export const STRIKE_WINDOW_HOURS = 0.08;
/** descanso entre botes (h de jogo) — um ataque por bote, nunca por tick */
export const ATTACK_COOLDOWN_HOURS = 0.22;
/** duração da reação de dor (h de jogo) — animação/flash curto, não um estado */
export const HURT_HOURS = 0.05;
/**
 * Quanto tempo a carcaça permanece no mundo (h de jogo). 1 h de jogo = 60 s
 * reais, então o corpo fica ~1 min visível: dá tempo de ver que o animal parou
 * de se mover e começa a se decompor, sem virar lixo permanente no chunk.
 */
export const CORPSE_HOURS = 1.0;
/** a partir daqui a carcaça já está em decomposição (restos → solo) */
export const CORPSE_DECAY_HOURS = 0.45;

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
      const kindCode = kind === 'rabbit' ? 1 : kind === 'frog' ? 2 : kind === 'bird' ? 3 : 4;
      out.push(
        makeAnimal({
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
          state: night && !FAUNA_TRAITS[kind].diurnal ? 'wander' : 'idle',
          facing: quirk > 0.5 ? 1 : -1,
          quirk,
        }),
      );
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

  // --- cobra: predador depende de PRESAS (sapo/coelho/ave) e de abrigo -----
  const preyHere = out.length;
  const snakeTarget = Math.round(
    FAUNA_CAP.snake * clamp(preyHere / 4 + vegShare * 0.25 + wetShare * 0.3, 0, 1) * (preyHere >= 2 ? 1 : 0.4),
  );
  place('snake', snakeTarget);
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
  /**
   * Consumo REAL de recursos do mundo: a fauna não come "comida invisível".
   * O mundo remove o inseto do pool / o fruto do chão e devolve o que comeu.
   */
  consumeInsect?: (chunk: Chunk, x: number, y: number, radius: number) => boolean;
  consumeFruit?: (chunk: Chunk, x: number, y: number, radius: number) => { species: number } | null;
  /** registra uma morte (o mundo remove o agente e devolve matéria orgânica) */
  onDeath?: (animal: Animal) => void;
  /**
   * Percepção de criaturas: devolve os animais próximos (mesma pool do mundo).
   * Usada para predador ver presa e presa ver predador — sem varrer o mapa.
   */
  nearbyAnimals?: (animal: Animal, radius: number) => Animal[];
  /** aplica dano a uma presa (o mundo é dono da saúde e da morte) */
  damageAnimal?: (prey: Animal, amount: number) => void;
}

/**
 * Mapeia estado → animação disponível no spritesheet da espécie.
 *
 * Regra: NUNCA inventar quadro. Se a folha não tem uma animação específica
 * (peek/approach/retreat da cobra, morte do coelho/sapo/ave), o comportamento
 * usa a linha existente mais próxima — a IA continua a mesma.
 *
 * `hurt` é um sinal curto (`hurtTimer`), não um estado: a dor não interrompe a
 * decisão, só troca a pose por alguns segundos.
 */
export function animFor(
  kind: FaunaKind,
  state: FaunaState,
  moving: boolean,
  inWater: boolean,
  hurt = false,
): FaunaAnim {
  // dor: sinal curto de reação (não é estado). A cobra tem linha própria;
  // coelho/sapo dão um sobressalto e a ave bate asas — animações que existem.
  if (hurt) return kind === 'snake' ? 'hurt' : kind === 'bird' ? 'fly' : 'jump';
  if (kind === 'snake') {
    // só as animações que existem na folha fornecida (idle/move/attack/hide/
    // hurt/death/sleep) — nunca inventar frame
    switch (state) {
      case 'dead':
        return 'death';
      case 'attack':
        return 'attack';
      case 'hide':
      case 'rest':
        return 'hide';
      case 'sleep':
        return 'sleep';
      case 'hunt':
        // emboscada: parada na toca = enrolada (hide); deslocando = move
        return moving ? 'move' : 'hide';
      case 'flee':
      case 'wander':
      case 'seek_food':
      case 'seek_water':
      case 'chase':
        return moving ? 'move' : 'idle';
      default:
        return 'idle';
    }
  }
  // morto: as folhas de coelho/sapo/ave não têm linha de morte; a carcaça usa
  // a pose de repouso CONGELADA (sem quadro de respiração) e o render aplica
  // a marca de decomposição — ver `emitAnimal`.
  if (state === 'dead') return 'sleep';
  if (kind === 'frog') {
    if (inWater) return 'swim';
    if (state === 'eat') return 'eat';
    if (state === 'sleep' || state === 'rest') return 'sleep';
    if (state === 'flee' || state === 'wander') return moving ? 'jump' : 'idle';
    return 'idle';
  }
  if (kind === 'bird') {
    if (state === 'fly') return 'fly';
    if (state === 'flee') return 'fly'; // ave ameaçada levanta voo
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
  for (let r = 1; r <= 4 && !best; r++) {
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

/** inseto mais próximo (posições do pool do mundo via `chunk.localInsects`) */
function nearestInsect(chunk: Chunk, x: number, y: number, reach: number): { x: number; y: number } | null {
  const list = chunk.localInsects;
  if (!list || list.length === 0) return null;
  let best: { x: number; y: number } | null = null;
  let bestD = reach * reach;
  for (const ins of list) {
    const d = (ins.x - x) ** 2 + (ins.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: ins.x, y: ins.y };
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

// ===========================================================================
// IA comportamental compartilhada (percepção → necessidades → memória →
// decisão → ação). Leve e determinística: busca local pelos pools do chunk,
// sem pathfinding e sem recalcular tudo a cada quadro.
// ===========================================================================

/** o que uma criatura percebeu à volta (busca local, O(pool do chunk)) */
export interface Perception {
  /** presa mais próxima (se for predador) */
  prey: Animal | null;
  preyDist: number;
  /** ameaça mais próxima (predador maior, jogador) */
  threat: Animal | null;
  threatDist: number;
  /** água mais próxima (px) */
  water: { x: number; y: number } | null;
  waterDist: number;
  /** inseto mais próximo */
  insect: { x: number; y: number } | null;
  insectDist: number;
  /** fruto no chão mais próximo */
  fruit: { x: number; y: number } | null;
  fruitDist: number;
  /** forragem na célula atual (coelho) */
  forage: number;
}

const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/**
 * Percepção local: olha só os animais do próprio chunk (+ vizinhos via
 * `nearbyAnimals`, quando o mundo fornece) e os recursos já indexados
 * (insetos do pool, frutos no chão, água por célula). Nada de varrer o mundo.
 */
export function perceive(animal: Animal, cfg: WorldConfig, opts: FaunaStepOptions): Perception {
  const traits = FAUNA_TRAITS[animal.kind];
  const chunk = animal.chunk;
  const cellPx = cellPxOf(cfg);
  const huntRange = traits.huntRange ?? 120;

  let prey: Animal | null = null;
  let preyDist = Infinity;
  let threat: Animal | null = null;
  let threatDist = Infinity;

  const others = opts.nearbyAnimals?.(animal, huntRange * 1.2) ?? [];
  const preyKinds = traits.prey ?? [];
  for (const other of others) {
    if (other === animal || other.state === 'dead') continue;
    const d2 = dist2(animal.x, animal.y, other.x, other.y);
    if (d2 > huntRange * huntRange) continue;
    // presa: só as espécies da dieta (o sapo é presa preferida da cobra)
    if (preyKinds.includes(other.kind)) {
      const prefer = other.kind === preyKinds[0] ? 0.75 : 1; // preferência
      if (d2 * prefer < preyDist) {
        preyDist = d2 * prefer;
        prey = other;
      }
    }
    // ameaça: qualquer predador (inclusive a própria cobra, para os demais)
    const otherTraits = FAUNA_TRAITS[other.kind];
    if (otherTraits.prey && otherTraits.prey.includes(animal.kind)) {
      if (d2 < threatDist) {
        threatDist = d2;
        threat = other;
      }
    }
  }

  const water = nearestWater(chunk, cfg, animal.x, animal.y);
  const insect = animal.kind === 'frog' || animal.kind === 'bird'
    ? nearestInsect(chunk, animal.x, animal.y, 4 * cellPx)
    : null;
  const fruit = animal.kind === 'bird' || animal.kind === 'rabbit'
    ? nearestFood(chunk, animal.x, animal.y, 3 * cellPx)
    : null;
  const lx = clamp(Math.floor(animal.x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly = clamp(Math.floor(animal.y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
  const forage = chunk.forage[chunk.cellIdx(lx, ly)] ?? 0;

  return {
    prey,
    preyDist: Math.sqrt(preyDist),
    threat,
    threatDist: Math.sqrt(threatDist),
    water,
    waterDist: water ? Math.hypot(water.x - animal.x, water.y - animal.y) : Infinity,
    insect,
    insectDist: insect ? Math.hypot(insect.x - animal.x, insect.y - animal.y) : Infinity,
    fruit,
    fruitDist: fruit ? Math.hypot(fruit.x - animal.x, fruit.y - animal.y) : Infinity,
    forage,
  };
}

/** atualiza a memória curta (expira depois de MEMORY_HOURS) */
export function remember(
  animal: Animal,
  kind: 'prey' | 'threat',
  target: Animal | null,
  hour: number,
): void {
  if (!target) {
    // sem alvo: a memória antiga expira sozinha com o tempo
    if (animal.memory && hour - animal.memory.hour > MEMORY_HOURS) animal.memory = undefined;
    return;
  }
  animal.memory = { targetId: target.id, x: target.x, y: target.y, hour, kind };
}

/** memória ainda válida? (e atualiza a posição lembrada enquanto visível) */
function freshMemory(animal: Animal, hour: number): Animal['memory'] {
  const m = animal.memory;
  if (!m) return undefined;
  if (hour - m.hour > MEMORY_HOURS) {
    animal.memory = undefined;
    return undefined;
  }
  return m;
}

/**
 * Decisão: traduz percepção + necessidades + memória em estado/alvo.
 * Ordem de prioridade (igual para todas as espécies):
 *   sobrevivência (fuga) > sede extrema > fome > caça (predador) > descanso >
 *   exploração. A personalidade (`quirk`) ajusta limiares e distâncias.
 */
export function decide(
  animal: Animal,
  cfg: WorldConfig,
  opts: FaunaStepOptions,
  percept: Perception,
  /** horas de jogo decorridas neste passo (nunca uma constante de FPS) */
  dtHours = 0,
): void {
  const traits = FAUNA_TRAITS[animal.kind];
  const hour = opts.hour + opts.worldDay * 24;
  const fear = animal.fear ?? 0;
  // quirk: 0 = cauteloso, 1 = ousado/explorador
  const boldness = animal.quirk;
  // cautela por espécie: coelho foge de longe, sapo foge para a água,
  // ave levanta voo. O quirk individual ajusta o limiar.
  const caution = traits.prey ? 0.6 : animal.kind === 'rabbit' ? 1.45 : animal.kind === 'frog' ? 1.0 : 1.2;
  const threatRange = (70 + animal.quirk * 45) * caution;

  // --- 0. janela do bote: a decisão não atropela a animação de ataque ------
  // Sem isso o 'attack' durava um único passo e a pose nunca aparecia.
  // O recuo já foi definido no momento do dano (ver `stepFauna`).
  if (animal.state === 'attack' && animal.timer < STRIKE_WINDOW_HOURS) return;

  // --- 1. sobrevivência: ameaça perto → foge (mesmo com fome) -------------
  if (percept.threat && percept.threatDist < threatRange) {
    let tx = animal.x;
    let ty = animal.y;
    if (percept.threatDist > 0.5) {
      const dx = animal.x - percept.threat.x;
      const dy = animal.y - percept.threat.y;
      const d = Math.hypot(dx, dy) || 1;
      const cellPx = cellPxOf(cfg);
      const minX = animal.chunk.cx * animal.chunk.n * cellPx;
      const maxX = (animal.chunk.cx + 1) * animal.chunk.n * cellPx;
      const minY = animal.chunk.cy * animal.chunk.n * cellPx;
      const maxY = (animal.chunk.cy + 1) * animal.chunk.n * cellPx;
      // cada espécie foge à sua maneira:
      //  - sapo: corre para a água (ambiente seguro);
      //  - ave: levanta voo para longe;
      //  - coelho: corre na direção oposta com desvio lateral (zigue-zague)
      if (animal.kind === 'frog' && percept.water && percept.waterDist < 220) {
        tx = percept.water.x;
        ty = percept.water.y;
      } else {
        const jitter = (animal.quirk - 0.5) * 0.9; // desvio lateral estável
        const cs = Math.cos(jitter);
        const sn = Math.sin(jitter);
        const ox = dx * cs - dy * sn;
        const oy = dx * sn + dy * cs;
        tx = clamp(animal.x + (ox / d) * 70, minX, maxX);
        ty = clamp(animal.y + (oy / d) * 70, minY, maxY);
      }
      animal.tx = tx;
      animal.ty = ty;
    }
    if (animal.kind === 'bird' && percept.threatDist < threatRange * 0.8) {
      animal.state = 'fly'; // ave escapa voando
    } else {
      animal.state = 'flee';
    }
    animal.tx = tx;
    animal.ty = ty;
    animal.timer = 0;
    animal.fear = clamp(fear + 0.4, 0, 1);
    remember(animal, 'threat', percept.threat, hour);
    return;
  }
  // memória de perigo: evita voltar ao local por um tempo
  const threatMemory = freshMemory(animal, hour);
  if (!percept.threat && threatMemory && threatMemory.kind === 'threat' && fear > 0.05) {
    const dx = animal.x - threatMemory.x;
    const dy = animal.y - threatMemory.y;
    if (Math.hypot(dx, dy) < 55) {
      const d = Math.hypot(dx, dy) || 1;
      animal.state = 'flee';
      animal.tx = animal.x + (dx / d) * 40;
      animal.ty = animal.y + (dy / d) * 40;
      animal.timer = 0;
      return;
    }
  }

  // --- 2. sede: beber / ir até a água ------------------------------------
  const thirstLimit = 0.55 + animal.quirk * 0.2;
  if (animal.thirst > thirstLimit && percept.water && percept.waterDist < 260) {
    animal.state = 'seek_water';
    animal.tx = percept.water.x;
    animal.ty = percept.water.y;
    animal.timer = 0;
    return;
  }

  // --- 3. predador: caçar quando com fome e desperto ----------------------
  // A atividade do horário entra na conta: cobra dorme no meio do dia.
  const activity = animal.activity ?? activityAt(animal.kind, opts.hour);
  const huntHunger = 0.45 + (1 - boldness) * 0.1; // ousado caça mais cedo
  const canHunt = animal.hunger > huntHunger && activity > 0.25;
  if (traits.prey && canHunt) {
    const target = percept.prey ?? preyFromMemory(animal, hour, opts);
    if (target) {
      const d = Math.hypot(target.x - animal.x, target.y - animal.y);
      remember(animal, 'prey', target, hour);
      // tempo REAL de perseguição (independe de FPS)
      animal.chaseHours = (animal.chaseHours ?? 0) + Math.max(0, dtHours);
      // perseguição longa sem sucesso: desiste e descansa
      if (animal.chaseHours > MAX_CHASE_HOURS) {
        animal.chaseHours = 0;
        animal.memory = undefined;
        animal.state = 'rest';
        animal.timer = 0;
        animal.hunger = clamp(animal.hunger + 0.05, 0, 1); // gastou energia
        return;
      }
      const ready = (animal.strikeCooldown ?? 0) <= 0;
      if (d <= (traits.attackRange ?? 14) && ready) {
        animal.state = 'attack';
        animal.tx = target.x;
        animal.ty = target.y;
        animal.timer = 0;
        animal.animPhase = 0;
        animal.struckThisLunge = false; // novo bote: pode dar um dano
      } else if (d <= (traits.attackRange ?? 14) * 2.4 && !ready) {
        // cooldown RECÉM-USADO: fica parada observando (pose enrolada/idle),
        // em vez de colar na presa — é o "recuo → cooldown" visível da cobra
        animal.state = 'idle';
        animal.timer = 0;
      } else if (d <= (traits.huntRange ?? 150)) {
        animal.state = 'chase';
        animal.tx = target.x;
        animal.ty = target.y;
        animal.timer = 0;
      }
      return;
    }
  }

  // --- 4. fome: procurar comida (dieta de cada espécie) --------------------
  const hungry = animal.hunger > 0.5;
  if (hungry) {
    const food = bestFoodTarget(animal, percept, opts);
    if (food) {
      animal.state = 'seek_food';
      animal.tx = food.x;
      animal.ty = food.y;
      animal.timer = 0;
      return;
    }
  }

  // --- 5. descanso: predador satisfeito esconde/descansa ------------------
  if (traits.prey && animal.hunger < 0.35 && animal.timer > 3) {
    // fora do pico de caça a cobra se esconde; no pico, só descansa
    animal.state = activity < 0.4 ? 'hide' : animal.quirk > 0.65 ? 'hide' : 'rest';
    animal.timer = 0;
    return;
  }

  // --- 6. exploração ------------------------------------------------------
  if (animal.state === 'idle' && animal.timer > 1.2 + animal.quirk * 2) {
    chooseTarget(animal, cfg, opts);
    animal.timer = 0;
  }
}

/** presa lembrada (persegue a região por alguns instantes) */
function preyFromMemory(animal: Animal, hour: number, opts: FaunaStepOptions): Animal | null {
  const m = freshMemory(animal, hour);
  if (!m || m.kind !== 'prey') return null;
  const others = opts.nearbyAnimals?.(animal, 260) ?? [];
  return others.find((o) => o.id === m.targetId && o.state !== 'dead') ?? null;
}

/** melhor alvo de comida segundo a dieta (forragem, inseto, fruto) */
function bestFoodTarget(animal: Animal, percept: Perception, opts: FaunaStepOptions): { x: number; y: number } | null {
  if (animal.kind === 'rabbit') {
    // coelho: forragem na célula; se não houver, procura fruta/folhagem perto
    if (percept.forage > 0.12) return { x: animal.x, y: animal.y };
    return percept.fruit && percept.fruitDist < 200 ? percept.fruit : null;
  }
  if (animal.kind === 'frog') {
    return percept.insect && percept.insectDist < 200 ? percept.insect : null;
  }
  if (animal.kind === 'bird') {
    if (percept.fruit && percept.fruitDist < 240 && animal.hunger > 0.6) return percept.fruit;
    return percept.insect && percept.insectDist < 220 ? percept.insect : null;
  }
  void opts;
  return null;
}

/**
 * Passo da fauna visual: estados simples, movimento local e reação ao ambiente.
 * `hours` é o intervalo de jogo coberto (a chamada usa passos curtos).
 */
export function stepFauna(animals: Animal[], cfg: WorldConfig, hours: number, opts: FaunaStepOptions): void {
  const h = Math.max(0.0001, hours);
  // 1 h de jogo = 60 s reais: velocidades em px/s viram deslocamento suave
  // quando o mundo chama este passo por quadro (gameHours do frame).
  // limita o passo para não "teleportar" depois de uma pausa/aba oculta
  const dtSec = clamp(h * 60, 0, 0.5);
  const cellPx = cellPxOf(cfg);
  for (const animal of animals) {
    // --- carcaça: não anda, não come, não decide; só envelhece ------------
    // O mundo remove o corpo quando `corpseHours >= CORPSE_HOURS` (vira solo).
    if (animal.state === 'dead') {
      animal.corpseHours = (animal.corpseHours ?? 0) + h;
      animal.hurtTimer = 0;
      animal.vx = 0;
      animal.vy = 0;
      continue;
    }
    animal.hurtTimer = Math.max(0, (animal.hurtTimer ?? 0) - h);
    const traits = FAUNA_TRAITS[animal.kind];
    const chunk = animal.chunk;
    animal.timer += h;
    // --- necessidades: fome e sede sobem, energia cai ---------------------
    animal.hunger = clamp(animal.hunger + h * 0.055, 0, 1);
    // aves obtêm água dos frutos/insetos: sentem menos sede que mamíferos/anfíbios
    // aves tiram água dos frutos e a cobra das presas: sentem menos sede
    const thirstRate = animal.kind === 'bird' ? 0.035 : animal.kind === 'snake' ? 0.03 : 0.055;
    animal.thirst = clamp(animal.thirst + h * thirstRate, 0, 1);
    animal.energy = clamp(animal.energy - h * 0.02, 0, 1);
    // fome/sede extremas corroem a saúde; alimentar-se recupera
    const strain = clamp(animal.hunger - 0.85, 0, 1) + clamp(animal.thirst - 0.85, 0, 1);
    if (strain > 0) animal.health = clamp(animal.health - h * strain * 0.05, 0, 1);
    else animal.health = clamp(animal.health + h * 0.01, 0, 1);
    if (animal.health <= 0.02) {
      // morte: vira CARCAÇA imóvel (visual) e devolve matéria orgânica.
      // O mundo mantém o corpo por CORPSE_HOURS e depois o transforma em solo.
      const cellPx = cellPxOf(cfg);
      const i = animal.chunk.cellIdx(
        clamp(Math.floor(animal.x / cellPx) - animal.chunk.cx * animal.chunk.n, 0, animal.chunk.n - 1),
        clamp(Math.floor(animal.y / cellPx) - animal.chunk.cy * animal.chunk.n, 0, animal.chunk.n - 1),
      );
      animal.chunk.litter[i] = Math.min(16, animal.chunk.litter[i] + 0.7);
      animal.chunk.coarse[i] = Math.min(6, animal.chunk.coarse[i] + 0.35);
      animal.chunk.nAvail[i] += 0.03;
      animal.chunk.soilDirty = true;
      animal.state = 'dead';
      animal.corpseHours = 0;
      animal.timer = 0;
      animal.vx = 0;
      animal.vy = 0;
      opts.onDeath?.(animal);
      continue;
    }

    // --- ritmo diário por espécie (curva, não um "if night") --------------
    // A atividade vem de `activityAt`: cada espécie tem seu pico e a curva
    // influencia sono, velocidade e disposição para caçar/comer.
    const activity = activityAt(animal.kind, opts.hour);
    animal.activity = activity;
    // cooldown do bote corre em horas de jogo (independe de FPS)
    animal.strikeCooldown = Math.max(0, (animal.strikeCooldown ?? 0) - h);
    // dorme quando a atividade da espécie está baixa e não há urgência
    const urgent = animal.hunger > 0.75 || animal.thirst > 0.85 || (animal.fear ?? 0) > 0.3;
    const asleep = activity < 0.22 && !urgent;
    if (asleep && animal.state !== 'sleep' && animal.state !== 'flee' && animal.state !== 'attack') {
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

    // --- beber: sede alta e água por perto --------------------------------
    if (animal.thirst > 0.5 && animal.state !== 'sleep') {
      const spotHere = spotAt(chunk, cfg, animal.x, animal.y, opts.worldDay);
      if (spotHere.water > 0.02) {
        // só o sapo NADA; os outros bebem na margem (animação de comer/beber)
        animal.state = animal.kind === 'frog' ? 'swim' : 'eat';
        animal.timer = 0;
        animal.thirst = clamp(animal.thirst - h * 1.6, 0, 1);
        animal.energy = clamp(animal.energy + h * 0.1, 0, 1);
      } else if (animal.thirst > 0.75) {
        // a ave também voa até a água quando a sede aperta
        const w = nearestWater(chunk, cfg, animal.x, animal.y);
        if (w) {
          animal.state = 'seek_water';
          animal.tx = w.x;
          animal.ty = w.y;
        }
      }
    }

    // --- comer: consome o recurso REAL (inseto, fruto, forragem) ----------
    if (animal.hunger > 0.55 && animal.state !== 'sleep' && animal.state !== 'flee') {
      feedAnimal(animal, cfg, opts, h);
    }

    // --- fezes: devolvem matéria orgânica (+ semente dispersa) ------------
    if (animal.poopTimer > 0) animal.poopTimer -= h;
    else if (animal.hunger < 0.6) {
      poop(animal, cfg, opts);
      animal.poopTimer = 2.5 + animal.quirk * 3;
    }

    // --- IA compartilhada: percepção → memória → decisão --------------------
    // (roda a cada passo do mundo; o movimento continua por quadro abaixo)
    const percept = perceive(animal, cfg, opts);
    animal.fear = clamp((animal.fear ?? 0) - h * 0.35, 0, 1);
    decide(animal, cfg, opts, percept, h);

    // --- bote do predador: UM dano por bote, com cooldown ------------------
    // (antes o dano era aplicado a cada tick enquanto 'attack' durasse)
    if (animal.state === 'attack' && percept.prey) {
      const d = Math.hypot(percept.prey.x - animal.x, percept.prey.y - animal.y);
      const inRange = d <= (traits.attackRange ?? 14) + 2;
      if (inRange && !animal.struckThisLunge && (animal.strikeCooldown ?? 0) <= 0) {
        animal.struckThisLunge = true;
        animal.strikeCooldown = ATTACK_COOLDOWN_HOURS;
        animal.energy = clamp(animal.energy - 0.04, 0, 1);
        // recuo do bote: a cobra se afasta alguns px da presa e observa.
        // Continua no estado 'attack' (animação attack) até a janela fechar —
        // o recuo é só o alvo do movimento, não um estado novo.
        const bx = animal.x - percept.prey.x;
        const by = animal.y - percept.prey.y;
        const bd = Math.hypot(bx, by) || 1;
        animal.tx = animal.x + (bx / bd) * 18;
        animal.ty = animal.y + (by / bd) * 13;
        // dano fixo por bote (não cresce com o tempo que o estado dura)
        opts.damageAnimal?.(percept.prey, traits.attackDamage ?? 0.5);
        if (percept.prey.health <= 0.02) {
          // abateu a presa: alimenta-se dela (o mundo remove a carcaça)
          animal.hunger = clamp(animal.hunger - 0.55, 0, 1);
          animal.energy = clamp(animal.energy + 0.45, 0, 1);
          animal.state = 'rest';
          animal.timer = 0;
          animal.chaseHours = 0;
          animal.memory = undefined;
        }
      } else if (!inRange) {
        animal.state = 'chase';
        animal.tx = percept.prey.x;
        animal.ty = percept.prey.y;
        animal.struckThisLunge = false;
      }
    }
    if (animal.state === 'chase' && percept.prey) {
      // a presa pode escapar: se ficar longe demais, a perseguição termina
      const d = Math.hypot(percept.prey.x - animal.x, percept.prey.y - animal.y);
      if (d > (traits.huntRange ?? 150) * 1.15) {
        animal.state = 'rest';
        animal.chaseHours = 0;
      } else {
        animal.tx = percept.prey.x;
        animal.ty = percept.prey.y;
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
      if (animal.state === 'eat') feedAnimal(animal, cfg, opts, h);
      if (animal.timer > 2.5) {
        animal.state = 'idle';
        animal.timer = 0;
      }
    } else if (animal.state === 'flee' && animal.timer > 1.6) {
      animal.state = 'idle';
      animal.timer = 0;
    } else if ((animal.state === 'rest' || animal.state === 'hide') && animal.timer > 2.5 + animal.quirk * 2) {
      animal.energy = clamp(animal.energy + h * 0.4, 0, 1);
      animal.state = 'idle';
      animal.timer = 0;
    } else if (animal.state === 'attack') {
      // janela do bote: curta. Depois volta a perseguir/descansar
      if (animal.timer > STRIKE_WINDOW_HOURS) {
        animal.state = 'chase';
        animal.timer = 0;
        animal.struckThisLunge = false;
      }
    }

    // --- movimento ---------------------------------------------------------
    const moving =
      animal.state === 'wander' ||
      animal.state === 'seek_food' ||
      animal.state === 'seek_water' ||
      animal.state === 'flee' ||
      animal.state === 'chase' ||
      // durante o bote o alvo é o RECUO: a cobra dá o golpe e volta alguns px
      animal.state === 'attack' ||
      animal.state === 'hunt';
    if (moving) {
      // cobra em perseguição faz o "bote": arranque curto e limitado
      const lunge = animal.kind === 'snake' && (animal.state === 'chase' || animal.state === 'attack') ? 2.3 : 1;
      const speed =
        traits.speed *
        (animal.state === 'flee' ? 2.1 : animal.state === 'chase' ? 1.45 : 1) *
        lunge *
        (0.6 + animal.energy * 0.6) *
        // fuga não depende de atividade (adrenalina); o resto sim
        (animal.state === 'flee' ? 1 : 0.55 + 0.45 * (animal.activity ?? 1));
      const dx = animal.tx - animal.x;
      const dy = animal.ty - animal.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed * 0.6; // perspectiva: desloca menos em Y
        // colisão leve: não entra em água funda (coelho/ave) nem em terra seca (sapo)
        // deslocamento por passo limitado e SEM ultrapassar o alvo
        // (evita "overshoot": o predador passava pela presa e ficava oscilando)
        const stepLen = Math.min(Math.hypot(vx * dtSec, vy * dtSec), dist, 30);
        const dxs = (dx / dist) * stepLen;
        const dys = (dy / dist) * stepLen;
        const nextX = animal.x + dxs;
        const nextY = animal.y + dys;
        const spot = spotAt(chunk, cfg, nextX, nextY, opts.worldDay);
        // colisão leve: quem não nada evita água funda; o sapo anda em terra
        // (mas prefere a margem — isso é escolha de alvo, não bloqueio)
        const blocked = traits.avoidsDeepWater && spot.water > 0.35;
        if (!blocked) {
          animal.x = nextX;
          animal.y = nextY;
        } else if (animal.kind === 'rabbit' || animal.kind === 'bird') {
          animal.tx = animal.x - dx * 0.5;
          animal.ty = animal.y - dy * 0.5;
        }
        animal.vx = vx;
        animal.vy = vy;
        // top-down: só vira o sprite quando o deslocamento é sobretudo
        // horizontal — subir/descer mantém a última direção (nada de piscar)
        if (Math.abs(vx) > 8) animal.facing = vx >= 0 ? 1 : -1;
        animal.animPhase += h * (animal.state === 'flee' ? 10 : 5);
      } else if (animal.state !== 'flee' && animal.state !== 'chase') {
        // chegou ao destino de exploração/comida; fuga e perseguição só
        // terminam pela decisão (ameaça/perda do alvo), nunca por "chegar"
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
          animal.x += (dx / d) * speed * dtSec;
          animal.y += (dy / d) * speed * dtSec;
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
      } else if (animal.state === 'flee') {
        // ave ameaçada: decola baixo (asas) — o hover já existente dá a altura
        animal.hover = 5 + Math.sin(animal.animPhase * 0.9) * 2;
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

/**
 * Dieta por espécie, consumindo recursos que EXISTEM no mundo:
 *  - coelho: camada herbácea (`chunk.forage`) — grama/brotos;
 *  - sapo: insetos do pool do chunk;
 *  - ave: frutos no chão (dispersa a semente) ou insetos.
 * Se não houver recurso por perto, procura um alvo (seek_food).
 */
function feedAnimal(animal: Animal, cfg: WorldConfig, opts: FaunaStepOptions, h: number): void {
  const chunk = animal.chunk;
  const cellPx = cellPxOf(cfg);
  const lx = clamp(Math.floor(animal.x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly = clamp(Math.floor(animal.y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
  const i = chunk.cellIdx(lx, ly);
  const eat = (satisfaction: number) => {
    animal.hunger = clamp(animal.hunger - h * satisfaction, 0, 1);
    animal.energy = clamp(animal.energy + h * satisfaction * 0.5, 0, 1);
    animal.state = 'eat';
    animal.timer = Math.min(animal.timer, 2);
  };
  const searchR = 22;

  if (animal.kind === 'snake') {
    // predador: alimenta-se da presa abatida (ver ataque em stepFauna)
    return;
  }
  if (animal.kind === 'rabbit') {
    if (chunk.forage[i] > 0.12) {
      chunk.forage[i] = Math.max(0, chunk.forage[i] - h * 0.05);
      eat(0.9);
      return;
    }
  } else if (animal.kind === 'frog') {
    if (opts.consumeInsect?.(chunk, animal.x, animal.y, searchR)) {
      eat(1.1);
      return;
    }
  } else {
    // ave: prefere fruto (dispersa semente); senão inseto
    if (animal.hunger > 0.75) {
      const fruit = opts.consumeFruit?.(chunk, animal.x, animal.y, searchR * 1.6);
      if (fruit) {
        // semente ingerida: germina melhor depois da passagem pelo animal
        animal.carriedSeed = { species: fruit.species, vigor: 0.6 + animal.quirk * 0.4 };
        eat(1.2);
        // frutos também hidratam (a ave raramente precisa descer até a água)
        animal.thirst = clamp(animal.thirst - 0.25, 0, 1);
        return;
      }
    }
    if (opts.consumeInsect?.(chunk, animal.x, animal.y, searchR)) {
      eat(0.9);
      return;
    }
  }

  // sem recurso ao alcance: procurar comida (inseto próximo ou fruto no chão)
  if (animal.state !== 'seek_food') {
    const insectTarget =
      animal.kind === 'frog' || animal.kind === 'bird' ? nearestInsect(chunk, animal.x, animal.y, 4 * cellPx) : null;
    const food = insectTarget ?? nearestFood(chunk, animal.x, animal.y, 3 * cellPx);
    if (food) {
      animal.state = 'seek_food';
      animal.tx = food.x;
      animal.ty = food.y;
      animal.timer = 0;
    }
  }
}

/** fezes: matéria orgânica + nutrientes (e semente dispersa, se houver) */
function poop(animal: Animal, cfg: WorldConfig, opts: FaunaStepOptions): void {
  const chunk = animal.chunk;
  const cellPx = cellPxOf(cfg);
  const lx = clamp(Math.floor(animal.x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
  const ly = clamp(Math.floor(animal.y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
  const i = chunk.cellIdx(lx, ly);
  // material fresco (decomposição rápida) + uma fração de nutrientes prontos
  chunk.litter[i] = Math.min(16, chunk.litter[i] + 0.35);
  chunk.nAvail[i] += 0.02;
  chunk.pAvail[i] += 0.006;
  chunk.kAvail[i] += 0.012;
  chunk.soilDirty = true;
  chunk.dirty = true;

  if (animal.carriedSeed) {
    // zoocoria: a semente cai longe da planta-mãe e com vigor extra
    chunk.seedBed.push({
      x: animal.x,
      y: animal.y,
      species: animal.carriedSeed.species,
      ageHours: 0,
      seedKey: Math.floor(hash2(cfg.seed ^ 0x5eed, animal.id % 100000, chunk.groundFruits.length + 17, 771) * 0x7fffffff),
      vigor: animal.carriedSeed.vigor,
    });
    animal.carriedSeed = null;
  }
  void opts;
}

/**
 * Aplica dano de predação a uma presa. A morte é decidida pelo MUNDO (que
 * remove do pool e devolve matéria orgânica), então aqui só reduzimos a saúde
 * e marcamos o estado de fuga/ferida.
 */
export function applyPredationDamage(prey: Animal, amount: number, attacker?: Animal): void {
  if (prey.state === 'dead') return;
  if (!(amount > 0)) return;
  prey.health = clamp(prey.health - Math.max(0, amount), 0, 1);
  prey.fear = clamp((prey.fear ?? 0) + 0.5, 0, 1);
  // reação de dor: pose/flash curto (não é estado — a decisão continua)
  prey.hurtTimer = HURT_HOURS;
  prey.state = 'flee';
  prey.timer = 0;
  if (attacker) {
    // foge para longe do atacante
    const dx = prey.x - attacker.x;
    const dy = prey.y - attacker.y;
    const d = Math.hypot(dx, dy) || 1;
    prey.tx = prey.x + (dx / d) * 80;
    prey.ty = prey.y + (dy / d) * 60;
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
  const hurt = (animal.hurtTimer ?? 0) > 0;
  const anim = animFor(animal.kind, animal.state, moving, spot.water > 0.25, hurt);
  const frames = framesFor(anim);
  let frame = animFrame(animal, anim, frames, timeMs);
  if (animal.state === 'dead') {
    // carcaça: a cobra tem linha de morte (colapsa e congela no último quadro);
    // as outras folhas congelam na pose de repouso — nada de respirar/andar.
    const secs = (animal.corpseHours ?? 0) * 60;
    frame = animal.kind === 'snake' ? Math.min(Math.max(0, frames - 1), Math.floor(secs / 0.1)) : 0;
  }
  return {
    id: animal.id,
    kind: animal.kind,
    x: animal.x,
    y: animal.y,
    state: animal.state,
    anim,
    frame,
    facing: animal.facing,
    hover: animal.state === 'dead' ? 0 : animal.hover,
    scale: 1,
    detailed: true,
  };
}
