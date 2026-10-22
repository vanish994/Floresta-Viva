/**
 * Relógio do mundo + modelo astronômico simplificado + clima.
 *
 * - 1 dia de jogo = `realMinutesPerDay` minutos reais (padrão 24 → 1 min de jogo = 1 s real).
 * - O ano tem `daysPerYear` dias de jogo (padrão 28 → 4 estações de 7 dias),
 *   duração configurável e documentada.
 * - A declinação solar segue a inclinação axial (23,4°) e a posição orbital;
 *   a duração do dia/noite varia ao longo do ano pela latitude.
 * - Tempo de jogo, hora local simulada e tempo real são grandezas separadas:
 *   o relógio visual avança por frame, os processos ambientais avançam por
 *   passos fixos em horas de jogo (independentes de FPS).
 */
import type { WorldConfig } from '../core/config';
import { ValueNoise, clamp, smoothstep } from '../core/rng';

export const SEASONS = ['primavera', 'verão', 'outono', 'inverno'] as const;
export type Season = (typeof SEASONS)[number];

const DEG = Math.PI / 180;

export interface SkyState {
  /** elevação solar (seno) */
  sinElevation: number;
  /** 0..1 nível de luz diurna (com crepúsculo suave) */
  light: number;
  sunriseHour: number;
  sunsetHour: number;
  dayLengthHours: number;
  declinationDeg: number;
}

export class Climate {
  readonly cfg: WorldConfig;
  private noise: ValueNoise;
  private rainOverride = false;
  /** ms reais por minuto de jogo */
  readonly msPerGameMinute: number;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.noise = new ValueNoise(cfg.seed ^ 0x51ab);
    this.msPerGameMinute = (cfg.realMinutesPerDay * 60 * 1000) / 1440;
  }

  /** Ativa/desativa chuva manual; usado temporariamente pelo botão de teste. */
  setRainOverride(enabled: boolean): void {
    this.rainOverride = enabled;
  }

  /** fração do ano [0,1) a partir do dia de jogo absoluto */
  yearFraction(dayFloat: number): number {
    const d = (this.cfg.startDayOfYear + dayFloat) % this.cfg.daysPerYear;
    return d / this.cfg.daysPerYear;
  }

  seasonIndex(dayFloat: number): number {
    return Math.floor(this.yearFraction(dayFloat) * 4) % 4;
  }
  seasonName(dayFloat: number): Season {
    return SEASONS[this.seasonIndex(dayFloat)];
  }
  /** dia dentro da estação (0..diasPorEstacao) */
  dayOfSeason(dayFloat: number): number {
    const per = this.cfg.daysPerYear / 4;
    return ((this.cfg.startDayOfYear + dayFloat) % this.cfg.daysPerYear) % per;
  }

  /** declinação solar (graus) — modelo determinístico de órbita circular */
  declination(dayFloat: number): number {
    const yf = this.yearFraction(dayFloat);
    return this.cfg.axialTiltDeg * Math.sin(2 * Math.PI * (yf - 0.125));
  }

  sky(dayFloat: number, hour: number): SkyState {
    const dec = this.declination(dayFloat) * DEG;
    const lat = this.cfg.latitudeDeg * DEG;
    const cosH0 = -Math.tan(lat) * Math.tan(dec);
    const H0 = cosH0 <= -1 ? Math.PI : cosH0 >= 1 ? 0 : Math.acos(cosH0);
    const dayLengthHours = (2 * H0) / (2 * Math.PI) * 24;
    const sunriseHour = 12 - dayLengthHours / 2;
    const sunsetHour = 12 + dayLengthHours / 2;
    const H = ((hour - 12) / 24) * 2 * Math.PI;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const light = clamp(smoothstep(-0.14, 0.16, sinEl), 0, 1);
    return { sinElevation: sinEl, light, sunriseHour, sunsetHour, dayLengthHours, declinationDeg: dec / DEG };
  }

  /** temperatura do ar (°C) num instante, para uma elevação normalizada 0..1 */
  temperature(dayFloat: number, hour: number, elevNorm: number): number {
    const yf = this.yearFraction(dayFloat);
    const latFactor = Math.sin(Math.abs(this.cfg.latitudeDeg) * DEG) / Math.sin(45 * DEG);
    const seasonAmp = 15 * latFactor;
    const seasonal = 13 + seasonAmp * Math.sin(2 * Math.PI * (yf - 0.125));
    const sky = this.sky(dayFloat, hour);
    // diurna: pico ~15h, mínima ~05h, amplitude maior com céu aberto/secas
    const diurnal = 5.5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    const cloud = this.rainIntensity(dayFloat) * 2.5;
    const lapse = -9 * elevNorm;
    return seasonal + diurnal * (0.4 + 0.6 * sky.light) - cloud + lapse;
  }

  /** umidade climática média anual (usada pela geração: forma do mundo) */
  meanWetness(): number {
    return 0.52;
  }

  /** fator sazonal de chuva [0.35..1.2] */
  seasonWetness(dayFloat: number): number {
    const yf = this.yearFraction(dayFloat);
    // verão mais chuvoso, inverno mais seco (regime de monção suave)
    return 0.78 + 0.42 * Math.sin(2 * Math.PI * (yf - 0.1));
  }

  /** intensidade de chuva agora [0..1] — feixes de chuva determinísticos por dia/hora */
  rainIntensity(dayFloat: number): number {
    if (this.rainOverride) return 1;
    const t = dayFloat;
    const spell = this.noise.fbm2(t * 0.55, 7.7, 3, 0.55, 2.1, 3) * 0.5 + 0.5;
    const gate = smoothstep(0.55, 0.72, spell);
    const burst = this.noise.fbm2(t * 2.3, -3.1, 2, 0.5, 2, 5) * 0.5 + 0.5;
    return clamp(gate * (0.35 + 0.65 * burst) * this.seasonWetness(dayFloat), 0, 1);
  }

  /** precipitação acumulada de um dia (mm) — para balanço hídrico */
  dayRainfall(day: number): number {
    let sum = 0;
    for (let h = 0; h < 24; h += 2) sum += this.rainIntensity(day + h / 24) * 2;
    return sum * 1.6; // mm/dia efetivos
  }
}

/** Relógio do mundo: converte tempo real acumulado em tempo de jogo. */
export class GameClock {
  /** minutos de jogo acumulados (float) */
  gameMinutes = 0;
  paused = false;
  /** multiplicador de tempo (debug) */
  speed = 1;

  constructor(private climate: Climate, startHour: number) {
    this.gameMinutes = startHour * 60;
  }

  advance(realMs: number): void {
    if (this.paused) return;
    this.gameMinutes += (realMs / this.climate.msPerGameMinute) * this.speed;
  }

  get day(): number {
    return Math.floor(this.gameMinutes / 1440);
  }
  get dayFloat(): number {
    return this.gameMinutes / 1440;
  }
  get hour(): number {
    return (this.gameMinutes % 1440) / 60;
  }
  get totalHours(): number {
    return this.gameMinutes / 60;
  }
  /** hh:mm formatado */
  get label(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor(this.gameMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}