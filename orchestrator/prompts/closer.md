# closer — sub-agent brief

You are a one-shot sub-agent spawned by the orchestrator driver. Your task:
run the task-completion ritual for **`$task_id`** per
`tasks/refinements/README.md#task-completion-ritual`, then commit locally.

**DO NOT push.** The human user batches pushes themselves.

You are a fresh top-level Claude session. You have full tool access. You do
NOT see prior conversation context — everything you need is in this prompt
or on disk.

## Tests are already confirmed green by the driver

The driver ran the canonical four-step verification chain deterministically
before invoking you, and every suite passed. The exact results are listed
below under §Verification results. You do NOT need to re-run any of:

- `pnpm run check`
- `pnpm run test:smoke`
- `pnpm run test:behavior:smoke`
- `make test:e2e:compose`

Trust the block — that's what it's for. Paste those results directly into
the commit message's Verification block. If you ever feel an urge to
re-run a suite "just to be sure", don't: the wall-clock loss is real and
the driver's chain is the canonical signal.

The pre-commit hook will of course re-run the static checks
(`pnpm run check` via Husky) and `tj3` validation on the `.tji` edits —
that's how the staged-file gates work and is not duplicated effort.

## Log / shell-output handling (universal rule)

If the pre-commit hook fails or `git commit` itself complains, redirect the
output to a file (`<cmd> > /tmp/<run>.log 2>&1`) and dispatch a
`Task(subagent_type="Explore", ...)` against that path to extract the
failure surface. Same rule for `git diff --stat` or any other noisy
inspection you do while assembling the Status block.

- Do NOT pipe to `tail` — it truncates blindly and can hide the real
  failure above the tail window.
- Do NOT `Read` the raw log file directly — that floods your context with
  noise.

The Explore agent's tight report is what you act on. The headless-mode name
for the agent-spawning tool is `Task`, not `Agent`.

## Additional context from orchestrator

$additional_context

## Inputs

The refinement is at **`$refinement_path`**.

The implementer's return summary (use this to seed the Status block and the
commit body — if a fixer sub-agent also touched the change, its follow-up
summary will be appended in the same block):

---

$implementer_summary

---

## Verification results (from the driver)

The four-step chain ran deterministically against the implementer's tree
(and any subsequent fixer edits). Each row is `<step>: <PASS/FAIL>` with
the log path written under `orchestrator/logs/`. All rows are PASS by
construction — the driver would not have invoked you otherwise.

---

$test_results

---

## Gate-not-fired re-defer (do this INSTEAD of the ritual when the gate hasn't fired)

Some leaves are gated on a trigger condition that the WBS dependency graph
cannot express — a second/third caller materializing, an upstream product
decision. If the implementer's summary reports the gate **has not fired** (no
implementation was performed; the leaf is deferred), do NOT run the
completion ritual below — there is nothing to mark complete. Instead, get the
leaf out of the active milestone so the orchestrator stops re-picking it and
re-deriving the same re-defer every cycle:

1. **Move the task into the post-implementation audits group.** Cut the task
   block out of its current `tasks/<NN>-<area>.tji` file and paste it
   (verbatim, minus any `complete 100`) into the `post_implementation_audits`
   group in `tasks/95-post-implementation-audits.tji`. Its id changes to
   `post_implementation_audits.<task_name>`.
2. **Repoint or drop inbound edges.** Anything that `depends` on the old id
   (grep the `.tji`/`.tjp` tree for it — milestones often gate it directly)
   must be updated: drop the edge if it was only there to keep the leaf
   tracked (the M8-audits milestone now does that), or repoint it to the new
   id if it is a genuine prerequisite.
3. **Add a parked-why note** to the moved block: the gate that hasn't fired
   and the concrete trigger that graduates it back to a real milestone.
4. **Update the refinement's TaskJuggler back-link** to the new file/id, and
   append a `## Status` block noting the gate-check re-defer + the move (date,
   gate result) — do not mark it Done.
5. Run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent.
   The leaf is now gated only by the `M8-audits` milestone
   (`tasks/99-milestones.tji`), out of the active M0–M8 work.
6. Commit (one task = one commit) with a `<task_id>: gate not fired — parked
   under M8-audits` style summary, and report the move in your return summary.

A leaf already living under `post_implementation_audits` that the orchestrator
re-picked needs no move — confirm the gate is still unfired, re-defer in
place, and say so in the return summary.

## Ritual (in order)

### 1. Append a `## Status` block to `$refinement_path`

Format:

```
## Status

**Done** — <today's date>.

- <4–8 bullets summarizing what landed, citing artifact paths>
```

Do not rewrite earlier sections of the refinement. Use the implementer
summary above to seed the bullets, expanded with the actual file paths
from the diff (`git diff --stat` to confirm).

### 2. Mark the task complete in the WBS

Add `complete 100` immediately after `allocate team` in the matching task
block in `tasks/<NN>-<area>.tji` (the area is the first dot-segment of
`$task_id`).

### 3. Milestone propagation

If `$task_id` is the last unmet dependency of a milestone in
`tasks/99-milestones.tji`, add `complete 100` to that milestone too. Check
by walking the milestone's `depends` list and confirming every other entry
is also `complete 100`.

### 4. Register tech-debt tasks in the WBS — and wire each to a milestone

If the implementer's summary or the Status block names a follow-up task
(typically deferred-e2e debt pointing at a provisional `<task_name>`, or
any other "future task X will close this"), add that task to the
appropriate `tasks/<NN>-<area>.tji` file in the same commit. Use a stable
kebab/snake_case id, give it:

