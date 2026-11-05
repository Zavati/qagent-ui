# QAgent 08.2-A.3 — instalação e validação

Entrega: **qagent-ui 0.1.0** (novo serviço) + **Observation 0.1.7** (integração aditiva).
**Plugin 2.0.20, Gateway 1.0.18 e licenças ficam como estão.**
Nenhum recurso remoto foi criado nesta entrega; os comandos abaixo serão executados por você.
O gate remoto A.3 — captura real → manifesto utilizável — continua pendente até o smoke.

## 1. Preparar as pastas sem sobrescrever a outra frente

Extraia o projeto `qagent-ui` em `C:/git/qagent-ui`.
Extraia o Observation atualizado em uma pasta temporária, separada do checkout atual.
Dentro da pasta extraída `qagent-observation`, execute:

```bash
python entrega-a3/check_update.py --target "C:/git/qagent-observation"
```

O esperado é `READY_LOCAL_ONLY`. Se houver CONFLICT, não force a cópia: reconcilie os paths listados.
O verificador aceita diferenças CRLF/LF em arquivos de texto, mas não ignora alterações de código.
Ele recusa outra migration0015 e bindings divergentes. Named environments `[env.*]` exigem merge manual.

Depois de backup/commit e sem edição simultânea:

```bash
python entrega-a3/check_update.py --target "C:/git/qagent-observation" --apply
```

O apply preserva configurações existentes do Wrangler e acrescenta somente as variáveis/bindings
A.3. **Não modifica UI_CAPTURE_ENABLED ou UI_ASYNC_INGESTION_ENABLED do seu checkout.**
Um backup verificável é criado em `.qagent-a3-backups`. O ZIP completo pode ser usado como referência,
mas não substitua cegamente arquivos que a outra conversa modificou.

## 2. Instalar dependências e validar

Use Node **22.13+** (ou24) e npm. O `node:sqlite` dos testes pode emitir ExperimentalWarning.
Os lockfiles preservam o toolchain da base recebida; não é necessário atualizar Wrangler/TypeScript.

No Observation:

```bash
cd /c/git/qagent-observation
npm ci --include=dev
npm run check
npm run test:ui-async
npm run test:ui-bundles
```

No qagent-ui:

```bash
cd /c/git/qagent-ui
npm ci --include=dev
npm run check
npm run test:integration -- --observation ../qagent-observation
```

**Não continue se um comando de teste/build falhar.** A validação local desta entrega usou tsc5.8.3
já disponível, módulos reais e SQLite real. Não certifica o build com as dependências do lockfile;
Wrangler/Vitest não puderam ser instalados aqui porque o registro npm não resolveu por DNS.

## 3. Criar somente os recursos NOVOS

Na pasta `qagent-ui`, confirme a conta:

```bash
npx wrangler whoami
npx wrangler queues list
npx wrangler d1 list
npx wrangler r2 bucket list
```

Se os nomes novos ainda não existirem:

```bash
npx wrangler queues create qagent-ui-bundle-build-dlq-dev --message-retention-period-secs 86400
npx wrangler queues create qagent-ui-bundle-build-dev --message-retention-period-secs 86400
npx wrangler d1 create qagent-ui-dev
npx wrangler r2 bucket create qagent-ui-bundles-dev
```

Não apague/recrie recursos existentes. Não reutilize o D1 `qagent-dev` do Gateway nem
`qagent-observation-dev` como UI_DB. O bucket novo é privado, sem r2.dev público ou domínio público.

As mensagens dessas filas têm retenção de24h; isso não é TTL da baseline. Uma fila pausada também
continua sujeita à retenção. Outbox e jobs persistidos permitem recuperação/republicação.
Configure acompanhamento de DLQ/idade das mensagens; não trate a DLQ como arquivo permanente.

## 4. Configurar o D1 novo e aplicar APENAS sua migration

Copie o UUID retornado por `wrangler d1 create qagent-ui-dev`:

```bash
node tools/configure.mjs --database-id COLE_AQUI_O_UUID_DO_NOVO_D1
node tools/configure.mjs --check
npx wrangler d1 migrations list UI_DB --remote
```

A única pendência esperada no NOVO banco:

```text
0001_ui_bundles.sql
```

Depois:

```bash
npx wrangler d1 migrations apply UI_DB --remote
```

**Este comando deve ser executado na pasta qagent-ui, apontando ao NOVO UI_DB.**
As tabelas de versão são imutáveis; acesso/revogação ficam em registros separados.

## 5. Publicar o consumidor qagent-ui primeiro

```bash
npm run check
npx wrangler deploy
```

Os consumers da fila principal e da DLQ são associados pelo wrangler.toml. Não precisa `consumer add`.
O Worker novo aponta ao Observation existente por Service Binding. Ainda não habilite a exportação
no Observation. O health pode funcionar antes dos secrets; isso não significa que a integração está pronta.

