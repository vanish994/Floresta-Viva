# Projeto Floresta Viva — Mundo Procedural, Chunks e Simulação Ecológica

## Missão

Transforme o projeto atual **Floresta Viva** em um mundo procedural de floresta, visualmente bonito, coerente, explorável e ecologicamente dinâmico.

O mundo deve ser gerado a partir de uma seed, carregado progressivamente em chunks conforme o personagem se movimenta e sustentado por sistemas que interagem entre si: relevo, água, solo, vegetação, decomposição, nutrientes, clima e, quando viável dentro da arquitetura existente, fauna.

O objetivo **não** é criar um mapa formado por tiles aleatórios. Queremos uma floresta com composição artística intencional, ecossistemas coerentes, rios que respeitam o relevo, clareiras naturais, vegetação diversificada e paisagens que pareçam pertencer a um mesmo mundo.

**Execute a implementação no repositório, não apenas apresente um plano ou produza um documento de recomendações.**

---

## 1. Inspecione o projeto antes de modificar

Antes de escrever código:

1. Inspecione o repositório inteiro e identifique a branch ativa, as alterações recentes, a estrutura de pastas, o ponto de entrada e as tecnologias utilizadas.
2. Examine o README, os arquivos de configuração, o sistema de renderização, o movimento do personagem, as colisões, os mapas e os recursos gráficos disponíveis.
3. Localize e examine o arquivo `Harmonious 2D Pixel Art Pack.zip` existente no repositório, se ainda estiver disponível. Inspecione seu conteúdo real, as dimensões das imagens, as transparências, os spritesheets e os tiles.
4. Identifique quais funcionalidades já existem e quais precisam ser implementadas.
5. Verifique se existe um sistema de chunks, geração procedural, seed, persistência ou simulação ambiental que possa ser reaproveitado.

Não suponha nomes de arquivos, bibliotecas, APIs ou funcionalidades sem verificar o código.

**Preserve as funcionalidades existentes.** Não recrie sistemas já funcionais apenas porque prefere outra arquitetura. Não apague assets, não sobrescreva trabalho recente e não faça alterações destrutivas desnecessárias. Se houver modificações preexistentes no ambiente de trabalho, preserve-as.

Após essa análise, implemente a solução diretamente na arquitetura existente.

## 2. Princípios fundamentais

- A mesma seed, as mesmas configurações e a mesma versão do gerador devem produzir o mesmo mundo.
- O resultado deve ser independente da ordem em que os chunks forem carregados.
- Carregar um chunk vizinho não pode mudar a paisagem já gerada.
- Os limites entre chunks devem ser visualmente e funcionalmente contínuos.
- A aparência da floresta deve ser orgânica e deliberadamente composta, não aleatória.
- O ambiente determina quais plantas conseguem sobreviver, crescer e se reproduzir.
- Água, relevo, vegetação e solo devem interagir por regras coerentes.
- A renderização visual e a simulação ambiental devem ser separadas.
- O sistema deve permitir expansão futura sem exigir a reescrita do núcleo.

Use geração determinística baseada em seed e coordenadas globais. Não dependa de um único gerador aleatório global cujo estado avance conforme os chunks são carregados. Quando necessário, utilize geradores pseudoaleatórios determinísticos separados por sistema, coordenadas, espécie ou finalidade.

## 3. Mundo procedural com chunks

Implemente ou aperfeiçoe um sistema de chunks apropriado ao motor e à arquitetura do projeto.

### Carregamento

- Gere os chunks próximos ao personagem.
- Carregue antecipadamente os chunks na direção do movimento, se isso for viável.
- Descarregue chunks distantes para controlar o uso de memória.
- Evite travamentos durante a geração.
- Utilize geração assíncrona ou processamento em etapas quando compatível com o projeto.
- Evite duplicar entidades, árvores, recursos, animais ou objetos nas fronteiras.
- Preserve a posição do personagem e o funcionamento da movimentação e das colisões.

O raio de carregamento, o tamanho dos chunks e a distância de descarregamento devem ser configuráveis e adequados à escala real do jogo.

