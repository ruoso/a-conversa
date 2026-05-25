# mod_role_palette_on_drop — role-pick popover at the drop point fires the connecting-edge proposal

**TaskJuggler entry**: `moderator_ui.mod_capture_flow.mod_draw_edge_flow.mod_role_palette_on_drop` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at lines 480-484).

## Effort estimate

**1d** (per the `.tji` allocation). The component itself is a sibling-submenu mirror of `<AxiomMarkSubmenu>` / `<EditWordingSubmenu>`; the load-bearing work is the in-flight gate on the propose envelope, the inline wire-error region, and the role enumeration + i18n catalog plumbing.

## Inherited dependencies

**Settled:**

- [`mod_drag_to_create_edge`](./mod_drag_to_create_edge.md) (sibling task that owns the `onConnect` + `onConnectEnd` plumbing on `<GraphCanvasPane>`. This task mounts the picker the sibling renders when the canvas state is set. The two land together in one commit cluster — `.tji` declares `mod_role_palette_on_drop depends !mod_drag_to_create_edge` so the order is pinned.)
- [`mod_edge_role_selector`](./mod_edge_role_selector.md) (done — pins the canonical `EDGE_ROLES` order + the i18n catalog keys for `methodology.edgeRole.<role>.label` / `methodology.edgeRole.<role>.description` this picker re-uses verbatim. Single source of truth — keyboard-shortcut chips also share the `EDGE_ROLE_TO_SHORTCUT` table.)
- [`mod_set_edge_substance_endpoint_carriage`](./mod_set_edge_substance_endpoint_carriage.md) (done — the wire path the picker fires into. The `set-edge-substance` connecting case carries `source_node_id` / `target_node_id` / `role` + a substance value; the server emits `edge-created` + `entity-included(edge)` + `proposal` per the fresh-edge predicate.)
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) §1 + §5 + §10. The connecting-edge gesture creates an edge whose shape facet enters life with the inline role as candidate and whose substance facet enters life as `proposed` (with the picker's submitted `value: 'agreed'`); the cross-facet sequence gate accepts the fresh-edge case bypass per `pf_shape_facet_wire_vote` line 37.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every empirical check ships as a committed test.

**Pending:** (none — every input is settled on `main`.)

## What this task is

Implement `<DrawEdgeRolePicker>` — the small cursor-anchored popover that the canvas mounts when the moderator's drag-from-handle-to-handle gesture lands a valid `{source, target}` pair. The picker:

1. Renders the seven `EDGE_ROLES` as buttons in canonical order with localized labels + tooltip descriptions + uppercase keyboard-mnemonic chips (`S` / `R` / `Q` / `B` / `G` / `E` / `X` — same chips `<EdgeRoleSelector>` shows).
2. On a click, fires a `set-edge-substance` proposal envelope carrying `source_node_id` / `target_node_id` / `role` + `value: 'agreed'`. The fresh edge id is minted client-side via `crypto.randomUUID()`.
3. Closes itself on success.
4. Surfaces an inline wire-error region (`data-testid="draw-edge-role-picker-error"`) when the propose round-trip rejects; the picker stays open so the moderator can retry.
5. Closes on Escape and on outside-mousedown (the same close-paths `<AxiomMarkSubmenu>` + `<GraphContextMenu>` use).
6. Disables all role buttons during the in-flight window so a double-click cannot land two envelopes.

## Why it needs to be done

The sibling [`mod_drag_to_create_edge`](./mod_drag_to_create_edge.md) handlers capture the drop pair but produce no UI affordance on their own — the canvas must mount something at the drop point so the moderator can name the relationship. Without this picker, the gesture is inert: the drag completes and nothing happens. The picker is the load-bearing UI surface that converts a structural gesture into a methodology proposal.

The reason it is a popover rather than a single-click default role: every drag-to-create-edge gesture in the methodology asserts a specific argumentative relation (supports / rebuts / contradicts / qualifies / bridges / defines), and a sensible default does not exist — picking the wrong role then having to retract the proposal is more friction than picking the right role from a 7-button palette on first try.

The reason substance defaults to `'agreed'`: by drawing the edge, the moderator is asserting the relation holds. Participants who disagree about the relation's substance will move the substance facet via the per-edge affordance after the shape facet settles; they do not need an "opt out of asserting substance" choice at the drag-create gate. The default keeps the gesture single-pick.

## Inputs / context

- [`apps/moderator/src/graph/DrawEdgeRolePicker.tsx`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx) — the component file this task lands.
- [`apps/moderator/src/layout/EdgeRoleSelector.tsx`](../../../apps/moderator/src/layout/EdgeRoleSelector.tsx) — the sibling button-row palette in the bottom-strip capture pane. The picker reuses its role iteration + i18n catalog keys verbatim; the visual styling diverges (the picker is a popover, not an inline horizontal row).
- [`apps/moderator/src/layout/AxiomMarkSubmenu.tsx`](../../../apps/moderator/src/layout/AxiomMarkSubmenu.tsx) — the sibling-submenu close-path mirror (Escape + outside-click; `position: fixed`; `z-index: 60`).
- [`packages/i18n-catalogs/src/keyboard-shortcuts.ts`](../../../packages/i18n-catalogs/src/keyboard-shortcuts.ts) — `EDGE_ROLES` + `EDGE_ROLE_TO_SHORTCUT`. Single source of truth for the seven roles + their keyboard mnemonics.
- [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/) — the `moderator.drawEdgePicker.*` keys this task adds (`header`, `errorPrefix`, `timeoutError`). Three-locale parity per ADR 0024.

## Constraints / requirements

- **Reuse `EDGE_ROLES` + `EDGE_ROLE_TO_SHORTCUT` from `@a-conversa/i18n-catalogs`.** Don't inline the role list — single source of truth so a future role addition propagates automatically. The picker iterates `EDGE_ROLES` and looks up `EDGE_ROLE_TO_SHORTCUT[role]` for the chip text.
- **Reuse `methodology.edgeRole.<role>.{label,description}` i18n keys.** Don't duplicate the role labels into a `moderator.drawEdgePicker.*` namespace — the methodology vocabulary is the source of truth and `<EdgeRoleSelector>` already reads from the same keys.
- **In-flight gate prevents double-click.** Per `useProposeSetEdgeSubstanceAction`'s precedent the picker tracks an in-flight boolean; while in-flight, every role button is `disabled` AND Escape / outside-click close paths are suppressed (the moderator can't dismiss mid-flight; the request must settle first).
- **Inline error region on wire-error.** When the propose envelope rejects, the picker surfaces the error message inside `<div data-testid="draw-edge-role-picker-error">` under the role buttons (matches the `<AxiomMarkSubmenu>` error region's data-testid + visual treatment). The picker does NOT auto-close on error; the moderator dismisses explicitly via Escape / outside-click after reading the message.
- **Position is `position: fixed`** at the drop cursor coordinates the sibling refinement's canvas state passed in. No projection through ReactFlow's viewport transform — the drop event already carries client coordinates.
- **Three-locale i18n catalog parity per ADR 0024.** The new `moderator.drawEdgePicker.*` keys land in all three locale catalogs (`en-US`, `pt-BR`, `es-419`). The `methodology.edgeRole.*` keys are already three-locale per `mod_edge_role_selector`.

## Acceptance criteria

**Pinned per ADR 0022 — every check ships as a committed test.**

Vitest:

- New [`apps/moderator/src/graph/DrawEdgeRolePicker.test.tsx`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.test.tsx) — five cases:
  - Seven role buttons render in canonical `EDGE_ROLES` order.
  - Click on a role button fires a `set-edge-substance` proposal envelope with `kind: 'set-edge-substance'`, the four endpoint fields (`source_node_id`, `target_node_id`, `role`), `value: 'agreed'`, and a freshly-minted UUID `edge_id`. Closes the picker on success.
  - Escape closes the picker.
  - Outside-mousedown closes the picker.
  - On a `WsRequestError`, the picker stays open and renders the inline error region (`data-testid="draw-edge-role-picker-error"`) containing the wire-supplied message.

Playwright e2e:

- New [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) — single 3-browser session (alice / ben / maria) drives the full propose-then-commit chain: alice proposes two free-floating statements, drags from N1.source-handle to N2.target-handle, picks the `supports` role, verifies the picker mounts at the drop point + carries both node UUIDs on `data-source-id` / `data-target-id`, verifies the proposed edge surfaces on alice's canvas with `data-facet-status="proposed"` AND on both debater tablets via `participant-edge-status`, drives both debaters' agree votes on the shape + substance facet rows of the participant detail panel, alice commits the shape facet via `edge-shape-commit-affordance` and then the `set-edge-substance` proposal via the `pending-proposals-pane` `commit-button`. Tolerant of cross-context broadcast races at the vote / commit phases per the methodology-full-flow precedent.

Build + scheduler:

- `pnpm run check` clean.
- `pnpm run test:smoke` green (Vitest baseline +5).
- `pnpm -F @a-conversa/moderator build` clean.
- `pnpm -F @a-conversa/i18n-catalogs build` clean.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_role_palette_on_drop`.

## Decisions

- **D1 — Substance defaults to `'agreed'`.** The moderator's drag gesture asserts the relation holds; substance defaults follow. Alternative considered: render a second row of substance buttons (`agreed` / `disputed`) below the role row. Rejected — the user's request is "ask what type of relationship" (singular); a two-row picker doubles the click target. Participants who disagree about substance move it via the per-edge affordance after the shape facet settles; the default does not foreclose that path.
- **D2 — Picker reuses `methodology.edgeRole.*` i18n keys (not a `moderator.drawEdgePicker.*` namespace).** The methodology vocabulary is the source of truth for role labels and descriptions; duplicating it into a moderator-only namespace would create drift the next time a role's description gets refined. The picker's own namespace (`moderator.drawEdgePicker.*`) is reserved for surface-specific strings (the header text, the error region prefix, the timeout message).
- **D3 — In-flight gate suppresses Escape / outside-click.** During the in-flight window the user cannot accidentally dismiss the picker before the propose round-trip settles; the cancel path is intentionally blocked to prevent a "did my click work?" race. Alternative considered: allow Escape to abort the round-trip via `AbortController`. Rejected — the wire-level surface doesn't support cancellation, and surfacing a cancel UI for an action that doesn't actually cancel is a worse user experience than blocking the close path for ~100ms.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-05-25.

- New component at [`apps/moderator/src/graph/DrawEdgeRolePicker.tsx`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx) — `position: fixed` popover with seven role buttons, in-flight gate, inline error region, Escape + outside-mousedown close paths.
- Five Vitest cases at [`apps/moderator/src/graph/DrawEdgeRolePicker.test.tsx`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.test.tsx) pin the role enumeration order, the `set-edge-substance` envelope shape (all four endpoint fields + `value: 'agreed'`), the close-paths (Escape, outside-mousedown), and the wire-error region.
- Three-locale i18n catalog entries added to [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/) — `moderator.drawEdgePicker.{header,errorPrefix,timeoutError}`.
- 3-browser Playwright spec [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) drives the full chain: drag-create → cross-surface broadcast → shape vote → shape commit → substance vote → substance commit. Tolerant-acceptance pattern (per methodology-full-flow precedent) absorbs cross-context broadcast races at the vote / commit phases.
- The sibling [`mod_drag_to_create_edge`](./mod_drag_to_create_edge.md) refinement ships the `<GraphCanvasPane>` `onConnect` + `onConnectEnd` plumbing that mounts this picker.
- `pnpm run check` green; `pnpm run build` green (server + shared-types + moderator + audience + participant all clean).
