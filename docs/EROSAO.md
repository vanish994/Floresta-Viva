# Erosão, sedimentos e margens arenosas — Floresta Viva

Relatório da implementação: como o terreno funcionava, o que mudou, modelo
adotado, testes executados, limitações e custo.

---

## 1. Antes × depois

### Antes (o que existia de fato)

| aspecto | estado anterior |
| --- | --- |
| relevo | `chunk.elev` derivado de `WorldFields.elevation` + deltas persistentes (`world.terrainDeltas`, ±0,25 por célula) |
| erosão | `stepErosion` em `ecology.ts`, chamada **por chunk** a cada 24 h: usava `acc` (D8) e `flowDir`, tinha `deposit` calculado e descartado (`void deposit`), escrevia deltas com **sinais mistos** (`-amount`, `+0,6×amount`, `+0,2×amount`) → criava/destruía terreno; `chunk.elev` nunca era atualizado, então a deformação só aparecia ao recarregar o chunk |
| sedimentos | `chunk.sediment` existia, mas nenhum consumidor real: a carga não influenciava solo, textura nem vegetação |
| areia | `SOIL_SAND` vinha só da geração (`soilParent`) e da umidade; o render pintava praia **decorativa** em qualquer margem de lago (`lakeShore`), independente do solo |
| solo | `soilType` (0 areia, 1 argila, 2 rocha, 3 florestal, 4 aluvial); sem memória de contato com água |
| vegetação | copa/raízes só influenciavam sombreamento e estresse hídrico — não protegiam o solo |
| persistência | salvava `deltas` + `soil` quantizado; textura de areia não era persistida |

### Depois

- O terreno **muda de verdade**: a elevação é rebaixada/depositada, `chunk.elev`
  e a declividade são recalculados no mesmo passo e o render lê esse estado.
- A **areia é um estado físico**: fração de areia da superfície (`chunk.sand`) +
  espessura do depósito (`chunk.sandLayer`). Sem sedimento depositado não há
  areia; o solo só é reclassificado com histerese e cooldown.
- O sedimento **circula**: erodido → carga suspensa → transporte na direção real
  do fluxo (atravessando chunks) → deposição onde a correnteza perde força.
- Vegetação protege o solo (copa e raízes), e erosão profunda pode expor raízes e
  derrubar árvores vulneráveis.

---

## 2. Arquivos alterados

| arquivo | responsabilidade |
| --- | --- |
| `src/world/sediment.ts` (**novo**) | todo o sistema: desagregação, transporte, deposição, mistura de textura, formação/recuperação de margem, histerese de classificação, exposição de raízes, orçamento de sedimentos |
| `src/world/world.ts` | orquestra morfologia e margens em frequências próprias, região ativa, orçamento (`world.sedimentBudget`), `sedimentChunks()`, stats (`sedimentMs`, `sandCells`), `addDelta` com furo numérico 1e-9 (conservação exata) |
| `src/world/chunk.ts` | novos campos: `sand`, `sandBase`, `sandLayer`, `soilBase`, `shoreHours`, `soilCooldown`, `sedimentScratch`, `sedimentDelta`, `terrainDirty`, caches de copa/raiz, `lastBankHour`, `sandCells()` |
| `src/world/ecology.ts` | removido o `stepErosion` antigo (e `ErosionSink`); regeneração de floresta não sobrescreve mais areia (evita oscilação entre passos) |
| `src/world/gen.ts` | grava `soilBase`, `sandBase`, `sand` iniciais (textura de origem) |
| `src/world/persistence.ts` | save v2 agora inclui `sand` (fração), `sandLayer` e `types` (classificação do solo) por chunk |
| `src/render/scene.ts` | areia como mistura contínua (alpha por fração/depósito) em vez de troca de tile; barranco erodido a partir do delta real; modos de debug `sand` e `sediment` |
| `src/main.ts` | debug `sand`/`sediment`; contagem de células de areia no HUD |
| `src/core/config.ts` | 18 parâmetros novos; `generatorVersion` 5 |
| `tests/sediment.test.ts` (**novo**) | 14 testes (os 9 obrigatórios + exposição de raízes, chunk boundary, cenário, integração, persistência, geração) |
| `tools/erosion-scenario.ts` (**novo**) | cenário reproduzível com relatório de massa/orçamento |
| `docs/*`, `README.md` | documentação |

