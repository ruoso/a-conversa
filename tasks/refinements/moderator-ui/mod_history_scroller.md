# Refinement — `moderator_ui.mod_change_history_pane.mod_history_scroller`

## TaskJuggler entry

Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) under
`task mod_change_history_pane "Change history pane"`:

```
task mod_change_history_pane "Change history pane" {
  depends !mod_layout.mod_right_sidebar, root_app.root_moderator_cutover, backend.replay_endpoints.get_session_log
  task mod_history_scroller "Reverse-chronological event scroller" {
    effort 1d
    allocate team
  }
  task mod_history_event_summary "Brief payload summary per entry" { depends !mod_history_scroller }
  task mod_history_click_to_flash "Click entry to flash affected entities on graph" { depends !mod_history_scroller }
  task mod_history_filtering "Filter by event kind / actor / target" { depends !mod_history_scroller }
}
```

## Effort estimate

**1 day.** Adds one fetch hook, one pure merge/order helper, one pane
component (closely modeled on the existing `PendingProposalsPane`), the
`changeHistorySlot` wiring in `Operate.tsx`, a handful of i18n keys, and the
Vitest + Playwright coverage. The hard design questions (data source, ordering,
scroll, reachability) are settled below; the implementation is mostly a
near-copy of an established pane shape.

## Inherited dependencies

The parent `mod_change_history_pane` carries the dependencies; `mod_history_scroller`
is its first leaf and inherits all three.

**Settled (Done):**

- **`mod_layout.mod_right_sidebar`** (Done 2026-05-11) —
  [`apps/moderator/src/layout/RightSidebar.tsx`](../../../apps/moderator/src/layout/RightSidebar.tsx).
  `<RightSidebar>` already exposes a `changeHistorySlot?: ReactNode` prop
  (`RightSidebar.tsx:37-38`), already renders the change-history pane block
  with stable test id `right-sidebar-pane-change-history`
  (`RightSidebar.tsx:82-84,110`) and the localized title key
  `moderator.rightSidebar.panes.changeHistory.title` (already present in all
  three catalogs). The slot currently renders the "Coming soon" placeholder;
  this task fills it.
- **`root_app.root_moderator_cutover`** (Done 2026-05-16) — the moderator surface
  mounts under `/m/sessions/:id/operate`; the session id reaches components as a
  URL param. `Operate.tsx:109` reads `const { id = '' } = useParams<{ id: string }>();`
  and the route is wrapped in `<WsClientProvider store={useWsStore}>`
  (`Operate.tsx:124-130`), so the WS event log is already populated for the
  operating session.
- **`backend.replay_endpoints.get_session_log`** (Done 2026-06-03) —
  [`tasks/refinements/backend/get_session_log.md`](../backend/get_session_log.md).
  `GET /sessions/:id/events?after=<seq>&limit=<n>` returns
  `{ events: Event[], nextCursor: number | null }`, ordered **ascending by
  sequence** (replay order), cursor-paginated on `sequence` (`after` exclusive
  lower bound, default 0; `limit` 1–1000, default 100). Visibility-gated
  (invisible → 404). This is the full-log source the pane prefetches.

**Pending:** (none — all three settled.)

## What this task is

Build the **change-history pane** — the third stacked pane in the moderator
right sidebar — and its foundational **reverse-chronological event scroller**.
The scroller renders the session's full event log newest-first (highest
`sequence` at the top), one row per event, and stays live: events broadcast over
the WebSocket while the moderator works appear at the top as they arrive.

This is the *foundation* leaf of the pane. It deliberately renders a **minimal
row** — event-kind label, actor (8-char prefix), relative timestamp — and owns
the data-fetch, merge/order, scroll, and empty/loading/error states. The three
sibling tasks build on the row contract this task establishes:

- `mod_history_event_summary` enriches each row with a per-kind payload summary.
- `mod_history_click_to_flash` makes a row click flash the affected graph entities.
- `mod_history_filtering` adds kind / actor / target filters over the same list.

## Why it needs to be done

The change-history pane is the moderator's audit/orientation surface — "what just
happened, and in what order." It gates **M7 (end-to-end debate)**
([`tasks/99-milestones.tji`](../../99-milestones.tji), `m_end_to_end_debate`),
whose note calls out the change-history pane as one of the walkthrough flows that
must work live. Everything in this pane's subtree depends on this scroller, so it
unblocks three sibling tasks plus the milestone.

## Inputs / context

