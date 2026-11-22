# Test Design UI — matriz de aceite da próxima implementação

**Data:** 21/11/2026. **Estado:** matriz de critérios da arquitetura completa.
UI-TD-1 e UI-TD-2 têm implementação e ensaios locais descritos no
[relatório desta entrega](ui-test-design-release-td1-td2.md). Essa evidência não marca
automaticamente todas as linhas como aprovadas. Critérios de execução, comparação,
Evolution e catálogo permanecem pendentes; não houve implantação remota nesta validação.

Esta matriz pertence ao [plano de entrega de valor](ui-test-design-value-plan.md).
As responsabilidades dos serviços e a arquitetura de lotes estão no
[ADR de serviços compartilhados e lotes](ui-shared-services-batch-architecture.md).
Ela não é um relatório de aprovação e não altera a qualificação do bundle atual.
Os dados de ensaio devem ser identificados como dados de teste, separados da captura real.

**Prioridade vigente:** compilar Test Designs UI em lote, deterministicamente, a partir dos
bundles persistidos e de templates/regras versionados. O caminho principal não depende de
chave, provedor, interpretação ou chamada de IA. A IA atua principalmente no Evolution após
falhas, sobre fatos e diferenças já registrados.

O primeiro marco é UI-TD-1 + UI-TD-2: cenários compilados, versionados e consultáveis, com
contrato preparado para duas execuções relacionadas, **REPLAY** com respostas observadas e
**LIVE** com APIs atuais. UI-EXEC-1 implementa esse par. O catálogo agregado continua no
backlog UI-CAT-1. Compilar não declara execução nem PASS; prontidão e bloqueios são avaliados
por modo, e uma limitação de execução pode coexistir com um design válido e versionado.

## 1. Planejamento e evidência

| ID | Ensaio | Resultado exigido |
|---|---|---|
| TD-01 | Ler um bundle observado selado válido | Preservar capture/bundle/source/manifest e referências de evidência |
| TD-02 | Apresentar um bundle com hash ou referência inconsistente | Recusar o uso inconsistente e explicar a causa; não gerar uma versão executável |
| TD-03 | Usar uma captura com fixtures utilizáveis e indisponíveis | Gerar candidatos; calcular dependências por cenário sem reprovar todo o planejamento |
| TD-04 | Criar dois cenários, um dependente de 304 sem corpo e outro comprovadamente independente | Bloquear o replay dependente; avaliar os demais cenários e o modo LIVE por suas próprias dependências; não inventar corpo para desbloquear |
| TD-05 | Uma fixture ausente é necessária ao bootstrap de ambos os cenários no modo REPLAY | Bloquear os dois replays com a dependência compartilhada, mesmo que seus passos diretos tenham fixtures; a prontidão de LIVE é calculada separadamente |
| TD-06 | Relação temporal entre clique e request sem outra prova | Manter a incerteza; não declarar causalidade comprovada |
| TD-07 | Template, regra ou entrada tenta produzir assertion sem evidência, requisito ou política aplicável | Recusar a assertion sem fundamento e registrar a limitação; a compilação não inventa expected nem usa IA para completar a lacuna |
| TD-08 | Plano compilado ou entrada contém ação/locator/ref inexistente, operador não suportado ou JavaScript livre | Guard rejeita a saída incompatível; nenhum reparo semântico por IA é necessário para concluir o job com diagnóstico correto |
| TD-09 | Cenário contém apenas cliques, sem check verificável | Não classificar como teste executável pronto |
| TD-10 | Locator era único na captura e é ambíguo no alvo | Diagnóstico de locator; sem escolher silenciosamente um elemento arbitrário |
| TD-11 | Compor segmentos com predecessor faltante, índice duplicado ou escopo diferente | Recusar a união inválida; conservar a evidência de segmentos válidos individualmente |
| TD-12 | Cenário de um único segmento é suficiente | Declarar cobertura desse segmento, sem afirmar cobertura da jornada lógica inteira |

## 2. Versionamento e integração

| ID | Ensaio | Resultado exigido |
|---|---|---|
| INT-01 | Repetir a mesma operação de compilação após timeout | Preservar operação, job lógico e versões persistidas sem duplicação; recompilação das mesmas entradas e versões conserva o conteúdo semântico e não chama IA |
| INT-02 | Solicitar uma nova compilação deliberada com insumos, regras ou política diferentes | Nova versão identificável e proveniência completa, mantendo a versão anterior |
| INT-03 | Enviar contrato UI à rota/validador REST legado | Rejeição preservada; rota UI valida seu contrato próprio |
| INT-04 | Solicitar versão de outro tenant/projeto | Recusa por escopo antes de expor dados ou executar |
| INT-05 | Alterar a versão latest depois da admissão de um run | Run continua usando a versão exata fixada no plano |
| INT-06 | Fechar o Console durante geração em lote ou execução | Job durável continua, com progresso recuperável na reabertura |
| INT-07 | Browser Runner indisponível | Geração e registro de Test Designs UI continuam disponíveis; execução, quando solicitada, fica bloqueada/diagnosticável, e o processamento REST continua independente |
| INT-08 | Baseline antiga, mas artefatos disponíveis e autoridade atual válida | Idade isolada não bloqueia; ausência/revogação real de dependência continua sendo verificada |

