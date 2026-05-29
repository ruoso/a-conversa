# mod_decompose_commit_handler_todo_cleanup

TaskJuggler entry: [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji), task `mod_decompose_commit_handler_todo_cleanup` (under `moderator_ui.mod_graph_rendering`).

## Effort estimate

0.25 day. Docs-only — strip two stale block-comments and replace with a one-line clarifying note on each of the two commit-arms in `apps/server/src/projection/replay.ts`. No production-behavior change, no schema change, no test-shape change.

## Inherited dependencies

**Settled (predecessor refinements / ADRs):**

- [`mod_decompose_propose_time_canvas_visibility`](mod_decompose_propose_time_canvas_visibility.md) — landed the per-component propose-time fan-out for `decompose` and `interpretive-split` (`N × (node-created + entity-included)` per propose envelope), the matching lockstep withdraw arms (`entitiesToRetractForWithdraw` walks `components` / `readings`), and the moderator's per-component `'proposed'`-state styling. Its D7 explicitly surfaced this follow-up: with components now on the projection at commit-time, the commit-arm's responsibility narrows to "flip the parent off" — exactly what the existing arm already does — and the two TODO block-comments become informational debt.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md), Decision §1 + §2. §1 pins propose-time emission of structural events for `decompose` (N components) + `interpretive-split` (N readings). §2 pins that commit becomes a pure facet-state transition: the commit handler does NOT re-emit structural events for entities that were created at propose-time.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every observable behavior that the task claims is "still correct" must be pinned by a committed test. For this task the pin is *the predecessor task's already-landed Vitest + Playwright surfaces*, not a new one (the comment change is invisible at the behavior layer).

**Pending:** (none — the predecessor task is `complete 100` in `tasks/30-moderator-ui.tji`'s preceding block; ADRs 0027 and 0022 are Accepted.)

## What this task is

The commit-side dispatcher in `apps/server/src/projection/replay.ts` carries two TODO block-comments — `TODO(decomposition_logic)` at L1204–1211 and `TODO(interpretive_split_logic)` at L1226–1229 — both claiming that "the methodology engine creates the component nodes / readings when the proposal commits". That claim was true under the pre-ADR-0027 design where the commit handler emitted the structural events. It is no longer true: per ADR 0027 §1 and [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) (post-`mod_decompose_propose_time_canvas_visibility`), each `decompose` / `interpretive-split` propose envelope fans out one `node-created` + one `entity-included` per component / reading. By the time `handleCommit` runs the `'decompose'` / `'interpretive-split'` arm, the component nodes are already on the projection; the commit arm's only structural job is to flip the parent's visibility off (which both arms already do via `projection.setNodeVisible(parent_node_id, false)` followed by the `visibility-changed` change-set entry).

The task removes both TODO block-comments and replaces each with a one-line clarifying note that:

- Names ADR 0027 as the rule (commit is a pure facet-state transition; structural-event emission happens at propose-time).
- States the commit-arm's narrow structural responsibility (parent visibility flip; component nodes minted at propose-time, not here).

No code change beyond the two comment blocks. No schema change. No test change. No ADR.

## Why it needs to be done

- **Removes a misleading marker.** The TODO comments are read by anyone auditing `replay.ts` for "what does commit still owe?" — and answer it wrong. A reader following the TODO would look for missing component-node-creation logic and either re-add a duplicate emission (double-mint bug) or chase a phantom gap. The faster the misleading comment goes away after ADR 0027 lands, the less drift accumulates.
- **Closes the explicit follow-up flagged in `mod_decompose_propose_time_canvas_visibility` D7.** That refinement deferred the comment-removal to "a cleanup pass (out of scope for this task per the surgical-change principle, but flagged as a follow-up)". This is that pass.
- **Pays the registered-debt cost cheaply.** 0.25 day, docs-only, no test churn — the kind of task that costs more in WBS overhead the longer it sits than it costs to land.

## Inputs / context

- [`apps/server/src/projection/replay.ts:1203-1223`](../../../apps/server/src/projection/replay.ts) — the `case 'decompose':` arm of `handleCommit`'s sub-kind switch. Lines 1204–1211 hold the `TODO(decomposition_logic)` block-comment claiming "the methodology engine creates the component nodes (each with its own `node-created` and initial classification) when the decompose proposal commits". The remaining lines 1212–1223 are the parent-visibility flip + `visibility-changed` change-set push.
- [`apps/server/src/projection/replay.ts:1225-1244`](../../../apps/server/src/projection/replay.ts) — the `case 'interpretive-split':` arm. Lines 1226–1229 hold the `TODO(interpretive_split_logic)` block-comment claiming "downstream methodology engine semantics. For M1 the structural effect is the same as decompose — parent becomes invisible; readings are added via their own `node-created` events." The remaining lines 1230–1243 are the parent-visibility flip + change-set push.
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts) — the propose handler whose `decompose` + `interpretive-split` arms already emit `N × (node-created + entity-included)` at propose-time per ADR 0027 §1 (the source-of-truth contract that makes the TODOs stale). Per the predecessor refinement's D3 each component takes 2 sequence slots `[node-created, entity-included]` in proposal-payload array order.
- [`docs/adr/0027-entity-and-facet-layers-strict-separation.md`](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) Decision §1 + §2 — the architectural rule the new one-line comments cite.
- [`tasks/refinements/moderator-ui/mod_decompose_propose_time_canvas_visibility.md`](mod_decompose_propose_time_canvas_visibility.md) D7 (and its Status block) — the source-of-debt note explicitly registering this task and naming the TODO at the (now-shifted) line numbers it originally pointed at.
- [`apps/server/src/projection/replay.test.ts`](../../../apps/server/src/projection/replay.test.ts) — the Vitest pinning the commit-arms' observable behavior (parent visibility flips off; change-set carries the `visibility-changed` entry). The behavior the comment-removal preserves is already pinned here; no new test needed.

