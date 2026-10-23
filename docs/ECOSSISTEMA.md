# Ecossistema vivo — floração, frutos, sementes e insetos

Documento da entrega: o que existia, o que mudou, o modelo ecológico, os testes
executados, o teste visual, as limitações e o desempenho.

---

## 1. Antes × depois

| área | antes | depois |
| --- | --- | --- |
| vegetação | `PlantRecord` + `species` + idade/saúde; sem estado fenológico | cada planta ganha `pheno` (estágio, flores, frutos, pragas) — persistido no save |
| floração | só decoração (`decor` de flores geradas, sem relação com a planta) | floração real da planta adulta saudável, com nº de flores por estação e saúde |
| polinização | não existia | inseto visita flor → carrega pólen → fertiliza outra flor; vento é raro |
| frutos | não existiam (só um SVG de overlay 1 px na main) | catálogo de 13 frutos com sprites 32×32, verde → maduro, na copa |
| queda | não existia | fruto maduro cai com risco crescente (varia por espécie/saúde/fruto) |
| fruto no chão | não existia | vive no chão, decompõe em ~2 dias e pode deixar semente |
| sementes | só o recrutamento por pressão de sementes da copa | banco de sementes no solo → germinação → muda |
| insetos | nenhum | abelha, borboleta (polinizadores), lagarta (herbívora), joaninha (predadora) |
| herbivoria | nenhuma | lagarta reduz folhas/saúde → menos flores → menos frutos |
| predação | nenhuma | joaninha reduz pragas do chunk e das plantas próximas |
| fauna | modelo determinístico de atividade (sem agentes) | mantido + insetos com agentes leves (pool, sem save) |

Nada do sistema anterior foi substituído: clima, solo, água, erosão, saúde e
recrutamento continuam os mesmos e passaram a ser usados como entrada.

---

## 2. Arquivos

| arquivo | papel |
| --- | --- |
| `src/world/ecosystem.ts` (**novo**) | catálogo de frutos, fenologia, polinização, queda, frutos no chão, sementes, insetos e pragas |
| `src/world/flora.ts` | traços novos por espécie (`fruit`, `fruitRipenDays`, `fruitHoldDays`, `fruitingSeason`, `maxFruits`, `nectar`); `pheno` opcional; `plantRecordById` |
| `src/world/chunk.ts` | `groundFruits`, `seedBed`, `pestPressure`, `predators` |
| `src/world/world.ts` | `runEcosystem` (insetos a cada 0,25 h, fenologia no passo da biologia), pool por chunk, `ecoBudget`, stats, `insectsAt()` |
| `src/world/persistence.ts` | save v2 passa a guardar fenologia, frutos no chão, sementes e pragas |
| `src/render/manifest.ts` | `FRUIT_SHEET`, `SEED_SHEET`, `INSECT_SHEET` + recortes (`fruitRect`, `seedRect`, `insectRect`) na folha própria do projeto |
| `src/render/scene.ts` | `treeGeometry` (âncora da copa), flores e frutos na copa, frutos no chão, sementes, insetos, debug `eco` |
| `src/main.ts`, `index.html`, `src/ui/style.css` | HUD do ecossistema (florindo / no chão / insetos / planta mais próxima) |
| `tools/gen-eco-sprites.ts` (**novo**) | gera frutos, sementes e insetos em pixel art (determinístico) |
| `tools/eco-scenario.ts` (**novo**) | linha do tempo do ciclo + orçamento ecológico |
| `tools/eco-visual.ts` (**novo**) | teste visual headless com as ops reais do jogo |
| `tests/ecosystem.test.ts` (**novo**) | 12 testes do ecossistema |
| `assets/Fruits/fruits.png`, `seeds.png`, `assets/Insects/insects.png` | sprites gerados (32×32, transparência real, sem antialias) |

---

## 3. Modelo ecológico

### 3.1 Ciclo de vida

