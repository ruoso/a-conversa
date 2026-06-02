# Refinement: `participant_ui.part_withdraw_proposal_overlay_removal`

## TaskJuggler entry

Defined at [`tasks/40-participant-ui.tji:496`](../../40-participant-ui.tji) —

```
task part_withdraw_proposal_overlay_removal "Port participant axiom-mark + annotation overlay projectors to honor zero-emission withdrawal terminator; extend cross-surface spec with deferred Block-1 counterpart" {
  effort 0.5d
  allocate team
  depends participant_ui.part_withdraw_proposal_gesture, backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator
}
```

Milestone: **M7 — End-to-end debate** (`tasks/99-milestones.tji:78`; the
`m_end_to_end_debate` `depends` list names this task directly at
`:80`).

## Effort estimate

**0.5d.** The substance is the deferred cross-surface Playwright counterpart
(self-withdraw → pending-row convergence across three surfaces) and two
regression-pin unit cases. The "port the overlay projectors" charter
resolves to **no production projector change** once the commit-gating reality
is accounted for (see §D1) — so the day is almost entirely test work.

## Inherited dependencies

**Settled:**

- `participant_ui.part_withdraw_proposal_gesture` (commit `7284ed39`,
  Done 2026-06-02). Shipped the participant `useWithdrawProposalAction` hook,
  the proposer-only withdraw button in the pending-proposals row, the
  participant `derivePendingProposals` / `projectGraph` `entity-removed`
  cleanup, and `tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts`
  (Block 1 = proposer-only affordance + accepted ack on the axiom-mark path;
  Block 2 = moderator-proposed-node cross-surface disappearance). Its **§A4
  deferred sub-scenario** — *debater-A withdraws their own axiom-mark and the
  row + overlay vanish on all surfaces* — is the debt this task pays.
  Refinement: [`tasks/refinements/participant-ui/part_withdraw_proposal_gesture.md`](part_withdraw_proposal_gesture.md).
- `backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator`
  (commit `7d42e6d9`, Done 2026-06-02). Introduced the **`proposal-withdrawn`**
  event kind (ADR 0037) emitted by `withdraw-proposal` **iff** the withdraw
  would otherwise append zero events. It already terminates **both** pending
  **panes** on the new event — the participant `derivePendingProposals` arm is
  live (`apps/participant/src/proposals/derivePendingProposals.ts:197-206`,
  unit cases (n)/(o)). The backend refinement explicitly **scoped out**
  overlay projectors and Playwright and handed both to this task
  ([`tasks/refinements/backend/ws_withdraw_proposal_zero_emission_terminator.md:23,87`](../backend/ws_withdraw_proposal_zero_emission_terminator.md)).
- The WS/replay seam for the zero-emission terminator is already pinned at the
  protocol boundary by Cucumber:
  `tests/behavior/backend/ws-withdraw.feature` Scenario 4 (axiom-mark
  withdraw → `removedEventCount: 0`, one `proposal-withdrawn` event broadcast,
  re-withdraw → `proposal-not-found`).

**Pending (surfaced by this task):**

- (none — see Open questions.)

## What this task is

Close the last open piece of the participant withdraw-proposal story: make a
debater's **self-withdrawal of their own zero-emission proposal**
(axiom-mark / annotate) converge on every surface, and land the cross-surface
Playwright counterpart that `part_withdraw_proposal_gesture` §A4 deferred
because the terminator did not yet exist.

The investigation behind this refinement found that the participant
axiom-mark and annotation **overlay** projectors are **commit-gated** — they
emit a decoration only when the proposal **commits**, never while it is
pending (§D1). Because a withdraw can only target a **pending** proposal (the
server forbids withdrawing a committed one), a zero-emission
`proposal-withdrawn` can never strand a committed overlay. The overlay
projectors are therefore **already correct by construction** for the
terminator; the deliverable is:

1. **Regression pins** on the participant overlay projectors asserting that a
   `proposal → proposal-withdrawn` sequence (no commit) yields **no** overlay
   — pinning the commit-gating invariant the task's title is really about.
