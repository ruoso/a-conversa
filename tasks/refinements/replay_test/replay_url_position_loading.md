# replay_url_position_loading — Load replay starting at URL-supplied position

## TaskJuggler entry

- **Task:** `replay_test.replay_ui.replay_url_position_loading`
- **Defined in:** [`tasks/60-replay-and-test-mode.tji:61`](../../60-replay-and-test-mode.tji#L61)
- **Title:** "Load replay starting at URL-supplied position"
- **Refinement back-link:** this document.

## Effort estimate

**0.5d** (per the `.tji` block). This is the smallest leaf in the replay-UI
group, and deliberately so: both halves of the work already ship. The
`?position=<sequence>` URL grammar and its reactive reader
(`useAudienceLogPosition`) landed with
`audience.aud_url_routing.aud_url_position_param`; the lifted-position
container and the `clampPosition` guard landed with `replay_playback_controls`
/ `replay_seek_bar`. This leaf is the ~30-line seam that threads the one into
the other — read the param at the route, seed the container's initial cursor
from it (clamped against the loaded log), fall back to the head frame when the
param is absent or out of range — plus the tests that pin it. No new helper,
endpoint, or i18n string.

## Inherited dependencies

Direct: `depends !replay_seek_bar, audience.aud_url_routing.aud_url_position_param`
([`.tji:64`](../../60-replay-and-test-mode.tji#L64)). The parent `replay_ui`
group also carries `depends data_and_methodology.replay_primitive,
audience.aud_graph_rendering, audience.aud_animations`
([`.tji:32`](../../60-replay-and-test-mode.tji#L32)); the stream root
`replay_test` depends
`backend.backend_tests.be_e2e_tests.auth_flow_integration`
([`.tji:30`](../../60-replay-and-test-mode.tji#L30)).

**Settled:**

- **`aud_url_position_param`** — done 2026-05-27. Shipped the pure parser
  [`apps/audience/src/state/positionParam.ts`](../../../apps/audience/src/state/positionParam.ts)
  (`parsePositionParam(searchParams): number | null`) and its reactive hook
  [`apps/audience/src/state/useAudienceLogPosition.ts`](../../../apps/audience/src/state/useAudienceLogPosition.ts)
  (`useAudienceLogPosition(): number | null`, wrapping React Router's
  `useSearchParams()`), both re-exported from the audience state barrel
  [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts).
  The accepted value-space is the event envelope's `sequence` field —
  nonnegative integer (`Decision §R2`, mirroring
  [`packages/shared-types/src/events.ts:796`](../../../packages/shared-types/src/events.ts#L796));
  `"0"` is valid (log genesis), `"-1"`/`"3.5"`/`"abc"`/missing all yield
  `null` (`Decision §R4/§R5`). Crucially, that leaf's `Decision §R5` /
  `Decision §R6` **deliberately left the route reading the value but not
  branching on it**, and **left bounds-against-the-log clamping to this
  task** — the parser validates syntax (nonnegative int) but not range
  against a session's high-water mark, because only the replay consumer knows
  the loaded log's head.
- **`replay_playback_controls`** — done 2026-06-05. Built
  [`apps/audience/src/replay/ReplayPlaybackContainer.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx),
  the lifted-position owner that `AudienceReplayRoute`'s `ready` branch mounts.
  It seeds `const [position, setPosition] = useState(() =>
  replayHeadSequence(events))`
  ([`:63`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L63))
  and writes only through the `clampPosition`-guarded `updatePosition` setter
  ([`:67-69`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L67)).
  Today it takes only `{ sessionId, events }` — it is router-agnostic.
- **`replay_seek_bar`** — done 2026-06-05. Added the controlled
  `<input type="range">` (`data-testid="audience-replay-seek"`) bound to the
  same lifted `position`
  ([`:155-165`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L155)).
  The bar's thumb reflects whatever the initial cursor is, so a URL-seeded
  position is visible on the bar at first paint for free.
- **The replay-position contract (ADR 0043)** —
  [`packages/shell/src/replay-position/replay-position.ts`](../../../packages/shell/src/replay-position/replay-position.ts)
  exports `clampPosition(value, events)` and `replayHeadSequence(events)`.
  `clampPosition`'s docstring explicitly names *"a parsed query param"* as an
  input it snaps into `[0, head]`: `NaN`/negatives floor to `0`, values past
  the head clamp to the head, fractional truncates toward zero
  ([`:86-98`](../../../packages/shell/src/replay-position/replay-position.ts#L86)).
  This is exactly the out-of-range handling this leaf owes.
- **ADR 0045 (audience replay visibility-gating / head-landing default)** —
  the surface lands on the complete-session head frame when there is no
  position to honor. A URL-supplied position overrides that *initial* frame;
  absence preserves it.
- **The route to extend:**
  [`apps/audience/src/routes/AudienceReplayRoute.tsx`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx)
  — mounts `ReplayPlaybackContainer` only in its `ready` branch
  ([`:106`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx#L106)),
  where `events` is loaded and the head is knowable.

**Pending (downstream — explicitly NOT this task):**

- **`replay_chapter_jumping`** ([`.tji:66`](../../60-replay-and-test-mode.tji#L66))
  — next/prev snapshot via chapter markers; independent of URL position.
- **`replay_speed_controls`** ([`.tji:50`](../../60-replay-and-test-mode.tji#L50))
  — independent sibling off `replay_playback_controls`.

## What this task is

Make the audience replay viewer **honor a `?position=<sequence>` query
parameter as its opening frame.** Today `/a/replay/:id` always opens on the
log head (the fully-projected, complete-session graph). After this leaf,
`/a/replay/:id?position=42` opens with the cursor seeded at sequence 42 — the
graph shows the prefix of events `<= 42`, the seek-bar thumb sits at 42, and
the play / step controls take over from there. A missing, malformed, or
out-of-range `position` falls back to the head frame exactly as today. The
URL is read **once at mount** to seed the initial cursor; from then on the
existing controls own `position`. This is a one-way URL → state binding — the
deep-link *into* the replay — not a two-way sync that rewrites the URL as the
user scrubs (out of scope; see Decision §3).

## Why it needs to be done

`aud_url_position_param` shipped the `?position` reader specifically so a
replay could be deep-linked to a moment in a debate — its `Decision §R6`
calls out that "branching is the downstream task's responsibility
(`replay_url_position_loading`)" and that speculative branching there "would
either be no-op dead code or lock in behaviour choices prematurely." This is
that downstream task. The user-facing payoff is shareable links: a moderator
or audience member can paste a URL that drops the viewer at the exact event a
diagnostic fired, instead of forcing the recipient to scrub there by hand.
The seam is the last piece wiring the URL grammar (already parsed and tested)
to the playback container (already lifted and tested) — neither half is
useful for deep-linking until this leaf joins them.

## Inputs / context

- **Param reader to consume (do not rebuild):**
  [`apps/audience/src/state/useAudienceLogPosition.ts`](../../../apps/audience/src/state/useAudienceLogPosition.ts)
  — `useAudienceLogPosition(): number | null`, re-exported from
  [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts).
  Returns the parsed nonnegative integer, or `null` for missing/invalid.
- **Route to extend:**
  [`apps/audience/src/routes/AudienceReplayRoute.tsx:40-43,106`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx#L40)
  — reads `useAudienceLogPosition()` here and passes it down; the
  load/auth/CTA branches above stay untouched.
- **Container to seed:**
  [`apps/audience/src/replay/ReplayPlaybackContainer.tsx:48-63`](../../../apps/audience/src/replay/ReplayPlaybackContainer.tsx#L48)
  — `ReplayPlaybackContainerProps` gains an optional `initialPosition`; the
  `useState` seeder at `:63` consumes it.
- **Clamp helper (out-of-range handling):**
  [`packages/shell/src/replay-position/replay-position.ts:86-98`](../../../packages/shell/src/replay-position/replay-position.ts#L86)
  — `clampPosition(urlPosition, events)`. No new helper is needed.
- **Existing Vitest component test:**
  [`apps/audience/src/replay/ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
  — extend with `initialPosition` cases (its existing no-prop cases must keep
  passing unchanged, pinning the head-default fallback).
- **Existing Vitest route test:**
  [`apps/audience/src/routes/AudienceReplayRoute.test.tsx`](../../../apps/audience/src/routes/AudienceReplayRoute.test.tsx)
  — already mounts the route under a router (the route calls `useParams`);
  extend it with a `?position=` entry. This is the seam where the hook →
  prop → seed chain is exercised end-to-end in a unit test.
- **Existing replay e2e:**
  [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
  (the `chromium-audience-replay` project,
  [`playwright.config.ts:435`](../../../playwright.config.ts#L435)) — add a
  deep-link scenario alongside the existing replay tests.

## Constraints / requirements

1. **Read the param at the route; pass it as a prop.** `AudienceReplayRoute`
   calls `useAudienceLogPosition()` and passes the result to
   `ReplayPlaybackContainer` as an optional `initialPosition` prop. The
   container stays router-agnostic — it does not import `useSearchParams` /
   `useAudienceLogPosition` itself (Decision §1).
2. **Seed once, then hand off.** `initialPosition` seeds only the container's
   initial `useState` cursor. After mount, the step buttons, seek bar, and
   auto-advance loop own `position` exactly as they do today; the param is not
   a controlled binding and the container does not re-seed if the search
   string changes mid-session (Decision §5).
3. **Clamp the URL value against the loaded log.** The initial cursor is
   `clampPosition(initialPosition, events)` — never the raw param. An
   out-of-range value (e.g. `?position=999999` on a 12-event log) lands at the
   head; this is the parser's deliberately-deferred bounds check
   (`aud_url_position_param` Decision §R5), and `clampPosition` is its single
   owner (ADR 0043). No parallel range arithmetic in the audience app.
4. **Distinguish "absent" from `position=0`.** `useAudienceLogPosition()`
   returns `null` for absent/invalid and `0` for the valid genesis frame.
   The seeder must branch on `initialPosition != null` (NOT a falsy check) so
   `?position=0` seeds the pre-history baseline frame while a missing param
   falls back to `replayHeadSequence(events)`. `0` is falsy — `initialPosition
   || head` would be a bug.
5. **Preserve the head-landing default.** With no (or an invalid/out-of-range)
   `position`, the no-deep-link view is byte-for-byte unchanged — head frame,
   complete session (ADR 0045). The existing `ReplayPlaybackContainer` and
   route Vitest cases that assert head-landing must pass unedited.
6. **Touch only the route + the container.** The change set is
   `AudienceReplayRoute.tsx` (read + pass the prop), `ReplayPlaybackContainer.tsx`
   (accept + seed from the prop), and the three test files. No change to the
   parser, the hook, the shell contract, or any endpoint.
7. **No new wire/broadcast/projector behavior, no new i18n.** This leaf adds
   no endpoint, envelope, broadcast, or user-visible string — it is a pure
   client-side URL → state wiring of already-pinned seams; no Cucumber pin and
   no catalog change are owed (Decision §6).

## Acceptance criteria

All criteria are committed, non-throwaway tests (ADR 0022) — they pin the
observable deep-link behavior, not implementation detail.

1. **Vitest (component) — `initialPosition` seeding.** Extend
   [`ReplayPlaybackContainer.test.tsx`](../../../apps/audience/src/replay/ReplayPlaybackContainer.test.tsx)
   against a fixed multi-event log fixture:
   - `initialPosition` set to a mid-log sequence → first render's
     `data-position` (and the seek input's `value`, and the `GraphView`
     `events` prop length = prefix `<= position`) reflect that sequence, not
     the head.
   - `initialPosition={0}` → seeds the baseline frame (`data-position="0"`,
     empty/pre-history prefix), proving the `!= null` branch (not a falsy
     check).
   - `initialPosition` past the head → clamped to the head (proves
     `clampPosition` is in the seeder path).
   - `initialPosition` omitted / `undefined` / `null` → seeds at the head
     (the existing no-prop behavior, asserted to still hold).
2. **Vitest (route) — hook → prop → seed.** Extend
   [`AudienceReplayRoute.test.tsx`](../../../apps/audience/src/routes/AudienceReplayRoute.test.tsx):
   mounting the `ready` route under the existing router harness with an
   initial entry of `/replay/<uuid>?position=<mid>` renders the container with
   its readout at `<mid>`; an entry with no `position` renders at the head;
   an entry with an out-of-range `position` renders at the head (clamped).
   This is the end-to-end unit pin that `useAudienceLogPosition()` is actually
   wired into the route and threaded to the container.
3. **Playwright (e2e) — deep-link reachable behavior.** Extend
   [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts)
   (the `chromium-audience-replay` project) on the existing authenticated
   replay fixture: navigating to `/a/replay/<seeded-uuid>?position=<mid>`
   opens with the `audience-replay-position` readout at `<mid>`, the
   `audience-replay-seek` thumb at `<mid>`, and the graph rendering the
   prefix; a separate navigation to an out-of-range `?position` opens at the
   head. **E2e is in scope, not deferred** — the replay route is already
   reachable at `/a/replay/:id` (shipped by `replay_mode_audience_surface`)
   and renders the controls cluster, so the "not yet reachable" deferral
   exception does not apply; this is the wiring task that makes the deep-link
   behavior user-visible, so it carries its own Playwright coverage rather
   than deferring it onward.
4. **No regression.** The existing `ReplayPlaybackContainer.test.tsx`,
   `AudienceReplayRoute.test.tsx`, and `audience-replay.spec.ts` cases pass
   unedited (head-landing default + playback controls + seek bar unchanged).
5. **Accessibility.** The axe-playwright pass on the replay route stays clean
   (ADR 0040) — no new DOM, so this is a no-op confirmation.
6. **Build + test gate.** `make` build + the full unit/e2e suites pass before
   the closer commits (global build-and-test rule).

No deferred-e2e debt is created by this task, and none is inherited: the WBS
and sibling-refinement search surfaced no `note` / Status line pointing
deferred URL-position coverage *at* this task. No new WBS task registration is
owed.

## Decisions

- **§1 — Read the param at the route; thread it into the container as an
  optional `initialPosition` prop.** `AudienceReplayRoute` (already the URL
  layer — it reads `useParams`) calls `useAudienceLogPosition()` and passes
  the value down; `ReplayPlaybackContainer` gains
  `initialPosition?: number | null` and stays router-agnostic. *Rationale:*
  the container is a pure, prop-driven component whose existing Vitest suite
  mounts it without a router; reading the hook inside it would couple it to
  React Router and the state barrel and force every existing component test to
  wrap a `MemoryRouter` for no behavioral gain. Threading a prop keeps the
  inversion the codebase prefers (props-in), keeps the seed deterministic and
  unit-testable in isolation, and matches how the route already owns URL
  reads. *Alternative — container calls `useAudienceLogPosition()` directly:*
  rejected for the coupling/testability cost above.
- **§2 — Seed the initial cursor via `clampPosition(initialPosition,
  events)`; out-of-range lands at the head.** *Rationale:* the parser
  (`aud_url_position_param` §R5) validates *syntax* only and explicitly
  deferred *bounds* to this consumer, because only the loaded log knows its
  head. `clampPosition` is the shell's single owner of that snap (ADR 0043)
  and its docstring already names "a parsed query param" as an input — so a
  too-large position lands at the head, which is also the informative default
  (ADR 0045). No new validation path, no error surface for a bad position —
  it degrades gracefully to the complete-session view. *Alternative — reject
  out-of-range with an error/“unavailable” state:* rejected — an over-large
  `?position` is most likely a stale link to a session that has since grown or
  shrunk; landing on the complete session is more useful than a dead end, and
  the existence-non-leak posture (ADR 0029) already covers the genuinely
  absent session at the load tier.
- **§3 — One-way URL → state only; no write-back of position to the URL during
  playback.** The param seeds the opening frame; scrubbing/stepping does not
  rewrite `?position`. *Rationale:* the task is "load replay *starting at* a
  URL-supplied position" — a deep-link *in*, not a live address-bar mirror.
  Two-way sync would churn browser history on every seek/auto-advance tick and
  is a distinct, unrequested feature. *Alternative — replace the URL on every
  position change (shareable “current frame” link):* rejected as out of scope;
  surfaced to the parking lot (see return summary), not encoded as a WBS task
  (it would be a new feature decision, not a closable wiring leaf).
- **§4 — Seed once at mount; do not re-seed on search-string change.** The
  `useState` initializer runs once; if the URL's `position` changes while the
  viewer is open, the container keeps the user's live cursor rather than
  yanking it back. *Rationale:* the URL is a *starting* position; once the
  user is interacting, their controls are authoritative. Re-seeding mid-session
  would fight the user and is the natural pair of the (rejected) two-way sync.
  In practice the replay route does not navigate its own `?position`
  mid-session, so this is the simplest correct behavior.
- **§5 — Distinguish `null` (absent/invalid → head) from `0` (genesis →
  baseline) with an explicit `!= null` branch.** *Rationale:* `useAudienceLogPosition()`
  returns `0` for the valid log-genesis deep-link and `null` for
  absent/invalid; `0` is falsy, so the seeder must not use `initialPosition ||
  head`. This is a one-line correctness constraint that a test pins
  (Acceptance §1).
- **§6 — No Cucumber pin, no new i18n, no new ADR.** This leaf reads no new
  endpoint, emits no envelope, changes no broadcast/projector/replay-boundary
  output, and adds no user-visible string. Every seam it uses already exists:
  the `?position` parser/hook (`aud_url_position_param`), the lifted-position
  container (`replay_playback_controls`/`replay_seek_bar`), and the
  `clampPosition` contract (ADR 0043). *Rationale:* per the backend/WS
  Cucumber rule, Vitest + Playwright are the right pins for UI-only behavior;
  no new dependency, architectural seam, or security-relevant trade-off means
  no ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Added optional `initialPosition?: number | null | undefined` prop to `ReplayPlaybackContainer` in `apps/audience/src/replay/ReplayPlaybackContainer.tsx`; `useState` seeder branches on `!= null`: `clampPosition(initialPosition, events)` when set, `replayHeadSequence(events)` otherwise.
- `AudienceReplayRoute` (`apps/audience/src/routes/AudienceReplayRoute.tsx`) reads `useAudienceLogPosition()` and threads the result as `initialPosition` — keeping the container router-agnostic.
- Vitest component tests extended in `apps/audience/src/replay/ReplayPlaybackContainer.test.tsx` with 4 `initialPosition` cases: mid-log seeding, `position=0` baseline (proves the `!= null` branch, not a falsy check), out-of-range clamping to head, and null/undefined head fallback.
- Vitest route tests extended in `apps/audience/src/routes/AudienceReplayRoute.test.tsx` with 3 cases: `?position=<mid>` seeds at mid, no-position seeds at head, out-of-range clamps to head.
- Playwright e2e test added in `tests/e2e/audience-replay.spec.ts` (test 7): deep-link `?position=<mid>` seeds the opening frame + out-of-range `?position` lands on head.
- Prop type widened to `number | null | undefined` (fix for `exactOptionalPropertyTypes: true` rejecting explicit `undefined`); `typecheck` and `typecheck:tests` both exit 0.