### 2.1 Leitura direta de evidência: exigida em UI-TD-1

Estes ensaios validam o adapter de leitura dos bundles existentes. Não exigem tabela,
projeção, indexador ou serviço de UI Catalog. A leitura usa a versão exata admitida no job,
com validação de acesso e integridade antes de formar o contexto de geração.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| DREAD-01 | Ler uma versão exata fora do scope autorizado ou revogar bundle/origem depois de admitir o lote | Validar organização/projeto/ambiente e acesso vigente no servidor; a referência fixada no job não contorna revogação. Registrar a indisponibilidade sem expor conteúdo nem inventar uma fonte substituta |
| DREAD-02 | Apresentar um contrato de envelope não suportado, incluindo arquivo de página sem as evidências observadas exigidas pelo adapter | Recusar ou registrar incompatibilidade antes da geração; não interpretar um envelope de arquivo como jornada observada nem completar campos ausentes por suposição |
| DREAD-03 | Montar entradas de compilação a partir de bundles com DOM, imagens, corpos e recursos grandes | Usar referências e carregar somente conteúdo necessário, com limites explícitos e hashes verificados; não copiar todos os artefatos para cada item ou mensagem, nem remover dependências silenciosamente para caber no limite |

## 3. Execução funcional: regras do replay e verificações comuns

| ID | Ensaio | Resultado exigido |
|---|---|---|
| EX-01 | Executar o par de um cenário curto contra build alvo identificado | REPLAY e LIVE têm resultados próprios, passos e assertions efetivamente avaliados ou impedimentos explícitos; as evidências são correlacionadas ao mesmo Test Design |
| EX-02 | Introduzir uma mudança deliberada que contrarie uma assertion | Falha detectada e explicada por expected/actual |
| EX-03 | Retornar corpo observado para request correspondente | Ledger registra fixture, hash, ocorrência e etapa usados |
| EX-04 | Aplicação emite request de negócio não previsto | Bloqueio/diagnóstico de replay; nenhuma chamada real como fallback |
| EX-05 | Aplicação emite request com query, body ou contexto divergente | Matcher não entrega uma fixture só porque a URL básica coincide |
| EX-06 | Repetir request além da cardinalidade autorizada | Diagnóstico de consumo esgotado; sem reutilização ilimitada |
| EX-07 | Uma dependência selecionada obrigatória não é consumida | Resultado indica a ausência; conclusão operacional não vira PASS |
| EX-08 | Remapear documento/navegação para a nova sessão | Correspondência por contexto planejado, sem comparar UUIDs de sessões distintas literalmente |
| EX-09 | Executar um PUT/POST previsto como mock no modo REPLAY | Bloqueio de saída real e prova restrita ao comportamento do front-end; LIVE usa a operação real conforme seu plano de preparação e isolamento, sem herdar esse mock |
| EX-10 | Bootstrap, build ou artefato exigido indisponível para um modo | Bloquear esse modo antes de afirmar resultado funcional; avaliar a outra execução por suas próprias dependências |
| EX-11 | Retry após erro de infraestrutura ou perda de heartbeat | Tentativas identificadas, recuperação limitada e sem sobrescrever o histórico |
| EX-12 | Reexecutar o mesmo plano/bundle/build/perfil | Mesmas entradas e política; diferenças ficam rastreáveis como instabilidade ou mudança real |
| EX-13 | Erro ocorre antes de qualquer assertion | Resultado não declara que a funcionalidade passou ou falhou como fato comprovado |
| EX-14 | Todas as assertions são ignoradas ou não alcançadas | Nunca produzir PASS de regressão |

## 4. Results, inteligência e evolução

