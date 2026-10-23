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

/**
 * Estado atmosférico agregado (não é meteorologia pesada): dois reservatórios
 * — umidade do ar e água condensada nas nuvens — alimentados por
 * evaporação/transpiração e drenados pela precipitação. A chuva passa a ser
 * CONSEQUÊNCIA desse estado, não um número sorteado.
 */
export interface AtmosphereState {
  /** umidade relativa do ar 0..1 */
  humidity: number;
  /** água condensada disponível nas nuvens 0..1 (reservatório) */
  cloudWater: number;
  /** cobertura de nuvens 0..1 (visual/debug) */
  cloudCover: number;
  /** convecção/instabilidade 0..1 (calor + sol + vento) */
  convection: number;
  /** vento 0..1 */
  wind: number;
  /** intensidade de precipitação 0..1 no instante */
  precipitation: number;
}

export interface AtmosphereForcing {
  /** temperatura do ar (°C) */
  temperature: number;
  /** fluxo de evaporação do mundo carregado (0..1 normalizado) */
  evaporation: number;
  /** transpiração da vegetação carregada (0..1) */
  transpiration: number;
  /** biomassa relativa da floresta carregada (0..1) */
  forest: number;
  /** fração de superfície com água (0..1) */
  waterSurface: number;
  /** horas do dia 0..23 (convecção) */
  hour: number;
  /** dia de jogo (sazonalidade/sinótica) */
  dayFloat: number;
}