### Continuidade

A geração deve utilizar coordenadas globais, não coordenadas locais isoladas de cada chunk.

Considere vizinhanças, margens e dados compartilhados para assegurar continuidade de elevação e inclinação, solo e biomas, rios, córregos e lagos, manchas de vegetação, trilhas e caminhos naturais, árvores e agrupamentos de plantas, colisões e navegação.

Um rio que atravessa três chunks deve continuar sendo o mesmo rio. Uma floresta densa não pode terminar abruptamente na borda de um chunk.

A geração de um chunk deve ser reproduzível mesmo que ele seja visitado pela primeira vez muito tempo depois.

## 4. Composição visual da floresta

Esta é uma das prioridades máximas do projeto.

**Não distribua árvores, flores, pedras e arbustos por sorteios independentes sobre um terreno uniforme.**

Implemente um gerador de paisagem em múltiplas escalas.

### Escala territorial

Determine características amplas, como montanhas, vales, colinas e planícies; regiões florestais densas e esparsas; áreas úmidas, margens de rios e depressões; clareiras grandes e pequenas; bacias hidrográficas; e transições graduais entre diferentes ambientes.

### Escala da paisagem

Defina agrupamentos naturais de vegetação:

- Bosques com densidade variável.
- Grupos de árvores com espécies compatíveis.
- Bordas irregulares entre floresta e clareira.
- Vegetação mais abundante em condições favoráveis.
- Espaços de transição junto a rios, encostas e terrenos abertos.
- Trilhas sinuosas que evitem parecer linhas geométricas artificiais.

Utilize combinações de campos de densidade, ruído coerente, máscaras de bioma, regras espaciais e critérios ecológicos, conforme apropriado. O ruído deve ajudar a criar formas naturais; ele não deve ser a única lógica de geração.

### Escala de detalhes

Somente depois de determinar a composição maior, distribua árvores pequenas e grandes, arbustos, flores, gramíneas e samambaias, pedras, galhos, tocos e folhas, pequenos detalhes de solo, variações decorativas e elementos de ambientação.

Evite repetições óbvias, padrões quadriculados, alinhamentos artificiais e excesso de elementos competindo pela atenção.

### Composição artística

A paisagem precisa ter contraste entre áreas densas e áreas abertas, variação de escala e silhueta das árvores, profundidade visual por meio da composição e da sobreposição, margens de água coerentes, espaço suficiente para o personagem circular, pontos de interesse que incentivem a exploração, leitura clara do terreno e dos caminhos, e densidade visual compatível com o estilo do pacote gráfico.

Não coloque objetos decorativos indiscriminadamente em todos os espaços disponíveis.

Respeite transparências, dimensões, pivôs, camadas e ordem de desenho dos assets. Não estique sprites para encaixá-los em células. Preserve a proporção original das imagens.

Se os recursos existentes forem insuficientes para alguma composição, implemente a melhor solução com os assets disponíveis e documente as limitações. Não substitua silenciosamente os gráficos por quadrados coloridos ou formas provisórias como solução final.

## 5. Sistema de terreno e relevo

O mundo deve possuir uma representação ambiental que não se limite aos tiles visuais.

Implemente, conforme a escala e a arquitetura do projeto, elevação, inclinação, orientação das encostas, tipo e profundidade do solo, umidade, drenagem, erodibilidade, cobertura vegetal e acúmulo de sedimentos.

O terreno deve influenciar a distribuição de água e vegetação. Encostas íngremes, depressões, margens fluviais, planícies e áreas elevadas precisam apresentar diferenças ambientais coerentes.

Mantenha separadas a resolução da simulação física e a resolução gráfica. A simulação pode utilizar uma grade mais grossa do que os tiles de 32 × 32 pixels, caso isso melhore o desempenho e a estabilidade numérica. Não assuma que todos os tiles possuem dimensões idênticas sem verificar os arquivos reais.

## 6. Água, chuva e hidrologia

Implemente um sistema coerente de circulação da água, considerando precipitação, interceptação pela vegetação, infiltração, escoamento superficial, retenção no solo, evaporação, percolação, armazenamento subterrâneo simplificado, nascentes, córregos, rios, lagos, enchentes e secas.

