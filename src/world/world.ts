/**
 * Mundo: orquestra chunks, simulação em múltiplas frequências, deltas de
 * terreno persistentes e o relógio. A renderização consulta este estado, mas
 * nunca o modifica — simulação e desenho são separados.
 */
import { WorldConfig, DEFAULT_CONFIG } from '../core/config';
import { chunkOfPx, chunkKeyStr, chunksInRadius, type ChunkKey } from '../core/coords';
import { clamp, hash2 } from '../core/rng';
import { WorldFields } from './fields';
import { Climate, GameClock } from './climate';
import { Chunk } from './chunk';
import { generateChunk, type GenContext } from './gen';
import { stepWater, stepBio, type Neighborhood, type SoilWaterFlux } from './ecology';
import {
  stepErosion,
  stepBanks,
  createSedimentBudget,
  accumulateSedimentBudget,
  type SedimentBudget,
  type SedimentRegion,
} from './sediment';
import {
  stepWaterPhysics,
  accumulateBudget,
  createWaterBudget,
  totalWaterVolume,
  type WaterBudget,
  type WaterRegion,
} from './water';
import type { PlantRecord } from './flora';
import {
  seedFauna,
  stepFauna,
  applyPredationDamage,
  FAUNA_CAP,
  type Animal,
} from './fauna';
import {
  stepPhenology,
  stepInsects,
  seedInsects,
  updatePestPressure,
  createEcoBudget,
  snapshotEco,
  restoreEco as restoreEcoState,
  fastForwardEco,
  type ChunkLookup,
  type EcoBudget,
  type EcoContext,
  type EcoSnapshot,
  type Insect,
} from './ecosystem';

export interface WorldStats {
  chunksLoaded: number;
  chunksGenerated: number;
  genMs: number;
  simMs: number;
  plants: number;
  /** volume de água superficial nos chunks carregados (m³) */
  waterVolume: number;
  /** custo do passo de física da água (ms, média móvel) */
  waterMs: number;
  /** custo dos passos de erosão/margem (ms, média móvel) */
  sedimentMs: number;
  /** células classificadas como areia nos chunks carregados */
  sandCells: number;
  /** insetos ativos na região simulada */
  insects: number;
  /** frutos no chão nos chunks carregados */
  groundFruits: number;
  /** plantas florindo / com fruto nos chunks carregados */
  floweringPlants: number;
  /** chunks fora de carga com estado ecológico guardado (mundo infinito) */
  ecoArchived: number;
  /** animais visuais ativos (coelhos, sapos, aves) */
  animals: number;
  /** umidade do ar 0..1 (ciclo atmosférico) */
  humidity: number;
  /** cobertura de nuvens 0..1 */
  cloudCover: number;
  /** chuva efetiva 0..1 */
  rain: number;
  /** tipo de chuva (garoa…tempestade) */
  rainKind: string;
}

/** estado de água arquivado quando um chunk é descarregado */
interface WaterSnapshot {
  depth: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
  floodHours: Float32Array;
  surfaceInput: Float32Array;
}

export class World implements Neighborhood, WaterRegion, SedimentRegion {
  readonly cfg: WorldConfig;
  readonly fields: WorldFields;
  readonly climate: Climate;
  readonly clock: GameClock;
  readonly chunks = new Map<string, Chunk>();
  /** deltas persistentes de elevação (erosão/alterações), por célula global */
  readonly terrainDeltas = new Map<string, number>();
  /** diffs de save aguardando o chunk ser gerado */
  pendingDiffs?: Record<
    string,
    {
      removed: number[];
      recruits: PlantRecord[];
      soil?: number[];
      water?: number[];
      flow?: number[];
      sand?: number[];
      types?: number[];
      layer?: number[];
      pheno?: Array<[number, number, number, number, number, Array<[number, number, number, number, number, number]>, number]>;
      fruits?: Array<[number, string, number, number, number, number, number]>;
      seeds?: Array<[number, number, number, number, number]>;
      pests?: number;
    }
  >;
  /** chamado após cada chunk gerado (usado para aplicar diffs persistidos) */
  onChunkGenerated?: (chunk: Chunk) => void;
  stats: WorldStats = {
    chunksLoaded: 0,
    chunksGenerated: 0,
    genMs: 0,
    simMs: 0,
    plants: 0,
    waterVolume: 0,
    waterMs: 0,
    sedimentMs: 0,
    sandCells: 0,
    insects: 0,
    groundFruits: 0,
    floweringPlants: 0,
    ecoArchived: 0,
    animals: 0,
    humidity: 0.55,
    cloudCover: 0,
    rain: 0,
    rainKind: 'seco',
  };
  /** orçamento acumulado de água (m³) desde o início da sessão */
  readonly waterBudget: WaterBudget = createWaterBudget();
  /** orçamento acumulado de erosão/sedimentos (m somados por célula) */
  readonly sedimentBudget: SedimentBudget = createSedimentBudget();
  /** orçamento acumulado do ecossistema (polinizações, quedas, sementes) */
  readonly ecoBudget: EcoBudget = createEcoBudget();
  /** insetos ativos por chunk (pool leve, reconstruído; não vai para o save) */
  private insectsByChunk = new Map<string, Insect[]>();
  /** visitas de polinizadores por planta no intervalo do passo de biologia */
  private flowerVisits = new Map<number, number>();
  /**
   * Estado ecológico de chunks que saíram de carga. Sem isso, o mundo
   * "reiniciaria" (plantas em vegetativo) toda vez que o jogador voltasse —
   * com o arquivo, a fenologia continua e é recuperada no reload.
   */
  private ecoArchive = new Map<string, EcoSnapshot>();
  /** fauna visual por chunk (pool leve; não vai para o save) */
  private faunaByChunk = new Map<string, Animal[]>();
  /** lookup de chunk vizinho para insetos/polinização na fronteira */
  private neighborLookup: ChunkLookup = (cellX, cellY) => this.cellAt(cellX, cellY);
  /** água de chunks descarregados — evita que a borda vire uma parede permanente */
  private waterArchive = new Map<string, WaterSnapshot>();

