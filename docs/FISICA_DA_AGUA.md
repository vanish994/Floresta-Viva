# Física real da água — Floresta Viva

Este documento registra a entrega da simulação física da água: diagnóstico do
problema original, arquivos alterados, modelo adotado, garantias de conservação,
testes executados com resultados reais, limitações e impacto no desempenho.

---

## 1. Diagnóstico do problema original

Antes desta entrega, a água do jogo era **decorativa e não conservativa**:

| Sintoma no código | Consequência física |
| --- | --- |
| `waterDepth` vinha de `solveHydrology` (D8), sem passo de física próprio | a lâmina nunca mudava por gravidade; era um mapa estático |
| `stepRainwater` somava água em `waterDepth` a partir de fórmulas arbitrárias (`intensity * storm * 0.035`, …) | **criação de água** sem fonte física |
| `stepRainwater` movia água pela `flowDir` D8 pré-calculada, dentro do próprio chunk | água "teleportava" na direção estática; nas bordas do chunk o fluxo parava (parede) |
| `stepWater` (solo) roteava o escoamento também pela D8 e somava em `waterDepth` (`r * 0.004`) | **duplo roteamento**: a mesma chuva produzia água por dois caminhos independentes |
| `stepWater` relaxava lagos para `depth * (0.85 + 0.3*seasonWet)` e secava poças com `-hours*0.02` | lagos e córregos perdiam/ganhavam volume sem sumidouro real; canais podiam desaparecer |
| Nenhum limite de transferência por origem; deltas aplicados ao final sem limite global | possibilidade de profundidade negativa e de oscilação (transferir mais do que existe) |
| `stepErosion` usava `acc` (D8) e `flowDir`, ignorando profundidade/velocidade reais; deltas com sinais mistos | erosão não correspondia à água; podia criar terreno |
| Vegetação removida por um `hash(id, dia)` com limiar em profundidade fixa | derrubada de árvores sem relação com a correnteza |
| Render: filetes animados com fase `timeMs/150` e direção da `flowDir` | o movimento visual podia contradizer o estado da água |
| Persistência salvava apenas solo/plantas/deltas | a água simulada era perdida no reload (o chunk "voltava no tempo") |

O build passava e os testes antigos passavam porque **nada testava a água como
volume**: os testes verificavam apenas a hidrologia gerada (D8) e a umidade do solo.

---

## 2. Arquivos modificados e responsabilidades

| arquivo | mudança |
| --- | --- |
| `src/world/water.ts` (**novo**) | solver de volume por célula: Manning por aresta, buffers de transferência, fontes/sumidouros, orçamento de massa, eventos de vegetação, pressão hidrostática, helpers de volume |
| `src/world/ecology.ts` | `stepWater` virou **balanço hídrico do solo** (chuva → interceptação → infiltração → `surfaceInput`); a água superficial não é mais roteada por D8. `stepErosion` passou a usar velocidade/profundidade reais, com transporte de sedimento conservado e atualização de `chunk.elev` |
| `src/world/rainwater.ts` (**removido**) | era o sistema paralelo de água "fake" (criação de água, transbordamento arbitrário, arrancamento por hash); sua função foi absorvida pelo solver e pelos eventos de vegetação |
| `src/world/chunk.ts` | novos campos por célula: `waterBase`, `springWeight`, `surfaceInput`, `waterDelta`, `flowX`, `flowY`, `floodHours`, `sediment`; relógio `lastSoilHour`; flag `waterDirty` |
| `src/world/world.ts` | orquestra a física em passos fixos (`waterStepHours`) com região ativa, contabilidade (`world.waterBudget`, `stats.waterVolume`), arquivo de água ao descarregar chunk, `addDelta` retornando o delta efetivo, `WaterRegion.waterChunks()` |
| `src/world/gen.ts` | grava `waterBase` (nível de equilíbrio gerado) e `springWeight` (contribuição local da bacia = `acc − montante`) |
| `src/world/persistence.ts` | `SAVE_VERSION = 2`; diffs de água (`water`, `flow`) quantizados por chunk |
| `src/render/scene.ts` | água desenhada a partir da lâmina/velocidade reais: alpha e camada profunda recalibrados para metros, filetes no vetor de fluxo real, espuma só em correnteza forte, quadros mais rápidos com velocidade, novo debug `current` |
| `src/main.ts` | debug `current`; raio ativo menor no mobile; volume de água no HUD |
| `src/core/config.ts` | 17 parâmetros novos de física da água; `generatorVersion` 4 |
| `tools/water-scenario.ts` (**novo**) | cenário reproduzível (encosta + canal + depressão + árvores) com relatório de volumes/orçamento |
| `tools/preview.ts` | `--sim <horas>` e `--rain 1`: renderiza depois de simular a física |
| `tests/water.test.ts` (**novo**) | 15 testes de física/conservação/vegetação/chunks/persistência |
| `tests/ecology.test.ts` | o teste de chuva passou a usar uma célula de terra firme (célula inundada agora recebe chuva direto na lâmina, por projeto) |
| `docs/*` | este documento, `ARQUITETURA.md`, `PARAMETROS.md`, `README.md`, `RELATORIO_FINAL.md` |

