# Auth + secrets security review

Scope: M3 backend (Fastify + WS + OIDC + JWT cookie + pending cookie).
Reviewer: independent security pass. No code changes — analysis only.

## Severity legend
- **Critical** — exploitable with practical attack path; loss of confidentiality / integrity / availability.
- **High** — credible attack but requires a precondition (specific deployment shape, cross-origin etc.).
- **Medium** — defense-in-depth gap or missing hardening that increases blast radius of another bug.
- **Low** — minor hardening / consistency.
- **Informational** — design intent worth recording; not a defect.

## Findings

### F-001 [High] — `/auth/logout` is unauthenticated and accepts anonymous POSTs, but JWT remains valid until expiry (no server-side revocation)
**Location**: `apps/server/src/auth/routes.ts:809-836` (`POST /auth/logout`), `apps/server/src/auth/session-token.ts:60-90` (TTL).
**Description**: Logout clears the browser cookie via `Set-Cookie: aconversa-session=; Max-Age=0` but never invalidates the JWT on the server. The token is stateless HS256, has a 7-day TTL, and there is no denylist (`session_token_management.md` openly defers per-session revocation). Anything that copied the cookie value before logout (a malicious browser extension, a leaked syslog/access log, a shared workstation) keeps full access for up to seven days.
**Impact**: Stolen / shoulder-surfed / extension-captured cookie cannot be revoked by the user via the UI. Real users will tell support "I logged out" and the support team has no mitigation; the only options are wait-out-the-TTL or rotate `SESSION_TOKEN_SECRET` (which invalidates every session globally).
**Suggested fix**: Add a small `auth_token_denylist (jti, expires_at)` table per the existing deferral; mint a `jti` per JWT and check the denylist in `verifySessionToken`. The denylist is at most 7 days × peak active users in size. Alternative: shorten TTL to ~24h and gate the WS surface with periodic re-auth.
**Confidence**: Confirmed.