/** limiares e taxas do ciclo (por hora de jogo) */
export const ATMOS = {
  /** umidade acima disto condensa quando há convecção */
  condensationThreshold: 0.56,
  /** água de nuvem a partir da qual começa a chover */
  rainThreshold: 0.30,
  /** escala do ganho de umidade por evapotranspiração */
  evapoGain: 0.22,
  /** relaxamento da umidade em direção ao equilíbrio sazonal */
  humidityRelax: 0.16,
  /** taxa de condensação (umidade → nuvem) */
  condensationRate: 0.26,
  /** consumo de nuvem pela chuva */
  rainDrain: 0.30,
  /** secagem do ar pela chuva */
  rainDrying: 0.06,
} as const;

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

  /** estado atmosférico corrente (persistido no save do mundo) */
  readonly atmosphere: AtmosphereState = {
    humidity: 0.55,
    cloudWater: 0.08,
    cloudCover: 0.12,
    convection: 0.3,
    wind: 0.35,
    precipitation: 0,
  };

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.noise = new ValueNoise(cfg.seed ^ 0x51ab);
    this.msPerGameMinute = (cfg.realMinutesPerDay * 60 * 1000) / 1440;
  }

  /** vento determinístico 0..1 (varia com o dia/noite e a estação) */
  windAt(dayFloat: number): number {
    const n = this.noise.fbm2(dayFloat * 0.7, 3.3, 3, 0.5, 2, 11) * 0.5 + 0.5;
    const diurnal = 0.25 + 0.35 * Math.abs(Math.sin(((dayFloat % 1) * 24 * Math.PI) / 24));
    return clamp(n * 0.7 + diurnal * 0.5, 0, 1);
  }

  /**
   * Avança o ciclo atmosférico por `hours` horas de jogo.
   *
   * Fonte → umidade (evaporação + transpiração) → condensação se há convecção
   * → nuvem → precipitação quando a nuvem satura. A chuva consome nuvem e seca
   * o ar, fechando o ciclo; a vegetação e a água superficial puxam a umidade de
   * equilíbrio para cima (floresta → mais umidade, nunca garantia de chuva).
   */
  stepAtmosphere(hours: number, f: AtmosphereForcing): AtmosphereState {
    const a = this.atmosphere;
    const h = Math.max(0, hours);
    if (h === 0) return a;
    const seasonWet = this.seasonWetness(f.dayFloat);
    const sky = this.sky(f.dayFloat, f.hour);
    const tempF = clamp((f.temperature - 4) / 30, 0, 1);
    const synoptic = this.rainIntensity(f.dayFloat); // potencial de grande escala
    a.wind = this.windAt(f.dayFloat);

    // --- equilíbrio da umidade: estação + floresta + água − calor -------------
    // equilíbrio da umidade: clima de grande escala (sinótico) + estação,
    // com floresta/água puxando para cima e calor puxando para baixo
    const equilibrium = clamp(
      0.34 + 0.26 * seasonWet + 0.10 * clamp(f.forest, 0, 1) + 0.08 * clamp(f.waterSurface, 0, 1)
        - 0.10 * tempF + 0.30 * synoptic,
      0.05,
      0.98,
    );
    const evapo = clamp(f.evaporation, 0, 1) * 0.6 + clamp(f.transpiration, 0, 1) * 0.8;
    let humidity = a.humidity + h * ((equilibrium - a.humidity) * ATMOS.humidityRelax + evapo * ATMOS.evapoGain);

    // --- convecção: calor + sol + vento (a noite estabiliza) -----------------
    a.convection = clamp(
      (0.15 + 0.45 * tempF + 0.35 * sky.light + 0.15 * a.wind) * clamp(seasonWet, 0.25, 1.2),
      0,
      1,
    );

    // --- condensação: umidade acima do limiar com convecção ------------------
    const excess = Math.max(0, humidity - ATMOS.condensationThreshold);
    const condensation = excess * 4.0 * a.convection;
    let cloudWater = a.cloudWater + h * (condensation * ATMOS.condensationRate
      // nuvem também se dissipa devagar quando não chove
      - a.cloudWater * 0.015);
    humidity -= h * condensation * 0.02;

    // --- precipitação: precisa de nuvem E instabilidade -----------------------
    // saturação da nuvem define a intensidade; convecção forte pode virar
    // tempestade. Chuva só existe com nuvem carregada (nunca "sorteada").
    const saturation = smoothstep(ATMOS.rainThreshold * 0.55, ATMOS.rainThreshold * 2.3, cloudWater);
    a.precipitation = clamp(
      saturation * (0.45 + 0.75 * a.convection) * clamp(seasonWet, 0.25, 1.15),
      0,
      1,
    );
    // chuva consome a nuvem e seca o ar (retroalimentação negativa)
    cloudWater -= h * a.precipitation * ATMOS.rainDrain;
    humidity -= h * a.precipitation * ATMOS.rainDrying;

    a.humidity = clamp(humidity, 0.02, 1);
    a.cloudWater = clamp(cloudWater, 0, 1);
    a.cloudCover = clamp(smoothstep(0.05, 0.45, a.cloudWater) * (0.5 + 0.5 * a.convection), 0, 1);
    return a;
  }

  /** chuva efetiva AGORA (causal); usada pelo mundo, render e áudio */
  precipitationNow(): number {
    if (this.rainOverride) return 1;
    return clamp(this.atmosphere.precipitation, 0, 1);
  }

  /** cobertura de nuvens agora (sombreamento/render) */
  cloudCoverNow(): number {
    return clamp(this.atmosphere.cloudCover, 0, 1);
  }

  /** classifica a chuva atual (HUD/debug e efeitos por intensidade) */
  rainKind(): 'seco' | 'garoa' | 'leve' | 'normal' | 'forte' | 'tempestade' {
    const p = this.precipitationNow();
    if (p < 0.04) return 'seco';
    if (p < 0.18) return 'garoa';
    if (p < 0.38) return 'leve';
    if (p < 0.62) return 'normal';
    if (p < 0.85) return 'forte';
    return 'tempestade';
  }

  /** estado atmosférico serializável (save do mundo) */
  exportAtmosphere(): AtmosphereState {
    return { ...this.atmosphere };
  }

  importAtmosphere(state: Partial<AtmosphereState> | undefined): void {
    if (!state) return;
    Object.assign(this.atmosphere, {
      humidity: clamp(state.humidity ?? this.atmosphere.humidity, 0, 1),
      cloudWater: clamp(state.cloudWater ?? this.atmosphere.cloudWater, 0, 1),
      cloudCover: clamp(state.cloudCover ?? this.atmosphere.cloudCover, 0, 1),
      convection: clamp(state.convection ?? this.atmosphere.convection, 0, 1),
      wind: clamp(state.wind ?? this.atmosphere.wind, 0, 1),
      precipitation: clamp(state.precipitation ?? 0, 0, 1),
    });
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