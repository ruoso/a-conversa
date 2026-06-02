# mod_blocking_diagnostic_banner — Blocking diagnostic banner / status indicator

## TaskJuggler entry

- WBS: `moderator_ui.mod_diagnostic_resolution_flow.mod_blocking_diagnostic_banner`
- Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) (the
  `task mod_blocking_diagnostic_banner "Blocking diagnostic banner / status indicator"`
  block, L575-579, inside `task mod_diagnostic_resolution_flow "F7 — Resolve a
  structural diagnostic"` L568).

## Effort estimate

`1d` (per the `.tji` block). This is a small new presentational component plus a
mount point in `Operate.tsx` and a thin extension of the existing diagnostic
Playwright spec. The blocking-vs-advisory order, the affected-entity helper, the
`requestCanvasFocus` dispatch path, and the diagnostic-test seeding fixtures all
already shipped with the two predecessor leaves — this task composes them, it
does not introduce new store, selector, or projection machinery.

## Inherited dependencies

Direct `depends`: `!mod_diagnostic_flag_pane` (L578). Through the parent
`mod_diagnostic_resolution_flow` (L569) it transitively inherits the F7
dependency set, all settled.

**Settled (shipped):**

- `mod_diagnostic_flag_pane` — shipped
  `apps/moderator/src/layout/DiagnosticFlagPane.tsx` and the shared blocking-first
  comparator `orderActiveDiagnostics(activeDiagnostics): DiagnosticPayload[]` in
  `apps/moderator/src/layout/orderActiveDiagnostics.ts` (blocking before advisory,
  then ascending `sequence`, then `diagnosticIdentityKey` lexicographic tiebreak).
  It also shipped the `BLOCKING_PANEL_CLASSES` / `ADVISORY_PANEL_CLASSES` Tailwind
  constants and the moderator-side `applyDiagnostic(page, payload)` / `seedWsStore`
  Playwright fixtures in `tests/e2e/fixtures/wsStoreSeed.ts`, plus the spec this
  task extends (`tests/e2e/moderator-diagnostic-flag-pane.spec.ts`). See
  `tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md`.
- `mod_diagnostic_focus_action` — shipped the canvas-focus command path this
  banner reuses: the `focusRequest` field + `requestCanvasFocus(target)` action on
  `useUiStore` (`apps/moderator/src/stores/uiStore.ts:35-83`) and the
  `useCanvasFocusEffect(reactFlow)` consumer inside the `<ReactFlowProvider>`
  (`apps/moderator/src/graph/useCanvasFocusEffect.ts`). The flag rows already
  dispatch `requestCanvasFocus({ nodeIds, edgeIds })` on click
  (`DiagnosticFlagPane.tsx:157-159`). See
  `tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md`.
- `mod_diagnostic_methodology_suggestions` / `mod_diagnostic_highlighting` — the
  per-kind `affectedEntities(payload): { readonly nodes; readonly edges }` helper,
  re-exported from `@a-conversa/shell`
  (`packages/shell/src/diagnostics/diagnostic-highlights.ts:247-270`,
  `packages/shell/src/index.ts:152`). It documents that it does **not** dedupe;
  callers dedupe (`DiagnosticFlagPane.tsx:66-71`).
- `data_and_methodology.diagnostics.blocking_vs_advisory_classification` /
  `frontend_i18n.i18n_diagnostic_descriptions` — the `severity` discriminant
  (`'blocking' | 'advisory'`, `packages/shared-types/src/ws-envelope.ts`
  `wsDiagnosticSeverities`) carried on each `DiagnosticPayload`, and the
  `diagnostics.<kind>.title` / `.action` catalog keys. This task consumes both;
  it adds no per-kind diagnostic strings.
- `root_app.root_moderator_cutover` — the moderator app is the live root surface;
  `apps/moderator/src/routes/Operate.tsx` renders both the canvas and the right
  sidebar.

**Pending:** none.

## What this task is

