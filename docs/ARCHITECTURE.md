# Decisão A.3 — domínio independente, fontes preservadas

## Identidade e confiança

Um captureId é uma ocorrência de captura, não um catálogo semântico de telas entre sessões.
Jornada e bundle têm identidade estável por escopo + captureId. A versão é um hash de
sourceRef + perfil de montagem + builderVersion + matchingVersion. Repetição não cria versão;
mudar explicitamente `profile.revision` cria uma nova versão imutável.

São mantidos o contrato A.2 de ações/checkpoints/interações e a canonicalização recebida na base.
`contracts/canonical.ts` e `contracts/uiCapture.ts` foram copiados sem alteração da fonte.
O novo envelope `qagent.ui-bundle-assembly.v1` contém o manifesto de jornada e bundle existentes,
qualificação, matching e proveniência. Hash de bytes R2 e hash do manifesto são verificados separadamente.

## Fonte e descoberta

O cron de minuto do Observation descobre até 20 capturas por chamada, ordenadas por fechamento,
com `ui_ingestion_sessions.phase=COMPLETE` e status RECORDED/PARTIAL/ABORTED. Capturas síncronas
antigas sem reconciliação assíncrona não são admitidas neste perfil. Não há hook síncrono na
conclusão atual: os próprios registros terminais são a fonte durável de recuperação da outbox.

A flag `UI_BUNDLE_EXPORT_ENABLED` vem desabilitada. Quando habilitada, a descoberta inclui
capturas históricas elegíveis, de todos os escopos presentes nessa instância. Isso é backfill
automático, não somente capturas novas. O operador deve avaliar volume/custo e acesso antes de habilitar.

Até três fontes por tick são verificadas/persistidas e publicadas. A leitura de capabilities
precede a publicação. Lote concluído e consumidor indisponível não desfazem a captura.

A outbox volta a publicar após 15 minutos enquanto não houver confirmação persistida do consumidor.
A fila pode duplicar mensagens; o consumidor usa identidade determinística, leases cercadas por
fencing token e gravação condicional. Não há alegação de exactly-once físico.

## Persistência, recuperação e falhas

Originais ficam no R2 UI do Observation. Um snapshot autenticado e imutável da fonte fica em
`ui-bundle-sources/v1/`. A fila transporta referência + hash + perfil + assinatura, não os bytes.
O serviço novo mantém jobs e índice no D1 próprio e manifestos em `ui-bundles/v1/` no bucket próprio.

A escrita R2 é condicional e relida para verificação. O commit de índice é transacional no D1.
Não há transação distribuída entre R2, D1 e Queue: uma falha pode deixar um objeto órfão privado;
a retomada reutiliza as mesmas identidades. Não há limpeza automática destrutiva.

A mensagem só recebe ACK depois do commit e da confirmação ao Observation. Perda do ACK pode
repetir leitura/confirmação, não inserir outro manifesto. Mensagem DLQ registra somente código,
identidade segura e hash; payload malformado arbitrário não é salvo. Falha durável do job requer
nova revisão deliberada para tentar novamente, preservando a tentativa anterior.

## Segurança

- `UI_BUNDLE_SOURCE_SECRET`: secret interno compartilhado só entre Observation e qagent-ui.
- `UI_BUNDLE_OPERATOR_SECRET`: secret diferente, acesso administrativo global via CLI; não é
  uma credencial de usuário/tenant e não pode ser entregue ao Console/browser/Plugin.
- HMAC-SHA256 com separação de domínio entre Queue e HTTP. HTTP cobre principal/método/path/
  timestamp/hash do body, tolerância 60 s, sem querystring. Mensagens duráveis não usam grants
  de navegador expirantes. Rotação desse secret exige coordenar mensagens/filas pendentes.
- Health público mínimo; todas as leituras de fonte/bundle/artefato são autenticadas e vinculadas
  ao escopo. Nenhum CORS público de acesso a dados. Responses de leitura usam no-store.
- Revogação de bundle muda acesso em registro separado; não edita a baseline imutável.
- Arquivos exportados podem conter dados funcionais preservados por FULL_TEST. A CLI não os
  imprime em logs estruturados do serviço, mas um `read` local pode exibir os dados ao operador.
  Prefira `--out` e não compartilhe exports de clientes sem revisão.

## Retenção

Pins são criados antes de ler artefatos. Trigger em D1 impede DELETE de metadados fixados.
Não há TTL por idade para uma versão disponível. Leitura respeita revogação; `inspect` revalida
as dependências e registra auditoria sem reescrever a qualificação original.

**Pins no D1 não anulam lifecycle do R2 nem exclusão manual via painel/API.** Ambos os buckets
privados devem ficar sem expiração automática dos prefixos de evidência. Remoção externa gera
UNAVAILABLE/erro de integridade, não uma fixture inventada. Não incluímos liberação de pin ou
exclusão física nesta entrega; isso requer um fluxo explícito de retenção/autorização.

## Qualificação e matching

Dimensões: integridade, ações, rede, bootstrap, proveniência, semântica e visual. Não inferimos
causalidade a partir de janela temporal. Mantemos correlationBasis e as identidades observadas.
Query preserva ordem/duplicatas; bodies e headers são comparados por hash dos bytes sanitizados
armazenados. Diferenças de negócio não são ignoradas. Identificadores voláteis precisam de
normalização explícita em futura política versionada; não há normalização oculta.

Requests indistinguíveis no mesmo contexto que exigem responses diferentes produzem ambiguidade.
Não é implementado o matcher de execução, só sua descrição/fingerprint para B. Recursos JS/CSS
da gravação não substituem o build alvo. Assets de dados ausentes limitam visual.

Semântica/visual indisponíveis são distinguíveis. As dimensões mínimas deste perfil para READY
incluem integridade, ações, rede, bootstrap, proveniência e semântica. Visual é elegível apenas
quando também READY. Os checkpoints de funcional/semântica apontam ao snapshot existente; não
criamos assertions ou resultado de teste nesta etapa.

## Limites do perfil

Fonte até 12 MiB, manifesto até 16 MiB, controle interno 32 KiB; artefato mantém 1 MiB e 128 por
captura da A.2. Há no máximo um body em verificação por vez, mas a fonte/manifesto são estruturas
em memória. O canonicalizador da base mantém limites de profundidade e contagem de nós.

Contratos de manifesto A.1: até 500 ações, 1000 interações, 128 checkpoints e 64 issues. A fonte
pode ser maior dentro da ingestão A.2; exceder o contrato resulta DIAGNOSTIC, não truncamento.
As flags/limites originais de captura não são aumentados por este serviço.

Nenhum teste de carga multiusuário foi executado. Max concurrency inicial da fila é 2, batch1;
não é garantia de escala ilimitada. Medir idade da fila, duração, tentativas e falhas após rollout.
