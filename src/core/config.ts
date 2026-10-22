/**
 * Configuração central do mundo. Tudo que é "decisão de design" vive aqui,
 * para poder ser ajustado sem tocar nos sistemas.
 */

export interface WorldConfig {
  /** seed numérica do mundo */
  seed: number;
  /** versão do gerador — mudá-la invalida saves de terreno (ver persistência) */
  generatorVersion: number;

  /** lado do tile gráfico em pixels */
  tileSize: number;
  /** tiles por chunk (lado) */
  chunkTiles: number;
  /** tiles por célula de simulação (grade ambiental mais grossa que a gráfica) */
  simCellTiles: number;

  /** raio de chunks carregados ao redor do personagem */
  loadRadiusChunks: number;
  /** chunks extras carregados na direção do movimento */
  lookaheadChunks: number;
  /** chunks além do raio que são descarregados */
  unloadMarginChunks: number;
  /** máximo de chunks gerados por quadro (evita travamentos) */
  maxChunkGenPerFrame: number;

  // --- relevo ---
  /** amplitude total de elevação (metros simulados) */
  elevationRange: number;
  /** peso de montanhas (ridge) no relevo */
  mountainWeight: number;
  /** escala base do ruído continental (células porFeature) */
  continentScale: number;

  // --- hidrologia ---
  /** nível base do lençol freático (0..1 da elevação) — controla lagos */
  waterTableBase: number;
  /** acumulação mínima (células de contribuição) para nascer um córrego */
  streamThreshold: number;
  /** acumulação para rio permanente */
  riverThreshold: number;

  // --- tempo / astronomia ---
  /** minutos reais por dia de jogo (requisito: 24) */
  realMinutesPerDay: number;
  /** dias de jogo por ano (configurável e documentado: 28 dias = 4 estações de 7 dias) */
  daysPerYear: number;
  /** inclinação axial em graus (modelo astronômico simplificado) */
  axialTiltDeg: number;
  /** latitude do mundo em graus (dura a duração do dia ao longo do ano) */
  latitudeDeg: number;
  /** dia do ano em que o mundo começa */
  startDayOfYear: number;
  /** hora do dia em que o mundo começa */
  startHour: number;

  // --- simulação: períodos (em horas de jogo) ---
  /** umidade/água rápida */
  periodWaterHours: number;
  /** crescimento, decomposição, nutrientes */
  periodBioHours: number;
  /** erosão e transformação geológica */
  periodErosionHours: number;

  // --- vegetação ---
  /** densidade alvo de árvores por célula de simulação em floresta densa */
  maxTreesPerCell: number;
  /** raio de dispersão de sementes (células) */
  seedDispersalCells: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 1337,
  generatorVersion: 3,

  tileSize: 32,
  chunkTiles: 32,
  simCellTiles: 2,

  loadRadiusChunks: 3,
  lookaheadChunks: 2,
  unloadMarginChunks: 2,
  maxChunkGenPerFrame: 2,

  elevationRange: 60,
  mountainWeight: 0.55,
  continentScale: 96,

  waterTableBase: 0.225,
  streamThreshold: 70,
  riverThreshold: 300,

  realMinutesPerDay: 24,
  daysPerYear: 28,
  axialTiltDeg: 23.4,
  latitudeDeg: 32,
  startDayOfYear: 8,
  startHour: 8,

  periodWaterHours: 0.5,
  periodBioHours: 3,
  periodErosionHours: 24,

  maxTreesPerCell: 3,
  seedDispersalCells: 4,
};

export function cloneConfig(c: WorldConfig): WorldConfig {
  return { ...c };
}
