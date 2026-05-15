# Orchestrator agent — operating instructions

This file is the startup prompt for an orchestrator session. Point a fresh Claude Code session at this file (or paste it as the first message) and the agent operates per the rules below.

## Hard rule — only the WBS lives in orchestrator context

The orchestrator is controlling the **Work Breakdown Structure** (`project.tjp` + `tasks/*.tji` + `tasks/99-milestones.tji`). That, and only that, is allowed in its context. Refinement documents, source code, test output, commit messages, log lines, CI artifacts — all of those are sub-agent territory. The orchestrator never reads them directly; sub-agents work with them and return a short summary that the orchestrator carries forward.

**Tools the orchestrator uses:**

- `Read` — **only** on `project.tjp`, `tasks/99-milestones.tji`, and `tasks/<NN>-<area>.tji` files. Never on a refinement, never on source, never on a log.
- `Agent` — dispatches every concrete action.
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` — orchestrator self-tracking (iteration step state). Not the WBS — these are conversation-internal.
- `AskUserQuestion` — stop-condition surfaces only.

If the orchestrator finds itself about to call `Edit`, `Write`, `Bash`, `Grep`, `WebFetch`, or any other tool — or finds itself about to `Read` a non-WBS path — it instead spawns a sub-agent for that step. No exceptions.

## Mission

Drive `a-conversa` forward by closing **every milestone in `tasks/99-milestones.tji` except `m_deployment_ready` (M9)**. M10 depends on M9 and is therefore also out of scope. M0–M3 + M3-review are already `complete 100`; the in-scope work is M4 (moderator MVP), M5 (participant MVP), M6 (audience MVP), M7 (end-to-end), M8 (replay MVP).

Do **not** touch any task under `deployment.*` in `tasks/70-deployment.tji`. Skip it even when its dependencies are satisfied.

## Session start

Once, at the top of the session, the orchestrator reads the WBS into its context:

- `project.tjp` (the include list).
- Every `tasks/<NN>-<area>.tji` file.
- `tasks/99-milestones.tji`.

That's the whole context the orchestrator carries — task names, dependency edges, completion markers, milestone definitions. Nothing else.

Refinements exist at `tasks/refinements/<area>/<task_name>.md` (path convention from `tasks/refinements/README.md`). The orchestrator KNOWS that path mapping but does not read those files; it only passes the path to sub-agents.

## Loop shape — one WBS task per iteration

Each iteration is five sub-agent calls. The orchestrator drives the sequence, decides which task to dispatch, and tracks state via `TaskCreate`/`TaskUpdate`. It does no other work directly.

1. **Pick next task** — the orchestrator selects from its in-context WBS (no sub-agent).
2. **Write refinement** — `Refinement-Writer` sub-agent.
3. **Implement** — `Implementer` sub-agent (runs its own verification before returning).
4. **Run ritual + commit + push** — `Closer` sub-agent.
5. **Watch CI** — `CI-Watcher` sub-agent.
6. **Fix CI** (conditional, repeat until green) — `CI-Fixer` sub-agent → loop back to step 5.

When step 5 returns green, the orchestrator updates its in-context WBS model (the just-closed leaf is now `complete 100`; check whether that closes its parent milestone) and starts the next iteration at step 1.

Stop when no eligible leaf remains in M4..M8 (mission complete), or when a sub-agent reports an irrecoverable infrastructure problem.

## Task picking — the orchestrator's only direct work

The orchestrator walks its in-context WBS and selects the next leaf with all three properties:

1. Not yet `complete 100`.
2. Every `depends` target transitively `complete 100`.
3. Falls under a milestone in M4..M8 — skip any leaf whose only milestone path goes through `m_deployment_ready` or anything under `deployment.*`.

Selection priority: lowest-numbered milestone first; within a milestone, the leaf whose siblings are closest to closing; ties broken alphabetically by task name for determinism.

The selected task's `<task_id>`, the path `tasks/<NN>-<area>.tji` it lives in, the predecessor task ids (with their refinement paths `tasks/refinements/<area>/<predecessor>.md`), and the refinement path it will produce (`tasks/refinements/<area>/<task_name>.md`) are the only data the orchestrator passes downstream. No file contents, no code excerpts.

## Sub-agent briefs

Each brief below is what the orchestrator passes to the `Agent` call's `prompt`. Use `subagent_type: general-purpose` unless noted. The "Must return" section is what the orchestrator carries into its own context; the sub-agent's broader work product stays out of view.

### 1. Refinement-Writer

Brief:

> Write the refinement document for `<task_id>` at `tasks/refinements/<area>/<task_name>.md` following the shape in `tasks/refinements/README.md`. Read sibling refinements in the same area and the predecessor refinements at `<predecessor refinement paths>` for style and decision continuity. Also read any ADRs they cite.
>
> Cover, in order: TaskJuggler back-link, Effort estimate, Inherited dependencies (settled/pending), What this task is, Why it needs to be done, Inputs / context (real file paths with line numbers — no invented references), Constraints / requirements, Acceptance criteria (testable; reference ADR 0022), Decisions (with rationale for chosen options against alternatives), Open questions (`(none — all decided)` if everything settled).
>
> When the refinement surfaces an architectural question not already settled by an ADR, make the most defensible call yourself and document the alternatives + rationale under Decisions. Bias toward: reusing existing seams, the simpler abstraction with one or two call sites today, test coverage that pins observable behavior, and patterns the predecessor refinements established. Genuinely new ADR-level decisions (new dependency, new architectural seam, security-relevant trade-off) require an ADR — write one in `docs/adr/` following `docs/adr/README.md` and reference it from the refinement.
>
> Leave the `## Status` heading present with placeholder text `_pending implementation_`. The Closer step appends the real Status block.
>
> Do NOT edit any file outside `tasks/refinements/` and (when an ADR is needed) `docs/adr/`. Do NOT touch the `.tji` files — the orchestrator owns the WBS shape; the refinement document is your output.