### Secrets novos, separados das credenciais do Plugin

Gere e guarde **dois valores aleatórios diferentes**, com pelo menos32 caracteres (recomendado32bytes/64hex).
Por exemplo, rode duas vezes localmente e guarde em gerenciador de senhas, sem enviar ao chat:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Na pasta `qagent-ui`, use os prompts do Wrangler:

```bash
npx wrangler secret put UI_BUNDLE_SOURCE_SECRET
npx wrangler secret put UI_BUNDLE_OPERATOR_SECRET
```

- SOURCE: será o **mesmo valor** no Observation e no qagent-ui, somente para comunicação interna.
- OPERATOR: valor **diferente**, somente no qagent-ui e na sessão local da CLI administrativa.
- Não colocar nenhum deles no Plugin, no `QAGENT_UI_CAPTURE_POLICY`, no JSON de Environment nem no Git.
- A CLI tem acesso administrativo aos escopos; não é uma credencial de usuário final.
- Rotação do SOURCE exige coordenar as mensagens assinadas pendentes; esta versão não implementa keyring.

## 6. Atualizar o Observation sem mudar a ingestão atual

Na pasta `qagent-observation`:

```bash
npx wrangler d1 migrations list OBSERVATION_DB --remote
```

A nova pendência esperada é somente:

```text
0015_ui_bundle_exports.sql
```

Se aparecer outra0015 ou outras migrations inesperadas, pare para reconciliar a base.
Não reaplique/edite/renumere0013/0014 já aplicadas. Faça backup/revisão operacional do banco antes da mudança.

```bash
npx wrangler d1 migrations apply OBSERVATION_DB --remote
node tools/configure-ui-bundles.mjs --disable
npm run check
npm run test:ui-async
npm run test:ui-bundles
npx wrangler deploy
npx wrangler secret put UI_BUNDLE_SOURCE_SECRET
```

Cole **o mesmo SOURCE secret** cadastrado no qagent-ui.
No deploy, confira o novo producer `qagent-ui-bundle-build-dev` e o service binding `UI_BUNDLE_SERVICE -> qagent-ui`.
As filas `qagent-ui-ingestion-dev`, suaDLQ e `qagent-normalization-dev` continuam como estavam.

Preserve estes valores que já funcionam:

```toml
UI_CAPTURE_ENABLED = "true"
UI_ASYNC_INGESTION_ENABLED = "true"
```

Agora habilite a nova saída:

```bash
node tools/configure-ui-bundles.mjs --enable
npx wrangler deploy
```

Se usa pipeline Git, versione também a alteração da flag; não deixe o próximo deploy publicar false novamente.

**Ao habilitar, capturas históricas assíncronas já reconciliadas também são descobertas.**
A descoberta é incremental (20 registros/tick, até3 publicações/tick), em todos os escopos da instância.
Capturas abertas, ainda PROCESSING, ou síncronas antigas sem reconciliação não são convertidas à força.

## 7. Confirmar os logs da integração

Em terminais separados:

```bash
npx wrangler tail qagent-observation --format pretty
```

```bash
npx wrangler tail qagent-ui --format pretty
```

Eventos importantes (prefixo estruturado `qagent_ui_bundle`):

| Evento | O que confirma |
|---|---|
| source.published | Observation publicou a referência da fonte na fila nova |
| bundle.persisted | qagent-ui verificou e persistiu o manifesto/qualificação |
| build.duplicate | Reentrega reconhecida, sem segunda versão da mesma operação |
| source.retry / build.retry | Falha registrada e recuperação; confira code |
| build.dead_letter | Tentativas esgotadas e disposição durável registrada |

Nenhum body/token de captura deve aparecer nesses logs.
`NEEDS_ATTENTION` de qualificação não é sinônimo de falha de fila. Cache304 sem body e build ausente
continuam sendo lacunas de evidência; não geramos conteúdo fictício para fazer o estado ficar verde.

## 8. Inspecionar um bundle real sem recapturar tudo

No qagent-ui:

```bash
cp ui-ops.example.json .qagent-ui-ops.json
```

Confira a URL exibida no deploy e os IDs do projeto/ambiente nesse arquivo. O exemplo contém os IDs
da última request compartilhada nesta conversa, mas não contém secret.

No Git Bash, carregue o **OPERATOR** secret sem colocá-lo no histórico do comando:

```bash
read -rsp "UI operator secret: " QAGENT_UI_OPERATOR_SECRET; echo
export QAGENT_UI_OPERATOR_SECRET
```

Confira health e liste bundles:

```bash
node tools/ui-ops.mjs health
node tools/ui-ops.mjs list
```

Para a captura real que teve processamento COMPLETE no log:

```bash
node tools/ui-ops.mjs list --capture uic_c8f6b86b-afd8-46bb-a18e-741e63d72e44
```

É possível solicitar explicitamente sua montagem (mesma revisão/perfil não duplica):

