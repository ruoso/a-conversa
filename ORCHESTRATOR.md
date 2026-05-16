# Orchestrator agent — operating instructions

This file is the startup prompt for an orchestrator session. Point a fresh Claude Code session at this file (or paste it as the first message) and the agent operates per the rules below.

## Hard rule — the orchestrator reads only the milestones file

The orchestrator controls the **Work Breakdown Structure** (`project.tjp` + `tasks/*.tji` + `tasks/99-milestones.tji`) but reads only one of those files itself: **`tasks/99-milestones.tji`**, which gives it the milestone ids, names, `depends` lists, and explanatory notes that frame the mission. Every per-area `.tji` (leaf definitions, area-level dep graphs) and `project.tjp` itself are off-limits. Its window into "what's currently ready to pick up" is `make unblocked`, which prints, per milestone, the leaf tasks currently READY (see `scripts/unblocked.ts`). Refinement documents, source code, test output, commit messages, log lines, CI artifacts — all of those are sub-agent territory. Sub-agents read them and return short summaries the orchestrator carries forward.

**Tools the orchestrator uses:**

- `Read` — **only** on `tasks/99-milestones.tji`. Never on `project.tjp`, never on a `tasks/<NN>-<area>.tji`, never on a refinement, never on source, never on a log.
- `Bash` — **only** to run `make unblocked` (optionally with `MILESTONE=<id>` to scope to one milestone). No other shell commands.
- `Agent` — dispatches every concrete action.
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` — orchestrator self-tracking (iteration step state). Not the WBS — these are conversation-internal.
- `AskUserQuestion` — stop-condition surfaces only.

If the orchestrator finds itself about to call `Edit`, `Write`, `Grep`, `WebFetch`, any other `Bash` command, any other tool — or to `Read` any path other than `tasks/99-milestones.tji` — it instead spawns a sub-agent for that step. No exceptions.

## Mission

Drive `a-conversa` forward by closing **every in-scope milestone in `tasks/99-milestones.tji`**. Out of scope: `m_deployment_ready` (M9), `m_first_show_recorded` (M10, depends on M9), and `m_backend_review` (M3-review — still has open leaves under `backend_hardening`, but its only forward edge is into M9, so its work is out of this loop's scope). M0–M3 are `complete 100`. The in-scope milestone ids (used as `MILESTONE=<id>` arguments to `make unblocked`, in pick order) are:

- `m_manual_lobby_smoke` (M3-lobby — strictly smaller than M4/M5; pick its READY leaves first so a human can drive invite-and-lobby end-to-end as soon as possible, per its own milestone note)
- `m_moderator_mvp` (M4)
- `m_participant_mvp` (M5)
- `m_audience_mvp` (M6)
- `m_end_to_end_debate` (M7)
- `m_replay_mvp` (M8)

Do **not** touch any task under `deployment.*` in `tasks/70-deployment.tji`. Skip any READY leaf whose id begins with `deployment.` even when `make unblocked` lists it (it can appear under in-scope milestones via transitive dependency edges).

## Session start

At session start the orchestrator reads `tasks/99-milestones.tji` once. That file is small (one block per milestone with `depends` + `note`) and gives it the milestone ids, the human-readable names, the high-level dep structure, and the prose context for each milestone — enough to interpret `make unblocked` output and to route picks intelligently. Nothing else is loaded; per-task `.tji` and refinement files stay sub-agent-only. READY-leaf state is read on demand, one milestone at a time, via `make unblocked MILESTONE=<id>` during the pick step.

Refinements exist at `tasks/refinements/<area>/<task_name>.md` (path convention from `tasks/refinements/README.md`). The orchestrator KNOWS that path mapping — `<area>` is the first dot-segment of the fully-qualified task id, `<task_name>` is the last segment — but does not read refinement files; it only passes the path to sub-agents.

## Loop shape — one WBS task per iteration

Each iteration is three sub-agent calls. The orchestrator drives the sequence, decides which task to dispatch, and tracks state via `TaskCreate`/`TaskUpdate`. It does no other work directly.

1. **Pick next task** — the orchestrator runs `make unblocked MILESTONE=<id>` (no sub-agent) and picks from the READY list.
2. **Write refinement** — `Refinement-Writer` sub-agent.
3. **Implement** — `Implementer` sub-agent (runs its own verification before returning).
4. **Run ritual + commit (local only)** — `Closer` sub-agent.

When the Closer returns, the orchestrator does NOT update an in-memory WBS model. The next iteration's pick step re-runs `make unblocked` against the current on-disk state, so the freshly-closed leaf and any newly-unblocked successors are reflected automatically.

**The orchestrator does NOT push and does NOT watch CI.** The human user pushes to `origin/main` manually, in batches, and observes CI themselves. Sub-agents commit locally only. If the user reports a CI failure on a prior commit, that gets dispatched ad-hoc as a fix task — not as part of the orchestrator's loop.

Stop when no eligible leaf remains in M4..M8 (mission complete), or when a sub-agent reports an irrecoverable infrastructure problem.

## Task picking — the orchestrator's only direct work

The orchestrator walks the in-scope milestones in the pick order listed under §Mission — `m_manual_lobby_smoke` (M3-lobby) first, then M4 → M8 — and runs `make unblocked MILESTONE=<id>` against each in turn. The first milestone with a non-empty READY list is the source for this iteration's pick.

`make unblocked` already enforces the two structural eligibility properties: the listed leaves are not `complete 100` and have every predecessor `complete 100`. The orchestrator only adds the **scope filter**: skip any READY leaf whose id starts with `deployment.` (the M9 / out-of-scope rule).

**Within the READY list, use judgment to pick the leaf that generates the least amount of tech debt**, where "tech debt" means deferred assertions, missing seams that successor tasks will have to work around, or open tech-debt tasks (per the tech-debt registration policy below) that another task's e2e or refinement explicitly depends on.

Heuristics, in rough order of weight:

1. **Close existing debt before creating new debt.** If a leaf is already named as deferred-debt in another refinement's Status block — or is itself a tech-debt leaf added under the registration policy — picking it pays down debt instead of accruing it. This usually wins.
2. **Infrastructure / seam tasks before consumer tasks.** If a leaf adds a structural seam (a wire-format, a layout pass, a renderer handle) that several successor tasks would otherwise have to defer assertions against, pick it first.
3. **Composability with recent work.** Prefer a leaf whose surface composes cleanly with the most recent commit's work; this keeps reviewer + future-reader context coherent and reduces the chance of small reverts.
4. **Subgroup momentum.** All else equal, prefer a leaf in a subgroup with siblings already complete (continuity), but **don't sacrifice (1) or (2) just to close a subgroup**.
5. **Tie-breaker for genuine ties:** alphabetical by task name for determinism.

When picking, state the reasoning in one or two sentences before dispatching the Refinement-Writer — this makes the pick auditable and lets the user redirect if the intuition is off. Don't dispatch silently.

The orchestrator passes the selected task's fully-qualified `<task_id>` and the refinement path it will produce (`tasks/refinements/<area>/<task_name>.md`, derived from the task id) to the Refinement-Writer. The Refinement-Writer is responsible for locating the task's `.tji` block, predecessor list, and any other WBS context it needs — the orchestrator does not pre-extract or pass those.

## Sub-agent briefs

Each brief below is what the orchestrator passes to the `Agent` call's `prompt`. Use `subagent_type: general-purpose` unless noted. The "Must return" section is what the orchestrator carries into its own context; the sub-agent's broader work product stays out of view.

### 1. Refinement-Writer

Brief:

> Write the refinement document for `<task_id>` at `tasks/refinements/<area>/<task_name>.md` following the shape in `tasks/refinements/README.md`. First locate the task's block in the matching `tasks/<NN>-<area>.tji` file (the area is the first dot-segment of `<task_id>`) to get the effort estimate, dependency list, and any embedded notes. Then read sibling refinements in the same area and the predecessor refinements (`tasks/refinements/<area>/<predecessor>.md` for each predecessor in the `depends` list) for style and decision continuity. Also read any ADRs they cite.
>
> Cover, in order: TaskJuggler back-link, Effort estimate, Inherited dependencies (settled/pending), What this task is, Why it needs to be done, Inputs / context (real file paths with line numbers — no invented references), Constraints / requirements, Acceptance criteria (testable; reference ADR 0022), Decisions (with rationale for chosen options against alternatives), Open questions (`(none — all decided)` if everything settled).
>
> When the refinement surfaces an architectural question not already settled by an ADR, make the most defensible call yourself and document the alternatives + rationale under Decisions. Bias toward: reusing existing seams, the simpler abstraction with one or two call sites today, test coverage that pins observable behavior, and patterns the predecessor refinements established. Genuinely new ADR-level decisions (new dependency, new architectural seam, security-relevant trade-off) require an ADR — write one in `docs/adr/` following `docs/adr/README.md` and reference it from the refinement.
>
> **For UI-stream tasks** (`moderator_ui.*`, `participant_ui.*`, `audience.*`, `replay_test.*`): scope a Playwright e2e spec under Acceptance criteria by default. If the component is not yet reachable from any user flow, you may defer the e2e — but you MUST then (a) say so explicitly under Acceptance criteria, naming the unit/component coverage that stands in, and (b) identify the future WBS task(s) that will make this component reachable and that MUST inherit the deferred e2e debt. See the "UI-stream e2e policy" section of `ORCHESTRATOR.md` for the full rule. When this task IS the wiring task for a previously-deferred component, search the WBS and sibling refinements for "deferred e2e" markers and include those scenarios in your scoped spec.
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
> - No e2e edits unless the refinement explicitly scopes them. **For UI-stream tasks**: the refinement should either scope a Playwright spec OR explicitly mark e2e deferred-because-not-yet-reachable. If a UI-stream refinement is silent on e2e, stop and ask the orchestrator to re-dispatch the Refinement-Writer — do not silently land without e2e.
> - No new i18n catalog keys unless the refinement scopes them.
> - No new dependencies without an ADR (Refinement-Writer should have produced one; if a fresh dependency surfaces during implementation, stop and report — do not add it autonomously).
> - No `--no-verify`, no hook bypass, no test weakening.
> - Do NOT touch any `.tji` file or the refinement's `## Status` section — that's the Closer's job.
> - Do NOT commit — the Closer does that too.
>
> Before returning, run the verification the refinement's Acceptance criteria require, at minimum: `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F <affected-workspace> build` where relevant. If the refinement requires Cucumber or Playwright layers, run them too. For Playwright suites, bring the compose stack up (`make up`), run, then tear down with `make down-v` so the runner is clean.
>
> **Test output handling (mandatory):** redirect every verification command to a file (`<command> > /tmp/<run>.log 2>&1`) and then dispatch an `Explore` sub-agent with the file path to extract pass/fail and failing-test excerpts. Do NOT pipe to `tail`. Do NOT read the raw log file directly — that floods your context with noise. The Explore agent's tight report is what you act on.
>
> If verification fails, fix the implementation (not the test) and re-run until green. If a verification gap is in the test infrastructure itself, fix that infrastructure — but do not document it in the refinement's Status block (that's the Closer's job; just report the fix in your summary).

