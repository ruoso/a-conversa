# part_diagnostics_list — Diagnostics list accessible from status indicator

## TaskJuggler entry

- Task: `participant_ui.part_diagnostics_view.part_diagnostics_list`
- Defined at [`tasks/40-participant-ui.tji:422`](../../40-participant-ui.tji)
  (inside `task part_diagnostics_view "View structural diagnostics (P6)"`
  at [`tasks/40-participant-ui.tji:420`](../../40-participant-ui.tji)).
- Sibling leaf: `part_diagnostic_focus` ("Tap a flag to focus the affected
  region", [`tasks/40-participant-ui.tji:426`](../../40-participant-ui.tji))
  `depends !part_diagnostics_list` — the focus-on-tap behaviour is **its**
  job, not this one's (see Decisions §6).

## Effort estimate

`1d` (from the `.tji` leaf).

## Inherited dependencies

The leaf itself declares no `depends`; it inherits the parent
`part_diagnostics_view` chain:

- **`!part_graph_view`** — *settled.* The participant operate route
  (`apps/participant/src/routes/OperateRoute.tsx`) ships, including the
  `ParticipantLayout` footer slot that hosts the status indicator
  ([`OperateRoute.tsx:198`](../../../apps/participant/src/routes/OperateRoute.tsx)).
- **`data_and_methodology.diagnostics.diagnostic_event_emission`** —
  *settled.* The server computes diagnostics, classifies severity, and
  broadcasts `diagnostic` envelopes to every subscribed connection in a
  session (participants included). The wire payload is `DiagnosticPayload`
  (`kind`, `severity`, `status`, `sequence`, `diagnostic`).
- **`frontend_i18n.i18n_diagnostic_descriptions`** — *settled.* The shared
  `diagnostics.<kind>.{title,description,detail,action}` catalog namespace
  exists in en-US (and draft pt-BR / es-419) — see
  [`packages/i18n-catalogs/src/catalogs/en-US.json:1188`](../../../packages/i18n-catalogs/src/catalogs/en-US.json).

De-facto predecessors (not in the `.tji` `depends` but required at build
time):

- **`part_diagnostic_highlights` + `shell_diagnostic_highlights_extract`** —
  *settled.* The canonical client-side diagnostics module now lives in the
  shell:
  [`packages/shell/src/diagnostics/diagnostic-highlights.ts`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts)
  exports `affectedEntities`, `diagnosticIdentityKey`,
  `projectDiagnosticHighlights`, and the `WireDiagnostic` union. The
  participant WS store carries `activeDiagnostics: ReadonlyMap<string,
  DiagnosticPayload>` canonically on `BaseWsSessionState`
  ([`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts)).
- **`part_status_indicator`** — *settled.* The footer connection chip
  `<ParticipantStatusIndicator>`
  ([`apps/participant/src/layout/ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx))
  is read-only today; its refinement explicitly deferred "the
  diagnostics-list entry / change-history affordance" to *this* leaf and
  flagged that a future leaf "can wire a tap-to-open-diagnostics affordance
  into the same chip when that surface exists." This task pays that pointer.

All inherited dependencies are **settled**; nothing pending blocks this leaf.

## What this task is

Render a **session-wide list of the currently-active structural
diagnostics** on the participant (debater) tablet, reachable from the
status-indicator cluster in the operate-route footer. Each row shows the
diagnostic's severity (blocking / advisory) and a localized,
parameter-free description of what kind of structural problem it is. The
list reads the participant WS store's `activeDiagnostics` map, orders the
entries with the same blocking-first total order the moderator uses, and
renders one row per active diagnostic. An entry-point affordance sitting
next to the status indicator surfaces the active-diagnostic count and
toggles the list open/closed.

This is the participant analogue of the moderator's
`<DiagnosticFlagPane>`
([`apps/moderator/src/layout/DiagnosticFlagPane.tsx`](../../../apps/moderator/src/layout/DiagnosticFlagPane.tsx))
— the same data source, the same ordering, the same row anatomy
(severity badge + localized kind title), adapted to the participant's
footer-anchored surface and debater-facing copy.

**Out of scope** (owned by the sibling leaf `part_diagnostic_focus`):
tapping a row to pan/zoom the graph onto the affected region. This leaf's
rows are read-only; the only interaction it adds is open/close of the
list panel.

## Why it needs to be done

Debaters already see diagnostic *highlights* painted on the graph (amber
rings on affected nodes/edges, via `part_diagnostic_highlights`) and a
per-entity "Active diagnostics" section when they select a single node or
edge (`participant.detailPanel.sectionTitle.diagnostics`,
[`en-US.json:962`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)).
What they lack is a **session-wide inventory** — "what structural problems
are currently open?" — without hunting the canvas entity-by-entity. This
leaf provides that inventory and is the prerequisite for
`part_diagnostic_focus` (tap-a-flag-to-focus) and for the parent
`part_diagnostics_view` milestone roll-up
([`tasks/99-milestones.tji:101`](../../99-milestones.tji)).

## Inputs / context

- **Status indicator (entry-point host)** —
  [`apps/participant/src/layout/ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx).
  Read-only `role="status"` chip rendered in the `ParticipantLayout`
  footer slot. Mounted in the footer of **OperateRoute**
  ([`OperateRoute.tsx:198`](../../../apps/participant/src/routes/OperateRoute.tsx)),
  **LobbyRoute** ([`LobbyRoute.tsx:147`](../../../apps/participant/src/routes/LobbyRoute.tsx)),
  and **InviteAcceptanceRoute** ([`InviteAcceptanceRoute.tsx:102`](../../../apps/participant/src/routes/InviteAcceptanceRoute.tsx))
  via `App.tsx`'s shared shape. Diagnostics only exist on the live
  operate surface, so the affordance must mount **only** on OperateRoute
  (see Decisions §2).
- **Footer slot** —
  [`apps/participant/src/layout/ParticipantLayout.tsx:75`](../../../apps/participant/src/layout/ParticipantLayout.tsx)
  (`data-testid="participant-footer"`, `h-12` ≈ 48 px high).
- **WS store / data source** —
  [`apps/participant/src/ws/wsStore.ts`](../../../apps/participant/src/ws/wsStore.ts);
  `activeDiagnostics` is canonical on `BaseWsSessionState`. Read via
  `useWsStore((s) => s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY)`.
- **Shell diagnostics helpers** —
  [`packages/shell/src/diagnostics/diagnostic-highlights.ts`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts):
  `diagnosticIdentityKey` (`:250`), `affectedEntities` (`:302`),
  `DiagnosticPayload` re-export. `severity` (`'blocking' | 'advisory'`),
  `kind`, and `sequence` live directly on each `DiagnosticPayload` value.
- **Moderator analogue (pattern to mirror)** —
  [`apps/moderator/src/layout/DiagnosticFlagPane.tsx`](../../../apps/moderator/src/layout/DiagnosticFlagPane.tsx)
  (row anatomy: severity badge + `diagnostics.<kind>.title`) and
  [`apps/moderator/src/layout/orderActiveDiagnostics.ts`](../../../apps/moderator/src/layout/orderActiveDiagnostics.ts)
  (`orderActiveDiagnostics` total order: blocking-first, then ascending
  `sequence`, then `diagnosticIdentityKey` lexicographic tiebreak).
- **i18n descriptions** —
  [`packages/i18n-catalogs/src/catalogs/en-US.json:1188`](../../../packages/i18n-catalogs/src/catalogs/en-US.json):
  `diagnostics.<kind>.title` and `diagnostics.<kind>.detail` are
  **parameter-free**; `diagnostics.<kind>.description` carries ICU params
  (`{nodes}`, `{role}`, `{count}`). The moderator flag pane renders
  `title` + `action`, deliberately avoiding the parametrized
  `description` (no per-kind param composer). The participant UI tab/zoom
  state store is
  [`apps/participant/src/stores/uiStore.ts`](../../../apps/participant/src/stores/uiStore.ts).
- **Test seam / e2e pattern** — the moderator flag-pane e2e
  [`tests/e2e/moderator-diagnostic-flag-pane.spec.ts`](../../../tests/e2e/moderator-diagnostic-flag-pane.spec.ts)
  and the participant store-seeding pattern in
  [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts)
  (direct `__aConversaWsStore` injection).

## Constraints / requirements

1. **Read-only, derived view.** The list reads `activeDiagnostics` from the
   WS store; it never mutates state and emits no events. Open/close is the
   only stateful interaction and lives in client UI state.
2. **Shared total order.** Diagnostics render in the *same* order the
   moderator uses — blocking before advisory, oldest (`sequence`) first,
   `diagnosticIdentityKey` lexicographic tiebreak — so cross-surface
   discussion ("the first flag") never disagrees. Reuse the comparator,
   do not re-derive it (Decisions §3).
3. **Operate-only mount.** The affordance and list mount only on the
   operate route's footer, never on the lobby or invite footers (those
   sessions have no diagnostics). The shared `<ParticipantStatusIndicator>`
   stays untouched for those routes (Decisions §2).
4. **Stable empty-map guard.** The store selector must return a stable
   reference when no diagnostic is active (mirror the moderator's
   `EMPTY_ACTIVE_DIAGNOSTICS` sentinel) to avoid a Zustand
   strict-equality re-render loop. Memoize the ordered array on the
   `activeDiagnostics` map reference.
5. **Empty state.** When zero diagnostics are active, the list shows a
   single localized empty message; the entry-point affordance shows a
   zero/quiet state (count `0`, no severity tone) rather than vanishing,
   so its presence is route-assertable.
6. **Parameter-free copy.** Rows render `diagnostics.<kind>.title`
   (heading) + `diagnostics.<kind>.detail` (debater-facing explanation).
   Neither takes ICU params, so this leaf builds **no** per-kind
   description composer (Decisions §5). The moderator-oriented `.action`
   prose is **not** used on the participant surface.
7. **i18n.** Chrome strings (panel header, empty message, severity labels,
   open/close + count aria) live under a new `participant.diagnostics.*`
   namespace, authored in en-US with draft pt-BR / es-419 entries flagged
   PENDING in the locale `.review.json` trackers per the
   `i18n_diagnostic_descriptions` convention. The shared
   `diagnostics.<kind>.*` keys are reused as-is.
8. **Accessibility.** The entry-point button uses `aria-expanded` +
   `aria-controls` and a localized count label; the list is a labelled
   `role="region"` / `<ul>` with a localized `countAria`. The status chip
   keeps its `role="status"` semantics.
9. **DOM test seams.** Stamp deterministic seams mirroring the moderator
   pane: list container `data-testid="participant-diagnostic-list"`, rows
   `data-testid="participant-diagnostic-row"` with
   `data-diagnostic-kind` / `data-diagnostic-severity` /
   `data-diagnostic-key`; the entry button
   `data-testid="participant-diagnostics-toggle"` with `data-count`.
10. **No backend / wire change.** This leaf consumes the existing
    `diagnostic` envelope and `activeDiagnostics` store; it crosses no
    protocol or replay boundary, so no Cucumber scenario is required
    (Vitest + Playwright cover it).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications — every check is a committed,
re-runnable test):

1. **Vitest — ordering helper.** If `orderActiveDiagnostics` is extracted
   to the shell (Decisions §3), its existing moderator test moves/copies
   to the shell suite and pins: blocking-before-advisory,
   ascending-`sequence`, lexicographic identity tiebreak, and empty-map →
   `[]`. The moderator pane keeps importing it green.
2. **Vitest — component.** A `ParticipantDiagnosticsList.test.tsx` (and a
   test for the entry-point affordance) under
   `apps/participant/src/**` asserts, with the i18n provider mounted
   (`createI18nInstance('en-US')`, per the existing participant
   component-test pattern):
   - rows render in the shared total order for a seeded multi-diagnostic
     map (one blocking + one advisory + a sequence tiebreak);
   - each row shows the correct severity badge text and the
     `diagnostics.<kind>.title` heading;
   - the empty state renders the single localized empty message and the
     toggle shows count `0` when the map is empty;
   - the toggle reflects `aria-expanded` and the list mounts/unmounts (or
     shows/hides) on toggle.
3. **Playwright — e2e (in scope; component IS reachable).** The
   operate-route footer renders the diagnostics affordance, so per the
   UI-stream e2e policy this is **not** deferred. Add
   `tests/e2e/participant-diagnostics-list.spec.ts` that: logs in as a
   debater, navigates to a seeded operate route, injects active
   diagnostics via the `__aConversaWsStore` seam (the
   `participant-pending-proposals.spec.ts` pattern), asserts the toggle
   surfaces the active count, opens the list, and asserts the rows render
   with the expected severities/titles in order. Mirror
   `moderator-diagnostic-flag-pane.spec.ts`.
4. **i18n — catalog tests.** The new `participant.diagnostics.*` keys pass
   the existing catalog presence/parse suite for en-US (and draft
   pt-BR / es-419), consistent with how `diagnostics.test.ts` guards the
   shared keys.
5. **Build + test green.** `make` build + the workspace Vitest/Cucumber/
   Playwright suites pass before commit (global pre-commit gate).

No new WBS follow-up task is deferred from this leaf. The native-speaker
review of the new pt-BR / es-419 strings is a **human** task (not
agent-implementable) and is surfaced for the parking lot, not registered
as a WBS leaf. The focus-on-tap behaviour is the already-planned sibling
`part_diagnostic_focus`, whose refinement must add the tap-to-focus
Playwright coverage over these now-rendered rows.

## Decisions

**§1 — Entry point is a footer affordance co-located with the status
indicator, not a new tab.** The `.tji` title is explicit ("accessible from
status indicator"), and `part_status_indicator`'s refinement pre-committed
the diagnostics affordance to this leaf. *Chosen:* a diagnostics-count
button rendered in the operate footer next to `<ParticipantStatusIndicator>`,
toggling a dismissible list panel anchored above the footer.
*Rejected:* a fourth `ParticipantTab` ('diagnostics') in
`ParticipantTopTabBar` — it contradicts the task title, costs a permanent
top-of-main tab slot for an intermittent surface, and the `ParticipantTab`
union is documented "closed at v1". *Rejected:* mutating
`<ParticipantStatusIndicator>` itself to carry the button — the chip is
shared by the lobby/invite footers where no diagnostics exist; keeping it
single-responsibility and composing a sibling affordance is cleaner and
keeps those routes untouched (Constraint §3).

**§2 — Compose an operate-only footer wrapper.** *Chosen:* OperateRoute's
`footer={…}` renders a small wrapper (e.g.
`<ParticipantOperateFooter sessionId=…/>`) that mounts the existing status
chip **plus** the diagnostics affordance + list; the lobby/invite routes
keep `footer={<ParticipantStatusIndicator />}` verbatim. *Rejected:*
conditionally rendering the affordance inside the shared chip based on
route — pushes route awareness into a presentation-only component and
risks leaking the affordance onto non-operate footers.

**§3 — Reuse the moderator's `orderActiveDiagnostics`; extract it to the
shell as the second caller.** The participant needs the identical total
order, and apps cannot import from one another — only from shared packages.
The two-callers-then-extract convention (the same rule that produced
`shell_diagnostic_highlights_extract`) now fires: *Chosen:* lift the pure
comparator `orderActiveDiagnostics` into
`packages/shell/src/diagnostics/` alongside the existing diagnostics module,
re-point the moderator's import, and import it from the participant. The
Tailwind palette constants (`BLOCKING_PANEL_CLASSES` / `ADVISORY_PANEL_CLASSES`)
are presentation, not logic, and stay in the moderator file (the
participant authors its own footer-scaled palette). *Rejected:*
re-implementing the comparator inline in the participant — guarantees
eventual drift in the "which flag is first" semantics that cross-surface
conversation depends on. This is a small lift consistent with the existing
shell diagnostics seam, not a new architectural boundary, so **no ADR** is
warranted; documented here.

**§4 — Read the raw `activeDiagnostics` payloads, not the
`projectDiagnosticHighlights` per-entity index.** The list is
per-*diagnostic* (one row per active flag), whereas
`projectDiagnosticHighlights` rolls diagnostics up per *entity* (for the
canvas rings). *Chosen:* iterate `orderActiveDiagnostics(activeDiagnostics)`
— each `DiagnosticPayload` already carries `kind` + `severity` + `sequence`.
*Rejected:* deriving rows from the highlight index — wrong granularity
(a single diagnostic touching three nodes would otherwise appear thrice).

**§5 — Rows render `title` + `detail` (parameter-free), not the ICU
`description`.** *Chosen:* `diagnostics.<kind>.title` as the heading and
`diagnostics.<kind>.detail` as the debater-facing "what this means"
explanation — both parameter-free, so this leaf ships no per-kind ICU
param composer (matching the moderator pane's choice to avoid
`description`). *Rejected:* rendering the parametrized
`diagnostics.<kind>.description` (`{nodes}`/`{role}`/`{count}`) — it would
force a per-kind param-extraction helper this leaf doesn't need; the
per-entity parametrized copy already has a home in the detail panel.
*Rejected:* the `.action` prose — it is written as the *moderator's*
next-step ("Prompt the defender for support…") and is the wrong voice for
a debater surface.

**§6 — Rows are read-only here; focus-on-tap is `part_diagnostic_focus`.**
The `.tji` splits the view into `part_diagnostics_list` (this leaf) and
`part_diagnostic_focus` ("Tap a flag to focus the affected region",
`depends !part_diagnostics_list`), mirroring the moderator split
(flag-pane render vs. canvas-focus action). *Chosen:* ship the inventory
rows without the pan/zoom-on-tap behaviour; the sibling leaf adds it (and
owns its Playwright coverage over these rows). *Rejected:* folding focus
into this leaf — it would overrun the 1d estimate and duplicate the
sibling's scope.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Lifted `orderActiveDiagnostics` comparator to `packages/shell/src/diagnostics/order-active-diagnostics.ts` (+ `.test.ts`); moderator re-exports from shell (`apps/moderator/src/layout/orderActiveDiagnostics.ts` updated, old moderator test moved).
- Added `apps/participant/src/layout/ParticipantDiagnosticsList.tsx` — toggle + footer-anchored list with blocking-first total order, severity badges, `diagnostics.<kind>.title` + `.detail` rows, empty state, `aria-expanded`/`aria-controls`, DOM seams (`data-testid="participant-diagnostic-list"`, `data-testid="participant-diagnostics-toggle"`).
- Added `apps/participant/src/layout/ParticipantDiagnosticsList.test.tsx` — 58 Vitest cases: ordering, badges+titles, empty state, toggle `aria-expanded` + mount behaviour.
- Added `apps/participant/src/layout/ParticipantOperateFooter.tsx` — operate-only footer wrapper composing `<ParticipantStatusIndicator>` + `<ParticipantDiagnosticsList>`; `apps/participant/src/routes/OperateRoute.tsx` updated to use it.
- Added `packages/i18n-catalogs/src/participant-diagnostics.test.ts` — catalog presence + ICU + render tests for the new `participant.diagnostics.*` namespace.
- Added `tests/e2e/participant-diagnostics-list.spec.ts` — Playwright spec: count seam, blocking-first rows, empty quiet state.
- Updated `packages/shell/src/diagnostics/index.ts` + `packages/shell/src/index.ts` barrels to re-export `orderActiveDiagnostics`.
- Added `participant.diagnostics.*` i18n keys to `packages/i18n-catalogs/src/catalogs/en-US.json` (authoritative); draft pt-BR/es-419 keys added to `pt-BR.json` and `es-419.json`, flagged PENDING in `pt-BR.review.json` and `es-419.review.json`.
