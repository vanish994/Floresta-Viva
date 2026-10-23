# Fauna visual — coelho, sapo e ave

Três espécies de fauna visuais integradas à arquitetura existente, sem criar um
segundo sistema de fauna e sem tocar no modelo abstrato que já alimenta a
zoocoria.

---

## 1. Diagnóstico do que existia

- **`src/world/fauna.ts`** tinha apenas o modelo *abstrato*: `faunaActivity`
  (0..1 por célula, derivado de copa/água/hora/estação), usado pela zoocoria em
  `stepBio`, e `NullFauna` como referência de interface. Não havia agentes.
- **Insetos** (`ecosystem.ts`) já eram agentes leves em pool por chunk,
  reconstruídos pelo mundo e não serializados — esse é o padrão seguido aqui.
- **Render**: `composeScene` monta uma lista de *ops* com os sprites ordenados
  por `y`, usando `manifest.ts` para recortes. `CanvasRenderer` (navegador) e
  `SoftwareRenderer` (headless) consomem as mesmas ops.
- **Assets**: `publicDir: 'assets'` com `base: './'` (GitHub Pages), carregados
  por `allAssetFiles()`; sprites do pacote Harmonious medidos em
  `tools/data/*.json`.
- **Personagem**: 29 px de altura nos sheets; árvores grandes chegam a ~90 px.

## 2. Sprites: extração da prancha fornecida

A prancha (`tools/data/fauna-reference.png`, fora de `assets/` para não ser
publicada no site) é uma folha de
apresentação: fundo azul-acinzentado, brilho/sombra suaves, títulos, caixas,
paletas e legendas. **Nada disso vai para o jogo.** O extrator
`tools/extract-fauna-sprites.ts` faz:

1. **Remove o fundo** por distância de cor (limiar 52) e descarta o texto por
   saturação/brilho (`isLabel`: cinza claro com baixa saturação).
2. **Auto-trim** por célula (miolo do animal), ignorando o halo em volta.
3. **Reduz por média de área** até a altura de jogo — preserva o sombreado e
   evita serrilhado: coelho 17 px, sapo 15 px, ave 14 px de altura.
4. **Quantiza as cores** (7 níveis) e aplica **alpha binário** (0 ou 255):
   pixel art sem antialiasing e sem halo cinza.
5. Empacota **uma spritesheet por espécie** (uma animação por linha, frames
   alinhados pela base) e escreve um `.json` com célula e nº de frames.

Resultado:

| espécie | célula | animações (frames) | arquivo |
| --- | --- | --- | --- |
| coelho | 21×17 | idle 6 · walk 6 · run 5 · jump 5 · eat 6 · sleep 5 | `assets/Animals/rabbit.png` |
| sapo | 27×15 | idle 4 · jump 4 · swim 5 · eat 4 · sleep 4 | `assets/Animals/frog.png` |
| ave | 19×14 | idle 5 · fly 4 · land 4 · eat 4 · sleep 4 | `assets/Animals/bird.png` |

> **Atualização (direções)**: coelho, sapo e cobra foram re-extraídos das
> pranchas direcionais e agora têm célula 24×21, 24×19 e 30×21 com 4 direções
> desenhadas — ver §6.3. A tabela acima descreve a primeira extração (histórico).
> A ave permanece nesta folha.

Escala: **1:1** com o pixel art do jogo (sem esticar). Coelho tem 59% da altura
do personagem, sapo 52% e ave 48% — animais pequenos, como pedido; nada de
sprites gigantes.

## 3. Comportamento (simples e determinístico)

Estados: `idle · wander · seek_food · seek_water · eat · flee · rest · sleep ·
swim · fly · land`. A animação é derivada do estado e do ambiente
(`animFor`): sapo na água usa `swim`, coelho fugindo usa `run`, ave em voo usa
`fly` com `hover`.

| espécie | habitat | rotina |
| --- | --- | --- |
| coelho | vegetação/umidade, longe de água funda | pasta, come frutos caídos, dorme à noite |
| sapo | margem de água (lagoa/córrego) | noturno; procura água, nada, come |
| ave | árvores/copa e onde há insetos | diurna; voa, pousa, come, dorme |

