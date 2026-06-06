# Refinement — `participant_ui.part_history_view.part_history_list`

## TaskJuggler entry

- WBS leaf: `participant_ui.part_history_view.part_history_list`
  ("Reverse-chronological event list").
- Definition: [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji)
  lines 435–446 (the `part_history_view` group and its `part_history_list`
  child).

```
task part_history_view "View change history (P7)" {
  depends !part_shell, backend.replay_endpoints.get_session_log
  task part_history_list "Reverse-chronological event list" {
    effort 1d
    allocate team
  }
  task part_history_filtering "Filter / search history" {
    effort 1d
    allocate team
    depends !part_history_list
  }
}
```

## Effort estimate

**1d.** A single pane component + one pure selector + the tab-bar / route
wiring that makes it reachable, all mirroring an already-shipped moderator
analogue (`<ChangeHistoryPane>`) and reusing an already-shipped shell
data-fetch hook (`useSessionEventLog`). The cost is in the test surface
(selector unit test, component test, tab-bar + route extensions, one
Playwright spec, one i18n catalog-parity test), not in novel design.

## Inherited dependencies

Both parent-level dependencies are **settled**:

- **`!part_shell`** (settled) — the participant surface mount contract,
  `<ParticipantLayout>`, the operate route, the Zustand UI store, and the
  top tab bar are all shipped. Concretely:
  - Surface mount contract: `packages/shell/src/mount-contract/types.ts:85–114`
    (`MountProps`, `MountFn`, `SurfaceModule`).
  - Operate route + tab dispatch: `apps/participant/src/routes/OperateRoute.tsx:415–461`
    (a `currentTab`-keyed ternary selecting `<GraphView>` /
    `<MyAgreementsPane>` / `<PendingProposalsPane>`).
  - Tab union + setter: `apps/participant/src/stores/uiStore.ts:21`
    (`ParticipantTab = 'graph' | 'proposals' | 'my-agreements'`),
    `:47,:63,:86` (`currentTab`, `setCurrentTab`).
  - Top tab bar: `apps/participant/src/proposals/ParticipantTopTabBar.tsx:36–100`
    (`role="tablist"` with one `<TabButton>` per tab).
- **`backend.replay_endpoints.get_session_log`** (settled) — the REST
  endpoint `GET /api/sessions/:id/events` is live
  (`apps/server/src/replay/routes.ts:533–620`), paginated by an
  `?after=<sequence>&limit=<1–1000>` cursor returning
  `{ events: Event[]; nextCursor: number | null }` ascending by `sequence`.
  The shell already wraps it in a paging-to-completion React hook,
  `useSessionEventLog(sessionId)`
  (`packages/shell/src/session-log/useSessionEventLog.ts:71–146`, exported
  from `packages/shell/src/index.ts:167–172`).

## What this task is

Add a **change-history view** to the participant (debater) tablet: a
reverse-chronological (newest-first) list of the session's event log,
reachable from a new **History** tab in the participant operate route. Each
row shows the event's kind (localized label), the acting participant, and a
relative timestamp — the debater's "what just happened, and in what order"
orientation surface, mirroring the moderator's `<ChangeHistoryPane>`
foundation leaf (`mod_history_scroller`).

This leaf is the **foundation** of the `part_history_view` subtree. It owns:

1. The data fetch — the **complete** session log (not just post-join live
   events), via the shell's `useSessionEventLog` REST prefetch overlaid with
   the live WS `events` array.
2. The reverse-chronological ordering and the minimal row contract
   (kind + actor + timestamp).
3. The four display states: loading, error (+ retry), empty, and the list.
4. The **tab + route wiring** that makes the pane reachable (there is no
   separate wiring task — see Decisions §D2).

The sibling `part_history_filtering` (next leaf, `depends !part_history_list`)
extends this with kind / actor / search filters; it is out of scope here.

## Why it needs to be done

P7 ("View change history") is a participant-facing requirement: a debater
needs to audit the sequence of structural changes (statements, connections,
proposals, votes, commits) without the moderator's console. The other
participant list views (`part_proposal_list_view`, `part_my_agreements_view`,
`part_diagnostics_list`) all read **live WS state only** — which holds only
the events received *since this client connected* and may be incomplete when
catch-up took the snapshot-state fallback path. A history/audit view must
show the **whole** log including pre-join events, which is exactly why the
parent task depends on the replay endpoint rather than the WS store. This is
the first participant view to read the REST replay endpoint.

