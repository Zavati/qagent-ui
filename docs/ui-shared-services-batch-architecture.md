# ADR — Testes UI orientados à observação e execução em pares

**Data:** 2026-11-21  
**Decisão:** ADOTADA.  
**Runtime:** UI-TD-1 + UI-TD-2 implementados localmente; demais cortes pendentes. O
[relatório da entrega](ui-test-design-release-td1-td2.md) delimita código e ensaios realizados.
Este documento especifica a arquitetura completa e não comprova contratos implantados
em produção. Complementa o [plano de entrega de valor](ui-test-design-value-plan.md) e a
[matriz de aceite](ui-test-design-acceptance.md).

## 1. Decisão de produto

**O Test Design UI será compilado deterministicamente a partir das evidências observadas e de regras versionadas.** Cada cenário prevê duas execuções relacionadas: primeiro `UI_REPLAY`, com respostas observadas, depois `UI_LIVE`, com as APIs atuais. A IA fica fora da compilação e da decisão determinística de resultado; seu uso principal será analisar falhas no Evolution e propor mudanças rastreáveis.

A primeira entrega continua sendo Test Design em lote diretamente dos bundles existentes: uma solicitação admite uma observação ou conjunto delimitado e produz os cenários sustentados por essas evidências no Registry. Uma jornada pode permanecer um cenário com muitas verificações; não há quantidade mínima artificial por observação. Escolher a fonte não exige escolher cada teste. Browser Runner e os pares de execução vêm no corte seguinte. A especificação já define os dois modos, sem apresentar compilação como execução.

O UI Catalog permanece aprovado para evolução posterior, sem bloquear essa trilha. Catalog API é enriquecimento opcional mediante vínculo demonstrável. A compilação UI não depende de endpoint correspondente, projeção de catálogo, provedor de IA, credencial BYOAI ou orçamento de tokens. A configuração de IA existente para testes API permanece preservada.

## 2. Responsabilidades compartilhadas

| Componente | Responsabilidade |
|---|---|
| Observation | Eventos e artefatos originais, ingestão, integridade e exportação. |
| qagent-ui | Bundles persistidos, adapter de evidências, compilador determinístico, regras/templates UI, qualificação e domínio do plano de execução. |
| Gateway | Autorização, escopo, rotas e caso de uso de compilação UI; encaminha ao domínio apropriado. Mantém AI Engine/BYOAI para os usos existentes e para análise no Evolution. |
| Generation Orchestrator | Jobs de compilação em lote, fontes fixadas, itens, progresso, orçamento operacional e recuperação. Mantém identidade própria por domínio. |
| Test Registry | Identidade dos testes e versões imutáveis de especificações e referências de baseline; publicação idempotente. |
| Controle de execução | Materializar suites e pares, admitir cada modo, agendar tentativas e reconciliar resultados. |
| Browser Runner | Executar ações e verificações permitidas, aplicar o modo de rede e coletar fatos; runtime separado de REST. |
| Results | Resultados por modo/tentativa/checkpoint, comparações, cobertura efetiva e referências de evidência. |
| Evolution | Classificar falhas, apoiar análise por IA quando necessário, propor alterações e verificar versões derivadas. |
| Console | Solicitar lotes, apresentar designs, pares, diferenças, bloqueios e propostas. |
| UI Catalog, posterior | Descoberta agregada, projeções e relações entre observações, inicialmente no qagent-ui. |

A UI recebe contratos próprios. O Registry não exige endpoint fictício; o validador REST conserva seu domínio. Jobs, testes, resultados e bytes de evidência continuam com seus respectivos donos. Filas e capacidade de browser podem ser independentes sem duplicar Registry, Evolution ou infraestrutura de IA.

## 3. Base existente e fronteira da leitura

`Repository.version(scope, id)` já consulta uma versão exata e recusa acesso revogado. `readEnvelope()` confere tamanho, hash do objeto, manifesto, identidade e acesso à origem. O envelope `qagent.ui-page-evidence.v2` contém ações, checkpoints, documentos, estados, recursos, interações, fixtures e qualificação. Esses elementos sustentam o adapter; o envelope atual conserva `assertions: []`, e a compilação descrita aqui ainda não existe.

As rotas atuais são de operador. A integração de produto exige leitura interna autenticada e vinculada a organização/projeto/ambiente, sem expor a credencial de operador ao Console. O adapter valida contratos suportados e carrega somente artefatos necessários, com referências e limites explícitos.

O `journeyId` atual é por captura. O builder v5 não propaga a proveniência de segmentos ao envelope. Cenários contidos em um segmento podem declarar esse escopo; composições precisam resolver `logicalJourneyId`, índice e predecessor pela fonte imutável, conservando lacunas. Não unir por URL/horário ou editar manifests existentes.

