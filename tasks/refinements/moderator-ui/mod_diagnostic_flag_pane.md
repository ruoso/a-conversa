# mod_diagnostic_flag_pane — Diagnostic flags pane in sidebar

## TaskJuggler entry

- WBS: `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane`
- Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) (the
  `task mod_diagnostic_flag_pane "Diagnostic flags pane in sidebar"` block,
  L570-573, inside `task mod_diagnostic_resolution_flow "F7 — Resolve a
  structural diagnostic"` L568).

## Effort estimate

`1d` (per the `.tji` block).

## Inherited dependencies

The leaf has no direct `depends`; it inherits the parent
`mod_diagnostic_resolution_flow` dependency set (L569):

**Settled (shipped):**

- `mod_diagnostic_flow` (the whole F3 diagnostic surface) — in particular
  `mod_diagnostic_methodology_suggestions` shipped the
  `DiagnosticSuggestionsPanel` that already occupies the `diagnostic-flags`
  slot, and `mod_diagnostic_highlighting` shipped the
  `affectedEntities(payload)` / `projectDiagnosticHighlights(...)` helpers.
  See `tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md`
  and `…/mod_diagnostic_highlighting.md`.
- `root_app.root_moderator_cutover` — the moderator app is the live root
  surface; `apps/moderator/src/routes/Operate.tsx` renders the right sidebar.
- `data_and_methodology.diagnostics.blocking_vs_advisory_classification` —
  `classifyDiagnostic(entry)` ships at
  `apps/server/src/diagnostics/classification.ts:81-125`; the `severity`
  field (`'blocking' | 'advisory'`) already rides on every `DiagnosticPayload`
  envelope, so the pane reads severity directly off the wire — no
  re-classification client-side.