| ID | Ensaio | Resultado exigido |
|---|---|---|
| EV-01 | Gravar resultado UI_REPLAY | Domínio da prova UI explícito; resultado não promove API nem altera seu catálogo/baseline |
| EV-02 | Falha seguida de sucesso em nova tentativa | Ambas preservadas; comportamento instável não é ocultado |
| EV-03 | Selecionar cenários por risco/impacto e budget | Motivos da seleção e do adiamento registrados, com limites respeitados |
| EV-04 | Na análise pós-execução, IA sugere defeito de produto quando falta fixture | Hipótese separada dos fatos e das diferenças determinísticas; diagnóstico não altera a assertion nem a baseline original |
| EV-05 | Propor locator equivalente com evidência inequívoca | Política avalia; versão derivada é criada no Registry e verificada em novo run |
| EV-06 | Proposta remove assertion, aumenta tolerância ou troca expected pelo actual | Não tratar como reparo seguro automático; aplicar autoridade específica e registrar mudança de escopo |
| EV-07 | Rejeitar ou falhar na verificação de uma proposta | Versão anterior e resultado original continuam intactos |
| EV-08 | Nova observação revela fluxo recorrente sem teste | Propor cobertura adicional com proveniência e dependências |

## 5. Estrutura, layout e comparação visual

Verificações suportadas de presença, estado, dados e posição/layout entram no primeiro perfil
de execução pareada quando houver evidência e condições comparáveis. Operadores adicionais
e comparação visual avançada podem ser ampliados em UI-VIS-1. A ausência de uma modalidade
não elimina checks independentes nem transforma cobertura parcial em validação de toda a tela.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| VIS-01 | Comparar estrutura/layout ou imagem com referência observada aceita e perfil compatível | Expected/actual/diff, operadores, perfil e dimensões efetivamente comparadas registrados; tolerâncias são prévias e versionadas |
| VIS-02 | Perfil de browser/SO/fontes/viewport incompatível | Limitação de comparabilidade explícita; não concluir regressão visual a partir de comparação inválida |
| VIS-03 | Screenshot ausente ou instável, mas check funcional independente válido | Limitar a modalidade visual e manter o resultado funcional separado |
| VIS-04 | Build de origem desconhecido | Preservar a referência observada e declarar a limitação de reprodução/atribuição histórica; avaliar checks comparáveis sem inventar identidade de build ou concluir uma causa não demonstrada |
| VIS-05 | Mudança visual deliberada | Comparador detecta diferença com tolerância previamente versionada |

## 6. Pendência adiada

Os testes de recuperação de HTTP 304, validators, contexto de cache e concorrência entre
upload de 200/publicação e preparo de 304 permanecem em
[QAGENT-UI-CACHE-001](ui-cache-deferred.md). Eles não são gate global de UI-TD-1.

TD-04 e TD-05 continuam obrigatórios no desenho, e EX-10 no marco de execução: verificam o
tratamento correto de uma dependência indisponível, sem implementar a recuperação de cache.

## 7. Compilação em lote desde a primeira entrega

**Estado de todos os ensaios desta seção: A IMPLEMENTAR / NÃO EXECUTADO.**

O usuário informa fontes, perfil e limites do lote. Uma observação ou um conjunto delimitado
de bundles pode produzir vários fluxos e cenários conforme suas evidências. O compilador
resolve versões exatas, fixa esse conjunto no job e aplica regras/templates versionados.
Não há quota artificial de cenários por observação. Selecionar cada cenário manualmente
não é condição para compilar ou acompanhar o lote. Uma operação individual, quando oferecida,
usa o mesmo caso de uso com um único item.

O MVP declara cobertura das fontes admitidas. Não depende de um inventário global de telas
e jornadas nem afirma cobrir todas as observações do projeto. Se uma listagem paginada for
usada para resolver fontes, sua completude é avaliada dentro do escopo delimitado da operação.

