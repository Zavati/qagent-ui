# qagent-ui 0.1.6

Domínio UI do QAgent: montagem, qualificação e persistência de bundles.
Não executa navegador e não aprova testes UI.

Observation continua dono dos dados de origem. Este serviço recebe referências pela fila,
consulta a fonte pelo Service Binding e guarda manifestos derivados no D1/R2 próprios.
Usuário/Plugin não precisa disparar uma montagem manual.

## PAGE-COPY PC.2

Leitor sintético v2 aditivo e compatível com a origem paginada. Ver [contrato/limites](docs/page-copy-pc2.md).
Mantenha as rotas, IDs, filas e secrets do seu checkout. O Wrangler deste pacote é um template.

## PAGE-COPY observado PC.3

O consumidor aceita a origem observada v2 emitida por Observation, verifica novamente os bytes e
produz o recibo `qagent.ui-page-evidence.v2`: índice de documentos/estados/recursos e referências
determinísticas de fixtures de negócio. A qualificação separa integridade, disponibilidade para
mocks, referência estrutural/visual e limitações de execução. Ver [contrato e usos](docs/page-copy-observed.md).
O conteúdo capturado não é executado. Não há Runner, teste aprovado nem asserção de negócio gerada.

O perfil r2 `ENVIRONMENT_MANAGED` usa exporter próprio e builder v4, preserva dados de teste sem
redação/máscara e registra essa responsabilidade na qualificação. Gateway admite esse perfil
somente para `FULL_TEST` em ambiente persistido `DEV`/`STG`. O ramo sanitizado r1 mantém builder v3
e os mesmos hashes; captura v1 e PC.2 continuam com suas identidades anteriores.

## Validação

```bash
npm ci --include=dev
npm test
npm run test:pc2
npm run test:pc3
npm run check
npm run test:integration -- --observation ../qagent-observation
npm run test:pc2 -- --observation ../qagent-observation
```

Node 22.13+ para node:sqlite nos testes. Preserve o lockfile.
As suítes locais não substituem o smoke remoto/workerd.
`npm run deploy` mantém o check e a conferência da configuração antes de publicar.

## Estados

COMPLETE = operação terminada. SEALED = evidência íntegra segundo o montador.
READY/NEEDS_ATTENTION = qualificação de uso, separada de integridade. Nenhum significa teste aprovado.
PC.2 arquiva evidência sintética v2 sem declarar replay elegível. Builds v1 existentes permanecem legíveis.
PC.3 mantém o mesmo princípio: uma resposta HTTP 400 íntegra pode servir como fixture observada,
e falta de checkpoint/sourceBuild/bootstrap limita os respectivos usos sem apagar essa evidência.

## Histórico

Não foi feita limpeza destrutiva dos materiais históricos deste checkout nesta entrega funcional.
Documentação/instalador específicos da PC.2 ficam fora do produto.