Add a **blocking-diagnostic banner** to the moderator console: a single,
persistent, non-collapsible status indicator that appears at the top of the
operate surface whenever **one or more `blocking`-severity diagnostics are
active**, and is absent otherwise. The flag pane
(`mod_diagnostic_flag_pane`) lists every diagnostic inside a right-sidebar pane
that the moderator can collapse; a blocking diagnostic gates the session
(commit is blocked until it is resolved), so the blocked state needs a surface
the moderator cannot lose track of. The banner is that surface: it states "N
blocking diagnostics must be resolved", names the highest-priority blocking
diagnostic (the order head's localized kind title), and offers one click that
re-frames the canvas on that diagnostic's affected region **and** foregrounds
the diagnostic-flags sidebar pane — reusing the exact `orderActiveDiagnostics`
order, `affectedEntities` projection, and `requestCanvasFocus` dispatch the flag
rows already use, not a parallel mechanism. **Advisory-only** diagnostics never
raise the banner — that discrimination is the whole point of the
blocking-vs-advisory classification.

## Why it needs to be done

`mod_diagnostic_resolution_flow` (F7) is the moderator's loop for resolving a
structural diagnostic. The flag pane (inventory) and the focus action (jump to
the affected region) shipped; what is missing is the **global, always-visible
signal that the session is blocked**. Without it, a moderator who has collapsed
the diagnostic-flags pane — or who is heads-down in a capture flow — has no cue
that a commit is being refused for a structural reason. The banner closes that
gap and provides the natural entry point into the resolution flow that
`mod_resolution_path_picker` (the next leaf, `2d`, already READY and depending
on `mod_diagnostic_focus_action`) builds out. Landing the banner first gives the
picker a stable, blocking-aware surface to attach to.

## Inputs / context

- **Mount surface** — `apps/moderator/src/routes/Operate.tsx`. `OperateRouteInner`
  (L143-351) renders `<main data-testid="route-operate">` (L248) wrapping
  `<OperateLayout>` (L260-342). `<SnapshotLabelInputMount />` is already mounted
  as a sibling of `<OperateLayout>` inside the same `<main>` (L348). The banner
  mounts the same way — as a sibling **before** `<OperateLayout>` so it sits at
  the top of the console flow, above the three-pane grid, and is unaffected by
  the right sidebar's per-pane collapse state.
- **Diagnostic source + order** — `apps/moderator/src/layout/orderActiveDiagnostics.ts`
  (`orderActiveDiagnostics(...)`, blocking-first). The store read pattern is the
  one both predecessors use:
  `useWsStore((state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS)`
  with a module-level stable empty-`Map` reference to avoid the Zustand
  strict-equality re-render loop (`DiagnosticFlagPane.tsx:50-54,77-79`).
- **Blocking predicate** — `severity` is `'blocking' | 'advisory'`
  (`packages/shared-types/src/ws-envelope.ts`). Because `orderActiveDiagnostics`
  sorts blocking-first, the blocking diagnostics are the leading prefix of the
  ordered array and `ordered[0]?.severity === 'blocking'` is the
  "is-blocked" predicate. The head blocking diagnostic is `ordered[0]`; the
  blocking count is `ordered.filter((d) => d.severity === 'blocking').length`.
- **Focus dispatch** — `useUiStore`'s `requestCanvasFocus({ nodeIds, edgeIds })`
  (`apps/moderator/src/stores/uiStore.ts:59,74-81`) and the
  `useCanvasFocusEffect` consumer already wired in the canvas
  (`apps/moderator/src/graph/useCanvasFocusEffect.ts`). The banner dispatches the
  same command with the head blocking diagnostic's `affectedEntities` (deduped,
  the same `dedupe` shape as `DiagnosticFlagPane.tsx:66-71`).
- **Sidebar foregrounding** — `useUiStore`'s
  `setActiveSidebarPane('diagnostic-flags')`
  (`apps/moderator/src/stores/uiStore.ts:20,52,72`). The `<RightSidebar>` reflects
  the active pane onto its header as `data-active="true"`
  (`apps/moderator/src/layout/RightSidebar.tsx:101,111`,
  `right-sidebar-pane-header-diagnostic-flags`). Note the sidebar's expand /
  collapse is **local component state**, not store state — the banner can
  foreground (highlight) the pane but cannot programmatically re-expand a
  collapsed one; canvas focus is therefore the load-bearing affordance and pane
  foregrounding is the secondary cue (see Decision §D4).
- **i18n** — flag-chrome keys already live under `moderator.diagnostic.flags.*`
  (`packages/i18n-catalogs/src/catalogs/en-US.json:649-657`); per-kind titles
  under `diagnostics.<kind>.title` (`…:850-880`). The plural-count idiom is the
  ICU form already used by `moderator.diagnostic.flags.countAria`
  (`"{count, plural, one {# active diagnostic} other {# active diagnostics}}"`).