- `frontend_i18n.i18n_diagnostic_descriptions` — the per-kind localized
  strings `diagnostics.<kind>.title` / `.description` / `.detail` / `.action`
  exist in all three catalogs
  (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`,
  en-US at L841-870). The pane reuses these; it coins no new per-kind
  diagnostic strings.

**Pending:** none — every dependency above is shipped.

## What this task is

The `diagnostic-flags` sub-pane of the moderator's right sidebar currently
mounts `<DiagnosticSuggestionsPanel>` (`apps/moderator/src/routes/Operate.tsx:338`),
which renders **one** auto-focused diagnostic and its methodology-suggestion
chips. This task adds the **flag list**: a `<DiagnosticFlagPane>` that renders
**every** active diagnostic as a flag row — severity badge + localized kind
title + one-line action prose — sorted blocking-first, then oldest-first. The
flag pane wraps (does not delete) the existing suggestions panel: the list sits
above it, and the auto-focused flag (the row the suggestions panel is showing)
is marked `data-focused="true"` for visual continuity.

Flag rows are **presentational** in this leaf — they carry stable
`data-diagnostic-*` seams but no click handler. Turning a flag click into a
canvas-focus gesture is the very next leaf,
`mod_diagnostic_focus_action` (L579-583); turning the suggestion chips into
real propose-actions is `mod_resolution_path_picker` (L585-590). This task is
the "render the whole list" step in the established
render-now/wire-later cadence both predecessors used (highlighting is
visual-only; suggestion chips are disabled placeholders).

## Why it needs to be done

`mod_diagnostic_resolution_flow` (F7) is the moderator's loop for resolving a
structural diagnostic. The auto-focus suggestions panel answers "what should I
do about *the* most urgent diagnostic?" but gives the moderator no view of the
full backlog — how many flags are open, which are blocking, what else is
advisory. The flag pane is the inventory view that the rest of F7 hangs off:

- `mod_blocking_diagnostic_banner` (L574-577, `depends !mod_diagnostic_flag_pane`)
  needs a rendered flag inventory to summarize "N blocking diagnostics open."
- `mod_diagnostic_focus_action` (L579-583, `depends !mod_diagnostic_flag_pane`)
  attaches the click-to-focus gesture to **the flag rows this task renders**,
  stamping `data-suggestion-affected-nodes` / `…-edges` via the shipped
  `affectedEntities(payload)` helper.
- `mod_resolution_path_picker` (L585-590) drives the suggestion chips for the
  focused flag.

## Inputs / context

- `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx:65-85` —
  `pickFocusedDiagnostic(activeDiagnostics)`: the ordering rule (blocking
  before advisory → ascending `sequence` → `diagnosticIdentityKey`
  lexicographic tiebreak). The flag pane needs **the same total order** to list
  the flags; this leaf extracts that comparator so both call sites share one
  definition (see Decision D2).
- `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx:87-166` — the
  shipped panel: store selector at L90-92
  (`state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS`),
  the `EMPTY_ACTIVE_DIAGNOSTICS` stable-reference guard (L45), the
  rose/amber/empty Tailwind palettes (L47-55), and the `data-diagnostic-kind` /
  `data-diagnostic-severity` / `data-diagnostic-key` seam set (L127-129).
- `apps/moderator/src/layout/RightSidebar.tsx:35-39, 77-80, 133-148` — the
  `diagnosticFlagsSlot` prop and the `right-sidebar-pane-body-diagnostic-flags`
  host the pane renders into. The slot comment at L10/L35 explicitly names
  `mod_diagnostic_flag_pane` as the owner.
- `apps/moderator/src/routes/Operate.tsx:94, 338` — the import and the
  current `diagnosticFlagsSlot={<DiagnosticSuggestionsPanel sessionId={…} />}`
  mount that this task swaps for `<DiagnosticFlagPane sessionId={…} />`.
- `packages/shared-types/src/ws-envelope.ts:1584-1591` — `DiagnosticPayload`
  (`sessionId`, `kind: WsDiagnosticKind`, `severity: WsDiagnosticSeverity`,
  `status`, `sequence`, `diagnostic`). The kind enum (`wsDiagnosticKinds`,
  L1522-1528) and severity enum (`wsDiagnosticSeverities`, L1539) bound the
  rendered set.
- `packages/shell/src/diagnostics/diagnostic-highlights.ts:205-223` —
  `diagnosticIdentityKey(payload)` (re-exported from `@a-conversa/shell`,
  already imported by the suggestions panel at
  `DiagnosticSuggestionsPanel.tsx:31`); the per-flag row key.
- `packages/i18n-catalogs/src/catalogs/en-US.json:632-660` — the
  `moderator.diagnostic.suggestions.*` chrome namespace this task extends with
  a sibling `moderator.diagnostic.flags.*` block; `…:841-870` — the reused
  per-kind `diagnostics.<kind>.title` / `.action` strings.
- `apps/moderator/src/layout/DiagnosticSuggestionsPanel.test.tsx:39-88` —
  the inline payload builders (`cycleFiredPayload`, `contradictionFiredPayload`,
  `multiWarrantFiredPayload`) and the
  `applyDiagnostic(payload)` → `useWsStore.getState().applyDiagnostic(...)`
  test seam this leaf's Vitest reuses.
- `tests/e2e/audience-live-session.spec.ts` (the `applyDiagnostic(page, payload)`
  backdoor helper) + `tests/e2e/fixtures/wsStoreSeed.ts` (`seedWsStore`) +
  `apps/moderator/src/main.tsx:35-55` (`window.__aConversaWsStore`) — the
  proven path for seeding a `fired` diagnostic into the moderator client in
  Playwright (see Decision D5).

## Constraints / requirements

1. **New component, slot swap only.** Add
   `apps/moderator/src/layout/DiagnosticFlagPane.tsx` exporting
   `<DiagnosticFlagPane sessionId={…} />`. The only edit to `Operate.tsx` is
   swapping the `diagnosticFlagsSlot` value (L338) and its import (L94). Do
   **not** delete `DiagnosticSuggestionsPanel`; the flag pane renders it for the
   focused flag.
2. **Read the wire, don't recompute.** Severity comes from
   `payload.severity`; the kind from `payload.kind`. No client-side
   re-classification (ADR 0027 — the pane is an entity-layer reader, it neither
   emits nor consumes facet-layer events). Use the same
   `state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS`
   selector + stable empty-reference guard as the suggestions panel to avoid the
   fresh-`Map`-per-read re-render loop.
3. **One ordering, shared.** Extract the `pickFocusedDiagnostic` comparator
   into a reusable `orderActiveDiagnostics(activeDiagnostics): DiagnosticPayload[]`
   (blocking → ascending sequence → identity-key tiebreak). `pickFocusedDiagnostic`
   becomes `orderActiveDiagnostics(...)[0] ?? null`; the flag pane lists
   `orderActiveDiagnostics(...)` top-to-bottom. The flag list and the suggestions
   panel must never disagree about which flag is "first/focused."
4. **Per-row seams (stable contract for the next two leaves).** Each flag row
   is a list item carrying:
   - `data-testid="diagnostic-flag-row"`,
   - `data-diagnostic-key={diagnosticIdentityKey(payload)}`,
   - `data-diagnostic-kind={payload.kind}`,
   - `data-diagnostic-severity={payload.severity}`,
   - `data-focused="true"` on the single auto-focused row (the
     `orderActiveDiagnostics(...)[0]`), `"false"` on the rest.
   These mirror the suggestions-panel seam vocabulary so
   `mod_diagnostic_focus_action` can attach its click handler and
   `affectedEntities`-derived `data-suggestion-affected-*` seams without a
   markup refactor.
5. **Row content.** Severity badge (localized
   `moderator.diagnostic.flags.severity.{blocking|advisory}`), the localized
   kind title `t('diagnostics.<kind>.title')`, and the one-line
   `t('diagnostics.<kind>.action')` prose. Reuse the rose (blocking) / amber
   (advisory) palette constants already defined in the suggestions panel —
   hoist them alongside the shared comparator rather than re-declaring (ADR
   0005, Tailwind).
6. **Empty state.** When `activeDiagnostics.size === 0`, render the empty
   message (reuse `moderator.diagnostic.suggestions.empty` —
   "No active diagnostics") and do **not** render an empty flag list; the
   suggestions panel already shows its own empty state, so the pane shows one
   empty message, not two.
7. **i18n (ADR 0024).** Add a `moderator.diagnostic.flags` block —
   `header` ("Diagnostic flags"), `severity.blocking`, `severity.advisory`,
   `countAria` (e.g. "{count, plural, one {# active diagnostic} other
   {# active diagnostics}}") — to all three catalogs
   (`en-US`, `pt-BR`, `es-419`). Non-English values are machine-drafted and must
   be entered into the `*.review.json` `pending` lists for native-speaker
   sign-off (the parity test ignores `*.review.json` by filename). Coin **no**
   new per-kind diagnostic strings — reuse `diagnostics.<kind>.*`.
8. **No new wire envelope, no new store field, no new CaptureMode.** The pane is
   pure read-side chrome over the already-shipped `activeDiagnostics` map.
9. **Accessibility.** The flag list is a `<ul>`/`<li>`; the focused row carries
   `aria-current="true"`. The pane root keeps `role="region"` with an
   `aria-label` from `moderator.diagnostic.flags.header`.

## Acceptance criteria

All empirical checks ship as committed tests (ADR 0022 — no throwaway
verifications).

1. **Vitest — `orderActiveDiagnostics`** (`apps/moderator/src/layout/`
   co-located, or alongside the extracted helper): blocking sorts before
   advisory; within a severity, ascending `sequence`; identity-key tiebreak for
   equal sequence; empty map → `[]`. The existing
   `DiagnosticSuggestionsPanel.test.tsx` focus-pick cases keep passing against
   the refactored `orderActiveDiagnostics(...)[0]`.
2. **Vitest — `DiagnosticFlagPane.test.tsx`** (Testing Library, reusing the
   `applyDiagnostic(payload)` seam and the `*FiredPayload` builders from
   `DiagnosticSuggestionsPanel.test.tsx`):
   - empty store → one `diagnostic-flag-empty` message, no flag rows;
   - one blocking cycle + one advisory multi-warrant seeded → exactly two
     `diagnostic-flag-row`s, the cycle first with `data-focused="true"` and
     `data-diagnostic-severity="blocking"`, the multi-warrant second with
     `data-focused="false"`;
   - each row shows `t('diagnostics.<kind>.title')` and its severity badge;
   - the embedded `diagnostic-suggestions-panel` focuses the same flag whose row
     is `data-focused="true"` (continuity check — same `data-diagnostic-key`);
   - i18n catalog-parity: the new `moderator.diagnostic.flags.*` keys resolve in
     en-US / pt-BR / es-419 (the existing parity test in
     `packages/i18n-catalogs` enforces this at CI; assert the keys render here).
3. **Playwright — `tests/e2e/moderator-diagnostic-flag-pane.spec.ts`**
   (e2e is **in scope, not deferred** — the pane is route-rendered at
   `Operate.tsx:338` and a `fired` diagnostic is seedable today via the
   `window.__aConversaWsStore` backdoor; see Decision D5). Under a
   `chromium-create-session`-style project that reaches `/m/sessions/:id/operate`
   (create session → seed participants → enter session → `seedWsStore` a small
   graph): seed a blocking `cycle` and an advisory `multi-warrant` via
   `applyDiagnostic(page, payload)`, then assert the
   `right-sidebar-pane-body-diagnostic-flags` body contains two
   `diagnostic-flag-row`s in blocking-first order with the correct
   `data-diagnostic-kind` / `data-diagnostic-severity` seams and the top row
   `data-focused="true"`; assert the empty case (no diagnostics seeded → empty
   message, zero rows). A moderator-side `applyDiagnostic(page, payload)` helper
   (mirroring the audience spec's) is added to `tests/e2e/fixtures/wsStoreSeed.ts`
   if not reusable as-is.
4. `make build` and the moderator + e2e test suites pass; the i18n parity check
   is green.

## Decisions

- **D1: Flag pane wraps the suggestions panel; it does not replace it.** The
  `diagnostic-flags` slot becomes `<DiagnosticFlagPane>`, which renders the flag
  list **and** mounts the shipped `<DiagnosticSuggestionsPanel>` for the focused
  flag. *Alternatives:* (a) replace the suggestions panel with a richer
  list-plus-inline-chips component — rejected: throws away shipped, tested
  markup and the stable `data-suggestion-*` chip contract that
  `mod_resolution_path_picker` already targets (L589); (b) render the list as a
  *sibling* slot — rejected: there is one `diagnostic-flags` slot and the
  RightSidebar comment (L10/L35) names this task as its single owner. Wrapping
  preserves both predecessors' contracts and matches the suggestions panel's own
  forecast ("that future task can wrap or replace the panel without re-arranging
  the layout," `DiagnosticSuggestionsPanel.tsx:18-20`).

- **D2: One shared total order (`orderActiveDiagnostics`).** Extract the
  comparator from `pickFocusedDiagnostic` so the list and the focus-pick are
  defined by the same function; `pickFocusedDiagnostic` reduces to
  `orderActiveDiagnostics(...)[0] ?? null`. *Alternative:* duplicate the
  blocking→sequence→identity comparator in the pane — rejected: two copies drift,
  and a list whose top row disagrees with the focused suggestion would be a
  confusing, untestable seam. The shared helper lives next to the palettes both
  components consume.

- **D3: Flag rows are presentational in this leaf (no click handler).** Rows
  carry the full `data-diagnostic-*` seam set and a `data-focused` marker but no
  `onClick`. *Rationale:* click-to-focus-the-canvas is the explicitly separate
  next leaf `mod_diagnostic_focus_action` (L579-583), which "inherits the
  affected-entity seam contract" and will add the
  `data-suggestion-affected-nodes/-edges` seams via the shipped
  `affectedEntities(payload)` helper. This is the same render-now/wire-later
  split the predecessors used (visual-only highlighting; disabled suggestion
  chips). Shipping inert rows with stable seams lets that leaf be a
  handler-addition diff, not a markup rewrite.

- **D4: Auto-focused row marked, selection state not introduced.** The pane does
  not add a `selectedDiagnosticKey` store field or local selection state; the
  "focused" flag is purely derived (`orderActiveDiagnostics(...)[0]`) and marked
  `data-focused="true"` / `aria-current`. *Alternative:* introduce user-driven
  selection now (click a row → it becomes focused) — rejected: that is the
  behavior `mod_diagnostic_focus_action` owns, and introducing a selection store
  field here would pre-empt that leaf's design while adding scope this 1d task
  doesn't need. Deriving focus keeps the pane a pure function of
  `activeDiagnostics`.

- **D5: e2e is in scope — pay it down here, do not defer to
  `mod_pw_diagnostic_flow`.** The pane is route-rendered (`Operate.tsx:338`) and
  a `fired` `DiagnosticPayload` can be injected into the live moderator client
  in Playwright today via the `window.__aConversaWsStore` backdoor
  (`apps/moderator/src/main.tsx:35-55`) using the same `applyDiagnostic(page,
  payload)` pattern proven in `tests/e2e/audience-live-session.spec.ts`. The
  UI-stream e2e policy reads "not yet reachable" strictly (no route AND no event
  surface) — neither holds here. Additionally, `mod_pw_diagnostic_flow` is named
  as a deferral target by **8 prior refinements** yet is **not a registered WBS
  task** — a planning-debt sink. Adding a ninth deferral would worsen it, so this
  task scopes a small, self-contained moderator Playwright spec inline instead.
  *Alternative:* defer to `mod_pw_diagnostic_flow` like
  `mod_diagnostic_methodology_suggestions` did (its Decision §D7) — rejected on
  both the strict-reachability reading and the debt-paydown rule.

- **D6: Reuse `diagnostics.<kind>.title` / `.action`; add only flag-chrome
  keys.** The per-kind strings are owned by
  `frontend_i18n.i18n_diagnostic_descriptions` and already exist in all locales
  (en-US L841-870). The pane adds only `moderator.diagnostic.flags.*` chrome
  (header, severity badge labels, count aria). *Alternative:* coin
  moderator-only per-kind titles — rejected for the same single-source-of-truth
  reason `mod_diagnostic_methodology_suggestions` Decision §D4 gave. Non-English
  drafts go to the `*.review.json` pending lists for native-speaker sign-off (a
  human gate, not a WBS task).

- **D7: No new ADR.** The pane reuses the shipped `activeDiagnostics` map, the
  `diagnosticIdentityKey` helper, the rose/amber palette, the right-sidebar slot,
  and the wire `severity` field. No new dependency, seam architecture, or
  security-relevant trade-off is introduced (ADRs 0003 React, 0005 Tailwind,
  0006 Vitest, 0008 Playwright, 0024 i18n, 0027 entity/facet separation all
  already cover the ground). A new ADR would be ceremony over a settled pattern.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- Added `apps/moderator/src/layout/DiagnosticFlagPane.tsx` — the flag-list pane wrapping `<DiagnosticSuggestionsPanel>` for the focused flag, with per-row seams (`data-testid`, `data-diagnostic-key/kind/severity`, `data-focused`, `aria-current`), blocking-first ordering, and empty state.
- Added `apps/moderator/src/layout/orderActiveDiagnostics.ts` — shared comparator (blocking → ascending sequence → identity-key tiebreak) + rose/amber palette constants hoisted from the suggestions panel.
- Added `apps/moderator/src/layout/orderActiveDiagnostics.test.ts` and `DiagnosticFlagPane.test.tsx` — Vitest coverage for ordering (tiebreak/empty), empty state, two-row blocking-first render, badge/title content, focus continuity, and i18n parity.
- Added `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` — Playwright spec asserting populated inventory (blocking-first order, correct seams, top row `data-focused="true"`) and empty state.
- Edited `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx` — `pickFocusedDiagnostic` now delegates to `orderActiveDiagnostics(...)[0]`; palettes extracted to the shared helper.
- Edited `apps/moderator/src/routes/Operate.tsx` — swapped `diagnosticFlagsSlot` from `<DiagnosticSuggestionsPanel>` to `<DiagnosticFlagPane>`.
- Edited `tests/e2e/fixtures/wsStoreSeed.ts` — added moderator-side `applyDiagnostic` helper.
- Edited `playwright.config.ts` — widened `chromium-create-session` testMatch to include the new spec.
- Edited `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — added `moderator.diagnostic.flags.*` chrome keys (header, severity badge labels, countAria); pt-BR and es-419 drafts entered in `*.review.json` pending lists for native-speaker sign-off.