---

## 3. Como erosão, transporte, deposição e areia funcionam

Tudo parte do estado **físico** da água (`flowX/flowY` em m/s, `waterDepth` em m,
fluxo real do solver de água), do relevo (`elev`, `slope`) e do solo
(`soilType`, `sand`, `litter`, `humus`) — nunca de `flowDir` pré-calculada nem da
animação da correnteza.

### 3.1 Desagregação (`erodeBed`)

```
erodibilidade = f(textura)          // areia 1,6 · aluvial 0,95 · floresta 0,7 · argila 0,5 · rocha 0,12
v_crítica     = v_crit(textura) × (1 + 0,9·copa + 0,5·matéria orgânica + 1,1·raízes)
excesso       = max(0, v − v_crítica)
fluxo         = excesso^1,4 · √profundidade · (0,35 + 0,65·declive)
splash        = chuva · declive · (1 − 0,85·copa) · (1 − 0,5·orgânica)
taxa          = erosionRate · erodibilidade · (fluxo + splash)      [m/h]
```

Limites: `erosionMaxRatePerHour` (0,006 m/h), nunca mais que a lâmina presente
(+ água de chuva), e nunca mais que a **capacidade de carga restante**
(`sedimentMaxLoad − sediment`). Se o excesso é ≤ 0 e não chove, não há erosão.
O material removido entra na carga suspensa local e mistura a textura em direção
ao material de origem (`sandBase`).

### 3.2 Transporte (`transportAndDeposit`)

- Capacidade: `sedimentCapacity · v^1,5 · √(profundidade + 0,02)`.
- A carga avança **uma célula por subpasso** na direção da velocidade
  (`flowX/flowY`; `flowDir` só como fallback quando `v ≈ 0`), na fração
  `min(1, v / sedimentTransportSpeed)`.
- Buffers de snapshot (`sedimentScratch` + `sedimentDelta`, zerado por subpasso):
  uma carga nunca é movida duas vezes; o resultado independe da ordem.
- Alvo fora da região ativa → deposita no local (nada de carga presa em outro
  chunk). O teste `7` verifica a travessia de fronteira com massa constante.

### 3.3 Deposição

Só onde a correnteza perdeu força (`speed < 0,18`), com bônus em lâmina rasa
(0,35 m) — é assim que **bancos de areia** crescem. A composição do depósito
depende do ambiente:

```
fração de areia depositada = 0,78 − 0,45·smoothstep(0,02…0,16, v) − 0,30·smoothstep(0,25…1,0, prof)
```

⇒ areia em barras/praias rasas e de correnteza moderada; finos + matéria
orgânica em água funda e parada (lama de lago). A saturação da carga
(`sedimentMaxLoad`) também **deposita** o excedente em vez de descartá-lo.

### 3.4 Formação de margem arenosa e classificação do solo (`stepBanks`)

1. **Contato com água**: `shoreHours` acumula enquanto há lâmina na célula ou em
   um vizinho (incluindo vizinhos de outro chunk, sem costura) e decai com
   memória de 24 h.
2. **Lavagem seletiva (winnowing)**: só em solos que **já têm areia**
   (`sandBase ≥ 0,3`, ou seja, aluvial/arenoso), com contato ≥ 3 h, declive
   ≤ 1,2 e correnteza > 0,012 m/s. É limitada por `sandWinnowCap` (0,5), **abaixo**
   do limiar de classificação — então a lavagem sozinha nunca "cria" areia.
3. **Deposição**: cada espessura depositada entra em `sandLayer` e mistura `sand`;
   a célula vira `SOIL_SAND` apenas com `sand ≥ 0,55` **e** `sandLayer ≥ 1 cm`.