- **Existing e2e** — `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` already
  drives create-session → invite → gate → operate, seeds a small graph, and seeds
  a blocking `cycle` + advisory `multi-warrant` via `applyDiagnostic`
  (L100-217). The banner scenarios extend this spec.

## Constraints / requirements

1. **New component** `<BlockingDiagnosticBanner sessionId={sessionId} />` at
   `apps/moderator/src/layout/BlockingDiagnosticBanner.tsx`. Mounted in
   `Operate.tsx`'s `OperateRouteInner` as a sibling before `<OperateLayout>`
   inside `<main data-testid="route-operate">`.
2. **Render only when blocked.** When zero blocking diagnostics are active —
   including the advisory-only case — the component returns `null` (renders
   nothing). It must NOT render an empty/placeholder banner: the flag pane owns
   the "no diagnostics" empty state; this surface exists only to announce a
   blocked session.
3. **Reuse, don't recompute.** Blocking detection and ordering come from
   `orderActiveDiagnostics(...)`; affected-entity ids come from
   `affectedEntities(...)` + the same `dedupe`; the canvas re-frame goes through
   `requestCanvasFocus(...)`. No new selector, no new classification helper, no
   DOM scraping of the flag rows' `data-diagnostic-affected-*` seams.
4. **Content.** The banner shows (a) a localized blocking-count message
   (`moderator.diagnostic.banner.message`, ICU plural on `count`) and (b) the
   head blocking diagnostic's localized kind title
   (`diagnostics.<head.kind>.title`). It carries the blocking severity styling
   (`BLOCKING_PANEL_CLASSES` or an equivalent rose treatment) so it reads as a
   blocking surface at a glance.
5. **Affordance.** A single review `<button>` (inside the banner region)
   dispatches, on click: `requestCanvasFocus({ nodeIds, edgeIds })` for the head
   blocking diagnostic's deduped affected entities, and
   `setActiveSidebarPane('diagnostic-flags')`. Clicking changes neither the
   diagnostic order nor any selection state.
6. **DOM seams** (Playwright + component tests assert these):
   - `data-testid="blocking-diagnostic-banner"` on the banner region.
   - `data-blocking-count` = the integer blocking count.
   - `data-diagnostic-kind` = the head blocking diagnostic's kind.
   - `data-testid="blocking-diagnostic-banner-review"` on the review button.
7. **Accessibility.** The banner region is an ARIA live region —
   `role="status"` with `aria-live="polite"` (see Decision §D3) — and the review
   button has an `aria-label` (`moderator.diagnostic.banner.reviewAria`,
   interpolating the head kind `title`).
8. **i18n keys** added to all three shipped catalogs (`en-US`, `pt-BR`,
   `es-419`) under `moderator.diagnostic.banner.*`:
   - `message` — ICU plural, e.g.
     `"{count, plural, one {# blocking diagnostic must be resolved} other {# blocking diagnostics must be resolved}}"`.
   - `reviewAria` — e.g. `"Review the blocking {title} diagnostic"`.
   No new `diagnostics.<kind>.*` keys (the head title reuses the existing per-kind
   key). `pt-BR` / `es-419` follow the project's machine-then-review path; the
   native-speaker sign-off is a human task, not a WBS leaf (see Open questions).

## Acceptance criteria

Per ADR 0022 (no throwaway verifications) every check below lands as a committed,
re-runnable test — Vitest for the component logic, Playwright for the
route-rendered behavior. No deleted scratch scripts.

1. **Component unit tests** — new `apps/moderator/src/layout/BlockingDiagnosticBanner.test.tsx`
   (Vitest + Testing Library):
   - No active diagnostics → component renders nothing (`queryByTestId('blocking-diagnostic-banner')` is null).
   - Advisory-only active (e.g. one `multi-warrant`) → renders nothing. *(The
     blocking-vs-advisory discriminator pin.)*
   - One blocking diagnostic active → banner present, `data-blocking-count="1"`,
     `data-diagnostic-kind` matches the seeded kind, message + head title resolve
     from the catalog.
   - Mixed (≥1 blocking + ≥1 advisory) → `data-blocking-count` counts only the
     blocking ones; `data-diagnostic-kind` is the blocking-first head.
   - Clicking `blocking-diagnostic-banner-review` calls `requestCanvasFocus` with
     the head blocking diagnostic's deduped affected nodes/edges (asserted against
     `affectedEntities(head)`), and calls `setActiveSidebarPane('diagnostic-flags')`.
   - Catalog-parity: the new `moderator.diagnostic.banner.*` keys resolve in
     `en-US`, `pt-BR`, and `es-419` (same parity-assertion shape
     `DiagnosticFlagPane.test.tsx` uses).