---

## 3. Modelo físico adotado

Grade: a grade ambiental existente (célula = 2 tiles = 64 px, interpretada como
`waterCellMeters = 8 m`; o solver é invariante a essa escala porque a vazão é
convertida de m³ para lâmina usando a **mesma** área de célula).

### 3.1 Potencial hidráulico e escoamento

Para cada célula `i` e vizinho `j` (8 direções, Moore):

```
head_i    = elev_i + depth_i                      (potencial hidráulico)
Δh        = head_i − head_j
sill      = max(elev_i, elev_j)                   (soleira entre as células)
h_eff     = min(depth_i, head_i − sill)           (lâmina acima da soleira)
S         = Δh / (waterCellMeters · dist)         (declividade da linha d'água)
v         = h_eff^(2/3) · √S / n_eff              (Manning, tubo largo)
Q         = v · h_eff · waterCellMeters · waterFlowScale   (m³/s)
V         = Q · Δt
```

- Só há fluxo se `Δh > waterHeadEpsilon` ⇒ a água nunca sobe o terreno; em
  terreno plano o fluxo tende a zero (não oscila).
- `n_eff = waterManningBase + rugosidade do solo + 0.018 × plantas na célula`
  (vegetação aumenta a resistência ao fluxo).
- Duas condições limitam cada transferência:
  1. **equalização de superfície**: `Σ V ≤ 0.5·Δh_max·A` (nenhuma célula passa
     do nível do destino neste subpasso);
  2. **disponibilidade**: `Σ V ≤ waterMaxOutflowFraction · depth_i · A`.

Assim `depth_i` nunca fica negativa, o esquema é estável e a solução converge
para superfície horizontal (equilíbrio), sem oscilação.

### 3.2 Conservação de massa

- Todos os fluxos são calculados sobre um **snapshot** (`waterDepth` + `waterDelta`);
  `waterDelta` é zerado a cada subpasso. Nenhuma célula gasta água que já saiu e
  a **ordem de varredura não altera o resultado** (teste 12).
- Cada transferência é `delta[i] -= V/A` e `delta[j] += V/A` — o mesmo volume sai
  da origem e entra no destino, uma única vez por subpasso.
- A vizinhança é resolvida pelo **mundo** (`cellAt`), não pelo chunk: a fronteira
  entre chunks não é parede (teste 10). Chunks descarregados guardam um snapshot
  de água (`World.storeWaterSnapshot`) e o restauram no recarregamento.
- Fontes e sumidouros são explícitos e contabilizados em `WaterBudget` (m³):
  - `rain` — chuva + escoamento pendente (`surfaceInput`), produzido pelo balanço de solo;
  - `springs` — recarga do lençol: `waterBase·(acc−montante)` para rios, valor fixo para lagos;
  - `evaporation` — água aberta, `evaporação ∝ (T, luz)`;
  - `infiltration` — lâmina → umidade do solo (Ksat por textura, reduzido em leito de rio/lago);
  - `drainage` — drenagem profunda acima de `waterBase` + alívio de segurança;
  - `boundary` — água que sai da região ativa pela borda aberta (a jusante).
- Fechamento verificado nos testes e no cenário: `V_final = V_inicial + entradas − saídas`
  (erro relativo 0,0000% sem chuva; 0,0007% com chuva forte).
- Limites numéricos: `depth ≥ 0`, `depth ≤ waterMaxDepth (30 m)`, velocidade
  limitada a `waterMaxVelocity`, guardas de `NaN/Infinity` em todos os divisores.

### 3.3 Subpassos e independência de FPS

- `waterStepHours = 0.02 h` (1,2 s reais) é o passo fixo. O mundo acumula tempo de
  jogo e executa `⌊Δt/step⌋` subpassos (máx. 64 por quadro), com
  `waterMaxSubsteps` dentro de cada passo — resultados idênticos em qualquer FPS.
- A simulação é limitada à região ativa (`waterActiveRadiusChunks = 2` → 25 chunks
  no desktop, 1 no mobile); o anel externo carregado serve de borda e recebe água.
- Chunks fora da região ativa não são advectados: em vez de represar a água na
  borda (parede permanente), a borda ativa é **aberta** e a saída é registrada em
  `budget.boundary`. Quando o jogador se aproxima, o chunk volta a participar.

