# Canonical en-US -> pt-BR / es-419 glossary

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_methodology_glossary`
**Effort estimate**: 2d
**Inherited dependencies**: `frontend_i18n.i18n_catalog_workflow` (must land first)

## What this task is

Land the canonical mapping from each English-coded methodology value (statement kinds, edge roles, annotation kinds, vote choices, diagnostic kinds, facet states) to its pt-BR and es-419 rendering. The mapping lives as catalog entries under the `methodology` namespace in `packages/i18n-catalogs`. The english-coded value remains the wire format; the localized rendering is what UI components show.

## Why it needs to be done

Every UI surface that renders a methodology label depends on this mapping:

- Moderator classification palette, edge role selector, diagnostic flag pane.
- Participant per-facet voting buttons, status indicator, diagnostics view.
- Audience graph rendering — kind labels inside nodes, edge role glyphs.
- Replay / test-mode event inspector — every event kind is a label here.

Without this glossary, every render falls back to the english identifier (`fact`, `bridges-from`, `meta-disagreement`), which is wrong for non-English locales.

## Inputs / context

- [docs/data-model.md](../../../docs/data-model.md) — the authoritative enum lists (statement kinds, edge roles, annotation kinds, facet states, vote choices, diagnostic kinds).
- [docs/methodology.md](../../../docs/methodology.md) — semantic context for each term; the localization must preserve the methodological commitment, not pick a colloquial synonym.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — methodology values stay English in the data model; localization is render-only.
- [docs/adr/0021-event-envelope-discriminated-union-with-zod.md](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — event log durability constraint; translating an enum in the data model would break replay.
- `packages/shared-types/src/events/enums.ts` and `events/proposals.ts` — the runtime definitions of the english-coded values.

## Constraints / requirements

- **Render-only translation.** The english values stay in `packages/shared-types`, the Postgres CHECK constraints, the WebSocket payloads, the OpenAPI spec, the event log. This task only adds catalog entries; it does NOT add a translation column anywhere persistent.
- **Native-speaker + philosophical review per locale.** The methodology terms are technical philosophical vocabulary, not casual UI labels. Initial values are flagged "PENDING review" and finalized only after a reviewer with both fluent pt-BR / es-419 and methodological literacy signs off.
- **Catalog namespace**: `methodology`. Keys mirror the english identifier: `methodology.kind.fact`, `methodology.edgeRole.supports`, `methodology.facetState.proposed`, `methodology.diagnostic.cycle`, `methodology.voteChoice.agree`, `methodology.annotationKind.note`.
- **No gendered article in the catalog entry itself.** The catalog stores the bare noun; ICU select/select-ordinal handles agreement in the strings that compose with it (handled in `i18n_diagnostic_descriptions`).

## Proposed mapping (initial values — PENDING review)

| English | pt-BR | es-419 |
| --- | --- | --- |
| **Statement kinds** |  |  |
| `fact` | Fato | Hecho |
| `predictive` | Preditiva | Predictiva |
| `value` | Valor | Valor |
| `normative` | Normativa | Normativa |
| `definitional` | Definicional | Definicional |
| **Edge roles** |  |  |
| `supports` | Apoia | Apoya |
| `rebuts` | Refuta | Refuta |
| `qualifies` | Qualifica | Califica |
| `bridges-from` | Ponte de | Puente desde |
| `bridges-to` | Ponte para | Puente hacia |
| `defines` | Define | Define |
| `contradicts` | Contradiz | Contradice |
| **Facet states** |  |  |
| `proposed` | Proposta | Propuesta |
| `agreed` | Acordada | Acordada |
| `disputed` | Em disputa | En disputa |
| `meta-disagreement` | Meta-desacordo | Meta-desacuerdo |
| **Vote choices** |  |  |
| `agree` | Concordar | De acuerdo |
| `dispute` | Discordar | En desacuerdo |
| `withdraw` | Retirar | Retirar |
| **Annotation kinds** |  |  |
| `note` | Nota | Nota |
| `reframe` | Reenquadramento | Reencuadre |
| `scope-change` | Mudanca de escopo | Cambio de alcance |
| `stance` | Posicao | Postura |
| **Diagnostic kinds** |  |  |
| `cycle` | Ciclo | Ciclo |
| `contradiction` | Contradicao | Contradiccion |
| `multi-warrant` | Multi-garantia | Multi-garantia |
| `dangling-claim` | Afirmacao pendente | Afirmacion pendiente |
| `coherency-hint` | Sugestao de coerencia | Sugerencia de coherencia |

(Diacritics in the table above are stripped for portability; the actual JSON catalog entries carry full diacritics.)

## Acceptance criteria

- `packages/i18n-catalogs/{en-US,pt-BR,es-419}.json` (or the equivalent namespaced files) contain every methodology key listed above, with diacritics correctly encoded.
- Each entry in the non-en-US catalogs carries a comment-equivalent flag (e.g., a sibling `*.review.json` file or a marker in a `_meta` block) marking "PENDING native-speaker + philosophical review" until each entry is signed off.
- The parity-check from `i18n_catalog_workflow` passes (every key present in `en-US` is present in `pt-BR` and `es-419`).
- A unit test exists that round-trips every English methodology value through `t('methodology.kind.fact')` etc. and asserts non-empty resolution in each locale.
- The `## Status` block on this refinement records the review chain — who reviewed each locale, on what date, and which entries were modified.

