# Moderator snapshot visual marker — top-left overlay on the graph canvas listing snapshot labels in reverse-chronological order

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_snapshot_flow.mod_snapshot_visual_marker`.

```
task mod_snapshot_flow "F10 — Snapshot a segment" {
  depends !mod_capture_flow, root_app.root_moderator_cutover, backend.websocket_protocol.ws_snapshot_message
  task mod_snapshot_visual_marker "Visual marker on graph for snapshot point" {
    effort 0.5d
    allocate team
    depends !mod_snapshot_action
  }
}
```

## Effort estimate

**0.5d.** Confirmed. The deliverable is two small frontend artefacts plus their colocated tests:

1. A pure selector `projectSnapshots(events) → Snapshot[]` (~30 lines) added to [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — walks the event log, picks `snapshot-created` events, and projects each to `{ snapshotId, label, logPosition, createdAt }`. Mirrors the [`projectPendingAxiomMarks`](../../../apps/moderator/src/graph/selectors.ts) shape (event-stream input → flat record array output). Pure function; no React, no store reads.
2. A presentational `<SnapshotMarkerStrip>` component (~80 lines) at `apps/moderator/src/graph/SnapshotMarkerStrip.tsx` — small fixed-corner overlay mounted as a sibling of the `<ReactFlow>` element inside `<GraphCanvasPane>`. Reads `events` from `useWsStore`, calls `projectSnapshots(events)`, renders a vertical stack of label cards at `absolute top-4 left-4 z-10` (mirror of the `absolute right-4 top-4 z-10` tidy-up button on the opposite corner). Hidden entirely when the list is empty.

Plus a five-key i18n addition (`moderator.snapshotMarker.{stripAriaLabel, header, overflowLabel}` + pt-BR / es-419 review flags — note: ICU plural for `overflowLabel` collapses three potential keys into one), one Vitest file per artefact, and one Playwright `test()` block added to the existing carrier spec `apps/moderator/tests/e2e/moderator-snapshot.spec.ts` (created by `mod_snapshot_action`, extended by `mod_snapshot_label_input`). This pays down the deferred-e2e debt that `mod_snapshot_label_input` registered against this task — the "labeled-snapshot event arrives → marker renders" scenario.

This task is **independent of the trigger flag** (`useSnapshotFlowStore`) — the marker reads the event log directly, so it renders whenever a `snapshot-created` event exists in the projection regardless of whether the label-input modal is open. It is also independent of the backend write-side (already landed by `ws_label_snapshot_message` and `snapshot_create_logic` per `mod_snapshot_label_input.md`'s Inherited dependencies, both shipped 2026-05-31).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- **`moderator_ui.mod_snapshot_flow.mod_snapshot_action`** (done — 2026-05-31) — declared dependency per the WBS. Provides the testability seam `data-snapshot-flow-open` on `operate-layout-root` per [`mod_snapshot_action.md`](mod_snapshot_action.md) (used by this task's Playwright spec to assert the flow opens / closes around the marker-rendering check, but the marker itself is independent of the trigger).
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`** (done — 2026-05-31) — not a declared dependency in the .tji, but a *functional prerequisite* for the e2e test: without the modal, the spec cannot dispatch a `label-snapshot` envelope through the moderator UI to produce a `snapshot-created` event to render the marker for. The Vitest coverage of the selector + component is independent of this and exercises injected event streams. See [`mod_snapshot_label_input.md`](mod_snapshot_label_input.md).
- **`backend.websocket_protocol.ws_label_snapshot_message`** (done — 2026-05-31, commit `48101a71`) — the write-side WS handler that mints the `snapshot-created` event reaching the projection.
- **`data_and_methodology.methodology_engine.snapshot_create_logic`** (done — 2026-05-31, commit `55238da1`) — the engine handler producing the payload `{ snapshot_id, label, log_position }`.
- **`data_and_methodology.event_types.snapshot_events`** (done — 2026-05-10) — `snapshot-created` event kind and `snapshotCreatedPayloadSchema` at [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts).
- **`moderator_ui.mod_graph_canvas_pane`** (done) — `<GraphCanvasPane>` at [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) is the canvas container the marker mounts inside. The fixed-corner overlay pattern is established: the tidy-up button uses `absolute right-4 top-4 z-10` ([`GraphCanvasPane.tsx:1709-1718`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)); this task mirrors it on the top-left.
- **`moderator_ui.mod_shell.mod_ws_client`** (done — 2026-05-11). `useWsStore` exposes `session.events` (the appended event log per ADR 0021), which is the marker's input. **The WS store contract intentionally does NOT carry a `snapshots[]` field** (see [`packages/shell/src/ws/store-contract.ts:50-81`](../../../packages/shell/src/ws/store-contract.ts) — `BaseWsSessionState` lists `lastAppliedSequence`, `events`, `pendingProposalFacetStatus`, `activeDiagnostics`, `lastDiagnostic` and nothing else). Decision §1 records why this task derives snapshots from the event stream rather than widening the contract.
- **`moderator_ui.mod_capture_flow.mod_graph_canvas_pane`** — pattern: `apps/moderator/src/graph/selectors.ts` is the canonical home for event-derived selectors (`projectAxiomMarks`, `projectPendingAxiomMarks`, `projectAnnotationNodes`, etc.). `projectSnapshots` joins them.
- **`frontend_i18n.i18n_library_choice`** / **`i18n_catalog_workflow`** / **`i18n_locale_negotiation`** / **`i18n_testing`** (done — `useTranslation()` API, `*.review.json` PENDING-flag lifecycle, parity round-trip pattern, ICU plural support).
- **[ADR 0021 — Event envelope schema-on-write](../../../docs/adr/0021-event-envelope.md)** — the event log this task reads.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — the `useTranslation()` API the overlay consumes.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_change_history_pane`** (downstream — depends on `!mod_layout.mod_right_sidebar`, etc.; see [`tasks/30-moderator-ui.tji:631-650`](../../30-moderator-ui.tji)). The change-history scroller will render `snapshot-created` events as one entry kind among many per [docs/moderator-ui.md:228](../../../docs/moderator-ui.md). That display is in the sidebar, NOT on the graph; this task's canvas overlay is the on-graph affordance. They are complementary surfaces (Decision §2.c records why both coexist) — when the history pane lands, no rework of the marker is needed.
- **`frontend_i18n.i18n_snapshot_marker_native_review`** (registered by this task — see Decision §5 + Acceptance criteria). The pt-BR + es-419 drafts of the new keys land flagged PENDING; the follow-up replaces them with native-speaker-reviewed text. (Handled as a parking-lot entry per the standing 2026-05-30 item — no WBS task created.)

## What this task is

Land the **on-graph indicator** for F10 ("Snapshot a segment") on the moderator's operate route: a small overlay strip mounted on the top-left of the graph canvas that lists the most-recently-taken snapshots with their labels, derived from the projection's `snapshot-created` event stream. The strip is the answer to "did I already snapshot this moment? what did I label it?" without forcing the moderator to drop into the (future) change-history pane.

[docs/moderator-ui.md, F10 (lines 156–162)](../../../docs/moderator-ui.md):

> At natural breaks (commercial, end of segment, end of show).
> 1. **Trigger `Snapshot`** (shortcut or sidebar button).
> 2. **Type a label** (e.g., "Segment 1 close").
> 3. **The current event-log position is named**; replay can refer to this snapshot.

This task implements the *visual feedback* for step 3 — the moderator can see, on the graph, that a snapshot was taken and what its label is. The replay-side consumer (`replay_test.*` stream) is independent; this task surfaces the snapshot only in the live operator view.

Concretely the deliverable is:

- **One new selector** in [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts):
  ```typescript
  export interface Snapshot {
    snapshotId: string;
    label: string;
    logPosition: number;
    createdAt: string;
  }

  export function projectSnapshots(events: readonly Event[]): Snapshot[] {
    const out: Snapshot[] = [];
    for (const event of events) {
      if (event.kind !== 'snapshot-created') continue;
      const payload = event.payload;
      out.push({
        snapshotId: payload.snapshot_id,
        label: payload.label,
        logPosition: payload.log_position,
        createdAt: event.createdAt,
      });
    }
    return out;
  }
  ```
  Iteration order mirrors the event log (chronological). The component reverses for display (Decision §3). Pure; no Map keying needed (snapshots are immutable — once minted, never amended; no terminator events to filter against, unlike `projectPendingAxiomMarks`'s proposal-→-commit lifecycle).
- **One new presentational component**: `apps/moderator/src/graph/SnapshotMarkerStrip.tsx` — small vertical stack at `absolute top-4 left-4 z-10` inside `<GraphCanvasPane>`'s outer `<div>`. Structure:
  - Outer container: `<div data-testid="snapshot-marker-strip" role="region" aria-label={t('moderator.snapshotMarker.stripAriaLabel')} className="absolute top-4 left-4 z-10 ..." />`. **Rendered only when at least one snapshot exists** — empty state collapses to `null` (Decision §4).
  - Header `<h3>` reading `moderator.snapshotMarker.header` ("Snapshots") with the count appended.
  - Stack of cards: `<ol>` listing **up to `MAX_VISIBLE_SNAPSHOTS = 5`** in reverse-chronological order (newest first — Decision §3). Each card `<li data-testid="snapshot-marker-{snapshotId}" data-log-position="{logPosition}" data-snapshot-label="{label}">`, with the label as visible text and a small subscript showing `#{logPosition}`.
  - **Overflow indicator** (when `snapshots.length > MAX_VISIBLE_SNAPSHOTS`): a final `<li data-testid="snapshot-marker-overflow">` with localized text from `moderator.snapshotMarker.overflowLabel` (ICU plural: `"{n, plural, one {# more snapshot} other {# more snapshots}}"`).
