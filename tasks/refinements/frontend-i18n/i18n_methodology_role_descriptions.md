# Edge-role description catalog entries (light up the hover-popover description seam)

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task
`frontend_i18n.i18n_methodology_role_descriptions`. Registered as tech debt by the
Closer of `moderator_ui.mod_graph_rendering.mod_edge_popover_full_target_wording`
(commit `8aa3cd7`) per the ORCHESTRATOR.md `b7c5ff0` tech-debt registration policy.

```
task i18n_methodology_role_descriptions "Add methodology.edgeRole.<role>.description entries to all v1 locale catalogs" {
  effort 0.5d
  allocate team
  depends !i18n_methodology_glossary
  note "Source of debt: mod_edge_popover_full_target_wording (commit 8aa3cd7) — the moderator edge popover wires a conditional render of methodology.edgeRole.<role>.description via i18next t.exists(). Once these entries land ... the popover automatically surfaces a one-sentence role description on hover; until then the key-existence check yields the role label alone."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

## Effort estimate

**0.5d.** Confirmed. The work is content design + catalog edits + a small consumer
migration (the existing `methodology.edgeRole.<role>` lookup pattern must move from
"value is a label string" to "value is a `{label, description}` object", mirroring
the established `moderator.modeBanner.<mode>.{label, description}` shape — see
Decisions below). Concretely:

- 7 roles × 3 locales = 21 description strings to author (en-US authoritative; pt-BR /
  es-419 as drafts pending native review per the glossary policy).
- 7 edgeRole entries × 3 locales = 21 small-shape migrations from `"<label>"` to
  `{ "label": "<label>", "description": "<sentence>" }`.
- 4 consumer call sites updated: `apps/moderator/src/graph/HoverPopover.tsx:252`,
  `apps/moderator/src/graph/StatementEdge.tsx:84`,
  `packages/i18n-catalogs/src/methodology.test.ts:111` (and `:176`),
  `packages/i18n-catalogs/src/diagnostics.test.ts:207, :216, :225`.
- 1 thin extension to Playwright Test 4 in `tests/e2e/moderator-hover-details.spec.ts`
  asserting the description renders on edge hover.
- 2 new Vitest cases on the consumer side (the existing `HoverPopover.test.tsx`
  conditional-render cases are flipped from "no description in en-US, addResource()
  to test the hit path" to "en-US description from the canonical catalog").
- 2 sibling `*.review.json` updates flagging the new pt-BR / es-419 entries as
  PENDING native-speaker review (same pattern as `i18n_methodology_glossary` and
  `i18n_diagnostic_descriptions`).

## Inherited dependencies

Settled:

- **`frontend_i18n.i18n_methodology_glossary`** (done — 2026-05-11; commit landed the
  7 `methodology.edgeRole.<role>` label entries in `en-US.json` / `pt-BR.json` /
  `es-419.json`, plus the 91-case round-trip test in `methodology.test.ts`, plus the
  sibling `*.review.json` review trackers). This task extends each edgeRole entry's
  shape from a bare label string to a `{label, description}` object — the labels
  themselves are not retranslated.
- **`moderator_ui.mod_graph_rendering.mod_edge_popover_full_target_wording`** (done —
  commit `8aa3cd7`; refinement
  [`mod_edge_popover_full_target_wording.md`](../moderator-ui/mod_edge_popover_full_target_wording.md)).
  The Closer of that task wired the conditional-render seam at
  `apps/moderator/src/graph/HoverPopover.tsx:264-266`:
  ```ts
  const roleDescriptionKey = `methodology.edgeRole.${role}.description`;
  const roleDescription = t(roleDescriptionKey);
  const hasRoleDescription = roleDescription !== roleDescriptionKey;
  ```
  Today every locale's lookup misses (the catalog has no `.description` entries),
  `hasRoleDescription` is `false`, and the popover omits the description paragraph.
  This task lands the catalog entries; the popover then automatically surfaces the
  description on hover without further code change at the popover level (modulo the
  small migration of the role-label lookup to the new `.label` sub-key — see
  Decisions for why that's part of the same task).
- **`frontend_i18n.i18n_catalog_workflow`** (done — the parity-check script and the
  CI plumbing are in place; the new `.description` entries flow through the same
  parity gate).

Pending edges this task does NOT depend on:

- A future `i18n_methodology_role_descriptions_native_review` leaf (registered by
  this task — see Acceptance criteria / Decisions). That follow-up replaces the
  pt-BR / es-419 drafts with reviewed strings; it is not a precondition for the
  popover surfacing a description (a draft is rendered just as readily as a
  reviewed string).
- `moderator_ui.mod_graph_rendering.mod_pan_zoom`, `mod_draw_edge_flow`, etc. —
  orthogonal.

## What this task is

Two intertwined deliveries:

1. **Catalog content.** Add a `description` sub-key to each of the seven
   `methodology.edgeRole.<role>` entries in each of the three v1 locale catalogs.
   Each description is a single sentence suitable for a hover-tooltip — concise,
   methodology-accurate, and complementing (not duplicating) the role label that
   already lives on the edge pill and at `methodology.edgeRole.<role>.label`. The
   seven roles (per `docs/data-model.md` lines 112–122):

   - `supports`
   - `rebuts`
   - `qualifies`
   - `bridges-from`
   - `bridges-to`
   - `defines`
   - `contradicts`

2. **Light migration of the role-label lookup.** The existing
   `methodology.edgeRole.<role>` entries are bare label strings (`"Supports"`,
   `"Apoia"`, `"Apoya"`). To make `methodology.edgeRole.<role>.description` resolve
   cleanly to a string in i18next's resource store, each entry shape changes from
   `"<role>": "<label>"` to `"<role>": { "label": "<label>", "description": "..." }`
   — the same shape used by `moderator.modeBanner.<mode>` in this catalog. Four
   consumer call sites (two `apps/moderator` files, two `packages/i18n-catalogs`
   tests) migrate from `t('methodology.edgeRole.<role>')` to
   `t('methodology.edgeRole.<role>.label')`. See Decisions for why this migration
   travels with the catalog content rather than being deferred.

The Playwright assertion in `tests/e2e/moderator-hover-details.spec.ts` Test 4
gains one positive line asserting the description renders on edge hover. The
existing Vitest conditional-render coverage in `HoverPopover.test.tsx` is updated
from "miss path is the default; addResource() exercises the hit path" to "hit path
is now the default for en-US; miss path is exercised via `i18next.removeResource()`
for one role to keep the omitted-DOM branch covered."

## Why it needs to be done

1. **Closes the tech debt registered by `mod_edge_popover_full_target_wording`.**
   The Closer of that task (commit `8aa3cd7`) wired the conditional render
   specifically because Option C of the popover refinement decided that descriptions
   were "content-translation work that wants its own refinement round" rather than
   the popover-code task's scope. The seam exists; the catalog content is the
   matching pair. Until this task ships, the popover renders the role label alone,
   which is what the role pill on the edge already shows — the popover under-earns
   its existence on the edge surface (it adds endpoint references but not the role's
   full meaning, which was the half of the design Option C named).

2. **Lights up a feature without further moderator-workspace code change.** Once
   the catalog entries exist and the role-label consumers migrate to `.label`, the
   popover automatically surfaces a one-sentence role description on every edge
   hover in every locale. No popover code change, no new component, no new test
   seam. The existing `data-hover-popover-section="role-description"` paragraph
   already renders conditionally; it simply starts being non-empty.

3. **Establishes the catalog pattern for "vocabulary entries with both a label and a
   gloss".** The methodology vocabulary will plausibly grow more such pairs in
   future tasks (kind descriptions, facet-state descriptions, diagnostic-kind
   one-liners) — each is the same shape: a wire-format identifier rendered as a
   short title-case label plus an optional sentence-length gloss. Migrating
   `methodology.edgeRole.<role>` to the `{label, description}` shape now and letting
   the pattern compose into the rest of the methodology namespace later is cheaper
   than retrofitting the shape every time a description is added downstream.

## Inputs / context

### Existing catalog files (line ranges as of this writing)

- `packages/i18n-catalogs/src/catalogs/en-US.json:37-45` — the `methodology.edgeRole`
  block (7 entries, each a bare label string today).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json:37-45` — same structure, pt-BR
  labels.