A lista atual ordena por ID derivado de hash, não por recência. Ela não comprova inventário completo durante publicações concorrentes. O MVP fixa as fontes admitidas e declara sua abrangência, sem alegar cobertura de todo o projeto. Clientes/contratos locais foram auditados; os repositórios completos e deployments dos serviços compartilhados ainda precisam de conferência antes das alterações funcionais.

## 4. Compilador e modelo reutilizável

O modelo é comum entre aplicações, e os dados concretos vêm de cada observação. O pipeline é:

1. Validar bundles e extrair ações, estados, interações, fixtures e limitações.
2. Delimitar cenários por regras explícitas de sequência, checkpoints e preparação, preservando dependências.
3. Aplicar templates de operações e verificações compatíveis com a evidência disponível.
4. Produzir especificação estruturada, política de comparação e prontidão separada por modo.
5. Validar o contrato, salvar a saída compilada e publicar/reutilizar sua versão no Registry.

Templates descrevem como verificar presença, propriedades capturadas, valores, estados de controles, navegação, consumo de requests, geometria ou imagem. Cada assertion registra operador, alvo, expected/referência, checkpoint, origem e condição de aplicabilidade. Um clique não vira automaticamente uma regra de negócio; associação temporal não vira causalidade.

Perfis de capacidade delimitam o que é suportado: tipos de ação, locators, frames, componentes, recursos de rede e modalidades de comparação. O mesmo motor atende aplicações dentro desses perfis; canvas, interfaces inacessíveis ou comportamentos não capturados podem exigir adapters. Não há promessa de validar todas as aplicações ou todas as regras a partir de uma observação.

A divisão de jornadas conserva preparação e dependências. Um checkpoint intermediário não restaura por si só uma sessão. Limites de bytes/quantidade de evidências não autorizam omitir dependências silenciosamente. O compilador pode registrar cenário com execução bloqueada quando seu desenho é definível, preservando a limitação e a cobertura declarada.

## 5. Determinismo, identidades e lotes

Mesmas evidências, regras, templates, bindings e perfil versionados produzem o mesmo conteúdo canônico e hash. Referências imutáveis de origem fazem parte dessa identidade. Timestamps de criação/processamento, `jobId`, `runId`, IDs aleatórios de invocação e contadores de tentativa ficam no envelope operacional, fora do conteúdo usado para detectar equivalência do design.

A chave da operação identifica a invocação; o fingerprint identifica os insumos; o hash identifica a especificação compilada. Nova invocação com conteúdo equivalente não exige nova versão semântica. Mudanças nas evidências ou regras produzem uma versão identificável, preservando a anterior. IDs de cenários/saídas seguem regra estável, sem colisões entre variantes legítimas.

O job persiste seu conjunto delimitado de fontes, versões, hashes, perfil e política antes de compilar. Não exige um snapshot global do UI Catalog. Cada item pode produzir vários cenários ou uma ausência justificada; contagens de fontes, itens, cenários e versões ficam separadas. Novos bundles não entram silenciosamente no trabalho já admitido.

A saída validada é checkpoint operacional antes do append. Retry de persistência reutiliza os mesmos bytes/chaves; confirmação perdida é reconciliada. Publicação parcial retoma as saídas restantes. A compilação não faz chamadas ao modelo e não gera custo de inferência; continua tendo custo operacional de leitura, CPU e armazenamento. Eventual IA no Evolution possui orçamento separado.

## 6. Duas execuções, três referências

O plano conserva **O: observação original**, **R: replay com mocks observados** e **L: execução live**. As comparações são O↔R, O↔L e R↔L. R não substitui automaticamente a referência O; dois runs podem repetir a mesma regressão.

Cada par fixa versão do design, bundles, política de assertions, build alvo, perfil de browser e preparação. R e L usam o mesmo build alvo identificado e perfis comparáveis, com contextos separados. A ordem padrão é R e depois L; os dois estados permanecem visíveis, incluindo bloqueio, erro ou cancelamento.

A prontidão é avaliada por modo e modalidade. Falha de assertion em R não cancela L automaticamente. Fixture 304 sem corpo pode bloquear R, enquanto L ainda pode executar se suas próprias dependências estiverem disponíveis. Nesse caso, a comparação entre modos é parcial. A pendência `QAGENT-UI-CACHE-001` permanece adiada; não inventar corpo nem usar chamada real como fallback de replay.