A água deve respeitar o relevo e as propriedades do terreno.

### Formação de rios

Os rios devem resultar da drenagem e da convergência de fluxos, e não de linhas desenhadas aleatoriamente.

- A água escoa de regiões com maior potencial hidráulico para regiões com menor potencial.
- Encostas, depressões e divisores de águas devem influenciar o percurso.
- A área de contribuição deve influenciar a vazão.
- Lagos e depressões podem acumular água.
- Rios devem apresentar larguras e volumes coerentes com a vazão.
- A chuva, a estação e a evaporação devem influenciar os níveis da água.
- Pequenos córregos podem secar durante períodos secos.
- Rios permanentes devem ser mais resistentes a pequenas variações climáticas.

Evite água visualmente atravessando montanhas, subindo encostas ou terminando sem explicação.

Não é necessário simular cada gota nem executar cálculos hidrológicos de alta precisão a cada quadro. Utilize uma representação simplificada, estável e determinística, com diferentes frequências de atualização conforme a importância e a proximidade da área.

A geração da rede hidrográfica deve ser consistente entre chunks, inclusive quando estes são criados fora de ordem.

## 7. Erosão e transformação da paisagem

A água também deve modificar gradualmente o terreno. Considere erosão de margens, escavação de canais, transporte de sedimentos, deposição em regiões de menor energia, formação gradual de planícies aluviais, alteração de meandros em rios compatíveis com essa escala, e formação de pequenas depressões e áreas alagáveis.

A intensidade deve depender de fatores como vazão, velocidade, declividade, resistência do solo e rocha e cobertura vegetal.

Não execute alterações geológicas complexas a cada quadro. Utilize passos de simulação apropriados, com limites numéricos estáveis e atualização em escalas temporais maiores.

Preserve as características iniciais do mundo e garanta que as alterações persistentes não desapareçam simplesmente porque um chunk foi descarregado.

Se a erosão dinâmica completa for excessivamente complexa para a primeira implementação, implemente uma base funcional e extensível, priorizando primeiro o fluxo da água, a formação dos canais e a persistência do estado.

## 8. Solo e ciclo de nutrientes

O solo deve ser um sistema vivo, com propriedades que mudam ao longo do tempo.

Implemente uma representação adequada de umidade, matéria orgânica, húmus, nitrogênio disponível, fósforo disponível, potássio disponível, temperatura, pH ou acidez simplificada se houver suporte na arquitetura, profundidade e fertilidade, e atividade dos decompositores.

Diferentes solos devem apresentar propriedades distintas:

- **Solo arenoso:** infiltração geralmente elevada e menor retenção de água.
- **Solo argiloso:** infiltração geralmente mais lenta e maior possibilidade de escoamento superficial.
- **Solo rochoso:** pouca profundidade disponível para raízes em muitos locais.
- **Solo florestal rico em matéria orgânica:** maior capacidade de retenção de água e nutrientes.
- **Solo aluvial:** propriedades relacionadas à deposição de sedimentos e à inundação.

Esses exemplos não são regras absolutas; os parâmetros devem ser configuráveis.

### Ciclo do fósforo e de outros nutrientes

- A vegetação absorve nutrientes do solo.
- A decomposição devolve parte dos nutrientes ao sistema.
- O intemperismo pode liberar fósforo lentamente de materiais minerais.
- A erosão e o escoamento podem transportar nutrientes para outros locais.
- Os nutrientes podem ficar temporariamente imobilizados na biomassa microbiana ou retidos no solo.
- A lixiviação pode remover nutrientes da região das raízes.

A decomposição recicla nutrientes existentes; ela não cria elementos químicos.

Garanta que os balanços simplificados de água e nutrientes sejam coerentes, sem criar recursos infinitos artificialmente.

## 9. Vegetação como sistema ecológico

As plantas não devem ser apenas objetos decorativos.