2. **Playwright e2e — IN SCOPE, extends `tests/e2e/moderator-diagnostic-flag-pane.spec.ts`.**
   The banner is route-rendered at `Operate.tsx` and a `fired` diagnostic is
   injectable via the `applyDiagnostic` / `window.__aConversaWsStore` backdoor the
   existing spec already uses — so the strict "not reachable" deferral test
   (no route renders it AND no event surface drives it) fails on both counts.
   A new `test.describe` block adds:
   - **Blocking present** — seed a blocking `cycle`; assert
     `blocking-diagnostic-banner` is visible with `data-blocking-count="1"` and
     `data-diagnostic-kind="cycle"`.
   - **Advisory-only absent** — seed only an advisory `multi-warrant`; assert the
     banner is absent (`toHaveCount(0)`) while the flag pane still lists the row.
     *(End-to-end proof that advisory diagnostics do not raise the banner.)*
   - **Review click foregrounds the pane** — with a blocking `cycle` seeded over a
     two-node subset, click `blocking-diagnostic-banner-review` and assert the
     `right-sidebar-pane-diagnostic-flags` section gains `data-active="true"`. The
     canvas re-frame itself reuses the `requestCanvasFocus` path already pinned by
     `mod_diagnostic_focus_action`'s viewport-transform scenario, so it is covered
     at the unit layer here rather than re-asserting the transform a second time.

   This e2e is **not deferred** to `mod_pw_diagnostic_flow`. That catch-all
   already inherits deferred coverage from nine F3/F7 refinements (see its `.tji`
   note, L861-870) — per the UI-stream e2e policy's debt-bomb guard, reachable
   behavior is paid down here rather than added to that pile.

3. **Build + tests green** — `pnpm` workspace build, Vitest, and the moderator
   Playwright project all pass before commit (per the global build-and-test gate;
   the doc-only exception does not apply — this task ships source + tests).

## Decisions

- **D1 — Mount at the top of the operate console, not inside the
  collapsible sidebar pane.** The banner is a sibling before `<OperateLayout>` in
  `Operate.tsx`'s `<main data-testid="route-operate">`, mirroring how
  `<SnapshotLabelInputMount>` mounts as a layout sibling.
  *Rationale:* the whole point of a blocking *status indicator* is that the
  moderator cannot lose sight of the blocked state. A banner nested in the
  diagnostic-flags sidebar pane would vanish the moment the moderator collapses
  that pane (collapse is local `useState` in `RightSidebar.tsx:64-68`) — exactly
  when the cue matters most. *Alternative rejected:* rendering the banner inside
  `<DiagnosticFlagPane>` above the flag list. Cheaper (one file, no `Operate.tsx`
  edit) but it ties the global blocked-signal to a collapsible container and to
  the sidebar's width; it fails the product intent of a persistent indicator.

- **D2 — Reuse `orderActiveDiagnostics` for both detection and the head,
  no new selector.** The banner calls the shared comparator and reads
  `ordered[0]` (head) and `ordered.filter(d => d.severity === 'blocking')`
  (count). *Rationale:* the orchestrator's directive is to build on the shipped
  surface and reuse the row seam data rather than re-deriving. The comparator is
  already the single source of "which diagnostic is most important", so the
  banner's head and the flag pane's `data-focused` row are guaranteed to be the
  same diagnostic — no drift. *Alternative rejected:* a dedicated
  `selectBlockingDiagnostics` store selector. Neither predecessor introduced one
  (ordering is computed per-consumer from the `activeDiagnostics` map), and a new
  selector for a single call site is abstraction the codebase has so far
  declined; the local derivation matches the established pattern and stays
  unit-testable.

- **D3 — `role="status"` / `aria-live="polite"`, not `role="alert"`.** The
  banner is a persistent, count-updating region. *Rationale:* `role="alert"` is
  assertive and interrupts the screen-reader on every re-announce — with a count
  that changes as diagnostics fire and clear, that is noisy and hostile. A polite
  live region announces the blocked state without hijacking focus, which is the
  right register for an always-present status indicator. *Alternative considered:*
  `role="alert"` — apt for a one-shot "you are now blocked" event, but the banner
  is steady-state, not an event, so polite wins.

