# Refinement — `participant_ui.part_history_view.part_history_filtering`

## TaskJuggler entry

- WBS leaf: `participant_ui.part_history_view.part_history_filtering`
  ("Filter / search history").
- Definition: [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji)
  lines 442–446 (the `part_history_filtering` child of the
  `part_history_view` group).

```
task part_history_view "View change history (P7)" {
  depends !part_shell, backend.replay_endpoints.get_session_log
  task part_history_list "Reverse-chronological event list" {
    effort 1d
    allocate team
    complete 100
  }
  task part_history_filtering "Filter / search history" {
    effort 1d
    allocate team
    depends !part_history_list
  }
}
```

## Effort estimate

**1d.** One pure predicate module + a filter strip woven into the
already-shipped `<ParticipantHistoryPane>`, plus the test surface (predicate
unit test, component test extensions, Playwright filter scenarios, i18n
catalog-parity for ~5 new keys). The design is a deliberately reduced mirror
of the moderator's already-shipped `historyFilter.ts` + `<ChangeHistoryPane>`
filter strip — the cost is in the tests and the careful drop of the
moderator's selection-coupled "target" dimension, not in novel design.

## Inherited dependencies

The single declared dependency is **settled**:

- **`!part_history_list`** (settled — shipped 2026-06-05,
  `tasks/refinements/participant-ui/part_history_list.md` §Status). It
  established everything this task extends:
  - The pane component
    `apps/participant/src/history/ParticipantHistoryPane.tsx:1–174` with its
    four display states and stable test-ids
    (`participant-history-pane-{loading,error,empty,list}`,
    `participant-history-pane-retry`).
  - The pure selector
    `apps/participant/src/history/deriveHistoryRows.ts:1–65` —
    `deriveHistoryRows(prefetched, live): readonly HistoryRow[]`, dedup by
    `id`, newest-first (descending `sequence`). The row shape
    (`deriveHistoryRows.ts:26–32`):
    `{ id: string; sequence: number; kind: EventKind; actor: string | null;
    createdAt: string }`.
  - The row markup `ParticipantHistoryPane.tsx:135–173` —
    `data-testid="participant-history-row"` `<li>` carrying `data-event-id` /
    `data-event-kind` / `data-sequence`, with three column spans
    (`participant-history-row-{kind,actor,timestamp}`).
  - The data wiring: `useSessionEventLog(sessionId)` (REST prefetch) overlaid
    with `useWsStore((s) => s.sessionState[sessionId]?.events)`
    (`ParticipantHistoryPane.tsx:60–65`), merged via `deriveHistoryRows` in a
    `useMemo`.
  - **Reachability**: the History tab is already wired into the operate route
    (`ParticipantTab` union member `'history'` in `uiStore.ts`, the fourth
    `<TabButton>` in `ParticipantTopTabBar.tsx`, the `currentTab === 'history'`
    branch in `OperateRoute.tsx`). The pane is reachable — so e2e is **in
    scope** (Acceptance §7), not deferred.
  - The i18n surface `participant.changeHistory.*` (en-US
    `packages/i18n-catalogs/src/catalogs/en-US.json:1029–1055`:
    `paneAriaLabel`, `systemActor`, `loading`, `error`, `retry`, `emptyState`,
    `kind.<EventKind>` ×17).

## What this task is

Add **filtering** to the participant change-history view: a pinned filter
strip above the history list that lets a debater narrow the log by **event
kind** and by **acting participant (actor)**, both multi-select chip groups
derived from the kinds/actors actually present in the merged log. Filters
AND-compose; a **Clear** affordance resets to the full list; when a
non-default filter excludes every row the pane shows a distinct
**filtered-empty** state (separate from the "log is genuinely empty" state).

This is the second and final leaf of the `part_history_view` subtree. It is a
deliberately reduced mirror of the moderator's shipped filtering
(`apps/moderator/src/graph/historyFilter.ts:1–171`,
`apps/moderator/src/layout/ChangeHistoryPane.tsx:264–506`) — reduced because
the participant's minimal row carries less data than the moderator's (see
Decisions §D3, §D4).