Dados usados (todos já existentes): `waterDepth`, `moisture`, `canopyCoverAt`,
`groundFruits`, `chunk.localInsects` (pool de insetos) e a hora do
`GameClock`. **Nada de pathfinding**: alvo local + colisão leve (não entra em
água funda, sapo não fica em terra seca quando quer água), clamp na área do
chunk dono.

## 4. Chunks, determinismo e performance

- `seedFauna(chunk, cfg, dia, hora, insetos)` é **determinística**: mesma seed +
  mesmo habitat ⇒ mesmos animais (mesmos ids, mesmas posições). Ids incluem a
  espécie no hash (frog/bird não colidem).
- População por chunk é limitada por `FAUNA_CAP` (3/3/2) e escala com o habitat
  (share de água/vegetação/árvores).
- O pool vive em `world.faunaByChunk`, é **descartado no unload** e reconstruído
  ao voltar (como os insetos) — nada de milhares de agentes fora da área.
- Só a vizinhança de 1 chunk do jogador simula fauna; o resto do mundo continua
  representado pelo modelo abstrato (`faunaActivity` → zoocoria).
- Render respeita `y-sort`, câmera e iluminação; animais fora da câmera nem
  entram na lista de ops.

## 5. Testes

`tests/fauna.test.ts` (11 casos) — todos executados:

| # | caso | verificação |
| --- | --- | --- |
| 1 | determinismo | mesma seed ⇒ mesmos ids/posições; independente de ordem |
| 2 | habitat | sapo aparece na água e não no seco; coelho na vegetação; ave em árvores |
| 3 | população | teto por chunk respeitado em cada chunk/horário |
| 4 | estados | foge do jogador, sapo procura água, ave voa |
| 5 | rotina | coelho/ave dormem à noite; sapo não |
| 6 | animação | cada estado mapeia para uma linha existente da folha |
| 7 | escala | 17/15/14 px < 65% do personagem e > 10 px |
| 8 | assets | PNGs existem no manifesto, têm transparência real e alpha binário |
| 9 | chunks | sem duplicatas, ids únicos/estáveis no reload, dentro do chunk |
| 10 | render | `blit` correto (célula nativa), proporção preservada, y-sort |
| 11 | integração | mundo semeia fauna, `stats.animals` bate e ela se move |

`npm test` → **18 arquivos, 179 testes aprovados** (15 novos em
`tests/predator.test.ts`: nascer, perceber, perseguir, atacar, matar, comer,
fome cair, desistir, coelho e sapo fugindo, tetos, sem presas, predação real,
render e traços). `npm run typecheck` e
`npm run build` ok (120 kB).

## 6. Teste visual

`npx tsx tools/fauna-visual.ts` compõe uma cena controlada com **as mesmas ops
do jogo** e gera `.tmp/fauna/fauna.png` (+ `fauna_zoom.png` 4×): personagem
junto de dois coelhos, dois sapos, uma ave pousada e uma ave voando — permite
conferir escala e recorte. Também rodei o pipeline real
(`preview.ts --find forest`), onde os animais aparecem no mundo.

O que **não** foi validado: jogar no navegador (não há teste de browser no
projeto). O movimento, a fuga e a rotina foram verificados por simulação
automatizada, não a sensação em tempo real.

## 6.1 Cobra (predador) e IA comportamental (atualização)

### Sprites
`tools/extract-snake-sprites.ts` lê a prancha fornecida (`tools/data/snake-reference.png`),
separa a cobra das caixas de rótulo e do fundo quadriculado por saturação,
detecta cada frame por componentes conexos, reduz com escala única e grava
`assets/Animals/snake.png` (célula **41×20**, 7 animações: idle 11, move 11,
attack 8, hide 9, death 7, hurt 7, sleep 8). Alpha binário, sem halo.

### IA compartilhada (`fauna.ts`)
Pipeline único, usado por todas as espécies — sem segundo sistema de fauna:

```
perceive()  → busca local (animais do chunk + vizinhos, insetos, frutos, água, forragem)
decide()    → prioridades: sobrevivência (fuga) > sede > fome > caça > descanso > explorar
remember()  → memória curta (MEMORY_HOURS) de presa/ameaça, com posição e hora
ação        → estado + alvo; o movimento continua por quadro (px/s)
```

- **Personalidade**: o `quirk` (0..1) ajusta limiares (ousado caça mais cedo,
  cauteloso foge de mais longe) — determinístico por indivíduo.
- **Cobra**: `FAUNA_TRAITS.snake.prey = ['frog','rabbit','bird']` (sapo é a
  presa preferida), `attackRange 18`, `attackDamage 0.6`, `huntRange 190`.
  Persegue com **bote** (arranque 2,3× por curto período), ataca só no alcance,
  **desiste** após `MAX_CHASE_HOURS` e descansa; satisfeita, explora/esconde.
- **Presas**: coelho, sapo e ave detectam a cobra como ameaça, fogem (2,1× de
  velocidade), guardam a região perigosa por alguns segundos e voltam ao normal.
- **Morte**: o mundo remove do pool, marca `dead` e devolve matéria orgânica
  (liteira + madeira + nutrientes). Nenhum sprite fantasma.
- **População**: `FAUNA_CAP.snake = 1` por chunk; a reposição só ocorre com
  presas suficientes no chunk (cobra não nasce em deserto de presas).

### Resultado observado (seed 1337, 4 dias)
`rabbit 14→6 · frog 10→7 · bird 17→6 · snake 9→5`; insetos 41→24. As cobras
aumentam a pressão, as presas caem e depois **as próprias cobras passam fome**
(5 de 9 com saúde baixa) — o ciclo presa/predador funciona sem script.

Custo: **0,87 ms/frame** no desktop (49 chunks) e **0,50 ms/frame** no mobile
(25 chunks), praticamente igual a antes da cobra.

## 6.2 IA comportamental completa (atualização)

### Curva de atividade por espécie (`activityAt`)
Substitui o `if (night) sleep()` por uma curva contínua 0..1 com pico próprio:

| espécie | pico | vale |
| --- | --- | --- |
| coelho | manhã (1,0) e tarde (0,85) | madrugada (0,12) |
| ave | amanhecer (1,0) e tarde (0,85) | noite (0,05) |
| sapo | crepúsculo e noite (1,0) | meio-dia (0,20) |
| cobra | crepúsculo/amanhecer (1,0), noite 0,65 | meio-dia (0,22) |

A atividade modula **sono** (dorme abaixo de 0,22, salvo fome/sede/perigo),
**velocidade** (0,55 + 0,45·atividade; fuga não é penalizada), **caça**
(cobra só caça acima de 0,25) e **esconder-se** (abaixo de 0,4).

### Correções de simulação
- **`chaseHours += 0.016` removido**: a duração da perseguição agora soma o
  delta real (`dtHours`), então o comportamento é idêntico em qualquer FPS
  (teste `9. o tempo de perseguição não depende do tamanho do passo`).
- **Ataque por bote**: antes o dano era aplicado a cada tick enquanto o estado
  `attack` durasse. Agora cada investida dá **um** dano fixo
  (`attackDamage`), com `STRIKE_WINDOW_HOURS` (0,08 h) de janela e
  `ATTACK_COOLDOWN_HOURS` (0,22 h) de descanso — medido em teste
  (`5. o bote aplica dano UMA vez por investida`, `6. o cooldown impede…`).
- **Fuga por espécie**: coelho é o mais cauteloso (alcance ×1,45, zigue-zague
  lateral); sapo corre **para a água**; ave **levanta voo**. O jogador continua
  sendo tratado como ameaça pelas presas.
- **Bebida**: só o sapo nada (`swim`); coelho/ave/cobra bebem em `eat`
  (evita "coelho nadando" no render).
- **Percepção**: a vizinhança (chunk + 8 vizinhos) é montada **uma vez por
  frame** e cada animal só filtra por raio — antes cada animal varria o mapa.

### Desempenho (medido)
| alvo | ms/frame |
| --- | --- |
| desktop (49 chunks) | **0,88** |
| mobile (25 chunks) | **0,53** |