Must return (≤ 8 lines): files created / edited (paths only), Vitest test-count delta (before → after), e2e suite result (pass / fail / not-run-not-required), one-line summary of what shipped.

### 3. Closer

Brief:

> Run the task-completion ritual for `<task_id>` per `tasks/refinements/README.md#task-completion-ritual`, then commit locally. **Do NOT push** — the human user batches pushes themselves.
>
> Ritual:
>
> 1. Append a `## Status` block to `<refinement path>`. Format: `**Done** — <today's date>.` followed by 4–8 bullets summarizing what landed, citing artifact paths. Do not rewrite earlier sections of the refinement. The implementation summary from the prior step is: `<Implementer's return summary>`.
> 2. Add `complete 100` immediately after `allocate team` in the matching task block in `tasks/<NN>-<area>.tji`.
> 3. If the task is the last unmet dependency of a milestone in `tasks/99-milestones.tji`, add `complete 100` to that milestone too. Check by walking the milestone's `depends` list and confirming every other entry is also `complete 100`.
> 4. **Register tech-debt tasks in the WBS.** If the Implementer's summary or the Status block names a follow-up task (typically deferred-e2e debt pointing at a provisional `<task_name>`, or any other "future task X will close this"), add that task to the appropriate `tasks/<NN>-<area>.tji` file in the same commit. Use a stable kebab/snake_case id, give it an effort estimate (`0.5d`/`1d`), an `allocate team` line, a `depends` list reflecting the real prerequisites, and a `note` line citing the source-of-debt refinement + commit. Do NOT add `complete 100` (the task is deliberately open). The orchestrator's next pick-task pass will see the new leaf and route it through the normal loop.
>
> WBS validation is handled by the pre-commit hook: it runs `tj3 --silent project.tjp` whenever a `.tji`/`.tjp` is staged and fails the commit on any `Warning:` or `Error:` line (strictly stricter than a `grep -iE "error|fatal"`). No separate manual `tj3` invocation in this ritual.
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
> **Do NOT run `git push`.** The commit stays on local `main`; the human user pushes in batches at their own cadence. If you call `git push`, the auto-mode classifier will soft-block it and your work returns blocked — wasting an iteration. Just commit and stop.
>
> Do not use `--no-verify`. If the pre-commit hook fails, fix the underlying issue and create a NEW commit (not `--amend`).

