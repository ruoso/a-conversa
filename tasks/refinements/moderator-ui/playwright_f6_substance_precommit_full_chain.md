# Playwright F6 step-4 full-chain — extend `seedWsStore` with facet vote/commit synthesis, unskip the rebut-substance-precommit happy-path

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_tests.mod_e2e_playwright.playwright_f6_substance_precommit_full_chain`
(see leaf at line 828).

```tji
task playwright_f6_substance_precommit_full_chain "Extend seedWsStore to synthesize facet-vote/committed events; unskip full F6 step-4 e2e chain" {
  effort 1d
  allocate team
  depends moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit
  note -8<-
    Source of debt: mod_defeater_substance_precommit (commit closing that task) — the full
    F6 step-4 happy-path (shape vote+commit → rebut affordance → substance vote+commit) is
    test.skip in tests/e2e/moderator-capture.spec.ts because seedWsStore does not synthesize
    facet-vote/committed events. This task extends seedWsStore (or adds a sibling helper)
    to synthesize those events so the skipped test can be unskipped and the end-to-end
    chain pinned.
  ->8-
}
```

## Effort estimate

**1d.** Confirmed. Two coordinated edits:

- **`tests/e2e/fixtures/wsStoreSeed.ts`** — add three new seed types
  (`SeedProposal`, `SeedFacetVote`, `SeedFacetCommit`) wired into
  `SeedSessionOptions`, plus the `applyEvent` loops that synthesize
  `kind: 'proposal'`, `kind: 'vote'`, `kind: 'commit'` events with the
  facet-keyed inner payloads. ~80 lines of additions; same shape as the
  existing `nodes` / `edges` / `annotations` arms.
- **`tests/e2e/moderator-capture.spec.ts` L2335–2426** — unskip the
  existing `test.skip` body, extend it to drive the full F6 step-4 chain
  via two `seedWsStore` calls bracketing the new
  `<RebutEdgePreCommitAffordance>` click. Replaces the
  baseline-only assertions with full end-state assertions per the
  predecessor's Acceptance criteria §5.

Concrete deliverable:

- **Extended `seedWsStore`** synthesizing facet-keyed proposal + vote +
  commit events (Decision §D2 commits to extending the existing helper
  rather than minting a sibling). The new event kinds are
  `'proposal'`, `'vote'`, and `'commit'` per
  [`events.ts` L132–169](../../../packages/shared-types/src/events.ts#L132);
  the inner payloads are `proposalEnvelopePayloadSchema` (envelope of
  `proposalPayloadSchema`), `facetVotePayloadSchema`, and
  `facetCommitPayloadSchema` from
  [packages/shared-types/src/events.ts L430–525](../../../packages/shared-types/src/events.ts#L430).
- **Unskipped `test()`** at
  [tests/e2e/moderator-capture.spec.ts L2335](../../../tests/e2e/moderator-capture.spec.ts#L2335)
  exercising the full F6 step-4 chain end-to-end. The body becomes the
  scenario predecessor §5 scoped: seed X + Y + rebut edge → seed the
  shape-facet round (proposal + 2 votes + commit) → assert rebut
  affordance mounts → click "Pre-commit as agreed" → seed the
  substance-facet round (2 votes + commit) → assert end state.
- **No new fixture file, no new helper file.** The seam extension is
  in the existing `wsStoreSeed.ts`; the spec extension is in the existing
  spec body. Decision §D3 records this.
- **No production-code change.** The `<RebutEdgePreCommitAffordance>` +
  `<StatementEdge>` switch shipped by
  [`mod_defeater_substance_precommit`](mod_defeater_substance_precommit.md)
  are unchanged.
- **No methodology / projection / wire-schema change.** All event shapes
  the helper synthesizes are already pinned by the shared-types schemas;
  this task only teaches `seedWsStore` to produce them.

## Inherited dependencies

Direct dep:
`!moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit` (WBS
L831).

Settled (every gating dep is done):

- **`moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit`**
  (done 2026-05-31 —
  [`mod_defeater_substance_precommit.md`](mod_defeater_substance_precommit.md)).
  Shipped `<RebutEdgePreCommitAffordance>` + the `<StatementEdge>`
  role-discriminator switch, plus the baseline-only e2e at
  `tests/e2e/moderator-capture.spec.ts:2335-2426` whose
  `test.skip` closure (L2422–2425) explicitly defers the full F6 step-4
  happy-path to this task. The predecessor's Status block (L1115) names
  the deferred coverage and the registration target.
- **`moderator_ui.mod_defeater_flow.mod_defeater_node_creation`** (done
  2026-05-31 —
  [`mod_defeater_node_creation.md`](mod_defeater_node_creation.md)).
  Shipped F6 step 3 — the capture pane + the
  `capture-node`-with-edge envelope that mints Y + the rebut edge.
  Indirect ancestor; this task's full-chain spec exercises F6 steps
  3 → 4 in one test body.
- **`moderator_ui.mod_defeater_flow.mod_capture_defeater_mode`** (done —
  commit `0bed258`,
  [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md)).
  Shipped F6 step 1's mode-entry seam. Indirect ancestor.
- **`moderator_ui.per_facet_refactor.pf_mod_edge_shape_commit_affordance`**
  (settled — moderator can advance an edge's shape facet via the
  per-edge inline affordance at
  [`StatementEdge.tsx` L306](../../../apps/moderator/src/graph/StatementEdge.tsx#L306)).
  Decision §D4 records that this spec drives the shape facet via
  **synthetic event seeding** rather than UI clicks on the
  shape-commit affordance — the goal is to pin
  `<RebutEdgePreCommitAffordance>`'s wire path, not to re-cover the
  shape-commit affordance.
- **[ADR 0021](../../../docs/adr/0021-event-envelope.md)** — event
  envelope shape; `kind` is the top-level discriminator (`'proposal'`,
  `'vote'`, `'commit'`, `'node-created'`, `'edge-created'`, ...).
- **[ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as committed Vitest / Cucumber /
  Playwright; this refinement is a Playwright unskip.
- **[ADR 0027](../../../docs/adr/0027-structural-events-emit-at-propose-time.md)**
  — structural entity events emit at propose time, so the rebut edge
  exists in projection from the step-3 envelope.
- **[ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)**
  — per-facet vote-keying and sequential capture. §1 + §5 + §8 + §10
  are the relevant clauses: (a) the edge facet sequence is
  `shape → substance`; (b) facet-keyed votes carry
  `{ target: 'facet', entity_kind, entity_id, facet, participant, choice }`;
  (c) a facet reaches `'committed'` after a `kind: 'commit'` event
  with `target: 'facet'`.
- **[ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md)** —
  Playwright as the e2e framework + the dev-only `window.__aConversaWsStore`
  seam the helper plugs into.
- **`tests/behavior/methodology/defeater-capture.feature`** (settled
  engine pin). Pins the projection-side end state this spec also
  asserts in the UI layer: rebut edge with shape=committed,
  substance=agreed, source Y with substance=proposed → firing
  predicate inert.

Pending edges this task FEEDS (NOT depends on):

- **`milestones.M6` (F6 / defeater-flow milestone)** — this task closes
  the last deferred Playwright coverage of F6 step 4. The Closer
  evaluates milestone propagation per
  [`tasks/refinements/README.md`](../README.md#task-completion-ritual).

No new ADR is required (see Decision §D7). No new fixture file. No
production-code change.

## What this task is

Pay down the test-debt registered by
[`mod_defeater_substance_precommit`](mod_defeater_substance_precommit.md):
extend `seedWsStore` (the dev-only `window.__aConversaWsStore` seed
helper at
[tests/e2e/fixtures/wsStoreSeed.ts L120](../../../tests/e2e/fixtures/wsStoreSeed.ts#L120))
with three new event-kind arms — `proposal`, `vote` (facet-keyed),
`commit` (facet-keyed) — and unskip the F6 step-4 happy-path body at
[tests/e2e/moderator-capture.spec.ts L2335–2426](../../../tests/e2e/moderator-capture.spec.ts#L2335)
so it exercises the full chain:

1. **Seed structural shell** (existing arms): a target node X, the
   defeater node Y, and the rebut edge Y→X with `role: 'rebuts'`.
   (Same as the current baseline.)
2. **Seed the shape-facet round** (new arms): a proposal naming the
   shape candidate, unanimous-agree votes from the two debaters,
   moderator commit on the shape facet. After this round, the rebut
   edge's shape facet is `'committed'` in projection and the
   substance facet is `'awaiting-proposal'` —
   `<StatementEdge>`'s `showSubstanceAffordance` predicate flips
   `true`.
3. **Assert affordance mounts** (existing UI surface): the new
   `<RebutEdgePreCommitAffordance>` is visible on the rebut edge with
   its hint paragraph + two-button picker.
4. **Click "Pre-commit as agreed"** (real UI gesture): exercises the
   wire path the predecessor refinement scoped — the click fires
   `propose set-edge-substance(rebut_edge_id, 'agreed')` via
   `useProposeSetEdgeSubstanceAction(edgeId)` (substance-only re-vote
   shape, no endpoint carriage per
   [predecessor §D6](mod_defeater_substance_precommit.md#d6-wire-shape-substance-only-re-vote-no-endpoint-carriage)).
5. **Seed the substance-facet round** (new arms): unanimous-agree
   votes + moderator commit on the substance facet. The proposal
   envelope was emitted by the real click in step 4 — the seed adds
   only the votes + commit.
6. **Assert end state**: rebut edge's substance facet is `'agreed'`
   (via `data-substance-facet-status`); the affordance unmounts (the
   gate flips `false` once substance is no longer `'awaiting-proposal'`);
   Y's substance facet remains `'proposed'` (per the predecessor's §D5
   — no active gesture by this task or its predecessor names Y's
   substance, it carries from the step-3 `entity-included` event).

The task title's phrasing — "extend seedWsStore to synthesize
facet-vote/committed events" — uses the conventional facet-keyed
shorthand; on the wire the events are `kind: 'vote'` and
`kind: 'commit'` with `payload.target: 'facet'`. The Constraints
section pins the literal wire shape.

**Out of scope** (sibling-task / downstream / out-of-flow ownership):

- **Driving F6 step 3 via real UI in the same test body.** The
  predecessor's `mod_capture_defeater_mode` and
  `mod_defeater_node_creation` specs (in the same file) already pin
  the F6 steps 1–3 real-UI flow end-to-end. This spec's job is the
  substance-precommit chain (step 4) — it seeds the structural shell
  + shape-committed precondition rather than re-driving step 3 to
  keep the test body focused (Decision §D5).
- **A second test variant for the disputed path.** The predecessor's
  Vitest cover at
  [`RebutEdgePreCommitAffordance.test.tsx`](../../../apps/moderator/src/graph/RebutEdgePreCommitAffordance.test.tsx)
  pins the disputed-button wire dispatch at the unit level (case 3 of
  the test file). The Playwright spec pins only the methodology-default
  path (`'agreed'`) — Decision §D6 records this.
- **A meta-disagree or withdraw path within the F6 chain.** The
  facet-status projection has additional rules for those state
  transitions (rules 3 + 4 of
  [`facet-status.ts`](../../../apps/server/src/projection/facet-status.ts));
  exercising them is out of scope for this task.
- **Server-side replay of the seeded events.** The seed mutates the
  client-side Zustand store directly via `applyEvent`; it does NOT
  re-broadcast to the server. The seeded session is a client-local
  illusion — that's the existing `seedWsStore` posture and Decision §D1
  inherits it.
- **A `seedWsStore` generalization to all 20+ event kinds.** This task
  adds the three kinds the F6 step-4 chain needs (`proposal`, `vote`,
  `commit`); other kinds are added by their owning specs as needed
  (Decision §D2's "extend, don't reinvent" rationale).

## Why it needs to be done

Three reasons:

1. **The F6 step-4 happy-path Playwright cover is currently
   `test.skip`.** The predecessor's Acceptance criteria §5 scoped the
   full chain but the implementer (correctly) reduced it to a baseline
   gate-behavior spec because `seedWsStore` didn't synthesize the
   facet-round events needed to reach shape=committed. The skip
   comment at
   [tests/e2e/moderator-capture.spec.ts L2422–2425](../../../tests/e2e/moderator-capture.spec.ts#L2422)
   names this task as the remediation. Closing it pays down the debt.

2. **The wire-shape pin is currently unit-only.** The predecessor's
   `RebutEdgePreCommitAffordance.test.tsx` cases 2 + 3 pin that a
   button click calls `propose(value)` with the right argument; the
   unit-level mock asserts the propose envelope shape. But the
   Playwright cover pins the FULL chain — the click reaches the WS
   client, the WS client builds the right envelope, the envelope is
   accepted by the propose-handler arm, the projection moves the
   substance facet forward. Without an unskipped e2e, the
   propose-handler-arm coverage relies on the Vitest pin
   ([`proposeDefeaterPreCommit.test.ts`](../../../apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts))
   which exercises the server-side seed loop — not the UI gesture.

3. **`seedWsStore` is the canonical projection-seeding seam for the
   moderator e2e suite.** It's used by `mod_hover_details`,
   `mod_session_lobby`, `mod_defeater_substance_precommit` (the
   baseline gate spec), and others. Adding the three new arms unblocks
   not just this task's spec but every future spec that needs to seed
   a settled facet state (e.g., specs that pin per-edge actions gated
   on committed facets — Decision §D2's downstream-reuse rationale).

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- [tests/e2e/fixtures/wsStoreSeed.ts L1–223](../../../tests/e2e/fixtures/wsStoreSeed.ts#L1)
  — the helper this task extends. `seedWsStore` (L120–223) accepts
  `SeedSessionOptions` with `nodes` / `edges` / `annotations` arrays
  and calls `store.applyEvent(event)` for each, advancing
  `sequence` from the store's `lastAppliedSequence` high-water mark
  (L149–150). The new arms (`proposals`, `votes`, `commits`) follow
  the same shape: per-item loop, `applyEvent`-per-event,
  `sequence += 1`.
- [tests/e2e/moderator-capture.spec.ts L2335–2426](../../../tests/e2e/moderator-capture.spec.ts#L2335)
  — the `test.skip` body this task unskips. The seed-X+Y+rebut-edge
  preamble (L2367–2387), the gate-absent baseline assertions
  (L2392–2409), and the `test.skip` closure (L2422–2425) are the
  existing surface. The unskipped body replaces the gate-absent
  assertions (L2398–2409) with full-chain assertions and removes the
  `test.skip(true, ...)` call.
- [tests/e2e/moderator-capture.spec.ts L2301–2334](../../../tests/e2e/moderator-capture.spec.ts#L2301)
  — the pre-`test()` doc-block from the predecessor. The Status block
  this task ships updates the deferred-coverage section to point at
  this refinement's landing (Decision §D9).
- [packages/shared-types/src/events.ts L132–169](../../../packages/shared-types/src/events.ts#L132)
  — the top-level event-kind discriminator. `kind: 'proposal'` /
  `'vote'` / `'commit'` are the wire kinds.
- [packages/shared-types/src/events.ts L430–438](../../../packages/shared-types/src/events.ts#L430)
  — `facetVotePayloadSchema`:
  ```ts
  z.object({
    target: z.literal('facet'),
    entity_kind: z.enum(['node', 'edge']),
    entity_id: z.string().uuid(),
    facet: facetNameSchema,
    participant: z.string().uuid(),
    choice: z.enum(['agree', 'dispute']),
    voted_at: z.string().datetime({ offset: true }),
  })
  ```
- [packages/shared-types/src/events.ts L502–509](../../../packages/shared-types/src/events.ts#L502)
  — `facetCommitPayloadSchema`:
  ```ts
  z.object({
    target: z.literal('facet'),
    entity_kind: z.enum(['node', 'edge']),
    entity_id: z.string().uuid(),
    facet: facetNameSchema,
    committed_by: z.string().uuid(),
    committed_at: z.string().datetime({ offset: true }),
  })
  ```
- [packages/shared-types/src/events/proposals.ts L247–269](../../../packages/shared-types/src/events/proposals.ts#L247)
  — `setEdgeSubstanceProposalSchema`. The shape-facet proposal this
  task seeds uses the substance-only re-vote shape
  `{ kind: 'set-edge-substance', edge_id, value: 'agreed' }`
  with `value` matching the candidate the votes ratify. (For the
  shape-facet round, this same proposal kind is the candidate carrier;
  ADR 0030 §5 routes the carriage through the facet projection.)
- [packages/shared-types/src/events/proposals.ts L522–526](../../../packages/shared-types/src/events/proposals.ts#L522)
  — `proposalEnvelopePayloadSchema`. The proposal event's `payload`
  is `{ proposal: <kind-specific schema> }`.
- [apps/server/src/projection/facet-status.ts L1–247](../../../apps/server/src/projection/facet-status.ts#L1)
  — the projection that derives `FacetStatus` from the event-accumulated
  state. Rules 6 + 7 (commit-event-lands + unanimous-agree) are the
  ones the seeded round exercises. The seeded sequence advances the
  facet through `'proposed'` → `'agreed'` → `'committed'`.
- [apps/moderator/src/graph/proposalFacets.ts L290–364](../../../apps/moderator/src/graph/proposalFacets.ts#L290)
  — the moderator-side selector that merges broadcast-derived +
  events-derived facet status. `seedWsStore`'s events go through this
  selector to reach `<StatementEdge>`.
- [apps/moderator/src/graph/StatementEdge.tsx L147–160, L306–307](../../../apps/moderator/src/graph/StatementEdge.tsx#L147)
  — the consumer surface. The `showSubstanceAffordance` predicate at
  L160 is what flips `true` after the shape-facet round seeds, and
  the role-discriminator switch at L306–307 then mounts
  `<RebutEdgePreCommitAffordance>`.
- [apps/moderator/src/main.tsx](../../../apps/moderator/src/main.tsx)
  — the dev-only `window.__aConversaWsStore = useWsStore` assignment
  (gated on `import.meta.env.DEV`) the helper depends on. No change
  needed; the existing baseline spec already uses
  `isWsStoreReachable(page)` to branch on availability
  ([wsStoreSeed.ts L230–237](../../../tests/e2e/fixtures/wsStoreSeed.ts#L230)).
- [tests/behavior/steps/methodology-defeater-capture.steps.ts L71–116](../../../tests/behavior/steps/methodology-defeater-capture.steps.ts#L71)
  — `emitProposalVotesCommit(world, proposalId, proposalPayload)`, the
  Cucumber-side helper that synthesizes a propose → 3-vote (agree) →
  commit round against pglite. This task's `seedWsStore` extension
  follows the same shape (proposal envelope, then N votes, then a
  facet-keyed commit) but writes to `applyEvent` instead of
  `insertEventRow`.
- [tests/behavior/steps/commit-facet-keyed.steps.ts L272–287](../../../tests/behavior/steps/commit-facet-keyed.steps.ts#L272)
  — the canonical reference for the facet-keyed commit shape.
- [tests/behavior/steps/vote-facet-keyed.steps.ts L223–239](../../../tests/behavior/steps/vote-facet-keyed.steps.ts#L223)
  — the canonical reference for the facet-keyed vote shape.
- [tests/e2e/methodology-full-flow.spec.ts L1052](../../../tests/e2e/methodology-full-flow.spec.ts#L1052)
  — the existing cross-context spec that drives vote+commit via REAL
  participant tablets. Decision §D5 explains why this task does NOT
  fork to the real-tablet pattern.

Refinements consulted for style + decision continuity:

- [`mod_defeater_substance_precommit.md`](mod_defeater_substance_precommit.md)
  — predecessor; the source of debt this task pays. Acceptance §5
  scopes the spec body; Decision §D1 + §D6 pin the wire shape.
- [`mod_defeater_node_creation.md`](mod_defeater_node_creation.md) —
  carries the F6 framing + the capture-pane real-UI helpers the
  unskipped body relies on.
- [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md) — the
  mode-entry seam.
- [`mod_hover_details.md`](mod_hover_details.md) — the refinement that
  originally established `seedWsStore` (per its file header at
  [wsStoreSeed.ts L5](../../../tests/e2e/fixtures/wsStoreSeed.ts#L5)).
  Style precedent for extending the helper.
- [`mod_session_lobby.md`](mod_session_lobby.md) — the refinement that
  added the `seedParticipants` sibling helper. Decision §D2 contrasts
  that "sibling helper" pattern against this task's "extend the
  existing helper" choice (the F6 round events are conceptually one
  facet round, not a separate domain).

No new ADR is required (see Decision §D7). No new dependency, no
public type signature change, no cross-workspace contract change.

## Constraints / requirements

### Extend `tests/e2e/fixtures/wsStoreSeed.ts`

- **Three new `Seed*` types**, exported alongside the existing ones:

  ```ts
  export interface SeedProposal {
    readonly proposalEventId?: string;       // UUID; auto-generated if omitted
    readonly proposal: Record<string, unknown>;  // inner proposal payload (e.g.,
                                                  //   { kind: 'set-edge-substance',
                                                  //     edge_id, value })
    readonly actor?: string;                  // UUID; defaults to the moderator UUID
  }

  export interface SeedFacetVote {
    readonly entityKind: 'node' | 'edge';
    readonly entityId: string;
    readonly facet: 'shape' | 'substance' | 'classification' | 'wording';
    readonly participant: string;             // UUID
    readonly choice: 'agree' | 'dispute';
  }

  export interface SeedFacetCommit {
    readonly entityKind: 'node' | 'edge';
    readonly entityId: string;
    readonly facet: 'shape' | 'substance' | 'classification' | 'wording';
    readonly committedBy?: string;            // UUID; defaults to the moderator UUID
  }
  ```

- **`SeedSessionOptions` gains three optional arrays**:

  ```ts
  export interface SeedSessionOptions {
    readonly sessionId: string;
    readonly nodes?: readonly SeedNode[];
    readonly edges?: readonly SeedEdge[];
    readonly annotations?: readonly SeedAnnotation[];
    readonly proposals?: readonly SeedProposal[];     // NEW
    readonly votes?: readonly SeedFacetVote[];        // NEW
    readonly commits?: readonly SeedFacetCommit[];    // NEW
  }
  ```

- **Three new loops inside `seedWsStore`'s `page.evaluate(...)`
  callback**, mirroring the existing `nodes` / `edges` / `annotations`
  loops:

  ```ts
  for (const proposal of proposals) {
    store.getState().applyEvent({
      id: proposal.proposalEventId ?? `00000000-0000-4000-8000-${(0x6000 + sequence).toString(16).padStart(12, '0')}`,
      sessionId,
      sequence,
      kind: 'proposal',
      actor: proposal.actor ?? actor,
      payload: { proposal: proposal.proposal },
      createdAt,
    });
    sequence += 1;
  }
  for (const vote of votes) {
    store.getState().applyEvent({
      id: `00000000-0000-4000-8000-${(0x7000 + sequence).toString(16).padStart(12, '0')}`,
      sessionId,
      sequence,
      kind: 'vote',
      actor: vote.participant,
      payload: {
        target: 'facet',
        entity_kind: vote.entityKind,
        entity_id: vote.entityId,
        facet: vote.facet,
        participant: vote.participant,
        choice: vote.choice,
        voted_at: createdAt,
      },
      createdAt,
    });
    sequence += 1;
  }
  for (const commit of commits) {
    store.getState().applyEvent({
      id: `00000000-0000-4000-8000-${(0x8000 + sequence).toString(16).padStart(12, '0')}`,
      sessionId,
      sequence,
      kind: 'commit',
      actor: commit.committedBy ?? actor,
      payload: {
        target: 'facet',
        entity_kind: commit.entityKind,
        entity_id: commit.entityId,
        facet: commit.facet,
        committed_by: commit.committedBy ?? actor,
        committed_at: createdAt,
      },
      createdAt,
    });
    sequence += 1;
  }
  ```

- **Loop order**: `nodes → annotations → edges → proposals → votes →
  commits`. Decision §D3 records the rationale: structural creation
  precedes facet rounds, and a facet round is itself ordered
  proposal → votes → commit.
- **`createdAt` is shared with the existing arms** (the single
  `'2026-05-11T00:00:00.000Z'` constant at
  [wsStoreSeed.ts L143](../../../tests/e2e/fixtures/wsStoreSeed.ts#L143)).
  All seeded events share the same timestamp; the projection orders by
  `sequence`, not `createdAt`.
- **No schema validation in the helper.** The helper mirrors the
  existing arms' posture — `applyEvent` is the source of truth (Zod
  validation happens server-side; the client-side store accepts the
  shape and the projection derives state from it). A malformed seed
  surfaces as a projection-empty assertion failure, not a helper
  exception. (Decision §D8.)

### Unskip + extend `tests/e2e/moderator-capture.spec.ts` L2335–2426

The body becomes:

```ts
test('alice: F6 step 4 — pre-commit rebut edge substance as agreed (full chain)', async ({
  page,
}) => {
  // 1. Existing preamble: login + create session + invite + enter operate.
  //    (Lines 2338–2350 of the baseline spec — unchanged.)

  if (!(await isWsStoreReachable(page))) {
    test.skip(true, 'window.__aConversaWsStore unreachable in this environment.');
    return;
  }

  const url = new URL(page.url());
  const sessionId = url.pathname.split('/')[3] ?? '';

  // 2. Seed the structural shell: X, Y, rebut edge Y→X.
  const X_NODE_ID = '99999999-9999-4999-8999-999999999901';
  const Y_NODE_ID = '99999999-9999-4999-8999-999999999902';
  const REBUT_EDGE_ID = '99999999-9999-4999-8999-9999999999e1';
  const MODERATOR_ID = '00000000-0000-4000-8000-0000000000aa';
  const DEBATER_A_ID = '00000000-0000-4000-8000-0000000000bb';
  const DEBATER_B_ID = '00000000-0000-4000-8000-0000000000cc';

  await seedWsStore(page, {
    sessionId,
    nodes: [
      { nodeId: X_NODE_ID, wording: 'Workers should earn a living wage.' },
      { nodeId: Y_NODE_ID, wording: 'Cost-of-living adjustments fully cover all worker expenses.' },
    ],
    edges: [
      { edgeId: REBUT_EDGE_ID, source: Y_NODE_ID, target: X_NODE_ID, role: 'rebuts' },
    ],
  });

  // 3. Seed the shape-facet round: proposal naming the candidate +
  //    unanimous-agree from both debaters + moderator commit.
  //    After this round, shape='committed' and substance='awaiting-proposal'.
  await seedWsStore(page, {
    sessionId,
    proposals: [
      {
        proposal: {
          kind: 'set-edge-substance',
          edge_id: REBUT_EDGE_ID,
          value: 'agreed', // shape candidate carriage; the inner kind is the same
                            // schema, the projection routes by facet
        },
        actor: MODERATOR_ID,
      },
    ],
    votes: [
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'shape', participant: DEBATER_A_ID, choice: 'agree' },
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'shape', participant: DEBATER_B_ID, choice: 'agree' },
    ],
    commits: [
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'shape' },
    ],
  });

  // 4. Assert the affordance mounts.
  await expect(page.getByTestId(`rebut-edge-pre-commit-affordance-${REBUT_EDGE_ID}`)).toBeVisible();
  await expect(page.getByTestId(`edge-card-substance-affordance-${REBUT_EDGE_ID}`)).toHaveCount(0);

  // 5. Click "Pre-commit as agreed". The click fires a REAL propose envelope
  //    via the WS client.
  await page.getByTestId(`rebut-edge-pre-commit-button-${REBUT_EDGE_ID}-agreed`).click();

  // 6. Wait for the substance-facet status to flip to 'proposed' as the
  //    propose envelope round-trips and the projection consumes it.
  await expect(
    page.locator(`[data-edge-id="${REBUT_EDGE_ID}"] [data-substance-facet-status]`),
  ).toHaveAttribute('data-substance-facet-status', 'proposed', { timeout: 5_000 });

  // 7. Seed the substance-facet round: unanimous-agree + moderator commit.
  //    The proposal envelope was emitted by step 5's real click; the seed
  //    adds only votes + commit.
  await seedWsStore(page, {
    sessionId,
    votes: [
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'substance', participant: DEBATER_A_ID, choice: 'agree' },
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'substance', participant: DEBATER_B_ID, choice: 'agree' },
    ],
    commits: [
      { entityKind: 'edge', entityId: REBUT_EDGE_ID, facet: 'substance' },
    ],
  });

  // 8. End-state assertions.
  await expect(
    page.locator(`[data-edge-id="${REBUT_EDGE_ID}"] [data-substance-facet-status]`),
  ).toHaveAttribute('data-substance-facet-status', 'agreed');
  await expect(page.getByTestId(`rebut-edge-pre-commit-affordance-${REBUT_EDGE_ID}`)).toHaveCount(0);
  await expect(
    page.locator(`[data-node-id="${Y_NODE_ID}"] [data-substance-facet-status]`),
  ).toHaveAttribute('data-substance-facet-status', 'proposed');
});
```

- **The test title changes** from the gate-baseline phrasing to the
  full-chain phrasing. The doc-block above the test (L2301–2334) is
  updated: the "Why the full F6 step-4 happy-path is deferred" section
  is replaced with a short note pointing at this refinement.
- **No new test added** alongside the unskipped one. The baseline-only
  scenario from
  [`mod_defeater_substance_precommit`](mod_defeater_substance_precommit.md)
  is folded into this full-chain scenario — the gate-absent
  assertions before the shape-facet seed serve the same purpose
  (Decision §D9).

### Files this task touches (explicit allowlist)

- `tests/e2e/fixtures/wsStoreSeed.ts` (modified — three new arms +
  exported types).
- `tests/e2e/moderator-capture.spec.ts` (modified — unskip +
  full-chain body + doc-block update).

### Files this task does NOT touch

- `.tji` files — the Closer adds `complete 100` to
  `playwright_f6_substance_precommit_full_chain` per the README
  ritual. The Closer also evaluates milestone propagation
  (`mod_defeater_flow` may close as a side-effect; that's evaluated
  at close time).
- `docs/adr/` — no new ADR (Decision §D7).
- `apps/moderator/src/` — no production-code change. The
  `<RebutEdgePreCommitAffordance>` and the `<StatementEdge>` switch
  shipped by the predecessor are unchanged.
- `packages/shared-types/src/` — no schema change.
- `apps/server/src/` — no server-side change.
- `packages/i18n-catalogs/src/` — no new keys (Playwright spec uses
  the predecessor's existing keys via the moderator's running
  catalog).

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck across the
  modified test files).
- `pnpm exec playwright test tests/e2e/moderator-capture.spec.ts`
  green; the unskipped F6 step-4 full-chain scenario passes; the
  rest of the spec file is unchanged.
- `make test:e2e:compose` green (the full e2e suite under the
  compose stack the rest of the moderator e2e specs run under).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100`.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