## Why it needs to be done

P7 ("View change history") gives a debater the ordered audit of structural
changes. Once a session has accrued hundreds of events
(`part_history_list.md` §D6 notes logs reach low thousands), an undifferentiated
reverse-chronological scroll is hard to use: "show me only the votes," or
"only what *that* participant did" are the natural debater questions. Filtering
turns the list from a firehose into a queryable audit surface. It is the leaf
that completes the `part_history_view` subtree and therefore the P7
requirement on the participant surface.

There are no downstream WBS consumers — this is the subtree's terminal leaf.

## Inputs / context

Real files and the seams this task plugs into:

- **Canonical mirror — moderator history filtering.**
  - Predicate module `apps/moderator/src/graph/historyFilter.ts:1–171`:
    `interface HistoryFilter` (`:36–40`), `EMPTY_FILTER` (`:66–70`),
    `isDefaultFilter(filter)` (`:79–81`),
    `matchesHistoryFilter(row, filter, selectedEntityId)` (`:94–122`,
    AND-composed, pure, identity fast-path when default),
    `deriveAvailableKinds(rows)` (`:130–134`, distinct kinds in canonical
    order), `deriveActorOptions(events)` (`:145–170`, distinct actors,
    screen-name labels from `participant-joined` events, 8-char-prefix
    fallback), `SYSTEM_ACTOR_SENTINEL = 'system'` (`:49`).
  - Pane integration `apps/moderator/src/layout/ChangeHistoryPane.tsx`:
    filter state `useState<HistoryFilter>(EMPTY_FILTER)` (`:297`), toggle
    handlers (`:300–321`), derivation memos (`:326–330`), post-merge filter
    `useMemo` with identity-stable default fast-path (`:334–337`), the filter
    strip markup (`:344–431`), the two empty states (`:462–479`).
  - Refinement: `tasks/refinements/moderator-ui/mod_history_filtering.md`
    (Decisions D1–D7 this task selectively mirrors).
- **The thing being extended — participant history pane + selector.**
  `apps/participant/src/history/ParticipantHistoryPane.tsx:1–174`
  (props `{ sessionId; nowMs? }` at `:44–54`; data reads `:60–65`; the four
  states `:70–120`; row markup `:135–173`) and
  `apps/participant/src/history/deriveHistoryRows.ts:1–65` (the `HistoryRow`
  shape this task filters over).
- **Event-kind enum (chip domain).**
  `packages/shared-types/src/events.ts` — `EventKind` (the 17 kinds whose
  labels already exist under `participant.changeHistory.kind.*`), per
  **ADR 0021** (`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`).
- **Actor display helper (chip labels).** The pane already renders an actor
  as an 8-char id prefix or the localized `participant.changeHistory.systemActor`
  label (`ParticipantHistoryPane.tsx:135–173`). The actor chips reuse exactly
  this presentation (Decisions §D5).
- **i18n.** New strip-chrome keys go under `participant.historyFilter.*`
  (Decisions §D6), mirroring the moderator's `moderator.historyFilter.*`
  (en-US `packages/i18n-catalogs/src/catalogs/en-US.json:395–403`) **minus**
  the two target-dimension keys. Chip *labels* reuse the existing
  `participant.changeHistory.kind.*` (kind chips) and the existing actor
  presentation (actor chips) — no new label keys. Catalog-parity follows
  **ADR 0024**.
- **Test conventions.** Predicate unit test mirrors
  `apps/moderator/src/graph/historyFilter.test.ts`; component test extends
  `apps/participant/src/history/ParticipantHistoryPane.test.tsx:1–219`
  (imports `createI18nInstance, I18nProvider` from `@a-conversa/shell` at
  `:23`, `beforeAll` i18n setup `:84–86`, mocked `fetch` `:63–71`); the
  Playwright spec extends `tests/e2e/participant-history.spec.ts`.

## Constraints / requirements