- **D4 — Click does canvas-focus first, pane-foreground second; it does not
  try to expand the pane.** The review button dispatches `requestCanvasFocus` (the
  resolution-helping action: show the moderator *where* the problem is) and
  `setActiveSidebarPane('diagnostic-flags')` (draw the eye to the inventory).
  *Rationale:* the sidebar's expand state is local component state with no store
  handle (`RightSidebar.tsx:64`), so the banner cannot reliably re-expand a
  collapsed pane; reaching into the sidebar to lift that state into the store
  would be a markup refactor disproportionate to a `1d` leaf. Canvas focus is the
  affordance that works unconditionally and reuses the already-pinned
  `mod_diagnostic_focus_action` path; pane foregrounding is a best-effort cue.
  *Alternative deferred:* promoting per-pane expand state into `useUiStore` so the
  banner can auto-expand the flags pane — a reasonable future polish, but out of
  scope here and not blocking the resolution flow.

- **D5 — e2e is in scope; do not defer to `mod_pw_diagnostic_flow`.** The
  component is route-rendered and its blocking trigger is seedable via the
  existing `applyDiagnostic` backdoor, so it is "reachable" under the strict
  UI-stream policy test. The new scenarios extend
  `moderator-diagnostic-flag-pane.spec.ts`, the same spec the two predecessors
  grew. *Rationale:* `mod_pw_diagnostic_flow` already carries deferred debt from
  nine refinements (its `.tji` note); piling reachable behavior onto it would push
  a planning-debt time bomb further. Paying it down inline matches what
  `mod_diagnostic_flag_pane` (§D5) and `mod_diagnostic_focus_action` (§D5) both
  chose.

- **D6 — No new ADR.** This task adds no dependency, no architectural seam, and
  no security-relevant trade-off: it composes the shipped `useUiStore` focus
  command, the shared comparator, and the `affectedEntities` helper, and consumes
  the already-settled `severity` classification. The mount-location and ARIA-role
  choices are component-level calls recorded here under Decisions, consistent with
  how both predecessor leaves handled their analogous choices (each closed with a
  "no new ADR" decision).

## Open questions

(none — all decided)

The `pt-BR` / `es-419` strings for the two new `moderator.diagnostic.banner.*`
keys ship as machine translations pending native-speaker review — a human
sign-off task, not an agent-implementable WBS leaf. Surfaced to the orchestrator
for the parking lot rather than encoded as a task.

## Status

**Done** — 2026-06-02.

- Created `apps/moderator/src/layout/BlockingDiagnosticBanner.tsx` — new component; renders only when ≥1 blocking diagnostic is active, with `data-testid="blocking-diagnostic-banner"`, `data-blocking-count`, `data-diagnostic-kind`, `role="status"`, and `aria-live="polite"`.
- Created `apps/moderator/src/layout/BlockingDiagnosticBanner.test.tsx` — 10 Vitest tests: absent when no diagnostics, absent when advisory-only, present/correct when one blocking, mixed blocking-count, review-click dispatches `requestCanvasFocus` + `setActiveSidebarPane`, `reviewAria` aria-label, catalog parity for all three locales.
- Edited `apps/moderator/src/routes/Operate.tsx` — imported and mounted `<BlockingDiagnosticBanner>` as in-flow sibling before `<OperateLayout>` inside `<main data-testid="route-operate">`.
- Edited `apps/moderator/src/layout/OperateLayout.tsx` — changed outer `<main>` to a viewport-height flex column (`h-screen flex-col overflow-hidden`), changed inner grid to `flex-1 min-h-0` so the banner takes natural height and the grid absorbs the rest — zero page scrollbars with or without the banner.
- Edited `apps/moderator/src/layout/OperateLayout.test.tsx` — updated className assertion to match the new flex-column wrapper.
- Edited `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `moderator.diagnostic.banner.message` (ICU plural) and `moderator.diagnostic.banner.reviewAria` (interpolates head kind title); pt-BR/es-419 are machine-drafted pending native-speaker review (parking-lot entry added).
- Edited `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` — added new `test.describe` block with three scenarios: blocking banner visible, advisory-only absent, review-click foregrounds diagnostic-flags pane.
