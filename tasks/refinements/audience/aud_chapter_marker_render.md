# aud_chapter_marker_render — Render segment snapshot as a visible chapter marker

## TaskJuggler entry

- **Task:** `audience.aud_segment_markers.aud_chapter_marker_render`
- **Defined in:** [`tasks/50-audience-and-broadcast.tji:491`](../../50-audience-and-broadcast.tji) (inside `task aud_segment_markers` at line 489).
- **Note back-link:** this refinement.

## Effort estimate

`1d` (from the `.tji` leaf). One pure projector, one selector hook, one screen-fixed caption component, their Vitest coverage, and one Playwright scenario appended to the existing audience-live spec.

## Inherited dependencies

The parent `aud_segment_markers` declares `depends !aud_graph_rendering, data_and_methodology.event_types.snapshot_events`, which this leaf inherits.

**Settled:**

- **`data_and_methodology.event_types.snapshot_events`** — `complete 100`. The `snapshot-created` event kind exists end-to-end: payload schema `SnapshotCreatedPayload { snapshot_id, label (1–128 chars), log_position }` at [`packages/shared-types/src/events.ts:623`](../../../packages/shared-types/src/events.ts), projection record `SnapshotRecord { snapshotId, label, logPosition, createdAt }` at [`apps/server/src/projection/types.ts:314`](../../../apps/server/src/projection/types.ts), and the projection change `{ kind: 'snapshot-added', snapshotId, label, logPosition }`. The event reaches every subscribed client (audience included) as an `event-applied` broadcast when the moderator labels a snapshot. Refinement: [`tasks/refinements/data-and-methodology/snapshot_events.md`](../data-and-methodology/snapshot_events.md).
- **`aud_graph_rendering.*`** — the audience live surface is built and, critically, **reachable**: `aud_url_routing.aud_session_url` (`complete 100`) landed the `/sessions/:sessionId` route, which mounts `<AudienceLiveRoute>` → `<AudienceGraphView>` (see [`apps/audience/src/App.tsx:182`](../../../apps/audience/src/App.tsx) and [`apps/audience/src/routes/AudienceLiveRoute.tsx:96`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx)). The audience event-derived state seam — projector helpers in `apps/audience/src/state/` consumed by selector hooks — is established by `aud_state_management` and proven by `sessionRosterFrom`/`useAudienceSessionRoster`.

**Pending:** none. Both dependencies are complete.

## What this task is

When the moderator labels a snapshot at a natural break ("Segment 1 close", "Commercial", "End of show" — moderator-typed free text), the audience broadcast surface should display that label as a **visible chapter marker**: a small, screen-fixed caption identifying the current segment of the show. This is the **live-broadcast** chapter marker, distinct from the replay scrubber's chapter list (`apps/audience/src/replay/`, already shipped) — replay navigates a *history* of snapshots; this renders the *most recent* snapshot as the current on-air segment caption.

Concretely the task adds:

1. A pure projector `latestSnapshotFrom(events)` deriving the most-recent `snapshot-created` event from the audience event stream (mirroring [`apps/audience/src/state/sessionRoster.ts:64`](../../../apps/audience/src/state/sessionRoster.ts)).
2. A selector hook `useAudienceLatestSnapshot(sessionId)` over the WS-store events slice (mirroring [`apps/audience/src/state/useAudienceSessionRoster.ts:30`](../../../apps/audience/src/state/useAudienceSessionRoster.ts)).
3. A screen-fixed caption component (`ChapterMarker`) rendering the latest snapshot label, mounted as a sibling of `<AudienceGraphView>` in `AudienceLiveRoute`. Renders nothing until the first snapshot arrives.

The sibling leaf `aud_segment_break_animation` (depends on this task) adds the *transient* entrance cue; this task owns the *static, persistent* marker.

## Why it needs to be done

`aud_segment_markers` is one of the leaves gating the **show-readiness** milestone ([`tasks/99-milestones.tji:101`](../../99-milestones.tji): "audience segment/chapter markers gates this milestone"). The broadcast surface today renders the argument graph but gives the at-home audience no signal of *where in the show* they are. Snapshots are the moderator's segment-boundary primitive (per [`docs/example-walkthrough.md:215`](../../../docs/example-walkthrough.md): `snapshot-created — label "Segment 1 close"`); surfacing the latest one as a caption is the smallest unit that turns that data into an audience-visible chapter marker. It also establishes the seam the `aud_segment_break_animation` sibling animates.

