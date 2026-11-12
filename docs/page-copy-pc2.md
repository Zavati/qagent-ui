# PAGE-COPY PC.2 — leitor de evidência v2

qagent-ui 0.1.5 mantém o fluxo v1 e acrescenta SourceRef v2 paginado do Observation 0.1.12.
O consumer lê a raiz e partes por Service Binding, autentica, verifica hashes, cadeia de eventos,
referências e tipos, fixa recursos transitivos em lotes <=128, persiste e confirma a tentativa ativa.
Não existe chamada síncrona producer->consumer antes de publicar; não há fila nova.

Saída: `qagent.ui-page-evidence.v1`, `SEALED` quando íntegra; qualificação `NEEDS_ATTENTION`,
`UI_PAGE_REPLAY_NOT_IMPLEMENTED`, `eligibleModes=[]`, `uiTestPassed=false` e
`apiEvidencePromoted=false`. É evidência sintética arquivada, não replay nem cópia observada real.
O assembler v1 não foi reescrito e mantém suas identidades/qualificações anteriores.

As operações administrativas existentes continuam exigindo seu HMAC; não são autenticação
alternativa para usuário final e não fazem parte do consumo automático. Nenhum secret novo.
A leitura de artefatos retorna attachment/no-store/nosniff/CSP sandbox, sem execução do conteúdo.
A GUI de inspeção da página e o matcher de replay permanecem nas próximas etapas.

Testes locais:
```bash
npm test
npm run test:pc2
npm run test:integration -- --observation ../qagent-observation
npm run test:pc2 -- --observation ../qagent-observation
npm run check
```

As duas últimas integrações entre repositórios usam SQLite e transportes simulados. Para esta
entrega publicar o reader primeiro, e só depois migrar/publicar o Observation. Não alterar
Wrangler, D1, R2, filas, Service Bindings ou secrets. Não há migration nova no UI_DB.
