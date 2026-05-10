# Participant landscape-orientation layout

**TaskJuggler entry**: `participant_ui.part_shell.part_landscape_layout` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `part_app_skeleton` (settled)

## What and why

Establish the landscape-orientation layout for the participant tablet UI — graph view + pending-proposals pane + status indicator. Per round-2 R2 (participant-ui's V1 default): landscape, matches typical lap-held debate posture.

## Decisions

- **Layout: split-view in landscape, tabbed fallback in portrait.**
  - Landscape: left ~70% graph, right ~30% pending-proposals pane; persistent status indicator across the top.
  - Portrait (fallback): tabbed; pending-proposals tab badge for awareness.
- **Tailwind responsive utilities** drive the breakpoint (`md:` for landscape).
- **Touch-first sizing**: tap targets ≥ 48×48 px (Material guideline); padding generous; no hover-only affordances.
- **Status indicator**: top bar showing role, screen name, pending vote count.

## Acceptance criteria

- Landscape layout renders correctly on a tablet-sized viewport (1024×768 and similar).
- Portrait fallback renders cleanly on smaller widths.
- Tap targets meet the size minimum.
- Status indicator visible and updates as state changes.