1. **Two filter dimensions: kind + actor.** Both are multi-select chip
   groups derived from the values **present in the merged log** (no chip for a
   kind/actor with zero rows). An empty selection on a dimension means "no
   narrowing on this dimension." The moderator's third (target /
   selected-entity) dimension is **not** ported — see Decisions §D4.
2. **AND-compose dimensions.** A row survives iff it passes the kind
   dimension **and** the actor dimension. Within a dimension, selected chips
   union (OR). Mirrors moderator Constraint §2.
3. **Default filter is identity.** With no chips selected the predicate
   passes every row and the post-filter memo returns the unfiltered rows
   reference unchanged (identity-stable fast-path, mirroring
   `ChangeHistoryPane.tsx:334–337`), so the default path is allocation-free
   and re-render-stable.
4. **Pure predicate module.** The filter logic lives in a new pure module
   `apps/participant/src/history/historyFilter.ts` exporting
   `HistoryFilter`, `EMPTY_FILTER`, `isDefaultFilter(filter)`,
   `matchesHistoryFilter(row, filter)` (no `selectedEntityId` argument — no
   target dimension), `deriveAvailableKinds(rows)`,
   `deriveActorOptions(rows)`, and `SYSTEM_ACTOR_SENTINEL`. It operates over
   the participant `HistoryRow` (not raw events) and resolves actor labels
   the same way the row does (Decisions §D5).
5. **Two empty states.** Keep the existing
   `participant-history-pane-empty` (ready + default filter + zero rows in the
   log) and add `participant-history-pane-filtered-empty` (ready + non-default
   filter + zero rows after filtering). Mirrors moderator Constraint §8 /
   Decision §D4.
6. **Filter strip visibility.** The strip renders when `status === 'ready'`
   **and** the unfiltered merged log is non-empty (there is something to
   filter). It is **not** shown during loading/error or when the log is
   genuinely empty (no chips to derive, nothing to filter). When a filter
   narrows to zero rows the strip stays visible above the filtered-empty
   state so the debater can clear/adjust. This is a deliberate, minor
   divergence from the moderator's always-pinned strip — see Decisions §D7.
7. **Local component state, no store slice.** Filter state is one
   `useState<HistoryFilter>(EMPTY_FILTER)` cell inside
   `<ParticipantHistoryPane>`; it resets on mount by design. No Zustand slice
   is added (mirrors moderator Decision §5 and every other participant list
   view).
8. **Stable seams.** The strip and its controls carry test-ids mirroring the
   moderator names under the participant prefix:
   `participant-history-filter-strip` (container),
   `participant-history-filter-kind` + `data-filter-kind="<kind>"` +
   `aria-pressed` (kind chips), `participant-history-filter-actor` +
   `data-filter-actor="<actor|system>"` + `aria-pressed` (actor chips),
   `participant-history-filter-clear` (clear button, rendered only when the
   filter is non-default).
9. **Duplicate, don't extract.** `historyFilter.ts` is duplicated into the
   participant rather than shared from the moderator — the moderator's
   `historyFilter.ts` is consumer #1, this is consumer #2; extraction waits
   for a third consumer (audience / replay history), matching the established
   participant precedent (`part_history_list.md` Constraint §8,
   `part_proposal_list_view.md` Decisions §1). Do **not** edit moderator
   code.
10. **i18n — no hard-coded user-facing English.** All strip chrome resolves
    through `t(...)` under `participant.historyFilter.*`. Chip labels reuse
    the existing `participant.changeHistory.kind.*` and the existing actor
    presentation — no new label keys. Drafts for pt-BR + es-419 mirror the
    approved `moderator.historyFilter.*` values (parity, not fresh
    translation — Acceptance §8).
11. **File scope.** Write `apps/participant/src/history/historyFilter.ts` +
    its test; extend `ParticipantHistoryPane.tsx` + its test; add the
    `participant.historyFilter.*` i18n keys + a participant catalog-parity
    test; extend the Playwright spec. No edits to moderator code, the shell
    hook, the existing `deriveHistoryRows.ts`, or any `.tji` file.

## Acceptance criteria

