# Refinement — `moderator_ui.mod_change_history_pane.mod_history_filtering`

## TaskJuggler entry

Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) under
`task mod_change_history_pane "Change history pane"`:

```
task mod_change_history_pane "Change history pane" {
  depends !mod_layout.mod_right_sidebar, root_app.root_moderator_cutover, backend.replay_endpoints.get_session_log
  task mod_history_scroller "Reverse-chronological event scroller" { effort 1d; allocate team; complete 100 }
  task mod_history_event_summary "Brief payload summary per entry" { effort 1d; allocate team; complete 100; depends !mod_history_scroller }
  task mod_history_click_to_flash "Click entry to flash affected entities on graph" { effort 1d; allocate team; complete 100; depends !mod_history_scroller }
  task mod_history_filtering "Filter by event kind / actor / target" {
    effort 1d
    allocate team
    depends !mod_history_scroller
  }
}
```

## Effort estimate

**1 day.** Confirmed. The deliverable is a small filter strip pinned above the
existing `<ol>` list inside `<ChangeHistoryPane>`, a thin block of local
component state carrying three filter dimensions (selected event-kinds,
selected actors, target-selection toggle), one pure predicate module
(`graph/historyFilter.ts`) with the predicate + two small derivation helpers
(available-kinds / available-actors-with-labels), a post-merge `useMemo` that
applies the predicate, a distinct filtered-empty state, a `moderator.historyFilter.*`
i18n namespace (~7 keys × 3 locales), and the Vitest + Playwright coverage. Every
seam the strip plugs into already exists from the three completed siblings: the
pane, the row contract, the merged-log source, the precomputed `summary` and
`affected` fields, and the `seedWsStore`-driven e2e harness. The only non-trivial
calls — how to make the **actor** dimension usable without a screen-name resolver
(D2), and what "**target**" means as a self-contained, testable filter (D3) — are
settled below. No new architectural seam, no new dependency (D7).

## Inherited dependencies

This leaf's only direct dependency is `!mod_history_scroller`; through the parent
`mod_change_history_pane` it transitively inherits the same three the scroller
inherited. It also **consumes** (de-facto, not a formal WBS edge — both are Done)
the row-contract enrichments the other two siblings landed.

**Settled (Done):**

- **`mod_history_scroller`** (Done 2026-06-03) —
  [`tasks/refinements/moderator-ui/mod_history_scroller.md`](mod_history_scroller.md).
  Shipped the pane, the row contract, the REST-prefetch+WS-overlay merged-log
  source, the loading/error/empty surfaces, and the `seedWsStore`-driven
  Playwright spec this task extends:
  - [`apps/moderator/src/graph/changeHistory.ts`](../../../apps/moderator/src/graph/changeHistory.ts) —
    `ChangeHistoryRow` (`:36-59`) + pure `mergeAndOrderEventLog` (`:82-109`).
  - [`apps/moderator/src/layout/ChangeHistoryPane.tsx`](../../../apps/moderator/src/layout/ChangeHistoryPane.tsx) —
    the pane (`:231-324`) and the co-located `ChangeHistoryRowItem` (`:178-229`).
  - [`tests/e2e/moderator-change-history.spec.ts`](../../../tests/e2e/moderator-change-history.spec.ts) —
    the route-rendered, `seedWsStore`-driven spec.
- **`mod_history_event_summary`** (Done 2026-06-03) —
  [`tasks/refinements/moderator-ui/mod_history_event_summary.md`](mod_history_event_summary.md).
  Added the `summary` descriptor field on `ChangeHistoryRow` and the pure
  `summarizeEvent` helper. This task does **not** re-derive summaries; it reads
  `row.kind` directly for the kind dimension.
