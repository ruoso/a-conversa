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
 * Public surface of a flow-state store. The plugin layer depends on
 * this shape (not on the concrete `Map`-backed class) so tests can
 * substitute a custom implementation if needed.
 */
export interface FlowStateStore {
  /** Add an entry to the store. Overwrites any prior entry for the same state. */
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
}

/**
 * Default TTL — 5 minutes, expressed in ms. Exported so tests can
 * reference the same value without duplicating the literal.
 */
export const DEFAULT_FLOW_STATE_TTL_MS = 5 * 60 * 1000;

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
  const map = new Map<string, FlowStateEntry>();

  return {
    put(state: string, entry: FlowStateEntry): void {
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
      const cutoff = now();
      for (const [state, entry] of map.entries()) {
        if (entry.expiresAt <= cutoff) {
          map.delete(state);
        }
      }
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
