# Bases e decisões

Código recebido: Observation0.1.6 FULL_TEST, SHA256 da4949bbbee305ae813e386e78627a43a25c184c401a171d2fac025b661be348.
Roteiro: QAGENT-08.2-IMPLEMENTATION-HANDOFF, seção08.2-A.3; protocolo CROSS-CHAT-INTEGRATION.
Decisão aprovada na conversa: novo serviço qagent-ui e fila própria após reconciliação,
sem mudar Plugin/Gateway/API nesta entrega. Contratos implementados são baseados nos validadores
reais da A.2, não apenas nos exemplos conceituais antigos.

Extensões implementadas nesta entrega: envelope assemblyv1, protocolo source/ref/build assinados,
outbox por descoberta recuperável, pins, novos estados e CLI administrativa. Não são APIs antigas
presumidas nem funcionalidades já publicadas. Sua disponibilidade requer o rollout deste pacote.

Documentação Cloudflare primária consultada para mecanismos e comandos:
https://developers.cloudflare.com/queues/configuration/javascript-apis/
https://developers.cloudflare.com/queues/reference/delivery-guarantees/
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/
https://developers.cloudflare.com/workers/wrangler/commands/queues/
https://developers.cloudflare.com/d1/wrangler-commands/
https://developers.cloudflare.com/r2/buckets/create-buckets/
https://developers.cloudflare.com/queues/configuration/pause-purge/