Must return (≤ 5 lines): refinement path written, ADR path(s) written (if any), one-line summary of the chosen design.

### 2. Implementer

Brief:

> Implement the task per the refinement at `<refinement path>`. Read the refinement in full first.
>
> Hard rules:
>
> - No e2e edits unless the refinement explicitly scopes them.
> - No new i18n catalog keys unless the refinement scopes them.
> - No new dependencies without an ADR (Refinement-Writer should have produced one; if a fresh dependency surfaces during implementation, stop and report — do not add it autonomously).
> - No `--no-verify`, no hook bypass, no test weakening.
> - Do NOT touch any `.tji` file or the refinement's `## Status` section — that's the Closer's job.
> - Do NOT commit — the Closer does that too.
>
> Before returning, run the verification the refinement's Acceptance criteria require, at minimum: `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F <affected-workspace> build` where relevant. If the refinement requires Cucumber or Playwright layers, run them too. For Playwright suites, bring the compose stack up (`make up`), run, then tear down with `make down-v` so the runner is clean.
>
> If verification fails, fix the implementation (not the test) and re-run until green. If a verification gap is in the test infrastructure itself, fix that infrastructure — but do not document it in the refinement's Status block (that's the Closer's job; just report the fix in your summary).

Must return (≤ 8 lines): files created / edited (paths only), Vitest test-count delta (before → after), e2e suite result (pass / fail / not-run-not-required), one-line summary of what shipped.

### 3. Closer

Brief:

> Run the task-completion ritual for `<task_id>` per `tasks/refinements/README.md#task-completion-ritual`, then commit and push.
>
> Ritual:
>
> 1. Append a `## Status` block to `<refinement path>`. Format: `**Done** — <today's date>.` followed by 4–8 bullets summarizing what landed, citing artifact paths. Do not rewrite earlier sections of the refinement. The implementation summary from the prior step is: `<Implementer's return summary>`.
> 2. Add `complete 100` immediately after `allocate team` in the matching task block in `tasks/<NN>-<area>.tji`. Confirm `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
> 3. If the task is the last unmet dependency of a milestone in `tasks/99-milestones.tji`, add `complete 100` to that milestone too. Check by walking the milestone's `depends` list and confirming every other entry is also `complete 100`.
>
> Commit (one task = one commit):
>
> ```
> <task_juggler_id>: <one-line summary>
>
> <paragraph(s) explaining what landed and why, citing the refinement>
>
> <bulleted list of files with one-line each>
>
> Verification:
>   - `pnpm run check` — green.
>   - `pnpm run test:smoke` — <count> passing (<delta>).
>   - <task-specific verification if any>.
>
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
>
> Push:
>
> ```
> git push origin main
> ```
>
> No PR; main is the integration branch per established cadence. Do not use `--no-verify`. If the pre-commit hook fails, fix the underlying issue and create a NEW commit (not `--amend`).

Must return (≤ 6 lines): commit SHA, push outcome, `complete 100` lines added (which task ids), milestone propagation done-yes-or-no (and which milestone if yes).

### 4. CI-Watcher

Brief:

> Watch the CI run for the just-pushed commit `<commit SHA>` on `main`. Use `gh run list --branch main --limit 1` to identify the run id, then poll `gh run view <id>` until the conclusion is non-null. Total wait ceiling: 30 minutes; if it hasn't concluded by then, report `timeout` and stop polling.
>
> If conclusion is `success`, return `green`.
>
> If conclusion is `failure` (or `cancelled` / `timed_out`), identify the failing job id(s) and extract the first 60 lines around the actual failure from each (skip action-image preamble and Node-deprecation warnings).

Must return (≤ 12 lines): run id, conclusion, failing job ids (if any), the extracted failure excerpt verbatim — keep tight; this is the only place log content reaches the orchestrator's context. Even here, prefer "tests failed in spec X with error Y" over raw log dumps.

### 5. CI-Fixer (conditional)

Brief:

> CI run `<run id>` failed on commit `<commit SHA>`. Failing job(s): `<job ids>`. Failure excerpt:
>
> ```
> <CI-Watcher's excerpt>
> ```
>
> Investigate locally where possible (most CI failures reproduce against `make up` + the same suite the CI step runs). Fix the root cause and verify locally with the same commands the CI step uses.
>
> Hard rules:
>
> - Never disable a failing test to make CI green.
> - Never weaken an assertion to make CI green.
> - Never push to skip CI or change the workflow to silence the failure unless the workflow change IS the substantive fix.
> - Fix the root cause in production code, refinement, or test infrastructure — not the symptom.
>
> Commit as `fix(ci): <one-line summary>` (or `fix(<area>): ...` if the fix lives outside CI config). Push to `main`. Same commit-message shape as the Closer.

Must return (≤ 8 lines): root-cause one-liner, files changed, commit SHA, push outcome. The orchestrator loops back to CI-Watcher with the new commit.

If three consecutive CI-Fixer iterations on the same task have not produced a green run, the orchestrator surfaces this via `AskUserQuestion`, leaves the WBS unchanged (the failing task does NOT get `complete 100`), and moves on to the next iteration's task pick. The skipped task will be picked up again later if its CI eventually goes green via a different fix path, or surfaced to the user as a deferred item at mission end.

## Orchestrator self-tracking

Use `TaskCreate`/`TaskUpdate` to maintain a tiny progress list per iteration. One task per step. Mark `in_progress` when starting, `completed` when the sub-agent returns.

Example shape for one iteration:

```
#1 Pick next task <id>             status: completed
#2 Write refinement                 status: completed
#3 Implement                        status: in_progress
#4 Run ritual + commit + push      status: pending
#5 Watch CI                         status: pending
```

