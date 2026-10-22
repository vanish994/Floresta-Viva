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
  // --- física da água superficial (volume por célula) ---
  /** passo fixo da física (horas de jogo) — 0,02 h = 1,2 s reais */
  waterStepHours: number;
  /** limite de subpassos por passo (estabilidade numérica) */
  waterMaxSubsteps: number;
  /** raio (chunks) da região ativa de física; o anel externo serve de borda */
  waterActiveRadiusChunks: number;
  /** lado de uma célula de simulação em metros (escala do escoamento) */
  waterCellMeters: number;
  /** rugosidade Manning de base (canais) */
  waterManningBase: number;
  /** rugosidade máxima acrescentada por vegetação/obstáculos */
  waterManningVegetation: number;
  /** coeficiente de vazão: calibra a escala do mundo (não é 1 SI) */
  waterFlowScale: number;
  /** fração máxima da profundidade que pode sair de uma célula por subpasso */
  waterMaxOutflowFraction: number;
  /** velocidade máxima (m/s) para estabilidade e renderização */
  waterMaxVelocity: number;
  /** profundidade máxima de segurança (m) */
  waterMaxDepth: number;
  /** diferença de potencial abaixo da qual o fluxo é considerado nulo (m) */
  waterHeadEpsilon: number;
  /** chuva em metros por hora com intensidade 1 */
  rainPerHour: number;
  /** evaporação de água aberta em metros por hora (referência) */
  waterEvaporationPerHour: number;
  /** drenagem profunda de água acima do nível de base (m/h) */
  waterDrainagePerHour: number;
  /** recarga de rios pelo lençol (m/h) */
  waterBaseflowPerHour: number;
  /** recarga de lagos pelo lençol (m/h) */
  waterLakeSeepagePerHour: number;
  /** profundidade considerada inundação (m) */
  waterFloodDepth: number;
  /** horas de inundação a partir das quais a vegetação sofre estresse (h) */
  waterFloodStressHours: number;
  /** velocidade de correnteza que começa a arrancar plantas (m/s) */
  waterUprootSpeed: number;
  /** taxa de arrancamento por hora em condições plenas */
  waterUprootRate: number;
  /** tempo que leva para a velocidade relaxar (s) */
  waterVelocityRelaxSeconds: number;
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
  /** umidade/água rápida: passo curto para que a correnteza reaja sem demora */
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
  generatorVersion: 4,
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
  waterStepHours: 0.02,
  waterMaxSubsteps: 16,
  waterActiveRadiusChunks: 2,
  waterCellMeters: 8,
  waterManningBase: 0.075,
  waterManningVegetation: 0.06,
  waterFlowScale: 0.05,
  waterMaxOutflowFraction: 0.45,
  waterMaxVelocity: 4,
  waterMaxDepth: 30,
  waterHeadEpsilon: 1e-4,
  rainPerHour: 0.02,
  waterEvaporationPerHour: 0.0025,
  waterDrainagePerHour: 0.004,
  waterBaseflowPerHour: 0.02,
  waterLakeSeepagePerHour: 0.3,
  waterFloodDepth: 0.22,
  waterFloodStressHours: 2,
  waterUprootSpeed: 0.07,
  waterUprootRate: 0.22,
  waterVelocityRelaxSeconds: 0.8,
  realMinutesPerDay: 24,
  daysPerYear: 28,
  axialTiltDeg: 23.4,
  latitudeDeg: 32,
  startDayOfYear: 8,
  startHour: 8,
  periodWaterHours: 0.1,
  periodBioHours: 3,
  periodErosionHours: 24,
  maxTreesPerCell: 3,
  seedDispersalCells: 4,
};

export function cloneConfig(c: WorldConfig): WorldConfig {
  return { ...c };
}
