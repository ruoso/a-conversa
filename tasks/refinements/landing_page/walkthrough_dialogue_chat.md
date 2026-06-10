# walkthrough_dialogue_chat — dialogue script + chat panel synchronized with the stream

## TaskJuggler entry

`landing_page.walkthrough_dialogue_chat` in `tasks/47-landing-page.tji`.

## Effort estimate

1d. Inherited dependencies: `walkthrough_representative_log` (shipped —
the anchors below point at events that log introduced, e.g. the
mode-change, the reword proposal, the value re-classification).

## What this task is

A "speech" layer for the landing walkthrough demo: a chat window between
the moderator (Maria) and the two debaters (Anna, Ben) that simulates
what a video of the debate would carry, synchronized with the event
stream. The dialogue is adapted from the spoken lines of
`docs/example-walkthrough.md`, condensed to chat-bubble length, and each
turn anchors to the stable EVENT ID of the platform action it
precipitates — the same anchoring pattern as the narration beats.

## Why it needs to be done

User direction (2026-06-10): "include a 'speech' element to the
walkthrough, so it simulates what a video of the debate would have …
present it in the landing page as a chat window between the moderator
and the two participants." The visible-step task
(`walkthrough_visible_steps`) consumes the dialogue anchors as visible
steps; the locale-overlay task localizes the rest of the demo content
around this panel.

## Inputs / context

- `docs/example-walkthrough.md` — source dialogue (~22 turns).
- `narration.ts` — the event-id anchoring pattern + activation rule.
- DESIGN.md / docs/methodology.md — speech is NOT an event kind (raw
  utterances are deliberately not preserved in the log), which decides
  the sidecar-script approach.
- ADR 0024 — copy lives in the i18n catalogs.

## Constraints / requirements

1. Speech enters as a landing-only sidecar script (user-approved) — no
   schema change, no new event kind, fixture untouched.
2. Anchoring by event id with loud failure on a missing anchor; resolved
   positions non-decreasing in script order.
3. Dialogue copy is catalog-resolved (`landing.demo.dialogue.<slug>.text`)
   in all three locales; machine drafts for pt-BR/es-419 ride the review
   trackers + parking-lot pass.
4. The chat hangs off the existing position seam and works identically
   for both demo variants (full + compact).
5. Accessibility: labelled `role="log"` region, `aria-live="off"` (the
   step-status is the polite announcer; autoplay must not spam AT),
   keyboard-reachable scroll area, reduced-motion-aware auto-scroll.

## Acceptance criteria

- A chat panel renders beside the demo showing every turn whose anchor ≤
  the current position, newest kept in view; debater bubbles reuse the
  participants' axiom-mark palette (board ↔ chat identity).
- Suites: dialogue table integrity (unique slugs, resolved non-decreasing
  anchors, catalog-key sweep), ChatPanel visibility/speaker/copy seams,
  e2e (chat visible on load; grows to the full script at the finale —
  counts derived from the imported script, never pinned).

## Decisions

- **D1 — module shapes**: `anchors.ts` extracts the shared
  `resolveAnchorPosition` (narration + dialogue resolve through one
  helper); `dialogue.ts` holds the typed script
  (`{slug, speaker, anchorEventId}` → resolved `WALKTHROUGH_DIALOGUE`)
  plus `dialogueVisibleAt(position)`; `ChatPanel.tsx` is pure props-in
  (`{position}`).
- **D2 — script size**: 28 turns spanning session-created through
  session-ended (the doc's 22 spoken turns, plus short lines voicing the
  representative-log additions: Ben's E3 withdrawal, the N12
  normative→value exchange, the reword pass, the deadlock call).
- **D3 — speaker identity**: debater bubbles tint via
  `axiomMarkColorFor` over the fixture participant ids
  (`DEBATER_PARTICIPANT_IDS`); Maria stays neutral slate — she has no
  marks on the board and casts no counted votes.
- **D4 — layout**: the narrated wrapper's right column becomes caption +
  chat (`flex` column; chat `flex-1` at `lg`, height-capped `max-h-80`
  on small screens where it stacks under the compact demo).

## Open questions

(none — all decided)

## Status

**Done** (2026-06-10). Artifacts: `apps/root/src/walkthrough/{anchors.ts,
dialogue.ts, ChatPanel.tsx, dialogue.test.ts, ChatPanel.test.tsx}`,
narrated-wrapper layout, `landing.demo.dialogue.*` in en-US/pt-BR/es-419
(+ review trackers + parking-lot note), e2e chat scenario in
`tests/e2e/landing-demo.spec.ts`.
