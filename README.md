# qagent-ui 0.1.5

Domínio UI do QAgent: montagem, qualificação e persistência de bundles.
Não executa navegador e não aprova testes UI.

Observation continua dono dos dados de origem. Este serviço recebe referências pela fila,
consulta a fonte pelo Service Binding e guarda manifestos derivados no D1/R2 próprios.
Usuário/Plugin não precisa disparar uma montagem manual.

## PAGE-COPY PC.2

Leitor sintético v2 aditivo e compatível com a origem paginada. Ver [contrato/limites](docs/page-copy-pc2.md).
Captura real do Plugin, representação visual e execução permanecem nas próximas etapas.
Mantenha as rotas, IDs, filas e secrets do seu checkout. O Wrangler deste pacote é um template.

## Validação

```bash
npm ci --include=dev
npm test
npm run test:pc2
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

## Histórico

Não foi feita limpeza destrutiva dos materiais históricos deste checkout nesta entrega funcional.
Documentação/instalador específicos da PC.2 ficam fora do produto.
