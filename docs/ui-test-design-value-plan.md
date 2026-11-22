# QAgent — Test Design observado, execução pareada e evolução

**Data:** 21/11/2026. **Estado:** UI-TD-1 + UI-TD-2 implementados e verificados localmente.
Este documento mantém a arquitetura completa. O compilador, os lotes, o Registry UI,
o Gateway e o Console estão no [relatório do corte entregue](ui-test-design-release-td1-td2.md).
Browser Runner, comparação O/R/L executada e Evolution UI permanecem próximos cortes.
A implementação local não comprova implantação remota ou execução de testes da aplicação.

## 1. Decisão de produto

O Test Design UI será **orientado pelos dados observados e produzido por um compilador
determinístico**, usando templates e políticas versionados. O caminho normal de criação não
depende de LLM, chave de provedor ou interpretação semântica nova a cada observação. A IA fica
principalmente no Evolution, para analisar falhas ou divergências selecionadas depois da execução.

Cada versão de teste define dois perfis relacionados: **UI_REPLAY**, com respostas observadas
como mocks, e **UI_LIVE**, com a aplicação fazendo suas chamadas reais. O primeiro executor
entregue já deverá processar esse par. O usuário solicita lotes; não precisa selecionar ou
disparar cada cenário individualmente.

A prioridade continua sendo Test Design diretamente sobre os bundles persistidos no
`qagent-ui`. UI Catalog permanece aprovado como evolução posterior, sem bloquear compilação,
versionamento ou execução inicial. Catalog API é enriquecimento opcional, nunca condição para
que uma interação UI seja utilizável.

A recuperação ampliada dos sete HTTP 304 permanece em
[QAGENT-UI-CACHE-001](ui-cache-deferred.md). A disponibilidade é avaliada por dependência e
por perfil: uma ausência pode impedir replay sem impedir uma execução live válida.

O primeiro valor é um desenho estruturado, rastreável e versionado no Registry. O marco seguinte
executa as duas modalidades e apresenta verificações e diferenças. A
[arquitetura compartilhada](ui-shared-services-batch-architecture.md) e a
[matriz de aceite](ui-test-design-acceptance.md) complementam este plano.

## 2. Evidência disponível e seu significado

Os números abaixo vêm das consultas D1 enviadas por Igor nesta conversa. São provas de
persistência, entrega e qualificação, não resultados de execução UI realizados pelo assistente.

| Campo | Valor |
|---|---|
| Captura | `uic_d314dfa9-986e-4532-ac30-202f2cf72640` |
| Build ativo | `uib_893e2d5a19cbbc420ec3a0fb94cb1d235a06f5fca0efe825d6bc319fb4c8b27b` |
| Bundle | `urbv_893e2d5a19cbbc420ec3a0fb94cb1d235a06f5fca0efe825d6bc319fb4c8b27b` |
| Fonte SHA-256 | `7451d67ec14b8b384d550685299acb62ac27fb43eae9ed59f8bd03786189a711` |
| Exportação / tentativa ativa | `DELIVERED` / `DELIVERED` |
| Builder / operação | `qagent_ui_bundle_builder_v5` / `COMPLETE` |
| Manifesto / integridade | `SEALED` / `READY` |
| Artefatos referenciados / verificados / pins | `345 / 345 / 345` |
| Interações BUSINESS_API | `49` |
| Fixtures utilizáveis | `42`: 41 GET/XHR e 1 PUT/XHR, HTTP 200, corpo completo |
| Fixtures indisponíveis | `7`: GET/XHR HTTP 304, `MISSING`, `UI_CACHE_BODY_UNAVAILABLE` |
| Execução de jornada | `UNAVAILABLE` |
| Qualificação | `OBSERVED_PAGE_EVIDENCE_WITH_FIXTURES_NOT_EXECUTED` |

As 42 fixtures são ocorrências, não 42 testes nem necessariamente 42 endpoints. Um percurso
pode precisar de várias delas. A evidência também não comprova cobertura integral da aplicação
ou homologação de uma jornada com mais de 512 artefatos distribuídos em segmentos.