- **Slot contract** — [`apps/moderator/src/layout/RightSidebar.tsx`](../../../apps/moderator/src/layout/RightSidebar.tsx):
  - `RightSidebar.tsx:37-38` — `changeHistorySlot?: ReactNode`.
  - `RightSidebar.tsx:82-84` — pane entry `key: 'change-history'`, `titleKey:
    'moderator.rightSidebar.panes.changeHistory.title'`, `slot: props.changeHistorySlot`.
  - `RightSidebar.tsx:110` — wrapper test id `right-sidebar-pane-change-history`.
  - The sidebar owns the per-pane `<section>`, header, collapse toggle, and aria
    wiring; **the slot content is just the pane body.**
- **Template pane** — [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx):
  - `PendingProposalsPane.tsx:602` — `useWsStore((s) => s.sessionState[sessionId]?.events)`.
  - `PendingProposalsPane.tsx:624` — `useMemo(() => derive…(events ?? []), [events])`.
  - Row test-id / column / `truncate` / relative-time idiom; empty-state test id
    `pending-proposals-pane-empty`. **Copy this shape.**
- **Selector template** — [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts)
  `pendingProposals.ts:1-54` — pure walk over `readonly Event[]`, newest-first by
  `sequence` descending, no `Date.now()`/`Math.random()` in the selector.
- **Mount point** — [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx):
  - `Operate.tsx:109` — `const { id = '' } = useParams<{ id: string }>();`
  - `Operate.tsx:353-356` — `<RightSidebar pendingProposalsSlot={…} diagnosticFlagsSlot={…} />`
    (no `changeHistorySlot` yet — this task adds it).
- **WS store shape** — [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) `:38`
  → [`packages/shell/src/ws/store-contract.ts`](../../../packages/shell/src/ws/store-contract.ts):
  - `store-contract.ts:52` — `lastAppliedSequence: number` (high-water mark).
  - `store-contract.ts:54` — `events: Event[]` (deduped, arrival order).
  - `store-contract.ts:118` — `applyEvent: (event: Event) => boolean` (test seam).
- **REST fetch idiom** — [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx):
  - `InviteParticipants.tsx:156-181` — `fetch('/api/sessions/${id}', { method:'GET',
    credentials:'include', headers:{ Accept:'application/json' } })`, then status
    check + defensive `await response.json()` parse.
  - `InviteParticipants.tsx:187,274-275` — `let cancelled = false` unmount guard.
  - No central `apiClient`; routes call `fetch` directly under the `/api`
    dev-proxy prefix. **No existing client helper for `GET /sessions/:id/events`** —
    this task adds the first frontend caller.