```
vegetativo → floração (12 h) → [visita de inseto ⇒ flor fertilizada]
   → fruto verde (0,7–1,6 dias por espécie, modulado por saúde/umidade)
   → fruto maduro (fica 0,6–1,4 dias, com variação por fruto)
   → QUEDA → fruto no chão (48 h) → semente (45%) ou liteira
   → germinação (umidade > 0,35, 8%, teto de 10 mudas/chunk) → nova planta
```

O vento poliniza com 4% de chance; a visita do inseto eleva a chance para 90%. É
por isso que "flor apareceu → fruto automático" não acontece.

### 3.2 Queda (regra principal)

Risco acumulado por passo, avaliado a cada 3 h:

```
holdHoras  = holdDays(espécie) × 24 × (0,7 + 0,6·(1−saúde)) × holdBias(fruto)
risco      = 1 − exp(−(Δt/holdHoras) · (0,45 + idade²) · chuva)
```

- a chance **cresce com o tempo que o fruto passa maduro** (idade²);
- `holdBias` (0,8–1,3) faz cada fruto cair em um momento diferente;
- saúde baixa encurta a permanência; chuva forte (≥0,5) aumenta a queda em 50%;
- maçã/açaí (holdDays 1,2/1,4) seguram mais que mirtilo (0,6).

### 3.3 Insetos

| inseto | comportamento |
| --- | --- |
| abelha / borboleta | procuram flor aberta, voam até ela, coletam néctar e pólen, procuram outra flor **compatível** e fertilizam; dormem à noite |
| lagarta | procura planta adulta próxima, come folhas → `pests` da planta e `pestPressure` do chunk sobem |
| joaninha | patrulha o chunk, reduz `pestPressure` e `pests` das plantas num raio de 2 células |

População: derivada da flora local (abelhas ≈ 0,5 × flores, borboletas ≈ 0,3 ×
flores, lagartas ≈ 2% das plantas + 1, joaninhas ≈ 0,6 × lagartas), com teto por
chunk e **reconstruída** quando a flora muda — nada disso vai para o save.

### 3.4 Saúde, clima e estações

- a saúde vem do sistema existente (`plantHealth` = idade/estresse) **modulada**
  por pragas: `saúde = base × (1 − 0,45·pragas)` — um segundo sistema de saúde
  não foi criado;
- floração exige umidade (`moisture > waterNeed × 0,65`) e saúde ≥ 0,3;
- `fruitingSeason` dá calendário próprio por espécie (ipê/açai/maçã no verão,
  pouco no inverno), usando `climate.seasonIndex` que já existia;
- chuva entra pela umidade do solo (via `stepWater`) e pelo risco de queda.

---

## 4. Testes executados (reais)

`npm test` → **12 arquivos, 94 testes aprovados** (12 novos em
`tests/ecosystem.test.ts`), `npm run typecheck` e `npm run build` ok (107 kB).

| # | requisito | verificação |
| --- | --- | --- |
| 1 | crescimento/floração | adulta floresce; muda (1 dia) e solo seco não |
| 2 | polinização | visita fertiliza flores; vento < 5% |
| 3 | fruto verde → maduro | `age` cresce por passo, `ripened > 0` só depois do tempo da espécie |
| 4 | **queda de fruto maduro** | 7 dias: `fallen ≥ 2`, frutos saem da copa e aparecem no chão |
| 5 | fruto no chão → semente → muda | `seeds > 0`, muda criada, `≤ RECRUIT_CAP` (sem explosão) |
| 6 | herbivoria | planta com pragas 0,95 floresce menos e produz menos frutos |
| 7 | polinizador | abelha visita, carrega pólen, `pollinated > 0` e frutos criados |
| 8 | limites populacionais | ≤ 12 insetos/chunk; abelhas ausentes à noite |
| 9 | predador | 30 passos de joaninha reduzem `pests` e `pestPressure` |
| 10 | chuva/umidade | solo seco ⇒ `flowered = 0`; úmido ⇒ floresce |
| 11 | save/load | fenologia, frutos no chão, sementes e pragas sobrevivem |
| 12 | integração no mundo | 80 h de jogo: o ciclo ocorre e não acumula frutos presos |