Downstream, `part_history_filtering` builds directly on the row contract and
data source this task establishes.

## Inputs / context

Real files and the seams this task plugs into:

- **Canonical mirror — moderator change-history pane.**
  `apps/moderator/src/layout/ChangeHistoryPane.tsx:1–506`. The participant
  pane is a deliberately reduced subset of this. Note especially:
  - Header comment `:21–26` — "Full-log source: REST prefetch + WS overlay";
    the WS log alone is not guaranteed complete.
  - `actorText(actor, systemLabel)` `:146–149` — 8-char UUID prefix, or the
    localized "System" label when `actor === null`.
  - `relativeTimeFor(createdAt, nowMs)` `:159–166` — `formatRelativeTime`
    from `@a-conversa/i18n-catalogs`, past = negative seconds, NaN-guarded.
  - The four display states `:438–494` (loading / error+retry / empty / list)
    and their `data-testid`s.
  - Refinement: `tasks/refinements/moderator-ui/mod_history_scroller.md`
    (the foundation-leaf decisions this mirrors), and its siblings
    `mod_history_event_summary.md`, `mod_history_click_to_flash.md`,
    `mod_history_filtering.md` (enrichments the participant does **not**
    replicate in this task).
- **Data-fetch hook (reuse as-is).**
  `packages/shell/src/session-log/useSessionEventLog.ts:71–146` —
  `useSessionEventLog(sessionId): { status, events, retry }`,
  `status ∈ 'loading' | 'ready' | 'not-found' | 'error'`, `events` is the
  full log ascending by `sequence`. Already paginates to completion and
  carries the defensive per-row `isEventLike` guard. Exported at
  `packages/shell/src/index.ts:167–172`.
- **Event envelope (the row source type).**
  `packages/shared-types/src/events.ts:820–863` — `EventEnvelope` /
  `Event` (`{ id, sessionId, sequence, kind, actor, payload, createdAt }`),
  per **ADR 0021** (`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`).
- **Live WS overlay source.** `apps/participant/src/ws/wsStore.ts:36`
  (`useWsStore`), selector `state.sessionState[sessionId]?.events` — the
  same selector the participant list views read
  (`part_proposal_list_view.md`, `part_my_agreements_view.md`). The store
  creates a new `events` array reference on each `applyEvent`, so a WS
  selector re-renders the pane the moment a new event lands.
- **Wiring points** (this task edits all three):
  - `apps/participant/src/stores/uiStore.ts:21` — add `'history'` to the
    `ParticipantTab` union.
  - `apps/participant/src/proposals/ParticipantTopTabBar.tsx:50–72` — add a
    fourth `<TabButton tab="history">`.
  - `apps/participant/src/routes/OperateRoute.tsx:415–461` — add a
    `currentTab === 'history'` branch mounting the new pane (the current
    ternary's final `else` is `proposals`; the new branch must be inserted
    explicitly, not via the trailing else).