- `packages/i18n-catalogs/src/catalogs/es-419.json:37-45` — same structure, es-419
  labels.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json:11-17` — the review tracker
  flags the seven edgeRole label entries as PENDING. The new `.description` entries
  this task lands are flagged in the same `pending` list with their full dotted
  paths.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (mirror of pt-BR).

### The seam this task lights up

- `apps/moderator/src/graph/HoverPopover.tsx:264-266` — the conditional-render
  seam:
  ```ts
  const roleDescriptionKey = `methodology.edgeRole.${role}.description`;
  const roleDescription = t(roleDescriptionKey);
  const hasRoleDescription = roleDescription !== roleDescriptionKey;
  ```
- `apps/moderator/src/graph/HoverPopover.tsx:306-313` — the rendered description
  paragraph (`data-hover-popover-section="role-description"`), conditional on
  `hasRoleDescription`.

### Consumer call sites for the role label (migrate from `<role>` to `<role>.label`)

- `apps/moderator/src/graph/HoverPopover.tsx:252` —
  `const roleLabel = t(\`methodology.edgeRole.${role}\`);`. After this task:
  `t(\`methodology.edgeRole.${role}.label\`)`.
- `apps/moderator/src/graph/StatementEdge.tsx:84` —
  `const label = data?.role ? t(\`methodology.edgeRole.${data.role}\`) : '';`. After
  this task: `t(\`methodology.edgeRole.${data.role}.label\`)`.
- `packages/i18n-catalogs/src/methodology.test.ts:111` — the round-trip loop builds
  the key as `\`methodology.${group}.${id}\``; the `edgeRole` group's expected leaf
  becomes `<role>.label` for the label round-trip. The existing `STRUCTURALLY_
  IDENTICAL` allow-list entries for `defines` migrate from `methodology.edgeRole.
  defines` to `methodology.edgeRole.defines.label`.
- `packages/i18n-catalogs/src/methodology.test.ts:176` — the fixed-expectation
  `expect(t('methodology.edgeRole.bridges-from')).toBe('Ponte de')` becomes
  `expect(t('methodology.edgeRole.bridges-from.label')).toBe('Ponte de')`.
- `packages/i18n-catalogs/src/diagnostics.test.ts:207, :216, :225` — three lines
  inside the `cycle.description` ICU-composition cases use
  `t('methodology.edgeRole.supports')` for the role label interpolation; each
  migrates to `t('methodology.edgeRole.supports.label')`.

### Tests touched by this task

- `apps/moderator/src/graph/HoverPopover.test.tsx:350-367` — "does NOT render the
  role-description section when the catalog lacks ..." case. Update its premise:
  en-US now CARRIES descriptions, so this case switches its role from "supports"
  (which now has a description) to a synthetic role for which the test removes the
  description via `i18next.removeResource(...)` first. Alternatively, exercise the
  miss path by mounting a stripped-down i18n instance with the description resource
  absent. See Decisions.
- `apps/moderator/src/graph/HoverPopover.test.tsx:369-400` — "renders the
  role-description section when the catalog DOES carry ..." case. The current case
  uses `addResource()` to inject a synthetic description for `qualifies`. After
  this task the canonical catalog ALREADY carries descriptions; this case can drop
  the `addResource()` line and simply render the popover for the `qualifies` role,
  asserting the description paragraph contains the canonical en-US description text.
- `packages/i18n-catalogs/src/methodology.test.ts` — the round-trip loop's
  `edgeRole` entries migrate to `.label`. A NEW round-trip block lands for the
  `.description` sub-key, structurally parallel to the existing one: per-locale
  per-role assertion that the description resolves to a non-empty string and is not
  the dotted key itself. The `STRUCTURALLY_IDENTICAL` cognate set extends with the
  new `.label` entries for the pre-existing cognates (no change in coverage; just
  the path moves under `.label`).
- `tests/e2e/moderator-hover-details.spec.ts:200-212` — Test 4's edge-popover
  assertion block. Add a single positive assertion that the description paragraph
  is present and non-empty. Concretely:
  ```ts
  const descriptionRow = edgePopover.locator(
    '[data-hover-popover-section="role-description"]',
  );
  await expect(descriptionRow).toBeVisible();
  await expect(descriptionRow).not.toBeEmpty();
  ```
  Refrain from asserting the literal English text — the description text is a
  content decision that may revise; the structural assertion that "a non-empty
  description renders" is the load-bearing contract.

### Canonical role meanings (per `docs/data-model.md:116-122` and
       `docs/methodology.md`)

