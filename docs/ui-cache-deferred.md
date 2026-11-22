# QAGENT-UI-CACHE-001 — recuperação de representações HTTP adiada

## Decisão

**Status: ADIADO — pendente de implantação futura.**

Em **21/11/2026**, Igor decidiu priorizar a entrega de Test Design UI, execução de
testes UI e evolução contínua. A recuperação dos casos restantes de cache deixa de
ser uma condição global para avançar nessas entregas.

Este documento registra a decisão, as evidências e os critérios para retomar o
trabalho. Os comentários `TODO(QAGENT-UI-CACHE-001)` apenas apontam para esta
pendência: **esta entrega de documentação não implementa recuperação de cache,
Test Design, readiness por cenário ou execução de testes**.

O comportamento atual de captura e qualificação permanece válido. Fixtures sem
representação comprovada continuam indisponíveis e mantêm seus motivos.

## Evidência que motivou a decisão

Fonte: resultados das consultas D1 fornecidos por Igor e log do plugin da mesma
captura, analisados em 21/11/2026.

| Campo | Valor confirmado |
| --- | --- |
| Captura | `uic_d314dfa9-986e-4532-ac30-202f2cf72640` |
| Plugin de referência | `2.0.26` |
| Builder concluído | `qagent_ui_bundle_builder_v5` |
| Build | `uib_893e2d5a19cbbc420ec3a0fb94cb1d235a06f5fca0efe825d6bc319fb4c8b27b` |
| Bundle | `urbv_893e2d5a19cbbc420ec3a0fb94cb1d235a06f5fca0efe825d6bc319fb4c8b27b` |
| Fonte preservada, SHA-256 | `7451d67ec14b8b384d550685299acb62ac27fb43eae9ed59f8bd03786189a711` |
| Observation / tentativa ativa | `DELIVERED` / `DELIVERED` |
| Build / manifesto / integridade | `COMPLETE` / `SEALED` / `READY` |
| Artefatos referenciados / verificados / pins | `345` / `345` / `345` |
| Interações `BUSINESS_API` | `49` |
| Fixtures utilizáveis | `42`: 41 GET/XHR e 1 PUT/XHR, HTTP 200, corpo `COMPLETE` de origem `NETWORK`, sem issues |
| Fixtures indisponíveis | `7`: GET/XHR, `networkStatus=304`, `replayStatus=304`, `bodyState=MISSING`, `bodySource=UNAVAILABLE` |
| Motivo nas sete interações | `UI_CACHE_BODY_UNAVAILABLE` |
| Execução de UI | Não executada; `uiTestPassed=false` |

Os 345 artefatos verificados comprovam a integridade das referências existentes.
Isso não comprova que toda resposta necessária foi capturada: um corpo ausente
pode não possuir artefato correspondente.

## O que sabemos e o que permanece em aberto

A causa imediata das sete indisponibilidades é conhecida: foram observadas
respostas 304 sem uma representação recuperada e comprovada para servir como
fixture. Uma resposta HTTP 304 não contém o corpo da representação; seu uso depende
da representação anteriormente armazenada pelo cliente.

O log da captura registra `cacheMode=DISABLED` para `HTTP_BROWSER_CACHE`, seguido
de `RESTORED` no encerramento. O código aguarda `Network.setCacheDisabled(true)`
na inicialização. **Não há evidência de que o comando tenha sido esquecido.** Isso
não demonstra, por si só, a origem de cada requisição condicional ou a cobertura
efetiva de todos os contextos de rede.

**A origem das sete revalidações não foi comprovada.** Os cabeçalhos condicionais
efetivamente enviados e recebidos ainda não foram examinados nesse diagnóstico.
Não atribuir os casos à aplicação, a Service Worker, a um intermediário ou a uma
falha de configuração sem evidência específica.

Na revisão do código foi identificado um risco de ordem: a representação de um
200 entra no cache após a publicação de sua interação, enquanto a resolução de um
304 ocorre durante a preparação, que pode executar em paralelo com uploads. Um
200 concluído na rede, mas ainda não publicado, pode não estar disponível para
essa resolução. **É uma hipótese fundamentada no código, sem reprodução confirmada
e sem comprovação de que tenha causado os sete casos desta captura.**

## Regra para avançar com Test Design UI

A disponibilidade de cache será avaliada pelas dependências de cada cenário na
implementação de Test Design e execução. Uma fixture indisponível ou uma
dependência cuja associação permaneça ambígua deve bloquear a execução dos
cenários afetados, com motivo explícito, e não impedir a geração de candidatos e
o trabalho sobre cenários independentes.

**42 fixtures utilizáveis não equivalem a 42 testes nem comprovam uma jornada
executável.** Uma das sete requisições indisponíveis pode participar do bootstrap
comum a vários cenários. A independência de um cenário precisa ser demonstrada,
incluindo sua preparação e suas dependências; proximidade temporal entre ação e
request não estabelece causalidade.