All criteria are committed, CI-run checks — **no throwaway / manual
verification (ADR 0022)**. Per the global rule, `make` build + the full
Vitest/Cucumber/Playwright suites pass before commit (pre-commit gate).

1. **`pnpm install` / typecheck / build clean** across the workspace
   (TypeScript strict, ADR 0013).
2. **`pnpm run check` green** (lint + format + typecheck + unit tests).
3. **Predicate unit test** —
   `apps/participant/src/history/historyFilter.test.ts` (Vitest, ADR 0006)
   pins: `matchesHistoryFilter` default passes every row; kind dimension
   union within / AND across with actor; actor dimension including the
   `actor === null` → `SYSTEM_ACTOR_SENTINEL` path; `isDefaultFilter`;
   `deriveAvailableKinds` distinct + canonical order, no duplicates;
   `deriveActorOptions` distinct + first-appearance order + System sentinel;
   purity (no input mutation).
4. **Component test** — `ParticipantHistoryPane.test.tsx` gains cases: the
   strip renders a kind chip per present kind and an actor chip per present
   actor; pressing a kind chip narrows the list; pressing a second kind chip
   widens to the union; pressing a kind chip and an actor chip narrows to the
   intersection; the Clear button appears only when the filter is non-default
   and restores the full list; a filter excluding every row renders
   `participant-history-pane-filtered-empty` with the strip still visible; the
   strip is absent while loading/error and when the log is empty. Uses
   `createI18nInstance('en-US')` and deterministic injected `nowMs` per the
   existing harness.
5. **`pnpm run test:smoke` green**, smoke count grows by the sum of the new
   cases above (report the exact delta in the Status block, e.g.
   `+N (X from historyFilter.test.ts + Y from ParticipantHistoryPane.test.tsx)`,
   matching the per-test budget).
6. **No regressions.** The existing `deriveHistoryRows.test.ts` (7 cases) and
   the existing four-state component assertions remain unchanged; the row
   contract (test-ids + data-attributes) is untouched.
7. **e2e is in scope (not deferred).** The pane is already reachable (History
   tab wired by `part_history_list`), so filtering is exercised end-to-end.
   Extend `tests/e2e/participant-history.spec.ts` (ADR 0008, run under
   `make up` via
   `pnpm run test:e2e --project=chromium-participant-skeleton`): on a session
   whose log has accrued at least two kinds and two distinct actors, assert a
   kind chip narrows the list by kind, an actor chip narrows by actor, the two
   combined narrow to the intersection, Clear restores the full list, and a
   filter that matches nothing surfaces the filtered-empty state. (No prior
   participant refinement defers history-filter e2e to a `part_pw_*`
   catch-all, so there is no inherited debt to fold in.)
8. **i18n catalog parity** — a participant catalog-parity test
   (`packages/i18n-catalogs/src/participant-history-filter.test.ts`, ADR 0024)
   asserts the new `participant.historyFilter.*` keys
   (`regionAriaLabel`, `kindGroupAriaLabel`, `actorGroupAriaLabel`,
   `clearLabel`, `filteredEmpty`) are present in en-US, pt-BR, and es-419 and
   parse under ICU. `pnpm --filter @a-conversa/i18n-catalogs run check` is
   green. The pt-BR + es-419 drafts mirror the already-approved
   `moderator.historyFilter.*` values, so native-speaker sign-off is a
   **parity check, not a fresh translation** — it is human-only work, surfaced
   for the parking lot (see Open questions), not a WBS task.
9. **No file modifications outside the §11 allowlist;** predecessor test
   assertions remain unchanged.

## Decisions

- **§D1 — Filter dimensions: kind + actor, chip groups derived from the
  present log.** Mirrors moderator Decisions D1/D2. Chips are built from the
  kinds/actors actually in the merged log (`deriveAvailableKinds`,
  `deriveActorOptions`), so a debater never sees a chip that filters to
  nothing. Kind chips reuse the existing `participant.changeHistory.kind.*`
  labels (zero new label i18n); actor chips reuse the row's existing actor
  presentation (§D5).
