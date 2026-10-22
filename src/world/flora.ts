/**
 * Espécies vegetais com traços ecológicos configuráveis.
 * Nada aqui é decorativo: os traços decidem onde cada espécie germina,
 * cresce, compete, reproduz e morre.
 */

export type SeasonLook = 'normal' | 'autumn' | 'winter' | 'snow' | 'vines';
export type SizeClass = 'small' | 'big' | 'bigger';

export interface Species {
  id: string;
  name: string;
  /** classe de sprite (altura/silhueta) */
  size: SizeClass;
  /** aparência por estação (índice em TREE_FILES[size]) */
  look: Record<'spring' | 'summer' | 'autumn' | 'winter', SeasonLook>;
  /** perde folhas no outono/inverno? */
  deciduous: boolean;
  /** 0..1 necessidade de água no solo */
  waterNeed: number;
  /** tolerância à seca 0..1 */
  droughtTolerance: number;
  /** tolerância a inundação 0..1 */
  floodTolerance: number;
  /** 0..1 necessidade de luz (1 = pioneira heliófila) */
  lightNeed: number;
  /** tolerância à sombra 0..1 */
  shadeTolerance: number;
  /** afinidade por tipo de solo [arenoso, argiloso, rochoso] */
  soilAffinity: [number, number, number];
  /** temperatura ótima e mínima (°C) */
  tempOpt: number;
  tempMin: number;
  /** crescimento (fração de maturidade por dia de jogo em condições ótimas) */
  growthRate: number;
  /** idade de maturidade e longevidade (dias de jogo) */
  maturityAge: number;
  longevity: number;
  /** produção de sementes (pressão por dia) e raio de dispersão (células) */
  seedRate: number;
  dispersal: number;
  /** liteira produzida por unidade de biomassa/dia */
  litterRate: number;
  /** profundidade de raiz (m) — acesso a água profunda e estabilização do solo */
  rootDepth: number;
  /** raio de copa (células) — sombra e competição */
  canopy: number;
  /** nutrientes demandados (N,P,K) relativos */
  nutrientNeed: [number, number, number];
}

export const SPECIES: Species[] = [
  {
    id: 'embauba', name: 'Embaúba', size: 'small', deciduous: false,
    look: { spring: 'vines', summer: 'vines', autumn: 'vines', winter: 'vines' },
    waterNeed: 0.62, droughtTolerance: 0.25, floodTolerance: 0.55, lightNeed: 0.9, shadeTolerance: 0.15,
    soilAffinity: [0.7, 0.8, 0.3], tempOpt: 24, tempMin: 6,
    growthRate: 0.02, maturityAge: 40, longevity: 220, seedRate: 0.9, dispersal: 6,
    litterRate: 0.9, rootDepth: 0.5, canopy: 1.1, nutrientNeed: [0.7, 0.5, 0.6],
  },
  {
    id: 'jequitiba', name: 'Jequitibá', size: 'bigger', deciduous: false,
    look: { spring: 'normal', summer: 'normal', autumn: 'normal', winter: 'normal' },
    waterNeed: 0.55, droughtTolerance: 0.45, floodTolerance: 0.3, lightNeed: 0.45, shadeTolerance: 0.55,
    soilAffinity: [0.3, 0.95, 0.25], tempOpt: 22, tempMin: 4,
    growthRate: 0.006, maturityAge: 120, longevity: 900, seedRate: 0.35, dispersal: 3,
    litterRate: 1.2, rootDepth: 1.4, canopy: 2.2, nutrientNeed: [0.9, 0.8, 0.8],
  },
  {
    id: 'ipe_amarelo', name: 'Ipê-amarelo', size: 'big', deciduous: true,
    look: { spring: 'normal', summer: 'normal', autumn: 'autumn', winter: 'winter' },
    waterNeed: 0.42, droughtTolerance: 0.7, floodTolerance: 0.2, lightNeed: 0.75, shadeTolerance: 0.3,
    soilAffinity: [0.75, 0.6, 0.5], tempOpt: 25, tempMin: 8,
    growthRate: 0.01, maturityAge: 70, longevity: 420, seedRate: 0.6, dispersal: 5,
    litterRate: 1.0, rootDepth: 0.9, canopy: 1.6, nutrientNeed: [0.6, 0.7, 0.6],
  },
  {
    id: 'araucaria', name: 'Araucária', size: 'bigger', deciduous: false,
    look: { spring: 'snow', summer: 'normal', autumn: 'normal', winter: 'snow' },
    waterNeed: 0.5, droughtTolerance: 0.4, floodTolerance: 0.15, lightNeed: 0.65, shadeTolerance: 0.35,
    soilAffinity: [0.5, 0.7, 0.7], tempOpt: 16, tempMin: -6,
    growthRate: 0.007, maturityAge: 100, longevity: 700, seedRate: 0.4, dispersal: 4,
    litterRate: 0.8, rootDepth: 1.2, canopy: 1.8, nutrientNeed: [0.6, 0.6, 0.7],
  },
  {
    id: 'salgueiro', name: 'Salgueiro', size: 'big', deciduous: true,
    look: { spring: 'vines', summer: 'vines', autumn: 'autumn', winter: 'winter' },
    waterNeed: 0.85, droughtTolerance: 0.1, floodTolerance: 0.95, lightNeed: 0.7, shadeTolerance: 0.25,
    soilAffinity: [0.6, 0.75, 0.2], tempOpt: 20, tempMin: 0,
    growthRate: 0.014, maturityAge: 50, longevity: 300, seedRate: 0.7, dispersal: 4,
    litterRate: 1.1, rootDepth: 0.7, canopy: 1.5, nutrientNeed: [0.8, 0.6, 0.7],
  },
  {
    id: 'macaneira', name: 'Maçaneira-brava', size: 'small', deciduous: true,
    look: { spring: 'normal', summer: 'normal', autumn: 'autumn', winter: 'winter' },
    waterNeed: 0.5, droughtTolerance: 0.5, floodTolerance: 0.25, lightNeed: 0.6, shadeTolerance: 0.5,
    soilAffinity: [0.6, 0.8, 0.4], tempOpt: 19, tempMin: -2,
    growthRate: 0.012, maturityAge: 45, longevity: 260, seedRate: 0.5, dispersal: 3,
    litterRate: 0.9, rootDepth: 0.6, canopy: 1.2, nutrientNeed: [0.7, 0.7, 0.7],
  },
];

export const speciesIndex = (id: string): number => SPECIES.findIndex((s) => s.id === id);

export interface PlantRecord {
  /** id estável (hash de célula+slot) */
  id: number;
  species: number;
  /** posição global em pixels (pivô na base) */
  x: number;
  y: number;
  /** idade inicial (dias de jogo "nascidos" antes do início) */
  birthAge: number;
  /** variação visual determinística */
  variant: number;
  /** origem: 'gen' = gerado pela seed, 'recruit' = recrutado pela simulação */
  origin: 'gen' | 'recruit';
}
