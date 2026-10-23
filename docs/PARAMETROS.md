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

## Ciclo causal: solo, atmosfera e fauna

### Solo (`chunk.ts` / `ecology.ts`)

| campo | faixa | significado |
| --- | --- | --- |
| `moisture` | 0..1 | saturação relativa (já existia) |
| `waterCapacity` | 0,15..3 | retenção = profundidade × textura × matéria orgânica |
| `compaction` | 0..1 | encosta/rocha compactam; vegetação e húmus descompactam |
| `forage` | 0..1 | camada herbácea (comida de coelho), cresce com luz+água |
| `coarse` | 0..6 | madeira/galhos (decomposição ~0,06 %/h) |
| `light` | 0..1 | sol × (1 − copa) × (1 − nuvens) |

`stepWater` devolve `{ evaporation, transpiration, runoff }` (m) usados pela
atmosfera; infiltração = `Ksolo × capacidade × (1 − 0,75·compactação) × (1 − saturação)`.

### Atmosfera (`climate.ts`)

| parâmetro | valor | efeito |
| --- | --- | --- |
| `condensationThreshold` | 0,56 | umidade acima disto condensa com convecção |
| `rainThreshold` | 0,30 | nuvem a partir da qual começa a chover |
| `evapoGain` / `humidityRelax` | 0,22 / 0,16 | peso da evapotranspiração / retorno ao equilíbrio |
| `condensationRate` | 0,26 | velocidade umidade → nuvem |
| `rainDrain` / `rainDrying` | 0,30 / 0,06 | chuva consome nuvem / seca o ar |
| passo | 0,25 h de jogo | custo fixo, independente de FPS |

Equilíbrio da umidade = `0,34 + 0,26·sazonal + 0,10·floresta + 0,08·água − 0,10·calor + 0,30·sinótico`.

### Fauna (necessidades)

| taxa | valor | efeito |
| --- | --- | --- |
| fome | +0,055/h | > 0,55 procura comida; > 0,85 corrói saúde |
| sede (ave) / (outros) | +0,035 / +0,055/h | > 0,5 bebe na água; > 0,75 procura água |
| saúde | −0,05·excesso/h | ≤ 0,02 morre e vira matéria orgânica |
| fezes | a cada 2,5–5,5 h após comer | +0,35 liteira, +N/P/K; semente com vigor |
| germinação com vigor | ×(1 + 2·vigor) | semente dispersada germina até 3× mais |

## Fauna visual (`src/world/fauna.ts`)

| item | valor | efeito |
| --- | --- | --- |
| `FAUNA_CAP` | coelho 3 · sapo 3 · ave 2 · **cobra 1** | teto de animais por chunk |
| velocidade | coelho 26 · sapo 14 · ave 34 px/s | passo local por hora de jogo |
| `searchCells` | 2–3 células | raio de busca de fruta/água |
| hábitos | coelho e ave diurnos, sapo noturno | dormem/ativos conforme a hora |
| fuga | raio de 70 px do jogador | prioridade máxima no estado |
| `MEMORY_HOURS` | 1,2 h de jogo | validade da memória de presa/ameaça |
| `MAX_CHASE_HOURS` | 1,5 h de jogo | tempo máximo de perseguição antes de desistir |
| cobra | `speed 40` · `attackRange 18` · `attackDamage 0,6` · `huntRange 190` | predador de emboscada com bote |
| cobra (bote) | 2,3× de velocidade em `chase`/`attack` | arranque curto, não é "míssil" |
| `STRIKE_WINDOW_HOURS` | 0,08 h | duração do estado `attack` (um bote) |
| `ATTACK_COOLDOWN_HOURS` | 0,22 h | descanso entre botes (dano nunca por tick) |
| `activityAt(kind, hora)` | 0..1 | curva de atividade: modula sono, velocidade e caça |
| `HURT_HOURS` | 0,05 h (~3 s reais) | reação de dor (pose/flash curto, não é estado) |
| `CORPSE_HOURS` | 1,0 h (~60 s reais) | carcaça imóvel no mundo antes de virar solo |
| `CORPSE_DECAY_HOURS` | 0,45 h | início da decomposição visível (restos/moscas) |

### Direções da fauna (`src/world/fauna.ts` + `src/render/manifest.ts`)

| item | valor | efeito |
| --- | --- | --- |
| `facingFromVector(dx, dy, anterior)` | histerese de 25% | eixo dominante decide N/S/L/O; sem piscar na diagonal |
| `Animal.facingDir` | `n · s · e · w` | linha do spritesheet usada no render |
| `faunaRow(sheet, anim, dir)` | linha `anim:dir` | resolve a linha e se precisa espelhar |
| `faunaFlip(sheet, anim, dir)` | só sem arte da direção | ave (folha de direção única) usa espelho |
| `alias` (manifesto) | ex.: `swim→walk`, `attack→strike` | estado sem arte própria usa a linha existente |
| células | coelho 24×21 · sapo 24×19 · cobra 30×21 · ave 19×14 | 1:1, dentro de ~1 tile de 32 px |

