// Env-driven WebSocket `Origin`-header allowlist resolver.
//
// Refinement: tasks/refinements/backend-hardening/ws_origin_allowlist.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.auth_hardening.ws_origin_allowlist
// Source:      docs/security/m3-review/auth.md F-002
//
// **What this module owns.** A single pure function
// `resolveWsOriginAllowlist(env)` that turns the production env
// (`NODE_ENV`, `APP_BASE_URL`, `CORS_ORIGIN_ALLOWLIST`) into the
// allowlist the `/ws` upgrade gate uses to fence cross-origin
// upgrades. The shape is either the sentinel `'*'` (dev-only, "any
// origin accepted") or an explicit array of WHATWG-normalized origin
// strings.
//
// **Why a sibling module to `server.ts` instead of inside it.** Two
// reasons:
//   1. The `ws/connection.ts` plugin imports the resolver, and
//      `server.ts` imports `ws/connection.ts` (via `ws/index.ts`).
//      Putting the resolver in `server.ts` would create a cycle that
//      breaks tsc + the runtime module graph.
//   2. The (future) `backend_hardening.auth_hardening.prod_cors_lockdown`
//      task will land a peer `resolveCorsOptions(env)` helper reading
//      the SAME env vars. Co-locating both resolvers next to each
//      other (not buried inside `server.ts`'s bootstrap factory) makes
//      the env-var coupling visually loud.
//
// **Env-var coupling with CORS — by design.** A WS upgrade is just an
// HTTP `Upgrade` request, and the browser sends the same `Origin`
// header it sends on a cross-origin `fetch`. The hardening invariant
// is: "any origin the CORS layer accepts MUST be acceptable on the
// WS gate, and vice versa." Sharing the env vars (`APP_BASE_URL` +
// `CORS_ORIGIN_ALLOWLIST`) makes that invariant a config-layer fact
// rather than a documentation hope. There is deliberately no
// `WS_ORIGIN_ALLOWLIST` env var — a deployment can't drift the WS
// gate away from the CORS layer because they read the same source.

/**
 * Sentinel returned by `resolveWsOriginAllowlist` in non-production
 * environments. Means "accept any `Origin` header (or its absence) on
 * the WS upgrade; the cookie + JWT verify check still runs." Mirrors
 * the way the future CORS resolver will return `origin: true` in dev.
 *
 * Exported as a typed constant so the WS gate's narrowing reads
 * `allowlist === WS_ORIGIN_ALLOWLIST_ANY` rather than a magic string.
 */
export const WS_ORIGIN_ALLOWLIST_ANY = '*' as const;

/**
 * Resolved allowlist shape for the WS `/ws` upgrade gate. Either the
 * dev-only "any origin" sentinel or an explicit list of origin
 * strings (e.g. `['https://app.example.com', 'https://staging.example.com']`).
 *
 * Origin strings follow the WHATWG URL origin serialization (scheme +
 * host + optional port — no path, no trailing slash). The resolver
 * normalizes inputs via `new URL(value).origin` so the comparison the
 * gate runs is byte-equal.
 */
export type WsOriginAllowlist = typeof WS_ORIGIN_ALLOWLIST_ANY | readonly string[];

/**
 * Thrown by `resolveWsOriginAllowlist` when production env vars are
 * missing or malformed. Surfaces at server boot via `createServer()`
 * so a misconfigured production never silently downgrades to "open."
 * Mirrors the fail-fast posture of `OidcConfigError`.
 */
export class WsOriginAllowlistError extends Error {
  override readonly name = 'WsOriginAllowlistError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Resolve the WS-upgrade `Origin` allowlist from env.
 *
 * **Dev (`NODE_ENV !== 'production'`)**: returns `WS_ORIGIN_ALLOWLIST_ANY`.
 * The gate then accepts every upgrade (including those with no
 * `Origin` header — `curl --upgrade`, the WS test injector, and any
 * non-browser client all omit it). The cookie + JWT verify check
 * still runs; dev simply doesn't fence on origin.
 *
 * **Production (`NODE_ENV === 'production'`)**: returns an array of
 * normalized origins composed of:
 *
 *   1. The origin of `APP_BASE_URL` (REQUIRED — missing or
 *      unparseable throws `WsOriginAllowlistError`).
 *   2. Each comma-separated entry of `CORS_ORIGIN_ALLOWLIST`
 *      (optional — empty/unset is fine; whitespace around each entry
 *      is trimmed; an unparseable entry throws).
 *
 * Each input is normalized via `new URL(value).origin` so the gate's
 * comparison can be a byte-equal `allowlist.includes(originHeader)`
 * — no scheme casing, no trailing-slash, no port-default surprise.
 * The output is de-duplicated (APP_BASE_URL's origin may also appear
 * in CORS_ORIGIN_ALLOWLIST without affecting the resolved list).
 *
 * @param env - process.env (or a test-shaped subset).
 * @returns the resolved allowlist (sentinel `'*'` in dev, an array of
 *          normalized origin strings in production).
 * @throws `WsOriginAllowlistError` in production when `APP_BASE_URL`
 *         is missing/unparseable or a `CORS_ORIGIN_ALLOWLIST` entry
 *         is unparseable.
 */
export function resolveWsOriginAllowlist(
  env: Record<string, string | undefined>,
): WsOriginAllowlist {
  if (env['NODE_ENV'] !== 'production') {
    return WS_ORIGIN_ALLOWLIST_ANY;
  }
  const appBaseUrl = env['APP_BASE_URL'];
  if (appBaseUrl === undefined || appBaseUrl === '') {
    throw new WsOriginAllowlistError(
      'APP_BASE_URL is required in production to build the WS Origin allowlist',
    );
  }
  let appOrigin: string;
  try {
    appOrigin = new URL(appBaseUrl).origin;
  } catch {
    throw new WsOriginAllowlistError(
      `APP_BASE_URL is not a valid URL: ${JSON.stringify(appBaseUrl)}`,
    );
  }
  // `new URL(...)` of a bare hostname / scheme-less string can produce
  // origin `'null'` (WHATWG marks opaque origins that way). Reject:
  // that's not a sane allowlist entry.
  if (appOrigin === 'null') {
    throw new WsOriginAllowlistError(
      `APP_BASE_URL has an opaque origin (parsed to "null"): ${JSON.stringify(appBaseUrl)}`,
    );
  }
  const raw = env['CORS_ORIGIN_ALLOWLIST'];
  const extras: string[] = [];
  if (raw !== undefined && raw !== '') {
    for (const piece of raw.split(',')) {
      const trimmed = piece.trim();
      if (trimmed === '') {
        continue;
      }
      let entryOrigin: string;
      try {
        entryOrigin = new URL(trimmed).origin;
      } catch {
        throw new WsOriginAllowlistError(
          `CORS_ORIGIN_ALLOWLIST contains an invalid origin: ${JSON.stringify(trimmed)}`,
        );
      }
      if (entryOrigin === 'null') {
        throw new WsOriginAllowlistError(
          `CORS_ORIGIN_ALLOWLIST entry has an opaque origin (parsed to "null"): ${JSON.stringify(trimmed)}`,
        );
      }
      extras.push(entryOrigin);
    }
  }
  // De-duplicate while preserving order. APP_BASE_URL's origin always
  // sits first in the result (operationally, it's "the" same-origin
  // entry and listing it first matches how operators reason about the
  // policy: "the app, plus these other allowed origins").
  const seen = new Set<string>();
  const out: string[] = [];
  for (const origin of [appOrigin, ...extras]) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}
