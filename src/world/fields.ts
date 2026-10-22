/**
 * Campos globais do mundo: funções puras de (configuração, coordenada global).
 *
 * Estes campos são a fonte única de verdade do relevo, solo base, lençol
 * freático, densidade de floresta e trilhas. Como dependem apenas da
 * coordenada global, a continuidade entre chunks é garantida por construção:
 * dois chunks que consultam a mesma célula recebem exatamente o mesmo valor.
 */
import { ValueNoise, clamp, hash2, lerp, smoothstep } from '../core/rng';
import type { WorldConfig } from '../core/config';

export type DeltaAt = (cellX: number, cellY: number) => number;
const ZERO_DELTA: DeltaAt = () => 0;

export class WorldFields {
  readonly noise: ValueNoise;
  readonly cfg: WorldConfig;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.noise = new ValueNoise(cfg.seed);
  }

  /** warp de domínio para formas orgânicas (compartilhado por vários campos) */
  private warpX(x: number, y: number): number {
    return x + 2.2 * this.noise.fbm2(x * 0.021 + 31.7, y * 0.021 - 12.4, 3, 0.5, 2, 11);
  }
  private warpY(x: number, y: number): number {
    return y + 2.2 * this.noise.fbm2(x * 0.021 - 8.1, y * 0.021 + 44.9, 3, 0.5, 2, 23);
  }

  /**
   * Elevação base normalizada [0,1] na célula global (sem deltas de erosão).
   * Combina continente, colinas e cristas de montanha com transições suaves.
   */
  elevationBase(cellX: number, cellY: number): number {
    const s = 1 / this.cfg.continentScale;
    const wx = this.warpX(cellX, cellY);
    const wy = this.warpY(cellX, cellY);
    const continent = this.noise.fbm2(wx * s, wy * s, 4, 0.5, 2, 1) * 0.5 + 0.5;
    const hills = this.noise.fbm2(wx * s * 3.1, wy * s * 3.1, 4, 0.5, 2, 2) * 0.5 + 0.5;
    const ridge = this.noise.ridge2(wx * s * 1.7, wy * s * 1.7, 4, 3);
    // montanhas só onde o continente já é alto → cordilheiras coerentes
    const mountainMask = smoothstep(0.55, 0.8, continent);
    const m = this.cfg.mountainWeight;
    let e = lerp(lerp(continent, hills, 0.45), ridge, m * mountainMask);
    // vales suaves: depressões de baixa frequência
    const basin = this.noise.fbm2(wx * s * 0.6, wy * s * 0.6, 2, 0.5, 2, 5) * 0.5 + 0.5;
    e = lerp(e, e * (0.72 + 0.28 * basin), 0.35);
    // curva de contraste: vales mais fundos e montanhas mais altivas
    e = clamp((e - 0.47) * 1.55 + 0.47, 0, 1);
    return clamp(e, 0, 1);
  }

  /** elevação em metros, incluindo deltas persistentes (erosão/jogador) */
  elevation(cellX: number, cellY: number, deltaAt: DeltaAt = ZERO_DELTA): number {
    return (this.elevationBase(cellX, cellY) + deltaAt(cellX, cellY)) * this.cfg.elevationRange;
  }

  /** declividade (m por célula) e orientação da encosta (rad) */
  slopeAspect(cellX: number, cellY: number, deltaAt: DeltaAt = ZERO_DELTA): { slope: number; aspect: number } {
    const e = this.elevation(cellX, cellY, deltaAt);
    const ex = this.elevation(cellX + 1, cellY, deltaAt);
    const ey = this.elevation(cellX, cellY + 1, deltaAt);
    const dx = ex - e;
    const dy = ey - e;
    return { slope: Math.hypot(dx, dy), aspect: Math.atan2(dy, dx) };
  }

  /**
   * Material de solo pai (antes da dinâmica ecológica):
   * 0 arenoso, 1 argiloso, 2 rochoso. Aluvial é derivado pela hidrologia.
   */
  soilParent(cellX: number, cellY: number): number {
    const n = this.noise.fbm2(cellX * 0.017 + 91.3, cellY * 0.017 - 55.2, 3, 0.5, 2, 7) * 0.5 + 0.5;
    const e = this.elevationBase(cellX, cellY);
    const { slope } = this.slopeAspect(cellX, cellY);
    const rocky = smoothstep(0.55, 0.8, e) * smoothstep(0.6, 1.4, slope);
    const sandy = smoothstep(0.62, 0.4, n) * (1 - rocky);
    const clay = smoothstep(0.45, 0.68, n) * (1 - rocky);
    // dither determinístico nas fronteiras → transições pontilhadas, não linhas duras
    const d = (hash2(1013, cellX, cellY, 171) - 0.5) * 0.22;
    const scores = [sandy + d, clay - d * 0.5, rocky];
    let best = 0;
    for (let i = 1; i < 3; i++) if (scores[i] > scores[best] + 1e-9) best = i;
    if (scores[best] < 0.18) best = 1; // padrão: argiloso moderado
    return best;
  }

  /** profundidade de solo (m) — encostas íngremes e rocha têm solo raso */
  soilDepth(cellX: number, cellY: number): number {
    const parent = this.soilParent(cellX, cellY);
    const { slope } = this.slopeAspect(cellX, cellY);
    const base = parent === 2 ? 0.25 : parent === 0 ? 0.9 : 1.1;
    return clamp(base * (1 - smoothstep(0.8, 2.2, slope) * 0.7), 0.08, 1.6);
  }

  /**
   * Lençol freático / nível de água potencial (elevação normalizada).
   * Lagos surgem onde a elevação fica abaixo dele; umidade base idem.
   */
  waterTable(cellX: number, cellY: number, climateWetness: number): number {
    const n = this.noise.fbm2(cellX * 0.011 - 71.5, cellY * 0.011 + 18.3, 3, 0.5, 2, 9) * 0.5 + 0.5;
    return this.cfg.waterTableBase + (n - 0.5) * 0.17 + (climateWetness - 0.5) * 0.1;
  }

  /**
   * Densidade de floresta [0,1]: combina umidade potencial, relevo e manchas
   * de vegetação com bordas irregulares (warp), criando bosques e clareiras.
   */
  forestDensity(cellX: number, cellY: number, wetness: number): number {
    const s = 1 / 42;
    const wx = this.warpX(cellX * 0.9, cellY * 0.9);
    const wy = this.warpY(cellX * 0.9, cellY * 0.9);
    const patch = this.noise.fbm2(wx * s, wy * s, 4, 0.55, 2.1, 13) * 0.5 + 0.5;
    const clearings = this.noise.fbm2(cellX * 0.006 + 5.5, cellY * 0.006 - 9.9, 3, 0.5, 2, 17) * 0.5 + 0.5;
    const open = smoothstep(0.62, 0.78, clearings); // clareiras grandes
    const smallOpen = smoothstep(0.7, 0.85, this.noise.fbm2(cellX * 0.03, cellY * 0.03, 3, 0.5, 2, 19) * 0.5 + 0.5);
    const { slope } = this.slopeAspect(cellX, cellY);
    const tooSteep = smoothstep(1.6, 2.6, slope);
    let d = smoothstep(0.32, 0.62, patch) * (0.55 + 0.45 * clamp(wetness * 1.4, 0, 1));
    d *= 1 - open * 0.92;
    d *= 1 - smallOpen * 0.55;
    d *= 1 - tooSteep * 0.8;
    return clamp(d, 0, 1);
  }

  /**
   * Campo de trilhas naturais: linhas de crista suavizadas de um ruído
   * independente → curvas sinuosas, não linhas geométricas.
   * Retorna intensidade [0,1] (1 = centro da trilha).
   */
  trailField(cellX: number, cellY: number): number {
    const n = this.noise.fbm2(cellX * 0.014 + 133.7, cellY * 0.014 + 77.1, 3, 0.5, 2, 29);
    const line = 1 - smoothstep(0.03, 0.14, Math.abs(n));
    const gate = smoothstep(0.45, 0.6, this.noise.fbm2(cellX * 0.008 - 40.2, cellY * 0.008 + 60.6, 2, 0.5, 2, 31) * 0.5 + 0.5);
    return clamp(line * gate, 0, 1);
  }
}
