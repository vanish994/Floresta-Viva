# Tileset de chão e água (pack gratuito, recolorido)

O chão (grama, terra, areia, neve) e a água podem vir de **dois tilesets**. A
escolha é um único ponto no manifesto e não toca em física, IA, save ou testes
de comportamento.

| tileset | arquivo | origem |
| --- | --- | --- |
| `harmonious` (antigo) | `assets/Miscellaneous/tiles.png` + `assets/Water/WaterTilesAnimated/*` | pacote Harmonious (original do projeto) |
| `pack` (novo, padrão) | `assets/Ground/pack_tiles.png` + `assets/Water/pack_water*.png` | "Free asset pack", recolorido |

No jogo, **`T` alterna** entre os dois ao vivo (o HUD mostra qual está ativo).
Nada é salvo: ao recarregar, volta o padrão do manifesto.

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

## 4. Integração no render

- `manifest.ts`: `PACK_GROUND` (recortes por tipo), `PACK_GROUND_FILE`,
  `PACK_WATER_FILE`, `PACK_WATER_DEEP_FILE`, `DEFAULT_TILESET = 'pack'`,
  `setActiveTileset()` / `activeTilesetId()` e `groundRect(kind, variant)`.
- Variante: o `chunk.groundVariant` (0–3), que já existia gerado em `gen.ts`,
  escolhe entre as 2–4 texturas do tipo.
- **Espelho determinístico**: em `(tx + ty + variante) & 1` o tile é desenhado
  espelhado — 2 variantes × 2 orientações = 8 leituras por textura, o que quebra
  a "grade" sem custo de asset.
- Água: o overlay translúcido por profundidade **continua igual**; muda só a
  folha (superfície e fundo) e o alpha base (0,82 no pack contra 0,92).
- Areia: no tileset antigo a areia era o próprio tile de terra clareado por um
  `fill`; no pack já existe areia de verdade, então o véu é desligado.

## 5. Testes e validação

`tests/tileset.test.ts` (7 casos):

1. folhas existem, cada célula é 32×32 e cabe na folha (e nenhuma repete recorte);
2. todo tipo tem variante; `DEFAULT_TILESET === 'pack'`;
3. `groundRect` alterna tilesets e não estoura com variante negativa/grande;
4. a paleta do pack fica na mesma faixa do jogo **e ainda tem textura**;
5. `matchTone`/`harmonize` são determinísticos, casam a média e não estouram;
6. a cena usa a folha do tileset ativo (e o antigo continua funcionando);
7. o zip está no repositório e só tem PNG (as pranchas usadas continuam lá).

Imagem de validação: `docs/imagens/tileset_antes_depois.png`
(`npm run visual:tileset`) — mesma cena, **mesmas ops**, esquerda Harmonious,
direita pack.

## 6. Como reproduzir

```bash
npm run sprites:pack      # regenera assets/Ground/pack_tiles.png e assets/Water/pack_water*.png
npm run visual:tileset    # comparação A/B (docs/imagens/tileset_antes_depois.png)
npm run preview:world     # cena headless do mundo (usa o tileset ativo)
npm test                  # 203 testes
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