- **`mod_history_click_to_flash`** (Done 2026-06-03) —
  [`tasks/refinements/moderator-ui/mod_history_click_to_flash.md`](mod_history_click_to_flash.md).
  Added the precomputed `affected: { nodeIds, edgeIds }` field on
  `ChangeHistoryRow` (`apps/moderator/src/graph/affectedEntities.ts`). The
  **target** dimension (D3) reads exactly this field — no new payload extraction
  needed. This is the leaf that makes a self-contained "filter by target"
  tractable: every row already knows which graph entities it touches.
- **`mod_layout.mod_right_sidebar`** (Done 2026-05-11), **`root_app.root_moderator_cutover`**
  (Done 2026-05-16), **`backend.replay_endpoints.get_session_log`** (Done 2026-06-03) —
  consumed already by the scroller; no new surface here.
- **`useSelectionStore`** (pre-existing infrastructure —
  [`apps/moderator/src/stores/selectionStore.ts`](../../../apps/moderator/src/stores/selectionStore.ts)).
  Read-only consumer for the target dimension (D3). Not a formal WBS edge; it is
  established moderator-canvas state the diagnostic/annotation flows already drive.

**Pending:** (none — all settled.)

## What this task is

Land the moderator's **filter affordance for the change-history pane**: a small
strip pinned above the existing newest-first event list, narrowing it along the
three dimensions named in the task title — **event kind**, **actor**, and
**target** — AND-composed (a row survives iff it passes every active dimension).
The change-history pane is the moderator's audit / orientation surface; once a
live debate has produced dozens of events, "what just happened to *this* entity",
"show me only the votes", and "show me only what *that participant* did" are the
questions the pane must answer without scrolling the whole log.

Concretely the deliverable is:

- **One new pure predicate module** `apps/moderator/src/graph/historyFilter.ts`
  exporting:
  - `interface HistoryFilter { kinds: ReadonlySet<EventKind>; actors: ReadonlySet<string | null>; targetSelectedOnly: boolean }`
  - `const EMPTY_FILTER: HistoryFilter` (the default — empty kind set, empty actor
    set, `targetSelectedOnly: false`) + `isDefaultFilter(filter)`.
  - `function matchesHistoryFilter(row: ChangeHistoryRow, filter: HistoryFilter, selectedEntityId: string | null): boolean`
    — pure. The three dimensions are AND-composed; an **empty set means "no
    narrowing on that dimension"** (every kind / every actor passes), so the
    empty default short-circuits to `true` and the predicate is the identity for
    callers that haven't installed a non-default filter.
  - `function deriveAvailableKinds(rows: readonly ChangeHistoryRow[]): readonly EventKind[]`
    — the distinct kinds present in the merged log, in a stable order, so the kind
    chip group only renders kinds that actually occur.
  - `function deriveActorOptions(events: readonly Event[]): readonly { actor: string | null; label: string }[]`
    — the distinct actors present, each with a **display label resolved from the
    log itself** (D2): a `participant-joined` event carries `user_id` +
    `screen_name`, so this walk builds an `actor → screen_name` map and labels
    each actor by name (falling back to the 8-char id prefix the row already
    shows, and to the localized "System" label for `actor === null`).
- **One filter-strip UI pinned at the top of the pane body**, rendered ABOVE the
  conditional loading/error/empty-vs-list branch so it stays reachable even when
  the post-filter list is empty (D4). Always visible (D5). Contents:
  - A **kind chip group** — one toggle chip per available kind, labeled via the
    existing `moderator.changeHistory.kind.*` key (D1 — **zero new kind i18n**),
    each carrying `data-testid="change-history-filter-kind"` +
    `data-filter-kind="<kind>"` + `aria-pressed`.
  - An **actor chip group** — one toggle chip per available actor, labeled per D2,
    each carrying `data-testid="change-history-filter-actor"` +
    `data-filter-actor="<actorId|system>"` + `aria-pressed`.
  - A **target toggle** — a single chip "Selected entity only"
    (`data-testid="change-history-filter-target"` + `aria-pressed`) that, when on
    AND a graph entity is selected, narrows to rows whose `affected` set includes
    the selected entity id (D3). Rendered **disabled** with an explanatory
    `title` when nothing is selected.
  - A **clear-filters button** (`data-testid="change-history-filter-clear"`),
    shown only when the filter is non-default, resetting to `EMPTY_FILTER`.
  - The strip container carries `data-testid="change-history-filter-strip"` and a
    localized region `aria-label`.
