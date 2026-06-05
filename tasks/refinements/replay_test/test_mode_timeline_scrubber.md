# Refinement — `replay_test.test_mode.test_mode_timeline_scrubber`

**Per-event timeline scrubber UI.**

## TaskJuggler entry

- Task: `test_mode_timeline_scrubber` — [`tasks/60-replay-and-test-mode.tji:96`](../../60-replay-and-test-mode.tji).
- Parent group: `test_mode` ([`tasks/60-replay-and-test-mode.tji:70`](../../60-replay-and-test-mode.tji)).
- Grandparent stream: `replay_test` ([`tasks/60-replay-and-test-mode.tji:22`](../../60-replay-and-test-mode.tji)).
- WBS note ([`tji:100`](../../60-replay-and-test-mode.tji)): *"Granularity is per-event — every event in the log is a scrubber stop."*

## Effort estimate

**3d** ([`tasks/60-replay-and-test-mode.tji:97`](../../60-replay-and-test-mode.tji)). Budget: a small client position-navigation helper in `@a-conversa/shell` with its truth-table tests (~0.5d), the scrubber surface component wiring `@a-conversa/graph-view` at the current position (~1d), snapshot-jump integration + the lifted position seam downstream inspectors read (~0.5d), i18n keys + Vitest view tests (~0.5d), and the Playwright spec + updates to the two existing test-mode e2e specs whose readout this surface supersedes (~0.5d).

## Inherited dependencies

`test_mode_timeline_scrubber` declares two direct edges and inherits three through its ancestors.

**Direct:**

