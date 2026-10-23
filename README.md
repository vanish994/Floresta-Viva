# Floresta Viva

Mundo procedural de floresta, explorável e ecologicamente dinâmico, construído em
TypeScript + Canvas2D (Vite), usando os sprites reais do pacote
**Harmonious 2D Pixel Art Pack** (`Harmonious 2D Pixel Art Pack.zip`, extraído em `assets/`).

O mundo nasce de uma **seed**: relevo, rios, lagos, solos, bosques, clareiras e trilhas
são funções determinísticas de coordenadas globais. Chunks são carregados/descarregados
conforme o personagem se move, e os sistemas ambientais (água, solo, vegetação,
decomposição, erosão, clima, estações) evoluem em frequências separadas do render.

## Como executar

```bash
npm install
npm run dev          # abre o jogo (Vite em 0.0.0.0:5173)
npm test             # 82 testes (determinismo, continuidade, hidrologia, água, erosão, natação, ecologia, tempo, chunks, persistência)
npm run preview:world  # validação visual headless: renderiza PNGs reais + mapas de campos
npm run scenario:water # cenário reproduzível da física da água (volumes + orçamento)
npm run scenario:erosion # cenário reproduzível de erosão/sedimentação/margens
npm run build        # typecheck + bundle
```

### Validação visual headless

```bash
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find forest
npx tsx tools/preview.ts --seed 4242 --day 4 --hour 15 --find river
npx tsx tools/preview.ts --seed 777  --day 16 --hour 10 --find open   # inverno/neve
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find river --sim 8 --rain 1  # enchente
npx tsx tools/water-scenario.ts --hours 10 --rain 0.02                # balanço de massa
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find river --sim 96   # 96 h de erosão
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find water --swim 1   # personagem nadando
```

Gera em `.tmp/previews/` uma cena renderizada com as **mesmas ops de desenho do jogo**
(executadas por um rasterizador software) e um mapa com seis painéis
(elevação, fluxo, água, umidade, solo, floresta) para inspecionar continuidade e hidrologia.
Exemplos commitados em `docs/imagens/`.

## Controles

| tecla | ação |
| --- | --- |
| WASD / setas | mover (em água funda, nadar) |
| `Q` | alterna modos de depuração (chunks, elevação, umidade, fluxo, correnteza, solo, vegetação, água, areia, sedimento, nutrientes) |
| `P` | pausa o relógio do mundo |
| `F` | derruba a árvore mais próxima (vira liteira; efeito ecológico real) |
| `G` | planta uma muda da espécie mais adequada ao solo local |
| `🌧 chuva` | força chuva máxima (para ver o nível dos rios subir e transbordar) |
| botões do HUD | novo mundo (seed), salvar, debug, pausa, trocar personagem |

