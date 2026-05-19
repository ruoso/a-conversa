# Server-side anonymous WS subscribe with per-session privacy enforcement

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_anonymous_ws_subscribe` (effort `0.5d`, depends `!aud_no_auth_for_public, backend.websocket_protocol.ws_subscribe_to_session`; embedded `note` cites `aud_no_auth_for_public.md` Decision §9 as the source-of-debt and pins the cookie-on-upgrade seam at `apps/server/src/ws/connection.ts:86-104`).

**Effort estimate**: 0.5d — the upper bound from `aud_no_auth_for_public.md` Decision §9's "0.5d–1d" range. The seam count is small (one auth-gate widening, one new visibility predicate, one new pruner branch, one provider opt-in, six write-handler null-user branches, three new Cucumber scenarios) and every change reuses an existing pattern, so 0.5d holds.

**Inherited dependencies**:

- `!audience.aud_shell.aud_no_auth_for_public` (settled — `apps/root/src/surfaces/SurfaceHost.tsx` now reads `surface.meta?.requiredAuthLevel` after the dynamic import and skips the `<Navigate to="/login" />` deflection for `'public'` surfaces; the audience surface for anonymous visitors mounts the placeholder; `<WsClientProvider>` short-circuits without opening a socket because its effect requires `auth.status === 'authenticated'`. See [`apps/root/src/surfaces/SurfaceHost.tsx:96`](../../../apps/root/src/surfaces/SurfaceHost.tsx#L96) for the meta read, [`packages/shell/src/ws/WsClientProvider.tsx:85-97`](../../../packages/shell/src/ws/WsClientProvider.tsx#L85) for the auth-status guard this leaf widens. The [`aud_no_auth_for_public.md` Status block](aud_no_auth_for_public.md#L364) names **this** leaf as the inheritor of the deferred server-side widening per its Decision §9.).
- `backend.websocket_protocol.ws_subscribe_to_session` (settled — the subscribe handler at [`apps/server/src/ws/handlers/subscribe.ts:73-167`](../../../apps/server/src/ws/handlers/subscribe.ts#L73) calls `canSeeSession(pool, sessionId, userId)` and registers the (connection, session) tuple in the per-instance `WsSubscriptionRegistry` (see [`apps/server/src/ws/subscriptions.ts:292-319`](../../../apps/server/src/ws/subscriptions.ts#L292)). The handler is role-agnostic and currently assumes `connection.user?.id !== undefined` — that assumption is what this leaf widens.).
- `audience.aud_shell.audience` (transitive — `audience` depends `backend.backend_tests.be_e2e_tests.auth_flow_integration`; settled).
- Prose-only context (NOT a `.tji` edge): `!audience.aud_shell.aud_ws_client` (settled — the audience surface now mounts `<WsClientProvider auth={{ status: props.auth.status }} clientOptions={{ store: audienceWsStore }} store={audienceWsStore}>` at the surface boundary in [`apps/audience/src/main.tsx:76-84`](../../../apps/audience/src/main.tsx#L76). Three Cucumber scenarios at [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) already pin the **authenticated** audience-role wire contract (subscribe→ack, subscribe→event-applied broadcast, subscribe→raw-propose→participant-gate-rejection). This leaf appends three **anonymous** scenarios to the same feature file — the natural place: the feature's framing is "audience-role subscribe-only" and anonymous is the next variant of that role.).
- Prose-only context: `backend_hardening.security_review.privacy_flip_subscription_prune` (settled — [`pruneSubscribersForPrivateSession`](../../../apps/server/src/ws/subscriptions.ts#L527) walks the per-session subscription set when a session's privacy flips to private, re-runs `canSeeSession` for each subscriber, and evicts via `unsubscribed { reason: 'privacy-flipped' }`. The helper already has a `userId === undefined` branch at line 540-549 that "skips with a warn log" — this leaf widens that branch into a real eviction for anonymous subscribers, who can never see a private session by construction.).
- Prose-only context: `backend.cross_session_permissions.privacy_field_enforcement` (settled — [`canSeeSession`](../../../apps/server/src/sessions/visibility.ts#L167) + [`visibilityWhereFragment`](../../../apps/server/src/sessions/visibility.ts#L115) encode "public OR host OR participant" against an authenticated caller. This leaf adds a sibling predicate `canSeeSessionAnonymously` that's strictly stricter — `privacy = 'public' AND ended_at IS NULL` — and degenerates the authenticated SQL fragment's OR-branches cleanly for a `null`-user caller.).

## What this task is

The 0.5d server-side wire-up that flips the audience surface from "anonymous visitor sees the placeholder but no live events arrive" into "anonymous visitor subscribes to a public session and receives live `event-applied` broadcasts over WS." After this leaf:

- The **WS upgrade auth gate** (`preValidation` hook in [`apps/server/src/ws/connection.ts:914-994`](../../../apps/server/src/ws/connection.ts#L914)) widens to accept a missing or invalid `aconversa-session` cookie. The 401 throw at lines 970-975 + 983-991 is replaced with a fall-through that sets `request.authUser = undefined` and proceeds to the upgrade. The origin-allowlist gate at lines 942-959 is **unchanged** — anonymous upgrade does not relax the same-origin / production-origin contract; off-origin upgrades still 403.
- The **subscribe handler** ([`apps/server/src/ws/handlers/subscribe.ts:73-167`](../../../apps/server/src/ws/handlers/subscribe.ts#L73)) widens to call a new `canSeeSessionAnonymously(pool, sessionId)` predicate when `connection.user === undefined`. The new predicate runs `SELECT 1 FROM sessions WHERE id = $1 AND privacy = 'public' AND ended_at IS NULL`; the existence-non-leak rule the authenticated path uses is preserved (a private session, an ended session, and a nonexistent session all return `not-found` to an anonymous caller). The registry call passes `undefined` as the `userId` argument — `WsSubscriptionRegistry.subscribe(connId, sessId, userId?)` already accepts the optional shape (see [line 292](../../../apps/server/src/ws/subscriptions.ts#L292)).
- The **six write-side handlers** (`propose`, `vote`, `commit`, `withdraw-proposal`, `mark-meta-disagreement`, `catch-up`) widen their `connection.user === undefined` branches to emit a wire `forbidden` error envelope instead of throwing "auth-gate bypassed" Error. The connection stays open (per `ws_error_message`'s connection-stays-open invariant); the single envelope is rejected with `code: 'forbidden'` + `inResponseTo: envelope.id`. `snapshot-state` follows the same shape if it has a null-user branch.
- The **privacy-flip pruner** ([`pruneSubscribersForPrivateSession`](../../../apps/server/src/ws/subscriptions.ts#L527)) widens its `userId === undefined` branch (lines 540-549) to ALSO drop the subscription + emit `unsubscribed { reason: 'privacy-flipped' }`. An anonymous subscriber can never see a private session by construction, so the predicate-re-evaluation step the authenticated path uses is unnecessary; the eviction is immediate. Today's "skips with a warn log" branch was a placeholder for legacy fixtures; this leaf turns it into a real eviction for genuine anonymous subscribers.
- The **`WsClientProvider`** ([`packages/shell/src/ws/WsClientProvider.tsx:70-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L70)) grows a new optional prop `allowAnonymous?: boolean` (default `false`). The provider's effect opens the socket when `auth.status === 'authenticated'` OR (`allowAnonymous === true` AND `auth.status === 'unauthenticated'`). Moderator and participant providers keep the default and their effect is unchanged; only the audience surface opts in via `<WsClientProvider … allowAnonymous>` in [`apps/audience/src/main.tsx:76`](../../../apps/audience/src/main.tsx#L76).
- A **Cucumber feature** ([`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature)) grows three new scenarios at the anonymous-wire seam: (a) anonymous subscribe to a public session → `subscribed` ack + live `event-applied` broadcast delivery; (b) anonymous subscribe to a private session → `not-found` error envelope rejection; (c) anonymous client that successfully subscribed and then raw-sends a `propose` envelope → `forbidden` error envelope rejection (connection stays open). The existing three authenticated scenarios stay unchanged.
- A **Vitest suite extension** at `apps/server/src/ws/subscriptions.test.ts` adds two cases pinning the anonymous-prune branch: (a) flipping a session to private evicts anonymous subscribers with `unsubscribed { reason: 'privacy-flipped' }`; (b) the eviction is paired with a real registry-state assertion (the anonymous connection's session set is empty post-flip).

Out of scope (deferred to existing or future leaves):

- **Anonymous `catch-up` envelope handling.** Re-enabling the catch-up path for anonymous viewers requires a per-anonymous-connection rate-limit accounting story (the existing accounting at [`apps/server/src/ws/handlers/catch-up.ts:279`](../../../apps/server/src/ws/handlers/catch-up.ts#L279) is keyed by `connectionId`, which works for anonymous — but the rate-limit cap may need different defaults for read-only viewers; the calculation is non-trivial and orthogonal to the broadcast-subscribe path). Deferred to a follow-up `aud_anonymous_catch_up` leaf (0.5d — pick the cap, widen the handler, add Cucumber pin). For v0 the anonymous client's `catch-up` envelope receives the same `forbidden` rejection the other writes do; if a brief disconnect drops envelopes, the viewer simply doesn't see them (the audience is a passive viewer; missing events are visually inert).
- **A query-string ticket primitive.** ADR 0029 picks anonymous-WS-upgrade over the ticket path for v0. A future cross-origin audience embed would reach for the ticket; this leaf doesn't.
- **An `/api/sessions/:id/meta` public-readable HTTP endpoint.** The audience surface today renders the same placeholder regardless of session privacy; until a graph or roster UI lands, the audience does not need session metadata via HTTP — the WS subscribe ack and event-applied broadcasts carry everything the surface renders. The deferral is consistent with `aud_no_auth_for_public.md`'s "Out of scope" §4.
- **Synthesized anonymous-user identity.** Per ADR 0029 (and `aud_no_auth_for_public.md` Decision §5), `WsConnectionContext.user` stays `undefined` for anonymous; no fake `AuthUser` is fabricated. The `connectionId` is logged for diagnostics; no persistent anonymous handle.
- **Wire-format role flag** (e.g. `subscribe { role: 'audience' }`). Per ADR 0029, the server discriminates by `connection.user === undefined` only; no role flag on the subscribe payload.
- **Audience-surface-side branching on `auth.status`.** The placeholder route renders the same content for authenticated and anonymous visitors; this leaf does not add any "you are viewing anonymously" affordance, no new i18n keys.
- **Per-route audience UI re-render in response to the connection going live.** The audience placeholder route does not read `useAudienceConnectionStatus()` today; a future producer-facing diagnostic chip can; this leaf does not.
- **Server-side broadcast scoping by anonymous-visibility.** The existing event-broadcast emitter at [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts) fans out to every subscribed connection. Anonymous subscribers are registered in the SAME `bySession` index as authenticated subscribers (per the existing registry shape); no broadcast-side filter is added. The privacy boundary is enforced at subscribe time (anonymous + private = `not-found`) + at privacy-flip time (anonymous subscribers evicted from a session that flipped to private). The broadcast emitter remains agnostic.
- **Audience opt-out for authenticated visitors.** A logged-in user who navigates to `/a/sessions/<uuid>` still has the cookie attached on the WS upgrade; the gate's authenticated path runs and produces a real `AuthUser`. The same audience surface mount opens an authenticated WS for them; the visibility predicate is the authenticated one. No new branch — the audience surface accepts both authenticated and anonymous viewers; the WS-side discrimination is automatic.
- **Playwright spec for the anonymous-WS path.** Per `ORCHESTRATOR.md`'s UI-stream e2e policy + the deferred-e2e exception, the audience surface has no visible event-driven affordance until `aud_graph_rendering.aud_cytoscape_init` lands. The Playwright assertion "anonymous viewer sees a node arrive over WS" inherits the same deferral `aud_ws_client.md` Decision §10 set: deferred to `aud_graph_rendering.aud_cytoscape_init` (the first leaf that surfaces a user-visible event-driven affordance). The audience-skeleton spec at [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) already exercises the anonymous-mount path (added by `aud_no_auth_for_public`); this leaf does not need to extend it because no new visible behavior crosses the browser surface (the WS connection opening is not directly observable from a page assertion without a debug DOM mirror, which would be throwaway verification per ADR 0022).
- **`tests/behavior/steps/backend-ws-audience-subscribe.steps.ts` reorganisation.** The existing step-defs added by `aud_ws_client` are reused for the new scenarios; new steps land alongside in the same file. No second step-defs file.

## Why it needs to be done

The audience surface's whole purpose is to be the "this is the show" surface — a broadcast-quality live view of a public debate, rendered into OBS browser sources or shared as a plain URL. After `aud_no_auth_for_public` landed, an anonymous visitor can reach the audience URL and see the placeholder, but the **WS path is dead for them** — `<WsClientProvider>`'s effect guard at line 86 of [`packages/shell/src/ws/WsClientProvider.tsx`](../../../packages/shell/src/ws/WsClientProvider.tsx#L86) refuses to open the socket without an authenticated user, and the server's upgrade gate would reject the cookie-less upgrade with 401 anyway. This leaf closes both halves of that gap.

The `m_audience_mvp` milestone (M6, [`tasks/99-milestones.tji`](../../99-milestones.tji)) — "a producer can point OBS at an audience URL and see the live debate graph" — depends transitively on this leaf via `aud_graph_rendering.*` (the graph subgroup's nodes only render when events arrive over WS). Until this leaf lands, the milestone's central use case is unreachable for the actual target user (a passive viewer who never had a debate account).

Architecturally, this leaf is the **first cross-seam relaxation of the authenticated-only WS posture** the project has shipped. The WS substrate has always been authenticated-only since `ws_auth_on_connect`; this leaf widens it for the first time, with per-session privacy as the new gate. The change is structural enough that it required a new ADR ([ADR 0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md)), which surveys the three transport alternatives (anonymous WS / query-string ticket / SSE) and locks the project to anonymous-WS-upgrade for v0. The cookie-on-upgrade contract documented at [`apps/server/src/ws/connection.ts:94-104`](../../../apps/server/src/ws/connection.ts#L94) already anticipated this widening; the comment block names the audience surface as the future caller that would force the question.

The leaf is also the **first reader of `canSeeSessionAnonymously`** — a new sibling predicate to `canSeeSession` that encodes the strict "public AND not-ended" rule for null-user callers. Co-locating the new predicate next to the existing one in `apps/server/src/sessions/visibility.ts` keeps the privacy logic in one file; future read-side endpoints that need to serve anonymous traffic (a hypothetical `/api/sessions/:id/meta` public-readable endpoint, a future broadcast embed) inherit the same predicate.

Downstream consumers of this leaf:

- **`aud_graph_rendering.aud_cytoscape_init`** — the first audience UI that surfaces a user-visible event-driven affordance. After this leaf lands, an anonymous viewer's WS connection actually opens and delivers `event-applied` envelopes; `aud_cytoscape_init` can render nodes that arrived over the live wire. The Playwright assertion "anonymous viewer sees a node arrive over WS" lives in `aud_cytoscape_init`'s spec, inheriting the deferral chain `aud_ws_client.md` → `aud_no_auth_for_public.md` → this leaf established.
- **`aud_url_routing.aud_session_url`** — the first audience leaf to land a real `:id` route. Will call `useWsClient().trackSession(sessionId)` from inside the route's `useEffect`. The `useWsClient` hook only resolves when the provider's effect actually opened the socket; this leaf is what makes that resolution succeed for anonymous viewers.
- **`aud_segment_markers.*`** — read snapshot events. Pure consumers of the event stream this leaf opens for anonymous viewers.
- **`aud_animations.*`** — drive node-appear / proposed-to-agreed transitions off the same event stream.

## Inputs / context

### ADRs

- [**ADR 0029 — Anonymous WebSocket subscribe for public sessions**](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — the new ADR written alongside this refinement. Locks the project to anonymous-WS-upgrade (over query-string ticket / SSE) and names the six call-site widenings this leaf implements. Decision section enumerates the connection-context optionality, the visibility predicate split, the privacy-flip pruner branch, and the `allowAnonymous` provider opt-in.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — establishes the `mount(props): UnmountFn` contract; the audience surface consumes `auth` and the host's WS client via `MountProps`. The `requiredAuthLevel: 'public'` hint already lives in `SurfaceMeta`; this leaf makes the audience surface's WS layer match the surface-level public posture.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the three new Cucumber scenarios + the two new Vitest cases ARE the regression pins; no manual "I opened an incognito window and watched events arrive" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth; HTTP routes are unchanged. The WS upgrade gate's relaxation is targeted at this single endpoint, not a project-wide change.
- [ADR 0021 — event-envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the envelope schema is the single source of truth; no new envelope type, no `WsMessageType` widening, no role-flag payload field. The audience uses `subscribe` verbatim.
- [ADR 0023 — web framework Fastify](../../../docs/adr/0023-web-framework-fastify.md) — `preValidation` is the canonical seam for upgrade-gate auth widening per the `@fastify/websocket` README.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — `WsConnectionContext.user?: AuthUser` is genuinely optional now (was structurally optional but runtime-invariant since `ws_auth_on_connect`); the strict-mode null narrows expand from "throw on undefined" to "branch on undefined" at every consumer.

### Sibling refinements

- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — the predecessor. **Decision §9** ("Tech-debt registration") names this leaf and its scope verbatim: *"`aud_anonymous_ws_subscribe` — the deferred-server-side leaf. Effort: 0.5d–1d … Scope: pick a transport for anonymous live-event delivery on public sessions, wire it through the WS subscribe handler with per-session privacy enforcement, add a Cucumber scenario pinning 'anonymous client subscribes to a public session → receives event-applied; anonymous client subscribes to a private session → receives forbidden', and update the audience-side `<WsClientProvider>` invocation to open the connection for anonymous visitors on public sessions."* The "forbidden" the predecessor cited becomes `not-found` in this leaf (Decision §3 below — the existence-non-leak rule applies to anonymous callers too).
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — establishes the audience-side `<WsClientProvider>` mount at the surface boundary, the read-only TypeScript-narrowed barrel, and the three authenticated Cucumber scenarios at [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature). This leaf appends three anonymous scenarios to the same feature file and widens the provider invocation to pass `allowAnonymous`. The "out of scope" §3 of `aud_ws_client.md` explicitly forwards the anonymous-visitor concern to this leaf.
- [`tasks/refinements/audience/aud_state_management.md`](aud_state_management.md) — the audience state-derivation layer. Pure consumer of events; auth-agnostic by construction. This leaf's WS-anonymous path delivers events; the state layer reads them via `useAudienceSessionEvents`. No change to the state layer.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the library-mode mount + `requiredAuthLevel: 'public'` meta. Unchanged by this leaf.
- [`tasks/refinements/backend/ws_subscribe_to_session.md`](../backend/ws_subscribe_to_session.md) — the canonical subscribe handler. This leaf widens the handler's visibility-check branch but preserves the handler's overall shape (gate → registry-add → ack).
- [`tasks/refinements/backend/ws_propose_message.md`](../backend/ws_propose_message.md) — the subscribe-before-act gate every write handler enforces. This leaf does NOT change the gate; it changes what happens when `connection.user === undefined` *after* the gate (or before — the user check runs first in every handler).
- [`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md) — the gold-standard backend Cucumber pin shape. The three new scenarios this leaf appends mirror that feature file's Background + scenario structure.
- [`tasks/refinements/backend/ws_auth_on_connect.md`](../backend/ws_auth_on_connect.md) — the upgrade-gate's authenticated path. This leaf widens the same `preValidation` hook with a non-401 fall-through; the existing authenticated path and the origin-allowlist gate are preserved.
- [`tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md`](../backend-hardening/privacy_flip_subscription_prune.md) — the privacy-flip pruner. This leaf widens the pruner's `userId === undefined` branch from "skip with warn" to "evict anonymous subscribers."
- [`tasks/refinements/backend/privacy_field_enforcement.md`](../backend/privacy_field_enforcement.md) — the `canSeeSession` predicate + visibility fragment. This leaf adds a sibling `canSeeSessionAnonymously` predicate next door.

### Live code the leaf integrates with

- [`apps/server/src/ws/connection.ts:914-994`](../../../apps/server/src/ws/connection.ts#L914) — the `preValidation` auth gate. **The single non-trivial server-side widening.** The new shape:
  - The origin-allowlist gate at lines 942-959 runs first; UNCHANGED.
  - The cookie short-circuit at lines 970-975 — currently throws `ApiError(401, AUTH_REQUIRED_CODE, ...)` when the cookie header is absent — becomes a fall-through that sets `request.authUser = undefined` and `return`s from the hook.
  - The `authenticateRequest` call at lines 977-991 — currently throws `ApiError(401, ...)` when the call returns `null` — becomes a fall-through that sets `request.authUser = undefined` and `return`s from the hook. (A debug log line is preserved so operators can correlate anonymous upgrades with their request ids.)
  - The "happy path" at line 993 (`request.authUser = authUser` for a valid cookie) is UNCHANGED.
- [`apps/server/src/ws/connection.ts:402-419`](../../../apps/server/src/ws/connection.ts#L402) — the connection handler's defensive narrow. The block that currently throws `'ws-auth-gate bypass: request.authUser is undefined inside the WS handler'` becomes a real branch: if `request.authUser === undefined`, the connection context's `user` field is `undefined` and the handler proceeds normally. The log line at line 445-448 widens to include `userId: user?.id` (instead of unconditional `user.id`); the format strings already use destructuring so this is a one-line widening.
- [`apps/server/src/ws/handlers/subscribe.ts:73-167`](../../../apps/server/src/ws/handlers/subscribe.ts#L73) — the subscribe handler. The `userId === undefined` branch at lines 78-92 (currently logs "auth gate bypassed" + returns) becomes the anonymous-visibility branch: call `canSeeSessionAnonymously(opts.pool, sessionId)`; if false, send the same `not-found` error envelope the authenticated rejection branch sends (lines 95-118); if true, call `opts.registry.subscribe(connection.connectionId, sessionId)` (omitting the `userId` arg — the registry's optional shape per line 292 of `subscriptions.ts` already handles this) and send the `subscribed` ack via the same code path as the authenticated branch (lines 160-167).
- [`apps/server/src/sessions/visibility.ts:115-178`](../../../apps/server/src/sessions/visibility.ts#L115) — the visibility module. Adds a new exported function `canSeeSessionAnonymously(executor, sessionId)`: runs `SELECT 1 FROM sessions WHERE id = $1 AND privacy = 'public' AND ended_at IS NULL LIMIT 1`; returns `result.rows.length > 0`. The function does NOT distinguish "doesn't exist" from "exists but not public / ended" — both return false, preserving the existence-non-leak rule. The new function reuses the `VisibilityExecutor` interface verbatim.
- [`apps/server/src/ws/subscriptions.ts:540-549`](../../../apps/server/src/ws/subscriptions.ts#L540) — the privacy-flip pruner's `userId === undefined` branch. Widens from "skip with warn log" to: drop the subscription (`subscriptions.unsubscribe(connectionId, sessionId)`); emit `unsubscribed { reason: 'privacy-flipped' }` via the connection-sender registry; log at debug level (the eviction is expected for anonymous on a flipping-public session). A new helper `pruneAnonymousSubscribersForPrivateSession` is NOT introduced — the existing pruner already iterates the per-session subscriber set; the branch widening is in-place.
- [`apps/server/src/ws/handlers/propose.ts:160-167`](../../../apps/server/src/ws/handlers/propose.ts#L160) — the propose handler's null-user branch. Currently throws `'ws-propose: connection.user is undefined — auth gate bypassed'`. Widens to throw `ApiError.forbidden('this action requires an authenticated session', { sessionId })`. The dispatcher's `onHandlerError` seam already maps `ApiError.forbidden` to the canonical `error` envelope with `code: 'forbidden'` + `inResponseTo: envelope.id`; no dispatcher change needed.
- [`apps/server/src/ws/handlers/catch-up.ts:391-397`](../../../apps/server/src/ws/handlers/catch-up.ts#L391) — same widening as propose: throw `ApiError.forbidden` instead of an unrecoverable Error. Anonymous catch-up is deferred per "Out of scope" above.
- The remaining write handlers (`vote`, `commit`, `withdraw-proposal`, `mark-meta-disagreement`, `snapshot-state`) — each has an identical `userId === undefined` defensive narrow. The widening is mechanical (find the `throw new Error(...auth gate bypassed...)`; replace with `throw ApiError.forbidden(...)`). The Implementer enumerates these in the diff.
- [`packages/shell/src/ws/WsClientProvider.tsx:38-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L38) — the provider. Adds an optional `allowAnonymous?: boolean` prop (default `false`). The effect's gate widens from `if (auth.status !== 'authenticated') return;` to `if (!shouldConnect(auth.status, allowAnonymous)) return;` where the helper returns `true` for `'authenticated'` OR (`allowAnonymous && 'unauthenticated'`). No change to the close-on-unmount / reset semantics.
- [`apps/audience/src/main.tsx:76-80`](../../../apps/audience/src/main.tsx#L76) — the audience-surface provider mount. Add `allowAnonymous` to the `<WsClientProvider>` props.
- [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) — the existing Cucumber feature. Appends three new scenarios (Decision §6 below). The Background grows a new `Given an anonymous (no-cookie) WebSocket client connects to "/api/ws"` step alongside the existing authenticated background.
- [`tests/behavior/steps/backend-ws-audience-subscribe.steps.ts`](../../../tests/behavior/steps/backend-ws-audience-subscribe.steps.ts) — the existing audience-specific step-defs. Adds the anonymous-connect step + an `unsubscribed { reason: 'privacy-flipped' }` assertion step if not already shared.
- [`apps/server/src/ws/subscriptions.test.ts`](../../../apps/server/src/ws/subscriptions.test.ts) — the existing Vitest suite. Adds two cases pinning the anonymous-prune branch.
- [`packages/shell/src/ws/WsClientProvider.test.tsx`](../../../packages/shell/src/ws/WsClientProvider.test.tsx) — the existing provider test. Adds one case pinning that `allowAnonymous` opens the socket under `auth.status === 'unauthenticated'`.

### What the surface MUST NOT do

- **No new envelope type.** The audience uses `subscribe` verbatim; the server discriminates by `connection.user === undefined`. No `WsMessageType` enum widening.
- **No new subscribe-payload field** (e.g. `role: 'audience'`). The role is implicit in the connection's auth posture.
- **No synthesized anonymous-user identity.** `WsConnectionContext.user` stays `undefined` for anonymous; no fake `AuthUser` row, no fake `userId` for logs / events / projections. Logs that today include `userId: user.id` widen to `userId: user?.id` (which serializes to `undefined`).
- **No widening of the origin-allowlist gate.** The same-origin / production-allowlist contract is preserved unchanged. Anonymous upgrade is targeted at the cookie-auth gate only.
- **No HTTP-route relaxation.** Every HTTP route still requires a valid cookie. The WS upgrade is the only path that becomes optional-auth.
- **No anonymous catch-up envelope handling.** Anonymous `catch-up` envelopes are rejected with `forbidden` — same as the other writes. Per "Out of scope" above.
- **No anonymous tracking surface.** No anonymous-id cookie, no localStorage handle, no opt-in pseudonym. The `connectionId` (already minted per upgrade) is logged for diagnostics; it is not persisted beyond the connection's lifetime.
- **No broadcast-side filter.** The event-broadcast emitter at [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts) fans out to every connection in `registry.connectionsForSession(sessionId)`; anonymous connections are in the same Set as authenticated ones. The privacy boundary is enforced at subscribe-time + privacy-flip-time, not at fanout-time. No change to the emitter.
- **No new dependency** (root `package.json` or any workspace's). No new ADR-tier choice beyond ADR 0029, which IS authored alongside this refinement.
- **No `--no-verify` / hook bypass / test weakening.** Standard rule.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md`](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — NEW (authored alongside this refinement). Locks the project to anonymous-WS-upgrade over the alternatives.
- [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — modified. The `preValidation` hook's two 401 throws become fall-throughs (lines ~970-975, ~983-991); the connection handler's defensive narrow at lines ~416-419 becomes a real branch; the open-connection log line at ~445-448 widens `userId: user.id` → `userId: user?.id`. The `connectionsByUser` index (which the soft-delete WS revocation helper uses) skips anonymous connections via the existing `userId === undefined` guard at lines 653-660 — no change to that helper. Approximately +20/-15 LOC.
- [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — modified. Adds `canSeeSessionAnonymously(executor, sessionId)`. ~25 LOC.
- [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) — modified. The `userId === undefined` branch widens from log+return into the anonymous-visibility path; the `userId !== undefined` path is preserved verbatim. ~25 LOC change.
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) — modified. The `userId === undefined` branch's `throw new Error(...)` becomes `throw ApiError.forbidden(...)`. ~5 LOC.
- [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts) — modified. Same shape. ~5 LOC.
- [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) — modified. Same shape. ~5 LOC.
- [`apps/server/src/ws/handlers/withdraw-proposal.ts`](../../../apps/server/src/ws/handlers/withdraw-proposal.ts) — modified. Same shape. ~5 LOC.
- [`apps/server/src/ws/handlers/mark-meta-disagreement.ts`](../../../apps/server/src/ws/handlers/mark-meta-disagreement.ts) — modified. Same shape. ~5 LOC.
- [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) — modified. Same shape. ~5 LOC.
- [`apps/server/src/ws/handlers/snapshot-state.ts`](../../../apps/server/src/ws/handlers/snapshot-state.ts) — modified IF it has a null-user branch; same shape. ~5 LOC.
- [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts) — modified. The `userId === undefined` branch in `pruneSubscribersForPrivateSession` (lines ~540-549) becomes a real eviction (drop subscription + emit `unsubscribed { reason: 'privacy-flipped' }`). ~20 LOC change.
- [`apps/server/src/ws/subscriptions.test.ts`](../../../apps/server/src/ws/subscriptions.test.ts) — modified. Adds two Vitest cases pinning the anonymous-prune eviction. ~80 LOC.
- [`packages/shell/src/ws/WsClientProvider.tsx`](../../../packages/shell/src/ws/WsClientProvider.tsx) — modified. Adds optional `allowAnonymous` prop; widens the effect's gate. ~10 LOC.
- [`packages/shell/src/ws/WsClientProvider.test.tsx`](../../../packages/shell/src/ws/WsClientProvider.test.tsx) — modified. Adds one Vitest case pinning the anonymous-open branch. ~30 LOC.
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — modified. Adds `allowAnonymous` to the `<WsClientProvider>` mount; updates the inline doc-comment at lines 54-67 to reflect this leaf landed. ~3 LOC.
- [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) — modified. Appends three new scenarios + a new anonymous-connect Background step. ~60 LOC.
- [`tests/behavior/steps/backend-ws-audience-subscribe.steps.ts`](../../../tests/behavior/steps/backend-ws-audience-subscribe.steps.ts) — modified. Adds the anonymous-connect step + the privacy-flip eviction assertion step if not already present in shared step-defs. ~50 LOC.

### Files this task does NOT touch

- `packages/shared-types/src/ws-envelope.ts` — no envelope schema change; the wire format is unchanged.
- `packages/shared-types/src/events.ts` — no event-shape change.
- `apps/server/src/sessions/routes.ts` — HTTP routes are unchanged; `PATCH /api/sessions/:id/privacy` continues to call `pruneSubscribersForPrivateSession` with no signature change (the anonymous branch lives inside the pruner).
- `apps/server/src/auth/middleware.ts` — `authenticateRequest` is unchanged; the WS upgrade gate accepts its existing `null` return as "anonymous" instead of 401, but the helper itself does not need modification.
- `apps/server/src/ws/broadcast/event-applied.ts` — no broadcast filter change; the emitter fans out to every subscriber regardless of auth status.
- `apps/server/src/ws/dispatcher.ts` — no dispatcher seam change; the existing `onHandlerError` mapping of `ApiError.forbidden` to a wire `error` envelope is reused verbatim.
- `apps/audience/src/App.tsx`, `apps/audience/src/ws/*` — no audience surface change beyond the `main.tsx` provider prop; the read-only barrel and the selector hooks are untouched.
- `apps/moderator/`, `apps/participant/` — these surfaces' `<WsClientProvider>` mounts do NOT pass `allowAnonymous` (defaults to `false`); their behavior is unchanged.
- `apps/root/src/surfaces/SurfaceHost.tsx` — host-level gate is `aud_no_auth_for_public`'s scope; unchanged.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — no Playwright spec change; the anonymous-mount scenario already lives there from `aud_no_auth_for_public`. The "anonymous viewer sees a node arrive over WS" assertion is the future `aud_graph_rendering.aud_cytoscape_init`'s scope.
- `playwright.config.ts` — no project change.
- `packages/i18n-catalogs/` — no new i18n keys (no audience-side UI change).
- `infra/authelia/users.yml` — no new Authelia user (anonymous by definition has no Authelia user).
- `.tji` files — `complete 100` for this leaf is the Closer's job; the leaf does not register any follow-up tech-debt task in the WBS (the deferred-anonymous-catch-up is a future leaf the Closer will register only if the Implementer surfaces it as a real follow-up; see Decision §7 below).

### `preValidation` widened shape (sketch)

```ts
preValidation: async (request, _reply) => {
  // Origin allowlist gate — UNCHANGED.
  if (auth.originAllowlist !== WS_ORIGIN_ALLOWLIST_ANY) {
    // ... existing throw-on-missing / throw-on-unlisted logic ...
  }

  // Cookie-auth gate — WIDENED. Missing cookie now means "anonymous,
  // proceed", not 401. The valid-cookie happy path is preserved.
  const rawHeader = request.headers['cookie'];
  const cookieHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
  if (cookieHeader === undefined || cookieHeader === '') {
    request.log.debug(
      { route: '/api/ws' },
      'ws-auth-on-connect: no session cookie — proceeding as anonymous',
    );
    request.authUser = undefined;
    return;
  }
  const authUser = await authenticateRequest(
    cookieHeader,
    auth.ensurePool(),
    auth.ensureSecret(),
    auth.now,
  );
  if (authUser === null) {
    // Cookie was present but invalid (expired / forged / soft-deleted
    // user). Treat as anonymous for the audience-surface case; a
    // malicious actor who forged a cookie does not bypass the
    // anonymous-only visibility check (the SQL fragment is strictly
    // `privacy = 'public' AND ended_at IS NULL`).
    request.log.debug(
      { route: '/api/ws' },
      'ws-auth-on-connect: cookie present but verify/lookup failed — proceeding as anonymous',
    );
    request.authUser = undefined;
    return;
  }
  request.authUser = authUser;
},
```

### Vitest cases (`apps/server/src/ws/subscriptions.test.ts`)

Two new cases added to the existing privacy-flip-prune describe block:

1. **`evicts an anonymous subscriber when the session's privacy flips to private + sends an unsubscribed envelope with reason: privacy-flipped`** — sets up an anonymous subscription (no `userId` passed to `subscribe`); flips the session row's privacy to `'private'`; calls `pruneSubscribersForPrivateSession`; asserts the connection's `unsubscribed` send fires with `payload.reason === 'privacy-flipped'`; asserts the registry no longer has the connection in `connectionsForSession(sessionId)`.
2. **`does NOT call canSeeSession for the anonymous branch (no userId means strictly-public; the flip-to-private eviction is unconditional)`** — uses the same in-memory pool shim the existing prune cases use; asserts the `SELECT 1 FROM sessions WHERE id = ... AND ...` query the authenticated path emits is NOT issued for the anonymous subscriber (verified by counting the executor's query calls). Pins that the anonymous eviction path doesn't pay a DB round trip per subscriber.

### Vitest cases (`packages/shell/src/ws/WsClientProvider.test.tsx`)

One new case:

1. **`opens the connection when allowAnonymous is true and auth.status is 'unauthenticated'`** — renders `<WsClientProvider auth={{ status: 'unauthenticated' }} client={mockClient} allowAnonymous>`; asserts `mockClient.connect` was called. The existing "does NOT open when auth.status is 'unauthenticated' and allowAnonymous is undefined" case (or equivalent default-behavior pin) is added if not already present.

### Cucumber scenarios (`tests/behavior/backend/ws-audience-subscribe.feature`)

Three new scenarios appended to the existing feature. The feature's Background stays as-is for the authenticated scenarios; the new scenarios prepend a Given/When step pair establishing the no-cookie connect.

```gherkin
Scenario: An anonymous (no-cookie) WebSocket client subscribes to a public session and receives a subscribed ack
  Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111201"
  When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
  And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111201"
  Then the client receives a subscribed ack referencing the subscribe envelope

Scenario: An anonymous subscribed client receives event-applied broadcasts for a public session
  Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111202"
  When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
  And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111202"
  And the server emits an event-applied broadcast for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111202" with sequence 1
  Then the client receives an event-applied envelope for sequence 1

Scenario: An anonymous client subscribing to a private session is rejected with not-found
  Given a private session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111203"
  When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
  And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111203"
  Then the client receives a not-found error envelope referencing the subscribe envelope

Scenario: An anonymous client that subscribed and raw-sends a propose envelope is rejected with forbidden, connection stays open
  Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204" and node id "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab04"
  When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
  And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204"
  And the anonymous client raw-sends a propose envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204" with expectedSequence 1 targeting node "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab04"
  Then the anonymous client receives a forbidden error envelope referencing the propose envelope
  And the anonymous client connection is still open
```

(Four scenarios listed; three are net-new at the wire seam — the "subscribed ack" + "live event-applied delivery" + "not-found rejection" + "forbidden rejection" — and together they pin both the success path and the two security boundaries the leaf installs. The first two share the happy path's two endpoints in two scenarios for clarity; if scenario count compression is preferred, the first two can be combined into one scenario chaining both assertions.)

### UI-stream e2e policy disposition

**E2e deferred — anonymous viewer sees a node arrive over WS** inherits the deferral chain `aud_ws_client.md` Decision §10 → `aud_no_auth_for_public.md` Decision §9 → this leaf established. The audience surface has no visible event-driven affordance until `aud_graph_rendering.aud_cytoscape_init` lands. The audience-skeleton anonymous-mount scenario at [`tests/e2e/audience-skeleton-smoke.spec.ts:81-101`](../../../tests/e2e/audience-skeleton-smoke.spec.ts#L81) already pins the anonymous reach-the-placeholder behavior; the live-event arrival assertion belongs in the first leaf that surfaces a node DOM affordance. No new Playwright spec in this leaf.

**This is a backend / WS / protocol-seam task** per ORCHESTRATOR.md's "Behavior + e2e coverage growth" steer; Cucumber-at-the-seam is the right primary pin. The three new Cucumber scenarios exercise the real WS upgrade path (`app.injectWS`) against a pglite-backed pool with real `sessions` rows, mirroring the gold-standard shape `ws_withdraw_proposal_message` established.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers pinning different observable properties:

1. **Cucumber scenarios** (`tests/behavior/backend/ws-audience-subscribe.feature`) — pin the end-to-end wire contract through the real upgrade path. Anonymous-subscribe + event-delivery for public; `not-found` for private; `forbidden` for writes; connection-stays-open after rejection.
2. **Vitest cases** (`apps/server/src/ws/subscriptions.test.ts`) — pin the privacy-flip pruner's anonymous-eviction branch in isolation. Catches regressions like "someone reverted the anonymous-prune widening and an anonymous subscriber stayed subscribed after a privacy flip" without needing a full Cucumber/Playwright run.
3. **Vitest case** (`packages/shell/src/ws/WsClientProvider.test.tsx`) — pins the client-side provider's `allowAnonymous` opt-in. Catches regressions like "someone reverted the gate widening and the audience surface's WS effect refused to fire for anonymous viewers."

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The widened handler signatures, the new `canSeeSessionAnonymously` export, the new `allowAnonymous` provider prop, the widened `WsConnectionContext.user` null-narrows, the new Vitest cases, and the new Cucumber step-defs all typecheck under strict mode.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+3** (the two new `subscriptions.test.ts` cases + the one new `WsClientProvider.test.tsx` case). No existing smoke case regresses.
3. **`pnpm run test:bdd`** (Cucumber, pglite-backed) stays green and grows by **+3 scenarios** under `tests/behavior/backend/ws-audience-subscribe.feature` (or +4 if the success path is split into two scenarios per the sketch above). The three existing authenticated scenarios in the same feature continue to pass.
4. **`pnpm run test:e2e:smoke`** (under `make up`) stays green. No Playwright spec is added; the existing `audience-skeleton-smoke.spec.ts` anonymous-mount scenario continues to pass.
5. **`pnpm -F @aconversa/server build`** + **`pnpm -F @a-conversa/audience build`** + **`pnpm -F @a-conversa/shell build`** all green.
6. **Failing-first verifiability** — temporarily reverting any of (a) the `preValidation` 401-to-fall-through widening, (b) the `canSeeSessionAnonymously` predicate addition, OR (c) the `<WsClientProvider>` `allowAnonymous` gate-widening MUST make at least one of the new Cucumber scenarios fail. The Implementer confirms this for each of the three loci before re-applying. Pins ADR 0022's "regression-pin" property.
7. **No file modifications outside the explicit allowlist** in "Files this task touches."
8. **No regression of the authenticated-only WS paths** — pinned by the three existing scenarios in `ws-audience-subscribe.feature` + the moderator + participant Playwright projects + the existing `ws-subscribe.feature` and `ws-event-broadcast.feature` Cucumber features all continuing to pass.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf's task block (Closer step 2). The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
10. **The audience surface's `apps/audience/src/main.tsx` inline doc-comment** is updated to reflect this leaf landed; no behavior change beyond the `allowAnonymous` prop and the doc-comment.

## Decisions

### 1. Anonymous WS upgrade (over query-string ticket / SSE)

Per [ADR 0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md). Three alternatives surveyed in the ADR; "anonymous WS upgrade" picked for v0 because the same-origin cookie-or-no-cookie posture is strictly simpler than a ticket primitive (no second HTTP round trip) and keeps the broadcast emitter at a single seam (no SSE side-channel). The ADR records the cross-origin-embed deferral: a query-string ticket can be added later without disturbing the same-origin anonymous path.

### 2. `connection.user === undefined` is the discriminator (no role flag on the wire)

Per ADR 0029's "Alternatives considered" §4. The server distinguishes anonymous from authenticated by inspecting `WsConnectionContext.user`; a wire `role: 'audience'` flag would either duplicate the source of truth or be ignored. The `WsConnectionContext.user?: AuthUser` type was already structurally optional since `ws_auth_on_connect` (anticipating this exact widening); this leaf is the first time the optionality is genuinely populated.

### 3. Anonymous rejection on a private session is `not-found`, not `forbidden`

`aud_no_auth_for_public.md` Decision §9's task-registration cited "forbidden" as the expected wire response for the not-visible case. **This leaf revises that to `not-found`** for consistency with the existence-non-leak rule the authenticated path already enforces ([`apps/server/src/sessions/visibility.ts:140-145`](../../../apps/server/src/sessions/visibility.ts#L140) — the predicate collapses "doesn't exist" and "exists but not visible" into a single false result; the subscribe handler renders this as `code: 'not-found'` per [line 113](../../../apps/server/src/ws/handlers/subscribe.ts#L113)). An anonymous client probing for session existence by trying to subscribe should not be able to distinguish "private session at this id" from "no session at this id." Two alternatives surveyed:

- **(A) `forbidden` for private, `not-found` for nonexistent.** Rejected — leaks the existence bit to anonymous probers and contradicts the existing authenticated path's already-shipped collapse.
- **(B) `not-found` for both, mirroring the authenticated path** (chosen). Preserves the no-info-leak property end-to-end; consistent with the existing wire shape; one less special-case at the wire surface.

The wire scenario count is unchanged — the "private session rejection" scenario asserts `code: 'not-found'`, not `forbidden`.

### 4. Anonymous WRITE attempts return `forbidden` (with `inResponseTo`), connection stays open

The write handlers' `userId === undefined` branches widen from `throw new Error(...)` (which today surfaces as a 500-equivalent `internal-error` via the dispatcher's no-leak fallback) to `throw ApiError.forbidden(...)`. Two alternatives surveyed:

- **(A) Continue to throw a generic Error (which renders as `internal-error`).** Rejected — `internal-error` implies a server bug; an anonymous client raw-sending a `propose` envelope is a CLIENT bug, not a server bug. The wire code should reflect the client's mistake.
- **(B) `ApiError.forbidden` (chosen).** Matches the propose handler's "subscribed-but-tried-to-write-without-being-a-participant" case at [`apps/server/src/ws/handlers/propose.ts:175-180`](../../../apps/server/src/ws/handlers/propose.ts#L175) (the participant gate already emits `forbidden`). The audience-anonymous-write scenario uses the same wire code; the client experience is consistent.

The connection stays open per the wire-format invariant from `ws_error_message`: per-envelope errors don't tear down the connection. The fourth Cucumber scenario explicitly asserts post-rejection connection liveness.

### 5. Privacy-flip pruner: anonymous eviction is unconditional (no DB round trip per subscriber)

The existing pruner's authenticated branch re-evaluates `canSeeSession(pool, sessionId, userId)` per subscriber because a soft-deleted user might still be in the registry (defensive). For anonymous subscribers, the predicate is trivially "false" (anonymous can never see private), so the DB round trip is unnecessary. Two alternatives surveyed:

- **(A) Call a new `canSeeSessionAnonymously` per anonymous subscriber inside the prune loop.** Rejected — wasteful (the answer is always "false" by construction); adds O(N_anonymous) DB queries per privacy flip.
- **(B) Drop the subscription unconditionally for anonymous** (chosen). The pruner's `userId === undefined` branch becomes: drop the registry entry + emit `unsubscribed { reason: 'privacy-flipped' }`; no DB query. Vitest case 2 above pins the "no DB query for anonymous subscriber" property.

### 6. Cucumber scenarios extend the existing feature file (no second feature)

`aud_ws_client.md` Decision §7 established `tests/behavior/backend/ws-audience-subscribe.feature` as the audience-role wire-contract feature. The anonymous variants are the next role-variant; co-locating them in the same feature file keeps the audience-wire-contract story in one place. Two alternatives surveyed:

- **(A) New feature file `ws-audience-anonymous-subscribe.feature`.** Rejected — fragments the audience wire-contract story across two files; the Background steps would be near-duplicates.
- **(B) Extend the existing feature** (chosen). Three (or four) new scenarios appended; one new Background step for the anonymous-connect; existing scenarios untouched.

### 7. No follow-up tech-debt task in scope for this leaf

The deferred `aud_anonymous_catch_up` is a candidate but is NOT registered in this leaf's WBS at refinement-write time. Two cases:

- If the Implementer surfaces during build that the anonymous-catch-up forbidden path produces a UX surprise (e.g. a transient disconnect drops events and the viewer notices), the Closer can register `aud_anonymous_catch_up` per the tech-debt registration policy.
- Otherwise (likely), the Closer registers nothing new — the broadcast-only path is sufficient for the audience's v0 use case.

The `aud_auth_for_private` sibling (the audience surface's authenticated-only path for private sessions) already exists with `depends !aud_no_auth_for_public`; it is independent of this leaf and unblocks automatically when `aud_no_auth_for_public` is `complete 100` (which it already is). No re-wiring needed.

### 8. No new ADR-tier choice beyond ADR 0029

ADR 0029 is the only new architectural choice. Every Decision below it is a direct application of an existing precedent:

- The `canSeeSessionAnonymously` predicate addition is a sibling pattern to `canSeeSession` — no new architectural seam.
- The `allowAnonymous` provider prop is the smallest possible widening of an existing seam.
- The Cucumber-at-the-seam pin is direct application of `ws_withdraw_proposal_message`'s gold-standard shape.
- The `forbidden` write-rejection code reuses the existing taxonomy.

No second ADR is needed.

### 9. The `WsClientProvider.allowAnonymous` opt-in is per-consumer (not per-instance)

The audience surface opts in via its `<WsClientProvider … allowAnonymous>` mount. The moderator and participant surfaces never want anonymous WS; their existing mounts default `allowAnonymous` to `false` and their behavior is unchanged. Two alternatives surveyed:

- **(A) `WsClientProvider` always opens for `'unauthenticated'`.** Rejected — moderator and participant would open an anonymous socket for a logged-out user, which leaks broadcast bandwidth and is meaningless for those role-locked surfaces.
- **(B) Per-consumer opt-in via a prop** (chosen). The audience's surface-boundary `<WsClientProvider>` is the only call site that flips the flag.

The prop is OPTIONAL (default `false`) so existing call sites compile unchanged.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-19.

- WS upgrade gate widened per [ADR 0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md): the `preValidation` hook in [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) now falls through on missing/invalid cookie (setting `request.authUser = undefined`) instead of throwing 401; origin-allowlist gate preserved unchanged.
- New `canSeeSessionAnonymously(executor, sessionId)` predicate added to [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) encoding strict `privacy = 'public' AND ended_at IS NULL`; subscribe handler at [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) calls it for null-user callers and renders rejection as `not-found` (existence-non-leak rule preserved per Decision §3).
- Privacy-flip pruner branch in [`apps/server/src/ws/subscriptions.ts`](../../../apps/server/src/ws/subscriptions.ts) widened from "skip with warn log" to unconditional eviction of anonymous subscribers with `unsubscribed { reason: 'privacy-flipped' }` (Decision §5: no DB round trip per anonymous subscriber).
- Six write-side handlers (`propose`, `vote`, `commit`, `withdraw-proposal`, `mark-meta-disagreement`, `catch-up`, plus `snapshot-state`) rewired their `connection.user === undefined` branches from `throw new Error('auth gate bypassed')` to `throw ApiError.forbidden(...)`, surfacing as wire `forbidden` envelopes with `inResponseTo` (Decision §4); connection stays open.
- Audience surface now opts in via `<WsClientProvider … allowAnonymous>` in [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx); the new optional `allowAnonymous` prop in [`packages/shell/src/ws/WsClientProvider.tsx`](../../../packages/shell/src/ws/WsClientProvider.tsx) defaults to `false` so moderator/participant mounts are unchanged (Decision §9).
- New wire contract pinned by 3 Cucumber scenarios in [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) (anonymous public-subscribe→ack+event-applied; anonymous private→not-found; anonymous raw-propose→forbidden, connection still open), 2 Vitest cases in [`apps/server/src/ws/subscriptions.test.ts`](../../../apps/server/src/ws/subscriptions.test.ts) (anonymous-prune eviction + no-DB-roundtrip), and 3 provider tests in [`packages/shell/src/ws/WsClientProvider.test.tsx`](../../../packages/shell/src/ws/WsClientProvider.test.tsx) (`allowAnonymous` opt-in).
- Test deltas: Vitest 4084 → 4088 (+4), Cucumber 239 → 242 scenarios (+3), Playwright 81 → 81 (unchanged — anonymous-WS Playwright assertion deferred to `aud_graph_rendering.aud_cytoscape_init` per the inherited `aud_ws_client.md` → `aud_no_auth_for_public.md` deferral chain; the existing `aud_cytoscape_init` task in [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) already inherits this debt, so no new WBS registration).