2. **The deferred cross-surface Playwright counterpart**: debater-A
   axiom-marks a node, then withdraws it themselves; the pending **row**
   vanishes on debater-A's tablet, debater-B's tablet, **and** the moderator
   console — driven off the new `proposal-withdrawn` event on the immutable
   log.

## Why it needs to be done

`part_withdraw_proposal_gesture` Block 1 pinned only what was observable
*before* the terminator existed: the proposer-only affordance and a clean
`proposal-withdrawn` **ack**. The row did **not** vanish then, because an
axiom-mark is zero-emission and the server appended nothing to the log on
withdraw, so no surface could converge (§D4 of that refinement). The backend
terminator task removed that blocker. This task is the participant side of
making the now-reachable self-withdraw convergence **observed and pinned** —
the analogue of `moderator_ui.mod_withdraw_proposal_canvas_edge_annotation_removal`,
which paid the moderator side of the same cross-surface debt.

Downstream: M7 (`m_end_to_end_debate`) names this task in its `depends` list;
a debater retracting their own axiom-mark and seeing it disappear everywhere
is part of the full live debate the walkthrough enacts.

## Inputs / context

**The terminator event (ADR 0037, already live):**

- `docs/adr/0037-proposal-withdrawn-terminator-event.md` — the
  `proposal-withdrawn` kind, payload `{ proposal_id, withdrawn_by,
  withdrawn_at }`, emitted iff the withdraw is otherwise log-silent. Replaces
  inference; terminates the pending record directly by `proposal_id`.
- `apps/participant/src/proposals/derivePendingProposals.ts:197-206` — the
  participant pane's `proposal-withdrawn` arm (terminates the row by
  `event.payload.proposal_id`). **Already shipped** by the backend task; this
  task does not touch it. Unit cases (n)/(o) in
  `apps/participant/src/proposals/derivePendingProposals.test.ts` cover it.

**The overlay projectors (commit-gated — the crux, §D1):**

- `packages/shell/src/axiom-marks/axiom-marks.ts:86-119` — `projectAxiomMarks`
  caches each `proposal` (kind `axiom-mark`) in a `pending` map keyed by the
  proposal envelope id, and emits an `AxiomMark` **only** on a `commit`
  (`target: 'proposal'`) referencing it. The docstring (`:78-81`) is explicit:
  *"Uncommitted axiom-mark proposals produce **no** output … the pending
  visualization is owned per-surface."* No `proposal-withdrawn` arm; none is
  needed (a pending proposal contributed no output to remove).
- `packages/shell/src/annotations/annotations.ts:83-98` — `projectAnnotations`
  walks **`annotation-created`** only (the commit-time event for `annotate`);
  *"All other event kinds are ignored at this layer."* A pending `annotate`
  proposal produces no `annotation-created`, so there is no overlay to remove
  on withdraw.
- `apps/participant/src/graph/axiomMarks.ts` — thin shim: re-exports
  `projectAxiomMarks` / `groupAxiomMarksByNode` from shell + the
  participant-local `nodeHasAxiomMark` (`:42-47`). Tested in
  `apps/participant/src/graph/axiomMarks.test.ts`.
- `apps/participant/src/graph/annotations.ts` — thin shim: re-exports
  `projectAnnotations` / `groupAnnotationsByEntityId` / `groupAnnotationsByEdge`
  from shell + participant-local `nodeHasAnnotation` / `edgeHasAnnotation` /
  `annotationCountFor` (`:41-76`). Tested in
  `apps/participant/src/graph/annotations.test.ts`.

**Where the overlays are consumed (commit-gated, confirms §D1):**

- `apps/participant/src/routes/OperateRoute.tsx:278-282` — the **only**
  call sites building the indices:
  `axiomMarkIndex = groupAxiomMarksByNode(projectAxiomMarks(events))`,
  `nodeAnnotationIndex = groupAnnotationsByEntityId(projectAnnotations(events))`,
  `edgeAnnotationIndex = groupAnnotationsByEdge(annotations)`.
