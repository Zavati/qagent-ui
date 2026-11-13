# PAGE-COPY observado: recibo e fixtures PC.3

Esta entrega integra evidência observada ao consumidor existente. A montagem continua assíncrona,
com fonte autenticada por Service Binding, referências pequenas na fila, pins em Observation,
manifesto imutável no R2, metadados/qualificação em `ui_bundle_versions` e ACK após o commit.
Não cria tabela, fila ou domínio novo.

## Identidade e compatibilidade

| Origem | Exporter | Builder | Recibo |
| --- | --- | --- | --- |
| Captura v1 | `qagent_ui_source_v1` | `qagent_ui_bundle_builder_v2` | Contrato histórico de assembly |
| PAGE-COPY sintético v2 | `qagent_ui_page_source_v2` | `qagent_ui_bundle_builder_v2` | `qagent.ui-page-evidence.v1` |
| PAGE-COPY observado v2 | `qagent_ui_page_observed_source_v2` | `qagent_ui_bundle_builder_v3` | `qagent.ui-page-evidence.v2` |

O contrato da referência paginada permanece `qagent.ui-bundle-source-ref.v2`. O exporter observado
é um discriminante explícito e precisa corresponder ao `dataOrigin` da captura. A revisão observada
de ingresso é `08.2-PC.3.r1`, com política `qagent.ui-page-observed.v1` e `FULL_TEST` autorizado.
O número da versão do pacote não substitui nenhum desses contratos.

`builderVersionForSource` escolhe v3 somente para o exporter observado. O algoritmo de identidade
e os builders históricos continuam preservados. A entrega não reescreve bundles existentes nem
reclassifica os dados históricos no banco.

## Verificação antes de persistir

O leitor confere escopo, captureId, exporter, sourceHash, revisão de conclusão, contagens, partes,
sequência persistida, hashes de eventos e cadeia de eventos. As referências diretas e transitivas
precisam ter tipo correto, descritor FINALIZED, hash e tamanho correspondentes aos bytes reais.
Descritores sintéticos não são admitidos dentro da fonte observada.

Para o ramo observado, as mesmas funções puras de Observation verificam formato e privacidade
dos artefatos, política de headers e política de screenshot. O PNG é decodificado e a máscara é
conferida novamente. HTML exige o marcador de transformação do produtor e passa por recusa de
conteúdo ativo/privado; continua apenas como anexo. Nenhum HTML, JavaScript ou URL é executado
ou buscado durante essa verificação.

Os manifestos de recursos passam pelo mesmo validador estrito de projeção. Além da forma, o leitor
confere a associação com os eventos INTERACTION e os estados: documento, request, sequência,
tempo, tipo, status, origem do corpo e referências. DOM/layout/form-state precisam corresponder ao
documento do checkpoint. A ligação temporal de um recurso a um estado não afirma causalidade.

Falhas de integridade não viram fixtures aparentemente úteis. Falhas de infraestrutura permanecem
falhas de montagem com retry e sem ACK de conclusão. O ciclo existente de lease, pin, commit,
reentrega idempotente e revogação continua responsável pelo armazenamento.

## Conteúdo do recibo

- `journey`: ações observadas, destino/target/valor por referência, ligações de estados e lista vazia
  de asserções. `evidenceOnly=true`.
- `bundle.artifacts`: descritores dos bytes verificados, usados também pelas rotas existentes de
  leitura, inspeção e download autenticado.
- `bundle.fixtures`: referências de respostas BUSINESS_API, preservando status, corpo, headers,
  contexto, ordem, ocorrências e limites de consumo.
- `pageIndex`: documentos, estados, recursos, associações de recursos a estados e interações.
- `qualification`: integridade, usos possíveis, lacunas, contagens e cobertura observada.

O manifesto guarda referências e hashes. Os corpos de resposta, HTML, scripts e imagens continuam
nos artefatos de origem. CSS/JavaScript observados não são convertidos em recursos executáveis
do build alvo. A estratégia declarada permanece executar um build alvo controlado em etapa futura.

