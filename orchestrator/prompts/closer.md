# closer — sub-agent brief

You are a one-shot sub-agent spawned by the orchestrator driver. Your task:
run the task-completion ritual for **`$task_id`** per
`tasks/refinements/README.md#task-completion-ritual`, then commit locally.

**DO NOT push.** The human user batches pushes themselves.

You are a fresh top-level Claude session. You have full tool access. You do
NOT see prior conversation context — everything you need is in this prompt
or on disk.

## Additional context from orchestrator

$additional_context

## Inputs

The refinement is at **`$refinement_path`**.

The implementer's return summary (use this to seed the Status block and the
commit body):

---

$implementer_summary

---

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

### 4. Register tech-debt tasks in the WBS

If the implementer's summary or the Status block names a follow-up task
(typically deferred-e2e debt pointing at a provisional `<task_name>`, or
any other "future task X will close this"), add that task to the
appropriate `tasks/<NN>-<area>.tji` file in the same commit. Use a stable
kebab/snake_case id, give it:

- an effort estimate (`0.5d` / `1d`),
- an `allocate team` line,
- a `depends` list reflecting the real prerequisites,
- a `note` line citing the source-of-debt refinement + this commit.

Do NOT add `complete 100` (the task is deliberately open). The
orchestrator's next pick-task pass will see the new leaf and route it
through the normal loop.

Rationale: a Status-block note is invisible to the orchestrator's
task-picker. The pattern showed up first on `mod_node_handle_rendering`
(deferred from `mod_hover_details` / commit `b7ac2d5`) — recorded in
prose, missed by the WBS, almost lost. This step closes that loophole.

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

Verification:
  - `pnpm run check` — green.
  - `pnpm run test:smoke` — <count> passing (<delta>).
  - `pnpm run test:bdd` — <count> scenarios passing (<delta or "unchanged">).
  - `pnpm run test:e2e:smoke` — <count> green (<delta or "unchanged">). Compose stack: `make up` → run → `make down-v`.
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
registered tech-debt block), the milestone-file change if you propagated,
and the appended Status block in the refinement.

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
- Tech-debt tasks registered (id list) — `none` if none.
- One-line confirmation that `git push` was NOT run.

The orchestrator reads this and uses it to decide the next pick.
