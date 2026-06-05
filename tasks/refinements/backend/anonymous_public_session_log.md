# `GET /sessions/:id/events` — anonymous read of a public session's event log

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.replay_endpoints.anonymous_public_session_log` (line 416)
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.replay_endpoints.get_session_log` — **settled** (shipped 2026-06-03; see [`get_session_log.md`](./get_session_log.md)). That task landed the endpoint this one relaxes: `GET /sessions/:id/events` in `apps/server/src/replay/routes.ts` (the `replayRoutesPlugin`), the cursor-paginated `{ events, nextCursor }` response, the read helper `readSessionEventsPage` (`apps/server/src/events/read.ts`), and the visibility gate via `canSeeSession`. Inherited via the `.tji` `depends !get_session_log`.
- `backend.session_management` (transitively, via `get_session_log`) — **settled**. The visibility seam `apps/server/src/sessions/visibility.ts` (`canSeeSession`, `canSeeSessionAnonymously`, `visibilityWhereFragment`) is the family this task extends with a third predicate.
- `backend.auth` (transitively) — **settled**. `apps/server/src/auth/middleware.ts` owns the `app.authenticate` decorator and the `authenticateRequest(cookieHeader, pool, secret, now)` primitive this task reuses to build an *optional* auth posture.

## What this task is

The backend half of ADR 0045's anonymous public-session replay. `replay_test.replay_ui.replay_mode_audience_surface` shipped (commit 365a7a27) the public audience replay surface at `/a/{locale}/replay/{id}`, but its data source — `GET /sessions/:id/events` — is **authenticated-only** (`preHandler: app.authenticate` → 401 for any anonymous request, *before* visibility is even consulted). So an anonymous viewer of a public replay URL today sees only the sign-in CTA.

