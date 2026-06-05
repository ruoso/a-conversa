# test_mode_changed_highlights — Highlight what changed at each scrubber step

## TaskJuggler entry

- **Task:** `replay_test.test_mode.test_mode_changed_highlights`
- **Definition:** [`tasks/60-replay-and-test-mode.tji:109`](../../60-replay-and-test-mode.tji)
- **Parent group:** `replay_test.test_mode` (the test-mode replay surface).
- **Title:** "Highlight what changed at each scrubber step."

## Effort estimate

**2d** (per the `.tji` block). Rough split:

- ~0.75d — the pure `diffProjection` helper + its Vitest truth-table.
- ~0.75d — the `ChangeHighlights` presentational panel + its Vitest+RTL
  component test, plus the `testMode.changes.*` catalog keys.
- ~0.5d — wiring the panel into `TimelineScrubber` as a sibling and
  extending the existing scrubber Playwright spec.

## Inherited dependencies

- **`!test_mode_timeline_scrubber`** — **settled / shipped**
  ([`tasks/refinements/replay_test/test_mode_timeline_scrubber.md`](test_mode_timeline_scrubber.md),
  commit `f65fdb66`). Provides:
  - The lifted-`position` seam in
    [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx:32-54`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx) —
    the single owner of `position` / `setPosition`, explicitly designed
    (container header comment, lines 7-14) for the downstream `test_mode_*`
    leaves — *including changed-highlights by name* — to attach as siblings
    reading the same lifted state.
  - The mount point in
    [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:84-156`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx),
    where `EventInspector` already hangs as a read-only sibling
    (`TimelineScrubber.tsx:154`) holding `events` + `position`.
  - The client position-navigation helper (`replayHeadSequence`,
    `clampPosition`, …) in `@a-conversa/shell` (ADR 0043).
- **Transitively settled** (through `test_mode_timeline_scrubber`'s own
  `depends`): `test_mode_load_session` (the `useSessionEventLog` substrate
  in `@a-conversa/shell`), `test_mode_app` (the reachable `/t/` micro-frontend),
  and `data_and_methodology.replay_primitive.position_navigation` (the
  position contract ported into shell, ADR 0043).
- **The canonical projector** — `projectGraph` from `@a-conversa/graph-view`
  (ADR 0039), already a runtime dependency of this app (consumed by
  `GraphView` at `TimelineScrubber.tsx:96`). No new dependency is added.

No **pending** inherited dependencies — every predecessor is `complete 100`.

## What this task is

A fourth read-only sibling panel on the scrubber surface — alongside the
graph, the controls, the snapshot-jump list, and the event inspector — that
answers *"what did stepping to this position do to the projected graph?"*

At scrubber position `p` (event-sequence space `0..head`) the panel computes
the structural difference between the projected graph **just before** this
stop and the projected graph **at** this stop, and renders a structured
readout of it:

- **Nodes added** at this step (statement or annotation nodes that appear).
- **Nodes removed** (none today — the projector is monotonic — but the diff
  is symmetric so the panel stays correct if removal ever lands).
- **Nodes changed** — same `data.id` on both sides, but the projected
  `data` differs (a classification committed, a facet status flipped, an
  axiom-mark or annotation attached, a decomposition stamped).
- **Edges added / removed / changed** — the symmetric edge buckets.

The diff is derived from the **canonical projector**, not by re-interpreting
event kinds in the test-mode app: project the `events` prefix `[0..p-1]` and
the prefix `[0..p]` with `projectGraph`, then compare the two element sets by
`data.id`. The panel never re-implements "what does a `commit` event mean for
the graph" — that knowledge lives once, in `projectGraph`, and the panel
reads its output.

At the pre-history baseline (`position 0`) there is no "before" — nothing has
been projected yet — so the panel shows an empty / baseline readout. At
`position 1` the before-prefix is empty and everything the first event
produces shows as *added*.

## Why it needs to be done

The scrubber + event inspector tell you *which event* fired and *what the
graph looks like now*. Neither tells you, at a glance, *which graph elements
that event touched* — for a design-iteration tool that is the high-value
signal. A `commit` event's payload (shown raw by the inspector) is opaque;
"this step classified node N as a claim and flipped facet `relevance` to
`flagged`" is the readable form. This panel closes that gap, completing the
"step → see the event → see its effect" loop the test-mode replay surface
exists to provide.

