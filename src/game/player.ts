/**
 * Personagem: movimento em terra, vadeo em água rasa, natação em água profunda,
 * colisão com penhascos/troncos e animação.
 *
 * A água que o personagem sente é a água REAL do solver (`chunk.waterDepth` em
 * metros e `chunk.flowX/flowY` em m/s): a profundidade decide entre andar, vadear
 * e nadar, e a correnteza empurra quem está nadando (a favor ou contra).
 *
 * Constantes de jogo (px/s) vivem aqui, na camada de jogo, e não no solver:
 * o solver trabalha em metros por segundo e é calibrado para erosão; para o
 * personagem usamos um fator de escala explícito (`currentFactor`) que converte
 * m/s em deslocamento perceptível na tela, sem alterar a física da água.
 */
import type { World } from '../world/world';
import { plantSize } from '../world/ecology';
import { clamp } from '../core/rng';
import type { PlayerView } from '../render/scene';

/** profundidade (m) a partir da qual o personagem nada em vez de vadear */
export const SWIM_DEPTH_M = 0.45;
/** profundidade (m) a partir da qual andar fica lento (vadeo) */
export const WADE_DEPTH_M = 0.15;

export interface PlayerWaterSample {
  /** lâmina d'água na célula (m) */
  depth: number;
  /** classificação: 1 lago, 2 rio/córrego */
  kind: number;
  /** velocidade da correnteza (m/s) */
  currentX: number;
  currentY: number;
  currentSpeed: number;
}

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  moving = false;
  frame = 0;
  private frameAcc = 0;
  speed = 150; // px/s em terra
  female = false;

  // --- estado aquático ---
  /** nadando (água acima de SWIM_DEPTH_M) */
  swimming = false;
  /** 0..1 — fração do corpo submersa (usada no desenho) */
  submerge = 0;
  /** fôlego 0..1: cai nadando, volta em terra/água rasa */
  stamina = 1;
  /** fase da braçada (rad) — anima o balanço do corpo */
  swimPhase = 0;
  /** correnteza aplicada neste quadro (px/s) */
  driftX = 0;
  driftY = 0;
  /** lâmina e correnteza amostradas neste quadro (para HUD/testes) */
  readonly water: PlayerWaterSample = { depth: 0, kind: 0, currentX: 0, currentY: 0, currentSpeed: 0 };

  // --- constantes de jogo ---
  readonly swimSpeed = 78; // px/s nadando com fôlego
  readonly exhaustedSwimFactor = 0.35; // fôlego zero: só flutua/remenda (sem soft-lock)
  readonly wadeSpeedFactor = 0.55;
  /** converte m/s da correnteza em px/s jogáveis (escala de jogo, não física) */
  readonly currentFactor = 14;
  readonly staminaDrain = 0.032; // por segundo nadando
  readonly staminaRegenLand = 0.35;
  readonly staminaRegenShallow = 0.12;

  place(world: World): void {
    const spawn = world.findSpawn();
    this.x = spawn.x;
    this.y = spawn.y;
    this.resetWaterState();
  }

  private resetWaterState(): void {
    this.swimming = false;
    this.submerge = 0;
    this.stamina = 1;
    this.swimPhase = 0;
    this.driftX = 0;
    this.driftY = 0;
    this.water.depth = 0;
    this.water.kind = 0;
    this.water.currentX = 0;
    this.water.currentY = 0;
    this.water.currentSpeed = 0;
  }

  /** amostra profundidade e correnteza na posição (célula da grade ambiental) */
  sampleWater(world: World, x: number, y: number): PlayerWaterSample {
    const cfg = world.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const out = this.water;
    const chunk = world.cellAt(Math.floor(x / cellPx), Math.floor(y / cellPx));
    if (!chunk) {
      out.depth = 0;
      out.kind = 0;
      out.currentX = 0;
      out.currentY = 0;
      out.currentSpeed = 0;
      return out;
    }
    const lx = clamp(Math.floor(x / cellPx) - chunk.cx * chunk.n, 0, chunk.n - 1);
    const ly = clamp(Math.floor(y / cellPx) - chunk.cy * chunk.n, 0, chunk.n - 1);
    const i = chunk.cellIdx(lx, ly);
    out.depth = chunk.waterDepth[i];
    out.kind = chunk.waterKind[i];
    out.currentX = chunk.flowX[i];
    out.currentY = chunk.flowY[i];
    out.currentSpeed = Math.sqrt(out.currentX * out.currentX + out.currentY * out.currentY);
    return out;
  }

  update(world: World, dt: number, axis: { x: number; y: number }): void {
    const cfg = world.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1); // passo máximo: estabilidade em quedas de FPS

    // ---- 1. estado da água (profundidade + correnteza reais) ----------------
    const water = this.sampleWater(world, this.x, this.y);
    this.swimming = water.depth >= SWIM_DEPTH_M;
    const wading = !this.swimming && water.depth > WADE_DEPTH_M;
    // quanto mais fundo, mais o corpo afunda (o sprite é cortado na linha d'água)
    this.submerge = this.swimming
      ? clamp(0.14 + (water.depth - SWIM_DEPTH_M) * 0.2, 0.14, 0.42)
      : 0;

    // correnteza em px/s: só age no corpo dentro da água (escala de jogo)
    const pxPerMeter = cellPx / Math.max(0.001, cfg.waterCellMeters);
    const driftFactor = this.swimming ? 1 : wading ? 0.25 : 0;
    const driftScale = pxPerMeter * this.currentFactor * driftFactor;
    this.driftX = water.currentX * driftScale;
    this.driftY = water.currentY * driftScale;

    // ---- 2. fôlego: nadar cansa; remar contra a correnteza cansa mais -------
    const wantsMove = axis.x !== 0 || axis.y !== 0;
    if (this.swimming) {
      let strain = 1;
      if (axis.x !== 0 || axis.y !== 0) {
        // componente da correnteza contrária ao esforço do jogador
        const along = axis.x * water.currentX + axis.y * water.currentY;
        const against = clamp(-along / 0.12, 0, 1.6);
        strain += against * 1.4;
      }
      const drain = this.staminaDrain * (wantsMove ? 1 : 0.45) * strain;
      this.stamina = clamp(this.stamina - drain * dt, 0, 1);
    } else {
      const regen = wading ? this.staminaRegenShallow : this.staminaRegenLand;
      this.stamina = clamp(this.stamina + regen * dt, 0, 1);
    }
    const exhausted = this.swimming && this.stamina <= 0.001;

    // ---- 3. velocidade alvo: terra > vadeo > nado > nado exausto -----------
    let base = this.speed;
    if (this.swimming) base = this.swimSpeed * (exhausted ? this.exhaustedSwimFactor : 1);
    else if (wading) base = this.speed * this.wadeSpeedFactor;

    const targetVx = axis.x * base + this.driftX;
    const targetVy = axis.y * base + this.driftY;
    const accel = this.swimming ? 4.5 : 12;
    this.vx += (targetVx - this.vx) * Math.min(1, dt * accel);
    this.vy += (targetVy - this.vy) * Math.min(1, dt * accel);

    // teto: nadando a favor da correnteza o personagem pode ser levado rápido,
    // mas nunca a ponto de atravessar células por quadro (sem "teleporte")
    const maxSpeed = this.speed * 2.4;
    const vmag = Math.hypot(this.vx, this.vy);
    if (vmag > maxSpeed) {
      this.vx = (this.vx / vmag) * maxSpeed;
      this.vy = (this.vy / vmag) * maxSpeed;
    }

    // ---- 4. movimento com colisão ------------------------------------------
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (this.walkable(world, nx, this.y)) this.x = nx;
    else this.vx = 0;
    if (this.walkable(world, this.x, ny)) this.y = ny;
    else this.vy = 0;

    // ---- 5. animação --------------------------------------------------------
    this.moving = Math.hypot(this.vx, this.vy) > 12;
    if (this.vx > 8) this.facing = 1;
    else if (this.vx < -8) this.facing = -1;
    if (this.swimming) {
      // braçada mais lenta e contínua; parado ainda "rema" para flutuar
      this.swimPhase += dt * (this.moving ? 4.2 : 1.8) * (0.6 + 0.4 * this.stamina);
      this.frame = Math.floor(this.swimPhase / (Math.PI / 2)) % 4;
    } else if (this.moving) {
      this.frameAcc += dt * 1000;
      if (this.frameAcc > 110) {
        this.frameAcc = 0;
        this.frame = (this.frame + 1) % 8;
      }
    } else {
      this.frame = 0;
    }
  }

  /**
   * Água profunda é atravessável NADANDO (não bloqueia mais). Penhascos e
   * troncos continuam bloqueando — também para quem nada.
   */
  private walkable(world: World, x: number, y: number): boolean {
    const cfg = world.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const chunk = world.cellAt(Math.floor(x / cellPx), Math.floor(y / cellPx));
    if (!chunk) return false;
    const lx = Math.floor(x / cellPx) - chunk.cx * chunk.n;
    const ly = Math.floor(y / cellPx) - chunk.cy * chunk.n;
    const i = chunk.cellIdx(lx, ly);
    if (chunk.slope[i] > 2.6) return false; // paredão (acima ou abaixo da água)
    // troncos
    for (const p of chunk.livePlants()) {
      const size = plantSize(p, chunk, cfg, world.clock.dayFloat);
      if (size < 0.3) continue;
      const r = 7 + size * 5;
      const dx = x - p.x, dy = y - (p.y - 4);
      if (dx * dx + dy * dy < r * r) return false;
    }
    return true;
  }

  view(): PlayerView {
    return {
      x: this.x,
      y: this.y,
      moving: this.moving,
      frame: this.moving || this.swimming ? this.frame : 0,
      female: this.female,
      facing: this.facing,
      swimming: this.swimming,
      submerge: this.submerge,
      stamina: this.stamina,
      swimPhase: this.swimPhase,
      speed: Math.hypot(this.vx, this.vy),
    };
  }
}