Em **água funda** (≥ 0,45 m) o personagem nada: mais lento que andar, com o corpo
submerso (o sprite é cortado na linha d'água, com ondulação, braçadas e esteira),
fôlego que cai nadando e volta em terra/água rasa — e a **correnteza real** do
solver empurra a favor ou contra (nadar rio acima rende menos e cansa mais).
Água rasa (< 0,45 m) é vadeo. Penhascos e troncos continuam bloqueando.

O jogo salva automaticamente a cada 20 s em `localStorage` (diffs, não o mundo inteiro).

## Mobile first

O jogo é jogável no celular (toque), não só no desktop:

- **Joystick virtual** no canto inferior esquerdo (aparece só em dispositivos de toque,
  `src/game/touch.ts`) e botões **F** (derrubar) / **G** (plantar) no canto inferior direito.
- **HUD recolhível**: em telas pequenas ele abre colapsado (só o relógio) com botão `+/–`
  para expandir; sem scroll, sem zoom (`user-scalable=no`, `viewport-fit=cover`).
- **Orçamento de performance** em telas pequenas: raio de carga de 2 chunks
  (vs. 3 no desktop) e 1 chunk gerado por frame, para manter o frame estável.
- **Build relativo** (`base: './'` + sprites como `publicDir`): o mesmo `dist/` funciona
  na raiz ou em subpath (ex.: GitHub Pages em `/Floresta-Viva/`) — os sprites são
  copiados para a raiz do `dist/` e referenciados por caminho relativo.

## O que existe de fato

- **Chunks determinísticos** por seed + coordenadas globais, com lookahead de movimento,
  orçamento de geração por frame e descarregamento por distância.
- **Relevo** com contraste de vales/montanhas, hillshade e tiles de penhasco reais.
- **Hidrologia gerada**: D8 sobre potencial hidráulico, acumulação multi-escala (bacias
  distantes semeiam o anel do chunk), lagos por lençol freático climático, rios com
  largura por vazão, margens alargadas por cota.
- **Física real da água**: volume por célula (`waterDepth`, m) escoando por gravidade
  (Manning sobre `elev + depth`), com conservação de massa, buffers de transferência,
  fluxo entre chunks, subpassos fixos (independentes de FPS), chuva → infiltração →
  escoamento, nascentes, evaporação, drenagem e orçamento separado por processo.
  Lagos enchem e transbordam, rios alargam em enchentes, poças secam e a correnteza
  arranca árvores vulneráveis. Ver [`docs/FISICA_DA_AGUA.md`](docs/FISICA_DA_AGUA.md).
- **Solo vivo**: textura (arenoso/argiloso/rochoso/florestal/aluvial), profundidade, umidade,
  liteira, húmus, N/P/K, pH, atividade microbiana, estresse hídrico — com balanço de massa
  fechado (mineralização, imobilização, intemperismo de P, lixiviação).
- **Vegetação**: 6 espécies com traços ecológicos; germinação/recrutamento por pressão de
  sementes + zoocoria, crescimento por idade/saúde, competição por luz (copa), morte por
  estresse, senescência, liteira sazonal (decíduas perdem folhas no outono).
- **Erosão, sedimentos e margens**: solo desprotegido erode pela correnteza e pela chuva
  (resistência por textura, copa, matéria orgânica e raízes); a carga é transportada na
  direção real do fluxo, atravessa chunks e deposita onde a energia cai — formando bancos
  de areia, praias e lama de lago. A areia é um estado físico (fração + espessura de
  depósito) com histerese, e margens secas sob vegetação se recuperam. Ver
  [`docs/EROSAO.md`](docs/EROSAO.md).
- **Clima/astronomia**: dia de 24 min reais, declinação solar por inclinação axial (23,4°),
  duração do dia variando com a estação, estações configuráveis (28 dias/ano), chuva em
  feixes determinísticos, neve no inverno.
- **Natação**: água profunda é atravessável nadando (limiar de 0,45 m), com fôlego,
  correnteza real empurrando o corpo e desenho submerso coerente com a lâmina.
- **Fauna**: modelo de atividade (alimento/água/abrigo/hora/estação) que já alimenta a
  dispersão de sementes; interfaces `FaunaAgent`/`FaunaSystem` para agentes visuais futuros.
- **Persistência** versionada em `localStorage` com diffs (plantas removidas/recrutadas,
  solo quantizado, deltas de terreno, lâmina e velocidade da água, relógio, posição).

## Documentos

- `docs/ARQUITETURA.md` — decisões técnicas e fluxo de dados.
- `docs/PARAMETROS.md` — todos os parâmetros configuráveis e traços das espécies.
- `docs/FISICA_DA_AGUA.md` — física da água: modelo, conservação, testes, limitações.
- `docs/EROSAO.md` — erosão, transporte/deposição de sedimentos e margens arenosas.
- `docs/RELATORIO_FINAL.md` — relatório final pedido pelo prompt (testes, limitações, pendências).
- `docs/PROMPT_MUNDO_PROCEDURAL_FLORESTA_VIVA.md` — o prompt original do projeto.

## Créditos

Sprites: *Harmonious 2D Pixel Art Pack* (itch.io), presente no repositório como zip.
O marcador roxo de sombra dos sprites é convertido em sombra escura suave em tempo de
carga (`src/render/sanitize.ts`), preservando transparência, pivô e proporção.