Os contratos atuais são `qagent.ui-capture.v2`, `qagent.ui-bundle-source-ref.v2`,
`qagent.ui-page-evidence.v2`, `qagent.ui-observed-journey.v1` e
`qagent.ui-page-fixture-index.v1`. O matching usa
`qagent_ui_observed_fixture_match_v1`. As bases são Plugin 2.0.26, qagent-ui 0.1.10 e
Observation 0.1.18. `qagent.ui-test-design.v1` está implementado em qagent-ui 0.2.0;
os contratos de execução/resultados UI completos deste plano pertencem ao próximo corte.

O perfil `OBSERVED_ENVIRONMENT_MANAGED` de DEV/STG permanece. O conteúdo observado conserva
sua origem; esta especificação não reintroduz a política anterior de sanitização.

## 3. O modelo comum e as capacidades realmente capturadas

O modelo reutilizável representa fontes, preparação, ações, checkpoints, requests, fixtures,
verificações e políticas de comparação. Diferentes aplicações fornecem dados para esse modelo;
capacidades especiais entram por adapters ou perfis explícitos.

| Evidência atual | Informação disponível |
|---|---|
| DOM | Nós com identidade local, parent, tipo, nome, atributos e texto |
| Layout | Bounds por nó, propriedades CSS selecionadas, viewport, DPR e scroll |
| Formulário | Tipo, valor e checked; referências aos nós |
| Ações | CLICK, FILL, SELECT, CHECK, NAVIGATE e SCROLL, com ordem e contexto |
| Checkpoints | Contexto, timestamps, estabilidade e refs de DOM/layout/form/screenshot |
| Rede | Método, origem, path, query, corpo/headers por referência, status e ocorrência |
| Qualificação | Limitações de ações, estado, visual, fixtures, bootstrap e proveniência |

Na base do produtor, locators efetivamente gerados são TEST_ID e CSS, com frame principal.
Enter/Escape/Tab são registrados como capacidade não suportada; arquivos, multiselect,
shadow DOM e iframes também têm limitações. O contrato permitir ROLE/TEXT não comprova que o
sensor já os produz.

`nodeId` pertence à observação e não identifica automaticamente o mesmo elemento em uma nova
sessão. O compilador precisa de correspondência verificável e unicidade. O recorder grava
`stateBeforeId` a partir do último estado e `stateAfterId` como null; checkpoints posteriores
não estabelecem, sozinhos, causalidade de cada clique.

O sensor calcula idioma, timezone e esquema de cores em `renderProfile`, mas esse objeto
não é persistido pelo recorder consultado; viewport/DPR/scroll são persistidos. Portanto, não
anunciar perfil visual histórico completo. Também permanece `SOURCE_BUILD_UNKNOWN` na
captura de referência.

O envelope observado original conserva `assertions: []`. O novo compilador produz checks
em um Test Design separado e imutável, preservando o bundle. Esses limites orientam a
capacidade compilável, sem obrigar interpretação por IA.

## 4. Compilador determinístico e contrato declarativo

A entrada do compilador fixa versões exatas das fontes, hashes, compiler, templates, adapters,
perfil de comparação e configurações relevantes. O resultado normalizado produz um digest
reproduzível. Mesmos insumos e versões devem produzir o mesmo modelo; relógio, UUID aleatório
ou chamada a provedor não podem alterar seu conteúdo sem necessidade.

Metadados operacionais, como horário de criação, pertencem ao job/registro e ficam separados
do conteúdo que define equivalência. Fingerprint de contexto, hash do modelo e chave de
idempotência da operação têm funções diferentes.

O contrato proposto precisa conter:

- Identidade de escopo, origem e versão; hashes e refs das evidências.
- Preparação, capacidades exigidas e entradas observadas ou bindings declarados.
- Ações permitidas e condições de conclusão, em ordem demonstrável.
- Pontos de verificação e operadores, com origem de cada esperado.
- Plano de matching/consumo das fixtures e observação das chamadas live.
- Políticas por check para dados fixos, diferenças e bindings.
- Perfis UI_REPLAY/UI_LIVE e prontidão independente.
- Versões do compilador/templates/adapters/políticas, limitações e cobertura efetiva.