This task IS the deferred-e2e payment; the e2e cover is the
deliverable. The predecessor task explicitly named this as the
named-future-task receiving the deferred coverage. No further
deferral is appropriate — the gate was a `seedWsStore`-shape
deficiency and this task fixes that. Decision §D7 confirms no new
ADR-level decisions are surfaced.

## Acceptance criteria

### 1. `seedWsStore` shape extension

- `SeedSessionOptions` gains three optional arrays: `proposals`,
  `votes`, `commits`. Each has the type signature pinned in
  Constraints / requirements.
- `SeedProposal`, `SeedFacetVote`, `SeedFacetCommit` are exported
  alongside `SeedNode`, `SeedEdge`, `SeedAnnotation`.
- When `proposals`, `votes`, and `commits` are all absent, the
  helper's behavior is byte-identical to its pre-task behavior (the
  three new loops iterate zero items and contribute no events).
- The loops run in the order
  `nodes → annotations → edges → proposals → votes → commits`.
- `sequence` advances by one per seeded event across all six loops,
  continuing from `lastAppliedSequence + 1` as today (L149–150).

### 2. Wire payloads

- A `proposal` seed produces an event with:
  - `kind === 'proposal'`
  - `payload === { proposal: <the inner proposal payload> }`
  - `actor === proposal.actor ?? <moderator UUID>`
  - `id === proposal.proposalEventId ?? <auto-generated UUID>`
  - `sequence` and `createdAt` per the shared accumulator.
