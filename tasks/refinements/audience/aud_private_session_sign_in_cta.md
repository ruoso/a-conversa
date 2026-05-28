# Per-session sign-in CTA for private-session subscribe rejection

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_url_routing.aud_private_session_sign_in_cta` (effort `0.5d`, depends `!aud_session_url`; embedded `note` records the inheritance: *"Anonymous visitor hits a private session; server rejects the WS subscribe with 'forbidden'; the graph route currently renders an empty canvas with no user-facing message. This task registers a subscribe-rejection-aware sign-in CTA contextualised to the session. Source: tasks/refinements/audience/aud_session_url.md Open question §1 + Status block."*). Note: the actual wire code is `not-found`, not `'forbidden'` — the existence-non-leak rule per ADR 0029 collapses both into the same code (see Inputs / context — the `.tji` note pre-dates the audit; the refinement below reads from the shipped server behaviour).

**Effort estimate**: 0.5d — capture the `trackSession` promise rejection inside `<AudienceLiveRoute>` (~10 LOC), render a contextual CTA panel under a new `audience-private-session-cta` testid when the rejection is `not-found` AND `auth.status` is anonymous (~30 LOC + 3 new i18n keys × 3 locales), 4 new Vitest cases in `AudienceLiveRoute.test.tsx`, one new Playwright scenario appended to `tests/e2e/audience-live-session.spec.ts`.

**Inherited dependencies**:

- `!audience.aud_url_routing.aud_session_url` (settled — the route `/sessions/:sessionId` (and locale sibling) now mounts `<AudienceLiveRoute>` at [`apps/audience/src/routes/AudienceLiveRoute.tsx`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx); the route calls `void wsClient.trackSession(sessionId)` inside a `useEffect` and swallows the rejection. The refinement [`aud_session_url.md`](aud_session_url.md) Open question §1 named **this leaf** as the home for subscribe-rejection-aware messaging; this is that follow-up).
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_auth_for_private` (settled — landed the surface's first `useAuth()` consumer (the placeholder route's `<AnonymousChrome>`) and the canonical exhaustive `switch (status)` discipline. Decision §6 of [`aud_auth_for_private.md`](aud_auth_for_private.md) explicitly **deferred the per-session contextual wording to `aud_url_routing.aud_session_url`**; `aud_session_url` in turn deferred it to this leaf. The chain settles here).
- Prose-only context: `audience.aud_shell.aud_anonymous_ws_subscribe` (settled — establishes the wire contract this leaf is downstream of: a subscribe attempt from an anonymous connection to a private (or ended, or non-existent) session is rejected with `code: 'not-found'`, the existence-non-leak rule per ADR 0029. See [`apps/server/src/ws/handlers/subscribe.ts:95-123`](../../../apps/server/src/ws/handlers/subscribe.ts#L95) and [`apps/server/src/sessions/visibility.ts:217-226`](../../../apps/server/src/sessions/visibility.ts#L217).).
- Prose-only context: `shell_package.shell_substrate_extraction` (settled — `<LoginButton>`, `useAuth()`, `AuthValueProvider`, `WsRequestError`, `useWsClient()` all consumed from `@a-conversa/shell` as-is. See [`packages/shell/src/ws/client.ts:152-161`](../../../packages/shell/src/ws/client.ts#L152) for the `WsRequestError.code` shape this leaf branches on.).

## What this task is

The follow-up to `aud_session_url` + `aud_auth_for_private`: a per-session sign-in CTA that surfaces when an **anonymous visitor** hits a URL whose underlying session is invisible to them. After this leaf:

- `<AudienceLiveRoute>` no longer fires `void wsClient.trackSession(sessionId)` and discards the result. Instead, it captures the promise's rejection in component-local state. When the rejection is a `WsRequestError` with `code === 'not-found'` (see [`packages/shell/src/ws/client.ts:152-161`](../../../packages/shell/src/ws/client.ts#L152)) AND `auth.status` is one of the anonymous shapes (`'unauthenticated'` or `'needs-screen-name'`), the route renders a new contextual CTA panel **in addition to** the existing `<AudienceGraphView>` (the graph view continues to mount; the CTA renders as an overlay child of the route container — see Decision §1).
- The CTA is gated by **TWO** conditions, ANDed: (1) the subscribe was rejected with `not-found`, (2) the visitor is anonymous. Both must hold; either alone is **not sufficient**:
  - For an authenticated visitor receiving `not-found`, signing in would not help (they're already signed in; the rejection means the session doesn't exist or they're not on the visibility list). The CTA stays hidden; the graph viewport remains empty until a future task lands a distinct "you don't have access" affordance (out of scope — see Open questions §1).
  - For an anonymous visitor whose subscribe **succeeded** (public-session happy path), no CTA renders; the broadcast-clean aesthetic per `aud_auth_for_private.md` Decision §1 holds.
- Three new i18n keys land under a new `audience.privateSession.*` namespace: `audience.privateSession.title`, `audience.privateSession.body`, and (optional) `audience.privateSession.cta.note` for the small explanatory line under the `<LoginButton>`. All three locales (en-US, pt-BR, es-419) ship the keys at the same commit; pt-BR and es-419 land as `pending` entries in their review JSONs (catalog-parity rule per `apps/audience/CLAUDE.md`-equivalent in `packages/i18n-catalogs/`). See Decision §3.
- The CTA panel is wrapped in `data-testid="audience-private-session-cta"` — distinct from `audience-sign-in` (the placeholder-route's chrome) so the two affordances can be asserted independently. The panel contains the title, body, and a `<LoginButton>` consumed from `@a-conversa/shell` (no new login UI). The `<LoginButton>` uses the existing `auth.login.button` i18n key.
- Existing-language wording, intentionally careful re security: the CTA must **not** assert that the session is private (the server-side existence-non-leak rule would be violated). The wording phrases the situation conditionally — e.g. *"This session is not available to anonymous visitors. If you have an account that can view it, sign in to retry."* See Decision §2 for the wording rationale and the security audit.
- Four new Vitest cases append to `AudienceLiveRoute.test.tsx`:
  1. The CTA renders when `trackSession` rejects with `WsRequestError({ code: 'not-found' })` AND `auth.status === 'unauthenticated'`.
  2. The CTA does NOT render when `trackSession` rejects with `not-found` AND `auth.status === 'authenticated'`.
  3. The CTA does NOT render when `trackSession` resolves (happy path; public session; anonymous subscribe accepted).
  4. The CTA does NOT render when `trackSession` rejects with a non-`not-found` code (e.g. a transient `ws connection closed` Error or a `WsRequestTimeoutError`) — the rejection-aware branch is narrowly scoped to the existence-non-leak code, not all subscribe failures (Decision §4).
- One new Playwright scenario appends to `tests/e2e/audience-live-session.spec.ts` (the audience surface's existing live-session catch-all spec): an **anonymous visitor** navigates to a **private** session URL; the route mounts; `audience-graph-root` is visible (the graph viewport renders empty); `audience-private-session-cta` is visible; the inner `<a>` points at `/api/auth/login`. Real session creation: alice (authenticated) creates a session via `POST /api/sessions`; alice flips the session's privacy via the existing `PATCH /api/sessions/:id/privacy` endpoint so the session is private; then a fresh anonymous context navigates and the subscribe fails per ADR 0029.

Out of scope (deferred or owned elsewhere):

- **Authenticated-visitor "you don't have access" affordance.** When an authenticated visitor (signed in, valid session, populated `auth.user`) hits a private session whose visibility list excludes them, they also receive `not-found`. Signing in won't help. This is a distinct UX path — "you may be on the wrong account" or "ask the moderator to add you" — that belongs to a future leaf NOT yet registered in the WBS. See Open questions §1. **Not this leaf's scope** — anonymous visitors are the dominant audience-surface visitor profile (per ADR 0029 + the OBS-embed use case), and authenticated-but-no-access is an exceptional path; the WBS leaf for it lands when the use case surfaces from a real producer complaint.
- **Distinguishing private-session rejection from genuinely-nonexistent session.** Per the existence-non-leak rule, the wire returns the same `not-found` code for both. The CTA wording must hold for both interpretations — *"this session is not available to anonymous visitors"* is true whether the session is private (might be visible after sign-in) or nonexistent (sign-in won't help, but the visitor at least learns they should double-check the URL). See Decision §2.
- **Retry mechanics after sign-in.** When the visitor clicks the `<LoginButton>`, the OIDC handshake takes them through Authelia and back to `/a/sessions/:id`. The audience surface re-mounts with `auth.status === 'authenticated'`, the route runs `trackSession` again, the server re-evaluates `canSeeSession(...)` with the authenticated `userId`, and the subscribe either succeeds (visitor has access; graph populates from live events) or fails again (visitor signed in to an account that still can't see the session; the CTA stays hidden because the `auth.status` is no longer anonymous — empty graph viewport, per the bullet above). **No new retry button** — the OIDC redirect IS the retry mechanism; the route's natural mount-time subscribe runs after the re-mount.
- **Rate-limiting or backoff on the rejection path.** The `trackSession` call fires once per route mount; the route only re-mounts on navigation. There's no auto-retry loop, so no backoff needed.
- **Logout affordance inside the CTA.** Out of scope (mirrors `aud_auth_for_private.md` Decision §1 — broadcast-clean; logout lives in moderator / root chrome).
- **OBS-embed chrome suppression for the CTA.** An anonymous OBS browser source pointed at a private session URL is a misconfiguration; the producer either fixes the URL or signs the source's profile in. The CTA renders unconditionally — sibling task `aud_obs_chrome_suppression` (speculative; NOT registered in WBS) would land if a real producer surfaces a complaint.
- **A separate Playwright project for "audience-with-private-session-cta".** The existing `chromium-audience-skeleton` project carries the new scenario inline (the spec file `audience-live-session.spec.ts` is already in its `testMatch`).
- **Cucumber scenario for the wire-level rejection.** The server's `not-found` reply to anonymous-on-private subscribe is already pinned by [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) (via `aud_anonymous_ws_subscribe`'s three scenarios). This leaf adds zero new wire interaction; the audience-side branch is UI-only.
- **Server-side change.** No new endpoint, no new WS handler, no new error code. The leaf consumes the existing `not-found` envelope verbatim.
- **A new `useAuth()` consumption beyond the route's existing branch.** `<AudienceLiveRoute>` already imports `useAuth()` once (added by this leaf — it's NOT in the file today); the CTA's `auth.status` branch is THAT single consumer. The placeholder route's `<AnonymousChrome>` (added by `aud_auth_for_private`) consumes `useAuth()` independently — unchanged.

## Why it needs to be done

Today an anonymous visitor reaching `/a/sessions/<uuid>` of a **private** session sees the audience surface mount, the graph route render, the Cytoscape canvas mount empty, and the live event stream never arrive — because the server rejected the subscribe with `not-found` and the route swallowed the rejection (`void wsClient.trackSession(sessionId)` at [`apps/audience/src/routes/AudienceLiveRoute.tsx:42`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx#L42)). The visitor's only feedback is "the graph is empty"; they cannot tell whether:

- The session genuinely has no nodes yet (live debate hasn't started).
- The URL is wrong (typo in the UUID).
- The session is private and requires sign-in.
- Their browser blocked WebSocket upgrades.
- The server is down.

The producer's likely workflow is **share the URL via DM** to a panellist who's expected to view the broadcast. If the producer marked the session private (the default for in-progress private debates), the panellist's first audience-URL hit goes silent — no sign-in prompt, no error message, just an empty canvas. They contact the producer; the producer either re-flips the session public, or talks them through the sign-in flow manually. Both flows are friction the audience surface can absorb itself.

This leaf installs the smallest contextual affordance that closes the gap:

1. The visitor sees a clear "this session is not available; sign in to retry" message (worded to avoid the existence-non-leak per Decision §2).
2. The `<LoginButton>` is in front of them; one click starts the OIDC handshake.
3. After sign-in, the OIDC callback returns the visitor to `/a/sessions/<uuid>`; the surface re-mounts; the route fires `trackSession` again; **this time** with an authenticated cookie the server runs `canSeeSession(pool, sessionId, userId)` and (if the visitor is on the visibility list) accepts the subscribe; the graph populates from the live event stream.

The leaf is also the **first audience-side consumer of `WsRequestError` from `@a-conversa/shell`** — the audience has not branched on subscribe rejection until now. The participant's `OperateRoute` swallows rejections similarly (the participant only mounts the route after the moderator's session-mode flip auto-navigates them, so the subscribe is guaranteed-acceptable at mount-time). The audience is different — anonymous-on-private is a load-bearing case. Adding the audience-side rejection branch is the right place for it.

Architecturally, this leaf is a thin reactive coupling: the route's `trackSession` promise feeds into component state; the rendered CTA depends on `(promiseState, authStatus)`. No new abstraction, no new substrate, no new ADR. The pattern is "promise outcome → state setter → conditional render" — small and reviewable.

Downstream consumers of this leaf:

- **`aud_tests.aud_playwright_e2e`** (the audience's 2d catch-all Playwright leaf) inherits no new debt from this leaf — the new scenario lands inline in `audience-live-session.spec.ts` as part of the same spec the `aud_session_url` cumulative-debt scenarios live in.
- **Future authenticated-no-access leaf** (NOT yet in WBS — see Open questions §1) would land an *additional* branch alongside this leaf's anonymous one. The component shape this leaf establishes (capture promise rejection → branch on `auth.status` + rejection code) is the natural extension point.
- **Future OBS-embed chrome suppression** (speculative; NOT registered) would CSS-hide the CTA panel under a `?chrome=off` query param. The CTA's testid + DOM position make that suppression a one-line CSS change if it ever lands.

## Inputs / context

### ADRs

- [**ADR 0029 — anonymous WebSocket subscribe for public sessions**](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — the wire contract this leaf is downstream of. The `not-found` envelope returned for anonymous-on-private subscribes is the canonical signal the leaf branches on. The existence-non-leak rule (private + ended + nonexistent all collapse to `not-found`) is the constraint the CTA wording must honor — Decision §2.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — Decision 3 (root owns auth chrome; surface consumes `useAuth()` + `<LoginButton>` from the shell). The CTA's sign-in flow uses the shell's existing components verbatim; no audience-local OIDC handling.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical claim about CTA visibility lands as a committed Vitest case (4 new cases) + one Playwright scenario appended to the existing audience-live-session spec.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — the `<LoginButton>`'s full-page redirect to `/api/auth/login` is the OIDC handshake the visitor enters when clicking the CTA. After Authelia returns to the audience URL, the surface re-mounts and the natural mount-time subscribe runs — no audience-side "retry" code path needed.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — the `WsRequestError` narrow (`err instanceof WsRequestError && err.code === 'not-found'`) is exhaustively typed; an exhaustive `switch (auth.status)` continues to mirror the placeholder route's discipline.
- [ADR 0008 — E2E framework: Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — the new scenario lands in the existing `tests/e2e/audience-live-session.spec.ts`.

### Sibling refinements

- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — the predecessor + the explicit deferral source. **Open question §1** (lines 367) registered THIS leaf as the follow-up: *"Recommendation: register `audience.aud_url_routing.aud_private_session_sign_in_cta` (~0.5d) as a follow-up tech-debt leaf via the closer."* The closer registered it, the orchestrator picked it up, this refinement scopes it.
- [`tasks/refinements/audience/aud_auth_for_private.md`](aud_auth_for_private.md) — Decision §6 deferred per-session contextual messaging here (via `aud_session_url`); Decision §1 (broadcast-clean aesthetic — no identity chip for authenticated) is the constraint the CTA respects (no `<LoginButton>` for authenticated visitors); Decision §4 (`'needs-screen-name'` collapses into the unauthenticated branch) is the pattern this leaf mirrors. The placeholder route's `<AnonymousChrome>` (under `audience-sign-in`) renders on `/a` bare-root and other non-session URLs — distinct from this leaf's CTA which renders inside `<AudienceLiveRoute>`. The two affordances co-exist; each has its own testid.
- [`tasks/refinements/audience/aud_anonymous_ws_subscribe.md`](aud_anonymous_ws_subscribe.md) — the wire-level predecessor. Decision §3 (anonymous-on-private → `not-found`) is the server response this leaf's branch matches. Decision §9 (`allowAnonymous: true` on the audience's `<WsClientProvider>`) is already shipped; this leaf consumes the rejected promise that the existing provider produces.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — establishes the audience-side WS client + provider. Decision §6 (audience workspace barrel does NOT export `useWsClient`; consume from `@a-conversa/shell`) — this leaf preserves that constraint; `WsRequestError` is similarly consumed from `@a-conversa/shell` (`packages/shell/src/ws/index.ts:7` exports it).
- [`tasks/refinements/participant-ui/part_auth_flow.md`](../participant-ui/part_auth_flow.md) — the canonical "in-surface `useAuth()` + exhaustive switch" pattern this leaf's CTA gate mirrors. The participant's `participant-not-authenticated` panel is the closest precedent for "render a panel only on a specific auth + state combination"; the audience's CTA is smaller (no identity chip, no logout, no descriptive subhead beyond the title + body + button + optional note).

### Live code the leaf integrates with

- [`apps/audience/src/routes/AudienceLiveRoute.tsx:36-58`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx#L36) — the route component. **Modified.** The current `void wsClient.trackSession(sessionId)` becomes `wsClient.trackSession(sessionId).then(...).catch(...)` (or async/await with try/catch inside the effect); the catch branch sets a component-local `subscribeRejection` state to `'not-found'` (or `null` for other shapes). The route renders the new `<PrivateSessionCta>` element conditionally — see Decision §1 for the placement.
- [`apps/audience/src/routes/AudienceLiveRoute.test.tsx`](../../../apps/audience/src/routes/AudienceLiveRoute.test.tsx) — modified. Four new Vitest cases appended (see Acceptance criteria). The existing 5 cases stay intact (the happy paths don't reject; the assertions don't change shape).
- [`packages/shell/src/ws/client.ts:152-161`](../../../packages/shell/src/ws/client.ts#L152) — `WsRequestError` class. `err.code` carries the wire `code` (`'not-found'` for the existence-non-leak path). **NOT modified.**
- [`packages/shell/src/ws/index.ts:7`](../../../packages/shell/src/ws/index.ts#L7) — the public re-export of `WsRequestError`. **NOT modified.**
- [`packages/shell/src/login-logout/LoginButton.tsx`](../../../packages/shell/src/login-logout/LoginButton.tsx) — the shell's `<LoginButton>` (renders an `<a href="/api/auth/login" role="button">` resolving its label from `auth.login.button`). **NOT modified.** This leaf consumes it as-is with a `className` override for the audience's broadcast-clean styling.
- [`packages/shell/src/auth/useAuth.ts`](../../../packages/shell/src/auth/useAuth.ts) — the `useAuth()` hook. **NOT modified.**
- [`packages/shell/src/auth/types.ts:23-61`](../../../packages/shell/src/auth/types.ts#L23) — the `AuthStatus` discriminator. **NOT modified.** The new `switch (status)` inside the CTA's gate mirrors `<PlaceholderRoute>`'s shape.
- [`apps/server/src/ws/handlers/subscribe.ts:95-123`](../../../apps/server/src/ws/handlers/subscribe.ts#L95) — the wire-level rejection source. **NOT modified.** The `not-found` envelope this leaf branches on is the same envelope `aud_anonymous_ws_subscribe`'s Cucumber scenarios pin.
- [`apps/server/src/sessions/visibility.ts:217-226`](../../../apps/server/src/sessions/visibility.ts#L217) — `canSeeSessionAnonymously` (public AND not-ended). **NOT modified.** This leaf is downstream of this predicate; the predicate's return value drives the rejection path.
- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — modified. ONE new scenario appended (see Acceptance criteria scenario 7).
- [`packages/i18n-catalogs/src/catalogs/en-US.json:733-738`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L733) — the existing `audience` namespace. **Modified** — adds `audience.privateSession.{title, body, cta?}` keys.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) + [`es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json) — modified. Same keys; translated via the catalog-author's pattern. The matching `.review.json` files gain `pending` entries (catalog-parity rule).
- `tests/e2e/audience-skeleton-smoke.spec.ts` — **NOT touched.** The skeleton spec asserts the placeholder route at `/a/placeholder-fallback/<uuid>`; this leaf does not edit the placeholder branch.

### What the surface MUST NOT do (in this leaf's diff)

- **No new fetch.** The CTA's "what's the session id" data is `useParams<{ sessionId: string }>()` — already in scope inside the route. No `fetch('/api/sessions/...')` call to check privacy; the wire `not-found` reply is the source of truth.
- **No re-implementation of OIDC handshake.** The `<LoginButton>` from `@a-conversa/shell` is the sole transport.
- **No new WS message type or server endpoint.** The wire is unchanged.
- **No `untrackSession` on cleanup** of the rejected-subscribe path. `trackSession`'s internal state-tracking is idempotent; the route's natural unmount-on-navigation handles cleanup.
- **No `<Navigate>` to `/login`.** The CTA renders inline; the visitor decides whether to sign in or close the tab. Mirrors `aud_auth_for_private.md`'s "no deflect" stance.
- **No reveal of "this session is private"** (existence-non-leak per ADR 0029). The wording is conditional — "if you have an account that can view it" — see Decision §2.
- **No retry button** beyond the `<LoginButton>`. The OIDC round-trip IS the retry; the natural mount-time subscribe runs after re-mount.
- **No CTA for authenticated visitors.** Decision §6.
- **No CTA for `loading` auth state.** While the auth status is still resolving, the CTA stays hidden — flicker risk. Decision §6.
- **No reads of `auth.user.userId`** inside the CTA branch. The decision is `status`-only — `userId` is irrelevant for "should we offer sign-in."
- **No mutation of `auth` state.** The CTA only reads `auth.status`; clicking the `<LoginButton>` triggers a full-page redirect (the only auth-state mutation is via the OIDC callback, after which the surface re-mounts).
- **No mutation of WS state.** The CTA observes the promise rejection from `trackSession`; it does not call `wsClient.untrackSession(...)` or re-fire `trackSession`. The subscribe-failure state is local to the component instance.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`apps/audience/src/routes/AudienceLiveRoute.tsx`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx) — modified. The `useEffect` that fires `trackSession` becomes:

  ```tsx
  const [subscribeRejection, setSubscribeRejection] = useState<'not-found' | null>(null);

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return;
    let cancelled = false;
    setSubscribeRejection(null);
    wsClient
      .trackSession(sessionId)
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof WsRequestError && err.code === 'not-found') {
          setSubscribeRejection('not-found');
        }
        // Other rejection shapes (transport drop, timeout) are
        // intentionally NOT surfaced via the CTA — they are not
        // sign-in-recoverable. See Decision §4.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, wsClient]);
  ```

  And the route returns:

  ```tsx
  return (
    <div className="h-screen w-screen relative">
      <AudienceGraphView />
      {subscribeRejection === 'not-found' && <PrivateSessionCta />}
    </div>
  );
  ```

  Approximately +35/-2 LOC.

- `apps/audience/src/routes/PrivateSessionCta.tsx` — NEW. Approximately 50 LOC. Reads `useAuth()`, branches `switch (status)` exhaustively (`'unauthenticated'` and `'needs-screen-name'` render the panel; `'authenticated'` and `'loading'` render `null`); renders an overlay div under `data-testid="audience-private-session-cta"` with the title (`t('audience.privateSession.title')`), body (`t('audience.privateSession.body')`), and a `<LoginButton>` (consumed from `@a-conversa/shell`). See Decision §1 for the layout container's CSS shape.

- [`apps/audience/src/routes/AudienceLiveRoute.test.tsx`](../../../apps/audience/src/routes/AudienceLiveRoute.test.tsx) — modified. Four new Vitest cases appended. Approximately +120 LOC.

- `apps/audience/src/routes/PrivateSessionCta.test.tsx` — NEW (OPTIONAL — if the Implementer prefers an isolated test layer over piggybacking on `AudienceLiveRoute.test.tsx`). Two Vitest cases: (a) renders the panel for `'unauthenticated'` + `'needs-screen-name'`; (b) renders `null` for `'authenticated'` + `'loading'`. Decision §5 — the Implementer picks; the 4 cases in `AudienceLiveRoute.test.tsx` cover the routing path end-to-end either way.

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — modified. Three new keys under `audience.privateSession`:
  - `title` (e.g. "Session unavailable")
  - `body` (e.g. "This session is not available to anonymous visitors. If you have an account that can view it, sign in to retry.")
  - `cta.note` (OPTIONAL — small explanatory line under the button; see Decision §2). The Implementer may collapse the body + note into a single `body` string; the i18n shape stays open until the wording is settled at implementation time.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) — modified. Same keys; Portuguese translations.
- [`packages/i18n-catalogs/src/catalogs/es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json) — modified. Same keys; Spanish translations.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) — modified. New `pending` entries for the three keys (catalog-parity rule).
- [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — modified. Same.

- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — modified. ONE new scenario appended (see Acceptance criteria scenario 7). Approximately +60 LOC.

### Files this task does NOT touch

- `apps/audience/src/App.tsx` — unchanged. The placeholder route's `<AnonymousChrome>` (under `audience-sign-in`) is untouched; the CTA is a route-internal affordance.
- `apps/audience/src/main.tsx` — unchanged. The `<WsClientProvider allowAnonymous>` mount + the `window.__aConversaWsStore` assignment + the `<AuthValueProvider>` wrap are all in place.
- `apps/audience/src/graph/*` — unchanged. The graph view continues to mount; the CTA overlays it.
- `apps/audience/src/state/*` — unchanged. The state layer reads the URL-driven session id; the CTA reads `auth.status` directly.
- `apps/audience/src/ws/*` — unchanged.
- `packages/shell/*` — unchanged. The shell exports `<LoginButton>`, `useAuth()`, `WsRequestError`, `useWsClient()` — all consumed as-is.
- `apps/server/*` — unchanged. The wire contract is preserved.
- `apps/root/*` — unchanged. The host's surface mount + auth provisioning is preserved.
- `apps/moderator/*`, `apps/participant/*`, `apps/replay-test/*` — none touched.
- `playwright.config.ts` — unchanged. The new scenario lands in an existing file whose `testMatch` already includes it.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — unchanged.
- `apps/audience/src/mount.test.tsx` — unchanged. The new Vitest cases live in `AudienceLiveRoute.test.tsx` (and optionally `PrivateSessionCta.test.tsx`).
- `docs/adr/` — no new ADR; every decision below applies an existing ADR (0029 / 0026 / 0022 / 0002 / 0013) or matches an established pattern. See Decision §8.
- `.tji` files — `complete 100` on this task at task-completion time per the README ritual.

### Vitest cases in `AudienceLiveRoute.test.tsx` (append-only)

The existing 5 cases (render, trackSession-on-mount, trackSession-on-navigate, malformed-uuid, locale-prefix parametrization) keep their shape. Four new cases append:

1. **`renders the private-session CTA when trackSession rejects with not-found and the visitor is anonymous`** — mounts the route with `auth = { status: 'unauthenticated', user: undefined, ... }` and a `useWsClient` mock whose `trackSession` returns `Promise.reject(new WsRequestError({ code: 'not-found', message: 'session not found' }))`. Asserts: `audience-graph-root` visible, `audience-private-session-cta` visible, the panel contains an `<a>` whose `href` is `/api/auth/login`.

2. **`does NOT render the CTA when trackSession rejects with not-found but the visitor is authenticated`** — same `trackSession` mock; `auth = { status: 'authenticated', user: { userId: 'alice', screenName: 'Alice' }, ... }`. Asserts: `audience-graph-root` visible, `audience-private-session-cta` is NOT in the DOM (queryByTestId returns null).

3. **`does NOT render the CTA when trackSession resolves successfully`** — `trackSession` returns `Promise.resolve()`; `auth = { status: 'unauthenticated', ... }`. Asserts: `audience-graph-root` visible, `audience-private-session-cta` is NOT in the DOM. Pins the happy-path public-session anonymous-visitor case.

4. **`does NOT render the CTA when trackSession rejects with a non-not-found code`** — `trackSession` returns `Promise.reject(new WsRequestError({ code: 'invalid', message: '...' }))` (or a `WsRequestTimeoutError`, or a generic `Error`). `auth = { status: 'unauthenticated', ... }`. Asserts: `audience-graph-root` visible, `audience-private-session-cta` is NOT in the DOM. Pins Decision §4 — the CTA gate is narrowly scoped to `not-found`.

Optional fifth case if `PrivateSessionCta.test.tsx` is NOT split out: `renders the CTA for status='needs-screen-name'` — `auth = { status: 'needs-screen-name', user: undefined, ... }` + the not-found rejection; asserts the panel renders. Pins Decision §6's collapse of `'needs-screen-name'` into the anonymous branch.

### Playwright scenario in `audience-live-session.spec.ts` (append-only, scenario 7)

**`anonymous visitor on a private session URL sees the per-session sign-in CTA`**:

- alice (authenticated) creates a public session via `POST /api/sessions`.
- alice flips the session to private via `PATCH /api/sessions/:id/privacy` (existing endpoint; see the moderator's privacy-toggle wire path).
- A fresh anonymous Playwright context (`storageState: { cookies: [], origins: [] }`) navigates to `/a/sessions/<sessionId>`.
- `audience-graph-root` testid is visible (the route mounts; the canvas is empty).
- `audience-private-session-cta` testid is visible within 5s.
- The CTA contains an `<a>` element whose `href` is `/api/auth/login`.
- The URL did NOT redirect (`new URL(page.url()).pathname === '/a/sessions/<sessionId>'`); the audience surface mounted and offered the affordance in-place.

**Negative-control assertions piggyback on existing scenarios** — scenario 1 (authenticated event delivery, public session) already implies the CTA is absent for public + authenticated; scenario 3 (anonymous WS delivery, public session) already implies absent for public + anonymous. To keep the inherited-debt count low, the new scenario carries the positive assertion only; the existing scenarios continue to assert the graph-visible happy path which transitively rules out the CTA. If the Implementer prefers explicit negative pins, ONE assertion appended to scenarios 3 and 1 (`expect(page.getByTestId('audience-private-session-cta')).toHaveCount(0)`) is acceptable.

Per the test-output handling rule, the Playwright run is redirected to a log file and inspected via an Explore sub-agent.

### Cucumber surface

**No Cucumber scenario in this leaf.** The wire-level rejection is already pinned at the server tier by `aud_anonymous_ws_subscribe`'s scenarios in [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature). This leaf is a UI-only branch; no new wire, no new broadcast shape, no new projector output.

### UI-stream e2e policy disposition

**E2e is in scope; the existing `audience-live-session.spec.ts` carries the new scenario inline.** Per ORCHESTRATOR.md's UI-stream e2e policy, the audience surface is reachable + the CTA is a user-observable behaviour; a Playwright pin is required. The deferred-e2e exception does NOT apply (the CTA renders directly inside the already-reachable route; no future "wiring" leaf needs to make it reachable). No new spec file, no new Playwright project.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Two tiers pinning different observable properties:

1. **Vitest cases** — pin the rejection-handling branch in `<AudienceLiveRoute>` in isolation: the promise-rejection capture, the `not-found` filter, the `auth.status` gate, the CTA's `<LoginButton>` shape. Catches regressions like "someone changed the `WsRequestError.code` check and the CTA stopped rendering" without needing a full Playwright run.
2. **Playwright scenario** — pins the end-to-end flow: a real session, a real privacy flip, a real anonymous WS subscribe rejection, the CTA rendered with the real i18n catalogs loaded.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** stays green. The `WsRequestError` instanceof narrow, the exhaustive `switch (auth.status)` inside `<PrivateSessionCta>`, the new state hook, and the new Playwright scenario all typecheck under strict mode.

2. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+4** (the four new Vitest cases in `AudienceLiveRoute.test.tsx`). If the Implementer splits `PrivateSessionCta.test.tsx` out, +2 more cases.

3. **`pnpm run test:e2e`** (under `make up`) runs the augmented `tests/e2e/audience-live-session.spec.ts` with all seven scenarios green (six pre-existing + the new scenario 7 above).

4. **`pnpm -F @a-conversa/audience build`** green; the new component + the `WsRequestError` import tree-shake correctly.

5. **`pnpm -F @aconversa/root build`** + **`pnpm -F @a-conversa/moderator build`** + **`pnpm -F @a-conversa/participant build`** all green. The audience-side change does not break peer surfaces.

6. **Failing-first verifiability** — temporarily reverting the `setSubscribeRejection('not-found')` call inside the `.catch` MUST make scenario 7 fail (the CTA never renders). Independently, temporarily forcing the CTA to render unconditionally MUST make Vitest case 2 (authenticated branch) fail. The Implementer confirms both reversions in their verification log before re-applying. Pins ADR 0022's regression-pin property at two distinct loci.

7. **No file modifications outside the explicit allowlist** in "Files this task touches."

8. **No regression of the existing audience-live-session scenarios** — scenarios 1–6 continue to pass; the new state machinery is additive and does not perturb the happy-path event-delivery, projection, anonymous-delivery, canvas-mount, no-input, or dimension assertions.

9. **No regression of the placeholder route's `audience-sign-in` chrome** — the chrome inside `<AnonymousChrome>` (placeholder route) continues to render on `/a` bare-root and `/a/placeholder-fallback/<uuid>` per `audience-skeleton-smoke.spec.ts`; this leaf does not touch that surface.

10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands. The pre-commit hook is the safety net.

11. **Catalog parity** — the three new `audience.privateSession.*` keys land in all three locales (en-US, pt-BR, es-419); pt-BR.review.json and es-419.review.json gain three `pending` entries each.

12. **No new ADR is committed** by this leaf (Decision §8). The pre-commit hook's `docs/adr/` check stays green without a new entry.

## Decisions

### §1 — CTA renders as an overlay child of the route container, NOT a replacement of `<AudienceGraphView>`

Three alternatives surveyed:

- **(A — chosen)** The CTA renders as a sibling-overlay of `<AudienceGraphView>` inside the route's `<div className="h-screen w-screen relative">`. The CTA itself is `position: absolute inset-0` (or `flex items-center justify-center`) with a small centered card. The graph view continues to mount underneath — empty canvas, since no events arrived — but the route's DOM is unchanged in shape (graph-root + new CTA), preserving the existing `audience-graph-root`-presence assertions in scenarios 1–6.
- **(B)** Replace `<AudienceGraphView>` with the CTA panel when `subscribeRejection === 'not-found' && anonymous`. Rejected — would require the existing scenarios to branch their assertions ("is graph-root present?") on the auth/subscribe state, and would make the OBS-embed behaviour (where a private session URL might get briefly hit before correction) more jarring (the graph viewport disappears entirely instead of just hosting the CTA on top of an empty canvas).
- **(C)** Render the CTA outside the route, inside the surface's chrome (e.g. up at `<App>` level). Rejected — the rejection is route-scoped (the subscribe is to *this* session); surfacing the affordance at the surface level decouples it from the route's lifecycle and complicates the "navigate to a different session" cleanup.

Decision: (A). The graph viewport remains visible (empty) under the CTA; the CTA is the front-and-center signal. The `relative` positioning on the wrapper is a one-token CSS change.

### §2 — CTA wording is conditional, honoring the existence-non-leak rule

Per ADR 0029, the server's `not-found` envelope is intentionally ambiguous — it returns for genuinely-nonexistent sessions, ended sessions, AND private sessions (when anonymous). The CTA wording MUST honor that ambiguity. Three wording shapes surveyed:

- **(A) "This is a private session. Sign in to view."** — Rejected. Directly asserts the session is private; leaks existence to an anonymous probe.
- **(B) "This session was not found. If you believe it should be available to you, sign in."** — Rejected (weaker but still leaks). The "if you believe it should be available to you" phrasing is suspiciously specific — for a genuinely nonexistent URL, this wording wouldn't apply, so its presence signals to a sophisticated visitor that the session likely exists.
- **(C — chosen) "Session unavailable. This session is not available to anonymous visitors. If you have an account that can view it, sign in to retry."** — Holds for both interpretations:
  - **Private session case**: the visitor signs in, gets re-evaluated against `canSeeSession(...)`, possibly gets in.
  - **Nonexistent / ended session case**: the visitor signs in, the subscribe re-fires, the server still returns `not-found` — but the visitor is now authenticated and the CTA (which gates on `auth.status` anonymous) stops rendering. They see an empty graph viewport with no CTA — a defensible "this might be the wrong URL" state. Per Open questions §1, a dedicated authenticated-no-access affordance is a future leaf; until then, the empty viewport is the fallback.

The wording also covers the OBS-embed case (anonymous browser source hits a session that flipped private mid-broadcast): the CTA renders briefly, the producer notices, the producer fixes the URL or the privacy flag. This is a misconfiguration the CTA surfaces; no security tradeoff because the OBS source is anonymous-by-construction.

**Security audit summary**: a network observer (or a sophisticated visitor reading the rendered HTML) cannot distinguish private-session-with-access vs nonexistent-URL from this leaf's UI — both render the same CTA on the same wire `not-found`. The existence-non-leak rule is preserved.

### §3 — Three new i18n keys under `audience.privateSession.*`

The placeholder route's `<AnonymousChrome>` (under `audience-sign-in`, added by `aud_auth_for_private`) used **zero** new i18n keys — it reused `auth.login.button` only. **This leaf is different**: the CTA needs actual contextual wording (the title + body in Decision §2's option C), which doesn't exist elsewhere in the catalog. Three alternatives surveyed:

- **(A — chosen)** Add three new keys under a new `audience.privateSession.*` namespace. Catalog-parity rule applies (en-US ships the canonical strings; pt-BR + es-419 ship translations or fall back to en-US until reviewed; `.review.json` files in both translated locales gain `pending` entries). Smallest viable surface — title + body cover the message; `cta.note` is OPTIONAL (the Implementer can collapse into the body string if the layout reads cleanly without a separate line).
- **(B)** Reuse `audience.placeholder.title` / `audience.placeholder.body` from the existing namespace. Rejected — those keys today resolve to "Audience surface" / "Loading…", which are placeholders. Mixing the contextual private-session wording into the placeholder namespace muddies the catalog (a translator updating the placeholder for OBS-aesthetic reasons would inadvertently change the private-session CTA).
- **(C)** Render hard-coded English strings (no i18n at all). Rejected — the audience surface is locale-prefixed (`/{locale}/sessions/...`); a non-English-speaking visitor of a private session would see English in an otherwise-localized UI. Catalog discipline matters.

Decision: (A). The three keys are minimal; pt-BR and es-419 translations land at the same commit; the review files capture the pending-review status.

### §4 — CTA gate is narrowly scoped to `code === 'not-found'`, NOT all subscribe failures

The `trackSession` promise can reject with multiple shapes:

- `WsRequestError({ code: 'not-found', ... })` — the existence-non-leak case this leaf addresses.
- `WsRequestError({ code: 'invalid', ... })` — protocol-level validation failure (shouldn't happen in practice; the client constructs valid envelopes).
- `WsRequestTimeoutError` — the subscribe ack didn't return within `defaultTimeoutMs`.
- Generic `Error('ws connection closed')` — the socket dropped while waiting.

Should the CTA render for all of these? **No**, scoped to `not-found` only:

- **Sign-in doesn't help transport-level failures.** Even after sign-in, a dropped socket stays dropped; the CTA's `<LoginButton>` is the wrong affordance.
- **Transport-level failures are recoverable via reconnect/resume** — the WS client already handles auto-reconnect + subscription resume (see `client.ts:374-389`); the route's `useEffect` does not need to surface a transient drop.
- **Conflating transport with auth state confuses the visitor** — they'd click "Sign in" expecting it to fix the empty graph, then nothing changes (because the underlying issue is connectivity).

**Alternative**: render a CTA for ALL rejection shapes with branching wording (sign-in CTA for `not-found`; "connection lost; retrying" banner for transport failures). Rejected — adds an additional UX surface this leaf is not scoped for. A dedicated `aud_ws_disconnect_banner` (speculative; NOT registered in WBS) is the right home if transport-failure messaging ever becomes a real need.

The Vitest case 4 (the non-not-found code rejection) pins this narrow scoping.

### §5 — Inline `<PrivateSessionCta>` component, optionally split into its own file

Two alternatives surveyed:

- **(A — chosen)** New file `apps/audience/src/routes/PrivateSessionCta.tsx` exports the component; `<AudienceLiveRoute>` imports it. Cleaner separation; the Vitest tests can target the CTA in isolation if the Implementer prefers (Decision §5's optional `PrivateSessionCta.test.tsx`).
- **(B)** Inline the CTA inside `AudienceLiveRoute.tsx` (no new file). Marginally less ceremony; less obvious as a unit.

Decision: (A). The CTA's `useAuth()` consumption + exhaustive switch is non-trivial enough to deserve its own file; the test affordance is a bonus.

### §6 — `'needs-screen-name'` collapses into the anonymous branch; `'authenticated'` and `'loading'` render `null`

Mirrors `aud_auth_for_private.md` Decision §4. The four `AuthStatus` values map:

- `'unauthenticated'` → render CTA panel.
- `'needs-screen-name'` → render CTA panel (the OIDC re-handshake via `<LoginButton>` lands at `/screen-name` if the user is still in that state, completing the flow indirectly through existing seams).
- `'authenticated'` (with populated user) → render `null` (out of scope per "What this task is" — authenticated-no-access is a separate future leaf).
- `'authenticated'` with `user === undefined` (mid-mount flip race) → render `null`. Rationale: the race is transient (resolves within a paint); rendering the CTA for it could flicker. The participant's `part_auth_flow` Decision §A treats this race as a transient state; the audience CTA respects that pattern.
- `'loading'` → render `null`. Auth status is still resolving; the visitor will see the CTA (or not) within a tick — flicker risk if rendered.

The `switch (auth.status)` is exhaustive; a future addition to the `AuthStatus` union triggers a compile error here per ADR 0013.

**Alternative**: also render the CTA for `'loading'` (so the visitor sees *something* during a slow auth round-trip). Rejected — the auth round-trip is typically sub-100ms; the brief flicker of "showing CTA then hiding it" is worse than the brief empty-graph state.

**Alternative**: split `'authenticated' && user === undefined` into its own "you may be mid-signout; sign in again" affordance. Rejected — the participant's panel for this case is a defensive guard, not a primary affordance; the audience's broadcast-clean aesthetic argues against surfacing it.

### §7 — Subscribe-rejection state lives in the route component, NOT the WS store

The audience workspace's `audienceWsStore` (Zustand) tracks subscriptions, events, connection status. It does NOT today track per-subscription rejection reasons. Two alternatives surveyed:

- **(A — chosen)** Component-local `useState<'not-found' | null>` inside `<AudienceLiveRoute>`. The state lives for the route's lifetime; navigation away from the route resets it (via the cleanup function + the next mount's `setSubscribeRejection(null)`). No store change.
- **(B)** Extend `audienceWsStore` with a `sessionRejections: Record<string, 'not-found' | ...>` map. Rejected — the rejection is consumed by exactly one component (this route); store-scoping it is YAGNI. The store's read-only-by-construction posture (per `aud_ws_client.md`) also argues against — adding mutable rejection-reason state widens the store's writable surface for no benefit.

Decision: (A). Component-local is the right scope; the rejection is route-bound and the cleanup is automatic.

### §8 — No new ADR

This task introduces no architectural choices beyond existing precedents:

- The `WsRequestError`-narrow + `useAuth()` consumption pattern is direct application of ADR 0029 (the wire) + ADR 0026 (the auth context).
- The `<LoginButton>` reuse is direct application of ADR 0026 Consequences §1 (shell single-sources auth chrome) + ADR 0002 (OIDC cookie auth).
- The exhaustive `switch (auth.status)` is direct application of ADR 0013 (TypeScript strict).
- The Vitest + Playwright pin pair is direct application of ADR 0022.
- The wording-conditional-on-existence-non-leak is direct application of ADR 0029.

No new dependency, no new abstraction, no new wire format. ADR not triggered.

### §9 — No deferred-e2e debt; the new scenario lives inline in `audience-live-session.spec.ts`

Per ORCHESTRATOR.md's e2e policy, the CTA is reachable + the leaf adds user-observable behaviour. The new Playwright scenario lands in the existing audience-live-session catch-all spec (the same spec that paid down the four-leaf cumulative debt from `aud_session_url`); no further deferral to `aud_pw_*` or `aud_tests.aud_playwright_e2e`.

The inherited-debt count on `aud_tests.aud_playwright_e2e` (the 2d audience-Playwright catch-all) stays at zero from this leaf. The 2d task's scope remains breadth-coverage of the audience URL grammar (multi-locale sweeps, replay-mode variations once `aud_url_position_param` lands), not graph-rejection coverage.

### §10 — Tech-debt registration

- **No new WBS leaf registered.** The authenticated-no-access affordance (Open questions §1) is genuinely speculative — the use case has not surfaced from a real producer complaint; registering a 0.5d follow-up now would queue planning debt against a hypothetical need. The Decision §6 stance ("`'authenticated'` renders `null`") is stable until that real need surfaces.
- **No deferred-e2e debt.** This leaf's Playwright scenario IS the e2e pin; no `aud_pw_*` catch-all inherits coverage.
- **No deferred i18n debt.** The three new keys land in all three locales at the same commit; the `.review.json` `pending` entries are the standard catalog-parity mechanism (NOT debt — they're the documented review workflow).

## Open questions

1. **Authenticated-visitor "you don't have access" affordance.** When an authenticated visitor receives `not-found` (genuinely-nonexistent session OR visible-list-excluded private session), the CTA renders `null` per Decision §6. They see an empty graph viewport with no message. A dedicated affordance ("you may be on the wrong account; ask the moderator to add you") is a separate UX concern. **Not blocking this leaf.** Recommendation: defer to a future WBS leaf when a real producer complaint surfaces; until then, the empty-viewport fallback is the documented behaviour. The future leaf, if it lands, would slot into the same `<AudienceLiveRoute>` component's render shape (the `subscribeRejection` state + the `auth.status` switch are the natural extension points).

(All other open questions resolved by the Decisions above.)

## Status

**Done** — 2026-05-27.

- Captured `trackSession` rejection via both `.catch` (already-open socket path) and `wsClient.onEnvelope` (deferred resume path post-hello); `'not-found'` code sets `subscribeRejection` state in `apps/audience/src/routes/AudienceLiveRoute.tsx`.
- New `apps/audience/src/routes/PrivateSessionCta.tsx`: `useAuth()` + exhaustive `switch (status)`; renders overlay panel with title, body, and `<LoginButton>` for anonymous auth states; returns `null` for `'authenticated'` and `'loading'`.
- Route wrapper gains `relative` CSS class; `<PrivateSessionCta>` overlays `<AudienceGraphView>` when `subscribeRejection === 'not-found'`.
- `apps/audience/src/routes/AudienceLiveRoute.test.tsx`: 4 new Vitest cases (f) anonymous+not-found→CTA; (g) authenticated+not-found→no CTA; (h) resolved→no CTA; (i) non-not-found rejections→no CTA. Fake test client gained `onEnvelope` stub for the deferred subscribe path.
- `tests/e2e/audience-live-session.spec.ts`: scenario 7 — anonymous visitor on private session URL renders CTA with `/api/auth/login` href.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`: added `audience.privateSession.{title,body}` keys in all three locales.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`, `es-419.review.json`: 2 `pending` entries each (catalog-parity rule).