Mockar responses não restaura sozinho build, sessão, storage, dados iniciais, relógio ou renderização. O código atual usa `EXECUTE_TARGET_BUILD`, `observedCssJsAreFixtures=false` e `archiveExecutionAllowed=false`: shell/assets vêm da aplicação alvo. `SOURCE_BUILD_UNKNOWN` limita a comparação histórica; fixar o build de R/L não recupera retroativamente o build de O.

## 7. Rede, preparação e repetibilidade

Em R, instalar o roteamento antes das ações e responder APIs de negócio com fixtures selecionadas. Preservar método, serviço/origem, path, query, corpo, headers relevantes, contexto e ocorrência, conforme política versionada. Correspondência só por URL é insuficiente. Consumo é finito; request desconhecido ou fixture esgotada produz diagnóstico, sem fallback live.

Em L, executar as ações da aplicação e observar suas chamadas reais, sem mocks de negócio nem reescrita de responses para aproximá-las da observação. Não reenviar cegamente os HTTP gravados. Registrar request/response atual, origem, status e relação com o passo. Cache e Service Workers seguem perfil explícito; ausência de mocks não comprova, sozinha, que todo dado veio agora da rede.

R e L começam em contextos limpos independentes, com preparação declarada. Sessão, entrada, dados, locale, timezone, viewport, relógio e demais controles relevantes ficam identificados. Não transferir estado final de R para L. Tempos de espera usam condições observáveis e limites, sem reproduzir todos os intervalos gravados como se fossem requisitos.

Dados observados podem conter IDs expirados ou entidades já alteradas. Bindings explícitos podem obter valores atuais, com origem rastreável; o motor não adivinha substitutos. Para fluxos mutantes, definir dados de ensaio, namespace/preparação e restauração quando necessária. Retry após resultado desconhecido pode exigir reconciliar o efeito ou preparar novo estado; idempotência do job não garante que um servidor recebeu apenas uma chamada.

## 8. Verificações e diferenças de dados

| Classe | Regra |
|---|---|
| Valor observado fixo | Comparar com o valor/ref de O, especialmente sob mocks; normalizações são declaradas e versionadas. |
| Estrutura e comportamento | Verificar propriedades disponíveis e ações/transições nos checkpoints correspondentes, conforme perfil. |
| Relação com dado atual | Em L, verificar UI contra response atual somente quando existir binding explícito e demonstrável. |
| Diferença histórica | Registrar alterações O↔R, O↔L e R↔L sem concluir automaticamente que toda diferença é defeito. |

Exemplo: O/R apresentam Ana; a API live retorna Beatriz e a UI mostra Beatriz. Há diferença histórica e, com binding definido, consistência da renderização atual. Se a API retorna Beatriz e a UI mostra Ana, o binding diverge. Uma coincidência isolada de texto não comprova a ligação JSON→DOM; registrar essa incerteza quando faltar evidência.

Regras fixas ou dinâmicas pertencem ao perfil/versionamento. Não mascarar campos, remover assertions ou substituir expected por actual para absorver mudança. O resultado separa divergência observada, violação de regra e limitação de comparação. Essa caracterização não transforma todo comportamento capturado em regra de negócio correta.

Presença, estado de campos, geometria e pixels são modalidades distintas. **UI-EXEC-1 já inclui validações estruturais e de layout quando comparáveis**, além das demais verificações suportadas. Comparação visual usa baseline/perfil compatíveis e tolerâncias prévias. Diferenças de SO/fontes/browser/viewport ou screenshot instável limitam essa modalidade, sem invalidar automaticamente checks funcionais independentes.

## 9. Results e diagnóstico do par

| R | L | Leitura inicial, sujeita às evidências |
|---|---|---|
| Passa | Passa | Regras avaliadas satisfeitas; diferenças de dados ainda podem existir. |
| Passa | Falha | Investigar integração atual, dados, serviços, sessão ou contrato. |
| Falha | Passa | Investigar replay, fixtures, referência, preparação ou mudança reconhecida. |
| Falha | Falha | Investigar falha comum de UI, referência, preparação ou ambiente. |
| Bloqueado/erro | Qualquer estado | Conservar resultado individual e declarar comparação parcial. |

A matriz não determina causalidade automaticamente. Registrar expected/actual, operador, modo, tentativa, checkpoint, request/fixture consumida e referências de trace/screenshot/diff. Conservar assertions planejadas, avaliadas, não alcançadas e não comparáveis. Não emitir PASS global se checks obrigatórios ficaram sem execução.

Um retry não apaga a tentativa anterior. O agregado distingue conclusão operacional, resultado funcional, cobertura e comparação. UI_REPLAY não comprova saúde atual do backend; UI_LIVE comprova as interações exercitadas, sem promover automaticamente toda API ou atualizar seu Catalog/baseline. Resultados e classificações mantêm essa proveniência.