Used to author the en-US descriptions below. The descriptions in this refinement
are CANONICAL — the Implementer copies them verbatim into the catalog. The
en-US text is authoritative; pt-BR / es-419 ship as drafts pending native review.

| Role | Data-model gloss |
| --- | --- |
| `supports` | source provides evidence or backing for target. Covers data→claim and backing→warrant. |
| `rebuts` | source challenges or refutes target. |
| `qualifies` | source hedges the scope or degree of target ("usually", "in most cases", "except when X"). |
| `bridges-from` | outgoing from a warrant node to the data node it draws on. |
| `bridges-to` | outgoing from a warrant node to the claim node it licenses. |
| `defines` | source provides the meaning of a term used in target. |
| `contradicts` | source and target conflict; both cannot be true. Directed. |

## Constraints / requirements

- **One sentence per role per locale.** Each description is a single declarative
  sentence ending in a period. Concise, methodology-accurate, hover-tooltip-shaped.
  The popover renders the paragraph with `text-xs text-slate-600 leading-snug` so
  long descriptions wrap but no `line-clamp` truncates them; even so, aim for
  sentences that fit on one or two lines at the popover's `max-w-[24rem]` width.
- **Don't duplicate the role label.** The label already renders as the
  `data-hover-popover-section="role"` headline directly above the description, and
  on the edge pill itself. The description's job is to add the role's full meaning,
  not restate the role's name. Bad: "Supports — the supports role connects a source
  to a target it supports." Good: "Source provides evidence or backing for target."
