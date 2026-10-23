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

`npm test` → **16 arquivos, 156 testes aprovados** (15 novos em
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

## 7. Limitações

1. Sem pathfinding: os animais escolhem um alvo local e andam em linha reta com
   colisão leve; podem "esbarrar" em árvores sem contornar.
2. A fauna não é persistida: ao recarregar, é reconstruída pela seed/habitat
   (mesmos animais, mas fome/energia reiniciam).
3. Comida é abstrata: comer reduz `hunger` e usa frutos no chão como atração,
   mas os frutos **não são consumidos** do chão (o ecossistema é o dono deles).
4. Não há reprodução, predação nem morte de animais.
5. A prancha é raster suave; a conversão para pixel art é uma redução fiel, não
   uma re-ditagem pixel a pixel — detalhes finos (olhos, penas) foram
   preservados em 1–2 px.
6. Coelho e ave não atravessam chunk: ficam contidos na área do chunk dono
   (a travessia com transferência de dono existe para insetos; para a fauna
   ficou como evolução futura para não duplicar donos).

## 8. Como reproduzir

```bash
npm run sprites:fauna   # regenera assets/Animals/*.png a partir da prancha
npm run visual:fauna    # cena headless (escala/recorte)
npm test                # 118 testes
npm run build
```