Cada espécie deve ter propriedades configuráveis, como necessidades de água, luz e nutrientes; temperatura favorável; tolerância a diferentes tipos de solo; velocidade de crescimento; idade de maturidade; capacidade de reprodução; longevidade; tolerância à seca e a inundações; efeito das raízes sobre o solo; e produção de folhas, frutos e sementes, quando aplicável.

### Ciclo de vida

Implemente, conforme compatível com o motor:

1. Germinação.
2. Crescimento.
3. Competição por recursos.
4. Maturidade.
5. Reprodução.
6. Produção e dispersão de sementes.
7. Senescência.
8. Morte.
9. Decomposição.

As condições ambientais devem determinar onde uma espécie pode prosperar. Áreas próximas à água podem favorecer espécies que necessitam de mais umidade. Locais secos podem favorecer espécies tolerantes à escassez hídrica. A sombra deve influenciar plantas que dependem da disponibilidade de luz.

A competição deve evitar que todas as espécies ocupem todos os lugares igualmente.

### Folhas, raízes e matéria orgânica

- Árvores e plantas produzem matéria orgânica.
- Folhas e galhos caem.
- Raízes mortas e plantas mortas entram no ciclo de decomposição.
- Decompositores transformam resíduos orgânicos.
- Parte dos nutrientes volta a ficar disponível no solo.
- Parte do carbono permanece na matéria orgânica.
- A chuva pode transportar nutrientes e matéria orgânica.

A decomposição deve depender de temperatura, umidade, composição do material e atividade biológica.

A retirada de árvores deve produzir efeitos ambientais coerentes, como redução de entradas de matéria orgânica, alterações de sombra e umidade e aumento potencial da erosão.

Evite criar uma entidade independente para cada folha se isso comprometer o desempenho. O sistema pode agrupar matéria orgânica em parcelas ou células ambientais.

## 10. Ciclo de dia e noite

Implemente um ciclo de dia e noite com duração de **24 minutos reais por dia completo dentro do jogo**.

Referências iniciais:
- 06:00: nascer do sol.
- 12:00: meio-dia.
- 18:00: pôr do sol.
- 00:00: meia-noite.

Isso corresponde a aproximadamente 12 minutos de luz diurna e 12 minutos noturnos, com transições suaves de iluminação.

A iluminação deve mudar gradualmente, sem alternar abruptamente entre dois estados.

Quando viável, o horário deve influenciar atividade da fauna, comportamento dos organismos, temperatura, crescimento ou atividade de processos biológicos, e aparência e iluminação da floresta.

Não execute a simulação inteira a cada quadro apenas porque a iluminação precisa ser atualizada. Separe o relógio visual dos processos ambientais mais lentos.

## 11. Estações e astronomia

Projete um sistema sazonal baseado em um modelo astronômico simplificado, não em uma simples troca arbitrária de texturas.

Considere rotação do planeta para produzir o ciclo diário, inclinação axial aproximada de 23,4 graus, posição orbital ao longo do ano, variação do ângulo solar, mudança na duração do dia e da noite ao longo do ano, e variações sazonais de temperatura e precipitação.

A duração do ano dentro do jogo deve ser configurável. Não fixe uma duração arbitrária sem documentá-la e sem considerar a jogabilidade.

O sistema precisa funcionar com o ciclo diário de 24 minutos sem confundir tempo de jogo, horário local simulado e tempo real decorrido.

Se uma simulação orbital detalhada for desnecessária para a primeira versão, utilize um modelo matemático simplificado, determinístico e extensível.

As estações devem afetar a disponibilidade de água, o crescimento das plantas, a dormência, a queda de folhas e outros processos compatíveis com cada espécie.

Não force todas as plantas a perderem as folhas simultaneamente. As respostas sazonais devem depender das características de cada espécie e do ambiente.

## 12. Fauna e interações ecológicas

Se a arquitetura existente permitir, prepare a integração de animais com o ambiente. Os animais devem depender de recursos como alimento, água, abrigo e condições climáticas.

Considere futuramente alimentação, reprodução, migração, atividade diurna ou noturna, dispersão de sementes, produção de fezes e carcaças, e relações entre espécies.