## 10. Operação e Evolution

Jobs continuam assíncronos e recuperáveis, sem depender da aba do Console. Filas podem reentregar mensagens: usar claim/lease, fencing, commits idempotentes e estado durável antes do ack. Retry é limitado e classificado; republicação não zera tentativas. Um item falho não desfaz itens concluídos. Cancelamento interrompe novas admissões e conserva versões/resultados confirmados. Quotas de CPU, armazenamento, tempo e browsers preservam a capacidade API.

A compilação e os comparadores não precisam de IA. Após falhas, classificação determinística básica identifica fixture ausente, request inesperado, assertion divergente, indisponibilidade e erro de infraestrutura. O Evolution pode usar o AI Engine existente para explicar hipóteses, correlacionar O/R/L, agrupar falhas recorrentes e propor alterações. Contexto, orçamento e tentativas dessa análise são limitados; indisponibilidade da IA não impede compilar, executar ou registrar fatos.

Propostas incluem evidência, mudança exata, impacto e versão de origem. A política do projeto determina quais classes podem ser aplicadas automaticamente; o Registry publica nova versão e uma execução vinculada verifica a mudança. IA não altera retrospectivamente PASS/FAIL nem troca expected pelo actual como resposta automática à falha. A autorização do projeto permite trabalhar em lotes sem confirmação por cenário.

## 11. Ordem de entrega e catálogo posterior

| Corte | Entrega |
|---|---|
| UI-TD-1 | Adapter direto, compilador/template versionados, contrato UI, checks rastreáveis e prontidão por modo; nenhuma dependência de LLM. |
| UI-TD-2 | Compilação em lote, checkpoint, Registry e Console. Primeiro valor: designs versionados sobre fontes existentes, sem divisão artificial de jornadas. |
| UI-EXEC-1 | Browser Runner em lote com pares R/L, Results, comparações O/R/L e validação estrutural/layout quando comparável; regressão deliberada detectada. |
| UI-EVOL-1 | Análise posterior de falhas, IA opcional, proposta, nova versão e verificação. |
| UI-EXEC-2 | Seleção por impacto, otimização de custo e diagnóstico ampliado. |
| UI-CAT-1 | Posteriormente: descoberta agregada, projeções, busca e relações entre observações. |

UI Catalog terá domínio próprio, inicialmente no qagent-ui. Ele poderá ampliar a seleção de fontes sem mudar o contrato do compilador. Indexação histórica, watermark global e reconciliação de projeções permanecem fora do primeiro corte. A projeção guarda referências; não duplica bytes, testes ou resultados. Sua falha não desfaz bundles já confirmados.

Aceites essenciais: recompilar mesmas fontes/regras produz conteúdo/hash iguais; mudar uma regra cria versão rastreável; ausência de credencial IA não bloqueia compilação; lote processa o conjunto de cenários admitidos; retries não duplicam versões; cada cenário prevê dois estados de execução; replay sem fixture não usa rede real; live não recebe mocks; diferença de dados não é escondida nem automaticamente classificada como defeito; baseline original permanece preservada. Os ensaios detalhados continuam A IMPLEMENTAR / NÃO EXECUTADO na matriz.

## 12. Evidências e referências

Fontes locais auditadas: `qagent-ui/src/storage/repository.ts`, `src/services/buildService.ts`, `src/services/pageEvidence.ts`, `src/services/pageFixtures.ts`, `src/protocol.ts`, `src/index.ts`; Gateway `src/services/testGenerationOrchestratorClient.js`, `src/handlers/internalTestDesignGeneration.js` e `src/intelligence/testDesignPersistence.js`. Seus contratos atuais de geração API não representam o compilador UI proposto.

A separação das ingestões foi conferida no Plugin `src/background/observation/monitoringLifecycle.ts` e no Observation `src/contracts/catalogUpdate.ts`, `src/normalization/processor.ts` e `src/ui/ingestionService.ts`. Um coletor API paralelo pode observar a mesma requisição sem comprovar identidade comum de ocorrência com UI. Catalog API continua opcional.

Referências primárias: [Playwright — Mock APIs](https://playwright.dev/docs/mock), [Network](https://playwright.dev/docs/network), [Isolation](https://playwright.dev/docs/browser-contexts), [Visual comparisons](https://playwright.dev/docs/test-snapshots), [Clock](https://playwright.dev/docs/clock); [Cloudflare Queues — Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) e [Batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/). Esses mecanismos não implementam, por si, os contratos e critérios de domínio deste ADR.
