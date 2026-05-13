# `backend_hardening.resource_limits_and_dos.flow_state_map_bound`

**Source finding**: [`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md) F-006.
**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.flow_state_map_bound`.
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `backend.auth.oauth_callback_handler` — settled (`createFlowStateStore`, the lazy default singleton, 5-minute TTL, 60-second sweeper at `apps/server/src/auth/flow-state.ts`).
- `backend.api_skeleton.error_handling` — settled (`ApiError(statusCode, code, message)` shape; the error-handler plugin's `ApiError` branch emits the canonical envelope at the requested status).

## What this task is

Cap the in-process OIDC `flow-state` Map's size so an unauthenticated
flood of `GET /auth/login` cannot grow memory unboundedly between
the existing 60-second sweep cycles. The cap is a hard ceiling on
`map.size` at `put(...)` time, with one fallback step before refusal:

1. Read the cap from env at store-construction time
   (`FLOW_STATE_MAX_ENTRIES`, default `1000`).
2. On `put(state, entry)`, if `map.size >= MAX`:
   - Trigger an eager `sweep()` — this drops any already-expired
     entries that the periodic 60-second sweeper hasn't yet visited.
   - If still `map.size >= MAX`, throw a typed `FlowStateCapacityError`.
3. The `/auth/login` route catches `FlowStateCapacityError` and throws
   `ApiError(503, 'temporarily-unavailable', '...')`. The message MUST
   NOT leak the cap value (an attacker could calibrate the flood
   against it).

The eager-sweep fallback is the cheap mitigation: a flood that lasts
longer than the per-entry TTL (5 minutes) self-clears on every fresh
`put` once the floor of expired entries crosses 1. The hard refusal
is the load-bearing safety: a fast-enough flood (faster than expiry)
gets a 503 instead of growing memory.

## Why it needs to be done

`docs/security/m3-review/inputs.md` F-006 (Low) documents the surface:
every `GET /auth/login` allocates a `FlowStateEntry` (~hundreds of
bytes for `nonce` + `codeVerifier` + `expiresAt`) and inserts it.
There is no cap on `map.size` between sweeps; the default sweep
cadence is 60 seconds and the TTL is 5 minutes, so the worst-case
high-water-mark is `request_rate × 5 minutes` before any entry
becomes eligible for removal. At a sustained 1000 req/s of hostile
`/auth/login` traffic that's 300 000 entries in memory before the
first sweep trims anything.

The cap is the structural defense; per-IP rate-limiting at the edge
is the future complementary fix (out of scope here — F-006 itself
notes "combined with rate-limiting `/auth/login` on the deployment
edge" as the suggested mitigation). Capping fail-fast at the store
layer is the work this task does; it does not preclude the future
rate-limit.

## Inputs / context

From [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) (pre-task):

```ts
export function createFlowStateStore(options: FlowStateStoreOptions = {}): FlowStateStore {
  void options.ttlMs;
  const now = options.now ?? ((): number => Date.now());
  const map = new Map<string, FlowStateEntry>();

  return {
    put(state: string, entry: FlowStateEntry): void {
      map.set(state, entry); // <-- no cap check today
    },
    take(state: string): FlowStateEntry | undefined { ... },
    size(): number { return map.size; },
    sweep(): void { ... },
  };
}
```

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts):
`ApiError(statusCode, code, message)` is the canonical typed error
the error-handler plugin recognises. No existing code in the project
uses 503 yet — this task introduces the first call site.

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) (pre-task):

```ts
flowState.put(state, {
  nonce,
  codeVerifier,
  expiresAt: computeExpiresAt(computeOpts),
});
```

The single `put` call site in `/auth/login` is the seam where the
capacity error surfaces; the callback's `take` path is unaffected.

## Constraints / requirements

- **`MAX_FLOW_STATE_ENTRIES` default**: `1000`. Env override:
  `FLOW_STATE_MAX_ENTRIES`. Constant exported from
  `apps/server/src/auth/flow-state.ts`.
- **Resolution helper**: `resolveFlowStateMaxEntries(env)` mirrors the
  shape of `resolveBodyLimit` / `resolveCatchUpMaxEvents` — read env,
  `parseInt(raw, 10)`, fall back to default on `undefined` / `''` /
  `NaN` / `<= 0`. Exported so per-test scenarios can set
  `process.env.FLOW_STATE_MAX_ENTRIES` and assert the cap surface
  end-to-end.
- **`FlowStateCapacityError`**: a typed exported class (extends
  `Error`), thrown by `put(...)` when the eager-sweep fallback fails.
  Carries no internal state details (no `cap` field, no occupancy
  count) — keeps the symbol out of the wire shape so a future
  `JSON.stringify(err)` cannot leak the cap.
- **Eager-sweep order**: cap check → eager `sweep()` → cap check
  again → throw or proceed. The first cap check is the cheap path
  (no walk through the map); the eager sweep is only paid when the
  cap is reached.
- **Constructor option**: `createFlowStateStore({ maxEntries, ... })`
  accepts an optional override so tests can construct a tiny-cap
  store hermetically (no env mutation). When absent, the constructor
  reads `resolveFlowStateMaxEntries(process.env)` so the production
  `getDefaultFlowStateStore()` path inherits the env value naturally.
- **`/auth/login` route**: wrap the `flowState.put(...)` call in a
  `try { ... } catch (err) { if (err instanceof FlowStateCapacityError) throw new ApiError(503, 'temporarily-unavailable', 'service is temporarily unable to start a new auth flow; please retry shortly'); throw err; }` shape. The message MUST NOT include the cap value or the current `map.size`. The `code` (`temporarily-unavailable`) is the typed discriminator clients branch on.
- **No mutation of the periodic 60-second sweeper**: the eager-sweep
  fallback is per-`put`, not a cadence change. The existing
  background sweeper continues unchanged so a low-traffic deployment
  doesn't run more sweeps than necessary.
- **Per ADR 0022**: every cap-behavior assertion lands as a committed
  Vitest case. No throwaway probes.

## Acceptance criteria

- `MAX_FLOW_STATE_ENTRIES = 1000` exported from `flow-state.ts`.
- `FLOW_STATE_MAX_ENTRIES_ENV = 'FLOW_STATE_MAX_ENTRIES'` exported.
- `resolveFlowStateMaxEntries(env)` exported; returns the default on
  absent / empty / `NaN` / `<= 0`, returns the parsed integer on a
  positive int.
- `FlowStateCapacityError` exported as a class.
- `createFlowStateStore({ maxEntries: N })` accepts the option;
  absent → reads `resolveFlowStateMaxEntries(process.env)`.
- `put(state, entry)` at-cap with no expired entries: throws
  `FlowStateCapacityError`. The map is unchanged.
- `put(state, entry)` at-cap with at least one expired entry: eager
  sweep clears the expired entries, the new entry is accepted.
- `put(state, entry)` below cap: no sweep called (regression — the
  cheap path stays cheap).
- `/auth/login` returns **503** with body
  `{ error: { code: 'temporarily-unavailable', message: '...' } }`
  when `put(...)` raises `FlowStateCapacityError`. The message does
  NOT include the cap value (test asserts the absence).
- `pnpm run check` clean.
- `pnpm run test:smoke` passes including the new tests.
- `complete 100` added to the `flow_state_map_bound` task entry in
  `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Cap default of 1000.** F-006's suggested fix mentions 10 000; we
  pick the tighter 1000 because: a legitimate concurrent-login burst
  for a moderate-scale instance is in the tens (one entry per
  in-flight OIDC dance, each lasting at most 5 minutes); 1000 is two
  orders of magnitude over realistic peak demand; the tighter cap
  fails fast on flood without ever interfering with legitimate use.
  Operators with a sustained legitimate burst above 1000 can lift
  the cap via `FLOW_STATE_MAX_ENTRIES` without a code change.
- **Eager-sweep fallback before refusal.** Cheap (a single pass
  through the map at most once per `put` at the cap boundary) and
  closes the worst-case-clean shape: a flood that started 5+ minutes
  ago has at least one expired entry waiting for the next 60-second
  sweep. The eager sweep on `put` collapses that window — flood
  refusal only fires when expiry can't keep up.
- **503 not 429.** The failure mode is server resource exhaustion
  (memory floor), not a per-client rate-limit (which would be 429
  with a `Retry-After`). 503 is "the server is temporarily unable
  to fulfill the request"; a future per-IP rate limit at the edge
  would emit 429. The two are complementary, not substitutes.
- **`temporarily-unavailable` code, no cap value in the message.**
  An attacker who knows the cap can calibrate the flood (e.g.
  steady-state at `cap × (1 − ε)`); withholding the value forces
  trial-and-error. The OpenAPI doc / refinement record the value
  for operators; the wire message does not.
- **`FlowStateCapacityError` is a plain `Error` subclass, not an
  `ApiError`.** The store should not know about HTTP — the route
  layer maps the typed store error to the typed HTTP error. This
  mirrors `AuthStateMismatchError` (in `flow.ts`) which is also a
  store-layer typed error mapped to a route-layer 400.
- **Constructor option + env-driven default.** Matches the
  `createFlowStateStore({ ttlMs, now })` pattern — the constructor
  accepts overrides; absent overrides default to env / production
  defaults. Tests build a tiny-cap store via `{ maxEntries: 3 }`
  without touching `process.env`.
- **No per-IP rate limit here.** F-006 notes rate-limiting as a
  complementary deployment-edge mitigation; that's its own future
  task. This refinement closes the in-process structural concern.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) — added the `FlowStateCapacityError` class, the `MAX_FLOW_STATE_ENTRIES = 1000` constant, the `FLOW_STATE_MAX_ENTRIES_ENV` env-name constant, the `FlowStateMaxEntriesEnv` env-shape interface, and the `resolveFlowStateMaxEntries(env)` helper. Extended `FlowStateStoreOptions` with the optional `maxEntries` field and wired the resolver default through `createFlowStateStore`. The `put(...)` body now does the cap check → eager `sweep()` → re-check → throw flow; the cheap path (below cap or overwriting an existing state) is unchanged.
  - [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) — imported `FlowStateCapacityError`; wrapped the `/auth/login` handler's `flowState.put(...)` call in a `try/catch` that maps the typed store error to `ApiError(503, 'temporarily-unavailable', '...')`. The public-facing message intentionally does not include the cap value or the current map size.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/auth/flow.test.ts`](../../../apps/server/src/auth/flow.test.ts) — +15 cases across two new describe blocks:
    - `flow-state capacity cap (M3-review inputs.md F-006)` — 8 tests pinning the exported constants, the at-cap accept path (`maxEntries: 3` → 3 puts succeed), the over-cap reject path (`FlowStateCapacityError` thrown, store unchanged), the wire-shape no-leak invariant (error message and `JSON.stringify(err)` carry no integers), the eager-sweep-then-accept path (expired entries cleared at the cap boundary), the cheap-path regression (below the cap, no sweep), and the overwrite-doesn't-trip-cap edge case.
    - `resolveFlowStateMaxEntries` — 7 tests pinning default-on-absent / empty / NaN / zero / negative, parsed-on-positive, and end-to-end wiring via `process.env.FLOW_STATE_MAX_ENTRIES`.
  - [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts) — +1 case in a new describe block `GET /auth/login — capacity cap (inputs.md F-006)`: builds a tiny-cap test app (`maxEntries: 2`), saturates it with two 302 responses, then asserts the third request returns **503** with `{ error: { code: 'temporarily-unavailable', message: '...' } }` and that the wire message contains no integers (so the cap value is not leaked). Asserts the store is unchanged on rejection (no partial state mutation).

- `tasks/25-backend-hardening.tji` — `complete 100` added to the `flow_state_map_bound` task entry under `resource_limits_and_dos`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).

Test count delta: +16 Vitest cases (flow.test.ts: +15; routes.test.ts: +1). `pnpm run check` and `pnpm run test:smoke` both green (1176 tests across 72 files).

**Cap-leak invariant (load-bearing)**: the public-facing 503 message
(`'service is temporarily unable to start a new auth flow; please retry shortly'`)
contains no digits, so a future operator changing the cap value via
`FLOW_STATE_MAX_ENTRIES` does not need to coordinate a wire-message
change. The cap leak invariant is pinned by an `expect(message).not.toMatch(/\b\d+\b/)`
assertion in both `flow.test.ts` (the store layer) and `routes.test.ts`
(the route layer) so a future regression at either layer fails CI.