```bash
node tools/ui-ops.mjs build --capture uic_c8f6b86b-afd8-46bb-a18e-741e63d72e44
```

Use o buildId devolvido para consultar:

```bash
node tools/ui-ops.mjs build-status --build COLE_O_BUILD_ID
```

Depois de persistido, use o `bundle_version_id` da listagem:

```bash
node tools/ui-ops.mjs read --bundle COLE_O_BUNDLE_VERSION_ID --out .export/bundle.json
node tools/ui-ops.mjs inspect --bundle COLE_O_BUNDLE_VERSION_ID --out .export/inspection.json
```

O arquivo não é sobrescrito automaticamente; use outro nome ou `--force` deliberadamente.
A origem deve continuar disponível/autorizada, mesmo depois de o grant do browser expirar.

Para baixar uma PNG **referenciada por esse bundle**:

```bash
node tools/ui-ops.mjs artifact --bundle COLE_O_BUNDLE_VERSION_ID --artifact COLE_O_SCREENSHOT_REF --out .export/checkpoint.png
```

Não use um screenshotRef de outra captura. O serviço verifica escopo, associação e hash.
O comando artifact funciona em manifestos SEALED com referência íntegra; DIAGNOSTIC permite ler
a evidência diagnóstica, mas não publica um pacote selado falso.

### O que esperar da captura OrangeHRM já existente

O perfil automático deixa bootstrap UNAVAILABLE. `sourceBuildRef:null`, bodies ausentes e cobertura
parcial permanecem explícitos. Portanto, é esperado conseguir um manifesto persistido com
`qualification.overall:NEEDS_ATTENTION`. Isso já permite inspecionar relações, artefatos e dependências;
não é autorização para executar um replay incompleto nem certifica o GateA.

Não invente sourceBuildRef nem declare `--bootstrap none` para esconder uma autenticação necessária.
Para uma aplicação comprovadamente pública, revisão explícita pode declarar:

```bash
node tools/ui-ops.mjs build --capture COLE_O_CAPTURE_ID --revision 2 --bootstrap none
```

Para sessão controlada, `--bootstrap controlled --auth-profile authp_ID_REAL` registra somente a
referência declarada. A integração com credenciais/bootstrap do Browser Runner pertence à etapaB.

Ao encerrar a operação:

```bash
unset QAGENT_UI_OPERATOR_SECRET
```

## 9. Smoke de isolamento obrigatório

Pause **somente a fila nova**, nunca a fila de ingestão já existente:

```bash
npx wrangler queues pause-delivery qagent-ui-bundle-build-dev
```

Faça uma captura normal no Plugin. Confira que os eventos são recebidos/processados e a captura
é reconciliada no Observation, embora a montagem ainda não tenha ocorrido. Mantenha o controle curto:
pausar não suspende a expiração das mensagens.

Depois sempre retome:

```bash
npx wrangler queues resume-delivery qagent-ui-bundle-build-dev
```

Confira `bundle.persisted`, leitura do manifesto e inexistência de duplicação de versão.
Execute também a regressão API normal do seu projeto; os testes locais não substituem esse smoke.
Não use purge/delete durante o controle.

## 10. Retenção, revogação e rollback

Ambos os buckets privados devem manter os prefixos de evidência **sem expiração automática**.
Pins do D1 impedem DELETE de metadados via SQL, mas não bloqueiam lifecycle ou exclusão manual de R2.
Um artefato removido externamente é tratado como dependência ausente, nunca recuperado por IA.

Revogação não destrutiva do acesso a uma versão:

```bash
node tools/ui-ops.mjs revoke --bundle COLE_O_BUNDLE_VERSION_ID --confirm-revoke
```

Para interromper novas exportações, no Observation:

```bash
node tools/configure-ui-bundles.mjs --disable
npx wrangler deploy
```

A flag não apaga capturas/bundles nem para o monitoramento API/UI. Mensagens já publicadas podem
continuar sendo processadas; para congelar também essa entrega, pause a fila nova e acompanhe retenção.
Não remova tabelas, pins, objetos ou fontes em um rollback operacional.

Rollback do instalador local, somente quando nenhum arquivo de saída foi alterado depois:

```bash
python entrega-a3/check_update.py --target "C:/git/qagent-observation" --rollback "C:/git/qagent-observation/.qagent-a3-backups/PASTA_DO_BACKUP"
```

Isso reverte arquivos locais, **não** migrations executadas nem dados remotos.

## Documentação oficial consultada

- Queues CLI: https://developers.cloudflare.com/workers/wrangler/commands/queues/
- D1/migrations CLI: https://developers.cloudflare.com/d1/wrangler-commands/
- R2 create: https://developers.cloudflare.com/r2/buckets/create-buckets/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Queue pause/retention: https://developers.cloudflare.com/queues/configuration/pause-purge/

Comandos confirmados na documentação oficial; o deployment real desta entrega não foi executado aqui.