- **Methodology-accurate phrasing.** Each description must be consistent with the
  canonical gloss in `docs/data-model.md:116-122` and with any methodology-specific
  framing in `docs/methodology.md`. Don't introduce concepts that don't appear in
  the data model (e.g., don't gesture at "warrants" in `supports`'s description if
  `supports` covers more than the data→claim move).
- **pt-BR and es-419 entries ship as DRAFTS.** Per `i18n_methodology_glossary`'s
  Status block, the methodology vocabulary is "technical philosophical vocabulary,
  not casual UI labels" — descriptions land flagged as PENDING native-speaker +
  philosophical review per locale. The drafts ship in this task to keep the catalog
  symmetric and the parity-check passing; the native review is a follow-up tech-debt
  task this refinement registers explicitly.
- **Catalog parity.** `pnpm --filter @a-conversa/i18n-catalogs run check` must pass
  — the 7 new `methodology.edgeRole.<role>.description` keys are present in all
  three locales (plus the 7 `methodology.edgeRole.<role>.label` keys that replace
  the bare-label entries — the parity check sees 7 net-new `.description` keys and
  observes that each pre-existing `<role>` leaf is now a `<role>.label` sub-leaf).
- **Methodology round-trip parity test extends.** A new `describe('methodology
  edgeRole description round-trip', ...)` block lands in `methodology.test.ts`
  parallel to the existing glossary round-trip; for each locale × each role it
  asserts (a) the description resolves to a non-empty string, (b) the description
  is not the dotted key itself, (c) for non-en-US locales the description is
  different from the en-US value (sanity: drafts translate, not copy — modulo any
  documented `STRUCTURALLY_IDENTICAL` entries which this task does NOT introduce
  for descriptions because no description is a one-word cognate). The existing
  edgeRole-label round-trip block is updated to read `.label`.
- **Sibling review files extend.** `pt-BR.review.json` and `es-419.review.json`
  each gain 7 new dotted-path entries under `pending`:
  `methodology.edgeRole.<role>.description` for each role. The `_comment` block
  in each file already explains the pending → signed_off lifecycle; no change to
  the schema.
- **i18n strict: no inline JSX.** The description renders through `t(...)`; no
  hardcoded English fallback in the popover. The seam already routes through
  `t(...)` so this constraint is automatic.
- **ADR 0022.** Every test listed above ships as committed test code, not as an
  in-PR verification.

## Acceptance criteria

- `packages/i18n-catalogs/src/catalogs/en-US.json` carries
  `methodology.edgeRole.<role>.{label, description}` for all 7 roles. Labels are
  preserved verbatim from the pre-task values; descriptions match the canonical
  en-US text under Decisions.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` carries the same shape with
  pt-BR labels (verbatim from pre-task) and pt-BR draft descriptions per
  Decisions.
- `packages/i18n-catalogs/src/catalogs/es-419.json` carries the same shape with
  es-419 labels (verbatim) and es-419 draft descriptions per Decisions.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` lists each of the 7
  `methodology.edgeRole.<role>.description` keys in `pending`. Same for
  `es-419.review.json`.
