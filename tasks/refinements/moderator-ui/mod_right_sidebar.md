# Moderator right sidebar (stacked sub-panes scaffold)

**TaskJuggler entry**: `moderator_ui.mod_layout.mod_right_sidebar` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `moderator_ui.mod_layout.mod_layout_shell` (settled — `<OperateLayout>` exists with a named `rightSidebar` slot and stable `operate-right-sidebar` test id).

Source: `tasks/30-moderator-ui.tji` `moderator_ui.mod_layout.mod_right_sidebar`.

## What this task is

Land the right-sidebar component that holds a stack of named sub-panes inside the `rightSidebar` slot of `<OperateLayout>`. The component owns the **stack geometry** (titled accordion-style panes, each independently collapsible, each carrying a stable `data-testid` and an `aria-labelledby` region for accessibility), the **header chrome** (pane title + expand/collapse toggle), and the **empty-state placeholder** (`chrome.hello` until downstream tasks plug content into each slot). The actual pane content is owned by downstream tasks: `mod_pending_proposals_pane`, `mod_diagnostic_flow` / `mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane`, and `mod_change_history_pane`.

## Why it needs to be done

[docs/moderator-ui.md](../../../docs/moderator-ui.md#layout-sketch) sketches the right sidebar as three stacked panes: pending proposals, diagnostic flags, change history. `uiStore.SidebarPane` already enumerates those three keys. Until the stacked container exists with named slots, each downstream pane task would have to re-decide its mounting affordance — the per-pane title, the expand/collapse toggle, the aria wiring, the visual separator between panes — and the three siblings would race on the geometry. This task settles the container so the three pane-content tasks plug into the slot map.

## Inputs / context

- [docs/moderator-ui.md — Layout (sketch)](../../../docs/moderator-ui.md#layout-sketch) — the three-pane right-sidebar description.
- [tasks/refinements/moderator-ui/mod_layout_shell.md](mod_layout_shell.md) — the `<OperateLayout>` shell + the `rightSidebar` render-prop slot the sidebar mounts into.
- `apps/moderator/src/stores/uiStore.ts` — exposes `SidebarPane = 'pending-proposals' | 'change-history' | 'diagnostic-flags'` and `setActiveSidebarPane`. The right-sidebar reads `activeSidebarPane` to highlight the currently-foregrounded pane header.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every verification of pane scaffold behaviour lands as a committed Vitest test.
- [ADR 0024 (i18n)](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — pane titles + placeholder copy go through `@a-conversa/i18n-catalogs` per the i18n discipline.
- [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) `mod_pending_proposals_pane`, `mod_change_history_pane`, `mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane` — the three downstream consumers each replace one empty slot with real content.

## Constraints / requirements

- **Three named slots.** `<RightSidebar>` exposes three optional `ReactNode` slot props (`pendingProposalsSlot`, `diagnosticFlagsSlot`, `changeHistorySlot`) — one per `SidebarPane` key. Downstream tasks set the matching prop; the sidebar itself stays content-free.
- **Stable `data-testid` per pane.** The container test id is `operate-right-sidebar-stack`; each pane block carries `right-sidebar-pane-<key>` (`right-sidebar-pane-pending-proposals`, `right-sidebar-pane-diagnostic-flags`, `right-sidebar-pane-change-history`). Each pane header carries `right-sidebar-pane-header-<key>` and each pane body carries `right-sidebar-pane-body-<key>`.
- **Accessibility.** Each pane block is a `<section>` with `role="region"` and `aria-labelledby` pointing at its header's `id`. Each header is a `<button>` with `aria-controls` pointing at its body's `id` and `aria-expanded` reflecting expanded state.
- **Independent expand/collapse.** Each pane has its own boolean expanded state with default `true` (downstream content visible by default). Clicking a header toggles only that pane; multiple panes may be expanded simultaneously. The expand/collapse state is local component state (the panes are stack-visible at all times; `uiStore.activeSidebarPane` tracks foregrounding semantics separately and is not toggled by collapse).
- **Active-pane highlighting.** The pane whose key matches `uiStore.activeSidebarPane` gets a highlighted header (Tailwind: `bg-slate-200` vs `bg-slate-100`). Clicking a header also sets that pane as active via `setActiveSidebarPane` — this is the "click to foreground" semantic the docs sketch implies.
- **Empty-state placeholder.** When a slot is unset (`undefined`), the body renders a localized "coming soon" placeholder so the geometry is visible during the build-out phase. The placeholder copy is a single i18n key: `moderator.rightSidebar.emptyPanePlaceholder` (defaulting to "Coming soon" in en-US). Downstream content replaces it entirely once the slot is filled.
- **i18n.** Pane titles ship as catalog keys `moderator.rightSidebar.panes.pendingProposals.title`, `…diagnosticFlags.title`, `…changeHistory.title` in all three v1 locales (en-US / pt-BR / es-419). The expand/collapse button has an `aria-label` derived from `moderator.rightSidebar.toggleAria` (a two-state ICU key parameterized by `{expanded}`).
- **Tailwind only.** No new stylesheets; the sidebar uses utility classes consistent with `<OperateLayout>`'s `bg-slate-100` / `border-slate-200` palette.
- **No business logic.** The sidebar reads `useUiStore` for active-pane state only. It does not subscribe to any other store, does not touch `wsStore`, does not own proposal / history / diagnostic data.

## Acceptance criteria

- `<RightSidebar>` component under `apps/moderator/src/layout/RightSidebar.tsx` renders three pane blocks with the stable `data-testid` selectors and the three slot props.
- `OperateRoute` composes `<RightSidebar />` into `<OperateLayout>`'s `rightSidebar` prop.
- Committed Vitest cases under `apps/moderator/src/layout/RightSidebar.test.tsx` cover: (a) three pane blocks render with their test ids, (b) each slot prop lands in its pane body, (c) empty-state placeholder renders when a slot is omitted, (d) clicking a header toggles `aria-expanded` and hides/shows the body, (e) clicking a header calls `setActiveSidebarPane`, (f) the active pane header has the highlight class, (g) accessibility wiring (`role="region"`, `aria-labelledby`, `aria-controls`) is present.
- New i18n keys (`moderator.rightSidebar.*`) ship in en-US / pt-BR / es-419 catalogs; a round-trip test (or a small assertion suite next to `RightSidebar.test.tsx`) verifies each key resolves to a non-empty, locale-distinct string in each locale.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Stack model: all panes visible, each independently collapsible.** The docs sketch shows three stacked panes side-by-side in the sidebar — not an accordion where only one is open. Each pane has its own collapse toggle with default-expanded so downstream content is visible the moment it lands. `uiStore.activeSidebarPane` tracks the "currently foregrounded" semantic (for keyboard focus, hint banners, downstream "scroll to active" affordances) and is **set** by clicking a header, but **not** mutually exclusive with expand/collapse.
- **Three fixed pane keys, matching `uiStore.SidebarPane`.** No dynamic pane list yet. The set is closed at compile time; adding a fourth pane is a deliberate edit to the `SidebarPane` enum plus a new slot prop on `<RightSidebar>` plus catalog keys for its title.
- **Empty slot = placeholder, not hidden.** During the build-out phase the panes are visible even before content lands; the placeholder string anchors the geometry and reassures the reader the slot is wired correctly. Once a downstream task fills its slot, the placeholder disappears.
- **Active-pane highlight via Tailwind `bg-slate-200`.** Same palette as `<OperateLayout>`; a deeper-than-base background distinguishes the active pane's header from the rest.
- **No keyboard-shortcut support yet.** `mod_keyboard_shortcuts` (downstream group) owns the global keymap; this task does not register shortcuts for switching panes. Click-to-foreground is sufficient scaffolding.
- **No `aria-current="true"` on the active pane.** ARIA's `aria-current` is for navigation lists (a current page in a pagination, a current step in a wizard); a foregrounded sidebar pane is not "currently selected" in that sense — it's "where the moderator is most-recently focused." The active-pane state ships as a Tailwind highlight class only; ATs read the button labels normally without a misleading `aria-current` announcement.

## Open questions

(none — all decided; downstream tasks own per-pane content choices.)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/layout/RightSidebar.tsx` — a stack of three `<section role="region">` blocks (`right-sidebar-pane-pending-proposals`, `right-sidebar-pane-diagnostic-flags`, `right-sidebar-pane-change-history`) inside a `flex-col` container with `data-testid="operate-right-sidebar-stack"`. Each pane has its own collapse toggle (default expanded), its own `aria-controls` / `aria-labelledby` wiring (ids derived via `useId`), and its own `data-active` attribute set from `uiStore.activeSidebarPane`. The component takes three optional slot props (`pendingProposalsSlot`, `diagnosticFlagsSlot`, `changeHistorySlot`) and renders a localized `"Coming soon"` placeholder for unfilled slots. Clicking a header toggles its expanded state AND calls `setActiveSidebarPane` so downstream tasks can hook foreground semantics (banner / scroll-to / shortcut) off the store without forcing the other panes to collapse.
- New `apps/moderator/src/layout/RightSidebar.test.tsx` — 28 committed Vitest cases (ADR 0022) covering: container + three pane test ids; per-slot routing into the matching body; empty-state placeholders; default-expanded baseline; per-pane collapse independence; click-to-foreground via `uiStore`; active-pane highlight (`bg-slate-200` vs `bg-slate-100`); `data-active` markers; `<section role="region">` + `aria-labelledby` wiring; `aria-controls` → body id wiring; localized `aria-label` on the toggle button (Collapse pane / Expand pane via ICU `{expanded}` selector); per-locale round-trip on the four new keys; non-en-US values differ from en-US; ICU toggleAria string resolves in all three v1 locales.
- `apps/moderator/src/routes/Operate.tsx` — passes `<RightSidebar />` to `<OperateLayout>`'s `rightSidebar` slot. The graph-pane stub from `mod_layout_shell` stays untouched (downstream `mod_graph_canvas_pane` replaces it).
- New i18n keys in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`:
  - `moderator.rightSidebar.emptyPanePlaceholder` — "Coming soon" / "Em breve" / "Próximamente"
  - `moderator.rightSidebar.toggleAria` — ICU `{expanded, select, true {Collapse pane} other {Expand pane}}` (mirrored pt-BR / es-419)
  - `moderator.rightSidebar.panes.pendingProposals.title` — "Pending proposals" / "Propostas pendentes" / "Propuestas pendientes"
  - `moderator.rightSidebar.panes.diagnosticFlags.title` — "Diagnostic flags" / "Sinalizações diagnósticas" / "Indicadores diagnósticos"
  - `moderator.rightSidebar.panes.changeHistory.title` — "Change history" / "Histórico de mudanças" / "Historial de cambios"
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes (54 keys, parity across the three locales).
- Smoke tests: 1507 → 1535 (+28 Vitest cases under `RightSidebar.test.tsx`). `pnpm run check` clean, `pnpm run test:smoke` green, `pnpm -F @a-conversa/moderator build` produces the bundled CSS containing the new `bg-slate-200` / `border-slate-200` utilities. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — `mod_pending_proposals_pane`, `mod_change_history_pane`, `mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane` — replace the empty placeholder of each pane by passing the matching `*Slot` prop into `<RightSidebar>` (typically by composing them inside `OperateRoute`). The scaffold itself does not change when slots fill in.