### F-002 [High] — Cross-origin audience surface will silently break the WS auth gate (same-origin assumption is load-bearing and unenforced)
**Location**: `apps/server/src/ws/connection.ts:94-104, 557-591` (`preValidation` reads `Cookie` header); `tasks/refinements/backend/ws_auth_on_connect.md:76` (the constraint is documented as a "loud reminder" only).
**Description**: The WS auth gate depends entirely on the browser sending the `aconversa-session` cookie on the upgrade — which the WebSocket spec only does same-origin. There is no `Origin` header check, no SameSite enforcement at the WS layer, and no fallback ticket mechanism. The audience surface is explicitly called out (`audience.broadcast_surface`) as needing to be same-origin "or else." Nothing in the server prevents a cross-origin deployment shape from passing CI; CORS at the HTTP layer is wide-open (`origin: true, credentials: true`).
**Impact**: A future deployment that puts the audience UI on a different subdomain will produce a WS endpoint that rejects every legitimate audience connection (denial of service) OR — if a maintainer "fixes" it by reading a query-string token without ratcheting up — a token-in-URL leak via referer / log lines. Today, no exploit; tomorrow's deployment topology change is the trigger.
**Suggested fix**: Add an `Origin`-header allowlist on `/ws` (env-driven, defaulting to `APP_BASE_URL`'s origin) and a query-string-ticket primitive issued by an authenticated HTTP exchange for cross-origin clients. Reject upgrades whose `Origin` is missing or not in the allowlist.
**Confidence**: Confirmed (constraint exists but is not server-enforced).

### F-003 [High] — CORS is permissively `origin: true` + `credentials: true` in production builds
**Location**: `apps/server/src/server.ts:158-161`.
**Description**: `@fastify/cors` is registered with `{ origin: true, credentials: true }`, which reflects the request's `Origin` back in `Access-Control-Allow-Origin` and allows cookies. The code comment claims "production tightening lives with `deployment.prod_container`" but the production code path running today does NOT tighten this — every protected JSON endpoint is reachable from any web origin with `withCredentials`. The session cookie's `SameSite=Lax` is the only CSRF mitigation. SameSite=Lax permits top-level GET navigation, so `GET /auth/me` (returns user id + screen name) is reachable from a cross-origin top-level navigation, but state-changing endpoints (POST/PATCH/DELETE) are blocked at the browser layer by SameSite=Lax for cross-site fetch.
**Impact**: A malicious site can read `/auth/me` (user id + screen name) via a top-level navigation (limited exfil), and any future loosening to `SameSite=None` or any future endpoint that accepts simple GET state-changes (none today) becomes an open CSRF surface. The wider concern is that the production CORS is not yet locked down — when this app moves past M3, the open CORS is a footgun.
**Suggested fix**: Read `APP_BASE_URL` (already in env) and set `origin: [APP_BASE_URL]` (or a configurable allowlist) when `NODE_ENV === 'production'`. The `credentials: true` is fine; the `origin: true` is the problem.
**Confidence**: Confirmed.

### F-004 [Medium] — Dev `SESSION_TOKEN_SECRET` is a low-entropy committed literal; no boot-time strength check
**Location**: `.env.example:95` (`SESSION_TOKEN_SECRET=dev-session-secret-change-me`); `apps/server/src/auth/pending-cookie.ts:298-307` (`resolveSessionTokenSecret` only checks non-empty).
**Description**: The shipped dev secret is the literal `"dev-session-secret-change-me"`. `resolveSessionTokenSecret` enforces "present and non-empty" only — no minimum length, no entropy check. The same secret is used for both the HS256 JWT (`session-token.ts`) and the pending-cookie HMAC (`pending-cookie.ts`), so a single compromise breaks both bridges. A developer who copies `.env.example` to `.env` and forgets to rotate ships a guessable secret to dev/staging; a deployment that forgets to set the env var fails-loud (good), but the loud failure happens at first OIDC callback, not at boot.
**Impact**: Any deployment that runs with the example value (or any short value) lets an attacker forge `aconversa-session` JWTs offline. Combined with F-001 (no revocation), forged sessions stay valid for 7 days.
**Suggested fix**: (a) Require `SESSION_TOKEN_SECRET.length >= 32` in `resolveSessionTokenSecret`; (b) fail at server boot if missing/short rather than at first auth; (c) consider distinct secrets per use (`SESSION_TOKEN_SECRET` for JWT, `PENDING_COOKIE_SECRET` for the bridge) so rotation can decouple.
**Confidence**: Confirmed.

### F-005 [Medium] — In-process OIDC flow-state map causes lost-state on multi-instance deployment and on server restart mid-flow
**Location**: `apps/server/src/auth/flow-state.ts:8-37, 180-203` (module-scoped `Map`, lazy singleton).
**Description**: The flow-state store is a per-process `Map`. Two consequences: (1) any future horizontal scaling (two app pods behind a load balancer) breaks the OIDC flow whenever login and callback hit different pods — the callback's `take(state)` misses, surfacing as `auth-state-invalid` to the user. (2) Restart between `/auth/login` and `/auth/callback` invalidates every in-flight flow. The deeper concern: a future "fix" by a maintainer who doesn't see the security boundary may swap this for an unauthenticated signed cookie, which would expose PKCE verifier + nonce to the client (signing them doesn't help — they need to remain confidential between the login leg and the callback leg, otherwise a CSRF-fixation attack becomes easier).
**Impact**: Today: deployment fragility, not exploit. Tomorrow: a careless replacement could trade availability for a state-fixation surface.
**Suggested fix**: When horizontal scaling lands, back this with Redis (or a Postgres table with index on `state` + a TTL sweeper) — NOT a signed client cookie. Document the constraint in `flow-state.ts` more loudly than the current "single-process" line.
**Confidence**: Confirmed (architectural deferral, not a current exploit).

### F-006 [Medium] — `verifySessionToken` does not bind the JWT to anything other than the secret; cookie copied between devices/browsers is fully portable
**Location**: `apps/server/src/auth/session-token.ts:190-259`.
**Description**: The JWT payload is exactly `{ sub, iat, exp }`. There is no IP binding, no UA binding, no per-device `jti`, no token-binding. This is a deliberate minimality choice (per ADR + no-profile-data), but combined with F-001 (no logout invalidation) and F-004 (single shared secret) the JWT becomes a portable "bearer of identity" credential with a 7-day life. A 7-day portable bearer cookie deserves at least one of {short TTL, per-device jti + denylist, rotating refresh-token pair}.
**Impact**: Token theft → 7 days of full impersonation. This is standard JWT-cookie tradeoff but worth flagging given the WS surface accepts the same token for every state-changing message in the methodology engine (propose / vote / commit / mark-meta-disagreement). Stolen cookie = ability to cast votes / commit proposals as the victim until expiry.
**Suggested fix**: Mint a `jti`, persist a small `auth_sessions (jti, user_id, created_at, last_seen_at, revoked_at)` table, and look up by `jti` on each verify (the WS path will pay the per-message cost, but the lookup is O(log N) on an indexed UUID and runs once per connection if you cache on the WsConnectionContext). At minimum, add the explicit logout-invalidation path from F-001.
**Confidence**: Confirmed (this is design intent; the call-out is to make the residual risk explicit).

### F-007 [Medium] — `POST /auth/logout` accepts any anonymous POST and can be CSRF-pushed onto a victim without authentication
**Location**: `apps/server/src/auth/routes.ts:809-836` (no `preHandler: app.authenticate`).
**Description**: Logout is unauthenticated. Combined with `SameSite=Lax` on the session cookie, a top-level cross-origin form POST (Lax allows the cookie on top-level POST? — actually Lax restricts cookies to same-site requests except for "safe" methods, so the cookie is NOT sent on a cross-site POST → no actual forced-logout via this path under Lax). Under SameSite=Lax the practical attack is mitigated. However, the endpoint's idempotent 204 means an attacker who controls a same-origin context (e.g., XSS, a permissive subdomain) can force log-outs without any token check — a low-impact DoS-style nuisance and a useful primitive for session-fixation flows.
**Impact**: Low-to-medium. Under current Lax-cookie posture, no cross-site forced logout. A same-origin DoS / fixation primitive remains.
**Suggested fix**: Either require a CSRF token / `Origin` check, or accept that idempotent logout is fine and add an `Origin`-allowlist guard at minimum.
**Confidence**: Suspected (impact depends on future deployment shape).

### F-008 [Low] — `oauth_subject` is namespaced by issuer **hostname**, not full URL; subdomain collisions possible across deployments sharing a DB
**Location**: `apps/server/src/auth/routes.ts:183-185` (`namespacedOauthSubject` uses `issuerUrl.hostname`).
**Description**: The namespaced key stored in `users.oauth_subject` is `${hostname}:${sub}`. If a deployment ever points at two different OIDC issuers on the SAME hostname (different ports — `auth.example.com:443` vs `auth.example.com:9091`) or rotates issuers while keeping the same hostname, two distinct OIDC `sub` values would collide. The Authelia dev shape and a future production swap on the same `auth.example.com` URL fall in this bucket.
**Impact**: Two separate users from two issuers on the same hostname could land on the same `users` row, with the second login overwriting the first's identity binding. Requires an operational misstep, but the failure mode is silent.
**Suggested fix**: Include port + protocol in the namespace key (or use the full `issuer` claim verbatim — openid-client validates it). The UNIQUE constraint on `oauth_subject` is the safety net here too — the second user would just get the first's account, which is worse than a failed login.
**Confidence**: Confirmed (low practical impact today, latent risk).

### F-009 [Low] — Session JWT verify does not pin the `iat` < `exp` invariant or a sane upper bound on `exp`
**Location**: `apps/server/src/auth/session-token.ts:231-259`.
**Description**: `verifySessionToken` accepts any token where `exp` is a finite number and not expired. There is no check that `exp <= iat + SESSION_TOKEN_TTL_SECONDS` or that `iat <= now`. An attacker who somehow obtains the signing secret (cf. F-004) could mint a token with `exp = year 2100`; the verifier would happily accept it. The signing path bounds the TTL, but the verifier does not re-bind on read.
**Impact**: Only matters if the secret is compromised — at which point the attacker has full impersonation anyway. Defense in depth.
**Suggested fix**: In `verifySessionToken`, reject when `(payload.exp - payload.iat) > SESSION_TOKEN_TTL_SECONDS + slack` and when `payload.iat > now + slack`. Small clock-skew tolerance (e.g. 60s) suffices.
**Confidence**: Confirmed.

### F-010 [Low] — `screen_name` UPDATE allows arbitrary unicode including control chars and confusables; no normalization
**Location**: `apps/server/src/auth/routes.ts:361-376` (`validateScreenName`).
**Description**: Validation is: non-string → reject; trim → if empty after trim, reject; if >64 UTF-16 units, reject. Otherwise accept. No normalization (NFC/NFKC), no zero-width / direction-override stripping, no homograph protection. A user can register `аdmin` (Cyrillic а) or use RLO/LRO overrides to spoof another user's name in audience-visible event payloads (`participant-joined.payload.screen_name` is broadcast).
**Impact**: UI impersonation (different `users.id` but visually-identical `screen_name`). Not authentication bypass, but a social-engineering primitive in a debate platform whose moderator identity is visually-presented.
**Suggested fix**: NFKC-normalize, strip control characters + bidi overrides, optionally restrict to a printable-character class. Document the policy in the screen-name refinement.
**Confidence**: Confirmed.

### F-011 [Low] — `Set-Cookie` header composition does not URL-encode the cookie value; pending-cookie's `.`-separated base64url is safe but the discipline isn't enforced
**Location**: `apps/server/src/auth/session-token.ts:278-294`, `apps/server/src/auth/pending-cookie.ts:255-271`.
**Description**: The cookie value is interpolated into the `Set-Cookie` header directly: `${COOKIE_NAME}=${token}`. The pending cookie and the JWT both produce values restricted to a safe charset (base64url + `.`), so today there's no injection. However, the helpers don't enforce that the supplied `token` is safe — a future caller that passes an unsanitized value (e.g. for a debug cookie) would header-inject.
**Impact**: None today. Latent regression risk.
**Suggested fix**: Add an assertion in `buildSessionCookieHeader` / `buildPendingCookieHeader` that the token matches `/^[A-Za-z0-9._\-]+$/` (or whatever the cookie-value RFC permits without quoting).
**Confidence**: Confirmed (latent).

### F-012 [Informational] — `request.log.debug` on auth failure could leak the cookie value at debug log level
**Location**: `apps/server/src/ws/connection.ts:567-588` (debug logs on WS auth reject); `apps/server/src/logger.ts:29-42` (documents header-redaction but only via the default request serializer — explicit `request.log.debug({ route: '/ws' }, ...)` calls bypass redaction).
**Description**: The WS reject path logs `{ route: '/ws' }` only — currently safe. But the surrounding pattern relies on the developer not adding cookie / token fields to the log object. There's no pino `redact` configured in `createLoggerOptions`. A future PR that adds `{ cookie: rawHeader }` for "debugging" would leak the bearer token to logs.
**Impact**: None today; latent.
**Suggested fix**: Configure Pino `redact: ['req.headers.cookie', 'req.headers.authorization', '*.cookie', '*.token']` in `logger.ts`. The cost is per-log-line redaction; the benefit is defense-in-depth against future log additions.
**Confidence**: Confirmed.

### F-013 [Informational] — OIDC redirect-after-callback always redirects to `APP_BASE_URL` (no open-redirect surface), but no `?next=` parameter exists yet
**Location**: `apps/server/src/auth/routes.ts:682` (`return reply.redirect(oidcConfig.appBaseUrl, 302)`).
**Description**: The returning-user path redirects to the configured `APP_BASE_URL` — a server-side fixed value, not a user-controllable parameter. No open-redirect surface today. When the frontend grows a "remember where the user was trying to go" feature, the temptation will be to add `?next=<url>`; the next reviewer should pin that this parameter must be same-origin-validated.
**Impact**: None today.
**Suggested fix**: Document in `routes.ts` that any future `?next=` parameter must be validated against the `APP_BASE_URL` origin via a `URL`-parse comparison.
**Confidence**: Informational.

### F-014 [Informational] — Authority on `POST /sessions/:id/end` (and siblings) uses `host_user_id === caller.id`; the host role is conflated with moderator role
**Location**: `apps/server/src/sessions/routes.ts:1659-1661, 1856-1862, 2028-2033, 2277-...`.
**Description**: The session-management endpoints treat "host" and "moderator" as synonymous, returning `not-a-moderator` for any non-host caller. This is documented as a v1 simplification (the host IS the moderator). When the moderator role gains separability (the methodology engine's events already distinguish `actor` from `host`), every authority check in `sessions/routes.ts` will need updating. Currently safe; flag for future.
**Impact**: None today.
**Suggested fix**: When separating roles, route authority through a single `isModerator(session, userId)` helper rather than re-deriving from `host_user_id` at each call site.
**Confidence**: Informational.

### F-015 [Informational] — `expectedSequence` race in WS write handlers is OK; the FOR UPDATE row lock is the primary serialization
**Location**: `apps/server/src/ws/handlers/propose.ts:200-249`, plus `vote.ts` / `commit.ts` / `meta-disagreement.ts`.
**Description**: Reviewed for TOCTOU between the visibility re-check (line 188) and the transactional FOR UPDATE (line 207). The window exists in theory — between gate 2 and the lock acquisition — but inside the transaction the FOR UPDATE serializes appenders and the existence-check inside the transaction catches a session that vanished. No issue.
**Impact**: None.
**Suggested fix**: None.
**Confidence**: Confirmed (clean).

## Coverage notes

**What was checked**:
- All files under `apps/server/src/auth/` (config, flow, flow-state, routes, session-token, pending-cookie, middleware, no-profile-data audit, types).
- `apps/server/src/ws/connection.ts` (auth gate + lifecycle).
- All seven WS handlers under `apps/server/src/ws/handlers/` for auth gate + visibility re-check + payload-id-spoofing pattern.
- Every route in `apps/server/src/sessions/routes.ts` (`preHandler: app.authenticate` and visibility/authority/lifecycle ordering).
- `apps/server/src/sessions/visibility.ts` for the canonical predicate.
- `apps/server/src/server.ts` for plugin registration order + CORS shape.
- `.env.example`, `infra/authelia/configuration.yml`, `compose.yaml` (briefly) for secret material.
- `apps/server/migrations/0001_users.sql` for schema column set (verified no profile-data columns).
- `apps/server/src/auth/no-profile-data.test.ts` — confirmed the lock-in tests cover scope / claim-read-site / userinfo / migration / JWT payload / response surface. Solid.
- `apps/server/src/auth/middleware.test.ts` for soft-delete behavior.
- `apps/server/src/ws/auth.test.ts` for the WS gate's rejection variants.
- The `ws_auth_on_connect.md` refinement for the same-origin contract.

**What was deliberately NOT checked** (out of scope or covered by sibling reviewers):
- The methodology engine's per-action authorization (`validateAction` in `methodology/engine.ts`). Reviewed cursorily — the engine emits `not-a-moderator` for non-host commit, which is the right code given current role conflation (cf. F-014).
- Rate limiting / brute-force throttling on the auth endpoints (none exists — Authelia handles upstream auth rate limits via its `regulation` block, which is dev-permissive at 10 retries / 2 min).
- The Cucumber / Playwright tests' fidelity — assumed correct based on the test counts in refinement docs.
- Production deployment configuration (`deployment.prod_container` is a deferred task per `tasks/`).
- The detailed openid-client library internals (JWKS rotation, id_token validation specifics) — relied on the library's audited behavior + the explicit `algorithms: ['HS256']` pin on our verify.
- Secret rotation operational playbook (none exists yet; F-004 flags it).

## Overall assessment

The auth + secrets surface is in considerably better shape than typical M3-MVP code: PKCE + state + nonce are correctly threaded through openid-client; the OIDC scope is pinned to `openid` and the no-profile-data invariants are pinned by lock-in tests; the JWT verifier pins `algorithms: ['HS256']` (closing algorithm-confusion); the pending cookie uses `timingSafeEqual`; SQL is uniformly parameterized; the visibility predicate is factored into a single module and reused at every session-management endpoint with consistent existence-non-leak (404-not-403) semantics; every protected HTTP endpoint declares `preHandler: app.authenticate` and every WS handler defensively narrows `connection.user`. The biggest risks are not in what was written but in what was deferred: no session revocation (F-001 / F-006), no production CORS lockdown (F-003), no enforcement of the same-origin WS auth contract (F-002), and a low-entropy committed dev secret with no boot-time strength check (F-004). Prioritize F-001/002/003/004 before exposing this to a public network surface; F-005 is the architectural follow-up if horizontal scaling is on the roadmap.
