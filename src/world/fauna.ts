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
