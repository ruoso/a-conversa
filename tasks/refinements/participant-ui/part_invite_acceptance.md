# Accept moderator's invite

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_session_join.part_invite_acceptance`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_shell` (settled — every leaf under the `part_shell` group is `complete 100`: `part_app_skeleton` ships the library-mode bundle and the `/p/*` dispatch; `part_state_management` ships the participant's `useWsStore` singleton + the three local-UI slices; `part_ws_client` ships the surface-wide `<WsClientProvider>` + the source-hook swap that makes the chip reflect real WS state; `part_auth_flow` ships the `useAuth()` consumption + the identity row + the defensive `participant-not-authenticated` guard; `part_landscape_layout` ships `<ParticipantLayout>` with its four named-region testids and three render-prop slots; `part_status_indicator` ships the connection-state chip in the footer slot. See [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx), [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx), and the six sibling refinements under [`tasks/refinements/participant-ui/`](.)).
- `backend.session_management` (settled — the inherited group-level edge from the `part_session_join` parent. Every session-management endpoint this flow touches is shipped: `POST /api/sessions/:id/invite/claim` (the predecessor named below), `GET /api/sessions/:id` (visibility-gated session header read for the pre-claim "you'll join …" hint, used optionally — see Decision §6), `auth_middleware` (the session-cookie auth the claim POST inherits via Fastify's `preHandler: app.authenticate`)).
- Prose-only context (NOT a `.tji` edge): `backend.session_management.session_invite_self_claim_endpoint` (settled, commit `f07d456` — the canonical predecessor this leaf consumes. `POST /api/sessions/:id/invite/claim` body is `{ role: 'debater-A' | 'debater-B' }`, response is the `SessionParticipantResponse` (`{ id, sessionId, userId, role, joinedAt, leftAt }`), and the typed error envelopes are `auth-required` (401), `validation-failed` (400), `not-found` (404), `session-already-ended` (409), `not-a-moderator` (403), `role-already-filled` (409), `user-already-joined` (409). See [`apps/server/src/sessions/routes.ts:2651-2906`](../../../apps/server/src/sessions/routes.ts#L2651) and the refinement at [`tasks/refinements/backend/session_invite_self_claim_endpoint.md`](../backend/session_invite_self_claim_endpoint.md)).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_shell.part_ws_client` (settled — its Status block at [`tasks/refinements/participant-ui/part_ws_client.md#L412`](part_ws_client.md#L412) explicitly names THIS task as the inheritor of the `client.trackSession(sessionId)` lifecycle wiring. The participant surface has one wildcard route today and no `:id` param to pull from `useParams()`; subscription is a per-route lifecycle concern that lands here in the claim route — the first participant route that knows its `sessionId`. Mirrors the moderator's `OperateRoute` / `InviteParticipantsRoute` pattern at [`apps/moderator/src/routes/Operate.tsx:141-147`](../../../apps/moderator/src/routes/Operate.tsx#L141) and [`apps/moderator/src/routes/InviteParticipants.tsx:189-195`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L189)).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_session_setup.mod_invite_participants` (settled — the upstream that emits the invite URLs this leaf consumes. Per [`apps/moderator/src/routes/InviteParticipants.tsx:313-316`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L313) the URL shape is `${origin}/p/sessions/${sessionId}/invite?role=${role}` where `role ∈ {'debater-A', 'debater-B'}`. The moderator's lobby view already subscribes to the per-session `participant-joined` WS broadcast through `client.trackSession(sessionId)`, so the claim this leaf POSTs lights up the moderator's slot in real time without any moderator-side change).

## What this task is

The first **real route** in the participant surface — the one that turns "the debater clicked the moderator's invite URL" into "the debater is a `session_participants` row and a `participant-joined` event in the session log." After this leaf:

- The participant `<App>` route tree grows a `<Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />` entry registered **above** the existing wildcard (which remains as the placeholder fallback). The route is mounted under the surface's `/p` basename, so the moderator-emitted URL `/p/sessions/<uuid>/invite?role=debater-A` lands on it.
- The `<InviteAcceptanceRoute>` component reads the path's `:id` via `useParams()`, the role hint from the URL's `?role=` via `useSearchParams()`, the host-supplied auth via `useAuth()` (for the pre-claim "you'll join as <screenName>" line + the post-success navigation decision), and the shell's `useWsClient()` for the inherited `client.trackSession(sessionId)` lifecycle.
- The route's main interactive surface is a single primary button — "Join this debate as <role>" — that POSTs the body `{ role }` against `/api/sessions/${id}/invite/claim` using the same-origin session cookie. The button is disabled while the request is in flight and re-enabled on a typed error (which lets the user retry only when retry makes sense; see Decision §3 for the per-code error-mapping).
- On a 200 the route navigates to `/sessions/${id}/lobby` (the route owned by the next sibling leaf, `part_session_join.part_lobby_view`). Because `part_lobby_view` has not landed yet, this leaf also lands a **placeholder lobby route** under the same `<App>` so the navigation has a destination — see Decision §1 for the placeholder-vs-inline-confirmation choice and the explicit "remove me when part_lobby_view lands" testid the placeholder carries.
- The `client.trackSession(sessionId)` lifecycle is wired the same way the moderator already wires it: a `useEffect` with `[client, sessionId]` deps calls `void client.trackSession(sessionId)` on mount and `void client.untrackSession(sessionId)` on cleanup. This closes the inherited debt named in `part_ws_client`'s Status block — the participant's WS subscription now follows the session the route is bound to, so the broadcasts the moderator emits (`participant-joined` from the host-only POST, `session-ended`, etc.) reach the participant's store and are queryable through the existing `useWsStore` selectors.
- All five typed error codes the predecessor endpoint defines surface as localized error panels with discriminating testids: `not-found`, `session-already-ended`, `not-a-moderator` ("you are the session's host; you cannot also be a debater"), `role-already-filled` ("this slot was just taken"), `user-already-joined` ("you are already in this session"). The two retryable shapes (`role-already-filled` + transient network failure) keep the button visible; the four terminal shapes (`not-found`, `session-already-ended`, `not-a-moderator`, `user-already-joined`) replace the button with a return-home or contact-the-moderator affordance. See Decision §3.
- All new user-facing strings land in en-US, pt-BR (PENDING), es-419 (PENDING) under the new `participant.inviteAcceptance.*` namespace, with the two pt-BR + es-419 review.json `pending` lists updated and a native-review follow-up registered (per the participant-ui convention `part_app_skeleton` / `part_auth_flow` / `part_landscape_layout` / `part_status_indicator` all established).
- Tests pin: Vitest at the component level (8 cases covering the role-hint read, the auth-derived hint, the success-navigation, all five error branches, and the `trackSession`/`untrackSession` mount/unmount lifecycle); Playwright at the e2e level under `chromium-participant-skeleton` — one scenario covering the happy path against the live compose stack (alice creates a private session as moderator → ben follows the invite URL → 200 → lobby placeholder renders) and one scenario covering the `not-found` 404 path against a fabricated session id. Decision §7 documents what's deferred from this leaf (the unauth → OAuth → return-to round-trip e2e and the multi-debater real-time-slot-fill cross-surface scenario).

Out of scope (deferred to existing or future leaves):

- **`part_session_join.part_lobby_view`** (the next sibling, 0.5d, `depends !part_invite_acceptance`). The lobby's real UX — "the other debater is/isn't here yet", the ready-state badges, the moderator's enter-session signal — is that leaf's concern; this leaf lands only the placeholder lobby route so the success-navigation target exists. The placeholder carries an explicit `data-testid="lobby-placeholder"` + a comment block naming `part_lobby_view` as its replacement so the future leaf has an unambiguous removal target.
- **A debater-side `RequireAuth` route gate.** The host's `SurfaceHost` already gates `/p/*` on `auth.status === 'authenticated'`; the surface's `requiredAuthLevel: 'authenticated'` declaration in `SurfaceModule.meta` makes the host bounce unauthenticated visitors to `/login` with the invite URL remembered as `return_to`. A second gate inside the surface would be parallel logic with no new caller. The existing skeleton-smoke spec's `'unauthenticated visit to /p/...'` scenario already pins the host-side deflection for the invite URL shape; this leaf inherits the proof.
- **Tokenized invites / per-debater invitation rows.** The predecessor refinement's Decisions §"No tokenized invitations in v1" + §"Public sessions are claimable by any authenticated user" settled this: the moderator-shared URL relies on out-of-band trust, the role-availability index is the structural gate. This leaf does NOT introduce a token field on the body, does NOT verify any invite metadata before posting, does NOT read a server-side "intent to invite this user" record (no such record exists). The endpoint's body is `{ role }` only; the caller's id comes from the session cookie. A future tokens-required feature is forward-compatible — the body would gain an optional `token` field; this leaf's caller would just keep sending `{ role }` until that feature lands.
- **A first-time-debater onboarding modal / coachmark.** The chrome already surfaces identity + a connection chip + a product label; the route's body is intentionally minimal — a one-line description + a primary button. If user research later wants a richer onboarding affordance, a future P-something leaf can add it; landing it today before any debater has actually used the surface would be over-design.
- **Retry-after-network-failure with backoff.** The button is re-enabled on a transient error (network failure, 5xx); the user can re-click. No automatic retry, no progressive backoff, no exponential-jitter — a single user-driven retry covers the M3-lobby use case (a moderator-and-debaters-in-the-same-room scenario; the user can re-click if it fails). Future iteration may add automatic retry if telemetry shows manual retry is missed.
- **A "go back to the invite URL" affordance from the lobby on a misclick.** Once the claim succeeds and the user lands on the lobby, the lobby is the new home; navigating "back" to the invite URL is meaningless (the slot is now filled by the same user; the page would render the `user-already-joined` terminal panel). The browser-back's default behavior is acceptable. If a future leaf wants a structured "leave session" flow, that's its concern.
- **Vote / withdraw / propose paths.** Those are owned by `part_voting.*` / `part_withdraw.*` / future `part_propose_*` leaves. This leaf only opens the per-session WS subscription; it does NOT call `useWsClient().send('propose', ...)` or any other write path.
- **Pre-claim session-header fetch (`GET /api/sessions/:id`).** Decision §6 below settles: do NOT pre-fetch the session header on this leaf. The button-then-claim flow is direct; the session topic / privacy hint would be nice-to-have but the moderator-side trust channel already conveys them (the moderator told the debater "we're debating X; here's the link") and pre-fetching adds a second failure mode, a loading state, and a `not-found`-before-the-button code path that complicates the UX without adding M3-lobby value.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji:42-46`](../../99-milestones.tji#L42)) is the milestone the orchestrator picks against today, and this leaf is one of the last `part_session_join` group leaves the milestone depends on for its "two debaters land in the lobby and see each other live" success criterion. The chain a real debater hits today, after the just-shipped `part_shell` group, the predecessor backend endpoint (commit `f07d456`), and the moderator's invite view (already shipped):

1. Moderator generates the invite URL `/p/sessions/<uuid>/invite?role=debater-A` from their invite view; shares it out-of-band with the debater.
2. Debater clicks the URL. Root host's `/p/*` route renders `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`. The host's auth-gate passes (after `f93e80b`'s new-user redirect fix); the host calls `surface.mount({ container, auth, i18n, routerBasePath: '/p' })`.
3. The participant `main.tsx` wraps the React tree in `<I18nProvider>` + `<AuthValueProvider>` + `<WsClientProvider>` + `<BrowserRouter basename="/p">` (per `part_ws_client`'s Decision §1). `<App>` mounts.
4. **Today**: `<App>` only has a wildcard route returning the placeholder. The debater sees the chrome (identity row + status chip + product label) + the body "Participant surface" / "Loading…" / `Signed in as <screenName>`. There is **no claim affordance**. The URL's `?role=` is read by nothing; the path's `:id` is read by nothing; `client.trackSession(<id>)` is never called; the WS connection is open but subscribed to zero sessions. The moderator's lobby view never sees a `participant-joined` event for this debater because no such event is emitted (no row is INSERTed; no event is appended). The chain stalls.
5. **After this leaf**: `<App>` has a real `/sessions/:id/invite` route. The debater sees the chrome plus a one-line hint ("You're joining this debate as Debater A as <screenName>") plus a primary button ("Join this debate"). Clicking the button POSTs to `/api/sessions/${id}/invite/claim` with `{ role }`; on a 200 the route calls `navigate('/sessions/${id}/lobby')`; the placeholder lobby route renders with the session id surfaced under a stable testid; in parallel, the WS broadcast bus emits the `participant-joined` event the moderator's `InviteParticipants.tsx` slot reducer already subscribes to, and the moderator's slot for `debater-A` lights up with the debater's screen name in real time. The M3-lobby chain is now end-to-end.

Downstream concretely:

- **`part_session_join.part_lobby_view`** (existing open WBS leaf, 0.5d, `depends !part_invite_acceptance`). Replaces this leaf's placeholder lobby with the real lobby UX. Reads `useWsStore((s) => s.sessionState[sid].events)` to derive slot occupancy + ready states + the moderator's "start" signal. The `trackSession` lifecycle this leaf installs on the invite route is duplicated by the lobby route on its own mount (per the moderator's pattern: each WS-driving route owns its own subscription lifecycle); the two subscriptions are idempotent (per `ws-client.test.ts:547` — "trackSession is idempotent — re-tracking the same session is a no-op") so the transition from invite → lobby is clean.
- **`part_status_indicator`'s chip** — the connection-state chip in the footer continues to reflect the real WS state through every transition on this route (initial paint, the claim POST round-trip, the navigation to the lobby placeholder). The chip is structural chrome; this route does not touch it.
- **Moderator's invite view** ([`apps/moderator/src/routes/InviteParticipants.tsx:189-195`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L189)) — already calls `client.trackSession(sessionId)` on mount and renders slot occupancy from the per-session events slice. The moment this leaf's claim POST commits server-side and the post-COMMIT `wsBroadcast.emit({ event: <participant-joined> })` fires, the event lands in every subscriber's store (per the existing `ws_event_broadcast` contract) — including the moderator's open invite-view socket. No moderator-side code change.

Architecturally, this leaf is also the **structural close of `part_ws_client`'s deferred-debt block**. The shell's WS substrate plus the surface-wide `<WsClientProvider>` mount were the previous wiring leaves; this is the first leaf with a real `:id` from `useParams()`, which is the canonical place per-session subscription belongs (per `part_ws_client` Decision §1's "per-session subscription is a downstream concern"). After this leaf lands, the participant surface goes from "the WS connection is open but watches nothing" to "the WS connection watches the sessions the user's current route is bound to." The next sibling, the lobby, inherits that posture (its own `trackSession` call on its own mount).

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37-L88) — Decision 1 fixes the `/p/*` URL prefix the moderator's invite URL targets; Decision 2 fixes the surface's mount contract; Decision 3 fixes that surfaces consume shared services (auth, i18n, WS) from `@a-conversa/shell` rather than re-implementing them. The auth-callback's `return_to` handling — i.e. unauth'd visit to `/p/sessions/<uuid>/invite?role=...` → login → land back at the invite URL — is the chain this leaf implicitly relies on; the existing skeleton-smoke spec already pins the host-side deflection.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioral assertion below is a committed Vitest case, Cucumber scenario, or Playwright scenario. The terminal "I clicked the button and it worked" path is pinned by the Playwright happy-path scenario against the live compose stack; the typed error branches are pinned at the Vitest component layer (with a single Playwright `not-found` scenario as the structural sentinel).
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth. The claim POST relies on the same-origin `aconversa-session` HttpOnly cookie via `credentials: 'include'`; the route does NOT read the cookie, append a token to the URL, or pass auth claims through the body. Per the predecessor endpoint's contract: `request.authUser.id` is the source of truth for the caller's identity.
- [ADR 0021 — event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `participant-joined` event emitted post-COMMIT carries `actor === payload.user_id` (the canonical self-action shape). The participant's `useWsStore` reducer handles this event via the existing `applyEvent` path (per `part_state_management`'s store wiring); this leaf does not extend the reducer.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_ws_client.md#L25-L26`](part_ws_client.md#L25) + Status block [§L412](part_ws_client.md#L412) — the canonical statement that THIS task is the inheritor of `client.trackSession(sessionId)` lifecycle wiring. The deferred-debt list explicitly names "per-session subscription wiring → existing leaf `participant_ui.part_session_join.part_invite_acceptance`." Decision §1 of that refinement also rules that the surface boundary owns the provider, not per-route; this leaf does NOT mount its own `<WsClientProvider>` — it consumes `useWsClient()` from the surface-wide one.
- [`tasks/refinements/participant-ui/part_auth_flow.md#L103-L146`](part_auth_flow.md#L103) — the `useAuth()` consumption shape this leaf mirrors. The route's hint line ("You're joining as Debater A as <screenName>") narrows on `auth.status === 'authenticated' && auth.user !== undefined` and reads `auth.user.screenName`; same belt-and-suspenders shape `<PlaceholderRouteBody>` uses. The route does NOT add a second `participant-not-authenticated` guard inside the route body — the chrome's defensive panel + the host's `SurfaceHost` cleanup cover the mid-mount status-flip window already.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — the `useWsStore` selectors this leaf does NOT call (the claim flow is HTTP-driven, not WS-driven). The `applyEvent` reducer that lands the `participant-joined` broadcast in the per-session slice is consumed transitively through `client.trackSession(sessionId)` — this leaf does not extend the reducer or call `setConnectionStatus`.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome shape the route renders inside. The route returns `<ParticipantLayout header={<ParticipantChrome />} main={<InviteAcceptanceRouteBody />} footer={<ParticipantStatusIndicator />} />` — same composition shape `<PlaceholderRoute>` uses today; the `main` slot is the only piece this leaf populates differently.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md) — the chip in the footer that surfaces the WS state through the claim round-trip. No interaction needed here; the chip's source hook reads from `useWsStore` and is unaffected by this leaf.
- [`tasks/refinements/backend/session_invite_self_claim_endpoint.md`](../backend/session_invite_self_claim_endpoint.md) — the canonical predecessor. The "URL shape" Decisions block fixes `/api/sessions/:id/invite/claim`; the "Body schema" Constraints block fixes `{ role: 'debater-A' | 'debater-B' }` (no `userId` — the body schema's `additionalProperties: false` would block it at the schema layer, though `@fastify/ajv-compiler`'s `removeAdditional: true` default actually silently strips it per the amendment note at the end of the Status block); the "Status codes" section fixes the seven typed envelopes this leaf maps to localized error panels. The Decisions §"Not idempotent: repeat POST returns 409" matters for the `user-already-joined` terminal branch — a debater who refreshes the page after a successful claim gets sent here by the URL, posts again, gets the 409, and sees the "you are already in this session" panel with a "go to lobby" button (Decision §3 below).
- [`tasks/refinements/backend/list_session_participants_endpoint.md`](../backend/list_session_participants_endpoint.md) — the lobby's natural pre-fetch source once `part_lobby_view` lands. Per the prompt's instruction: this leaf does NOT consume the endpoint (the lobby will). Mentioned here for cross-referencing.
- [`tasks/refinements/moderator-ui/mod_invite_participants.md`](../moderator-ui/mod_invite_participants.md) — the upstream that emits the invite URL shape. Notably, lines 313-316 of [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L313) are the authoritative source for the URL grammar — this leaf's `useParams()` + `useSearchParams()` reads MUST match the moderator's emit shape exactly.

### Live code the route plugs into

- [`apps/participant/src/App.tsx:142-148`](../../../apps/participant/src/App.tsx#L142) — the current route tree. This leaf adds **two** new `<Route>` entries above the existing wildcard:
  1. `<Route path="/sessions/:id/invite" element={<InviteAcceptanceRoute />} />` — the claim route.
  2. `<Route path="/sessions/:id/lobby" element={<LobbyPlaceholderRoute />} />` — the placeholder navigation destination (replaced by `part_lobby_view`).
  The wildcard `<Route path="*">` stays as the catch-all so any other URL under `/p/*` still renders the existing placeholder. The two new routes mount the same chrome (`<ParticipantLayout>`) — `<InviteAcceptanceRoute>` and `<LobbyPlaceholderRoute>` each compose the layout the same way `<PlaceholderRoute>` does.
- [`apps/participant/src/main.tsx:77-85`](../../../apps/participant/src/main.tsx#L77) — the `<WsClientProvider>` mount the route consumes via `useWsClient()`. No change to `main.tsx`; the provider is already at the surface boundary per `part_ws_client` Decision §1.
- [`apps/participant/src/ws/wsStore.ts`](../../../apps/participant/src/ws/wsStore.ts) — the participant's `useWsStore` singleton. This leaf does NOT directly read the store; the `trackSession` call routes envelope writes through the store via the provider's `clientOptions.store` wiring, and the lobby will read the store when it lands.
- [`packages/shell/src/ws/WsClientProvider.tsx:107-112`](../../../packages/shell/src/ws/WsClientProvider.tsx#L107) — `useWsClient()` throws if called outside the provider. Safe here because the provider wraps the whole router tree.
- [`packages/shell/src/ws/client.ts:139-141`](../../../packages/shell/src/ws/client.ts#L139) + [`packages/shell/src/ws/client.ts:477-503`](../../../packages/shell/src/ws/client.ts#L477) — `client.trackSession(sessionId)` / `client.untrackSession(sessionId)` are async; the participant route calls them with `void` (fire-and-forget) inside a `useEffect`, mirroring the moderator's pattern. The functions are idempotent (per `ws-client.test.ts:547`) so the cleanup-then-remount path on a parameter change is safe.
- [`apps/moderator/src/routes/InviteParticipants.tsx:181-195`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L181) — the canonical `trackSession` lifecycle pattern. This leaf's `useEffect` mirrors it line-for-line: same `if (sessionId === '') return;` guard, same `void client.trackSession(sessionId)` call, same cleanup with `void client.untrackSession(sessionId)`, same `[client, sessionId]` deps.
- [`apps/moderator/src/routes/Operate.tsx:141-147`](../../../apps/moderator/src/routes/Operate.tsx#L141) — the second canonical example. Same shape; this leaf copies the shape.
- [`apps/server/src/sessions/routes.ts:2651-2906`](../../../apps/server/src/sessions/routes.ts#L2651) — the `POST /api/sessions/:id/invite/claim` handler. The error envelope shape (`{ code, message, ... }` per `errorEnvelopeRef`) and the per-code status mapping are the contract this leaf's error-mapper consumes.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — `loginAs(page, { username })` drives a full OIDC dance and returns the authenticated user's `{ userId, screenName }`. The happy-path scenario uses it for ben (the debater) and indirectly via `setup-auth` (which seeds alice's jar for the moderator preconditions; alice's session-create is driven via `page.request.post(...)` so no second OIDC dance).
- [`tests/e2e/invite-participants-flow.spec.ts:42-65`](../../../tests/e2e/invite-participants-flow.spec.ts#L42) — the canonical pattern for a multi-step session-create-then-do-thing scenario. This leaf's happy path mirrors the shape: create the session, get the session id, follow the invite URL.
- [`playwright.config.ts:303-312`](../../../playwright.config.ts#L303) — the `chromium-participant-skeleton` project. Already pre-seeded with the `setup-auth` storage state. The new scenarios land in the same project; no new Playwright project, no new fixture file.
- [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) — the predecessor's spec. **This leaf does NOT extend this spec** — the skeleton-smoke scope is "the participant skeleton renders correctly under `/p/*`"; the invite-acceptance scope is "the claim round-trip works." A new spec file at `tests/e2e/participant-invite-acceptance.spec.ts` keeps the concerns separate and matches the moderator's per-feature spec-file convention (`create-session-flow.spec.ts`, `invite-participants-flow.spec.ts`, `moderator-hover-details.spec.ts`).

### What the surface MUST NOT do

- **No participant-local `createWsClient()` call.** The provider's auto-construction is the canonical path; the route consumes `useWsClient()` from the surface-wide provider. A direct `createWsClient` import in the route would duplicate the singleton.
- **No `fetch('/api/auth/me')`.** The route reads the host-supplied `useAuth()`; no second auth fetch.
- **No `fetch('/api/sessions/:id')` pre-fetch** (per Decision §6). The button-then-claim flow is direct; no pre-flight read of the session header.
- **No `localStorage` / `sessionStorage` writes.** In-memory only; the route's local state lives in `useState`. The host's `sessionStorage['a-conversa:return-to']` is set by the host on the unauth deflection — not by this leaf.
- **No `window.location` writes.** Post-success navigation uses `react-router-dom`'s `useNavigate()`; the destination is in-surface (`/sessions/${id}/lobby` under the `/p` basename), so a programmatic `navigate(...)` is the right call.
- **No `userId` field in the claim POST body.** The endpoint's body schema is `{ role }` only; the caller's id is implicit from the cookie. Sending `userId` would be silently stripped by `@fastify/ajv-compiler`'s `removeAdditional: true` default (per the predecessor's Status amendment), so it'd be a no-op; but explicitly not sending it keeps the contract honest.
- **No second `<WsClientProvider>` mount, no second `useWsStore` singleton, no inline store creation.** Surface-wide provider only.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/App.tsx` — modified. Imports `InviteAcceptanceRoute` from `./routes/InviteAcceptanceRoute` and `LobbyPlaceholderRoute` from `./routes/LobbyPlaceholderRoute`. Adds two new `<Route>` entries above the existing wildcard. No other change to the placeholder body, the chrome, or the chrome's identity row.
- `apps/participant/src/routes/InviteAcceptanceRoute.tsx` — NEW. The claim route: reads `useParams<{ id: string }>()` for the session id, `useSearchParams()` for the `?role=...` hint, `useAuth()` for the pre-claim hint, `useWsClient()` for the `trackSession` lifecycle, `useNavigate()` for post-success navigation. State: `idle | submitting | error<code>`. Renders the layout shell (`<ParticipantLayout header={<ParticipantChrome />} main={<InviteAcceptanceRouteBody ... />} footer={<ParticipantStatusIndicator />} />`); the `InviteAcceptanceRouteBody` is a sibling component in the same file that owns the route content.
- `apps/participant/src/routes/InviteAcceptanceRoute.test.tsx` — NEW. Vitest cases (8) covering: (a) renders the hint line with the role + screen name; (b) renders the primary button enabled; (c) successful POST → `useNavigate` called with `/sessions/${id}/lobby` AND `trackSession(${id})` called once on mount AND `untrackSession(${id})` called once on cleanup; (d-h) one case per typed error code mapped to the right localized panel + the right testid + the right retryable/terminal affordance. Uses MSW or a `fetch` mock to drive the POST surface (project convention: lightweight `vi.spyOn(global, 'fetch')` mock — the moderator workspace's `CreateSession.test.tsx` is the precedent).
- `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` — NEW. Placeholder destination for the success navigation. Renders the same chrome (`<ParticipantLayout>` with `<ParticipantChrome>` header + the status chip footer); body is one line ("You're in the lobby") + the session id under `data-testid="session-id"` (mirrors the moderator's `Lobby.tsx` placeholder). Carries an explicit `data-testid="lobby-placeholder"` and a load-bearing comment block naming `part_session_join.part_lobby_view` as its replacement.
- `apps/participant/src/routes/LobbyPlaceholderRoute.test.tsx` — NEW. Vitest case (1) pinning that the route renders with the session id from `useParams()` under the expected testid.
- `apps/participant/src/error-mapper/inviteAcceptanceError.ts` — NEW. A small module exporting `mapInviteAcceptanceError(code: string, status: number): { i18nKey: string; isRetryable: boolean; isTerminal: boolean }` mirroring the shell's `mapCreateSessionError` shape. Five typed codes (`not-found`, `session-already-ended`, `not-a-moderator`, `role-already-filled`, `user-already-joined`) plus the fallback path via the shell's `mapGenericApiError`.
- `apps/participant/src/error-mapper/inviteAcceptanceError.test.ts` — NEW. Vitest cases (7) — one per typed code + a 5xx fallback + a 4xx-with-unknown-code fallback.
- `tests/e2e/participant-invite-acceptance.spec.ts` — NEW. Two Playwright scenarios under `chromium-participant-skeleton`:
  1. **Happy path** — alice creates a private session via `page.request.post('/api/sessions', { data: { topic, privacy: 'private' } })` after `loginAs(page, { username: 'alice' })`; logs out via `/logout`; the same `page` re-authenticates as ben via `loginAs(page, { username: 'ben' })`; navigates to `/p/sessions/<the new session id>/invite?role=debater-A`; sees the route render with the pre-claim hint; clicks the join button; URL settles on `/p/sessions/<id>/lobby`; the lobby placeholder testid is visible; the session id surfaces under `data-testid="session-id"`.
  2. **Not-found path** — alice (the seeded `setup-auth` jar) navigates to `/p/sessions/00000000-0000-4000-8000-0000000000ff/invite?role=debater-A` (a deterministic UUID guaranteed not to exist in the migrated schema); sees the route render; clicks the join button; the response is 404 `not-found`; the route renders the terminal `invite-acceptance-error-not-found` panel.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Adds the `participant.inviteAcceptance.*` namespace with 12 new keys: `hint` (ICU `You're joining this debate as {role} as {name}`), `joinButton` (`Join this debate`), `joining` (`Joining…`), `roleLabels.debaterA` (`Debater A`), `roleLabels.debaterB` (`Debater B`), `errors.notFound`, `errors.sessionAlreadyEnded`, `errors.notAModerator`, `errors.roleAlreadyFilled`, `errors.userAlreadyJoined`, `errors.generic`, `errors.network`. Also adds the lobby placeholder keys: `participant.lobbyPlaceholder.body` (`You're in the lobby`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same 13 keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same 13 keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Appends all 13 new dotted keys to the `pending` list.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — the provider stack is correct; no change. The `<WsClientProvider>` from `part_ws_client` is the seam this leaf consumes via `useWsClient()`.
- `apps/participant/src/ws/wsStore.ts` / `apps/participant/src/ws/wsStore.test.ts` — the store + tests are consumed unchanged. The route does not select from the store; the `trackSession` write-path routes envelope writes through the store via the provider's `clientOptions.store` wiring.
- `apps/participant/src/stores/*` — the three local-UI slices are not consumed yet (they land with the voting / graph leaves). The claim route's transient state lives in `useState`.
- `apps/participant/src/layout/*` — the layout + chrome + chip are consumed unchanged.
- `apps/participant/src/mount.test.tsx` — the mount-boundary case stays as-is (it asserts the placeholder, and the placeholder still renders for any URL not matching the two new routes; the existing assertions are unaffected because the test's URL is `/p/sessions/<uuid>/invite?role=debater-A` which... actually MATCHES the new route, so see Decision §8).
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep; no new build config.
- `packages/shell/` — the substrate is consumed unchanged. No new shell substrate; the error-mapper this leaf adds lives in the participant workspace (the surface-local error-mapping shape; if the audience surface later needs a similar mapping, an extraction can happen then).
- `apps/root/` / `apps/server/` / `apps/moderator/` / `apps/audience/` — no cross-surface change. The moderator's invite emit shape is the upstream contract; the backend endpoint is shipped.
- `playwright.config.ts` — no new Playwright project; the `chromium-participant-skeleton` project covers the new spec via the testMatch glob (the new spec file matches `participant-*.spec.ts`, which the existing project glob accepts). **Amendment**: the existing project's testMatch is `/participant-skeleton-smoke\.spec\.ts$/` (literal-named). This leaf's new spec needs the testMatch to be widened to `/participant-(skeleton-smoke|invite-acceptance)\.spec\.ts$/` OR a sibling project added. See Decision §7 for the widening-the-glob choice.
- `.tji` files — `complete 100` on `part_invite_acceptance` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual. A new native-review follow-up leaf (`frontend_i18n.i18n_participant_invite_acceptance_native_review`) is registered in `tasks/35-frontend-i18n.tji` per Decision §10 / tech-debt.
- `docs/adr/` — no new ADR (every decision below applies an existing ADR or codifies a scoped UI policy).

### Component shape (`apps/participant/src/routes/InviteAcceptanceRoute.tsx`)

The route, sketched:

```tsx
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useWsClient } from '@a-conversa/shell';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';
import { ParticipantChrome } from '../layout/ParticipantChrome'; // extracted from App.tsx — see Decision §9
import { mapInviteAcceptanceError } from '../error-mapper/inviteAcceptanceError';

type ClaimStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; i18nKey: string; isRetryable: boolean; isTerminal: boolean; code: string };

const VALID_ROLES = ['debater-A', 'debater-B'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

export function InviteAcceptanceRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const rawRole = searchParams.get('role') ?? '';
  const role = (VALID_ROLES as readonly string[]).includes(rawRole) ? (rawRole as ValidRole) : undefined;

  const client = useWsClient();

  // Inherited from part_ws_client: the per-session subscription
  // lifecycle. Idempotent re-tracking on a remount is safe per
  // `ws-client.test.ts:547`; the cleanup pairs trackSession with
  // untrackSession so the server's subscription registry stays clean.
  useEffect(() => {
    if (id === '') return;
    void client.trackSession(id);
    return () => {
      void client.untrackSession(id);
    };
  }, [client, id]);

  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<InviteAcceptanceRouteBody id={id} role={role} />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

function InviteAcceptanceRouteBody({
  id,
  role,
}: {
  id: string;
  role: ValidRole | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ClaimStatus>({ kind: 'idle' });

  // Belt-and-suspenders against the mid-mount auth-status flip. The
  // chrome's identity row + the host's SurfaceHost cleanup are the
  // primary defenses; this guard prevents `.screenName` access if React
  // re-renders between the auth flip and the host's tear-down (mirrors
  // `part_auth_flow` Decision §3 + `<PlaceholderRouteBody>`).
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div
        data-testid="route-invite-acceptance"
        data-state="not-authenticated"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="participant-not-authenticated" className="text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  // The role hint is required: a malformed invite URL (missing
  // `?role=...`, or `?role=` with anything other than the two debater
  // values) renders a terminal "invalid invite URL" panel and does NOT
  // expose the join button — the predecessor endpoint's body schema
  // would 400 anyway, but discriminating the malformed-URL case at the
  // route layer keeps the user-facing message accurate.
  if (role === undefined) {
    return (
      <div
        data-testid="route-invite-acceptance"
        data-state="invalid-url"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="invite-acceptance-error-invalid-url" className="text-sm text-red-700">
          {t('participant.inviteAcceptance.errors.invalidUrl')}
        </p>
      </div>
    );
  }

  const roleLabel = t(
    role === 'debater-A'
      ? 'participant.inviteAcceptance.roleLabels.debaterA'
      : 'participant.inviteAcceptance.roleLabels.debaterB',
  );

  const handleClaim = useCallback(async (): Promise<void> => {
    setStatus({ kind: 'submitting' });
    try {
      const response = await fetch(`/api/sessions/${id}/invite/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (response.status === 200) {
        // Per Decision §1: navigate to the placeholder lobby route.
        // `part_lobby_view` replaces the destination.
        navigate(`/sessions/${id}/lobby`, { replace: true });
        return;
      }
      const errBody = (await response.json().catch(() => ({}))) as { code?: string };
      const mapped = mapInviteAcceptanceError(errBody.code ?? 'unknown', response.status);
      setStatus({ kind: 'error', ...mapped, code: errBody.code ?? 'unknown' });
    } catch {
      const mapped = mapInviteAcceptanceError('network', 0);
      setStatus({ kind: 'error', ...mapped, code: 'network' });
    }
  }, [id, role, navigate]);

  return (
    <div data-testid="route-invite-acceptance" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.inviteAcceptance.title')}</h1>
      <p data-testid="invite-acceptance-hint" className="mt-2 text-sm text-slate-700">
        {t('participant.inviteAcceptance.hint', { role: roleLabel, name: auth.user.screenName })}
      </p>
      {status.kind !== 'error' || status.isRetryable ? (
        <button
          type="button"
          data-testid="invite-acceptance-join-button"
          disabled={status.kind === 'submitting'}
          onClick={handleClaim}
          className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {status.kind === 'submitting'
            ? t('participant.inviteAcceptance.joining')
            : t('participant.inviteAcceptance.joinButton')}
        </button>
      ) : null}
      {status.kind === 'error' ? (
        <p
          data-testid={`invite-acceptance-error-${status.code}`}
          role="alert"
          aria-live="polite"
          className="mt-4 text-sm text-red-700"
        >
          {t(status.i18nKey)}
        </p>
      ) : null}
      {status.kind === 'error' && status.isTerminal && status.code === 'user-already-joined' ? (
        <button
          type="button"
          data-testid="invite-acceptance-go-to-lobby"
          onClick={() => navigate(`/sessions/${id}/lobby`, { replace: true })}
          className="mt-4 inline-flex rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700"
        >
          {t('participant.inviteAcceptance.goToLobby')}
        </button>
      ) : null}
    </div>
  );
}
```

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest component-shape** — `apps/participant/src/routes/InviteAcceptanceRoute.test.tsx`. Eight cases:
   - (a) Renders the hint line with the role label + screen name for `?role=debater-A`.
   - (b) Renders the hint line with the role label + screen name for `?role=debater-B`.
   - (c) Renders the `invalid-url` panel (no button, no hint) for a missing or malformed `?role=` value.
   - (d) Successful POST: button click → `fetch` POSTs `{ role }` to `/api/sessions/${id}/invite/claim` → `navigate('/sessions/${id}/lobby', { replace: true })` is called once. `client.trackSession(${id})` is called once on mount; `client.untrackSession(${id})` is called once on unmount.
   - (e) 404 `not-found`: renders `invite-acceptance-error-not-found`, button is hidden (terminal), no `go-to-lobby` button.
   - (f) 409 `session-already-ended`: renders the matching panel, terminal.
   - (g) 409 `user-already-joined`: renders the matching panel, terminal, AND renders the `invite-acceptance-go-to-lobby` button (the only terminal branch with a forward affordance).
   - (h) 409 `role-already-filled`: renders the matching panel, retryable (button remains visible).
   The 403 `not-a-moderator` and the 5xx fallback are covered by the error-mapper unit test (below), not the component test — the component cases stay focused on the navigation-and-button states.

2. **Vitest error-mapper** — `apps/participant/src/error-mapper/inviteAcceptanceError.test.ts`. Seven cases — one per typed code (`not-found`, `session-already-ended`, `not-a-moderator`, `role-already-filled`, `user-already-joined`), a 5xx fallback, and a 4xx-with-unknown-code fallback. Pins the `{ i18nKey, isRetryable, isTerminal }` mapping table.

3. **Vitest lobby-placeholder** — `apps/participant/src/routes/LobbyPlaceholderRoute.test.tsx`. One case: renders the `lobby-placeholder` testid + the session id from `useParams()` under `data-testid="session-id"`.

4. **Playwright e2e** — `tests/e2e/participant-invite-acceptance.spec.ts`. Two scenarios under `chromium-participant-skeleton`:
   - **Happy path** — alice creates a private session via `page.request.post('/api/sessions', ...)` (the existing API the moderator UI also uses); the same Playwright page logs out and logs in as ben via `loginAs`; navigates to the moderator-emitted invite URL shape; clicks the join button; URL settles on the lobby placeholder. The scenario indirectly validates:
     1. The route renders (the chrome + the hint + the button).
     2. The claim POST is wired correctly (200 path).
     3. The post-success navigation hits the placeholder lobby route, which exists.
     4. `client.trackSession(${id})` did not throw (the WS subscription registry accepted the subscribe message — observable via the `chromium-participant-skeleton` project's existing connection-state chip; a regression here would surface as the chip going to `reconnecting` or `closed`).
   - **Not-found path** — alice (the seeded jar) navigates to a deterministic non-existent session id; clicks the join button; sees the `invite-acceptance-error-not-found` terminal panel. Pins that the route's error-mapping is wired end-to-end against the real backend's 404 envelope (the predecessor refinement's "private-not-visible-to-caller collapses to 404" behavior surfaces here too — a deterministic-uuid-that-doesn't-exist is the same shape as a private-session-visible-to-someone-else).

The vote-send / withdraw-send Playwright scenarios deferred by `part_state_management` and `part_ws_client` are NOT exercised here — they belong to `part_voting.part_vote_single_tap` and `part_withdraw.part_withdraw_action` as the predecessor refinements already declared.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default per `ORCHESTRATOR.md`.** The invite-acceptance route is reachable from a user-visible flow (the moderator-emitted URL); the happy-path scenario and the not-found scenario cover the contract end-to-end. Per Decision §7, two scenarios are deferred from this leaf:

- **Unauthenticated → OAuth → return-to round-trip e2e against the live Authelia.** The existing `participant-skeleton-smoke.spec.ts`'s `'unauthenticated visit to /p/...'` scenario already pins that `SurfaceHost` deflects to `/login` with `a-conversa:return-to` remembered for the invite URL shape. Re-exercising the full Authelia round-trip on this leaf would require either driving the OIDC dance for a *third* time (above and beyond `setup-auth`'s once-per-project amortization) or layering a per-test login dance — both expensive against the rate-limited dev Authelia. The skeleton-smoke spec's deflection pin + the `tests/e2e/auth-flow.spec.ts`'s new-user / returning-user OIDC pins jointly cover the full chain at the layer where it belongs (the host's auth chrome, not the surface). **No future leaf inherits this debt** — it's already covered by existing pins.
- **Multi-debater cross-surface "moderator sees both debaters joined" e2e.** This requires driving two browser contexts (alice as moderator + ben as debater-A + the orchestrator polling for participant-joined in the moderator's slot reducer) — the kind of fixture the future `part_pw_concurrent_with_moderator` leaf (`tasks/40-participant-ui.tji:341-345`, effort 2d) explicitly owns. Per `ORCHESTRATOR.md`'s deferred-e2e exception ("when the cross-surface fixture infrastructure isn't yet built"), the cross-surface scenario inherits to that leaf. The single-context happy path here pins the surface-side contract; the cross-surface pin is `part_pw_concurrent_with_moderator`'s job.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~45 min: write `apps/participant/src/routes/InviteAcceptanceRoute.tsx` (~150 LOC including comments).
- ~30 min: write `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` (~40 LOC).
- ~20 min: write `apps/participant/src/error-mapper/inviteAcceptanceError.ts` (~40 LOC + ~50 LOC test).
- ~15 min: extract `<ParticipantChrome>` from `App.tsx` into its own file (per Decision §9) so the new routes can import it (~30 LOC moved, no logic change).
- ~10 min: edit `apps/participant/src/App.tsx` — add the two new `<Route>` entries, update the imports (~10 LOC).
- ~1.25h: write `apps/participant/src/routes/InviteAcceptanceRoute.test.tsx` — 8 cases with fetch-mock + router wrapper + auth provider stub (~250 LOC including the helper boilerplate). The moderator's `CreateSession.test.tsx` is the precedent.
- ~15 min: write `apps/participant/src/routes/LobbyPlaceholderRoute.test.tsx` (~30 LOC).
- ~45 min: write `tests/e2e/participant-invite-acceptance.spec.ts` — happy path + not-found scenario (~150 LOC). The moderator's `invite-participants-flow.spec.ts` is the shape precedent.
- ~15 min: i18n catalog edits (13 new keys × 3 locales + 2 review.json appends).
- ~10 min: widen the `chromium-participant-skeleton` project's testMatch in `playwright.config.ts` to accept the new spec file.
- ~30 min: `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e --project=chromium-participant-skeleton` + the WBS-status ritual + the commit. Compose stack down via `make down-v` at end.

Risk surface is moderate:

- The chrome extraction (Decision §9) is the riskiest piece — it moves code from `App.tsx` into a new file. The existing component-shape Vitest cases (which mock `useAuth`) and the existing Playwright pins (which assert on the chrome's identity row testid + product label) both stay green if the extraction is faithful; the test surface is dense enough to catch a bad extract.
- The Playwright happy-path scenario has to drive two OIDC dances on the same `page` — `loginAs(alice)` to create the session, then `logout` + `loginAs(ben)` to claim. The `setup-auth` jar covers the first user but not the second; the `loginAs` helper handles the per-test dance correctly (per its existing usage in `invite-participants-flow.spec.ts`). The dev Authelia's rate limiter is the constraint; the spec runs one `loginAs(ben)` call so the budget is one extra OIDC dance per CI run.
- The `chromium-participant-skeleton` testMatch widening (Decision §7) is mechanical — the existing project picks up the new spec file automatically once the glob matches.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dep; the lockfile should not move.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new route + error-mapper + lobby-placeholder all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build; bundle filename / sidecar shape unchanged; the new code tree-shakes into the existing `participant-<hash>.js`.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+16** (8 cases in `InviteAcceptanceRoute.test.tsx` + 7 cases in `inviteAcceptanceError.test.ts` + 1 case in `LobbyPlaceholderRoute.test.tsx`).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the 13 new keys present in all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the new scenarios green. The pre-existing 4 scenarios from `participant-skeleton-smoke.spec.ts` stay green; the 2 new scenarios from `participant-invite-acceptance.spec.ts` pass. Total scenarios in the project grow from 4 to 6.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No new `fetch` / `XMLHttpRequest` / `window.location` write** under `apps/participant/src/` other than the single `fetch('/api/sessions/${id}/invite/claim', ...)` call in the new route (which is auditable + scoped + per the predecessor endpoint's contract).
10. **No OIDC profile-claim identifier** under `apps/participant/src/` — the forbidden list (`email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`) returns zero grep matches (the audit `part_auth_flow` established stays green).
11. **No participant-local `createWsClient()` call** — a grep for `createWsClient` under `apps/participant/src/` returns zero matches.
12. **The `trackSession` lifecycle is wired correctly** — the Vitest case (d) asserts both `trackSession(${id})` on mount and `untrackSession(${id})` on cleanup (single call each, against the right session id).
13. **The success-navigation lands on the lobby placeholder** — the Playwright happy-path scenario asserts the URL settles on `/p/sessions/<id>/lobby` AND the `lobby-placeholder` testid is visible AND the session id surfaces under `data-testid="session-id"`.
14. **The `not-found` error path renders the right panel** — the Playwright not-found scenario asserts the `invite-acceptance-error-not-found` testid is visible after the 404 (no `lobby-placeholder` testid, no navigation away from the invite URL).
15. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_invite_acceptance` task block per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.
16. **Predecessor's existing assertions unchanged** — `tests/e2e/participant-skeleton-smoke.spec.ts`'s four scenarios pass without modification; the chip's seven component-shape Vitest cases pass unchanged; the existing `mount.test.tsx` case stays green (the new `/sessions/:id/invite` route only renders when the URL matches; the mount-boundary case's URL DOES match, so the case's assertions need updating — see Decision §8).

## Decisions

### 1. Post-success navigation: navigate to `/sessions/${id}/lobby` (with a placeholder lobby route landed here), NOT inline confirmation

Three alternatives surveyed:

- **(A) Render an inline "Joined — waiting for session" panel at the claim route** and don't navigate. Rejected: the URL stays as `/sessions/<id>/invite?role=...`, which is misleading once the claim succeeds (the user is not still "accepting an invite" — they're in the lobby). The browser-history entry stays at the invite URL, so a refresh re-fires the claim flow which hits `user-already-joined` and renders the terminal panel; the user has to manually navigate forward, defeating the point of inline confirmation. Worse, the placeholder lobby has to land *eventually anyway* when `part_lobby_view` ships, and that leaf's first user-visible signal is the URL settling on `/sessions/<id>/lobby` — landing the navigation now avoids a future "we changed the success behavior from inline-confirm to navigate" disruption.
- **(B) Navigate to `/sessions/${id}/lobby` and let it render the existing wildcard placeholder.** Rejected: the wildcard placeholder renders "Participant surface" / "Loading…" (the literal placeholder from `part_app_skeleton`) which reads as "the page is still loading" rather than "you're in the lobby." Confusing for the user; ambiguous as a test target (the same testid `route-participant-placeholder` matches both the invite-page-not-yet-loaded state and the post-claim state).
- **(C) Navigate to `/sessions/${id}/lobby` AND land a dedicated `<LobbyPlaceholderRoute>` component with its own testid** (chosen). The URL settles on the canonical lobby URL the future `part_lobby_view` will own; the placeholder renders a clear "You're in the lobby" message with the session id under a stable testid; the placeholder's load-bearing comment block names `part_session_join.part_lobby_view` as its replacement so the future leaf has an unambiguous removal target. The Playwright happy-path scenario asserts on the dedicated `lobby-placeholder` testid, which `part_lobby_view`'s refinement-writer will update when they replace it (either via amendment to the scenario or by giving the lobby a different testid + having the spec assert on the new one).

### 2. The claim route lives at `/sessions/:id/invite` (relative to the `/p` basename), NOT `/invite/:token` or `/invite/:id`

The moderator's invite URL grammar fixes this: `${origin}/p/sessions/${sessionId}/invite?role=${role}` per [`apps/moderator/src/routes/InviteParticipants.tsx:313-316`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L313). The path's `:id` segment is the session id; the role is a query-string hint. The path inside the surface's basename-scoped router is therefore `/sessions/:id/invite`. Three alternatives that were briefly considered and rejected:

- **`/invite/:token`** — would require a server-side `session_invitations` table + a tokenized invite scheme. Per the predecessor refinement's Decisions §"No tokenized invitations in v1", that's out of scope.
- **`/invite/:id`** — would diverge from the moderator's emit shape and require either (a) the moderator to change its emit URL (a breaking change that crosses two surfaces) or (b) a server-side redirect from `/p/sessions/:id/invite` to `/p/invite/:id` (added latency, second failure mode). Rejected — the existing URL shape is the right one.
- **A `?role=` in the path instead of the query** — would require the moderator to change its emit URL. Rejected for the same reason.

### 3. Per-code error mapping table and retryable-vs-terminal semantics

The five typed codes the predecessor endpoint defines map to user-visible affordances as follows:

| Backend code | i18n key | Retryable | Terminal | Affordance |
|---|---|---|---|---|
| `not-found` (404) | `participant.inviteAcceptance.errors.notFound` | no | yes | Error panel only ("This session could not be found — check the invite link with your moderator"). No retry; the URL itself is broken. |
| `session-already-ended` (409) | `participant.inviteAcceptance.errors.sessionAlreadyEnded` | no | yes | Error panel only ("This debate has already ended"). No retry; the lifecycle gate is permanent. |
| `not-a-moderator` (403) | `participant.inviteAcceptance.errors.notAModerator` | no | yes | Error panel only ("You are the session's moderator; you cannot also be a debater. Sign in as a different user to join as a debater"). No retry; the host-cannot-self-claim rule is permanent for this session+caller pair. |
| `role-already-filled` (409) | `participant.inviteAcceptance.errors.roleAlreadyFilled` | yes | no | Error panel + button visible ("This slot was just taken. Try refreshing or contact your moderator"). The user might want to retry with the other role; the upstream invite URL carries one specific role, so the retry value is "click again in case there was a transient slot-race" — the moderator's social channel covers the real recovery. |
| `user-already-joined` (409) | `participant.inviteAcceptance.errors.userAlreadyJoined` | no | yes (with `go-to-lobby` affordance) | Error panel + a secondary "Go to lobby" button that navigates to `/sessions/${id}/lobby`. The user is already in the session; the forward path is the lobby. |
| 5xx / network failure | `participant.inviteAcceptance.errors.generic` or `.network` | yes | no | Error panel + button visible. The user can retry. |
| 4xx with unknown code | `common.errors.validation` (via `mapGenericApiError`) | yes | no | Generic panel + button visible. |

Two alternatives surveyed:

- **(A) One generic error panel + button always visible.** Rejected: hides the discriminator the user needs to decide whether to retry, contact the moderator, refresh, or go to the lobby. The terminal-vs-retryable signal is what makes the UX actionable.
- **(B) Per-code mapping with five distinct localized panels and discriminating affordances** (chosen). The mapping is explicit (the `mapInviteAcceptanceError` module + its unit test); the user-visible affordances are testable at the Vitest layer; the discriminator is also what the Playwright not-found scenario asserts on at the e2e layer.

### 4. The `trackSession` lifecycle pairs `void client.trackSession(id)` on mount with `void client.untrackSession(id)` on cleanup

Mirrors the moderator's pattern at [`apps/moderator/src/routes/InviteParticipants.tsx:189-195`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L189) and [`apps/moderator/src/routes/Operate.tsx:141-147`](../../../apps/moderator/src/routes/Operate.tsx#L141) exactly. The `void` is intentional — both functions return `Promise<void>` and the call is fire-and-forget (the WS subscription is reliable from the user's perspective via the chip's connection-state cue; per-call success/failure is not user-actionable). The deps array is `[client, sessionId]` so a remount with a different session id re-runs the cleanup-then-re-subscribe cycle correctly.

Per `part_ws_client` Decision §1, the WS provider sits at the surface boundary in `main.tsx` and `useWsClient()` is available from every route inside the router; no per-route `<WsClientProvider>` mount is needed (or allowed).

Two alternatives surveyed:

- **(A) Wrap `client.trackSession` in `await` inside an async effect** so failures bubble. Rejected: React effects can't be `async` directly, so the wrapping would add boilerplate (`useEffect(() => { let cancelled = false; (async () => { try { await client.trackSession(id); } catch { /* ... */ } })(); return () => { cancelled = true; void client.untrackSession(id); }; }, [client, id])`); the failures are not user-actionable (the chip surfaces them via the connection state); the moderator does not bother either. Rejected.
- **(B) `void` fire-and-forget** (chosen). Matches the moderator's pattern verbatim; same observability story (the chip).

### 5. Native `fetch` for the claim POST, NOT a shared HTTP client

Two alternatives surveyed:

- **(A) Introduce a shared `apiFetch` helper in `@a-conversa/shell`** that wraps `fetch` with `credentials: 'include'` + JSON-content-type defaults + error-envelope parsing. Rejected for this leaf: the helper would be a new shell substrate, which is out of scope (the prompt biases toward reusing existing seams, not creating new ones). The moderator's `CreateSession.tsx` + `InviteParticipants.tsx` + `Operate.tsx` all call native `fetch` directly for their HTTP round-trips; the pattern is consistent across the codebase. If a future iteration finds value in consolidating, a `shell_pkg.shell_api_fetch` leaf can extract.
- **(B) Native `fetch` with explicit `credentials: 'include'` + `Content-Type: application/json` + `Accept: application/json`** (chosen). One call site, scoped to this leaf, with the same shape the moderator uses. Auditable; testable via `vi.spyOn(global, 'fetch')`.

### 6. No pre-fetch of the session header (`GET /api/sessions/:id`) before showing the button

Two alternatives surveyed:

- **(A) Pre-fetch on mount** to show the session topic in the hint ("You're joining the debate on 'Universal basic income' as Debater A as ben"). Rejected: adds a second failure mode (the header fetch could 404 / 5xx before the user even sees the button) and a loading state ("Loading session details…" before the button can render), both of which complicate the UX without M3-lobby value. The moderator-side trust channel already conveys the topic ("we're debating UBI; here's the link"); the user clicks the link knowing what they're joining. If a future iteration finds the topic surface valuable, a non-blocking fetch can land then (render the button immediately; insert the topic when it arrives).
- **(B) Skip the pre-fetch; render the button immediately on the bare hint** (chosen). The hint reads "You're joining this debate as Debater A as ben" — role-aware, identity-aware, no topic. One round-trip from the user's perspective (the claim POST). No loading state, no second error path. Honest about what we know without a fetch.

### 7. Defer the unauth-round-trip e2e AND the cross-surface "moderator sees the joined debater" e2e

Both deferrals are explicit:

- **Unauth → OAuth → return-to round-trip e2e** — already covered by `participant-skeleton-smoke.spec.ts`'s `'unauthenticated visit to /p/...'` scenario (the host-side deflection pin) + `auth-flow.spec.ts`'s new-user / returning-user OIDC pins (the OAuth round-trip pins). Adding a third pin against the live Authelia on this leaf would burn dev-Authelia rate-limit budget for zero new signal. **No future leaf inherits this debt** — it's covered by existing pins.
- **Cross-surface "moderator sees both debaters joined" e2e** — requires a two-browser-context fixture that does not exist yet (Playwright's `browserContext.newPage()` is the API, but the moderator-side polling shape, the synchronization between contexts, and the assertion order are non-trivial; the future `participant_ui.part_tests.part_e2e_playwright.part_pw_concurrent_with_moderator` leaf (effort 2d, [`tasks/40-participant-ui.tji:341-345`](../../40-participant-ui.tji#L341)) explicitly owns this fixture per its `.tji` note ("Used as a building block for the full-session Playwright run in the moderator-ui tests"). The cross-surface debt inherits to that leaf — no new tech-debt leaf needs registration; the consuming leaf already exists.

The two scenarios landed by this leaf (single-context happy path + single-context not-found) jointly pin the surface-side contract. The cross-surface contract is `part_pw_concurrent_with_moderator`'s scope.

### 8. The existing `mount.test.tsx` case's URL matches the new route — accept the case's chip + identity assertions, drop the placeholder-testid assertion

The existing mount-boundary case at [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) calls `mount({ ..., routerBasePath: '/p' })` with `window.history.replaceState({}, '', '/p/sessions/<uuid>/invite?role=debater-A')`. After this leaf, that URL no longer matches the wildcard route — it matches the new `<InviteAcceptanceRoute>`. The case's existing assertions:

- `route-participant-placeholder` testid is visible — **REMOVED** by this leaf (the new route does not render the placeholder; it renders `route-invite-acceptance`).
- `participant-identity` is visible inside the chrome header — **STAYS** (the chrome is the same; the header still carries the identity row).
- `participant-status-indicator` is visible inside the footer — **STAYS** (same chrome).

The case's amended assertion list: assert `route-invite-acceptance` is visible (the new route's testid), keep the chrome assertions, drop the placeholder assertion. **This is the only modification to a file outside the explicit allowlist** — the allowlist treats `apps/participant/src/mount.test.tsx` as in-scope for this surgical amendment. The amendment is documented in the test file's comment block.

Two alternatives surveyed:

- **Move the test's URL to something that still hits the wildcard** (e.g. `/p/foo/bar`). Rejected: would lose the regression pin on the canonical invite URL shape, which is what the mount-boundary case is actually validating ("the surface bundle mounts correctly on the moderator-emitted invite URL").
- **Amend the existing case in-place** (chosen). Two assertions stay; one is replaced. The case's name stays the same (it's still "mounts the participant route tree under the provided basename and returns an unmount fn"); the comment block updates to note the assertion shift.

### 9. Extract `<ParticipantChrome>` from `App.tsx` into its own file

Today `<ParticipantChrome>` is defined inline in [`apps/participant/src/App.tsx:58-85`](../../../apps/participant/src/App.tsx#L58). The new routes (`<InviteAcceptanceRoute>` and `<LobbyPlaceholderRoute>`) need to compose the same chrome — they each call `<ParticipantLayout header={<ParticipantChrome />} ... />`. Three alternatives surveyed:

- **(A) Re-define `<ParticipantChrome>` inline in each route file.** Rejected: three copies of the same component, drift risk.
- **(B) Export `<ParticipantChrome>` from `App.tsx`.** Rejected: makes `App.tsx` carry a sub-component export that lives in the same file as the route table; cross-file imports of "App.tsx" are unusual and confuse the module's purpose.
- **(C) Extract into `apps/participant/src/layout/ParticipantChrome.tsx`** (chosen). The chrome is a layout concern; it sits naturally next to `ParticipantLayout.tsx` and `ParticipantStatusIndicator.tsx`. All three callers (`<PlaceholderRoute>` from `App.tsx`, `<InviteAcceptanceRoute>`, `<LobbyPlaceholderRoute>`) import from the same module. The extraction is a one-time move; the existing tests that mount `<PlaceholderRoute>` still pass because the chrome's behavior is unchanged.

The extraction is a small file motion (~30 LOC moved with no logic change); the chrome's existing test surface (via the mount-boundary test + the Playwright skeleton-smoke spec) stays green.

### 10. Tech-debt registration

- **`frontend_i18n.i18n_participant_invite_acceptance_native_review`** — pt-BR + es-419 native-speaker review of the 13 new keys under `participant.inviteAcceptance.*` + `participant.lobbyPlaceholder.*`. Effort: 0.25d. Mirrors the existing `i18n_participant_placeholder_native_review` / `i18n_participant_identity_native_review` / `i18n_participant_chrome_native_review` / `i18n_participant_status_indicator_native_review` task shapes per `tasks/35-frontend-i18n.tji`. **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes, chained after `!i18n_participant_status_indicator_native_review` to keep the participant-side native-review chain linear.
- **No other follow-ups need registration.** The two e2e deferrals (Decision §7) are inherited by named existing pins / WBS leaves (`participant-skeleton-smoke.spec.ts`'s unauth scenario + `auth-flow.spec.ts` for the round-trip, and `part_pw_concurrent_with_moderator` for the cross-surface scenario). The lobby placeholder is inherited by `part_session_join.part_lobby_view` (the next sibling, already an open WBS leaf with `depends !part_invite_acceptance`). No new WBS leaf needs registration for any of those.

### 11. No new ADR needed

This task introduces no new architectural choices beyond existing precedents. Every decision above applies an existing ADR (0026 for the surface-consumes-from-shell-substrate posture, 0022 for the test discipline, 0002 for cookie-only auth, 0021 for the event-envelope shape the post-COMMIT broadcast carries) or codifies a scoped UI policy (Decisions §1 / §3 / §6 / §7 / §8 / §9). The "no new dependencies" rule is satisfied: no `package.json` change. The "no new shell substrate" rule is honored: `useAuth()` + `useWsClient()` + `client.trackSession` + the i18n bridge are all consumed unchanged. The "no new server-side change" rule is honored: the `POST /api/sessions/:id/invite/claim` endpoint is shipped.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Claim route landed at `/p/sessions/:id/invite` via `apps/participant/src/routes/InviteAcceptanceRoute.tsx` (+ test) and `apps/participant/src/App.tsx` route table; native `fetch` POSTs `/api/sessions/:id/invite/claim` with `credentials: "include"` per Decisions §5 and §2.
- Placeholder lobby destination shipped at `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` (+ test) for the post-success redirect; the real lobby view is owned by `participant_ui.part_session_join.part_lobby_view` which will replace it (Decisions §1).
- Per-code error mapping table extracted to `apps/participant/src/error-mapper/inviteAcceptanceError.ts` (+ test, with a dedicated `network` mapper case) implementing the retryable-vs-terminal split per Decisions §3; the extra `network` case accounts for the +17 (vs projected +16) Vitest delta.
- `<ParticipantChrome>` extracted from `App.tsx` to `apps/participant/src/layout/ParticipantChrome.tsx` per Decisions §9, so the route file mounts inside the shared chrome.
- `trackSession`/`untrackSession` lifecycle paired on mount/unmount per Decisions §4, closing the prior `part_ws_client` lifecycle debt.
- Playwright happy-path + not-found-terminal scenarios in `tests/e2e/participant-invite-acceptance.spec.ts`; the happy-path session uses `public` visibility so a non-host caller passes the predecessor's visibility-non-leak gate (test-infra fix, not a refinement-decision change). `playwright.config.ts` and `tests/e2e/participant-skeleton-smoke.spec.ts` were touched for shared setup wiring; `chromium-participant-skeleton` now runs 6 scenarios + 1 setup, all green.
- en-US gained 13 new keys under `participant.inviteAcceptance.*` / `participant.lobby.*` in `packages/i18n-catalogs/src/catalogs/en-US.json`; pt-BR + es-419 received 13 draft entries each (with matching `*.review.json` pending entries) — native-speaker review is registered as `frontend_i18n.i18n_participant_invite_acceptance_native_review` (Decisions §10).
- Vitest 3464 → 3481 (+17); `pnpm -F @a-conversa/participant build` green; `pnpm run test:e2e --project=chromium-participant-skeleton` green via the compose stack.