Não crie fauna apenas para preencher visualmente o mapa. Sua presença e sobrevivência devem fazer sentido para o ambiente.

Se esse sistema for grande demais para concluir com qualidade na primeira etapa, entregue interfaces e pontos de integração bem definidos, sem fingir que uma simulação ainda inexistente está funcional.

## 13. Arquitetura e desempenho

Mantenha separados, na medida adequada à arquitetura existente:

- Geração determinística do mundo.
- Representação do terreno.
- Hidrologia.
- Estado do solo.
- Estado da vegetação.
- Ciclo climático e astronômico.
- Estado persistente do mundo.
- Renderização.
- Carregamento e descarregamento de chunks.

Não crie abstrações excessivas nem dezenas de sistemas independentes sem necessidade.

Use dados compactos e atualizações por etapas. Evite recalcular o mundo inteiro sempre que o personagem se mover.

A simulação deve poder operar em diferentes frequências:
- **Renderização:** frequência normal do jogo.
- **Processos rápidos:** atualizações curtas quando necessárias.
- **Água e umidade:** atualizações periódicas.
- **Crescimento e decomposição:** passos mais lentos.
- **Erosão e transformações geológicas:** passos ainda mais lentos.

Quando áreas distantes estiverem descarregadas, o mundo não deve precisar simular cada detalhe continuamente. Utilize atualização agregada ou avanço temporal determinístico quando apropriado.

Qualquer otimização precisa preservar a coerência dos resultados e a continuidade entre chunks.

## 14. Persistência

Implemente ou integre persistência compatível com a arquitetura existente.

A seed deve permitir reconstruir o estado inicial do mundo, mas não deve apagar as modificações que ocorreram depois.

Preserve, conforme aplicável:
- Seed e versão do gerador.
- Alterações de terreno.
- Canais e mudanças persistentes na hidrologia.
- Vegetação removida, plantada ou modificada.
- Estado ecológico relevante para o jogador.
- Recursos coletados.
- Construções e modificações feitas pelo jogador, se existirem.

Evite salvar cada detalhe estático que possa ser regenerado de forma determinística.

Utilize dados de diferenças ou snapshots de estado quando forem adequados. Inclua tratamento para versões de dados e carregamento seguro.

## 15. Testes e validação

Não considere a tarefa concluída apenas porque o projeto compila.

Execute os testes disponíveis e adicione testes para os novos sistemas.

### Determinismo
- A mesma seed gera o mesmo resultado.
- Um chunk gera o mesmo resultado independentemente da ordem de carregamento.
- Descarregar e recarregar um chunk não modifica seu estado indevidamente.

### Continuidade
- Não existem descontinuidades artificiais no relevo entre chunks.
- Rios e lagos não apresentam cortes indevidos nas bordas.
- A vegetação mantém uma transição natural.
- Objetos não são duplicados por geração nas margens.

### Ecologia
- Plantas com necessidades diferentes respondem de maneira diferente às condições do solo.
- A decomposição devolve matéria e nutrientes ao sistema de forma coerente.
- A escassez de água pode afetar a vegetação.
- A cobertura vegetal influencia umidade e erosão conforme as regras implementadas.
- Os processos não geram nutrientes ou água infinitamente por erro numérico.

### Tempo
- O ciclo diário tem duração de 24 minutos reais.
- As transições de iluminação são suaves.
- As estações avançam de forma determinística.
- A velocidade dos processos ambientais não depende indevidamente da taxa de quadros.

### Desempenho
- O carregamento de chunks não provoca travamentos excessivos.
- Chunks distantes podem ser descarregados.
- A memória não cresce indefinidamente durante a exploração.
- A geração não recalcula todo o mundo sem necessidade.

Se possível, crie uma cena de teste ou modo de depuração que permita inspecionar a seed, os limites dos chunks, a elevação, a umidade, os fluxos de água, os tipos de solo e as zonas de vegetação.

## 16. Validação visual obrigatória

A aparência final é um requisito central, não um detalhe secundário.

