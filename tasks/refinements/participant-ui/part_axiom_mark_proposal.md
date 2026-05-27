# Send axiom-mark proposal — Playwright e2e cover for the axiom-mark button

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task
`participant_ui.part_axiom_mark_from_tablet.part_axiom_mark_proposal` (lines 314-328).

```
task part_axiom_mark_proposal "Send axiom-mark proposal (repurposed: Playwright e2e cover)" {
  effort 0.5d
  allocate team
  depends !part_mark_axiom_action
  note -8<-
    Repurposed per part_mark_axiom_action Decision §10 option (b): add a Playwright e2e spec block in
    tests/e2e/participant-methodology-flow.spec.ts Phase 7.1 driving the locked selector
    [data-testid="participant-axiom-mark-button"][data-node-id="<id>"] — tap a node, click the mark
    button, assert the proposal event with kind: 'axiom-mark' lands on
    useWsStore.sessionState[sid].events. Wire dispatch was shipped in part_mark_axiom_action (commit 60feb8a);
    this leaf provides the Playwright cover only.

    Source: tasks/refinements/participant-ui/part_mark_axiom_action.md Decision §10 + Status block.
  ->8-
}
```

## Effort estimate

**0.5d.** Confirmed. This leaf adds exactly one focused Playwright spec at
`tests/e2e/participant-axiom-mark.spec.ts` exercising the
already-shipped participant axiom-mark button. **No new component work,
hook work, route wire-up, or i18n change** — everything the button needs
already shipped in `part_mark_axiom_action` (commit `60feb8a` for hook +
component + route + catalogs; commit `5399c46` for the Vitest button
suite). The selector contract
(`[data-testid="participant-axiom-mark-button"][data-node-id="<id>"]`,
the `data-axiom-mark-state` attribute, the
`participant-axiom-mark-button-wire-error` inline alert) is locked by
the predecessor refinement
([`part_mark_axiom_action.md` Constraints + Acceptance criteria](part_mark_axiom_action.md))
and exercised in unit tests already; this spec pins the same selector
contract at the e2e layer.

The deliverable is:

- **`tests/e2e/participant-axiom-mark.spec.ts`** — one new file, one
  `test()` block running under Playwright's `fullyParallel: true`.
  Two-context setup (`ivan` creates the session + captures a node; `julia`
  claims debater-A, navigates to operate, taps the captured node, clicks
  the axiom-mark button). Assertions cover the three closer-defined
  scenarios:
  1. **Button visible for own participant on node selection** — after
     `julia` taps the captured node, the panel mounts
     `[data-testid="participant-axiom-mark-button"][data-node-id="<n1>"]`
     with `data-axiom-mark-state="enabled"` and the button is enabled.
  2. **Click dispatches the proposal event** — clicking the button
     transitions `data-axiom-mark-state` to `"in-flight"` then settles
     back to `"enabled"`; the inline wire-error region
     (`[data-testid="participant-axiom-mark-button-wire-error"]`) is
     absent; and `__aConversaWsStore.getState().sessionState[<sid>].events`
     contains a `kind: 'proposal'` envelope whose `payload.proposal.kind`
     is `'axiom-mark'` and whose `payload.proposal.node_id` is the
     captured node id.
  3. **Graph reflects the mark** — covered by the existing
     `methodology-full-flow.spec.ts` Phase 7.1 + 7.2 chain (lines
     1307-1365), which already drives ben → maria-agrees → alice-commits
     and lands the committed axiom-mark. This refinement augments that
     phase with one explicit
     `data-is-axiom="true"` mirror assertion on ben's canvas mirror
     after the commit lands (the assertion was elided in Phase 7.2
     because the original spec was a pre-button bootstrap; with this
     leaf landing the regression-pin moves inside).

