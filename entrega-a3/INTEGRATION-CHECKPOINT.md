# Checkpoint para integração com a frente REST

Etapa: 08.2-A.3. Entrega local: qagent-ui0.1.0 + Observation0.1.7.
Base: Observation0.1.6 FULL_TEST SHA256 da4949bbbee305ae813e386e78627a43a25c184c401a171d2fac025b661be348.
Estado: IMPLEMENTED_LOCAL_VALIDATION / REMOTE_GATE_PENDING.

Não alterados: Plugin2.0.20, Gateway1.0.18/trials, Runner/Registry/Results/Evolution/Normalizer/Catalog,
rotas API legadas, código de ingestão UI existente e migrations já entregues 0001–0014.

Observation: novos módulos src/ui/bundles, rotas internas assinadas, tarefa cron separada,
outbox/pins na0015, novo producerbinding e capabilitybinding; versão/scripts adicionados.
Novo serviço dono único dos manifestos: qagent-ui, D1/R2/Queue próprios; não escreve tabelas do Observation.

Não houve lock global, confirmação de merge da outra conversa, execução remota, criação de recursos,
publicação ou aceitação de uma jornada real em A.3. Compare o checkout com check_update antes de aplicar.
A reserva de paths é intenção local. Havendo outra0015, reconciliar antes de executar migrations.

B segue pendente: Browser Runner, replay estrito, integraçãoRegistry/Results. A.2 continua com backlog
cache304, cobertura/Stop dos checkpoints, identificação do build e inspeção das PNGs.