O compilador não gera JavaScript livre a partir de texto capturado. Ele instancia um conjunto
finito de operações que o runner conhece. Títulos podem ser derivados de rota, ação e sequência;
nomear uma regra de negócio por IA não é necessário para executar a caracterização.

A primeira origem dos esperados é **caracterização observada aceita pela política do projeto**.
Isso testa continuidade em relação à referência. Requisitos e regras de negócio declarados
podem acrescentar assertions com autoridade própria. Uma observação isolada não transforma
todo comportamento ocorrido em requisito normativo.

### Templates de verificações

Os nomes abaixo são operadores propostos, ainda sujeitos ao contrato final.

| Operador | Origem do esperado | Condição |
|---|---|---|
| ELEMENT_PRESENT | DOM observado | Elemento identificável de forma única |
| ATTRIBUTE_EQUALS | Atributo capturado | Propriedade e estabilidade qualificadas |
| TEXT_EQUALS | Texto efetivamente preservado | Política de dado definida |
| FORM_VALUE_EQUALS | Form state | Campo suportado e mapeado |
| CHECKED_EQUALS | Checked observado | Controle compatível |
| BOUNDS_WITHIN_TOLERANCE | Layout observado | Perfil/scroll comparáveis e tolerância versionada |
| STYLE_EQUALS | CSS da whitelist | Propriedade suportada |
| SCREENSHOT_MATCHES | Screenshot qualificada | Referência e perfil visual comparáveis |
| URL_MATCHES | Navegação/URL observada | Mapeamento de origem e valores explícitos |
| REQUEST_MATCHES | Request/contexto observado | Fingerprint e ocorrência resolvidos |
| FIXTURE_CONSUMPTION_MATCHES | Plano de consumo | Cardinalidade obrigatória e máxima definidas |

Cada check conserva sua referência de origem, extração aplicada e política. O relatório
contabiliza verificações elegíveis, executadas, divergentes, bloqueadas e não suportadas.
Zero verificações obrigatórias executadas nunca significa PASS.

## 5. Transformação das fontes em testes, sem catálogo obrigatório

`Repository.version(scope, bundleVersionId)` e `readEnvelope()` já fornecem leitura de
versão exata com escopo, acesso e integridade. O adapter inicial reutiliza essas bases,
admite contratos suportados e carrega apenas os artefatos necessários. A integração interna
com Gateway/Orchestrator terá escopo próprio; credencial global de operador não vai ao Console.

O processamento será: validar fonte, resolver referências, ordenar evidências, qualificar
capacidades, instanciar templates, validar o modelo, salvar o candidato e publicar no Registry.
Não há requisito de conta BYOAI ou provedor disponível nesse caminho. A indisponibilidade do
AI Engine não deve impedir compilação, leitura ou execução normal.

Não forçar N cenários por observação. Uma jornada coerente com muitos checkpoints e checks
pode gerar um teste. Vários cenários só são separados quando existe início/preparação
demonstrável para cada um. Cortar por quantidade de tokens, requests ou telas não prova
independência.

Cenários contidos em um segmento declaram esse escopo. Composição entre segmentos exige
resolver e validar `logicalJourneyId`, índice e predecessor nas fontes correspondentes.
O `journeyId` atual é por captura. Metadados ausentes não autorizam união por URL/horário ou
reescrita de bundles selados.

O primeiro pedido admite uma observação ou conjunto delimitado de bundles. A listagem atual
é lexical por ID de hash, não cronológica; ela não demonstra inventário completo enquanto
entram novas versões. O job fixa suas fontes e declara abrangência. UI Catalog poderá ampliar
descoberta, busca e relações entre observações depois.

## 6. Responsabilidades compartilhadas