- **One new filtered-empty state** — `<p data-testid="change-history-pane-filtered-empty">`,
  rendered when the filter is non-default AND the post-filter row count is zero,
  distinct from the existing `change-history-pane-empty` (D4).
- **Filter state as local component state** inside `<ChangeHistoryPane>` (D5 — no
  Zustand slice for the filter itself; the target dimension reads `useSelectionStore`
  read-only), plus a post-merge `useMemo` applying the predicate, identity-stable
  on the default fast path.
- **~7 i18n keys** under a new `moderator.historyFilter.*` namespace (D6), pt-BR +
  es-419 drafts flagged PENDING, with the native-review follow-up registered.
- **Vitest + Playwright coverage** (Acceptance criteria; ADR 0022).

It does **not** add a free-text search box (deferred — see Open questions /
parking-lot note in the return summary; the task title scopes structured
kind/actor/target dimensions, and a free-text matcher would also re-introduce the
i18n-resolution-purity wrinkle the structured predicate avoids), and it does not
add a per-entity target *picker* dropdown (D3 picks the selection-coupled toggle;
the wording-resolving picker is surfaced to the parking lot, not a WBS leaf).

This is the **fourth and last of the four original leaves** of
`mod_change_history_pane` (after `mod_history_scroller`, `mod_history_event_summary`,
`mod_history_click_to_flash`). Closing it lets the parent container derive-complete.

## Why it needs to be done

1. **An audit pane without a filter degrades to a wall of rows.** A live debate
   produces a steady stream of events across many minutes; even newest-first, the
   moderator scanning for "the three votes that just happened" or "everything
   about that one statement" must visually parse every row. The kind and target
   dimensions turn the pane from a scrolling log into a query surface — the same
   "narrow to the subset I'm working through" discipline `mod_proposal_filter_search`
   established for the pending-proposals pane.
2. **"Who did what" is a moderator-facing accountability question.** The actor
   dimension answers "show me everything debater-A did" — directly useful during
   moderation and post-hoc review. Crucially, the change-history pane already
   holds the full event log (REST prefetch), which **includes the
   `participant-joined` events that carry each actor's screen name** — so this
   pane can label actors by name where the pending-proposals pane could not
   (`mod_proposal_filter_search` D1.b rejected an author filter precisely because
   no screen-name resolver was reachable there; here the log self-supplies it —
   D2).
3. **It is the last leaf of the subgroup.** Landing it lets
   `mod_change_history_pane` derive-complete; the parent feeds **M7
   (end-to-end debate)** ([`tasks/99-milestones.tji`](../../99-milestones.tji),
   `m_end_to_end_debate`), whose walkthrough exercises the pane live.

## Inputs / context

Code seams the implementation plugs into (real paths, verified against the
working tree):

- **Pane + row to extend** —
  [`apps/moderator/src/layout/ChangeHistoryPane.tsx`](../../../apps/moderator/src/layout/ChangeHistoryPane.tsx):
  - `:231-324` — `ChangeHistoryPane`. It already holds the raw merged sources:
    the REST `prefetched` events and the live WS `liveEvents` (`:250-251`) and the
    merged `rows` (`:255-258`). This task adds the filter state, the
    `deriveActorOptions(prefetched ∪ liveEvents)` memo, the `deriveAvailableKinds(rows)`
    memo, the post-merge filter `useMemo`, and the strip JSX above the
    loading/error/empty/list branch (`:268-313`).
  - `:178-229` — `ChangeHistoryRowItem`. **Untouched** — the row contract
    (`data-event-id` / `-kind` / `-sequence` + the four column test-ids) stays
    exactly as the siblings left it; filtering only changes *which* rows render.
  - `:293-298` — the existing `change-history-pane-empty` branch the new
    `change-history-pane-filtered-empty` parallels (D4).