Um item planejado não equivale necessariamente a um cenário: uma jornada ou partição
delimitada de evidência pode originar vários cenários. A identidade do job, do item, da
saída e da versão persistida precisa permanecer distinguível.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| BGEN-01 | Solicitar geração sobre uma observação ou conjunto delimitado de fontes, usando paginação apenas quando necessária à resolução desse conjunto | Resolver e fixar versões/hashes exatos no snapshot do job; registrar limites, exclusões e fontes não resolvidas. Se houver paginação, cobrir o escopo admitido sem truncamento silencioso; não exigir catálogo global nem declarar cobertura integral do projeto |
| BGEN-02 | Falhar ao resolver uma fonte ou, quando usada, uma página intermediária da seleção delimitada | Não publicar um conjunto incompleto como se todas as fontes solicitadas tivessem sido resolvidas; registrar causa e progresso e retomar a resolução ou admitir explicitamente um escopo parcial. Fontes já fixadas permanecem identificáveis e não são substituídas por latest |
| BGEN-03 | Usar uma ou mais fontes fixadas que contenham vários fluxos, incluindo dois candidatos válidos, outro com execução bloqueada por fixture e uma falha transitória de processamento | Um único pedido cria o lote e gera cenários sem seleção manual por caso; a limitação de execução é preservada no design quando ele puder ser definido, outros itens progridem e somente o item afetado usa a política de retry |
| BGEN-04 | Uma jornada planejada produz vários cenários e outra produz nenhum cenário admissível | Registrar cada saída com identidade própria e registrar a ausência justificada; contagens de itens, candidatos, saídas e versões não são tratadas como equivalentes |
| BGEN-05 | Repetir a admissão do mesmo lote após perda da resposta | Resolver a mesma operação no mesmo escopo e retornar o job existente; a mesma chave com conteúdo semanticamente incompatível é recusada, sem criar outro lote silenciosamente |
| BGEN-06 | Reentregar uma mensagem ou repetir o commit de uma saída de um item com vários cenários | A chave estável por saída impede versões duplicadas; preservar saídas distintas do mesmo item, sem deduplicar todo o item como se tivesse somente uma saída |
| BGEN-07 | Persistir o artefato compilado/validado e provocar falha transitória na gravação no Registry | Retomar a publicação dos mesmos bytes e identidade; retry de persistência não muda o conteúdo nem depende de IA |
| BGEN-08 | Registry confirma a gravação, mas o ACK é perdido antes de atualizar o job | Reconciliar a operação/saída pelo identificador estável, recuperar a versão criada e concluir o checkpoint; não publicar outra versão nem chamar IA para compensar a perda de ACK |
| BGEN-09 | Interromper o worker durante a compilação antes de salvar o artefato durável | Recompilar as mesmas fontes/regras/perfil e obter o mesmo conteúdo semântico, registrando nova tentativa operacional e uma única conclusão lógica; nenhuma chamada de IA é necessária |
| BGEN-10 | Expirar o lease e entregar o item a outro worker enquanto o anterior ainda responde | Um token de fencing/revisão válido governa commits e mudanças de estado; o worker antigo não publica saída nem sobrescreve progresso da nova tentativa |
| BGEN-11 | Cancelar um lote com itens pendentes, em execução e já persistidos | Parar novas admissões de itens, tratar os trabalhos em andamento pela política declarada e registrar sua disposição; versões já criadas permanecem auditáveis e o lote não aparece como concluído integralmente |
| BGEN-12 | Retomar um lote interrompido ou parcialmente cancelado segundo a política de retomada | Reutilizar o snapshot e os checkpoints aplicáveis; processar somente o trabalho autorizado restante, sem regenerar saídas concluídas ou apagar tentativas anteriores |
| BGEN-13 | Saturar a compilação UI enquanto há jobs de API e projetos de outros tenants | Respeitar quotas por escopo, CPU/memória/bytes, concorrência e backpressure; UI não monopoliza a capacidade reservada a API ou a outros tenants. Orçamento de análise por IA no Evolution é separado |
| BGEN-14 | Alterar latest, Catalog, fixtures ou política durante a geração | Itens permanecem vinculados às revisões e fingerprints do snapshot admitido; mudanças geram revisão/operação explícita, não uma mistura de contextos dentro do mesmo plano; revogação de acesso continua sendo respeitada |
| BGEN-15 | Duas jornadas geram candidatos parecidos, mas com expectativas, estados ou dependências diferentes | Deduplicação considera a semântica e a procedência; não fundir cenários apenas por URL, endpoint ou título. Duplicatas comprovadas são relacionadas à saída preservada e contabilizadas |
| BGEN-16 | Gerar a partir de bundle observado sem endpoint correspondente no Catalog API e sem projeção/indexação de UI Catalog | Usar leitura direta, identidade e contexto UI próprios; nenhum catálogo é pré-requisito para esse lote. Enriquecimento API é opcional e não exige endpointId fictício nem aceitação de UI no validador REST |
| BGEN-17 | Fechar o Console e voltar após retries e conclusões parciais do lote | Recuperar estado durável por job/item/saída, incluindo bloqueios, tentativas, consumo e versões criadas; a sessão do navegador não é responsável por manter o job vivo |

INT-01, BGEN-05, BGEN-06 e BGEN-08 comprovam idempotência dos efeitos persistidos e da
operação lógica. A compilação pode ser refeita após interrupção, preservando o conteúdo
semântico para as mesmas fontes/regras/perfil. Ela não utiliza provedor de IA; custos e
retentativas de uma análise posterior no Evolution pertencem a outra operação.

### 7.1 Backlog UI-CAT-1 — catálogo UI próprio no qagent-ui

**Estado de todos os ensaios desta seção: A IMPLEMENTAR / NÃO EXECUTADO.**

**UCAT-01 a UCAT-10 pertencem ao backlog UI-CAT-1 e não são gates de UI-TD-1 ou UI-TD-2.**
As invariantes já necessárias à leitura direta e à geração permanecem cobertas por
TD, INT, DREAD e BGEN. A prioridade atual não exige implementar consultas agregadas,
projeções, indexação global ou reconciliação de catálogo para entregar Test Design.