Must return (≤ 5 lines): commit SHA, `complete 100` lines added (which task ids), milestone propagation done-yes-or-no (and which milestone if yes). **Do NOT push** — pushing to `origin/main` is the human user's responsibility; they batch pushes and watch CI themselves.

### CI is out of the orchestrator's loop

The orchestrator does not dispatch a CI-Watcher or a CI-Fixer. The human user pushes commits to `origin/main` in batches and watches CI themselves. If they report a CI failure on a previously-closed task, that becomes an ad-hoc fix task dispatched outside the normal loop — typically as a one-off `Agent` call briefed with the failing spec and the relevant refinement. Such a fix lands as `fix(<area>): <summary>` and stays separate from the WBS task's original commit.

Rationale: this orchestrator was built as a code-shipping loop, not a CI-monitoring loop. Watching a 6–20-minute CI run is wall-clock waste for an automated agent; the human user already does it at a useful cadence.

## Orchestrator self-tracking

Use `TaskCreate`/`TaskUpdate` to maintain a tiny progress list per iteration. One task per step. Mark `in_progress` when starting, `completed` when the sub-agent returns.

Example shape for one iteration:

```
#1 Pick next task <id>          status: completed
#2 Write refinement              status: completed
#3 Implement                     status: in_progress
#4 Run ritual + commit (local)   status: pending
```

