# Arquitetura — Floresta Viva

## Princípios

1. **Mundo = função pura de (seed, coordenada global).** Todo campo ambiental
   (`WorldFields`) é avaliado por coordenada, sem estado mutável global. Chunks são
   apenas janelas de armazenamento/renderização; por isso a continuidade entre chunks
   é garantida por construção e a ordem de carregamento não importa.
2. **Simulação separada da renderização.** A simulação escreve em typed arrays por
   chunk; a renderização só lê. O desenho é uma lista de **ops** (`src/render/ops.ts`)
   produzida por `composeScene` (função pura) e executada por dois backends:
   `CanvasRenderer` (navegador) e `SoftwareRenderer` (validação headless em Node).
3. **Frequências distintas.** Relógio visual por frame; superfície da água em passo
   fixo de 0,02 h (1,2 s reais); balanço hídrico do solo a cada 0,5 h; biologia a
   cada 3 h; erosão a cada 24 h. Passos quantizados ⇒ independente de FPS.
4. **Persistência por diffs.** A seed regenera o que é determinístico; só mudanças
   (plantas removidas/recrutadas, solo modificado, deltas de erosão, lâmina e
   velocidade da água, relógio) são salvas.

## Espaços de coordenadas (`src/core/coords.ts`)

- **px** mundo contínuo (personagem, câmera);
- **tile** 32 px (grade gráfica);
- **cell** 2 tiles = 64 px (grade de simulação ambiental — mais grossa que a gráfica,
  como pedido);
- **chunk** 32 tiles = 16 cells por lado.

## Geração de chunk (`src/world/gen.ts`)

1. `solveHydrology` (janela de células + margem de 28 células) → flowDir, acumulação,
   profundidade de água, classificação lago/rio.
2. Campos por célula: elevação (+deltas persistentes), declividade/aspecto, solo pai
   com dither determinístico nas fronteiras, umidade inicial de equilíbrio,
   liteira/húmus/N/P/K/pH/micróbios iniciais coerentes (o mundo nasce adulto).
3. Tiles: variação de chão, trilha natural (`trailField` = crista de ruído → curvas
   sinuosas), bits de penhasco por comparação de cota.
4. Vegetação em múltiplas escalas: densidade territorial (`forestDensity` com warp e
   clareiras) × manchas finas (`cluster`) × aceite por hash → bosques coesos, bordas
   irregulares, vazios. Espécie escolhida por idoneidade ecológica com mancha de
   "stand" (bosques de espécies compatíveis) e coorte de idade (clareiras de
   regeneração). Posições com jitter amplo, mas **dono = célula-âncora** ⇒ sem
   duplicatas em fronteiras.
5. Marcos paisagísticos (ridge noise) → bosques de gigantes + afloramentos.
6. Detalhes finos (serrapilheira, galhos, gramíneas, flores, arbustos de borda, rochas,
   tocos) só onde o micro-sítio permite, com agregação por ruído — nunca sprinkle
   uniforme.

## Hidrologia (`src/world/hydro.ts`)

- D8 sobre `head = max(elevação, nível do lago)`; ordenação topológica por bucket
  (determinística e O(n)).
- **Multi-escala**: um passo grosso (células de 8) cobre uma região ampla e semeia o
  anel externo da janela fina com a montante distante ⇒ um rio que nasce longe continua
  o mesmo rio em todos os chunks.
- Lagos: `elev < waterTable(clima)`; profundidade = (wt−elev)·3 com teto.
- Rios: `stream = smoothstep(acc)` contínuo (sem flip binário nas bordas); margens
  alargadas para células de cota próxima (rios de 2–3 células).
- A hidrologia D8 é apenas a **condição inicial** (relevo dos canais, lagos,
  `waterBase` e `springWeight`); a lâmina em si é simulada por `water.ts`.

## Física da água superficial (`src/world/water.ts`)

- Volume por célula (`waterDepth`, m) sobre a grade ambiental; `head = elev + depth`.
- Lei de Manning por aresta (8 direções), com lâmina acima da soleira entre as
  células, rugosidade do solo + vegetação e distância real entre células.
- Duas garantias por transferência: equalização de superfície (`≤ 0,5·Δh·A`) e
  disponibilidade (`≤ 45%` da lâmina da origem). Nunca há profundidade negativa
  nem oscilação em terreno plano.
- Todos os fluxos usam snapshot (`waterDepth` + `waterDelta` zerado por subpasso)
  ⇒ o resultado não depende da ordem de varredura.
- Vizinhança via mundo (`cellAt`): a fronteira de chunk é transparente; o anel
  externo carregado serve de borda e a borda ativa é aberta para jusante
  (`budget.boundary`), evitando represar rios no limite do streaming.
- Fontes/sumidouros explícitos e contabilizados em `WaterBudget` (m³): chuva,
  nascentes (recarga do lençol), evaporação, infiltração, drenagem e borda.
- `flowX/flowY` (m/s) derivados dos volumes transferidos alimentam renderização,
  erosão e arrancamento de vegetação. Nada de animação independente do estado.

## Acoplamentos

- **Solo**: `stepWater` (ecology) faz chuva → interceptação → infiltração →
  `surfaceInput` (água pendente que o solver move). Não há mais roteamento por D8
  nem criação de água no passo de solo.