| Componente | Papel nesta decisão |
|---|---|
| Observation | Eventos e bytes originais, integridade e acesso |
| qagent-ui | Bundles, adapter de evidências, compilador/templates e qualificação UI |
| Gateway | Autorização, rotas e coordenação do caso UI; sem chamada obrigatória de geração por IA |
| Generation Orchestrator | Jobs/lotes de compilação, fontes fixadas, orçamento e recuperação |
| Test Registry | Identidade e versões imutáveis dos desenhos |
| Controle de execução | Suite, par de runs, agendamento e tentativas |
| Browser Runner | Aplicação alvo, ações, mocks/observação live e verificações |
| Results | Fatos dos dois runs, diferenças e comparabilidade |
| Evolution | Diagnóstico, propostas e verificação; IA opcional pós-execução |
| Console | Operação em lote, cobertura, resultados e exceções |
| UI Catalog posterior | Organização agregada das mesmas fontes |
| Catalog API opcional | Conhecimento vinculado, sem pré-requisito do fluxo UI |

Os clientes atuais de geração/Registry no Gateway são específicos de API e exigem endpoint.
A integração UI precisa de contrato próprio e discriminador de domínio; reaproveitar
versionamento não significa inventar endpoint para uma jornada.

API e UI são coletados em caminhos distintos. Uma requisição pode aparecer no Catalog pelo
coletor API paralelo, sem levar suas relações UI. Mocks ou resultados UI_REPLAY não se tornam
automaticamente novas provas de execução real de API.

## 7. Lotes, persistência e recuperação

A unidade do usuário continua sendo uma operação em lote, mesmo quando há somente uma fonte.
Cada item pode produzir um desenho, vários desenhos justificáveis ou bloqueio documentado.
Contagens de fontes, itens, cenários e checks permanecem distintas.

O job registra todas as fontes admitidas, versões e política antes de compilar. Falha de
resolução não desaparece dos contadores. Novas observações ficam para outra operação.
Limites de bytes, tempo e concorrência evitam carregar todo o histórico indiscriminadamente.

Salvar o candidato validado e seu hash antes da publicação permite retomar a mesma saída.
Retry de transporte não cria nova versão lógica. Se o Registry confirmou e a resposta se
perdeu, reconciliar pela chave. Saídas múltiplas têm identidade e commit próprios.

Claims/leases, fencing, retries limitados e reconciliação protegem itens interrompidos.
Reentrega não repete item terminal. Cancelamento para novas admissões e conserva resultados
confirmados. Fechar o Console não interrompe o backend. Esses mecanismos servem ao compilador
determinístico; referências anteriores a checkpoint de resposta de LLM deixam de ser requisito
da geração normal.

## 8. Um desenho, duas execuções e três referências

Cada item de execução cria um par com identidade comum e duas execuções lógicas:
**R = UI_REPLAY** e **L = UI_LIVE**. A referência histórica é **O = observação aceita**.
Os dois perfis usam a mesma versão do desenho, do compilador e das políticas aplicáveis.

A ordem normal é R e depois L. Cada execução começa em contexto de browser novo e recebe
preparação própria, sem herdar cookies mutados, estado de formulário ou consumo de fixtures
da execução anterior. Fixar o mesmo build alvo, perfil de browser, viewport, locale e demais
condições controláveis. Dados necessários à preparação também precisam de estratégia explícita.

O build alvo atual pode ser diferente do build observado. Como a captura tem
SOURCE_BUILD_UNKNOWN, não atribuir retroativamente uma versão histórica inventada. Os dois
runs podem comparar o mesmo alvo conhecido à referência, registrando essa limitação.

Responder com os mesmos corpos não restaura automaticamente sessão, armazenamento local,
relógio, aleatoriedade, código, fontes ou estado inicial. O bootstrap pertence ao plano.
Os snapshots são evidência; o contrato atual usa EXECUTE_TARGET_BUILD, não execução do HTML/JS
arquivado.

O primeiro runner já entrega o par, não apenas replay com live adiado. Sempre haverá dois
estados explícitos. Uma falha de assertion em R não cancela L automaticamente. Bloqueio de um
perfil deve ter sua própria causa; se o outro possui condições válidas, pode executar.
Ausência de um resultado necessário deixa a comparação incompleta, nunca aprovada por omissão.