- **One composition update** in [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx): import `<SnapshotMarkerStrip>` and mount it as a sibling of the tidy-up button (inside the outer container, after the `<ReactFlow>` close tag, before the context-menu block at line 1719). The component reads its own `events` from `useWsStore`; no props are threaded down from `GraphCanvasPane`.
- **Three new i18n keys** in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` under `moderator.snapshotMarker`:
  - `stripAriaLabel` — region label ("Snapshot markers").
  - `header` — strip header ("Snapshots ({n, number})").
  - `overflowLabel` — overflow indicator ICU plural ("{n, plural, one {# more snapshot} other {# more snapshots}}").

## Why it needs to be done

F10 visibility requires this:

- After the snapshot modal closes on submit success, the moderator currently has **no on-graph confirmation** that the snapshot landed. The modal disappears; the trigger flag flips to `false`; the `snapshot-created` event flows to the projection silently. Without the marker, F10's "the event-log position is named" step is invisible to the operator on the canvas.
- The (future) change-history pane will show snapshots inline with other events, but that pane is sidebar-scoped and not yet landed. The graph canvas is where the moderator's attention lives during a live debate; the on-graph marker is the lower-friction confirmation.
- `mod_snapshot_label_input` registered a deferred-e2e against this task ("labeled-snapshot event arrives → marker renders"). Paying that debt down requires this task to land the renderer and the matching Playwright scenario in the same spec.

Without this 0.5d marker, F10's three-step flow ships without on-canvas feedback for step 3, and the deferred-e2e debt sits open.

## Inputs / context

- [docs/moderator-ui.md — F10 Snapshot a segment, lines 156–162](../../../docs/moderator-ui.md) — the three-step UX. This task is the visualization of step 3.
- [docs/moderator-ui.md — Change history pane, lines 224–233](../../../docs/moderator-ui.md) — "Event kind (proposal / vote / commit / withdraw-agreement / withdraw-proposal / snapshot / etc.)". Confirms snapshots are a sidebar-history concern as well; the canvas marker is a parallel surface, not a duplicate (Decision §2.c).
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1709-1718`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — the tidy-up button's fixed-corner overlay (`absolute right-4 top-4 z-10`). The snapshot marker mirrors this idiom on the top-left (Decision §2.a).
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1719-1769`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — the conditional-render overlays (context menu, axiom-mark submenu, annotate submenu, edit-wording submenu, draw-edge picker) — established pattern for overlays that mount inside the canvas container and read state from `useWsStore`. The marker follows this idiom but is always mounted (its own conditional collapses to `null` on empty state — Decision §4).
- [`apps/moderator/src/graph/selectors.ts:334-378`](../../../apps/moderator/src/graph/selectors.ts) — `projectPendingAxiomMarks` is the closest selector shape: events-in, flat-record-array-out. `projectSnapshots` is structurally simpler (no terminator events to track).
- [`apps/moderator/src/graph/selectors.ts:711-805`](../../../apps/moderator/src/graph/selectors.ts) — `projectAnnotationNodes` / `projectAnnotationHostEdges` etc.: another selector cluster the new one joins.
- [`packages/shared-types/src/events.ts:608-616`](../../../packages/shared-types/src/events.ts) — `snapshotCreatedPayloadSchema` (`{ snapshot_id: uuid, label: string (1..128), log_position: int positive }`). The selector projects this 1:1 to `Snapshot`.
- [`packages/shell/src/ws/store-contract.ts:50-81`](../../../packages/shell/src/ws/store-contract.ts) — `BaseWsSessionState` shape. **No `snapshots` field** — confirms the derive-from-events approach (Decision §1).
- [`packages/shell/src/ws/client.ts:272-274`](../../../packages/shell/src/ws/client.ts) — the `snapshot-state` envelope handler discards the wire payload's `snapshots` array; only `lastAppliedSequence` is captured into the store. This task's selector does NOT depend on the read-side WS query — it reads `session.events` which is populated by `event-applied` broadcasts.
- [`apps/moderator/src/layout/SnapshotLabelInputModal.tsx`](../../../apps/moderator/src/layout/SnapshotLabelInputModal.tsx) — the upstream modal whose successful submission produces the `snapshot-created` event the marker renders.
- [`tasks/refinements/moderator-ui/mod_snapshot_label_input.md`](mod_snapshot_label_input.md) — registered the deferred-e2e debt this task pays down.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](mod_axiom_mark_decoration.md) — reference for the selector → enrichment → component pattern (this task uses a simpler overlay variant — no per-node enrichment).

## Constraints / requirements

- **Source of truth: event stream.** The marker reads `session.events` via `useWsStore` and derives the snapshot list via `projectSnapshots(events)`. It does NOT widen `BaseWsSessionState`; it does NOT consume the `snapshot-state` envelope's projection.snapshots payload; it does NOT call the read-side `snapshot` WS request (Decision §1).
- **No coupling to the trigger flag.** `useSnapshotFlowStore.isLabelInputOpen` is NOT read by the marker. The strip renders based purely on the projection-derived list; whether the modal is open or closed is orthogonal.
- **Always-mounted component, empty-state-collapses.** The marker is unconditionally rendered inside `<GraphCanvasPane>`'s outer container — there is no conditional `{showMarker ? ... : null}` at the call site. The component's own render returns `null` when `snapshots.length === 0`. This keeps the call-site mounting trivial and avoids a parent-side subscription to derive a boolean (Decision §4).
- **Reverse-chronological display order.** The selector returns chronological (insertion order from the event log); the component reverses for display (newest first). Matches the change-history pane's "reverse chronological" convention.
- **Visible cap of `MAX_VISIBLE_SNAPSHOTS = 5`.** Live debates may accumulate 1–5 snapshots in a typical session (per segment); a six-card stack is the realistic ceiling. The cap prevents canvas-corner takeover in a long session or a replay-bound session with many segments. **Overflow surfaces as a final localized "N more snapshots" entry** so the moderator knows the visible list is truncated. The full list lives in the (future) change-history pane.
- **The cap is a hard-coded constant** in `SnapshotMarkerStrip.tsx`, not a prop or a setting. A future task can lift it to user-preference territory if usability surfaces a real need.
- **Fixed-corner positioning, top-left.** `absolute top-4 left-4 z-10` — mirror of the tidy-up button's `absolute right-4 top-4 z-10`. The top-left corner is free in v1 (no other overlays mount there). The strip's width is bounded (`max-w-[16rem]`) and content wraps if a label is long; long labels are truncated with `text-overflow: ellipsis` + `title` attribute for hover-reveal (no separate tooltip dependency).
- **Tailwind only.** No new stylesheets. The strip uses the moderator's slate palette (`bg-white`, `border-slate-200`, `text-slate-900`, `rounded-md`, `shadow-md` — same vocabulary as the modal card and the tidy-up button).
- **Accessibility.**
  - `role="region"` + `aria-label={t('moderator.snapshotMarker.stripAriaLabel')}` on the outer container.
  - The list is a semantic `<ol>` with `<li>` items.
  - `data-snapshot-label` and `data-log-position` attributes on each item give test harnesses and screen-reader inspection tools structured access without relying on the visible text.
  - The strip does NOT trap focus; it is not interactive in v1 (Decision §6 — clicking a snapshot does nothing).
- **Stable selectors.**
  - Strip container: `data-testid="snapshot-marker-strip"`.
  - Per-snapshot card: `data-testid="snapshot-marker-{snapshotId}"`, `data-log-position="{logPosition}"`, `data-snapshot-label="{label}"`.
  - Overflow indicator: `data-testid="snapshot-marker-overflow"` + `data-hidden-count="{n}"`.
- **i18n discipline.** All three new keys ship in en-US (drafts authored inline), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). Parity round-trip test from the existing pattern applies. `overflowLabel` uses ICU plural — the parity test must cover both branches (one / other).
- **No WS send.** The marker is read-only; it does not call `WsClient.send(...)`. No mutation.
- **No coupling to ReactFlow.** The strip is a plain DOM element positioned over the canvas via CSS — it does NOT use ReactFlow's `<Panel>` because `<Panel>` would re-render on viewport pan/zoom and the marker is viewport-independent. (Decision §2.b.)

## Acceptance criteria

- New `projectSnapshots(events)` selector added to [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts), exported alongside `Snapshot` interface. Pure; deterministic; runs in O(events).
- New `apps/moderator/src/graph/SnapshotMarkerStrip.tsx` exports a default `SnapshotMarkerStrip` component that reads `events` from `useWsStore`, calls `projectSnapshots()`, reverses, slices to first 5, renders the `<ol>` strip with header + per-snapshot cards + overflow indicator. Returns `null` when the list is empty.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` mounts `<SnapshotMarkerStrip />` as a sibling of the existing tidy-up button (after `</ReactFlow>`, before the context-menu block).
- Committed Vitest cases (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/graph/projectSnapshots.test.ts` — `(a)` empty event stream → empty array; `(b)` single `snapshot-created` event → one-record array with correct fields mapped from payload; `(c)` multiple `snapshot-created` events → array in insertion (chronological) order; `(d)` events of other kinds are ignored; `(e)` mixed stream returns only snapshot records; `(f)` selector is pure (called twice with same input produces equal output — structural equality).
  - `apps/moderator/src/graph/SnapshotMarkerStrip.test.tsx` — `(a)` returns `null` when no snapshots; `(b)` renders the strip with `data-testid="snapshot-marker-strip"` and the localized aria-label when ≥1 snapshot; `(c)` renders one `<li data-testid="snapshot-marker-{snapshotId}">` per snapshot up to the cap; `(d)` cards are in REVERSE-chronological order (newest first — first event in the list is newest); `(e)` each card carries `data-log-position` and `data-snapshot-label` attributes mirroring the event payload; `(f)` cards display the label as visible text; `(g)` cap of 5 is enforced (six snapshots → 5 visible + 1 overflow row); `(h)` overflow row uses the ICU plural one-branch when exactly one hidden, other-branch when ≥2 hidden, and is absent when none hidden; `(i)` overflow row carries `data-hidden-count` reflecting the count; `(j)` per-locale label round-trip (en-US / pt-BR / es-419) resolves to non-empty strings for the three modal keys including both ICU plural branches; `(k)` the header shows the total snapshot count (NOT the visible-cap count).
- Update to `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (or a new colocated test) — `(a)` `<SnapshotMarkerStrip />` is mounted inside `<GraphCanvasPane>`'s outer container; `(b)` baseline state (no `snapshot-created` events) → no marker strip visible; `(c)` injecting a `snapshot-created` event into the WS store causes the strip to appear with the correct card.
- Extends Playwright spec `apps/moderator/tests/e2e/moderator-snapshot.spec.ts` (already created by `mod_snapshot_action`, extended by `mod_snapshot_label_input`):
  - **Test 7 — pay down deferred-e2e debt from `mod_snapshot_label_input`**: navigate to operate route; assert `[data-testid="snapshot-marker-strip"]` is NOT present (baseline — no snapshots); click sidebar `[data-testid="snapshot-action-button"]`; type "Segment 1 close" in the modal input; click submit; wait for modal to close (`[data-testid="snapshot-label-input-modal"]` absent); assert `[data-testid="snapshot-marker-strip"]` IS present; assert exactly one `[data-testid^="snapshot-marker-"]` card visible with `data-snapshot-label="Segment 1 close"`.
  - **Test 8**: from the state after Test 7, dispatch a second snapshot via `Cmd/Ctrl+S` + modal submit with label "Segment 2 close"; assert two visible cards; assert the FIRST card in the list is "Segment 2 close" (reverse-chronological order); assert the SECOND card is "Segment 1 close".
- New i18n keys (`moderator.snapshotMarker.stripAriaLabel`, `moderator.snapshotMarker.header`, `moderator.snapshotMarker.overflowLabel`) ship in en-US (drafts), pt-BR (`*.review.json` PENDING), es-419 (`*.review.json` PENDING). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes (must cover both ICU plural branches of `overflowLabel`).
- **No deferred-e2e debt registered against future tasks.** This task's surface IS reachable end-to-end at landing time (the modal + backend prereqs all shipped 2026-05-31); Test 7 + Test 8 cover the user-visible behavior. The (future) `mod_change_history_pane` will add a parallel snapshot affordance in the sidebar and own its own Playwright coverage.
- **Native-speaker translation review** for the three new pt-BR / es-419 keys is human-only work; covered by the standing parking-lot entry (2026-05-30); no WBS task registered. (Surfaced explicitly in the return summary.)
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

1. **Derive snapshots from `session.events` via `projectSnapshots(events)`; do NOT widen `BaseWsSessionState` to carry a `snapshots[]` field.**
   - **Why.** The shell's `BaseWsSessionState` is a deliberately minimal contract ([`packages/shell/src/ws/store-contract.ts:50-81`](../../../packages/shell/src/ws/store-contract.ts)) — five fields, all of them either canonical replay primitives (`events`, `lastAppliedSequence`) or pre-computed indices over the events (`pendingProposalFacetStatus`, `activeDiagnostics`, `lastDiagnostic`). Snapshots are pure events with no terminator lifecycle and no derived-state aggregation; deriving on demand via a pure selector is cheaper than maintaining yet another indexed slice that the shell + moderator + audience all have to thread.
   - The pattern matches every other event-stream-derived view in the moderator: `projectAxiomMarks`, `projectPendingAxiomMarks`, `projectAnnotationNodes`, `projectVotesByProposal` — none of them widens the shell contract; all read `events` directly.
   - **Alternative rejected — widen `BaseWsSessionState` to carry `snapshots: Snapshot[]`.** Would require updating the shell contract, the default store's `applyEvent` reducer to detect `snapshot-created` and append to the slice, the moderator's local widening to consume it, and (eventually) the audience's widening too. The selector is one function with no contract churn.
   - **Alternative rejected — call the read-side `snapshot` WS request on mount and consume the response's `snapshots` array.** That request returns the projection.snapshots payload, but [`packages/shell/src/ws/client.ts:272-274`](../../../packages/shell/src/ws/client.ts) discards it — only `lastAppliedSequence` is captured. Either the discard path widens (large change), OR the marker fires its own request and parses the response inline (introduces a non-`event-applied` data path for state the rest of the app already gets from the event log). Neither is justified.

2. **Placement: top-left fixed-corner overlay inside `<GraphCanvasPane>`'s outer container.**
   - **a — Why top-left.** Top-right is taken by the tidy-up button (`absolute right-4 top-4 z-10`). Bottom corners are noisier (the bottom-strip capture pane occupies the lower viewport region). Top-left is currently empty in `<GraphCanvasPane>` and gives the moderator peripheral vision of snapshot state without obstructing the central canvas.
   - **b — Why plain DOM + `absolute` rather than ReactFlow's `<Panel>`.** `<Panel>` is viewport-relative and re-renders on pan/zoom (per the React Flow docs); the snapshot marker is content that should stay anchored to the *pane*, not the viewport. The fixed-corner pattern with `absolute` matches the tidy-up button's implementation, which the team already shipped and validated.
   - **c — Why NOT in the change-history pane (sidebar).** Two reasons. First, the change-history pane is downstream and not yet shipped; F10 cannot land its visual feedback through a pane that doesn't exist. Second, even when the pane lands, the on-graph marker is a different affordance — the pane gives reverse-chronological deep-detail across ALL events (snapshots + proposals + commits + votes + withdrawals); the canvas marker gives an at-a-glance "yes, we've snapshotted; here's the recent labels" without forcing the moderator to scroll a long history list filtered for one event kind. The two surfaces are complementary, established as a pattern by `docs/moderator-ui.md:183-185` ("graph view is the operator's 'ambient awareness' mode"; "sidebar is the 'focus mode'").
   - **Alternative rejected — top-right adjacent to the tidy-up button.** Would crowd the corner where the moderator clicks-by-muscle-memory for tidy-up. The two affordances are unrelated; keeping them on opposite corners reduces accidental clicks.
   - **Alternative rejected — bottom-left or bottom-right overlay.** The bottom strip's capture pane and mode banner occupy the lower viewport; overlaying snapshots there fights for vertical space and conflicts visually with the mode banner.
   - **Alternative rejected — flash a toast on `snapshot-created`, no persistent UI.** A transient toast is not a "marker"; the moderator might be looking elsewhere when the toast fires. Persistent on-graph indication is what the task name implies and what the F10 UX needs.
   - **Alternative rejected — pin a marker to a graph node at the snapshot's `log_position`.** A snapshot's `log_position` is a sequence number, not a node id. There is no deterministic mapping from "the event sequence when the snapshot fired" to "a node currently on the canvas" — the node-at-that-position is the LAST node touched by an event at that sequence, which may have been a vote/withdraw/commit and not a structural change. The corner-overlay disconnects the marker from the per-node decoration logic entirely.

3. **Reverse-chronological display order (newest first); visible cap of `MAX_VISIBLE_SNAPSHOTS = 5`; ICU-pluralized overflow indicator.**
   - **Why reverse-chronological.** Matches the change-history pane convention ([docs/moderator-ui.md:226](../../../docs/moderator-ui.md)). The moderator's mental model is "the last thing I did is most relevant" — newest snapshot is the one most likely being referenced in conversation.
   - **Why a cap.** A debate session in v1 will typically take 1–5 snapshots (per segment break). A replay-bound session or a long-form show could exceed that; without a cap, the strip could overflow the viewport and overlap the canvas content. 5 is the realistic visible ceiling without scrolling; six+ surfaces as overflow.
   - **Why ICU plural for overflow.** Matches en-US (`"1 more snapshot"` vs `"3 more snapshots"`), pt-BR (`"mais 1 instantâneo"` vs `"mais 3 instantâneos"`), and es-419 (`"1 instantánea más"` vs `"3 instantáneas más"`) plural grammars correctly. Three flat keys would force the implementer to choose one form per locale or fork at render time; ICU plural is the established pattern (`mod_snapshot_label_input` uses it for the character-count helper).
   - **Alternative rejected — chronological (oldest first).** Forces the moderator to scan to the bottom of a growing list to find the most recent label. Inverts the change-history convention.
   - **Alternative rejected — no cap; let it grow.** Strip would overlap canvas content in long-form sessions; the moderator's hover-to-truncated-label affordance breaks when the strip pushes past the viewport's vertical bound.
   - **Alternative rejected — cap of 3.** Too aggressive; the typical 1–5 working set would frequently trigger overflow. 5 is the breakeven between "shows the recent working set without truncation" and "fits comfortably in the corner without dominating".
   - **Alternative rejected — make the cap user-configurable.** v1 has no UI for moderator preferences; the cap is a small constant; a future task can lift it if usability demands.

4. **Empty-state collapses to `null` at the component level; the call site mounts unconditionally.**
   - **Why.** The alternative is to thread a `hasSnapshots` boolean through `<GraphCanvasPane>` and conditionally mount the strip — that forces `<GraphCanvasPane>` to compute the snapshot list (or subscribe to its emptiness) on every render even when the strip doesn't need to render. The cheaper pattern is: mount the component unconditionally; let the component decide. The component already subscribes to `events` (because it has to render the list when non-empty); the additional `events.length === 0`-or-equivalent check is trivial.
   - This mirrors the `<GraphContextMenu>` / `<AxiomMarkSubmenu>` / `<AnnotateSubmenu>` family in `GraphCanvasPane.tsx:1719-1769` — except those components are conditionally MOUNTED by the parent because their props (`x`, `y`) are stateful. The snapshot strip has no parent-owned props.

5. **i18n: three flat keys + ICU plural for overflow; pt-BR / es-419 drafts flagged PENDING.**
   - **Why.** Established pattern from `mod_snapshot_action.md` Decision §6 and `mod_snapshot_label_input.md` Decision §8 — drafts ship in `*.review.json` flagged PENDING, native-speaker review happens out-of-band via the parking-lot entry. en-US is authored inline by the implementer.
   - **Why three keys and not more.** No empty-state copy (component returns `null`); no per-card copy (the visible text IS the user-authored label, untouched by i18n); no error copy (the marker is read-only and has no failure modes). Three is the minimum set: ARIA region label, strip header, overflow indicator.

6. **Marker cards are non-interactive in v1; no click handlers, no hover popovers.**
   - **Why.** Clicking a snapshot in a live debate has no useful semantic in v1. The replay-side (forthcoming `replay_test.*` stream) will eventually let the operator "rewind to this snapshot" — that affordance belongs in the replay surface, not the live operator canvas. Adding click handlers now would either be no-ops (UX trap) or jump out of the operator view, which is the wrong context.
   - The hover-truncated-label affordance is handled by the standard HTML `title` attribute; no JS popover dependency.
   - **Alternative rejected — wire each card to scroll the (future) change-history pane to that event.** Tightly couples this task to the unshipped pane; introduces a dependency cycle (the strip would need a stable ref / scroll API the pane doesn't yet expose). A future task can add the click-to-flash behaviour once both surfaces are live.

7. **Cap constant lives in `SnapshotMarkerStrip.tsx`, not in `shared-types` / `limits.ts`.**
   - **Why.** `MAX_SNAPSHOT_LABEL_LENGTH = 128` lives in `limits.ts` because both client and server enforce it (server-side validation, client-side `maxLength`). The visible-cap is a UI-only concern with no wire correlate; centralising it in `limits.ts` would imply a constraint the data layer doesn't enforce.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- `apps/moderator/src/graph/selectors.ts` — added `Snapshot` interface and `projectSnapshots(events)` selector; pure function returning `{ snapshotId, label, logPosition, createdAt }[]` from `snapshot-created` events.
- `apps/moderator/src/graph/SnapshotMarkerStrip.tsx` — new presentational component; reads `events` via `useWsStore`, renders reverse-chronological stack of up to 5 snapshot label cards with ICU-pluralized overflow row; returns `null` when empty.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — mounts `<SnapshotMarkerStrip sessionId={sessionId} />` as sibling of the tidy-up button (minor deviation: takes `sessionId` prop instead of zero props to avoid breaking direct-render tests that don't wrap a router).
- `apps/moderator/src/graph/projectSnapshots.test.ts` — 6 Vitest cases (a–f) covering empty stream, single event, multiple events, non-snapshot events ignored, mixed stream, and pure-function parity.
- `apps/moderator/src/graph/SnapshotMarkerStrip.test.tsx` — 11 Vitest cases (a–k) covering null-on-empty, strip render, per-card attributes, reverse-chronological order, 5-cap enforcement, overflow ICU plural branches, overflow data-hidden-count, per-locale round-trip (en-US/pt-BR/es-419), and header showing total count.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — 2 new mount-contract cases: strip is mounted unconditionally; empty state → no strip visible; `snapshot-created` event → strip appears.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — 3 new keys under `moderator.snapshotMarker` (`stripAriaLabel`, `header`, `overflowLabel` with ICU plural).
- `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json` — draft translations; `{pt-BR,es-419}.review.json` — PENDING flags for native-speaker review (covered by standing parking-lot entry 2026-05-30).
- `tests/e2e/moderator-snapshot.spec.ts` — Test 7 (single labeled snapshot → strip appears with one card) and Test 8 (two snapshots → newest-first order) pay down the deferred-e2e debt registered by `mod_snapshot_label_input`.