- **Erosão**: usa velocidade e profundidade reais; sedimento suspenso conservado;
  `chunk.elev` atualizado no mesmo passo (deformação visível, deltas persistentes).
- **Vegetação**: alagamento acumula `floodHours` → estresse por espécie; arrasto
  `ρgh·v` com resistência por raiz/tamanho derruba árvores vulneráveis (teto por
  passo, hash determinístico, liteira no local, índice reconstruído).

## Ecologia (`src/world/ecology.ts`)

- `stepWater`: chuva → interceptação pela copa → infiltração por textura → escoamento
  pendente (`surfaceInput`) → evaporação/transpiração → percolação; umidade limitada a
  [0,1] (sem criação de água).
- `stepBio`: liteira (com pulso outonal das decíduas) → decomposição
  (função de umidade/temperatura) → húmus + mineralização de N/P/K; imobilização
  microbiana; intemperismo como única entrada de P; absorção pela vegetação;
  lixiviação de N; pH derivando; recrutamento por pressão de sementes + zoocoria
  (`fauna.ts`); mortalidade por estresse hídrico prolongado (vira liteira);
  solo florestal se desenvolve sob copa estabelecida.
- `stepErosion`: capacidade de transporte por vazão×declive÷resistência (cobertura
  vegetal + textura); deposição onde a energia cai; escreve em `world.terrainDeltas`
  (persistente, sobrevive a unload).
- Índices espaciais (`chunk.plantIndex`) mantêm ecologia e colisão baratas.

## Clima e astronomia (`src/world/climate.ts`)

- 1 min de jogo = 1 s real (dia = 24 min reais).
- Declinação δ = 23,4°·sin(2π(yf−0,125)); duração do dia por `acos(−tan φ·tan δ)`;
  luz = smoothstep do seno de elevação solar (crepúsculo suave).
- Temperatura = média anual + amplitude sazonal (latitude) + diurna + lapse de altitude
  − nuvens. Neve quando a máxima do dia < 7,5 °C.
- Chuva em feixes (ruído 1D no tempo) × fator sazonal (verão chuvoso).

## Renderização (`src/render/scene.ts`)

Ordem: chão (bioma/trilha/hillshade/penhasco/praias) → água (duas camadas com alpha
contínuo por profundidade interpolada por tile ⇒ margens suaves; filetes e espuma
seguem `flowX/flowY` reais) → decalques de solo →
sprites ordenados por y (profundidade) → chuva → iluminação (tint multiply + escuridão
com furo de luz no personagem) → overlay de depuração.

Sprites nunca são esticados: rects medidos dos sheets reais (`src/render/manifest.ts`,
gerado por `tools/gen-manifest.mjs` a partir de bounding boxes de alpha); árvores jovens
usam escala uniforme quantizada; o marcador roxo de sombra vira sombra escura
(`sanitize.ts`).

## Persistência (`src/world/persistence.ts`)

`localStorage['floresta-viva:save:v2']` com `{version, generatorVersion, seed,
clockMinutes, player, deltas, chunks{removed, recruits, soil, water, flow}}`
(lâmina quantizada em 12 m, velocidade em ±4 m/s).
Load seguro: versão/seed/gerador conferidos; diffs aplicados quando o chunk é gerado
(`world.onChunkGenerated`).

## Camada de jogo e mobile (`src/game/`, `src/main.ts`)

- `input.ts`: teclado (eixos WASD/setas, ações F/G/Q/P).
- `touch.ts`: joystick virtual + botões F/G via Pointer Events; só é exibido com
  `pointer: coarse`. O loop soma/prioriza o eixo de toque sobre o do teclado.
- `main.ts`: HUD DOM, autosave, e ajustes mobile-first (HUD colapsado em telas
  pequenas, `loadRadiusChunks: 2` quando `min(viewport) < 560 px`).
- Spawn (`world.findSpawn`): varre anéis ao redor da origem e escolhe o ponto
  caminhável com maior `forestDensity` (penalidade leve de distância), para o
  jogador nascer dentro de um bosque de verdade.

## Deploy (`vite.config.ts`)

- `base: './'`: URLs relativas → o `dist/` serve em qualquer subpath (GitHub Pages).
- `publicDir: 'assets'`: os sprites são copiados para a raiz do `dist/` e o
  `CanvasRenderer` os carrega com base `'./'` (idem no dev server).
- `build.assetsDir: 'bundle'`: evita colisão de nome com a pasta pública `assets/`.

## Fauna (`src/world/fauna.ts`)

Sem sprites de animais no pacote ⇒ nada de fauna visual falsa. Existe um modelo
determinístico de atividade (copa/alimento, água, abrigo, hora, estação) que já altera o
mundo via zoocoria, e as interfaces `FaunaAgent`/`FaunaSystem` para agentes futuros.

## Ferramentas

- `tools/preview.ts` — validação visual headless (cenas + mapas de campos, `--sim`/`--rain`).
- `tools/water-scenario.ts` — cenário reproduzível da física da água com orçamento de massa.
- `tools/png.ts` — codec PNG sem dependências (decode dos sprites / encode dos previews).
- `tools/gen-manifest.mjs` — regenera o manifesto de sprites a partir das medições.