## 9. UI_REPLAY: caracterização com respostas observadas

Instalar o matching antes da navegação e executar as ações do desenho. As APIs de negócio
recebem as fixtures previstas, conservando status, corpo, representação e headers relevantes
sob o contrato de transporte. Shell/assets e bootstrap seguem origens e políticas explícitas.

O matching preserva método, serviço/origem mapeada, path, query com ordem/duplicatas, corpo,
headers de negócio, contexto e ocorrência. UUIDs de documento/navegação da captura são
remapeados para o novo run; não comparados literalmente.

Requisição sem correspondência ou consumo esgotado produz diagnóstico, sem fallback real.
Registrar fixture usada, hash, etapa e contagem. Chamadas repetidas indistinguíveis com respostas
diferentes exigem contexto suficiente; ordem de chegada concorrente isolada não garante
associação correta.

A resposta observada é o dado do mock. As verificações conferem a UI produzida, as ações,
transições demonstráveis e o contrato das chamadas emitidas. Responder HTTP 200 ao mock não
comprova funcionamento atual do backend.

Fixture ausente pode bloquear preparação ou parte do replay. Um HTTP 304 sem representação
comprovada não vira corpo inventado, resposta vazia ou 200 sintético. Essa limitação pode
coexistir com elegibilidade live, pois os dois perfis têm dependências diferentes.

## 10. UI_LIVE: aplicação real e dados atuais

O runner repete as ações UI com a preparação live e deixa a aplicação fazer suas chamadas
normais. Não injeta respostas observadas nem reaplica a lista de requests como chamadas
paralelas. Captura requests/responses atuais e evidências da UI para comparação.

O perfil inicial deve controlar cache/browser e Service Workers de forma consistente com
seu objetivo, declarando a limitação quando não observar efetivamente chamadas atuais.
Isso não implementa recuperação do cache histórico nem altera a captura original.

Dados podem mudar legitimamente. Cada verificação declara uma das políticas propostas:

| Política | Comportamento |
|---|---|
| FIXED | Compara com esperado versionado; divergência viola a assertion correspondente |
| OBSERVED_DIFF | Registra diferença de valor/estrutura em relação a O/R sem concluir defeito automaticamente |
| DATA_BINDING | Resolve valor por associação explícita e versionada entre entrada/resposta/elemento |

Não ignorar todos os campos dinâmicos. Preservar seus valores, diferenças e cobertura.
Ao mesmo tempo, não reprovar toda execução porque a quantidade de registros ou um timestamp
mudou. Estrutura, tipos, presença e relações declaradas podem continuar verificáveis.

Uma única captura não comprova que determinado texto veio de um JSONPath. Igualdade de string
ou proximidade temporal pode apoiar investigação, mas não cria binding normativo. Campos
atuais, IDs de entidades e credenciais exigem resolução configurada, sem substituições
silenciosas para fazer o teste passar.

Exemplo ilustrativo: o response atual contém um nome diferente e a tela o apresenta corretamente.
A comparação registra a mudança; um binding explícito permite verificar a correspondência
response→UI. Se o response contém o novo nome e a UI mantém o antigo, essa relação pode
falhar. Sem binding comprovado, registrar os fatos e a incerteza, sem inventar o vínculo.

## 11. Campos, posições, aparência e sincronização

Presença, valores e geometria qualificada fazem parte do primeiro conjunto de templates.
A comparação visual avançada pode evoluir depois, mas posições dos campos não ficam
integralmente adiadas. Bounds são comparados sob viewport, DPR, scroll e tolerância fixados.

Comparações de texto/layout usam elementos mapeados e checkpoints apropriados. Se o conteúdo
live aumenta, o deslocamento de um elemento pode ser consequência legítima dos dados;
a política distingue diferença geométrica e violação de restrição exigida.

Screenshots e estilos só recebem verdicts compatíveis com a qualidade da referência.
Perfil desconhecido, fonte ausente ou checkpoint instável aparece como limitação da modalidade.
Não mascarar regiões, aumentar tolerâncias ou aceitar uma nova imagem automaticamente depois
da falha.

