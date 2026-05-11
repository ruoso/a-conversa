# Diagnostic kind -> localized description templates

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_diagnostic_descriptions`
**Effort estimate**: 1d
**Inherited dependencies**: `frontend_i18n.i18n_methodology_glossary` (must land first)

## What this task is

Land the ICU MessageFormat template strings that turn a structured diagnostic event (with typed payload — affected node ids, edge ids, edge role, etc.) into a human-readable description in each locale. The methodology labels inside each template (`supports`, `cycle`, etc.) interpolate from the glossary catalog landed by `i18n_methodology_glossary`.

## Why it needs to be done

Structural diagnostics (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`) are emitted by the methodology engine as typed events; the frontend renders them as human-readable prose in the diagnostic flag pane (moderator), the diagnostics view (participant), and the diagnostic-fire animation captioning (audience). The prose has to be locale-correct AND has to use the same methodology vocabulary as the rest of the UI.

## Inputs / context

- [docs/data-model.md](../../../docs/data-model.md) — structural diagnostics section: cycle, contradiction, multi-warrant, dangling-claim, coherency-hint. Authoritative on the diagnostic kinds and their payload shapes.
- `data_and_methodology.diagnostics.diagnostic_event_emission` — the task that emits the typed diagnostic events (the upstream the frontend templates consume).
- [`tasks/refinements/frontend-i18n/i18n_methodology_glossary.md`](./i18n_methodology_glossary.md) — the localized methodology labels these templates compose with.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — ICU MessageFormat support via `i18next-icu` is the substrate.

## Constraints / requirements

- **Catalog namespace**: `diagnostics`.
- **Key shape**: `diagnostics.{kind}.description` plus optional `diagnostics.{kind}.detail` for longer-form copy. Keys are english-identifier-shaped (`diagnostics.cycle.description`, `diagnostics.contradiction.description`, etc.).
- **Templates use ICU MessageFormat** for plurals and gender. Example:
  - `cycle.description` en-US: `"Cycle detected in {role} edges among: {nodes}"`
  - `cycle.description` pt-BR: `"Ciclo detectado nas arestas de {role} entre: {nodes}"`
  - `cycle.description` es-419: `"Ciclo detectado en aristas de {role} entre: {nodes}"`
  - `contradiction.description` en-US: `"{count, plural, one {# contradiction} other {# contradictions}} found"`
  - `contradiction.description` pt-BR: `"{count, plural, one {# contradicao encontrada} other {# contradicoes encontradas}}"`
  - `contradiction.description` es-419: `"{count, plural, one {# contradiccion encontrada} other {# contradicciones encontradas}}"`
- **Methodology terms compose via lookup, not literal text.** The template embeds `{role}` and the caller passes `t('methodology.edgeRole.supports')` rather than literal "supports" / "Apoia" / "Apoya". One source of truth (the glossary).
- **Per-kind templates**: at minimum one description per diagnostic kind per locale. Longer detail strings are optional but recommended for the diagnostic flag pane's expanded view.

## Acceptance criteria

- `packages/i18n-catalogs/*/diagnostics.json` (or the equivalent namespaced entries) contain a `description` (and optional `detail`) for each diagnostic kind, in each of the three locales.
- ICU plural / select syntax validates (a vitest smoke runs `IntlMessageFormat` against each template with sample payloads and asserts no parse errors).
- A vitest test exists that, given a sample diagnostic event payload for each kind, produces a non-empty rendered string in each locale and that the string contains the expected localized methodology terms.
- The parity-check from `i18n_catalog_workflow` passes.

## Decisions

- **ICU MessageFormat** is the template syntax (via `i18next-icu`). Settled by ADR 0024.
- **Methodology terms interpolate via separate `t(...)` calls.** Rationale: keeps the glossary the single source of truth; a change to the localized label for `supports` propagates into every diagnostic description without editing the description templates.
- **One description per kind per locale in v1.** Per-payload-shape variants (e.g., different prose for "cycle in supports edges" vs. "cycle in rebuts edges") are NOT in v1 — the `{role}` interpolation handles the variation. Revisit if reviewers find the generic template insufficient.
- **Coherency-hint prose** is the most open-ended; its template likely needs the most iteration during native-speaker review.

## Open questions

- **Pluralization sub-cases for "multi-warrant".** The kind name is singular ("multi-warrant"), but the diagnostic typically involves N warrants (N >= 2). The description should plural-agree on N. Initial template: `"{count, plural, =2 {Two warrants for the same conclusion: {nodes}} other {# warrants for the same conclusion: {nodes}}}"`. Pt-BR / es-419 equivalents need review.
- **Gender agreement** in the description prose for adjectives that compose with `{role}` or `{nodes}` — needs review with native speakers, especially in pt-BR where `Apoia` (verb) vs. `Apoio` (noun) interacts with the surrounding clause structure.
- **Methodology-suggestion prose** (the moderator-UI feature where each diagnostic kind suggests a resolution path) — does that go here or in a `chrome` namespace? Initial recommendation: here, under `diagnostics.{kind}.suggestion`. Revisit when `mod_diagnostic_methodology_suggestions` lands.