O Catálogo UI é o domínio de descoberta e consulta das evidências de UI dentro do
`qagent-ui`. Ele usa referências versionadas aos bundles e suas projeções, preservando
as origens e a disponibilidade de cada dado. A geração UI funciona sem exigir que o
Catalog API já conheça as requisições capturadas pela UI. O conhecimento API, quando
associado por evidência explícita, é enriquecimento opcional.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| UCAT-01 | Descobrir e planejar uma observação UI válida cujas APIs não existem no Catalog API | A descoberta e o planejamento usam as evidências UI disponíveis; ausência de endpoint no Catalog API não é bloqueio artificial nem exige endpointId fictício |
| UCAT-02 | A mesma rota aparece no monitoramento API paralelo e em uma interação UI, sem identificador de correlação comprovado | Preservar as duas proveniências; correspondência de rota ou proximidade temporal não prova que sejam a mesma ocorrência nem que o Catalog API tenha recebido aquela interação UI |
| UCAT-03 | Indexar ações, estados, rotas e recursos e depois propor nomes ou relações semânticas para fluxos | Separar metadados observados de interpretações derivadas; referências, hashes e incertezas permanecem rastreáveis, sem converter associação temporal em causalidade comprovada |
| UCAT-04 | Reconstruir a projeção do mesmo bundle/versão do projetor e depois apresentar conteúdo conflitante sob a mesma identidade | Reconstrução equivalente é idempotente; conflito de hash é recusado e diagnosticado; manifests e versões de origem imutáveis permanecem intactos |
| UCAT-05 | Paginar a descoberta enquanto novos bundles e projeções são publicados, inclusive com IDs lexicamente anteriores ao cursor atual | Um snapshot materializado ou delimitação estável equivalente garante enumeração completa do conjunto admitido, sem perda ou duplicação; um cursor lexical sobre IDs derivados de hash isoladamente não é aceito como prova de snapshot consistente |
| UCAT-06 | Consultar uma evidência de outro scope ou revogar o acesso ao bundle/à origem após sua indexação | Autorizar pelo scope no servidor e respeitar revogações; a projeção não concede acesso independente à evidência nem permite usar a versão revogada porque ela constava de um índice anterior |
| UCAT-07 | Agrupar capturas segmentadas com journeyId por captura, logicalJourneyId e predecessor ausente ou incompatível | Não confundir as duas identidades; unir somente segmentos com escopo e cadeia comprovados. Metadados indisponíveis ou predecessor faltante mantêm a limitação explícita, sem inventar completude da jornada |
| UCAT-08 | Confirmar um bundle e seu ACK de entrega, interrompendo depois a projeção do Catálogo UI | O bundle confirmado continua válido; a indexação fica pendente/falha com causa e é reconciliada de forma idempotente. Não reclassificar a entrega como falha nem tratar ausência de índice como ausência de observação |
| UCAT-09 | Listar várias evidências com DOM, screenshots, corpos e recursos grandes | Resposta de descoberta usa metadados limitados e referências/hashes; conteúdo pesado é carregado somente no detalhe necessário, com limites explícitos, sem copiar todos os artefatos para cada item ou mensagem de fila |
| UCAT-10 | Indexar uma fonte parcial com 42 fixtures utilizáveis e sete indisponíveis, sem execução UI | Preservar qualificação por uso, motivos e dependências; não declarar 42 testes, jornada executável ou PASS. Fixtures e resultados de replay não são promovidos automaticamente a evidência real de execução da API |

Esses ensaios definem a fundação futura do Catálogo UI; não afirmam que as consultas, projeções ou
garantias de snapshot acima já estejam implementadas. O catálogo organiza fatos e suas
referências. Test Designs e suas versões continuam no Registry, e resultados continuam
no Results.

### 7.2 Compilador determinístico e modelo reutilizável

**Estado de todos os ensaios desta subseção: A IMPLEMENTAR / NÃO EXECUTADO.**