It is a leaf: nothing in the WBS depends on it. It is one of the four
inspector/overlay leaves the scrubber container was built to host
(`SessionScrubberContainer.tsx:9-12`); the diagnostic inspector
(`test_mode_diagnostic_inspector`) and position export
(`test_mode_export_position`) are its independent siblings.

## Inputs / context

- **Lifted-position seam** —
  [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx:32-54`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx).
  `position` and the clamped `setPosition` (`updatePosition`) are owned here
  and threaded through `TimelineScrubber`. This panel reads, never writes.
- **Sibling mount + props in scope** —
  [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:41-52`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx)
  (`events` + `position` props) and `:154` (the `EventInspector` sibling this
  panel sits beside).
- **The read-only-sibling precedent** —
  [`apps/test-mode/src/inspector/EventInspector.tsx`](../../../apps/test-mode/src/inspector/EventInspector.tsx)
  (whole file, 111 lines): the exact shape this panel mirrors — a
  `{ events, position }` props interface, a `<section>` with a localized
  heading and stable `data-testid` seams, a baseline branch for `position 0`,
  and no `setPosition`.
- **The canonical projector** —
  [`packages/graph-view/src/projectGraph.ts:328-331`](../../../packages/graph-view/src/projectGraph.ts):
  `projectGraph(events): { nodes: AudienceNodeElement[]; edges: AudienceEdgeElement[] }`,
  a pure single-pass walk. The diffable element shapes:
  - `AudienceNodeData` — `projectGraph.ts:181-250`: `id`, `wording`,
    `nodeKind`, `annotationKind`, `kind` (classification), `facetStatuses`,
    `rollupStatus`, `axiomMarks`, `annotations`, `decomposed`.
  - `AudienceEdgeData` — `projectGraph.ts:256-287`: `id`, `source`, `target`,
    `role`, `entityRole`, `facetStatuses`, `rollupStatus`, `annotations`.
  - Both keyed by `data.id` (Cytoscape's id convention — `:182-183`,
    `:257-258`). Exported from the package index
    ([`packages/graph-view/src/index.ts:15-20`](../../../packages/graph-view/src/index.ts)).