### Camada visual da fauna (`src/render/scene.ts`)

| item | valor | efeito |
| --- | --- | --- |
| escala | 1:1 (célula nativa) | coelho 21×17, sapo 27×15, ave 19×14, cobra 41×20 |
| âncora | base do sprite | ponto de contato no chão; sombra logo abaixo |
| direção | `flip` horizontal | escolhido pelo sinal de `vx`; Y não inverte o sprite |
| LOD | 420 px do centro da câmera | perto: efeitos + quadro animado; longe: quadro 0, sem sombra |
| efeitos | 1–6 `fill` por animal | poeira da fuga, ondulação da natação, "z" do sono, faísca de dor, brilho do bote, restos da carcaça |
| contagem de frames | `faunaFrameCount` (manifesto) | fonte única — `scene.ts` não duplica a tabela |

## Tileset de chão e água (`src/render/manifest.ts`)

| item | valor | efeito |
| --- | --- | --- |
| `DEFAULT_TILESET` | `'pack'` | folha de chão/água usada por padrão |
| `setActiveTileset(id)` / `activeTilesetId()` | `harmonious` \| `pack` | alternância em tempo real (tecla **T** no jogo) |
| `groundRect(kind, variant)` | recorte + arquivo | escolhe a variante pelo `chunk.groundVariant` |
| variantes | grama 4 · terra 2 · areia 2 · neve 1 | mais leitura sem trocar a física |
| espelho determinístico | `(tx + ty + variante) & 1` | 8 leituras por textura (quebra a grade) |
| água | 4 quadros, superfície + fundo | alpha 0,82 (pack) contra 0,92 (antigo) |
| `matchTone` | ganho limitado 0,72–1,35 | casa a paleta do pack com a do jogo |

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

## Ecossistema (`src/world/ecosystem.ts`)

| item | valor | efeito |
| --- | --- | --- |
| `MAX_FLOWERS` | 6 | flores por floração de uma planta adulta |
| `FLOWERING_HOURS` | 12 h (0,5 dia) | duração da antese antes de fechar a floração |
| `WIND_POLLINATION` | 0.04 | chance de polinização sem inseto (baixa: a visita importa) |
| `GROUND_FRUIT_HOURS` | 48 h | fruto no chão até decompor (vira liteira + semente) |
| `SEED_LIFE_HOURS` | 12 dias | semente viável no solo |
| `RECRUIT_CAP` / `SEED_BED_CAP` | 10 / 24 | tetos por chunk (sem explosão populacional) |
| `fruitRipenDays` (por espécie) | 0.7–1.6 dias | tempo de maturação do fruto |
| `fruitHoldDays` (por espécie) | 0.6–1.4 dias | permanência média do fruto maduro antes de cair |
| `fruitingSeason` (por espécie) | [0..1]⁴ | frutificação por estação (inverno ≈ 0) |

Arquivo de chunks fora de carga: até 192 chunks, 220 plantas por snapshot,
recuperação de no máximo 20 dias de jogo em ≤ 8 passos (`FF_MAX_HOURS`,
`FF_STEP_HOURS`, `FF_MAX_STEPS`, `ECO_SNAPSHOT_MAX_PLANTS`).

A queda usa risco acumulado: `1 − exp(−(Δt/hold)·(0,45 + idade²)·chuva)`, com
`hold` variando por espécie, saúde e por fruto (`holdBias`) — fruto maduro nunca
fica indefinidamente na planta.

## Recortes das árvores (`src/render/manifest.ts`)

`TREE_RECTS` é gerado por `npx tsx tools/gen-tree-frames.ts`, que mede cada
sprite como componente conexa de alpha (união das 5 variantes sazonais) e grava
`tools/data/tree-frames.json` + o bloco no manifesto. Assim o recorte sempre
inclui **copa + tronco** e nunca invade o sprite vizinho.

| porte | altura do recorte | observação |
| --- | --- | --- |
| `small` | 45–51 px | inalterado |
| `big` (média) | **88–96 px** | antes: 55–63 px → desenhava só a copa (bug do tronco) |
| `bigger` | 126–128 px | inalterado |

`tests/trees.test.ts` falha se qualquer variante não couber no recorte, se a
média tiver menos de 80 px de altura ou se dois recortes se sobrepuserem.