- **Row type + merge** —
  [`apps/moderator/src/graph/changeHistory.ts`](../../../apps/moderator/src/graph/changeHistory.ts)
  `:36-59` — `ChangeHistoryRow` carries `kind` (kind dimension), `actor` (actor
  dimension), and `affected` (target dimension). All three filter dimensions read
  fields already on the row; **no change to `changeHistory.ts`**.
- **Precomputed target field** —
  [`apps/moderator/src/graph/affectedEntities.ts`](../../../apps/moderator/src/graph/affectedEntities.ts) —
  `affectedEntities(event)` → `{ nodeIds, edgeIds }`, populated onto
  `ChangeHistoryRow.affected` by the merge. The target predicate tests
  `selectedEntityId ∈ (row.affected.nodeIds ∪ row.affected.edgeIds)`.
- **Graph selection (target source)** —
  [`apps/moderator/src/stores/selectionStore.ts`](../../../apps/moderator/src/stores/selectionStore.ts):
  `useSelectionStore` exposes `selected: { kind: EntityKind; id: string } | null`.
  The pane reads `selected?.id` and threads it into the predicate as
  `selectedEntityId` (D3). Read-only — the pane never calls `select` / `clear`.
- **Actor-label source (actor dimension)** —
  [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts)
  `:232-241` — `participantJoinedPayloadSchema` carries `user_id` (== the `actor`
  on that participant's later events) + `screen_name`. `deriveActorOptions` walks
  the log for `participant-joined` events to build the `actor → screen_name` map
  (D2).
- **Event envelope** — ADR 0021
  ([`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md));
  `Event.kind` is the discriminated `EventKind` union (17 kinds) the kind
  dimension filters on; `Event.actor: string | null` is the actor field.
- **Precedent — the analogous filter refinement** —
  [`tasks/refinements/moderator-ui/mod_proposal_filter_search.md`](mod_proposal_filter_search.md)
  and its module
  [`apps/moderator/src/graph/proposalFilter.ts`](../../../apps/moderator/src/graph/proposalFilter.ts).
  This task mirrors its shape exactly: pinned strip (its §2), pure predicate
  module with an `EMPTY_FILTER` identity short-circuit (its §3/§8), local
  component state (its §5), a distinct filtered-empty state (its §4), and a new
  i18n namespace with a native-review follow-up (its §9). The differences are the
  dimensions (kind/actor/target vs free-text/state) and the actor-label win (D2).
- **i18n** — ADR 0024
  ([`docs/adr/0024-frontend-i18n-react-i18next-with-icu.md`](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md));
  react-i18next with ICU. Catalogs
  [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/);
  the existing `moderator.changeHistory.*` block (incl. `kind.*` and
  `systemActor`) is reused for chip labels (D1, D2). The parity test
  [`packages/i18n-catalogs/src/change-history.test.ts`](../../../packages/i18n-catalogs/src/change-history.test.ts)
  is extended to cover the new `moderator.historyFilter.*` keys.

## Constraints / requirements

1. **Predicate is pure.** `matchesHistoryFilter(row, filter, selectedEntityId)`
   has no closure over time, no `Date.now()`, no `Math.random()`, no store
   access, no react-i18next dependency. The selected entity id is passed in as an
   argument (the pane reads `useSelectionStore` and threads it). The empty default
   short-circuits to `true`.
2. **Empty set = no narrowing on that dimension.** An empty `kinds` set passes
   every kind; an empty `actors` set passes every actor; `targetSelectedOnly:
   false` (or a `null` `selectedEntityId`) passes every row. A row survives iff it
   passes all three dimensions (AND composition). This makes "no chips pressed"
   the natural identity and lets a moderator widen by deselecting.
3. **Kind dimension reads `row.kind` directly.** No re-derivation; the chip
   group's options come from `deriveAvailableKinds(rows)` so only kinds present in
   the log are offered (a fresh session shows few chips, not 17).
4. **Actor dimension labels by screen name where the log supplies it.** The
   `actor → screen_name` map is built from `participant-joined` events in the
   merged log; an actor without a join event (or a future actor) falls back to its
   8-char id prefix (the same string the row's actor column renders, so chip and
   row stay consistent); `actor === null` renders the localized "System" label
   (reusing `moderator.changeHistory.systemActor`). The chip's `data-filter-actor`
   carries the raw id, or the literal `system` sentinel for the null actor.
5. **Target dimension is self-contained and selection-coupled.** The toggle
   narrows to rows whose precomputed `affected` includes the
   `useSelectionStore.selected.id`. It is rendered **disabled** (with an
   explanatory localized `title`) when nothing is selected, so it never silently
   filters to zero. No graph-store wording resolution, no cross-event walk at
   filter time — the `affected` field is already computed.
6. **Filter state is local component state** (three pieces, e.g. two `Set` cells +
   a boolean, or one `HistoryFilter` cell). No Zustand slice for the filter, no URL
   params, no persistence across route changes — resets on pane mount, by design
   (mirrors `mod_proposal_filter_search` §5). The target dimension's *input*
   (graph selection) lives in `useSelectionStore`, which the pane subscribes to
   read-only.
7. **Strip is always visible**, rendered above the loading/error/empty-vs-list
   branch, so the filter is reachable even when it has narrowed the list to zero
   (mirrors `mod_proposal_filter_search` §2 — the strip is the escape from the
   filtered-empty state).
8. **Two distinct empty states.** `change-history-pane-empty` (existing) — the
   merged log is empty AND the default filter is in effect.
   `change-history-pane-filtered-empty` (new) — the filter is non-default AND the
   post-filter count is zero, regardless of the pre-filter count (mirrors
   `mod_proposal_filter_search` §4).
9. **Identity-stable when default.** The post-merge `useMemo` returns the input
   `rows` reference directly when `isDefaultFilter(filter)` (no new array
   allocation), keeping the pane render identity-stable for the common case.
10. **Row contract unchanged.** The `change-history-row` `data-*` attributes and
    the four column test-ids are untouched; filtering changes only the set of rows
    rendered. The three completed siblings continue to see the row they expect.
11. **i18n.** All strip-authored strings (region label, the target toggle label +
    its disabled-hint title, the clear button label/aria, and the filtered-empty
    message) flow through `useTranslation()`. Kind chip labels reuse
    `moderator.changeHistory.kind.*`; the "System" actor label reuses
    `moderator.changeHistory.systemActor`. No raw UUID is ever wrapped in a
    translation key.
12. **No new dependency, no new architectural seam, Tailwind only.** Reuses the
    existing graph-helper module pattern, the existing selection store, the
    existing chip vocabulary (`slate-*`; pressed chip uses the same `slate-700`
    tone as the row kind chip). No ADR required (D7).
13. **No virtualization, no keyboard shortcut** (carried forward from the
    scroller's D5 and `mod_proposal_filter_search` §10) — the list is bounded in
    practice and the strip is one click away.

## Acceptance criteria

Per **ADR 0022**, every check below ships as a committed automated test — no
throwaway verification.

**Vitest (unit / component)** — `apps/moderator/src/…`, `packages/i18n-catalogs/src/…`:

1. **`matchesHistoryFilter` (new `graph/historyFilter.test.ts`):** (a) the empty
   default passes every row; (b) kind dimension — a non-empty `kinds` set passes
   iff `row.kind ∈ kinds`; empty set passes all; (c) actor dimension — a non-empty
   `actors` set passes iff `row.actor ∈ actors`, including the `null`/System case;
   empty set passes all; (d) target dimension — with `targetSelectedOnly: true`
   and a `selectedEntityId`, passes iff the id is in `row.affected.nodeIds ∪
   row.affected.edgeIds`; with `selectedEntityId === null` (nothing selected),
   passes every row even when the toggle is on; (e) AND composition — all active
   dimensions must pass; (f) purity — same inputs → same output, no clock/RNG.
2. **`deriveAvailableKinds` / `deriveActorOptions` (same test file):**
   `deriveAvailableKinds` returns exactly the distinct kinds present, in the
   documented stable order, with no duplicates. `deriveActorOptions` returns one
   entry per distinct actor (including `null` when a system event is present),
   labels a participant by the `screen_name` from their `participant-joined`
   event, falls back to the 8-char id prefix when no join event is present, and
   labels the `null` actor with the System sentinel. Pure.
3. **Pane component (`layout/ChangeHistoryPane.test.tsx`, extended):** the strip
   renders with a kind chip per available kind and an actor chip per available
   actor; pressing a kind chip narrows the list to that kind (`aria-pressed`
   flips); pressing a second kind chip widens to the union; pressing an actor chip
   AND a kind chip narrows to the intersection; the target toggle is **disabled**
   when `useSelectionStore` has no selection and **enabled** once a selection is
   set (the test seeds `useSelectionStore.getState().select({...})`), and toggling
   it narrows to rows whose `affected` includes the selected id; the clear button
   appears only when the filter is non-default and resets to the full list; when
   the filter excludes every row the `change-history-pane-filtered-empty`
   paragraph renders AND `change-history-pane-empty` does NOT; the strip stays
   visible in both empty states; the existing row contract is unaffected.
4. **i18n parity (`packages/i18n-catalogs/src/change-history.test.ts`, extended):**
   every new `moderator.historyFilter.*` key resolves to a non-empty,
   locale-distinct string across en-US / pt-BR / es-419, and any ICU template
   renders with sample values leaving no `{placeholder}`.

**Playwright (e2e)** — **in scope, NOT deferred.** The pane is route-rendered and
`seedWsStore`-driven today (wired by the scroller's D6), so the filter is reachable
with no new harness hook. Extend `tests/e2e/moderator-change-history.spec.ts` (new
`test()` in the existing describe):

5. Seed a mixed log via `seedWsStore` — at least two kinds and two distinct actors
   (one carrying a `participant-joined` so an actor labels by name). Assert: (a)
   pressing a kind chip narrows the visible rows to that kind (assert the surviving
   rows' `data-event-kind`); (b) pressing an actor chip narrows to that actor; (c)
   pressing both narrows to the intersection; (d) the clear button restores the
   full list; (e) a filter that excludes every row surfaces
   `change-history-pane-filtered-empty`. The **target** dimension's full
   narrowing-by-selection is pinned deterministically by the component test (#3,
   which can set `useSelectionStore` directly); the e2e additionally asserts the
   target toggle is present and **disabled** on a fresh load with no selection
   (component-presence + affordance-state-from-state, per the UI-stream e2e
   policy's "rendered-but-inert" guidance). Reuses the existing
   `window.__aConversaWsStore` backdoor.

**No Cucumber.** This task changes no wire behavior, broadcast shape, or projector
output — it is a frontend-only read-side filter over an already-landed event log.
Vitest + Playwright are the right pins (cf. the Backend/WS guidance: Cucumber is
for protocol/replay-boundary changes, which this is not).

**i18n native-review follow-up:** the pt-BR + es-419 drafts of the new
`moderator.historyFilter.*` keys land flagged PENDING in the matching
`*.review.json` trackers; a follow-up task `i18n_history_filtering_native_review`
(effort 0.5d) replaces them with native-speaker-reviewed text — **deferred to
`i18n_history_filtering_native_review` (closer registers in
`tasks/35-frontend-i18n.tji`, chained after the latest i18n native-review leaf and
wired into the frontend-i18n milestone)**. This mirrors the
`i18n_proposal_filter_search_native_review` registration.

**Build/test gate:** `make` build + lint + test green before commit (global rule;
this task ships source, so the doc-only exception does not apply).

## Decisions

- **D1 — Kind dimension is a multi-select chip group of the kinds *present in the
  log*, reusing the existing `moderator.changeHistory.kind.*` labels (chosen)**
  over a static 17-value control or a single-select dropdown. *Rationale:* the 17
  `EventKind`s are too many for a flat always-rendered chip wall, and most never
  occur in a given session; deriving the chip set from `deriveAvailableKinds(rows)`
  keeps the control proportional to what the moderator can actually see, and the
  scroller already localizes every kind, so the chip group costs **zero new kind
  i18n**. Multi-select (union semantics) lets "show votes AND commits" work in one
  gesture. *Rejected: a static `<select>`/dropdown of all 17 kinds* — usable but
  surfaces kinds that never occur and breaks the chip vocabulary the sidebar
  already speaks; *single-select kind* — can't express "votes and commits".
- **D2 — Actor dimension labels by screen name resolved from the log, chip set
  derived from actors present (chosen)** over either omitting the actor dimension
  or labeling chips with raw 8-char UUIDs. *Rationale:* the task title mandates an
  actor filter, and — unlike the pending-proposals pane, where
  `mod_proposal_filter_search` D1.b rejected an author filter because no
  screen-name resolver was reachable — the change-history pane **already holds the
  full event log**, which contains the `participant-joined` events carrying
  `user_id` + `screen_name`. A single pure walk (`deriveActorOptions`) yields
  `actor → screen_name`, so chips read "Alice" / "Bob" instead of UUIDs. Fallbacks
  stay honest: an actor with no join event shows the 8-char prefix the row already
  shows (chip and row agree by construction), and the null actor shows the
  localized "System" label. *Rejected: raw-UUID chip labels* — unusable, the exact
  reason the proposal filter declined an author filter; *deferring actor entirely*
  — abandons a title-mandated dimension when the log makes it cheap.
- **D3 — Target dimension is a selection-coupled toggle over the precomputed
  `affected` field (chosen)** over a free-text id match, a per-entity picker, or a
  "has any graph target" boolean. *Rationale:* `mod_history_click_to_flash` already
  precomputed `row.affected = { nodeIds, edgeIds }` for every row, and
  `useSelectionStore` already tracks the moderator's selected canvas entity. A
  toggle that intersects the two — "show only history affecting the selected
  entity" — is the highest-value reading of "filter by target", is purely a set
  membership test (no cross-event walk, no wording resolution), reuses two existing
  seams, and composes the click-to-flash direction (row → entity) with its inverse
  (entity → rows). It is rendered **disabled** when nothing is selected so it never
  silently empties the pane (Constraint §5). *Rejected: free-text id match* —
  surfaces UUIDs to type, unusable; *a per-entity target picker dropdown resolving
  ids to wordings via `selectNodeWordingById`/`selectEdgeLabelById`* — genuinely
  nicer, but its value over the selection-coupled toggle is uncertain (the
  moderator usually has the entity selected already when asking "what happened to
  this?"), so per the speculative-enhancement rule (cf. `mod_history_event_summary`
  D4) it is surfaced to the **parking lot**, not registered as a WBS leaf that
  would get picked up before its value is established; *a coarse "has any graph
  target" boolean* — too weak a reading of "by target".
- **D4 — Two distinct empty states (chosen)** over reusing
  `change-history-pane-empty` for the filtered-zero case. *Rationale:* "the log is
  empty" and "your filter matched nothing" are different signals with different
  remedies (wait vs. loosen/clear). A separate
  `change-history-pane-filtered-empty` paragraph keeps the actionable message
  ("clear the filter") explicit and lets the e2e/unit assertions on the two
  surfaces be unambiguous. Mirrors `mod_proposal_filter_search` §4. The trigger is
  the simple `!isDefaultFilter(filter)` test; the pre-filter count is intentionally
  not in the trigger (low-cost edge fidelity).
- **D5 — Filter state is local component state; strip pinned and always visible
  (chosen)** over a Zustand slice or a collapsible strip. *Rationale:* the filter
  is ephemeral, pane-local UI state consumed by no other component, so two/three
  `useState` cells are the right realization (no slice ceremony, resets on mount by
  design); pinning the strip above the empty-vs-list branch keeps it the escape
  hatch from the filtered-empty state. Mirrors `mod_proposal_filter_search` §2/§5.
  The one piece of *shared* state the target dimension needs — the graph selection
  — already lives in `useSelectionStore`; the pane subscribes read-only.
- **D6 — New `moderator.historyFilter.*` namespace for strip-authored prose, reuse
  existing keys for chip labels (chosen)** over folding the new keys into
  `moderator.changeHistory.*` or minting per-kind/per-actor label keys. *Rationale:*
  the strip's own strings (region label, target toggle + disabled hint, clear
  button, filtered-empty message — ~7 keys) are filter-action vocabulary distinct
  from the row-rendering vocabulary, so a sibling namespace keeps them from
  cross-contaminating (mirrors `mod_proposal_filter_search` §9's
  `moderator.proposalFilter.*`); the **kind** chip labels reuse the scroller's
  `kind.*` keys and the **System** actor label reuses `systemActor`, so the only
  new keys are genuinely new prose. pt-BR/es-419 drafts land PENDING with a
  registered native-review follow-up (Acceptance criteria).
- **D7 — No new ADR.** Every dimension composes existing seams — the row's
  `kind`/`actor`/`affected` fields, `useSelectionStore`, the chip vocabulary, the
  predicate-module + local-state + filtered-empty pattern established by
  `mod_proposal_filter_search`. No new dependency, no new architectural seam, no
  security-relevant trade-off — nothing that meets the ADR bar.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-03.

- Pure predicate module `apps/moderator/src/graph/historyFilter.ts` — exports `HistoryFilter`, `EMPTY_FILTER`, `isDefaultFilter`, `matchesHistoryFilter`, `deriveAvailableKinds`, `deriveActorOptions`, `SYSTEM_ACTOR_SENTINEL`.
- Vitest unit coverage `apps/moderator/src/graph/historyFilter.test.ts` — predicate correctness, derivation helpers, AND-composition, empty-set no-narrowing, target-dimension, purity.
- `apps/moderator/src/layout/ChangeHistoryPane.tsx` extended with filter state, chip-set memos, identity-stable post-merge `useMemo`, always-visible pinned filter strip (kind chip group + actor chip group + selection-coupled target toggle + clear button), and `change-history-pane-filtered-empty` branch.
- `apps/moderator/src/layout/ChangeHistoryPane.test.tsx` — new `filter strip` describe (9 cases): chip rendering, press-to-narrow, AND-narrowing, target disabled/enabled/toggle, clear button, filtered-empty vs empty, strip visibility.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — 7 new `moderator.historyFilter.*` keys.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` and `es-419.json` — matching keys, drafts flagged PENDING in `*.review.json`.
- `packages/i18n-catalogs/src/change-history.test.ts` — parity coverage for all new `moderator.historyFilter.*` keys across three locales.
- `tests/e2e/moderator-change-history.spec.ts` — new filter-strip Playwright test: kind-chip narrows by kind, actor-chip narrows by actor, combined narrows to intersection, clear restores full list, filtered-empty state, target toggle present and disabled on fresh load.
