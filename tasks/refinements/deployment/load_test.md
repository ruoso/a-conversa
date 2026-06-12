# Load test — concurrent subscribers + event-rate ceiling against the compose stack

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.deployment_tests.load_test`
**Effort estimate**: 2d
**Inherited dependencies**: none in the WBS. Practically: the test-mode synthetic seam (ADR 0041), anonymous WS subscribe (ADR 0029), and the WS protocol surface (`docs/ws-protocol.md`) — all settled.
**Executor**: implementation agent — repo-only work against the local compose stack, part of milestone `m_predeploy_agent_work` (M9-prep).

## What this task is

A committed, re-runnable load harness that answers the two capacity
questions the `.tji` title names — **concurrent sessions/subscribers**
and the **event-rate ceiling** — against the local compose stack, with
floor assertions (it is a *test*, exit non-zero on violation) plus a
full metrics report (it is also the *benchmark* the M10 show-planning
reads).

Three phases (`scripts/load-test.ts`):

1. **Ingest throughput** — create several `walkthrough` synthetic
   sessions concurrently (each replays the full example debate
   through the production validate→append→broadcast write path in
   one transaction, per ADR 0041); measure events appended per
   second.
2. **Concurrent audience** — flip a `structured` synthetic session
   public, open N WebSocket connections, each `subscribe` +
   `catch-up(sinceSequence: 0)`; measure success rate and
   time-to-caught-up p50/p95. The timed connections authenticate —
   anonymous catch-up/snapshot are deferred in v0 (the handlers
   answer `forbidden`; surfaced by the first runner execution) — and
   one extra anonymous subscriber stays in the fan-out accounting so
   the ADR 0029 path is exercised end to end.
3. **Live fan-out ceiling** — with those N subscribers attached, an
   authenticated host connection drives wording-only `capture-node`
   proposes in a sequence-gated loop (the protocol intentionally
   serializes writers via `expectedSequence`); measure round-trip
   event rate and delivery to all subscribers.

## Why it needs to be done

- M9 gates on `deployment_tests` in full; M9-prep lists this leaf as
  repo-only agent work ("the load test against the local compose
  stack").
- The realistic v1 load (ADR 0033: one show, two debaters, tens of
  audience viewers) has never been demonstrated as a number. The
  floors encode "a show works with margin"; the report tells the
  operator where the ceiling actually is.

## Inputs / context

- **Driver seam**: `POST /api/test-mode/synthetic-sessions`
  (non-production only — the stack must run in dev mode, `make up`)
  builds a scenario through the production write path. Scenario keys:
  `empty` / `structured` / `walkthrough`
  (`apps/server/src/test-mode/synthetic/scenarios.ts`).
- **Auth**: the seam and the privacy flip require a session cookie.
  The harness seeds a driver user row (psql via `docker compose
  exec`) and mints the cookie with the server's own
  `signSessionToken` (`apps/server/src/auth/session-token.ts`) using
  the stack's `SESSION_TOKEN_SECRET` — no browser, no Authelia round
  trip in the measured path.
- **Audience shape**: anonymous WS upgrade + `subscribe` to a public
  session works (ADR 0029), but anonymous `catch-up` and `snapshot`
  are v0-deferred (both handlers answer `forbidden` for
  `connection.user === undefined`; a future `aud_anonymous_catch_up`
  leaf owns the widening). `catch-up` from 0 takes the slice-replay
  path below `WS_CATCHUP_MAX_EVENTS=500` — the `structured` log is
  far below it. Caps that shape the harness: catch-up rate limit
  (10/min/connection — one per connection stays under it),
  subscription cap (32/connection — one each).
- **Write shape**: `propose` with
  `{ kind: 'capture-node', node_id, wording }`, sequence-gated via
  `expectedSequence`, host-as-moderator authority (the synthetic
  session's host is the driver user). Ack + `event-applied`
  broadcast per `docs/ws-protocol.md`.

## Constraints / requirements

- **`scripts/load-test.ts`** (tsx; `ws` client added to root
  devDependencies), env-tunable knobs with defaults:
  `LOAD_BASE_URL` (http://localhost:3000), `LOAD_SESSIONS` (5),
  `LOAD_SUBSCRIBERS` (50), `LOAD_PROPOSES` (100), plus the floor
  thresholds. Prints a JSON metrics report; exits non-zero when any
  floor is violated.
- **Audience connections authenticate for the timed catch-up**; the
  broadcast fan-out path is connection-identity-agnostic (the
  subscription registry delivers by connectionId), so the measured
  ceiling holds for anonymous viewers too — pinned by the extra
  anonymous subscriber in the delivery accounting.
- **Floors** (deliberately generous — a failure means something is
  badly wrong, not that the hardware is modest):
  - ingest ≥ 50 events/s aggregate;
  - 100% of subscribers reach `caught-up`, p95 ≤ 5 s;
  - fan-out loop sustains ≥ 5 proposes/s round-trip with all
    subscribers receiving every `event-applied`.
- **`make load-test`** target (asserts the stack is up, dev mode).
- **Workflow venue**: `.github/workflows/load-test.yml`
  (`workflow_dispatch`) — brings up the stack via `make up` on a
  runner and runs the harness; same pattern as the rollback
  rehearsal. Executed once for this task; numbers recorded in
  Status.
- The harness is read-only toward the repo and creates only
  synthetic/private + one public session in the throwaway stack; it
  does not reuse the dev stack's volumes on a runner.
- `pnpm run check` green (script is under `tsconfig.tools.json`).

## Acceptance criteria

- `make load-test` against a fresh `make up` stack completes all
  three phases, prints the report, exits 0 with the default floors.
- Tampering with a floor (e.g. `LOAD_MIN_INGEST_EPS=999999`) makes it
  exit non-zero — the assertion path is real.
- The workflow run on a GitHub runner passed; Status records the
  measured numbers.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **The synthetic seam is the load driver.** It exercises the
  production validate→append→broadcast path (ADR 0041 §"production
  write path") with zero auth choreography per event. The
  alternative — scripting the full OIDC dance and driving the
  moderator UI protocol — measures Authelia and the browser stack,
  not the platform's event path, and adds an order of magnitude of
  harness complexity.
- **Cookie minted with server code, not captured from a login.**
  `signSessionToken` is the production signer; importing it makes
  the harness immune to auth-flow refactors and keeps Authelia out
  of the measured path. Works only because the dev stack's secret is
  known from `.env` — exactly the property production denies, which
  is why the harness targets the local stack by design.
- **The fan-out phase is round-trip-serialized on purpose.** The
  protocol's `expectedSequence` gate means a single writer CANNOT
  pipeline proposes; measuring a pipelined rate would measure a
  scenario the protocol forbids. The serialized round-trip rate ×
  fan-out delivery is the honest ceiling for "how fast can a debate
  move."
- **Floors, not benchmarks-as-assertions.** Asserting precise
  numbers makes the test flaky across hardware; floors at ~10× below
  expected capacity catch regressions in kind (an accidental
  O(n²) fan-out, a serialization bottleneck) while the report
  carries the real numbers.
- **Dev-mode stack is a feature, not a compromise.** The seam is
  production-gated off; the load test needs it, so the stack runs
  dev-mode. The HTTP/WS/projection/Postgres path being measured is
  identical in both modes (the gates differ in CORS/cookie/secret
  policy, not in the event path).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12. Landed as:

- [`scripts/load-test.ts`](../../../scripts/load-test.ts) +
  `make load-test` +
  [`.github/workflows/load-test.yml`](../../../.github/workflows/load-test.yml)
  (`workflow_dispatch`); `ws@8` added to root devDependencies.
- **Executed on a GitHub runner**
  ([run 27416778865](https://github.com/ruoso/a-conversa/actions/runs/27416778865),
  via a temporary branch push trigger, removed after the run; the
  sandbox's network policy blocks registry pulls, same as the
  rollback rehearsal). The first execution
  ([run 27416147206](https://github.com/ruoso/a-conversa/actions/runs/27416147206))
  surfaced that anonymous catch-up is v0-forbidden — recorded above
  in What-this-is / Inputs / Constraints; the harness was adjusted
  (authenticated timed connections + one anonymous subscriber pinned
  in the fan-out) and the rerun passed all floors.
- **Measured** (ubuntu-latest, fresh `make up` stack, defaults):
  - Phase A ingest: **1505 events in 0.54 s ≈ 2797 events/s**
    aggregate over 5 concurrent walkthrough creations (floor: 50).
  - Phase B audience: **50/50 subscribers caught up**, p50 239 ms /
    p95 272 ms over an 11-event catch-up (floor: p95 ≤ 5 s).
  - Phase C fan-out: **73.0 proposes/s** round-trip (100
    sequence-gated proposes, 300 events appended, 1.37 s) with
    **15300/15300 `event-applied` frames delivered** across all 51
    subscribers including the anonymous viewer (floor: 5/s, full
    delivery).
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