O modelo comum contém operadores, templates, adapters de capacidade e regras versionadas.
Ele transforma evidência qualificada em plano; não cria uma regra de negócio por coincidência
entre valores ou por interpretação livre. O conteúdo semântico e seus metadados operacionais
são separados para permitir reprodução e auditoria.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| COMP-01 | Compilar com IA/BYOAI desconfigurada, nenhuma chave e provedor indisponível | Produzir o mesmo plano elegível e as mesmas limitações sem chamada ao modelo; nenhuma dependência artificial de IA bloqueia o lote |
| COMP-02 | Compilar duas vezes as mesmas fontes, compiler/templates/adapters/perfil, mudando apenas jobId, tentativa ou timestamp operacional | Conteúdo semântico canonicalizado e seu hash permanecem iguais; metadados operacionais ficam fora desse hash. A canonicalização preserva a ordem significativa de passos e ocorrências |
| COMP-03 | Alterar fontes ou regras efetivas, template, adapter ou versão do compilador | Proveniência/fingerprint refletem a mudança e a publicação identifica a nova revisão, preservando versões anteriores; não reutilizar silenciosamente plano produzido por outra regra |
| COMP-04 | Receber uma observação curta, outra longa e cortes possíveis que começam sem preparação | Produzir somente cenários suportados, sem mínimo artificial por observação; divisão é determinística e conserva dependências/preparação. Trecho que não permite início independente permanece unido ou explicitamente limitado |
| COMP-05 | Faltar checkpoint pós-ação, haver estado instável ou IDs de nós/documentos válidos apenas na captura | Gerar checks somente onde há referência e correspondência suportadas; remapear por contrato/locator qualificado, sem comparar IDs de sessões literalmente ou fabricar postState. Registrar verificações não aplicáveis/não verificáveis e sua cobertura |
| COMP-06 | Aplicar o mesmo modelo a duas aplicações com nomes/rotas/dados diferentes e uma capacidade não suportada | Reutilizar operadores/templates sem prompts específicos ou IA; valores e referências vêm das evidências/perfil. A capacidade não suportada é explicitada, sem prometer cobertura universal nem substituir por uma assertion inventada |

## 8. Execução pareada em lote

**Estado de todos os ensaios desta seção: A IMPLEMENTAR / NÃO EXECUTADO.**

A unidade apresentada ao usuário é um lote/suite de cenários UI. Cada cenário fixa uma
versão de Test Design e prevê dois membros relacionados: REPLAY e depois LIVE, com resultados
e tentativas separados. A composição registra modos elegíveis/bloqueados e motivos no ledger.
O usuário inspeciona e ajusta o plano sem disparar cada cenário ou modo individualmente.
Uma falha em REPLAY não cancela automaticamente LIVE; suas dependências são avaliadas à parte.
Dois membros previstos não autorizam fabricar duas execuções ou dois PASS.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| BEX-01 | Admitir uma suite UI e depois alterar latest de seus testes ou das evidências | Fixar composição/revisão da suite e, em cada par, versões exatas de Test Design/bundle, build alvo, perfil e política; ambos os modos usam essas referências durante toda a execução |
| BEX-02 | Planejar um lote com cenários elegíveis e outros sem dependência obrigatória | Criar plano dos elegíveis e ledger dos excluídos, com cenário, motivo, dependência e origem; não executar bloqueados nem fazê-los desaparecer da cobertura apresentada |
| BEX-03 | Executar dois fluxos independentes com contextos de navegador próprios e um candidato bloqueado | Um único disparo agenda os dois elegíveis conforme os limites; o bloqueado permanece explícito. Estado de browser e consumo de fixtures não vazam entre execuções |
| BEX-04 | Um item encontra regressão funcional e outro encontra indisponibilidade temporária do Browser Runner | Persistir resultados individuais e distinguir defeito observado, erro de infraestrutura e bloqueio; retry de infraestrutura é limitado e não reexecuta todo o lote automaticamente |
| BEX-05 | Reentregar uma tarefa de execução ou receber resultado tardio de um worker cujo lease expirou | Manter um run lógico por item e tentativas identificadas; fencing impede commit tardio sobre a tentativa vigente. Não prometer que o navegador iniciou exatamente uma vez |
| BEX-06 | Cancelar e posteriormente retomar um lote segundo sua política | Registrar itens concluídos, cancelados, em andamento e retomáveis; preservar resultados e tentativas existentes e agendar somente o restante autorizado |
| BEX-07 | Encerrar um lote com membros REPLAY/LIVE aprovados, reprovados, bloqueados ou cancelados | Agregado reconcilia cenários, pares, modos e exclusões, sem contar retries como novos cenários; conclusão operacional e cobertura parcial não viram PASS global nem comparação completa |
| BEX-08 | Enfileirar um lote UI maior que a capacidade de browsers enquanto execuções API estão ativas | Respeitar capacidade, quotas e backpressure do executor de navegador, mantendo o processamento API independente; espera e progresso são recuperáveis sem acompanhamento manual por cenário |
| BEX-09 | Planejar futuramente uma suite que contenha itens API e UI | Roteamento explícito pelo domínio e contrato direciona API ao executor de API e UI ao Browser Runner, com resultados identificáveis; extensão opcional posterior, sem ser gate do primeiro MVP de lotes UI |

