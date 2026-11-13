# qagent-ui 0.1.4 — versioned retry / builder v2

- `BUILDER_VERSION` passa de `qagent_ui_bundle_builder_v1` para `qagent_ui_bundle_builder_v2`.
- A identidade determinística inclui builder version, portanto a mesma captura/perfil recebe um novo `buildId` e `bundleVersionId` sem alterar o build v1 `FAILED`.
- Mensagens v1 atrasadas continuam autenticáveis, mas são encerradas como `UI_BUNDLE_BUILD_SUPERSEDED`; não são montadas com semântica v2 e não entram em retry infinito.
- Sem migration no `UI_DB` e sem alterações de binding, queue, R2, secret ou rota.