### Ciclo diário observado no mundo (seed 1337)
| hora | cobra (ativ.) | sapo (ativ.) | coelho (ativ.) |
| --- | --- | --- | --- |
| 05h | rest/idle (0,81) | idle/swim/eat (0,46) | idle/flee (0,34) |
| 09h | **sleep 9/9** (0,24) | sleep/swim (0,12) | idle/wander (0,78) |
| 13h | **sleep 8/9** (0,22) | swim (0,12) | idle/eat (0,88) |
| 19h | idle/chase (1,00) | swim/flee (0,79) | idle/wander (0,44) |
| 23h | rest/seek_water (0,49) | seek_food/swim (0,91) | idle/eat (0,12) |

## 6.3 Camada visual: estado da IA → animação → sprite (atualização)

O objetivo desta etapa foi **tornar visível o que a IA já decidia**, sem criar
uma segunda arquitetura de fauna, outro renderer, outro manifesto ou assets
novos. A cadeia continua sendo:

`IA existente → estado existente → animação da folha → emitAnimal → cena → Canvas`

### Mapa estado → animação (fonte única: `animFor` + `faunaFrameCount`)

| estado da IA | coelho | sapo | ave | cobra |
| --- | --- | --- | --- | --- |
| `idle` / `rest` | idle / sleep | idle | idle | idle / hide |
| `wander` / `seek_food` / `seek_water` | walk (parado = idle) | jump (parado = idle) | idle | move (parado = idle) |
| `eat` | eat | eat | eat | — |
| `sleep` | sleep | sleep | sleep | sleep |
| `flee` | **run** + poeira | **jump** (ou `swim` na água) | **fly** + sombra alta | move |
| `swim` | — | swim + ondulação | — | — |
| `fly` / `land` | — | — | fly / land | — |
| `hunt` | — | — | — | **hide** (emboscada enrolada) ou move |
| `chase` | — | — | — | **move** (aproximação) |
| `attack` | — | — | — | **attack** + brilho no focinho |
| dor (`hurtTimer`) | jump (sobressalto) | jump | fly | **hurt** |
| `dead` | sleep **congelado** (carcaça) | idem | idem | **death** (colapsa e congela) |

Regras aplicadas:

- **Nada inventado**: se a folha não tem `peek/approach/retreat/strike`, o
  comportamento usa `hide` / `move` / `attack` (as poses da folha da cobra);
  se a folha não tem linha de morte (coelho/sapo/ave), a carcaça usa a pose de
  repouso **congelada** (sem quadro de respiração) + marca de decomposição.
- **Uma tabela de frames**: `FAUNA_FRAMES`/`faunaFrameCount` no manifesto é a
  única contagem. `scene.ts` não mantém mais uma cópia (antes havia duas).
- **Top-down**: só `flip` horizontal, escolhido pelo sinal do deslocamento
  horizontal; subir/descer **não** inverte o sprite. Animais não são vistos de
  lado "andando na horizontal": seguem o vetor real de movimento.
- **Escala nativa**: 1:1 (coelho 21×17, sapo 27×15, ave 19×14, cobra 41×20);
  nada é esticado para preencher o tile de 32 px. O ponto de contato é a base
  do sprite (âncora no chão) e a sombra fica **abaixo** do animal.

### Feedback visual por estado (`emitAnimal`)

| situação | leitura no jogo | custo |
| --- | --- | --- |
| fuga (coelho/sapo correndo) | 2 pixels de poeira atrás do corpo | 2 `fill` |
| sapo nadando | linha d'água sobre o corpo + 2 ondulações | 3 `fill` |
| ave voando/fugindo | sombra menor e mais clara, separada do corpo | 1 `fill` |
| dormindo | dois "z" de 3 traços piscando acima da cabeça | 6 `fill` |
| ferido | pose de dor (cobra) / sobressalto + 2 faíscas vermelhas | 2 `fill` |
| bote da cobra | brilho no focinho durante `attack` | 1 `fill` |
| carcaça | sem sombra, mancha no chão que cresce, restos escuros e 2 "moscas" | 4 `fill` |
| longe da câmera (> 420 px) | quadro estático 0, sem sombra nem efeitos (LOD) | 0 |

