# qagent-ui 0.4.0

Domínio UI do QAgent: montagem, qualificação e persistência de bundles e compilação determinística de Test Designs.
Não executa navegador e não aprova testes UI.

Observation continua dono dos dados de origem. Este serviço recebe referências pela fila,
consulta a fonte pelo Service Binding e guarda manifestos derivados no D1/R2 próprios.
Usuário/Plugin não precisa disparar uma montagem manual.

## UI-EXEC-1 — evidência para o executor

A versão 0.4.0 acrescenta um adapter interno que entrega o manifesto e os artefatos
completos para execuções admitidas pelo Gateway. O adapter valida escopo, versão,
hashes, autorização e revogação antes de liberar a evidência. A execução Chromium
fica no projeto separado `qagent-ui-runner`; os lotes, resultados e acesso do Console
ficam no Gateway. Os planos v2 já salvos continuam utilizáveis sem nova geração.

Configure `UI_EXECUTION_SECRET` com o mesmo valor no Gateway e neste serviço.
Mantenha as configurações anteriores de Test Design, Observation, filas e buckets.
Esta atualização não adiciona migração D1 ao qagent-ui.
Veja [contrato e implantação do adapter](docs/ui-execution-evidence.md).

As seções abaixo registram as etapas de construção da evidência e do Test Design.

## PAGE-COPY PC.2

Leitor sintético v2 aditivo e compatível com a origem paginada. Ver [contrato/limites](docs/page-copy-pc2.md).
Mantenha as rotas, IDs, filas e secrets do seu checkout. O Wrangler deste pacote é um template.

## PAGE-COPY observado PC.3

O consumidor aceita a origem observada v2 emitida por Observation, verifica novamente os bytes e
produz o recibo `qagent.ui-page-evidence.v2`: índice de documentos/estados/recursos e referências
determinísticas de fixtures de negócio. A qualificação separa integridade, disponibilidade para
mocks, referência estrutural/visual e limitações de execução. Ver [contrato e usos](docs/page-copy-observed.md).
O conteúdo capturado não é executado neste serviço. Montar o bundle não executa nem aprova testes.

O perfil r2 `ENVIRONMENT_MANAGED` usa exporter próprio e builder v5, preserva dados de teste sem
redação/máscara e registra essa responsabilidade na qualificação. Gateway admite esse perfil
somente para `FULL_TEST` em ambiente persistido `DEV`/`STG`. O ramo sanitizado r1 mantém builder v3
e os mesmos hashes; captura v1 e PC.2 continuam com suas identidades anteriores.

## UI-TD-1 implementado — 0.2.0

A recuperação do build v5 foi validada para a captura de referência. A entrega 0.2.0 permite
**compilar Test Designs UI deterministicamente a partir das observações**, usando regras,
templates e perfis versionados. A compilação e a execução normal não dependem de IA, provedor
ou credencial BYOAI. Registry, Evolution, Results, Gateway e Orchestrator serão reutilizados
com contratos UI; o Browser Runner terá runtime separado. O AI Engine existente permanece
disponível para API e para análise posterior de falhas no Evolution.

**A prioridade é Test Design UI em lote diretamente sobre os bundles já persistidos.** Um
adapter fornece evidências verificadas ao compilador, sem exigir antes um catálogo agregado.
O **UI Catalog próprio** permanece aprovado para evolução posterior, inicialmente módulo/projeção
neste serviço. O Catalog API é enriquecimento opcional quando houver vínculo comprovado.
O primeiro resultado de valor é o conjunto de cenários estruturados/versionados no Registry e
consultáveis no Console. Uma jornada pode gerar um cenário com muitas verificações; divisões
exigem preparação e dependências demonstráveis. A operação é em lote, sem seleção manual de
cada teste. Browser Runner e execução são o corte seguinte.

Cada cenário prevê duas execuções: `UI_REPLAY`, com mocks das respostas observadas, e
`UI_LIVE`, com as chamadas reais da aplicação. O par usa a mesma versão do design e build alvo,
em contextos independentes. Os resultados preservam a observação original (O), replay (R) e
live (L), com comparações O↔R, O↔L e R↔L. Diferença de dado não é automaticamente defeito;
checks de relação response→UI exigem bindings explícitos. Estrutura e posições entram no
primeiro executor onde a evidência e o perfil permitem comparação.
O roteiro detalhado e os critérios de saída estão em
[Test Design UI e entrega de valor](docs/ui-test-design-value-plan.md) e na
[matriz de aceite](docs/ui-test-design-acceptance.md).
A decisão sobre os serviços e os jobs está em
[serviços compartilhados e arquitetura em lote](docs/ui-shared-services-batch-architecture.md).

A recuperação dos sete casos HTTP 304 sem corpo foi adiada e está registrada como
[QAGENT-UI-CACHE-001](docs/ui-cache-deferred.md). Essa pendência não impede a compilação;
um replay que dependa dessa fixture fica bloqueado, sem fallback de negócio para a rede.
O modo live tem admissão independente; o resultado do par explicita comparação incompleta.
Este serviço implementa o compilador e as rotas internas UI-TD-1. A publicação no Registry e
a operação em lote são integrações UI-TD-2 nos serviços compartilhados. O Browser Runner
UI-EXEC-1 é separado; a compilação continua com executionPerformed=false.
Ver [contrato, configuração e testes UI-TD-1](docs/ui-test-design-td1.md).
Manifestos observados existentes não são regravados pelo compilador.

## Validação

```bash
npm ci --include=dev
npm test
npm run test:pc2
npm run test:pc3
npm run test:td1
npm run test:exec1
npm run check
npm run test:integration -- --observation ../qagent-observation
npm run test:pc2 -- --observation ../qagent-observation
```

Node 22.13+ para node:sqlite nos testes. Preserve o lockfile.
As suítes locais não substituem o smoke remoto/workerd.
`npm run deploy` mantém o check e a conferência da configuração antes de publicar.

## Estados

COMPLETE = operação terminada. SEALED = evidência íntegra segundo o montador.
READY/NEEDS_ATTENTION = qualificação de uso, separada de integridade. Nenhum significa teste aprovado.
PC.2 arquiva evidência sintética v2 sem declarar replay elegível. Builds v1 existentes permanecem legíveis.
PC.3 mantém o mesmo princípio: uma resposta HTTP 400 íntegra pode servir como fixture observada,
e falta de checkpoint/sourceBuild/bootstrap limita os respectivos usos sem apagar essa evidência.

## Histórico

Não foi feita limpeza destrutiva dos materiais históricos deste checkout nesta entrega funcional.
Documentação/instalador específicos da PC.2 ficam fora do produto.