The spec uses `ivan` + `julia` from the expanded dev-user pool
([`tests/e2e/fixtures/dev-users.ts:40-52`](../../../tests/e2e/fixtures/dev-users.ts#L40))
so it runs in parallel with `methodology-full-flow.spec.ts`
(alice/ben/maria), `participant-graph-render.spec.ts` block-1
(alice/ben), block-2 (maria/dave), and block-3 (frank/erin) without
racing on the shared OIDC + users-table user-creation path. The pair
selection follows the convention in
[`part_e2e_user_pool_expansion.md`](part_e2e_user_pool_expansion.md):
each new fully-parallel `test()` block claims a fresh `{creator,
debater}` pair from the pool.

## Inherited dependencies

Settled (every gating dep is done):

- **`participant_ui.part_axiom_mark_from_tablet.part_mark_axiom_action`**
  (done — 2026-05-27). Shipped the
  [`useAxiomMarkAction`](../../../apps/participant/src/detail/useAxiomMarkAction.ts)
  hook, the
  [`ParticipantAxiomMarkButton`](../../../apps/participant/src/detail/ParticipantAxiomMarkButton.tsx)
  component, the `OperateRoute` wire-up, the en-US/pt-BR/es-419 i18n
  catalogs, and the Vitest unit coverage (commit `60feb8a` plus the
  follow-up `5399c46` button suite). Selector contract locked at
  `[data-testid="participant-axiom-mark-button"][data-node-id="<id>"]`
  + `data-axiom-mark-state="enabled" | "in-flight"` + inline error
  region. Decision §10 of that refinement explicitly nominated this
  leaf as the Playwright cover.

- **`participant_ui.part_graph_view.part_axiom_mark_decoration`** (done
  — 2026-05-17). Shipped the DOM mirror that surfaces `data-is-axiom`
  per node
  (`<li data-testid="participant-node-status" data-node-id="…"
  data-is-axiom="…"/>` inside
  `[data-testid="participant-graph-status-mirror"]`). This is the
  selector the Phase 7.2 augmentation targets for the "graph reflects
  mark" assertion.

- **`participant_ui.part_e2e_user_pool_expansion`** (done). Expanded
  Authelia dev users to twelve (alice, ben, maria, dave, erin, frank,
  grace, henry, ivan, julia, kate, leo) plus the
  [`tests/e2e/fixtures/dev-users.ts`](../../../tests/e2e/fixtures/dev-users.ts)
  pool constant and the `DEV_USER_POOL` discipline. The
  ivan + julia pair is unused by any currently-merged spec; claiming
  it here is the convention.

- **`backend.websocket_protocol.ws_propose_message`** (done) +
  **`data_and_methodology.methodology_engine.axiom_mark_logic`** (done
  — 2026-05-10) — the server accepts the canonical `axiom-mark`
  proposal payload from a participant whose authenticated user id
  equals `proposal.participant`. Rule 3 (`axiom-mark-not-self`)
  passes naturally because the participant marks themselves.

Pending (none).

## What this task is

Add a single Playwright spec that exercises the axiom-mark button
end-to-end on the participant tablet:

1. `ivan` logs in, creates a public session, captures one node N1.
2. `ivan` logs out + drops cookies; `julia` logs in, claims debater-A
   via the invite-acceptance flow, navigates to the operate route.
3. `julia` taps N1 on her Cytoscape canvas (via the
   `__aConversaCyInstance.tapNode(nodeId)` test seam already used by
   `participant-graph-render.spec.ts`).
4. The `EntityDetailPanel` mounts; `julia`'s
   `[data-testid="participant-axiom-mark-button"][data-node-id="<n1>"]`
   is visible with `data-axiom-mark-state="enabled"` and enabled.
5. `julia` clicks the button.
6. The spec asserts the wire round-trip:
   - the button's `data-axiom-mark-state` transitions through
     `"in-flight"` and back to `"enabled"`;
   - the
     `[data-testid="participant-axiom-mark-button-wire-error"]`
     region is **not** present;
   - `__aConversaWsStore.getState().sessionState[<sessionId>].events`
     contains a `kind: 'proposal'` event whose
     `payload.proposal.kind === 'axiom-mark'` and
     `payload.proposal.node_id === <n1>` and
     `payload.proposal.participant === <julia's user id>`.

Plus a one-line augmentation to `methodology-full-flow.spec.ts` Phase
7.2 that asserts the mirror's `data-is-axiom="true"` on ben's mirror
after the commit lands. This pins the "graph reflects mark" leg of the
closer-defined scenario without duplicating the full multi-participant
agree+commit chain in the new focused spec.

## Why it needs to be done

The predecessor `part_mark_axiom_action` shipped the button + hook + i18n
+ Vitest coverage in commits `60feb8a` and `5399c46`, but Vitest
exercises the React tree in isolation against a mocked
`useWsClient()`. The wire round-trip (button click → real WebSocket
`propose` → server `axiom_mark_logic` validation → `proposed` ack →
button settled) is only exercised inside `methodology-full-flow.spec.ts`
Phase 7.1, which is buried in a 12-phase serial test running the
entire methodology end-to-end (capture → classify → substance →
decompose → interpretive-split → axiom-mark → annotate → meta-move →
…). When Phase 7.1 fails, the failure surface is "phase 7 of the
methodology" — diagnostically expensive to localize to the axiom-mark
button specifically.

A standalone focused spec gives this leaf its own regression-pin:
parallelisable, decoupled from upstream phases (`capture` /
`classify` / `decompose` failures don't blow up the axiom-mark cover),
and small enough that a failure points directly at the click + wire
round-trip.

The Phase 7.2 mirror-assertion augmentation is the cheapest way to
pin the "graph reflects mark" leg in the existing
multi-participant-commit chain that's already there; reimplementing
that chain in the new focused spec would cost a full 0.5d on its
own and duplicate coverage.

The leaf also closes the `participant_ui.part_axiom_mark_from_tablet.*`
subgroup. With this task done, `part_axiom_mark_from_tablet` ticks
through to `complete 100`, unblocking
`participant_ui.part_tests.part_unit_tests.part_unit_graph_view` and
the broader `participant_ui` rollup.

## Inputs / context

### ADRs

- [ADR 0008 — Playwright as the e2e framework](../../../docs/adr/0008-e2e-framework-playwright.md)
  — drives the live compose stack, real Postgres, real Authelia, real
  WS server. Multi-context API is first-class.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — the Playwright spec lands committed; no ad-hoc curl / browser
  sessions.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the spec asserts the inner-payload shape (`proposal.kind`,
  `proposal.node_id`, `proposal.participant`) against the canonical
  envelope.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)
  — does NOT apply to axiom-marks (per-node, not per-facet); cited only
  to lock that the axiom-mark proposal envelope has no `facet` field.

No new ADR. The architectural seams (selector contract, mirror
testids, `__aConversaWsStore` window seam, dev-user pool) are all
settled.

### Sibling refinements

- [`part_mark_axiom_action.md`](part_mark_axiom_action.md) — the
  predecessor; locks the selector contract and the wire envelope shape
  this spec asserts against. Decision §10 option (b) is the original
  scope of this leaf.
- [`part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) —
  ships the participant DOM mirror (`participant-node-status` +
  `data-is-axiom`); the Phase 7.2 augmentation targets that mirror.
- [`part_entity_detail_panel.md`](part_entity_detail_panel.md) — the
  `actionSlot` seam the button mounts into; the spec depends on the
  panel rendering when a node is selected.
- [`part_e2e_user_pool_expansion.md`](part_e2e_user_pool_expansion.md)
  — the dev-user pool convention; this spec claims the ivan + julia
  pair.

### Live code the spec exercises

- **Selector contract** (locked):
  - [`apps/participant/src/detail/ParticipantAxiomMarkButton.tsx`](../../../apps/participant/src/detail/ParticipantAxiomMarkButton.tsx)
    — `data-testid="participant-axiom-mark-button"` +
    `data-node-id={nodeId}` + `data-axiom-mark-state="enabled" |
    "in-flight"`; inline alert at
    `data-testid="participant-axiom-mark-button-wire-error"` with
    `role="alert"`.
- **Hook** (drives the wire round-trip):
  - [`apps/participant/src/detail/useAxiomMarkAction.ts`](../../../apps/participant/src/detail/useAxiomMarkAction.ts)
    — `markAsAxiom` builds the canonical `propose` envelope; the spec
    asserts the resulting event lands on the events stream.
- **Route** (mounts the button on node selection):
  - [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx)
    — derives `axiomMarkButton` from the current selection; threads
    `actionSlot` into `<EntityDetailPanel>`.
- **DOM mirror** (Phase 7.2 augmentation target):
  - `[data-testid="participant-graph-status-mirror"] >
    li[data-testid="participant-node-status"][data-node-id="<id>"][data-is-axiom="true"]`
    — see
    [`tests/e2e/participant-graph-render.spec.ts:746-751`](../../../tests/e2e/participant-graph-render.spec.ts#L746)
    for the established assertion pattern.
- **Window seam** for the events-stream assertion:
  - `window.__aConversaWsStore.getState().sessionState[<sessionId>].events`
    — read-only, type-erased; the spec narrows via
    `page.evaluate(({sessionId}) => …)`. Pattern is established in
    [`tests/e2e/participant-graph-render.spec.ts:655-741`](../../../tests/e2e/participant-graph-render.spec.ts#L655)
    where `applyEvent` is invoked through the same seam; this spec
    only reads the events array, so the seam usage is even smaller.
- **Cytoscape test seam** for tapping the node:
  - `window.__aConversaCyInstance.tapNode(nodeId)` — see
    [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts)
    block-1 for the established pattern.

### Fixtures the spec uses

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) —
  `loginAs(page, { username: 'ivan' })` and
  `loginAs(page, { username: 'julia' })` drive the OIDC dance + the
  new-user-creation branch.
- [`tests/e2e/fixtures/no-scrollbars.ts`](../../../tests/e2e/fixtures/no-scrollbars.ts)
  — `freshContext(browser)`, `createSession(page, …)`,
  `logoutAndClearAllCookies(page)`.
- [`tests/e2e/fixtures/dev-users.ts`](../../../tests/e2e/fixtures/dev-users.ts)
  — `DEV_USER_POOL` constant; this spec claims `ivan` + `julia`.

### What the spec MUST NOT do

- **Must not add new component/hook/route/i18n code.** The button is
  already built; this is a coverage-only leaf.
- **Must not seed the axiom-mark event via `__aConversaWsStore.applyEvent`
  to satisfy assertions 1 + 2.** The point of the spec is to exercise
  the real button-click → real wire round-trip → real server validation
  chain. The `applyEvent` seam is allowed for the *capture* step (so
  the spec does not depend on the moderator-capture UI for the
  ingredient node), but the axiom-mark proposal MUST travel the real
  wire. (Decision §3 below.)
- **Must not add `test.describe.serial(…)`.** The spec is a single
  parallel `test()` block in its own file; sibling specs in the same
  file (none for this leaf) would parallelise per Playwright defaults.
  Mirrors the convention in
  `participant-graph-render.spec.ts` block-3.
- **Must not duplicate the multi-participant agree+commit chain.**
  The "graph reflects mark" assertion lives in the Phase 7.2
  augmentation, not in this spec. (Decision §2.)
- **Must not introduce new selector contracts.** Every `data-testid` /
  `data-*` attribute the spec queries was locked by
  `part_mark_axiom_action` or by `part_axiom_mark_decoration`.

## Constraints / requirements

- **File scope:**
  - WRITE new: `tests/e2e/participant-axiom-mark.spec.ts`.
  - WRITE augment: `tests/e2e/methodology-full-flow.spec.ts` Phase 7.2
    test block (lines 1331-1365) — add a single
    `data-is-axiom="true"` mirror assertion on `benPage` after the
    commit lands.
  - DO NOT touch any other file. DO NOT touch any `apps/participant/**`
    or `packages/**` source; DO NOT touch `.tji` (the closer owns the
    `complete 100` marker and the `note` line).

- **The spec exercises a real session, not a seeded one.** `ivan` runs
  through `loginAs` + `createSession` + the moderator capture flow to
  produce N1; `julia` runs through `loginAs` + the invite-acceptance
  flow + navigates to operate. The axiom-mark click travels the real
  wire. The events-stream read at assertion 2.c is the **only** use of
  the `__aConversaWsStore` window seam; it reads but does not write.

- **Selector contract** (verbatim from
  `part_mark_axiom_action.md` Acceptance criteria):
  - Button: `[data-testid="participant-axiom-mark-button"][data-node-id="<n1>"]`.
  - State attribute: `data-axiom-mark-state="enabled"` initially,
    transitions to `"in-flight"` during dispatch, returns to
    `"enabled"` on settled success.
  - Inline error region (NOT present on success):
    `[data-testid="participant-axiom-mark-button-wire-error"]` with
    `role="alert"`.
  - Mirror node (Phase 7.2 augmentation):
    `[data-testid="participant-node-status"][data-node-id="<n1>"]`
    with `data-is-axiom="true"` after the commit lands.

- **Wire-payload assertion shape.** The events-stream read must
  narrow exactly:
  ```ts
  const events = await page.evaluate(({ sid }) => {
    const store = (window as any).__aConversaWsStore;
    return store?.getState()?.sessionState?.[sid]?.events ?? [];
  }, { sid: sessionId });
  const axiomProposalEvent = events.find(
    (e: any) =>
      e?.kind === 'proposal' &&
      e?.payload?.proposal?.kind === 'axiom-mark' &&
      e?.payload?.proposal?.node_id === n1Id,
  );
  expect(axiomProposalEvent).toBeDefined();
  expect(axiomProposalEvent.payload.proposal.participant).toBe(juliaUserId);
  ```
  The `juliaUserId` is read off `loginAs(…)`'s return value (the
  `userId` field). The event-find tolerates other events in the stream
  (proposal acks, applies, etc.); it does NOT depend on the
  axiom-mark proposal being last.

- **In-flight transition** is asserted via `data-axiom-mark-state`,
  not via the `disabled` attribute alone. Playwright's
  `toHaveAttribute('data-axiom-mark-state', 'in-flight')` may race
  against the `proposed` ack — the spec uses a `Promise.race`-style
  pattern (or, more pragmatically, just polls for either `"in-flight"`
  OR the settled `"enabled"` + populated events stream). The
  acceptance criteria below allow EITHER observing the in-flight
  transition explicitly OR observing the settled state + events stream
  populated; the latter is sufficient to pin the wire-roundtrip leg.

- **Mirror-assertion augmentation in Phase 7.2** stays inside the
  existing `if (await axiomRow.isVisible().catch(() => false)) {…}`
  branch (lines 1359-1364 of `methodology-full-flow.spec.ts`) — i.e.,
  ONLY when the commit actually fires. This preserves the existing
  tolerance posture (Phase 7.2 already tolerates the commit row being
  absent on rare race paths from prior phases).

- **Wall-clock budget.** The spec runs under
  `fullyParallel: true`; target wall-clock under 30s per `test()` block
  (matches the participant-graph-render.spec.ts block-3 budget). No
  serial mode, no fixture chaining across blocks.

- **`pnpm run test:e2e:smoke`** stays green; **`pnpm run check`**
  stays clean; **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`**
  silent.

## Acceptance criteria

- **`tests/e2e/participant-axiom-mark.spec.ts`** exists with one
  `test()` block exercising the three closer-defined scenarios:
  1. Button visible for own participant on node selection.
  2. Click dispatches the proposal event (settled state + events
     stream contains the canonical axiom-mark proposal).
  3. Graph reflects the mark (pinned by the Phase 7.2 mirror
     augmentation — see next bullet).
- **`tests/e2e/methodology-full-flow.spec.ts` Phase 7.2** carries an
  added `data-is-axiom="true"` mirror assertion on `benPage` inside
  the commit branch, after the
  `await expect(axiomRow).toHaveCount(0, { timeout: 15_000 });` line
  (line 1363).
- The new spec uses the `ivan` + `julia` pair from
  `DEV_USER_POOL` and does NOT race with sibling specs already in
  parallel rotation (alice/ben, maria/dave, frank/erin, alice/ben/maria).
- The spec exercises the real button click → real wire round-trip; it
  does NOT seed the axiom-mark event via `__aConversaWsStore.applyEvent`.
  The `applyEvent` seam is permissible for the *node-creation
  ingredient* if shortening the moderator-capture chain is needed for
  wall-clock budget, but the **axiom-mark proposal itself MUST be
  produced by the button click** (Decision §3).
- `pnpm run check` is clean (TypeScript + ESLint + Prettier).
- `pnpm run test:e2e:smoke` is green; the new spec executes in under
  30s wall-clock per block (matches `participant-graph-render.spec.ts`
  block budgets).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent after the
  closer adds `complete 100` to `part_axiom_mark_proposal` (and to
  `part_axiom_mark_from_tablet` if this is the last task in the group).
- The closer adds, in the same closing commit cluster:
  - `complete 100` to `part_axiom_mark_proposal` in
    `tasks/40-participant-ui.tji:314`.
  - `note "Refinement: tasks/refinements/participant-ui/part_axiom_mark_proposal.md"`
    on the same task block (replacing the existing scope-note that
    documented the repurpose).
  - `complete 100` to the parent `part_axiom_mark_from_tablet` group
    (line 306) once this leaf and `part_mark_axiom_action` are both
    done.
- ADR 0022 compliance: every empirical assertion in the new spec is
  committed (no ad-hoc dev-time browser checks).

## Decisions

1. **Focused standalone spec, not a `test()` block appended to
   `methodology-full-flow.spec.ts`.**

   The predecessor's Decision §10 option (b) wording
   ("`tests/e2e/participant-methodology-flow.spec.ts` Phase 7.1") is a
   filename that does not exist — the actual existing file is
   `methodology-full-flow.spec.ts`, and Phase 7.1 already lives there
   (lines 1307-1329). The honest options are:

   - **(a) Append a new `test()` to `methodology-full-flow.spec.ts`'s
     Phase 7 block.** *Rejected* — `methodology-full-flow.spec.ts` is
     a serial describe (`test.describe.serial`) that chains state
     across phases via module-scoped `_n1Id` / `_p1Id` etc. Adding a
     parallel sibling block would either fight that posture or
     contribute to the diagnostic-localization problem the predecessor
     refinement already flagged (a Phase 7 failure could be anywhere
     from capture to commit).
   - **(b) New standalone spec
     `tests/e2e/participant-axiom-mark.spec.ts` running parallel to
     the methodology-full-flow under `fullyParallel: true`.** *Chosen*
     — the spec runs in its own file, in its own context, with its own
     user pair (`ivan` + `julia`). Failures localize. The selector
     contract is the same. The methodology-full-flow Phase 7.1
     continues to provide integration coverage as a byproduct of the
     full methodology run; this leaf adds focused coverage.

2. **"Graph reflects mark" is pinned by augmenting Phase 7.2 of
   `methodology-full-flow.spec.ts`, not by adding a multi-participant
   block to the new focused spec.**

   The participant-side mirror surfaces `data-is-axiom="true"` only
   after the commit lands — and the commit lands only after another
   participant has agreed and the moderator has committed. To pin that
   leg in the new focused spec would require a three-context flow
   (declarer + voter + moderator) plus the agree-vote UI plus the
   moderator commit-button UI. That's the entire Phase 7.1+7.2 chain,
   duplicated.

   - **(a) Three-context flow in the new spec.** *Rejected* — costs
     the full 0.5d on its own and produces a Phase 7.1+7.2 duplicate.
   - **(b) Augment Phase 7.2 of `methodology-full-flow.spec.ts` with
     a one-line `data-is-axiom="true"` mirror assertion on `benPage`
     after the commit.** *Chosen* — leverages the existing
     multi-participant chain at marginal cost; the assertion adds one
     locator + one `toHaveAttribute` call inside the existing
     commit-success branch. The mirror element is already known to
     exist by Phase 7.1's earlier assertions on the panel + canvas.

3. **The axiom-mark proposal MUST travel the real wire; do not
   `applyEvent`-seed it.**

   The seed seam (`__aConversaWsStore.getState().applyEvent(…)`) is
   the right pattern for fixture-set-up — see
   `participant-graph-render.spec.ts` block-3 lines 644-741 — but it
   short-circuits the wire round-trip the spec is meant to exercise.
   The whole point of this leaf is "click the button, observe the
   server-broadcast proposal land on the events stream"; seeding the
   event directly would mean the spec passes even if the button click
   does nothing.

   - **(a) Seed the axiom-mark event via `applyEvent`; assert mirror
     reflects.** *Rejected* — passes even with a broken hook; tests
     the projector, not the button.
   - **(b) Seed only the node-creation ingredient (the capture step
     produces N1); drive the axiom-mark click through the real wire;
     assert the resulting event on the events stream.** *Chosen* —
     pins the wire round-trip while keeping the spec's setup cheap.
     The capture step may be either real (moderator capture UI) or
     seeded (`applyEvent` with a `node-created` envelope) depending
     on the wall-clock budget; both are acceptable per the
     refinement (Decision §4).

4. **Ingredient capture: real moderator-capture UI OR `applyEvent`
   seed — implementer chooses based on wall-clock.**

   The capture step is not the system under test. If the
   moderator-capture UI flow makes the spec spend >20s setting up the
   ingredient, the implementer should swap to `applyEvent` seeding of
   one `node-created` envelope (the same pattern as
   `participant-graph-render.spec.ts` block-3). The acceptance criteria
   tolerate either approach.

   - **(a) Real moderator-capture UI flow.** Acceptable; integration
     coverage byproduct.
   - **(b) `applyEvent`-seeded `node-created` ingredient.** Acceptable;
     faster, isolates the spec to the button.

   No prescribed choice — the implementer picks based on observed
   wall-clock against the 30s/block target.

5. **User pair: `ivan` + `julia` from `DEV_USER_POOL`.**

   `alice`/`ben`/`maria` are claimed by `methodology-full-flow.spec.ts`
   and `cross-surface-lobby-start.spec.ts`. `dave` floats in
   `methodology-full-flow.spec.ts` as the optional fourth voter (not
   currently activated but reserved). `erin` + `frank` are claimed by
   `participant-graph-render.spec.ts` block-3. `grace` + `henry` are
   the next pair beyond that. `ivan` + `julia` is the cleanest
   unused pair; it leaves `kate` + `leo` for the next Playwright
   leaf.

   - **(a) Reuse `maria` + `dave`.** *Rejected* — `dave` is a
     reservation in `methodology-full-flow.spec.ts` and the
     fully-parallel posture forbids two specs trying to create the
     same dev-user row concurrently.
   - **(b) Claim `ivan` + `julia`.** *Chosen* — fresh pair from the
     pool, follows the convention in
     [`part_e2e_user_pool_expansion.md`](part_e2e_user_pool_expansion.md).

6. **In-flight transition assertion is best-effort, not required.**

   The `data-axiom-mark-state="in-flight"` transition is a sub-200ms
   window in fast-network conditions; asserting it deterministically
   would force a slow-mode mock or a `Promise.race` ladder. The
   regression class this leaf pins is "the click reaches the server",
   not "the button visibly flips through in-flight". The Vitest
   suite in `ParticipantAxiomMarkButton.test.tsx` already pins the
   in-flight visual transitions deterministically.

   - **(a) Required: assert `data-axiom-mark-state="in-flight"` mid-click.**
     *Rejected* — flaky under fast networks; needs slow-mode mocks
     that pull the spec further from real-world conditions.
   - **(b) Optional: observe in-flight if naturally caught; the
     pass-criterion is settled `"enabled"` + populated events stream.**
     *Chosen* — robust under varying network conditions; the
     load-bearing regression class is the wire round-trip.

7. **No new selector contracts.**

   Every `data-testid` / `data-*` the spec queries was locked by
   `part_mark_axiom_action` (button + error region) or
   `part_axiom_mark_decoration` (mirror). Adding new testids would
   force changes back into participant source code — out of scope per
   the closer's brief ("no new component work").

8. **No closer-driven additional WBS leaves.** The "graph reflects
   mark" Phase 7.2 augmentation is one line; it does not warrant its
   own future task. The selector contract is locked, the user pool
   has headroom, and the implementer's deliverable is small.
   `mod_pw_*` / `part_pw_*` catch-all deferral targets are NOT
   inheriting any debt from this leaf.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Added `tests/e2e/participant-axiom-mark.spec.ts` — single `test()` block using the `ivan` + `julia` pair; seeds N1 via `__aConversaWsStore.applyEvent`, taps via `__aConversaCyInstance.getElementById(n1).emit('tap')`, asserts the button appears with `data-axiom-mark-state="enabled"`, clicks it, and pins the wire round-trip via the settled state plus the canonical `kind: 'proposal'` envelope (`proposal.kind='axiom-mark'`, `node_id=N1`, `participant=julia.userId`) landing on the events stream.
- Added one `data-is-axiom="true"` mirror assertion on `benPage` inside the Phase 7.2 commit branch of `tests/e2e/methodology-full-flow.spec.ts` (after `await expect(axiomRow).toHaveCount(0, { timeout: 15_000 })`), pinning the "graph reflects mark" leg.
- Wire round-trip exercised via real button click — axiom-mark proposal was NOT seeded via `applyEvent`; only the node-creation ingredient was seeded.
- `ivan` + `julia` pair claimed from `DEV_USER_POOL`; does not race with sibling specs (alice/ben/maria, maria/dave, frank/erin).
- Inline wire-error region (`data-testid="participant-axiom-mark-button-wire-error"`) asserted absent on success.
- Closes the `participant_ui.part_axiom_mark_from_tablet.*` subgroup; both `part_mark_axiom_action` and `part_axiom_mark_proposal` are now `complete 100`.
