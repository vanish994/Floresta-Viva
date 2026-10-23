# Parâmetros configuráveis

Tudo em `src/core/config.ts` (`DEFAULT_CONFIG`), sobrescrevível por `new World({...})`.

## Mundo / chunks

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `seed` | 1337 | seed numérica do mundo |
| `generatorVersion` | 5 | invalida saves de terrenos antigos |
| `tileSize` | 32 px | tile gráfico (medido nos assets) |
| `chunkTiles` | 32 | tiles por lado do chunk (1024 px) |
| `simCellTiles` | 2 | tiles por célula de simulação (grade ambiental 2× mais grossa) |
| `loadRadiusChunks` | 3 | raio carregado ao redor do personagem |
| `lookaheadChunks` | 2 | anéis extras na direção do movimento |
| `unloadMarginChunks` | 2 | distância além do raio para descarregar |
| `maxChunkGenPerFrame` | 2 | orçamento de geração por frame (anti-travamento) |

## Relevo e hidrologia

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `elevationRange` | 60 m | amplitude total de elevação |
| `mountainWeight` | 0.55 | peso das cristas (montanhas) |
| `continentScale` | 96 cells | escala das formas continentais |
| `waterTableBase` | 0.225 | lençol freático base (controla quantidade de lagos ≈ 4%) |
| `streamThreshold` | 70 cells | acumulação para nascer córrego |
| `riverThreshold` | 300 cells | acumulação para rio permanente |

## Tempo, astronomia e clima

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `realMinutesPerDay` | **24** | minutos reais por dia de jogo (requisito) |
| `daysPerYear` | 28 | dias de jogo por ano → 4 estações de 7 dias (≈ 2,8 h reais/estação); escolha documentada para jogabilidade |
| `axialTiltDeg` | 23.4 | inclinação axial do modelo astronômico |
| `latitudeDeg` | 32 | latitude → variação da duração do dia |
| `startDayOfYear` / `startHour` | 8 / 8 | instante inicial |
| `periodWaterHours` | 0.5 | passo do balanço hídrico do solo |
| `periodBioHours` | 3 | passo de crescimento/decomposição/nutrientes |
| `periodErosionHours` | 24 | passo de erosão/deposição (morfologia) |
| `periodBankHours` | 1 | passo de margem (contato com água/textura de areia) |

Referências do ciclo: 06:00 nascer do sol, 12:00 meio-dia, 18:00 pôr do sol no equinócio
(testado); transições de luz por smoothstep do seno de elevação solar.

## Física da água (`src/world/water.ts`)

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `waterStepHours` | 0.02 h | passo fixo do solver (= 1,2 s reais); independe de FPS |
| `waterMaxSubsteps` | 16 | subpassos por chamada (estabilidade) |
| `waterActiveRadiusChunks` | 2 | chunks ativos (mobile: 1); o resto é borda |
| `waterCellMeters` | 8 m | lado da célula de simulação (escala do escoamento) |
| `waterManningBase` | 0.075 | rugosidade base (canais) |
| `waterManningVegetation` | 0.06 | rugosidade extra máxima por vegetação |
| `waterFlowScale` | 0.05 | coeficiente de vazão (calibração do mundo, não SI) |
| `waterMaxOutflowFraction` | 0.45 | fração máxima da lâmina que pode sair por subpasso |
| `waterMaxVelocity` | 4 m/s | teto de velocidade (estabilidade) |
| `waterMaxDepth` | 30 m | teto de lâmina (alívio contabilizado) |
| `waterHeadEpsilon` | 1e-4 m | Δhead mínimo para haver fluxo |
| `rainPerHour` | 0.02 m/h | chuva com intensidade 1 |
| `waterEvaporationPerHour` | 0.0025 m/h | evaporação de água aberta (× temperatura/luz) |
| `waterDrainagePerHour` | 0.004 m/h | drenagem profunda acima do nível de base |
| `waterBaseflowPerHour` | 0.02 m/h | recarga de rio por unidade de contribuição local |
| `waterLakeSeepagePerHour` | 0.3 m/h | recarga máxima de lagos |
| `waterFloodDepth` | 0.22 m | lâmina considerada inundação |
| `waterFloodStressHours` | 2 h | tempo de alagamento que começa a estressar |
| `waterUprootSpeed` | 0.07 m/s | velocidade que começa a arrancar plantas |
| `waterUprootRate` | 0.22 /h | taxa base de arrancamento |
| `waterVelocityRelaxSeconds` | 0.8 s | inércia da velocidade (evita direção "piscando") |

Ksat por textura (m/h): arenoso 0,12 · argiloso 0,02 · rochoso 0,006 · florestal 0,05 ·
aluvial 0,04. Leito de rio/lago infiltra 15–20% do valor da margem.

