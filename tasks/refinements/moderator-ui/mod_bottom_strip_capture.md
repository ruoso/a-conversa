# Moderator bottom-strip capture pane (scaffold)

**TaskJuggler entry**: `moderator_ui.mod_layout.mod_bottom_strip_capture` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `moderator_ui.mod_layout.mod_layout_shell` (settled — the three-pane scaffold landed with `<OperateLayout>` exposing a `bottomStrip` render-prop slot keyed to the `operate-bottom-strip` region).

## What this task is

Land the structural scaffold for the bottom-strip capture pane that mounts into `<OperateLayout>`'s `bottomStrip` slot. The pane is the moderator's primary input surface during a session — statement text, classification palette, edge-role selector, propose-action button, all anchored by a mode banner — but **this task is empty scaffolding only**. The four real sub-surfaces are filled in by the downstream `mod_capture_flow.*` tasks, and the mode banner copy lands with `mod_mode_banner`. What ships here is the DOM shape, the five stable `data-testid` sub-slots, the accessibility wrapper (a labelled `role="region"`), the Tailwind palette consistent with the shell, and a one-line placeholder visible per slot so the pane reads as wired-but-unimplemented during the foundation pass.

## Why it needs to be done

`tasks/30-moderator-ui.tji` records that `mod_mode_banner` depends on `mod_bottom_strip_capture`, and `mod_capture_flow` (`mod_capture_text_input`, `mod_classification_palette`, `mod_edge_role_selector`, `mod_propose_action`) fills the pane's content. None of those downstream tasks can land cleanly while the strip is an empty render-prop hole — each would have to re-decide where in the DOM its sub-surface mounts and what the surrounding container looks like. This scaffold settles those questions in a single small commit so the five downstream tasks plug in without negotiating geometry.

It also discharges the carryover from `mod_layout_shell`'s Status block: *"Downstream consumers ... `mod_bottom_strip_capture` replace[s] the placeholder children with their real implementations by passing a different child element into the matching render-prop slot — no shell changes required."* This task does exactly that — passes a `<BottomStripCapture />` element into the shell's `bottomStrip` slot — without touching the shell.

## Inputs / context

- [tasks/refinements/moderator-ui/mod_layout_shell.md](mod_layout_shell.md) — the predecessor's `## Status` block lists the render-prop slot mapping; `bottomStrip` is the one this task fills.
- [apps/moderator/src/layout/OperateLayout.tsx](../../../apps/moderator/src/layout/OperateLayout.tsx) — the three-pane shell. `bottomStrip` lands in the `operate-bottom-strip` grid area.
- [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts) — `CaptureMode` enum (`idle | capture-statement | decompose | capture-defeater | operationalization | warrant-elicitation | meta-move | axiom-mark`). `mod_mode_banner` will key its copy off this; the scaffold reserves a `bottom-strip-mode-banner` sub-slot for it.
- [docs/moderator-ui.md — Layout (sketch)](../../../docs/moderator-ui.md) — the bottom-strip is described as the capture surface for statement text + classification + edge-role + propose.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the slot/region behaviors verified here are committed Vitest cases, not throwaway probes.

## Constraints / requirements

- **Empty scaffold, no business logic.** No store reads, no event emission, no i18n catalog keys. The five sub-slots take optional `ReactNode` props (`modeBanner`, `textInput`, `classificationPalette`, `edgeRoleSelector`, `proposeAction`) so the downstream tasks fill them by passing children — exactly the slot-mechanism `mod_layout_shell` established.
- **Stable `data-testid` selectors.** Six identifiers so downstream tasks and tests can target them without re-deciding the DOM shape:
  - `bottom-strip-capture` — the outer pane region.
  - `bottom-strip-mode-banner` — `mod_mode_banner`'s slot.
  - `bottom-strip-text-input` — `mod_capture_text_input`'s slot.
  - `bottom-strip-classification` — `mod_classification_palette`'s slot.
  - `bottom-strip-edge-role` — `mod_edge_role_selector`'s slot.
  - `bottom-strip-propose-action` — `mod_propose_action`'s slot.
