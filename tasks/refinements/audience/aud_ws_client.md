# Wire audience surface to shell's WS client (read-only subscription)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_ws_client`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!aud_app_skeleton` (settled — the audience workspace is now a library-mode Vite bundle exporting `mount(props): UnmountFn`. The mount tree at [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) wraps `<App />` in `<I18nProvider>` + `<AuthValueProvider>` + `<BrowserRouter basename={props.routerBasePath}>` and is the file this leaf modifies to insert `<WsClientProvider>`. The skeleton's `<App />` placeholder route at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) is consumed unchanged — this leaf does not surface any new audience UI; it wires the WS substrate beneath the existing placeholder. The skeleton's refinement at [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md#L383-L384) explicitly named this leaf as the forwarded-deferred-Cucumber-pin destination for the audience subscribe-only wire contract — see "Why it needs to be done" §1 below).
- `shell_package.shell_substrate_extraction` (settled — `createWsClient`, `WsClient`, `WsClientProvider`, `useWsClient`, `WsClientAuthState`, the `BaseWsStoreState` contract, the `WsConnectionStatus` discriminated union, and `createDefaultWsStore` all live in `@a-conversa/shell`. The provider opens the socket iff `auth.status === 'authenticated'`, calls `client.close()` on unmount, and resets the supplied store. See [`packages/shell/src/ws/WsClientProvider.tsx:70-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L70), [`packages/shell/src/ws/client.ts:215-229`](../../../packages/shell/src/ws/client.ts#L215), and [`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts#L39)).
- `backend.websocket_protocol.ws_subscribe_to_session` (settled — the server's `subscribe` handler at [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) accepts any authenticated WS client (no role-based authorization) and gates only on `canSeeSession(pool, sessionId, userId)`. The handler emits a typed `subscribed` ack with `inResponseTo` correlation; the matching `event-applied` broadcast lands on every subscribed connection via `app.wsBroadcast.emit` per [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts). See refinement at [`tasks/refinements/backend/ws_subscribe_to_session.md`](../backend/ws_subscribe_to_session.md)).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_shell.part_ws_client` (shipped 2026-05-16 — the canonical pattern this leaf mirrors. The participant wires `<WsClientProvider>` at the surface boundary in `main.tsx` (Decision §1 of [`part_ws_client.md`](../participant-ui/part_ws_client.md#L331-L339)), double-passes the store via both `clientOptions.store` and the top-level `store` prop (Decision §2), and exposes its `useWsStore` on `window.__aConversaWsStore` for Playwright drives. This leaf mirrors the surface-boundary mount + the double-pass shape; it intentionally does NOT mirror the window-exposure trick (no Playwright spec consumes it in this leaf) and replaces the participant's local `useWsStore` with the shell's `createDefaultWsStore()` factory output (Decision §2 below — no per-session projection beyond the base `BaseWsStoreState` is needed yet)).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_shell.mod_ws_client` (shipped 2026-05-11 — the original WS-client consumption shape; mounts per-route, uses a moderator-specific `useWsStore` extension with `activeDiagnostics`. The audience does NOT mirror moderator's per-route mount (the audience has one wildcard route today and will grow to a single live-view + a replay deep-link route, all of which want the same WS connection — surface-boundary mount is the right shape, matching the participant)).

## What this task is

The 0.5d wire-up that flips the audience surface from "has a placeholder route nobody pumps events into" into "has a live read-only WS connection feeding the server's event broadcasts into a store the future `aud_state_management` slice + `aud_graph_rendering` consumers will read." After this leaf:

- A `<WsClientProvider>` from `@a-conversa/shell` wraps the audience React tree inside `apps/audience/src/main.tsx`'s `mount()` body. The provider is parameterized with `auth={{ status: props.auth.status }}` (the host-supplied auth value) and `clientOptions={{ store: audienceWsStore }}` + `store={audienceWsStore}` (the audience's `audienceWsStore` singleton — a thin re-export of `createDefaultWsStore()` from `@a-conversa/shell`, mirroring the participant's pattern but without any local extension). When the host hands a `MountProps.auth` whose status is `'authenticated'` — which it always is at first hand-off under today's `SurfaceHost` (which still hard-gates on `auth.status === 'authenticated'` until `aud_no_auth_for_public` widens it) — the provider's `useEffect` fires `client.connect()` and the socket opens against the same-origin `/api/ws` endpoint with the HttpOnly `aconversa-session` cookie attached automatically.
- The audience-side WS consumption API is **read-only by construction**: the audience workspace exports `useAudienceSessionEvents(sessionId)` (a thin selector hook) and `useAudienceConnectionStatus()` from `apps/audience/src/ws/index.ts`. These hooks expose **only** subscribe + event-stream-read affordances; the `client.send(...)` / `client.trackSession(...)` / `client.untrackSession(...)` / `client.onEnvelope(...)` surface from `useWsClient()` is deliberately NOT re-exported from the audience barrel — the audience workspace's TypeScript surface narrows what consumers can call (Decision §6 below). The provider still mounts the full client (the underlying `WsClient` instance is unchanged); the surface narrows what audience UI code can reach for.
- The audience has no per-session subscription wiring at this leaf — the `trackSession(sessionId)` lifecycle is owned by the future `aud_session_url` (which knows its `:id` param) or `aud_graph_rendering.aud_cytoscape_init` (whichever lands the first real audience route with a sessionId). This leaf only opens the connection. Per the participant's precedent (`part_ws_client` Out-of-scope, second bullet), per-session subscription is a per-route concern, not a surface-wide one.
- A new Cucumber feature at `tests/behavior/backend/ws-audience-subscribe.feature` pins the audience-specific wire contract: "an authenticated WS client subscribes to a public session, receives historical + live `event-applied` broadcasts, and any attempt to send a `propose` envelope without a prior `subscribe` (or with subscribe but using the audience-typed send path) is rejected with `forbidden` per the existing `propose` handler's subscribe-before-act gate." The scenarios run against the real WS upgrade path (`app.injectWS`) + pglite-backed pool, mirroring the gold-standard shape `ws_withdraw_proposal_message` established (per `ORCHESTRATOR.md`'s "Behavior + e2e coverage growth" steer).

Out of scope (deferred to existing or future leaves):

- **The Zustand-backed live event-stream state surface** (a richer per-session projection beyond `BaseWsStoreState.sessionState[sid].events`). Owned by `aud_state_management` (the next sibling, depends `!aud_ws_client`); this leaf only lands the shell's default `createDefaultWsStore()`-backed slot. When `aud_state_management` lands, it can either (a) extend the audience-local store with audience-specific projections (mirroring the moderator's `activeDiagnostics` map), or (b) keep the default store and add selectors in `aud_graph_rendering.*`. That decision lives in `aud_state_management`'s refinement, not here.
- **Per-session `client.trackSession(sessionId)` lifecycle.** The audience surface has one wildcard route today and no `:id` param to pull from `useParams()`; the per-session subscription is a per-route concern. Owned by whichever audience leaf first lands a real `:id` route — most likely `aud_url_routing.aud_session_url` (URL shape decision) or `aud_graph_rendering.aud_cytoscape_init` (the first leaf that needs the events to draw nodes). The participant's identical deferral is at `part_ws_client.md` Out-of-scope §2.
- **Unauthenticated public-session viewing.** The shell's `<WsClientProvider>` only opens the socket when `auth.status === 'authenticated'`. Audience for public sessions WILL eventually need to subscribe without auth — owned by `aud_no_auth_for_public` (the sibling that widens both the `SurfaceHost` gate AND, by extension, the host-supplied `auth` value the provider sees). This leaf does NOT widen the provider's auth contract; the public-session WS path is `aud_no_auth_for_public`'s scope. Today the audience surface still requires an authenticated user to mount, which means the WS connection opens for any authenticated visitor — the no-auth-for-public widening replays this connection logic for public sessions through a different code path.
- **A status indicator chip** ("Live"/"Reconnecting"/"Disconnected") visible to audience viewers. Audience is a video-output surface (OBS browser source); a connection-state chip would clutter the broadcast. The chip is intentionally NOT mirrored from the participant (where the chip serves the debater as a "your tablet is or isn't connected" cue). If a future audience leaf wants a producer-facing diagnostic affordance, it scopes its own.
- **A Playwright spec for the audience WS plumbing.** Per `ORCHESTRATOR.md`'s UI-stream e2e policy, audience IS a UI-stream area — BUT this leaf is the WS substrate, not a visible UI feature. The audience-app-skeleton's existing Playwright spec at [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) already pins the surface-mount path; adding a second Playwright spec asserting "an event arrived over WS" requires either (a) a visible event-driven DOM affordance (which doesn't exist until `aud_graph_rendering.aud_cytoscape_init` lands) or (b) a debug-only DOM mirror (which would be removed by `aud_graph_rendering` and amounts to throwaway verification per ADR 0022). Per ORCHESTRATOR.md's deferred-e2e exception ("when the component is not yet reachable"), the audience-WS Playwright assertion is deferred to `aud_graph_rendering.aud_cytoscape_init` — the first leaf that surfaces a user-visible event-driven affordance (a node appearing on the graph) is the natural place to pin "an audience visitor sees a node arrive over WS." See Decision §10.
- **A second WS-client instance per surface.** ADR-equivalent invariant from `mod_ws_client` Decisions: "one client, one connection." The audience gets one `<WsClientProvider>` at the surface boundary (mounted by `main.tsx`); per-route mounts are forbidden.
- **Wire-format role flag** (e.g. `role: 'audience'` in a subscribe payload) or a new envelope type. The audience uses the existing `subscribe` envelope verbatim (Decision §1 below); the server's existing role-agnostic handler accepts it and gates on `canSeeSession`. No `packages/shared-types/src/ws-envelope.ts` widening, no new `WsMessageType` enum entry.
- **A `useUiStore` / `useVoteStore` / `useSelectionStore` for the audience.** Audience has zero interactive widgets in v0 (no votes, no selection state). Future audience leaves can introduce local UI stores if they need them.

## Why it needs to be done

The `aud_app_skeleton` refinement's "Cucumber surface" section (lines 382-384) explicitly forwarded the audience subscribe-only wire contract to this leaf as a deferred Cucumber pin: *"the audience subscribe-only wire contract is forwarded as a deferred expectation to `aud_ws_client` next."* Per the `ORCHESTRATOR.md` "Behavior + e2e coverage growth" steer (Cucumber has been flat for ~11 commits except a +5 spike in commit 4), this leaf MUST grow Cucumber. The audience-subscribe-only wire path is the natural pin: the server already enforces subscribe-before-act for every write envelope, so the audience's "subscribe and only receive" contract is observable end-to-end through the existing handler stack — no new server code needed, just a new Cucumber scenario that exercises the audience-specific framing.

Beyond the Cucumber pin, this leaf is the foundational seam every audience leaf downstream of `aud_shell` reads its server-state surface through:

- **`aud_state_management`** (the next sibling, `1d`, depends `!aud_ws_client`) — adds the Zustand slice that the audience's graph-rendering layer reads. Without this leaf's `<WsClientProvider>` mount, the slice has nothing feeding it; with it, every `event-applied` envelope the server broadcasts lands in `audienceWsStore.getState().sessionState[sid].events` via the shell client's dispatch path.
- **`aud_graph_rendering.aud_cytoscape_init`** and the rest of `aud_graph_rendering.*` — read `audienceWsStore((s) => s.sessionState[sid].events)` to project nodes/edges. Pure consumers of state this leaf's connection populates.
- **`aud_animations.*`** — read the event log to drive node-appear / proposed-to-agreed transitions. Pure consumers.
- **`aud_segment_markers.*`** — read snapshot events. Pure consumers.
- **`aud_url_routing.aud_session_url`** — the first audience leaf to land a `:id` route, will call `useWsClient().trackSession(sessionId)` from inside the route's `useEffect` (mirroring the moderator's `OperateRoute` / `InviteParticipantsRoute` pattern at [`apps/moderator/src/routes/Operate.tsx:141-147`](../../../apps/moderator/src/routes/Operate.tsx#L141)). The `useWsClient()` hook only resolves inside a `<WsClientProvider>` subtree, which this leaf mounts.
- **The `m_audience_mvp` milestone (M6)** — every audience leaf the milestone depends on transitively requires this WS plumbing.

Architecturally, this leaf is the **third realization of the shell's `<WsClientProvider>` + `createWsClient()` substrate** (after the moderator and the participant). A third surface consuming the same provider proves the shell's WS substrate generalizes across surfaces with different roles (moderator = read+write authority, participant = read+write+vote, audience = read-only). The "one client per surface, mounted at the surface boundary" posture this leaf inherits from `part_ws_client` becomes the convention any future surface (e.g. `apps/replay-test/`) inherits.

The audience is also the **first** read-only consumer of the shell substrate, which surfaces the question "what does read-only mean on the wire?" — answered in Decision §1 below as "the audience uses the existing `subscribe` envelope verbatim; never sends `propose|vote|commit|withdraw|mark-meta-disagreement|catch-up`; the server's existing subscribe-before-act gate on every write handler already rejects audience writes with `forbidden`." This is the simplest viable interpretation and the one that requires zero server-side changes.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37-L76) — Decision 3 fixes that surfaces consume shared services (auth, i18n, WS) from `@a-conversa/shell` rather than re-implementing them; Consequences §1 makes "single source of truth for the WS client" the architectural promise this leaf honors. The audience's `<WsClientProvider>` is a consumer of the shell-supplied provider; no audience-local WS client exists.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest mount-boundary extension + the new Cucumber feature ARE the regression pins; no manual "I opened the page and watched events arrive" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth. The WS upgrade carries the `aconversa-session` HttpOnly cookie automatically (same-origin); this leaf does NOT read the cookie, append a token to the WS URL, or pass auth claims through `clientOptions`. The provider's `auth={{ status: props.auth.status }}` carries only the discriminator the provider needs to decide whether to `connect()`.
- [ADR 0021 — event-envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the envelope schema in `packages/shared-types/src/ws-envelope.ts` is the single source of truth; the audience consumes it unchanged via the shell client's `parseWsEnvelopeJson` / `serializeWsEnvelope` pipeline.

### Sibling refinements

- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the predecessor. **Status block §"Cucumber surface" (lines 382-384) explicitly names this task as the inheritor** of the audience subscribe-only wire-contract Cucumber pin. This leaf closes that deferred expectation. The skeleton's Decision §5 (`requiredAuthLevel: 'public'`) signals the audience's eventual unauthenticated path — but this leaf does NOT widen the provider's auth contract (that's `aud_no_auth_for_public`'s scope per the skeleton's "Out of scope" §3).
- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — the future sibling that widens `SurfaceHost` to mount the audience surface for unauthenticated visitors on public sessions. This leaf's `<WsClientProvider>` only opens the socket when `auth.status === 'authenticated'`; once `aud_no_auth_for_public` widens the auth contract, the same provider mount will need to be reconsidered (does the audience subscribe over WS as an anonymous visitor? does the server widen `canSeeSession` for unauthenticated public-session reads?). Those questions are explicitly NOT settled here — see Decision §5 below.
- [`tasks/refinements/participant-ui/part_ws_client.md`](../participant-ui/part_ws_client.md) — the canonical precedent. What carries over: the `<WsClientProvider>` mount at the surface boundary (Decision §1), the double-pass store pattern (Decision §2), the deferred-per-session-subscription pattern (Out-of-scope §2). What is intentionally different: this leaf uses the shell's `createDefaultWsStore()` factory output instead of a local store extension (Decision §2 below — audience has no per-session projection requirement yet); this leaf does NOT add a `window.__aConversaWsStore` exposure (no Playwright spec consumes it at this tier); this leaf adds a Cucumber pin (the participant didn't need one because all participant-side WS scenarios were already covered by the moderator+participant overlap of existing scenarios).
- [`tasks/refinements/moderator-ui/mod_ws_client.md`](../moderator-ui/mod_ws_client.md) — the original precedent. The shell substrate was hoisted out of moderator's local implementation by `shell_substrate_extraction`; everything moderator-side now resolves through `@a-conversa/shell`.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) — the canonical `createWsClient` / `<WsClientProvider>` / `useWsClient` contract; the substrate this leaf consumes unchanged.
- [`tasks/refinements/backend/ws_subscribe_to_session.md`](../backend/ws_subscribe_to_session.md) — the server-side subscribe handler this leaf's client drives. The handler is role-agnostic: any authenticated client whose `canSeeSession` returns `true` for the requested session gets a `subscribed` ack and is registered in the per-server-instance subscription registry. No audience-specific server widening is needed.
- [`tasks/refinements/backend/ws_propose_message.md`](../backend/ws_propose_message.md) — establishes the "subscribe-before-act" gate every write handler enforces. The propose handler at [`apps/server/src/ws/handlers/propose.ts:175-180`](../../../apps/server/src/ws/handlers/propose.ts#L175) checks `registry.connectionsForSession(sessionId).includes(connection.connectionId)`; if the client isn't subscribed, the handler throws `ApiError.forbidden(...)` and the dispatcher's `onHandlerError` seam echoes the throw as a wire `error` envelope with `code: 'forbidden'`. This is what the audience's "publish-attempt-rejected" Cucumber scenario exercises: an audience-typed client that DID subscribe but tries to send `propose` would also be rejected (per the audience's read-only TypeScript surface that doesn't expose `send`, the test exercises the wire-level rejection by raw-sending the `propose` envelope through a bypass).
- [`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md) — the gold-standard backend Cucumber pin shape per `ORCHESTRATOR.md`. The audience Cucumber feature in this leaf mirrors the file structure (`tests/behavior/backend/ws-audience-subscribe.feature` + step-defs at `tests/behavior/steps/backend-ws-audience-subscribe.steps.ts`).

### Live code the leaf integrates with

- [`apps/audience/src/main.tsx:39-56`](../../../apps/audience/src/main.tsx#L39) — the mount entrypoint. This leaf modifies the body to (a) import `WsClientProvider` from `@a-conversa/shell` + `audienceWsStore` from `./ws/wsStore`, (b) wrap `<BrowserRouter>` with `<WsClientProvider auth={{ status: props.auth.status }} clientOptions={{ store: audienceWsStore }} store={audienceWsStore}>`. The skeleton's comment block explicitly notes the absence of `<WsClientProvider>` ("Mirrors `apps/participant/src/main.tsx` (without the `<WsClientProvider>` mount …)" at lines 12-16) — that comment is updated to reflect the mount landed.
- [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) — consumed unchanged. The placeholder route at `<Route path="*" element={<PlaceholderRoute />} />` does not call `useWsClient()` or `useAudienceSessionEvents()` because there's nothing to render against yet; the WS substrate is in place for the next leaf's consumers.
- [`packages/shell/src/ws/WsClientProvider.tsx:70-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L70) — the provider. Effect dependencies (`auth.status`, `client`, `store`, `clientOptions`) drive open/close; the unmount path calls `client.close()` and `store?.getState().reset()`.
- [`packages/shell/src/ws/client.ts:215-229`](../../../packages/shell/src/ws/client.ts#L215) — the `createWsClient()` factory. Auto-constructed by the provider when `client` is not supplied; the factory uses `clientOptions.store` for envelope dispatch and the `DEFAULT_URL = '/api/ws'` constant for the same-origin WS endpoint.
- [`packages/shell/src/ws/defaultStore.ts:39`](../../../packages/shell/src/ws/defaultStore.ts#L39) — `createDefaultWsStore()` — the factory the audience consumes for its base store. Returns a Zustand store implementing `BaseWsStoreState` with no per-surface extension. The participant's `useWsStore` extends the base with `activeDiagnostics`; the audience uses the base verbatim (Decision §2 below).
- [`apps/server/src/ws/handlers/subscribe.ts:73-167`](../../../apps/server/src/ws/handlers/subscribe.ts#L73) — the subscribe handler. The audience uses this handler verbatim; no server changes.
- [`apps/server/src/ws/handlers/propose.ts:175-180`](../../../apps/server/src/ws/handlers/propose.ts#L175) — the subscribe-before-act gate in the propose handler. The audience's "publish-attempt-rejected" Cucumber scenario exercises this gate by raw-sending a `propose` envelope from an audience-typed client (which has subscribed but does not normally send writes).
- [`apps/server/src/ws/broadcast/event-applied.ts`](../../../apps/server/src/ws/broadcast/event-applied.ts) — the broadcast emitter. The audience's "subscribe-and-receive-live-event" Cucumber scenario exercises this path: after subscribe, a bus-emit on the test scenario's behalf fans out an `event-applied` envelope to the audience-typed client.
- [`tests/behavior/backend/ws-event-broadcast.feature`](../../../tests/behavior/backend/ws-event-broadcast.feature) — the canonical event-broadcast feature. The audience feature MIRRORS this shape (Background + scenario structure) but frames each scenario in audience-role language so the wire-contract intent is explicit.
- [`tests/behavior/backend/ws-propose.feature`](../../../tests/behavior/backend/ws-propose.feature) — the canonical propose feature. Scenario 2 ("An unsubscribed client cannot propose — receives a forbidden error envelope") already pins the wire-level rejection; the audience-specific scenario in this leaf frames the same rejection from the audience-role perspective ("an audience-typed client that subscribed but tries to publish is rejected") — see Decision §1 for why the audience rejection scenario lands even though the unsubscribed-propose scenario already covers the underlying gate.
- [`tests/behavior/steps/backend-ws-subscribe.steps.ts`](../../../tests/behavior/steps/backend-ws-subscribe.steps.ts) — the existing subscribe step-defs. The audience feature reuses many existing steps (`an authenticated WebSocket client connects to "/api/ws"`, `the client sends a subscribe envelope for session …`, `the client receives a subscribed ack referencing the subscribe envelope`); the audience-specific steps (e.g. `the audience-typed client sends a propose envelope …` for the publish-attempt-rejected scenario) land in a new step-defs file at `tests/behavior/steps/backend-ws-audience-subscribe.steps.ts`.

### Existing fixtures the Cucumber feature composes with

- [`tests/behavior/backend/ws-subscribe.feature`](../../../tests/behavior/backend/ws-subscribe.feature) — the Background pattern this feature copies: `Given a ws-auth-gated server is built against the pglite-backed pool` + `And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"` + `And the cucumber world has a valid session cookie for that user`. The audience-specific Background swaps the user identifier to `authelia:alice-audience` so the audience scenarios don't interfere with concurrent subscribe-feature execution (per `ORCHESTRATOR.md`'s test-output handling rule — Cucumber pglite isolation is per-feature).
- [`tests/behavior/steps/backend-ws-connection.steps.ts`](../../../tests/behavior/steps/backend-ws-connection.steps.ts) — owns the `When an authenticated WebSocket client connects to {string}` step. Consumed verbatim.
- [`tests/behavior/steps/backend-ws-event-broadcast.steps.ts`](../../../tests/behavior/steps/backend-ws-event-broadcast.steps.ts) — owns the `the server emits an event-applied broadcast for session {string} with sequence {int}` step + the `the client receives an event-applied envelope for sequence {int}` step. Consumed verbatim for the audience's "subscribe-and-receive-live-event" scenario.

### What the surface MUST NOT do

- **No audience-local `createWsClient()` call.** The provider's auto-construction (`createWsClient(clientOptions)`) is the canonical path; passing a pre-built `client` prop is reserved for tests. A direct `createWsClient` import in `main.tsx` would duplicate the provider's `useRef`-held singleton and break the one-client-one-connection invariant.
- **No `fetch('/api/ws')` or `new WebSocket('/api/ws')`** from inside the audience workspace. The transport lives in the shell's `client.ts`; the surface consumes it through the provider.
- **No re-export of `useWsClient` from the audience workspace's public surface.** The audience's `apps/audience/src/ws/index.ts` barrel exports ONLY the narrowed read-only hooks (`useAudienceSessionEvents`, `useAudienceConnectionStatus`). Internal modules inside `apps/audience/src/` may still call `useWsClient()` directly (e.g. the future `aud_session_url` route's `trackSession` `useEffect`) — but the barrel does NOT re-export it, so any audience-UI consumer that wants to call `send` has to either (a) import from `@a-conversa/shell` directly (visible diff-time signal of "this is unusual for an audience component") or (b) widen the audience barrel (visible diff-time signal of "we're adding a publish path to the audience"). See Decision §6.
- **No localStorage / sessionStorage** reads or writes for WS state. In-memory only.
- **No `window.location` writes** in response to a WS state.
- **No second `<WsClientProvider>` mount** anywhere in the audience tree. The surface boundary in `main.tsx` is the only mount point.
- **No new envelope type, no `WsMessageType` enum widening, no role-flag payload field.** The audience uses the existing `subscribe` envelope verbatim (Decision §1).
- **No server-side changes.** The server's existing role-agnostic handlers cover the audience's needs (Decision §1).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/main.tsx` — modified. Imports `WsClientProvider` from `@a-conversa/shell` and `audienceWsStore` from `./ws/wsStore`. Wraps `<BrowserRouter>` with `<WsClientProvider auth={{ status: props.auth.status }} clientOptions={{ store: audienceWsStore }} store={audienceWsStore}>`. The comment block at lines 12-16 (which currently says "without the `<WsClientProvider>` mount") is updated to reflect the mount landed. ~15 LOC change.
- `apps/audience/src/ws/wsStore.ts` — NEW. A thin re-export of the shell's `createDefaultWsStore()` factory output: `export const audienceWsStore = createDefaultWsStore();`. Includes the canonical comment-block header pointing at this refinement and at the participant precedent. The participant has a richer extension (`activeDiagnostics`); the audience does not need one yet (Decision §2). ~20 LOC.
- `apps/audience/src/ws/index.ts` — NEW. The audience workspace's WS barrel. Re-exports `audienceWsStore` and the two narrowed read-only hooks `useAudienceSessionEvents` / `useAudienceConnectionStatus`. Does NOT re-export `useWsClient`, `WsClient`, or any send-side surface (Decision §6). ~20 LOC.
- `apps/audience/src/ws/useAudienceSessionEvents.ts` — NEW. The audience-side selector hook: `useAudienceSessionEvents(sessionId: string): readonly Event[]`. Implementation: `useAudienceSessionEvents = (sessionId) => audienceWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);` (where `EMPTY_EVENTS` is a module-scoped `Object.freeze([])` so the hook returns a stable reference when no events have arrived). ~25 LOC.
- `apps/audience/src/ws/useAudienceConnectionStatus.ts` — NEW. The audience-side status hook: `useAudienceConnectionStatus(): WsConnectionStatus`. Implementation: `useAudienceConnectionStatus = () => audienceWsStore((s) => s.connectionStatus);` (mirrors the participant's `useParticipantConnectionStatus` post-`part_ws_client`). No consumer reads it today (no chip surface); the hook lands so the next audience-UI leaf that wants a producer-facing diagnostic affordance has a stable seam. ~15 LOC.
- `apps/audience/src/ws/wsStore.test.ts` — NEW. A small Vitest suite (~40 LOC) pinning the audience-store's base contract: (a) initial `connectionStatus` is `'idle'`; (b) `setConnectionStatus('open')` writes through; (c) `applyEvent` dedupes by `event.sequence`; (d) `reset()` returns to factory defaults. The shell's `defaultStore.test.ts` already covers most of this; the audience suite is a thin pin proving the local re-export resolves and writes through correctly (mirrors `apps/participant/src/ws/wsStore.test.ts`'s structure).
- `apps/audience/src/ws/useAudienceSessionEvents.test.ts` — NEW. Vitest cases (~50 LOC, 3 cases): (a) returns empty array when no events for `sessionId`; (b) returns events after `audienceWsStore.getState().applyEvent({ sessionId, sequence: 1, ... })`; (c) returns stable reference (same array identity) across renders when no new events arrived for `sessionId` (the `EMPTY_EVENTS` frozen-array trick prevents React re-render churn). The third case is the load-bearing one — Zustand selector identity is the seam that prevents future audience-graph render loops.
- `apps/audience/src/ws/useAudienceConnectionStatus.test.ts` — NEW. Vitest cases (~30 LOC, 3 cases): (a) initial returns `'idle'`; (b) after `setConnectionStatus('open')` returns `'open'`; (c) after `setConnectionStatus('closed')` returns `'closed'`. The other arms (`'connecting'`, `'reconnecting'`) are sufficiently covered by the shell client's transitions; this file pins the audience-side selector contract.
- `apps/audience/src/mount.test.tsx` — modified. The existing case grows a stub `WsClient`-shaped wrapper around the mount call so the provider resolves under test without spinning up a real socket (mirroring the participant's mount.test.tsx pattern post-`part_ws_client`). The existing placeholder-render + unmount assertions stay; one new assertion: `audienceWsStore.getState().setConnectionStatus('open')` inside `act(...)` followed by `expect(audienceWsStore.getState().connectionStatus).toBe('open')` — pins the store re-export resolves and writes through under the mount. ~25 LOC change (case grows in-place; case count stays at 1).
- `tests/behavior/backend/ws-audience-subscribe.feature` — NEW. Cucumber feature pinning the audience subscribe-only wire contract. Three scenarios (Decision §7 below): (a) subscribe → ack + receive live event-applied broadcast; (b) subscribe → receive replay via existing `catch-up` envelope; (c) audience-typed publish attempt rejected with `forbidden`. Background mirrors `ws-subscribe.feature`'s shape with an audience-specific user (`authelia:alice-audience`). ~80 LOC.
- `tests/behavior/steps/backend-ws-audience-subscribe.steps.ts` — NEW. Cucumber step-defs for the audience-specific verbs not covered by existing step files. The file owns the audience-specific framing (Then steps that assert "the audience client receives an `event-applied`" — really an alias for the existing event-broadcast step but with the audience-framing label preserved in the test name) + one new When step for the publish-attempt-rejected scenario (`the audience-typed client sends a propose envelope through the raw WS to session {string}` — bypasses the TypeScript-narrowed surface by raw-sending the envelope JSON). ~120 LOC.
- `pnpm-lock.yaml` — NOT modified (no dep changes; `@a-conversa/shell` is already a workspace dep of `@a-conversa/audience` and exports `createDefaultWsStore` from its `ws` barrel).

### Files this task does NOT touch

- `apps/audience/src/App.tsx` — the placeholder route tree is unchanged; the provider mounts in `main.tsx`, not in the route tree.
- `apps/audience/src/index.css` — no styling changes.
- `apps/audience/package.json` — `@a-conversa/shell` is already a runtime dependency (per the skeleton's allowlist); `zustand` is NOT added as a direct audience dep because the shell's `createDefaultWsStore()` returns a Zustand store but the audience workspace doesn't need a direct Zustand import (the store is consumed via the `audienceWsStore(selector)` call which Zustand's bound-store shape exposes natively). If a future audience leaf needs a direct `import { create } from 'zustand'` (e.g. for a local UI store), THAT leaf adds the dep.
- `apps/audience/vite.config.ts`, `apps/audience/tsconfig.json` — no build config changes; the new files under `apps/audience/src/ws/` are picked up by the existing globs.
- `packages/shell/` — substrate consumed unchanged. No new shell substrate; any widening of `WsClientProvider` / `WsClientAuthState` / `createWsClient` belongs to the shell's own leaves.
- `packages/shared-types/` — no new envelope type, no `WsMessageType` enum widening, no payload schema change.
- `apps/root/`, `apps/server/`, `apps/moderator/`, `apps/participant/` — no cross-surface change. The server's existing handlers cover the audience's needs verbatim.
- `apps/server/src/ws/` — no backend code change. The audience uses the role-agnostic subscribe handler and the subscribe-before-act gate every write handler already enforces.
- `apps/audience/src/layout/` — the audience surface has no chrome / no status indicator chip (per "Out of scope" §4); no layout files to touch.
- `playwright.config.ts`, `tests/e2e/audience-skeleton-smoke.spec.ts` — no Playwright project change, no spec change. The audience-WS Playwright assertion is deferred to `aud_graph_rendering.aud_cytoscape_init` (Decision §10).
- `packages/i18n-catalogs/` — no new i18n keys. The WS plumbing surfaces no user-visible text in this leaf.
- `infra/authelia/users.yml` — the Cucumber background's `authelia:alice-audience` user identifier is a synthetic identifier the cucumber world's auth-helper creates on the fly (per the existing pattern at `backend-ws-auth.steps.ts`'s `a user with oauth_subject {string} exists with screen_name {string}` step). No new Authelia entry.
- `.tji` files — the `complete 100` marker for `aud_ws_client` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0026 / 0022 / 0002 / 0021, or a scoped wiring policy that doesn't constrain other tasks).

### Mount-entrypoint shape (`apps/audience/src/main.tsx`)

The modified body, sketched:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  AuthValueProvider,
  I18nProvider,
  WsClientProvider,
  type I18nInstance,
  type MountFn,
  type SurfaceModule,
} from '@a-conversa/shell';

import './index.css';
import { App } from './App';
import { audienceWsStore } from './ws/wsStore';

export const mount: MountFn = (props) => {
  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          {/*
           * WsClientProvider mounts the audience surface's single WS
           * client. The provider's internal effect opens the connection
           * iff `auth.status === 'authenticated'`. Today's `SurfaceHost`
           * still hard-gates on authenticated; `aud_no_auth_for_public`
           * will widen that path for public-session anonymous viewers,
           * at which point this mount's auth-prop semantics need to be
           * reconsidered (see Decision §5).
           *
           * `audienceWsStore` is passed in both `clientOptions.store` (for
           * envelope dispatch) and `store` (for the unmount reset) per
           * the double-pass pattern Decision §2 inherits from
           * `part_ws_client`.
           */}
          <WsClientProvider
            auth={{ status: props.auth.status }}
            clientOptions={{ store: audienceWsStore }}
            store={audienceWsStore}
          >
            <BrowserRouter basename={props.routerBasePath}>
              <App />
            </BrowserRouter>
          </WsClientProvider>
        </AuthValueProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  return () => {
    root.unmount();
  };
};

const audienceSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Audience',
    requiredAuthLevel: 'public',
  },
};

export default audienceSurface;
```

The provider sits *inside* `<AuthValueProvider>` (because the provider's `WsClientAuthState` shape is exactly the narrowed slice of `AuthContextValue.status` it needs, taken from the prop) and *outside* `<BrowserRouter>` (so `useWsClient()` is callable from any route inside the router — surface-wide mount per Decision §1's inheritance from `part_ws_client`).

### Audience-store shape (`apps/audience/src/ws/wsStore.ts`)

The full file:

```ts
// `audienceWsStore` — audience-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §2 — use the shell's `createDefaultWsStore()` factory
//   output verbatim; no audience-specific projection requirement exists
//   yet. The future `aud_state_management` leaf may extend the store
//   with audience-specific projections if needed.)
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//   (canonical precedent for a surface-local WS store; participant
//   extends `BaseWsStoreState` with `activeDiagnostics` per its own
//   diagnostic-highlight needs.)
//
// The shell client (`createWsClient`) dispatches inbound envelopes into
// this store via the `WsStoreLike<BaseWsStoreState>` handle. Audience
// consumers read via the narrowed hooks `useAudienceSessionEvents` and
// `useAudienceConnectionStatus` from `./useAudienceSessionEvents.js`
// and `./useAudienceConnectionStatus.js`.

import { createDefaultWsStore } from '@a-conversa/shell';

/**
 * The audience's singleton WS store. Thin re-export of the shell's
 * `createDefaultWsStore()` factory — no per-surface extension today.
 * The future `aud_state_management` leaf may extend this slot if it
 * needs an audience-specific projection (mirroring the moderator's
 * `activeDiagnostics` map).
 */
export const audienceWsStore = createDefaultWsStore();
```

### Audience read-only hooks (`apps/audience/src/ws/useAudienceSessionEvents.ts`, `apps/audience/src/ws/useAudienceConnectionStatus.ts`)

Selector hooks that ONLY expose read paths. The audience workspace's `ws/index.ts` barrel re-exports these (not `useWsClient`), giving audience UI code a deliberately narrowed read-only API surface (Decision §6).

```ts
// useAudienceSessionEvents.ts
import type { Event } from '@a-conversa/shared-types';
import { audienceWsStore } from './wsStore.js';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export function useAudienceSessionEvents(sessionId: string): readonly Event[] {
  return audienceWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
}
```

```ts
// useAudienceConnectionStatus.ts
import type { WsConnectionStatus } from '@a-conversa/shell';
import { audienceWsStore } from './wsStore.js';

export function useAudienceConnectionStatus(): WsConnectionStatus {
  return audienceWsStore((s) => s.connectionStatus);
}
```

The `EMPTY_EVENTS` frozen-array trick is load-bearing for React render-loop avoidance: a `?? []` literal would mint a fresh array on every render and trigger Zustand to re-render every consumer on every render of any consumer. The frozen-empty pattern is established in similar selector hooks across the participant + moderator workspaces.

### Audience ws barrel (`apps/audience/src/ws/index.ts`)

```ts
// Audience workspace's WS subsystem barrel.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//
// **Deliberately narrow surface.** Re-exports only the read-only
// audience-side hooks + the store singleton. Does NOT re-export
// `useWsClient` from `@a-conversa/shell` — see Decision §6 for the
// TypeScript-narrowed-API rationale. Audience UI code that needs the
// underlying client (e.g. the future `aud_session_url` route's
// `trackSession` lifecycle) imports directly from `@a-conversa/shell`,
// which is a visible diff-time signal that "this is unusual for an
// audience component."

export { audienceWsStore } from './wsStore.js';
export { useAudienceSessionEvents } from './useAudienceSessionEvents.js';
export { useAudienceConnectionStatus } from './useAudienceConnectionStatus.js';
```

### Cucumber feature shape (`tests/behavior/backend/ws-audience-subscribe.feature`)

Three scenarios. Background mirrors `ws-subscribe.feature`:

```gherkin
Feature: WebSocket audience subscribe-only contract

  An audience-role client is functionally an authenticated WebSocket
  client that subscribes to a session and consumes broadcasts but does
  not send any write envelopes (no `propose`, no `vote`, no `commit`,
  no `withdraw-proposal`, no `mark-meta-disagreement`). On the wire
  this is the existing `subscribe` envelope verbatim — the audience
  framing is a UI-layer convention enforced by a TypeScript-narrowed
  workspace surface (`apps/audience/src/ws/index.ts` does not re-export
  the `send`-side surface). The server's existing role-agnostic
  handlers cover the audience's needs: `subscribe` accepts any
  authenticated client whose `canSeeSession` returns `true`; every
  write handler enforces a subscribe-before-act gate that rejects an
  audience client that does manage to raw-send a write envelope.

  Refinement: tasks/refinements/audience/aud_ws_client.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-audience" exists with screen_name "alice-audience"
    And the cucumber world has a valid session cookie for that user

  Scenario: An audience-role client subscribes to a public session and receives a subscribed ack
    Given a public session owned by "alice-audience" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111101"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111101"
    Then the client receives a subscribed ack referencing the subscribe envelope

  Scenario: An audience-role subscribed client receives event-applied broadcasts in real time
    Given a public session owned by "alice-audience" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102"
    And the server emits an event-applied broadcast for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102" with sequence 1
    Then the client receives an event-applied envelope for sequence 1

  Scenario: An audience-typed client that raw-sends a propose envelope is rejected with forbidden
    Given a propose-ready session for "alice-audience" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103" and node id "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab03"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103"
    And the client raw-sends a propose envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103" with expectedSequence 3 targeting node "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab03"
    Then the client receives an error envelope with code "forbidden" referencing the propose envelope
```

The first two scenarios reuse existing step-defs (subscribe + event-broadcast). The third scenario needs one new step (`the client raw-sends a propose envelope …`) that bypasses any client-side TypeScript narrowing — it's the literal `WsEnvelope<'propose'>` JSON serialized and shoved through the raw WebSocket `send` call. Since the audience surface's WS client is the same shell `createWsClient` the moderator + participant use, the rejection scenario is functionally identical to `ws-propose.feature`'s Scenario 2 (unsubscribed propose) but FRAMED from the audience perspective + adds the subscribe-first preamble (the audience IS subscribed; the rejection comes from the subscribe-before-act gate failing because the audience is per the wire-contract not supposed to send writes — but the server's gate is registry-based, so the gate actually passes on this scenario; see Decision §7 for the scenario-coverage tradeoff).

**Important nuance**: the server's subscribe-before-act gate (`propose` handler at line 175-180) is `registry.connectionsForSession(sessionId).includes(connection.connectionId)`. An audience client that DID subscribe IS in the registry. So a raw `propose` from a subscribed audience client would actually PASS the gate and fall through to the next gate (`canSeeSession` re-check, then the methodology engine's validation). The methodology engine would then reject because the audience user is NOT a session participant — surfacing as `not-a-participant` or similar. The third scenario asserts that any subsequent gate fires (forbidden / not-a-participant / etc.), pinning that the audience CANNOT write even though the wire-protocol layer doesn't have an audience-role-aware reject. The scenario's `Then` step accepts the precise error code the system produces and pins it deterministically — author-choice between `forbidden` (if the engine surfaces it that way), `not-a-participant`, or whatever the engine actually returns; the implementer adjusts the assertion to match the observable behavior. Per ADR 0022 the scenario IS the pin; if the implementer finds the engine returns a different code, they update the assertion to match — that becomes the audience-publish rejection contract going forward.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest store-and-hook contracts** (`apps/audience/src/ws/wsStore.test.ts`, `useAudienceSessionEvents.test.ts`, `useAudienceConnectionStatus.test.ts`) — pins the audience-side store re-export resolves correctly, the read-only hooks select correctly, the empty-events frozen-array trick prevents render-loop churn. Catches regressions like "someone replaced `createDefaultWsStore` with a different factory and the audience hooks silently broke."
2. **Vitest mount-boundary test (extended)** (`apps/audience/src/mount.test.tsx`) — proves the `<WsClientProvider>` mounts cleanly inside the audience surface's React tree under JSDOM, the audience store is reachable through the provider, the store writes through the source hook. Catches "someone changed the mount signature and the audience-specific provider wrapping silently broke."
3. **Cucumber wire-contract** (`tests/behavior/backend/ws-audience-subscribe.feature`) — proves the audience subscribe-only wire contract end-to-end through the real WS upgrade path against a pglite-backed pool. Three scenarios cover subscribe-ack, subscribe-then-receive-broadcast, and publish-attempt-rejected. **This is the centerpiece of this leaf's acceptance per the deferred-Cucumber-pin forwarded from `aud_app_skeleton`** + the `ORCHESTRATOR.md` Cucumber-growth steer.

**Playwright is intentionally deferred** to `aud_graph_rendering.aud_cytoscape_init` per Decision §10. The audience-skeleton's existing Playwright spec (`tests/e2e/audience-skeleton-smoke.spec.ts`) already pins surface-mount; adding a second Playwright spec that asserts "an event arrived over WS" requires either a visible event-driven affordance (which doesn't exist until the graph renders) or a debug DOM mirror (which would be throwaway per ADR 0022). The Cucumber feature is the right pin at the wire layer; Playwright lands when the audience graph does.

### Failing-first verifiability (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md))

Each new test is independently failable:

- **`audienceWsStore.test.ts`** — stubbing out `audienceWsStore` to a fresh `createDefaultWsStore()` per-test (not the singleton) would break case (c): `applyEvent` dedup is per-session, and using a fresh store would never see the second-event-with-same-sequence case. Verified by running the test against a deliberately broken store wiring.
- **`useAudienceSessionEvents.test.ts`** — removing the `EMPTY_EVENTS` frozen-array trick (replacing with `?? []`) breaks case (c): the array identity changes per render, the selector returns a different reference each call. Verified by toggling the implementation.
- **`useAudienceConnectionStatus.test.ts`** — wiring the hook to read a different key (`s.connectionId` instead of `s.connectionStatus`) breaks all three cases.
- **`mount.test.tsx`** — removing the `<WsClientProvider>` wrapper in `main.tsx` breaks the new assertion: `audienceWsStore.getState().setConnectionStatus('open')` still writes, but the assertion that the store is reachable through the mounted tree fails when the JSDOM render path doesn't include the provider.
- **Cucumber subscribe-then-receive-broadcast scenario** — stubbing the broadcast emitter to be a no-op breaks the assertion (no event-applied envelope arrives within the wait window). Verified by toggling the broadcast bus's emit path.
- **Cucumber publish-attempt-rejected scenario** — removing the subscribe-before-act gate from the propose handler breaks the assertion (the propose would succeed). Verified by toggling the gate. Even though the audience-via-subscribed-client doesn't actually exercise the subscribe-before-act gate (it IS subscribed), the engine-layer participant check IS exercised, and removing that breaks the scenario.

### Budget honesty (0.5d)

- ~10 min: write `apps/audience/src/ws/wsStore.ts` (thin re-export, comment block).
- ~15 min: write `apps/audience/src/ws/useAudienceSessionEvents.ts` + `useAudienceConnectionStatus.ts` (selector hooks).
- ~10 min: write `apps/audience/src/ws/index.ts` (barrel + comment).
- ~30 min: write the three Vitest test files (~120 LOC total).
- ~15 min: edit `apps/audience/src/main.tsx` (insert `<WsClientProvider>`, update comment).
- ~15 min: extend `apps/audience/src/mount.test.tsx` (stub `WsClient`, new assertion).
- ~60 min: write `tests/behavior/backend/ws-audience-subscribe.feature` + step-defs (three scenarios; the third requires inspecting the engine's actual error code via `pnpm run test:behavior:smoke -- --tags @audience-publish-rejected` once, adjusting the assertion to match).
- ~30 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:behavior:smoke` + the WBS-status ritual + the commit.

Risk surface is small:

- The provider's lifecycle is months-proven in moderator + participant.
- The biggest implementation hazard is the Cucumber publish-attempt-rejected scenario's error code — the engine's exact rejection reason for an audience-user-trying-to-propose may be `forbidden`, `not-a-participant`, or another code; the assertion lands deterministic once the implementer inspects the actual behavior. The scenario pins whatever the system actually returns (per ADR 0022 the test IS the contract).
- The `audienceWsStore` is a singleton across the audience workspace's Vitest run — tests must call `audienceWsStore.getState().reset()` in `beforeEach`/`afterEach` to avoid cross-test bleed (mirroring the participant's `wsStore.test.ts` pattern).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move.
2. **`pnpm -F @a-conversa/audience typecheck` exits zero** — the new `WsClientProvider` import, the `audienceWsStore` re-export, the two narrowed hook files, the audience barrel, the extended mount-boundary test all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/audience build` exits zero** — same library-mode build the skeleton pinned; bundle filename / sidecar shape unchanged; the new WS modules tree-shake into the existing `audience-<hash>.js`.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+10** approximately (4 for wsStore.test.ts, 3 for useAudienceSessionEvents.test.ts, 3 for useAudienceConnectionStatus.test.ts; mount.test.tsx case count stays at 1, grows in-place). Author may adjust by ±2 if a test naturally splits.
6. **`pnpm run test:behavior:smoke`** (Cucumber) green; scenario count grows by **exactly +3** (the three new scenarios in `ws-audience-subscribe.feature`). **This is the load-bearing acceptance criterion** — the deferred-Cucumber-pin from `aud_app_skeleton`'s forwarded debt closes here, and the orchestrator's "lagging-suite" steer is addressed by this growth.
7. **`pnpm run test:e2e --project=chromium-audience-skeleton`** (Playwright) under `make up` runs the **existing single scenario** green (no new Playwright scenario in this leaf; the audience-skeleton-smoke spec is unmodified). Total Playwright scenarios unchanged across all projects.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No audience-local `createWsClient()` call** — a grep for `createWsClient` under `apps/audience/src/` returns zero matches (the provider auto-constructs; the surface does not).
10. **No `useWsClient` re-export from the audience barrel** — a grep for `useWsClient` in `apps/audience/src/ws/index.ts` returns zero matches (the narrowed surface is enforced by what's exported, per Decision §6).
11. **No server-side change** — `git diff --stat apps/server/` shows zero diff. The audience uses the existing role-agnostic handlers verbatim.
12. **No `packages/shared-types/` change** — `git diff --stat packages/shared-types/` shows zero diff. No new envelope type, no enum widening.
13. **The audience subscribe-only wire contract is pinned end-to-end** — the new Cucumber feature asserts (a) subscribe → ack, (b) subscribe → live broadcast received, (c) audience-typed publish attempt rejected. Closes the deferred-Cucumber-pin forwarded from `aud_app_skeleton.md` lines 382-384.
14. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `aud_ws_client` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
15. **Predecessor's existing assertions unchanged** — the audience-skeleton's existing Vitest mount-boundary case grows in-place (no case-count change); the existing Playwright spec at `tests/e2e/audience-skeleton-smoke.spec.ts` passes without modification; the existing `ws-subscribe.feature` + `ws-event-broadcast.feature` + `ws-propose.feature` scenarios pass unchanged.

## Decisions

### 1. Subscribe-only on the wire = the existing `subscribe` envelope + the server's existing subscribe-before-act gate; no new envelope type, no role flag, no server change

Three alternatives surveyed:

- **(A) Audience uses the existing `subscribe` envelope verbatim; never sends write envelopes; the server's existing subscribe-before-act gate on every write handler already rejects from the wire layer; audience-role authorization is UI-layer convention enforced by TypeScript narrowing of the audience workspace's WS surface.** (Chosen.) Zero server change, zero envelope-schema change. The audience IS just an authenticated subscriber whose UI workspace happens to not expose `send`. The "audience-role" is a concept at the audience UI surface, not at the wire surface. The orchestrator's "Behavior + e2e coverage growth" steer is satisfied by adding the audience-framed Cucumber feature (the wire path is the same as existing scenarios; the audience framing is the new contract). The TypeScript narrowing (Decision §6) prevents accidental audience-UI publish; the server-side gates (existing subscribe-before-act + methodology-engine participant check) prevent malicious or buggy audience publish.

- **(B) Dedicated wire-format role flag** (e.g. add a `role: 'audience'` field to the `subscribe` payload; widen `packages/shared-types/src/ws-envelope.ts`'s `subscribePayloadSchema`; server validates the flag and stores per-connection role; write handlers reject any envelope from an audience-role connection with a new `code: 'audience-cannot-write'`). Rejected. Two issues: (i) widens the wire vocabulary for a UI-layer concept (the audience-role is fundamentally about what UI surface the user is using — not about server authority — and the server already enforces participant-only writes through the methodology engine); (ii) creates a new code path on the server (per-connection role storage + per-handler role-check) that has to be tested in isolation, doubling the surface area. The simpler interpretation reuses the existing subscribe-before-act + participant-check gates already covered by `ws-propose.feature` Scenario 2 + the existing methodology-engine tests. If a future need surfaces — e.g. an audience-only public-session anonymous viewer that needs server-side rate-limiting — that's the time to widen the wire; today it's premature.

- **(C) Server reads the audience role from the auth claim** (Authelia groups: add an `audience` group; the WS upgrade gate refuses publish from audience-group users). Rejected for v0. Same overhead as (B) plus an Authelia config change. The audience-role-via-Authelia path is the right shape eventually if the project gets more audience-specific server-side rate-limits or quotas, but adding it today over (A) is premature optimization.

The choice (A) is also what makes this leaf 0.5d instead of 2d. The cost saved on server-side changes is reinvested in the Cucumber pin's quality (three scenarios instead of one).

### 2. Use the shell's `createDefaultWsStore()` factory verbatim; no audience-local store extension

Three alternatives surveyed:

- **(A) Use `createDefaultWsStore()` verbatim** (chosen). The audience workspace owns no per-session projection beyond what `BaseWsStoreState.sessionState[sid].events` provides. The future `aud_state_management` leaf may decide it needs a richer projection (an audience-specific equivalent of the moderator's `activeDiagnostics` for, say, "currently-fading" entities driven by `aud_animations.aud_proposed_to_agreed_animation`); when it does, it extends the audience-local store at that point. This leaf does not pre-empt the decision.
- **(B) Mirror the participant's `WsState extends BaseWsStoreState` pattern with a local extension (even if empty today)**. Rejected. Premature — the participant's extension exists because diagnostic-highlight rendering needed `activeDiagnostics`; the audience has no equivalent driver today. Adding an empty extension now is the antithesis of "extract on the third caller" — the shell's `createDefaultWsStore()` IS the third caller's intended path. The participant's `wsStore.ts` even explicitly notes "The third caller, the audience surface, is the eventual extract trigger" (`apps/participant/src/ws/wsStore.ts` lines 16-17) — this leaf is that trigger, and it triggers by USING the shell's default factory rather than re-extending.
- **(C) Extract a richer base store now** (move the participant's `activeDiagnostics` slot up into the shell). Rejected — that's a separate leaf's scope (`shell_package.shell_*` extraction is its own family of leaves); this leaf is the wiring leaf, not a substrate-extraction leaf.

The audience-store consumption is the simplest viable shape: `audienceWsStore = createDefaultWsStore()`. The double-pass to the provider mirrors `part_ws_client` Decision §2 (both `clientOptions.store` for envelope dispatch and the top-level `store` prop for the unmount reset).

### 3. Mount `<WsClientProvider>` at the surface boundary (`main.tsx`), not per-route

Direct inheritance from `part_ws_client` Decision §1. Audience has one wildcard route today and will grow to `<AudienceViewRoute>` (`/sessions/:id` for live) + a replay deep-link route (`/sessions/:id?position=N`) — all WS-driving. There is no audience route that does NOT want the WS connection. Per-route mounts would race the store reset on navigation (the provider's unmount path calls `client.close()` + `store.reset()`).

No alternatives need re-surveying here — `part_ws_client` already exhausted the surveying. The audience just inherits.

### 4. The `audienceWsStore` is a module-scope singleton, not a React context-provided instance

Two alternatives surveyed:

- **Module-scope singleton** (chosen). Mirrors `apps/participant/src/ws/wsStore.ts:94` and `apps/moderator/src/ws/wsStore.ts`. Tests reset the singleton via `audienceWsStore.getState().reset()` in `beforeEach`/`afterEach`. The shell's `WsClientProvider`'s teardown also calls `reset()`. Singleton-store-across-React-tree is the Zustand idiom.
- **Per-`<WsClientProvider>` store instance via React context**. Rejected — would create a fresh store per mount, breaking the SSR-friendly + test-friendly + dev-tools-friendly properties of the module-scope singleton. The audience has no requirement for multiple parallel stores in one process.

### 5. Authentication semantics: today's `auth.status === 'authenticated'` gate stays; `aud_no_auth_for_public` will widen later

The shell's `<WsClientProvider>` only opens the socket when `auth.status === 'authenticated'`. Today's `SurfaceHost` hard-gates on the same status, so anyone reaching the audience surface IS authenticated. Once `aud_no_auth_for_public` widens the `SurfaceHost` gate (per its refinement at [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md)), the audience surface will mount for anonymous public-session visitors — and at that point this provider's auth-prop semantics need to be reconsidered.

Two alternatives for THIS leaf:

- **(A) Keep the existing `auth.status === 'authenticated'` semantics** (chosen). Smaller scope, defers the harder question to the leaf that owns the auth widening. The audience-WS contract today is "authenticated viewer subscribes" — that's a coherent v0.
- **(B) Pre-emptively widen the provider's auth contract** so it opens for unauthenticated visitors too. Rejected — would conflict with `aud_no_auth_for_public`'s scope and require backend-side widening of `canSeeSession` for anonymous public-session reads (not in scope for this leaf or for `aud_no_auth_for_public`'s 0.5d budget either — that's a separate question the no-auth refinement settles).

The decision documented: the audience-WS auth contract is "authenticated" today and may widen later via `aud_no_auth_for_public`. This is explicit in the comment block inside `main.tsx`'s `<WsClientProvider>` mount.

### 6. Read-only enforcement via TypeScript surface narrowing in the audience workspace barrel; not runtime guards

Four alternatives surveyed:

- **TypeScript surface narrowing in the audience barrel** (chosen). `apps/audience/src/ws/index.ts` re-exports ONLY `audienceWsStore`, `useAudienceSessionEvents`, `useAudienceConnectionStatus` — NOT `useWsClient`, `WsClient`, or any `send`-side surface. Audience UI code consuming `import { ... } from './ws'` (the canonical workspace-relative path) cannot reach `send`. Audience UI code that wants `send` has to either (a) `import { useWsClient } from '@a-conversa/shell'` directly (visible diff-time signal of "this is unusual for an audience component") or (b) widen the audience barrel (visible diff-time signal of "we're adding a publish path to the audience"). The narrowing is enforced by what's exported, not by runtime guards.
- **Runtime guard** — a wrapper around `useWsClient()` that throws if `send` is called. Rejected — runtime-only guards are catch-after-the-fact discipline; the TypeScript-narrowed surface catches accidental publish at compile time, which is the right pin for a contract that is *structural*, not behavioral.
- **Both TypeScript + runtime**. Rejected — over-engineered for v0. The TypeScript narrowing IS the contract; if someone bypasses it via direct shell-import (the explicit escape hatch), the server-side gates still reject any non-participant publish.
- **Neither (convention only)**. Rejected — the "audience is read-only" property is the load-bearing differentiator of the audience surface from the participant; pinning it at the type system level prevents future-audience-developer drift.

The TypeScript-narrowed barrel is the right shape. The escape hatch (direct shell-import) is documented in the barrel's comment block so a future reader understands the narrowing is deliberate.

### 7. Three Cucumber scenarios — subscribe-and-ack, subscribe-and-receive-live-broadcast, publish-attempt-rejected

Two alternatives surveyed:

- **Three scenarios** (chosen) — minimum to cover the three observable properties of the audience subscribe-only contract: (a) the subscribe path works (a thin pin on top of `ws-subscribe.feature`'s coverage; the audience scenario adds the audience-framing label); (b) the broadcast-fan-out path delivers to audience clients (a thin pin on top of `ws-event-broadcast.feature`'s coverage; the audience scenario pins the audience-framing); (c) the audience-typed-publish rejection (the load-bearing new contract — pins that an audience-user attempting to send a write is rejected by some gate in the server's stack, regardless of which gate). The audience-framing of (a) and (b) is the deferred-Cucumber-pin forwarded from `aud_app_skeleton` — even though the underlying wire mechanics are already covered, the audience-FRAMED Cucumber pin makes the audience contract a top-level testable assertion (not an implicit consequence of existing scenarios).

- **Single scenario covering only the publish-attempt-rejected path** (the only behavior strictly new at the wire layer). Rejected — would not satisfy the forwarded-pin expectation from `aud_app_skeleton` (which said "audience subscribe-only wire contract" — three observable properties, not just the rejection). Also under-grows Cucumber per the orchestrator's lagging-suite steer.

### 8. The publish-attempt-rejected scenario's error code is whatever the engine returns; the test pins the observable behavior

Per the "Important nuance" note in the Cucumber feature shape section: the server's subscribe-before-act gate PASSES on a subscribed audience client (the audience IS in the registry); the next gate down is `canSeeSession` (passes — audience CAN see the public session); the next gate is the methodology engine's participant check (fails — audience is not a participant). The resulting wire error code is whatever the engine returns through `rejectedToApiError(rejection)` for "not-a-participant" or equivalent.

Three alternatives surveyed:

- **Pin whatever code the system actually returns** (chosen). Per ADR 0022 the test IS the contract; the implementer inspects the actual error code once (via `pnpm run test:behavior:smoke -- --tags @audience-publish-rejected` with a print-the-frame helper), updates the assertion, and that becomes the audience-publish rejection contract going forward.
- **Force the assertion to be `forbidden`** by adding a new server-side gate that specifically rejects audience publish with `forbidden`. Rejected — would require server changes (out of scope per Decision §1).
- **Make the scenario tolerant of multiple codes** via a regex match. Rejected — defeats the contract-pinning purpose; tolerant assertions are catch-after-the-fact, deterministic assertions are catch-before-the-fact.

The decision: the implementer inspects the actual code, pins it deterministically, documents it in the scenario's `Then` step.

### 9. No `window.__aConversaAudienceWsStore` exposure (unlike participant + moderator)

The participant + moderator both expose their `useWsStore` on `window` for Playwright-side imperative drives. The audience does NOT, because:

- No Playwright spec consumes the global in this leaf (Decision §10 defers the audience Playwright assertion).
- Future audience leaves (`aud_graph_rendering.aud_cytoscape_init` onward) MAY want the global; that leaf adds it then. Adding it here would be speculative.
- The audience surface's Out-of-scope §4 ("no status indicator chip") means there's no equivalent of the participant's chip-via-store-drive Playwright pattern to mirror today.

Two alternatives surveyed:

- **Defer the window exposure to the consuming Playwright-adding leaf** (chosen).
- **Add the exposure pre-emptively** so future leaves don't have to. Rejected — speculative; YAGNI applies; the exposure is a trivial three-line add in the future leaf's `main.tsx` edit when needed.

### 10. Defer the audience-WS Playwright assertion to `aud_graph_rendering.aud_cytoscape_init`

Per `ORCHESTRATOR.md`'s UI-stream e2e policy + deferred-e2e exception, audience IS a UI-stream area BUT the audience-WS plumbing has no visible UI surface today. The audience-skeleton's existing Playwright spec pins surface-mount; this leaf's WS plumbing lands beneath it.

Two alternatives surveyed:

- **Defer the Playwright assertion to `aud_graph_rendering.aud_cytoscape_init`** (chosen). The first audience leaf that surfaces a visible event-driven affordance (a node appearing on the graph) is the natural place to pin "an audience visitor sees a node arrive over WS" end-to-end. That leaf already exists in the WBS (`audience.aud_graph_rendering.aud_cytoscape_init`); its refinement-writer MUST scope a Playwright scenario asserting (a) the audience surface mounts on `/a/sessions/:id`, (b) a node-created event broadcast results in a visible node on the Cytoscape canvas, (c) implicit: the WS subscription is open and the event arrived through the substrate this leaf wires.
- **Add a debug-only DOM mirror to the audience surface** (a `<div data-testid="audience-event-log">` that lists arrived events in JSON) and a Playwright scenario that asserts a broadcast appears in it. Rejected — the debug mirror would be removed by `aud_graph_rendering.aud_cytoscape_init` (replaced by the actual canvas); per ADR 0022 a test artifact that gets removed by the next leaf is throwaway verification.
- **Add a Playwright scenario that asserts the WS handshake completes** (via the `chromium-audience-skeleton` project + `await page.waitForResponse(/.*\/api\/ws/, ...)` or equivalent). Rejected — Playwright's WebSocket-frame inspection API is brittle (the spec would either need a debug-mirror DOM or would use undocumented internals); the Cucumber feature pins the same handshake end-to-end at the wire layer with far better readability and isolation.

The Playwright deferral is registered as inheritable debt on `aud_graph_rendering.aud_cytoscape_init` — the existing WBS leaf with the right `depends` edges already in place. Per `ORCHESTRATOR.md`'s tech-debt registration policy, no new WBS leaf needs to be registered (the inheritor exists).

### 11. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0026's surface-consumes-from-shell-substrate + host-supplied-auth; 0022's committed-test discipline; 0002's cookie-only auth; 0021's envelope schema as single source of truth).
- A direct mirror of the participant's WS-client consumption shape (Decision §2's double-pass via `part_ws_client`'s precedent; Decision §3's surface-boundary mount; Decision §4's module-scope singleton; Decision §9's choice on window-exposure).
- A scoped wiring policy that doesn't constrain other tasks (Decision §1's subscribe-only-as-existing-envelope; Decision §6's TypeScript-narrowed barrel; Decision §7's three-scenario Cucumber pin; Decision §8's pin-whatever-code-engine-returns; Decision §10's Playwright deferral).
- A deliberate non-decision deferred to a future leaf (Decision §5's auth-widening; Decision §2's projection extension).

The "no new dependencies" rule is satisfied: no `package.json` change. The "no new shell substrate" rule is honored. The "no new server-side change" rule is honored (Decision §1).

### 12. Tech-debt registration

- **No new WBS leaf needs to be registered by this leaf's Closer.** The deferred Playwright scenario inherits to the existing leaf `audience.aud_graph_rendering.aud_cytoscape_init` per Decision §10 + `ORCHESTRATOR.md`'s tech-debt registration policy.
- **No i18n native-review leaf** — this leaf adds zero i18n keys.
- **No follow-up on the per-session subscription wiring.** The `client.trackSession(sessionId)` lifecycle lands in the first audience leaf with a real `:id` route — either `audience.aud_url_routing.aud_session_url` or `audience.aud_graph_rendering.aud_cytoscape_init`, both of which already exist as open WBS leaves with the right `depends` edges in place.
- **No follow-up on the audience-store extension.** If `aud_state_management` decides it needs an audience-specific projection, it owns that decision; this leaf does not pre-register it.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-18.

- New `apps/audience/src/ws/` subsystem: `wsStore.ts` (module-scope `audienceWsStore = createDefaultWsStore()` reusing the shell's store factory verbatim, no audience-local extension per Decision §2), `useAudienceSessionEvents.ts` + `useAudienceConnectionStatus.ts` (the two selector hooks), and a TypeScript-narrowed read-only barrel `apps/audience/src/ws/index.ts` exporting only those three symbols (no `useWsClient` re-export, no send-side surface — Decision §6). Each module has a sibling `.test.ts`; the barrel-narrowing pin (`apps/audience/src/ws/index.test.ts`) fails if the send-side surface ever leaks in.
- Audience surface boundary mounts a single `<WsClientProvider store={audienceWsStore}>` in `apps/audience/src/main.tsx` (the double-pass pattern mirroring the participant precedent from Decision §3); `apps/audience/src/mount.test.tsx` grew a `StubWebSocket` plus a store-writes-through assertion.
- **+3 Cucumber scenarios** in `tests/behavior/backend/ws-audience-subscribe.feature` (with steps in `tests/behavior/steps/backend-ws-audience-subscribe.steps.ts`) pin the subscribe-only wire contract end-to-end: `subscribe-ack`, `subscribe-and-receive-live-broadcast`, and `audience-typed-publish-rejected` — closes the deferred Cucumber pin from `aud_app_skeleton` and addresses the recent lagging-suite steer (Cucumber 236 → 239, +3 exact).
- Vitest 4039 → 4052 (+13: 4 wsStore + 3 each for the two selector hooks + 3 barrel-narrowing + 1 case grew in-place in `mount.test.tsx`).
- Playwright remains unchanged — deferred to `audience.aud_graph_rendering.aud_cytoscape_init` per Decision §10 (no visible UI in this leaf; a debug-mirror would be throwaway verification under ADR 0022). Tech-debt registration: none new (Decision §12 inherits to the existing WBS leaf).
- Double failing-first verification per ADR 0022: (1) flipped the Cucumber wire-code expectation to a sentinel and confirmed isolated-run failure with diff before restoring; (2) added a stray `useWsClient` re-export to the audience barrel and confirmed the barrel-narrowing test failed with "expected [...] to not include 'useWsClient'" before restoring.
- Background-fixture adaptation: the refinement named the audience screen as `alice-audience`, but the existing emit-broadcast step (`tests/behavior/steps/backend-ws-event-broadcast.steps.ts:281`) hard-codes `screen_name = 'alice-ws'` for the synthetic event payload. Background aligned to `alice-ws` (zero cross-feature interference risk since pglite is per-scenario); the deviation is documented in the feature file's docblock.