## Correspondência e consumo de fixtures

A política `qagent_ui_observed_fixture_match_v1` conserva método, serviço lógico, origin, path,
pairs de query com ordem e duplicatas, hash dos bytes armazenados do corpo de request e hash dos
headers de negócio. O contexto inclui documento, navegação, frame e step. O índice de ocorrência
segue o `requestSequence` de despacho dentro desse contexto; sequência de persistência não é
usada como substituto do despacho observado.

Cada fixture disponível exige consumo máximo 1; um limite incompatível permanece registrado e
torna a fixture indisponível. Não há reutilização após esgotar,
resposta inventada nem fallback para o backend real. Requests não correspondidos ou fixtures
esgotadas têm política `BLOCK`. O índice descreve essas regras; não executa um interceptor.

HTTP 400 completo é uma resposta observada válida e pode ter fixture disponível. Isso não afirma
que 400 é a resposta correta segundo uma regra de negócio. Body ausente/omitido/truncado, status
desconhecido, perda declarada do request body ou consumo incompatível tornam a fixture
indisponível com motivos explícitos. A evidência original permanece referenciada.

Para 304, `networkStatus=304` é preservado. `replayStatus=200` só é admitido quando a prova aponta
para uma INTERACTION NETWORK 200 anterior, terminada antes do novo request, da mesma captura
e mesmo contexto público, com mesmos bodyRef/hash e chave de correspondência. A prova é
validada novamente no consumidor. Os headers da representação 200 são referenciados para a
fixture; os headers realmente observados no 304 ficam em `networkHeadersRef`.

A verificação do consumidor cobre as referências e hashes transmitidos. As verificações privadas
do produtor sobre headers efetivos, ETag e condições de cache não expõem Cookie/Authorization
no contrato. Cache sem prova permanece indisponível; não se transforma em origem NETWORK.

## Qualificação por uso

| Uso | Significado |
| --- | --- |
| `archiveInspection` | Bytes referenciados íntegros; sem renderização ou execução |
| `fixtureMocks` | Disponibilidade das ocorrências observadas para um consumidor futuro |
| `structuralReference` | DOM disponível como evidência do estado |
| `visualReference` | Screenshot verificado e estado estável disponível como referência |
| `testDesignEvidence` | Evidência disponível para orientar desenho posterior; nenhuma asserção gerada |
| `journeyExecution` | Indisponível nesta entrega; inclui também lacunas de ação/estado/bootstrap/proveniência |

Ausência de screenshot afeta referência visual. Ausência de checkpoint afeta cobertura de estados.
Ausência de sourceBuild ou bootstrap afeta proveniência/preparação de execução. Nenhuma dessas
lacunas apaga um body íntegro que pode ser útil como fixture ou evidência para rascunho.
Estado instável permanece registrado como instável e não se torna baseline estável automaticamente.

O recibo observado mantém `overall=NEEDS_ATTENTION`, `eligibleModes=[]`, `uiTestPassed=false`
e `apiEvidencePromoted=false`. Uma qualificação READY em uso específico não aprova um teste.

## Limites e validação

Continuam os limites declarados da fonte/artifacts, de 16 MiB por manifesto derivado e de 100.000
nós do canonicalizador/parser herdado. O índice acrescenta metadados derivados: uma captura
que caiba no armazenamento da origem ainda pode ultrapassar o limite de montagem. O limite é
recusado explicitamente; não há truncamento silencioso nem mudança do canonicalizador histórico.

`npm run check` inclui typecheck real, regressões históricas, PC.2 e `test:pc3`. A suíte PC.3 exercita
400, falta de estado/proveniência, 304 com/sem prova, ocorrência única, corrupção, mistura de
escopo/origem, inspeção de JSON/headers/DOM/HTML/PNG e contradições entre recursos e eventos.
Também executa o consumidor real com SQLite e transportes locais de R2/Observation, incluindo
ACK, pins, idempotência e recuperação de indisponibilidade. Isso não substitui captura nova e smoke
no ambiente implantado, nem comprova execução de UI.
