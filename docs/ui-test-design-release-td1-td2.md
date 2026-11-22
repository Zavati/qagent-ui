# Estado entregue — UI-TD-1 + UI-TD-2

**21/11/2026 — implementação e validação locais. Implantação remota pendente.**

Esta entrega implementa o compilador observado, lotes duráveis, versões imutáveis e a tela
de consulta. Atualiza o plano anterior, sem declarar execução de navegador concluída.

| Projeto | Versão | Entrega |
|---|---|---|
| qagent-ui | 0.2.0 | Adapter direto dos bundles, compilador determinístico, contratos, guard e fontes |
| qagent-test-generation-orchestrator | 0.2.0 | Jobs UI, itens, tentativas, candidato persistido e recuperação |
| qagent-test-registry | 0.6.0 | Raízes/versões/operações UI no Registry existente |
| qagent-gateway | 1.1.0 | Sessão/escopo, transporte assinado, callbacks e leitura de versões |
| qagent-console | 0.4.0 | Test Design UI por projeto/ambiente, lotes e inspeção de checks |

O conteúdo da versão vem das evidências e de regras versionadas. O contrato prevê
`UI_REPLAY` e `UI_LIVE`, com prontidão separada e `executionPerformed: false`.
No replay, os esperados são fixos. No live, os checks desta versão são `OBSERVED_DIFF`:
uma diferença de dado fica visível e não é automaticamente declarada regressão.
`bindings` permanece vazio. Não se infere causalidade entre response e campo, nem o
estado posterior de uma ação que não foi comprovado pela observação.

Cada bundle admitido produz no máximo um design com sua jornada. Um lote admite até
50 bundles explícitos. A descoberta tem paginação e o Console mostra o conjunto
selecionado. Agregação de uma jornada lógica entre vários segmentos permanece futura.

## Verificação desta entrega

- qagent-ui: typecheck e 131 testes, incluindo 18 novos do compilador.
- Orchestrator: check e 88 testes, incluindo 23 novos UI.
- Registry: 11 testes UI; check de configuração aprovado. Suíte geral 255/259;
  quatro falhas legadas reproduzidas no ZIP base intacto, sem mudança na validação API.
- Gateway: 14 testes UI, router legado e regressões selecionadas de API aprovados.
- Integração entre os quatro serviços: 4 testes aprovados, incluindo ACK perdido,
  fonte revogada, NO_DESIGN e leitura pelo Console BFF. Zero chamadas externas/IA.
- Console: TypeScript/build Next aprovados e 10 testes de interação em DOM simulado.
- Chromium: execução bloqueada por restrição de socket do ambiente; elevação recusada
  pela política automática. Não há aceite visual/browser local. O roteiro está incluído
  para execução em um ambiente que permita iniciar o navegador.

Os testes usam fixtures identificadas e infraestrutura local controlada. Não comprovam
que a captura de produção já foi compilada, que migrations foram aplicadas remotamente
ou que algum teste da aplicação observada foi executado.

## Próximos cortes

1. UI-EXEC-1: Browser Runner pareado, contextos independentes, aplicação dos mocks,
   execução dos operadores, Results e comparação O/R/L.
2. UI-EVOL-1: análise opcional de falhas/divergências e propostas versionadas verificadas.
3. UI-CAT-1: organização agregada das evidências e descoberta entre jornadas/segmentos.
4. Comparadores visuais/screenshot, bindings explícitos e suporte adicional a ações.

O cache continua no backlog [QAGENT-UI-CACHE-001](ui-cache-deferred.md). Uma fixture 304
sem representação não é inventada: bloqueia o replay que depende dela; a elegibilidade
live é avaliada separadamente. Os limites detalhados do compilador e seus ensaios estão
em [ui-test-design-td1.md](ui-test-design-td1.md).