## Constraints / requirements

1. **Two arms, two comment edits, nothing else in `replay.ts`.** The `case 'decompose':` arm body (lines 1212–1223) and the `case 'interpretive-split':` arm body (lines 1230–1243) remain byte-identical apart from the leading comment block. No re-flow, no helper extraction, no error-message edits.
2. **Replacement comment is a single short line per arm**, naming ADR 0027 and stating "commit-arm intentionally does NOT mint components / readings — they entered at propose-time per ADR 0027 §1 + §2". Two lines max if the line-length budget forces a wrap. Avoid restating the propose-handler implementation; the ADR reference is the canonical pointer.
3. **No behavioral change.** `pnpm -F @a-conversa/server test` and `pnpm -F @a-conversa/server build` stay green with no test-file edits. The change-set produced by `handleCommit` for a `decompose` / `interpretive-split` commit envelope is byte-identical before vs after.
4. **No schema change, no migration, no ADR, no event-kind change.** Per ADR 0022 the behavior is already pinned by the predecessor task's Vitest + Playwright surfaces; no new tests are required because no new behavior is added.
5. **Cucumber + Playwright surfaces are untouched.** This is not a wire-behavior, broadcast-shape, or replay-boundary change — it's a comment-only edit on the same code-paths the predecessor task already pinned end-to-end.

## Acceptance criteria

This is a docs-only / comment-only change in `apps/server/src/projection/replay.ts`. Per ADR 0022 the behavior that survives the edit is already pinned by the predecessor refinement's committed tests; no new test surfaces are required. The acceptance check is structural:

1. **Both TODO comment blocks are gone.** A grep for `TODO(decomposition_logic)` and `TODO(interpretive_split_logic)` over `apps/server/src/projection/replay.ts` returns no matches.
2. **Both arms carry a one-line replacement comment** naming ADR 0027 and stating that the commit-arm does not mint component / reading nodes (they entered at propose-time). The replacement comment lives above `projection.setNodeVisible(proposal.parent_node_id, false);` in each arm.
3. **`pnpm -F @a-conversa/server test` green with no test-file edits.** The pre-existing `replay.test.ts` cases that exercise `decompose` + `interpretive-split` commit-arms are the regression cover; they must stay green and unchanged. (No new Vitest cases are added — the behavior is already pinned per ADR 0022; adding a "comment-content" test would itself be a throwaway verification.)
4. **`pnpm -F @a-conversa/server build` green** (TypeScript strict; no type drift from the comment removal).
5. **`pnpm run check` + `pnpm run test:smoke` green** (the pre-commit hook gate per [`docs/dev-environment.md`](../../../docs/dev-environment.md)).
6. **No Playwright surface change.** No new spec, no spec edit; the predecessor task's `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts` Scenarios 1 + 2 + 3 stay green unchanged. This task is *not* deferring an e2e — it has no user-visible surface to exercise; the canvas styling and propose/commit/withdraw flows are unchanged at the byte-of-output level.
7. **No new ADR.** ADR 0027 already governs; this task references it, it does not amend it.
8. **No new follow-up debt registered.** No future WBS task is needed (the cleanup is complete after the two comment-blocks are gone).

## Decisions

- **D1 — Replace, don't delete.** Leave a one-line comment in place of each TODO block rather than deleting the comment outright. Rationale:
  - The reader of `replay.ts` benefits from knowing *why* the commit-arm is "thin" (only a parent-visibility flip) — without an anchor pointer, the next maintainer might wonder "is something missing here?" and re-add the component-minting logic.
  - The replacement is short (one line, name ADR 0027). It's the minimum signal that says "this is by design, see the ADR for the rule".
  - **Alternative considered — delete both TODO comments outright, leave the arm bodies un-commented.** Rejected — relies on the reader having ADR 0027 already loaded in their head; a one-line pointer costs effectively nothing and saves the next maintainer a navigation step.
  - **Alternative considered — long replacement comment paraphrasing ADR 0027 §1 + §2 inline.** Rejected — paraphrase drifts away from the ADR. Reference the ADR; don't re-state it.