### 3.4 Interação com terreno, solo e vegetação

- **Infiltração** depende do tipo de solo (Ksat arenoso 0,12 → rochoso 0,006 m/h),
  da saturação (`1 − umidade`) e da profundidade do solo; leito de rio/lago
  infiltra 15–20% do que infiltra a margem seca.
- **Erosão**: a capacidade de desagregação usa `(v−0.1)² · depth · slope ÷ resistência`
  (resistência = cobertura de copa × textura). O material vai para
  `chunk.sediment` e é transportado na direção da velocidade real; deposita onde a
  velocidade cai. `delta de elevação + variação de sedimento` é conservado e
  `chunk.elev` é atualizado **imediatamente** (a mudança aparece no jogo).
- **Alagamento**: `floodHours` acumula tempo com `depth > waterFloodDepth` (0,22 m).
  Acima de `waterFloodStressHours` a célula recebe estresse proporcional à
  severidade e à intolerância da espécie.
- **Arrancamento**: por planta, `arrasto = pressão hidrostática (ρgh) × velocidade`;
  `perigo = uprootRate · Δt · (1−floodTolerance) · f(profundidade) · f(velocidade) ÷ resistência`,
  com `resistência = 0.3 + 0.7·rootDepth + 0.4·tamanho`. A chance é
  `1 − e^(−perigo)`, sorteada por hash determinístico `(seed, id, passo)`.
  Espécies tolerantes (`vulnerabilidade ≤ 0,08`) não são removidas e há um teto de
  remoções por passo. Planta removida sai de `removedPlants`, o índice espacial é
  reconstruído e o local recebe liteira (matéria orgânica).

### 3.5 Renderização coerente com a física

- Alpha da água: `(depth − 0,025)/0,22`; camada profunda a partir de 0,35 m;
  sombreamento de profundidade a partir de 0,18 m — tudo em metros reais.
- Filetes de superfície usam o **vetor `flowX/flowY`** (direção e magnitude reais);
  a fase avança mais rápido onde `|v|` é maior ⇒ água parada é visualmente estável.
- Espuma só com `speed > 0,085 m/s` e lâmina > 0,3 m; cristas antigas por D8 foram removidas.
- Frames animados do sheet aceleram com a velocidade (`420 / (0,6 + 12·v)` ms).
- Novo modo de debug `current` mostra a velocidade do solver.

---

## 4. Testes executados e resultados reais

`npx vitest run` — **9 arquivos, 58 testes, todos aprovados** (21 s):

```
 ✓ tests/water.test.ts (15 tests)
 ✓ tests/ecology.test.ts (7 tests)
 ✓ tests/hydrology.test.ts (5 tests)
 ✓ tests/persistence.test.ts (5 tests)
 ✓ tests/time.test.ts (7 tests)
 ✓ tests/determinism.test.ts (6 tests)
 ✓ tests/continuity.test.ts (4 tests)
 ✓ tests/chunks.test.ts (5 tests)
 ✓ tests/deploy.test.ts (4 tests)
 Test Files  9 passed (9)      Tests  58 passed (58)
```

Cobertura dos 12 casos obrigatórios (`tests/water.test.ts`):

| # | caso | teste |
| --- | --- | --- |
| 1 | água em terreno inclinado escoa para baixo | centro de massa 0,5 → 6,4 células; origem esvazia; volume idêntico |
| 2 | terreno plano equilibra sem oscilar | variância cai em 4 janelas consecutivas; `v_max < 0,001 m/s` no fim |
| 3 | depressão acumula água | interior > 0,1 m; borda da bacia permanece seca |
| 4 | depressão cheia transborda | saída a leste recebe água e a jusante também |
| 5 | conservação sem chuva/infiltração/evaporação | `V_final/V_inicial = 1` (1e-5) em 2 chunks, 600 subpassos |
| 6 | chuva aumenta volume previsível | `budget.rain` e `ΔV` = `0,01 m × 256 × 64 m²` |
| 7 | evaporação e infiltração reduzem volume | perda = orçamento (erro < 1e-4); umidade do solo sobe |
| 8 | enchente inunda células vizinhas | ≥ 2 das 4 células vizinhas passam de 0,01 m |
| 9 | correnteza arranca vulnerável, não todas | ipê no canal removido (> 0); secas e salgueiros intactos; < 75% do total |
| 10 | transferência entre chunks | chunk leste recebe > 0,05 m; conservação 1e-5 |
| 11 | sem NaN, negativo ou divergência | célula com 80 m de lâmina, 400 passos com chuva e calor |
| 12 | independência da ordem | ordem dos chunks invertida ⇒ diferença < 1e-9 por célula |

Cenário reproduzível (`npm run scenario:water` / `npx tsx tools/water-scenario.ts`),
encosta + canal + depressão + árvores, 10 h de simulação, sem chuva:

```
== antes ==  volume 1468,8 m³
 montante (2,8)  lâmina 0,450 | canal (8,8) 0,450 | depressão (12,8) 1,200
 jusante (15,8)  0,000 | margem seca (8,4) 0,000
== depois == volume 1315,5 m³
 montante (2,8)  lâmina 0,003  v 0,002 | canal (8,8) 0,102 v 0,021
 depressão (12,8) 1,226 | jusante (15,8) 1,470 | margem seca (8,4) 0,000

orçamento: evaporação 58,0 | infiltração 48,1 | drenagem 47,2  (soma 153,3)
fechamento: 1468,80 − 153,34 = 1315,46  ==  depois 1315,46   (erro 0,0000%)
```

Com chuva forte (`--rain 0.02`, 10 h): volume 1468,8 → 3160,3 m³;
`rain 3276,8 | evap 331,8 | infiltração 1034,0 | drenagem 219,6`;
fechamento `3160,29` vs `3160,28` (**erro 0,0007%**); a margem seca (8,4) é
inundada (0,081 m) e o canal sobe de 0,450 → 0,258 (escoou mais rápido para
jusante, onde a lâmina chega a 1,857 m).

Jogo real (mesma seed 1337, 30 min de jogo, região ativa de 9 chunks):
volume ativo passou de 5 961 m³ para 14 595 m³ (chuva + nascentes), 841 células
com lâmina > 5 cm, velocidade máxima 0,060 m/s, 124 células com nível diferente
do gerado (Δ máximo 0,89 m) — **a água mudou de posição e profundidade**.

Validação visual headless (`tools/preview.ts --find river --sim 8 --rain 1`):
`docs/imagens/agua_antes.png` (antes de simular) e `docs/imagens/agua_enchente.png`
(depois de 8 h de chuva forte — o rio transborda para a margem direita).

---

## 5. Desempenho

Medido no cenário de 49 chunks com o solver completo (Node 22, 1 thread):

| região ativa | ms por subpasso | ms por quadro (≈0,4 subpasso/quadro) |
| --- | --- | --- |
| 9 chunks (mobile) | 1,19 | **0,46 ms** |
| 25 chunks (padrão) | 1,45 | **0,56 ms** |
| 49 chunks | 2,86 | **1,12 ms** |

- Sem alocação por quadro: os buffers vivem no chunk; apenas vetores de 8
  posições por célula para as transferências do subpasso.
- Frequências separadas: superfície 0,02 h (fixo), solo 0,5 h, biologia 3 h,
  erosão 24 h, render por frame.
- HUD mostra `água <volume>` e `sim` inclui o custo do solver; `stats.waterMs`
  registra a média móvel da física.

---

## 6. Limitações conhecidas

1. **Shallow water de poços**: o solver é hidrostático e não resolve ondas,
   ressaltos ou transporte vertical; a velocidade é a média da coluna d'água.
2. **Escala calibrada**: `waterFlowScale = 0,05` e `waterCellMeters = 8` são
   calibrados para o mundo do jogo (dia de 24 min, células de 64 px), não uma
   réplica 1:1 de um rio real. Os números são consistentes entre si e a
   conservação não depende da escala.
3. **Bordas**: chunks descarregados guardam apenas o último snapshot de água
   (até 192 chunks); depois disso a borda vira parede até o chunk ser regenerado
   com o estado de equilíbrio da geração. A região ativa abre a borda para
   jusante, evitando represamento permanente.
4. **Nascentes** entram como condição de contorno (`waterBase·springWeight`) sem
   modelar o aquífero; a vazão média é calibrada, não derivada de um balanço
   subterrâneo completo.
5. **Erosão** continua lenta (passo de 24 h) e limitada a ±0,25 m por célula
   (limite persistente já existente); canais novos aparecem como deformação
   gradual, não como incisão profunda.
6. **Vegetação**: só árvores do mundo são arrancadas; gramíneas/flores são
   decorações e não têm estado físico próprio.
7. **Sem testes de navegador automatizados** (não há Playwright no repositório);
   a validação visual é headless com as mesmas ops de cena do jogo.

---

## 7. Como reproduzir

```bash
npm install
npm test                      # 58 testes (9 arquivos), inclui tests/water.test.ts
npm run scenario:water        # cenário encosta+canal+depressão+árvores
npx tsx tools/water-scenario.ts --hours 10 --rain 0.02
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find river --sim 8 --rain 1
npm run build                 # typecheck + bundle estático (GitHub Pages)
```

No jogo: `Q` cicla os modos de depuração — o modo **current** mostra a velocidade
real do escoamento; `🌧 chuva` liga a chuva máxima para observar o transbordamento
em tempo real.