### Correções de simulação que a leitura visual exigiu

- **A janela do bote agora dura o que foi definido**: `decide()` não
  sobrescreve mais `attack` no passo seguinte — antes a pose aparecia por um
  único frame. O recuo do bote usa o **próprio** movimento de `attack` (alvo
  afastado da presa), sem estado novo.
- **Cooldown visível**: com o bote em descanso perto da presa, a cobra fica em
  `idle` (observando) em vez de colar na presa; depois volta a perseguir.
- **Ave em fuga levanta voo** (`flee` → `fly`) com altura baixa (`hover`), em
  vez de "correr" com sprite de voo.
- **Sapo só nada na água**; coelho/ave/cobra bebem em `eat`.
- **Morte é visível**: o corpo **não desaparece** no instante da morte. Ele fica
  imóvel como carcaça (`state = 'dead'`, `corpseHours`) por `CORPSE_HOURS` e
  depois vira solo (liteira + nutrientes). Carcaça não conta para o teto
  populacional nem serve de presa.

### Parâmetros novos

| constante | valor | efeito |
| --- | --- | --- |
| `HURT_HOURS` | 0,05 h (~3 s reais) | duração da pose/flash de dor |
| `CORPSE_HOURS` | 1,0 h (~60 s reais) | tempo que a carcaça permanece no mundo |
| `CORPSE_DECAY_HOURS` | 0,45 h | a partir daqui aparecem restos/moscas |

### Direções (atualização): N, S, L, O

As três pranchas novas (`tools/data/{rabbit,frog,snake}-dir-reference.png`)
trazem **4 direções desenhadas** por animação. Elas foram extraídas por
`tools/extract-direction-sprites.ts` (`npm run sprites:dirs`):

| espécie | célula | animações | direções | linhas | arquivo |
| --- | --- | --- | --- | --- | --- |
| coelho | 24×21 | 8 | N/S/L/O | 32 | `assets/Animals/rabbit.png` |
| sapo | 24×19 | 8 | N/S/L/O | 32 | `assets/Animals/frog.png` |
| cobra | 30×21 | 10 | N/S/L/O | 40 | `assets/Animals/snake.png` |
| ave | 19×14 | 5 | única + flip | 5 | `assets/Animals/bird.png` |

Animações por espécie: `idle · walk · run · jump · eat · sleep · hurt · death`
(+ `strike · coil · hiss` na cobra). A **ave** não veio com prancha nova nesta
etapa: continua na folha antiga, com espelho horizontal e `alias`
(`death→sleep`, `hurt→fly`, `rest→sleep`), sem inventar quadro.

**Como a direção é escolhida**

1. `facingFromVector(dx, dy, anterior)` olha o **deslocamento real** do agente.
   O eixo horizontal vence por 25% de margem; na diagonal o eixo anterior é
   mantido. Empate/parado nunca troca a direção — o sprite não pisca.
2. `Animal.facingDir` guarda `n|s|e|w`; `facing` (1/−1) continua existindo para
   compatibilidade (efeitos antigos).
3. O render usa `faunaRow(sheet, anim, dir)` → linha `anim:dir`. Só espelha
   (`faunaFlip`) quando a folha **não tem** aquela direção desenhada (ave).

**Correção da direção OESTE (o pedido principal)**

Nas pranchas do **coelho** e da **cobra**, a coluna Oeste foi desenhada com a
mesma arte da Leste (o bicho "andava para a direita" indo para a esquerda). O
extrator mede isso por animação, compara com o espelho da Leste e decide
**pela espécie inteira** (não por animação isolada, senão sono/morte — poses
quase simétricas — faziam a folha misturar as duas convenções):

| espécie | votos "igual a L" | votos "já espelhada" | ação |
| --- | --- | --- | --- |
| coelho | 5 | 0 | **coluna Oeste espelhada** (8 animações) |
| cobra | 8 | 0 | **coluna Oeste espelhada** (10 animações) |
| sapo | 0 | 6 | mantida (a prancha já trouxe Oeste voltada para a esquerda) |