- `apps/participant/src/graph/projectGraph.ts:565-567` — stamps
  `isAxiom: nodeHasAxiomMark(...)`, `hasAnnotation: nodeHasAnnotation(...)`,
  `annotationCount: annotationCountFor(...)` onto each node. There is **no**
  pre-commit / pending axiom-mark or annotation decoration anywhere on the
  participant canvas (verified: no `pending`-overlay module exists in
  `apps/participant/src/graph/`).
- `apps/participant/src/graph/GraphView.tsx:507-511` (axiom = double border),
  `:527-533` (node annotation = amber overlay), `:544-550` (edge annotation =
  amber underlay) — the Cytoscape style selectors keyed off the stamped flags;
  DOM mirrors at `:1411-1412` (`data-is-axiom`, `data-has-annotation`).
- `apps/participant/src/graph/projectGraph.ts` has **no** `proposal-withdrawn`
  arm and needs none — a zero-emission withdraw carries no structural entity,
  so there is no node/edge for `projectGraph` to drop (its `entity-removed`
  pre-pass at `:538-545` handles the entity-emitting withdraw path, untouched
  here).

**The cross-surface spec to extend:**

- `tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts` — the
  3-context spec. Block 1 (lines 13-29 docblock + assertions ~277-284) marks
  a node as axiom from debater-A's tablet, asserts the proposer-only withdraw
  button shows only on debater-A, clicks withdraw, asserts the
  `participant-withdraw-proposal-button-wire-error` region stays empty, and
  **explicitly defers** the row-disappearance assertion to this task. Block 2
  drives the moderator-proposed-node cross-surface disappearance. The spec's
  three-context setup helper `reachOperate()` (lines ~84-152) builds contexts
  via `authedContext(browser, username)`; the per-test user triples are
  `{alice, ben, maria}` (Block 1) and `{dave, erin, frank}` (Block 2) from
  `tests/e2e/fixtures/dev-users.ts`.

**Selectors already in place (no new test ids needed):**

- `[data-testid="participant-pending-proposal-row"][data-proposal-id=…]`
  (participant pane row), `[data-testid="pending-proposal-row"][data-proposal-id=…]`
  (moderator pane row), `[data-testid="participant-withdraw-proposal-button"][data-proposal-id=…]`
  (proposer-only button), `[data-testid="participant-withdraw-proposal-button-wire-error"]`.

**ADRs in force:** 0021 (event envelope discriminated union), 0022 (no
throwaway verifications), 0026 (micro-frontend surfaces consume `useAuth()` /
`useWsClient()`), 0027 (entity / facet layers strictly separate), 0030 §9
(axiom-mark commits ride the proposal-keyed commit arm), **0037** (the
`proposal-withdrawn` terminator — the direct enabler).

## Constraints / requirements

1. **No protocol, server, or shell-projector change.** The terminator event,
   its payload, and the WS/replay seam are settled (ADR 0037). The shared
   shell projectors are commit-gated and correct for the terminator (§D1);
   do **not** edit `packages/shell/src/axiom-marks/axiom-marks.ts` or
   `packages/shell/src/annotations/annotations.ts`.
2. **Pure projectors stay pure.** Any test exercises the projectors as pure
   functions over a hand-built event log — no `Date.now()`, no store reads.