- **`!test_mode_load_session`** — *settled (Done 2026-06-05)*. The sibling that loads the full log ([`tasks/60-replay-and-test-mode.tji:77`](../../60-replay-and-test-mode.tji); refinement [`test_mode_load_session.md`](test_mode_load_session.md)). It shipped the reusable `useSessionEventLog(sessionId)` hook in `@a-conversa/shell` ([`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts), re-exported at [`packages/shell/src/index.ts:154-159`](../../../packages/shell/src/index.ts)) — a four-state machine `{ status: 'loading' | 'ready' | 'not-found' | 'error', events, retry }` that pages `GET /api/sessions/:id/events` to completion in ascending `sequence` order — and the app-local `/sessions/:sessionId` route view ([`apps/test-mode/src/session-log/SessionLogRoute.tsx`](../../../apps/test-mode/src/session-log/SessionLogRoute.tsx)). That view's ready readout was built as **deliberately inert scaffolding**, with the explicit hand-off that *"the timeline scrubber, event inspector, and graph supersede it in place"* ([`SessionLogRoute.tsx:16-19`](../../../apps/test-mode/src/session-log/SessionLogRoute.tsx); [`test_mode_load_session.md`](test_mode_load_session.md) Decision §4). **This task is that supersession.**
- **`data_and_methodology.replay_primitive.position_navigation`** — *settled (Done 2026-06-02)*. The pure stepping primitive ([`apps/server/src/projection/position-navigation.ts`](../../../apps/server/src/projection/position-navigation.ts); refinement [`tasks/refinements/data-and-methodology/position_navigation.md`](../data-and-methodology/position_navigation.md)). It defines the **contract** the scrubber must honor — event-sequence space, navigable stops `0..headSequence`, `±1` saturating steps, `isAtStart`/`isAtEnd` boundary predicates — but it lives in `apps/server`, which is **not client-importable** (Decision §1, ADR 0043).

**Inherited through ancestors:**

- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — *settled (Done)*. From the `replay_test` stream root ([`tasks/60-replay-and-test-mode.tji:30`](../../60-replay-and-test-mode.tji)). The OIDC handshake the authenticated test-mode surface rides on.
- **`data_and_methodology.replay_primitive`** — *settled (Done)*. From the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji)). Render-at-position projection. **Consumed client-side**, not via the server primitive: `@a-conversa/graph-view` carries its own pure `projectGraph(events)` ([`packages/graph-view/src/projectGraph.ts`](../../../packages/graph-view/src/projectGraph.ts), called at [`GraphView.tsx:465`](../../../packages/graph-view/src/GraphView.tsx)), so the scrubber renders the graph at a position by feeding `GraphView` the event prefix — no per-step server round-trip (Decision §2).
- **`audience.aud_graph_rendering`** — *settled (Done)*. From the `test_mode` group. Realized as the shared `@a-conversa/graph-view` package (ADR 0039); this task adds it as a dependency of `apps/test-mode` and mounts `GraphView` for the first time in test-mode.

**Inherited e2e debt (not a `.tji` edge, but binding):** the deferred *snapshot-list render → click row → jump-to-position* Playwright spec was forwarded by [`snapshot_list_ui.md`](snapshot_list_ui.md) §4 and [`snapshot_jump_ui.md`](snapshot_jump_ui.md) §4 to the two leaves that first mount the snapshot list in a reachable surface: `replay_chapter_jumping` and **`test_mode_timeline_scrubber`**. This task is reachable (it renders at `/t/sessions/:id`) and mounts the snapshot list, so it **pays its inherited copy of that debt** (Decision §5, Acceptance §5). The `replay_chapter_jumping` copy stays with that leaf.

All inherited edges are settled; nothing this task needs is pending.

## What this task is

Replace the inert textual readout at the test-mode `/sessions/:sessionId` route with a **per-event timeline scrubber**: the operator picks a session, then scrubs through every event in its log — one event per stop — and watches the projected graph rebuild at each position. Concretely:

1. **A client position-navigation helper in `@a-conversa/shell`** (new module `packages/shell/src/replay-position/`) — `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`, `replayHeadSequence`, and `clampPosition`, contract-identical to the server primitive (ADR 0043). The scrubber cannot import the server's `position-navigation.ts` (`apps/server` is not a workspace dependency of any frontend package); this is the client port that honors the same stepping contract and is reusable by the replay seek bar and chapter jumping. `clampPosition` (snapping an arbitrary dragged range value into `[0, head]`) is the one addition the server primitive deliberately left to its UI consumer.
2. **A scrubber surface component** in `apps/test-mode/src/` (app-local, superseding the readout) that:
   - holds the **current position** state in event-sequence space (`0..head`), lifted into the route-level container so downstream sibling panels (event inspector, diagnostic inspector, changed-highlights) read it (Decision §4);
   - renders a per-event scrubber control set mirroring the `WalkthroughDemo` precedent ([`apps/root/src/walkthrough/WalkthroughDemo.tsx:189-254`](../../../apps/root/src/walkthrough/WalkthroughDemo.tsx)): a `type="range"` input (`min={0}`, `max={head}`, `step={1}`), prev/next step buttons disabled at the boundaries via `isAtStart`/`isAtEnd`, and a position-status readout (`position N of head`) under stable `data-testid`s;
   - renders the projected graph at the current position by feeding `@a-conversa/graph-view`'s `GraphView` the event prefix `events.filter(e => e.sequence <= position)` (Decision §2);
   - mounts the shipped `SnapshotJumpList` ([`packages/shell/src/snapshot-list/SnapshotJumpList.tsx`](../../../packages/shell/src/snapshot-list/SnapshotJumpList.tsx)) as a positional shortcut, wiring its `onJump(position)` callback to set the scrubber position (Decision §5).
3. **Route wiring** — the `/sessions/:sessionId` ready state ([`apps/test-mode/src/App.tsx`](../../../apps/test-mode/src/App.tsx) → `SessionLogRoute`) now mounts the scrubber surface instead of the inert event list. The `loading` / `not-found` / `error` / empty-`ready` states from `useSessionEventLog` stay; an empty log (`head === 0`) shows a baseline-only scrubber with no stops.
4. **i18n keys** `testMode.scrubber.*` in all three catalogs ([`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/)) plus the `.review.json` companions.
5. **Test layers** (per ADR 0022): Vitest truth-table tests for the shell helper, Vitest+RTL tests for the scrubber component, a Playwright scrubber e2e (new `chromium-*` project, paying the inherited snapshot-jump debt), and updates to the two existing test-mode e2e specs whose readout assertions this surface supersedes.

## Why it needs to be done