- **§D2 — AND across dimensions, OR within a dimension.** Mirrors moderator
  Constraint §2. The two natural debater questions ("only votes" and "only
  *this* actor") compose by intersection; multiple selected chips in one
  dimension union. Chosen over a single flat OR (which can't express
  "votes by Quinn") and over a guided query builder (over-engineered for two
  dimensions).
- **§D3 — Reuse the moderator's predicate design, duplicated into the
  participant.** The moderator's `historyFilter.ts` is the proven shape
  (`HistoryFilter`, `EMPTY_FILTER`, `isDefaultFilter`, `matchesHistoryFilter`,
  `deriveAvailableKinds`, `deriveActorOptions`, `SYSTEM_ACTOR_SENTINEL`).
  Duplicating it (Constraint §9) is strictly less risk than designing a new
  predicate, and keeps the duplicate-don't-extract precedent intact. A third
  consumer (audience/replay history) is the trigger to promote a shared
  module — recorded as a parking-lot possibility, not a WBS task.
- **§D4 — Drop the moderator's "target / selected-entity" dimension.** The
  moderator filters by "rows affecting the selected graph entity" using a
  precomputed `row.affected.{nodeIds,edgeIds}` set
  (`historyFilter.ts:94–122`) coupled to `useSelectionStore`. The participant
  `HistoryRow` (`deriveHistoryRows.ts:26–32`) carries **no** `affected` field —
  it is the minimal `{ id, sequence, kind, actor, createdAt }` from
  `part_history_list` §D3. Porting the target dimension would require
  precomputing affected-entity sets per row (a payload-walking enrichment the
  participant row deliberately omits) **and** coupling the history pane to the
  participant graph-selection store. That is materially more scope than this
  1d leaf and reproduces an enrichment `part_history_list` explicitly left to
  a product call. Rejected as scope creep; surfaced for the parking lot as a
  product possibility (Open questions), not auto-registered, because it is a
  human call about whether the debater surface should match the moderator's.
- **§D5 — Actor chips label like the row (8-char prefix / System), not by
  screen name.** The moderator's `deriveActorOptions` resolves screen names
  from `participant-joined` events (`historyFilter.ts:145–170`). The shipped
  participant *row* deliberately shows only the 8-char id prefix or the
  localized System label (`part_history_list.md` §D3). For chip↔row
  consistency — a chip must read the same as the rows it filters — and to
  avoid pulling join-event resolution into this leaf, the participant
  `deriveActorOptions` labels actors exactly as the row does. Resolving screen
  names for *both* the row and the chips is a coherent future enhancement, but
  it belongs with the row (a `part_history_list` follow-up), not smuggled in
  here; recorded for the parking lot.
- **§D6 — No free-text "search" box in v1.** The task title is "Filter /
  search history," but the participant `HistoryRow` carries **no free-text
  content** — only an event `kind` (covered by kind chips) and an `actor`
  (covered by actor chips). A free-text box would search the *same two fields*
  the chips already cover exactly and discoverably, so it would be pure
  redundancy with worse UX. The moderator's own history filtering reached the
  same conclusion — it ships chip filters, no free-text search (its free-text
  search lives on the proposal surface, not history). Free-text search becomes
  meaningful only once a row gains searchable prose (e.g. the per-kind payload
  **summary** that `part_history_list` deferred); at that point it would be a
  follow-up of *that* enrichment. The chip filtering delivered here **is** the
  "filter/search" capability over the dimensions the row actually has.
- **§D7 — New i18n keys under `participant.historyFilter.*`, mirroring
  `moderator.historyFilter.*` minus the target keys.** Five keys:
  `regionAriaLabel`, `kindGroupAriaLabel`, `actorGroupAriaLabel`,
  `clearLabel`, `filteredEmpty` (the moderator's `targetToggleLabel` /
  `targetDisabledHint` are dropped with the target dimension, §D4). Chosen
  over reading `moderator.historyFilter.*` cross-surface, which would couple
  the two surfaces' catalogs and break duplicate-don't-extract (mirrors
  `part_history_list` §D5). The values mirror the approved moderator strings,
  so native review is a parity check (Acceptance §8).
- **§D8 — Filter strip gated on a non-empty ready log, not always pinned.**
  The moderator pins its strip above every branch including loading
  (`mod_history_filtering.md` Decision §5). The participant instead renders
  the strip only when `status === 'ready'` and the unfiltered log is non-empty
  — there are no chips to derive while loading/erroring or with an empty log,
  so an always-present strip would be empty chrome. The strip stays visible
  over the filtered-empty state (so the debater can clear). This minor,
  deliberate divergence favors the cleaner participant UX over byte-for-byte
  mirroring; documented so the divergence is intentional, not drift.
- **§D9 — No new ADR.** This leaf composes existing seams (the shipped
  predicate pattern, the existing pane, local component state, the existing
  i18n + test conventions) and introduces no new dependency, architectural
  seam, or security-relevant trade-off. Mirrors moderator Decision §D7.

## Open questions

(none — all decided.)

Three product-scope possibilities are intentionally **not** WBS tasks and are
surfaced for the parking lot rather than auto-registered, since each is a
human product call about whether the debater surface should match the
moderator's — not agent-implementable scope:

- Whether the participant history should gain the moderator's
  **selected-entity ("target") filter** — which first requires the row to
  carry a precomputed `affected` set and the pane to couple to graph selection
  (§D4).
- Whether actor chips (and rows) should resolve **screen names** instead of
  8-char id prefixes (§D5) — a coherent enhancement that belongs with the row
  contract.
- Whether a **free-text search** is warranted once a row gains searchable
  prose such as the deferred per-kind payload summary (§D6).

Human-only follow-up (not a WBS task — surfaced for the parking lot):
native-speaker sign-off of the pt-BR + es-419 `participant.historyFilter.*`
drafts. Because the values mirror the approved `moderator.historyFilter.*`
translations, this is a parity check, covered by the existing participant
i18n parking-lot entry (2026-05-30) rather than a fresh review leaf.

## Status

**Done** — 2026-06-05.

- Pure predicate module `apps/participant/src/history/historyFilter.ts` — two-dimension filter (kind + actor) with `HistoryFilter`, `EMPTY_FILTER`, `isDefaultFilter`, `matchesHistoryFilter`, `deriveAvailableKinds`, `deriveActorOptions`, `SYSTEM_ACTOR_SENTINEL`; no target dimension.
- Predicate unit test `apps/participant/src/history/historyFilter.test.ts` — 17 cases covering default passthrough, kind union, actor union, AND-composition, purity, `deriveAvailableKinds` ordering, `deriveActorOptions` sentinel path.
- `apps/participant/src/history/ParticipantHistoryPane.tsx` extended — filter strip with kind + actor chip groups, identity-stable post-filter memo, `participant-history-pane-filtered-empty` state, strip visibility gated on ready + non-empty log.
- `apps/participant/src/history/ParticipantHistoryPane.test.tsx` extended — 6 new component cases: strip-renders-chips, narrow-by-kind, union-widen, kind+actor intersection, Clear button, filtered-empty state; strip-hidden-while-loading/empty retained.
- i18n keys `participant.historyFilter.*` (5 keys: `regionAriaLabel`, `kindGroupAriaLabel`, `actorGroupAriaLabel`, `clearLabel`, `filteredEmpty`) added to `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`; pt-BR/es-419 mirror approved moderator values (parity, not fresh translation).
- Catalog parity test `packages/i18n-catalogs/src/participant-history-filter.test.ts` — presence + ICU-parse + en-US oracle + moderator parity for all 5 keys across all 3 locales.
- Playwright spec `tests/e2e/participant-history.spec.ts` extended — rosa+sam scenario: kind narrow, actor narrow, kind+actor intersection, Clear, filtered-empty state.
- Vitest total: 77 tests across the three new/extended files (17 predicate + 6 component + ~46 i18n parity; pre-existing cases unchanged).
- Tech-debt follow-up: none. e2e was in scope and delivered.
