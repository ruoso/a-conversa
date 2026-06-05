# replay_seek_bar — Seek bar showing position in the event log

## TaskJuggler entry

- **Task:** `replay_test.replay_ui.replay_seek_bar`
- **Defined in:** [`tasks/60-replay-and-test-mode.tji:55`](../../60-replay-and-test-mode.tji#L55)
- **Title:** "Seek bar showing position in the event log"
- **Refinement back-link:** this document.

## Effort estimate

**1d** (per the `.tji` block). The work is small: the lifted-position
container, the shell position contract, and the controls cluster already
exist (`replay_playback_controls`), and the **exact seek-bar widget already
ships in the test-mode scrubber** — a controlled `<input type="range">`
funnelling through `clampPosition`
([`apps/test-mode/src/scrubber/TimelineScrubber.tsx:122-132`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L122)).
This leaf ports that widget into the audience replay controls cluster and
extends the existing test surfaces. No new seam.

## Inherited dependencies

Direct: `depends !replay_playback_controls`
([`.tji:58`](../../60-replay-and-test-mode.tji#L58)). The parent `replay_ui`
group also carries `depends data_and_methodology.replay_primitive,
audience.aud_graph_rendering, audience.aud_animations`
([`.tji:32`](../../60-replay-and-test-mode.tji#L32)); the stream root
`replay_test` depends
`backend.backend_tests.be_e2e_tests.auth_flow_integration`
([`.tji:30`](../../60-replay-and-test-mode.tji#L30)).

**Settled:**

- **`replay_playback_controls`** — done 2026-06-05. Built
  [`apps/audience/src/replay/ReplayPlaybackContainer.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx),
  the lifted-position owner that `AudienceReplayRoute`'s `ready` branch
  mounts. It owns `const [position, setPosition] = useState(() =>
  replayHeadSequence(events))` and a `clampPosition`-guarded `updatePosition`
  setter
  ([`ReplayPlaybackContainer.tsx:56-62`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L56)),
  renders `GraphView` fed the position prefix
  ([`:77-80,102`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L77)),
  a play/pause + step-back + step-forward button cluster, and a
  `role="status"` text position readout
  ([`:104-151`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L104)).
  Its own refinement (§Pending) explicitly names *this* leaf as the owner of
  "the rich draggable bar" and ships only the text readout for now.
- **The replay-position contract (ADR 0043)** —
  [`packages/shell/src/replay-position/replay-position.ts`](../../../packages/shell/src/replay-position/replay-position.ts)
  exports `nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`,
  `replayHeadSequence`, `clampPosition`. Position is event-sequence space,
  stops `0..head`, `0` is the pre-history baseline. Re-exported from
  `@a-conversa/shell`.
- **The seek-bar precedent** —
  [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:122-132`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L122):
  `<input type="range" min={0} max={head} step={1} value={position}
  onChange={onScrub}>` where `onScrub` calls `setPosition(clampPosition(
  Number(e.target.value), events))`
  ([`:83-85`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L83)).
  Controlled by `value={position}`, so the thumb tracks any writer.
- **ADR 0045 (audience replay visibility-gating)** — the surface lands on the
  head frame by default; the seek bar must not change that default-landing
  posture (the cursor still seeds at `replayHeadSequence(events)`).
- **ADR 0039 (`@a-conversa/graph-view`)** — the prefix-render renderer; it
  re-projects when the position prefix changes.

**Pending (downstream — explicitly NOT this task):**

- **`replay_url_position_loading`** ([`.tji:60`](../../60-replay-and-test-mode.tji#L60),
  `depends !replay_seek_bar, audience.aud_url_routing.aud_url_position_param`)
  — load replay starting at a URL-supplied position. Consumes the seek bar's
  position state; owns the `?position` URL grammar.
- **`replay_chapter_jumping`** ([`.tji:65`](../../60-replay-and-test-mode.tji#L65),
  `depends !replay_seek_bar, data_and_methodology.replay_primitive.snapshot_resolution`)
  — next/prev snapshot via chapter markers. Owns the snapshot **tick marks**
  on the seek bar; this task ships a plain (unmarked) bar (Decision §3).
- **`replay_speed_controls`** ([`.tji:50`](../../60-replay-and-test-mode.tji#L50))
  — independent sibling off `replay_playback_controls`; not this task.

## What this task is

Add a **draggable seek bar** to the audience replay viewer. Today
`ReplayPlaybackContainer` shows play/pause + step buttons and a text
`position / head` readout, but the only way to move more than one event at a
time is to hold a step button. This leaf adds a controlled range slider —
the same widget the test-mode scrubber already uses — to the existing
controls cluster, so a viewer can drag directly to any point in the log. The
thumb is bound to the lifted `position`, so it also **doubles as a playback
progress indicator**: as the auto-advance loop steps the cursor, the thumb
moves on its own. The graph re-renders client-side from the position prefix
exactly as it does today; the seek bar is a new writer of `position`, not a
new data path.

## Why it needs to be done

`replay_playback_controls` deliberately shipped buttons + a text readout and
deferred "the rich draggable bar" to this leaf (its refinement, §Pending and
§What-this-task-is). Stepping one event at a time through a long debate log
is tedious; the seek bar is what makes the replay **navigable** — jump to the
middle, scrub back, watch progress. It is also the hinge for the two
downstream replay leaves: `replay_url_position_loading` and
`replay_chapter_jumping` both `depends !replay_seek_bar` — URL-position
loading sets the bar's initial position, and chapter jumping decorates the
bar with snapshot tick marks. Neither can land until the bar exists.

## Inputs / context

- **Surface to extend:**
  [`apps/audience/src/replay/ReplayPlaybackContainer.tsx:104-151`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L104)
  — the `data-testid="audience-replay-controls"` group div holding the
  buttons and the text readout. The seek bar mounts here as a sibling. The
  state ownership (`:56-62`), the `updatePosition` guard, the
  `useReplayPlayback` wiring (`:64-68`), and `head`/`atStart`/`atEnd`
  (`:70-72`) are all already in hand.
- **Seek-bar widget to port:**
  [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:83-85,122-132`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L83)
  — the `onScrub` handler and the controlled `<input type="range">`.
- **Position helpers:**
  [`packages/shell/src/replay-position/replay-position.ts`](../../../packages/shell/src/replay-position/replay-position.ts)
  — `clampPosition(value, events)`, `replayHeadSequence(events)`,
  `isAtEnd(events, position)`. No new helper is needed.
- **Existing replay e2e:**
  [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
  (the `chromium-audience-replay` project). Test (5) at
  [`:264`](../../../tests/e2e/audience-replay.spec.ts#L264) already drives the
  controls via `audience-replay-play` / `-step-back` / `-step-forward` /
  `-position` testids; this task adds a seek-bar test alongside it.
- **Existing Vitest component test:**
  [`apps/audience/src/replay/ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
  — extend with seek-bar cases.
- **i18n catalogs:**
  [`packages/i18n-catalogs/src/catalogs/en-US.json:1053-1060`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L1053)
  — the `audience.replay.playback.*` namespace (`play`, `pause`, `stepBack`,
  `stepForward`, `positionStatus`, `regionAriaLabel`). The one new label goes
  here; mirror the test-mode `testMode.scrubber.rangeAriaLabel`
  ([`:1082`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L1082)).
  pt-BR / es-419 + their `.review.json` companions take the new key too.
- **Accessibility:** ADR 0040 (axe-playwright stays clean). A native
  `<input type="range">` is keyboard-operable and screen-reader-labelled for
  free given an `aria-label`.

## Constraints / requirements

1. **Reuse the test-mode range widget verbatim in shape** — a controlled
   `<input type="range" min={0} max={head} step={1} value={position}>` whose
   `onChange` funnels through `clampPosition(Number(value), events)` and the
   existing `updatePosition` setter. Do not introduce a custom pointer-event
   drag surface (Decision §1).
2. **Single guarded setter** — the seek bar writes `position` only through
   the same `updatePosition`/`clampPosition` path the buttons and the
   auto-advance loop use; no parallel sequence arithmetic in the audience app
   (ADR 0043 is the single source of truth).
3. **Controlled by `position`** — `value={position}` so the thumb tracks the
   buttons and the play loop (doubles as a progress indicator); no local
   slider state.
4. **Preserve the head-landing default** — the no-interaction view is
   unchanged; the cursor still seeds at `replayHeadSequence(events)`
   (ADR 0045).
5. **Plain bar, no chapter ticks** — snapshot tick marks are
   `replay_chapter_jumping` (Decision §3). This bar has no `<datalist>` /
   marker decoration.
6. **Keep the text readout** — the `role="status"` `position / head` readout
   shipped by `replay_playback_controls` stays; the bar is the visual
   affordance, the readout is the accessible announce surface (Decision §4).
7. **Touch only `ReplayPlaybackContainer`** — the route's load/auth/CTA
   branches and the play-loop hook are unchanged; the bar renders only in the
   already-`ready` controls cluster.
8. **Accessibility** — the range input carries a localized `aria-label`; the
   axe pass on the replay route stays clean (ADR 0040).
9. **No new wire/broadcast/projector behavior** — pure UI consumer of
   already-pinned seams; no Cucumber pin is owed (Decision §6).

## Acceptance criteria

All criteria are committed, non-throwaway tests (ADR 0022) — they pin the
observable behavior of the seek bar, not implementation detail.

1. **Vitest (component) — seek widget.** Extend
   [`ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
   against a fixed multi-event log fixture: the `ready` render exposes a seek
   input (stable `data-testid`, e.g. `audience-replay-seek`) with `min=0`,
   `max=head`, `value=head` at first render; firing a change to a mid value
   relocates the position (the readout/`data-position` and the `GraphView`
   `events` prop length update accordingly); a change to a value past `head`
   or below `0` is clamped; step-forward becomes disabled once the bar is
   dragged to `head` (`isAtEnd`).
2. **Vitest (component) — bar tracks playback.** Using fake timers (the
   existing play-loop test harness): after pressing play and advancing the
   timer one tick, the seek input's `value` has incremented by one event —
   the thumb is a live progress indicator, not just an input.
3. **Playwright (e2e) — reachable behavior.** Extend
   [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
   (the `chromium-audience-replay` project) on the existing authenticated
   replay fixture, alongside test (5): the seek bar is present
   (`audience-replay-seek`); setting it to a mid position updates the
   `audience-replay-position` readout and the rendered graph; pressing play
   advances the seek value over wall-clock time. **E2e is in scope, not
   deferred** — the surface is already reachable at `/a/replay/:id` and
   `replay_playback_controls` already renders the controls cluster this task
   adds to, so the "not yet reachable" deferral exception does not apply.
4. **i18n parity.** One new `audience.replay.playback.seekAriaLabel` key added
   to `en-US.json`, `pt-BR.json`, `es-419.json` and the two `.review.json`
   companions; `pnpm --filter @a-conversa/i18n-catalogs run check` passes
   (catalog parity). Native-speaker review of the pt-BR / es-419 string is
   **not** a WBS task — flagged for the parking lot (see return summary).
5. **Accessibility.** The axe-playwright pass on the replay route stays clean
   with the new range input (ADR 0040).
6. **Build + test gate.** `make` build + the full unit/e2e suites pass before
   the closer commits (global build-and-test rule).

No deferred-e2e debt is created by this task, and none is inherited: the WBS
and sibling-refinement search surfaced no `note` / Status line pointing
deferred seek-bar coverage *at* this task. The two downstream leaves
(`replay_url_position_loading`, `replay_chapter_jumping`) already exist as WBS
leaves depending on `!replay_seek_bar`; no new task registration is owed.

## Decisions

- **§1 — Port the test-mode controlled `<input type="range">`; mount it in
  the existing controls cluster.** Add the slider as a sibling of the buttons
  and readout inside the `audience-replay-controls` group, wired through the
  existing `updatePosition`/`clampPosition` guard — a near-verbatim copy of
  [`TimelineScrubber.tsx:83-85,122-132`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx#L83).
  *Rationale:* the widget, the contract, and the test pattern already exist
  and ship in production; a native range input is keyboard-operable and
  screen-reader-labelled for free (ADR 0040), and reusing it keeps both replay
  surfaces on one mental model. *Alternative — a custom div + pointer-event
  draggable bar:* rejected — it reinvents native keyboard/ARIA support, costs
  more than the 1d budget, and risks the axe pass for no user-visible gain.
- **§2 — Seek relocates the cursor; playback continues from the new
  position (no auto-pause on seek).** Dragging while playing simply writes a
  new `position`; the auto-advance loop keys off the current `position`
  (`useReplayPlayback` reads it
  [`ReplayPlaybackContainer.tsx:64-68`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L64)),
  so play resumes from where the thumb was dropped. Both the slider and the
  timer tick funnel through the single guarded setter, so last-write-wins —
  no race state to manage. *Rationale:* simplest behavior that is correct;
  matches the test-mode surface where the range and the step buttons already
  coexist against one lifted setter. *Alternative — pause-on-grab (some media
  players):* rejected — extra interaction state for a 1d leaf with no
  demonstrated need; if UX testing later wants it, it is a tweak, not a new
  seam (surfaced to the parking lot, not encoded as a WBS task).
- **§3 — Plain seek bar, no chapter tick marks.** The bar has no snapshot
  markers / `<datalist>`. *Rationale:* snapshot chapter markers are
  `replay_chapter_jumping` (`.tji:65`, `depends !replay_seek_bar`) —
  decorating the bar here would steal that downstream leaf's scope.
- **§4 — Keep the text position readout alongside the bar.** The
  `role="status" aria-live="polite"` `position / head` readout
  ([`ReplayPlaybackContainer.tsx:141-150`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L141))
  stays. *Rationale:* it is the accessible announce surface for position
  changes; a range thumb's value is not reliably announced on every drag, so
  the readout remains the a11y status while the bar is the visual affordance —
  exactly how the test-mode scrubber pairs them.
- **§5 — Reuse the `audience.replay.playback.*` namespace; one new key.** Add
  `seekAriaLabel` (mirroring `testMode.scrubber.rangeAriaLabel`) to the
  existing playback namespace
  ([`en-US.json:1053`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L1053)).
  *Rationale:* the seek bar is part of the same playback control cluster;
  no new namespace is warranted for a single label.
- **§6 — No Cucumber pin.** This leaf reads no new endpoint, emits no
  envelope, and changes no broadcast/projector/replay-boundary output — it is
  a pure UI consumer of state already lifted by `replay_playback_controls`.
  *Rationale:* per the backend/WS Cucumber rule, Vitest + Playwright are the
  right pins for UI-only behavior.
- **§7 — No new ADR.** Every choice reuses an existing seam (the shell
  position contract / ADR 0043, the `GraphView` prefix render / ADR 0039, the
  head-landing default / ADR 0045, the `audience.replay.playback.*` i18n
  namespace / ADR 0024, the `data-testid` regression seams / ADR 0022, the
  a11y bar / ADR 0040). No new dependency, architectural seam, or
  security-relevant trade-off — these are refinement-level Decisions.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Added controlled `<input type="range" data-testid="audience-replay-seek">` to `apps/audience/src/replay/ReplayPlaybackContainer.tsx` wired through the existing `updatePosition`/`clampPosition` guard; thumb value is bound to `position` so it doubles as a playback progress indicator.
- New `onScrub` handler in `ReplayPlaybackContainer.tsx` mirrors the test-mode pattern (`TimelineScrubber.tsx:83-85`) exactly — no parallel sequence arithmetic, single guarded setter throughout.
- Vitest "seek bar" suite added to `apps/audience/src/replay/ReplayPlaybackContainer.test.tsx`: bounds at head, mid-seek relocates position + re-projects, clamping past head/below baseline, step-forward disabled at head; plus "seek bar tracks playback" suite confirming thumb advances on play-loop tick.
- Playwright test (6) added to `tests/e2e/audience-replay.spec.ts`: seek drag relocates `audience-replay-position` readout and thumb tracks playback over wall-clock time.
- New i18n key `audience.replay.playback.seekAriaLabel` added to `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`, and `pt-BR.review.json` / `es-419.review.json` companions; catalog parity check passes.
- No deferred-e2e debt created; no new WBS tasks registered (downstream leaves `replay_url_position_loading` and `replay_chapter_jumping` already exist and depend on `!replay_seek_bar`).
- Parking-lot entry added for the pause-on-grab UX alternative (Decision §2); native-speaker review of pt-BR/es-419 `seekAriaLabel` covered by the standing general translation review entry (2026-05-30).
