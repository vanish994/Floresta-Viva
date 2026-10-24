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

- `docs/imagens/pixellab_autotile.png` — ilha de grama cercada por folhiço,
  colada só com os recortes do manifesto (borda orgânica, sem costura).
- `docs/imagens/pixellab_cadeia.png` — rio serpenteando com margem e folhiço
  usando **três folhas da cadeia** ao mesmo tempo.

## Estado atual

As folhas estão **importadas e validadas**, mas o render do mundo ainda usa o
tileset do pack anterior (`docs/TILESET.md`). Ligar o autotile no mundo precisa
de um campo de "bioma de chão" por célula (`água/margem/folhiço/grama/rocha`),
que hoje não existe — o `soilType` tem 5 classes, mas não é essa cadeia.
É o próximo passo natural, e é uma mudança de simulação (não só de render).

## Limitações

- Os tilesets são **planos** (sem penhasco 2,5D), bom para top-down — mas o
  relevo de `04_grama_relevo` não substitui o sistema de `cliffs` do jogo.
- A ordem `lower/upper` é convenção do pacote; trocar qual nível é "chão" muda
  o desenho da borda.
- O atlas `props_atlas_arvores_vegetacao.png` (128×128, 4×4) **não** foi usado:
  as árvores atuais seguem Harmonious (opção A).
