# qagent-ui 0.1.3 — Cloudflare Request redirect fix

- Corrige `signedRequest()` de `redirect: "error"` para `redirect: "manual"`.
- Motivo: Cloudflare Workers não implementa `redirect: "error"`; o Request lança TypeError antes do Service Binding enviar a requisição.
- Mantém HMAC, rotas, Queue, D1, R2, retries e diagnóstico por estágio.
- `internalFetch()` já trata respostas não-2xx, portanto 3xx continuam fail-closed.

Validação: `npm test` 62/62; integração com Observation 0.1.9 10/10.