## Erosão, sedimentos e margens (`src/world/sediment.ts`)

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `periodErosionHours` | 24 h | intervalo da morfologia (erosão + transporte + deposição) |
| `erosionSubstepHours` / `erosionMaxSubsteps` | 8 h / 4 | discretização interna (estabilidade) |
| `erosionActiveRadiusChunks` | 1 | chunks ativos da morfologia (a água usa 2) |
| `erosionRate` | 0.09 | coeficiente global de desagregação |
| `erosionMaxRatePerHour` | 0.006 m/h | teto de rebaixamento por hora |
| `sedimentCapacity` | 0.05 | capacidade de transporte (∝ v^1,5·√prof) |
| `sedimentMaxLoad` | 0.004 | carga máxima por célula; excedente assenta |
| `sedimentDepositionPerHour` | 0.00008 | taxa base de deposição |
| `sedimentTransportSpeed` | 0.04 m/s | velocidade em que a carga avança uma célula/subpasso |
| `sandLayerMeters` | 0.04 m | espessura de referência para misturar textura |
| `sandMinLayerMeters` | 0.01 m | depósito mínimo para classificar areia |
| `sandThreshold` / `sandRevertThreshold` | 0.55 / 0.36 | histerese de classificação areia↔terra |
| `sandWinnowCap` | 0.5 | teto da lavagem seletiva (abaixo do limiar: não cria areia) |
| `shoreHoursForSand` | 3 h | contato com água para iniciar a lavagem |
| `sandWinnowRate` | 0.12 /h | velocidade da lavagem seletiva |
| `sandRecoveryRate` | 0.002 /h | recuperação do solo sob vegetação estabelecida |
| `shoreMemoryHours` | 24 h | memória do contato com água quando a célula seca |
| `bankMaxSlope` | 1.2 | declive máximo para uma margem acumular areia |
| `rootExposureMeters` | 0.12 m | erosão que começa a expor raízes |

Textura inicial de areia por solo (`sandBase`): arenoso 0,85 · aluvial 0,35 ·
florestal 0,15 · argiloso 0,10 · rochoso 0,03.

## Personagem / natação (`src/game/player.ts`)

| constante | valor | efeito |
| --- | --- | --- |
| `SWIM_DEPTH_M` | 0.45 m | acima disso o personagem nada (abaixo, vadea ou anda) |
| `WADE_DEPTH_M` | 0.15 m | acima disso andar fica lento (vadeo) |
| `swimSpeed` | 78 px/s | velocidade nadando (terra: 150, vadeando: 82,5) |
| `exhaustedSwimFactor` | 0.35 | fração da velocidade com fôlego zerado (flutuando) |
| `currentFactor` | 14 | converte m/s da correnteza em px/s de empurrão (escala de jogo) |
| `staminaDrain` | 0.032 /s | consumo de fôlego nadando (× até 2,4 contra a correnteza) |
| `staminaRegenLand` / `staminaRegenShallow` | 0.35 / 0.12 /s | recuperação de fôlego |

## Vegetação

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `maxTreesPerCell` | 3 | tetos de candidatos por célula (×2 slots com jitter) |
| `seedDispersalCells` | 4 | raio base de dispersão (espécies têm o próprio) |

## Traços das espécies (`src/world/flora.ts`)

`waterNeed, droughtTolerance, floodTolerance, lightNeed, shadeTolerance,
soilAffinity[arenoso,argiloso,rochoso], tempOpt, tempMin, growthRate, maturityAge,
longevity, seedRate, dispersal, litterRate, rootDepth, canopy, nutrientNeed[N,P,K]`.

| espécie | porte | estratégia |
| --- | --- | --- |
| Embaúba | small | pioneira heliófila, rápida, curta |
| Ipê-amarelo | big | decídua (outono), tolerante à seca |
| Maçaneira-brava | small | decídua de sub-bosque claro |
| Salgueiro | big | ripário, tolera inundação |
| Jequitibá | bigger | clímax, lento, longo, solo argiloso/florestal |
| Araucária | bigger | tolera frio, look de neve no inverno |

Aparência por estação (`look`) mapeia para as variantes reais do pacote
(normal/autumn/winter/snow/vines).

## Solo (`src/world/chunk.ts`)

Texturas: 0 arenoso (Ksat 0,12 · retenção 0,45), 1 argiloso (0,02/0,90),
2 rochoso (0,006/0,35, raso), 3 florestal (0,05/1,15), 4 aluvial (0,04/0,80, fértil).
A mesma tabela de Ksat é usada pelo balanço de solo e pela infiltração da lâmina.
Campos por célula: `moisture, litter, humus, nAvail, pAvail, kAvail, pH, microbe, stress`.

## Renderização

- Água: bandas de alpha contínuo (`water_mid` + `water_deep` sobrepostos) por
  profundidade interpolada por tile; alpha `(d−0,025)/0,22`, camada profunda a partir
  de 0,35 m; filetes na direção de `flowX/flowY` e espuma só acima de 0,085 m/s;
  frames aceleram com a velocidade real.
- Neve: chão/arbustos/árvores trocam de variante quando a máxima do dia < 7,5 °C.
- Iluminação: tint multiply + escuridão com furo de luz de ~150 px no personagem.
