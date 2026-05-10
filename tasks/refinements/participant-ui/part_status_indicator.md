# Persistent status indicator

**TaskJuggler entry**: `participant_ui.part_shell.part_status_indicator` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji)
**Effort**: 1d

## What and why

The persistent top-bar status indicator on the participant tablet — shows role (debater A / B), screen name, and pending vote count. Always visible regardless of which view the participant is on.

## Decisions

- Height: ~48px (one tap-target row); doesn't crowd the graph view.
- Left-aligned: role badge + screen name.
- Right-aligned: pending vote count badge (links to pending-proposals tab) plus optional connection status indicator (online / reconnecting).
- Renders as a Tailwind component subscribing to `useUiStore` for the badge count.

## Acceptance criteria

- Indicator visible on every participant route.
- Updates in real time as proposals arrive and as the debater votes.
- Tap on the badge navigates to the pending-proposals tab.
- Visual regression test covers steady state, badge >0, and reconnecting state.
