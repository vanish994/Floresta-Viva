# Parâmetros configuráveis

Tudo em `src/core/config.ts` (`DEFAULT_CONFIG`), sobrescrevível por `new World({...})`.

## Mundo / chunks

| parâmetro | padrão | efeito |
| --- | --- | --- |
| `seed` | 1337 | seed numérica do mundo |
| `generatorVersion` | 3 | invalida saves de terrenos antigos |
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
| `periodWaterHours` | 0.5 | passo da água/umidade |
| `periodBioHours` | 3 | passo de crescimento/decomposição/nutrientes |
| `periodErosionHours` | 24 | passo de erosão/geologia |

Referências do ciclo: 06:00 nascer do sol, 12:00 meio-dia, 18:00 pôr do sol no equinócio
(testado); transições de luz por smoothstep do seno de elevação solar.

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

Texturas: 0 arenoso (infiltração 0.85, retenção 0.45), 1 argiloso (0.45/0.90),
2 rochoso (0.60/0.35, raso), 3 florestal (0.55/1.15), 4 aluvial (0.35/0.80, fértil).
Campos por célula: `moisture, litter, humus, nAvail, pAvail, kAvail, pH, microbe, stress`.

## Renderização

- Água: bandas de alpha contínuo (`water_mid` + `water_deep` sobrepostos) por
  profundidade interpolada por tile; frames animados sincronizados (260 ms).
- Neve: chão/arbustos/árvores trocam de variante quando a máxima do dia < 7,5 °C.
- Iluminação: tint multiply + escuridão com furo de luz de ~150 px no personagem.