- `packages/i18n-catalogs/src/methodology.test.ts` — the existing `edgeRole`
  round-trip path is updated to read `.label`; a new round-trip block lands for the
  `.description` sub-key with parallel assertions; the canonical-translation
  smoke set extends with one fixed-expectation description per locale (e.g., the
  en-US `supports.description`).
- `apps/moderator/src/graph/HoverPopover.tsx:252` and
  `apps/moderator/src/graph/StatementEdge.tsx:84` migrate from `<role>` to
  `<role>.label`. The seam at lines 264–266 is **unchanged** (it already reads
  `.description`).
- `packages/i18n-catalogs/src/diagnostics.test.ts:207, :216, :225` migrate from
  `<role>` to `<role>.label`.
- `apps/moderator/src/graph/HoverPopover.test.tsx`:
  - The "renders the role-description section when the catalog DOES carry ..." case
    drops the `addResource()` line and asserts the canonical en-US description
    text from the canonical catalog.
  - The "does NOT render the role-description section when the catalog lacks ..."
    case keeps its DOM-absence assertion but exercises the miss path via
    `i18next.removeResource('en-US', 'translation', 'methodology.edgeRole.
    supports.description')` (or via a stripped-down per-test i18n instance with the
    description key absent). The omitted-DOM branch stays covered.
- `tests/e2e/moderator-hover-details.spec.ts` Test 4 asserts the
  `data-hover-popover-section="role-description"` paragraph is visible and
  non-empty when hovering the seeded `supports` edge. No literal-text assertion.
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes — 7 net-new
  `.description` keys present in all 3 locales; the pre-existing label entries
  re-shaped under `.label` are also parity-checked.
- `pnpm run check` (lint + format + typecheck) clean.
- `pnpm run test:smoke` green (test count delta: roughly +21 round-trip cases for
  `.description` across the 3 locales × 7 roles + 3 fixed-expectation description
  cases + 1 description-hit-path Vitest case net of the `addResource()` drop, ≈
  +24 tests).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test --project chromium-moderator-hover` green against the
  dev compose stack — Test 4's new description assertion lands.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/35-frontend-i18n.tji` gets `complete 100` on
  `i18n_methodology_role_descriptions` plus a `note "Refinement: tasks/refinements/
  frontend-i18n/i18n_methodology_role_descriptions.md"` line.
- **Follow-up tech debt registered in the same closing commit**: a new leaf task
  `frontend_i18n.i18n_methodology_role_descriptions_native_review` is added to
  `tasks/35-frontend-i18n.tji` with `effort 1d`, `depends !i18n_methodology_role_
  descriptions`, and a `note` citing this refinement's Decisions section as the
  trigger. The Closer adds this leaf when registering the debt per the
  ORCHESTRATOR.md `b7c5ff0` policy; the leaf's purpose is to land reviewed pt-BR /
  es-419 descriptions (replacing the drafts) and move the 14 dotted paths from
  `pending` to `signed_off` in the sibling review files.
- ADR 0022 — every verification ships as committed test code; no throwaway
  verifications.

## Decisions

### D1 — Catalog coverage strategy: **Option A (drafts in all 3 locales, marked as PENDING in sibling review files)**

Three options framed in the orchestrator brief; all three considered:

- **Option A — Land draft in all 3 locales with a `_draft_` marker.** **Chosen,**
  with a refinement: the "draft" marker is the existing sibling-`*.review.json`
  `pending` list, NOT a `_draft_` prefix in the catalog string. Rationale:
  - The conditional-render seam was specifically designed to handle "key exists"
    as the render trigger. With Option A, the seam lights up in every locale on
    day one; the moderator sees a one-sentence role description on hover in
    en-US / pt-BR / es-419 alike. This is the maximum-feature-coverage outcome.
  - The "pending review" provenance lives in `pt-BR.review.json` and
    `es-419.review.json`, the established pattern from `i18n_methodology_glossary`
    and `i18n_diagnostic_descriptions`. The catalog string itself stays clean —
    no `(draft)` suffix leaking into production renders.
  - A draft authored by the implementer (informed by the canonical en-US text and
    a Romance-language sense of style) is good enough for a hover tooltip during
    v1 development; the native-review follow-up replaces it with the reviewed
    string when a reviewer is available. The cost of "wrong word choice for one
    sentence in a hover tooltip" is low; the cost of "no description in pt-BR /
    es-419 for an indefinite period" is moderate (the seam is dark in those
    locales until review).

