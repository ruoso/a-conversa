# Amend mod_propose_action refinement + code comment to correct wire-shape claim

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_propose_action_refinement_amendment` (lines 668-673).

**Effort estimate**: 0.25d (doc-hygiene + comment-block amendment; no runtime change).

**Inherited dependencies**: `moderator_ui.mod_capture_flow.mod_propose_action` (done — commit landed the runtime correctly, the Status block on the prior refinement registered the wrong-claim debt and named this follow-up as the redress path). That Status block is the only "settled" input: the canonical contracts it cites — `tasks/refinements/backend/ws_propose_message.md` line 13 and `tasks/refinements/data-and-methodology/commit_logic.md` line 13 — are the authority this amendment realigns the stale text against.

## What this task is

An **amendment pass** in the same shape as the `docs/adr/README.md:16-22` ADR-amendment rule, but applied to a refinement document and a colocated code comment. The prior `mod_propose_action` refinement asserts — in multiple places — that the server's `propose` handler emits paired `node-created` / `entity-included` / `edge-created` events alongside each `proposal` event. That claim is **wrong**. The canonical contract is: `propose` writes a single `proposal` event; the entity-creation events (`node-created` / `edge-created` / `entity-included`) fire on **commit**, not on propose. The runtime was always correct; the refinement-doc body and a `useProposeAction.ts` code comment narrate the wrong shape. This task rewrites those narrations in place so the next reader of either artifact doesn't reproduce the wrong claim.

Scope is **two files, doc-only**:

1. `tasks/refinements/moderator-ui/mod_propose_action.md` — replace every body occurrence of the paired-events claim with the correct claim (propose emits only `proposal`; entity-creation events fire on commit per `commit_logic.md`). The `## Status` block at the bottom (lines 1838-1848) already calls out the correction and registers this task — **do not touch it**; it is the historical record of how the prior task landed and per `tasks/refinements/README.md` Status sections are write-once.
2. `apps/moderator/src/layout/useProposeAction.ts` lines 347-353 — replace the comment block that claims the propose handler emits the paired events inline with one that names the actual contract.

## Why it needs to be done

Canonical contract authority. `tasks/refinements/backend/ws_propose_message.md` line 13 is the source of truth for what the `propose` handler does; `tasks/refinements/data-and-methodology/commit_logic.md` line 13 is the source of truth for when entity-creation events fire. Refinements and code comments that contradict these contracts mis-train the next reader — including future LLM sub-agents who treat the refinement as the spec — into reproducing the wrong wire-shape understanding in downstream tasks (commit flow, vote flow, snapshot flow, reconnection replay), in test expectations, and in any UI logic that derives behavior from the apparent contract. The cost of leaving the stale text in place compounds with every reader; the cost of removing it is one small commit.

The same logic underwrites the ADR amendment-pass rule (`docs/adr/README.md:16-22`): when a downstream artifact discovers that an upstream document's operational text is stale relative to canonical authority, the upstream document is amended in place. This task is the refinement-tier analogue of that pass.

## Inputs / context

**Canonical contracts (source of truth — do not edit, only cite):**

- `tasks/refinements/backend/ws_propose_message.md` line 13 — the propose handler's behavior: loads projection, allocates `MAX(sequence)+1`, builds `MethodologyAction.propose`, runs `validateAction`, INSERTs the resulting event (singular) via `appendSessionEvent`, commits, then broadcasts. **One event per `propose` envelope**; that event is of kind `proposal`.
- `tasks/refinements/data-and-methodology/commit_logic.md` line 13 — establishes that the structural commit effect (which is the moment entity-creation events fire for the entities the proposal references) runs on the read side via `replay.ts/handleCommit` after the write-side `commit` validator passes. The propose path stages the proposal; commit enacts the structural change.

**Target files to amend:**