## Decisions

- **Mapping table above is the proposal.** Finalized only after review (see Open questions).
- **Keys are english-identifier-shaped.** Settled here to prevent re-discovery: `methodology.kind.fact` not `methodology.kind.factual` or `methodology.kind.empirical`. Wire-format identifiers ARE the keys.
- **No gendered-article variants in the catalog entry itself.** The bare noun ships; compositional strings (e.g., "Uma proposta foi feita") live in `chrome` or `diagnostics` namespaces and use ICU `{gender, select, ...}` for agreement.

## Open questions

- **All non-en-US entries above are PENDING review.** Specific flag-points per the plan §8:
  - **`predictive`** has competing pt-BR renderings: "Preditiva" (closer to formal philosophy of science usage) vs. "Previsao" (more colloquial). Same in es-419: "Predictiva" vs. "Prediccion". Initial value "Preditiva" / "Predictiva" is the formal-register choice; revisit if reviewers prefer the colloquial.
  - **`value` vs. `normative` in Portuguese** is delicate: "valor" can mean both "value claim" and "amount/worth"; "Juizo de valor" disambiguates but is longer and may not fit palette real estate. Same in Spanish ("valor" vs. "juicio de valor"). Initial value: bare "Valor"; revisit if disambiguation is needed.
  - **`definitional`** in pt-BR ("Definicional" vs. "De definicao") and es-419 — the former reads more like an english calque. Revisit.
  - **`bridges-from` / `bridges-to`** — the "bridge" metaphor works in english; "Ponte" / "Puente" are literal but directional suffixes may not feel idiomatic. Alternatives: "Origem da ponte" / "Destino da ponte". Revisit.
  - **`meta-disagreement`** — pt-BR "Meta-desacordo" is an english calque; native renderings may prefer "Desacordo de fundo" or similar. Same in es-419. Revisit.
- **Reviewer identification.** Who signs off each locale? Captured in the `## Status` block when this task ships.

## Status

**Done — 2026-05-11.**

Initial values for the canonical glossary landed in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` under the `methodology` namespace. Per the refinement, keys mirror the wire-format identifiers — `methodology.kind.fact`, `methodology.edgeRole.bridges-from`, `methodology.facetState.meta-disagreement`, `methodology.voteChoice.agree`, `methodology.annotationKind.scope-change`, `methodology.diagnostic.coherency-hint`. 29 total keys per locale (5 kinds + 7 edge roles + 4 facet states + 3 vote choices + 4 annotation kinds + 5 diagnostic kinds + 1 pre-existing `chrome.hello`).

Artifacts:

- `packages/i18n-catalogs/src/catalogs/en-US.json` — canonical English labels.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — initial pt-BR values per the glossary table; full diacritics.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — initial es-419 values per the glossary table; full diacritics.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — sibling review-tracker file flagging every methodology entry as PENDING native-speaker + philosophical review.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — sibling review-tracker file flagging every methodology entry as PENDING native-speaker + philosophical review.
- `packages/i18n-catalogs/src/methodology.test.ts` — round-trip vitest suite (91 cases): every methodology key resolves to a non-empty, non-key string in each locale; non-en-US locales translate (not copy) en-US except for the documented `defines` cognate; six fixed-expectation cases for canonical-translation regression.

Decisions made during implementation (all per the refinement's initial-value defaults; the Open questions remain open for reviewer revisit):

- Adopted the refinement table verbatim. No deviations from the proposed mapping.
- For `defines`, the English/pt-BR/es-419 renderings are identical ("Define"). The round-trip test's "non-en-US value differs from en-US" check carries an explicit `STRUCTURALLY_IDENTICAL` allow-list documenting this cognate is intentional, not a stub.
- "PENDING review" tracking lives in sibling `*.review.json` files (the refinement listed this and `_meta` block as alternatives); chose the sibling-file route to keep the catalog parity-check's leaf-walk uncluttered.

Review chain — none yet:

- pt-BR — PENDING; reviewer TBD; signed-off list empty.
- es-419 — PENDING; reviewer TBD; signed-off list empty.

Open questions from the refinement carry forward:

- All five flag-points (predictive, value/normative, definitional, bridges-from/to, meta-disagreement) remain open and will be revisited during native-speaker + philosophical review.
- Reviewer identification is still unsettled; the sibling `*.review.json` `signed_off` lists are the structured surface where reviewer + date land on sign-off.

Verifications:

- `pnpm --filter @a-conversa/i18n-catalogs run check` — parity check: 29 keys present in all 3 locales.
- `pnpm run check` — lint + format + typecheck across the workspace: green.
- `pnpm run test:smoke` — 1251 tests pass (includes the 91 new round-trip cases under `methodology.test.ts`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` — silent.