- **Sibling list-view conventions** (mirror): `part_diagnostics_list.md`
  (recent list inventory, test-id + i18n + test-layer conventions),
  `part_proposal_list_view.md` and `part_my_agreements_view.md`
  (duplicate-don't-extract rule, `participant.<feature>.*` i18n namespace).
- **i18n.** The moderator catalog already holds the full surface-neutral
  string set under `moderator.changeHistory.*` in
  `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`
  (`paneAriaLabel`, `systemActor`, `loading`, `error`, `retry`,
  `emptyState`, `kind.<EventKind>` for all 17 kinds — en-US at
  `:340–365`). Catalog-parity tests follow the i18n convention
  (**ADR 0024**); the participant tab labels live under
  `participant.proposalsTab.*` (`ParticipantTopTabBar.tsx:51,58,61`).

## Constraints / requirements

1. **Complete log, not live-only.** The pane MUST source the full session
   log via `useSessionEventLog` (REST prefetch to completion). Live WS
   `events` are overlaid for liveness but are not the base — a debater who
   joined mid-session must still see earlier events.
2. **Reverse-chronological.** Rows render newest-first (descending
   `sequence`). The REST/WS sources are ascending; the selector reverses.
3. **Minimal row (v1).** Each row shows: localized **kind** label, **actor**
   (8-char id prefix, or the localized "System" label when `actor === null`),
   and a **relative timestamp** (`formatRelativeTime`). No per-kind payload
   summary, no click-to-focus, no withdraw/commit affordances — those are
   moderator-only enrichments with no participant WBS leaf (see Open
   questions). Rows are read-only `<li>` elements.
4. **Four display states**, mirroring the moderator pane: `loading` while the
   prefetch is in flight; `error` with a retry button on REST failure
   (fold the hook's `'not-found'` status into the error surface — the
   operate-view session is always visible to its participants, so
   `'not-found'` is effectively unreachable and earns no distinct UI);
   `empty` once ready with zero rows; the list otherwise.
5. **Stable seams.** The list container, each row, and the row's three
   columns carry `data-testid` + data-attributes following the participant
   convention (`data-testid="participant-history-*"`, plus `data-event-id` /
   `data-event-kind` / `data-sequence` on the `<li>`), so the component test
   and the Playwright spec query stable selectors.
6. **Reachable.** This task adds the History tab to
   `<ParticipantTopTabBar>`, the `'history'` member to `ParticipantTab`, and
   the `currentTab === 'history'` branch in `<OperateRoute>`. After this task
   the pane is reachable from the operate route.
7. **No new store slice.** Use the existing `useUiStore` `currentTab` /
   `setCurrentTab` and the existing `useWsStore` selector. No Zustand slice
   is added (mirrors the other list views).
8. **Duplicate, don't extract.** The pure row selector is duplicated into the
   participant rather than extracted to the shell — the moderator's
   `mergeAndOrderEventLog` is consumer #1, this is consumer #2; extraction
   waits for a third consumer (audience / replay), matching the established
   participant precedent (`part_proposal_list_view.md` Decisions §1,
   `part_my_agreements_view.md` Decisions §1). Do **not** edit moderator code.
9. **i18n — no hard-coded user-facing English.** All chrome strings and kind
   labels resolve through `t(...)`. New keys live under
   `participant.changeHistory.*` (Decisions §D5); the new tab label under
   `participant.proposalsTab.historyLabel`. Drafts for pt-BR + es-419 are
   added and flagged in the catalogs' review lists; native-speaker sign-off
   is a separate registered leaf (see Acceptance criteria §8).
10. **File scope.** Write the pane + selector + tests under
    `apps/participant/src/history/`; extend `uiStore.ts`,
    `ParticipantTopTabBar.tsx`, `OperateRoute.tsx` and their tests; add the
    i18n keys + a participant catalog-parity test; add the Playwright spec.
    No other files. No edits to moderator code, the shell hook, or any
    `.tji` file.

## Acceptance criteria

All criteria are committed, CI-run checks — **no throwaway / manual
verification (ADR 0022)**. Per the global rule, `make` build + the full
Vitest/Cucumber/Playwright suites pass before commit (pre-commit gate).

1. **`pnpm install` / typecheck / build clean** across the workspace
   (TypeScript strict, ADR 0013).
2. **`pnpm run check` green** (lint + format + typecheck + unit tests).
3. **Selector unit test** — `apps/participant/src/history/deriveHistoryRows.test.ts`
   (Vitest, ADR 0006) pins the pure selector: dedup by `id` across the REST
   + WS inputs, descending-`sequence` (newest-first) ordering, the
   `actor === null` → system path, and the minimal row mapping. (No
   `Date.now()` / clock dependence — `nowMs` is injected.)
4. **Component test** — `apps/participant/src/history/ParticipantHistoryPane.test.tsx`
   (Vitest + `createI18nInstance('en-US')`, deterministic injected `nowMs`)
   asserts all four states render with the expected test-ids; rows render
   newest-first with the correct kind label, actor text, and relative
   timestamp; the error state's retry button re-runs the fetch.
5. **Wiring tests** — `ParticipantTopTabBar.test.tsx` gains a case for the
   fourth (History) tab button rendering + selecting `'history'`;
   `OperateRoute.test.tsx` gains a case that `currentTab === 'history'`
   mounts `<ParticipantHistoryPane>`.
6. **`pnpm run test:smoke` green**, smoke count grows by the sum of the new
   cases above (report the exact delta in the Status block, e.g.
   `+N (X from deriveHistoryRows.test.ts + Y from ParticipantHistoryPane.test.tsx
   + Z from the tab-bar/route extensions)`, matching the per-test budget).
7. **e2e is in scope (not deferred).** This task wires the History tab into
   the operate route, so the pane is reachable — a new Playwright spec
   `tests/e2e/participant-history.spec.ts` (ADR 0008, run under `make up` via
   `pnpm run test:e2e --project=chromium-participant-skeleton`) logs in,
   joins/operates a session that has accrued events, switches to the History
   tab, and asserts the list renders the expected events newest-first with
   their kind labels. (No prior participant refinement defers history e2e to
   a `part_pw_*` catch-all — the two existing participant `part_pw_*` tasks
   are pending-proposals work — so there is no inherited debt to fold in.)
8. **i18n catalog parity** — a participant catalog-parity test
   (`packages/i18n-catalogs/src/participant-change-history.test.ts`, ADR 0024)
   asserts the new `participant.changeHistory.*` + `participant.proposalsTab.historyLabel`
   keys are present in en-US, pt-BR, and es-419 and parse under ICU.
   `pnpm --filter @a-conversa/i18n-catalogs run check` is green. Native-speaker
   review of the pt-BR + es-419 drafts is deferred to
   `frontend_i18n.i18n_participant_change_history_native_review` (≈0.25d;
   `depends` the prior participant i18n-review chain tail +
   `participant_ui.part_history_view.part_history_list`; M-frontend-i18n
   milestone — closer registers in the WBS). Because the kind-label values
   duplicate the already-approved `moderator.changeHistory.kind.*`
   translations, that review is a parity check, not a fresh translation.
9. **No file modifications outside the §10 allowlist;** predecessor test
   assertions remain unchanged.

## Decisions

- **§D1 — Data source: REST prefetch (`useSessionEventLog`) + live WS
  overlay, reversed.** Chosen over (a) WS-store-only, like the other
  participant list views, and (b) a fresh participant-local fetch.
  Rationale: the WS store holds only post-connect events and may be
  incomplete after a snapshot-state catch-up — a history/audit view must show
  the *whole* log, which is precisely why the parent task depends on the
  replay endpoint. The shell already exposes `useSessionEventLog` (pages to
  completion, defensive row guard, retry) — reusing it is strictly less code
  and risk than a new fetch. Overlaying live WS `events` keeps the list
  current while the tab is open (a new event reference re-renders the memo),
  mirroring the moderator pane's REST+WS merge (`ChangeHistoryPane.tsx:21–26,
  277–291`). The merge/order is a small pure selector duplicated into the
  participant (Constraint §8).
- **§D2 — This leaf owns the tab/route wiring; no separate wiring task.**
  The WBS has no "wire history tab" leaf, and a list component nobody can
  reach is dead code. So `part_history_list` adds the `'history'` tab union
  member, the fourth `<TabButton>`, and the `OperateRoute` branch as part of
  its delivery. This also keeps the e2e in scope (the UI-stream policy's
  full-deferral exception applies only when nothing renders the component;
  here this task renders it).
- **§D3 — Minimal row in v1 (kind + actor + timestamp), read-only.** Mirrors
  the moderator's foundation leaf `mod_history_scroller`, which deferred the
  per-kind payload summary (`mod_history_event_summary`) and click-to-flash
  (`mod_history_click_to_flash`) to sibling leaves. The participant WBS has
  **no** equivalent summary or click-to-focus leaf — only `part_history_list`
  + `part_history_filtering` — so v1 stays minimal and read-only. Adding a
  payload summary or row-tap-to-focus is a product-scope call, not silent
  scope creep (see Open questions).
- **§D4 — Fold the hook's `'not-found'` status into the error surface.** The
  `'not-found'` state exists for test-mode, where an operator pastes an
  arbitrary id (`useSessionEventLog.ts:15–19`). In the participant operate
  route the session is always visible to its own participants, so a 404 is
  effectively unreachable; giving it a bespoke affordance would be untestable
  dead UI. Treat it as the retry-able error state.
- **§D5 — New i18n keys under `participant.changeHistory.*`; do not read the
  moderator namespace.** Chosen over reusing `moderator.changeHistory.*`
  cross-surface. Although the *values* are surface-neutral, the keys are
  namespaced under `moderator`, and reading them from participant code
  couples the two surfaces' catalogs and breaks the duplicate-don't-extract
  precedent (Constraint §8). Duplicating the keys under
  `participant.changeHistory.*` keeps the namespaces clean and the file scope
  contained; a third consumer (audience/replay history) is the trigger to
  promote a shared `changeHistory.*` namespace. The duplicated kind-label
  *values* mirror the approved moderator translations, so the native-review
  cost is a parity check (Acceptance §8).
- **§D6 — No virtualization in v1.** Mirrors the moderator pane
  (`ChangeHistoryPane.tsx:34`). Debate-session logs are bounded (hundreds,
  low thousands of events); a plain `<ol>` is adequate. Windowing is a
  speculative perf concern, not WBS work (see Open questions).

## Open questions

(none — all decided.)

Two product-scope possibilities are intentionally **not** WBS tasks and are
surfaced for the parking lot rather than auto-registered, since each is a
human product call about whether the debater surface should match the
moderator's, not agent-implementable scope:

- Whether participant history rows should carry a per-kind payload **summary**
  (the moderator's `mod_history_event_summary`) and/or **tap-to-focus** on the
  graph (the moderator's `mod_history_click_to_flash`). v1 omits both.
- Whether very long logs warrant **windowing/virtualization** (the moderator
  also deferred this).

## Status

**Done** — 2026-06-05.

- Pure selector `apps/participant/src/history/deriveHistoryRows.ts` — deduplicates REST + WS inputs by `id`, reverses to newest-first, maps each event to `{ kind, actor, timestamp }` row shape; `nowMs` injected for deterministic tests.
- Selector unit test `apps/participant/src/history/deriveHistoryRows.test.ts` (7 cases) — covers dedup, ordering, `actor === null` → system path, minimal row mapping.
- Pane component `apps/participant/src/history/ParticipantHistoryPane.tsx` — four display states (loading / error+retry / empty / list), `data-testid="participant-history-*"` + `data-event-id` / `data-event-kind` / `data-sequence` on `<li>` rows; all chrome strings via `t(...)` from `participant.changeHistory.*`.
- Component test `apps/participant/src/history/ParticipantHistoryPane.test.tsx` (8 cases) — all four states, newest-first row order, kind label, actor text, relative timestamp, retry button.
- Wiring: `apps/participant/src/stores/uiStore.ts` (`'history'` added to `ParticipantTab` union), `apps/participant/src/proposals/ParticipantTopTabBar.tsx` (fourth `<TabButton tab="history">`), `apps/participant/src/routes/OperateRoute.tsx` (`currentTab === 'history'` branch mounting pane); matching test extensions (+2 tab-bar cases, +1 route case).
- i18n: `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — `participant.proposalsTab.historyLabel` + full `participant.changeHistory.*` key set (parity with `moderator.changeHistory.*`); pt-BR + es-419 drafts mirror approved moderator translations; native-speaker parity review deferred to human (covered by parking-lot entry 2026-05-30).
- Catalog-parity test `packages/i18n-catalogs/src/participant-change-history.test.ts` — asserts all new keys present + ICU-parseable in all three locales.
- Playwright spec `tests/e2e/participant-history.spec.ts` (1 scenario) — logs in as `peter`+`quinn`, operates a session, switches to History tab, asserts newest-first list with kind labels.
- Smoke delta: **+18** participant Vitest cases (7 selector + 8 component + 2 tab-bar + 1 route) + new i18n parity suite.
- `playwright.config.ts` widened `testMatch` for participant project to include the new spec.
- Tech-debt follow-up `frontend_i18n.i18n_participant_change_history_native_review` is human-only (native-speaker sign-off); not registered as a WBS task — covered by existing parking-lot entry 2026-05-30.