4. **Recuperação**: margem seca sob copa estabelecida incorpora a areia
   (`sand → 0,85·sandBase`, depósito decai) e a célula volta a aluvial/floresta
   conforme o caso.
5. **Histerese + cooldown de 48 h** (`sandRevertThreshold = 0,36`): nenhuma
   oscilação areia↔terra — verificado no teste `6`.
6. **Rocha nunca vira areia** (`sand ≤ 0,5` em `SOIL_ROCK`) e células secas
   distantes mantêm a textura de origem.

### 3.5 Vegetação

- **Copa** e **raízes** entram na velocidade crítica (até ~2× mais resistência) e
  a copa reduz o splash da chuva em até 85%.
- Mapas de copa/raiz são construídos por *splat* por planta e cacheados por chunk
  (1 reconstrução por dia de jogo ou quando a vegetação muda), com orçamento por
  passo — não há `canopyCoverAt` por célula.
- **Exposição de raízes**: a erosão acumulada (`-getDelta`) é comparada a um
  limiar que depende da profundidade real da raiz e da tolerância da espécie.
  Superado o limiar, a árvore ganha estresse e pode cair — com resistência por
  raiz/porte, teto de 2 remoções por chunk/steps, hash determinístico e liteira
  no local (teste `7b`). Espécies ripárias suportam muito mais solo perdido.

### 3.6 Conservação

`delta de elevação + carga suspensa` é constante. O orçamento explícito
(`SedimentBudget`) registra `eroded`, `deposited`, `transported`, `retained`
(apenas quando o depósito não pôde ser aplicado) e `lost` (deve ser 0). O teste
`9` fecha `erodido − depositado = carga em trânsito` e a massa total antes/depois.

---

## 4. Testes executados e resultados reais

`npx vitest run` — **10 arquivos, 72 testes, todos aprovados** (47 s).

`tests/sediment.test.ts` (14 testes):

| # | requisito | verificação |
| --- | --- | --- |
| 1 | solo exposto × vegetado | `eroded` do solo nu > 2× o do solo com copa+raízes |
| 2 | correnteza × água parada | parada: `eroded = 0` (abaixo da v crítica); 0,2 m/s: > 0,05 m erodido, com transporte |
| 3 | transporte e deposição | remanso a jusante recebe depósito; `chunk.elev` acompanha o delta persistido |
| 4 | areia sem fonte | argila + 600 h de contato: `sand` constante, 0 células de areia, carga 0 |
| 5 | margens indiscriminadas | rocha nunca vira areia; células secas intactas; margem aluvial ganha areia mas ≤ cap |
| 6 | oscilação areia↔terra | 4 fases (úmida → depósito → seca+vegetação → úmida): ≤ 2 transições, 0 na fase final |
| 7 | fronteira de chunks | carga atravessa (0,0)→(1,0); massa idêntica; `lost = 0` |
| 7b | raízes expostas | ipê vulnerável cai (não todos), salgueiro resiste |
| 8 | estabilidade/desempenho | 2 chunks × 6 passos com chuva e correnteza 2,5 m/s: sem NaN/negativos, ±0,25 respeitado, < 3 s |
| 9 | perda/criação de sedimento | `lost = 0`, `retained = 0`, massa antes/depois iguais (1e-6), balanço fecha |
| 10 | cenário reproduzível | massa conservada, canal escavado, margem mais arenosa (relatório no log) |
| 11 | integração com o mundo | 32 h de jogo: erosão rodou, margens mudaram, sem NaN |
| 12 | persistência | `sand`, `sandLayer` e classificação sobrevivem ao save/load |
| 13 | geração | `soilBase/sandBase/sand` coerentes em todo chunk gerado |

Cenário reproduzível (`npm run scenario:erosion`, 168 h, chuva 0,3):

