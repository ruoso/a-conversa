# replay_speed_controls — Playback speed controls (0.5×, 1×, 2×, …)

## TaskJuggler entry

- **Task:** `replay_test.replay_ui.replay_speed_controls`
- **Defined in:** [`tasks/60-replay-and-test-mode.tji:50`](../../60-replay-and-test-mode.tji#L50)
- **Title:** "Playback speed controls (0.5x, 1x, 2x, etc.)"
- **Refinement back-link:** this document.

## Effort estimate

**1d** (per the `.tji` block). The seam this leaf consumes already exists and
was built *for* it: `replay_playback_controls` (Decision §3) shipped a single
fixed cadence as the named constant `DEFAULT_PLAYBACK_INTERVAL_MS` and made
the auto-advance hook take an `intervalMs` override
([`apps/audience/src/replay/useReplayPlayback.ts:49-57`](../../../apps/audience/src/replay/useReplayPlayback.ts#L49)),
whose effect already re-subscribes the timer when `intervalMs` changes
([`useReplayPlayback.ts:104`](../../../apps/audience/src/replay/useReplayPlayback.ts#L104)).
This leaf adds a `speed` state to the existing
`ReplayPlaybackContainer`, a small selector control into the existing
controls cluster, and derives `intervalMs` from the multiplier — no new hook,
no new endpoint, no new shell seam.

## Inherited dependencies

Direct: `depends !replay_playback_controls`
([`.tji:53`](../../60-replay-and-test-mode.tji#L53)). The parent `replay_ui`
group also carries `depends data_and_methodology.replay_primitive,
audience.aud_graph_rendering, audience.aud_animations`
([`.tji:32`](../../60-replay-and-test-mode.tji#L32)), and the stream root
`replay_test` depends
`backend.backend_tests.be_e2e_tests.auth_flow_integration`
([`.tji:30`](../../60-replay-and-test-mode.tji#L30)).

**Settled:**

- **`replay_playback_controls`** — done 2026-06-05. Built the play/pause/step
  cluster and the auto-advance loop:
  - [`apps/audience/src/replay/useReplayPlayback.ts`](../../../apps/audience/src/replay/useReplayPlayback.ts)
    — the app-local auto-advance hook. It already accepts an optional
    `intervalMs` (defaulting to `DEFAULT_PLAYBACK_INTERVAL_MS = 1000`,
    [`:31`](../../../apps/audience/src/replay/useReplayPlayback.ts#L31)), and
    the comment at
    [`:28-29`](../../../apps/audience/src/replay/useReplayPlayback.ts#L28)
    names *this* leaf as the one that "extends this by multiplying the
    interval." The play effect's dependency array is `[isPlaying, intervalMs]`
    ([`:104`](../../../apps/audience/src/replay/useReplayPlayback.ts#L104)), so
    a cadence change tears down and re-creates a single clean interval — the
    re-subscribe seam this task needs is already in place.
  - [`apps/audience/src/replay/ReplayPlaybackContainer.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx)
    — the lifted-position owner. It mounts `useReplayPlayback({ events,
    position, setPosition })` **without** passing `intervalMs`
    ([`:90-94`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L90)),
    and renders the controls cluster (play, step-back, step-forward, seek bar,
    position readout) inside a `role="group"`
    ([`:137-196`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L137)).
    This is where the speed selector mounts and where the `speed` state lives.
  - [`apps/audience/src/replay/ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
    — the Vitest component suite (controls/stepping + fake-timer play loop)
    this task extends.
- **`replay_seek_bar`**, **`replay_url_position_loading`** — done 2026-06-05.
  They added the draggable seek bar and the `?position` deep-link seeding to
  the same container, both funnelling through the one `updatePosition` /
  `clampPosition` guard
  ([`ReplayPlaybackContainer.tsx:84-94`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L84)).
  Speed is **orthogonal** to position: it changes the auto-advance *cadence*,
  never the position arithmetic, so it does not touch that guard.
- **ADR 0043 (client position-navigation contract)** — unchanged by this
  task. Speed governs *when* the next step fires, not *which* step; the
  `nextPosition` / `isAtEnd` atoms are untouched.
- **ADR 0024 (react-i18next)** — the `audience.replay.playback.*` namespace
  is where the new speed labels go
  ([`packages/i18n-catalogs/src/catalogs/en-US.json:1053-1061`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L1053)).
- **ADR 0040 (axe-playwright clean)** — the new selector must keep the axe
  pass green.

**Pending (downstream — explicitly NOT this task):**

- **`replay_chapter_jumping`** ([`.tji:67`](../../60-replay-and-test-mode.tji#L67),
  `depends !replay_seek_bar, …`) — snapshot chapter markers; unrelated to
  speed.

## What this task is

Add a **playback-speed selector** to the replay viewer. Today the
auto-advance loop runs at a single fixed cadence
(`DEFAULT_PLAYBACK_INTERVAL_MS = 1000` ms per event-step). This leaf lets the
viewer pick a multiplier — **0.5×, 1×, 2×, 4×** — that scales the auto-advance
cadence, so the same event log can be watched slower (to study a single
turn) or faster (to skim a long debate).

Mechanically:

- The container gains a `speed` state (default `1`), lifted alongside
  `position`.
- A selector control (a native `<select>`) renders into the existing controls
  cluster, listing the multipliers; selecting one sets `speed`.
- The container derives `intervalMs = DEFAULT_PLAYBACK_INTERVAL_MS / speed`
  and passes it to `useReplayPlayback`, which already re-subscribes its
  interval on change. 2× → 500 ms/step; 0.5× → 2000 ms/step.

Speed governs **only the auto-advance cadence**. Manual step-back/step-forward
stay ±1 event regardless of speed, and the position/seek/`?position` behavior
is untouched.

## Why it needs to be done

The WBS split speed into its own 1d leaf depending on
`replay_playback_controls` precisely so the playback leaf could ship a watchable
single-cadence loop first and leave a clean seam (the `intervalMs` override)
for this one. A debate replay at a fixed 1 s/step is watchable but blunt: a
long session is tedious at 1× and a fast-moving exchange is hard to follow
without a slow option. The speed selector is the standard media-player
affordance that makes the replay surface usable across debate lengths. It is a
leaf — nothing downstream in replay-UI depends on it
(`replay_chapter_jumping` chains off the seek bar, not this).

## Inputs / context

- **Surface to extend (the controls cluster):**
  [`apps/audience/src/replay/ReplayPlaybackContainer.tsx:137-196`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L137)
  — the `role="group"` cluster holding play / step / seek / readout. The
  speed `<select>` mounts here as a new sibling. The `speed` state and the
  derived `intervalMs` go next to the existing `position` state
  ([`:80-94`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L80)).
- **The cadence seam:**
  [`apps/audience/src/replay/useReplayPlayback.ts:42-57`](../../../apps/audience/src/replay/useReplayPlayback.ts#L42)
  — `UseReplayPlaybackArgs.intervalMs?: number` (default
  `DEFAULT_PLAYBACK_INTERVAL_MS`). The play effect deps are
  `[isPlaying, intervalMs]`
  ([`:104`](../../../apps/audience/src/replay/useReplayPlayback.ts#L104)) — a
  speed change while playing cleanly swaps the interval (old cleared on
  cleanup, new one created). **No hook change is required**; the container
  just stops omitting `intervalMs`.
- **i18n catalogs:**
  [`packages/i18n-catalogs/src/catalogs/en-US.json:1053-1061`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L1053)
  — the `audience.replay.playback.*` block. Mirror new keys into
  `pt-BR.json` / `es-419.json` and add pending entries to the
  `pt-BR.review.json` / `es-419.review.json` companions (the i18n catalog
  workflow).
- **Vitest suite to extend:**
  [`apps/audience/src/replay/ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
  — the fake-timer play-loop tests already exercise cadence; the speed test
  injects multipliers and asserts the advance rate changes.
- **Playwright spec to extend:**
  [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
  — the `chromium-audience-replay` project. Tests `(1)`–`(7)` are present;
  this task adds `(8)`. Test `(5)` (playback controls) is the closest
  template.
- **Accessibility:** ADR 0040 — the selector needs a localized accessible
  name; the native `<select>` is keyboard-operable and axe-clean by
  construction.

## Constraints / requirements

1. **Reuse the `intervalMs` seam — derive, don't re-implement.** The container
   computes `intervalMs` from `speed` and passes it to `useReplayPlayback`. Do
   **not** add a second timer, a speed-aware variant of the hook, or any
   sequence/timing arithmetic outside the existing loop. The hook stays the
   single owner of the interval (it already re-subscribes on `intervalMs`).
2. **Speed is cadence-only.** The multiplier scales the auto-advance interval
   and nothing else. Manual step buttons advance ±1 event at any speed; the
   position prefix render, the seek bar, the `?position` seeding, and
   `clampPosition` are untouched.
3. **`1×` is the default and the existing behavior.** With no interaction the
   loop runs at `DEFAULT_PLAYBACK_INTERVAL_MS` exactly as today — `speed`
   initialises at `1`, and `DEFAULT_PLAYBACK_INTERVAL_MS / 1` is the unchanged
   constant. This task must not regress the shipped 1× cadence.
4. **Changing speed mid-play takes effect immediately and cleanly.** Selecting
   a new speed while playing must continue the run at the new cadence without
   leaking the old timer, without stopping playback, and without losing
   position (the hook's `[isPlaying, intervalMs]` effect already guarantees a
   single live interval — rely on it; do not pause/replay around the change).
5. **Fixed, finite multiplier set.** A small named list — `0.5, 1, 2, 4` — not
   a free-form number input. Keep it a single constant array in the container
   so the option list and the test fixture share one source.
6. **Accessibility (ADR 0040).** The selector carries a localized accessible
   name (`aria-label` / associated label); the axe-playwright pass on the
   replay route stays clean.
7. **i18n parity.** New `audience.replay.playback.*` keys land in all three
   catalogs with `.review.json` companions for pt-BR / es-419; option labels
   are locale-number-formatted via ICU (so `0.5` renders correctly per
   locale), not hardcoded.
8. **No new wire/broadcast/projector behavior.** Pure UI consumer of an
   already-pinned hook; no endpoint, no envelope, no replay-boundary change —
   no Cucumber pin is owed (Decisions §5).

## Acceptance criteria

All criteria are committed, non-throwaway tests (ADR 0022) — they pin the
observable behavior of the speed control, not implementation detail.

1. **Vitest (component) — selector presence + default.** Against a fixed
   multi-event log fixture, the `ready` render shows a speed selector
   (stable `data-testid`, e.g. `audience-replay-speed`) listing the
   multipliers, with `1×` selected by default. Selecting a different option
   updates the reflected value (assert via the control value and/or a
   `data-speed` seam).
2. **Vitest (component) — speed scales the cadence (fake timers).** Using fake
   timers: at `2×` the auto-advance position advances **twice as fast** as at
   `1×` over the same elapsed fake time (i.e. one step per
   `DEFAULT_PLAYBACK_INTERVAL_MS / 2`); at `0.5×` it advances **half as fast**
   (one step per `2 × DEFAULT_PLAYBACK_INTERVAL_MS`). Assert by advancing the
   fake clock by a known amount and checking the resulting `data-position`.
3. **Vitest (component) — mid-play speed change (fake timers).** Pressing play
   at `1×`, advancing a tick, then selecting `2×` continues advancing at the
   faster cadence; the run does not stop, no act-warning / post-change stale
   tick occurs, and a single timer remains (assert no double-advance per
   interval). The self-terminate-at-head behavior still holds at any speed.
4. **Playwright (e2e) — reachable behavior.** Extend
   [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
   (the `chromium-audience-replay` project) as test `(8)` on the existing
   authenticated replay fixture: the speed selector is present and defaults to
   `1×`; selecting `2×` is reflected in the control; pressing play advances
   the position readout. **E2e is in scope, not deferred** — the surface is
   already reachable at `/a/replay/:id` and renders this control into the
   live cluster, so the "not yet reachable" deferral exception does not apply.
   Precise per-step cadence timing is pinned by the Vitest fake-timer tests
   (criteria 2–3), not by wall-clock Playwright assertions — the e2e asserts
   *that* the chosen speed is applied and playback advances, mirroring how
   test `(5)` handles the play loop, to stay non-flaky.
5. **i18n parity.** New `audience.replay.playback.*` keys (the selector
   accessible name + the multiplier option format) added to `en-US.json`,
   `pt-BR.json`, `es-419.json`, with pending entries in `pt-BR.review.json`
   and `es-419.review.json`;
   `pnpm --filter @a-conversa/i18n-catalogs run check` passes. Human-language
   review of the pt-BR / es-419 strings is **not** a WBS task — flagged for
   the parking lot (see return summary).
6. **Accessibility.** The axe-playwright pass on the replay route stays clean
   with the new selector (ADR 0040).
7. **Build + test gate.** `make` build + the full unit/e2e suites pass before
   the closer commits (global build-and-test rule).

No deferred-e2e debt is created by this task, and none is inherited: a search
of the WBS and sibling refinements surfaced no `note` / Status line pointing
deferred replay-speed coverage *at* this task.

## Decisions

- **§1 — Lift a `speed` multiplier state into the existing container; derive
  `intervalMs` from it.** Add `const [speed, setSpeed] = useState(1)` next to
  `position` in `ReplayPlaybackContainer`, compute `intervalMs =
  DEFAULT_PLAYBACK_INTERVAL_MS / speed`, and pass it to `useReplayPlayback`.
  *Rationale:* the playback leaf built the hook to take `intervalMs` and
  re-subscribe on change *expressly* for this task
  ([`useReplayPlayback.ts:28-29`](../../../apps/audience/src/replay/useReplayPlayback.ts#L28)) —
  this is the cheapest seam, no hook change, one source of timing truth.
  *Alternative — push speed state into `useReplayPlayback` (a `setSpeed` in the
  returned API):* rejected; the hook deliberately owns only the timing loop,
  and the container already owns the other lifted UI state (`position`) — a
  speed multiplier is sibling UI state, and keeping it in the container leaves
  the hook a single-responsibility timer. *Alternative — promote a
  `useReplayPlayback` speed parameter to `@a-conversa/shell`:* rejected for the
  same YAGNI reason `replay_playback_controls` kept the loop app-local
  (Decision §2 there) — one consumer, no shared contract owed.

- **§2 — `intervalMs = base / speed` (higher speed = shorter interval).** The
  multiplier scales the *rate*, so it divides the interval: 2× halves the
  per-step delay, 0.5× doubles it. `1×` is exactly the shipped constant, so
  the default path is a no-op change to today's behavior (Constraint §3).
  *Rationale:* matches the universal media-player mental model and keeps the
  arithmetic a single obvious expression; the hook's existing re-subscribe on
  `intervalMs` makes mid-play changes Just Work. *Alternative — multiply (more
  speed = longer interval):* rejected as inverted/confusing.

- **§3 — Fixed multiplier set `{0.5, 1, 2, 4}` as one named constant.** A
  small finite ladder, default `1`, defined once in the container and shared by
  the option list and the tests. *Rationale:* the `.tji` title says "0.5x, 1x,
  2x, etc." — a discrete ladder, not a continuous control; four steps cover
  slow-study (0.5×), normal (1×), skim (2×), and fast-skim (4×) without
  cluttering the cluster. A single constant array keeps the UI and the test
  fixture in lockstep. *Alternative — a free-form numeric input or a continuous
  slider:* rejected; over-scoped for the stated affordance, harder to make
  axe-clean and locale-format, and invites pathological values (0, negatives)
  the discrete ladder forecloses.

- **§4 — Native `<select>` control, not a segmented button group.** Render the
  ladder as a single `<select>` with one `<option>` per multiplier.
  *Rationale:* one element, keyboard-operable and axe-clean by construction
  (ADR 0040), trivially driven in Playwright via `selectOption` and asserted
  by value, and localizable with a single `aria-label` + ICU-formatted option
  labels. *Alternative — a row of `aria-pressed` toggle buttons (mirroring the
  existing play/step buttons):* rejected; it adds four interactive elements and
  a roving-selection a11y burden to a cluster that already holds five controls,
  for no behavioral gain over a `<select>`. The existing buttons are *actions*;
  speed is a *single-choice setting*, which a `<select>` models more honestly.

- **§5 — No Cucumber pin; no new ADR.** This leaf reads no new endpoint, emits
  no envelope, and changes no broadcast/projector or replay-boundary output —
  it is a pure UI consumer of the already-pinned `useReplayPlayback`
  `intervalMs` seam and the shell position helpers. *Rationale:* per the
  backend/WS Cucumber rule, Vitest + Playwright are the right pins for UI-only
  behavior. Every choice reuses an existing seam (the `intervalMs` override
  from `replay_playback_controls`, the `audience.replay.playback.*` i18n
  namespace / ADR 0024, the lifted-container pattern), introduces no new
  dependency, architectural seam, or security-relevant trade-off — so these
  are refinement-level Decisions, not an ADR.

- **§6 — Speed persists across the restart-from-end affordance.** Pressing play
  at the head restarts position from `0` (the playback leaf's Decision §5) but
  leaves `speed` untouched — the viewer's chosen pace carries into the
  re-watch. *Rationale:* speed and position are orthogonal state; resetting the
  pace on every loop-around would be surprising. No extra code is needed — they
  are independent `useState`s — but pinning it as a decision prevents a
  future "reset speed on restart" regression.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Added `SPEED_OPTIONS` constant (`[0.5, 1, 2, 4]`), `speed` state, and derived `intervalMs = DEFAULT_PLAYBACK_INTERVAL_MS / speed` in `apps/audience/src/replay/ReplayPlaybackContainer.tsx`.
- Wired derived `intervalMs` into `useReplayPlayback` call so the existing re-subscribe seam handles mid-play cadence changes cleanly.
- Added a native `<select>` with `data-testid="audience-replay-speed"` / `data-speed` seam and localized `aria-label` into the controls cluster in `apps/audience/src/replay/ReplayPlaybackContainer.tsx`.
- Extended `apps/audience/src/replay/ReplayPlaybackContainer.test.tsx` with six Vitest cases: selector presence/default, select-updates-value, 2× cadence scaling, 0.5× cadence scaling, mid-play speed change (single live timer, no stale tick), and self-terminate-at-head at 2×.
- Added Playwright test `(8) speed control` to `tests/e2e/audience-replay.spec.ts`: asserts default 1×, `selectOption('2×')` reflected, play advances the position readout.
- Added `audience.replay.playback.speedAriaLabel` and `audience.replay.playback.speedOption` (ICU `{speed, number}`) keys to `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, and `es-419.json`; pending entries in `pt-BR.review.json` and `es-419.review.json`.
- No new hook, endpoint, or architecture seam — pure consumer of the existing `intervalMs` override in `useReplayPlayback`.
