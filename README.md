# qagent-ui 0.1.2

# qagent-ui 0.1.0 — 08.2-A.3

Serviço independente de montagem, qualificação e persistência de Replay Bundles.
**Não executa navegador nem aprova testes UI.** Plugin 2.0.20 e Gateway 1.0.18 não mudam.

## Fluxo

Captura UI reconciliada no Observation → outbox recuperável → fila exclusiva de bundles →
leitura autenticada da captura → verificação dos artefatos → manifesto determinístico →
R2 privado + índice/versionamento no D1 do domínio UI.

O Observation 0.1.7 continua dono dos artefatos originais. O `qagent-ui` não possui binding
para seu D1 ou bucket. Lê e fixa referências por contrato interno autenticado.
A integração não entra no HTTP do Plugin. O envio API e a fila de ingestão UI ficam preservados.

## Instalação

Leia **entrega-a3/COMANDOS-E-DEPLOY.md** antes de publicar. Requisitos: Node 22.13+ e npm,
acesso autorizado à conta Cloudflare, banco/filas/bucket novos provisionados. Os testes
nativos usam `node:sqlite`; o aviso experimental do Node não é falha do teste.

```bash
npm ci --include=dev
npm run check
npm run test:integration -- --observation ../qagent-observation
```

`npm run check` regenera os tipos usando Wrangler, executa TypeScript e os testes nativos.
Os testes de integração compilam os dois projetos reais, com SQLite real e transporte/R2/Queue simulados.
Não substituem o smoke remoto. Não use `npm audit fix` nem atualize lockfiles sem revisão.

## Estados

- `build.status`: PENDING / BUILDING / COMPLETE / FAILED — operação do montador.
- `manifestState`: SEALED / DIAGNOSTIC — integridade/fechamento do pacote.
- `qualification.overall`: READY / NEEDS_ATTENTION — aptidão para uma tentativa de replay.
- `access_state`: ACTIVE / REVOKED — acesso à versão, separado da imutabilidade.

`COMPLETE` não significa READY; `READY` não significa teste aprovado.
O manifesto inclui `uiTestPassed:false`, `apiEvidencePromoted:false` e
`QUALIFIED_FOR_REPLAY_ATTEMPT_NOT_EXECUTED`.

O perfil automático usa bootstrap UNAVAILABLE, pois os eventos não provam como autenticar
um novo browser. Não inventamos autenticação. Um operador autorizado pode declarar NONE
para aplicação comprovadamente pública, ou CONTROLLED_SESSION com authProfileRef. A referência
não resolve credenciais nesta etapa; a execução e a verificação dessa autorização pertencem à etapa B.

## Operação

`tools/ui-ops.mjs` usa um secret administrativo separado, nunca o token do Plugin.
Comandos: health, list, build, build-status, read, inspect, artifact, revoke.
A configuração local `.qagent-ui-ops.json` contém somente origem e IDs de escopo.
O secret vem da variável de processo `QAGENT_UI_OPERATOR_SECRET`.
A revogação exige `--confirm-revoke` e não apaga dados.

## Demonstração offline

```bash
node tools/demo.mjs
```

Gera `fixtures/synthetic-source.json`, `synthetic-assembly.json` e `synthetic-artifacts.json`.
São **SYNTHETIC_CONTROL**, não um bundle reconstruído dos logs OrangeHRM.
Capturas reais devem ser lidas do Observation, com seus bytes e hashes reais.

## Fora do escopo

Nenhuma migração da ingestão API, atualização do Plugin, mudança em licenças, geração IA,
Browser Runner, regressão visual ou execução live. As lacunas de 304/cache, checkpoints e build
ficam explícitas na qualificação; não foram reparadas nesta entrega.
