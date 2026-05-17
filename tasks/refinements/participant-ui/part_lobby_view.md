# Pre-debate lobby

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_session_join.part_lobby_view`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_session_join.part_invite_acceptance` (settled — commit `5d51bf9`; ships the claim route at `/sessions/:id/invite`, the `POST /api/sessions/:id/invite/claim` round-trip, the `<LobbyPlaceholderRoute>` at [`apps/participant/src/routes/LobbyPlaceholderRoute.tsx`](../../../apps/participant/src/routes/LobbyPlaceholderRoute.tsx) under `/sessions/:id/lobby`, the per-session `client.trackSession(id)` lifecycle wiring against a real `:id` from `useParams()`, and the extracted `<ParticipantChrome>` at [`apps/participant/src/layout/ParticipantChrome.tsx`](../../../apps/participant/src/layout/ParticipantChrome.tsx). The predecessor's Status block at [`tasks/refinements/participant-ui/part_invite_acceptance.md:511`](part_invite_acceptance.md#L511) and its Decisions §1 + §10 explicitly name THIS task as the inheritor of the `<LobbyPlaceholderRoute>` replacement — the placeholder carries an explicit `data-testid="lobby-placeholder"` marker + a `!!! REMOVE-ME-WHEN-PART-LOBBY-VIEW-LANDS !!!` comment block at [`apps/participant/src/routes/LobbyPlaceholderRoute.tsx:15`](../../../apps/participant/src/routes/LobbyPlaceholderRoute.tsx#L15) naming this leaf as the removal target).
- `!participant_ui.part_shell` (settled via the parent's `depends !part_shell` edge — every leaf under the `part_shell` group is `complete 100`. `part_app_skeleton` ships the library-mode bundle and the `/p/*` dispatch; `part_state_management` ships the participant's `useWsStore` singleton at [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36) — delegated to the shell's `createDefaultWsStore()` so `useWsStore.getState().sessionState[sid].events` is the dedup'd event log per `BaseWsSessionState`; `part_ws_client` ships the surface-wide `<WsClientProvider>` + the source-hook swap that makes the chip reflect real WS state; `part_auth_flow` ships the `useAuth()` consumption + the identity row + the defensive `participant-not-authenticated` guard; `part_landscape_layout` ships `<ParticipantLayout>` with its four named-region testids; `part_status_indicator` ships the connection-state chip in the footer slot).
- `backend.session_management` (settled — the inherited group-level edge from the `part_session_join` parent. Both lobby-relevant endpoints are shipped: `GET /api/sessions/:id` for the session-header read (topic + privacy + endedAt) and `GET /api/sessions/:id/participants` for the cold-load participant list, plus `auth_middleware` (the session-cookie auth both reads inherit via Fastify's `preHandler: app.authenticate`)).
- Prose-only context (NOT a `.tji` edge): `backend.session_management.list_session_participants_endpoint` (settled, commit `20f546f` — the lobby's HTTP prefetch source. `GET /api/sessions/:id/participants` returns `{ participants: SessionParticipantResponse[] }` where each row is `{ id, sessionId, userId, role, joinedAt, leftAt }`; ordering is `joined_at ASC, id ASC`; visibility-gated through `canSeeSession` (404 existence-non-leak); the list includes the implicit-moderator row + active debater rows (and historical `leftAt !== null` rows, which the lobby filters out client-side). See [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) and the refinement at [`tasks/refinements/backend/list_session_participants_endpoint.md`](../backend/list_session_participants_endpoint.md)).
- Prose-only context (NOT a `.tji` edge): `backend.session_management.session_invite_self_claim_endpoint` (settled, commit `f07d456` — the upstream of the lifecycle the lobby observes. `POST /api/sessions/:id/invite/claim` INSERTs a `session_participants` row, then post-COMMIT emits a `participant-joined` event with payload `{ user_id, role, screen_name, joined_at }` per `participantJoinedPayloadSchema` at [`packages/shared-types/src/events.ts:202-211`](../../../packages/shared-types/src/events.ts#L202). The event reaches every subscriber via `wsBroadcast.emit({ event: evt })` at [`apps/server/src/sessions/routes.ts:2128`](../../../apps/server/src/sessions/routes.ts#L2128) and lands in the per-session events slice through `applyEvent`. The lobby reads the slice and re-derives slot occupancy on every event).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_shell.part_ws_client` (settled — the surface-wide `<WsClientProvider>` mount means `useWsClient()` and `useWsStore` are available from every route inside the router. The invite-acceptance route closed that refinement's "per-session subscription wiring" debt with its own `client.trackSession(id)` lifecycle; this leaf installs an idempotent re-subscription on the lobby route per the same pattern — re-tracking the same session is a no-op per `ws-client.test.ts:547`, so the transition invite → lobby is clean).

## What this task is

The real `/p/sessions/:id/lobby` route. The leaf that replaces the post-claim placeholder at [`apps/participant/src/routes/LobbyPlaceholderRoute.tsx`](../../../apps/participant/src/routes/LobbyPlaceholderRoute.tsx) with the participant-facing pre-debate lobby — the surface a debater sees after `<InviteAcceptanceRoute>` POSTs the claim and `navigate('/sessions/${id}/lobby', { replace: true })` settles. After this leaf:

- The participant `<App>` route table's `<Route path="/sessions/:id/lobby" element={<LobbyPlaceholderRoute />} />` entry at [`apps/participant/src/App.tsx:108`](../../../apps/participant/src/App.tsx#L108) is replaced (or its `element=` switched) with `<LobbyRoute />` from a new module `apps/participant/src/routes/LobbyRoute.tsx`. The `<LobbyPlaceholderRoute>` file is **deleted** (the comment block in the placeholder explicitly names this leaf as the removal target). The placeholder's `lobby-placeholder` testid stops being emitted; the new route emits `route-lobby` instead — see Decision §8 for the test-id migration trail.
- The `<LobbyRoute>` component reads the path's `:id` via `useParams()`, the host-supplied auth via `useAuth()` (for the "you're in the lobby as `<screenName>`" line + the post-load self-identification), the shell's `useWsClient()` for the inherited per-session subscription (`client.trackSession(id)` on mount / `untrackSession(id)` on cleanup, idempotent re-subscription per the moderator's pattern at [`apps/moderator/src/routes/InviteParticipants.tsx:189-195`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L189)), and `useWsStore((s) => s.sessionState[id]?.events)` for the live participant slot derivation.
- The route's main surface is a single read-only view: the session header (topic), the list of joined participants (one row per active occupant: screen name + role badge), and a "waiting for the moderator to start" hint. No write actions, no buttons that POST, no inline forms — the lobby is **observational only** for this leaf. Decision §3 documents what's deliberately out of scope (ready-state toggles, the moderator's "start debate" trigger, leave-session).
- The participants list is fed by **two seams composed**: (a) a one-shot `GET /api/sessions/:id/participants` HTTP prefetch on mount that paints the initial slot fill from the server's authoritative row set; (b) the WS event stream subscribed via `client.trackSession(id)` whose `participant-joined` / `participant-left` events update the slot map in real time, including the **other** debater claiming their slot while this debater is already in the lobby. Decision §1 settles the data-source pick (HTTP prefetch + WS upgrade; not WS-only, not polling). The HTTP prefetch fixes the "fresh tab opened on the lobby URL, WS not yet caught up" cold-load story; the WS subscription is the **canonical live-update path** for the moderator-watching-debater-arrive scenario the M3-lobby smoke needs.
- The session header is fed by a one-shot `GET /api/sessions/:id` HTTP read on mount — mirrors the moderator's invite view's pattern at [`apps/moderator/src/routes/InviteParticipants.tsx:204-245`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L204) line-for-line, including the fetch-status state machine (`'loading' | 'loaded' | 'error'`) and the retry-on-error affordance. The lobby needs the topic to render the "you're debating X" line; the lobby does NOT need the topic for any decision logic (the lifecycle is event-driven; the topic is presentational only).
- The slot-derivation logic reuses the moderator's `deriveSlotOccupants(events)` reducer pattern from [`apps/moderator/src/routes/InviteParticipants.tsx:108-137`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108) — walks `participant-joined` / `participant-left` events, collapses to a `{ moderator?, 'debater-A'?, 'debater-B'? }` map keyed by role. Decision §6 settles "duplicate the reducer in the participant workspace (~30 LOC)" against "extract into `@a-conversa/shell`": the moderator's reducer is non-trivial but small, and an extraction without a third caller is YAGNI (a future audience view may extract).
- The view merges the HTTP prefetch result and the WS events through a single derivation: HTTP rows seed the slot map (filtered to `leftAt === null` per Decision §2's "active only" client-side filter); the WS event stream then patches the map as `participant-joined` / `participant-left` events arrive. The two seams are **complementary, not competing** — the HTTP prefetch is the cold-load source of truth; the WS stream is the live-update overlay. The composition mirrors the moderator's invite view (which adopts the same pattern through the registered `mod_invite_participants_rest_prefetch` follow-up; this leaf does not depend on that follow-up landing first, since the participant lobby has no prior WS-only baseline).
- The empty state ("you're the first to arrive") renders when the slot map has only the caller's own row + the implicit-moderator row, i.e. no other debater. Decision §4 settles the empty-state phrasing + testid.
- HTTP-fetch errors (header fetch OR participants-list fetch) surface inline with a retry button per Decision §5; the WS subscription failure surface is **inherited** through the connection-state chip in the footer (no additional in-route error surface for WS — the chip is structural chrome and reflects the real connection state per `part_ws_client`).
- All new user-facing strings land in en-US + pt-BR (PENDING) + es-419 (PENDING) under the **already-allocated** `participant.lobby.*` namespace (the placeholder's `participant.lobbyPlaceholder.body` key migrates to `participant.lobby.placeholder` if any consumer cares, but the simpler path is to delete the unused `lobbyPlaceholder` namespace once the placeholder route file is deleted — see Decision §9). New keys: title, role badges (debaterA/debaterB/moderator), waiting hint, empty-state body, the two HTTP error panels, the retry button label, the "you're in" hint.
- Tests pin: Vitest at the component level (10 cases covering the prefetch happy path, the prefetch + WS-event live update, the empty state, the two HTTP error paths, the retry affordance, the WS lifecycle pair, the slot-derivation reducer); Playwright at the e2e level under `chromium-participant-skeleton` — Decision §7 scopes two scenarios: (a) single debater claims → lobby renders with themselves listed; (b) two debaters claim sequentially → both lobby views render with both participants visible. This is the **milestone-closing leaf for `m_manual_lobby_smoke`** ([`tasks/99-milestones.tji:44`](../../99-milestones.tji#L44)) — the Playwright spec is the proof a human can manually drive the smoke.

Out of scope (deferred to existing or future leaves):

- **Ready-state toggles ("I'm ready" / "I'm not ready") for the debater.** The lobby surface is observational for this milestone — the moderator is the one who triggers the start-debate transition (a future leaf, likely `mod_session_lobby` per the moderator's WBS), so a debater "ready" toggle has no consumer today. Adding it without a consumer would be premature.
- **The moderator's "start debate" → lobby-tears-down transition.** When the moderator triggers the start, the session log emits a session-start-style event (the exact event kind is owned by methodology-engine leaves still pending). The lobby's behavior on that event is: navigate to the live debate URL. For this leaf the lobby just **renders correctly** — the start-debate consumption is a future leaf. The lobby does NOT subscribe to a hypothetical `debate-started` event today.
- **A "leave session" affordance from the lobby.** Methodologically a debater who joined cannot quietly disappear; the moderator owns the participant-removal action via the existing host-only `DELETE /api/sessions/:id/participants/:userId`. A debater-side "leave" flow is a future P-something feature.
- **Per-debater ping / connection-health badge per slot.** The connection-state chip in the footer covers the caller's own WS health; surfacing the **other** debater's WS state would require a server-side health-broadcast that does not exist. Future P-something.
- **Pre-debate chat / pre-session messaging.** Out of scope for the milestone; not in the WBS.
- **The participants-list endpoint's historical rows (`leftAt !== null`).** Decision §2 — the list endpoint returns ALL rows by design (the active-only filter is the client's job). The lobby renders only active occupants; historical rows are filtered out client-side and never reach the UI.
- **A `<RequireAuth>` route gate inside this surface.** Inherited from `part_invite_acceptance` — the host's `SurfaceHost` already gates `/p/*` on `auth.status === 'authenticated'`; the surface's `requiredAuthLevel: 'authenticated'` declaration makes the host bounce unauthenticated visitors to `/login`. A second gate inside the surface would be parallel logic with no new caller.
- **Vote / withdraw / propose paths.** Owned by `part_voting.*` / `part_withdraw.*` / future `part_propose_*` leaves. The lobby opens the per-session WS subscription only — it does NOT call `useWsClient().send('propose', ...)` or any write path. The trackSession lifecycle is idempotent with the invite route's call (per `ws-client.test.ts:547`), so the in-surface navigation invite → lobby is clean.
- **A pre-claim "you'll see this lobby once you join" preview.** The invite-acceptance route renders the claim CTA; the lobby is the **post-claim** view. They are sequential surfaces; the lobby never renders for an unjoined caller.
- **A "back to invite URL" affordance.** Inherited from `part_invite_acceptance`'s Out-of-scope list — the lobby is the new home; back-navigation to the invite URL would re-fire the claim and hit `user-already-joined`. The browser-back's default behavior is acceptable. Decision §11 covers the user-already-joined → "go to lobby" affordance the invite-acceptance route already lands; that path is the structural recovery surface.
- **The full debate UX (graph, voting, proposals).** Owned by `part_graph_view.*` / `part_voting.*` / `part_pending_proposals.*`. The lobby is purely the waiting room.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji:42-46`](../../99-milestones.tji#L42)) is the milestone the orchestrator picks against today, and **this leaf is the last `part_session_join` dependency the milestone reads** (the milestone's `depends` line names exactly two participant-ui leaves under `part_session_join`: `part_invite_acceptance` (settled) and `part_lobby_view` (this leaf)). Without this leaf, the chain stalls at the placeholder:

1. Moderator generates invite URLs and shares them out-of-band (covered by `mod_invite_participants`, settled).
2. Debater A clicks the URL, authenticates, lands on `<InviteAcceptanceRoute>`, clicks "Join this debate" (covered by `part_invite_acceptance`, settled commit `5d51bf9`).
3. Server INSERTs the participants row, emits `participant-joined`, returns 200 (covered by `session_invite_self_claim_endpoint`, settled commit `f07d456`).
4. Invite route navigates to `/p/sessions/<id>/lobby` (settled).
5. **Today**: the placeholder renders. Body says "You're in the lobby" + the session id. No participants list, no topic, no real-time update when Debater B claims their slot — the moderator sees Debater B arrive (via the moderator's already-shipped slot reducer), but Debater A sees nothing change. The manual-smoke chain produces a debater who has joined but cannot see whether the other debater has joined; the milestone's "two debaters land in the lobby AND see each other live" criterion fails. The chain stalls.
6. **After this leaf**: the lobby renders the session topic ("Debating: Universal basic income"), Debater A's own row in the participants list (with their screen name + Debater A badge), the moderator's row (with the host's screen name + Moderator badge), and a "waiting for the other debater" hint. When Debater B claims their slot, the post-COMMIT `participant-joined` broadcast reaches Debater A's open WS subscription, lands in `useWsStore.sessionState[id].events` via `applyEvent`, the `deriveSlotOccupants` memo re-runs, and Debater B's row appears in the list — live, without a refresh. The M3-lobby chain is now end-to-end manually-drivable.

Downstream concretely:

- **`mod_session_lobby`** (the moderator's lobby leaf, future — a sibling under `moderator_ui.mod_session_setup`). The moderator's lobby view will share most of the slot-derivation logic with this leaf (slot map + per-role rendering); if either lobby's derivation gets extracted later, the other can adopt it. Today both views derive their own slot maps from the same event stream — no coupling, no shared module.
- **The moderator's "start debate" trigger** (future). When the moderator presses "start," the session log emits a debate-started-style event; the lobby's WS subscription receives it; the lobby's `useEffect` on that event calls `navigate('/sessions/${id}/debate')` (or similar) to transition to the live debate surface. The lobby's structure (WS subscription + event-driven projection) is the right substrate for that future leaf; this leaf's `trackSession` lifecycle stays open across the transition.
- **`part_graph_view`** and the downstream voting / withdraw paths inherit the lobby's `trackSession` posture — the WS connection is open and watching the session by the time the debate surface mounts. No re-subscription at the next route boundary is required (idempotent re-tracking on a remount is safe).

Architecturally, this leaf **closes the inherited debt named by `part_invite_acceptance`'s Status block and Decision §1** — the placeholder lobby route is the explicit removal target this refinement consumes. After this leaf lands, the participant surface goes from "you joined, here's a one-line acknowledgment" to "you joined, here's the room you're waiting in." The next downstream surface (the live debate view) inherits the WS subscription posture this leaf installs.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37-L88) — Decision 1 fixes the `/p/*` URL prefix the lobby lives under; Decision 2 fixes the surface's mount contract; Decision 3 fixes that surfaces consume shared services (auth, i18n, WS) from `@a-conversa/shell` rather than re-implementing them. The lobby route consumes `useAuth()`, `useWsClient()`, and `useWsStore` (the participant's singleton which extends the shell's base) — no new substrate.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioral assertion below is a committed Vitest case or Playwright scenario. The cross-debater live-update path is pinned by the two-context Playwright scenario; the HTTP-fetch error paths are pinned at the Vitest layer with fetch-mocking.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth. The two HTTP fetches (`GET /api/sessions/:id` and `GET /api/sessions/:id/participants`) rely on the same-origin `aconversa-session` HttpOnly cookie via `credentials: 'include'`; the route does NOT read the cookie, append a token to URLs, or pass auth claims through query strings.
- [ADR 0021 — event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `participant-joined` / `participant-left` events the slot reducer consumes carry the canonical envelope shape (`{ kind, sessionId, sequence, occurredAt, actor, payload }`); the payload schemas are `participantJoinedPayloadSchema` (`{ user_id, role, screen_name, joined_at }`) and `participantLeftPayloadSchema` (`{ user_id, left_at }`) per [`packages/shared-types/src/events.ts:202-220`](../../../packages/shared-types/src/events.ts#L202). The slot reducer in `deriveSlotOccupants` switches on `event.kind` and reads payload fields directly — no schema validation in the participant (the server validated at write time + the shell client validates incoming envelopes at parse time per `part_state_management`).
- [ADR 0024 — frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — all user-facing strings land via the shared catalog; the lobby's new keys live under `participant.lobby.*` per the i18n-namespace convention `part_invite_acceptance` established. ICU-free formatting (the lobby's "waiting for Debater B to arrive" line interpolates one variable; same convention as the invite route's hint).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_invite_acceptance.md#L17`](part_invite_acceptance.md#L17) — Status block at line 506 + Decisions §1 (lines 399-405) + §10 (lines 493-496) explicitly name THIS task as the inheritor of the `<LobbyPlaceholderRoute>` replacement. The placeholder's load-bearing comment block at [`apps/participant/src/routes/LobbyPlaceholderRoute.tsx:15`](../../../apps/participant/src/routes/LobbyPlaceholderRoute.tsx#L15) (`!!! REMOVE-ME-WHEN-PART-LOBBY-VIEW-LANDS !!!`) is the unambiguous removal target this leaf consumes. The placeholder's testid `lobby-placeholder` and its session-id testid `session-id` are pinned by `tests/e2e/participant-invite-acceptance.spec.ts:192-193` — this leaf migrates those assertions to the new `route-lobby` testid (Decision §8).
- [`tasks/refinements/participant-ui/part_ws_client.md`](part_ws_client.md) — Decision §1 settles that the WS provider sits at the surface boundary in `main.tsx`; this leaf consumes `useWsClient()` from the surface-wide provider, NOT a per-route provider. Status block at line 412 names `part_invite_acceptance` as the inheritor of the per-session subscription wiring; the invite route closed that debt with its own `trackSession` lifecycle, and this leaf adds an **idempotent re-subscription on the lobby route** per the same pattern (re-tracking the same session is a no-op).
- [`tasks/refinements/participant-ui/part_auth_flow.md#L103-L146`](part_auth_flow.md#L103) — the `useAuth()` consumption shape this leaf mirrors. The lobby's "you're in the lobby as `<screenName>`" line narrows on `auth.status === 'authenticated' && auth.user !== undefined` and reads `auth.user.screenName`; same belt-and-suspenders shape the invite route uses. The route does NOT add a second `participant-not-authenticated` guard inside the route body — the chrome's defensive panel + the host's `SurfaceHost` cleanup cover the mid-mount status-flip window already.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — Decision §2 settles that the participant `useWsStore` delegates to the shell's `createDefaultWsStore()`; the per-session `events` slice has the same shape as the moderator's, so the slot-derivation reducer that the moderator uses works against the participant's store unchanged. The participant has no "active diagnostics" projection layered on top — the base contract is sufficient for the lobby's needs.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the chrome shape the route renders inside. The route returns `<ParticipantLayout header={<ParticipantChrome />} main={<LobbyRouteBody ... />} footer={<ParticipantStatusIndicator />} />` — same composition shape the invite route uses; the `main` slot is the only piece this leaf populates differently.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md) — the chip in the footer that surfaces the WS state through the lobby's lifecycle. The chip's source hook reads from `useWsStore.connectionStatus` and is unaffected by this leaf; the lobby route does NOT touch the chip. Per Decision §5 below, a WS-disconnect during the lobby's lifetime is observable to the user through the chip's color change (`open` → `reconnecting` → `closed`); the lobby's body does not duplicate that signal.
- [`tasks/refinements/backend/list_session_participants_endpoint.md`](../backend/list_session_participants_endpoint.md) — the lobby's HTTP prefetch source. The endpoint's contract: `GET /api/sessions/:id/participants` returns `200 + { participants: SessionParticipantResponse[] }`; visibility-gated through `canSeeSession`; 404 on private-not-visible (existence-non-leak); ordering `joined_at ASC, id ASC`; rows include both active (`leftAt === null`) and historical (`leftAt !== null`) entries; the lobby filters client-side. The endpoint is shipped (commit `20f546f`) and is consumed for the first time by this leaf — Decision §1 settles the "frontend adoption is a separate task" follow-up the endpoint's refinement registered as `mod_invite_participants_rest_prefetch` is the moderator-side counterpart; THIS leaf is the participant-side counterpart of the same pattern (this leaf does NOT register a new "rest_prefetch" follow-up against itself, since the prefetch IS this leaf's data-source decision).
- [`tasks/refinements/backend/session_invite_self_claim_endpoint.md`](../backend/session_invite_self_claim_endpoint.md) — the upstream of the `participant-joined` event the lobby's WS subscription receives. The endpoint's post-COMMIT `wsBroadcast.emit({ event: evt })` at [`apps/server/src/sessions/routes.ts:2128`](../../../apps/server/src/sessions/routes.ts#L2128) reaches every subscriber's `applyEvent`; the lobby's `useWsStore((s) => s.sessionState[id]?.events)` selector reads the updated slice; the `deriveSlotOccupants` memo re-runs and the second debater's row appears live.
- [`tasks/refinements/moderator-ui/mod_invite_participants.md`](../moderator-ui/mod_invite_participants.md) — the moderator-side slot-derivation precedent. The `deriveSlotOccupants` reducer at [`apps/moderator/src/routes/InviteParticipants.tsx:108-137`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108) is the canonical example this leaf copies (Decision §6 — duplicate, do not extract). The HTTP fetch-status state machine at [`apps/moderator/src/routes/InviteParticipants.tsx:204-245`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L204) is the canonical example for the lobby's `GET /api/sessions/:id` fetch (Decision §5 — copy the shape; same `'loading' | 'loaded' | 'error'` machine).

### Live code the route plugs into

- [`apps/participant/src/App.tsx:104-112`](../../../apps/participant/src/App.tsx#L104) — the current route tree. This leaf replaces the `<LobbyPlaceholderRoute />` element of the `/sessions/:id/lobby` route entry with `<LobbyRoute />` from `./routes/LobbyRoute`. The wildcard `<Route path="*">` stays as the catch-all; the invite route stays untouched.
- [`apps/participant/src/routes/LobbyPlaceholderRoute.tsx`](../../../apps/participant/src/routes/LobbyPlaceholderRoute.tsx) — **deleted** by this leaf. The companion test file `LobbyPlaceholderRoute.test.tsx` is also deleted. The `participant.lobbyPlaceholder.body` i18n key (and its pt-BR/es-419 drafts + the two `.review.json` pending entries) is also removed; the new lobby uses keys under `participant.lobby.*`. Decision §9 covers the cleanup.
- [`apps/participant/src/main.tsx:77-85`](../../../apps/participant/src/main.tsx#L77) — the `<WsClientProvider>` mount the route consumes via `useWsClient()`. No change to `main.tsx`; the provider is already at the surface boundary per `part_ws_client` Decision §1.
- [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36) — the participant's `useWsStore` singleton. The lobby reads `useWsStore((s) => s.sessionState[id]?.events)` directly; the existing store's `applyEvent` path is the writer (driven by the shell client's envelope dispatch, no participant-side change).
- [`packages/shell/src/ws/store-contract.ts:44-53`](../../../packages/shell/src/ws/store-contract.ts#L44) — `BaseWsSessionState.events: Event[]` is the dedup'd event log this leaf reads via the selector. The doc-comment confirms the moderator's history pane reads it verbatim — this leaf takes the same posture.
- [`packages/shell/src/ws/client.ts:139-141`](../../../packages/shell/src/ws/client.ts#L139) + [`packages/shell/src/ws/client.ts:477-503`](../../../packages/shell/src/ws/client.ts#L477) — `client.trackSession(sessionId)` / `client.untrackSession(sessionId)`. The lobby calls them with `void` inside a `useEffect`, mirroring both the moderator's pattern and the invite route's pattern. Functions are idempotent per `ws-client.test.ts:547`.
- [`apps/moderator/src/routes/InviteParticipants.tsx:108-137`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108) — the canonical `deriveSlotOccupants(events)` reducer this leaf copies. Walks `participant-joined` / `participant-left` events; collapses to a `{ moderator?, 'debater-A'?, 'debater-B'? }` map keyed by role; `participant-left` clears the slot only when the leaver matches the current occupant (so a stale `participant-left` doesn't erase a fresh `participant-joined`).
- [`apps/moderator/src/routes/InviteParticipants.tsx:189-256`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L189) — the canonical fetch-status + WS-subscription composition. Same `useEffect` for trackSession/untrackSession; same `useEffect` for the HTTP fetch with a retry-nonce; same `useMemo` over the event-stream-derived occupants. This leaf copies the shape verbatim for `GET /api/sessions/:id` and adapts it for `GET /api/sessions/:id/participants` (a second fetch, same pattern).
- [`packages/shared-types/src/events.ts:202-220`](../../../packages/shared-types/src/events.ts#L202) — `participantJoinedPayloadSchema` / `participantLeftPayloadSchema`. The reducer reads `event.payload.role` + `event.payload.user_id` + `event.payload.screen_name` for joins, `event.payload.user_id` for leaves.
- [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `GET /api/sessions/:id/participants` registered alongside `GET /api/sessions/:id`. Both endpoints take `:id` UUID + return JSON; both are visibility-gated; both return 404 (not 403) on private-not-visible per `get_session_endpoint`'s existence-non-leak.
- [`tests/e2e/participant-invite-acceptance.spec.ts:192-193`](../../../tests/e2e/participant-invite-acceptance.spec.ts#L192) — the Playwright assertions that read `lobby-placeholder` + `session-id` testids. **This leaf updates those assertions** in the same commit that deletes the placeholder file — see Decision §8 + Constraints.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — `loginAs(page, { username })` drives a full OIDC dance and returns `{ userId, screenName }`. The two-debater scenario uses it for both alice (moderator, via the seeded `setup-auth` jar) and ben (debater-A, fresh OIDC dance) and carol (debater-B, fresh OIDC dance).
- [`tests/e2e/participant-invite-acceptance.spec.ts:58-69`](../../../tests/e2e/participant-invite-acceptance.spec.ts#L58) — the canonical `createSession(page, { topic, privacy })` helper that POSTs to `/api/sessions` and returns the id. This leaf's spec reuses the helper (lifted into a shared fixture file OR copied — Decision §7 settles "copy into the spec; if a third spec needs it, extract").
- [`tests/e2e/participant-invite-acceptance.spec.ts:85-91`](../../../tests/e2e/participant-invite-acceptance.spec.ts#L85) — the `logoutAndClearAllCookies(page)` helper that drops both the platform's session cookie and the Authelia jar. Reused for the two-debater scenario (alice → ben → carol requires two logout/clear cycles).
- [`playwright.config.ts:303-317`](../../../playwright.config.ts#L303) — the `chromium-participant-skeleton` project. Already pre-seeded with the `setup-auth` storage state. The testMatch is `/participant-(skeleton-smoke|invite-acceptance)\.spec\.ts$/` (widened by `part_invite_acceptance` Decision §7); this leaf widens it further to `/participant-(skeleton-smoke|invite-acceptance|lobby)\.spec\.ts$/` to accept the new spec file. Decision §7 covers the widening.

### What the surface MUST NOT do

- **No participant-local `createWsClient()` call.** The provider's auto-construction is the canonical path; the route consumes `useWsClient()` from the surface-wide provider. A direct `createWsClient` import in the route would duplicate the singleton. Inherits the invite route's rule.
- **No `fetch('/api/auth/me')`.** The route reads the host-supplied `useAuth()`; no second auth fetch.
- **No `userId` field in any HTTP request.** Both fetches are GETs (no body); the caller's id is implicit from the session cookie. The participants-list endpoint and the session-header endpoint both derive identity from `request.authUser.id`.
- **No `localStorage` / `sessionStorage` writes.** In-memory only; the route's local state lives in `useState`.
- **No `window.location` writes.** No navigation OUT of the lobby in this leaf — the lobby is a terminal surface for this milestone. The `client.untrackSession` cleanup on unmount handles the WS subscription tear-down; any future navigation (e.g. moderator's "start debate" trigger) is a downstream leaf's concern.
- **No second `<WsClientProvider>` mount.** Surface-wide provider only.
- **No event-stream side-effects.** The lobby does NOT call `useWsClient().send(...)` for any kind. The WS subscription is **read-only** for this leaf.
- **No client-side validation of the WS event schema.** The shell client validates incoming envelopes at parse time per `part_state_management`; the slot reducer assumes well-formed events. A malformed event would have been dropped at the dispatch layer.
- **No write to the `useWsStore`.** The store is read-only for the lobby route (via the selector); writes happen exclusively through the shell client's dispatch.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/App.tsx` — modified. Replaces the import of `LobbyPlaceholderRoute` with `LobbyRoute` from `./routes/LobbyRoute`; swaps the `element=` on the `/sessions/:id/lobby` route entry. Comment-block update: the route-table doc-comment loses the `participant.lobbyPlaceholder.body` mention and gains the `participant.lobby.*` namespace reference. No other change.
- `apps/participant/src/routes/LobbyRoute.tsx` — NEW. The lobby route. Reads `useParams<{ id: string }>()`, `useAuth()`, `useWsClient()`, `useWsStore((s) => s.sessionState[id]?.events)`. Lifecycle: trackSession on mount + untrackSession on cleanup (idempotent re-subscription with the invite route's prior call). Two HTTP fetches in two `useEffect`s — one for `GET /api/sessions/:id` (session header), one for `GET /api/sessions/:id/participants` (initial slot fill). Slot map = HTTP prefetch (active rows only) merged with WS event stream (`deriveSlotOccupants(events)`). Renders the layout shell (`<ParticipantLayout header={<ParticipantChrome />} main={<LobbyRouteBody ... />} footer={<ParticipantStatusIndicator />} />`); the `LobbyRouteBody` is a sibling component in the same file that owns the route content.
- `apps/participant/src/routes/LobbyRoute.test.tsx` — NEW. Vitest cases (10) covering: (a) initial render with the loading state for both fetches; (b) post-prefetch render with the session header (topic) + the participants list (moderator + caller's own row + waiting-for-debater-B hint); (c) live update: a `participant-joined` event arrives in the WS slice → the second debater's row appears without a refresh; (d) live update: a `participant-left` event clears the corresponding slot; (e) empty state (caller is the only debater, no second-debater hint); (f) session-header fetch error → error panel + retry button → retry refetches; (g) participants-list fetch error → error panel + retry button → retry refetches; (h) the `trackSession(${id})` lifecycle: called once on mount + `untrackSession(${id})` called once on cleanup; (i) the slot derivation: a stale `participant-left` for a no-longer-occupant user does NOT erase the current slot (mirrors the moderator's reducer contract); (j) the moderator's screen name renders with the Moderator badge alongside the two debater rows. Uses `vi.spyOn(global, 'fetch')` for the HTTP mocks + direct store writes via `useWsStore.setState` for the WS event injection (same shape `apps/participant/src/layout/useParticipantConnectionStatus.test.ts` already uses).
- `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` — **DELETED** by this leaf. The route is replaced by `<LobbyRoute>` per Decision §1; the file's `!!! REMOVE-ME-WHEN-PART-LOBBY-VIEW-LANDS !!!` comment block at line 15 explicitly named this leaf as the removal target.
- `apps/participant/src/routes/LobbyPlaceholderRoute.test.tsx` — **DELETED** alongside the placeholder.
- `apps/participant/src/lobby/deriveSlotOccupants.ts` — NEW (or inline in `LobbyRoute.tsx`; Decision §6 settles "inline as a non-exported function in `LobbyRoute.tsx`" against "extract to a sibling module"). Inline keeps the reducer co-located with its single caller, mirroring the moderator's posture at [`apps/moderator/src/routes/InviteParticipants.tsx:108`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108) where the reducer is also inline. **Action**: keep inline; no new module file.
- `tests/e2e/participant-lobby.spec.ts` — NEW. Two Playwright scenarios under `chromium-participant-skeleton`:
  1. **Single-debater happy path** — alice creates a public session via `page.request.post('/api/sessions', { data: { topic, privacy: 'public' } })` after `loginAs(page, { username: 'alice' })`; logs out + clears cookies; ben (`loginAs`) navigates to the invite URL, clicks join, lands on the lobby. Assert: `route-lobby` testid visible; session topic text rendered; ben's row visible with Debater A badge + ben's screen name; alice's row visible with Moderator badge + alice's screen name; the "waiting for the other debater" hint visible (Debater B not yet joined).
  2. **Two-debater live-update path** — alice creates a public session; ben claims debater-A and stays on the lobby; in a second browser context, carol (`loginAs`) navigates to the debater-B invite URL and claims; ben's lobby (still open in context 1) sees carol's row appear within ~15s. Assert: in context 1, the Debater B row appears with carol's screen name AFTER carol's claim, WITHOUT a manual refresh of context 1; the "waiting" hint is gone (both debaters present). This is the **manual-smoke proof** for the milestone — the chain a moderator would manually drive to verify the lobby works end-to-end.
- `tests/e2e/participant-invite-acceptance.spec.ts` — **modified** (testids migration only). The two assertions at lines 192-193 (`lobby-placeholder` + `session-id`) are updated to `route-lobby` + the new way the lobby surfaces the session id (Decision §8). The rest of the spec is untouched. **Amendment to part_invite_acceptance Constraints**: this file is in the part_invite_acceptance allowlist as touched-for-test-infra; the testid migration here is the structural follow-up the placeholder's removal forces.
- `playwright.config.ts` — modified. The `chromium-participant-skeleton` project's testMatch widens from `/participant-(skeleton-smoke|invite-acceptance)\.spec\.ts$/` to `/participant-(skeleton-smoke|invite-acceptance|lobby)\.spec\.ts$/`. Same mechanical change `part_invite_acceptance` made.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Removes the `participant.lobbyPlaceholder` namespace (1 key: `body`). Adds the `participant.lobby.*` namespace with 10 new keys: `title` ("Lobby"), `topicLabel` ("Debating:"), `participantsHeading` ("Participants"), `waitingForDebater` ("Waiting for {role} to join…"), `bothDebatersPresent` ("Both debaters are here — waiting for the moderator to start the debate."), `emptyState` ("You're the first to arrive."), `roleBadges.moderator` ("Moderator"), `roleBadges.debaterA` ("Debater A"), `roleBadges.debaterB` ("Debater B"), `errors.sessionFetchFailed` ("Could not load the session details."), `errors.participantsFetchFailed` ("Could not load the participants list."), `errors.retry` ("Try again"). 12 new keys + 1 removed = net +11.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Removes `participant.lobbyPlaceholder.body`; adds the 12 new draft entries.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Drops the `participant.lobbyPlaceholder.body` pending entry; appends all 12 new dotted keys to the `pending` list.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — the provider stack is correct; no change.
- `apps/participant/src/ws/wsStore.ts` / `wsStore.test.ts` — the store + tests are consumed unchanged. The lobby's selector usage is a read-only consumer; no shape change.
- `apps/participant/src/routes/InviteAcceptanceRoute.tsx` / `InviteAcceptanceRoute.test.tsx` — the invite route stays unchanged. Its `navigate('/sessions/${id}/lobby', { replace: true })` call now lands on `<LobbyRoute>` instead of `<LobbyPlaceholderRoute>` — same URL, different element; the route table swap is the only place the change surfaces.
- `apps/participant/src/error-mapper/inviteAcceptanceError.ts` — the invite-route's error mapper is unrelated; not touched.
- `apps/participant/src/layout/*` — the layout + chrome + chip + connection-status hook are consumed unchanged.
- `apps/participant/src/mount.test.tsx` — the mount-boundary test asserts the invite route (per `part_invite_acceptance` Decision §8); the lobby is not on its URL. Untouched.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep; no new build config.
- `packages/shell/` — the substrate is consumed unchanged. No new shell substrate; `deriveSlotOccupants` is inlined in the participant workspace (Decision §6).
- `apps/root/` / `apps/server/` / `apps/moderator/` / `apps/audience/` — no cross-surface change. The backend endpoints are shipped; the moderator's slot derivation is independent.
- `.tji` files — `complete 100` on `part_lobby_view` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual. **Milestone propagation**: this leaf is the last `m_manual_lobby_smoke` dependency from `participant_ui.part_session_join`; the Closer also adds `complete 100` to `m_manual_lobby_smoke` in `tasks/99-milestones.tji` once all other `m_manual_lobby_smoke` deps are settled. (All other deps on that milestone's `depends` line are already `complete 100` as of commit `5d51bf9` — this leaf is the structural close.) A new native-review follow-up leaf (`frontend_i18n.i18n_participant_lobby_native_review`) is registered in `tasks/35-frontend-i18n.tji` per Decision §10.
- `docs/adr/` — no new ADR (every decision below applies an existing ADR or codifies a scoped UI policy).

### Component shape (`apps/participant/src/routes/LobbyRoute.tsx`)

The route, sketched:

```tsx
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useWsClient } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';

type Role = 'moderator' | 'debater-A' | 'debater-B';
const SLOT_ROLES = ['moderator', 'debater-A', 'debater-B'] as const;
type SlotOccupants = { [K in Role]?: { userId: string; screenName: string } };

interface ParticipantRow {
  userId: string;
  role: Role;
  screenName: string;
}

interface SessionHeader {
  id: string;
  topic: string;
  privacy: 'public' | 'private';
  endedAt: string | null;
}

type FetchStatus = 'loading' | 'loaded' | 'error';

// Walk the event log and collapse `participant-joined` / `participant-left`
// into a role-keyed occupant map. Mirrors the moderator's reducer at
// `apps/moderator/src/routes/InviteParticipants.tsx:108-137`.
function deriveSlotOccupants(events: readonly Event[]): SlotOccupants {
  const occupants: SlotOccupants = {};
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      occupants[event.payload.role as Role] = {
        userId: event.payload.user_id,
        screenName: event.payload.screen_name,
      };
      continue;
    }
    if (event.kind === 'participant-left') {
      for (const role of SLOT_ROLES) {
        if (occupants[role]?.userId === event.payload.user_id) {
          delete occupants[role];
        }
      }
    }
  }
  return occupants;
}

// Merge the HTTP-prefetch row set into the WS-derived slot map. The HTTP
// prefetch is the cold-load source of truth; the WS event stream is the
// live overlay. Both are merged into a single per-render slot map — WS
// wins on collisions (its events are more recent than the HTTP snapshot).
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
): SlotOccupants {
  const merged: SlotOccupants = {};
  for (const row of httpRows) {
    merged[row.role] = { userId: row.userId, screenName: row.screenName };
  }
  for (const role of SLOT_ROLES) {
    const wsSlot = wsOccupants[role];
    if (wsSlot !== undefined) merged[role] = wsSlot;
  }
  return merged;
}

export function LobbyRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const client = useWsClient();

  // Per-session subscription lifecycle. Idempotent with the invite
  // route's prior call (per `ws-client.test.ts:547`); the cleanup pairs
  // trackSession with untrackSession so the server's subscription
  // registry stays clean. Mirrors the moderator's pattern.
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
      main={<LobbyRouteBody id={id} />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

function LobbyRouteBody({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  // Belt-and-suspenders mid-mount auth guard. Same shape the invite
  // route uses.
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div
        data-testid="route-lobby"
        data-state="not-authenticated"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="participant-not-authenticated" className="text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  // ── HTTP fetch: session header ──────────────────────────────────────
  const [headerStatus, setHeaderStatus] = useState<FetchStatus>('loading');
  const [header, setHeader] = useState<SessionHeader | undefined>(undefined);
  const [headerRetryNonce, setHeaderRetryNonce] = useState(0);

  useEffect(() => {
    if (id === '') return;
    let cancelled = false;
    setHeaderStatus('loading');
    setHeader(undefined);
    void (async () => {
      try {
        const resp = await fetch(`/api/sessions/${id}`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (resp.status !== 200) {
          setHeaderStatus('error');
          return;
        }
        const body = (await resp.json()) as SessionHeader;
        if (cancelled) return;
        setHeader(body);
        setHeaderStatus('loaded');
      } catch {
        if (!cancelled) setHeaderStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [id, headerRetryNonce]);

  // ── HTTP fetch: participants list ───────────────────────────────────
  const [participantsStatus, setParticipantsStatus] = useState<FetchStatus>('loading');
  const [httpRows, setHttpRows] = useState<readonly ParticipantRow[]>([]);
  const [participantsRetryNonce, setParticipantsRetryNonce] = useState(0);

  useEffect(() => {
    if (id === '') return;
    let cancelled = false;
    setParticipantsStatus('loading');
    setHttpRows([]);
    void (async () => {
      try {
        const resp = await fetch(`/api/sessions/${id}/participants`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (resp.status !== 200) {
          setParticipantsStatus('error');
          return;
        }
        const body = (await resp.json()) as { participants: Array<{
          userId: string;
          role: Role;
          leftAt: string | null;
          // The wire row carries `screenName` IF the predecessor endpoint
          // denormalizes it; if not, the row carries only `userId` and we
          // fall back to the WS event payload's `screen_name` for the
          // display name. See Open question §1 for the resolution.
          screenName?: string;
        }> };
        const active = body.participants.filter((r) => r.leftAt === null);
        const rows: ParticipantRow[] = active.map((r) => ({
          userId: r.userId,
          role: r.role,
          screenName: r.screenName ?? '',
        }));
        if (!cancelled) {
          setHttpRows(rows);
          setParticipantsStatus('loaded');
        }
      } catch {
        if (!cancelled) setParticipantsStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [id, participantsRetryNonce]);

  // ── WS event-derived slot occupants ─────────────────────────────────
  const events = useWsStore((s) => s.sessionState[id]?.events);
  const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
  const slots = useMemo(() => mergeSlots(httpRows, wsOccupants), [httpRows, wsOccupants]);

  const debaterAPresent = slots['debater-A'] !== undefined;
  const debaterBPresent = slots['debater-B'] !== undefined;
  const bothDebatersPresent = debaterAPresent && debaterBPresent;
  const onlyMeAsDebater = (auth.user.id === slots['debater-A']?.userId && !debaterBPresent)
    || (auth.user.id === slots['debater-B']?.userId && !debaterAPresent);

  // Loading-state render
  if (headerStatus === 'loading' || participantsStatus === 'loading') {
    return (
      <div data-testid="route-lobby" data-state="loading" className="mx-auto max-w-2xl p-6">
        <p data-testid="lobby-loading" className="text-sm text-slate-600">
          {t('common.loading')}
        </p>
      </div>
    );
  }

  // Error-state render
  if (headerStatus === 'error' || participantsStatus === 'error') {
    return (
      <div data-testid="route-lobby" data-state="error" className="mx-auto max-w-2xl p-6">
        {headerStatus === 'error' ? (
          <div data-testid="lobby-error-header" role="alert" aria-live="polite">
            <p className="text-sm text-red-700">{t('participant.lobby.errors.sessionFetchFailed')}</p>
            <button
              type="button"
              data-testid="lobby-retry-header"
              onClick={() => setHeaderRetryNonce((n) => n + 1)}
            >
              {t('participant.lobby.errors.retry')}
            </button>
          </div>
        ) : null}
        {participantsStatus === 'error' ? (
          <div data-testid="lobby-error-participants" role="alert" aria-live="polite">
            <p className="text-sm text-red-700">{t('participant.lobby.errors.participantsFetchFailed')}</p>
            <button
              type="button"
              data-testid="lobby-retry-participants"
              onClick={() => setParticipantsRetryNonce((n) => n + 1)}
            >
              {t('participant.lobby.errors.retry')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // Loaded render
  return (
    <div data-testid="route-lobby" data-state="loaded" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.lobby.title')}</h1>
      {header !== undefined ? (
        <p data-testid="lobby-topic" className="mt-2 text-sm text-slate-700">
          {t('participant.lobby.topicLabel')} {header.topic}
        </p>
      ) : null}
      <h2 className="mt-6 text-sm font-medium text-slate-600">
        {t('participant.lobby.participantsHeading')}
      </h2>
      <ul data-testid="lobby-participants-list" className="mt-2 space-y-1">
        {SLOT_ROLES.map((role) => {
          const slot = slots[role];
          if (slot === undefined) return null;
          return (
            <li
              key={role}
              data-testid={`lobby-participant-${role}`}
              data-user-id={slot.userId}
              className="flex items-center justify-between"
            >
              <span data-testid={`lobby-participant-${role}-name`}>{slot.screenName}</span>
              <span data-testid={`lobby-participant-${role}-badge`} className="text-xs text-slate-500">
                {t(`participant.lobby.roleBadges.${role === 'moderator' ? 'moderator' : role === 'debater-A' ? 'debaterA' : 'debaterB'}`)}
              </span>
            </li>
          );
        })}
      </ul>
      {bothDebatersPresent ? (
        <p data-testid="lobby-both-debaters-present" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.bothDebatersPresent')}
        </p>
      ) : !debaterAPresent ? (
        <p data-testid="lobby-waiting-for-debater" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.waitingForDebater', { role: t('participant.lobby.roleBadges.debaterA') })}
        </p>
      ) : !debaterBPresent ? (
        <p data-testid="lobby-waiting-for-debater" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.waitingForDebater', { role: t('participant.lobby.roleBadges.debaterB') })}
        </p>
      ) : null}
      {onlyMeAsDebater ? (
        <p data-testid="lobby-empty-state" className="mt-2 text-xs text-slate-500">
          {t('participant.lobby.emptyState')}
        </p>
      ) : null}
    </div>
  );
}
```

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest component-shape** — `apps/participant/src/routes/LobbyRoute.test.tsx`. Ten cases:
   - (a) Renders the loading state when both fetches are in flight (`route-lobby[data-state="loading"]` + `lobby-loading` testid).
   - (b) Renders the loaded state with the session topic + moderator row + caller's debater-A row + "waiting for Debater B" hint, given a mocked 200 from both endpoints (caller is debater-A; only moderator + caller are returned).
   - (c) Renders the live-update path: starts with one debater (caller) + moderator; a `participant-joined` event for debater-B arrives via `useWsStore.setState({ sessionState: { [id]: { events: [...prev, joinEvent] } } })`; the Debater B row appears in the list; the "waiting" hint is replaced by the `lobby-both-debaters-present` line.
   - (d) Renders the slot-clear path: starts with both debaters; a `participant-left` event for debater-B arrives; the Debater B row disappears; the "waiting for Debater B" hint reappears.
   - (e) Renders the empty state: caller is the only debater + moderator + no other-debater hint conditions; the `lobby-empty-state` testid is visible.
   - (f) Renders the session-header error state: 500 from `GET /api/sessions/:id`; the `lobby-error-header` testid is visible; the retry button is enabled; clicking retry refetches and (on a mocked 200) transitions to loaded.
   - (g) Renders the participants-list error state: 500 from `GET /api/sessions/:id/participants`; the `lobby-error-participants` testid is visible; clicking retry refetches.
   - (h) Pins the `trackSession` lifecycle: `client.trackSession(${id})` called once on mount; `client.untrackSession(${id})` called once on unmount.
   - (i) Pins the stale-`participant-left` resilience: an event log with `participant-joined(B, user-1)` → `participant-left(user-2)` → `participant-joined(B, user-1)` derives correctly to `{ debater-B: user-1 }` (the stale-leave does not erase the active slot).
   - (j) Pins the badge rendering: the moderator row carries the Moderator badge testid + label; the two debater rows carry their badge testids + labels.

   Uses `vi.spyOn(global, 'fetch')` for the HTTP mocks + direct `useWsStore.setState` writes for WS event injection (mirrors the test patterns in `useParticipantConnectionStatus.test.ts`).

2. **Playwright e2e** — `tests/e2e/participant-lobby.spec.ts`. Two scenarios under `chromium-participant-skeleton`:
   - **Single-debater happy path** — alice creates a public session via the API helper; logs out + clears cookies; ben (`loginAs`) follows the debater-A invite URL; clicks join; URL settles on `/p/sessions/<id>/lobby`. Assert: `route-lobby` testid visible; `lobby-topic` contains the session topic; `lobby-participant-moderator-name` contains alice's screen name; `lobby-participant-debater-A-name` contains ben's screen name; `lobby-waiting-for-debater` contains "Debater B".
   - **Two-debater live-update path** — alice creates a public session; ben (context 1, fresh OIDC dance) claims debater-A and stays on the lobby; carol (context 2, fresh OIDC dance) claims debater-B; in context 1, the Debater B row appears within 15s WITHOUT a refresh. Assert: in context 1, `lobby-participant-debater-B-name` appears with carol's screen name AFTER carol's claim completes; the `lobby-waiting-for-debater` testid is no longer visible; `lobby-both-debaters-present` testid is visible. **This is the manual-smoke proof for `m_manual_lobby_smoke`** — the chain a moderator would manually drive to verify the lobby works end-to-end. Three fresh OIDC dances per CI run (alice, ben, carol); the dev Authelia rate-limit budget tolerates it per Decision §7.

The two scenarios are deliberately the minimum the milestone needs:
- Single-debater proves the cold-load HTTP-prefetch path works against the live backend.
- Two-debater proves the WS live-update path works cross-context (the moderator-watching-debater-arrive scenario), which is the conceptual heart of the manual smoke. The fact that ben sees carol (a second debater) is structurally identical to what the moderator would see watching ben arrive — both observers consume the same `participant-joined` broadcast stream.

The cross-surface "moderator sees both debaters in the moderator's lobby" scenario is still deferred to `part_pw_concurrent_with_moderator` (per `part_invite_acceptance` Decision §7) — that scenario adds the moderator's surface as a third context and asserts on the moderator's slot reducer, which is a different concern. This leaf's two-debater scenario pins the **participant-side** live-update contract; the cross-surface pin remains the concurrent-with-moderator leaf's responsibility.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the milestone-closing requirement per `ORCHESTRATOR.md`.** The lobby is reachable from a user-visible flow (the moderator-emitted invite URL → claim → lobby chain). The two scenarios above cover the contract end-to-end:

- The single-debater scenario pins the cold-load HTTP-prefetch path + the static slot rendering.
- The two-debater scenario pins the live-update path that is the **conceptual heart of the manual smoke** — a moderator who manually drove `make up`, opened two private/incognito browsers, logged in as two different debaters, and followed two invite URLs would expect to see each debater's lobby update live as the other one joins. The Playwright scenario IS that manual smoke, automated.

**No future leaf inherits deferred e2e debt from this task.** The remaining cross-surface debt (moderator's slot reducer observing both debaters) is owned by `part_pw_concurrent_with_moderator` per `part_invite_acceptance` Decision §7 — that's a pre-existing inheritance, not new debt from this task.

### Budget honesty (0.5d)

The 0.5d budget breaks down roughly:

- ~30 min: write `apps/participant/src/routes/LobbyRoute.tsx` (~250 LOC including the two fetch effects, the slot reducer, the merge function, and the body render). Lifts patterns from the moderator's `InviteParticipants.tsx` line-for-line.
- ~5 min: delete `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` and its test file; edit `apps/participant/src/App.tsx` to swap the route element + import (~5 LOC change).
- ~45 min: write `apps/participant/src/routes/LobbyRoute.test.tsx` — 10 cases with fetch-mock + router wrapper + auth provider stub + WS-store direct writes (~350 LOC including helper boilerplate). Lifts patterns from `useParticipantConnectionStatus.test.ts` (for the store-setState injection) and `CreateSession.test.tsx` in the moderator workspace (for the fetch-mock + router wrapper).
- ~30 min: write `tests/e2e/participant-lobby.spec.ts` — single-debater (~80 LOC) + two-debater-with-second-context (~120 LOC). The shape is the invite-acceptance spec extended with a second context.
- ~10 min: edit `tests/e2e/participant-invite-acceptance.spec.ts` — migrate the two `lobby-placeholder` / `session-id` testid assertions to the new lobby testids; update the comment block.
- ~10 min: edit `playwright.config.ts` testMatch (one regex character class change).
- ~10 min: i18n catalog edits (12 new keys + 1 removal × 3 locales + 2 review.json updates).
- ~30 min: `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e --project=chromium-participant-skeleton` (against `make up`) + the WBS-status ritual + the milestone-propagation update (`complete 100` on `m_manual_lobby_smoke`) + the commit. Compose stack down via `make down-v` at end.

Risk surface is moderate:

- The two-context Playwright scenario is the riskiest piece — three OIDC dances per CI run (alice for session-create, ben for debater-A, carol for debater-B). The dev Authelia rate-limit budget is the constraint; the existing `participant-invite-acceptance.spec.ts` already runs two dances, so adding one more (carol) is a one-dance increase. If the rate limit becomes a problem, a fallback is to use `page.request.post` from a single-context alice to fabricate carol's claim (drive the claim server-side; render the lobby for ben; assert the WS event arrives in ben's lobby without ever opening a second browser context). That fallback retains the participant-side WS-live-update pin while saving two dances; Decision §7 settles "use two contexts" against "single-context with API drive" — the two-context shape is more faithful to the manual-smoke flow a human would drive.
- The HTTP-prefetch + WS-merge composition is novel for the participant workspace (the invite route only POSTed once; this is the first read-side composition). The 10 Vitest cases (especially case (c)'s WS-event injection) pin the merge contract; the Playwright two-debater scenario pins it against the live backend.
- The placeholder deletion is mechanical but cross-cuts the invite-acceptance Playwright spec (the two testid assertions at lines 192-193). Decision §8 covers the migration.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dep; the lockfile should not move.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new route + slot reducer + merge function all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build; bundle filename / sidecar shape unchanged; the new code tree-shakes into the existing `participant-<hash>.js`.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+10** (10 new cases in `LobbyRoute.test.tsx`) and shrinks by **−1** (deleted `LobbyPlaceholderRoute.test.tsx`), net **+9**.
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the 12 new keys present in all three locales; the `lobbyPlaceholder.body` key removed from all three locales + both `.review.json` files; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the new scenarios green. The pre-existing 4 skeleton-smoke scenarios + 2 invite-acceptance scenarios from `part_ws_client` / `part_invite_acceptance` stay green (the invite-acceptance happy-path's two updated testid assertions now read `route-lobby` / the lobby-side rendering of the session id, NOT `lobby-placeholder` / `session-id`); the 2 new scenarios from `participant-lobby.spec.ts` pass. Total scenarios in the project grow from 6 to 8.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No new `fetch` / `XMLHttpRequest` / `window.location` write** under `apps/participant/src/` other than the two new GETs in the lobby route (`GET /api/sessions/${id}` and `GET /api/sessions/${id}/participants`) plus the single POST in the existing invite route (which is auditable + scoped + unchanged).
10. **No OIDC profile-claim identifier** under `apps/participant/src/` — the forbidden list (`email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`) returns zero grep matches (the audit `part_auth_flow` established stays green).
11. **No participant-local `createWsClient()` call** — a grep for `createWsClient` under `apps/participant/src/` returns zero matches.
12. **The `trackSession` lifecycle is wired correctly** — the Vitest case (h) asserts both `trackSession(${id})` on mount and `untrackSession(${id})` on cleanup (single call each, against the right session id).
13. **The live-update path works** — the Vitest case (c) asserts that a `participant-joined` event injected into the store via `useWsStore.setState` causes the new debater's row to render; the Playwright two-debater scenario asserts the same against the live backend across two browser contexts.
14. **The empty-state and waiting-state branches render correctly** — Vitest cases (b), (d), (e), and the conditional renders pinned at the badge / waiting / both-present testids.
15. **The HTTP error paths render the retry button + clicking retry refetches** — Vitest cases (f), (g) pin both error branches independently.
16. **The placeholder is gone** — `apps/participant/src/routes/LobbyPlaceholderRoute.tsx` and its test file do not exist after the commit; a grep for `lobby-placeholder` under `apps/participant/src/` returns zero matches; the `participant.lobbyPlaceholder` namespace is absent from all three locale catalogs.
17. **The invite-acceptance Playwright spec stays green** — the two updated testid assertions at the old lines 192-193 (now reading `route-lobby` + the lobby's session-id surface) pass against the live lobby route.
18. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_lobby_view` task block AND on the `m_manual_lobby_smoke` milestone task per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.
19. **Predecessor's existing assertions unchanged** — `tests/e2e/participant-skeleton-smoke.spec.ts`'s four scenarios pass without modification; the chip's source-hook Vitest cases pass unchanged; the invite-route Vitest cases pass unchanged. The only test file outside this leaf's allowlist that gets modified is `participant-invite-acceptance.spec.ts` (the two testid assertions; see Decision §8).

## Decisions

### 1. Data source for the joined-participants list: HTTP prefetch + WS live-update (NOT WS-only; NOT polling)

Three alternatives surveyed:

- **(A) WS subscription only.** The lobby mounts, calls `client.trackSession(id)`, and reads `useWsStore.sessionState[id]?.events` to derive the slot map. The WS catch-up replay (per `client.ts:trackSession` — sends `subscribe` with `sinceSequence: 0` on first subscribe; receives every `event-applied` for the session's history) populates the events slice. Rejected: the catch-up replay is asynchronous and races the initial render. On a fresh tab opened directly on the lobby URL (e.g. a user who refreshed the page, or who follows the URL from a bookmark) the lobby paints with an empty `events` array, then re-paints once the WS round-trips. The intermediate empty state would render as the "you're the first to arrive" empty state, which is misleading (the user IS in the session per the cookie + the existing participants row). The race is not theoretical — the moderator's invite view at [`apps/moderator/src/routes/InviteParticipants.tsx:185-188`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185) documents the exact same race and explicitly named the HTTP-prefetch composition as the resolution ("the catch-up replay inside `trackSession` (sinceSequence: 0 when the store has no events for the session yet) populates the per-session event slice so the slot reducer below renders the correct state on first paint after a hard reload"). The moderator's view does NOT pre-fetch today — it pays the misleading-empty-state cost — and registered `mod_invite_participants_rest_prefetch` as the follow-up to switch. **This leaf gets the prefetch right from the start** instead of inheriting the moderator's debt.

- **(B) Polling `GET /api/sessions/:id/participants` every 2-5 seconds.** The lobby fetches the participants list on mount; sets a `setInterval` that re-fetches every N seconds; on each fetch, replaces the slot map with the fresh row set. Rejected for the milestone-closing scenario: a polling interval introduces a worst-case delay of N seconds between Debater B claiming and Debater A seeing the new row, which directly undermines the "see each other live" criterion (`m_manual_lobby_smoke`). The polling cost (a GET per N seconds per open lobby per participant) is fine at this scale but pays nothing the WS subscription doesn't already provide; the WS subscription is **already open** (the surface-wide `<WsClientProvider>` opens the socket on auth; the lobby just `trackSession`s a specific session). Polling on top of an already-open WS would be redundant work.

- **(C) HTTP prefetch on mount + WS subscription for live updates** (chosen). The lobby fetches `GET /api/sessions/:id/participants` once on mount to seed the slot map with authoritative server state (resolves the cold-load race); the WS subscription via `client.trackSession(id)` then provides live updates (`participant-joined` / `participant-left` events from any source — the second debater claiming, a debater leaving, etc.). The merge logic (`mergeSlots(httpRows, wsOccupants)`) composes both: HTTP seeds the map; WS events overlay any subsequent change. The HTTP prefetch's row set and the WS event stream are **consistent by construction** — the participants endpoint returns the same rows that the catch-up WS replay would project from the event log (they read from the same DB; the only difference is the snapshot-vs-stream representation). A WS event that arrives between the HTTP fetch starting and finishing is captured by the WS subscription and applied on top of the HTTP result. There is no "two sources disagree" failure mode the merge logic has to handle — at worst, the HTTP prefetch could lag behind one event, and the WS event overlay re-applies it (idempotently, since `applyEvent` dedupes by `sequence`).

  The composition is the same posture the moderator's invite view's planned `mod_invite_participants_rest_prefetch` adoption would land; this leaf gets there first because the lobby is a brand-new view with no prior WS-only baseline. The follow-up `mod_invite_participants_rest_prefetch` task remains independently registered (it's the moderator's adoption; this leaf doesn't touch the moderator's code).

  The chosen approach SATISFIES the milestone's "see each other live" criterion via the WS overlay; resolves the cold-load race via the HTTP prefetch; and pays no extra cost vs. WS-only on the live-update path (the WS subscription is already open).

### 2. Lobby content: minimal viable = topic + active participants list + waiting/empty hints; nothing else

Three alternatives surveyed:

- **(A) Topic only + participants list.** Rejected: no signal to the user about what to do next. The "waiting for the moderator to start" hint (or "waiting for Debater B to arrive") is a single sentence that costs nothing to add and tells the user the lobby is the right place to be — a critical UX cue for a moderator-driven flow where the next action belongs to someone else.

- **(B) Topic + participants list + waiting/empty hints** (chosen). The minimum the user needs to understand the surface ("I'm in the right place; I'm waiting; the other people I'm waiting for are X and Y"). The empty state ("you're the first to arrive") fires when the caller is the only debater + no other-debater hint applies; the waiting-for-Debater-X hint fires when one debater is missing; the both-debaters-present hint fires when both are joined and the lobby is waiting on the moderator. No buttons, no inputs, no actions — the lobby is observational.

- **(C) Add a "ready" toggle, a "leave" button, a chat surface, or other interactive affordances.** Rejected for this leaf: out of scope per Out-of-scope above. None of these have a consumer in the M3-lobby milestone; landing them now would be over-design. A future leaf can add them when the consumer surfaces.

### 3. State transition out of the lobby: this leaf does NOT handle it

The lobby gives way to the live debate surface when the moderator triggers a "start debate" event. For this milestone:

- The exact start-debate event kind is not yet defined (it's the methodology engine's concern; future leaves will land it).
- The lobby's responsibility for this leaf is just to render correctly + provide the substrate (open WS subscription) the future start-debate handler will sit on top of.
- The lobby does NOT subscribe to a hypothetical `debate-started` event today; the future leaf that lands the start trigger will add the subscription as a sibling effect.

Two alternatives surveyed:

- **(A) Land a stub start-debate handler that navigates somewhere on a hypothetical event.** Rejected: the event kind doesn't exist; speculating about it would create dead code that the future leaf would have to delete. YAGNI.

- **(B) Land nothing for the transition** (chosen). The lobby is purely observational; the future leaf adds the transition. The trackSession lifecycle this leaf installs stays open across the future transition (idempotent re-tracking on the debate surface's mount is safe), so there's no WS subscription debt the future leaf has to clean up.

### 4. Empty state: render "you're the first to arrive" only when the caller is the only debater AND no other debater is present

The empty state's trigger condition is precisely: `(auth.user.id === slots['debater-A']?.userId && !debaterBPresent) || (auth.user.id === slots['debater-B']?.userId && !debaterAPresent)`. In English: the caller is one of the two debater slots, and the OTHER debater slot is empty.

The condition excludes:
- The moderator's case (the moderator doesn't see this view at all — the moderator's lobby is a different surface; the participant lobby is debater-only by URL convention).
- The both-debaters-present case (replaced by the `bothDebatersPresent` hint).
- The other-debater-but-not-me case (impossible: the participant always sees their own row, since the caller authenticated and the HTTP prefetch returns the caller's row).

Two alternatives surveyed:

- **(A) Render "you're the first to arrive" whenever the participants list has only one debater row** (regardless of which one). Rejected: would render incorrectly for a hypothetical observer-only case (which doesn't exist today, but the wording is wrong for it).

- **(B) Caller-specific condition** (chosen). The wording ("you're the first to arrive") explicitly references the caller; the condition narrows to the case where the wording is accurate.

The empty-state line is a secondary affordance — it renders ALONGSIDE the "waiting for Debater B" hint (the hint is the primary signal; the empty-state line is a friendly addendum). The Playwright single-debater scenario asserts both lines visible.

### 5. Error handling: each HTTP fetch has an independent retry; WS errors surface through the chip (no in-route surface)

Two alternatives surveyed:

- **(A) One combined error region for both fetches with one retry button that refetches both.** Rejected: the two fetches are independent (the header is for the topic; the participants list is for the slot map); a header-fetch-failed + participants-fetch-succeeded scenario should show the participants list with a header-error banner, not collapse both into a blank slate. Independent retry per fetch lets the user recover from one without losing the other.

- **(B) Per-fetch error regions with per-fetch retry buttons** (chosen). Each fetch's `useEffect` has its own state machine + its own retry nonce; clicking a retry button bumps the nonce, the effect re-fires. Mirrors the moderator's invite view's pattern at [`apps/moderator/src/routes/InviteParticipants.tsx:200-244`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L200).

WS connection errors (the socket drops, reconnects, fails) surface through the **chip in the footer**, not through the lobby body. The chip is structural chrome owned by `part_status_indicator`; this leaf does not duplicate the signal. A user who sees the chip flip to `reconnecting` knows the live-update path is currently degraded; the lobby body continues to show the last-known slot map (the WS event slice is durable across reconnect; the catch-up replay on reconnect re-syncs).

### 6. Slot-derivation reducer: inline in the lobby route file, NOT extracted to `@a-conversa/shell`

Two alternatives surveyed:

- **(A) Extract `deriveSlotOccupants` to `@a-conversa/shell` so both the moderator's invite view and the participant lobby import it.** Rejected for this leaf: the reducer is ~30 LOC; the moderator's copy and this leaf's copy are independent today (they would diverge only via a deliberate change, which would be caught in either workspace's tests). Extracting without a third caller is YAGNI. The extraction is a clean future refactor when (or if) the audience surface adds a similar derivation.

- **(B) Inline the reducer in `LobbyRoute.tsx`** (chosen). Co-located with its single caller; mirrors the moderator's posture at [`apps/moderator/src/routes/InviteParticipants.tsx:108-137`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108) where the reducer is also inline next to its single caller. A future "extract slot-derivation" task can lift both copies into the shell substrate.

The two reducers are functionally identical today (same event kinds, same role enum, same payload shape, same "stale `participant-left` doesn't erase a fresh slot" semantic). If a behavior change in one needs to propagate to the other, the propagation is manual (both file paths are in the obvious places); the cost is a one-time copy-and-paste plus running both workspaces' tests. Acceptable for the current size.

### 7. Playwright scope: two scenarios, both within the participant surface (single-debater + two-debater live-update)

Two alternatives surveyed:

- **(A) Single-debater scenario only.** Rejected: the milestone-closing requirement is "two debaters land in the lobby and see each other live"; a single-debater scenario pins only the cold-load path, not the live-update path. The single-debater scenario alone would NOT demonstrate the manual-smoke chain works end-to-end.

- **(B) Two scenarios: single-debater (cold-load) + two-debater-with-live-update (the heart of the manual smoke)** (chosen). The two-debater scenario uses two browser contexts (Playwright's `browser.newContext()`); each context drives its own OIDC dance for its debater; the test asserts that context 1's lobby renders the new debater's row within ~15s of context 2's claim, without a manual refresh. This is the structural automated counterpart of the manual smoke a human moderator would drive.

The cross-surface "moderator's lobby ALSO updates live" scenario remains the responsibility of `part_pw_concurrent_with_moderator` (per `part_invite_acceptance` Decision §7) — that scenario adds the moderator's surface as a third context and asserts on the moderator's slot reducer, which is a different concern from the participant-side lobby this leaf owns. This leaf's two-debater scenario pins the **participant-side** WS live-update contract; the cross-surface pin remains deferred to the named existing leaf.

The dev Authelia rate-limit budget: the single-debater scenario costs 1 fresh OIDC dance (ben; alice uses the seeded `setup-auth` jar but logs out which would revoke alice's bootstrap JTI — per the invite-acceptance spec's pattern, the scenario creates a fresh context with no storage state and drives a fresh alice dance; same construction here). The two-debater scenario costs 3 fresh dances (alice + ben + carol). Total new dances for this leaf: 4 per CI run, on top of the invite-acceptance spec's 2. Within budget per the invite-acceptance refinement's analysis.

### 8. Testid migration: replace `lobby-placeholder` / `session-id` with `route-lobby` + the new lobby surfaces

The invite-acceptance Playwright spec at lines 192-193 reads:

```ts
await expect(page.getByTestId('lobby-placeholder')).toBeVisible();
await expect(page.getByTestId('session-id')).toHaveText(sessionId);
```

After this leaf, the placeholder is deleted and the testids it emitted (`lobby-placeholder`, `session-id`) are no longer emitted by the new `<LobbyRoute>`. The new lobby surfaces:
- `route-lobby` (the route's stable testid; analogous to `route-invite-acceptance`).
- `lobby-topic` (carries the session topic).
- `lobby-participants-list` + per-role rows (`lobby-participant-${role}`).
- The session id is NOT a first-class testid on the lobby (the topic is what the user cares about; the id is internal). The Playwright assertion that the URL settles on `/p/sessions/<id>/lobby` already pins the id round-trip via `page.waitForURL`; an additional in-body testid for the id would be redundant.

The migration:

```ts
await expect(page.getByTestId('route-lobby')).toBeVisible();
```

The `session-id` assertion is **dropped** (the URL-based assertion at the line above already covers the round-trip); no replacement needed. The comment block above the lines is updated to reflect the migration.

Two alternatives surveyed:

- **(A) Keep the testids as aliases on the new lobby route** (`data-testid="lobby-placeholder"` and `data-testid="session-id"` on hidden elements). Rejected: emits stale testids that don't reflect the route's actual content; future readers would be confused; the testids' names misrepresent the new component.

- **(B) Migrate the testids in the invite-acceptance spec to the new lobby's testids** (chosen). One spec touched outside the strict allowlist; the touch is the structural follow-up the placeholder's removal forces. The amendment is documented in this refinement's Constraints + Decision §8.

### 9. Cleanup of the `participant.lobbyPlaceholder` i18n namespace

The placeholder route's i18n key `participant.lobbyPlaceholder.body` ("You're in the lobby.") becomes orphaned when the placeholder is deleted. Two alternatives:

- **(A) Migrate the string into `participant.lobby.placeholder.body`** (or similar) and keep the entry. Rejected: the new lobby's body is different (it's the full lobby UX, not a "you're in the lobby" one-liner); the old string is genuinely obsolete.

- **(B) Delete the `lobbyPlaceholder` namespace entirely from all three locales + both `.review.json` `pending` lists** (chosen). The namespace had one key, now obsolete; cleaning it up keeps the catalog honest. The i18n-catalogs parity-check (`pnpm --filter @a-conversa/i18n-catalogs run check`) will verify all three locales have consistent shapes.

### 10. Tech-debt registration

- **`frontend_i18n.i18n_participant_lobby_native_review`** — pt-BR + es-419 native-speaker review of the 12 new keys under `participant.lobby.*`. Effort: 0.25d. Mirrors the existing `i18n_participant_invite_acceptance_native_review` task shape (per `tasks/35-frontend-i18n.tji`). **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes, chained after `!i18n_participant_invite_acceptance_native_review` to keep the participant-side native-review chain linear.

- **No other follow-ups need registration.** The two participant-UI e2e deferrals (Decision §7 for cross-surface; no other deferrals) are inherited by named existing leaves (`part_pw_concurrent_with_moderator` for the cross-surface scenario). The placeholder removal is the structural close of `part_invite_acceptance`'s deferred-debt; that debt is now paid down by this leaf and does not propagate. The moderator-side `mod_invite_participants_rest_prefetch` follow-up (registered by the participants-list endpoint's refinement) is the moderator's adoption — independent of this leaf; not this task's responsibility.

### 11. The `user-already-joined` "go to lobby" affordance from the invite route still works

The invite route's terminal `user-already-joined` branch renders a "go to lobby" button that navigates to `/sessions/${id}/lobby` (per `part_invite_acceptance` Decision §3 + the route's `invite-acceptance-go-to-lobby` testid). After this leaf:

- The "go to lobby" button still navigates to `/sessions/${id}/lobby`.
- The destination is no longer the placeholder; it's the real lobby route.
- The user lands on the lobby and sees their existing slot row (which they already filled in a prior tab/session) + the moderator + whoever else has joined.

The transition is graceful — the user-already-joined path is the structural recovery surface for "you tried to claim again; you're already in; here's the lobby."

### 12. No new ADR needed

This task introduces no new architectural choices beyond existing precedents. Every decision above applies an existing ADR (0026 for the surface-consumes-from-shell-substrate posture, 0022 for the test discipline, 0002 for cookie-only auth, 0021 for the event-envelope shape, 0024 for the i18n catalog) or codifies a scoped UI policy (Decisions §1 / §2 / §3 / §5 / §6 / §7 / §8 / §9). The "no new dependencies" rule is satisfied: no `package.json` change. The "no new shell substrate" rule is honored: `useAuth()` + `useWsClient()` + `useWsStore` + the i18n bridge are all consumed unchanged. The "no new server-side change" rule is honored: both endpoints (`GET /api/sessions/:id` and `GET /api/sessions/:id/participants`) are shipped.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Real `<LobbyRoute>` lives at `apps/participant/src/routes/LobbyRoute.tsx` and renders at `/p/sessions/:id/lobby`; `apps/participant/src/App.tsx` swaps its route element from the placeholder to the real component and the placeholder pair (`LobbyPlaceholderRoute.tsx` + `LobbyPlaceholderRoute.test.tsx`) is deleted in the same commit.
- HTTP prefetch (`GET /api/sessions/:id` + `GET /api/sessions/:id/participants`) seeds the slot map on mount with the server's authoritative active rows; per-session WS overlay (`client.trackSession(id)`) drives live `participant-joined` / `participant-left` updates. `mergeSlots(httpRows, wsOccupants)` composes both with WS winning collisions (the WS payload is the canonical `screen_name` source).
- Vitest pinning lives in `apps/participant/src/routes/LobbyRoute.test.tsx` (+10 new cases); suite delta 3494 → 3503 (+9 = +10 added − 1 deleted with the placeholder test). Behavior pinned: loading / error / loaded states, both retry buttons, the moderator + debater slot rows, "only me" empty state, both-debaters-present render, waiting-for-debater branches, WS overlay vs. HTTP-only collision, and stale-`participant-left` slot semantics.
- Playwright Browse-A / Browse-B cross-context manual-smoke proof at `tests/e2e/participant-lobby.spec.ts` covers (a) the single-debater happy path (one debater opens the lobby and sees the moderator + themselves) and (b) the two-debater cross-context live-update (Browse-A enters first, Browse-B's join becomes visible in A's lobby without reload). `playwright.config.ts` widens the participant-skeleton project's `testMatch` to include the new spec; `tests/e2e/participant-invite-acceptance.spec.ts` migrates from the deleted `lobby-placeholder` / `session-id` testids to `route-lobby`. 9/0 PASS in `chromium-participant-skeleton`.
- i18n catalog scope: 12 new keys under `participant.lobby.*` land in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` (title, topicLabel, participantsHeading, bothDebatersPresent, waitingForDebater, emptyState, three roleBadges, three errors.*); the obsolete `participant.lobbyPlaceholder.*` block is removed from all three locales + their `*.review.json` trackers; pt-BR / es-419 draft keys land flagged PENDING in the review trackers and are deferred to the new `frontend_i18n.i18n_participant_lobby_native_review` leaf chained after `i18n_participant_invite_acceptance_native_review`.
- Loading-state affordance renders `aria-busy="true"` + a non-localized ellipsis under `data-testid="lobby-loading"` instead of minting a 13th catalog key for transient text, staying within the refinement's 12-key budget. Test-infra note: the cross-context Playwright scenario uses the Authelia seed user `maria` for debater-B in place of the refinement-quoted `carol` (carol is not in `authelia/users.yml`); refinement budget math is unchanged.
- This commit closes the final dependency of milestone `m_manual_lobby_smoke` (M3-lobby); the milestone propagates to `complete 100` in the same commit and a human can now drive the full invite-and-lobby smoke end-to-end.