  private genQueue: ChunkKey[] = [];
  private genCtx: GenContext;
  /** posição do personagem (px) — usada para priorizar geração */
  playerX = 0;
  playerY = 0;
  private velX = 0;
  private velY = 0;

  constructor(cfg: Partial<WorldConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.fields = new WorldFields(this.cfg);
    this.climate = new Climate(this.cfg);
    this.clock = new GameClock(this.climate, this.cfg.startHour);
    this.genCtx = { cfg: this.cfg, fields: this.fields, climate: this.climate, deltaAt: this.deltaAt };
  }

  deltaAt = (cellX: number, cellY: number): number => this.terrainDeltas.get(`${cellX},${cellY}`) ?? 0;

  /** aplica um delta de elevação e devolve o valor efetivamente aplicado */
  addDelta(cellX: number, cellY: number, d: number): number {
    const k = `${cellX},${cellY}`;
    const prev = this.terrainDeltas.get(k) ?? 0;
    const v = prev + d;
    // mantém o valor enquanto for numericamente relevante (conservação exata)
    if (Math.abs(v) < 1e-9) this.terrainDeltas.delete(k);
    else this.terrainDeltas.set(k, clampDelta(v));
    return (this.terrainDeltas.get(k) ?? 0) - prev;
  }
  getDelta(cellX: number, cellY: number): number {
    return this.terrainDeltas.get(`${cellX},${cellY}`) ?? 0;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKeyStr(cx, cy));
  }

  cellAt(cellX: number, cellY: number): Chunk | null {
    const n = this.cfg.chunkTiles / this.cfg.simCellTiles;
    const cx = Math.floor(cellX / n), cy = Math.floor(cellY / n);
    return this.getChunk(cx, cy) ?? null;
  }

  /**
   * Região ativa da física: chunks próximos ao jogador. O anel externo
   * continua carregado e participa como vizinho (`cellAt`), recebendo água,
   * mas não é advectado a cada passo — orçamento mobile-first.
   */
  waterChunks(): Iterable<Chunk> {
    const center = chunkOfPx(this.playerX, this.playerY, this.cfg);
    const r = Math.max(0, this.cfg.waterActiveRadiusChunks);
    const out: Chunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (Math.abs(chunk.cx - center.cx) <= r && Math.abs(chunk.cy - center.cy) <= r) out.push(chunk);
    }
    return out;
  }

  /**
   * Região ativa da morfologia: um pouco menor que a da água (o solver é mais
   * caro por célula). Fora dela não há transporte — a carga deposita na borda,
   * sem perda de massa.
   */
  sedimentChunks(): Iterable<Chunk> {
    const center = chunkOfPx(this.playerX, this.playerY, this.cfg);
    const r = Math.max(0, this.cfg.erosionActiveRadiusChunks);
    const out: Chunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (Math.abs(chunk.cx - center.cx) <= r && Math.abs(chunk.cy - center.cy) <= r) out.push(chunk);
    }
    return out;
  }

  /**
   * Ponto de partida: terra firme, caminhável e DENTRO de floresta densa
   * (primeira impressão importa); relaxa progressivamente se não houver.
   */
  findSpawn(): { x: number; y: number } {
    const cfg = this.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const wet = this.climate.meanWetness();
    let bestScore = -Infinity;
    let bx = 0, by = 0;
    for (let r = 0; r < 72; r++) {
      const steps = Math.max(16, r * 4); // densidade angular constante
      for (let a = 0; a < steps; a++) {
        const cx = Math.round(Math.cos((a / steps) * Math.PI * 2) * r);
        const cy = Math.round(Math.sin((a / steps) * Math.PI * 2) * r);
        const e = this.fields.elevationBase(cx, cy);
        const wt = this.fields.waterTable(cx, cy, wet);
        const slope = this.fields.slopeAspect(cx, cy).slope;
        if (e <= wt + 0.06 || slope >= 1.4) continue;
        const forest = this.fields.forestDensity(cx, cy, wet);
        const score = forest * 2 - r * 0.012 + (this.fields.trailField(cx, cy) > 0.4 ? 0.2 : 0);
        if (score > bestScore) {
          bestScore = score;
          bx = cx;
          by = cy;
        }
      }
      if (bestScore > 1.3) break;
    }
    return { x: bx * cellPx + cellPx / 2, y: by * cellPx + cellPx / 2 };
  }

  requestChunks(px: number, py: number, vx: number, vy: number): void {
    this.playerX = px;
    this.playerY = py;
    this.velX = vx;
    this.velY = vy;
    const cfg = this.cfg;
    const center = chunkOfPx(px, py, cfg);
    const wanted = new Set<string>();
    for (const k of chunksInRadius(center.cx, center.cy, cfg.loadRadiusChunks)) wanted.add(chunkKeyStr(k.cx, k.cy));
    const speed = Math.hypot(vx, vy);
    if (speed > 4) {
      const dx = Math.round(vx / speed), dy = Math.round(vy / speed);
      for (let i = 1; i <= cfg.lookaheadChunks; i++) {
        const off = cfg.loadRadiusChunks + i - 1;
        for (const k of chunksInRadius(center.cx + dx * off, center.cy + dy * off, 1)) wanted.add(chunkKeyStr(k.cx, k.cy));
      }
    }
    for (const key of wanted) {
      if (!this.chunks.has(key) && !this.genQueue.some((q) => chunkKeyStr(q.cx, q.cy) === key)) {
        const [cx, cy] = key.split(',').map(Number);
        this.genQueue.push({ cx, cy });
      }
    }
    this.genQueue.sort((a, b) => dist(a) - dist(b));
    function dist(k: ChunkKey) {
      const dx = k.cx - center.cx, dy = k.cy - center.cy;
      const bias = speed > 4 ? -(dx * Math.sign(vx) + dy * Math.sign(vy)) * 0.35 : 0;
      return dx * dx + dy * dy + bias;
    }
    const unload = cfg.loadRadiusChunks + cfg.unloadMarginChunks;
    for (const [key, chunk] of [...this.chunks]) {
      const dx = chunk.cx - center.cx, dy = chunk.cy - center.cy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > unload) {
        this.storeWaterSnapshot(key, chunk);
        this.storeEcoSnapshot(key, chunk);
        this.insectsByChunk.delete(key);
        this.faunaByChunk.delete(key);
        this.chunks.delete(key);
      }
    }
  }

  pumpGeneration(budget = this.cfg.maxChunkGenPerFrame): Chunk[] {
    const made: Chunk[] = [];
    for (let i = 0; i < budget && this.genQueue.length > 0; i++) {
      const k = this.genQueue.shift()!;
      const key = chunkKeyStr(k.cx, k.cy);
      if (this.chunks.has(key)) continue;
      const t0 = performanceNow();
      const chunk = generateChunk(this.genCtx, k.cx, k.cy);
      this.stats.genMs = this.stats.genMs * 0.9 + (performanceNow() - t0) * 0.1;
      chunk.lastWaterHour = this.clock.totalHours;
      chunk.lastSoilHour = this.clock.totalHours;
      chunk.lastBioHour = this.clock.totalHours;
      chunk.lastErosionHour = this.clock.totalHours;
      chunk.lastBankHour = this.clock.totalHours;
      chunk.lastEcoHour = this.clock.totalHours;
      this.chunks.set(key, chunk);
      this.stats.chunksGenerated++;
      this.onChunkGenerated?.(chunk);
      // água simulada é mais recente que a geração: restaura ao recarregar
      this.restoreWaterSnapshot(key, chunk);
      // ecossistema: retoma o estado salvo e avança o tempo que passou fora
      this.restoreEcoSnapshot(key, chunk);
      made.push(chunk);
    }
    this.stats.chunksLoaded = this.chunks.size;
    return made;
  }

  update(realMs: number): void {
    const beforeMinutes = this.clock.gameMinutes;
    this.clock.advance(realMs);
    const gameHours = (this.clock.gameMinutes - beforeMinutes) / 60;
    const t0 = performanceNow();
    const hours = this.clock.totalHours;
    const cfg = this.cfg;
    const center = chunkOfPx(this.playerX, this.playerY, cfg);
    for (const chunk of this.chunks.values()) {
      const dx = Math.abs(chunk.cx - center.cx), dy = Math.abs(chunk.cy - center.cy);
      const near = dx <= 1 && dy <= 1;
      const maxSteps = near ? 6 : 2;

      if (hours - chunk.lastWaterHour > 96) {
        this.catchUp(chunk, hours - chunk.lastWaterHour);
        chunk.lastWaterHour = hours;
        chunk.lastSoilHour = hours;
        chunk.lastBioHour = hours;
        chunk.lastErosionHour = hours;
        chunk.lastBankHour = hours;
        continue;
      }

      let guard = 0;
      const rainNow = this.climate.precipitationNow();
      while (hours - chunk.lastSoilHour >= cfg.periodWaterHours && guard < maxSteps) {
        const flux: SoilWaterFlux = { evaporation: 0, transpiration: 0, runoff: 0 };
        stepWater(chunk, cfg, this.climate, cfg.periodWaterHours, this.clock.dayFloat, this, rainNow, flux);
        this.atmosEvaporation += flux.evaporation;
        this.atmosTranspiration += flux.transpiration;
        this.atmosRunoff += flux.runoff;
        chunk.lastSoilHour += cfg.periodWaterHours;
        guard++;
      }

      guard = 0;
      while (hours - chunk.lastBioHour >= cfg.periodBioHours && guard < maxSteps) {
        const res = stepBio(chunk, cfg, this.climate, cfg.periodBioHours, this.clock.dayFloat);
        this.applyBioResult(chunk, res);
        chunk.lastBioHour += cfg.periodBioHours;
        guard++;
      }

    }

    // ciclo atmosférico: consome a evapotranspiração do passo e decide a chuva
    this.runAtmosphere(gameHours);
    // física da água superficial: passo fixo, independente da taxa de quadros
    this.runWaterPhysics(gameHours);
    // morfologia fluvial (erosão/deposição) e margens, com a água já atualizada
    this.runMorphology(gameHours);
    // ecossistema: insetos (passo curto) e fenologia (passo da biologia)
    this.runEcosystem(gameHours);

    this.stats.simMs = this.stats.simMs * 0.9 + (performanceNow() - t0) * 0.1;
    let plants = 0;
    for (const c of this.chunks.values()) plants += c.plants.length + c.recruitedPlants.length - c.removedPlants.size;
    this.stats.plants = plants;
  }

  /** acumuladores de tempo de jogo (frequências independentes) */
  private waterAccumHours = 0;
  /** acumuladores do ciclo atmosférico (passo fixo, independente de FPS) */
  private atmosAccumHours = 0;
  private atmosEvaporation = 0;
  private atmosTranspiration = 0;
  private atmosRunoff = 0;
  private erosionAccumHours = 0;
  private bankAccumHours = 0;

  /**
   * Ecossistema: insetos (polinização, herbivoria, predação) em passo curto e
   * fenologia das plantas (floração → fruto → queda) no passo da biologia.
   *
   * Orçamento mobile-first: insetos só existem perto do jogador (raio de 1
   * chunk) e são reconstruídos a partir da flora local — nada pesado no save.
   */
  private ecoAccumHours = 0;
  private insectAccumHours = 0;

  private runEcosystem(gameHours: number): void {
    if (!(gameHours > 0)) return;
    const cfg = this.cfg;
    const dayFloat = this.clock.dayFloat;
    const season = this.climate.seasonIndex(dayFloat);
    const hour = this.clock.hour;
    const center = chunkOfPx(this.playerX, this.playerY, cfg);
    const day = Math.floor(dayFloat);

    // --- insetos: passo curto (0,25 h de jogo), só na vizinhança do jogador ---
    this.insectAccumHours += gameHours;
    const insectStep = 0.25;
    let insectRuns = 0;
    while (this.insectAccumHours >= insectStep && insectRuns < 4) {
      for (const chunk of this.chunks.values()) {
        const near = Math.abs(chunk.cx - center.cx) <= 1 && Math.abs(chunk.cy - center.cy) <= 1;
        const key = chunkKeyStr(chunk.cx, chunk.cy);
        if (!near) {
          this.insectsByChunk.delete(key); // longe: sem agentes ativos (custo zero)
          continue;
        }
        let insects = this.insectsByChunk.get(key);
        const hadFlora = chunk.plants.length + chunk.recruitedPlants.length > 0;
        if (!insects) {
          insects = seedInsects(chunk, cfg, hour, day);
          this.insectsByChunk.set(key, insects);
        }
        // a população acompanha a flora local (sem flor, sem polinizador)
        if (insects.length === 0 && hadFlora) {
          insects = seedInsects(chunk, cfg, hour, day);
          this.insectsByChunk.set(key, insects);
        }
        const visits = this.flowerVisits;
        const before = new Map<string, { pollen: boolean; target: number }>();
        for (const insect of insects) {
          before.set(`${insect.kind}:${insect.id}`, { pollen: insect.pollen, target: insect.targetId });
        }
        stepInsects(insects, cfg, {
          worldDay: dayFloat,
          hour,
          detailed: true,
          budget: this.ecoBudget,
          neighbors: this.neighborLookup,
        });
        // registra a planta cuja flor RECEBEU pólen neste passo
        for (const insect of insects) {
          if (insect.targetId < 0 || !insect.pollen) continue;
          const prev = before.get(`${insect.kind}:${insect.id}`);
          if (!prev) continue;
          const arrived = prev.target === insect.targetId && prev.pollen;
          if (arrived) visits.set(insect.targetId, (visits.get(insect.targetId) ?? 0) + 1);
        }
        updatePestPressure(chunk, insects);
        chunk.localInsects = insects.map((ins) => ({ x: ins.x, y: ins.y, kind: ins.kind }));

        // --- fauna: nasce e é reposta conforme o alimento local -------------
        let animals = this.faunaByChunk.get(key);
        if (!animals) {
          animals = seedFauna(chunk, cfg, dayFloat, hour, insects);
          this.faunaByChunk.set(key, animals);
        }
        if (animals.length === 0) {
          animals = seedFauna(chunk, cfg, dayFloat, hour, insects);
          this.faunaByChunk.set(key, animals);
        }
        this.repopulateFauna(chunk, animals, insects, hour, dayFloat, day);
      }
      this.insectAccumHours -= insectStep;
      insectRuns++;
    }
    if (insectRuns >= 4) this.insectAccumHours = 0;

    // --- fauna visual: movimento por quadro, em px/s (suave em qualquer FPS) --
    for (const chunk of this.chunks.values()) {
      if (Math.abs(chunk.cx - center.cx) > 1 || Math.abs(chunk.cy - center.cy) > 1) continue;
      const key = chunkKeyStr(chunk.cx, chunk.cy);
      const animals = this.faunaByChunk.get(key);
      if (!animals || animals.length === 0) continue;
      const deaths: number[] = [];
      stepFauna(animals, cfg, gameHours, {
        worldDay: dayFloat,
        hour,
        playerX: this.playerX,
        playerY: this.playerY,
        neighbor: this.neighborLookup,
        // --- consumo REAL: a fauna come insetos e frutos do mundo -----------
        consumeInsect: (target, x, y, radius) => {
          const list = this.insectsByChunk.get(chunkKeyStr(target.cx, target.cy));
          if (!list || list.length === 0) return false;
          let best = -1;
          let bestD = radius * radius;
          for (let k = 0; k < list.length; k++) {
            const d = (list[k].x - x) ** 2 + (list[k].y - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          if (best < 0) return false;
          list.splice(best, 1);
          target.localInsects = list.map((ins) => ({ x: ins.x, y: ins.y, kind: ins.kind }));
          return true;
        },
        consumeFruit: (target, x, y, radius) => {
          let best = -1;
          let bestD = radius * radius;
          for (let k = 0; k < target.groundFruits.length; k++) {
            const gf = target.groundFruits[k];
            const d = (gf.x - x) ** 2 + (gf.y - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          if (best < 0) return null;
          const [eaten] = target.groundFruits.splice(best, 1);
          target.ecoDirty = true;
          return { species: eaten.species };
        },
        onDeath: (dead) => deaths.push(dead.id),
        // --- percepção de criaturas (predador/presa) ----------------------
        nearbyAnimals: (self, radius) => {
          const r2 = radius * radius;
          const out: Animal[] = [];
          for (const other of animals) {
            if (other === self) continue;
            const dx = other.x - self.x;
            const dy = other.y - self.y;
            if (dx * dx + dy * dy <= r2) out.push(other);
          }
          // vizinhos imediatos (fronteira do chunk) também são percebidos
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const other = this.faunaByChunk.get(chunkKeyStr(chunk.cx + ox, chunk.cy + oy));
              if (!other) continue;
              for (const a of other) {
                const dx = a.x - self.x;
                const dy = a.y - self.y;
                if (dx * dx + dy * dy <= r2) out.push(a);
              }
            }
          }
          return out;
        },
        // --- predação: dano real na saúde da presa ------------------------
        damageAnimal: (prey, amount) => {
          const wasAlive = prey.state !== 'dead';
          applyPredationDamage(prey, amount, undefined);
          if (prey.health <= 0.02 && wasAlive) {
            prey.state = 'dead';
            prey.timer = 0;
            // carcaça devolve matéria orgânica ao solo (o ecossistema continua)
            const cellPx = cfg.simCellTiles * cfg.tileSize;
            const pc = prey.chunk;
            const i = pc.cellIdx(
              clamp(Math.floor(prey.x / cellPx) - pc.cx * pc.n, 0, pc.n - 1),
              clamp(Math.floor(prey.y / cellPx) - pc.cy * pc.n, 0, pc.n - 1),
            );
            pc.litter[i] = Math.min(16, pc.litter[i] + 0.9);
            pc.coarse[i] = Math.min(6, pc.coarse[i] + 0.5);
            pc.nAvail[i] += 0.05;
            pc.soilDirty = true;
            deaths.push(prey.id);
          }
        },
      });
      if (deaths.length > 0) {
        this.faunaByChunk.set(key, animals.filter((a) => !deaths.includes(a.id)));
      }
    }

    // --- fenologia: no passo da biologia (3 h) -------------------------------
    this.ecoAccumHours += gameHours;
    let runs = 0;
    while (this.ecoAccumHours >= cfg.periodBioHours && runs < 2) {
      const ctx: EcoContext = {
        cfg,
        climate: this.climate,
        worldDay: dayFloat,
        season,
        hourFraction: this.clock.hour / 24,
        humidity: this.climate.meanWetness(),
      };
      for (const chunk of this.chunks.values()) {
        if (Math.abs(chunk.cx - center.cx) > 2 || Math.abs(chunk.cy - center.cy) > 2) continue;
        stepPhenology(chunk, cfg.periodBioHours, ctx, this.ecoBudget, this.flowerVisits);
        chunk.lastEcoHour = this.clock.totalHours;
      }
      this.flowerVisits.clear();
      this.ecoAccumHours -= cfg.periodBioHours;
      runs++;
    }
    if (runs >= 2) this.ecoAccumHours = 0;

    let insects = 0;
    for (const list of this.insectsByChunk.values()) insects += list.length;
    let animals = 0;
    for (const list of this.faunaByChunk.values()) animals += list.length;
    let ground = 0;
    let flowering = 0;
    for (const chunk of this.chunks.values()) {
      ground += chunk.groundFruits.length;
      for (const p of chunk.livePlants()) {
        if (p.pheno && (p.pheno.stage === 'flowering' || p.pheno.fruits.length > 0)) flowering++;
      }
    }
    this.stats.insects = insects;
    this.stats.animals = animals;
    this.stats.groundFruits = ground;
    this.stats.floweringPlants = flowering;
    this.stats.ecoArchived = this.ecoArchive.size;
  }

  /**
   * Reposição populacional: só nasce animal se houver comida de verdade
   * (forragem para coelho, insetos para sapo/ave) e espaço abaixo do teto.
   * É o feedback "mais comida → mais bicho → menos comida → estabiliza".
   */
  private repopulateFauna(
    chunk: Chunk,
    animals: Animal[],
    insects: Insect[],
    hour: number,
    dayFloat: number,
    day: number,
  ): void {
    const cfg = this.cfg;
    const counts = { rabbit: 0, frog: 0, bird: 0, snake: 0 } as Record<string, number>;
    for (const a of animals) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    let forage = 0;
    for (let i = 0; i < chunk.forage.length; i++) forage += chunk.forage[i];
    forage /= Math.max(1, chunk.n * chunk.n);
    const wants: Array<{ kind: 'rabbit' | 'frog' | 'bird' | 'snake'; food: number; cap: number }> = [
      { kind: 'rabbit', food: forage * 2.2, cap: FAUNA_CAP.rabbit },
      { kind: 'frog', food: Math.min(1, insects.length / 4), cap: FAUNA_CAP.frog },
      { kind: 'bird', food: Math.min(1, insects.length / 3), cap: FAUNA_CAP.bird },
      // predador: só aparece/recompõe se houver presas suficientes no chunk
      {
        kind: 'snake',
        food: Math.min(1, (counts.rabbit + counts.frog + counts.bird) / 3),
        cap: FAUNA_CAP.snake,
      },
    ];
    for (const w of wants) {
      if (counts[w.kind] >= w.cap) continue;
      if (w.food < 0.3) continue;
      const roll = hash2(cfg.seed ^ 0x5f2a, chunk.cx * 71 + counts[w.kind], (chunk.cy * 37 + day * 13) | 0, 781);
      if (roll >= 0.008 * w.food) continue;
      const born = seedFauna(chunk, cfg, dayFloat, hour, insects).filter((a) => a.kind === w.kind);
      if (born.length <= counts[w.kind]) continue;
      const baby = { ...born[counts[w.kind]], health: 0.7, hunger: 0.5, thirst: 0.4 };
      baby.id = Math.floor(
        hash2(cfg.seed ^ 0x99e1, chunk.cx * 17 + counts[w.kind], (chunk.cy * 29 + day) | 0, 782) * 0x7fffffff,
      );
      animals.push(baby);
    }
  }

  /** insetos ativos de um chunk (render/debug) */
  insectsAt(chunk: Chunk): Insect[] {
    return this.insectsByChunk.get(chunkKeyStr(chunk.cx, chunk.cy)) ?? [];
  }

  /** fauna visual ativa de um chunk (render/debug) */
  faunaAt(chunk: Chunk): Animal[] {
    return this.faunaByChunk.get(chunkKeyStr(chunk.cx, chunk.cy)) ?? [];
  }

  /**
   * Erosão/deposição e margens. Roda só na região ativa (a mesma da água):
   * o custo é proporcional ao número de chunks carregados e a ordem de
   * processamento é fixa (chunks ordenados), então o resultado é determinístico.
   */
  /**
   * Ciclo atmosférico causal: agrega evaporação/transpiração/biomassa/água dos
   * chunks carregados, avança umidade → nuvens → precipitação e publica o
   * resultado em `stats` (HUD) e no clima (render/áudio/eco).
   */
  private runAtmosphere(gameHours: number): void {
    if (!(gameHours > 0)) return;
    const cfg = this.cfg;
    this.atmosAccumHours += gameHours;
    const stepH = 0.25; // 15 min de jogo: barato e estável
    let steps = 0;
    while (this.atmosAccumHours >= stepH && steps < 8) {
      // agrega o estado do mundo carregado (O(células), algumas vezes por hora)
      let wet = 0;
      let cells = 0;
      let biomass = 0;
      let plants = 0;
      for (const chunk of this.chunks.values()) {
        const cn = chunk.n * chunk.n;
        cells += cn;
        for (let i = 0; i < cn; i++) {
          if (chunk.waterDepth[i] > 0.02) wet++;
          biomass += chunk.forage[i] * 0.15;
        }
        plants += chunk.plants.length + chunk.recruitedPlants.length;
      }
      const waterSurface = cells > 0 ? wet / cells : 0;
      const forest = cells > 0 ? clamp((plants * 0.02 + biomass) / Math.max(1, cells * 0.05), 0, 1) : 0;
      const temp = this.climate.temperature(this.clock.dayFloat, this.clock.hour, 0.3);
      // normaliza os fluxos acumulados desde o último passo atmosférico
      const norm = 1 / Math.max(1, cells * stepH);
      this.climate.stepAtmosphere(stepH, {
        temperature: temp,
        evaporation: clamp(this.atmosEvaporation * norm * 40, 0, 1),
        transpiration: clamp(this.atmosTranspiration * norm * 40, 0, 1),
        forest,
        waterSurface,
        hour: this.clock.hour,
        dayFloat: this.clock.dayFloat,
      });
      this.atmosEvaporation = 0;
      this.atmosTranspiration = 0;
      this.atmosRunoff = 0;
      this.atmosAccumHours -= stepH;
      steps++;
    }
    if (steps >= 8) this.atmosAccumHours = 0;
    const a = this.climate.atmosphere;
    this.stats.humidity = a.humidity;
    this.stats.cloudCover = a.cloudCover;
    this.stats.rain = this.climate.precipitationNow();
    this.stats.rainKind = this.climate.rainKind();
  }

  private runMorphology(gameHours: number): void {
    if (!(gameHours > 0)) return;
    const cfg = this.cfg;
    const t0 = performanceNow();
    const dayFloat = this.clock.dayFloat;
    const rain = this.climate.precipitationNow();
    const base = {
      worldDay: dayFloat,
      worldHours: this.clock.totalHours,
      rainIntensity: rain,
    };
    let ran = false;

    this.erosionAccumHours += gameHours;
    let steps = 0;
    while (this.erosionAccumHours >= cfg.periodErosionHours && steps < 4) {
      const budget = createSedimentBudget();
      stepErosion(this, cfg.periodErosionHours, { ...base, budget });
      accumulateSedimentBudget(this.sedimentBudget, budget);
      this.erosionAccumHours -= cfg.periodErosionHours;
      steps++;
      ran = true;
    }
    if (steps >= 4) this.erosionAccumHours = 0; // descarta atraso excessivo

    this.bankAccumHours += gameHours;
    steps = 0;
    while (this.bankAccumHours >= cfg.periodBankHours && steps < 8) {
      const budget = createSedimentBudget();
      stepBanks(this, cfg.periodBankHours, { ...base, budget });
      accumulateSedimentBudget(this.sedimentBudget, budget);
      this.bankAccumHours -= cfg.periodBankHours;
      steps++;
      ran = true;
    }
    if (steps >= 8) this.bankAccumHours = 0;

    if (ran) this.stats.sedimentMs = this.stats.sedimentMs * 0.9 + (performanceNow() - t0) * 0.1;

    const erosionUntil = this.clock.totalHours - this.erosionAccumHours;
    const bankUntil = this.clock.totalHours - this.bankAccumHours;
    let sand = 0;
    for (const chunk of this.chunks.values()) {
      if (erosionUntil > chunk.lastErosionHour) chunk.lastErosionHour = erosionUntil;
      if (bankUntil > chunk.lastBankHour) chunk.lastBankHour = bankUntil;
      sand += chunk.sandCells();
    }
    this.stats.sandCells = sand;
  }

  private runWaterPhysics(gameHours: number): void {
    if (!(gameHours > 0)) return;
    const cfg = this.cfg;
    this.waterAccumHours += gameHours;
    const step = Math.max(1e-4, cfg.waterStepHours);
    let steps = 0;
    const maxSteps = 64; // orçamento por quadro (evita espiral após aba oculta)
    const t0 = performanceNow();
    while (this.waterAccumHours >= step && steps < maxSteps) {
      const budget = createWaterBudget();
      stepWaterPhysics(this, step, {
        climate: this.climate,
        temperature: this.climate.temperature(this.clock.dayFloat, this.clock.hour, 0.35),
        daylight: this.climate.sky(this.clock.dayFloat, this.clock.hour).light,
        worldHours: this.clock.totalHours,
        openBoundary: true,
        budget,
      });
      accumulateBudget(this.waterBudget, budget);
      this.waterAccumHours -= step;
      steps++;
    }
    if (steps >= maxSteps) this.waterAccumHours = 0; // descarta atraso excessivo
    this.stats.waterMs = this.stats.waterMs * 0.9 + (performanceNow() - t0) * 0.1;
    this.stats.waterVolume = totalWaterVolume(this.chunks.values(), cfg);
    // o relógio da água reflete exatamente o tempo simulado (não o do render)
    const simulatedUntil = this.clock.totalHours - this.waterAccumHours;
    for (const chunk of this.chunks.values()) {
      if (simulatedUntil > chunk.lastWaterHour) chunk.lastWaterHour = simulatedUntil;
    }
  }

  private storeWaterSnapshot(key: string, chunk: Chunk): void {
    this.waterArchive.set(key, {
      depth: chunk.waterDepth.slice(),
      flowX: chunk.flowX.slice(),
      flowY: chunk.flowY.slice(),
      floodHours: chunk.floodHours.slice(),
      surfaceInput: chunk.surfaceInput.slice(),
    });
    while (this.waterArchive.size > 192) {
      const oldest = this.waterArchive.keys().next().value;
      if (oldest === undefined) break;
      this.waterArchive.delete(oldest);
    }
  }

  private restoreWaterSnapshot(key: string, chunk: Chunk): void {
    const snap = this.waterArchive.get(key);
    if (!snap) return;
    chunk.waterDepth.set(snap.depth);
    chunk.flowX.set(snap.flowX);
    chunk.flowY.set(snap.flowY);
    chunk.floodHours.set(snap.floodHours);
    chunk.surfaceInput.set(snap.surfaceInput);
    this.waterArchive.delete(key);
    chunk.waterDirty = true;
  }

  /**
   * Arquiva o estado ecológico do chunk que sai de carga (fenologia, frutos no
   * chão, sementes, pragas) com o instante de jogo. Cap de 192 chunks para a
   * memória não crescer sem limite num mundo infinito.
   */
  private storeEcoSnapshot(key: string, chunk: Chunk): void {
    // o instante do snapshot é o do ÚLTIMO passo ecológico real do chunk: se ele
    // ficou carregado mas longe do jogador, esse tempo também é recuperado
    const snap = snapshotEco(chunk, chunk.lastEcoHour);
    if (
      snap.plants.size === 0 &&
      snap.groundFruits.length === 0 &&
      snap.seedBed.length === 0 &&
      snap.recruited.length === 0 &&
      snap.removed.length === 0 &&
      snap.pestPressure < 0.001
    ) {
      this.ecoArchive.delete(key);
      return;
    }
    this.ecoArchive.set(key, snap);
    while (this.ecoArchive.size > 192) {
      const oldest = this.ecoArchive.keys().next().value;
      if (oldest === undefined) break;
      this.ecoArchive.delete(oldest);
    }
  }

  /** Restaura e avança o estado ecológico de um chunk recém-gerado. */
  private restoreEcoSnapshot(key: string, chunk: Chunk): void {
    const snap = this.ecoArchive.get(key);
    if (!snap) return;
    this.ecoArchive.delete(key);
    const elapsed = this.clock.totalHours - snap.hour;
    chunk.lastEcoHour = this.clock.totalHours;
    if (elapsed <= 0.01) {
      restoreEcoState(chunk, snap);
      return;
    }
    const ctx: EcoContext = {
      cfg: this.cfg,
      climate: this.climate,
      worldDay: this.clock.dayFloat,
      season: this.climate.seasonIndex(this.clock.dayFloat),
      hourFraction: this.clock.hour / 24,
      humidity: this.climate.meanWetness(),
    };
    fastForwardEco(chunk, snap, elapsed, ctx);
  }

  private bioAccum = new Map<string, number>();
  private applyBioResult(chunk: Chunk, res: { recruits: PlantRecord[]; deaths: number[] }): void {
    for (const r of res.recruits) {
      if (!chunk.recruitedPlants.some((p) => p.id === r.id) && !chunk.removedPlants.has(r.id)) chunk.recruitedPlants.push(r);
    }
    for (const id of res.deaths) chunk.removedPlants.add(id);
    if (res.recruits.length || res.deaths.length) {
      chunk.dirty = true;
      chunk.rebuildPlantIndex();
    }
  }

  private catchUp(chunk: Chunk, elapsedHours: number): void {
    const cfg = this.cfg;
    const days = elapsedHours / 24;
    const wet = this.climate.meanWetness();
    for (let i = 0; i < chunk.n * chunk.n; i++) {
      const target = clamp01(0.18 + wet * 0.4 + (chunk.waterDepth[i] > 0 ? 0.35 : 0));
      chunk.moisture[i] += (target - chunk.moisture[i]) * (1 - Math.exp(-days * 0.5));
      const prod = 0.09 * days;
      chunk.litter[i] = clamp(chunk.litter[i] + prod - chunk.litter[i] * 0.05 * days, 0, 12);
      chunk.humus[i] = clamp(chunk.humus[i] + chunk.litter[i] * 0.02 * days, 0, 20);
      chunk.stress[i] = clamp(chunk.stress[i] * Math.exp(-days * 0.2), 0, 2);
    }
    void cfg;
    chunk.lastSoilHour = Math.max(chunk.lastSoilHour, chunk.lastWaterHour);
    chunk.dirty = true;
  }
}

function clampDelta(v: number): number {
  return Math.max(-0.25, Math.min(0.25, v));
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
