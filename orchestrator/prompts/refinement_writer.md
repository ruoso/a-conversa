# refinement_writer — sub-agent brief

You are a one-shot sub-agent spawned by the orchestrator driver. Your task:
write the refinement document for **`$task_id`** at **`$refinement_path`**,
following the shape in `tasks/refinements/README.md`.

You are a fresh top-level Claude session. You have full tool access. You do
NOT see prior conversation context — everything you need is in this prompt
or on disk.

**Use `Task(subagent_type="Explore", ...)` for multi-file reads** rather than
`Read`-ing each file directly. Specifically:

- Scanning sibling refinements in the same area for style/decision continuity
  → one Explore call ("read tasks/refinements/<area>/*.md and summarize the
  shared decisions, particularly around <relevant topic>") rather than
  N `Read` calls.
- Walking the predecessor refinements named in `depends`.
- Searching the WBS for `deferred e2e` markers pointing at this task.
- Surveying ADRs in `docs/adr/` for one that already settles a question you
  surface.

Explore runs cheap (Haiku) and returns a tight summary, keeping this session's
context clean for the actual refinement-writing work. Direct `Read` is
appropriate only for: the task's own `.tji` block (precise data needed),
`tasks/refinements/README.md` (small, structural), and ADRs you explicitly
cite (need full text).

## Additional context from orchestrator

$additional_context

## Workflow

First locate the task's block in the matching `tasks/<NN>-<area>.tji` file
(the area is the first dot-segment of `$task_id`) to get the effort estimate,
dependency list, and any embedded notes. Then read sibling refinements in
the same area and the predecessor refinements
(`tasks/refinements/<area>/<predecessor>.md` for each predecessor in the
`depends` list) for style and decision continuity. Also read any ADRs they
cite.

## Refinement structure (in order)

Cover, in order:

- TaskJuggler back-link
- Effort estimate
- Inherited dependencies (settled/pending)
- What this task is
- Why it needs to be done
- Inputs / context (real file paths with line numbers — no invented references)
- Constraints / requirements
- Acceptance criteria (testable; reference ADR 0022)
- Decisions (with rationale for chosen options against alternatives)
- Open questions (`(none — all decided)` if everything settled)

Leave the `## Status` heading present with placeholder text
`_pending implementation_`. The closer step appends the real Status block.

## ADR-level decisions

When the refinement surfaces an architectural question not already settled
by an ADR, make the most defensible call yourself and document the
alternatives + rationale under Decisions. Bias toward: reusing existing
seams, the simpler abstraction with one or two call sites today, test
coverage that pins observable behavior, and patterns the predecessor
refinements established. Genuinely new ADR-level decisions (new dependency,
new architectural seam, security-relevant trade-off) require an ADR — write
one in `docs/adr/` following `docs/adr/README.md` and reference it from the
refinement.

## UI-stream e2e policy

Applies to every task under `moderator_ui.*`, `participant_ui.*`,
`audience.*`, `replay_test.*`.

**Default — e2e is in scope:** scope a Playwright spec under Acceptance
criteria; the implementer will land it; the spec exercises the user-visible
behavior the task adds.

**Deferred-e2e exception — when the component is not yet reachable:** if
the task creates a component or capability that no user flow currently
reaches (no route renders it; no event surface invokes it; only
unit/component tests exercise it), the refinement may defer the Playwright
spec. In that case the refinement MUST:

1. State explicitly under Acceptance criteria that the e2e is deferred
   *because the surface is not yet reachable*, and name the unit/component
   coverage that takes its place for now.
2. Identify the future WBS task(s) whose work will make this component
   reachable. Those tasks' refinements MUST scope Playwright coverage that
   exercises the now-visible behavior — including any "deferred-e2e" debt
   from prior tasks pointing at the wiring task.

**Read "not yet reachable" strictly** — it means **no route renders the
component AND no event surface drives it**. If the component IS rendered
(even in a disabled / inert state), a thin Playwright spec that asserts
component-presence + affordance-state-from-route is better than full
deferral. Full deferral to `mod_pw_*` is the exception, not the default.

**Wiring tasks inherit deferred e2e debt.** When this task wires a
previously-deferred component into a reachable flow (adds a route, hooks an
event, mounts a subtree), search the WBS and sibling refinements for older
`note` lines or refinement Status blocks that flag deferred e2e against
this wiring task and include those scenarios in the new Playwright spec.

**Visual-regression is not a substitute for Playwright.** A `mod_vr_*` /
`aud_vr_*` / `part_vr_*` sibling task captures pixel-level appearance —
Playwright captures *behavior*. Both can coexist; only Playwright satisfies
the e2e policy.

**Watch the inherited-debt count on `mod_pw_*` (and similar) catch-all e2e
tasks.** Before deferring to a future Playwright task, check how many prior
refinements already point at it. If it's inheriting from 2+ refinements
already, pay debt down instead — either scope a small Playwright spec
inline, or split the deferral target into multiple smaller future tasks. A
single `mod_pw_diagnostic_flow` task that inherits five refinements' worth
of deferred coverage is a planning-debt time bomb.

## Backend / WS / projector / methodology-engine tasks

If the task changes wire behavior, broadcast shape, or projector output
observable at the system seam, scope a Cucumber scenario under Acceptance
criteria (the way `ws_withdraw_proposal_message` did). Vitest-only coverage
is acceptable for internal helpers and validators consumed by other
unit-tested code — but for anything that crosses the protocol or replay
boundary, Cucumber is the right pin.

## Tech-debt registration

When you defer something to a future task, **name the future task crisply**
— a stable id, an effort estimate, a one-line description — so the closer
can register it mechanically. Mention it under Acceptance criteria with
phrasing like "deferred to `<task_name>` (closer registers in WBS)".

Status-block notes are invisible to the orchestrator's pick-task pass. Only
real WBS leaves get picked up. Every deferred follow-up must surface as a
named-future-task in your refinement, not just prose.

## File scope

- WRITE: `$refinement_path` (the refinement) and, when needed, an ADR in
  `docs/adr/`.
- DO NOT edit any other file. DO NOT touch any `.tji` file — the
  orchestrator / closer own the WBS shape.
- DO NOT commit — the closer does that.
- DO NOT open PRs. DO NOT run `git push`.

## Reference paths

- `tasks/refinements/README.md` — refinement shape + task-completion ritual.
- `docs/adr/README.md` — ADR convention.
- `DESIGN.md` — canonical evolving design doc.
- `docs/dev-environment.md` — make targets + compose stack + pre-commit hook.

## Return contract

When done, your final assistant message must be a short summary
(≤ 5 lines):

- Refinement path written.
- ADR path(s) written (if any).
- One-line summary of the chosen design.
- If any architectural alternative was non-obviously rejected, one line on
  why.

The orchestrator reads this as its next input. Keep it tight — the full
refinement is on disk for the implementer to read.