O Test Design deve conservar referências às evidências e às lacunas. Os estados
atuais `NEEDS_ATTENTION`, `PARTIAL` e `UNAVAILABLE` não serão alterados apenas para
permitir avanço do produto. A decisão de adiar cache não significa aprovar um teste
ou executar uma jornada parcialmente definida.

## Invariantes preservados

- Manter status de rede, origem do corpo, hashes, escopo, contexto e provas de
  cache existentes. Quando houver reutilização comprovada, preservar a distinção
  entre status de rede 304 e status de replay 200.
- Manter `UI_CACHE_BODY_UNAVAILABLE` e a classificação de fixture indisponível
  quando não houver representação comprovada.
- Não converter um 304 sem representação em 200 ou `EMPTY`, fabricar corpos ou
  substituir a observação original por uma chamada realizada posteriormente.
- Não introduzir fallback silencioso para a API real, nem reutilização ilimitada
  de uma fixture esgotada.
- Preservar capturas, fontes, bundles, Test Designs e resultados imutáveis.
  Melhorias futuras produzem novas versões, sem reescrever evidências históricas.
- Preservar a distinção entre integridade dos dados, prontidão para uso e
  aprovação de testes executados.

## Escopo futuro, quando retomado

1. Examinar cabeçalhos observados e contexto dos casos: validadores condicionais,
   ETag, Vary, identidade da representação, conclusão da fonte, mudanças de
   documento e invalidações.
2. Acrescentar diagnóstico interno que diferencie ausência de fonte, prova
   insuficiente, validador não suportado, contexto invalidado e fonte ainda não
   publicada, sem promover hipóteses a causas confirmadas.
3. Reproduzir o risco de preparo/publicação concorrentes antes de definir a
   correção de ordenação ou reconciliação de dependências.
4. Definir explicitamente os modos de captura com e sem cache, incluindo o
   tratamento de condicionais emitidas pela aplicação. Qualquer modificação das
   requisições deve constar da política da captura.
5. Avaliar separadamente o suporte a Service Worker, mudanças de documento e
   segmentos, preservando as provas e os limites de recursos.
6. Revalidar compatibilidade entre produtor, Observation, builder e consumidor de
   fixtures. Atualizar contratos e versões apenas se a mudança efetiva exigir.

## Testes previstos para a retomada

Estes testes são backlog, não validações executadas por esta entrega documental.

- 200 anterior seguido de 304 com prova compatível e representação íntegra.
- 304 sem fonte observada, com fonte posterior ou com corpo removido/corrompido.
- Upload/publicação do 200 bloqueados enquanto um 304 subsequente é preparado.
- ExtraInfo antes e depois dos eventos principais, ausente, duplicado ou ambíguo.
- Validadores fortes, fracos e divergentes; Vary e headers de contexto diferentes.
- Invalidação por mutação, mudança de documento/navegação, sessão ou segmento.
- Limites de memória, rajadas, encerramento e reconciliação sem perda ou espera
  indefinida.
- Configuração e restauração do modo de cache; contextos não cobertos devem ficar
  explícitos.
- Cenário independente continua elegível; cenário dependente fica bloqueado;
  bootstrap compartilhado indisponível bloqueia todos os cenários que dele dependem.
- Integridade e consumo de fixtures permanecem verificáveis, sem fallback real
  ou mudança silenciosa de expectativa.

## Critério de retomada e aceite

Retomar após a primeira entrega de valor do MVP UI — Test Design versionado,
execução de um fluxo funcional e resultados verificáveis — ou antes disso se uma
dependência de cache impedir o fluxo crítico escolhido para demonstrar essa entrega.

O trabalho será considerado concluído quando a causa dos casos tratados estiver
demonstrada, as regressões correspondentes passarem e uma nova observação confirmar
a política pretendida. Casos sem representação comprovada devem continuar
indisponíveis de forma diagnosticável. Não existe meta de zerar indisponibilidades
por relaxamento de contrato ou alteração artificial de status.

## Referências de implementação

Os caminhos abaixo são relativos à raiz da entrega com os projetos. Este documento
é mantido idêntico em `plugin-qagent-v2/docs` e `qagent-ui/docs`.

- `plugin-qagent-v2/src/background/ui/pageCopy/pageJourneyRecorder.ts`: configuração
  de cache, preparação de respostas, tentativa de reutilização e publicação.
- `plugin-qagent-v2/src/background/ui/pageCopy/pageRepresentationCache.ts`: critérios
  de prova, armazenamento, resolução e invalidação de representações.
- `plugin-qagent-v2/src/background/ui/uiWorkQueue.ts`: preparação concorrente e
  publicação ordenada de eventos.
- `qagent-ui/src/services/pageFixtures.ts`: classificação de fixtures e qualificação
  por uso, sem execução de testes.
- `qagent-ui/src/contracts/pageObservedEvidence.ts`: verificação das referências
  usadas como prova de cache.
- [RFC 9110, seção 15.4.5 — HTTP 304](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5).
- [Chrome DevTools Protocol — Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/).