- **Accessibility.** The outer pane is `role="region"` with `aria-label="Capture pane"`. Screen readers announce the strip as a labelled landmark; the per-sub-slot accessibility (input labels, button labels, palette ARIA) lands with each downstream task.
- **Tailwind palette consistent with the shell.** `bg-slate-100` surface, `border-slate-200` separators, matching the right-sidebar palette in `<OperateLayout>` so the pane visually belongs to the same shell.
- **Placeholder copy per sub-slot.** Each slot renders a short bracketed marker (`[mode banner]`, `[statement text]`, `[classification]`, `[edge role]`, `[propose]`) when no child is passed. The markers are `aria-hidden="true"` so they don't pollute the labelled region announcement; visual QA sees the strip is wired but unimplemented; downstream tasks delete the placeholder simply by passing a child element.
- **Wired into `OperateRoute`.** `apps/moderator/src/routes/Operate.tsx` mounts `<BottomStripCapture />` into the shell's `bottomStrip` slot. No other change to the route.

## Acceptance criteria

- `<BottomStripCapture>` component under `apps/moderator/src/layout/BottomStripCapture.tsx` renders the outer pane + five sub-slots with the six stable `data-testid` IDs.
- The outer pane is reachable as `screen.getByRole('region', { name: 'Capture pane' })`.
- `OperateRoute` mounts `<BottomStripCapture />` into the shell's `bottomStrip` slot.
- Committed Vitest cases (ADR 0022) cover: (a) the outer pane testid + labelled region role, (b) all five sub-slot test ids, (c) placeholder copy in every sub-slot when no children are passed, (d) each render-prop slot routes its child into the correct sub-slot.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Slot mechanism: five `ReactNode` props on `<BottomStripCapture>`** — symmetric with the three render-prop slots `<OperateLayout>` already uses. The downstream tasks (`mod_mode_banner`, `mod_capture_text_input`, `mod_classification_palette`, `mod_edge_role_selector`, `mod_propose_action`) each replace one slot by passing a child. No store wiring in the scaffold.
- **Outer region a `role="region"` with `aria-label="Capture pane"`** — the strip is a major navigation landmark on the operate route; labelling it as a region surfaces it to assistive tech without committing to a more specific role (e.g. `role="form"`) that the downstream sub-surfaces may want to override.
- **Placeholder copy is `aria-hidden="true"`** — the bracketed `[mode banner]` / `[propose]` markers are visual scaffolding, not content. Screen readers should hear the region label and the (eventual) child content; they shouldn't read `"left bracket mode banner right bracket"`.
- **No i18n keys yet.** This task is the empty scaffold; the strings each sub-surface needs (mode-banner copy keyed off `CaptureMode`, classification labels, edge-role labels, propose button) land with the downstream tasks via the `methodology.*` / new `chrome.capture.*` catalog keys those refinements introduce.
- **No store wiring.** The shell stays structure-only by `mod_layout_shell` precedent; the strip follows. `mod_mode_banner` will be the first to read `useCaptureStore((s) => s.mode)` and inject a `modeBanner` child.
- **Tailwind palette matches the shell's right-sidebar** (`bg-slate-100`, `border-slate-200`) — the strip and the sidebar are both ancillary surfaces around the central graph; styling them with the same palette keeps the eye anchored on the canvas. Pixel sizing on sub-slots is placeholder until `packages/ui-tokens` lands.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/layout/BottomStripCapture.tsx` — empty scaffold with five `ReactNode` props (`modeBanner`, `textInput`, `classificationPalette`, `edgeRoleSelector`, `proposeAction`), six stable `data-testid` IDs (`bottom-strip-capture` outer + the five sub-slots), `role="region"` with `aria-label="Capture pane"`, Tailwind palette consistent with `<OperateLayout>` (`bg-slate-100`, `border-slate-200`), and `aria-hidden` placeholder copy per slot so the pane reads as wired-but-unimplemented when no children are passed.
- New `apps/moderator/src/layout/BottomStripCapture.test.tsx` — 9 committed Vitest cases (ADR 0022) covering: outer testid render, labelled region role, five sub-slot test ids, placeholder copy in each empty sub-slot, and per-slot child routing for each of the five `ReactNode` props.
- `apps/moderator/src/routes/Operate.tsx` — mounts `<BottomStripCapture />` into the shell's `bottomStrip` slot; the existing `route-operate` + `session-id` testids that `App.test.tsx` asserts remain untouched.
- Smoke tests: 1507 → 1516 (+9). `pnpm run test:smoke` green. `pnpm -F @a-conversa/moderator build` succeeds (vite emits the bundle with the new component's CSS utilities). `pnpm run check` clean. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers (`mod_mode_banner`, `mod_capture_text_input`, `mod_classification_palette`, `mod_edge_role_selector`, `mod_propose_action`) replace each placeholder by passing a child element into the matching sub-slot prop — no scaffold changes required.
