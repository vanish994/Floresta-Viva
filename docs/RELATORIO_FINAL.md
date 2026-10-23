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
- `src/world/` — `fields.ts`, `hydro.ts`, `water.ts`, `sediment.ts`, `gen.ts`, `chunk.ts`,
  `world.ts`, `ecology.ts`, `climate.ts`, `flora.ts`, `fauna.ts`, `persistence.ts`
- `src/render/` — `ops.ts`, `scene.ts`, `CanvasRenderer.ts`, `manifest.ts` (gerado),
  `sanitize.ts`
- `src/game/` — `player.ts`, `input.ts`; `src/main.ts`; `index.html`; `src/ui/style.css`
- `tools/` — `preview.ts`, `software.ts`, `png.ts`, `gen-manifest.mjs`, `data/*`
- `tests/` — 13 arquivos, 107 testes
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
  (rasa→profunda) a partir da lâmina física; filetes e espuma seguem o vetor de
  correnteza real; frames aceleram com a velocidade.
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


---

## Atualização — física real da água (modelo conservativo)

O sistema anterior de água era visual: a lâmina vinha pronta da hidrologia D8 e o
passo "de água" somava volumes por fórmulas arbitrárias, roteava pela direção D8
dentro de cada chunk (parede nas bordas) e relaxava lagos/canais para alvos
sazonais — criando e destruindo água sem fonte ou sumidouro, e sem conservação.

Agora existe um solver de **volume por célula** (`src/world/water.ts`) rodando em
passo fixo de 0,02 h de jogo: `head = elevação + profundidade`, fluxo por Manning
entre as 8 direções, lâmina acima da soleira, rugosidade do solo e da vegetação,
com dois limites por transferência (equalização de superfície e disponibilidade da
origem). Todos os fluxos são calculados sobre snapshot e aplicados em buffers de
transferência ⇒ conservação de massa e independência da ordem de varredura; a
vizinhança é resolvida pelo mundo (sem fronteira artificial entre chunks).

Chuva, nascentes (`waterBase · springWeight`), evaporação, infiltração, drenagem e
saídas de borda são somadas por processo em `world.waterBudget` (m³). O jogo mostra
o volume de água no HUD e o modo de depuração `current` exibe a velocidade real.

Acoplamentos: a erosão passou a usar velocidade/profundidade reais com sedimento
conservado e atualização imediata de `chunk.elev`; o alagamento acumula
`floodHours` → estresse por espécie; o arrasto `ρgh·v` derruba árvores vulneráveis
(resistência por raiz/tamanho, teto por passo, liteira no local). A lâmina e a
velocidade são persistidas por chunk (save v2).

Resultados medidos (detalhes em `docs/FISICA_DA_AGUA.md`): **58 testes aprovados**
(15 de água), fechamento de massa com erro 0,0000% sem chuva e 0,0007% com chuva
forte, cenário reproduzível (encosta/canal/depressão) mostrando a lâmina descendo
de 0,45 m para 0,10 m no canal e a jusante subindo de 0 → 1,47 m, e solver custando
0,5–1,1 ms por quadro em 9–49 chunks.

Limitações: modelo hidrostático de poços (sem ondas/ressaltos), escala calibrada
(`waterFlowScale`), arquivo de água de chunks descarregados capado em 192 chunks,
nascentes como condição de contorno (sem aquífero completo) e erosão limitada a
±0,25 m por célula pelo limite persistente existente.


---

## Atualização — erosão, sedimentos e margens arenosas

O `stepErosion` anterior escrevia deltas de elevação com sinais mistos (criava e
destruía terreno), usava a direção D8 estática, descartava a deposição calculada
e nunca atualizava `chunk.elev`. A areia vinha só da geração e o render pintava
praias decorativas em qualquer margem de lago.

Agora a morfologia vive em `src/world/sediment.ts`, acoplada ao estado real da
água (velocidade/profundidade do solver): desagregação com resistência por
textura, copa, matéria orgânica e raízes; carga suspensa conservada, transportada
na direção do fluxo e através de fronteiras de chunk; deposição onde a correnteza
perde força (bancos de areia e praias) ou em água parada (lama de lago). A
elevação e a declividade são atualizadas no mesmo passo e persistidas em
`world.terrainDeltas`.

A areia passou a ser um estado físico: fração (`chunk.sand`) + espessura do
depósito (`chunk.sandLayer`). A célula só é classificada como arenosa acima de
0,55 de areia **e** 1 cm de depósito, com histerese (volta abaixo de 0,36) e
cooldown de 48 h; a lavagem seletiva tem teto abaixo do limiar, então não cria
areia sem sedimento. Vegetação protege o solo e recoloniza margens secas; erosão
profunda expõe raízes e pode derrubar árvores vulneráveis (resistência por
profundidade de raiz e tolerância à inundação).

Medições (detalhes em `docs/EROSAO.md`): **72 testes aprovados** (14 novos de
erosão/sedimentos), cenário reproduzível com fechamento de massa em 4,7e-9 e
`lost = 0`, canal rebaixado de 14,950 → 14,780 m, remanso com 1,7 cm de depósito
arenoso e 18 células reclassificadas como areia em 168 h. Custo: 3–4 ms por passo
de margem (1×/h de jogo) e 11–20 ms por passo de erosão (1×/24 h de jogo).

Limitações: deltas limitados a ±0,25 m por célula (teto pré-existente), transporte
de uma célula por subpasso com direção cardinal dominante, areia depende de solo
aluvial/arenoso como fonte, e a queda de árvores por erosão exige erosão local
profunda acumulada em muitos dias de jogo.


---

## Atualização — ecossistema vivo (flores, frutos, sementes, insetos)

A vegetação tinha só idade/saúde: flores eram decoração gerada e não existia
fruto, queda, semente ou inseto. Agora `src/world/ecosystem.ts` dá a cada planta
uma fenologia (vegetativo → floração → fruto verde → maduro → queda → fruto no
chão → semente → muda), acoplada ao clima/umidade/estação e à saúde existente.

Regra central: **fruto maduro cai**. A chance é acumulada (`1 − exp(−(Δt/hold) ·
(0,45+idade²) · chuva)`), com `hold` variando por espécie, saúde e por fruto —
nunca um tempo fixo, nunca indefinidamente na árvore.

Polinização é funcional: abelhas e borboletas visitam flores, carregam pólen e
fertilizam outra flor (vento contribui com 4%); lagartas reduzem folhas/saúde
(menos flores e frutos) e joaninhas reduzem a pressão de pragas. Tudo com tetos
populacionais e simulação só perto do jogador.

Frutos/sementes/insetos têm sprites próprios gerados em pixel art
(`tools/gen-eco-sprites.ts`), ancorados na geometria real da copa
(`treeGeometry`), com escala por porte (7/5/4/3 px). Fenologia, frutos no chão,
sementes e pragas são persistidos no save v2.

Medições: 94 testes aprovados (12 novos de ecossistema), cenário de 96 h
mostrando floração → 3 polinizações → 3 frutos maduros → 3 quedas, e teste
visual headless em `docs/imagens/ecossistema.png` (+ zoom). Limitações: insetos
não são salvos (reconstruídos), herbivoria é pressão agregada, e só as espécies
com planta compatível frutificam.
