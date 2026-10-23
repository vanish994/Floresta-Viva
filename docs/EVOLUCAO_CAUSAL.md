# Evolução causal do ecossistema

O que mudou nesta etapa: o mundo deixou de ter sistemas **paralelos** (chuva
"decidida" por ruído, crescimento por idade, animais decorativos) e passou a ter
uma **rede de fluxos** ligada pelos sistemas que já existiam. Nada foi
reescrito: cada mecânica nova é uma evolução de uma estrutura existente.

> Regra seguida em todo o trabalho: **evoluir > duplicar**. Nenhum segundo
> sistema de clima, solo, água, vegetação, insetos ou fauna foi criado.

---

## 1. Auditoria: o que já existia (e foi reaproveitado)

| área | já existia | como foi evoluído |
|---|---|---|
| água superficial | solver de volume conservativo (`water.ts`) | intocado; passou a receber a chuva **causal** |
| solo | `moisture`, `litter`, `humus`, `nAvail/pAvail/kAvail`, `microbe`, `stress` | + `waterCapacity`, `compaction`, `forage`, `coarse`, `light` |
| clima | `Climate` com estação, temperatura, `rainIntensity` (ruído) | + `AtmosphereState` (umidade → nuvens → chuva) |
| crescimento | `plantSize` = f(idade, `plantHealth`) | `plantHealth` agora inclui **luz** e **nutrientes** |
| decomposição | `stepBio`: liteira → húmus + N/P/K | + material **grosso** (madeira) com decomposição lenta |
| ecossistema | fenologia, frutos, sementes, insetos, pragas | intocado; consome a chuva causal |
| fauna | agentes visuais com `hunger`/`energy` | + `thirst`, `health`, dieta real, fezes, dispersão |
| persistência | diffs por chunk + snapshot ecológico | + estado do solo novo e da atmosfera |
| render | ops com y-sort | HUD mostra umidade/nuvens/tipo de chuva |

---

## 2. Ciclo da água no solo (Etapa 2)

`stepWater` (o passo que já existia a cada 0,5 h) foi evoluído:

```
chuva → interceptação da copa → infiltração (limitada por capacidade,
                                 compactação e saturação)
      → o que não infiltra vira surfaceInput (escoamento) → solver de água
      → evaporação do solo + transpiração da copa (saem do solo)
      → percolação profunda (saturado drena mais)
```

- `waterCapacity` = profundidade × retenção da textura × matéria orgânica —
  solo fundo/orgânico guarda mais água na mesma saturação.
- `compaction` (encosta íngreme, rocha; vegetação e húmus descompactam) fecha
  os poros: **infiltra menos e escorre mais**.
- Solo saturado (`moisture → 1`) quase não infiltra: a chuva vira escoamento.
- `stepWater` devolve um **orçamento de fluxos** (`evaporation`, `transpiration`,
  `runoff`) que alimenta a atmosfera — a água não "some".

## 3. Atmosfera causal (Etapas 3–4)

`Climate.atmosphere` tem dois reservatórios: **umidade do ar** e **água
condensada na nuvem**. A cada 15 min de jogo (passo fixo, independente de FPS):

```
evaporação + transpiração → umidade do ar
umidade do ar acima do limiar + convecção → condensação → nuvem
nuvem saturada + instabilidade → chuva (garoa…tempestade)
chuva → consome nuvem e seca o ar (retroalimentação negativa)
```

- O equilíbrio da umidade vem do clima de grande escala (ruído sazonal
  existente), da estação, do calor e de **floresta + superfície de água**
  (transpiração). Floresta **favorece** a umidade; não garante chuva.
- `precipitationNow()` é a chuva efetiva usada por solo, erosão, ecossistema,
  render e áudio. `rainIntensity(day)` continua sendo a climatologia
  determinística de geração/saves (não quebrou determinismo nem testes).
- **Tipos de chuva** (`rainKind`): seco, garoa, leve, normal, forte, tempestade
  — a intensidade já altera o mundo porque passa pela mesma física
  (infiltração satura → escoamento → erosão/erosão de margem).

Observado no mundo real (seed 1337, 4 dias): `seco → normal → forte → leve`,
umidade 0,59 → 0,74, solo 0,26 → 0,82, húmus 3,09 → 3,33.

## 4. Luz, fotossíntese e crescimento (Etapa 5)

- A cada passo de biologia, cada célula recebe `chunk.light` =
  `sol × (1 − copa) × (1 − nuvens)`.
- `plantHealth` passou a descontar **déficit de luz** (espécie heliófila na
  sombra) e **déficit nutricional** (N/P/K), além do estresse hídrico e da
  senescência que já existiam.
- Como `plantSize` = f(idade, saúde), o crescimento deixou de ser só timer:
  planta com pouca água, pouca luz ou solo pobre cresce menos — sem mudar a
  assinatura usada por render e ecologia.
- `stress` recebe também um termo nutricional (solo pobre estressa a planta).

## 5. Matéria orgânica e decomposição (Etapa 6)

Dois pools por célula, com velocidades diferentes:

| material | campo | comportamento |
|---|---|---|
| folhas, fezes, frutos, carcaças | `litter` | decompõe rápido (taxa existente) |
| galhos, tronco | `coarse` | decompõe **muito** devagar (~0,06%/h) |

Ambos devolvem húmus e nutrientes. A madeira entra quando: árvore derrubada
pelo jogador, árvore arrancada por erosão, ou animal morto. A liteira já
aumentava a retenção (é a matéria orgânica que multiplica a `waterCapacity`).