This task relaxes that endpoint to **two auth postures on a single route** (mirroring ADR 0029's "one transport, two auth postures" exactly):

- **Authenticated** request → gate unchanged: `canSeeSession` (`public OR host OR participant incl. historical`).
- **Anonymous** request (no cookie, or an invalid/expired cookie) → a new **replay-visibility predicate** `canReplaySessionAnonymously(executor, sessionId)` → `SELECT 1 FROM sessions WHERE id = $1 AND privacy = 'public'` (no `ended_at` filter — replay is inherently historical).

The existence-non-leak rule is preserved: a private or nonexistent session is `not-found` / 404 for an anonymous caller, indistinguishable from outside. No anonymous identity is synthesized; the transport stays same-origin with no query-string ticket (ADR 0029's deferred cross-origin answer stays deferred).

Artifact shape:

- **New predicate** — `canReplaySessionAnonymously(executor, sessionId): Promise<boolean>` in `apps/server/src/sessions/visibility.ts`, sibling to `canSeeSessionAnonymously` (lines 217–226). Strictly the live-anonymous predicate **minus** its `ended_at IS NULL` clause.
- **New optional-auth decorator** — `app.optionalAuthenticate` in `apps/server/src/auth/middleware.ts`, sibling to `app.authenticate` (lines 259–275). Resolves the cookie via the existing `authenticateRequest` primitive; on success sets `request.authUser`; on no-cookie / invalid-cookie leaves it **unset** (`undefined`) and **never throws 401**. This is the HTTP analogue of the WS upgrade gate's optional posture (`apps/server/src/ws/connection.ts:909–1011`).
- **Endpoint relaxation** — `apps/server/src/replay/routes.ts`: the `GET /sessions/:id/events` route swaps `preHandler: app.authenticate` for `app.optionalAuthenticate`, and the handler's `request.authUser === undefined` branch (today a defensive 500) becomes the real anonymous path that calls `canReplaySessionAnonymously` instead of `canSeeSession`.
- **Cucumber + pglite scenarios** — extend `tests/behavior/backend/get-session-events.feature` (+ its steps) with the anonymous matrix at the HTTP/replay protocol seam.
- **Vitest** — `visibility.test.ts` (predicate), `middleware.test.ts` (the new decorator), `replay/routes.test.ts` (the anonymous handler branches).
- **Playwright** — extend `tests/e2e/audience-replay.spec.ts` (project `chromium-audience-replay`) with the now-reachable anonymous-public-replay behavior, and re-point the shipped anonymous-CTA test to a non-public session.

## Why it needs to be done

- **It pays down ADR 0045's named follow-up and the surface task's one deferred e2e.** [`replay_mode_audience_surface.md`](../replay_test/replay_mode_audience_surface.md) criterion 5 (lines 92, 98–101) deferred the "anonymous public-session replays without sign-in" Playwright spec to *this* leaf, because the behavior was unreachable while the endpoint 401'd anonymous. This is the **only** refinement pointing at this leaf (debt count = 1 — no catch-all pile-up).
- **The product wants a shareable public-replay link that works without sign-in.** ADR 0045 Consequences: "A shared public-replay link works immediately for any signed-in viewer; the no-sign-in public experience is one backend leaf away." This is that leaf.
- **The surface already renders the graph the moment the data loads.** `AudienceReplayRoute` (`apps/audience/src/routes/AudienceReplayRoute.tsx:98–107`) mounts `<GraphView>` unconditionally on `useSessionEventLog` status `'ready'`, with no auth check; `PrivateSessionCta` shows only on `'not-found'` / `'error'` (lines 58–96). So flipping the endpoint from 401→200 for an anonymous public read flips the hook from `error`→`ready` and the graph renders — **no frontend change is required** to make the behavior reachable (see Decisions §5).

## Inputs / context

The endpoint as shipped — [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts) (`GET /api/sessions/:id/events`, ~lines 533–607):

```ts
app.get('/api/sessions/:id/events', {
  preHandler: app.authenticate,            // ← becomes app.optionalAuthenticate
  schema: { /* params: sessionIdParamsSchema, querystring: sessionEventsQuerySchema, ... */ },
}, async (request, reply) => {
  const auth = request.authUser;
  if (auth === undefined) {                // ← today: defensive 500; becomes the anonymous branch
    throw new ApiError(500, 'internal-error', 'auth middleware did not populate request.authUser');
  }
  const userId = auth.id;
  // ...params/query narrowing, ensurePool()...
  if (!(await canSeeSession(pool, sessionId, userId))) {   // ← authenticated gate (unchanged)
    throw ApiError.notFound('session not found or not visible');
  }
  const page = await readSessionEventsPage(pool, { sessionId, afterSequence, limit });
  return reply.code(200).send(page);
});
```

The visibility family — [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts):

- `canSeeSession(executor, sessionId, userId)` (lines 167–178) — authenticated full rule; **unchanged** by this task.
- `canSeeSessionAnonymously(executor, sessionId)` (lines 217–226) — `SELECT 1 ... WHERE id = $1 AND privacy = 'public' AND ended_at IS NULL`. The live-WS anonymous predicate (ADR 0029). The new predicate is this one **without** the `ended_at IS NULL` clause; copy the export/`VisibilityExecutor` shape verbatim.
- `visibilityWhereFragment(userIdParamIndex)` (lines 115–132) — the authenticated SQL fragment; not needed here (the anonymous predicate is a flat one-column existence check, no user param).

The auth seam — [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts):

- `app.authenticate` decorator (lines 259–275) — resolves the cookie via `authenticateRequest(...)`; on `null` throws `ApiError(401, AUTH_REQUIRED_CODE, ...)`; else sets `request.authUser`. The new `optionalAuthenticate` decorator is this with the `null → 401 throw` replaced by `null → leave authUser unset, return`.
- `authenticateRequest(cookieHeader, pool, secret, now)` (lines 158–200) — returns `AuthUser | null` (null for absent / unverifiable / revoked / soft-deleted). The optional decorator reuses it verbatim; it already encodes "invalid cookie ⇒ treat as not-authenticated."

The WS precedent — [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (~lines 909–1011): the `preValidation` upgrade gate that ADR 0029 relaxed. No cookie → `request.log.debug('… proceeding as anonymous'); return;` (authUser left unset). Cookie present but `authenticateRequest` returns `null` → same anonymous `return`. The origin-allowlist gate still runs first and still 403s off-origin. The HTTP optional decorator mirrors this branch structure (minus the origin gate, which is WS-only).

The shipped Cucumber pin — [`tests/behavior/backend/get-session-events.feature`](../../../tests/behavior/backend/get-session-events.feature) (lines 1–70) and its steps [`tests/behavior/steps/backend-get-session-events.steps.ts`](../../../tests/behavior/steps/backend-get-session-events.steps.ts): `Background` mints an authenticated cookie (`alice`) used by every existing scenario; the app is built with `__buildTestReplayApp` over the pglite-backed pool; `Given the most recently created session has {int} events` (steps ~118–136) seeds sequential proposal events; public/private session seeding reuses the `backend-list-sessions.steps.ts` Givens. **No anonymous (no-cookie) request step and no public-*ended* session seed exist yet** — both are new in this task.

The frontend consumers (read-only context, no edits except the e2e spec):

- [`apps/audience/src/routes/AudienceReplayRoute.tsx`](../../../apps/audience/src/routes/AudienceReplayRoute.tsx) (lines 40–108) — `'ready'` → `<GraphView>` unconditionally; `'not-found'`/`'error'` → unavailable shell + `<PrivateSessionCta>` (the CTA self-hides for authenticated viewers).
- [`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts) — HTTP 404 → `'not-found'`; any other non-200 (incl. the current 401) → `'error'`; 200 → `'ready'`. After this task, anonymous + public → 200 → `'ready'`; anonymous + private → 404 → `'not-found'`. The 401→`'error'` branch becomes unreachable *for this endpoint* (the relaxed route never 401s) but stays as defensive code.
- [`tests/e2e/audience-replay.spec.ts`](../../../tests/e2e/audience-replay.spec.ts) (test 2, lines 123–160) — the shipped anonymous-CTA e2e. It seeds a session via `generateSyntheticSession()` as `alice`, then asserts an anonymous context sees `audience-private-session-cta`. **It relies on the blanket 401** ("the authenticated-only endpoint 401s the anonymous request"), not on the session's privacy — so it breaks once the endpoint stops 401-ing anonymous *if that synthetic session is public* (see Constraints).
- [`playwright.config.ts`](../../../playwright.config.ts) (lines 434–444) — the `chromium-audience-replay` project (`testMatch: /audience-replay\.spec\.ts$/`, `dependencies: ['setup-auth']`, authenticated `storageState`). Test 2 already opens an anonymous context via `freshContext(browser)` — the pattern the new anonymous-public test reuses.

ADRs: [0045](../../../docs/adr/0045-audience-replay-surface-visibility-gating.md) (this task's governing decision — endpoint relaxation, the `canReplaySessionAnonymously` predicate, the Cucumber matrix, the scoped Playwright spec), [0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) (the "one transport, two auth postures" + no-tracking + existence-non-leak pattern this mirrors; its 2026-06-05 amendment routes anonymous replay through *this* HTTP endpoint), [0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) (events trusted on read), [0007](../../../docs/adr/0007-behavior-test-framework-cucumber.md) / [0008](../../../docs/adr/0008-e2e-framework-playwright.md) / [0022](../../../docs/adr/0022-no-throwaway-verifications.md) (the test layering).

## Constraints / requirements

- **Single route, two postures.** Do **not** fork a parallel public-only endpoint. Relax the existing `GET /sessions/:id/events` in place (ADR 0045 Alternatives: a parallel endpoint "would duplicate the cursor-pagination logic and create a second source of truth"). The cursor-pagination, response shape, param/query schemas, ordering, and `readSessionEventsPage` call are all **unchanged**.
- **The anonymous predicate is ended-agnostic.** `canReplaySessionAnonymously` is `WHERE id = $1 AND privacy = 'public'` — **no** `ended_at` clause. Reusing `canSeeSessionAnonymously` verbatim is wrong: its `ended_at IS NULL` excludes ended sessions, which are the primary replay target (ADR 0045 Decision + Alternatives).
- **Optional auth never 401s, and an invalid cookie degrades to anonymous.** `app.optionalAuthenticate` must treat a missing cookie *and* a present-but-unverifiable cookie (expired / forged / revoked / soft-deleted user — i.e. `authenticateRequest` → `null`) identically: leave `request.authUser` unset and proceed. This matches the WS gate's two anonymous branches (`connection.ts` ~966 and ~995) and ADR 0029's note that "a malicious actor who forged a cookie does not bypass the anonymous-only visibility check." A forged-cookie caller lands in the anonymous branch and is gated by `canReplaySessionAnonymously` — strictly `privacy = 'public'`.
- **`request.authUser` may now be `undefined` in the handler.** The shipped handler's `if (auth === undefined) throw 500` is replaced by the auth-posture branch. Respect `exactOptionalPropertyTypes` (the field is *omitted*, not set to `undefined`, on the anonymous path — same distinction the WS context makes).
- **Existence-non-leak preserved.** Anonymous + private, anonymous + nonexistent, anonymous + (any non-public) all → `ApiError.notFound('session not found or not visible')` → 404 `not-found`. Same single phrasing the authenticated path uses; private and absent are indistinguishable from outside.
- **Authenticated contract unchanged.** Every existing scenario in `get-session-events.feature` (authenticated visible → 200; private-not-visible-to-non-participant → 404; unknown id → 404; pagination) stays green byte-for-byte. The decorator swap is transparent to an authenticated caller — `authenticateRequest` still populates `request.authUser`, and `canSeeSession` still runs.
- **No new write surface, no anonymous mutation.** This is a read endpoint; there is no anonymous write path to consider (unlike the WS write handlers ADR 0029 had to forbid). No rate-limit accounting change (the read is a single bounded page; ADR 0029's deferred per-anonymous-connection accounting was a WS-catch-up concern, not an HTTP-page concern).
- **Re-point the shipped anonymous-CTA e2e to a non-public session.** `tests/e2e/audience-replay.spec.ts` test 2 currently asserts the CTA for an anonymous viewer of a `generateSyntheticSession()` session, relying on the blanket 401. Once relaxed, that assertion only holds if the target session is **not** anonymously-replayable. Determine the synthetic session's privacy; if it is (or can be) public, re-point test 2 to a **private** session (host creates it, flips privacy to private if needed) or a nonexistent uuid so it 404s → `not-found` → CTA. The "anonymous → CTA" behavior is real and must keep a pin — it now requires a *private* target.
- **Test layers per ADR 0022:**
  - **Vitest** `apps/server/src/sessions/visibility.test.ts` — `canReplaySessionAnonymously`: public-live → true; public-ended → true; private → false; nonexistent → false. (Contrast cases proving it differs from `canSeeSessionAnonymously` on the ended case.)
  - **Vitest** `apps/server/src/auth/middleware.test.ts` — `optionalAuthenticate`: valid cookie → `request.authUser` set, no throw; no cookie → `request.authUser` undefined, no throw, no 401; invalid/expired cookie → `request.authUser` undefined, no throw, no 401.
  - **Vitest** `apps/server/src/replay/routes.test.ts` (via `.inject()`) — anonymous + public-live → 200 + events; anonymous + public-ended → 200 + events; anonymous + private → 404; anonymous + unknown id → 404; authenticated paths (the shipped cases) still green.
  - **Cucumber + pglite** `tests/behavior/backend/get-session-events.feature` — **the protocol-seam pin (this is the required Cucumber per the backend e2e policy — the change crosses the HTTP/replay boundary).** New scenarios: anonymous + public-ended → 200 (events in ascending order); anonymous + public-live → 200; anonymous + private → 404 `not-found`; the existing authenticated scenarios stay unchanged. New step defs: an anonymous GET (no `cookie` header) and a public-*ended* session seed (`ended_at` set).
  - **Playwright** `tests/e2e/audience-replay.spec.ts` (`chromium-audience-replay`) — see Acceptance.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), each check is a committed regression pin, not a throwaway verification.

1. **Build + check green** — `pnpm --filter @a-conversa/server run build` and `pnpm run check` succeed.
2. **Vitest green** (`pnpm run test:smoke`) including: the new `canReplaySessionAnonymously` cases in `visibility.test.ts`; the `optionalAuthenticate` cases in `middleware.test.ts`; the anonymous handler branches in `replay/routes.test.ts`; and all pre-existing replay/auth/visibility cases unchanged.
3. **Cucumber green** (`pnpm run test:behavior:smoke`) including the new anonymous scenarios in `get-session-events.feature` (anon + public-ended → 200; anon + public-live → 200; anon + private → 404) — **the HTTP/replay protocol-seam pin**. The shipped authenticated scenarios stay green unchanged.
4. **Playwright — anonymous public-session replay renders the graph (the deferred e2e, now in scope and paid down).** In `tests/e2e/audience-replay.spec.ts` (`chromium-audience-replay`): an authenticated host seeds a **public** session log (`generateSyntheticSession()`, flipping privacy to public if it does not default so); an anonymous browser context (`freshContext(browser)`, no session cookie) navigates `/a/replay/<id>` → the graph root (`data-testid="audience-graph-root"`, the renderer's root from the surface task) mounts with nodes and the `audience-private-session-cta` is **absent**. This is the behavior `replay_mode_audience_surface` criterion 5 deferred here; it is now reachable because the endpoint returns 200 to the anonymous public read and `AudienceReplayRoute` renders `<GraphView>` on `'ready'`.
5. **Playwright — anonymous viewer of a non-public session still shows the CTA.** Test 2 of `audience-replay.spec.ts` is re-pointed to a **private** (or nonexistent) session so it 404s → `not-found` → `audience-private-session-cta` visible. The "anonymous → sign-in wall" behavior keeps a regression pin; only its target privacy changes.
6. **Accessibility unchanged** — the existing axe-playwright pass over the audience surface stays clean for the new anonymous-graph state (no new violations; ADR 0040).
7. **`make test` green end-to-end**, and `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the closer adds `complete 100`.
8. The exact before/after Vitest, Cucumber, and Playwright totals are recorded in the `## Status` block on completion (per the [README ritual](../README.md#task-completion-ritual)); this refinement does not hard-code baselines that drift between authoring and implementation.

No follow-up task is deferred from this leaf: the Cucumber matrix and the previously-deferred Playwright spec both land here. (There is no remaining anonymous-replay e2e debt to register — criterion 4 clears the surface task's debt count from 1 to 0.)

## Decisions

- **§1 — Relax the existing endpoint to two auth postures; do not fork a public-only route.** Chosen per ADR 0045 (and ADR 0029's transport precedent). Alternatives: (a) a parallel `GET /sessions/:id/public-events` — rejected: duplicates cursor-pagination and `readSessionEventsPage`, and creates a second source of truth for the read shape; (b) a query-string ticket primitive (`POST .../audience-ticket` then `?ticket=`) — rejected for v1 (ADR 0029/0045): the same-origin cookie-or-no-cookie posture covers the deployment shape; the ticket remains the deferred answer only for a cross-origin embed. The single-route relaxation keeps the authenticated contract and its Cucumber pins updating *in place*.

- **§2 — New `canReplaySessionAnonymously` predicate, ended-agnostic.** Chosen: `WHERE id = $1 AND privacy = 'public'`. Alternative — reuse `canSeeSessionAnonymously` verbatim — rejected: its `ended_at IS NULL` clause excludes ended sessions, the primary replay target (ADR 0045). The three predicates compose and none drifts the others' signatures: `canSeeSession` (authenticated full rule), `canSeeSessionAnonymously` (public + not-ended, live), `canReplaySessionAnonymously` (public, ended-agnostic, replay). The replay predicate is strictly the live-anonymous predicate minus one clause — the minimal, auditable delta.

- **§3 — A reusable `app.optionalAuthenticate` decorator, not inline auth resolution in the handler.** Chosen: a sibling decorator to `app.authenticate` that reuses `authenticateRequest` and never 401s. Rationale: it is symmetric with the existing decorator, unit-testable in isolation (the WS path's inline form is only integration-testable through an upgrade), and it gives future public-readable HTTP endpoints (e.g. a hypothetical public snapshot read) a ready seam — the same way `app.authenticate` serves every authenticated route. Alternatives: (a) drop the `preHandler` and call `authenticateRequest` inline in the handler — rejected: it scatters the cookie-resolution logic into the route body and is harder to reuse/test; (b) parameterize `app.authenticate` with an `{ optional: true }` flag — rejected: a boolean that changes whether a function throws is a footgun (a caller that forgets the flag silently gets the wrong posture); two named decorators make the posture explicit at the call site. This is an *implementation* choice within ADR 0045/0029's already-decided architecture (anonymous, data-layer gated, no synthesized identity) — it introduces no new architectural seam and needs no new ADR.

- **§4 — Invalid/expired cookie degrades to anonymous, not 401.** Chosen: mirror the WS gate (`connection.ts` ~995) — a present-but-unverifiable cookie lands in the anonymous branch and is gated by `canReplaySessionAnonymously`. Rationale: a forged or stale cookie cannot bypass the public-only predicate, so there is no security reason to 401 it, and treating it as anonymous keeps the relaxed endpoint's behavior uniform ("authenticated ⇔ a *valid* cookie; everything else ⇔ anonymous"). Alternative — 401 on a present-but-invalid cookie while allowing a wholly absent one — rejected: it splits the anonymous case in two for no benefit and diverges from the WS precedent ADR 0045 says to mirror.

- **§5 — The Playwright spec is in scope here (the behavior is reachable from this backend change alone), not deferred further.** This is the load-bearing scoping call. `AudienceReplayRoute` (`AudienceReplayRoute.tsx:98–107`) renders `<GraphView>` on `useSessionEventLog` status `'ready'` with **no auth conditional**; `PrivateSessionCta` shows only on `'not-found'`/`'error'`. The hook's status is a pure function of the HTTP response (200 → `'ready'`, 404 → `'not-found'`, other → `'error'`). Therefore flipping the endpoint from 401→200 for an anonymous public read flips the surface from CTA→graph **with no frontend edit** — the anonymous-public-replay behavior becomes reachable the instant this backend change lands, satisfying the UI-stream e2e policy's "reachable ⇒ e2e in scope" rule. Alternative — defer the Playwright spec to a future frontend task that relaxes the surface's gating — rejected: there is *nothing left to relax* on the frontend; the surface already gates on data-load status, not on auth status, so a frontend follow-up would be a no-op. Deferring would also re-open the debt this leaf exists to close (and risk the self-perpetuating-audit antipattern). The only frontend-side edit needed is to the *test* (criterion 5), which is a pin update, not a behavior change.

- **§6 — Add the anonymous scenarios to the existing `get-session-events.feature`, not a new feature file.** Chosen: ADR 0045 — "the authenticated contract and its existing Cucumber pins update in place rather than forking." One feature file owns the endpoint's whole contract (both postures), so a reader sees the authenticated and anonymous matrices side by side. Alternative — a new `get-session-events-anonymous.feature` — rejected: it splits one endpoint's contract across two files and risks the two drifting.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- **New predicate** `canReplaySessionAnonymously` added to `apps/server/src/sessions/visibility.ts` — `WHERE id = $1 AND privacy = 'public'` with no `ended_at` clause (ended-agnostic); 6 Vitest cases in `apps/server/src/sessions/visibility.test.ts` covering public-live→true, public-ended→true, private→false, nonexistent→false, plus contrast cases proving the ended-case difference vs `canSeeSessionAnonymously`.
- **New `app.optionalAuthenticate` decorator** added to `apps/server/src/auth/middleware.ts` and typed in `apps/server/src/auth/types.d.ts` — reuses `authenticateRequest` primitive; on missing or invalid cookie leaves `request.authUser` unset and never throws 401; 5 Vitest cases in `apps/server/src/auth/middleware.test.ts`.
- **Route relaxed** in `apps/server/src/replay/routes.ts` — `GET /api/sessions/:id/events` swapped from `preHandler: app.authenticate` to `app.optionalAuthenticate`; anonymous branch calls `canReplaySessionAnonymously` (404 on private/nonexistent); authenticated branch unchanged; 5 anonymous-posture handler cases added/replaced in `apps/server/src/replay/routes.test.ts`.
- **Cucumber pin** in `tests/behavior/backend/get-session-events.feature` — 3 new scenarios (anon+public-ended→200, anon+public-live→200, anon+private→404); 2 new step defs in `tests/behavior/steps/backend-get-session-events.steps.ts` (anonymous GET step, public-ended session seed).
- **Playwright** `tests/e2e/audience-replay.spec.ts` — new test (4) asserts anonymous public-session replay renders graph (`audience-graph-root`) with no CTA; test (2) re-pointed to a private session so anon→404→CTA pin holds after the endpoint stopped 401-ing anonymous.
- No tech-debt follow-up registered; the surface task's deferred e2e (criterion 4) lands here — debt count cleared 1→0.