- **Event envelope** — ADR 0021
  ([`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)),
  [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):
  `EventEnvelope<K>` (`events.ts:820`) / `Event` (`events.ts:861`) carry
  `id, sessionId, sequence, kind, actor (string | null), payload, createdAt`.
  `kind` enumerates ~17 values (`session-created`, `participant-joined`,
  `node-created`, `edge-created`, `annotation-created`, `entity-included`,
  `entity-removed`, `proposal`, `proposal-withdrawn`, `vote`, `commit`,
  `meta-disagreement-marked`, `snapshot-created`, `session-mode-changed`,
  `withdraw-agreement`, `session-ended`, `participant-left`).
- **Relative-time formatter** — [`packages/i18n-catalogs/src/format.ts`](../../../packages/i18n-catalogs/src/format.ts) `:233`
  already documents a shared formatter "for the change-history pane and any
  'N seconds ago' prose." Reuse it for the timestamp column rather than
  re-implementing.
- **i18n** — ADR 0024; catalogs at
  [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/).
  The `moderator.rightSidebar.panes.changeHistory.title` key already exists
  (en-US.json ~line 217); the new keys this task adds are under `moderator.changeHistory.*`.
- **E2E seed backdoor** — [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts)
  `seedWsStore(page, …)` drives `applyEvent` through the
  `window.__aConversaWsStore` handle exposed at
  [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) `:55`.

## Constraints / requirements

1. **Full-log source is the REST replay endpoint, not the WS log alone.** The
   pane must reflect the *complete* session history. The WS log only contains
   what catch-up delivered — and catch-up may take the **`snapshot-state`
   fallback** path, in which case `sessionState.events` holds a projected
   snapshot, not the full event list. The pane prefetches `GET
   /api/sessions/:id/events` paginating `after`→`nextCursor` to completion, then
   overlays live WS events (the established "REST prefetch + WS overlay" pattern,
   precedent `mod_invite_participants_rest_prefetch`).
2. **Reverse-chronological display.** Newest first — `sequence` **descending**.
   The REST endpoint returns ascending; the pane reverses for display. `sequence`
   is the sole, gap-tolerant, tie-free order key (per-session monotonic).
3. **Merge is pure and dedup-by-sequence.** A pure helper unions the prefetched
   page set with the live WS `events`, deduped on `sequence` (same envelope, same
   key), sorted descending. No `Date.now()`/`Math.random()` in the helper;
   relative-time is formatted at render with an injected `nowMs` prop (mirrors
   `PendingProposalsPane`).
4. **Minimal row only.** Three columns: localized **kind label** + **actor**
   (8-char prefix; `null` actor → localized "System") + **relative timestamp**.
   Payload detail is explicitly out of scope (it is `mod_history_event_summary`).
5. **Row contract is stable and reused by siblings.** Each row:
   `data-testid="change-history-row"` with `data-event-id`, `data-event-kind`,
   `data-sequence`; columns `change-history-row-kind`,
   `change-history-row-actor`, `change-history-row-timestamp`. Siblings extend
   this row, so the attributes must be present from this task.
6. **Scroll inside the slot.** The pane body sets `overflow-y: auto` /
   `max-height: 100%` so it scrolls within the sidebar; the outer layout never
   scrolls. **No virtualization in v1** (matches the `PendingProposalsPane`
   decision) — example-walkthrough logs are bounded (tens–low-hundreds of
   events).
7. **States.** Distinct loading / error / empty surfaces, all localized:
   - loading: `data-testid="change-history-pane-loading"`;
   - error (REST failure): `data-testid="change-history-pane-error"` plus a
     `change-history-pane-retry` button that re-runs the prefetch;
   - empty (ready, zero events): `data-testid="change-history-pane-empty"`.
8. **No new dependency, no localStorage, in-memory only** (consistent with the
   moderator store policy). DevTools middleware stays behind `import.meta.env.DEV`.
9. **i18n parity** across en-US / pt-BR / es-419 for every new key, including a
   per-kind label for each `EventKind` (ADR 0024).
10. **Unmount-safe fetch** — `cancelled` guard so the prefetch never setStates a
    torn-down component (precedent `InviteParticipants.tsx:187,274-275`).

## Acceptance criteria

Per ADR 0022, every check below ships as a committed automated test — no
throwaway verification.

**Vitest (unit / component)** — `apps/moderator/src/…`:

1. **Merge/order helper** (e.g. `mergeAndOrderEventLog(prefetched, live)`):
   given overlapping prefetched + live `Event[]`, returns a sequence-**descending**
   list, deduped on `sequence`, with index 0 = highest sequence. Pure (same input
   → same output; no clock/RNG).
2. **Pane render against seeded store + mocked fetch:** with the global `fetch`
   mocked to return two ascending pages (`nextCursor` chained then `null`) and
   `useWsStore.getState().applyEvent(...)` injecting a higher-sequence live event,
   the pane renders all rows newest-first; the live event is at the top.
3. **Row contract:** each row exposes `data-event-id` / `data-event-kind` /
   `data-sequence` and the three column test ids; `null` actor renders the
   localized "System" label.
4. **States:** loading test id present before the fetch resolves; error test id +
   working retry button on a rejected fetch; empty test id when the fetch resolves
   with zero events.
5. **i18n parity:** every new `moderator.changeHistory.*` key (including each
   per-kind label) resolves to a non-empty, locale-distinct string in en-US /
   pt-BR / es-419.

**Playwright (e2e)** — **in scope, not deferred.** This task wires
`changeHistorySlot` into `Operate.tsx`, so the pane becomes route-rendered and
reachable, and the WS-overlay path is seedable today via `seedWsStore`:

6. A spec under `tests/e2e/` navigates to `/m/sessions/:id/operate`, asserts
   `right-sidebar-pane-change-history` and `change-history-pane` are present, uses
   `seedWsStore` to inject a small ordered event sequence, and asserts the rows
   render newest-first (top row's `data-sequence` is the highest seeded). Reuses
   the existing `window.__aConversaWsStore` backdoor — no new harness hook needed.

**Deferred (named, not new debt):** the **REST-prefetch-from-live-server**
full-log content assertion (cold load against a real backend with no WS seeding)
is exercised by the existing real-stack catch-all
`moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_full_session_run` (the example
walkthrough run, which already gates M7 and naturally surfaces the change
history). This task adds that as an **inherited scenario** on that task — the
closer registers the one-line note against `mod_pw_full_session_run` (milestone
M7). It is *not* routed to `mod_pw_diagnostic_flow`, which already carries 4+
deferred-e2e debts and must not accrue more.

**Build/test gate:** `make` build + test green before commit (global rule).

## Decisions

- **D1 — Full-log source: REST prefetch + WS overlay (chosen) over WS-log-only.**
  The change-history pane must show the *complete* log; the WS `events` array is
  not guaranteed complete because catch-up may return a `snapshot-state` fallback
  instead of replaying every event. The parent task's explicit dependency on
  `get_session_log` signals the REST endpoint as the intended source. *Rejected:
  WS-log-only* — simpler (a near-verbatim copy of `PendingProposalsPane`) but
  silently truncates history whenever catch-up snapshots, which is exactly the
  long-session case where an audit pane matters most. The overlay merge keeps the
  pane live without that gap.
- **D2 — Order on `sequence` descending (chosen) over `createdAt`.** `sequence`
  is per-session monotonic, tie-free, and the server's canonical order key;
  `createdAt` can collide at clock resolution and isn't the replay key. Display
  reverses the REST endpoint's ascending order in the merge helper.
- **D3 — Dedup-by-sequence union (chosen) over dedup-by-`id` or
  last-write-wins-by-arrival.** Both REST and WS envelopes share the same
  `sequence`; sequence is the natural, cheap dedup key and also the sort key, so
  one pass does both. (`id` would work too but sequence is already required for
  ordering — one key is simpler.)
- **D4 — Minimal three-column row now; payload summary deferred to the sibling.**
  The `.tji` splits "scroller" from "payload summary" into separate leaves. This
  task ships kind-label + actor + timestamp so the scroller is useful standalone;
  `mod_history_event_summary` enriches the middle. The row's stable data-attributes
  are established here so siblings extend rather than reshape.
- **D5 — No virtualization in v1 (chosen) over windowing now.** Mirrors the
  `PendingProposalsPane` decision. Example-walkthrough logs are bounded; adding a
  virtualization dependency for a surface that renders fine at current scale is
  premature. Surfaced as a parking-lot watch item (not a WBS task — "re-evaluate
  if perf degrades" is a judgment call, not implementable work) so it is revisited
  only if real logs grow large.
- **D6 — E2E in scope inline; only the live-server full-log path is deferred, to
  the existing `mod_pw_full_session_run`.** Per the UI-stream e2e policy, the pane
  is route-rendered and WS-seedable after this task's wiring, so a thin-but-real
  spec (presence + seeded reverse-chron order) lands here. Routing the live-server
  content assertion to `mod_pw_diagnostic_flow` is *rejected* — that catch-all is
  already overloaded (4+ inherited debts); `mod_pw_full_session_run` is the
  natural, lightly-loaded home and already enacts the walkthrough that shows the
  history.
- **D7 — Reuse the shared relative-time formatter** from `i18n-catalogs/format.ts`
  (already earmarked for this pane) rather than re-implementing `relativeTimeFor`.
  Keeps the "N seconds ago" prose consistent across panes and locale-correct.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-03.

- `apps/moderator/src/graph/changeHistory.ts` — pure `mergeAndOrderEventLog` helper (union, dedup-by-sequence, descending).
- `apps/moderator/src/layout/useSessionEventLogPrefetch.ts` — REST prefetch hook (paginates `GET /api/sessions/:id/events`, cancelled-guarded, retry).
- `apps/moderator/src/layout/ChangeHistoryPane.tsx` — pane component with loading/error/empty/list surfaces; minimal 3-column row (kind label + actor + relative timestamp).
- `apps/moderator/src/routes/Operate.tsx` — imports `ChangeHistoryPane`, wires `changeHistorySlot` into `<RightSidebar>`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — `moderator.changeHistory.*` flat keys + per-kind labels for all 17 `EventKind`s; parity across three locales.
- `apps/moderator/src/graph/changeHistory.test.ts` — Vitest: `mergeAndOrderEventLog` (5 cases).
- `apps/moderator/src/layout/ChangeHistoryPane.test.tsx` — Vitest: prefetch+overlay order, row contract (`data-event-id`/`data-event-kind`/`data-sequence`), loading/error/empty/non-200, retry button.
- `packages/i18n-catalogs/src/change-history.test.ts` — Vitest: i18n parity for `moderator.changeHistory.*` across all three locales.
- `tests/e2e/moderator-change-history.spec.ts` — Playwright: pane present + seeded reverse-chron row order.
- Inherited scenario registered on `mod_pw_full_session_run` (M7): REST-prefetch-from-live-server full-log content assertion (cold load against real backend).
