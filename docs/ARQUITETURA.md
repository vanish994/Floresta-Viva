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
3. **Frequências distintas.** Relógio visual por frame; água a cada 0,5 h de jogo;
   biologia a cada 3 h; erosão a cada 24 h. Passos quantizados ⇒ independente de FPS.
4. **Persistência por diffs.** A seed regenera o que é determinístico; só mudanças
   (plantas removidas/recrutadas, solo modificado, deltas de erosão, relógio) são salvas.

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
- Escoamento superficial do passo de água roteia pela flowDir, atravessando chunks
  via `Neighborhood.cellAt`.

## Ecologia (`src/world/ecology.ts`)

- `stepWater`: chuva → interceptação pela copa → infiltração por textura → escoamento →
  evaporação/transpiração → percolação; umidade limitada a [0,1] (sem criação de água).
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
contínuo por profundidade interpolada por tile ⇒ margens suaves) → decalques de solo →
sprites ordenados por y (profundidade) → chuva → iluminação (tint multiply + escuridão
com furo de luz no personagem) → overlay de depuração.

Sprites nunca são esticados: rects medidos dos sheets reais (`src/render/manifest.ts`,
gerado por `tools/gen-manifest.mjs` a partir de bounding boxes de alpha); árvores jovens
usam escala uniforme quantizada; o marcador roxo de sombra vira sombra escura
(`sanitize.ts`).

## Persistência (`src/world/persistence.ts`)

`localStorage['floresta-viva:save:v1']` com `{version, generatorVersion, seed,
clockMinutes, player, deltas, chunks{removed, recruits, soil quantizado}}`.
Load seguro: versão/seed/gerador conferidos; diffs aplicados quando o chunk é gerado
(`world.onChunkGenerated`).

## Fauna (`src/world/fauna.ts`)

Sem sprites de animais no pacote ⇒ nada de fauna visual falsa. Existe um modelo
determinístico de atividade (copa/alimento, água, abrigo, hora, estação) que já altera o
mundo via zoocoria, e as interfaces `FaunaAgent`/`FaunaSystem` para agentes futuros.

## Ferramentas

- `tools/preview.ts` — validação visual headless (cenas + mapas de campos).
- `tools/png.ts` — codec PNG sem dependências (decode dos sprites / encode dos previews).
- `tools/gen-manifest.mjs` — regenera o manifesto de sprites a partir das medições.
