# UI Test Design — timeout fix1 / 0.2.1

Esta versão aplica pool de quatro leituras verificadas, reserva de 16 MiB de bytes declarados em andamento, deadline de leitura completo e logs de compilação. Consulte o README-APLICACAO.md e VALIDACAO.json na raiz do pacote entregue.

Contratos/compiler/profile preservados. A validação do mesmo conteúdo mantém o JSON e o hash da especificação. Sem nova migration, secret ou binding.
