# 0043 — Client-side replay position-navigation lives in `@a-conversa/shell`

## Status

Accepted (2026-06-05)

## Context

The replay position-navigation primitive shipped server-side as a pure
integer helper in
[`apps/server/src/projection/position-navigation.ts`](../../apps/server/src/projection/position-navigation.ts)
(Done 2026-06-02; refinement
[`tasks/refinements/data-and-methodology/position_navigation.md`](../../tasks/refinements/data-and-methodology/position_navigation.md)).
It exports `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd` over a
session's full ordered event log, in **event-sequence space**: the navigable
stops are the integers `0..headSequence` inclusive (`0` = pre-history
baseline, `headSequence` = the highest sequence in the log, `0` for an empty
log); a step is `±1`; stepping past a boundary **saturates**; a non-navigable
*current* position throws `ReplayPositionError`. The head-sequence helper is
`replayHeadSequence(events)` in
[`at-position.ts:25-27`](../../apps/server/src/projection/at-position.ts).

Its only WBS consumers are **client surfaces**: the test-mode timeline
scrubber (`replay_test.test_mode.test_mode_timeline_scrubber`) and,
transitively, the replay viewer's seek bar (`replay_seek_bar`) and chapter
jumping (`replay_chapter_jumping`). None of them can import the helper:

- Apps are leaf Vite bundles, **not** workspace libraries. ADR 0039
  established this when it extracted the audience renderer rather than let
  `apps/root` import from `apps/audience`. No frontend package references
  `apps/server` in its `tsconfig.json` or `package.json`; `apps/server`
  depends only on `@a-conversa/shared-types` and is not a workspace
  dependency of any UI package.
- The client already re-implements projection-family logic rather than reach
  into the server: `@a-conversa/graph-view` carries its **own** pure
  `projectGraph(events)`
  ([`packages/graph-view/src/projectGraph.ts`](../../packages/graph-view/src/projectGraph.ts),
  called at [`GraphView.tsx:465`](../../packages/graph-view/src/GraphView.tsx)),
  distinct from the server's `Projection`. A client scrubber therefore
  renders the graph at a position by feeding `GraphView` the event prefix for
  that position — no server round-trip per step.

So a client scrubber needs the *same stepping contract* the server defined,
but in code it can actually import. The position-navigation refinement's own
rationale ("centralize so every replay/test-mode surface doesn't re-derive
its own clamp-and-step arithmetic and get the boundary cases subtly wrong")
must be honored **within the client layer**, where three surfaces will
otherwise each re-derive it.

## Decision

Re-implement the replay position-navigation contract client-side as a small,
pure, React-free module in `@a-conversa/shell` (e.g.
`packages/shell/src/replay-position/`), exporting `nextPosition`,
`prevPosition`, `isAtStart`, `isAtEnd`, `replayHeadSequence`, and
`clampPosition`, re-exported from the shell barrel.

- **Contract-identical to the server primitive.** Same event-sequence space,
  same `0..headSequence` bounds, same `±1` saturating step, same boundary
  predicates, same "head is the last event's `sequence`, `0` for an empty
  log" rule. A position the client emits is accepted verbatim by the
  server's `GET /sessions/:id/state?position=N` endpoint
  ([`apps/server/src/replay/routes.ts:721-784`](../../apps/server/src/replay/routes.ts)),
  so the two layers agree on every stop.
- **Parity is pinned by a contract-mirroring Vitest truth table** that
  enumerates the same boundary cases as
  [`apps/server/src/projection/position-navigation.test.ts`](../../apps/server/src/projection/position-navigation.test.ts)
  (single steps from `0` / mid-log / each boundary asserting saturation; full
  forward and backward walks; `isAtStart`/`isAtEnd` truth tables including the
  empty-log coincidence). If the contracts drift, one side's test fails.
- **`clampPosition` lives only on the client copy.** Snapping an arbitrary
  dragged seek/scrub value into `[0, headSequence]` is a UI concern; the
  server primitive deliberately omitted it (`position_navigation.md`
  Decision §6) because the server never receives an unclamped value. The
  range-input scrubber is exactly the consumer that needs it.
- **The server file is not relocated and not deleted.** Its server-side role
  (feeding `get_at_position` and any future server stepping) keeps it; this
  ADR adds a parallel client port, it does not move the primitive.

## Consequences

- Two copies of four trivial integer functions exist across the
  server/client boundary, each pinned by its own truth-table test that
  enumerates the same cases. The duplication is deliberate and cheap; the
  tests are the sync mechanism.
- `@a-conversa/shell` gains a tiny pure module. Unlike the renderer (ADR 0039
  kept Cytoscape out of shell precisely because it is heavy), this is integer
  logic with zero new dependency — it does not threaten shell's leanness, and
  shell is already the home for pure cross-cutting helpers
  (`computeFacetStatuses`, `projectVotesByFacet`, `projectAxiomMarks`,
  `projectDiagnosticHighlights`).
- `replay_seek_bar` and `replay_chapter_jumping` import the same helper, so
  the "one notion of forward/backward" the server primitive's refinement
  wanted is realized within the client layer too, not re-derived per surface.
- A future shared server/client `replay-core` package could subsume both
  copies, but that is out of scope now: it is a new architectural seam with
  no third runtime that needs it today, and it would touch `apps/server` and
  its tested consumers. ADR 0039's precedent is duplication across the
  boundary, not a shared server/client core.

## Alternatives considered

- **Import `position-navigation` from `apps/server`.** Rejected: apps are
  leaf bundles, not workspace libraries (ADR 0039); no frontend package
  references `apps/server`, and a cross-boundary import would break the
  dependency graph and the surface-bundle model (ADR 0026).
- **Relocate the primitive into a shared package both import.** Rejected: a
  larger refactor that touches `apps/server` and its tested consumers
  (`get_at_position`) for a UI task's benefit, and a shared server/client
  core is a new seam with no third caller today.
- **Duplicate the logic inline in the test-mode app only** (mirroring
  `WalkthroughDemo`'s local `clampPosition`,
  [`apps/root/src/walkthrough/WalkthroughDemo.tsx:59-64`](../../apps/root/src/walkthrough/WalkthroughDemo.tsx)).
  Rejected: the replay seek bar and chapter jumping are additional client
  consumers; a shared shell helper avoids each re-deriving boundary
  arithmetic — exactly the re-derivation the server primitive's refinement
  set out to prevent.