O isolamento exigido para browser é de execução, capacidade e falhas. BGEN-13 e BEX-08
não exigem duplicar Catalog, Registry ou Evolution, nem criar um deploy separado de
geração somente por existir o domínio UI. A topologia concreta segue o ADR.

### 8.1 Par REPLAY/LIVE e comparação com a observação

**Estado de todos os ensaios desta subseção: A IMPLEMENTAR / NÃO EXECUTADO.**

Nesta matriz, **O** é a observação imutável, **R** o replay com fixtures e **L** a execução
com respostas atuais. Comparadores registram O→R, O→L e R→L nas dimensões aplicáveis.
Igualdade entre R e L não substitui a comparação com O. Mudança observada é um fato; seu
significado depende da assertion, do perfil e das condições de comparabilidade.

| ID | Ensaio | Resultado exigido |
|---|---|---|
| PAIR-01 | Solicitar um lote pareado sem chave/provedor de IA disponível | Cada cenário prevê REPLAY seguido de LIVE, com IDs, modo, tentativas e status próprios ligados à mesma versão do Test Design. Compilação, execução, comparação e persistência funcionam sem IA |
| PAIR-02 | Tentar usar builds, perfis de navegador, viewport, locale/timezone ou políticas divergentes nos dois membros | Fixar build alvo e perfil comparável no par; rejeitar admissão incompatível ou registrar a dimensão não comparável, sem atribuir a diferença automaticamente ao backend. Overrides ficam explícitos e versionados |
| PAIR-03 | Executar R e depois L com cookies, storage, contadores de fixture e dados de preparação | Usar contextos novos e preparação equivalente declarada, sem reutilizar o estado final de R. Contadores não vazam; estado de backend que afeta L tem preparação/reset ou limitação explícitos |
| PAIR-04 | No REPLAY, emitir requests correspondentes, ambíguos e sem fixture | Servir somente a fixture qualificada pelo matching/contexto/ocorrência, preservando status, corpo e política de headers; ausências/ambiguidades são diagnosticadas e não disparam fallback real de negócio |
| PAIR-05 | No LIVE, a aplicação solicita APIs com respostas atuais, inclusive diferentes das observadas | Permitir as chamadas reais do escopo e observar seus requests/responses sem substituir corpos por fixtures; mocks observados são referências de comparação, não respostas do modo LIVE. Mudanças de chamadas são registradas conforme o contrato |
| PAIR-06 | R falha numa assertion ou fica bloqueado por fixture ausente, enquanto L tem dependências suficientes | L continua por sua própria prontidão; uma falha de R não o cancela automaticamente. Preservar o resultado/bloqueio de R e declarar quais comparações não puderam ser realizadas |
| PAIR-07 | Um ou ambos os membros não executam, são cancelados ou não alcançam assertions | Exibir os dois status previstos com fatos distintos, sem fabricar duas execuções ou dois PASS. Resultado comparativo incompleto permanece explícito; retries não contam como novos cenários ou substituem o membro ausente |
| PAIR-08 | O, R e L são iguais; depois R e L divergem de O da mesma forma | No primeiro caso, registrar igualdade nas dimensões efetivamente verificadas. No segundo, detectar os deltas O→R/O→L mesmo com R=L; R nunca se torna baseline implícita que oculta a regressão compartilhada |
| PAIR-09 | Dados LIVE mudam e um binding explícito de response→UI produz valor incorreto; outra coincidência JSON/DOM não tem binding comprovado | Mudança de dado gera delta, não falha automática por igualdade histórica. Violação do binding/expected explícito falha; correspondência não comprovada permanece não verificável, sem inventar JSONPath, volatilidade ou regra de negócio |
| PAIR-10 | Checkpoint estável fornece presença/estado/dados e geometria de campos, incluindo mudança deliberada de posição | Compilar e executar operadores suportados de estrutura/layout desde o primeiro perfil, com correspondência de elementos, coordenadas/perfil e tolerâncias versionadas. Cobertura informa o que foi comparado; mudança que viola a regra falha sem esconder regiões não verificadas |
| PAIR-11 | A referência tem sourceBuildRef desconhecido, screenshot instável ou perfil visual incompatível | Preservar a limitação histórica e marcar dimensões incompatíveis/inconclusivas; continuar checks independentes comparáveis. Não prometer reconstrução exata nem concluir causa de front-end apenas pelo padrão de falhas |
| PAIR-12 | LIVE envia operação mutável e perde a confirmação antes de conhecer o efeito no servidor | Não repetir cegamente o efeito. Reconciliar com mecanismo previsto, chave idempotente realmente suportada ou preparação/reset apropriado; se não for possível, registrar estado incerto/bloqueado e manter tentativas e efeitos conhecidos |
| PAIR-13 | R passa e L falha, ou R falha e L passa | Preservar fatos e diferenças por assertion/rede/estado; a matriz orienta investigação, mas não declara automaticamente defeito exclusivo de API, front-end ou dados. Classificação de causa exige evidência adicional |
| PAIR-14 | Após falha, Evolution está sem IA; depois recebe proposta de trocar expected pelo actual ou ampliar tolerância | Salvar resultados/diffs independentemente da IA e deixar análise pendente/indisponível sem perder a falha. Proposta posterior não altera baseline automaticamente; exige política aplicável, nova versão e verificação vinculada, preservando o resultado original |