Test mode exists so one authenticated operator can replay a recorded session — for design iteration, debugging, or demoing — without three live participants. `test_mode_app` gave the surface a mount; `test_mode_load_session` gave it the log; **this task gives it the scrub**: the position state and per-event stepping that turn a static log into a navigable replay. It is also the **fan-out point** for the rest of the test-mode group — four leaves hang off it:

- `test_mode_event_inspector` ([`tji:102`](../../60-replay-and-test-mode.tji)) — inspect the event at the current scrubber position;
- `test_mode_changed_highlights` ([`tji:107`](../../60-replay-and-test-mode.tji)) — highlight what changed at each step;
- `test_mode_diagnostic_inspector` ([`tji:112`](../../60-replay-and-test-mode.tji)) — inspect structural diagnostics at any position;
- `test_mode_export_position` ([`tji:117`](../../60-replay-and-test-mode.tji)) — export the projected state at any position.

All four `depends !test_mode_timeline_scrubber` and read the **current position** this task establishes. Lifting that position into the route container (Decision §4) is what lets each slot a panel beside the scrubber and read the same value, instead of re-owning navigation.

## Inputs / context

- **The inert view this supersedes** — [`apps/test-mode/src/session-log/SessionLogRoute.tsx`](../../../apps/test-mode/src/session-log/SessionLogRoute.tsx): reads `:sessionId`, calls `useSessionEventLog`, renders `loading` (`test-mode-session-log-loading`), `not-found` (`test-mode-session-log-not-found`), `error`+retry (`test-mode-session-log-error` / `-retry`), empty (`test-mode-session-log-empty`), and the ready readout (`test-mode-session-log`, a count header + one row per event). The four non-ready states stay; the ready readout is replaced by the scrubber surface (Decision §3).
- **The loaded-log hook (data source)** — [`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts), re-exported at [`packages/shell/src/index.ts:154-159`](../../../packages/shell/src/index.ts). Returns the full ascending `Event[]`; the scrubber derives `head = replayHeadSequence(events)` and the per-position prefix from it.
- **The server stepping contract to mirror** — [`apps/server/src/projection/position-navigation.ts`](../../../apps/server/src/projection/position-navigation.ts) (`nextPosition`/`prevPosition`/`isAtStart`/`isAtEnd`), its head helper `replayHeadSequence` at [`at-position.ts:25-27`](../../../apps/server/src/projection/at-position.ts), its truth-table tests at [`apps/server/src/projection/position-navigation.test.ts`](../../../apps/server/src/projection/position-navigation.test.ts), and the refinement [`position_navigation.md`](../data-and-methodology/position_navigation.md). Event-sequence space, stops `0..head`, `±1` saturating, `0` is the pre-history baseline. The client port enumerates the same cases (Acceptance §2, ADR 0043).
- **The scrubber precedent (client-side, GraphView-driven)** — [`apps/root/src/walkthrough/WalkthroughDemo.tsx`](../../../apps/root/src/walkthrough/WalkthroughDemo.tsx): `position` `useState` + `clampPosition` (lines 59-64), the `events = walkthroughEvents.slice(0, position)` prefix fed to `GraphView` (lines 126, 196), prev/next buttons disabled via `atStart`/`atEnd` (lines 173-217), the `type="range"` scrubber (lines 229-239), and the `walkthrough-step-status` position readout (lines 241-250). The test-mode scrubber follows this control chrome but in **sequence space** (`max={head}`, prefix by `sequence <= position`), not array-index space, and adds the snapshot-jump shortcut.
- **The graph renderer** — `@a-conversa/graph-view` `GraphView`, a props-in/no-store component taking `events: readonly Event[]` + an opaque `instanceKey` and projecting client-side via `projectGraph` ([`packages/graph-view/src/GraphView.tsx:465`](../../../packages/graph-view/src/GraphView.tsx), [`projectGraph.ts`](../../../packages/graph-view/src/projectGraph.ts)). ADR 0039; ADR 0004 (Cytoscape). Consumers must provide `cytoscape` + the `methodology.kind.*` / `methodology.edgeRole.*` i18n keys (the shared catalog already carries them). Adding it to `apps/test-mode` is a new workspace + `cytoscape` runtime dependency, expected from the `aud_graph_rendering` group edge.
- **The snapshot-jump affordance (inherited debt target)** — [`packages/shell/src/snapshot-list/SnapshotJumpList.tsx`](../../../packages/shell/src/snapshot-list/SnapshotJumpList.tsx): `{ sessionId, onJump: (position: number) => void }`; composes `useSessionSnapshots` + `SnapshotList` + `resolveSnapshotPosition`, fetching `GET /api/sessions/:id/snapshots` and emitting the selected row's `logPosition` (event-sequence space) — the exact vocabulary the scrubber position speaks. Re-exported at [`packages/shell/src/index.ts:141-152`](../../../packages/shell/src/index.ts). Predecessors: [`snapshot_list_ui.md`](snapshot_list_ui.md), [`snapshot_jump_ui.md`](snapshot_jump_ui.md).
- **The route surface** — [`apps/test-mode/src/App.tsx`](../../../apps/test-mode/src/App.tsx) (the `/sessions/:sessionId` route added by `test_mode_load_session`); [`apps/test-mode/src/main.tsx`](../../../apps/test-mode/src/main.tsx) (mount bridges host `auth`/`i18n`/`routerBasePath`, `requiredAuthLevel: 'authenticated'`); deps at [`apps/test-mode/package.json`](../../../apps/test-mode/package.json) (`@a-conversa/shell`, `@a-conversa/shared-types`, `react-router-dom` — adds `@a-conversa/graph-view` + `cytoscape`).
- **The synthetic-session generator (e2e fixture source)** — `POST /api/test-mode/synthetic-sessions { scenario }` (dev-gated, ADR 0041) and the gallery at [`apps/test-mode/src/synthetic/SyntheticGallery.tsx`](../../../apps/test-mode/src/synthetic/SyntheticGallery.tsx). The `walkthrough` scenario instantiates the full re-keyed walkthrough fixture, whose log includes a `snapshot-created` event ("Segment 1 close", `payload.log_position 265`, snapshot event `sequence 266` — [`position_navigation.md:42`](../data-and-methodology/position_navigation.md)). Generating it yields a real session with both a deep multi-event log **and** a snapshot — the deterministic fixture for the scrubber + snapshot-jump e2e (Decision §6).
- **The position endpoint the scrubber does NOT call** — `GET /api/sessions/:id/state?position=N` → `{ sessionId, sequence, projection }` ([`apps/server/src/replay/routes.ts:721-784`](../../../apps/server/src/replay/routes.ts)). The scrubber renders client-side via `GraphView`; this endpoint is `test_mode_export_position`'s dependency, not this task's (Decision §2). The position the scrubber emits is exactly what this endpoint accepts, by the shared contract (ADR 0043).
- **Existing test-mode e2e (must stay green)** — [`tests/e2e/test-mode-load-session.spec.ts`](../../../tests/e2e/test-mode-load-session.spec.ts) and [`tests/e2e/test-mode-synthetic-session.spec.ts`](../../../tests/e2e/test-mode-synthetic-session.spec.ts) assert the readout `test-mode-session-log` and its rows; both must be updated to the new ready surface (Constraint §6). Project config + `setup-auth` bootstrap at [`playwright.config.ts:428-485`](../../../playwright.config.ts) / [`:206-215`](../../../playwright.config.ts). ADR 0040 (axe-playwright a11y checks).
- **i18n parity** — [`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/) (`en-US.json` source; `pt-BR.json`+`.review.json`; `es-419.json`+`.review.json`). Gate: `pnpm --filter @a-conversa/i18n-catalogs run check`.
- **ADRs** — **0043** (this task's client position-navigation seam, written here), 0039 (graph-view package), 0004 (Cytoscape), 0026 (micro-frontend mount), 0024 (react-i18next), 0021 (event envelope), 0041 (synthetic-session dev-gated seam), 0006 (Vitest), 0008 (Playwright + compose), 0040 (axe-playwright), 0010 (pnpm workspaces), 0022 (no throwaway verification).

## Constraints / requirements

1. **Per-event granularity in sequence space.** Every event is a stop; the navigable positions are the integers `0..head` where `head = replayHeadSequence(events)` (last event's `sequence`, `0` for an empty log). The prefix rendered at position `p` is `events.filter(e => e.sequence <= p)`. (`applyEvent` enforces contiguous sequences `1..head`, so this equals the first `p` events — the filter is the contract-honest expression.)
2. **Consume the stepping contract, do not re-derive it ad hoc.** The scrubber's step/boundary logic comes from the `@a-conversa/shell` `replay-position` helper (`nextPosition`/`prevPosition`/`isAtStart`/`isAtEnd`/`clampPosition`), contract-identical to the server primitive (ADR 0043). The range input's arbitrary drag value is run through `clampPosition`; step buttons through `nextPosition`/`prevPosition`; their `disabled` state through `isAtStart`/`isAtEnd`.
3. **Render the graph client-side via `@a-conversa/graph-view`.** No per-step call to `GET /sessions/:id/state`. Feed `GraphView` the position prefix + a stable `instanceKey` (the `sessionId`).
4. **Lift the current position into the route container.** The scrubber controls, the graph, and (downstream) the inspector panels are siblings reading one lifted `position` / `setPosition`. Keep it plain lifted state for the one-to-three call sites today; a dedicated context is a later refactor only if the panel tree deepens (Decision §4).
5. **Reuse the shipped snapshot-jump piece as-is.** Mount `SnapshotJumpList` from `@a-conversa/shell`; wire `onJump={setPosition}`. Do not re-implement snapshot fetching, resolution, or row rendering — the jump component already emits a position in the scrubber's vocabulary.
6. **Supersede the readout cleanly; keep the suite green.** The ready state of `/sessions/:sessionId` renders the scrubber, not the event list. Update [`test-mode-load-session.spec.ts`](../../../tests/e2e/test-mode-load-session.spec.ts) and [`test-mode-synthetic-session.spec.ts`](../../../tests/e2e/test-mode-synthetic-session.spec.ts) to assert the new ready surface (the scrubber's `data-testid`) — including the empty-session ready case in the load-session spec — instead of the superseded readout. This is inherited wiring debt from changing what the ready state renders, paid in-task (the parallel of how `test_mode_load_session` updated the skeleton smoke spec).
7. **No new data-fetching dependency.** The helper is pure integer logic; graph rendering and snapshot fetching reuse shipped packages. No React Query/SWR, no new store. `@a-conversa/graph-view` + `cytoscape` are the only added runtime deps, both implied by the `aud_graph_rendering` group edge.
8. **Catalog parity stays green.** `testMode.scrubber.*` lands in all three catalogs + both `.review.json` companions; `pnpm --filter @a-conversa/i18n-catalogs run check` exits zero.
9. **Build + check green.** `pnpm -F @a-conversa/shell build`, `pnpm -F @a-conversa/test-mode build`, and `pnpm run check` (lint + format + typecheck) all stay green.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **Typecheck + barrel.** `pnpm -F @a-conversa/shell typecheck` and `pnpm -F @a-conversa/test-mode typecheck` exit zero; `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`, `replayHeadSequence`, `clampPosition` are exported from `packages/shell/src/index.ts` under their own ASCII-ruled `replay-position/` block.
2. **Vitest truth-table for the shell helper** (`packages/shell/src/replay-position/replay-position.test.ts`), mirroring the server's `position-navigation.test.ts`:
   - `nextPosition`: `0 → 1`; mid-log `N → N+1`; at head → head (saturates); empty log `([], 0) → 0`.
   - `prevPosition`: head `→ head-1`; `1 → 0`; at `0 → 0` (saturates); empty log `([], 0) → 0`.
   - full forward walk from `0` reaches head in exactly `head` steps visiting every sequence once; symmetric backward walk.
   - `isAtStart(p)` iff `p === 0`; `isAtEnd(events, p)` iff `p === head`; on an empty log `0` is both.
   - `clampPosition`: `NaN → 0`, negative → `0`, `> head → head`, fractional → truncated, in-range → unchanged.
   - `replayHeadSequence`: `[] → 0`; ascending log → last `sequence`.
3. **Vitest+RTL for the scrubber component** (`apps/test-mode/src/<scrubber>.test.tsx`), mocking `useSessionEventLog` (or driving props) and mocking/stubbing `GraphView`:
   - given a log with head `H`, the range input renders `min=0`/`max=H`/`step=1`; the position-status reads the initial position of `H`;
   - clicking **next** at a mid position advances the rendered position by one and the graph receives the prefix `events.filter(e => e.sequence <= position)` (assert the `events` prop length / boundary);
   - clicking **prev** decrements; **prev** is `disabled` at position `0` and **next** is `disabled` at head;
   - dragging the range input to an arbitrary value sets the clamped position and re-renders the graph at that prefix;
   - an empty-log session (`head === 0`) renders the baseline scrubber with no traversable stops and the empty-graph state, without throwing.
4. **Vitest+RTL for the route ready/non-ready surface** (extending or replacing `SessionLogRoute.test.tsx`): `loading` / `not-found` / `error`+retry / empty still render their affordances; the non-empty `ready` state mounts the scrubber surface (asserted by its `data-testid`), not the old readout list.
5. **Playwright scrubber e2e** (`tests/e2e/test-mode-scrubber.spec.ts`, new `chromium-test-mode-scrubber` project in `playwright.config.ts`, `dependencies: ['setup-auth']`) — **e2e is in scope; the surface is reachable** at `/t/sessions/:id`. Under `make up` + `pnpm run test:e2e`, authenticated via the bootstrap storage state, generating the **`walkthrough`** synthetic session (`POST /api/test-mode/synthetic-sessions`) and navigating to its `/t/sessions/:id`:
   - the scrubber surface renders (controls + graph present); stepping **next**/**prev** and dragging the range input move the position-status readout, and the graph re-renders;
   - **prev** is disabled at position `0`, **next** is disabled at head (boundary affordance);
   - **inherited snapshot-jump debt (paid here):** the mounted snapshot list renders the walkthrough's snapshot row; **clicking that row navigates the scrubber to the snapshot's `logPosition`** — the position-status reflects `265`. This satisfies the *list-render → click row → jump-to-position* spec forwarded from [`snapshot_list_ui.md`](snapshot_list_ui.md) §4 / [`snapshot_jump_ui.md`](snapshot_jump_ui.md) §4 to this leaf;
   - one spec, en-US only, real backend + real surface, no moderator-gesture walkthrough (the synthetic generator supplies the deep log + snapshot deterministically).
6. **Existing test-mode e2e updated and green** — [`test-mode-load-session.spec.ts`](../../../tests/e2e/test-mode-load-session.spec.ts) and [`test-mode-synthetic-session.spec.ts`](../../../tests/e2e/test-mode-synthetic-session.spec.ts) assert the new ready surface (scrubber `data-testid`) per Constraint §6; the load-session spec's empty-ready and 404→not-found paths still pass.
7. **`pnpm run test:smoke`** stays green; the unit/component smoke count grows by the helper + scrubber + route cases.
8. **`pnpm --filter @a-conversa/i18n-catalogs run check`** green after the `testMode.scrubber.*` additions (all three catalogs + `.review.json` companions).
9. **`pnpm -F @a-conversa/shell build` + `pnpm -F @a-conversa/test-mode build` + `pnpm run check`** all green.
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`** silent after `complete 100` is added (closer step).
11. **No file modifications outside the task allowlist** — the new `packages/shell/src/replay-position/` module + its barrel block, the new/edited `apps/test-mode/src/` scrubber component + route view, `apps/test-mode/package.json` (graph-view + cytoscape deps), the two i18n catalog dirs, the new e2e spec + two updated e2e specs + `playwright.config.ts`, and `docs/adr/0043-*.md`. No backend change (the position endpoint and the navigation primitive already exist and are tested).

**No Cucumber scenario.** This task is a pure *consumer* of already-shipped, already-Cucumber-pinned seams: `GET /api/sessions/:id/events` (`get_session_log`), `GET /api/sessions/:id/snapshots` (`list_snapshots`), and the synthetic-session endpoint. It adds no wire behavior, broadcast shape, or projector output. The stepping contract it mirrors is Vitest-pinned on the server (`position-navigation.test.ts`) and re-pinned on the client (Acceptance §2); the graph projection it drives is Vitest-pinned inside `@a-conversa/graph-view`. The new behavior here is client-side composition, correctly pinned by Vitest + Playwright.

## Decisions

### §1 — The client cannot import the server's `position-navigation`; port the contract into `@a-conversa/shell` (ADR 0043)

**Chosen:** a new pure `replay-position/` module in `@a-conversa/shell`, contract-identical to the server primitive, parity-pinned by a mirroring Vitest truth table. **Rejected — import `position-navigation` from `apps/server`:** apps are leaf Vite bundles, not workspace libraries; no frontend package references `apps/server` (ADR 0039, ADR 0026), so the import is impossible, not merely discouraged. **Rejected — relocate the primitive into a shared package both layers import:** a larger refactor touching `apps/server` and its tested consumer `get_at_position`, for a UI task's benefit, with no third runtime needing the shared core today. **Rejected — duplicate inline in the test-mode app only** (à la `WalkthroughDemo`'s local `clampPosition`): the replay seek bar and chapter jumping are additional client consumers; a shared shell helper prevents each re-deriving boundary arithmetic — the exact re-derivation the server primitive's refinement set out to prevent, now honored within the client layer. Full rationale + consequences in **ADR 0043**.

### §2 — Render the graph client-side from the event prefix, not via `GET /sessions/:id/state`

**Chosen:** feed `@a-conversa/graph-view`'s `GraphView` the prefix `events.filter(e => e.sequence <= position)`; `GraphView` projects via its own `projectGraph` and re-renders. **Rejected — call the `get_at_position` endpoint per scrubber step:** a network round-trip per stop, with a loading/error state on every step, when the full log is already in memory (`useSessionEventLog`) and the client renderer already projects from events. The `WalkthroughDemo` precedent renders exactly this way, and ADR 0039 built `GraphView` to be driven by a precomputed `events` prop with no server coupling. The position the scrubber emits still matches what `get_at_position` would accept (shared contract, ADR 0043), so `test_mode_export_position` can later call the endpoint with the same number for a server-authoritative export.

### §3 — Supersede the inert readout in place, app-local

**Chosen:** the scrubber surface replaces `SessionLogRoute`'s ready readout at `/sessions/:sessionId`, app-local in `apps/test-mode/src/`. **Rejected — add the scrubber as a new route/panel alongside the readout:** `test_mode_load_session` Decision §4 explicitly built the readout as throwaway scaffolding *"superseded in place"* by the scrubber; keeping both leaves dead UI and two readouts of the same log. **Rejected — put the scrubber surface in `@a-conversa/shell`:** unlike the genuinely cross-surface snapshot list, this assembly is test-mode-specific (the replay viewer has its own separate seek-bar / playback leaves with play/pause/speed); its reusable parts (`replay-position` helper, `GraphView`, `SnapshotJumpList`) already live in shared packages, so the assembly stays app-local. The four non-ready load states are retained — the scrubber still needs the loaded log.

### §4 — Lift the current position into the route container as plain state

**Chosen:** the `/sessions/:sessionId` container owns `position` / `setPosition`; the scrubber controls, the graph, and (downstream) the inspector panels are siblings reading it. **Rejected — a dedicated `TestModePositionContext` provider now:** premature for the one-to-three sibling call sites this task and its immediate dependents have; lifted state is the simpler seam (predecessor discipline — build for today's call sites). If the panel tree deepens enough that prop-drilling bites, a context is a contained later refactor behind the same `position`/`setPosition` shape — surfaced as a note for the inspector tasks, not encoded as work now. **Rejected — let each downstream inspector own its own position:** that would fork navigation across four leaves and reintroduce exactly the divergent-boundary-arithmetic problem the shared helper and single lifted position prevent.

### §5 — Mount the shipped `SnapshotJumpList`; pay the inherited e2e debt here

**Chosen:** mount `SnapshotJumpList` (sessionId in, `onJump(position)` out) and wire `onJump={setPosition}`; the Playwright spec covers list-render → click row → jump-to-position. **Rejected — defer the snapshot-jump e2e further:** the surface is now reachable and mounts the list, so the UI-stream e2e policy's deferral exception does not apply; `snapshot_list_ui` §4 and `snapshot_jump_ui` §4 explicitly named this leaf as the inheritor, and the catch-all-overload guard is satisfied (this leaf inherits exactly one such debt). **Rejected — re-resolve `snapshotId → position` in the scrubber:** `SnapshotJumpList` already resolves client-side and emits a position in the scrubber's vocabulary; re-implementing the lookup would duplicate `resolveSnapshotPosition` and leak snapshot-record shape into the surface.

### §6 — Use the `walkthrough` synthetic scenario as the e2e fixture

**Chosen:** the scrubber e2e generates the `walkthrough` synthetic session, which deterministically yields both a deep multi-event log and a `snapshot-created` event (`log_position 265`), so a single real-backend spec exercises stepping, boundary affordances, and the snapshot jump without any moderator-gesture choreography. **Rejected — mint an empty session and drive moderator gestures to build a log with a snapshot:** flaky, slow, and redundant with the synthetic generator that exists precisely for design-iteration replay (ADR 0041). **Rejected — the `structured` scenario:** it carries nodes/proposals/votes but no snapshot, so it could not exercise the inherited snapshot-jump debt; `walkthrough` is the scenario that carries a snapshot.

### §7 — No graph-internals work; inspectors and highlights stay downstream

**Chosen:** this task renders the projected graph at a position and establishes the position seam; it does **not** add per-event change highlighting, event detail panels, or diagnostic overlays. **Rejected — fold the event inspector / changed-highlights into the scrubber:** those are their own WBS leaves (`test_mode_event_inspector`, `test_mode_changed_highlights`, `test_mode_diagnostic_inspector`), each with its own effort and dependency on this task; building them here would collapse four leaves into one. The scrubber is the substrate they attach to.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `packages/shell/src/replay-position/replay-position.ts` — pure client port of the position-navigation contract (`nextPosition`/`prevPosition`/`isAtStart`/`isAtEnd`/`replayHeadSequence`/`clampPosition`), contract-identical to the server primitive (ADR 0043).
- `packages/shell/src/replay-position/index.ts` + barrel block added to `packages/shell/src/index.ts` — exports the six navigation helpers under the `replay-position/` ASCII block.
- `packages/shell/src/replay-position/replay-position.test.ts` — Vitest truth-table covering all stepping, boundary, clamp, and head-sequence cases mirroring the server's `position-navigation.test.ts`.
- `apps/test-mode/src/scrubber/TimelineScrubber.tsx` — scrubber surface (range input, prev/next buttons, position-status readout, `GraphView` at position prefix, `SnapshotJumpList`).
- `apps/test-mode/src/scrubber/SessionScrubberContainer.tsx` — route-level container lifting `position`/`setPosition` state (Decision §4).
- `apps/test-mode/src/scrubber/TimelineScrubber.test.tsx` — Vitest+RTL scrubber component tests (stepping, boundary disabled state, range drag, empty-log baseline).
- `apps/test-mode/src/session-log/SessionLogRoute.tsx` + `SessionLogRoute.test.tsx` — ready state superseded by scrubber surface; non-ready states retained; tests extended for ready/non-ready distinction.
- `apps/test-mode/package.json` + `apps/test-mode/tsconfig.json` — added `@a-conversa/graph-view` + `cytoscape` runtime deps.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `pt-BR.review.json`, `es-419.json`, `es-419.review.json` — `testMode.scrubber.*` keys added to all three catalogs + review companions; parity check green (717 keys).
- `playwright.config.ts` — new `chromium-test-mode-scrubber` project; `tests/e2e/test-mode-scrubber.spec.ts` — scrubber e2e (stepping, boundary affordances, snapshot-jump → position 265, paying the inherited snapshot-jump debt from `snapshot_list_ui`/`snapshot_jump_ui` §4).
- `tests/e2e/test-mode-load-session.spec.ts` + `tests/e2e/test-mode-synthetic-session.spec.ts` — retargeted to the new scrubber `data-testid` surface (Constraint §6).
- `docs/adr/0043-client-side-replay-position-navigation-in-shell.md` — ADR recording the client port decision.
