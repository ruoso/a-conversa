# walkthrough_representative_log — extend the seed to a full realistic session log

## TaskJuggler entry

`landing_page.walkthrough_representative_log` in `tasks/47-landing-page.tji`.

## Effort estimate

1d. Inherited dependencies: `landing_e2e` (shipped — the spec now derives
every position from the app's narration table, which is what makes this
fixture edit non-reddening); the `per_facet_step_pill` graph-view work
(the per-node pill that renders the facet rounds this log now exercises).

## What this task is

The landing walkthrough seed (`apps/root/src/walkthrough/walkthrough-events.json`,
the canonical copy symlinked into `@a-conversa/test-fixtures`) encoded a
happy-path subset of the `docs/example-walkthrough.md` debate: 10 of 17
event kinds, 7 of 12 proposal sub-kinds, and exclusively proposal-keyed
votes/commits (the pre-ADR-0030 wire shape). This task extends it into a
full, realistic session log — every event kind a real broadcast debate
would produce, woven into the existing zoo-debate story — so the demo is
representative and the fixture exercises the modern wire shapes
everywhere they're consumed (server replay, projection behavior suites,
the landing renderer).

## Why it needs to be done

User direction (2026-06-10): "the event log needs to include every event
kind that would happen in a real debate." Downstream, the dialogue-chat
(`walkthrough_dialogue_chat`) and visible-step (`walkthrough_visible_steps`)
tasks anchor to events in this log; the richer the log, the more the demo
shows. The fixture is also the projection suites' canonical integration
input, so coverage here is test coverage there.

## Inputs / context

- `docs/example-walkthrough.md` — the 22-turn story every insert is
  grounded in (turn references below).
- ADR 0030 (facet-keyed votes/commits/marks; capture-node; withdraw-agreement),
  ADR 0037 (proposal-withdrawn terminator), ADR 0038 (annotation
  substance disputable post-commit).
- Projection gap fixes that shipped immediately before this task:
  shell `computeFacetStatuses` consumes `proposal-withdrawn`; graph-view
  applies committed rewords and paints `withdrawn`.

## Constraints / requirements

1. Story-faithful: every insert lands where the doc's narrative motivates
   it; deviations are deliberate and recorded (see Decisions).
2. No test may pin positions or counts that this (or a future) fixture
   edit invalidates — assertions derive from the stream (event-id
   anchors, snapshot-relative positions, structural invariants).
3. The canonical copy stays `apps/root/src/walkthrough/walkthrough-events.json`;
   the server vendored module regenerates via
   `pnpm -F @a-conversa/server gen:walkthrough-data`.
4. Every event passes `validateEvent` (the index.test sweep + the loader
   suite are the gate).
5. Inserted envelope ids use the batch-block scheme
   `ee000000-0000-4000-8000-0000XXXXNNNN` (one block per story insertion;
   block 0007 was taken by the wording votes) — stable under
   resequencing, collision-free with the original positional ids.

## Acceptance criteria

- The log contains: session-mode-changed, session-ended, capture-node,
  edit-wording (reword) + facet-keyed wording commit, meta-move,
  proposal-withdrawn, withdraw-agreement, meta-disagreement-marked
  (facet arm), a `note` annotation, a `defines` edge, a `value`
  classification, and facet-keyed votes/commits for every facet-valued
  proposal. (Skipped, story doesn't motivate: participant-left,
  entity-removed, break-edge, amend-node.)
- Full unit sweep + behavior (Cucumber) suite green; vendored module
  regenerated; narration anchors resolve onto visible events.

## Decisions

- **D1 — story insertion map** (all turn references to
  `docs/example-walkthrough.md`): lobby→operate `session-mode-changed`
  after the three joins; E16 `defines` edge (N1 defines N2) with its
  substance round in the turn-5/7 cluster; Ben's `withdraw-agreement` on
  E3's substance as he opens the captivity leg (turn 8); N12's classify
  round becomes normative → Ben disputes → `proposal-withdrawn` →
  re-proposed `value` → facet-keyed commit (turns 13–15); the doc's
  turn-17 "shared axiom" audience note becomes annotation A4 (`note`) on
  N12; N15 is created with Anna's spoken wording ("almost always…") and
  Maria rewords it to the platform form ("in nearly all cases…") after
  her turn-18 operationalization question — `edit-wording`/`reword` +
  facet wording votes + facet-keyed wording commit; N18 arrives through
  the canonical `capture-node` gesture (turn 19); A2's proposal becomes
  the `meta-move` the doc literally names (turn 17) and Ben's turn-21
  contest becomes the ADR 0038 facet-keyed dispute on A2's substance;
  E15's substance round deadlocks (Ben agree / Anna dispute) and Maria
  records the facet-keyed `meta-disagreement-marked` (turn 22's "live
  disagreement"); `session-ended` closes the log after the snapshot.
- **D2 — facet-arm migration**: votes/commits referencing the four
  facet-valued proposal sub-kinds (classify-node, set-node-substance,
  set-edge-substance, edit-wording) migrate to the facet-keyed arms —
  the shape today's server emits. Structural proposals stay
  proposal-keyed. Moderator votes stay in the log (the doc's turn-1
  monologue has Maria agreeing on every facet; the facet-status
  derivation ignores moderator votes either way).
- **D3 — deliberate deviations from the doc**: N12 commits as `value`
  (doc says `normative`) — chosen to land the missing `value` vocabulary
  in a committed state at the single most apt node; the E16 defines edge
  and the E3 withdrawal are extensions the doc doesn't narrate (the
  defines relation is implicit in N1 being definitional; the withdrawal
  dramatizes a real mechanic at a story-plausible moment). E3 stays
  `withdrawn` for the remainder of the demo.
- **D4 — beat re-anchoring**: `opening` re-anchors to the first
  `node-created` (was an `entity-included`, which renders nothing) and
  `finale` to `session-ended` — every narration beat now lands on a
  visible event, which `walkthrough_visible_steps` requires.
  `DEFAULT_INITIAL_POSITION` derives from the first beat instead of a
  literal.
- **D5 — known cosmetic artifact**: for the ~2 steps between the reword
  proposal and its fresh votes, the pill shows the prior candidate's
  checkmarks (`projectVotesByFacet` doesn't clear per-facet votes on
  supersession). Accepted; not fixed here.
- **D6 — one-off transformation, no committed generator**: the edit was
  performed by a reviewed one-off script; the JSON output is canonical.
  The durable guards are the `validateEvent` sweeps, the loader's
  sequence-contiguity assertion, the behavior-suite replay, and the
  narration anchor resolution (ADR 0022 posture).

## Open questions

(none — all decided)

## Status

**Done** (2026-06-10). Log extended 268 → 301 events; behavior features
(`at-position`, `walkthrough-replay`) updated to derived/extended
assertions (sessionState "ended", 18 edges, 4 annotations, E3 withdrawn,
E15 meta-disagreement, E16/A4 coverage); fixture `meta.json` rewritten;
server vendored module regenerated.