## 9. Marcos de entrega: Test Design primeiro, execução depois

**Estado de todos os cortes e dados de ensaio abaixo: A IMPLEMENTAR / NÃO EXECUTADO.**

O primeiro marco de produto abrange **UI-TD-1 + UI-TD-2** e demonstra compilação determinística
em lote, versionamento e apresentação de Test Designs rastreáveis, sem dependência de IA.
Os dois modos e suas regras de comparação já pertencem ao contrato compilado. O Browser Runner
e os resultados pertencem ao marco seguinte **UI-EXEC-1**, que nasce com o par REPLAY/LIVE.
Sua implementação não bloqueia a primeira entrega de desenho. O ensaio do produto comprova
lotes com fontes suficientes, sem obrigar cada observação a produzir vários cenários.

Para o primeiro marco, preparar dados de teste identificados com **dois fluxos passíveis de
desenho e um terceiro candidato cujo replay depende de fixture ausente**, em uma ou mais
fontes delimitadas. Incluir interrupção de compilação e falha transitória de persistência.
Os designs contêm checks rastreáveis, preparação, dados e prontidão por modo; sua compilação
não declara execução. No marco seguinte, executar pares de dois fluxos independentes,
introduzir uma regressão controlada, uma variação legítima de dados e um replay bloqueado
cujo LIVE possa executar. Nenhum teste de lote autoriza cortes que removam preparação.

Esses dados ainda precisam ser construídos e validados. Os números da captura real não
comprovam que ela já contém essa composição nem que seus fluxos são independentes.

| Corte | Entrega a demonstrar | Evidência de aceite exigida |
|---|---|---|
| UI-TD-1 | Adapter direto, compilador, templates/regras, contrato dos dois modos e snapshot do lote | Fontes delimitadas produzem cenários fundamentados e hashes reproduzíveis; checks/dependências têm proveniência e capacidades explícitas. Funciona sem IA, Catalog API ou UI Catalog projetado |
| UI-TD-2 | Compilação assíncrona em lote, guard, artefato durável, Registry e Console | Fontes de ensaio suficientes produzem vários cenários; fontes mais simples não são fragmentadas artificialmente. Checks, versões, prontidão por modo, retries e histórico são preservados, sem chamadas de IA nem PASS de execução |
| UI-EXEC-1 — marco seguinte | Browser Runner com pares REPLAY/LIVE, comparadores determinísticos e Results | Dois fluxos elegíveis executam ambos os modos; O/R/L preservam regressões e diferenças legítimas. Modos bloqueados ficam explícitos, contexto é isolado e IA não é necessária. Esse aceite não bloqueia a entrega anterior de Test Design |
| UI-CAT-1 — backlog posterior | Catálogo agregado de evidências UI, projeções e consultas reconstruíveis | Executar UCAT-01 a UCAT-10 quando esse domínio for implementado; preservar os bundles e os Test Designs já produzidos pela leitura direta |

UI Catalog agregado, Browser Runner, recuperação de cache HTTP 304, comparação visual
avançada e suites mistas API + UI ficam fora dos gates do primeiro marco de Test Design.
O contrato compilado já descreve os dois modos e os operadores de estrutura/layout suportados.
EX/BEX/PAIR e os demais ensaios que exigem browser aplicam-se ao marco de execução; COMP
aplica-se à compilação. Dependências ausentes, escopo, domínio, integridade, cobertura real e
rastreabilidade continuam obrigatórios desde a leitura inicial. AI/BYOAI é recurso de análise
no Evolution, com estado próprio; sua ausência não impede compilar, executar ou salvar resultados.

## 10. Evidência exigida para declarar cada corte entregue

Cada corte implementado deve incluir revisão/versão dos projetos, comandos de validação,
resultado dos testes pertinentes, IDs das versões e runs usados no smoke, limitações reais
e instrução de aplicação. Registrar separadamente testes locais e validação remota.

Não repetir a suíte inteira por uma edição documental. As verificações do pacote atual
limitam-se à preservação do código executável, links internos e integridade do conteúdo
distribuído; nenhuma linha desta matriz recebe aprovação por essa verificação documental.
