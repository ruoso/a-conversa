# Wire participant surface to shell's WS client

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_ws_client`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_shell.part_state_management` (settled — the participant's `useWsStore` singleton is exported from [`apps/participant/src/ws/wsStore.ts`](../../../apps/participant/src/ws/wsStore.ts#L36) and is a thin `createDefaultWsStore()` call from `@a-conversa/shell` with no projection widening; the three local-UI slices under [`apps/participant/src/stores/`](../../../apps/participant/src/stores/) ship alongside it; the participant-side regression pins at [`apps/participant/src/ws/wsStore.test.ts`](../../../apps/participant/src/ws/wsStore.test.ts) prove the base contract's `setConnectionStatus` / `applyProposalStatus` writers work for participant consumption. The state-management refinement's Decision §5 explicitly defers the `<WsClientProvider>` wiring + the `useParticipantConnectionStatus.ts` source swap + the connection-state-transition Playwright assertion to this leaf — see [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md#L408-L417)).
- `shell_package.shell_substrate_extraction` (settled — `createWsClient`, `WsClient`, `WsClientProvider`, `useWsClient`, `WsClientAuthState`, the `BaseWsStoreState` contract, and the `WsConnectionStatus` discriminated union all live in `@a-conversa/shell`; the provider opens the socket iff `auth.status === 'authenticated'`, calls `client.close()` on unmount, and resets the supplied store. See [`packages/shell/src/ws/WsClientProvider.tsx:70-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L70), [`packages/shell/src/ws/client.ts:125-146`](../../../packages/shell/src/ws/client.ts#L125), and the substrate refinement at [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_status_indicator` (settled — the persistent connection-state chip at [`apps/participant/src/layout/ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx) is already plugged into the layout footer slot and reads from the source-hook seam at [`apps/participant/src/layout/useParticipantConnectionStatus.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts#L20). This leaf performs the one-line swap in that file so the chip reflects real connection state instead of the `'connecting'` literal — see [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md#L325-L336) Decision §2 for the pre-committed swap shape).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_ws_client` (shipped 2026-05-11 — the canonical pattern this leaf mirrors. The moderator wires `<WsClientProvider>` per-route (`/sessions/:id/operate`, `/sessions/:id/invite`) so the WS connection's lifetime tracks the route that needs it. This leaf adopts a *surface-wide* mount instead per Decision §1 below — the participant has no operate-vs-non-operate route distinction today, the status chip is persistent across every route, and the connection cue is the M3-lobby user-perspective signal regardless of which participant view the debater is on).

## What this task is

The 0.5d wire-up that flips the participant surface from "has a WS store nobody writes to" into "has a live WS connection feeding the store the chip reads from." After this leaf:

- A `<WsClientProvider>` from `@a-conversa/shell` wraps the participant React tree inside `apps/participant/src/main.tsx`'s `mount()` body. The provider is parameterized with `auth={{ status: props.auth.status }}` (the host-supplied auth value) and `clientOptions={{ store: useWsStore }}` + `store={useWsStore}` (the participant's `useWsStore` singleton from `part_state_management`). When the host hands a `MountProps.auth` whose status is `'authenticated'` — which it always is at first hand-off, per `requiredAuthLevel: 'authenticated'` in the surface's `SurfaceModule.meta` — the provider's `useEffect` fires `client.connect()` and the socket opens against the same-origin `/api/ws` endpoint with the HttpOnly `aconversa-session` cookie attached automatically.
- The store's `setConnectionStatus` writer fires through the full transition path the moderator already proved: `'idle'` (factory default) → `'connecting'` (the moment `connect()` enters the socket-open path) → `'open'` (after the server's `hello` envelope lands and dispatches into `setConnectionId`) → `'reconnecting'` / `'closed'` on a transient drop or durable close, with exponential backoff per [`packages/shell/src/ws/client.ts:339-348`](../../../packages/shell/src/ws/client.ts#L339).
- The one-line swap in [`apps/participant/src/layout/useParticipantConnectionStatus.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts#L20) — replacing `return 'connecting';` with `return useWsStore((s) => s.connectionStatus);` — makes the chip reflect the real state. The chip's structure, ARIA contract, and the five-state mapping tables all stay; only the data source changes.
- The participant `main.tsx` also gains the same window-exposure trick the moderator carries at [`apps/moderator/src/main.tsx:36-55`](../../../apps/moderator/src/main.tsx#L36) — assigning `useWsStore` to `(window as any).__aConversaWsStore` — so the Playwright e2e spec can imperatively drive store state for the disconnected-transition scenario without spinning up server-side wire-tear infrastructure. The assignment is unconditional (not `import.meta.env.DEV`-gated) for the same reason: the compose stack's production-mode build tree-shakes DEV-gated branches and the e2e spec relies on the global.
- The Playwright spec at [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) gains a new scenario asserting the connection-state-transition end-to-end: `'connecting'` is observable shortly after navigation (the chip's initial paint), `'open'` appears after the WS handshake completes against the live `make up` compose stack, and `'closed'` appears after an imperative `setConnectionStatus('closed')` invocation via the `__aConversaWsStore` global. The chip's `data-status` attribute is the assertion anchor; the chip's component-shape Vitest cases already pin the per-state DOM, so the e2e only needs to pin the transitions.
- The participant's existing predecessor assertion at `tests/e2e/participant-skeleton-smoke.spec.ts:102-105` (`data-status="connecting"` after first paint) is *not removed* — it survives as the proof that the chip's initial paint precedes the WS handshake. The new transition scenario layers on after it.

Out of scope (deferred to existing or future leaves):

- **Vote-send and withdraw-send Playwright scenarios.** The task block's note mentions "vote / withdraw send paths" as part of this leaf's wiring scope; per Decision §4 below, the *send paths* (using `useWsClient().send('propose', ...)` / `send('withdraw', ...)`) become callable from the participant tree the moment this leaf mounts the provider, but **no user-visible UI consumes them today.** `part_voting.part_vote_button_per_facet` is the first leaf that surfaces a vote button to a debater; `part_withdraw.part_withdraw_dialog` is the first leaf that surfaces a withdraw affordance. Both already exist as open WBS leaves. Per `ORCHESTRATOR.md`'s deferred-e2e exception ("when the component is not yet reachable"), this leaf defers the vote-send and withdraw-send Playwright scenarios to *those* leaves — they own the user-visible consumer that makes the send path exercisable end-to-end. The connection-state-transition scenario IS exercisable today (the chip is wired) and MUST land in this spec.
- **The real per-session subscription** (`client.trackSession(sessionId)` / `untrackSession(sessionId)`). The participant surface has one wildcard route today and no `:id` param to pull from `useParams()`; subscription is a per-route lifecycle concern, not a surface-wide one. The first real participant route that knows its `sessionId` — `part_session_join.part_invite_acceptance` — owns the `trackSession` lifecycle (mirroring the moderator's `OperateRoute` / `InviteParticipantsRoute` `useEffect` pattern at [`apps/moderator/src/routes/Operate.tsx:141-147`](../../../apps/moderator/src/routes/Operate.tsx#L141)). This leaf only opens the connection; per-session subscription is a downstream concern.
- **The `useUiStore` / `useVoteStore` / `useSelectionStore` consumer wiring.** Those three local-UI slices have zero production consumers after `part_state_management`; this leaf does not add consumers either — vote-button consumers land in `part_voting.*`, graph-selection consumers land in `part_graph_view.*`, tab-switcher consumers land in `part_pending_proposals.part_proposals_tab`. This leaf's scope is the WS substrate only.
- **A WS-state-driven `<RequireAuth>` equivalent.** The moderator gates routes with `<RequireAuth>` outside the provider; the participant has one wildcard route and no parallel gate (per `part_auth_flow` Decision §2's "deliberately not mirrored"). This leaf does not introduce one; if a future participant route needs WS-state gating (e.g. block voting until `connectionStatus === 'open'`), that's the consuming leaf's call.
- **A reconnect-banner UX** ("you've lost connection; reconnecting…"). The chip already carries the `'reconnecting'` state (the amber dot + the `participant.statusIndicator.reconnecting` label per `part_status_indicator` Decisions §3 + §5); a separate banner is a visual-polish concern, not a wiring concern. The chip is the M3-lobby user-perspective signal; richer affordances can land later if user research demands them.
- **A second WS-client instance per surface.** ADR-equivalent invariant from `mod_ws_client` Decisions: "one client, one connection." The participant gets one `<WsClientProvider>` at the surface boundary (mounted by `main.tsx`); per-route mounts are forbidden because they would race the store reset on unmount and pollute the lifecycle.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji:42-46`](../../99-milestones.tji#L42)) is the milestone the orchestrator picks against today, and this leaf is the last `part_shell` group leaf the milestone depends on for its "two debaters land in the lobby and see each other live" success criterion. The chain a real debater hits today — after the four shipped `part_shell` leaves (`part_app_skeleton`, `part_auth_flow`, `part_landscape_layout`, `part_status_indicator`) and the just-landed `part_state_management`:

1. Debater clicks the moderator-emitted invite URL `/p/sessions/<uuid>/invite?role=debater-A`.
2. Root host's `/p/*` route dispatches `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`; the host's auth-gate passes (after `f93e80b`'s new-user redirect fix); the host calls `surface.mount({ container, auth, i18n, routerBasePath: '/p' })`.
3. The participant `main.tsx` wraps the React tree in `<I18nProvider>` + `<AuthValueProvider>` + `<BrowserRouter>`; the surface mounts; `<ParticipantStatusIndicator>` renders in the footer with the chip's source hook returning the hard-coded `'connecting'` literal.
4. **Today**: the chip stays at `'connecting'` forever. The participant's `useWsStore` exists (`part_state_management` shipped it) but no `<WsClientProvider>` mounts it, so `useWsStore.getState().connectionStatus` stays at the factory default `'idle'` — no writer fires. The debater has no live cue that their browser is actually talking to the backend; the lobby view (when it lands) cannot tell "other debater hasn't joined" from "my WS dropped two minutes ago."
5. **After this leaf**: the surface mounts the `<WsClientProvider>` with the participant's `useWsStore`. The provider's `useEffect` sees `auth.status === 'authenticated'`, calls `client.connect()`, the socket opens, the server's `hello` lands, the store's `setConnectionStatus('open')` fires, the chip's source hook (now reading `useWsStore((s) => s.connectionStatus)`) re-renders the chip's `data-status` from `'connecting'` to `'open'`, the chip's dot flips amber → emerald, and the debater sees "Live" in the footer. On a transient drop the chip flips amber again with "Reconnecting…"; on a durable close, rose with "Disconnected."

Downstream concretely:

- **`part_session_join.part_invite_acceptance`** — the first leaf that needs `useWsClient()` callable. The claim flow's `POST /api/sessions/:id/participants/self-claim` round-trip is HTTP today, but the *broadcast* the moderator's lobby view subscribes to (`participant-joined` event) is WS-borne. Without this leaf, the moderator's lobby view never sees the participant-joined event because no participant WS client is open to receive the broadcast and dispatch it through the store. The claim leaf's `useWsClient().trackSession(sessionId)` call is the natural place to plug in once this leaf lands the provider.
- **`part_session_join.part_lobby_view`** — reads `useWsStore((s) => s.sessionState[sid].events)` for the "other debater joined" feed. Pure consumer of state this leaf's connection populates.
- **`part_voting.part_vote_single_tap`** + **`part_withdraw.part_withdraw_action`** — both read `useWsClient()` for the typed `send('propose'|'withdraw', ...)` round-trip. The send paths only become callable once this leaf mounts the provider; without it, `useWsClient()` throws (per `WsClientProvider.tsx:108-112`).
- **`part_pending_proposals.part_proposals_tab`** — reads `useWsStore((s) => s.sessionState[sid].pendingProposals)` for the badge count. Pure consumer.
- **`part_graph_view.*`** — reads `useWsStore.sessionState[sid].events` to project nodes/edges. Pure consumer.

Architecturally, this leaf is also the **second realization of the shell's `<WsClientProvider>` + `createWsClient()` substrate** (after the moderator). Wiring a second surface through the same provider proves the shell's WS substrate generalizes — the audience surface's later `aud_ws_client` will mirror the same shape (probably without auth-gating since audience is the unauthenticated read-only surface, but the provider's structural pattern carries over). The "one client per surface, mounted at the surface boundary" posture (Decision §1) becomes the convention the audience inherits.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37-L76) — Decision 3 fixes that surfaces consume shared services (auth, i18n, WS) from `@a-conversa/shell` rather than re-implementing them; Consequences §1 makes "single source of truth for the WS client" the architectural promise this leaf honors. The participant's `<WsClientProvider>` is a consumer of the shell-supplied provider; no participant-local WS client exists.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest mount-boundary extension + the connection-state-transition Playwright scenario are the regression pins; no manual "I opened the page and the chip turned green" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth. The WS upgrade carries the `aconversa-session` HttpOnly cookie automatically (same-origin); this leaf does NOT read the cookie, append a token to the WS URL, or pass auth claims through `clientOptions`. The provider's `auth={{ status: props.auth.status }}` carries only the discriminator the provider needs to decide whether to `connect()`.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md#L408-L417) — the predecessor. **Status block §"deferred-e2e debt" explicitly names this task as the inheritor** of (a) the connection-state-transition Playwright scenario and (b) the `useParticipantConnectionStatus.ts` swap from the `'connecting'` stub to `useWsStore((s) => s.connectionStatus)`. This leaf closes both. The predecessor's Decision §5 also pre-committed that the swap lives in `part_ws_client`'s closer, not in `part_state_management`'s scope.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md#L325-L336) — Decision §2 ("Stubbed source today; wire the real `useWsStore` in `part_ws_client`'s follow-up") is the contract this leaf delivers. The Decision §2 risk note also pre-committed the Playwright-flake mitigation strategy for the chip's initial-state assertion: this leaf updates the existing `'connecting'` assertion to tolerate either `'connecting'` (the chip's instantaneous initial paint) or `'open'` (if the WS handshake completes before Playwright reads `data-status`) — see Decision §3 below.
- [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L172) — the mount entrypoint shape. This leaf adds the `<WsClientProvider>` *inside* the existing provider tree (`<I18nProvider>` outer, `<AuthValueProvider>` next, then `<WsClientProvider>` new, then `<BrowserRouter>` inner) so the WS provider sees the auth context and the router has access to `useWsClient()`.
- [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md) — the `useAuth()` consumption pattern. Not consumed directly in this leaf's wiring (the provider takes the auth value through `main.tsx`'s `props.auth`, not through `useAuth()` inside the React tree), but the same "the host hands us an auth value; we don't re-fetch" invariant applies. Per the shell's `WsClientAuthState` contract (a narrowed slice of `AuthContextValue.status`), the provider only needs the discriminator.
- [`tasks/refinements/moderator-ui/mod_ws_client.md`](../moderator-ui/mod_ws_client.md) — the canonical precedent. What carries over: the `<WsClientProvider>` mount shape, the `clientOptions={{ store: useWsStore }}` + `store={useWsStore}` props (the double-pass — see Decision §2), the `useWsStore` singleton-as-store contract, the imperative-store-via-window pattern for Playwright. What is intentionally different: this leaf mounts the provider at the *surface* boundary (`main.tsx`), not at a per-route boundary, because the participant has one wildcard route today and the status chip is persistent across every route — see Decision §1.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) — the canonical `createWsClient` / `<WsClientProvider>` / `useWsClient` contract; the substrate this leaf consumes unchanged.

### Live code the leaf integrates with

- [`apps/participant/src/main.tsx:33-50`](../../../apps/participant/src/main.tsx#L33) — the mount entrypoint. This leaf modifies the body to (a) import `WsClientProvider` from `@a-conversa/shell` + `useWsStore` from `./ws/wsStore`, (b) expose `useWsStore` on `window.__aConversaWsStore` (mirroring the moderator's pattern), (c) wrap `<BrowserRouter>` with `<WsClientProvider auth={{ status: props.auth.status }} clientOptions={{ store: useWsStore }} store={useWsStore}>`. No other changes to the entrypoint.
- [`apps/participant/src/layout/useParticipantConnectionStatus.ts:20-23`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts#L20) — the source-hook seam. The body changes from `return 'connecting';` to `return useWsStore((s) => s.connectionStatus);`; the file's header comment block updates to reflect that the swap landed (the "Tomorrow" paragraph becomes "Today"). The function signature and the React-hook naming stay; the call-site contract is stable per Decision §2 of `part_status_indicator`.
- [`apps/participant/src/ws/wsStore.ts:36`](../../../apps/participant/src/ws/wsStore.ts#L36) — the participant's `useWsStore` singleton. Consumed unchanged; this leaf passes it as `store={useWsStore}` + `clientOptions={{ store: useWsStore }}` to the provider.
- [`packages/shell/src/ws/WsClientProvider.tsx:70-100`](../../../packages/shell/src/ws/WsClientProvider.tsx#L70) — the provider. Effect dependencies (`auth.status`, `client`, `store`, `clientOptions`) drive open/close; the unmount path calls `client.close()` and `store?.getState().reset()`.
- [`packages/shell/src/ws/client.ts:215-229`](../../../packages/shell/src/ws/client.ts#L215) — the `createWsClient()` factory. Auto-constructed by the provider when `client` is not supplied; the factory uses `clientOptions.store` for envelope dispatch and the `DEFAULT_URL = '/api/ws'` constant for the same-origin WS endpoint.
- [`apps/moderator/src/main.tsx:33-55`](../../../apps/moderator/src/main.tsx#L33) — the canonical `window.__aConversaWsStore` exposure pattern + the load-time comment block. This leaf mirrors the comment block (with a participant-specific refinement reference) and the assignment line verbatim.
- [`apps/moderator/src/routes/Operate.tsx:101-110`](../../../apps/moderator/src/routes/Operate.tsx#L101) — the canonical `<WsClientProvider>` mount shape (auth prop + clientOptions + store), reproduced at the surface boundary in this leaf instead of per-route.
- [`tests/e2e/participant-skeleton-smoke.spec.ts:96-105`](../../../tests/e2e/participant-skeleton-smoke.spec.ts#L96) — the existing chip assertion (`data-status="connecting"` + the en-US `'Connecting…'` label). This leaf updates the assertion to be transition-tolerant (Decision §3) and appends the new connection-state-transition scenario.

### Existing fixtures the Playwright spec composes with

- [`playwright.config.ts:303-312`](../../../playwright.config.ts#L303) — the `chromium-participant-skeleton` project. Already pre-seeded with the `setup-auth` storage state; the new scenario lands in the same project (no new Playwright project, no new fixture).
- [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) — the existing helper the moderator's Playwright suite uses to imperatively drive `__aConversaWsStore` state from the spec's `page.evaluate()` body. This leaf's new scenario uses the same helper to fire `useWsStore.getState().setConnectionStatus('closed')` for the disconnected-transition assertion.

### What the surface MUST NOT do

- **No participant-local `createWsClient()` call.** The provider's auto-construction (`createWsClient(clientOptions)`) is the canonical path; passing a pre-built `client` prop is reserved for tests. A direct `createWsClient` import in `main.tsx` would duplicate the provider's `useRef`-held singleton and break the one-client-one-connection invariant.
- **No `fetch('/api/ws')` or `new WebSocket('/api/ws')`** from inside the participant workspace. The transport lives in the shell's `client.ts`; the surface consumes it through the provider and the typed `useWsClient()` hook.
- **No localStorage / sessionStorage** reads or writes for WS state. In-memory only, per `mod_ws_client` Decision and the project's no-tokens-in-storage discipline.
- **No `window.location` writes** in response to a WS state. The chip surfaces the cue; the host's auth gate handles re-login if it ever comes to that.
- **No second `<WsClientProvider>` mount** anywhere in the participant tree. The surface boundary in `main.tsx` is the only mount point; per-route providers are an antipattern that races the store reset.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/main.tsx` — modified. Imports `WsClientProvider` from `@a-conversa/shell` and `useWsStore` from `./ws/wsStore`. Adds the `window.__aConversaWsStore = useWsStore` assignment (mirroring the moderator's comment block + assignment verbatim, with the comment block's refinement reference updated). Wraps `<BrowserRouter>` with `<WsClientProvider auth={{ status: props.auth.status }} clientOptions={{ store: useWsStore }} store={useWsStore}>`. No other change.
- `apps/participant/src/layout/useParticipantConnectionStatus.ts` — modified. The body's `return 'connecting';` becomes `return useWsStore((s) => s.connectionStatus);`. The file's header comment block updates to reflect that the swap landed (the "Tomorrow" paragraph becomes a "Status: swapped 2026-MM-DD by part_ws_client" line; the historical context stays for git-blame-without-`git blame` readability).
- `apps/participant/src/mount.test.tsx` — modified. The existing authenticated case grows two pieces: (a) a `<WsClientProvider>`-shaped wrapper around the mount call so the surface's tree resolves `useWsClient()` correctly under test (matching the moderator's mount.test.tsx pattern — passing a stub `client` prop is the cleanest path); (b) an assertion that the chip's `data-status` reflects `useWsStore.getState().connectionStatus` after a `setConnectionStatus('open')` call in the test body (proving the source-hook swap landed and the chip re-renders on store update). The existing assertions stay.
- `apps/participant/src/layout/useParticipantConnectionStatus.test.ts` — NEW. A small Vitest suite (~30 LOC) that drives the participant's `useWsStore.getState().setConnectionStatus(...)` through all five `WsConnectionStatus` arms and asserts the source hook re-renders a probe component with the matching value (mirrors the source-hook contract). Three cases: `'idle'` after reset, `'open'` after `setConnectionStatus('open')`, `'closed'` after `setConnectionStatus('closed')`. The other two arms are covered by the chip's existing component-shape suite (which mocks the source hook per state); this file pins the *source* contract, not the chip.
- `tests/e2e/participant-skeleton-smoke.spec.ts` — modified. The existing first scenario's chip assertion at lines 102-105 changes from a strict `toHaveAttribute('data-status', 'connecting')` to a transition-tolerant `expect.poll()` that accepts either `'connecting'` or `'open'` (Decision §3), and the label assertion follows the same tolerance. A NEW `test.describe` block (or a new `test` inside the existing first describe — author choice; the surrounding describe's name still fits) lands the connection-state-transition scenario:
  1. Navigate to `/p/sessions/<uuid>/invite?role=debater-A`.
  2. Assert the chip starts at `'connecting'` OR `'open'` (the transition is fast; either is acceptable as the *initial* observation).
  3. `await expect.poll(...)` until `data-status === 'open'` lands — pins that the WS handshake actually completes against the live compose stack and the store writer fires.
  4. Imperatively fire `setConnectionStatus('closed')` via `page.evaluate(() => (window as any).__aConversaWsStore.getState().setConnectionStatus('closed'))`.
  5. Assert `data-status === 'closed'` lands and the chip's en-US label reads "Disconnected".
- `pnpm-lock.yaml` — NOT modified (no dep changes; `@a-conversa/shell` is already a workspace dep of `@a-conversa/participant` and ships `WsClientProvider` from its `ws` barrel).

### Files this task does NOT touch

- `apps/participant/src/App.tsx` — the route tree is unchanged; the provider mounts in `main.tsx`, not in the route tree.
- `apps/participant/src/ws/wsStore.ts` / `apps/participant/src/ws/wsStore.test.ts` — the store + its tests are consumed unchanged from `part_state_management`.
- `apps/participant/src/stores/*` — the three local-UI slices are not touched.
- `apps/participant/src/layout/ParticipantStatusIndicator.tsx` / `ParticipantStatusIndicator.test.tsx` — the chip's structure + per-state mapping tables + the seven component-shape cases are unchanged; only the *source* hook this leaf modifies, and the chip's tests still pass because they mock the source hook per state (per `part_status_indicator` Decision §7).
- `apps/participant/src/layout/ParticipantLayout.tsx` / `ParticipantChrome` — the chrome and the layout shell are unchanged; this leaf does not touch the surface's visible structure.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep (`@a-conversa/shell` is already pinned and exports `WsClientProvider`); no new build config; no new project reference.
- `packages/shell/` — substrate consumed unchanged. No new shell substrate; any widening of `WsClientProvider` / `WsClientAuthState` / `createWsClient` belongs to the shell's own leaves.
- `apps/root/` / `apps/server/` / `apps/moderator/` / `apps/audience/` — no cross-surface change.
- `apps/server/src/ws/` — no backend change. The `/api/ws` endpoint already exists and accepts the participant's auth cookie unchanged.
- `playwright.config.ts` — no new Playwright project; the `chromium-participant-skeleton` project's `dependencies: ['setup-auth']` + `storageState: AUTH_STORAGE_STATE_PATH` already cover the precondition.
- `packages/i18n-catalogs/` — no new i18n keys. The chip's per-state labels are already in the catalogs (landed by `part_status_indicator`); this leaf just makes the existing labels reflect the right state.
- `.tji` files — the `complete 100` marker for `part_ws_client` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0026 / 0022 / 0002 / 0024, or a scoped wiring policy that doesn't constrain other tasks).

### Mount-entrypoint shape (`apps/participant/src/main.tsx`)

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
import { useWsStore } from './ws/wsStore';

export const mount: MountFn = (props) => {
  // Expose the WS store on `window` so the Playwright e2e specs in
  // `tests/e2e/` can drive store state (e.g. setConnectionStatus) into
  // the participant chip without standing up a server-side wire-tear
  // path. Mirrors the moderator's `apps/moderator/src/main.tsx:36-55`
  // pattern — same security argument (the store reference is already
  // reachable through the module graph; window-exposure is plumbing
  // convenience, not new capability) and the same unconditional
  // assignment (the compose stack's production build mode tree-shakes
  // DEV-gated branches, so a `import.meta.env.DEV` guard would silently
  // strip the seed entry point in CI).
  //
  // Refinement: tasks/refinements/participant-ui/part_ws_client.md
  (window as unknown as { __aConversaWsStore?: typeof useWsStore }).__aConversaWsStore = useWsStore;

  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          {/*
           * WsClientProvider mounts the surface's single WS client. The
           * provider's internal effect opens the connection iff
           * `auth.status === 'authenticated'` (the surface's mount
           * contract guarantees this at first hand-off via
           * `SurfaceModule.meta.requiredAuthLevel: 'authenticated'`).
           * The `useWsStore` from `part_state_management` is passed as
           * both `clientOptions.store` (for envelope dispatch) and
           * `store` (for the unmount reset) — see Decision §2 for the
           * double-pass rationale.
           */}
          <WsClientProvider
            auth={{ status: props.auth.status }}
            clientOptions={{ store: useWsStore }}
            store={useWsStore}
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
```

The provider sits *inside* `<AuthValueProvider>` (because it needs the surface to be inside the auth context for `useWsClient()` consumers that also call `useAuth()`) and *outside* `<BrowserRouter>` (so `useWsClient()` is callable from any route inside the router — Decision §1's surface-wide mount).

### Source-hook swap (`apps/participant/src/layout/useParticipantConnectionStatus.ts`)

The full file after the swap:

```tsx
// `useParticipantConnectionStatus` — the seam between the participant
// status-indicator chip and the WS subsystem.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
//   (Decision §2 — the swap from the stubbed `'connecting'` to the
//   real `useWsStore` source was pre-committed as part_ws_client's
//   closer).
//   tasks/refinements/participant-ui/part_ws_client.md
//   (this swap landed; the chip now reflects real connection state).
//
// Reads `connectionStatus` off the participant's `useWsStore` singleton.
// The store is fed by the shell's `WsClientProvider` mounted at the
// surface boundary in `apps/participant/src/main.tsx`; the provider's
// `useEffect` calls `client.connect()` when `auth.status === 'authenticated'`
// at first hand-off, and `client.close()` on surface unmount.

import type { WsConnectionStatus } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore.js';

export function useParticipantConnectionStatus(): WsConnectionStatus {
  return useWsStore((s) => s.connectionStatus);
}
```

- The function still satisfies the React-hook contract (the body is now a real hook call — `useWsStore(...)` is Zustand's `useStore` selector binding, which is itself hook-shaped).
- The component's caller-side contract is unchanged: same return type, same call shape, same call site. The `part_status_indicator` chip and its seven component-shape cases (which mock this hook per state) keep passing.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three pins, each anchoring a different observable property:

1. **Vitest mount-boundary (extended)** — `apps/participant/src/mount.test.tsx`. The existing authenticated case grows two pieces:
   - The `mount()` call is wrapped (or the props are reshaped) so the `<WsClientProvider>` resolves under test. The cleanest path matches the moderator's `mount.test.tsx` pattern: construct a stub `WsClient` (a minimal object satisfying the `WsClient` interface — `connect`, `close`, `send`, `trackSession`, `untrackSession`, `status`, `onEnvelope`, `url`) and pass it via `clientOptions` overrides, OR construct a minimal external `client` prop. Either way the provider does not actually open a socket under JSDOM.
   - After the existing identity-and-chip assertions, a new assertion: `act(() => { useWsStore.getState().setConnectionStatus('open'); })` then `expect(screen.getByTestId('participant-status-indicator').getAttribute('data-status')).toBe('open')` — pins the source-hook swap landed and the chip re-renders on store update.
2. **Vitest source-hook contract (NEW)** — `apps/participant/src/layout/useParticipantConnectionStatus.test.ts`. Three cases:
   - (a) Initial `useParticipantConnectionStatus()` returns `'idle'` (the store's factory default) under a probe component.
   - (b) After `useWsStore.getState().setConnectionStatus('open')`, the probe component re-renders with `'open'`.
   - (c) After `useWsStore.getState().setConnectionStatus('closed')`, the probe re-renders with `'closed'`.
   The other two arms (`'connecting'`, `'reconnecting'`) are sufficiently covered by the chip's existing component-shape suite, which mocks this hook per state. Three cases here is the minimum to pin the source-side contract without duplicating the chip's coverage.
3. **Playwright (extended)** — `tests/e2e/participant-skeleton-smoke.spec.ts`. Two changes:
   - **Existing first scenario (`'authenticated user hits /p/...'`)** — the chip assertion at lines 102-105 changes from a strict `await expect(statusIndicator).toHaveAttribute('data-status', 'connecting')` + `toContainText('Connecting…')` to a transition-tolerant `await expect.poll(async () => statusIndicator.getAttribute('data-status'), { timeout: 5000 }).toMatch(/^(connecting|open)$/)`. The transition is fast; either initial state is acceptable. The strict-`'connecting'` assertion would race the handshake (per `part_status_indicator` Decision §2's pre-committed risk note).
   - **NEW scenario (`'connection state transitions through connecting → open → disconnected'`)** — appends to the existing `test.describe('Participant surface skeleton — invite URL reaches the placeholder', ...)` block:
     ```ts
     test('chip surfaces the connection-state transition end-to-end', async ({ page }) => {
       await page.goto(`/p/sessions/${SESSION_ID}/invite?role=debater-A`);

       const chip = page.getByTestId('participant-status-indicator');
       await expect(chip).toBeVisible({ timeout: 15_000 });

       // Initial paint may be 'connecting' or already 'open' depending on
       // handshake speed against the live compose stack; either is fine.
       await expect
         .poll(() => chip.getAttribute('data-status'), { timeout: 5_000 })
         .toMatch(/^(connecting|open)$/);

       // The WS handshake completes against the make-up compose stack;
       // the chip must reach 'open' within the polling window.
       await expect
         .poll(() => chip.getAttribute('data-status'), { timeout: 15_000 })
         .toBe('open');
       await expect(chip).toContainText('Live');

       // Imperatively drive the store to 'closed' (mirroring the
       // moderator's wsStoreSeed helper pattern). The chip's source hook
       // re-renders on the next React tick.
       await page.evaluate(() => {
         const w = window as unknown as { __aConversaWsStore: { getState: () => { setConnectionStatus: (s: string) => void } } };
         w.__aConversaWsStore.getState().setConnectionStatus('closed');
       });

       await expect
         .poll(() => chip.getAttribute('data-status'), { timeout: 5_000 })
         .toBe('closed');
       await expect(chip).toContainText('Disconnected');
     });
     ```
     The scenario runs in the existing `chromium-participant-skeleton` project; no new project, no new fixture. The `__aConversaWsStore` global is set by this leaf's `main.tsx` change (mirroring the moderator's pattern). The `'open'` assertion validates the live WS handshake against the compose stack; the `'closed'` assertion validates the chip-re-renders-on-store-update contract end-to-end.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default per `ORCHESTRATOR.md`.** This leaf inherits deferred e2e debt from `part_state_management` (per its Status block's "deferred-e2e debt" section): specifically, the connection-state-transition Playwright scenario for the chip. That scenario IS exercisable now — the chip is wired (`part_status_indicator` shipped it), the store is wired (`part_state_management` shipped it), and this leaf wires the provider + the source-hook swap — so the scenario MUST land in this spec. The new scenario above covers it end-to-end (connecting → open via real handshake; open → closed via imperative store drive).

The other half of the inherited debt — the vote-send / withdraw-send Playwright scenarios — CANNOT be exercised end-to-end here because no user-visible UI consumes votes or withdraws yet (per "Out of scope" above). Per `ORCHESTRATOR.md`'s deferred-e2e exception, those scenarios are deferred to:

- **`participant_ui.part_voting.part_vote_single_tap`** (existing WBS leaf) — the first leaf that surfaces a vote button. Its refinement-writer MUST scope a Playwright scenario asserting (a) the vote-button tap calls `useVoteStore.setVote`, (b) sends the `propose`/`vote` envelope over the WS, (c) reflects the ack visually, (d) clears the slice via `useVoteStore.removeVote`. This is the e2e debt this leaf cannot close because the consumer doesn't exist yet.
- **`participant_ui.part_withdraw.part_withdraw_action`** (existing WBS leaf) — the first leaf that surfaces a withdraw affordance. Its refinement-writer MUST scope a Playwright scenario asserting the withdraw round-trip end-to-end.

Both leaves already exist in the WBS with the appropriate `depends` edges; per `ORCHESTRATOR.md`'s tech-debt registration policy, no new tech-debt leaf needs to be registered for this deferral — the consuming leaves already own the e2e debt by virtue of being the first user-visible consumers.

### Budget honesty (0.5d)

The 0.5d budget breaks down roughly:

- ~15 min: edit `apps/participant/src/main.tsx` — add the imports, the `__aConversaWsStore` assignment + comment block, the `<WsClientProvider>` wrapper. ~20 LOC change.
- ~5 min: edit `apps/participant/src/layout/useParticipantConnectionStatus.ts` — one-line swap + comment-block update. ~10 LOC change.
- ~30 min: extend `apps/participant/src/mount.test.tsx` — construct the stub `WsClient` shape (the moderator's mount.test.tsx is the precedent if it needs one), wire the provider into the mount call, append the `setConnectionStatus('open')` + chip assertion. ~30 LOC change.
- ~30 min: write `apps/participant/src/layout/useParticipantConnectionStatus.test.ts` — three cases with a small probe component. ~50 LOC.
- ~45 min: extend `tests/e2e/participant-skeleton-smoke.spec.ts` — soften the existing assertion, append the new scenario, verify under `make up` that the handshake actually completes within the polling window. ~50 LOC change.
- ~30 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e --project=chromium-participant-skeleton` + the WBS-status ritual + the commit.

Risk surface is small:

- The provider's lifecycle behavior is two months proven in the moderator. The participant's `useWsStore` is `part_state_management`'s `createDefaultWsStore()` singleton, which `part_state_management`'s `wsStore.test.ts` already pins.
- The biggest implementation hazard is the Playwright handshake race — if the compose stack's WS endpoint takes longer than 15s to land `'open'` on a slow CI runner, the scenario flakes. Mitigation: the `expect.poll(..., { timeout: 15_000 })` window matches the existing chip-visible assertion's `{ timeout: 15_000 }`; if CI proves the handshake reliably takes longer, the future leaf bumps the window. The moderator's e2e suite under the same compose stack reliably completes its WS handshake in single-digit seconds — comparable conditions.
- The mount-boundary test needs a stub `WsClient` so JSDOM doesn't try to open a socket. The cleanest path is passing a literal object satisfying the `WsClient` interface via the `client` prop on `<WsClientProvider>`; the provider does not auto-construct when `client` is supplied. Author-choice between this path and stubbing `makeSocket` inside `clientOptions`.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new `WsClientProvider` import, the `window.__aConversaWsStore` assignment, the modified source hook, and the extended mount-boundary test all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessors pinned; bundle filename / sidecar shape unchanged; the new code tree-shakes into the existing `participant-<hash>.js`.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+3** (the three new `useParticipantConnectionStatus.test.ts` cases). The extended `mount.test.tsx` case does not change the case count (the existing case gains two assertions in-place).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** still green — no catalog changes in this leaf.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs all four scenarios green: the three pre-existing scenarios (per `part_landscape_layout` + `part_status_indicator` + `part_auth_flow`'s closers) plus the new connection-state-transition scenario. Total scenarios in the spec grow from 3 to 4.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No new fetch / WebSocket / window write** under `apps/participant/src/` other than the `window.__aConversaWsStore` assignment in `main.tsx` (which is auditable + named + in line with the moderator's pattern). The provider's transport lives in `@a-conversa/shell`'s `client.ts`, not in the participant workspace.
10. **No participant-local `createWsClient()` call** — a grep for `createWsClient` under `apps/participant/src/` returns zero matches (the provider auto-constructs; the surface does not).
11. **The chip reflects real connection state end-to-end** — the new Playwright scenario asserts `data-status` transitions through `'connecting' | 'open'` (initial) → `'open'` (post-handshake) → `'closed'` (post-imperative-drive) inside the chromium-participant-skeleton project.
12. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_ws_client` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
13. **Predecessor's existing assertions unchanged** — the second and third scenarios in `participant-skeleton-smoke.spec.ts` (identity-surfaces + unauthenticated-deflection) pass without modification; the first scenario's layout-shape + identity-row + product-label assertions still pass (only the strict-`'connecting'` chip assertion softens to transition-tolerant); the chip's seven component-shape Vitest cases pass unchanged; the participant `useWsStore` smoke cases pass unchanged.

## Decisions

### 1. Mount `<WsClientProvider>` at the surface boundary (`main.tsx`), not per-route

Three alternatives surveyed:

- **(A) Mirror the moderator's per-route mount.** The moderator's `OperateRoute` and `InviteParticipantsRoute` each mount their own `<WsClientProvider>` because the moderator has multiple routes and only some need a WS connection (`/sessions/new` and `/sessions/:id/lobby` don't drive WS calls). Per-route mounting keeps the WS connection's lifetime tied to the route that needs it. Rejected for the participant. The participant surface has one wildcard route today, will grow `/sessions/:id/invite` and `/sessions/:id/lobby` and `/sessions/:id` next, and *all* of them want a live WS — the lobby needs the participant-joined feed, the invite-claim needs the claim broadcast, the operate view needs the full event stream. There is no participant route that *doesn't* want the WS connection. Per-route mounting would mean every participant route has to copy the provider boilerplate, AND the per-route mounts would race the store reset on navigation between two WS-driving routes — the provider's unmount path calls `client.close()` + `store.reset()`, which would briefly drop the connection between routes.
- **(B) Mount the provider in `App.tsx` outside the `<Routes>`.** Slightly closer to the moderator's pattern (per-bundle but not per-route). Rejected. `App.tsx` is already inside `<BrowserRouter>` at the surface boundary, and the surface's React tree above the router (in `main.tsx`) is the natural home for surface-wide providers. Putting the provider in `App.tsx` would require `App.tsx` to know about `useWsStore`, which couples the route tree to the store unnecessarily.
- **(C) Mount the provider at the surface boundary in `main.tsx`, outside `<BrowserRouter>` and inside `<AuthValueProvider>`** (chosen). The provider sees the auth value through the prop (not through `useAuth()` inside the React tree — the shell's `WsClientAuthState` contract is exactly the narrowed slice the provider needs); `useWsClient()` is callable from any route inside the router; the WS connection's lifetime tracks the surface mount/unmount, which is exactly what we want for a single-route surface that will grow to many WS-driving routes.

The architectural seam this picks: **one WS provider per surface, mounted at the surface boundary, not per-route.** This is the participant-specific convention; if a future surface has the moderator's mix of WS-driving and non-WS-driving routes, that surface can pick per-route mounting (each surface's convention is local). The audience surface will probably also pick surface-boundary mounting (audience is read-only across all routes, so the WS connection serves every view).

The provider's `auth={{ status: props.auth.status }}` carries only the auth discriminator — when `props.auth.status` changes (a possibility per the host's status flip that `part_auth_flow` covers), React re-renders `main.tsx`'s tree and the provider's `useEffect` re-fires the open/close decision. The shell's `WsClientAuthState` shape is the narrowed contract specifically for this hand-off.

### 2. Double-pass the store: `clientOptions.store` AND `store` prop

The moderator's pattern at [`apps/moderator/src/routes/Operate.tsx:102-108`](../../../apps/moderator/src/routes/Operate.tsx#L102) double-passes `useWsStore`: once inside `clientOptions={{ store: useWsStore }}` and once via the top-level `store={useWsStore}` prop. The two slots serve different purposes:

- `clientOptions.store` is consumed by `createWsClient(clientOptions)` when the provider auto-constructs the client. The client uses it for envelope dispatch (the `dispatchToStore` function inside `client.ts` calls `store.getState().setConnectionStatus(...)` / `applyEvent(...)` / etc.). Without this, the client falls back to a fresh `createDefaultWsStore()` instance (per [`client.ts:228`](../../../packages/shell/src/ws/client.ts#L228)) and the participant's `useWsStore` consumers never see any updates.
- `store` is consumed by the `WsClientProvider`'s unmount-cleanup `useEffect` to call `store?.getState().reset()` on teardown. The provider doesn't reach into `clientOptions` for this because the prop is more explicit at the provider's API surface and tests that pass an external pre-built `client` (without `clientOptions`) still need the reset target.

Three alternatives surveyed:

- **(A) Pass `store` only via `clientOptions.store`** and rely on the provider's fallback path (`store ?? clientOptions?.store`). Rejected: technically works (per [`WsClientProvider.tsx:94`](../../../packages/shell/src/ws/WsClientProvider.tsx#L94)), but the moderator's precedent double-passes for explicitness, and matching the moderator keeps the convention uniform across surfaces. Future readers debugging "why does the store reset on unmount" don't have to walk a fallback chain.
- **(B) Pass `store` only via the top-level prop** and skip the `clientOptions.store`. Rejected: would break envelope dispatch — the auto-constructed client would dispatch into its default in-package store, not the participant's `useWsStore`, and `useWsStore` consumers would never see writes.
- **(C) Double-pass both** (chosen). Matches the moderator's pattern verbatim. The two slots are independent in the provider's implementation; double-passing makes both responsibilities explicit at the call site.

### 3. Soften the existing `'connecting'` chip assertion to transition-tolerant

`part_status_indicator`'s Decision §2 risk note pre-committed this — the strict `data-status="connecting"` assertion would flake the moment the WS handshake completes between the chip's first paint and Playwright's `getAttribute` read. The pre-committed mitigation: this leaf updates the assertion to accept either `'connecting'` (initial paint) or `'open'` (post-handshake).

Two alternatives surveyed:

- **(A) Add an explicit await on `'connecting'` before the handshake-completion check**, so the spec sees `'connecting'` deterministically. Rejected: the handshake is fast — typically sub-100ms against the compose stack — and the first JSDOM-side paint may already include the `'open'` writer's effect (Zustand's setter is synchronous; the React re-render happens on the next tick; Playwright's first `getAttribute` may land after that tick). Forcing an explicit `'connecting'` observation requires either an artificial slowdown (a `MutationObserver` race), a server-side delay shim (out of scope), or a brittle timing assumption. The transition-tolerant assertion is the correct shape — it pins that the initial value is either of the two valid transient/healthy states, not that the chip caught a specific micro-instant.
- **(B) Drop the `'connecting'` check entirely** and only assert the final `'open'` state in the new scenario. Rejected: loses the regression pin against "the chip's source hook returns a hard-coded `'open'` value" or "the chip's mapping table drops the `'connecting'` arm." The transition-tolerant assertion preserves the per-arm-exists pin while accepting either valid initial state.
- **(C) Transition-tolerant assertion** (chosen). `expect.poll(() => chip.getAttribute('data-status'), { timeout: 5_000 }).toMatch(/^(connecting|open)$/)` covers either valid initial state. The new connection-state-transition scenario then drives the explicit `'open'` and `'closed'` assertions deterministically (with explicit imperative drives where needed).

### 4. Defer vote-send / withdraw-send Playwright scenarios to the consuming leaves

The task block's note mentions "vote / withdraw send paths" as part of this leaf's wiring scope; per the "UI-stream e2e policy" section above, the send paths become *callable* the moment this leaf mounts the provider, but the *Playwright assertions* for those paths cannot land until a user-visible consumer exists. Per `ORCHESTRATOR.md`'s deferred-e2e exception, vote-send and withdraw-send Playwright scenarios defer to the leaves that surface vote buttons (`part_voting.part_vote_single_tap`) and withdraw affordances (`part_withdraw.part_withdraw_action`). Both leaves already exist as open WBS leaves; the deferral is named explicitly above.

Two alternatives surveyed:

- **(A) Land synthetic vote-send / withdraw-send Playwright scenarios in this leaf** by imperatively calling `useWsClient().send('propose', {...})` via `page.evaluate()` (mirroring the `__aConversaWsStore` pattern but for the client). Rejected: would require also exposing `useWsClient`'s singleton on `window`, which is a meaningfully larger API surface than the store seed. More importantly, the synthetic scenario would pin "the send path doesn't throw" but not "the user can vote and the system responds correctly" — the latter is what the consuming leaf's e2e scenario covers. Landing a synthetic scenario here would create a partial-coverage pin that the consuming leaf has to either delete or maintain, with no net regression-pinning gain.
- **(B) Defer to the consuming leaves** (chosen). Per `ORCHESTRATOR.md`'s policy, the consuming leaf owns the user-visible e2e debt. This leaf scopes the deferral explicitly so the consuming leaf's refinement-writer doesn't miss it.

### 5. The mount-boundary test uses a stub `WsClient` via the provider's `client` prop, not `makeSocket` injection

Two alternatives surveyed:

- **Inject a stub `WebSocket` factory via `clientOptions.makeSocket`** so the auto-constructed client uses the stub. Rejected: would couple the test to the client's internal lifecycle (e.g. needing to drive `socket.onopen` / `socket.onclose` callbacks to transition through states), which is more brittle than just stubbing the client. The shell's `ws-client.test.ts` already covers the `makeSocket` path comprehensively; the participant's mount-boundary test does not need to re-cover it.
- **Pass a stub `WsClient` via the provider's `client` prop** (chosen). The stub is a literal object satisfying the `WsClient` interface (~8 methods + a `url` getter) with all methods as no-ops. The provider skips auto-construction when `client` is supplied (per `WsClientProvider.tsx:75`), so the test doesn't need to mock the WebSocket constructor at all. The test then exercises the source hook via `useWsStore.getState().setConnectionStatus('open')` directly, which is exactly what the production code path does (the real client's `setStatus` writer calls the same setter on the store).

### 6. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0026's surface-consumes-from-shell-substrate + host-supplied-auth; 0022's committed-test discipline; 0002's cookie-only auth).
- A direct mirror of the moderator's WS-client consumption shape (Decision §2's double-pass; the `__aConversaWsStore` window-exposure pattern from `apps/moderator/src/main.tsx`).
- A scoped wiring policy that doesn't constrain other tasks (Decision §1's surface-wide mount; Decision §3's transition-tolerant assertion; Decision §4's deferred-e2e for vote/withdraw; Decision §5's stub-client test seam).

The "no new dependencies" rule is satisfied: no `package.json` change. The "no new shell substrate" rule is honored: the shell's `<WsClientProvider>` + `createWsClient` are consumed unchanged. The "no new server-side change" rule is honored: the `/api/ws` endpoint already accepts the participant's session cookie.

### 7. Tech-debt registration

- **No new WBS leaf needs to be registered by this leaf's Closer.** The two deferred Playwright scenarios (vote-send, withdraw-send) are inherited by named existing WBS leaves (`part_voting.part_vote_single_tap`, `part_withdraw.part_withdraw_action`) per the "UI-stream e2e policy" section above. Per `ORCHESTRATOR.md`'s tech-debt registration policy, the Closer does NOT need to add new tech-debt tasks for debt already inheritable by named existing leaves.
- **No i18n native-review leaf** — this leaf adds zero i18n keys; the chip's per-state labels are already in the catalogs and their native-review chain is already in flight (per `part_status_indicator`'s Closer).
- **No follow-up on the per-session subscription wiring.** The `client.trackSession(sessionId)` lifecycle lands in `part_session_join.part_invite_acceptance` (the first leaf with a real `:id` param), which already exists as an open WBS leaf with `depends !part_session_join` (transitively `!part_shell`).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- `<WsClientProvider>` mounted at the surface boundary in [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx) (inside `<AuthValueProvider>`, outside `<BrowserRouter>`), with `auth={{ status: props.auth.status }}` + `clientOptions={{ store: useWsStore }}` + `store={useWsStore}` double-pass per Decision §2; `useWsStore` exposed on `window.__aConversaWsStore` unconditionally for Playwright-side imperative drives, mirroring the moderator's pattern.
- Source-hook swap landed in [`apps/participant/src/layout/useParticipantConnectionStatus.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts) — body now `return useWsStore((s) => s.connectionStatus);` (was the `'connecting'` literal); `part_status_indicator`'s chip now reflects real connection state.
- New Vitest source-hook contract suite at [`apps/participant/src/layout/useParticipantConnectionStatus.test.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.test.ts) — three cases (`'idle'` initial, `'open'` after setter, `'closed'` after setter) pinning the source-hook re-render contract; smoke count 3461 → 3464 (+3).
- [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) extended with a file-scoped no-op `globalThis.WebSocket` stub (happy-dom lacks WebSocket; set in `beforeEach`, restored in `afterEach`) plus a transition-tolerant chip assertion and an in-test `setConnectionStatus('open')` drive proving the source-hook swap landed and the chip re-renders on store update.
- [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) — scenario 1's strict `'connecting'` assertion softened to `expect.poll(...).toMatch(/^(connecting|open)$/)` per Decision §3; new scenario 4 (`'chip surfaces the connection-state transition end-to-end'`) drives connecting → open via the live WS handshake against the `make up` compose stack, then open → closed via imperative `setConnectionStatus('closed')` through the `__aConversaWsStore` global. `chromium-participant-skeleton` now 4/4 green.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 3464 passing (+3); `pnpm -F @a-conversa/participant build` green; `pnpm run test:e2e --project=chromium-participant-skeleton` 4/4 under `make up` (compose down via `make down-v`).
- Deferred-debt inheritance — vote-send Playwright debt → existing leaf `participant_ui.part_voting.part_vote_single_tap`; withdraw-send Playwright debt → existing leaf `participant_ui.part_withdraw.part_withdraw_action`; per-session `client.trackSession(sessionId)` wiring → existing leaf `participant_ui.part_session_join.part_invite_acceptance`. Per Decision §7 + `ORCHESTRATOR.md`'s tech-debt registration policy, no new WBS leaves registered — all three inheritors are named existing leaves with the right transitive `depends` edges in place.