- **Option B — Land en-US only; leave pt-BR / es-419 entries absent.** Rejected.
  The seam handles missing keys cleanly, so this works, BUT (a) the parity test
  must accept the asymmetry, which weakens its load-bearing role as a missing-key
  detector ("every key in en-US must appear in pt-BR / es-419" is the parity
  contract; carving out methodology descriptions as an exception is a precedent
  this codebase has actively avoided), and (b) the seam stays dark in two of the
  three v1 locales for an indefinite period. The brief explicitly recommends
  against this option.

- **Option C — Land en-US + machine-translated pt-BR / es-419 with a clear
  `(machine-translated, pending review)` suffix.** Rejected. Visible
  "pending review" text in production looks unfinished and trains the moderator
  to ignore the description line entirely (banner blindness). The
  sibling-`*.review.json` route in Option A surfaces the pending state to the
  catalog reviewer without leaking into the rendered UI.

Option A's draft-quality bar: the implementer authors pt-BR / es-419 descriptions
informed by (a) the canonical en-US text from this refinement, (b) the existing
pt-BR / es-419 label translations in `methodology.edgeRole.<role>.label` (the
methodology glossary), and (c) the canonical role gloss in `docs/data-model.md:
116-122`. Honest framing: this is a Romance-language calque of the en-US
description, not a native-speaker rewriting. The review follow-up may rewrite
substantially.

### D2 — Catalog key placement: **`methodology.edgeRole.<role>.{label, description}` (the modeBanner shape)**

Three placements considered:

