# Relatório final — Floresta Viva

## O que existia antes

O repositório continha apenas:

- `README.md` com uma linha (`# Floresta-Viva`);
- `Harmonious 2D Pixel Art Pack.zip` (79 PNGs, tiles de 32 px, sheets de árvores/arbustos/
  água/penhascos/trilhas/personagens);
- `docs/PROMPT_MUNDO_PROCEDURAL_FLORESTA_VIVA.md` (este briefing).

Não havia código, motor, mapas nem sistema algum. Toda a arquitetura foi criada agora,
em TypeScript + Canvas2D (Vite), reaproveitando 100% dos sprites do pacote.

## O que foi implementado

1. **Infraestrutura determinística**: hashes por coordenada, ruído coerente com warp,
   conversões px/tile/cell/chunk, configuração central.
2. **Chunks**: streaming por distância com lookahead de movimento, orçamento de geração
   por frame (2 chunks/frame), descarregamento por margem, priorização espiral.
3. **Relevo**: fbm + ridge com curva de contraste, hillshade por aspecto/declive,
   tiles reais de penhasco nas bordas íngremes, deltas persistentes de erosão.
4. **Hidrologia**: D8 com ordenação topológica, acumulação multi-escala (bacias distantes
   semeiam a janela local), lagos por lençol freático climático, rios com largura por
   vazão e margens por cota, escoamento superficial roteado entre chunks, canais que
   secam/mudam com a estação no passo de água.
5. **Solo e nutrientes**: 5 texturas com infiltração/retenção próprias, profundidade,
   umidade, liteira, húmus, N/P/K, pH, micróbios, estresse hídrico; mineralização,
   imobilização, intemperismo (única entrada de P), lixiviação, absorção — balanço fechado.
6. **Vegetação**: 6 espécies com traços; composição em 3 escalas (territorial, paisagem,
   detalhes); recrutamento por pressão de sementes + zoocoria; crescimento por
   idade/saúde; competição por luz via copa; morte por estresse; senescência; liteira
   sazonal; solo florestal se desenvolve sob copa.
7. **Erosão**: passo diário de transporte/deposição escrevendo deltas persistentes.
8. **Ciclos de tempo**: dia de 24 min reais (1 min de jogo = 1 s), modelo astronômico com
   inclinação de 23,4°, duração do dia variável, estações configuráveis (28 dias/ano),
   chuva em feixes, neve por máxima diária, iluminação suave + luz noturna do personagem.
9. **Fauna**: modelo de atividade determinístico que já alimenta dispersão de sementes;
   interfaces prontas para agentes visuais (não há sprites de animais no pacote).
10. **Persistência**: save versionado em localStorage por diffs (plantas, solo quantizado,
    deltas, relógio, posição), aplicado no regenerar do chunk; auto-save 20 s.
11. **Jogo**: personagem com colisão real (água profunda, paredões, troncos), animações do
    pacote, HUD, modos de depuração (8 heatmaps + bordas de chunk), cortar/plantar árvores.
12. **Ferramentas**: validação visual headless com os sprites reais (mesmas ops do jogo),
    mapas de campos, codec PNG próprio, gerador de manifesto de sprites medido.

## Principais arquivos

- `src/core/` — `rng.ts`, `coords.ts`, `config.ts`
- `src/world/` — `fields.ts`, `hydro.ts`, `gen.ts`, `chunk.ts`, `world.ts`, `ecology.ts`,
  `climate.ts`, `flora.ts`, `fauna.ts`, `persistence.ts`
- `src/render/` — `ops.ts`, `scene.ts`, `CanvasRenderer.ts`, `manifest.ts` (gerado),
  `sanitize.ts`
- `src/game/` — `player.ts`, `input.ts`; `src/main.ts`; `index.html`; `src/ui/style.css`
- `tools/` — `preview.ts`, `software.ts`, `png.ts`, `gen-manifest.mjs`, `data/*`
- `tests/` — 7 arquivos, 39 testes
- `docs/` — este relatório, `ARQUITETURA.md`, `PARAMETROS.md`, `imagens/`

## Como funciona a geração por seed e chunks

Toda grandeza é função pura de `(seed, x, y)`: `WorldFields` avalia relevo, solo pai,
lençol freático, densidade de floresta e trilhas por célula global. `generateChunk`
materializa uma janela (16×16 células) resolvendo hidrologia numa janela maior
(margem 28) semeada por um passo grosso que cobre a bacia distante. Objetos pertencem à
célula-âncora ⇒ sem duplicatas nas bordas; como os campos são globais, bordas batem
exatamente e rios/vegetação atravessam chunks sem cortes. A seed textual vira inteiro por
FNV-1a; a versão do gerador invalida saves incompatíveis.

## Como foi resolvida a composição visual

