# replay_playback_controls — Play / pause / step controls

## TaskJuggler entry

- **Task:** `replay_test.replay_ui.replay_playback_controls`
- **Defined in:** [`tasks/60-replay-and-test-mode.tji:44`](../../60-replay-and-test-mode.tji#L44)
- **Title:** "Play / pause / step controls"
- **Refinement back-link:** this document.

## Effort estimate

**1d** (per the `.tji` block). The reusable machinery already exists — the
position-navigation contract is ported into shell (ADR 0043), the renderer
is `@a-conversa/graph-view`, and the test-mode scrubber already proved the
lifted-position container pattern. This leaf adds an app-local
auto-advance loop and a small controls cluster to the existing
`AudienceReplayRoute`; it does not invent a new seam.

## Inherited dependencies

Direct: `depends !replay_mode_audience_surface`
([`.tji:47`](../../60-replay-and-test-mode.tji#L47)). The parent
`replay_ui` group also carries `depends
data_and_methodology.replay_primitive, audience.aud_graph_rendering,
audience.aud_animations` ([`.tji:32`](../../60-replay-and-test-mode.tji#L32)),
and the stream root `replay_test` depends
`backend.backend_tests.be_e2e_tests.auth_flow_integration`
([`.tji:30`](../../60-replay-and-test-mode.tji#L30)).

**Settled:**

- **`replay_mode_audience_surface`** — done 2026-06-05. Built
  [`apps/audience/src/routes/AudienceReplayRoute.tsx`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx),
  mounted at `/a/replay/:sessionId` and `/a/:locale/replay/:sessionId`
  ([`apps/audience/src/App.tsx:195`](../../../apps/audience/src/App.tsx#L195)).
  The route loads the full log via `useSessionEventLog(sessionId)` and, in
  its `ready` branch, renders `<GraphView events={events}
  instanceKey={sessionId} />` at the log **head** with no position UI
  ([`AudienceReplayRoute.tsx:104`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx#L104)).
  The route's own comment names *this* task's family as the owner of the
  scrubber/playback machinery
  ([`AudienceReplayRoute.tsx:100`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx#L100)).
- **The replay-position contract (ADR 0043)** — the client port lives at
  [`packages/shell/src/replay-position/replay-position.ts`](../../../packages/shell/src/replay-position/replay-position.ts)
  and exports `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`,
  `replayHeadSequence`, `clampPosition`. Position is event-sequence space,
  stops `0..head`, ±1 saturating, `0` is the pre-history baseline. This is
  exactly the contract the test-mode scrubber consumes.
- **The lifted-position container pattern** — `test_mode_timeline_scrubber`
  (done 2026-06-05) established it:
  [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx)
  owns `const [position, setPosition] = useState(() =>
  replayHeadSequence(events))` and a `clampPosition`-guarded setter; the
  child
  [`TimelineScrubber.tsx`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx)
  feeds `GraphView` the prefix `events.filter(e => e.sequence <=
  position)` and renders prev/next buttons + a position-status readout. The
  test-mode scrubber has **no** auto-advance loop — manual stepping only.
- **ADR 0045 (audience replay visibility-gating)** — fixes the surface's
  auth posture and, at
  [`docs/adr/0045-...:59`](../../../docs/adr/0045-audience-replay-surface-visibility-gating.md#L59),
  decided the surface lands on the **head** frame by default, naming "the
  downstream playback controls" (this task) as what "add[s] scrubbing from
  the start." This refinement must not contradict that default.
- **ADR 0039 (`@a-conversa/graph-view`)** — the data-source-agnostic
  renderer; it accepts an `events` prop and re-renders when the prefix
  changes.

**Pending (downstream — explicitly NOT this task):**

- **`replay_speed_controls`** ([`.tji:49`](../../60-replay-and-test-mode.tji#L49),
  `depends !replay_playback_controls`) — the 0.5×/1×/2× selector. This task
  plays at a single fixed default cadence; speed selection is the next leaf.
- **`replay_seek_bar`** ([`.tji:54`](../../60-replay-and-test-mode.tji#L54),
  `depends !replay_playback_controls`) — the draggable seek bar showing
  position in the log. This task ships play/pause/step **buttons** plus a
  minimal text position readout (so stepping is observable); the rich
  draggable bar is that leaf.
- **`replay_url_position_loading`**, **`replay_chapter_jumping`** — chain
  off `replay_seek_bar`, further downstream.

## What this task is

Add **play / pause / step** controls to the replay viewer. Today
`AudienceReplayRoute` renders the complete session (the log head) as a
single static frame. This leaf introduces a **position cursor** on that
surface and the controls that move it:

- **Step back / step forward** — single-event navigation via `prevPosition`
  / `nextPosition`.
- **Play / pause** — an auto-advance loop that calls `nextPosition` on a
  fixed interval, auto-pausing when it reaches the head (`isAtEnd`).
- A **minimal text position readout** (`position / head`) so stepping and
  playback are observable before the seek bar lands.

The graph re-renders client-side from the position prefix
(`events.filter(e => e.sequence <= position)`), exactly as the test-mode
scrubber does — no per-step server calls.

## Why it needs to be done

`replay_mode_audience_surface` deliberately shipped the terminal frame only
and deferred all position UI to this family (ADR 0045 §default-frame;
`replay_mode_audience_surface` refinement §Out-of-scope). This is the leaf
that makes a saved debate *watchable*: it turns the static head frame into a
playable timeline. It is also the **hinge of the rest of the replay-UI
stream** — `replay_speed_controls` and `replay_seek_bar` both
`depends !replay_playback_controls`, and the URL-position and chapter-jump
leaves chain off the seek bar. Nothing downstream in replay-UI can render
until the position cursor and its owning container exist, which is what this
task builds.

## Inputs / context

- **Surface to extend:**
  [`apps/audience/src/routes/AudienceReplayRoute.tsx:104-108`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx#L104)
  — the `ready` branch currently renders `<GraphView>` at head inside a
  `relative h-screen w-screen` viewport. The `loading` / `not-found` /
  `error` / CTA branches (lines 45-96) stay untouched.
- **Position helpers:**
  [`packages/shell/src/replay-position/replay-position.ts`](../../../packages/shell/src/replay-position/replay-position.ts)
  — `nextPosition(events, position)`, `prevPosition(events, position)`,
  `isAtStart(position)`, `isAtEnd(events, position)`,
  `replayHeadSequence(events)`, `clampPosition(value, events)`. Re-exported
  from `@a-conversa/shell`
  ([`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts)).
- **Container pattern to mirror:**
  [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx:32-54`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx#L32)
  (state ownership + guarded setter) and
  [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:69-144`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L69)
  (prefix render, prev/next handlers, position-status readout with
  `data-position` / `data-head` attributes).
- **Data source (unchanged):** `useSessionEventLog(sessionId)` from
  [`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts);
  backed by `GET /api/sessions/:id/events`
  ([`apps/server/src/replay/routes.ts:533`](../../../apps/server/src/replay/routes.ts#L533)).
  No new endpoint; the full log is already in hand.
- **Existing replay e2e:**
  [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
  (the `chromium-audience-replay` Playwright project) — authenticated→graph,
  anonymous→CTA, locale-prefix. This task extends it.
- **i18n catalogs:**
  [`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/)
  `{en-US,pt-BR,es-419}.json` (+ `.review.json` companions for pt-BR /
  es-419); the existing `audience.replay.*` namespace is where new labels go.
- **Accessibility:** ADR 0040 (axe-playwright must stay clean — buttons need
  `aria-label`s, the play/pause toggle must announce state).

## Constraints / requirements

1. **Reuse the shell position contract** — step and auto-advance go through
   `nextPosition` / `prevPosition` / `isAtEnd` / `clampPosition`; do not
   re-derive sequence arithmetic in the audience app (ADR 0043 is the single
   source of that truth).
2. **Client-side prefix render** — the graph is fed `events.filter(e =>
   e.sequence <= position)`; no per-step server round-trips (mirrors
   `test_mode_timeline_scrubber` Decision §2; the full log is already
   loaded).
3. **Preserve the head-landing default** — the no-interaction view still
   shows the complete session (ADR 0045 §default-frame): initialise the
   cursor at `replayHeadSequence(events)`.
4. **Auto-advance must self-terminate** — the play loop pauses when it
   reaches the head (`isAtEnd`); it never spins past the end or busy-loops.
   Pressing **play while at the end restarts from position 0** (standard
   media-player "replay" affordance) so a viewer can watch from the start
   without the not-yet-built seek bar.
5. **Single fixed cadence** — one default interval (a named constant);
   speed selection is `replay_speed_controls`. No speed UI here.
6. **Timer hygiene** — the auto-advance interval is cleared on pause, on
   reaching the end, and on unmount; no leaked timers across navigations.
7. **Touch only the `ready` branch** — the load/auth/CTA states of
   `AudienceReplayRoute` are unchanged; the controls render only when there
   is a log to play.
8. **Accessibility** — every control has a localized `aria-label`; the
   play/pause toggle reflects its current state to assistive tech; the axe
   pass stays clean (ADR 0040).
9. **No new wire/broadcast/projector behavior** — pure UI consumer of
   already-pinned seams; no Cucumber pin is owed (see Decisions §6).

## Acceptance criteria

All criteria are committed, non-throwaway tests (ADR 0022) — they pin the
observable behavior of the controls, not implementation detail.

1. **Vitest (component) — controls + stepping.** New/extended tests under
   `apps/audience/src/` assert, against a fixed multi-event log fixture:
   the `ready` render shows play/pause + step-back + step-forward controls
   and a position readout starting at `head`; step-back decrements the
   position and the readout/`data-position`; step-forward increments it;
   step-back is disabled at `0` and step-forward is disabled at `head`
   (`isAtStart` / `isAtEnd`). The graph receives the position prefix (assert
   via the `GraphView` `events` prop length / a `data-position` seam).
2. **Vitest (component) — play loop with fake timers.** Using fake timers:
   pressing play auto-advances the position one event per interval tick;
   the loop **pauses on its own at the head** (no further advance, the timer
   is cleared); pressing play while at the head **restarts from 0** then
   advances; pressing pause mid-run stops advancement; unmount clears the
   timer (no act-warning / no post-unmount tick).
3. **Playwright (e2e) — reachable behavior.** Extend
   [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
   (the `chromium-audience-replay` project) on the existing authenticated
   replay fixture: the playback controls are present; clicking step-forward
   advances the position readout; clicking play advances the position over
   wall-clock time and pause stops it; the controls expose stable
   `data-testid` seams (ADR 0022) for these assertions. **E2e is in scope,
   not deferred** — the surface is already reachable at `/a/replay/:id`
   (`replay_mode_audience_surface` shipped the route) and this task renders
   the controls into it, so the strict "not yet reachable" deferral
   exception does not apply.
4. **i18n parity.** New `audience.replay.*` keys (play / pause / step-back /
   step-forward labels + the position-readout format) added to all three
   catalogs and the two `.review.json` companions;
   `pnpm --filter @a-conversa/i18n-catalogs run check` passes (catalog
   parity). Human-language review of the pt-BR / es-419 strings is **not** a
   WBS task — flagged for the parking lot (see return summary).
5. **Accessibility.** The existing axe-playwright pass on the replay route
   stays clean with the new interactive controls (ADR 0040).
6. **Build + test gate.** `make` build + the full unit/e2e suites pass
   before the closer commits (global build-and-test rule).

No deferred-e2e debt is created by this task, and none is inherited: the
search of the WBS and sibling refinements surfaced no `note` / Status line
pointing deferred replay-playback coverage *at* this task (the only
deferred replay item, anonymous public-session replay, was paid by
`backend.replay_endpoints.anonymous_public_session_log`, already shipped).

## Decisions

- **§1 — Lift position into a route-local container; render the prefix
  client-side.** Introduce a container in `apps/audience/src/` (mirroring
  `SessionScrubberContainer`) that owns `position` / `setPosition`
  (initialised at `replayHeadSequence(events)`, guarded by `clampPosition`)
  and renders `GraphView` + the controls as siblings; `AudienceReplayRoute`'s
  `ready` branch renders it. *Rationale:* this is the exact pattern
  `test_mode_timeline_scrubber` settled (Decision §4), and the downstream
  seek/speed leaves will mount alongside the controls as further siblings —
  they need the position state lifted above them. *Alternative — keep all
  state inside `AudienceReplayRoute`:* rejected; the route also owns
  load/auth/CTA branching, and conflating playback state into it makes the
  downstream seek/speed wiring harder. *Alternative — push position into a
  URL query param now:* rejected; `?position` deep-linking is explicitly
  `replay_url_position_loading` (chained off the seek bar), and
  `aud_url_position_param` already owns the URL grammar — pre-empting it here
  would duplicate that seam.

- **§2 — Auto-advance is an app-local hook in `apps/audience`, not a shell
  helper.** The play loop (a `setInterval`/effect that steps via
  `nextPosition` and stops at `isAtEnd`) lives in the audience app.
  *Rationale:* there is exactly one consumer today, and the test-mode
  scrubber deliberately has **no** auto-advance (`test_mode_timeline_scrubber`
  notes the replay viewer "has its own separate seek-bar / playback leaves
  with play/pause/speed"). The reusable atoms (`nextPosition`, `isAtEnd`,
  `clampPosition`) already live in shell; only the timing loop is new, and
  YAGNI says keep a single-call-site hook app-local. *Alternative — add a
  `useReplayPlayback` hook to `@a-conversa/shell` now:* rejected; promoting
  to shell is cheap later if `replay_speed_controls` or a second consumer
  needs it, and premature sharing would force a shell-API decision with one
  user.

- **§3 — Fixed default cadence; speed is the next leaf.** Play advances one
  event-step per a single named interval constant (e.g.
  `DEFAULT_PLAYBACK_INTERVAL_MS`, tunable for watchability/test speed). The
  0.5×/1×/2× multipliers are `replay_speed_controls`. *Rationale:* the WBS
  splits speed into its own 1d leaf depending on this one; shipping a speed
  selector here would steal that scope. Keeping the cadence a single constant
  leaves a clean seam (multiply the interval) for the speed leaf to extend.

- **§4 — Per-event cadence, not original-timestamp real-time.** "1×" means a
  constant wall-clock interval per event-step, **not** replaying the original
  inter-event timing. *Rationale:* (a) the shipped replay primitive is
  event-sequence space, not timestamp space — honoring original timing would
  require a new timestamp-delta seam this task has no reason to build; (b) a
  debate log contains long human think-time gaps, so real-time playback would
  produce dead air and an unwatchable replay; (c) the test-mode scrubber is
  already per-event, keeping both replay surfaces on one mental model.
  *Alternative — schedule each step by the delta between consecutive event
  timestamps, scaled by the speed multiplier:* rejected for the dead-air and
  new-seam reasons above; can be revisited as a future "real-time replay"
  toggle if ever desired (surfaced to the parking lot, not encoded as a WBS
  task).

- **§5 — Land on head, restart-from-end on play.** The cursor initialises at
  the head (preserving ADR 0045's informative default frame); pressing play
  while `isAtEnd` resets to `0` before advancing. *Rationale:* without the
  not-yet-built seek bar, a viewer who lands on the complete frame has no way
  to get back to the start to watch the debate unfold — the restart-on-play
  affordance (standard in media players) makes the surface watchable with
  buttons alone, and ADR 0045:59 explicitly anticipates "playback controls
  [that] add scrubbing from the start." *Alternative — land at position 0
  (empty graph):* rejected — ADR 0045 already rejected an empty landing frame
  as confusing for a surface that (at the time) had no scrubber. *Alternative
  — disable play at the end with no restart:* rejected — it strands the
  default head-landing viewer with no path to the beginning until the seek
  bar ships.

- **§6 — No Cucumber pin.** This leaf reads no new endpoint, emits no
  envelope, and changes no broadcast/projector output — it is a pure UI
  consumer of `useSessionEventLog` + the shell position helpers (both already
  pinned). *Rationale:* per the backend/WS Cucumber rule, Vitest + Playwright
  are the right pins for UI-only behavior; Cucumber is owed only when wire,
  broadcast, or replay-boundary behavior changes, and none does here.

- **§7 — No new ADR.** Every choice above reuses an existing seam (the shell
  position contract / ADR 0043, the `GraphView` prefix render / ADR 0039, the
  lifted-container pattern from `test_mode_timeline_scrubber`, the
  head-landing default / ADR 0045). No new dependency, architectural seam, or
  security-relevant trade-off is introduced, so these are refinement-level
  Decisions, not an ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Created `apps/audience/src/replay/useReplayPlayback.ts` — app-local auto-advance hook with `DEFAULT_PLAYBACK_INTERVAL_MS`, self-terminating at head, with timer cleanup on unmount/pause.
- Created `apps/audience/src/replay/ReplayPlaybackContainer.tsx` — lifted-position owner (initialised at `replayHeadSequence(events)`) with play/pause/step-back/step-forward controls and a position readout over `GraphView`.
- Created `apps/audience/src/replay/ReplayPlaybackContainer.test.tsx` — Vitest component tests: controls+stepping (4 cases) and play-loop with fake-timers (3 cases).
- Edited `apps/audience/src/routes/AudienceReplayRoute.tsx` — `ready` branch now renders `<ReplayPlaybackContainer>` instead of a direct `<GraphView>`.
- Edited `apps/audience/src/routes/AudienceReplayRoute.test.tsx` — ready-case assertions updated to assert container + controls presence.
- Edited `tests/e2e/audience-replay.spec.ts` — added test (5): "playback controls: step + play/pause move the position over the replay".
- Edited i18n catalogs — `audience.replay.playback.*` keys added to `en-US.json`, `pt-BR.json`, `es-419.json`, with pending arrays in `pt-BR.review.json` and `es-419.review.json`.
- No deferred-e2e debt created; two parking-lot items appended (pt-BR/es-419 native review; real-time timestamp-cadence toggle).