- **D2.a — `methodology.edgeRole.<role>` stays a label string;
  `methodology.edgeRoleDescription.<role>` is a sibling subtree carrying
  descriptions.** Rejected. The seam at `HoverPopover.tsx:264` literally reads
  `methodology.edgeRole.${role}.description`; placing descriptions under
  `methodology.edgeRoleDescription.<role>` would require editing the moderator
  workspace's popover code, which contradicts the orchestrator brief's framing
  ("the popover automatically surfaces a one-sentence role description on hover
  ... no code change required"). The seam was designed for the `<role>.description`
  path; this task honors that design.

- **D2.b — Keep `<role>` as a string AND store `<role>.description` as a literal
  dotted JSON key alongside it.** Rejected. JSON keys with literal dots are exotic
  in this codebase (no other catalog entry uses them); they confuse readers
  scanning the catalog and confuse static analysis tools that follow i18next key
  conventions. The behavior would also depend on i18next's resource-store key
  parsing in a way that's not load-bearing-documented anywhere in the codebase
  (the existing `HoverPopover.test.tsx` test uses `addResource()` to inject the
  dotted-key resource at runtime; whether the same shape parses cleanly from
  JSON at init time is i18next-internal behavior). Not a foundation to build on.

- **D2.c — Migrate `<role>` from a bare label string to a `{label, description}`
  object, mirroring `moderator.modeBanner.<mode>.{label, description}`.**
  **Chosen.** Rationale:
  - The modeBanner shape is the established precedent in this catalog for
    "vocabulary entries with a label and a sentence-length gloss." Reusing it
    keeps the catalog's structural vocabulary small.
  - The migration cost is modest — 4 consumer call sites, all in workspaces this
    task already touches (moderator + i18n-catalogs).
  - The same shape composes naturally to future tasks that want descriptions for
    `methodology.kind.<kind>` or `methodology.facetState.<state>` (each is the
    same "label + optional one-sentence gloss" pattern).
  - The seam reads `<role>.description` directly; with this shape the JSON-to-
    resource-store parse is unambiguous and uses i18next's documented nested-object
    walk.

### D3 — Light-touch consumer migration travels with the catalog content (NOT a separate task)

Two scopes considered:

- **D3.a — This task is catalog-content-only; the consumer migration is a
  separate follow-up.** Rejected. The migration is mechanical (4 lines across 4
  files) and atomic with the JSON shape change — splitting them produces a commit
  state where the catalog is one shape and the consumers expect another, breaking
  every edge-rendering Vitest case mid-stream. Not a clean atomic delivery.

- **D3.b — Migration travels with the content.** **Chosen.** The catalog content,
  the JSON shape change, the four consumer call-site edits, the four test-file
  edits, and the Playwright extension all land in one commit. The shape change is
  the load-bearing "what shape does this catalog entry have?" decision; landing it
  in the same task that needs it is the cleanest cut.

### D4 — Follow-up native-review task: `i18n_methodology_role_descriptions_native_review` (registered by the Closer)

The Closer of this task registers a new leaf in `tasks/35-frontend-i18n.tji`:

```
task i18n_methodology_role_descriptions_native_review "Reviewed pt-BR / es-419 role descriptions (replace drafts; sign off review trackers)" {
  effort 1d
  allocate team
  depends !i18n_methodology_role_descriptions
  note "Source of debt: i18n_methodology_role_descriptions landed drafts in pt-BR / es-419 per the glossary review policy. This task replaces the drafts with native-speaker + philosophically-vetted strings, then moves the 14 dotted paths from `pending` to `signed_off` in the sibling review trackers."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md (commit b7c5ff0)."
}
```

The Closer also adds the `complete 100` marker to the parent task in the same
commit and updates this refinement's `## Status` section with a pointer to the new
leaf's WBS path. The follow-up does NOT block this task's completion — the seam
is lit in all three locales on day one; the follow-up upgrades the pt-BR / es-419
quality to native-reviewed.

### D5 — Playwright assertion is a thin extension of Test 4 (NOT a new spec)

Considered alternatives:

- **D5.a — New Playwright spec
  `tests/e2e/moderator-edge-role-description.spec.ts`.** Rejected. The setup
  (loginAs + session-create + seedWsStore + edge-hover) overlaps totally with
  Test 4 in `moderator-hover-details.spec.ts`. A new spec duplicates the
  boilerplate for one positive assertion.

- **D5.b — Extend Test 4 with the description-visible / description-non-empty
  assertions.** **Chosen.** Same rationale as `mod_edge_popover_full_target_
  wording`'s in-place test extension. Test 4 already hovers the edge and asserts
  on `data-hover-popover-section="*"` rows; adding one more row's presence check
  is mechanical. The frontend-i18n stream policy (per the orchestrator brief)
  does not impose the strict UI-stream e2e isolation requirement on this task.

### D6 — Vitest miss-path coverage stays via `removeResource()` (NOT a separate i18n instance)

The current `HoverPopover.test.tsx:350-367` case relies on the canonical catalog
having NO description for `supports` — the test asserts the description paragraph
is absent. After this task, the canonical catalog DOES carry a description for
every role, so the miss path needs an alternative trigger:

- **D6.a — Build a stripped-down per-test i18n instance with the description
  resource absent.** Heavier setup; duplicates the existing `beforeEach`'s
  `initI18n('en-US')` work.

- **D6.b — Use `i18next.removeResource('en-US', 'translation',
  'methodology.edgeRole.supports.description')` at the top of the case, then
  render the popover with `role: 'supports'`, then assert the description
  paragraph is absent.** **Chosen.** Mirrors the existing pattern (the next-test
  `beforeEach` calls `initI18n('en-US')` which resets the resource store, so the
  removal does not leak across tests). One-line change to the existing case.

## Authoritative en-US descriptions (Implementer copies verbatim)

The Implementer copies these strings into
`packages/i18n-catalogs/src/catalogs/en-US.json` as the `.description` sub-key
under each role:

| Role | en-US description |
| --- | --- |
| `supports` | Source provides evidence or backing for target. |
| `rebuts` | Source challenges or refutes target. |
| `qualifies` | Source hedges the scope or degree of target — "usually", "in most cases", "except when X". |
| `bridges-from` | Outgoing from a warrant node to the data it draws on. |
| `bridges-to` | Outgoing from a warrant node to the claim it licenses. |
| `defines` | Source provides the meaning of a term used in target. |
| `contradicts` | Source and target conflict; both cannot be true. |

Authoring notes:
- Each sentence ends with a period (matches the diagnostic-description sentence
  style landed by `i18n_diagnostic_descriptions`).
- `qualifies` uses em-dash separator (U+2014) before the parenthetical
  examples — same typography policy as the rest of the catalog (the
  `typography.ts` codepoint-range allow-list covers Latin Extended-A + General
  Punctuation).
- `bridges-from` / `bridges-to` mirror each other's phrasing intentionally — the
  hover-popover is the first place a moderator encounters this directional
  asymmetry, and the parallel phrasing makes the asymmetry legible.
- `contradicts` omits the "Directed." note from the data-model gloss; the
  directionality is shown by the edge arrow on the canvas and does not need
  restating in the hover tooltip.

## Draft pt-BR descriptions (Implementer copies; flagged PENDING in pt-BR.review.json)

| Role | pt-BR draft description |
| --- | --- |
| `supports` | A fonte fornece evidência ou base para o alvo. |
| `rebuts` | A fonte contesta ou refuta o alvo. |
| `qualifies` | A fonte restringe o escopo ou o grau do alvo — "geralmente", "na maioria dos casos", "exceto quando X". |
| `bridges-from` | Sai de um nó de garantia em direção ao dado em que ele se apoia. |
| `bridges-to` | Sai de um nó de garantia em direção à afirmação que ele autoriza. |
| `defines` | A fonte fornece o significado de um termo usado no alvo. |
| `contradicts` | A fonte e o alvo se opõem; ambos não podem ser verdadeiros. |

These are calques of the en-US text informed by the existing pt-BR labels in
`methodology.edgeRole.<role>.label`. Flagged PENDING in `pt-BR.review.json`;
the native-review follow-up replaces them.

## Draft es-419 descriptions (Implementer copies; flagged PENDING in es-419.review.json)

| Role | es-419 draft description |
| --- | --- |
| `supports` | La fuente aporta evidencia o respaldo al objetivo. |
| `rebuts` | La fuente impugna o refuta el objetivo. |
| `qualifies` | La fuente acota el alcance o el grado del objetivo — "generalmente", "en la mayoría de los casos", "excepto cuando X". |
| `bridges-from` | Sale de un nodo de garantía hacia el dato en que se apoya. |
| `bridges-to` | Sale de un nodo de garantía hacia la afirmación que autoriza. |
| `defines` | La fuente aporta el significado de un término usado en el objetivo. |
| `contradicts` | La fuente y el objetivo se oponen; ambos no pueden ser verdaderos. |

These are calques of the en-US text informed by the existing es-419 labels in
`methodology.edgeRole.<role>.label`. Flagged PENDING in `es-419.review.json`;
the native-review follow-up replaces them.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-15.**

- **Coverage strategy:** Option A landed. Drafts in all three v1 locales (en-US
  authoritative; pt-BR + es-419 as drafts) so the conditional-render seam at
  `HoverPopover.tsx:264-266` lights up on day one in every locale; no production
  `(draft)` suffix in catalog strings. PENDING provenance lives in the sibling
  `*.review.json` trackers per the glossary policy.
- **JSON shape migration is atomic with consumer migration.**
  `methodology.edgeRole.<role>` moves from a bare label string to a
  `{label, description}` object (mirroring `moderator.modeBanner.<mode>`). The
  four consumer call sites — `HoverPopover.tsx:252`, `StatementEdge.tsx:84`,
  `methodology.test.ts:111+176`, `diagnostics.test.ts:207/216/225` — migrate
  from `t('methodology.edgeRole.<role>')` to
  `t('methodology.edgeRole.<role>.label')` in the same commit.
- **21 verbatim description sentences** landed in
  `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — the en-US,
  pt-BR, and es-419 tables in the Authoritative / Draft sections above are
  copied into the catalogs as-is.
- **Review trackers extended.** `pt-BR.review.json` and `es-419.review.json`
  each gain 14 PENDING entries (7 new `.description` paths + 7 repointed
  `.label` paths for the pre-existing labels under the new shape).
- **e2e Test 4 extension.** `tests/e2e/moderator-hover-details.spec.ts` Test 4
  asserts the `data-hover-popover-section="role-description"` paragraph is
  visible and non-empty on edge hover. No literal-text pin — content stays
  revisable per D5.
- **Follow-up native-review task registered** in the same commit:
  `frontend_i18n.i18n_methodology_role_descriptions_native_review` in
  `tasks/35-frontend-i18n.tji` per D4 and the ORCHESTRATOR.md `b7c5ff0`
  tech-debt registration policy. Replaces pt-BR / es-419 drafts with reviewed
  text and signs off the 14 PENDING tracker entries.
- **Closes the conditional-render-seam debt** registered by
  `mod_edge_popover_full_target_wording` (commit `8aa3cd7`) — the popover now
  surfaces a one-sentence role description on every edge hover in every locale
  with no popover-code change.

### Verification
- `pnpm run check` — green.
- `pnpm run test:smoke` — 2535 passing (was 2510; +25).
- i18n-catalogs workspace — 532/532 (8 files); parity 148 keys × 3 locales.
- Moderator workspace — 637/637 (23 files).
- Playwright (all 3 specs, 7 tests) — pass in 13.7s.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` — silent (with the new
  tech-debt task block).