- **i18n catalog** —
  [`packages/i18n-catalogs/src/catalogs/en-US.json:1063-1086`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  shows the existing `testMode.scrubber.*` / `testMode.inspector.*` key
  blocks; the new chrome keys land in a parallel `testMode.changes.*` block
  (and the `es-419` / `pt-BR` catalogs alongside).
- **Existing e2e to extend** —
  [`tests/e2e/test-mode-scrubber.spec.ts:47-127`](../../../tests/e2e/test-mode-scrubber.spec.ts):
  the walkthrough-fixture scrubber spec. `test_mode_event_inspector` added
  its assertions here (lines 74-121) rather than spawning a new spec; this
  task does the same.

## Constraints / requirements

1. **Read-only sibling.** The panel takes `{ events: readonly Event[];
   position: number }` and renders. It never calls `setPosition`; navigation
   stays single-sourced in `SessionScrubberContainer` (mirrors
   `EventInspector` Decision §1).
2. **Derive change from the projector, never re-interpret events.** The diff
   is computed by projecting two event prefixes through `projectGraph` and
   comparing outputs. The test-mode app must not branch on `event.kind` to
   guess graph effects — that would fork projection logic and drift from the
   audience renderer. Single source of truth = `projectGraph`.
3. **Diff key is `data.id`; "changed" is `data` inequality.** An element in
   the after-set but not the before-set is *added*; before but not after is
   *removed*; present in both with differing `data` is *changed*. Equality
   is a structural (deep) compare over the `data` object — no field
   allow-list to maintain as `AudienceNodeData` grows.
4. **Pure, separately-tested diff helper.** The comparison is a standalone
   pure function (`diffProjection(before, after)`) returning the six buckets,
   unit-tested independently of React. The component is a thin presentational
   wrapper over it.
5. **Baseline at `position 0`.** No before-state exists; render a localized
   baseline readout (no "changes" claimed). At `position 1` the before-prefix
   is empty so every element of the first event's projection is *added*.
6. **Re-project off the same `events` prop, memoized on `position`.** The
   panel filters `events` to the two prefixes (`sequence <= position` and
   `sequence <= position - 1`) and projects each, memoized on
   `[events, position]` — the same client-side, no-server-call discipline the
   scrubber graph uses (`TimelineScrubber.tsx:69-72`). Two full re-walks per
   stop is acceptable for design-iteration session sizes; do not prematurely
   optimize to an incremental diff.
7. **Localized chrome, raw data.** Section heading, bucket labels, and the
   baseline / empty messages are `testMode.changes.*` catalog keys
   (ADR 0024). Element ids, the raw `kind` discriminant, and changed-field
   names are data, rendered verbatim — exactly the inspector's split
   (`EventInspector.tsx:66`).
8. **Stable `data-testid` seams** for every asserted surface (the section,
   each non-empty bucket, the baseline branch) so the Vitest component test
   and the Playwright spec pin observable behavior (ADR 0022).
9. **Accessibility.** The section carries an `aria-label`; any scrollable
   region stays keyboard-reachable (`tabIndex={0}`), matching the inspector's
   payload block (`EventInspector.tsx:96-101`) and ADR 0040's axe pass.

## Acceptance criteria

All tests are committed regression coverage, not throwaway verification
(ADR 0022).

1. **Pure-diff Vitest** —
   `apps/test-mode/src/changes/diffProjection.test.ts`. Truth-table over
   `diffProjection(before, after)`: an added node, a removed node, a node
   whose `data` changed (e.g. `kind` went `null → 'claim'`), an added edge, a
   changed edge, the all-empty case (no change), and the
   empty-before / full-after case (everything added). Asserts each element
   lands in exactly one bucket and unchanged elements land in none.
2. **Component Vitest+RTL** —
   `apps/test-mode/src/changes/ChangeHighlights.test.tsx`. With a small
   synthetic `events` log: at a mid-log position the panel lists the elements
   the step touched under the right buckets; tracking a position change
   re-renders the readout; at `position 0` the baseline branch shows and no
   buckets render; at `position 1` everything shows as added. Uses the i18n
   test harness the sibling tests use.
3. **Playwright (in scope — surface is reachable)** — extend
   `tests/e2e/test-mode-scrubber.spec.ts` (the walkthrough-fixture spec the
   event inspector already extended). Generate the walkthrough session, open
   the scrubber, and assert: the changes panel (`test-mode-changes`) renders
   as a sibling; stepping `prev` from the head updates the listed changes;
   the panel's reported change for a step is consistent with the event the
   inspector shows at that step; at the `position 0` baseline the panel's
   baseline branch (`test-mode-changes-baseline`) shows and no change buckets
   render. **This e2e is NOT deferred** — the panel mounts on the same
   already-reachable `ready` route as `EventInspector`, driven by the live
   walkthrough fixture.
4. **Catalog completeness** — `testMode.changes.*` keys added to
   `en-US.json`, `es-419.json`, `pt-BR.json`; the i18n lint/structure check
   (the existing catalog-parity gate) stays green. Native-speaker review of
   the es-419 / pt-BR strings is a human sign-off, **not** a WBS task — see
   the return summary's parking-lot note.
5. **Build + test gate green** — `make` build + the full unit/component
   suite pass before commit (global CLAUDE.md rule); the new Playwright
   assertions pass against the compose stack (ADR 0008).

## Decisions

### §1 — A structured diff *panel*, not in-graph Cytoscape highlighting

**Chosen:** render "what changed" as a textual/structured sibling panel
listing the added/removed/changed nodes and edges, mirroring the
`EventInspector` shape.

**Rejected — highlighting changed elements inside the `GraphView` itself**
(flashing a Cytoscape class on the touched nodes/edges at each step). That
reads more literally as "highlight," but it requires `GraphView` /
`@a-conversa/graph-view` to grow a test-mode-only `highlightIds` prop and a
stylesheet class. That package is the **shared audience/broadcast renderer**;
adding a consumer-specific highlight seam to it is an architectural change
crossing a package boundary (an ADR-level call about whether the shared
renderer takes presentation hints from one consumer), well beyond a 2d
test-mode leaf. The panel reuses the existing `projectGraph` seam with zero
changes to the shared renderer and delivers the same information. Whether the
shared renderer should ever gain a highlight seam is surfaced to the parking
lot for a human design call, not encoded as a WBS task.

### §2 — Derive the diff from `projectGraph`, not from `event.kind`

**Chosen:** project two event prefixes and compare their outputs. The
"meaning" of each event for the graph is computed once, by the canonical
projector, and the panel only diffs results.

**Rejected — interpreting each event's payload in the test-mode app** (e.g. a
`commit` of `classify-node` "means" node N's kind changed). That would fork
the projection semantics that already live — exhaustively and tested — in
`projectGraph.ts`, and silently drift the moment the projector changes (new
event kinds, the annotation-as-endpoint promotion, decomposition stamping).
Diffing projector output keeps a single source of truth at the cost of a
second projection walk per stop, which §6 of Constraints accepts.

### §3 — `data.id` key + deep-equal on `data` defines "changed"

**Chosen:** bucket by `data.id` membership; "changed" = the `data` objects
for a shared id are not structurally equal. No per-field allow-list.

**Rejected — comparing a hand-picked field list** (`kind`, `rollupStatus`,
…). That needs maintenance every time `AudienceNodeData` / `AudienceEdgeData`
grow a field (and they have — `decomposed`, `annotations`,
`annotationKind` all arrived in later refinements). A structural compare over
the whole `data` object is self-maintaining and cannot miss a new field. The
projector already returns stable, frozen-default array identities for the
no-change case (`projectGraph.ts:230`, `:239`), so deep compares stay cheap
and don't false-positive on referentially-stable empties.

### §4 — App-local helper + component, not a shell export

**Chosen:** `diffProjection` and `ChangeHighlights` live under
`apps/test-mode/src/changes/`. Only the test-mode scrubber consumes them.

**Rejected — placing the diff in `@a-conversa/shell`.** Shell earns a home
only when a capability is shared across surfaces (the `useSessionEventLog` /
`replay-position` precedent in `test_mode_load_session`). Projection-diffing
has exactly one call site today; promoting it to shell now is speculative
generality. If a moderator/replay surface later wants the same diff, that
move is a mechanical extraction at that point.

### §5 — Extend the existing scrubber e2e, don't spawn a new spec

**Chosen:** add the changes-panel assertions to
`tests/e2e/test-mode-scrubber.spec.ts`, as `test_mode_event_inspector` did.

**Rejected — a standalone `test-mode-changes.spec.ts`.** A new spec would
re-pay the cost of generating the walkthrough session and opening the
scrubber for no isolation benefit; the panel only exists in the context of
the scrubber step flow, so co-locating the assertions keeps the e2e a single
coherent "step through the walkthrough and watch every sibling react" story.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `apps/test-mode/src/changes/diffProjection.ts` — pure six-bucket diff helper (`nodesAdded`, `nodesRemoved`, `nodesChanged`, `edgesAdded`, `edgesRemoved`, `edgesChanged`) keyed by `data.id` with structural deep-equal; exports `isEmptyDiff`.
- `apps/test-mode/src/changes/diffProjection.test.ts` — 7 truth-table Vitest cases: added node, removed node, changed node, added edge, changed edge, all-empty case, empty-before/full-after case.
- `apps/test-mode/src/changes/ChangeHighlights.tsx` — read-only `{ events, position }` sibling panel; memoized two-prefix `projectGraph` diff; baseline/empty/bucket branches; `data-testid` seams (`test-mode-changes`, `test-mode-changes-baseline`); `aria-label` and `tabIndex` per accessibility constraint.
- `apps/test-mode/src/changes/ChangeHighlights.test.tsx` — 5 RTL component cases using the i18n test harness.
- `apps/test-mode/src/scrubber/TimelineScrubber.tsx` — mounts `ChangeHighlights` as sibling beside `EventInspector`.
- `apps/test-mode/src/scrubber/TimelineScrubber.test.tsx` — added `projectGraph: () => ({ nodes: [], edges: [] })` stub to the `@a-conversa/graph-view` mock (fix: vitest threw on missing export after `ChangeHighlights` was wired in).
- `apps/test-mode/src/session-log/SessionLogRoute.test.tsx` — same `projectGraph` mock stub fix.
- `packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json` — `testMode.changes.*` block (heading, bucket labels, baseline/empty messages).
- `tests/e2e/test-mode-scrubber.spec.ts` — changes-panel sibling assertions, node-created consistency scan, position-0 baseline check; extended existing spec per Decision §5 (no new spec file).