3. **Pin observable behavior, not synthetic dead code (ADR 0022).** The
   regression pins assert the *participant-observable* invariant ("a withdrawn
   pending axiom-mark / annotation shows no overlay"), exercised through the
   participant shims that the surface actually consumes — not a guard against
   an event ordering the server cannot produce.
4. **Pay the deferred e2e inline; register no new follow-up.** This task is
   the registered owner of the §A4 deferred sub-scenario. The Playwright
   counterpart lands here; the debt is closed, not re-deferred.
5. **File scope — participant tests + the cross-surface spec only.** No
   server file, no `@a-conversa/shell` file, no moderator file, no `.tji`
   file. No production source change is expected (§D1); if implementation
   reveals one is genuinely required, it stays inside the participant app.

## Acceptance criteria

All checks ship as committed tests (ADR 0022 — no throwaway verifications).

**§A1 — Overlay commit-gating regression pins (Vitest).**

- `apps/participant/src/graph/axiomMarks.test.ts`: a log of
  `[ proposal(axiom-mark on node N), proposal-withdrawn(that proposal_id) ]`
  (no `commit`) projects to **no** axiom-mark — `projectAxiomMarks` returns
  `[]` and `nodeHasAxiomMark(group, N) === false`. A sibling positive case
  (`proposal` → `commit`) still yields the mark, proving the pin distinguishes
  withdrawn-pending from committed.
- `apps/participant/src/graph/annotations.test.ts`: a log of
  `[ proposal(annotate targeting node N), proposal-withdrawn(that proposal_id) ]`
  (no `annotation-created`) projects to **no** annotation —
  `projectAnnotations` returns `[]` and `nodeHasAnnotation(group, N) === false`.

These pin the §D1 invariant that drives the user-visible behavior: a
self-withdrawn zero-emission proposal leaves no decoration on the canvas.

**§A2 — Deferred cross-surface Playwright counterpart**
(extend `tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts`).
Reusing Block 1's `{alice (moderator), ben (debater-A), maria (debater-B)}`
triple and the axiom-mark proposal it already creates: after debater-A clicks
their own withdraw button (the existing Block-1 step) and the wire-error
region stays empty, assert the proposal **converges off the log** —

- the participant pending row
  `[data-testid="participant-pending-proposal-row"][data-proposal-id=<axiom>]`
  reaches `toHaveCount(0)` on **debater-A's** tablet **and** **debater-B's**
  tablet, and
- the moderator pending row
  `[data-testid="pending-proposal-row"][data-proposal-id=<axiom>]` reaches
  `toHaveCount(0)` on the moderator console,

each within the spec's existing convergence timeout. This is the §A4 deferred
sub-scenario, now reachable via the `proposal-withdrawn` terminator.

Because the participant canvas renders **no** decoration for a *pending*
axiom-mark (§D1 — the badge is commit-gated), the meaningful cross-surface
assertion is the **pending-row** disappearance above; the spec may add a
sanity assertion that the node carries no `data-is-axiom` badge throughout
(it never did, since the mark was never committed) to document the
commit-gating reality, but the row convergence is the debt-paying check.

**e2e is in scope and paid here (not deferred).** The surface is reachable:
the self-withdraw button is route-rendered in the participant operate console
(shipped by `part_withdraw_proposal_gesture`) and the terminator that drives
convergence is live (ADR 0037). No `part_pw_*` deferral; **no new WBS
follow-up task is registered** — this task is the §A4 debt owner and closes
it.

## Decisions

**§D1 — The overlay projectors need no `proposal-withdrawn` arm; they are
commit-gated and correct by construction.** `projectAxiomMarks` emits only on
`commit`; `projectAnnotations` emits only on `annotation-created`. Both are
commit-time events. A withdraw targets only a **pending** proposal (the
server forbids withdrawing a committed one —
`apps/server/src/ws/handlers/withdraw.ts` authority/state gate;
`ws-withdraw.feature` Scenario 3 `proposal-already-committed`). Therefore a
`proposal-withdrawn` event can only ever reference a proposal that
contributed **no** overlay output, so there is nothing to retract. *Rationale:*
the title's "port the overlay projectors to honor the terminator" rests on
the original §A4 framing that imagined a *pending* axiom-mark overlay
vanishing — but the participant canvas renders **no** pre-commit decoration
(`packages/shell/src/axiom-marks/axiom-marks.ts:78-81`; no pending-overlay
module exists under `apps/participant/src/graph/`). The honest, defensible
deliverable is to **pin the invariant** (§A1) and **observe the now-reachable
behavior** (§A2), not to add code. *Alternatives rejected:*
- **Add a `proposal-withdrawn` arm to the shell `pending` map**
  (`pending.delete(proposal_id)`) — out of participant file scope (mutates
  shared cross-surface code), and it guards a `commit`-after-`withdraw`
  ordering the server cannot emit, so it pins no observable behavior (a test
  for it would assert against a synthetic, impossible log — exactly the
  throwaway-style verification ADR 0022 discourages).
- **Add a participant-local output-filter wrapper** (the moderator's
  `projectModeratorAnnotations` shape from
  `mod_withdraw_proposal_canvas_edge_annotation_removal` §D2) — it would
  filter the projector's *output* against withdrawn proposal ids, but a
  withdrawn-pending proposal never produced output, so the wrapper would be a
  literal no-op filtering an empty set: dead code.

**§D2 — Pin the invariant in the participant shim tests, not in shell.** The
§A1 cases live in `apps/participant/src/graph/{axiomMarks,annotations}.test.ts`
and run through the participant shims (`nodeHasAxiomMark` /
`nodeHasAnnotation`) that `OperateRoute` actually consumes. *Rationale:* the
observable property being pinned is *participant-surface* ("a withdrawn
axiom-mark shows no badge here"), and these test files already exercise the
re-exported shell projectors via the shims (existing cases prove
bucketed-vs-unbucketed). *Alternative rejected:* add the cases only to the
shell package tests — that pins the shell function in isolation but not the
participant surface's consumption, and this is a participant-UI task.

**§D3 — Extend the existing Block 1, do not write a new spec.** The deferred
counterpart is the natural continuation of Block 1's existing axiom-mark
self-withdraw flow — the proposal is already created and withdrawn there; only
the convergence assertions were deferred. *Rationale:* reuses the spec's
three-context setup, the same proposal id, and the same `{alice, ben, maria}`
triple — minimal new wall-clock, and the assertion sits exactly where the
deferral note pointed. *Alternative rejected:* a fresh standalone spec —
duplicates the costly three-context bring-up for one extra convergence check.

**§D4 — `projectGraph` is untouched.** A zero-emission withdraw carries no
structural entity, so there is no node/edge for the graph projector to drop;
its `entity-removed` pre-pass (the entity-emitting withdraw path) already
shipped in `part_withdraw_proposal_gesture`. *Rationale:* adding a
`proposal-withdrawn` arm to `projectGraph` would be inert — preempting an
implementer from adding a spurious arm. *Alternative rejected:* defensively
arm `projectGraph` — no entity to act on; dead code.

## Open questions

(none — all decided. The overlay projectors are commit-gated and need no
code change (§D1); the deferred e2e is reachable and paid inline (§A2); no
new WBS task is registered.)

## Status

**Done** — 2026-06-02.

- `apps/participant/src/graph/axiomMarks.test.ts` — added "axiom-mark commit-gating (proposal-withdrawn terminator)" Vitest case: `[proposal(axiom-mark), proposal-withdrawn]` projects to no axiom-mark; sibling positive case (`proposal` → `commit`) still yields the mark (§A1 pin).
- `apps/participant/src/graph/annotations.test.ts` — added "annotation commit-gating (proposal-withdrawn terminator)" Vitest case: `[proposal(annotate), proposal-withdrawn]` projects to no annotation; sibling positive case still yields one (§A1 pin).
- `tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts` — extended Block 1 with the §A4 deferred counterpart: after debater-A withdraws their own axiom-mark, asserts `toHaveCount(0)` on the participant pending row on debater-A's tablet, debater-B's tablet, and the moderator console; added a `data-is-axiom="false"` sanity check documenting the commit-gating reality (§A2).
- No production source change (§D1 confirmed): overlay projectors are commit-gated and correct by construction; no `proposal-withdrawn` arm was needed.
- Tech-debt closed: this task was the registered §A4 debt owner; debt is fully paid, none re-deferred.
