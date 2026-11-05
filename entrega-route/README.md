# QAgent UI 0.1.1 — correção do prefixo público

## Diagnóstico

Base inspecionada: `qagent-ui-0.1.0-08.2-A.3-COMPLETO.zip` entregue nesta conversa.
O roteador 0.1.0 reconhece `GET /health` e operações assinadas em `/internal/ui/v1/`.
O request informado por Igor é `GET /v1/qagent-ui/health`; esse caminho não era reconhecido.
A resposta `UI_BUNDLE_ROUTE_NOT_FOUND` é compatível com essa rejeição pelo roteador,
não um diagnóstico de falha de D1, R2 ou Queue.
A CLI antiga também exigia baseUrl sem caminho. Alterar só o health seria insuficiente.

## Escopo implementado

- Novo alias de health: `GET /v1/qagent-ui/health`.
- Aliases administrativos: `POST /v1/qagent-ui/{list,build,build-status,read,inspect,artifact,revoke}`.
- Os endpoints administrativos continuam exigindo HMAC de operador, prazo e escopo válidos.
- A assinatura usa o caminho ORIGINAL recebido. Não há rewrite do Request antes da autenticação.
- `/internal/ui/v1/*`, `/health`, Service Bindings, filas, cron, builder e contratos preservados.
- Capabilities de source continuam somente na rota interna já existente e com sua autenticação.
- CLI aceita baseUrl raiz para compatibilidade, ou o prefixo exato `/v1/qagent-ui`, com barra final opcional.
- O health continua sendo liveness estático: não comprova disponibilidade de banco/fila/dependências.
- Sem migrations, secrets, recursos, dependências ou alterações remotas novos.

## Aplicar sem perder a configuração do banco

O ZIP é o projeto completo. EXTRAIA EM PASTA SEPARADA do checkout publicado.
Não substitua seu `wrangler.toml` pelo template do ZIP (o template mantém UUID placeholder).
Dentro da pasta extraída `qagent-ui`, execute:

```bash
node tools/apply-route-prefix-fix.mjs --target "C:/git/qagent-ui"
```

Esperado: `READY_LOCAL_ONLY`. O instalador valida hashes da base 0.1.0, tolerando CRLF/LF.
Faça commit/backup local e, sem edições simultâneas, aplique:

```bash
node tools/apply-route-prefix-fix.mjs --target "C:/git/qagent-ui" --apply
```

Somente os seis caminhos em `entrega-route/FILES.json` são substituídos.
`wrangler.toml`, `.qagent-ui-ops.json`, `.dev.vars`, secrets, migrations, D1, bindings e demais arquivos
não são alterados. CONFLICT interrompe a atualização antes das escritas. ALREADY_APPLIED é idempotente.
Um backup dos arquivos substituídos fica em `.qagent-route-backups/<identidade>`.

Rollback local, a partir da mesma pasta extraída, usando o diretório EXATO retornado pelo apply:

```bash
node tools/apply-route-prefix-fix.mjs --target "C:/git/qagent-ui" --rollback "C:/git/qagent-ui/.qagent-route-backups/COLE_A_IDENTIDADE"
```

O rollback recusa sobrescrever alterações posteriores. Não modifica recursos remotos.

## Rota Cloudflare

No `wrangler.toml` DO CHECKOUT PUBLICADO, preserve todas as configurações e deixe somente
uma entrada do qagent-ui para este namespace (edite a entrada existente; não a duplique):

```toml
[[routes]]
pattern = "api.apiqagent.com/v1/qagent-ui/*"
zone_name = "apiqagent.com"
```

Não use `custom_domain = true` com esse padrão de Route. Não atribua o catch-all
`api.apiqagent.com/*` ao qagent-ui: preserve o Gateway e as rotas específicas dos outros serviços.
Se cadastrou uma rota ampla para qagent-ui por engano, restrinja apenas essa entrada.
Não modifique Service Bindings para usar o domínio público.

Documentação oficial consultada em 05/11/2026:
https://developers.cloudflare.com/workers/configuration/routing/routes/

## Publicar e testar

Em `C:/git/qagent-ui`, após a aplicação e a revisão da rota:

```bash
npm ci --include=dev && npm run check && npx wrangler deploy
```

Não prossiga se a instalação ou validação falhar. A configuração D1 deve manter o banco
já provisionado (no diagnóstico do usuário: `877d4b28-e145-4e1a-b6bb-c754c5c7eae7`).
Não execute migrations novamente para esta correção.

```bash
curl.exe --fail --show-error --max-time 15 "https://api.apiqagent.com/v1/qagent-ui/health"
```

Esperado:

```json
{"status":"ok","service":"qagent-ui","version":"0.1.1","stage":"08.2-A.3"}
```

Em `.qagent-ui-ops.json`, mantenha os IDs existentes e altere APENAS baseUrl:

```json
"baseUrl": "https://api.apiqagent.com/v1/qagent-ui"
```

Não acrescente `/health`, `/*` ou `/internal/ui/v1` ao baseUrl.

```bash
node tools/ui-ops.mjs health
```

Para listagem, use o MESMO secret de operador já cadastrado, nunca o SOURCE ou a clientKey:

```bash
read -rsp "UI operator secret: " QAGENT_UI_OPERATOR_SECRET; echo
export QAGENT_UI_OPERATOR_SECRET
node tools/ui-ops.mjs list --capture uic_c8f6b86b-afd8-46bb-a18e-741e63d72e44
unset QAGENT_UI_OPERATOR_SECRET
```

A URL resultante de list é `/v1/qagent-ui/list`; não precisa alterar nenhuma fila ou o Observation.

## Validação executada nesta rodada

Ambiente: Node 22.16.0, npm 10.9.2, TypeScript global 5.8.3.

| Controle | Resultado |
|---|---|
| `npm test` base 0.1.0 | 48/48 |
| `npm test` versão 0.1.1 | 60/60 (48 anteriores + 12 novos) |
| Integração com fonte Observation 0.1.7 | 10/10 |
| `tsc --noEmit` sobre fontes atualizados | passou |
| Instalador local | 8/8 controles |
| `npm run check` oficial | não concluído: `wrangler: not found` em `wrangler types` |
| Deploy real / domínio remoto | não executados por este assistente |

Os testes compilam os módulos de produção e usam SQLite real. Queue, R2, transporte HTTP e
Service Bindings são simulados. Os 12 novos testes cobrem health com prefixo, CLI, assinatura
do caminho completo, auth ausente, principal incorreto, isolamento de escopo, rotas vizinhas,
compatibilidade das rotas internas e operações administrativas (incluindo artefatos e revogação).
As escritas e revogações dos testes ocorreram apenas em fixtures sintéticas locais.

Não foi instalada nem atualizada nenhuma dependência. Package/lock mudam somente a versão
raiz 0.1.0 → 0.1.1. A versão do assembler e a identidade dos bundles existentes são preservadas.
Os logs dos testes estão no ZIP em `entrega-route/evidence/`.

O ZIP inteiro é uma referência de projeto, não uma leitura do checkout ou deployment remoto.
Use o instalador de hash para integrar o delta e preservar a infraestrutura configurada.