Esperar por condições verificáveis, como elemento disponível, estado esperado ou conclusão
da dependência prevista, com limites. Tempos observados são evidência, não sleeps normativos.
A execução precisa registrar quais verificações foram alcançadas; sequência de cliques sem
checks avaliados não encerra uma regressão como PASS.

A seleção dos checkpoints respeita contexto e ordem demonstrável. A ausência atual de
stateAfterId completo impede atribuir automaticamente cada snapshot ao efeito causal de
um clique. O compilador pode criar barreiras qualificadas e conservar trechos ambíguos como
limitação, sem pedir à IA que complete silenciosamente a evidência.

## 12. Comparação O/R/L e interpretação dos resultados

Results mantém três comparações identificáveis: **O↔R**, **O↔L** e **R↔L**. A primeira verifica
reprodução sob dados observados; a segunda mostra evolução frente à referência; a terceira
ajuda a localizar diferenças entre dados fixados e chamadas atuais no mesmo alvo.

Cada comparação registra checks pareados, valores, referências, política, perfil e condição
de comparabilidade. Se um run não terminou ou os ambientes divergem, o agregado informa
incompletude ou limitação; não força uma conclusão binária.

| Padrão observado | Leitura inicial, sem causalidade automática |
|---|---|
| R e L satisfazem checks | Evidências compatíveis com os respectivos escopos |
| R satisfaz; L diverge | Investigar dados atuais, contrato, integração e estado live |
| R diverge; L satisfaz | Investigar fixture/referência, preparação e compatibilidade histórica |
| Ambos divergem | Examinar fatores compartilhados e causas independentes |
| Um perfil bloqueado | Resultado parcial e comparação incompleta, com causa própria |

Uma diferença é um fato comparativo. Uma falha é violação de uma assertion obrigatória.
Um diagnóstico de causa pode continuar hipótese. Armazenar essas três dimensões separadamente.

R não vira nova baseline automaticamente e L não substitui O. A referência aceita e a versão
do teste continuam imutáveis. Retentativas preservam resultados anteriores; falha seguida
de sucesso permanece disponível para análise de instabilidade.

## 13. Preparação live e efeitos das ações

O modo live pode criar, alterar ou excluir dados do ambiente de teste, como a aplicação faria.
A estratégia de preparação deve definir registros de ensaio, reset/cleanup e isolamento por
run quando necessários. Reutilizar os dados observados exige conferir sua existência atual.

Uma falha de infraestrutura após envio de uma ação com efeito pode deixar resultado incerto.
O retry não deve repetir automaticamente uma mutação desconhecida; usar reconciliação,
identidade de operação ou preparação nova conforme o adapter do sistema. Registrar a tentativa
e o estado encontrado.

Essas são propriedades do teste executável, não confirmação manual por cenário. As políticas
já autorizadas do projeto delimitam a execução em DEV/STG. O replay usa mocks para negócio;
o live usa chamadas reais, com orçamento, timeout e preparação próprios.

## 14. Evolution: IA depois dos fatos

O caminho normal de compilação e runs aprovados exige zero chamadas à IA. Evolution pode
selecionar falhas, divergências ambíguas ou padrões recorrentes para análise com o AI Engine
já existente. Deduplicação, prioridade e orçamento evitam enviar o mesmo erro repetidamente.

A entrada do diagnóstico inclui O/R/L, assertions, expected/actual, requests/responses,
fixtures, passos, diferenças, perfil e limitações. A IA pode propor causa, classificar mudança,
sugerir binding ou locator e explicar impactos. Sua resposta não altera o resultado factual.

Cada proposta conserva evidência, diff, versão de origem e política. A aplicação cria nova
versão no Registry e uma execução de verificação vinculada. Remover assertion, relaxar
tolerância ou substituir expected pelo actual é mudança de escopo/expectativa, não reparo
automaticamente seguro.

