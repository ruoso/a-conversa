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

## Status

**Done — 2026-05-11.**

Initial diagnostic-description templates landed under the new top-level `diagnostics` namespace in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`. The namespace was pre-declared empty by `i18n_methodology_glossary`; this task fills it.

Per the refinement, four sub-keys ship for each of the five diagnostic kinds (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`):

- `diagnostics.<kind>.title` — short panel label.
- `diagnostics.<kind>.description` — ICU MessageFormat templated prose with payload interpolation (`{role}`, `{nodes}`, `{count}`, `{kind}`).
- `diagnostics.<kind>.detail` — longer-form expanded copy for the diagnostic flag pane's expanded view (the "optional" detail the refinement recommended; landed in v1 to give the moderator-UI panel real content rather than a stub).
- `diagnostics.<kind>.action` — the moderator's typical next-step prose (the "methodology-suggestion prose" the Open questions section asked about; landed here per the section's initial recommendation; revisit when `mod_diagnostic_methodology_suggestions` lands).

Total: 20 new keys per locale (5 kinds * 4 subkeys). With the 29 methodology keys + the 9 chrome/auth keys already present, parity check now reports 65 keys present in all 3 locales.

Methodology terms compose via separate `t(...)` calls rather than literal text — `cycle.description` interpolates `{role}` and the test verifies that wiring `t('methodology.edgeRole.supports')` through the template produces the expected localized prose ("Supports" / "Apoia" / "Apoya"). Glossary remains the single source of truth.

Plural / select ICU branches:

- `contradiction.description` — `{count, plural, one {...} other {...}}` in all three locales.
- `multi-warrant.description` — `{count, plural, =2 {...} other {...}}` in all three locales (the `=2` exact-match captures the "Two warrants" / "Duas garantias" / "Dos garantías" common case per the refinement's Open Questions guidance).
- `coherency-hint.description` — `{count, plural, one {...} other {...}}` in all three locales.

Artifacts:

- `packages/i18n-catalogs/src/catalogs/en-US.json` — canonical English description templates.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — initial pt-BR description templates with full diacritics.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — initial es-419 description templates with full diacritics.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — extended with the 20 new entries flagged PENDING native-speaker + philosophical review.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — extended with the 20 new entries flagged PENDING native-speaker + philosophical review.
- `packages/i18n-catalogs/src/diagnostics.test.ts` — vitest suite (169 cases) covering: per-locale presence of the 4 required sub-keys for each of the 5 kinds; `IntlMessageFormat` parse validation of every template; per-kind sample-payload render through `t(...)`; glossary-composition assertion for `cycle.description` + `methodology.edgeRole.supports` in each locale; plural-branch arithmetic regression for `contradiction.description` and `multi-warrant.description`.

Decisions made during implementation:

- Adopted the refinement's `description` template shape verbatim. `cycle` interpolates `{role}` + `{nodes}`; `contradiction` pluralizes on `{count}`; `multi-warrant` selects on `{count}` with an `=2` exact branch + `other`; `dangling-claim` interpolates `{nodes}`; `coherency-hint` pluralizes on `{count}` and interpolates `{kind}`. The `dangling-claim` `description` does not pluralize because the detector emits one entry per affected node; the rendering surface aggregates.
- Coherency-hint `kind` is rendered as the raw hint identifier (e.g., `incomplete-warrant-missing-bridges-to`); a future task can compose a glossary lookup under `diagnostics.coherency-hint.<hintKind>` if reviewers find the raw identifier too cryptic.
- The methodology-suggestion prose landed under `diagnostics.<kind>.action` rather than a separate `suggestion` key, matching the user's task brief. Revisit if `mod_diagnostic_methodology_suggestions` needs a richer structure.
- pt-BR / es-419 entries are flagged PENDING review in the sibling `*.review.json` files (same pattern as `i18n_methodology_glossary`).

Open questions from the refinement carry forward:

- Pluralization sub-cases for "multi-warrant" — initial `=2 / other` shape landed per the refinement's proposal; native-speaker review may adjust.
- Gender agreement in pt-BR / es-419 prose — initial copy uses gender-neutral phrasings where possible; review pass should catch any awkward composition with `{role}` / `{nodes}`.
- Methodology-suggestion prose location — landed under `action`; revisit when `mod_diagnostic_methodology_suggestions` lands.

Verifications:

- `pnpm --filter @a-conversa/i18n-catalogs run check` — parity check: 65 keys present in all 3 locales.
- `pnpm run check` — lint + format + typecheck across the workspace: green.
- `pnpm run test:smoke` — 1670 tests pass (includes the 169 new cases under `diagnostics.test.ts`).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` — silent.
