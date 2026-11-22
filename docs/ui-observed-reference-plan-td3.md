# UI-TD-3 — roteiro por referência à observação

## Resultado

`qagent-ui` 0.3.0 acrescenta `qagent_ui_test_design_compiler_v2`. Ele produz um
`qagent.ui-test-design.v2` compacto com a identidade exata do bundle e regras
versionadas para todos os dados observados. O compilador v1 continua disponível
para jobs existentes e para leitura de versões anteriores; seus bytes, hashes e
contratos não foram reescritos.

O design v2 não copia arrays de ações, checkpoints, fixtures, recursos ou
verificações. O tamanho da observação deixa de determinar o tamanho do design.
Não há `maxChecks`, `maxNodes` ou `maxArtifactBytes` agregado no perfil v2. Limites
de transporte da infraestrutura e limites locais de página/blob continuam
existindo: eles não são uma cota total de cobertura da jornada.

## Referências e regra de conclusão

O plano contém nove seleções completas:

| Seção | Referência no bundle |
| --- | --- |
| ACTIONS | `/journey/actions` |
| CHECKPOINTS | `/pageIndex/states` |
| INTERACTIONS | `/pageIndex/interactions` |
| FIXTURES | `/bundle/fixtures` |
| DOCUMENTS | `/pageIndex/documents` |
| RESOURCES | `/pageIndex/resources` |
| STATE_RESOURCES | `/pageIndex/stateResources` |
| ARTIFACTS | `/bundle/artifacts` |
| SOURCE_METADATA | Todos os valores fora das coleções acima, incluindo seus apontadores |

Campos novos do manifesto permanecem referenciados. A leitura de metadados
percorre valores e containers, incluindo objetos/arrays vazios. Nas coleções,
cada item referencia o objeto observado completo; o preview não substitui essa
referência. Os artefatos têm uma travessia adicional `ARTIFACT_CONTENT` que revela
todos os valores JSON ou conserva o blob opaco integral como pendência.

O contrato fixa `selection: ALL_OBSERVED`, `silentOmissionAllowed: false`,
`completion: ALL_SECTIONS_AND_ARTIFACT_CONTENT` e `pendingCannotPass: true`.
O futuro Runner deverá reconciliar todas as seções e seus conteúdos, registrar
resultado ou motivo pendente para cada unidade e não promover uma leitura
parcial ou pendências à condição de teste aprovado. A implementação desta etapa
publica o plano e suas referências; não implementa o Runner.

## Planejado não significa validado

`checksGenerated` e `validationUnitsExecuted` são zero nesta representação. O
contador `validationUnitsPlanned` conta unidades de evidência cobertas pelas
seleções, não assertions executadas nem o número final de campos de todos os
blobs. `validationUnitsPending` contabiliza pendências conhecidas no manifesto;
outras pendências podem ser descobertas ao abrir o conteúdo de um artefato.
Um artifact pode conter muitos valores, todos visitáveis por páginas.

Uma observação com checkpoint instável continua gerando um design. Seu
checkpoint e os conteúdos estruturais ligados a ele ficam pendentes. Mocks sem
resposta disponível continuam bloqueando o Replay; não se inventa resposta,
status ou cache. Uma página sem comparador, um campo desconhecido em uma
estrutura de UI e dados opacos conservam a referência integral e um motivo.

As regras definem o destino de validação (sequência de ações, campos de tela,
interações, consumo de fixtures, documentos, recursos, bytes e metadados). Elas
não implementam por si só a comparação em navegador. Campos/propriedades
declarados como `PLANNED` ainda dependem do Runner; `PENDING` exige também o
comparador/contexto indicado. Replay compara com os dados observados; Live
registra as diferenças da aplicação atual. Alterações de dados não são
automaticamente classificadas como defeitos de negócio.

## Integridade

A geração verifica o hash do manifesto, o escopo, o estado selado, a dimensão de
integridade e a concordância entre quantidade de referências e artefatos
verificados pelo builder. Ela não baixa novamente todos os blobs para emitir
um plano que só os referencia. Isso aparece no contrato como:

```json
{
  "manifest": "VERIFIED",
  "artifactBytes": "VERIFIED_AT_BUNDLE_ASSEMBLY",
  "artifactBytesRecheckedDuringCompilation": false
}
```

Toda leitura de conteúdo confere tamanho e SHA-256 do blob antes de paginar.
Cada página reconfirma escopo, hash do design, fonte, acesso e revogação. A
publicação e a leitura pelo Gateway conservam a revalidação da fonte existente.
`validationUnitsExecuted: 0` e `executionPerformed: false` permanecem explícitos.

## Consulta das páginas

Rota interna, protegida pelo segredo e protocolo HMAC de Test Design existentes:

```text
POST /internal/ui/v1/test-design/plan-page
```

Corpo: `scope`, `specification`, `specificationHash`, `section`; opcionais
`cursor`, `limit` (1–100, padrão 20), `artifactId` (obrigatório apenas para
`ARTIFACT_CONTENT`). O Gateway obtém a especificação e seu hash da versão salva
no Registry; o browser não fornece um plano arbitrário como autoridade.

A resposta inclui `items`, `totalItems`, `nextCursor`, `source` e
`specificationHash`. Cada item contém referência exata, regra, condição
`PLANNED`/`PENDING`, motivo e um `preview` limitado. Os previews são apenas de
apresentação, podem ser resumidos e nunca são o esperado autoritativo do teste.

Os cursores são assinados e vinculados ao escopo/fonte, hash da especificação,
seção e artefato. Índices são contíguos; o cursor final só é nulo quando a página
chega ao fim real da seção. Não há limite de quantidade total de páginas.

Para `ARTIFACT_CONTENT`, `sourceRef.pointer` aponta para o JSON interno do
artefato. Nas demais seções aponta para o manifesto; na seção `ARTIFACTS`, o
item também fornece identidade/hash/tamanho do blob a ser aberto. O futuro
Runner deverá resolver esperados pelos hashes e apontadores, usando as rotas
autorizadas de fonte/artefato existentes, e jamais executar scripts ou markup
capturados como código de teste.

O parser de conteúdo não tem a antiga cota global de nós. JSON com chaves
duplicadas, sintaxe inválida ou profundidade não suportada conserva o blob
como uma pendência explícita; não retorna uma projeção que perdeu chaves.
Bytes não JSON, screenshots, CSS, JS e HTML têm referência integral, com
comparação ainda pendente quando não há comparador implementado.

## Execução e compatibilidade

O perfil v2 é:

```json
{
  "contractVersion": "qagent.ui-test-design-profile.v2",
  "revision": 2,
  "comparisonPolicyVersion": "qagent_ui_observed_comparison_v1",
  "layoutTolerancePx": 2,
  "coveragePolicy": "ALL_OBSERVED"
}
```

Não há nova migration, segredo ou binding neste serviço. A origem continua
sendo um bundle selado existente; não é necessário repetir a observação para
gerar o design v2. A agregação de vários bundles/segmentos em uma única jornada
lógica continua fora deste contrato: o job recebe versões exatas de bundle.

Um deadline local limita cada chamada de geração/leitura a 105 segundos e a
leitura individual de artefato conserva o deadline de 15 segundos do fix
anterior. Cancelamento/deadline interrompe a admissão de novos estágios; uma
operação R2 que não ofereça cancelamento físico pode ainda terminar em segundo
plano, sem publicar o resultado tardio.

## Verificações

Os testes locais usam código de produção compilado e artefatos sintéticos:

- Fonte superior a 768 KiB publica design compacto sem perder os documentos.
- Paginação completa de ações e 6.602 valores JSON, incluindo valores longos.
- Evidência instável, dados desconhecidos e JSON com chaves duplicadas não
  desaparecem nem são marcados como validados.
- Cursores não podem mudar de escopo/contexto, seção, versão ou artefato.
- Corrupção, referência não autorizada, revogação e timeout impedem retorno
  bem-sucedido de evidência.
- Fontes sanitizadas e gerenciadas pelo ambiente, além de v1, continuam aceitas.

Esses testes não representam execução de UI real nem validação dos dados do
cliente no ambiente remoto.