Novas observações podem fornecer dados melhores; elas entram com proveniência nova e política
de aceitação. A aprendizagem consiste em histórico de evidências, resultados e propostas
verificadas. Não é necessário treinar um modelo nem consultar IA a cada compilação para que
essa memória produza valor.

## 15. Entrega e critérios de conclusão

| Corte | Entrega e aceite |
|---|---|
| UI-TD-1 | Adapter direto, compilador/templates, contrato declarativo e guard; saída reproduzível sem IA |
| UI-TD-2 | Lotes, candidato persistido, Registry e Console; versões e limitações por perfil, sem afirmar execução |
| UI-EXEC-1 | Primeiro runner já pareado: replay seguido de live, contextos independentes, Results e comparação O/R/L |
| UI-EVOL-1 | Diagnóstico opcional pós-falha, proposta versionada e verificação |
| UI-CAT-1 | Descoberta agregada e organização posterior, sem bloquear os cortes anteriores |
| UI-VIS-1 | Aprimorar comparadores/baselines visuais; geometria qualificada já pertence ao primeiro executor |

A primeira entrega demonstra compilação sem provedor disponível, determinismo dos hashes,
rastreabilidade dos checks, versões no Registry e lote recuperável. Não exige N cenários
artificiais por observação; os dados de ensaio podem conter várias fontes para comprovar lote.

A entrega de execução demonstra os dois perfis, inclusive falha em R sem cancelamento indevido
de L, diferença legítima de dado live, regressão controlada, fixture ausente e comparação
incompleta. Também comprova que zero checks alcançados não produz PASS e que o replay não faz
fallback de negócio para rede real.

Os ensaios específicos estão na [matriz de aceite](ui-test-design-acceptance.md). O
[relatório desta entrega](ui-test-design-release-td1-td2.md) identifica a parte implementada
e verificada. Critérios de Runner, Results, Evolution e catálogo permanecem pendentes.
A configuração atual da captura não comprova que todos os casos estejam disponíveis nela;
dados de ensaio são identificados separadamente.

## 16. Fontes e precedência desta decisão

Código local usado: Plugin `src/background/ui/pageCopy/pageSensor.ts`,
`pageJourneyRecorder.ts` e contratos UI; qagent-ui `src/services/pageEvidence.ts`,
`pageFixtures.ts`, `buildService.ts`, `src/storage/repository.ts`, `src/protocol.ts`,
`src/contracts/pageArtifactInspection.ts` e `pageObservedEvidence.ts`.
No Gateway: `src/intelligence/testDesignPersistence.js`,
`src/handlers/internalTestDesignGeneration.js` e clientes de Orchestrator/Registry/Evolution.
As revisões completas dos serviços compartilhados precisam ser conferidas antes de editar
suas integrações; esta auditoria não confirma todos os deployments remotos.

Histórico:
[handoff 08.2](https://chatgpt.com/library?file_id=libfile_63ff9c4bd0048191ae3efe3887d4ccc7&account_id=personal),
[arquitetura observada UI](https://chatgpt.com/library?file_id=libfile_03be3c78735881918626dc91cbb922f6&account_id=personal),
[Orchestrator 07.8-B](https://chatgpt.com/library?file_id=libfile_14982e50b44c81919bea7a4b3533429e&account_id=personal)
e [auditoria 07.8-A](https://chatgpt.com/library?file_id=libfile_c814a14f204881918969f463bad30998&account_id=personal).

Referências técnicas:
[Playwright Mock APIs](https://playwright.dev/docs/mock),
[Network](https://playwright.dev/docs/network),
[Best Practices](https://playwright.dev/docs/best-practices),
[Visual comparisons](https://playwright.dev/docs/test-snapshots),
[Trace viewer](https://playwright.dev/docs/trace-viewer),
[Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
e [batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/).

Esta decisão de compilação determinística, execução pareada e IA pós-falha prevalece sobre
trechos históricos que exigiam enriquecimento por LLM na geração normal ou adiavam UI_LIVE.
Os nomes dos operadores, estados e contratos novos permanecem propostas até sua implementação.
