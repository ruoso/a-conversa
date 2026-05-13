// Server-side store for the transient OIDC auth-flow state.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_callback_handler
//
// **What this module owns.** A map keyed by the OIDC `state` value
// holding the matching `nonce` + PKCE `code_verifier` + an expiry
// timestamp. `GET /auth/login` calls `put(state, entry)` after
// generating the trio; `GET /auth/callback` calls `take(state)` to
// retrieve AND remove the entry in one step (so a replay against the
// same state fails on the second hit).
//
// **TTL: 5 minutes.** Authelia's `authorize_code` lifespan is 1 minute
// (per `infra/authelia/configuration.yml`), so the bottleneck is
// upstream — our store just needs to outlive the user's password
// typing. A 5-minute window covers a slow typist + a slow Authelia
// page-load on a dev box without being so long that abandoned flows
// accumulate.
//
// **In-process map, not Postgres or signed cookie.** Per ADR 0023 the
// backend is a single Node process; per ADR 0002 the application
// reads its OIDC trust signal off the id_token, not off a cookie. A
// signed-cookie flow would overlap with `session_token_management`'s
// signing-key story; a Postgres-backed flow would add operational
// surface (migration, cleanup) for a 5-minute transient state. The
// in-memory map is the simplest shape that satisfies the constraints.
//
// **Garbage collection.** `take(state)` is lazy — if the entry has
// expired by the time the callback arrives, it's removed without
// returning a value. A periodic sweeper (timer set on the default
// store) walks the map every 60 seconds and removes any entry whose
// `expiresAt` is past. Without the sweeper, abandoned flows would
// accumulate forever; with it, the map's high-water mark is bounded
// by (concurrent in-flight flows) + 60 seconds' worth of expired-but-
// not-yet-swept entries.
//
// **Hard capacity cap (M3-review F-006).** Refinement:
// `tasks/refinements/backend-hardening/flow_state_map_bound.md`. The
// 60-second sweep cadence + 5-minute TTL means an unauthenticated
// flood of `/auth/login` can drive `map.size` to
// `request_rate × 5 minutes` before any entry becomes eligible for
// removal. `put(state, entry)` enforces a hard cap on `map.size`
// (default `MAX_FLOW_STATE_ENTRIES = 1000`, env-overridable via
// `FLOW_STATE_MAX_ENTRIES`); when reached, an eager `sweep()` runs to
// drop already-expired entries, and if the cap is still hit after the
// sweep the call throws `FlowStateCapacityError`. The route plugin
// (`auth/routes.ts`) maps that typed error to a 503 +
// `temporarily-unavailable`. The cap value is intentionally never
// echoed on the wire so a flooder cannot calibrate against it.

/**
 * The per-flow record. Holds the values the callback handler needs
 * to validate the id_token (`nonce`) and complete the auth-code
 * exchange (`codeVerifier`), plus the expiration timestamp.
 *
 * `expiresAt` is the *millisecond* the entry stops being valid;
 * `take(state)` compares against `Date.now()` (or the injected clock).
 */
export interface FlowStateEntry {
  /** OIDC `nonce` value to assert against the id_token claim. */
  readonly nonce: string;
  /** PKCE `code_verifier` to send on the token-exchange request. */
  readonly codeVerifier: string;
  /** Absolute expiry instant (Date.now() comparison). */
  readonly expiresAt: number;
}

/**
 * Typed error thrown by `put(...)` when the store is at its capacity
 * cap AND the eager sweep that runs at the cap boundary did not free
 * any space (i.e. no entries are expired yet). The route plugin
 * (`/auth/login`) catches this and maps it onto a 503 with code
 * `temporarily-unavailable`.
 *
 * The error intentionally carries NO internal state (no `cap`, no
 * `size`, no `details` object) so a future `JSON.stringify(err)` or
 * accidental message echo cannot leak the cap value — which an
 * attacker could otherwise use to calibrate a flood. See refinement
 * `tasks/refinements/backend-hardening/flow_state_map_bound.md`.
 */
export class FlowStateCapacityError extends Error {
  override readonly name = 'FlowStateCapacityError';

  constructor() {
    // The message is intentionally generic — never include cap value
    // or current size. The route handler swaps this for its own
    // public-facing 503 message anyway; this string is only ever
    // surfaced to the server log.
    super('flow-state store is at capacity');
  }
}

/**
 * Public surface of a flow-state store. The plugin layer depends on
 * this shape (not on the concrete `Map`-backed class) so tests can
 * substitute a custom implementation if needed.
 */
export interface FlowStateStore {
  /**
   * Add an entry to the store. Overwrites any prior entry for the same state.
   *
   * Throws `FlowStateCapacityError` when the store is at its
   * configured capacity cap and the eager sweep at the cap boundary
   * did not free any slot (i.e. no entries are expired). Below the
   * cap, the cheap path is unaffected — no sweep is performed.
   */
  put(state: string, entry: FlowStateEntry): void;
  /**
   * Retrieve AND remove an entry. Returns `undefined` if no entry was
   * stored for `state`, OR if the stored entry has expired (in which
   * case it's also removed as a side effect — expired entries don't
   * linger past their first `take` attempt).
   */
  take(state: string): FlowStateEntry | undefined;
  /** Current number of entries in the store. Used by tests and the sweeper. */
  size(): number;
  /**
   * Walk the store and remove any entry whose `expiresAt` is past
   * the current clock. Called by the periodic sweeper; tests call it
   * directly to force expiry without timer manipulation.
   */
  sweep(): void;
}

