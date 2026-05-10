# Task refinements

This directory holds per-task refinement documents. Each refinement expands the one-line description in [`project.tjp`](../../project.tjp) (and its included `tasks/*.tji` files) into the constraints, prior decisions, and open questions that bound the task's scope. A refinement is the source of truth for "what does this task mean?" — read it before doing the work.

## Layout

Refinements are organized by work-stream, mirroring the `tasks/*.tji` file split:

- `foundation/` — repo skeleton, dev environment, CI (M0 milestone work).
- `data-and-methodology/` — schema, event types, projection, methodology engine, structural diagnostics (M1 / M2).
- `audience/` — audience-broadcast surface.
- `moderator-ui/` — moderator console.
- `participant-ui/` — debater tablet.

The filename convention is `<task_name>.md` matching the `task <task_name>` identifier in the `.tji` file. Each `.tji` task entry has a `note "Refinement: tasks/refinements/<area>/<task_name>.md"` line linking to its refinement.

## Refinement document shape

Each refinement covers, in roughly this order:

1. **TaskJuggler entry** — back-link to the `.tji` task definition.
2. **Effort estimate** and **Inherited dependencies** (settled or pending).
3. **What this task is** — one paragraph of plain-language scope.
4. **Why it needs to be done** — the dependency chain and downstream consumers.
5. **Inputs / context** — relevant excerpts from `docs/architecture.md`, `docs/data-model.md`, `docs/methodology.md`, prior ADRs.
6. **Constraints / requirements** — what the implementation must satisfy.
7. **Acceptance criteria** — the concrete check that says "done."
8. **Decisions** — pre-settled choices (with their refinement-round identifier R<n> if they came from a Q&A round).
9. **Open questions** — what remains unresolved, or `(none — all decided)`.
10. **Status** — appended on completion (see ritual below).

## Task-completion ritual

When a task ships, three things happen in the same commit (or a tight commit cluster):

1. **Refinement `## Status` block.** Append a `## Status` section at the bottom of the refinement document noting **Done** with the date and brief pointers to the produced artifacts (ADRs, files, scripts). Don't edit the prior sections — Decisions and Acceptance criteria are the historical record of why the task existed; the Status section is the historical record of how it landed. Prior content stays untouched.

2. **`complete 100` in the `.tji`.** Add `complete 100` immediately after the `allocate team` line of the matching task block in the relevant `tasks/*.tji` file. After editing, run `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` and confirm silent (clean parse). The `complete 100` marker is what `tj3`'s scheduler reads — refinement-Status alone is for human readers; the WBS file needs the structured marker too.

3. **Milestone propagation.** If the task is the last one a milestone depends on, also add `complete 100` to the milestone task in `tasks/99-milestones.tji` itself. Milestones don't infer completion from their dependencies — they need the explicit marker too.

The ritual was made explicit on 2026-05-10 after several tasks shipped their work without one or both updates and the WBS drifted out of sync with reality.

## Why refinements exist alongside ADRs

The two documents serve different purposes:

- **ADRs** (`docs/adr/`) capture **architectural decisions** — discrete choices among alternatives with stated rationale and consequences. They're frozen in time per the ADR convention; they describe the project's design at the moment the decision was made.
- **Refinements** capture **task scope** — the constraints, prior decisions, and open questions that bound a single piece of work. They reference ADRs (as Inputs) but they aren't decision records themselves; they're work-shaping documents that get a `## Status` block on completion.

A refinement may surface an open question that becomes an ADR; the ADR then constrains future refinements that depend on it. The two layers stay separate so each can be read for what it is.
