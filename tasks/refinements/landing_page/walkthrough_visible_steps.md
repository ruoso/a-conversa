# walkthrough_visible_steps — visible-step scrubbing + autoplay pacing

## TaskJuggler entry

`landing_page.walkthrough_visible_steps` in `tasks/47-landing-page.tji`.

## Effort estimate

1d. Inherited dependencies: `walkthrough_dialogue_chat` (the dialogue
anchors are promoted to steps), `walkthrough_representative_log` (the
extended stream this models).

## What this task is

The demo's controls walked raw event positions, but 77 of the stream's
301 events render nothing (entity-included bookkeeping, session
lifecycle, structural-proposal votes, the snapshot) — pressing next did
nothing for runs of 40 presses, and autoplay crawled through dead air at
a fixed 1200 ms. This task introduces the VISIBLE-STEP model: a pure
module computes the ordered positions where the rendered graph changes
or a dialogue turn lands; the scrubber, prev/next, and play walk step
indices, skipping the rest transparently; autoplay dwells per step kind
(graph fast, speech long enough to read).

## Why it needs to be done

User direction (2026-06-10): "some events that don't produce real visual
changes should be skipped when counting how many events there are … the
scrubber should just go over them transparently" + "the play button
should be enabled and go through the events at a reasonable speed."

## Inputs / context

- `steps.ts` predicate mirrors what the renderer consumes: graph-view's
  `projectGraph` (topology, commits, supersession, withdrawn paint) +
  the shell's facet-status/votes walks (pill candidates + checkmarks).
- `dialogue.ts` — speech anchor positions.
- The narration beats — every beat anchor must land on a visible step.

## Constraints / requirements

1. Honesty: a position may be skipped ONLY if rendering it changes
   nothing — pinned by replaying the full stream through `projectGraph`
   and asserting deep-equality across every skipped position.
2. The external seam vocabulary stays positions: `data-position` keeps
   reporting the raw event position (beat-anchor e2e assertions
   untouched); `data-step` + `data-total` (now the step count) carry the
   step space; `initialPosition` remains a raw position mapped at mount.
3. Beat anchors must be reachable: a new narration-suite assertion fails
   loudly if a fixture edit strands a beat on a skipped event.
4. Reduced-motion gating of autoplay is unchanged (constraint 6 of the
   stepper refinement).
5. No position/step literals in tests — everything derives from
   `WALKTHROUGH_STEPS`.

## Acceptance criteria

- Scrubber max = visible-step count; prev/next move exactly one visible
  step; play advances at 900 ms after a graph step and 3200 ms after a
  speech step, auto-stopping at the end.
- `steps.test.ts` green including the full-stream honesty sweep; the
  demo suites + e2e (step-indexed driving, raw-position assertions, a
  short play/pause scenario) green.

## Decisions

- **D1 — kind-level predicate** (not projection-diffing at runtime):
  visible = node/edge/annotation-created, commit (both arms),
  meta-disagreement-marked, withdraw-agreement, proposal-withdrawn,
  facet-valued proposals, facet-keyed votes, proposal-keyed votes whose
  proposal is facet-valued, plus any dialogue-anchor position.
  Invisible = session lifecycle, participant-joined, entity-included,
  snapshot, session-mode-changed, structural proposals and their votes.
  The honesty sweep (Acceptance) proves the predicate never skips a
  change; the converse (every kept step changes pixels) is deliberately
  NOT required — an early agree vote that hasn't flipped a rollup yet is
  an honest "building toward" beat.
- **D2 — dwell times**: graph 900 ms, speech/both 3200 ms (flat;
  length-aware dwell parked as a tunable follow-up). Implemented as a
  self-rescheduling timeout keyed on the step just arrived at.
- **D3 — step 0 is the empty board** (position 0), preserved from the
  stepper design.
- **D4 — compact variant unchanged mechanically**: it steps beats (all
  visible steps by D1+constraint 3); its status reports the same
  `data-step`/`data-total` vocabulary for cross-variant parity.
- **D5 — `landing.demo.stepStatus` ICU params** change from
  `{position, total}` to `{step, total}` in all three catalogs (copy
  text otherwise unchanged — no new review burden).

## Open questions

(none — all decided)

## Status

**Done** (2026-06-10). Artifacts: `apps/root/src/walkthrough/steps.ts`
(+ `steps.test.ts` with the full-stream honesty sweep), step-indexed
`WalkthroughDemo` controls + per-kind autoplay dwell, compact status
parity, narration beat-on-step assertion, derived test/e2e rework, the
play/pause e2e scenario.

**Amendment (2026-06-10, post-land):** constraint 4 is superseded — the
reduced-motion blanket disable of the play toggle dead-ended the demo's
headline affordance for any visitor with the OS preference set (the
original user report). Playback is an explicit user gesture with pause
adjacent (WCAG 2.2.2), not auto-triggered motion: the demo now loads
default-paused under `prefers-reduced-motion` (nothing moves until
asked) but play stays enabled and operable. Unit + e2e pins updated to
the new contract.