/**
 * Options consumed by `createFlowStateStore`. All optional — defaults
 * suit the production singleton; tests supply `now` and `ttlMs`
 * overrides for hermetic time-based assertions.
 */
export interface FlowStateStoreOptions {
  /**
   * Time-to-live for each entry, in milliseconds. Default 5 minutes
   * (300_000 ms). The default suits the OIDC dance window; tests
   * frequently pass a tiny value (e.g. 10 ms) to exercise expiry.
   */
  readonly ttlMs?: number;
  /**
   * Clock injection. Default `Date.now`. Tests pass a controllable
   * function so they can advance "time" without `await new Promise(...)`.
   */
  readonly now?: () => number;
  /**
   * Hard cap on `map.size`. When absent, the constructor reads
   * `resolveFlowStateMaxEntries(process.env)` so the production
   * default (`MAX_FLOW_STATE_ENTRIES`) is inherited unless the
   * operator overrides `FLOW_STATE_MAX_ENTRIES`. Tests pass a small
   * literal (e.g. `3`) to exercise the cap boundary hermetically.
   *
   * See `tasks/refinements/backend-hardening/flow_state_map_bound.md`
   * for the cap-design rationale.
   */
  readonly maxEntries?: number;
}

/**
 * Default TTL — 5 minutes, expressed in ms. Exported so tests can
 * reference the same value without duplicating the literal.
 */
export const DEFAULT_FLOW_STATE_TTL_MS = 5 * 60 * 1000;

/**
 * Default hard cap on the in-memory flow-state map size. Sized so a
 * legitimate concurrent-login burst (tens of in-flight OIDC dances)
 * stays well under the cap, while a hostile flood fails fast at the
 * `put(...)` boundary. Operators with a sustained legitimate burst
 * above this can lift the value via `FLOW_STATE_MAX_ENTRIES` without
 * a code change.
 *
 * See M3-review F-006 (`docs/security/m3-review/inputs.md`) and the
 * refinement at
 * `tasks/refinements/backend-hardening/flow_state_map_bound.md`.
 */
export const MAX_FLOW_STATE_ENTRIES = 1000;

/**
 * Env-var name the operator overrides to change the cap value at
 * boot. Kept as an exported constant (not a literal) so tests assert
 * against the same symbol the production resolver consumes.
 */
export const FLOW_STATE_MAX_ENTRIES_ENV = 'FLOW_STATE_MAX_ENTRIES';

/**
 * Subset of `process.env` the resolver reads. Mirrors the env-shape
 * pattern used by `resolveBodyLimit` / `resolveCatchUpMaxEvents` so
 * tests can pass a plain record without typing the full Node env.
 */
export interface FlowStateMaxEntriesEnv {
  readonly [FLOW_STATE_MAX_ENTRIES_ENV]?: string | undefined;
}

/**
 * Resolve the hard cap from env, with the documented fallback. The
 * shape mirrors `resolveBodyLimit` / `resolveCatchUpMaxEvents` —
 * `parseInt(raw, 10)`, fall back to `MAX_FLOW_STATE_ENTRIES` on
 * `undefined` / empty string / `NaN` / a non-positive integer.
 *
 * Exported so tests assert the resolver directly with a plain
 * `{ FLOW_STATE_MAX_ENTRIES: '...' }` record; the production
 * `createFlowStateStore()` default-path calls it with `process.env`.
 *
 * @param env - the env record (defaults to `process.env`).
 * @returns the resolved positive-integer cap.
 */
export function resolveFlowStateMaxEntries(env: FlowStateMaxEntriesEnv = process.env): number {
  const raw = env[FLOW_STATE_MAX_ENTRIES_ENV];
  if (raw === undefined || raw === '') {
    return MAX_FLOW_STATE_ENTRIES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return MAX_FLOW_STATE_ENTRIES;
  }
  return parsed;
}

/**
 * Construct a fresh flow-state store. The store is private state —
 * the returned object exposes only the `put` / `take` / `size` /
 * `sweep` surface, no direct map access. Tests build one per scenario
 * (with injected clock); the default singleton lives module-level.
 *
 * @param options - optional TTL and clock overrides.
 * @returns a `FlowStateStore` with the configured TTL.
 */
