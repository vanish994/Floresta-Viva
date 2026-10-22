/**
 * Personagem: movimento, colisão com água profunda/penhascos/troncos e
 * animação. A colisão consulta o estado ambiental real (profundidade de água,
 * declividade) e os troncos das plantas vivas — não uma grade decorativa.
 */
import type { World } from '../world/world';
import { plantSize } from '../world/ecology';
import type { PlayerView } from '../render/scene';

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  moving = false;
  frame = 0;
  private frameAcc = 0;
  speed = 150; // px/s
  female = false;

  place(world: World): void {
    const spawn = world.findSpawn();
    this.x = spawn.x;
    this.y = spawn.y;
  }

  update(world: World, dt: number, axis: { x: number; y: number }): void {
    const cfg = world.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const targetVx = axis.x * this.speed;
    const targetVy = axis.y * this.speed;
    // wading: água rasa freia
    const cell = world.cellAt(Math.floor(this.x / cellPx), Math.floor(this.y / cellPx));
    let slow = 1;
    if (cell) {
      const lx = Math.floor(this.x / cellPx) - cell.cx * cell.n;
      const ly = Math.floor(this.y / cellPx) - cell.cy * cell.n;
      const d = cell.waterDepth[cell.cellIdx(lx, ly)];
      if (d > 0.15) slow = 0.55;
    }
    this.vx += (targetVx * slow - this.vx) * Math.min(1, dt * 12);
    this.vy += (targetVy * slow - this.vy) * Math.min(1, dt * 12);

    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (this.walkable(world, nx, this.y)) this.x = nx;
    else this.vx = 0;
    if (this.walkable(world, this.x, ny)) this.y = ny;
    else this.vy = 0;

    this.moving = Math.hypot(this.vx, this.vy) > 12;
    if (this.vx > 8) this.facing = 1;
    else if (this.vx < -8) this.facing = -1;
    if (this.moving) {
      this.frameAcc += dt * 1000;
      if (this.frameAcc > 110) {
        this.frameAcc = 0;
        this.frame = (this.frame + 1) % 8;
      }
    } else this.frame = 0;
  }

  private walkable(world: World, x: number, y: number): boolean {
    const cfg = world.cfg;
    const cellPx = cfg.simCellTiles * cfg.tileSize;
    const chunk = world.cellAt(Math.floor(x / cellPx), Math.floor(y / cellPx));
    if (!chunk) return false;
    const lx = Math.floor(x / cellPx) - chunk.cx * chunk.n;
    const ly = Math.floor(y / cellPx) - chunk.cy * chunk.n;
    const i = chunk.cellIdx(lx, ly);
    if (chunk.waterDepth[i] > 0.5) return false; // nado não implementado: água profunda bloqueia
    if (chunk.slope[i] > 2.6) return false; // paredão
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
    return { x: this.x, y: this.y, moving: this.moving, frame: this.moving ? this.frame : 0, female: this.female, facing: this.facing };
  }
}