Cenário `npx tsx tools/eco-scenario.ts --hours 96`:

```
 h=12  flowering  6 flores
 h=24  green      frutos 0,25 0,25 0,25      (abelha polinizou)
 h=48  green      0,91 0,91 0,91
 h=60  ripe       1,00 1,00 …               1 no chão
 h=84  vegetative —                        3 no chão
orçamento: florou 1× | polinizações 3 | maduros 3 | caíram 3 | sementes 0
```

---

## 5. Teste visual (headless, com as ops do jogo)

`npx tsx tools/eco-visual.ts` compõe uma cena controlada com três plantas e
insetos: `docs/imagens/ecossistema.png` e `docs/imagens/ecossistema_zoom.png`
(4×). Verificado na imagem:

1. macieira florida (flores brancas na copa) com **abelha** visitando;
2. macieira com **maçãs maduras na copa** (escala proporcional: 8 px em copa de
   25 px — não são 1–2 px);
3. **maçãs caídas no chão** abaixo dela (com sombra de contato) e uma semente;
4. **joaninha** junto ao tronco; lagarta na planta de frutos verdes;
5. árvore jovem/verde ao lado mostrando o estágio anterior do ciclo.

O que **não** foi validado: comportamento em tempo real no navegador (não há
teste de browser no projeto) — a cena usa o mesmo `composeScene`/`Player` do
jogo, mas a sensação de jogo (ritmo, densidade de insetos) precisa ser olhada
no preview.

---

## 6. Desempenho

- insetos: passo de 0,25 h de jogo, **apenas nos 9 chunks ao redor do jogador**,
  busca local por `plantsInCell` (raio de 3 células) — não varre o chunk inteiro;
- fenologia: no passo da biologia (3 h), só em chunks a ±2 do jogador;
- frutos/insetos não são entidades serializadas: frutos no chão ficam em array
  por chunk (teto 48), sementes em banco (teto 24), mudas com teto 10;
- medido no mundo real (49 chunks, 12 h de jogo): `simMs` ≈ 235 ms por
  `update(30 s)` — o custo já existente (água/erosão/biologia) domina; o passo
  ecológico adiciona < 2 ms por update na região de 9 chunks.

---

## 7. Limitações

1. Insetos não são persistidos (por decisão): ao recarregar, a população é
   reconstruída a partir da flora local — o "estado" que importa (flores,
   frutos, pragas) está salvo.
2. Herbivoria é uma pressão agregada (`pests`), não um inseto por folha; a
   lagarta não tem ciclo de vida próprio (ovo → larva → adulto).
3. As sementes germinam só pelo mecanismo de banco no solo; a zoocoria existente
   (fauna) continua atuando no recrutamento por pressão de sementes, sem
   integração fina com os frutos caídos.
4. Nem toda espécie tem fruto: só as que têm planta compatível (`embauba`,
   `macaneira`, `jequitibá`) frutificam; ipê, araucária e salgueiro produzem
   flor/néctar mas não fruto no catálogo.
5. Folhagem não é um recurso separado: a "comida" da lagarta é a saúde da planta.
6. O balanço é de jogo (dias de jogo), não agronômico.

---

## 8. Como reproduzir

```bash
npm install
npm test                          # 94 testes
npm run scenario:eco              # linha do tempo do ciclo (96 h)
npm run visual:eco                # cena headless + zoom em .tmp/eco/
npx tsx tools/gen-eco-sprites.ts  # regenera frutos/sementes/insetos
npm run dev                       # no jogo: Q até o modo "eco"; HUD mostra o ciclo
```