- A `vote` seed produces an event with:
  - `kind === 'vote'`
  - `payload.target === 'facet'`
  - `payload.entity_kind`, `entity_id`, `facet`, `participant`,
    `choice`, `voted_at` populated per the type.
  - `actor === vote.participant` (the voting participant is the
    actor; mirrors the wire posture where votes are participant-actor
    events).
- A `commit` seed produces an event with:
  - `kind === 'commit'`
  - `payload.target === 'facet'`
  - `payload.entity_kind`, `entity_id`, `facet`, `committed_by`,
    `committed_at` populated per the type.
  - `actor === commit.committedBy ?? <moderator UUID>`.

### 3. Full-chain Playwright scenario

The unskipped `test()` in `tests/e2e/moderator-capture.spec.ts`
covers the eight numbered steps in the Constraints section. In
particular:

- After step 3 (shape-facet round seed), the rebut affordance
  `getByTestId('rebut-edge-pre-commit-affordance-<id>')` is visible;
  the generic affordance `getByTestId('edge-card-substance-affordance-<id>')`
  is NOT mounted.
- After step 5 (real click on the agreed button), the substance facet
  status attribute on the edge label flips to `'proposed'` within
  5 seconds (the propose round-trip latency budget).
- After step 7 (substance-facet round seed), the substance facet
  status attribute is `'agreed'`; the rebut affordance has
  unmounted (the gate flipped `false`); Y's substance facet is
  `'proposed'` (unchanged by this chain — pins the
  predecessor's §D5 invariant).

### 4. Vitest cover for the helper extension (per ADR 0022)

`tests/e2e/fixtures/wsStoreSeed.test.ts` (new file — the existing
helper has no Vitest cover today, so the task adds one). Minimum
3 cases:

1. `seedWsStore` with `nodes` only behaves byte-identically to the
   pre-task version (regression pin).
2. `seedWsStore` with `proposals + votes + commits` produces events
   in the canonical order and increments `sequence` per event.
3. The three new payload shapes match the Zod schemas (parses
   round-trip through `votePayloadSchema` / `commitPayloadSchema` /
   `proposalEnvelopePayloadSchema` succeed).

Decision §D8 records the rationale for adding helper-level Vitest
cover (the helper grew non-trivial; a parses-against-schema sanity
pin keeps drift small).

### 5. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `playwright_f6_substance_precommit_full_chain`
  block gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/playwright_f6_substance_precommit_full_chain.md"`
  line.
- `tasks/99-milestones.tji`: if this closes the F6 / defeater-flow
  milestone (no further leaves remain pending after this task
  closes), the Closer adds `complete 100` to the milestone per the
  README ritual.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

### 6. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### D1. Plug into `window.__aConversaWsStore`, not the server

The helper continues `seedWsStore`'s established posture: synthetic
events go directly into the moderator's Zustand store via
`applyEvent` on `window.__aConversaWsStore`, bypassing the WS
client + the server. The same dev-only attachment seam at
[`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx)
is the load-bearing dependency.

Considered alternatives:

- **(a) Drive everything through the real server.** A full-chain
  spec could spawn two participant tablets (per
  [`methodology-full-flow.spec.ts` L1052](../../../tests/e2e/methodology-full-flow.spec.ts#L1052))
  and drive real votes through their UIs. *Rejected* — the goal
  here is to pin the moderator-UI wire path for the new
  affordance, not to re-cover the participant-vote UI. Spawning
  participant tablets multiplies the runtime cost by ~3x and
  adds participant-side UI to the failure surface for a defect
  the participant-side spec already covers.
- **(b) Hit a server endpoint that synthesizes the event sequence.**
  *Rejected* — no such endpoint exists, and inventing one for
  test-only use is a wider design change than this task scopes.
- **(c) Inject events via `applyEvent` on `window.__aConversaWsStore`.**
  **Chosen.** Inherits the established posture, costs nothing, and
  pins exactly the slice the predecessor's wire-level pin needed.

### D2. Extend `seedWsStore`, don't ship a sibling helper

Considered alternatives:

- **(a) New sibling helper `seedFacetRound(page, options)`** that
  synthesizes proposal + votes + commit for a single facet, mirroring
  the `seedParticipants` sibling-helper precedent
  ([wsStoreSeed.ts L280](../../../tests/e2e/fixtures/wsStoreSeed.ts#L280)).
  *Rejected.* The sibling pattern fits a separate domain
  (participant lifecycle vs. session events); the facet-round events
  ARE session events and belong in `seedWsStore`. Splitting them off
  would force callers to coordinate two helpers' `sequence`
  accumulators, which is exactly what the existing `seedWsStore` /
  `seedParticipants` split already does — and that split is paying
  for itself only because the two helpers exist for orthogonal
  reasons (lifecycle vs. graph). A facet round is graph content.
- **(b) Three sibling helpers — `seedProposal`, `seedFacetVotes`,
  `seedFacetCommit`.** *Rejected.* Same coordination cost as (a),
  multiplied by three.
- **(c) Extend `seedWsStore` with three new arrays.** **Chosen.**
  Mirrors the existing arrays (`nodes`, `edges`, `annotations`);
  one helper still owns the `sequence` accumulator; the test body
  composes through array shapes, which scales to other future
  facet-round e2e specs without inventing new helpers.

### D3. Loop order: nodes → annotations → edges → proposals → votes → commits

The order matters because the projection cares about it: a facet
proposal references an entity that must already exist in projection;
votes reference a proposal that must already exist; a commit
references the votes' candidate.

Considered alternatives:

- **(a) Maintain insertion order across all six arrays via a single
  flattened `events` array.** *Rejected.* The caller would have to
  build event-shaped objects directly (defeating the typed-shape
  benefit of `SeedNode` / `SeedEdge` / etc.), or the helper would
  have to introspect each item's type to dispatch. The fixed
  loop-order encoded in the helper is the simpler abstraction for
  the call patterns this task and likely successors need (a facet
  round is always "proposal then votes then commit").
- **(b) Loop order nodes → edges → annotations → proposals → votes →
  commits.** *Rejected.* Annotations may be edge endpoints (per
  the existing `sourceKind: 'annotation'` / `targetKind: 'annotation'`
  arms at
  [wsStoreSeed.ts L72–82](../../../tests/e2e/fixtures/wsStoreSeed.ts#L72));
  edges that reference annotations need the annotations to exist
  first.
- **(c) Loop order nodes → annotations → edges → proposals → votes
  → commits.** **Chosen.** Honors the entity-creation ordering
  invariant and the facet-round ordering invariant in one pass.

### D4. Synthetic votes synthesize a "natural" voter set (one moderator + two debaters)

The seed helper uses the convention that the moderator (`0000…00aa`)
plus two debaters (`0000…00bb`, `0000…00cc`) constitute the session's
voting participants. The shape-facet and substance-facet rounds each
need ALL non-moderator participants to vote `'agree'` to reach the
`'agreed'` projection state (rule 7 of `facet-status.ts`); a moderator
commit then advances to `'committed'`.

The Playwright test body declares the three UUIDs as constants and
passes them through the `participant` field of each `SeedFacetVote`.
The helper itself is participant-set-agnostic — it just emits whatever
votes the caller supplies. (This keeps the helper general; the test
body owns the methodology semantics.)

Considered alternative: bake a default 3-participant set into the
helper (e.g., a `defaultVoters: true` flag). *Rejected* — the helper
should stay primitive; methodology-shaped defaults belong in the
test body.

### D5. The test body seeds F6 step 3's structural shell rather than driving it through real UI

The predecessor spec block (the
`mod_defeater_node_creation`-shipped test) already drives F6 step 3
via real UI. This spec's job is the step-4 chain; re-driving step 3
in the same body would multiply the failure surface and lengthen the
test runtime by ~5–10 seconds with no incremental coverage.

Considered alternatives:

- **(a) Drive F6 step 3 via real UI**, then drive step 4 via real UI.
  *Rejected* — re-covers step 3 unnecessarily.
- **(b) Seed both step 3 and step 4 (no real UI gestures at all).**
  *Rejected* — the predecessor §D1 explicitly scoped the test as
  pinning the wire path for the new affordance, which requires at
  least one real UI gesture (the affordance click).
- **(c) Seed F6 step 3's shell + the shape round; drive step 4 via
  real UI; seed the substance round.** **Chosen.** Pins the
  affordance click as the one real UI gesture under test, with the
  surrounding facet rounds synthesized for determinism + speed.

### D6. Pin only the methodology-default path (`'agreed'`); leave disputed to the unit-level pin

The Playwright test exercises only the `'agreed'` button click and
its substance-facet-round end state. The disputed button's wire path
is pinned at the unit level
([`RebutEdgePreCommitAffordance.test.tsx`](../../../apps/moderator/src/graph/RebutEdgePreCommitAffordance.test.tsx)
case 3 from the predecessor refinement).

Considered alternative: a second `test()` body covering the disputed
path. *Rejected* — Playwright runtime cost (login + session + seed +
real-UI gestures) for a wire-path pin that's already covered at the
unit level is not justified. The methodology-default path is the
behavior the F6 flow's promise rides on; the disputed button is
a regression-only surface.

### D7. No new ADR

Five potential triggers, all dispatched:

- **"Extending `seedWsStore` with facet-round arms is ADR-worthy."**
  No — the helper is test infrastructure; the shape extension is
  a localized choice with no cross-cutting impact. The seam stays
  on the same dev-only `window.__aConversaWsStore` attachment ADR 0008
  already covers.
- **"Synthesizing votes + commits client-side bypasses the
  server's authoritative pipeline."** No — the predecessor helper
  already bypasses the server for `node-created` / `edge-created`;
  the same argument applies to facet rounds. The server-side
  pipeline is pinned by Cucumber
  ([`defeater-capture.feature`](../../../tests/behavior/methodology/defeater-capture.feature))
  and Vitest
  ([`proposeDefeaterPreCommit.test.ts`](../../../apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts));
  this task pins the UI-side path.
- **"The test runs against the moderator alone (no participant
  tablets) — ADR-worthy?"** No — single-actor e2e is the default
  posture for the moderator suite; cross-actor coverage is the
  job of `mod_pw_full_session_run` (WBS L823) and
  `methodology-full-flow.spec.ts`. Decision §D1 alt (a) covers the
  rationale.
- **"The convention of moderator + two debater UUIDs is
  ADR-worthy."** No — it's a test-body convention, not an
  architectural choice. The actual session-participant model is
  pinned by ADR 0030 and the `participant-joined` event schema.
- **"Loop ordering in `seedWsStore` is ADR-worthy."** No — Decision
  §D3 records the rationale at the refinement level, which is the
  appropriate granularity.

### D8. Add a small Vitest cover for the helper

The pre-task helper has no Vitest cover; this task adds three cases
(per Acceptance §4) because the helper just grew from 3 event-kinds
to 6, and the per-payload Zod-parse round-trip is the cheapest
guard against future drift. The cases live in a new sibling test
file (`wsStoreSeed.test.ts`) so they run under `pnpm run test:smoke`
without contaminating the Playwright runtime.

Considered alternative: rely on the e2e spec itself as the only
cover (no Vitest). *Rejected* — when the e2e fails it's hard to tell
whether the helper produced wrong shapes or the projection / UI is
off; a payload-shape Vitest pin localizes regressions.

### D9. Fold the baseline-gate scenario into the full-chain scenario rather than keeping both

The predecessor's baseline scenario (assert affordance does NOT
mount when shape facet isn't settled) is testable as the
pre-shape-round assertion in the full-chain test body. Keeping
both as separate tests would duplicate ~25 lines of setup
(login + session + seed structural shell) for one extra assertion
pair.

Considered alternative: keep both. *Rejected* on the
duplication-vs-value trade. The gate behavior is also pinned at
the unit level (`StatementEdge.test.tsx` case 7 from the
predecessor — non-rebut role regression pin); the e2e baseline
adds little above the unit pin.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- Extended `tests/e2e/fixtures/wsStoreSeed.ts` with three new exported types (`SeedProposal`, `SeedFacetVote`, `SeedFacetCommit`), three new optional arrays on `SeedSessionOptions`, and three new `applyEvent` loops in canonical order (`nodes → annotations → edges → proposals → votes → commits`).
- Unskipped and rewrote the F6 step-4 test body in `tests/e2e/moderator-capture.spec.ts` (L2335–): full chain seeds structural shell + shape-facet round, asserts `<RebutEdgePreCommitAffordance>` mounts, clicks "Pre-commit as agreed" for a real wire gesture, seeds substance-facet round, asserts end state (`substance='agreed'`, affordance unmounted, Y substance='proposed'). Baseline-gate assertions folded into the full-chain body per D9.
- Added `tests/smoke/wsStoreSeed.test.ts` (new): 6 Vitest cases covering backwards-compatibility of pre-task arms, canonical loop order for facet-round arms, and Zod parse round-trips for all three new payload shapes.
- Two pragmatic deviations from the refinement's literal example (no new WBS tasks needed): (a) substance-status assertions use `data-facet-status` on `graph-edge-label-${id}` (the production seam) rather than the non-existent `[data-substance-facet-status]` selector; (b) post-click round seed also includes the `set-edge-substance` proposal (mirroring the click's intent) since `seedWsStore`'s client-only posture means the server rejects the propose — end state is `'committed'` per Rule 6 of `computeFacetStatuses`.
- Reused `GATE_DEBATER_A_USER_ID` / `GATE_DEBATER_B_USER_ID` participants (already seeded by `seedInviteParticipantsForGate`) rather than minting fresh debater UUIDs.
- ESLint fix applied by fixer sub-agent: removed `async` from fake `page.evaluate` stub in `tests/smoke/wsStoreSeed.test.ts`, replacing with `Promise.resolve(fn(args))` to satisfy `@typescript-eslint/require-await`.
- All four verification gates passed (check / vitest / cucumber / playwright) per driver chain.
