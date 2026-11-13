# qagent-ui 0.1.2 — diagnóstico por estágio

Escopo: observabilidade segura do consumer A.3, sem alterar contratos, retries, filas, D1, R2, secrets ou autenticação.

Novos campos nos logs:
- `build.stage_failed.stage`
- `build.retry.stage`

Estágios possíveis: `db.admit`, `db.version`, `manifest.read`, `source.ack`, `db.lease`, `source.snapshot`, `build.identity`, `source.pin`, `db.heartbeat`, `source.artifact`, `manifest.persist`, `db.commit`; erros fora desses pontos aparecem como `unknown`.

Nenhum body, URL completa, stack, mensagem bruta de exceção ou secret é incluído.

Validação local:
- `npm test`: 61/61 passed.
- integração com qagent-observation 0.1.8: 10/10 passed.
- controle novo comprova `source.snapshot` em falha de transporte sem vazar causa bruta/secret.

Comportamento esperado no remoto atual: após deploy, as mensagens já persistidas/republished serão consumidas novamente e o log deve mostrar o estágio exato, por exemplo:
`{"event":"build.retry","code":"UI_BUNDLE_SERVICE_UNAVAILABLE","stage":"source.snapshot",...}`.
