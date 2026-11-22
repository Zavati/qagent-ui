# UI-TD-1 — compilação determinística, qagent-ui 0.2.0

## Implementado

O serviço lê uma versão exata `qagent.ui-page-evidence.v2` via `Repository.version`, `readEnvelope`
e `SourceClient`. Confere escopo, acesso, manifesto, SHA-256/bytes de todos os artefatos admitidos,
contextos, documentos, referências e identidade das fixtures. Não regrava a observação e não
faz chamadas à aplicação observada, a provedores de IA ou a navegadores.

Cada bundle admitido gera **uma jornada declarativa** `qagent.ui-test-design.v1` com dois perfis,
`UI_REPLAY` e `UI_LIVE`. Passos e checkpoints mantêm ordem observada; a associação temporal não
é promovida a prova causal. Não há subdivisão artificial em cenários. A preparação do futuro
runner exige build alvo fixado e contexto novo por perfil.

O hash da specification cobre JSON canônico (`qagent.ui-canonical-json.v1`: chaves ordenadas,
arrays e query pairs preservados), fontes exatas, compiler/templates/adapter e perfil de
comparação. Timestamps operacionais e IDs de job não fazem parte do desenho. A saída não exige
chaves BYOAI. A fixture publicada em `fixtures/ui-test-design-compilation.v1.json` é um controle
sintético que representa o contrato observado; não é uma nova observação de cliente.

## Rotas internas e autenticação

Configurar `UI_TEST_DESIGN_SECRET` no qagent-ui e o mesmo segredo no chamador de Test Design.
Ele é independente de `UI_BUNDLE_SOURCE_SECRET` e `UI_BUNDLE_OPERATOR_SECRET`. O segredo não
vai ao Console. O protocolo é HMAC existente, principal `test-design`, método POST, path real,
timestamp com janela de 60 segundos e SHA-256 do corpo JSON. Rotas não são montadas no prefixo
público de operador. Usar Service Binding entre os serviços.

```bash
npx wrangler secret put UI_TEST_DESIGN_SECRET
```

- `POST /internal/ui/v1/test-design/compile`: `{scope,bundleVersionId,compilerVersion,profile?}`.
- `POST /internal/ui/v1/test-design/source`: `{scope,bundleVersionId,expectedManifestHash?}`;
  reconfirma fonte/acesso/hash sem recompilar, para publicação e leitura posteriores.
- `POST /internal/ui/v1/test-design/sources`: `{scope,captureId?,cursor?,limit?}`; máximo 50
  candidatos por página. Retorna `items`, `nextCursor`, `diagnostics` e metadados de paginação.

Compilação usa `compilerVersion: "qagent_ui_test_design_compiler_v1"`. O perfil pode ser omitido;
se fornecido precisa ser completo e versionado, sem campos extras:

```json
{
  "contractVersion": "qagent.ui-test-design-profile.v1",
  "revision": 1,
  "comparisonPolicyVersion": "qagent_ui_observed_comparison_v1",
  "layoutTolerancePx": 2,
  "maxChecks": 2000,
  "maxNodes": 25000,
  "maxArtifactBytes": 33554432
}
```

A resposta é `qagent.ui-test-design-compilation.v1`, com `COMPILED` ou `NO_DESIGN`, source,
specification/hash ou null, resumo e `executionPerformed:false`. Fonte inválida, revogada,
fora de escopo ou corrompida produz erro específico; não vira desenho aparentemente válido.
`NO_DESIGN` indica uma fonte lida mas sem checks UI elegíveis ou que excede orçamento explícito.
Nenhum desses estados significa PASS.

A descoberta lista apenas candidatos de evidência observada selada com integridade READY,
verifica acesso e omite fontes indisponíveis dos itens, mantendo diagnósticos por candidato.
Paginação é keyset lexical com teto fixado no cursor; não é uma fotografia transacional do
inventário. Novas versões inseridas antes do cursor exigem nova travessia. Cursor preserva
escopo/filtro e não transforma ausência de itens em prova de cobertura completa.

## Templates e políticas