Ciclo fechado: `matéria → decomposição → húmus/nutrientes → raízes → crescimento`.

## 6. Fauna causal (Etapas 7–9)

Cada agente agora tem `hunger`, `thirst`, `health`, `energy`, `poopTimer` e
`carriedSeed`. Dieta ligada a recursos **reais**:

| espécie | come | bebe | dispersa |
|---|---|---|---|
| coelho | `chunk.forage` (camada herbácea) | água próxima | — |
| sapo | insetos do pool do chunk | água (nada) | — |
| ave | frutos no chão (preferido) e insetos | água/frutos | semente com **vigor** |

- **Comida invisível não existe**: o mundo remove o inseto do pool
  (`consumeInsect`) e o fruto do chão (`consumeFruit`).
- **Fezes**: depois de comer, o animal deposita liteira + N/P/K na célula.
- **Zoocoria**: a ave que come fruto carrega a semente e a deposita nas fezes,
  longe da planta-mãe, com `vigor > 0` → germinação mais provável (até 3×).
- **Morte**: fome/sede extremas corroem a saúde; ao morrer, o animal vira
  matéria orgânica (liteira + madeira + nutrientes) e sai do pool.
- **Feedback populacional**: só nasce animal se houver comida (forragem/insetos)
  e espaço abaixo do teto (3/3/2 por chunk). Comer reduz a presa: em 3 dias de
  simulação, os insetos caíram de 41 → 18 com os sapos presentes.

## 7. Mundo infinito por chunks

- Novos campos por célula entram no save quantizados (`waterCapacity`,
  `compaction`, `forage`, `coarse`).
- A atmosfera é **um estado do mundo** (não por chunk) e é serializada no save.
- Animais continuam sendo pool por chunk (reconstruído, não salvo), com
  determinismo por seed.
- Fauna se move **por quadro em px/s** (suave em qualquer FPS) e a simulação de
  comportamento usa o intervalo existente; nada roda por célula por quadro.

## 8. Testes (23 novos em `tests/causal.test.ts`)

Todos executados com as funções reais do jogo:

| # | verificação |
|---|---|
| 1 | chuva → infiltração aumenta a umidade do solo |
| 2 | solo saturado → escoamento superficial (surfaceInput) |
| 3 | compactação reduz infiltração; capacidade maior retém mais |
| 4 | umidade baixa → sem nuvem → sem chuva |
| 5 | umidade alta + convecção → nuvem → chuva; chuva consome nuvem |
| 6 | floresta/água aumentam a umidade de equilíbrio, sem garantir chuva |
| 7 | tipos de chuva acompanham a intensidade |
| 8 | o mundo simula o ciclo e a chuva altera solo e água |
| 9 | pouca luz reduz a saúde (crescimento deixa de ser só idade) |
| 10 | solo pobre e estresse hídrico reduzem a saúde |
| 11 | bio atualiza luz/forragem e decompõe madeira muito devagar |
| 12 | matéria orgânica → húmus + nutrientes |
| 13 | coelho come a forragem real da célula |
| 14 | sapo come inseto do mundo (callback real) |
| 15 | ave come fruto, carrega semente e defeca (zoocoria com vigor) |
| 16 | fezes devolvem nutrientes ao solo |
| 17 | fome/sede extremas matam e devolvem matéria orgânica |
| 18 | cadeia alimentar: sapos reduzem os insetos vs. controle |
| 19 | tetos populacionais e valores finitos com a dieta nova |
| 20 | solo novo + atmosfera sobrevivem ao save/load |
| 21 | determinismo: mesma seed + mesmos passos ⇒ mesmo clima/solo/forragem |
| 22 | sem NaN/negativos após simulação longa |
| 23 | chunk gerado já vem com capacidade, compactação, forragem e luz |

Suíte completa: **15 arquivos, 141 testes aprovados**. `npm run typecheck` e
`npm run build` ok (129 kB).

## 9. Desempenho

Medido no mundo real (mesmo build):

| alvo | ms/frame |
|---|---|
| desktop (raio 3, 49 chunks) | **0,84 ms** |
| mobile (raio 2, 25 chunks) | **0,44 ms** |

Água 0,16 ms, erosão ~0 (1×/24 h). Atmosfera roda em passo de 0,25 h de jogo;
fauna por quadro (≤ 72 agentes); fenologia no passo de 3 h.

## 10. Limitações

1. A atmosfera é **global** (um estado para o mundo carregado), não um mapa de
   nuvens por região: nuvens não viajam visualmente pelo céu.
2. A convecção usa calor/sol/vento agregados; não há frentes, vento direcional
   nem raios.
3. A camada herbácea (`forage`) é abstrata: não tem espécie nem altura, só
   biomassa por célula.
4. A fauna não persiste: ao recarregar, é reconstruída pela seed/habitat
   (mesmos animais, fome/energia reiniciam).
5. Sementes dispersadas por animais ainda não distinguem espécie destruída vs.
   transportada (todas recebem vigor).
6. Não há predadores de coelho/ave nem reprodução sexuada: o crescimento
   populacional é por reposição ligada ao alimento.
7. Nada disso foi validado em navegador automatizado (o projeto não tem teste
   de browser); a validação foi por simulação headless + renders com as mesmas
   ops do jogo.

## 11. Como reproduzir

```bash
npm install
npm test          # 141 testes (15 arquivos), incluindo tests/causal.test.ts
npm run build
npm run dev       # HUD: temperatura · tipo de chuva · 💧umidade · ☁nuvens
```