- `tasks/refinements/moderator-ui/mod_propose_action.md` — `grep -n "node-created\|entity-included\|edge-created\|paired"` returns the full hit list. The body occurrences requiring rewrite are at approximately:
  - **Inputs / context section** — lines 41-43 (the parenthetical inside the bullet about the propose WS message wire shape claiming "the server's propose handler emits the paired `node-created` / `edge-created` / `entity-included` events alongside each proposal").
  - **Inherited dependencies section** — lines 159-162 (the `mod_target_auto_suggest` bullet describing what gets emitted for free-floating vs connecting cases) and lines 213-218 (the `entity_creation_events` bullet asserting the propose handler emits these alongside the proposal events).
  - **What this task does — step 3** — lines 310-315 (the client-side id-generation paragraph asserting the server's append path "treats client-generated ids as the canonical primary keys for the `nodes` / `edges` rows the paired `node-created` / `edge-created` events create"; reword so the temporal locus is commit, not propose).
  - **What this task does — step 8** — lines 345-352 (the explicit "the server-side propose handler emits the paired `node-created`, `entity-included`, and (optionally) `edge-created` events inline" sentence — this is the load-bearing wrong claim; rewrite the whole paragraph).
  - **Inputs / context — events.ts citation** — lines 472-478 (the `nodeCreatedPayloadSchema` / `edgeCreatedPayloadSchema` bullet asserting the server's propose handler emits these inline).
  - **Inputs / context — refinements-consulted list** — lines 549-551 (the `entity_creation_events` reference describing them as "the paired `node-created` / `edge-created` events the server emits alongside each propose envelope").
  - **Constraints / requirements — Client-side id generation** — lines 697-707 (the bullets asserting the propose handler "creates the paired `node-created` event" / "creates the paired `edge-created` event"; reword to the commit-time emission).
  - **Constraints / requirements — Wire-shape section, free-floating case** — lines 736-742 (the paragraph after the free-floating envelope JSON asserting the propose handler "emits four events on success").
  - **Constraints / requirements — Wire-shape section, connecting case** — lines 765-774 (the paragraph after the connecting envelope JSON asserting the second propose call emits `edge-created` + `entity-included` + the proposal event).
  - **Decision §1 region** — line 1260 (the reference to "paired `edge-created` payload — this is asserted at the …" inside the decisions section), line 1381-1404 (the test-shape narration claiming the bundle emits `node-created` + `entity-included` + `proposal` events — note the literal `arrayContaining(['node-created', 'entity-included', 'proposal'])` test expectation in this paragraph was pinned to the **wrong** claim and has since been corrected in the actual test file per the prior Status block; the narration here should match the corrected test), line 1479 (handler-side narration claiming it appends `node-created` + `entity-included`).
  - **Decisions / decoration paragraph at line 550** is part of the body claim and needs the same correction.

  Exact `grep -n` hit list as of this writing (the Implementer should re-run the grep to be sure none drift):

  ```
  42:  paired `node-created` / `edge-created` / `entity-included` events
  77:  (`client.trackSession(sessionId)`) is paired with the route mount.   ← unrelated "paired" usage; do NOT edit
  159:  a `null` slice means "free-floating new node — emit `node-created`
  161:  the connecting bundle — add `edge-created` + `proposal:
  172:  `useCaptureStore.edgeRole` to populate the bundled `edge-created`
  215:  — the `node-created` / `edge-created` schemas the propose
  315:   paired `node-created` / `edge-created` events create.
  347:   server-side propose handler emits the paired `node-created`,
  348:   `entity-included`, and (optionally) `edge-created` events
  374:   `node-created` (global), `entity-included` (in session),
  375:   `proposal: classify-node`, plus optionally `edge-created`,
  376:   `entity-included`, `proposal: set-edge-substance` if
  478:  paired creation events from those references).
  550:  — the paired `node-created` / `edge-created` events the server
  700:  server's propose handler creates the paired `node-created`
  706:  server's propose handler creates the paired `edge-created`
  737:  `node-created` (the new node row), `entity-included` (link to
  739:  and an implicit `entity-included` for the proposal itself (per
  766:  `edge-created` (the new edge row, referencing `targetEntityId`
  768:  + `entity-included` + `proposal: set-edge-substance` (the
  770:  `edge-created` payload is populated from the client's
  774:  paired creation event with the staged role).
  914:`trackSession` paired call inside `OperateRouteInner` paired call…   ← unrelated "paired" usage; do NOT edit
  1260:  paired `edge-created` payload — this is asserted at the
  1381:  //    seam. The free-floating bundle emits node-created +
  1382:  //    entity-included + proposal events; we check that
  1383:  //    lastAppliedSequence advances and at least one node-created
  1404:      kinds: expect.arrayContaining(['node-created', 'entity-included', 'proposal']) as string[],
  1479:  handler appends `node-created` + `entity-included` +
  1826:  ← Status block, do NOT edit
  1839:  ← Status block, do NOT edit (already records the correction)
  ```

  Lines 77 and 914 mention "paired" in an unrelated sense (the `trackSession` / `untrackSession` lifecycle pairing) — leave them alone.

  Lines 374-376 paraphrase `docs/moderator-ui.md:46` (the F1 spec text). That F1 spec text itself is **also stale** relative to the same canonical contract, but `docs/moderator-ui.md` edits are out of scope here (this task only touches files under `tasks/refinements/` per scope guard below). The refinement should either drop the quote, paraphrase it correctly, or surround it with a clarifying parenthetical that the F1 spec text predates the corrected wire shape and that on the actual wire, propose emits only `proposal` and the entity-creation events fire on commit.

- `apps/moderator/src/layout/useProposeAction.ts` — lines **347-353** (the exact range named in the WBS note). The block reads:

  ```ts
  // First envelope — `classify-node`. The server's propose handler
  // creates the paired `node-created` + `entity-included` events
  // inline; the `event-applied` broadcast lands and updates
  // `useWsStore.sessionState[sessionId].lastAppliedSequence` BEFORE
  // the matching `proposed` ack resolves the send-promise (the WS
  // client dispatches the broadcast into the store via its
  // `applyEvent` reducer; the broadcast arrives on the proposer's
  ```

  Rewrite so the description names the actual contract: propose emits a single `proposal` event; the `event-applied` broadcast that races the ack carries that proposal; entity-creation events for the referenced node / edge fire later on commit per `commit_logic.md`. Keep the rest of the comment (the ack-vs-broadcast ordering remark) intact — the temporal ordering of the ack relative to the broadcast is correct and is the load-bearing observation that justifies the surrounding code's `lastAppliedSequenceForCall()` call. Only the wire-shape part of the comment is wrong.

  **Important: the Implementer must NOT edit `useProposeAction.ts` as part of this refinement document — that file lives outside `tasks/refinements/` and is out of scope for this writer. The Implementer step does the actual edit. This refinement only describes the change.**

**Canonical sources for the corrected claim (the Implementer cites these in the rewritten text):**

- `tasks/refinements/backend/ws_propose_message.md:13` — "INSERTs the resulting event via the centralized `appendSessionEvent` helper" (singular `event`).
- `tasks/refinements/data-and-methodology/commit_logic.md:13` — boundary statement: propose validates the *intent*; commit applies the *structural effect* (which is when the entity-creation events fire).
- `apps/server/src/methodology/handlers/propose.ts` (lines around 207-217, per the prior Status block's note) — the runtime implementation, for code-level confirmation.

## Constraints / requirements

- **Doc-only.** No runtime behavior change. The implementation in `apps/moderator/src/layout/useProposeAction.ts` (apart from the named comment block) and the server-side propose handler are already correct and must not be touched.
- **Preserve all other content** of `tasks/refinements/moderator-ui/mod_propose_action.md`. Only the body occurrences of the wrong wire-shape claim get rewritten; everything else — decisions, acceptance criteria, every paragraph not naming the paired-creation-events claim — stays verbatim. The amendment is surgical, not a wholesale rewrite.
- **Do not touch the `## Status` block** (lines 1826 onward) on the prior refinement. That block is the historical record per `tasks/refinements/README.md` and the closer wrote it deliberately to flag this debt. Editing it would erase the record of why this amendment task exists.
- **Do not edit `docs/moderator-ui.md`**. The F1-spec quote at lines 374-376 of the prior refinement is paraphrasing `docs/moderator-ui.md:46`, which is itself stale, but `docs/moderator-ui.md` is out of scope for this task. The refinement-body text near lines 374-376 should be reworded to make the quote contextual rather than the binding contract (e.g., "per `docs/moderator-ui.md:46`'s F1 narration, which predates the wire-shape settlement…"); a separate doc-hygiene task can amend `docs/moderator-ui.md` itself.
- **Scope guard.** Only files under `tasks/refinements/` get edited by the Implementer for the refinement-body portion. The `useProposeAction.ts` comment-block edit is a separate file touch in the same task but is outside the refinements tree — both edits land in the same commit.
- **No new e2e, no new i18n keys, no new ADRs.** Pure doc + comment fix; the UI-stream e2e policy does not apply (no UI-surface change). The corrected e2e from the prior task is already on disk and already pins the correct contract.
- **Build + smoke remain green** per ADR 0022 — running the full test suite after the comment-block edit must not regress (the comment is non-load-bearing for execution, but the suite still gets run to confirm nothing nearby broke).

## Acceptance criteria

1. `grep -n "paired \`node-created\`\|paired \`edge-created\`\|paired \`entity-included\`" tasks/refinements/moderator-ui/mod_propose_action.md` returns **no hits** outside the `## Status` block (lines 1820+). The unrelated `paired` usages at lines 77 and 914 (the `trackSession`/`untrackSession` lifecycle pairing) remain.
2. `grep -n "creates the paired \`node-created\`\|creates the paired \`edge-created\`\|emits.*paired.*node-created\|emits.*paired.*edge-created" tasks/refinements/moderator-ui/mod_propose_action.md` returns no hits outside the `## Status` block.
3. `grep -n "paired \`node-created\`\|paired \`edge-created\`" apps/moderator/src/layout/useProposeAction.ts` returns no hits (the comment block at lines 347-353 no longer claims the wrong shape).
4. The rewritten refinement body explicitly cites `tasks/refinements/backend/ws_propose_message.md:13` and `tasks/refinements/data-and-methodology/commit_logic.md:13` as the canonical-contract sources for the corrected claim.
5. The `## Status` block on `mod_propose_action.md` (lines 1820+) is byte-identical before and after the amendment — `git diff` shows zero changes in that range.
6. Full repo lint + unit-test suite + the moderator-capture Playwright project remain green per ADR 0022 (no runtime regression from the comment-block edit).
7. The Closer appends a fresh `## Status` block to **this** refinement document recording the amendment and the commit.

## Decisions

- **D1 — Canonical contract authority.** The corrected claim defers to `tasks/refinements/backend/ws_propose_message.md:13` and `tasks/refinements/data-and-methodology/commit_logic.md:13`. Propose emits exactly one event (kind `proposal`) per envelope; the entity-creation events (`node-created`, `entity-included`, `edge-created`) fire on the commit transition, when `replay.ts/handleCommit` applies the structural effect on the read side. This is the same boundary `commit_logic.md` codifies (write-side intent validation vs read-side structural application) — the refinement-body rewrites name this boundary directly so the next reader doesn't have to reconstruct it.
- **D2 — Status block immutability.** The prior `mod_propose_action` `## Status` block stays untouched. Per `tasks/refinements/README.md:36` Status sections are the historical record of how the task landed; the closer's correction note in that block is the trail that points future readers to this amendment task. Editing it would erase the trail.
- **D3 — Scope confined to the two named files.** `docs/moderator-ui.md:46`'s F1 narration is also stale (it lists the entity-creation events as part of the "Propose" step), but amending it is out of scope here. The refinement-body text paraphrasing that quote gets contextual hedging so it doesn't propagate the stale framing; the doc itself is a separate doc-hygiene task whoever next encounters it can register.
- **D4 — Comment-block boundary.** Only lines 347-353 of `useProposeAction.ts` are amended. The rest of the file (including the ack-vs-broadcast ordering observation that continues past line 353) is correct and stays verbatim.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Amended `tasks/refinements/moderator-ui/mod_propose_action.md` — 11 distinct passages rewritten in place to drop the stale "paired `node-created` / `entity-included` / `edge-created` events alongside each `proposal`" claim and replace it with the corrected wire shape (propose emits exactly one `proposal` event per envelope; entity-creation events fire on commit via `replay.ts/handleCommit`). The prior `## Status` block (lines 1820+) is byte-identical — historical record preserved per `tasks/refinements/README.md:36`.
- Amended `apps/moderator/src/layout/useProposeAction.ts` — the 8-line comment block at lines 347-353 was replaced with a 15-line block that names the actual contract; the surrounding ack-vs-broadcast ordering observation (load-bearing for the `lastAppliedSequenceForCall()` call) stays verbatim.
- Both edits cite the canonical authority directly in-line: `tasks/refinements/backend/ws_propose_message.md:13` (propose INSERTs a single event via `appendSessionEvent`) and `tasks/refinements/data-and-methodology/commit_logic.md:13` (entity-creation events fire on the commit transition).
- Verification — `pnpm run check` green; `pnpm run test:smoke` green (2887 tests across 120 files, unchanged from baseline). No Playwright run needed — doc-only amendment with no UI-surface change. Acceptance grep silent on source file; refinement only retains the immutable Status-block hit (line 1920) plus one explicit "do NOT land on propose" line in the corrected test-shape narration (line 1455).
- No newly-deferred follow-ups; the F1-spec text at `docs/moderator-ui.md:46` remains stale but was explicitly scope-guarded out of this task per D3.