```
canal (5,7):    elev 14.950 → 14.780 m   areia 0,350 → 0,500   depósito 0,0000 → 0,0090 m
remanso (12,7): elev 11.200 → 11.198 m   areia 0,350 → 0,570   depósito 0,0000 → 0,0173 m
margem (4,6):   elev 15.400 → 15.358 m   areia 0,350 → 0,500   depósito 0,0000 → 0,0090 m
rocha (4,1):    elev 16.200 → 16.200 m   areia 0,030 → 0,027   (não vira praia)
células areia: 0 → 18 / 256
orçamento: erodido 15,508 − depositado 8,845 = 6,663 m em trânsito
fechamento: 0,000000 → 0,000000 (diferença 4,7e-9); perda inexplicada 0
```

No jogo (seed 1337, 30 h de simulação, região ativa de 9 chunks para morfologia):
1,61 m de rebaixamento acumulado somado às células, 0,31 m depositados, rebaixamento
máximo local 2,2 cm, 33 células com depósito arenoso novo, 1 296 células
classificadas como areia.

**Validação visual**: `docs/imagens/erosao_rio_96h.png` (rio após 96 h de
simulação, com margens claras e areia na curva) e `docs/imagens/erosao_praia_lago.png`
(lago com praia arenosa formada). São renders headless com as **mesmas ops de
cena** do jogo (`tools/preview.ts --sim`), não capturas de navegador — o
repositório não tem teste de navegador automatizado.

---

## 5. Desempenho

| passo | frequência | custo medido (9 chunks ativos, 2 304 células) |
| --- | --- | --- |
| `stepBanks` (margens/textura) | 1 h de jogo | **3–4 ms** (7 ms quando todos os mapas de copa estão frios) |
| `stepErosion` (erosão+transporte) | 24 h de jogo | **11–20 ms** |
| `stepErosion` com a região de água (25 chunks) | 24 h de jogo | 35 ms |

- Erosão roda **1× a cada 24 h de jogo** (24 min reais) ⇒ ~0,01 ms por quadro em
  média; margens 1×/h ⇒ ~0,06 ms por quadro. O HUD mostra `sim` (inclui ambos).
- Região ativa própria (`erosionActiveRadiusChunks = 1`) em vez do mundo inteiro;
  chunks sem água e sem chuva são pulados; mapas de copa/raiz cacheados;
  sem alocação por célula (buffers fixos no chunk, exceto os mapas cacheados).

---

## 6. Limitações conhecidas

1. **Escala calibrada**: a morfologia trabalha em metros de elevação (60 m de
   amplitude), com taxas por hora de jogo. É um modelo lento e plausível, não uma
   réplica de taxa geológica real.
2. **Deltas limitados a ±0,25 m por célula** (limite persistente pré-existente):
   rios não escavam canyons; o alargamento de canal acontece por rebaixamento
   gradual até esse teto.
3. **Transporte de uma célula por subpasso** com direção cardinal dominante
   (8 vizinhos): não há curva de meandro contínua nem suspensão em suspensão
   fina dentro da coluna d'água.
4. **Areia só onde há fonte**: margens de argila/rocha não ficam arenosas; é
   intencional, mas significa que praias amplas dependem de solo aluvial.
5. **Queda de árvores por erosão** exige erosão local profunda (> ~12 cm em
   média, mais para raízes fundas) — acontece em margens de correnteza forte ao
   longo de muitos dias de jogo, não em poucas horas.
6. **Depósitos em água profunda** viram lama (fração de areia baixa) e não são
   renderizados como areia — coerente com o modelo, mas menos visível.
7. **Sem teste de navegador automatizado**; a validação visual é headless com as
   ops reais do render.

---

## 7. Como reproduzir

```bash
npm install
npm test                        # 72 testes (10 arquivos), inclui tests/sediment.test.ts
npm run scenario:erosion        # relatório do cenário de erosão/sedimentação
npx tsx tools/erosion-scenario.ts --hours 336 --rain 0.6
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find river --sim 96
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find water --sim 96 --debug sand
npm run build
```

No jogo: `Q` cicla os modos de depuração — **sand** mostra a fração de areia da
superfície e **sediment** mostra a carga suspensa em trânsito; o HUD exibe o
número de células de areia.