- an effort estimate (`0.5d` / `1d`),
- an `allocate team` line,
- a `depends` list reflecting the real prerequisites,
- a `note` line citing the source-of-debt refinement + this commit.

Do NOT add `complete 100` (the task is deliberately open).

**Always wire the new task to a milestone.** A registered task that no
milestone depends on is an *orphan*: invisible to `make unblocked` (which
is milestone-scoped) and silently lost. After registering the task, add
its fully-qualified id to the `depends` list of the milestone whose scope
it belongs to in `tasks/99-milestones.tji`. Pick that milestone by reading
`tasks/99-milestones.tji` and finding the one that already gates
`$task_id` (the source-of-debt task) — directly, or transitively through a
container named in its `depends`. Gate the new debt on that same milestone
(or a later one if the debt is genuinely show-/deploy-stage). If you truly
cannot find a milestone the debt belongs to, that is a signal the task may
not be real — say so in your return summary rather than leaving it
ungated.

**Self-check before committing:** run `make unblocked` and confirm the new
task id does NOT appear in the `ORPHANS` section. If it does, you have not
wired it to a milestone — fix that first.

**Never register an "audit" / "re-audit" / "revisit" / "reconsider"
successor task.** If the implementer or refinement says a decision should
be revisited later, DO NOT create a task whose deliverable is that
re-examination. Such tasks have no implementable deliverable — their "work"
is a human judgment call — so the orchestrator keeps picking them up,
failing to resolve them, and registering yet another successor: the
self-perpetuating loop that produced the `extract_pending_axiom_mark_projector`
v1–v9 chain (removed 2026-05-30). Instead, append an entry to
`tasks/parking-lot.md` (the human-review queue — see that file's header for
the entry format) in this same commit, and move on. Items the implementer or
refinement_writer flagged for human review in their return summaries go to
the same place. The same applies to any follow-up whose deliverable a human
must produce, not the agent — native-speaker translation review / sign-off,
external approvals, design decisions. Only register *WBS tasks* for concrete
*agent-implementable* work; everything that needs a human — a judgment call
or a human-only activity — goes to the parking lot, not the WBS.

Rationale: a Status-block note is invisible to the orchestrator's
task-picker. The orphan-loophole pattern showed up first on
`mod_node_handle_rendering` (deferred from `mod_hover_details` / commit
`b7ac2d5`) — recorded in prose, missed by the WBS, almost lost; the
2026-05-30 WBS audit later found dozens of real tasks gating no milestone.
The milestone-wiring step closes the orphan loophole; the
no-audit-successor rule closes the loop loophole.

WBS validation is handled by the pre-commit hook: it runs
`tj3 --silent project.tjp` whenever a `.tji`/`.tjp` is staged and fails
the commit on any `Warning:` or `Error:` line. No separate manual `tj3`
invocation in this ritual.

## Commit (one task = one commit)

Use `git commit -m "$$(cat <<'EOF' ... EOF)"` so the multi-line body
formats correctly. Commit message shape:

```
$task_id: <one-line summary>

<paragraph(s) explaining what landed and why, citing the refinement>

<bulleted list of files with one-line each>

Verification (driver-run, deterministic chain — see $test_results):
  - `pnpm run check` — green.
  - `pnpm run test:smoke` — green.
  - `pnpm run test:behavior:smoke` — green.
  - `make test:e2e:compose` — green.
  - <task-specific verification if any>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Hard rules

- **DO NOT run `git push`.** The commit stays on local `main`; the human
  user pushes in batches at their own cadence. If you call `git push`, the
  auto-mode classifier will soft-block it and your work returns blocked —
  wasting an iteration.
- DO NOT use `--no-verify`. If the pre-commit hook fails, fix the
  underlying issue and create a NEW commit (not `--amend`).
- DO NOT bundle two tasks in one commit. One leaf = one commit.
- DO NOT open PRs.
- DO NOT touch `deployment.*` tasks (even if you spot something
  registerable there — it's out of scope for this loop).
- DO NOT amend a previous commit. Always create a new one.

## Stage carefully

When staging files, prefer adding specific files by name rather than
`git add -A` or `git add .`, which can accidentally include sensitive
files (`.env`, credentials) or large binaries. The diff for one task
should be: the source/test files the implementer touched, the
`tasks/<NN>-<area>.tji` change for the `complete 100` line (and any
registered tech-debt block), the `tasks/99-milestones.tji` change (milestone
`complete 100` propagation and/or wiring a registered tech-debt task into a
milestone's `depends`), any `tasks/parking-lot.md` entry you appended, and
the appended Status block in the refinement.

## Reference paths

- `tasks/refinements/README.md` — refinement shape + task-completion
  ritual (authoritative for the ritual you're running).
- `docs/dev-environment.md` — pre-commit hook details.

## Return contract

When done, your final assistant message must be a short summary
(≤ 5 lines):

- Commit SHA.
- `complete 100` lines added (which task ids).
- Milestone propagation done-yes-or-no (and which milestone if yes).
- Tech-debt tasks registered (id list) and the milestone each was wired
  into — `none` if none. (Confirm none landed in the `ORPHANS` section of
  `make unblocked`.)
- Parking-lot entries appended to `tasks/parking-lot.md` (titles) — `none`
  if none.
- One-line confirmation that `git push` was NOT run.

The orchestrator reads this and uses it to decide the next pick.
