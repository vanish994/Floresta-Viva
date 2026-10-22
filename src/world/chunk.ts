/**
 * Chunk: janela de armazenamento do mundo. A geração é determinística por
 * coordenadas globais; o chunk apenas materializa e guarda o estado dinâmico
 * (solo, plantas, decorações) da sua região, além de diffs persistidos.
 */
import type { WorldConfig } from '../core/config';
import { cellsPerChunk } from '../core/coords';
import type { PlantRecord } from './flora';

const EMPTY: PlantRecord[] = [];

export const SOIL_SAND = 0;
export const SOIL_CLAY = 1;
export const SOIL_ROCK = 2;
export const SOIL_FOREST = 3;
export const SOIL_ALLUVIAL = 4;

export interface DecorItem {
  /** chave de sprite no manifesto (bush, grass_1, rock_3, leaves_1, sticks_2...) */
  kind: string;
  /** posição global em px */
  x: number;
  y: number;
  variant: number;
  flip: boolean;
  /** camada: 0 = chão (sob sprites), 1 = objeto */
  layer: 0 | 1;
}

export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly n: number; // células de simulação por lado
  readonly tiles: number; // tiles por lado

  // --- relevo/hidro (por célula) ---
  elev!: Float32Array;
  slope!: Float32Array;
  aspect!: Float32Array;
  waterDepth!: Float32Array;
  waterKind!: Uint8Array;
  acc!: Float32Array;
  flowDir!: Int8Array;

  // --- solo (por célula) ---
  soilType!: Uint8Array;
  soilDepth!: Float32Array;
  moisture!: Float32Array; // 0..1
  litter!: Float32Array; // matéria orgânica fresca (kg/m² relativo)
  humus!: Float32Array; // húmus estável
  nAvail!: Float32Array; // nitrogênio disponível
  pAvail!: Float32Array; // fósforo disponível
  kAvail!: Float32Array; // potássio disponível
  pH!: Float32Array;
  microbe!: Float32Array; // atividade dos decompositores 0..1
  stress!: Float32Array; // estresse hídrico acumulado da vegetação

  // --- gráficos (por tile) ---
  groundVariant!: Uint8Array;
  trail!: Uint8Array; // 0 = sem trilha, 1..255 intensidade
  cliff!: Uint8Array; // 0 = plano, bits = bordas íngremes (S, SW, SE, W, E)

  plants: PlantRecord[] = [];
  /** plantas removidas (ids) — aplicadas sobre a geração determinística */
  removedPlants = new Set<number>();
  /** plantas recrutadas pela simulação (persistem) */
  recruitedPlants: PlantRecord[] = [];
  decor: DecorItem[] = [];
  removedDecor = new Set<number>();

  /** relógios de simulação deste chunk (horas de jogo), por frequência */
  lastWaterHour = 0;
  lastBioHour = 0;
  lastErosionHour = 0;
  dirty = false;
  /** solo modificado pela simulação (precisa ir para o save) */
  soilDirty = false;
  ready = false;

  constructor(cx: number, cy: number, cfg: WorldConfig) {
    this.cx = cx;
    this.cy = cy;
    this.n = cellsPerChunk(cfg);
    this.tiles = cfg.chunkTiles;
    this.alloc();
  }

  private alloc() {
    const c = this.n * this.n;
    const t = this.tiles * this.tiles;
    this.elev = new Float32Array(c);
    this.slope = new Float32Array(c);
    this.aspect = new Float32Array(c);
    this.waterDepth = new Float32Array(c);
    this.waterKind = new Uint8Array(c);
    this.acc = new Float32Array(c);
    this.flowDir = new Int8Array(c);
    this.soilType = new Uint8Array(c);
    this.soilDepth = new Float32Array(c);
    this.moisture = new Float32Array(c);
    this.litter = new Float32Array(c);
    this.humus = new Float32Array(c);
    this.nAvail = new Float32Array(c);
    this.pAvail = new Float32Array(c);
    this.kAvail = new Float32Array(c);
    this.pH = new Float32Array(c);
    this.microbe = new Float32Array(c);
    this.stress = new Float32Array(c);
    this.groundVariant = new Uint8Array(t);
    this.trail = new Uint8Array(t);
    this.cliff = new Uint8Array(t);
  }

  cellIdx(lx: number, ly: number): number {
    return ly * this.n + lx;
  }
  tileIdx(lx: number, ly: number): number {
    return ly * this.tiles + lx;
  }

  /** todas as plantas vivas visíveis (geradas + recrutadas - removidas) */
  *livePlants(): Generator<PlantRecord> {
    for (const p of this.plants) if (!this.removedPlants.has(p.id)) yield p;
    for (const p of this.recruitedPlants) if (!this.removedPlants.has(p.id)) yield p;
  }

  /** índice espacial por célula de simulação (acelera ecologia/colisão) */
  plantIndex = new Map<number, PlantRecord[]>();
  rebuildPlantIndex(): void {
    this.plantIndex.clear();
    const cellPx = (this.tiles * 32) / this.n;
    const add = (p: PlantRecord) => {
      if (this.removedPlants.has(p.id)) return;
      const lx = Math.min(this.n - 1, Math.max(0, Math.floor(p.x / cellPx) - this.cx * this.n));
      const ly = Math.min(this.n - 1, Math.max(0, Math.floor(p.y / cellPx) - this.cy * this.n));
      const k = this.cellIdx(lx, ly);
      const arr = this.plantIndex.get(k);
      if (arr) arr.push(p);
      else this.plantIndex.set(k, [p]);
    };
    for (const p of this.plants) add(p);
    for (const p of this.recruitedPlants) add(p);
  }
  plantsInCell(lx: number, ly: number): PlantRecord[] {
    return this.plantIndex.get(this.cellIdx(lx, ly)) ?? EMPTY;
  }
}