Reset the list at the start of each iteration (mark prior tasks `deleted` once they're no longer relevant).

## Updating the orchestrator's WBS view

After the Closer reports done, the orchestrator does NOT maintain an in-memory WBS view. The next iteration's pick step re-runs `make unblocked MILESTONE=<id>` against the current on-disk state, which already reflects the freshly-closed leaf, any milestone propagation the Closer did, and any newly-unblocked successors. There is no drift to manage.

## Stop conditions

- **Mission complete** — `make unblocked MILESTONE=<id>` for every milestone in M4..M8 shows no eligible leaf (either ALL GATING WORK COMPLETE, or every READY leaf is filtered by the `deployment.*` scope rule). Orchestrator dispatches one final `End-of-Mission` sub-agent (brief in §End-of-mission below), then stops.
- **Tooling gap** — `make unblocked` itself fails, or a sub-agent reports `docker`, `tj3`, or `pnpm` is unusable. Surface via `AskUserQuestion`, halt until user replies.
- **Corrupted state** — a sub-agent reports the working tree, the git index, or the WBS itself is in an unexpected shape. Surface via `AskUserQuestion`, halt.

The orchestrator does NOT stop for routine design questions; those are decided inside the Refinement-Writer per the "make the most defensible call" rule.

## Environment + tooling assumptions

The orchestrator does not verify these itself; the first sub-agent that needs each tool surfaces a failure if missing. Listed here so a human reader knows the baseline:

- `pnpm@9.15.4` via Corepack (pinned in root `package.json`).
- Node 20+ (last verified on 20.19.2 per `docs/dev-environment.md`; no `.nvmrc` / `engines` pin).
- Docker + Docker Compose (`make up` works).
- Playwright Chromium installed locally (`pnpm exec playwright install chromium`). Without it, `pnpm run test:e2e:smoke` (and `make test`, which invokes it) fail with a Chromium-not-found error rather than silently passing. The historical `mod_route_auth_gate` regression landed before the gap was closed; sub-agents that run Playwright still confirm it's installed before invoking.
- `tj3` (TaskJuggler) available. The pre-commit hook runs `tj3 --silent project.tjp` whenever a `.tji`/`.tjp` file is staged and fails the commit on any `Warning:`/`Error:` line — the WBS baseline is kept warning-free. `make unblocked` (the orchestrator's only window into the WBS) shells out to `tj3` internally; if `tj3` is missing, `make unblocked` fails and the orchestrator halts via the tooling-gap stop condition.

## Reference paths passed to sub-agents

The orchestrator does NOT read these — but every sub-agent's brief should reference them by path so the sub-agent knows what to load:

- `DESIGN.md` — canonical evolving design doc.
- `tasks/refinements/README.md` — refinement shape + ritual.
- `docs/adr/README.md` — ADR convention.
- `docs/dev-environment.md` — make targets + compose stack + pre-commit hook.
- `ORCHESTRATOR.md` — UI-stream e2e policy, tech-debt registration policy, test-output handling rule (sub-agent briefs below cite sections of this file by name).

Per-iteration, the orchestrator also passes:

- The selected task's fully-qualified `<task_id>` (as printed by `make unblocked`).
- The refinement path (existing or to-be-created), derived from the task id as `tasks/refinements/<area>/<task_name>.md`.

The `.tji` file path and the predecessor task ids are NOT pre-extracted by the orchestrator — sub-agents derive them from the task id (the area is the first dot-segment; the `.tji` file is `tasks/<NN>-<area>.tji`, found by listing the directory) and locate the predecessor list inside that file themselves.

## UI-stream e2e policy — passed through to every UI-stream brief

Applies to every task under `moderator_ui.*`, `participant_ui.*`, `audience.*`, `replay_test.*`.

**Default — e2e is in scope:** the Refinement-Writer scopes a Playwright spec under Acceptance criteria; the Implementer lands it; the spec exercises the user-visible behavior the task adds.

**Deferred-e2e exception — when the component is not yet reachable:** if the task creates a component or capability that no user flow currently reaches (no route renders it; no event surface invokes it; only unit/component tests exercise it), the refinement may defer the Playwright spec. In that case the refinement MUST:

1. State explicitly under Acceptance criteria that the e2e is deferred *because the surface is not yet reachable*, and name the unit/component coverage that takes its place for now.
2. Identify the future WBS task(s) whose work will make this component reachable. Those tasks' refinements MUST scope Playwright coverage that exercises the now-visible behavior — including any "deferred-e2e" debt from prior tasks pointing at the wiring task.

**Wiring tasks inherit deferred e2e debt.** When a UI-stream task wires a previously-deferred component into a reachable flow (adds a route, hooks an event, mounts a subtree), the Refinement-Writer reads the WBS for older `note` lines or refinement Status blocks that flag deferred e2e against this wiring task and includes those scenarios in the new Playwright spec.

**Visual-regression is not a substitute for Playwright.** A `mod_vr_*` / `aud_vr_*` / `part_vr_*` sibling task captures pixel-level appearance — Playwright captures *behavior*. Both can coexist; only Playwright satisfies the e2e policy.

## Test output handling — passed through to every brief that runs a verification

When a sub-agent runs tests, builds, lint/typecheck, `docker compose logs`, or any other command whose stdout/stderr is large or unstructured:

- **Redirect to a file**: `<command> > /tmp/<run>.log 2>&1` (or a path under the project if longer-lived).
- **Inspect via an `Explore` sub-agent**: spawn one with the log path and a tight question ("did the run pass? if not, paste the failing assertions / stack frames verbatim"). The Explore agent's report comes back as the tool result — the raw log never enters the parent's context.
- **Never pipe to `tail`** — it truncates blindly and can hide the real failure above the tail window.
- **Never read the raw log file directly** with `Read` from a verification-running sub-agent — that defeats the point. Use `Explore`.

This applies to the Implementer (running `pnpm run check`, `test:smoke`, Playwright, etc.) and any other sub-agent that runs a noisy command. Briefs below already cite this rule; surface it again in any future brief that runs verification.

## Tech-debt registration — passed through to every brief

Whenever a sub-agent surfaces a follow-up task (deferred test coverage, a known component-not-yet-wired, a small enhancement deferred for scope reasons, etc.), it MUST land as a real WBS leaf — not just a note in a Status block.

**Refinement-Writer:** when you defer something to a future task, name the future task crisply (a stable id, an effort estimate, a one-line description) so the Closer can register it mechanically. Mention it under Acceptance criteria with phrasing like "deferred to `<task_name>` (see Closer task-registration in ORCHESTRATOR.md)".

**Implementer:** when verification surfaces a gap you can't close in scope, include the proposed follow-up task name in your return summary (e.g. "deferred edge-hover assertion pending `mod_node_handle_rendering` — recommended placement under `mod_graph_rendering`").

**Closer:** Ritual step 4 (above) — add the new task block to the appropriate `tasks/<NN>-<area>.tji` file in the same commit that closes the current leaf. Stable id, effort, `allocate team`, `depends` list, `note` line citing the source-of-debt refinement + this commit. Do NOT add `complete 100`. Re-run `tj3 project.tjp` to confirm syntax.

**Orchestrator:** when reading the next iteration's mental WBS state, treat newly-registered tech-debt leaves as eligible candidates for the next pick. A subgroup with a freshly-registered open leaf has not closed; the pick-task pass picks up the debt before declaring the subgroup done.

Rationale: a Status-block note is invisible to the orchestrator's task-picker. The pattern showed up first on `mod_node_handle_rendering` (deferred from `mod_hover_details` / commit `b7ac2d5`) — recorded in prose, missed by the WBS, almost lost. This section closes that loophole.

## What sub-agents must NOT do (passed through to every brief)

- Don't open PRs. Commit locally; the human user pushes to `origin/main` in batches.
- Don't run `git push` — the auto-mode classifier soft-blocks sub-agent pushes to the default branch, and pushing isn't the orchestrator's job anyway.
- Don't bundle two tasks in one commit. One leaf = one commit.
- Don't skip the ritual. Both `complete 100` and `## Status` are load-bearing.
- Don't touch `deployment.*`.
- Don't introduce new top-level dependencies (root `package.json` or any workspace's) without an ADR.
- Don't run `make down-v` without a clear reason — it drops named volumes. `make down` (preserves volumes) is safe.
- Don't edit `.env` in place; use `cp .env.example .env` plus an overrides append.
- Don't push secrets. `.env.example` is the only env file in the repo; `.env` is gitignored.
- Don't pipe verification commands to `tail` or read raw test/log output inline — see "Test output handling" above.
- For UI-stream tasks (`moderator_ui.*`, `participant_ui.*`, `audience.*`, `replay_test.*`): don't ship without a Playwright e2e spec unless the refinement explicitly marks e2e deferred-because-not-yet-reachable AND names the future wiring task that inherits the debt. See "UI-stream e2e policy" above.

## End-of-mission

When `make unblocked` reports no eligible leaf across every M4..M8 milestone (per the mission-complete stop condition), dispatch one last sub-agent:

> Update `DESIGN.md`'s Status section with a one-paragraph note: "MVP scope complete (M1–M8); M9 deployment + M10 first show pending human-driven work." Do not rewrite the surrounding sections. Commit (local only — do NOT push) as `docs: DESIGN.md — mark MVP scope complete`.

Then print a final summary listing the closed tasks + green milestones + deferred questions (if any) and stop.
