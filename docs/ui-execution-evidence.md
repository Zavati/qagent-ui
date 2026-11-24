# UI-EXEC-1 — adapter de evidência completa

## Responsabilidade

O `qagent-ui` continua dono dos manifestos derivados. O executor não usa a prévia
de uma página do Console como valor esperado e não escolhe um URL arbitrário para
buscar dados. O Gateway envia a versão imutável do plano que admitiu no lote.

As rotas internas são:

| Rota POST | Retorno |
| --- | --- |
| `/internal/ui/v1/execution/source` | `qagent.ui-execution-source.v1`, fonte, hash do plano e envelope completo |
| `/internal/ui/v1/execution/artifact` | Bytes completos de um artefato referenciado, com tipo, tamanho e SHA-256 |

O corpo contém `scope`, `source`, `specification` e `specificationHash`; a segunda
rota recebe também `artifactId`. A fonte identifica organização, projeto, ambiente,
captura, versão de bundle, hash da fonte e hash do manifesto.

Cada leitura verifica o hash do plano, a identidade do bundle, seu manifesto e o
vínculo determinístico entre o plano v2 e essa fonte/perfil. Artefatos são buscados
no Observation, validados pelo tamanho e SHA-256 declarados no manifesto, e
liberados somente após uma nova conferência de acesso. Uma revogação detectada
durante a leitura impede retornar os bytes.

## Autenticação e implantação

Defina **o mesmo segredo novo** `UI_EXECUTION_SECRET` no `qagent-ui` e no Gateway:

```bash
npx wrangler secret put UI_EXECUTION_SECRET
```

Execute no diretório de cada serviço usando a configuração Wrangler já existente.
O protocolo HMAC usa o principal `execution`, caminho e método originais, timestamp
e hash do corpo. Os segredos de `operator`, `source` e `test-design` não dão acesso
a estas rotas. A montagem pública `/v1/qagent-ui/` não expõe o adapter de execução.
O token de CI fica somente no Gateway e não recebe esse segredo interno.

Não há nova migração D1 neste serviço. Preserve `UI_DB`, `UI_BUNDLES`, o binding
`OBSERVATION_SERVICE`, as filas, domínios e demais segredos existentes.

## Limites operacionais

A operação inteira tem prazo de 45 segundos, incluindo bindings que não respeitem
cancelamento. O cliente de origem mantém suas proteções por transferência. Prazo
ou bytes inválidos resultam em erro explícito; nenhum caso vira evidência vazia.
Os limites por artefato e manifesto da captura continuam válidos. Não se acrescenta
um teto ao número de verificações da jornada lógica.

Um manifesto grande pode superar o limite de JSON usado por endpoints de controle.
Por isso o Gateway usa um leitor próprio de até 20 MiB para o envelope e mantém as
leituras de artefatos separadas. Os relatórios do Runner também são separados em
páginas, sem copiar toda a evidência observada para o D1.

## Validação

`npm run test:exec1` exercita fonte completa, texto longo, autenticação separada,
escopo, pins e hashes, edição de plano, bytes adulterados, artefato não referenciado,
revogação anterior/durante leitura, cancelamento e deadline de binding travado.
`npm run check` inclui esta suíte junto das regressões existentes.

O adapter não executa navegador. A execução real, os comparadores e a preparação
do ambiente pertencem ao `qagent-ui-runner`. Os casos de cache HTTP 304 sem corpo
continuam na pendência `QAGENT-UI-CACHE-001`; este adapter não sintetiza respostas.