export function createFlowStateStore(options: FlowStateStoreOptions = {}): FlowStateStore {
  // `options.ttlMs` is accepted on the public surface for symmetry
  // with `computeExpiresAt(...)` (the route plugin uses both — TTL
  // here is informational; the store doesn't compute expiry, it
  // honors the pre-baked `entry.expiresAt`). The variable would be
  // assigned-and-unused, so we read the field with a leading
  // underscore to satisfy the lint rule.
  void options.ttlMs;
  const now = options.now ?? ((): number => Date.now());
  // Cap resolution: an explicit `maxEntries` option always wins so
  // tests can build a tiny-cap store hermetically. Absent, the
  // production default reads `process.env.FLOW_STATE_MAX_ENTRIES` via
  // `resolveFlowStateMaxEntries`, falling back to
  // `MAX_FLOW_STATE_ENTRIES` (1000). See refinement
  // `tasks/refinements/backend-hardening/flow_state_map_bound.md`.
  const maxEntries =
    options.maxEntries !== undefined ? options.maxEntries : resolveFlowStateMaxEntries(process.env);
  const map = new Map<string, FlowStateEntry>();

  function sweepImpl(): void {
    const cutoff = now();
    for (const [state, entry] of map.entries()) {
      if (entry.expiresAt <= cutoff) {
        map.delete(state);
      }
    }
  }

  return {
    put(state: string, entry: FlowStateEntry): void {
      // Cheap path: below the cap, no sweep — just insert. The
      // overwrite branch (`map.has(state)`) also stays cheap because
      // it doesn't grow the map.
      if (map.size >= maxEntries && !map.has(state)) {
        // At the cap and the new state is genuinely new. Eager-sweep
        // any already-expired entries — this collapses the 60-second
        // window the background sweeper would otherwise wait on. If
        // the sweep frees space, accept the new entry. Otherwise
        // throw the typed capacity error; the route plugin maps it
        // to a 503 with `temporarily-unavailable`. The cap value is
        // intentionally never echoed back to the caller, here or on
        // the wire.
        sweepImpl();
        if (map.size >= maxEntries) {
          throw new FlowStateCapacityError();
        }
      }
      map.set(state, entry);
    },
    take(state: string): FlowStateEntry | undefined {
      const entry = map.get(state);
      if (entry === undefined) {
        return undefined;
      }
      // Remove regardless of expiry — `take` is a one-shot
      // consumption. A replay against the same state will see
      // `undefined` whether the first call succeeded or the entry
      // had already expired.
      map.delete(state);
      if (entry.expiresAt <= now()) {
        return undefined;
      }
      return entry;
    },
    size(): number {
      return map.size;
    },
    sweep(): void {
      sweepImpl();
    },
  };
}

/**
 * Helper: derive the absolute expiry for a fresh entry, given a
 * clock and TTL. Centralized so the route plugin (which calls `put`)
 * uses the same math the store would derive internally on a future
 * "construct entry from TTL" overload.
 */
export function computeExpiresAt(options: { ttlMs?: number; now?: () => number } = {}): number {
  const ttlMs = options.ttlMs ?? DEFAULT_FLOW_STATE_TTL_MS;
  const now = options.now ?? ((): number => Date.now());
  return now() + ttlMs;
}

/**
 * Module-level default store, shared by the route plugin in
 * production. Constructed eagerly because the construction is free
 * (an empty Map); the periodic sweeper is set up here too so the
 * default store doesn't accumulate expired entries.
 *
 * Tests do NOT use this singleton — they construct fresh stores via
 * `createFlowStateStore({ ttlMs, now })` and pass them to the route
 * plugin's options.
 */
let defaultStore: FlowStateStore | undefined;
let defaultSweepTimer: NodeJS.Timeout | undefined;

/**
 * Return the process-wide default store. Lazily constructs it on
 * first call and arms a 60-second periodic sweeper. The sweeper's
 * timer is `.unref()`ed so it doesn't keep the Node event loop alive
 * past graceful shutdown.
 */
export function getDefaultFlowStateStore(): FlowStateStore {
  if (defaultStore !== undefined) {
    return defaultStore;
  }
  defaultStore = createFlowStateStore();
  // 60-second sweep cadence. Lower would burn CPU on a near-empty
  // map; higher would let expired entries linger longer (still
  // bounded — they're consumed-and-removed by `take` anyway).
  //
  // **Timing-observation note.** A response-time oracle on
  // `/auth/callback?state=<expired>` can distinguish "entry was in the
  // map, expired, lookup slower" from "entry was never in the map" —
  // up to ~60 s after the entry's TTL fires. Low-impact leak (existence
  // of a recent failed flow, not user identity); accepted for v1. See
  // tasks/refinements/backend-hardening/flow_state_sweep_cadence_note.md
  // (closes docs/security/m3-review/inputs.md F-012).
  defaultSweepTimer = setInterval(() => {
    defaultStore?.sweep();
  }, 60_000);
  defaultSweepTimer.unref();
  return defaultStore;
}

/**
 * Test-only helper — reset the default store and its sweeper. Vitest
 * tests that exercise the default singleton (rare; most tests build
 * their own) use this to start fresh.
 */
export function __resetDefaultFlowStateStore(): void {
  if (defaultSweepTimer !== undefined) {
    clearInterval(defaultSweepTimer);
    defaultSweepTimer = undefined;
  }
  defaultStore = undefined;
}
