/**
 * Mundo: orquestra chunks, simulação em múltiplas frequências, deltas de
 * terreno persistentes e o relógio. A renderização consulta este estado, mas
 * nunca o modifica — simulação e desenho são separados.
 */
import { WorldConfig, DEFAULT_CONFIG } from '../core/config';
import { chunkOfPx, chunkKeyStr, chunksInRadius, type ChunkKey } from '../core/coords';
import { clamp } from '../core/rng';
import { WorldFields } from './fields';
import { Climate, GameClock } from './climate';
import { Chunk } from './chunk';
import { generateChunk, type GenContext } from './gen';
import { stepWater, stepBio, type Neighborhood } from './ecology';
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
  };
  /** orçamento acumulado de água (m³) desde o início da sessão */
  readonly waterBudget: WaterBudget = createWaterBudget();
  /** orçamento acumulado de erosão/sedimentos (m somados por célula) */
  readonly sedimentBudget: SedimentBudget = createSedimentBudget();
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
      this.chunks.set(key, chunk);
      this.stats.chunksGenerated++;
      this.onChunkGenerated?.(chunk);
      // água simulada é mais recente que a geração: restaura ao recarregar
      this.restoreWaterSnapshot(key, chunk);
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
      while (hours - chunk.lastSoilHour >= cfg.periodWaterHours && guard < maxSteps) {
        stepWater(chunk, cfg, this.climate, cfg.periodWaterHours, this.clock.dayFloat, this);
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

    // física da água superficial: passo fixo, independente da taxa de quadros
    this.runWaterPhysics(gameHours);
    // morfologia fluvial (erosão/deposição) e margens, com a água já atualizada
    this.runMorphology(gameHours);

    this.stats.simMs = this.stats.simMs * 0.9 + (performanceNow() - t0) * 0.1;
    let plants = 0;
    for (const c of this.chunks.values()) plants += c.plants.length + c.recruitedPlants.length - c.removedPlants.size;
    this.stats.plants = plants;
  }

  /** acumuladores de tempo de jogo (frequências independentes) */
  private waterAccumHours = 0;
  private erosionAccumHours = 0;
  private bankAccumHours = 0;

  /**
   * Erosão/deposição e margens. Roda só na região ativa (a mesma da água):
   * o custo é proporcional ao número de chunks carregados e a ordem de
   * processamento é fixa (chunks ordenados), então o resultado é determinístico.
   */
  private runMorphology(gameHours: number): void {
    if (!(gameHours > 0)) return;
    const cfg = this.cfg;
    const t0 = performanceNow();
    const dayFloat = this.clock.dayFloat;
    const rain = this.climate.rainIntensity(dayFloat);
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