Utilize o ambiente real do projeto para validar o resultado sempre que possível. Gere várias seeds de teste e inspecione diferentes paisagens, incluindo floresta densa, clareiras, margens de rios, encostas, regiões abertas, transições entre diferentes densidades de vegetação e limites entre chunks.

Verifique se o resultado parece uma floresta construída com intenção artística, não um mosaico aleatório.

Se detectar padrões repetitivos, excesso de objetos, árvores mal posicionadas, margens artificiais ou composição visual confusa, corrija os algoritmos e valide novamente.

Não declare a qualidade visual validada se não tiver executado ou inspecionado o resultado real. Informe honestamente o que foi testado e o que não pôde ser verificado.

## 17. Ordem de implementação

Trabalhe em etapas integradas, mantendo o projeto funcional ao final de cada uma.

1. **Diagnóstico e infraestrutura:** entender o projeto e os assets; definir a arquitetura necessária; criar ou aperfeiçoar seed, coordenadas globais e chunks.
2. **Paisagem e composição visual:** implementar relevo e regiões de vegetação; construir clareiras, agrupamentos naturais e transições; integrar os assets reais; validar visualmente múltiplas seeds.
3. **Água e terreno:** implementar drenagem, acumulação e rede hidrográfica; integrar solo, relevo, lagos e rios; criar a base para erosão e sedimentos.
4. **Ciclos ambientais:** implementar dia e noite; implementar o modelo sazonal configurável; integrar clima, temperatura e precipitação.
5. **Ecologia:** implementar solo dinâmico e nutrientes; implementar crescimento, competição, reprodução e morte das plantas; implementar queda de folhas e decomposição; integrar os efeitos da vegetação na água e no solo.
6. **Persistência e otimização:** preservar alterações entre sessões; otimizar carregamento e descarregamento; implementar atualização econômica de regiões distantes.
7. **Validação final:** executar testes; corrigir falhas; verificar múltiplas seeds; documentar limitações e parâmetros.

Reorganize as etapas se a arquitetura real exigir, desde que preserve as dependências e entregue uma solução funcional.

Não deixe a implementação apenas no planejamento. Prossiga até concluir o máximo possível com qualidade dentro do ambiente e das ferramentas disponíveis.

## 18. Critérios de aceitação

A implementação só deve ser considerada concluída quando, dentro do escopo efetivamente implementado:

1. O personagem consegue explorar um mundo composto por chunks carregados conforme sua posição.
2. O mundo é determinístico por seed e coordenadas globais.
3. A floresta possui composição natural, com densidade variável, clareiras e agrupamentos coerentes.
4. O terreno, a água e a vegetação apresentam continuidade nas fronteiras.
5. A hidrologia respeita o relevo e utiliza uma representação consistente de drenagem.
6. O ciclo diário funciona em 24 minutos reais.
7. A estrutura sazonal está integrada ao relógio e é configurável.
8. Solo, vegetação e decomposição possuem estado dinâmico real, não apenas valores decorativos.
9. O descarregamento de chunks não apaga alterações persistentes.
10. O desempenho é adequado à escala do projeto.
11. Os testes e as limitações são relatados com honestidade.
12. O projeto existente continua funcional.

Não marque sistemas como concluídos se apenas criou classes vazias, interfaces sem implementação ou dados que não afetam o mundo.

## 19. Relatório final

Ao terminar, apresente um relatório objetivo em português contendo:
- O que existia antes.
- O que foi implementado.
- Os principais arquivos criados e modificados.
- Como funciona a geração por seed e chunks.
- Como foi resolvida a composição visual da floresta.
- Quais sistemas ecológicos estão realmente funcionais.
- Como executar e testar o projeto.
- Quais testes foram executados e seus resultados.
- Limitações conhecidas.
- O que ficou pendente.

Não invente resultados de testes nem alegue execução visual que não aconteceu.

**Resultado esperado:** um mundo procedural explorável, visualmente atraente, tecnicamente consistente e preparado para evoluir para uma simulação de ecossistema. A prioridade é combinar uma floresta bonita e contínua com sistemas ambientais reais, sem sacrificar o desempenho ou a funcionalidade já existente.