Operadores implementados: ELEMENT_PRESENT, ATTRIBUTE_EQUALS, TEXT_EQUALS, FORM_VALUE_EQUALS,
CHECKED_EQUALS, BOUNDS_WITHIN_TOLERANCE, STYLE_EQUALS, URL_MATCHES, REQUEST_MATCHES e
FIXTURE_CONSUMPTION_MATCHES. Eles referenciam artefatos ou manifesto, hash/bytes e JSON Pointer.
Valores observados são dados; nenhuma operação executa JavaScript capturado.

Locators de checks usam `data-testid` ou `id` únicos no snapshot, ou caminho CSS estrutural
calculado por parent/ordem de siblings. O runner precisará confirmar unicidade novamente.
`nodeId` identifica somente a evidência; nunca é usado como seletor de uma sessão nova.
Texto é conteúdo direto dos text nodes capturados, com normalização declarada. Form state
conserva valores e checked; geometria conserva bounds, viewport/DPR/scroll e tolerância.

Todos os checks usam FIXED no replay e OBSERVED_DIFF no live. Essa versão registra diferenças
live, não inventa uma relação response→DOM nem afirma invariantes de negócio. `bindings: []` é
intencional. Políticas FIXED live e DATA_BINDING exigem uma futura versão explícita do contrato.

## Limites e prontidão

O compilador conserva integralmente ações, estados, fixtures, matching e dependências do
bundle. Tem limites de 1.024 referências de artefato, 200 checkpoints, 2.000 ações, 10.000
interações e até 64 MiB de bytes verificados por perfil (32 MiB default). O conjunto de checks
é limitado pelo perfil e por 256 KiB de orçamento de assertions, com cotas por checkpoint.
Se as dependências ocuparem mais espaço, uma seleção adicional distribui checks entre
checkpoints, registra cada exclusão por transporte e conserva a jornada/dependências inteiras.
Formulários/layout têm prioridade sobre checks genéricos de todo o DOM. Exclusões registram
fonte, causa e quantidade; contadores distinguem checks, ações, checkpoints, nós e capacidades.
O envelope de compilação completo é limitado a **768 KiB** para publicação nos serviços
compartilhados. Excesso integral resulta em `NO_DESIGN`; não se removem requests ou passos
silenciosamente para caber no transporte.

A prontidão é independente por perfil. Fixture indisponível bloqueia UI_REPLAY; UI_LIVE pode
continuar `REQUIRES_CONFIGURATION`. Fontes parcialmente qualificadas podem gerar desenhos
úteis, com cobertura limitada. Unsupported actions bloqueiam os perfis que as exigem. Build
alvo, bootstrap, render profile e transições não comprovadas precisam de preparação antes
de executar; `executionPerformed:false` permanece separado da qualidade da evidência.

Não foram implementados Browser Runner, catálogo UI, DATA_BINDING, execução de scripts
arquivados, inferência causal, recuperação ampliada de cache 304 ou comparador de screenshots.
Bounds/estilos são qualificados apenas por viewport/DPR/scroll; idioma, timezone, fontes e
esquema de cores históricos ausentes continuam limitações. `SOURCE_BUILD_UNKNOWN`,
`stateAfterId:null`, teclado/shadow/iframe não suportados e gaps não desaparecem.

## Verificação local

Gate local executado em Node 24.22.3: TypeScript/Workers types e **131 testes aprovados**
(66 bundles/unit, 9 PC.2, 31 PC.3, 7 diagnósticos e 18 UI-TD-1).
O ensaio de 26 checkpoints/13.130 nós gerou 262 checks em 217.907 bytes; o caso
de transporte carregado manteve dependências completas e 142 checks em 723.752 bytes.
As reduções de cobertura foram registradas explicitamente. Esses números são dos controles
de teste locais, não da captura real de cliente.

```bash
npm run test:td1
npm run check
```

A suíte UI-TD-1 usa fontes reais de produção compiladas para Node e SQLite/R2/Service Binding
em memória. Cobre geração dos dez operadores, determinismo, hash/bytes/contexto, integridade
sem mutação, 304 sem corpo, readiness por modo, fonte instável sem checks, ações não suportadas,
locators com IDs duplicados, orçamento por checkpoint, autenticação separada, escopo,
revogação, hash esperado e descoberta com diagnóstico de inacessibilidade. Não é smoke remoto
Cloudflare, execução de browser ou validação do sistema observado.

O plano integral permanece em [ui-test-design-value-plan.md](ui-test-design-value-plan.md).
