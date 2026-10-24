# Tileset de chão e água (PixelLab Wang; alternativa antiga pack recolorido)

O jogo agora usa **somente o tileset Wang PixelLab** para o chão e a água
(`docs/PIXELLAB.md`): água, margem, folhiço, grama, rocha e riacho. A física,
IA e save não mudam.

| tileset | papel atual | arquivos |
| --- | --- | --- |
| `pixellab` | **ativo no jogo** | `assets/Tilesets/pixellab/*.png` (Wang nativo 32×32) |
| `pack` | folhas geradas, mantidas para comparação/ferramentas | `assets/Ground/pack_tiles.png`, `assets/Water/pack_water*.png` |
| `harmonious` | fallback/testes; não desenhado no mapa normal | `assets/Miscellaneous/tiles.png`, `assets/Water/WaterTilesAnimated/*` |

Não há alternância de tileset na interface do jogo. Ferramentas de comparação
podem mudar o seletor em memória; o default de runtime é `pixellab`.

---

## 1. Por que não foi "colar o pack"

As pranchas do pack são material de apresentação: tiles de **200–280 px**,
fundo escuro, títulos, margens em 2,5D, ilhas e cachoeiras. O mundo usa **32 px**
(`cfg.tileSize`). Colar direto daria:

- redução de ~8× sem preservar o pixel-grid nativo (não existe grade uniforme —
  testados fatores de 4 a 16);
- ruído de alta frequência em 32 px (desvio de luminância ~16 contra ~3 do tile
  atual) → o chão lia como "xadrez";
- paleta 16-bit saturada contra o pastel do Harmonious (árvores, fauna, cobra e
  personagem) → a tela brigava consigo mesma.

## 2. O pipeline (`npm run sprites:pack`)

`tools/extract-pack-tiles.ts` lê o zip **direto do repositório** (sem duplicar
17 MB em `assets/`) e, para cada prancha:

1. **localiza os tiles pelo desenho** (projeção de luminância: os tiles são
   retângulos claros sobre fundo quase preto) — nada de coordenada fixa;
2. **recua 4,5%** em cada lado para descartar a moldura/sombra de apresentação
   (sem isso a borda entrava no sprite e virava grade no mundo);
3. **reduz para 32×32 por média de área** (preserva o desenho, evita serrilhar);
4. **pontua a "planura"** de cada tile e descarta o que não é chão:
   borda/moldura, metade de cima ≠ metade de baixo (tiles de transição),
   quadrante diferente (areia + mar), bloco escuro (2,5D) e água;
5. **quantiza** a paleta (12 níveis) e aplica **casamento de tom** com o tile
   atual do jogo (`matchTone`):

   ```
   out = (v − média_pack) · min(1.35, sd_ref/sd_pack) + média_ref    (piso 0.72)
   ```

   O desvio é limitado por baixo (0.72) e por cima (1.35): sem o piso a textura
   era apagada e o chão virava cor chapada; sem o teto voltava o ruído.

Resultado (medido): grama com média **93** e desvio **7,4** (o tile antigo tem
média 94 e desvio 3,3; o pack cru tinha desvio ~16).

## 3. O que foi extraído

| tipo | variantes | prancha de origem |
| --- | --- | --- |
| grama | 4 | `1. Grass and dirt.png` (linha 0) |
| terra | 2 | `1. Grass and dirt.png` (linha 1) |
| areia | 2 | `9. Beach.png` / `8. Desert.png` (linha 0) |
| neve | 1 | `7. Snow.png` (linha 0) |
| água (superfície) | 4 quadros | `2. Water.png` (linha 0) |
| água (fundo) | 4 quadros | mesma arte × `deepen()` (0.62/0.74/0.90) |

A prancha de praia tem **só 1 tile realmente plano** (o resto é transição areia→
mar, ilha em 2,5D, borda com rocha); o extrator escolhe por pontuação, não por
índice — foi assim que o tile "meio areia, meio mar" deixou de entrar.

## 4. Tileset PixelLab (padrão atual)

O mapa usa agora as folhas Wang PixelLab para **água, margem, folhiço, grama,
rocha e riacho**, com `DEFAULT_TILESET = 'pixellab'`. O renderer deriva o bioma
visual dos dados físicos já existentes (`waterDepth`, `soilType`, `sandLayer`,
`forage`, `light`, `slope`) e faz autotile por quatro cantos. Não há estado novo
nem mudança em física, IA ou save. Detalhes e preview em [`PIXELLAB.md`](PIXELLAB.md).

A geração anterior de tiles recoloridos do pack gratuito continua em
`assets/Ground/pack_tiles.png` e `assets/Water/pack_water*.png` para testes/A-B;
não é desenhada no jogo. Não há tecla nem botão de alternância.

## 5. Testes e validação

`tests/tileset.test.ts` valida as folhas pack+PixelLab, recortes, default PixelLab
e que a cena não desenha os tiles antigos. A cadeia Wang testada por metadados
cobre 16 cantos por folha. Suíte completa: **207 testes**.

## 6. Como reproduzir

```bash
npm run sprites:pack      # regenera assets/Ground/pack_tiles.png e assets/Water/pack_water*.png
npm run visual:tileset    # comparação headless dos tilesets antigos (ferramenta)
npm run preview:world     # cena headless do mundo (PixelLab por padrão)
npm test                  # 207 testes
npm run build
```

## 7. Limitações honestas

- **Só chão e água.** Árvores, pedras, arbustos, flora e fauna continuam
  Harmonious (é o combinado da opção A). O pack tem árvores/rochas/flores que
  **não** foram usados.
- A água do pack é **estática por quadro** (4 quadros da prancha); a animação
  fina continua vindo do overlay do jogo (filetes pela velocidade do solver).
  Não há autotile/margem do pack: a margem é desenhada pelo código, como antes.
- **Licença**: o pack não traz arquivo de licença no zip. Antes de publicar,
  confirme os termos do autor do pack — o asset final vai no GitHub Pages.
- O zip (17,4 MB) **já estava versionado** no repositório antes desta mudança;
  este trabalho apenas o consome (não adiciona cópia em `assets/`). Vale mover
  para fora do Git numa limpeza futura.
- A comparação é por render headless com as ops reais; não houve captura em
  navegador/celular.
