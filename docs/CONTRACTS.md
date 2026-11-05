# APIs internas e estados — 08.2-A.3

## qagent-ui

`GET /health`: service, version, stage. Não prova conexão a todos os recursos.
`POST /internal/ui/v1/capabilities`: HMAC source. Confere schema D1 e acesso ao bucket.
Retorna sourceVersion, buildRequestVersion, assemblyVersion, builderVersion, ready e executionSupported:false.

Todos os endpoints abaixo usam HMAC **operator**, content-type JSON, timestamp atual, body assinado.
A CLI pronta implementa a assinatura; não cole o secret em curl/URLs.

| Sufixo `/internal/ui/v1/` | Entrada |
|---|---|
| build | scope, captureId, profile opcional; recibo202 só após publicação durável |
| build-status | scope, buildId |
| list | scope, captureId opcional, cursor opcional, limit1–50 |
| read | scope, bundleVersionId |
| artifact | scope, bundleVersionId, artifactId referenciado no manifesto selado |
| inspect | scope, bundleVersionId; revalida bytes e registra auditoria |
| revoke | scope, bundleVersionId; acesso REVOKED, sem apagar artefatos |

`scope` é `{organizationId,projectId,environmentId}`. A origem base é HTTPS sem path/query.
`read` retorna o envelope de montagem, incluindo `journey`, `bundle`, `qualification` e `manifestHash`.
`DIAGNOSTIC` tem journey/bundle nulos e evidência original em diagnostic; não se passa por pacote fechado.

Profile padrão:
```json
{"contractVersion":"qagent.ui-assembly-profile.v1","revision":1,"bootstrap":{"mode":"UNAVAILABLE","authProfileRef":null}}
```

`NONE` só deve ser declarado quando não há bootstrap autenticado necessário; `CONTROLLED_SESSION`
requer authProfileRef. Este serviço não consulta o Gateway para certificar essa referência, não
busca credenciais e não autentica no site. Isso é declaração de configuração, não evidência de login.

## Observation

Rotas novas somente HMAC source: `POST /internal/ui-bundles/v1/resolve|snapshot|artifact|pin|ack|status`.
Não usam, renovam nem alteram grants `qug_v1`/`qus_v1`. Os endpoints antigos ficam preservados.
`resolve` aceita scope+captureId; os demais usam sourceRef. Artifact/pin/ack têm campos específicos.
O protocolo em `src/ui/bundles/protocol.ts` é igual ao do novo serviço, exceto imports relativos.

## Reprocessamento

Mesma fonte + mesmo perfil + mesma versão do builder -> mesma identidade. Nova revisão do perfil
cria outra versão. Não se altera um pacote já fechado. Capturas antigas reconciliadas podem ser
montadas; capturas ACTIVE/PROCESSING são recusadas até haver reconciliação persistida.

Os relógios de criação não vencem o bundle. O acesso pode ser revogado e as dependências podem
ser explicitamente removidas fora do serviço; `inspect` e leitura não ocultam essas condições.