O `rabbit.json`/`snake.json` registram `mirroredDirs.w` para rastreabilidade, e
`docs/imagens/fauna_direcoes.png` (`npm run visual:dirs`) mostra lado a lado
**L | O | O=espelho de L | N | S** — a coluna 2 (Oeste desenhada) deve ser
igual à coluna 3. Testes cobrem a inclinação da cabeça (L positiva, O negativa)
e a diferença de silhueta (O ≈ espelho de L, ≠ L).

**Extração (por que não é recorte fixo)**

A grade das pranchas não está em passo uniforme e as células têm divisórias
finas. O extrator, em vez de presumir coordenadas: mede as **faixas** de
animação pela projeção da máscara, acha os **runs** de coluna dentro de cada
faixa, detecta os 3 **vãos maiores** (quebra entre blocos de direção) e encaixa
as 16 posições; depois auto-recorta o bicho, reduz por média de área, quantiza
e aplica alpha binário. Célula ausente repete o último quadro válido (nunca
inventa arte) e o JSON reporta as lacunas — a única hoje é `rabbit:w` quadro 3,
repetido.

### Desempenho medido (mesmo harness nas duas versões)

40 animais + 114 insetos, câmera 480×320, 240 quadros, seed 1337:

| alvo | antes (2a046ce) | depois (direções) | ops/frame |
| --- | --- | --- | --- |
| mobile (25 chunks) | 2,30 ms | **2,38 ms** | 1.373 → **1.409** (+2,6%) |
| desktop (49 chunks) | 2,11 ms | **2,65 ms** | 1.373 → **1.409** (+2,6%) |

Os efeitos só existem para animais a menos de 420 px do centro da câmera e para
estados específicos; o custo medido está dentro do ruído do harness.

### Ensaio visual (headless, ops reais)

`npm run visual:fauna` gera [`docs/imagens/fauna.png`](imagens/fauna.png) (e o
`fauna_zoom.png` em 4×) com 21 animais em duas faixas: caminhada, fuga, comer,
voo, perseguição, emboscada, sono com "z", bote com brilho, dor da cobra e três
carcaças em estágios diferentes. As ops são exatamente as do jogo — a validação
é por imagem renderizada, **não** por navegador real (não há automação de
navegador no projeto).

## 7. Limitações

1. Sem pathfinding: os animais escolhem um alvo local e andam em linha reta com
   colisão leve; podem "esbarrar" em árvores sem contornar.
2. A fauna não é persistida: ao recarregar, é reconstruída pela seed/habitat
   (mesmos animais, mas fome/energia reiniciam).
3. Comida é **consumida de verdade** (inseto sai do pool, fruto sai do chão),
   mas a forragem do coelho é só um campo de célula (`forage`), sem sprite
   individual de grama sendo comida.
4. Há predação e morte (carcaça → solo), mas **não há reprodução** com herança:
   o nascimento usa `seedFauna` + teto por chunk, não genética.
5. A prancha é raster suave; a conversão para pixel art é uma redução fiel, não
   uma re-ditagem pixel a pixel — detalhes finos (olhos, penas) foram
   preservados em 1–2 px.
6. Coelho e ave não atravessam chunk: ficam contidos na área do chunk dono
   (a travessia com transferência de dono existe para insetos; para a fauna
   ficou como evolução futura para não duplicar donos).
7. **Morte/dor**: coelho, sapo e cobra agora têm linhas próprias (`hurt`,
   `death`) nas pranchas direcionais. A **ave** ainda não: usa `fly` para dor e
   `sleep` congelado para a carcaça (registrado no `alias` do manifesto).
8. **Direções**: coelho, sapo e cobra têm N/S/L/O desenhados. A **ave** continua
   de perfil, com espelho horizontal — é a única espécie sem arte de 4 direções.
9. Sem diagonais: o eixo dominante do movimento decide a direção (com
   histerese); não existe sprite diagonal.

## 8. Como reproduzir

```bash
npm run sprites:fauna   # regenera assets/Animals/*.png a partir da prancha
npm run visual:fauna    # cena headless (escala/recorte)
npm test                # 192 testes
npm run build
```
