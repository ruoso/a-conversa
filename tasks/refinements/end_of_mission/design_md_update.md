# design_md_update — Update DESIGN.md to mark MVP scope complete

## TaskJuggler entry

`tasks/80-end-of-mission.tji` → `end_of_mission.design_md_update`

## Effort estimate

0.5d (doc-only; no code, schema, or test changes)

## Inherited dependencies

None — the milestone state (M1–M8 + M8-audits all complete) is the precondition and is already satisfied.

## What this task is

Update the Status blockquote at the top of `DESIGN.md` to reflect that the MVP scope (M1 through M8-audits) is complete, and that only M9 (deployment) and M10 (first show) remain — both pending human-driven infrastructure work.

## Why it needs to be done

`DESIGN.md` has carried the placeholder status "Early design phase" since the project was bootstrapped. Now that M8-audits has closed, the document's status line is factually wrong for anyone reading the repo. This task corrects the record so contributors and stakeholders pick up the project's actual state from the canonical design document.

## Constraints / requirements

- Only the Status blockquote is edited; no other sections change.
- The updated status must name which milestones are complete and which remain open.

## Acceptance criteria

- `DESIGN.md`'s opening blockquote reads "MVP scope complete (M1–M8 + M8-audits); M9 deployment and M10 first-show remain, pending human-driven infrastructure work."

## Decisions

- **D1 (doc-only scope)**: No code, test, or schema changes are in scope. The DESIGN.md change is the entire deliverable.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-06.

- Prepended MVP-scope-complete paragraph to `DESIGN.md` Status blockquote.
- Old status: "Early design phase. This document evolves through Q&A…"
- New status: "MVP scope complete (M1–M8 + M8-audits); M9 deployment and M10 first-show remain, pending human-driven infrastructure work."
- Implementation commit: `500f4a10c94cafbd7f4a0c43ec3840657c6806e9` (docs: DESIGN.md — mark MVP scope complete).
- No tests added (doc-only change).
- No tech-debt follow-up.
