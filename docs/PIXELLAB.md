# Tilesets Wang do pack PixelLab (autotiling)

`Floresta_completa_PixelLab.zip` (raiz do repo) traz **5 tilesets Wang 4×4** com
tiles de **32×32 nativos** (a escala do mundo) e metadados de autotiling. É o
primeiro pacote que **não precisa ser reduzido**: os tiles já encaixam 1:1.

## Conteúdo e cadeia de terreno

| folha | lower (0) | upper (1) |
| --- | --- | --- |
| `01_lago_margem` | água parada do lago | margem enlameada |
| `02_margem_chao_floresta` | margem enlameada | folhiço de floresta |
| `03_chao_grama` | folhiço de floresta | grama com trevos e flores |
| `04_grama_relevo` | grama | relevo rochoso com musgo |
| `05_grama_riacho` | grama | riacho de água corrente |

A cadeia encadeia: **água → margem → folhiço → grama → rocha**, com o riacho
como ramificação da grama.

## Metadados (o que dá o autotile de graça)

Cada JSON declara, por tile, os 4 cantos (`NW/NE/SW/SE` = `upper`/`lower`) e o
`bounding_box` recortando 32×32 na folha 128×128. Com os 16 cantos presentes,
o autotile é uma consulta:

```
chave = (NW?1:0)+(NE?1:0)+(SW?1:0)+(SE?1:0)   → recorte na folha (lo, hi)
```

## Importador (`npm run sprites:pixellab`)

`tools/import-pixellab-tiles.ts`:

1. lê o zip **direto do repositório** (nada de copiar 100 KB extras);
2. monta `canto → recorte` por folha e **valida os 16 cantos**;
3. registra a medida `bottomDrop` (base mais escura que o topo) só como
   diagnóstico — **não descarta** por desenho: a "lombada" inferior é o que
   liga chão e margem no próprio tileset (tirar o tile descasava dois cantos,
   descoberto na primeira versão do extrator);
4. grava `assets/Tilesets/pixellab/<folha>.png` + `.json` (com `corners`) e um
   `index.json` com as 5 folhas.

Resultado por folha: **16/16 cantos únicos** nas cinco.

## Validação visual

- `docs/imagens/pixellab_mapa_floresta.png` — cena de floresta com tiles Wang
  ativos no `composeScene` real (árvores/props ficam no sistema atual).
- `docs/imagens/pixellab_mapa_agua.png` — cena de lago: Wang água/margem,
  folhiço e riacho; lâmina/profundidade e fluxo continuam vindo do solver.
- `docs/imagens/pixellab_autotile.png` — ilha de grama cercada por folhiço,
  colada só com os recortes do manifesto (borda orgânica, sem costura).
- `docs/imagens/pixellab_cadeia.png` — protótipo da cadeia usando **três folhas**
  simultaneamente; imagem de validação do importador, não um novo renderer.

## Render do mundo (ativo, sem tecla/alternância)

O tileset PixelLab é agora o **único tileset de chão/água usado pelo jogo** por
padrão (`DEFAULT_TILESET = 'pixellab'`). `main.ts` não pede uma tecla T nem um
botão: abre já com o mapa novo. Os tiles antigos continuam em `assets/` por
compatibilidade e comparação interna, mas `composeScene` não os desenha no modo
PixelLab.

`composeScene` deriva o nível visual dos dados físicos que já existem — sem
adicionar campo paralelo, alterar simulação, save ou geração:

| nível | regra derivada dos dados da célula | transição PixelLab |
|---|---|---|
| 0 água | profundidade `waterDepth > 0,12 m` | `01_lago_margem` (água) |
| 1 margem | água rasa, `sandLayer`/fração arenosa, solo arenoso ou borda molhada | `01` (lama) |
| 2 folhiço | floresta fechada (pouca forragem + pouca luz) ou argila muito úmida | `02_margem_chao_floresta` |
| 3 grama | clareira/solo aluvial/solo de floresta aberto | `03_chao_grama` |
| 4 rocha | `SOIL_ROCK` ou declive íngreme | `04_grama_relevo` |
| riacho | bit de correnteza em `waterKind` + água no tile | `05_grama_riacho` |

Cada tile amostra os quatro cantos e consulta a folha Wang correspondente. A
água continua física: profundidade, correnteza, infiltração, erosão e filetes
continuam ligados ao solver; o que mudou é a textura-base e a margem visual.
A borda de penhasco antiga não é sobreposta no modo PixelLab: a transição Wang
`03→04` dá o relevo rochoso top-down. A neve não existe nas 5 folhas PixelLab;
no inverno o tile PixelLab recebe um véu frio (não é outro tileset).

O cálculo é cacheado por tile durante a composição da cena. Não se grava no save;
worlds antigos usam imediatamente o mesmo estado físico para desenhar o novo
mapa.

## Limitações

- Os tilesets são **planos top-down**. O Wang `04_grama_relevo` substitui a
  sobreposição visual antiga de cliffs no modo PixelLab; ele não altera a
  elevação nem a física do relevo.
- A ordem `lower/upper` é convenção do pacote; trocar qual nível é "chão" muda
  o desenho da borda.
- Árvores e props continuam Harmonious: o atlas PixelLab 128×128 tem bases
  em losango/3⁄4 e não foi substituído nesta alteração de chão/água. Os packs
  "Pixel Lab 24/25" de árvores mencionados pelo usuário ainda não aparecem no
  `main` visível desta sessão.