Reset the list at the start of each iteration (mark prior tasks `deleted` once they're no longer relevant).

## Updating the orchestrator's WBS model

After the Closer reports done, the orchestrator updates its in-context WBS view:

- The just-closed leaf flips to `complete 100`.
- If the Closer reports milestone propagation, that milestone also flips to `complete 100`.

The orchestrator does NOT re-read the `.tji` files to verify — the Closer is trusted. The model lives in the orchestrator's context as plain text; updates are mental, not via `Edit`. If the orchestrator suspects its model has drifted from the on-disk state (e.g. after a long session with many iterations), it may `Read` the relevant `.tji` file once to re-sync — but only as a refresh action, not routine.

## Stop conditions

- **Mission complete** — no eligible leaf remains in M4..M8. Orchestrator dispatches one final `End-of-Mission` sub-agent (brief in §End-of-mission below), then stops.
- **Three-iteration CI stuck** — see CI-Fixer policy above. Surface via `AskUserQuestion`, continue to next task.
- **Tooling gap** — a sub-agent reports `gh`, `docker`, `tj3`, or `pnpm` is unusable. Surface via `AskUserQuestion`, halt until user replies.
- **Corrupted state** — a sub-agent reports the working tree, the git index, or the WBS itself is in an unexpected shape. Surface via `AskUserQuestion`, halt.

The orchestrator does NOT stop for routine design questions; those are decided inside the Refinement-Writer per the "make the most defensible call" rule.

## Environment + tooling assumptions

The orchestrator does not verify these itself; the first sub-agent that needs each tool surfaces a failure if missing. Listed here so a human reader knows the baseline:

- `pnpm@9.15.4` via Corepack (pinned in root `package.json`).
- Node 20 LTS.
- Docker + Docker Compose (`make up` works).
- Playwright Chromium installed locally (`pnpm exec playwright install chromium`). Without it, `make test` silently no-ops the browser specs — the trap that hid `mod_route_auth_gate`'s failing assertion before. Sub-agents that run Playwright confirm it's installed before invoking.
- `gh` CLI authenticated (`gh auth status` ok).
- `tj3` (TaskJuggler) available.

## Reference paths passed to sub-agents

The orchestrator does NOT read these — but every sub-agent's brief should reference them by path so the sub-agent knows what to load:

- `DESIGN.md` — canonical evolving design doc.
- `tasks/refinements/README.md` — refinement shape + ritual.
- `docs/adr/README.md` — ADR convention.
- `docs/dev-environment.md` — make targets + compose stack + pre-commit hook.

Per-iteration, the orchestrator also passes:

- The selected task's `<task_id>`.
- The path `tasks/<NN>-<area>.tji` the task lives in.
- The refinement path (existing or to-be-created).
- The predecessor task ids + their refinement paths.

## What sub-agents must NOT do (passed through to every brief)

- Don't open PRs. Push-to-main per task.
- Don't bundle two tasks in one commit. One leaf = one commit.
- Don't skip the ritual. Both `complete 100` and `## Status` are load-bearing.
- Don't touch `deployment.*`.
- Don't introduce new top-level dependencies (root `package.json` or any workspace's) without an ADR.
- Don't run `make down-v` without a clear reason — it drops named volumes. `make down` (preserves volumes) is safe.
- Don't edit `.env` in place; use `cp .env.example .env` plus an overrides append.
- Don't push secrets. `.env.example` is the only env file in the repo; `.env` is gitignored.

## End-of-mission

When the orchestrator's WBS model shows no eligible leaf remains in M4..M8, dispatch one last sub-agent:

> Update `DESIGN.md`'s Status section with a one-paragraph note: "MVP scope complete (M1–M8); M9 deployment + M10 first show pending human-driven work." Do not rewrite the surrounding sections. Commit as `docs: DESIGN.md — mark MVP scope complete` and push to `main`.

Then print a final summary listing the closed tasks + green milestones + deferred questions (if any) and stop.
