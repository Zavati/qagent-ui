# QAgent 08.2-A.3 — relatório de validação da entrega

## Resultado

Implementação local preparada: **qagent-ui0.1.0 + Observation0.1.7**.
Não houve deploy, criação de recursos, aplicação remota de migrations, leitura de clientes na conta,
replay browser ou aceite do GateA remoto. Os ZIPs são fontes completos com testes e documentação.

## Bases e preservação

Entrada: `qagent-observation-0.1.6-FULL-TEST-COMPLETO.zip`.
SHA256: `da4949bbbee305ae813e386e78627a43a25c184c401a171d2fac025b661be348`.

A comparação byte a byte confirmou que o único arquivo de source preexistente alterado é
`src/index.ts`, com roteamento interno aditivo e tarefa cron independente. Nenhuma migration
0001–0014 foi alterada. Nenhum pacote de dependência no lockfile do Observation mudou;
versão do projeto e script de teste foram adicionados. Plugin2.0.20/Gateway1.0.18 não foram editados.
O checkout/deployment remoto do usuário não foi comparado byte a byte; usar o instalador com conflitos.

## Testes executados e aprovados

| Conjunto | Resultado | Ambiente |
|---|---:|---|
| Base0.1.6: suíte nativa de ingestão UI assíncrona | 41/41 | TS real compilado + SQLite; infra simulada |
| Saída0.1.7: mesma suíte sem editar testes existentes | 41/41 | Mesmo ambiente |
| Exportação/outbox/fonte no Observation | 24/24 | Código real + SQLite real; R2/Queue simulados |
| Novo qagent-ui, contratos, assembler, armazenamento, operações | 48/48 | Código real + SQLite real; R2/Queue/bindings simulados |
| Integração entre os dois projetos | 10/10 | Ambos compilados; transporte/fila/R2 simulados |
| Instalação/rollback/conflitos/configuração local | 15/15 | Checkouts temporários reais; nenhuma chamada de nuvem |
| TypeScript dos sources de ambos os projetos | passou | tsc5.8.3 global, tipos de referência locais |

São **82 testes nativos novos**, além da regressão existente de41 na base e na saída,
e15 controles de integração de arquivos. Contagens não são testes de navegador nem de carga.

### O que esses testes cobrem

- Contratos reais A.2, hashes, sequência/hash-chain, origem e escopo; troca de tenant recusada.
- Source somente após captura reconciliada; flagoff sem dependência da outbox no caminho legado.
- Falha/ambiguidade de publicação, retomada, consumidor pausado e reentrega sem duplicação.
- R2/D1 falhando, ACK perdido, leases concorrentes, imutabilidade no SQL e identidade determinística.
- Artefato faltante/corrompido produz DIAGNOSTIC; indisponibilidade de infraestrutura gera retry,
  não um manifesto parcial inventado. Body304 não é fabricado.
- Bootstrap e build desconhecidos bloqueiam a respectiva dimensão. Ambiguidade de matching não
  é resolvida por ordem global. Query duplicada e ordem são preservadas.
- Pins e trigger de retenção; passagem do tempo não invalida versão disponível; revogação impede
  leitura sem corromper mensagens duplicadas já processadas.
- Conteúdo malformado de DLQ não é persistido como payload bruto. Job com lease ativo não é
  sobrescrito por uma chegada concorrente à DLQ.
- CLI assina de modo compatível com o verificador real e recusa origem HTTP remota/credenciais em URL.
- Um teste integrado usa a **admissão/artifact upload/events/seal/consumer originais da A.2**,
  seguida pela nova exportação/montagem — não somente linhas de terminal preinseridas.

## Limitações verificadas do ambiente

- `npm ci` não concluiu na tentativa limitada do container.
- `npm ping --fetch-retries=0 --fetch-timeout=5000` retornou **EAI_AGAIN** para registry.npmjs.org.
- `npm run check` em ambos os projetos parou em **wrangler: not found**, exit127.
- Assim, não executamos `wrangler types` novo, Vitest oficial, bundling/deploy dry-run do Wrangler
  nem typecheck dos arquivos Vitest com as dependências do lockfile. Esses comandos devem passar
  no ambiente do usuário antes de publicar.
- A compilação local nativa usou tsc5.8.3 global; isso NÃO equivale ao TypeScript7.0.2 do lockfile.
- Os tipos de runtime do novo serviço têm proveniência documentada e bloco Env local; serão
  regenerados pelo `npm run cf-types` no build oficial.

Não houve atualização de dependências para esconder essa limitação. A suíte nativa usa o mesmo
mecanismo já presente na base: compileForNode sobre sources reais, sem alterar tsconfig de produção.

## Fixture e evidência real

`fixtures/synthetic-assembly.json` foi gerado pelo assembler real sobre SYNTHETIC_CONTROL,
com bootstrap NONE explícito, build sintético conhecido e checkpoint semântico. Ficou SEALED/READY
para funcional/semântica; visual permanece indisponível e nenhuma execução foi feita.
Hash do manifesto: `ac267e8ecfe5f0ac7496df8258283d65c0bfed8e0b39a4ed8e743b6f8e3438c1`.

Não reconstruímos um bundle "completo" a partir dos logs sanitizados OrangeHRM: eles não contêm
os bytes e campos integrais necessários. O smoke remoto lê as capturas reais persistidas no Observation.

## Pendências explícitas

- Rodar instalação oficial e checks com o lockfile; revisar npm audit separadamente.
- Criar recursos, secrets e aplicar migrations conforme guia, com consumidor antes do produtor.
- Validar captura real → bundle inspecionável, imagens/bodies legíveis, escopos e hashes.
- Pausar somente o consumer novo e provar que o monitoramento/encerramento continuam funcionando;
  retomar e provar que a montagem ocorre sem recaptura nem duplicação.
- Preservar e executar smoke/regressão API no mesmo rollout.
- Não corrigidos nesta entrega:304/cache, cobertura de checkpoints/Stop, sourceBuildRef ausente.
- B: resolução/execução de bootstrap, browser isolado e matcher de execução permanecem pendentes.

## Estados não equivalentes

Recebido durável ≠ materializado; build COMPLETE ≠ bundle READY; READY ≠ UI aprovado.
SEALED pode ter qualificação NEEDS_ATTENTION. DIAGNOSTIC preserva diagnóstico sem manifesto fechado.
Nenhum dado servido por replay é promovido a prova do backend atual.
