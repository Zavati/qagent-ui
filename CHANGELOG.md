# Changelog

## 0.1.9 — Page Copy segment metadata compatibility

- Parse/validate optional physical segment metadata in Page Copy v2 descriptors without changing per-physical capture immutability or builder qualification.
- Preserve per-segment bundle integrity and replay mock safety: unverified network status remains unusable.
- The logical, executable replay bundle and UI Test Design remain a separate, subsequent feature.

## 0.1.8 — Page Copy unverified status archive compatibility

- The builder accepts Page Copy v2's complete response body with an unknown wire status without inventing a network or replay status. Artifact integrity remains enforced; fixture is `UNAVAILABLE` with `UI_FIXTURE_STATUS_UNAVAILABLE` until status can be independently proven.
- Regression test confirms all source bytes remain accessible and replay qualification stays truthful. No change to Browser Runner and no migration.


## 0.1.7 — PC.3 r2

Consome o exportador environment-managed e monta bundles pelo builder v4, com origem, responsabilidade do ambiente e dataRedactionApplied=false explícitos. Preserva qualificação por uso, integridade, contratos históricos e indicação de testes ainda não executados.

# 0.1.5 — PAGE-COPY PC.2

- Leitura paginada de fonte v2 e validação da closure de recursos.
- Pins transitivos em lotes, arquivo sintético íntegro e leitura inerte.
- Fluxo, identidade do builder_v2 e leitura v1 preservados.
- Sem migration no UI_DB, sem mudança de infraestrutura ou autenticação.
- Sem captura real, replay ou renderização de página nesta etapa.