- **D2 — Same comment shape on both arms, not a single shared comment above both `case`s.** The `decompose` and `interpretive-split` arms are separate `case` blocks per the predecessor refinement's D5 (two arms, not a shared loop). Carry the same per-arm comment-replacement shape — one line above each arm — rather than hoisting a single comment to the dispatcher level. Rationale:
  - **Mirrors the per-sub-kind reading shape established by D5.** Each `case` block is meant to be self-contained when read top-to-bottom; a hoisted note would split the explanation away from the arm it explains.
  - **Avoids creating a "this comment applies to N arms" coupling** that would have to be amended every time a new structural sub-kind is added.
  - **Alternative considered — one shared comment above the entire structural-commit-arms cluster.** Rejected — would force a reader looking at the `interpretive-split` arm alone to scroll up to a different sub-kind's neighborhood to find the comment.

- **D3 — No new tests, per ADR 0022.** The behavior the cleanup preserves is already pinned by the predecessor refinement's surfaces (Vitest in `replay.test.ts`, Playwright in `moderator-proposed-entity-canvas-visibility.spec.ts`). Per ADR 0022 a test exists when a behavior change exists; this task has no behavior change. Adding a "comment-content" or "comment-presence" Vitest would itself be a throwaway verification — it would pin a doc string, not a behavior. Rationale:
  - **ADR 0022 forbids verifications that don't add a committed behavior pin.** A test asserting "the file contains the string `ADR 0027`" is fragile (any rewording breaks it) and pins documentation, not code.
  - **The existing `replay.test.ts` cases for `commit/decompose` and `commit/interpretive-split` parent-visibility flips are the right pin.** They were the right pin before the comment cleanup and they remain the right pin after.
  - **Alternative considered — add a Vitest assertion that the change-set length is exactly 1 (just the `visibility-changed` entry) for the commit-arm.** Rejected — that is already the contract pinned by `replay.test.ts` post-`mod_decompose_propose_time_canvas_visibility`; duplicating it under this task's name pads the test surface without adding new coverage.

- **D4 — No ADR.** This task makes no new architectural decision; it discharges an existing one. ADR 0027 is the rule the cleanup cites; ADR 0022 is the rule that makes the test-shape decision (no new tests) defensible. Rationale per the refinement-vs-ADR distinction in [`tasks/refinements/README.md`](../README.md) §"Why refinements exist alongside ADRs": ADRs capture *decisions*, refinements capture *task scope*; a comment-removal that simply implements a previously-deferred branch of an existing ADR is task scope, not a new decision.

- **D5 — Cite ADR 0027 by number in the replacement comment, not by URL or by-file-path link.** A code comment is a long-lived in-tree artifact; the stable identifier is the ADR number (a renumber would touch many files at once and is unlikely). Rationale:
  - **Numeric citation is the same convention used elsewhere in `replay.ts`** (e.g. the L682–686 ADR 0030 + `pf_facet_keyed_vote_payload` reference; the L1199 ADR 0021 reference).
  - **Alternative considered — link to the file path.** Rejected — file paths are mutable (the ADR could be re-filed); ADR numbers are by-convention stable.

- **D6 — Strip the residual `// For M1 the structural effect is "parent becomes invisible" …` continuation** in the `decompose` arm (currently L1208–1211) and the analogous `// For M1 the structural effect is the same as decompose …` continuation in the `interpretive-split` arm (L1227–1229). Rationale:
  - **"For M1" is post-M1 obsolete.** The current branch ships post-M1 code; the qualifier is a stale milestone marker. The behavior is now permanent, not an M1 stopgap.
  - **The continuation re-states what the body code already shows** (parent-visibility flip; component nodes minted by their own `node-created` events). The replacement one-liner names where the rule lives (ADR 0027); the body code is self-evident from the `setNodeVisible(false)` call.
  - **Alternative considered — keep the M1 continuation and only strip the `TODO(...)` opener.** Rejected — the continuation's "components are added by their own `node-created` events the methodology engine emits" sentence is what the *propose-time* fan-out now does (per ADR 0027 §1); leaving it under the *commit* arm would re-introduce a different version of the same misleading marker the cleanup is supposed to remove.

## Open questions

(none — all decided in D1–D6. The cleanup is structural and self-contained; no architectural alternatives remain open.)

## Status

**Done** — 2026-05-29.

- Stripped `TODO(decomposition_logic)` block-comment (L1204–1211 pre-patch) from the `case 'decompose':` arm of `handleCommit` in `apps/server/src/projection/replay.ts`.
- Stripped `TODO(interpretive_split_logic)` block-comment (L1226–1229 pre-patch) from the `case 'interpretive-split':` arm.
- Replaced each block with a single-line ADR 0027 §1+§2 citation: "Commit-arm intentionally does NOT mint component/reading nodes — they entered at propose-time per ADR 0027 §1 + §2."
- No code change beyond the two comment blocks; change-set output of `handleCommit` is byte-identical before/after.
- No test additions (comment-only change; behavior already pinned by predecessor task's `replay.test.ts` per ADR 0022 + D3).
- No new follow-up debt registered (cleanup complete per acceptance criterion 8).