- **Nada de sorteio por tile**: densidade territorial (warp + clareiras) × manchas finas ×
  coortes de idade → bosques coesos, bordas irregulares, clareiras com flores/gramíneas,
  serrapilheira sob copa, arbustos na transição, rochas em solo rochoso, tocos raros.
- **Contraste e leitura**: hillshade por aspecto solar, penhascos reais, praias arenosas
  em lagos, margens úmidas em rios, trilhas sinuosas de solo batido.
- **Água contínua**: profundidade interpolada por tile com duas camadas de alpha
  (rasa→profunda) + frames animados sincronizados; linha d'água escura na borda.
- **Assets respeitados**: rects medidos por bounding box de alpha (árvores grandes têm
  frames de 60–90 px, não 32); proporção preservada (escala uniforme apenas para
  crescimento); marcador roxo de sombra convertido em sombra escura.
- **Validação real**: `tools/preview.ts` renderiza headless com o mesmo pipeline
  (`composeScene` → rasterizador software) — exemplos em `docs/imagens/`
  (floresta+rio, rio, inverno com neve, noite, mapas de campos).

## Sistemas ecológicos realmente funcionais

Umidade/água (chuva→infiltração→escoamento→evapotranspiração→percolação), decomposição
com reciclagem de N/P/K, imobilização, intemperismo, lixiviação, estresse hídrico com
mortalidade, recrutamento com zoocoria, competição por luz, liteira sazonal, erosão
persistente, solo florestal dinâmico. Testes de balanço de massa garantem que nada é
criado infinitamente.

## Como executar e testar

```bash
npm install && npm run dev     # jogar
npm test                       # 39 testes
npx tsx tools/preview.ts --seed 1337 --day 4 --hour 10 --find forest
```

## Testes executados e resultados

`npx vitest run` → **7 arquivos, 39 testes, todos passando** (~11 s):

- determinismo: mesmos campos/plants/decor em regenerações; ordem de carregamento
  irrelevante; unload/reload idêntico; seeds diferentes ≠ mundos diferentes;
- continuidade: bordas batem com o campo global (1e-4), sem degraus; profundidade de rio
  contínua na fronteira; zero plantas/decor duplicadas; densidade gradual;
- hidrologia: fluxo sempre para potencial ≤; acumulação monotônica; lagos só abaixo do
  lençol; rios com montante coerente; janelas sobrepostas concordam (<6% de discordância
  de classe/altura);
- ecologia: espécies respondem diferente à umidade; decomposição transfere sem criar
  massa; nutrientes limitados em 400 passos; seca eleva estresse; chuva molha / seca
  seca; copa limita luz; derrubar árvore reduz copa;
- tempo: dia = 24 min reais; 1 min de jogo = 1 s; sol ~06:00/18:00 no equinócio; duração
  do dia varia >1,5 h entre verão/inverno; luz suave (salto <0,12 por 5 min); estações
  determinísticas; simulação independente de FPS;
- chunks: orçamento por frame respeitado; <60 ms/chunk; memória limitada após viajar;
  lookahead carrega à frente; frequências independentes avançam;
- persistência: round-trip de plantas/solo/relógio/posição; deltas de terreno; save de
  outro seed recusado; diffs reaplicados no regenerar.

Validação visual executada: 9 cenas headless (3 seeds × dia/noite/crepúsculo/estações +
rio + floresta + abertura) e mapas de 6 campos por seed, inspecionados manualmente
(iterações: sombras roxas, frames de árvores cortados, água em xadrez, bordas duras,
florestas em grade — todos corrigidos). **Não foi possível abrir um navegador real neste
ambiente**: a validação visual usa o rasterizador software com os sprites reais e as
mesmas ops; o servidor Vite foi verificado por HTTP (index/main/assets 200) e o build de
produção passa.

## Limitações conhecidas

- Água não usa autotiles de borda do pacote (sheets são "stamps" fechados, não autotile
  documentado); optou-se por alpha contínuo por profundidade, que é contínuo entre chunks.
- Relevo é 2.5D top-down com hillshade + penhascos de 1 tile (sem colunas de altura).
- Erosão é um passo simplificado de transporte/deposição (sem meandros dinâmicos).
- Fauna não tem agentes visuais (pacote sem sprites de animais); só o modelo de
  atividade/zoocoria.
- Catch-up de regiões descarregadas usa avanço agregado aproximado (documentado em
  `world.catchUp`), não passos finos.
- Iluminação noturna é tint + gradiente radial (sem sombras dinâmicas por sprite).
- O personagem não nada: água >0,5 m bloqueia.

## O que ficou pendente

- Agentes de fauna visuais e seus ciclos (alimentação, carcaças, fezes) sobre as
  interfaces já existentes.
- Autotiling completo de trilhas com as variações do pacote (hoje: solo batido por alpha).
- Construções/colheita do jogador além de cortar/plantar árvores.
- Áudio (o pacote tem `Background Music/` no zip, não extraído/usado).
- Sincronização multi-sessão/multiplayer (fora do escopo).