## Inputs / context

- **Mount point** — [`apps/audience/src/routes/AudienceLiveRoute.tsx:96`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx):
  ```tsx
  return (
    <div className="relative h-screen w-screen">
      <AudienceGraphView />
      {subscribeRejection === 'not-found' && <PrivateSessionCta />}
    </div>
  );
  ```
  The `relative` ancestor already exists; `<ChapterMarker />` mounts as a third sibling here. (It is **not** mounted inside the shared `packages/graph-view` canvas — see Decision §2.)
- **Live routes** — [`apps/audience/src/App.tsx:182`](../../../apps/audience/src/App.tsx): `/sessions/:sessionId` and `/:locale/sessions/:sessionId` → `<AudienceLiveRoute />`. (Replay routes `/replay/:sessionId` mount `<AudienceReplayRoute />`, which already owns its own chapter list — this caption stays out of the replay surface.)
- **Projector precedent** — [`apps/audience/src/state/sessionRoster.ts:64`](../../../apps/audience/src/state/sessionRoster.ts): `export function sessionRosterFrom(events: readonly Event[]): ReadonlyMap<string, string>`. Pure function over the event array; the new `latestSnapshotFrom` follows this exact shape and lives beside it.
- **Hook precedent** — [`apps/audience/src/state/useAudienceSessionRoster.ts:30`](../../../apps/audience/src/state/useAudienceSessionRoster.ts):
  ```ts
  export function useAudienceSessionRoster(sessionId: string): ReadonlyMap<string, string> {
    const events = useAudienceSessionEvents(sessionId);
    return useMemo(() => sessionRosterFrom(events), [events]);
  }
  ```
  The facade `useAudienceSession()` ([`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts)) composes the existing selectors; whether to thread the new selector through the facade or expose it standalone is a Decision (§4) below.
- **Event payload** — `SnapshotCreatedPayload` at [`packages/shared-types/src/events.ts:623`](../../../packages/shared-types/src/events.ts): `{ snapshot_id, label (1–128), log_position }`. The label is the audience-visible string.
- **OBS broadcast constraints** — [`tasks/refinements/audience/aud_obs_transparency.md`](aud_obs_transparency.md): body composites via alpha channel; overlays must not assume an opaque backdrop. [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md) §acceptance: the rendered container must contain **no** `<dialog>`, `[aria-modal="true"]`, `<audio>`, `<video>`, or `[data-requires-input="true"]`. The caption must be inert.
- **testid convention** — [`tasks/refinements/audience/aud_annotation_rendering.md`](aud_annotation_rendering.md) Decision §3: audience testids are prefixed `audience-` for cross-surface composite safety (moderator + audience feeds in one OBS scene must not collide).
- **i18n** — chrome strings resolve via `useTranslation()` against the `audience.*` namespace in [`packages/i18n-catalogs/src/catalogs/en-US.json:1039`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) (sibling `audience.replay.playback.*` keys at line 1053). The moderator-typed snapshot **label is free text and is NOT translated**; only surrounding chrome (an aria-label / visually-hidden prefix) is.
- **WS-store test seam** — `window.__aConversaWsStore` is assigned unconditionally on the audience surface (`aud_session_url` Decision §3/§5, as amended by `aud_session_url_refine_amend`); Playwright seeds events via `page.evaluate(() => window.__aConversaWsStore.getState().applyEvent(...))`. Existing spec to extend: [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts).

## Constraints / requirements

1. **Event-derived, latest-only.** Derive the marker from the audience event stream (the same slice `useAudienceSessionEvents` exposes), taking the last `snapshot-created` event. Do **not** fetch over HTTP (that is the replay pattern) and do **not** render the full snapshot history (the replay scrubber owns the list).
2. **Absent until present.** With zero snapshots in the stream, the projector returns `null` and the component renders nothing (no empty caption chrome). Use a frozen/`null` sentinel for stable React identity, consistent with the audience `EMPTY_*` precedent so a no-snapshot projection does not churn renders.
3. **Inert + OBS-safe.** The caption is `pointer-events-none`, introduces no `<dialog>`/`[aria-modal]`/`<audio>`/`<video>`/`[data-requires-input]`, and assumes a transparent backdrop (legible on an arbitrary producer scene — follow the node-fill legibility rationale in `aud_obs_transparency.md`: dark text on a solid light chip, not light-on-transparent).
4. **Screen-fixed, non-occluding.** Pinned to a screen corner (Decision §6: bottom-left), absolutely positioned within the route's `relative` ancestor — not anchored to any Cytoscape node, and not centered where node content lives.
5. **testid `audience-chapter-marker`** on the caption root; the user label rendered as text so Playwright can assert it.
6. **i18n chrome only.** Any prefix/aria string added under `audience.segmentMarker.*` in all three catalogs (`en-US`, `es-419`, `pt-BR`); the snapshot label itself is passed through verbatim.
7. **No shared-package coupling.** The component and hook live in `apps/audience/src/`; `packages/graph-view` stays free of snapshot semantics (Decision §2).
8. **No wire/broadcast/projector change.** This is pure client rendering over an already-pinned event; no server, WS-envelope, or projection change (Decision §3 of `snapshot_events` already pins the seam).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) (no throwaway verifications) every check below is a committed, repeatable test — no scratch scripts.

**Vitest (unit/component):**

1. `latestSnapshotFrom(events)` — empty stream → `null`; single `snapshot-created` → that snapshot's `{ snapshotId, label, logPosition }`; multiple → the **last** by stream order; non-snapshot events ignored; the no-snapshot result is referentially stable across calls (frozen/`null` sentinel).
2. `useAudienceLatestSnapshot(sessionId)` — React-harness test: mounts with no snapshot (null), re-renders to the label after a `snapshot-created` event is applied to the store, and supersedes to a newer label after a second snapshot.
3. `ChapterMarker` component — renders nothing when the hook returns `null`; renders the verbatim label inside `data-testid="audience-chapter-marker"` when present; the rendered subtree contains no `<dialog>`/`[aria-modal]`/`<audio>`/`<video>`/`[data-requires-input]` and is `pointer-events-none` (OBS-safety assertions, mirroring `aud_obs_no_input_required.md`); chrome resolves through `t('audience.segmentMarker.*')`.

**Playwright (e2e) — IN SCOPE, not deferred.** The surface is reachable (`/sessions/:sessionId` mounts `<AudienceLiveRoute>` → `<AudienceGraphView>` + `<ChapterMarker>` since `aud_session_url`), so the UI-stream e2e policy's default applies. Append one scenario to [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) following its established walk (create session → navigate to `/sessions/:id` → seed events via `window.__aConversaWsStore`):

4. Navigate to a live session; assert `audience-chapter-marker` is **absent** before any snapshot; seed a `snapshot-created` event (label e.g. `"Segment 1 close"`) via `applyEvent`; assert the caption appears with that exact label; seed a second `snapshot-created` (label `"Commercial"`) and assert the caption updates to the newer label.

**Out of scope / no new task:**

- **Pixel-level appearance** (exact corner, padding, type scale, contrast) is captured by the existing full-canvas `aud_visual_regression` pin — no new task; visual-regression is *not* a substitute for the Playwright behavioural pin above, both coexist.
- **Cucumber** is not required: this task crosses no protocol/replay/projector seam observable at the system boundary — the `snapshot-created` wire event and its projection are already pinned by `snapshot_events`'s coverage; the work here is client-side derivation, pinned by Vitest + Playwright.

## Decisions

1. **Static marker here; transient cue in the sibling.** This leaf renders the persistent caption; `aud_segment_break_animation` (which `depends !aud_chapter_marker_render`) animates its entrance. *Rationale:* the WBS split names "render" and "animation cue" as separate leaves; keeping render free of motion gives the animation task a clean, testable seam (a stable `audience-chapter-marker` testid + a "latest snapshot changed" signal to animate against). *Alternative rejected:* folding a fade-in into this task would pre-empt the sibling and entangle behavioural and motion assertions.

2. **Component lives in `apps/audience`, mounted in `AudienceLiveRoute` — not in `packages/graph-view`.** *Rationale:* the eight existing graph overlays are node/edge-anchored and genuinely need the Cytoscape `Core`; this caption is session-level and screen-fixed, needing none of that machinery. Mounting it in the route (beside `<PrivateSessionCta>`) keeps the shared graph-view package free of audience snapshot semantics and keeps the marker off the replay surface (which has its own chapter UI). *Alternative rejected:* adding a ninth overlay inside `packages/graph-view/src/GraphView.tsx` would couple a reusable package to audience-only snapshot rendering for no positioning benefit.

3. **Derive from the event stream, not the serialized projection or HTTP.** *Rationale:* the audience holds its state as an event slice and derives views with pure projectors (`sessionRosterFrom` precedent); a live snapshot arrives as an `event-applied` broadcast, so `latestSnapshotFrom(events)` is the consistent, already-reactive path. *Alternatives rejected:* (a) reading a server-serialized `projection.snapshots()` would introduce a second state channel the audience does not otherwise use live; (b) the replay surface's HTTP `GET /snapshots` fetch is a history query, wrong for the live, push-driven case.

4. **Latest-only; standalone hook, not threaded through the `useAudienceSession()` facade (yet).** The marker needs only the most-recent snapshot, and only this one component consumes it today, so `useAudienceLatestSnapshot` stays a standalone selector rather than a fifth field on the facade. *Rationale:* matches the "two-caller YAGNI" threshold the audience refinements apply to facade growth; promotion waits for a second consumer. *Alternative rejected:* a full snapshot-list selector + facade field is unused surface — the replay scrubber already owns list navigation.

5. **Persistent until superseded.** The caption stays on screen showing the current segment label until a newer snapshot replaces it (no auto-dismiss in this task). *Rationale:* a chapter marker answers "which segment are we in?", which is a standing question for the at-home audience; transient announcement behaviour, if wanted, belongs to the animation sibling. If persistence proves visually heavy in production it is a CSS/visual-polish tweak (caught by `aud_visual_regression`), not a re-architecture.

6. **Bottom-left corner placement.** *Rationale:* node content and the diagnostic/halo overlays cluster graph-center; a corner avoids occlusion, and bottom-left echoes the broadcast lower-third convention without colliding with the top-anchored producer chrome that OBS scenes typically place up top. Exact pixel placement is a visual-polish detail pinned by `aud_visual_regression`. *Alternative considered:* top-center reads as a title card but risks overlapping producer-composited upper-third graphics.

7. **e2e in scope, no deferral.** Because `aud_session_url` already made the live graph route reachable and paid down the prior deferred-e2e debt, this task pays its own way with a Playwright scenario rather than adding to any catch-all. *Rationale:* the UI-stream policy defaults to in-scope e2e whenever the surface is reachable; deferring here would needlessly grow inherited debt on an already-settled leaf.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- **`apps/audience/src/state/latestSnapshot.ts`** — pure projector `latestSnapshotFrom(events)` deriving the most-recent `snapshot-created` event; returns `null` (frozen sentinel) when no snapshots present.
- **`apps/audience/src/state/useAudienceLatestSnapshot.ts`** — selector hook `useAudienceLatestSnapshot(sessionId)` consuming `useAudienceSessionEvents` and memoizing `latestSnapshotFrom`.
- **`apps/audience/src/routes/ChapterMarker.tsx`** — screen-fixed, pointer-events-none caption component pinned bottom-left; renders nothing until first snapshot; `data-testid="audience-chapter-marker"` on root; i18n chrome via `audience.segmentMarker.prefix`; OBS-safe (no dialog/modal/audio/video/input elements).
- **`apps/audience/src/routes/AudienceLiveRoute.tsx`** — mounts `<ChapterMarker sessionId=…/>` as third sibling alongside `<AudienceGraphView>` and `<PrivateSessionCta>`.
- **`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`** — new `audience.segmentMarker.prefix` chrome key added to all three catalogs.
- **`tests/e2e/audience-live-session.spec.ts`** — added `seedSnapshotCreated` helper and scenario (12) asserting marker absent before any snapshot, visible with label after first seed, and superseded by second snapshot label.
- **Vitest tests:** `latestSnapshot.test.ts` (5 cases), `useAudienceLatestSnapshot.test.tsx` (3 cases), `ChapterMarker.test.tsx` (4 cases including OBS-inert assertions).
