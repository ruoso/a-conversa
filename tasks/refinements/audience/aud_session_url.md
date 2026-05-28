# Stable URL per session — wire `/sessions/:id` to the audience graph view

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_url_routing.aud_session_url`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_shell` (settled — every leaf under `aud_shell` is `complete 100`: `aud_app_skeleton` ships the library-mode bundle + `BrowserRouter basename={"/a"}` route table at [`apps/audience/src/App.tsx:148-153`](../../../apps/audience/src/App.tsx#L148); `aud_ws_client` mounts `<WsClientProvider>` at the surface boundary in [`apps/audience/src/main.tsx:85-94`](../../../apps/audience/src/main.tsx#L85); `aud_anonymous_ws_subscribe` widens the provider with `allowAnonymous` (ADR 0029 — server-side anonymous-WS-upgrade for public sessions); `aud_no_auth_for_public` flips `requiredAuthLevel: 'public'` so the surface mounts before sign-in; `aud_auth_for_private` reads `useAuth()` inside `<App>` and renders `<LoginButton>` chrome for anonymous visitors; `aud_state_management` ships `useAudienceSession()` at [`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts#L73), plus the URL-driven session-id projector `sessionIdFromPathname()` at [`apps/audience/src/state/sessionId.ts:53-65`](../../../apps/audience/src/state/sessionId.ts#L53) and the `popstate`-subscribed hook `useAudienceSessionId()` at [`apps/audience/src/state/useAudienceSessionId.ts:50-52`](../../../apps/audience/src/state/useAudienceSessionId.ts#L50)).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled — `<AudienceGraphView>` at [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) mounts Cytoscape inside `data-testid="audience-graph-root"`; reads `useAudienceSession()` events, projects via `projectGraph(events)`, runs `breadthfirst` layout only when truly-new node ids land. Decision §9 of that refinement forwarded full Playwright deferral to *this* leaf with a four-leaf inherited-debt list. Decision §8 also left the `window.__aConversaAudienceCyInstance` test-seam question to this leaf to decide).
- Prose-only context (NOT a `.tji` edge): `audience.aud_obs_integration.aud_obs_no_input_required` (settled — Decision §5 of [`aud_obs_no_input_required.md`](aud_obs_no_input_required.md) forwarded the **graph-route tier** of the no-input audit to this leaf, naming the audit selectors as a reusable predicate the new Playwright spec calls).
- Prose-only context (NOT a `.tji` edge): `audience.aud_obs_integration.aud_obs_sizing_defaults` (settled — Decision §5 of [`aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md) forwarded the **graph-route dimension audit** to this leaf, requiring the new spec to set `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` and assert the graph viewport fills the Chromium viewport edge-to-edge with no scrollbar-reserved strip).

## What this task is

The audience surface's first **reachable** session URL. After this leaf:

- `apps/audience/src/App.tsx` grows a real `<Route path="/sessions/:id" element={<AudienceLiveRoute />} />` plus a locale-prefixed sibling `<Route path="/:locale/sessions/:id" element={<AudienceLiveRoute />} />`, both **above** the existing wildcard placeholder. Any path that does NOT match falls through to `<PlaceholderRoute>` unchanged (matters for `/a` bare-root, `/a/foo`, replay deep-link URL shapes downstream).
- A new `apps/audience/src/routes/AudienceLiveRoute.tsx` component reads the session id (via `useParams` — the source of truth inside the matched route, parser-agnostic), calls `useWsClient().trackSession(sessionId)` inside a `useEffect` (mirroring the participant's per-route subscribe lifecycle at `apps/participant/src/routes/OperateRoute.tsx`), and renders `<AudienceGraphView />` inside its body. The route renders **only** the graph; no in-route lobby splash, no roster overlay, no debug chrome — the audience is a broadcast surface (the moderator/participant own the lobby chrome).
- `apps/audience/src/main.tsx` is extended with an **unconditional** `window.__aConversaWsStore = audienceWsStore` assignment that mirrors the participant + moderator pattern at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) and [`apps/moderator/src/main.tsx:55`](../../../apps/moderator/src/main.tsx#L55). This unblocks the Playwright spec (Decision §3). The assignment is **not** gated on `import.meta.env.DEV`: the compose stack's production-mode Vite build tree-shakes DEV-gated branches, which would silently strip the seed entry point in CI (the participant precedent documents the same trap inline).
- A new Playwright spec at `tests/e2e/audience-live-session.spec.ts` pays down the cumulative four-leaf deferred-e2e debt declared against this leaf, plus the graph-route extensions forwarded from `aud_obs_no_input_required` and `aud_obs_sizing_defaults`. **Six concrete scenarios** land in this spec (see Acceptance criteria) — this IS the audience surface's first behavioural pin of the rendered graph; the orchestrator brief flagged this leaf as the catch-all leaf, NOT a further deferral.
- The Playwright project block `chromium-audience-skeleton` in [`playwright.config.ts:337-347`](../../../playwright.config.ts#L337) widens its `testMatch` regex to also accept `audience-live-session.spec.ts` (same pattern the participant project block walked through `participant-(skeleton-smoke|invite-acceptance|lobby|graph-render|pending-proposals)` successive refinements).
- A handful of Vitest cases under `apps/audience/src/routes/AudienceLiveRoute.test.tsx` pin the route's component-tier contract (renders `<AudienceGraphView>` when the route matches, calls `trackSession` once per session id, skips when sessionId is `null`).

Out of scope (deferred to existing siblings):

- **URL-position query parameter for replay deep-linking** — owned by `audience.aud_url_routing.aud_url_position_param` (1d, declared at [`tasks/50-audience-and-broadcast.tji:375-378`](../../50-audience-and-broadcast.tji#L375)). That task adds a `?position=<sequence>` reader and threads it into a replay-mode projection. This leaf renders live mode only.
- **Subscribe-rejection-aware messaging for private sessions** — anonymous visitor hits a private session, server rejects with `forbidden`, the route shows a sign-in CTA contextualised to the session. The skeleton already renders `<LoginButton>` chrome generically; per-session contextualisation is a future leaf (NOT yet in the WBS — see Open questions §1).
- **Per-state styling, axiom-mark decoration, animations, segment markers, layout-engine tuning** — owned by the dedicated subgroups (`aud_graph_rendering.aud_proposed_styling` / `aud_agreed_styling` / `aud_disputed_styling` / `aud_axiom_mark_decoration` / `aud_annotation_rendering` / `aud_layout_engine`; `aud_animations.*`; `aud_segment_markers.*`). This leaf wires the route — siblings extend the rendering surface.
- **Pixel-level OBS rendering at 720p / 1440p** — owned by `audience.aud_tests.aud_obs_render_smoke`. This leaf's dimension Playwright scenario pins the 1080p `DEFAULT_BROADCAST_DIMENSIONS` contract only (the OBS-out-of-the-box default); the dimension matrix is the dedicated task's scope.
- **Audience-side Cucumber scenarios** — owned by `audience.aud_tests.aud_behavior_tests` (2d). The audience-broadcast wire path (anonymous subscribe + event-applied broadcast) is exercised already by Cucumber tests in `apps/server/features/` (server-side wire contract); the Cucumber audience leaf adds audience-rendering-state scenarios on top of the projection.
- **`window.__aConversaAudienceCyInstance` Cytoscape-instance test seam** — Decision §8 of `aud_cytoscape_init.md` left this leaf to decide. **Decision §4 below: not now.** The WS-store-seed flavour (`window.__aConversaWsStore`) is sufficient to pin "event arrives → element renders." Cytoscape pixel-level assertions (label round-trip, badge position, etc.) belong to the `aud_vr_*` visual-regression and `aud_tests.aud_obs_render_smoke` siblings, which can grow the seam themselves if pixel-comparison Playwright needs it.

## Why it needs to be done

`m_audience_mvp` (M6, [`tasks/99-milestones.tji`](../../99-milestones.tji)) — the milestone at which a producer points OBS at an audience URL and sees the live debate graph — depends transitively on every leaf under `audience.*`. Today the audience surface mounts and renders a placeholder for **every** URL under `/a/*` (the wildcard at [`App.tsx:150`](../../../apps/audience/src/App.tsx#L150)). The graph component exists at [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) but no route mounts it. **This leaf is the wiring task that makes the canvas reachable** — every subsequent audience leaf (per-state styling, layout tuning, axiom-mark decoration, animations, segment markers, OBS render smoke) assumes the graph is reachable at `/a/sessions/:id` and that the surface receives events for the URL-named session.

The downstream consequences of wiring this concretely:

- **The `aud_graph_rendering.*` styling siblings** now have a real URL their visual-regression specs can hit. `aud_proposed_styling` / `aud_agreed_styling` / `aud_disputed_styling` all carry "the audience renders a proposed/agreed/disputed-styled node" assertions in their refinements; until this leaf lands, those assertions sit at the Vitest tier only.
- **The `aud_animations.*` group** registers `cy.on('add', ...)` listeners that expect events to actually arrive through the WS path. The `trackSession` call this leaf wires is the trigger for the server-side subscribe — without it, no live events reach the audience-side store.
- **The `aud_obs_integration.aud_obs_render_smoke` dimension matrix** wants to verify the graph fills 720p / 1080p / 1440p browser-source frames without overflow. Today only the placeholder is reachable; OBS-dimension assertions on the placeholder are tautological (it's a centered `max-w-2xl` block — dimension-insensitive by construction). After this leaf, the graph is reachable and dimension-sensitive.
- **The `aud_tests.aud_playwright_e2e` 2d catch-all** is the dedicated audience-Playwright leaf for breadth coverage (multi-scenario sweeps). Today its scope is "the placeholder route mounts" — same as `audience-skeleton-smoke.spec.ts`, so it has nothing meaningful to add. After this leaf, `aud_playwright_e2e`'s scope crystallizes into "drive the full audience URL grammar across locales × auth states × event sequences" with this leaf's spec as the foundation.
- **The cumulative inherited-debt count on this leaf** — four upstream refinements (`aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init`) plus two graph-route-tier extensions (`aud_obs_no_input_required`, `aud_obs_sizing_defaults`) — sits at the threshold `ORCHESTRATOR.md` flags as "pay down inline." Per Decision §9 of `aud_cytoscape_init.md`: "every deferred assertion is a different observable behaviour of the same route landing; `aud_session_url` is the natural home." This leaf cashes that debt in **one cumulative Playwright spec**, NOT in a further-deferred `aud_pw_*` catch-all.

Architecturally, this is the **third** concrete route-mount of a Cytoscape canvas across surfaces (moderator `/sessions/:id/operate`; participant `/sessions/:id`; audience `/sessions/:id`). The patterns established by the participant's `OperateRoute` — `useParams` for id parsing, `useEffect`-wrapped `trackSession`, single-component body — become the audience's baseline.

## Inputs / context

### ADRs

- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — fixes the URL prefix table (`/a/*` → audience surface) and the per-surface basename-scoped `<BrowserRouter>`. The route this leaf adds lives under that basename; relative paths in the audience surface (`/sessions/:id`) resolve to `/a/sessions/:id` globally.
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-prefixed variant `/:locale/sessions/:id` honors the URL-prefix locale rule the audience surface already implements at [`App.tsx:120-146`](../../../apps/audience/src/App.tsx#L120). The `useEffect` that flips `i18n.language` reads the locale segment via `negotiateUrlLocale(pathname)` — this leaf does NOT touch that logic; the new routes coexist with it.
- [ADR 0029 — Anonymous WebSocket subscribe for public sessions](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — the wire path the anonymous Playwright scenario exercises. The server's `canSeeSessionAnonymously` predicate gates anonymous subscribe attempts at the data layer (public + not-ended only); the client-side `trackSession` call this leaf wires is identical for authenticated and anonymous visitors — the discrimination happens server-side.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical claim this leaf makes about the route's behaviour lands as a committed Playwright case (six scenarios — see Acceptance criteria) and a Vitest mount probe.
- [ADR 0008 — E2E framework: Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — the test-stack constraint. The new spec file lives at `tests/e2e/audience-live-session.spec.ts` under the existing project layout.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — orthogonal to this leaf (the projection already honors it); worth naming because the scenarios seed `node-created` + `edge-created` (entity events) without per-facet status events, and the rendered Cytoscape elements appear at propose-time as the projection contract requires.

### Sibling refinements

- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the wildcard route this leaf does NOT replace, only inserts above. The placeholder at `<Route path="*">` continues to render for `/a` bare-root and any non-matching path. The `<App>` component's locale-negotiation `useEffect` continues to run on every render — the new routes do not factor into it.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — Decision §6 explicitly says the audience workspace barrel does NOT export `useWsClient` (to keep the audience read-only-by-construction at the public API). The new `AudienceLiveRoute` component imports `useWsClient` directly from `@a-conversa/shell` (NOT from the audience barrel), preserving the public posture. Decision §10 of that refinement forwarded the audience-WS Playwright pin to a future "first visible affordance" leaf — that future leaf is **this** one.
- [`tasks/refinements/audience/aud_state_management.md`](aud_state_management.md) — ships the URL-driven session-id resolution and the `useAudienceSession()` facade. Decision §7 forwarded the live-projection Playwright pin to this leaf. The route this leaf adds is the consumer that finally exercises that projection end-to-end. The `sessionIdFromPathname()` parser supports both `/sessions/{uuid}` and `/{locale}/sessions/{uuid}` (line 54 comment); the new `useParams`-based id read in `AudienceLiveRoute` is equivalent on the happy path (both yield the canonical UUID for matched routes), and `useParams` is the idiomatic React Router approach for parameters that live inside a matched route.
- [`tasks/refinements/audience/aud_anonymous_ws_subscribe.md`](aud_anonymous_ws_subscribe.md) — the anonymous-WS-upgrade path that the new Playwright spec's anonymous scenario exercises. The scenario sets an empty cookie jar via `test.use({ storageState: { cookies: [], origins: [] } })` mirroring the existing `audience-skeleton-smoke.spec.ts:87` pattern.
- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — sets `requiredAuthLevel: 'public'` so the SurfaceHost mounts the audience for anonymous visitors. The anonymous Playwright scenario relies on this contract.
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — Decision §9 of that refinement is the load-bearing source for this leaf's debt inheritance list. Specifically:
  - Re-read **Decision §9** (lines 367-386) which itemises the four-leaf inherited debt: authenticated event delivery, live projection visibility, anonymous WS delivery, canvas-mount + canvas-element-presence assertion.
  - Note **Status block** (lines 408-419): the leaf already shipped with all four debts queued against this task name.
- [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md) — Decision §5 forwards the **graph-route tier** of the no-input audit here. The audit selectors are `<dialog>`, `[aria-modal="true"]`, `<audio>`, `<video>`, `[data-requires-input="true"]` — reused verbatim from `audience-skeleton-smoke.spec.ts:124-128`.
- [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md) — Decision §5 forwards the **graph-route dimension audit** here. The new spec's dimension scenario sets `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` (the 1080p alias declared at `apps/audience/src/graph/layoutOptions.ts`) and asserts the graph viewport fills it edge-to-edge.
- [`tasks/refinements/participant-ui/part_graph_render.md`](../participant-ui/part_graph_render.md) — the participant's `participant-graph-render.spec.ts` is the closest precedent for "drive a Cytoscape route in a real browser, seed events via `__aConversaWsStore`, assert canvas presence." Decision §6 of that refinement (one scenario, seed-via-WS-store flavour) is the pattern this leaf inherits. Read the spec at [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — it walks alice (creates session) → ben (claims debater-A) → seed `session-mode-changed` → wait for auto-nav → seed `node-created` + `edge-created` → assert canvas + element presence.

### Live code the leaf plugs into

- [`apps/audience/src/App.tsx:148-153`](../../../apps/audience/src/App.tsx#L148) — the route table. This leaf inserts two `<Route>` entries above the wildcard.
- [`apps/audience/src/main.tsx:85-94`](../../../apps/audience/src/main.tsx#L85) — `<WsClientProvider>` already mounted with `allowAnonymous`. This leaf adds the unconditional `window.__aConversaWsStore` assignment as the first statement of `mount(props)`, before the `ReactDOM.createRoot(...)` call (Decision §3).
- [`apps/audience/src/ws/wsStore.ts:31`](../../../apps/audience/src/ws/wsStore.ts#L31) — `audienceWsStore` is the singleton exposed on `window` for the seed seam.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — `<AudienceGraphView>` component. The route's body renders it directly (no wrapper).
- [`apps/audience/src/state/sessionId.ts:53-65`](../../../apps/audience/src/state/sessionId.ts#L53) — `sessionIdFromPathname()` parser. Kept as the canonical URL-driven session-id read (the `useAudienceSession()` facade reads it via `useAudienceSessionId()`); the new `AudienceLiveRoute` uses `useParams` for clarity but on the matched-route happy path both yield the same value. Decision §1.
- [`apps/audience/src/state/useAudienceSession.ts:73`](../../../apps/audience/src/state/useAudienceSession.ts#L73) — `useAudienceSession()` facade. `<AudienceGraphView>` already consumes it; the route component does NOT need to read it separately.
- [`packages/shell/src/ws/WsClientProvider.tsx`](../../../packages/shell/src/ws/WsClientProvider.tsx) — provides `useWsClient()` hook; `AudienceLiveRoute` imports it directly from `@a-conversa/shell` rather than through the audience barrel (preserving the read-only public surface — `aud_ws_client.md` Decision §6).
- [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50) — the existing `window.__aConversaWsStore = useWsStore` pattern. Mirror verbatim.
- [`apps/moderator/src/main.tsx:55`](../../../apps/moderator/src/main.tsx#L55) — the moderator's equivalent. Same shape.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) — the reference route-level subscribe pattern (`useParams` → `useEffect(() => trackSession(id), [id])` → render).
- [`playwright.config.ts:337-347`](../../../playwright.config.ts#L337) — `chromium-audience-skeleton` project. `testMatch` widens to include the new spec.
- [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) — the existing audience Playwright spec. The new spec adds **alongside** (not replacing); the skeleton spec continues to assert the placeholder route for `/a/sessions/<uuid>` against the **wildcard** branch (uses a synthetic UUID for which the new route's mount also matches — see Decision §6 for how the two specs co-exist).
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — the reference structure for the new spec (`createSession` helper, `loginAs` + cookie-clear sequence, `page.evaluate` to drive `__aConversaWsStore.applyEvent`, assertion shape).
- [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) — the existing seed-helper module. The new spec MAY use `seedWsStore(page, { sessionId, nodes, edges })` (lines 97-169) verbatim, OR drive `page.evaluate(...)` directly (the participant-graph-render spec uses the inline form). Decision §5.

### What the surface MUST NOT do

- **No replacement of the wildcard placeholder route.** It stays as the fallback for `/a` bare-root, `/a/foo`, replay deep-link routes, locale-only routes. The new `<Route>` entries are **inserted above** the wildcard.
- **No edit to `useAudienceSession()` or `useAudienceSessionId()`.** Both keep their pathname-driven contracts intact; the route-component's `useParams` read is a parallel source consumed by the route body, NOT a replacement of the state-layer hooks.
- **No `useWsClient` export from the audience barrel.** Per `aud_ws_client.md` Decision §6, the audience workspace's public API stays read-only. `AudienceLiveRoute` imports `useWsClient` from `@a-conversa/shell` directly.
- **No `fetch('/api/sessions/...')` from the audience surface.** All session-state arrives via the WS subscribe; the route's `trackSession(sessionId)` call is the only outbound signal.
- **No `createWsClient()` call inside `AudienceLiveRoute`.** The surface-wide `<WsClientProvider>` is the single client; the route consumes its hook output.
- **No mutation of the URL from inside `AudienceLiveRoute`.** No `navigate(...)`, no `window.history.replaceState`, no query-param writes. The route is rendering-only; the URL is read-only at this tier.
- **No expansion of the audience's `<Route>` table to handle replay-mode URL params.** That belongs to `aud_url_position_param`. The route this leaf adds renders live mode only.
- **No `window.__aConversaAudienceCyInstance` seam.** Decision §4 — the WS-store-seed flavour suffices for this tier.
- **No widening of `chromium-audience-skeleton`'s `dependencies` array.** The existing `['setup-auth']` is sufficient; the new spec creates its own session via `page.request.post('/api/sessions')` in its `freshContext` browser context.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/App.tsx` — modified. Adds two `<Route>` entries above the wildcard:
  ```tsx
  <Route path="/sessions/:sessionId" element={<AudienceLiveRoute />} />
  <Route path="/:locale/sessions/:sessionId" element={<AudienceLiveRoute />} />
  <Route path="*" element={<PlaceholderRoute />} />  {/* unchanged */}
  ```
  The locale-prefixed route shares the same component; the `useEffect` in `<App>` continues to negotiate the locale from `window.location.pathname` (no change to that block). The `useParams` hook inside `AudienceLiveRoute` returns `{ sessionId }` for both shapes (React Router merges matched params).
- `apps/audience/src/routes/AudienceLiveRoute.tsx` — NEW. ~30 LOC. Reads `useParams<{ sessionId: string }>()`. Inside `useEffect`, calls `useWsClient().trackSession(sessionId)` when `sessionId` is a non-empty string and skips when `null`/`undefined` (the latter is unreachable in practice because the route only mounts when a `:sessionId` segment is matched — but the guard is cheap and surfaces as a Vitest case). Returns `<AudienceGraphView />` as the route body. No additional chrome; the broadcast-clean aesthetic per `aud_auth_for_private.md` Decision §1 applies.
- `apps/audience/src/routes/AudienceLiveRoute.test.tsx` — NEW. Vitest cases (5):
  1. Renders `<AudienceGraphView>` (asserted via `audience-graph-root` testid presence) when the route matches.
  2. Calls `trackSession(sessionId)` once on mount when the URL is `/sessions/<uuid>`.
  3. Calls `trackSession(newId)` when the URL changes (route remounts under React Router's navigate).
  4. Does NOT crash when the URL is malformed (`/sessions/not-a-uuid`) — the route still mounts; the WS server rejects the subscribe (asserted via the WS-client's `trackSession` mock receiving `'not-a-uuid'`, not via Cytoscape).
  5. The route mounts inside both `/sessions/<uuid>` and `/<locale>/sessions/<uuid>` shapes (parametrized over `en-US`, `pt-BR`).
- `apps/audience/src/main.tsx` — modified. Inserts as the **first statement of `mount(props)`** (before `const root = ReactDOM.createRoot(...)`):
  ```ts
  (window as unknown as { __aConversaWsStore?: typeof audienceWsStore }).__aConversaWsStore =
    audienceWsStore;
  ```
  The assignment mirrors the participant's pattern at [`main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) with one intentional difference: the assignment runs inside the `mount(props)` body rather than at module scope, because the audience's library-mode bundle's module evaluation does NOT bring up the React tree (mount is host-driven) — placing it inside `mount` matches the actual bootstrap. The value is the audience-specific `audienceWsStore` (not a React hook reference), and the seed fixture `seedWsStore(page, ...)` calls `store.getState().applyEvent(...)`, which works against the Zustand store reference directly. The assignment is **unconditional** (no `import.meta.env.DEV` gate) — the compose stack's production-mode Vite build tree-shakes DEV-gated branches and would silently strip the seed entry point in CI; see the shipped comment block at [`apps/audience/src/main.tsx:56-73`](../../../apps/audience/src/main.tsx#L56) and the participant precedent at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36).
- `apps/audience/src/main.test.tsx` — modified (extension). Adds a Vitest case asserting the window assignment lands unconditionally on every `mount(props)` invocation (no DEV-flag toggling). **Important**: this is the audience surface's first `main.test.tsx` edit since `aud_app_skeleton`; if no `main.test.tsx` exists today (only `mount.test.tsx`), the case lands in `mount.test.tsx` instead.
- `tests/e2e/audience-live-session.spec.ts` — NEW. Six scenarios (see Acceptance criteria below).
- `playwright.config.ts` — modified. Widens the `chromium-audience-skeleton` project's `testMatch` regex from `/audience-skeleton-smoke\.spec\.ts$/` to `/audience-(skeleton-smoke|live-session)\.spec\.ts$/`.

### Files this task does NOT touch

- `apps/audience/src/state/*` — unchanged. The URL-driven session-id projector + facade hooks stay as-is.
- `apps/audience/src/ws/*` — unchanged. The store + selectors stay as-is.
- `apps/audience/src/graph/*` — unchanged. The component + projection stay as-is.
- `apps/audience/src/index.css` — unchanged. Full-bleed root chain already in place per `aud_obs_sizing_defaults`.
- `apps/audience/package.json` — unchanged. No new dependencies. `react-router-dom` is already pinned via the existing audience workspace.
- `apps/audience/vite.config.ts` — unchanged.
- `apps/participant/*` / `apps/moderator/*` — unchanged. The dev-only `__aConversaWsStore` assignment is duplicated to the audience workspace; cross-app imports are forbidden.
- `apps/root/*` — unchanged. The host's `/a/*` route still dispatches to the audience surface; the new route mounts inside the audience's `<BrowserRouter>`.
- `apps/server/*` — unchanged. The WS subscribe handler already accepts both authenticated and anonymous upgrades per ADR 0029.
- `packages/shell/*` — unchanged. No new substrate.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — unchanged. Coexists with the new spec; the synthetic UUID it uses (`00000000-0000-4000-8000-000000000099`) now matches the new `/sessions/:sessionId` route which mounts `<AudienceGraphView>` — see Decision §6 for why the skeleton spec's assertions still hold (it asserts `route-audience-placeholder` is present; but the new route renders `audience-graph-root`, NOT the placeholder). Decision §6 resolves this conflict.
- `tests/e2e/fixtures/wsStoreSeed.ts` — unchanged. The helper is reused as-is.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR or matches an established pattern. **Exception**: if Decision §6's conflict-resolution requires shifting the skeleton spec's synthetic UUID to a never-matching segment shape, that's a one-line spec edit, not an ADR.
- `.tji` files — `complete 100` on `aud_session_url` lands at task-completion time per the README ritual.

### Route lifecycle contract (`AudienceLiveRoute.tsx`)

Sketched:

```tsx
import { useEffect, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useWsClient } from '@a-conversa/shell';

import { AudienceGraphView } from '../graph/GraphView';

export function AudienceLiveRoute(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const wsClient = useWsClient();

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return;
    wsClient.trackSession(sessionId);
    // Note: `untrackSession` on unmount is NOT called here — the
    // audience is a single-route broadcast surface and a session
    // change means a navigation to a new URL, which remounts the
    // route. The WS provider's reset-on-unmount (per `aud_ws_client.md`
    // Decision §3 + 4) handles the cleanup at the surface boundary.
    // This mirrors the participant's `OperateRoute` lifecycle.
  }, [sessionId, wsClient]);

  return <AudienceGraphView />;
}
```

The shape is intentionally minimal — no roster overlay, no connection-status chip, no debug chrome. Broadcast-clean.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/App.tsx` has the two new `<Route>` entries above the wildcard; the wildcard placeholder still renders for `/a`, `/a/foo`, `/a/en-US`, `/a/replay/<uuid>`.
- `apps/audience/src/routes/AudienceLiveRoute.tsx` exists, reads `useParams`, calls `trackSession` once per session id, renders `<AudienceGraphView>`.
- `apps/audience/src/routes/AudienceLiveRoute.test.tsx` covers the 5 Vitest cases enumerated.
- `apps/audience/src/main.tsx` exposes `window.__aConversaWsStore = audienceWsStore` as the first statement of `mount(props)` — **unconditional**, no `import.meta.env.DEV` gate (the compose stack's production-mode build tree-shakes DEV-gated branches; matches the participant precedent at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36)). The Vitest case for the assignment lands in `main.test.tsx` (or `mount.test.tsx` if `main.test.tsx` doesn't exist) and pins the unconditional shape — the assignment is present on every `mount(props)` invocation without DEV-flag toggling.
- `tests/e2e/audience-live-session.spec.ts` exists. **Six concrete scenarios** (per ADR 0022 — each scenario is a committed pin of an observable behaviour):

  1. **Authenticated event delivery** (pays down `aud_ws_client.md` Decision §10):
     - alice logs in via `loginAs`.
     - alice creates a public session via `POST /api/sessions`.
     - alice navigates to `/a/sessions/<sessionId>`.
     - `route-audience-placeholder` is **NOT** visible (the new route shadows the wildcard).
     - `audience-graph-root` testid IS visible within 15s.
     - Spec seeds a synthetic `node-created` event via `page.evaluate(__aConversaWsStore.getState().applyEvent)` (or `seedWsStore(page, { sessionId, nodes: [...] })` from the fixture). The seeded sequence is `1_000_000+` to clear the live subscription's high-water mark per the participant precedent.
     - Spec asserts the WS store's events slice for the session carries the seeded event (`page.evaluate(() => window.__aConversaWsStore.getState().sessionState[sessionId].events.length)` returns ≥ 1).
     - Spec asserts a `<canvas>` element is present inside `audience-graph-root` (Cytoscape paints labels to canvas — DOM text queries cannot reach them; presence + WS-store-state is the assertion pair per the participant's post-deviation pattern).

  2. **Live projection rendering** (pays down `aud_state_management.md` Decision §7):
     - Same setup as scenario 1.
     - Spec seeds `node-created` + `edge-created` (the edge with `source_node_id` = the seeded node id, `target_node_id` = an unknown id; Cytoscape tolerates dangling endpoints since the projection filters them).
     - Spec asserts the canvas elements rendered: `page.evaluate(() => document.querySelectorAll('[data-testid="audience-graph-root"] canvas').length)` returns ≥ 1 (Cytoscape composes multiple `<canvas>` layers).
     - Spec asserts the WS store's events slice carries both seeded events (length ≥ 2).

  3. **Anonymous WS delivery** (pays down `aud_anonymous_ws_subscribe.md` debt):
     - alice (authenticated) creates a public session.
     - alice logs out + drops cookies (`page.context().clearCookies()`).
     - A fresh anonymous context (`storageState: { cookies: [], origins: [] }`) navigates to `/a/sessions/<sessionId>`.
     - `audience-graph-root` testid IS visible (the anonymous-WS-upgrade per ADR 0029 lets the subscribe succeed).
     - Spec seeds a `node-created` event via `__aConversaWsStore` (same seam — the dev-only assignment runs regardless of auth state).
     - Spec asserts the canvas + WS store state per scenarios 1 + 2.
     - Spec asserts the URL did NOT redirect (`new URL(page.url()).pathname === '/a/sessions/<sessionId>'`) — confirming `requiredAuthLevel: 'public'` is honored.
     - Spec asserts `audience-sign-in` is **NOT** visible on the graph route (broadcast-clean; the chrome was the placeholder's affordance, not the graph route's).

  4. **Canvas mount on `/sessions/:id`** (pays down `aud_cytoscape_init.md` Decision §9 — the direct self-deferral):
     - Authenticated visitor navigates to `/a/sessions/<uuid>` directly (no in-flow lobby precedent).
     - `audience-graph-root` testid IS visible.
     - A `<canvas>` layer is present inside the testid container within 5s of mount.
     - The empty-events case is assertable: the spec asserts `audience-graph-root` is visible even when zero events are seeded (Cytoscape mounts an empty canvas — the `<canvas>` count is still ≥ 1).

  5. **OBS no-input audit at the graph-route tier** (pays down `aud_obs_no_input_required.md` Decision §5):
     - Anonymous visitor navigates to `/a/sessions/<sessionId>` (real session created upstream, public).
     - Spec waits for `audience-graph-root` visible.
     - Spec seeds events so the canvas has elements (the audit must run against a populated graph, not just the empty mount — pixel-stability + canvas-readiness is the OBS-relevant condition).
     - Spec asserts:
       - `page.locator('dialog')` count is 0.
       - `page.locator('[aria-modal="true"]')` count is 0.
       - `page.locator('audio')` count is 0.
       - `page.locator('video')` count is 0.
       - `page.locator('[data-requires-input="true"]')` count is 0.
     - Spec issues **zero** user-interaction calls (no `.click()`, `.keyboard.*`, `.mouse.*`) — the assertions above confirm the surface reaches its rendered state without input.

  6. **OBS dimension audit at the graph-route tier** (pays down `aud_obs_sizing_defaults.md` Decision §5):
     - `test.use({ viewport: { width: 1920, height: 1080 } })` at the scenario level (matching `DEFAULT_BROADCAST_DIMENSIONS`).
     - Authenticated visitor navigates to `/a/sessions/<sessionId>`.
     - Spec asserts `expectNoScrollbars(page)` from the existing `no-scrollbars` fixture (the auto-fixture already runs after every test, but the explicit assertion makes the intent visible).
     - Spec asserts the graph-root bounding box covers the viewport edge-to-edge: `await page.locator('[data-testid="audience-graph-root"]').boundingBox()` returns `{ x: 0, y: 0, width: 1920, height: 1080 }` (tolerance ±1px for sub-pixel rounding).

- `playwright.config.ts:339` widens `testMatch` to `/audience-(skeleton-smoke|live-session)\.spec\.ts$/`.
- `pnpm run check` clean (strict TypeScript pass — the new component + spec typecheck).
- `pnpm run test:smoke` green (Vitest count rises by **5+1 = 6** new cases: 5 in `AudienceLiveRoute.test.tsx`, 1 in `main.test.tsx` for the window-seam assignment).
- `pnpm exec playwright test --project=chromium-audience-skeleton` green. Both `audience-skeleton-smoke.spec.ts` and the new `audience-live-session.spec.ts` run under the same project; the new spec's six scenarios all pass.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_session_url` in the same commit.

**No further deferral.** Per the orchestrator brief and per `ORCHESTRATOR.md`'s "pay debt down inline" rule at the 2+-leaf threshold, this leaf is the catch-all leaf. The audience surface's first behavioural Playwright pin of the rendered graph route lives here. The 2d `aud_tests.aud_playwright_e2e` catch-all stays scoped to **breadth** scenarios (multi-locale sweeps, multi-event-sequence variations, replay-mode coverage once `aud_url_position_param` lands); it inherits no graph-mount or live-projection debt from this leaf.

## Decisions

### §1 — `useParams` for session-id read inside the route, NOT the state-layer hook

The audience workspace ships TWO valid session-id sources:
- `useAudienceSessionId()` at [`apps/audience/src/state/useAudienceSessionId.ts:50-52`](../../../apps/audience/src/state/useAudienceSessionId.ts#L50) — a `useSyncExternalStore`-over-popstate hook that reads `window.location.pathname` and runs it through `sessionIdFromPathname()`.
- `useParams<{ sessionId: string }>()` from React Router — the canonical React Router approach.

For the route component, `useParams` is the right choice. Rationale:

- **It's the idiomatic React Router pattern**: parameters that live inside a matched route ARE the parameter — using a parallel parser is cargo-culting.
- **It avoids tautology**: the route only mounts when `:sessionId` is matched, so the value is guaranteed-present by the matcher. The `useAudienceSessionId()` hook needs the null guard because it can be called outside a matched route (e.g. by `<App>` or a sibling). The route doesn't need it.
- **It composes correctly with the locale-prefixed route**: React Router merges matched params across both `/sessions/:sessionId` and `/:locale/sessions/:sessionId`; the route gets the same `sessionId` value for both shapes.

`useAudienceSessionId()` stays in place — `<AudienceGraphView>` consumes `useAudienceSession()` which transitively reads it. The state layer keeps its pathname-driven contract; the route component reads from React Router. Both yield the same value on the happy path (matched route → UUID); they diverge only on edge cases (the route doesn't mount for `/a` bare; the state hook returns `null`).

**Alternative**: Use `useAudienceSessionId()` inside the route. Rejected — it would create an extra subscription (popstate listener + selector) for no benefit, since the route already remounts on URL changes via React Router's match-change mechanism.

**Alternative**: Drop `useAudienceSessionId()` entirely now that the route exists. Rejected — `<AudienceGraphView>` is mounted via `useAudienceSession()` which uses it; removing it would require threading sessionId through the graph component as a prop (architectural change that competes with future replay-mode siblings that might mount the graph at a different URL). Decision §3 of `aud_state_management.md` settled this; it stays.

### §2 — Route inserts above wildcard; the placeholder stays for non-session URLs

The wildcard at [`App.tsx:150`](../../../apps/audience/src/App.tsx#L150) maps every URL inside the audience basename to `<PlaceholderRoute>`. Three options for handling it:

- **(A — chosen)** Insert `<Route path="/sessions/:sessionId">` + the locale-prefixed sibling ABOVE the wildcard. The wildcard continues to render for `/a` bare-root, `/a/foo`, locale-only paths like `/a/en-US`, future replay routes like `/a/replay/<uuid>`. The placeholder's chrome (`<LoginButton>` for anonymous, none for authenticated) stays the right surface for non-session URLs.
- **(B)** Replace the wildcard with the new routes only. Rejected — `/a` bare-root would 404, locale-only `/a/en-US` would 404, future replay-mode URLs would 404 until their own route lands. The placeholder is the correct fallback.
- **(C)** Make the new routes nest under a new layout route that owns the placeholder fallback. Rejected — would add layout-routes complexity for a one-route surface; React Router's route-matching order already handles the desired semantics.

**Edge case**: the synthetic UUID used by `audience-skeleton-smoke.spec.ts` (`00000000-0000-4000-8000-000000000099`) would now match the new `/sessions/:sessionId` route, NOT the wildcard — see Decision §6 for resolution.

### §3 — Expose `window.__aConversaWsStore` on the audience; payback the deferred decision

`aud_ws_client.md` Decision §9 + `aud_cytoscape_init.md` Decision §8 both deferred the window-seam decision to "the future Playwright spec." This is that spec. The choice is now load-bearing:

- **(A — chosen)** Expose `audienceWsStore` on `window.__aConversaWsStore` **unconditionally** (no `import.meta.env.DEV` gate). Mirrors the participant's [`main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) and the moderator's [`main.tsx:55`](../../../apps/moderator/src/main.tsx#L55) verbatim (same window key — each surface's bundle owns the global at mount time; only one audience surface mounts at a time inside the `/a/*` route, so there's no cross-surface conflict). The Playwright spec calls `page.evaluate(() => window.__aConversaWsStore.getState().applyEvent(...))` directly OR via the existing `seedWsStore(page, ...)` fixture.
- **(B)** Use an audience-specific window key (`__aConversaAudienceWsStore`). Rejected — the existing `tests/e2e/fixtures/wsStoreSeed.ts` reads `__aConversaWsStore`; the spec would have to fork the fixture or pass the key as a parameter. Sharing the key (each surface's bundle assigns it at mount; only one mounts at a time per browser context for a single URL) is simpler.
- **(C)** Drive the assertions via real WS broadcasts (no synthetic seed). Rejected — would require either (a) running a real moderator session in the same Playwright context to broadcast events (cross-surface complexity, multi-context coordination — the participant precedent rejected this for the same reason), or (b) extending the server with a test-only "broadcast synthetic event" endpoint (test-affordance surface area + ADR-pushing additions). The WS-store-seed flavour is the established pattern; this leaf adopts it.

**Why now and not later**: the audience's window-seam absence was a *deliberate* deferral pending a consumer. The spec this leaf adds IS the consumer; the deferral resolves to (A).

**Why unconditional and not DEV-gated**: the compose stack's production-mode Vite build tree-shakes `import.meta.env.DEV` branches; a guard would silently strip the seed entry point in CI, where the Playwright spec runs against the production-mode build. The participant precedent at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) documents the same trap inline, and the shipped audience comment block at [`apps/audience/src/main.tsx:56-73`](../../../apps/audience/src/main.tsx#L56) mirrors it. The plumbing-convenience-not-new-capability argument (the store reference is already reachable through the module graph; window-exposure is a Playwright-only convenience) is the security argument: the audience surface's store is read-only-by-construction (`audienceWsStore` is a Zustand singleton fed only by the inbound WS dispatcher; no caller can write to it from outside), so production-mode exposure does not widen the attack surface.

### §4 — No `window.__aConversaAudienceCyInstance` seam (yet)

`aud_cytoscape_init.md` Decision §8 left this leaf to decide. **Choice: not now.**

Rationale:
- The six scenarios this leaf scopes all assert via `window.__aConversaWsStore` (event state) + DOM presence of `audience-graph-root` and `canvas`. Cytoscape pixel-state assertions (label positions, edge curves, badge offsets) are NOT in this leaf's scope.
- The dedicated visual-regression sibling tasks (`aud_vr_*` under `aud_tests`) and `aud_obs_render_smoke` are the right home for pixel-comparison work; they can grow the `__aConversaAudienceCyInstance` seam themselves if Playwright pixel-level inspection of the Cytoscape instance becomes necessary.
- The `cyRef` callback prop on `<AudienceGraphView>` is already sufficient for Vitest's needs.

**Alternative**: expose the seam preemptively. Rejected — surface area without a consumer; mirrors the audience's existing "no `__aConversaAudienceWsStore` until needed" posture per `aud_ws_client.md` Decision §9.

### §5 — Inline `page.evaluate` for seeding, NOT the `seedWsStore` fixture wrapper (initially)

The fixture `tests/e2e/fixtures/wsStoreSeed.ts` exposes `seedWsStore(page, { sessionId, nodes, edges })`. The participant-graph-render spec at [`participant-graph-render.spec.ts:187-229`](../../../tests/e2e/participant-graph-render.spec.ts#L187) uses inline `page.evaluate(...)` directly, NOT the fixture wrapper. Two options:

- **(A — chosen)** Inline `page.evaluate(...)` per scenario. Costs ~20 LOC per seed call but each scenario is self-describing and the sequence-number management is explicit (the spec uses `1_000_000+` to clear the live subscription's high-water mark, matching the participant precedent).
- **(B)** Use `seedWsStore(page, ...)` from the fixture. Cleaner; less boilerplate. But the fixture's docstring (lines 22-26) says it's "for the moderator's hover-popover spec" — adopting it for the audience would extend its consumer scope.

Decision: ship (A). The participant-graph-render precedent established the inline-evaluate pattern as canonical for "spec-specific seed shape"; the fixture is the moderator-and-participant-lobby's helper. A future `audience-fixtures.ts` extraction can consolidate when a second audience spec wants the same seed primitive.

**Tech-debt registration**: NONE. The future consolidation is "if a second audience spec wants the same seed primitive" — that's a YAGNI extraction trigger, not a debt entry.

**Window-key reachability**: the inline `page.evaluate(...)` calls reach the **unconditional** `window.__aConversaWsStore` per amended §3 — the spec does NOT need to special-case prod-vs-dev-mode Playwright runs (the assignment lands on every `mount(props)` invocation regardless of build mode).

### §6 — Coexistence with `audience-skeleton-smoke.spec.ts`

The skeleton spec uses session id `00000000-0000-4000-8000-000000000099` (a valid UUID per the v1-5 regex in `sessionId.ts:26`). Today both spec scenarios assert `route-audience-placeholder` for `/a/sessions/<that-uuid>`. After this leaf:

- The new `<Route path="/sessions/:sessionId">` shadows the wildcard for `/sessions/<any-UUID>`, mounting `<AudienceLiveRoute>` instead. The placeholder testid would NOT render.
- The skeleton spec's `expect(page.getByTestId('route-audience-placeholder')).toBeVisible(...)` would FAIL.

Three resolutions:

- **(A — chosen)** Update the skeleton spec to navigate to a path that still matches the wildcard. Switch from `/a/sessions/${SESSION_ID}` to `/a/${SESSION_ID}` (or `/a/sessions-foo/${SESSION_ID}` — any non-matching path). The skeleton spec's intent ("the surface bundle mounts under `/a/*`") is preserved; the URL shape it uses no longer collides with the new live route. **Smallest-diff** path.
- **(B)** Keep the skeleton spec's URL and split its scenarios into a separate "placeholder-fallback" project that uses a non-session URL. Rejected — multiplies project blocks for no architectural gain.
- **(C)** Delete the skeleton spec's session-shaped URL entirely; assert against `/a` bare-root. Rejected — the skeleton spec's whole point is to pin "the audience surface URLs are reachable," and pinning that against the bare root is less informative than against a session-shaped URL.

Decision: (A). One-line edit per scenario in `audience-skeleton-smoke.spec.ts` — change `/a/sessions/${SESSION_ID}` to `/a/placeholder-fallback/${SESSION_ID}` (the placeholder-fallback prefix is descriptive of what's being asserted). The skeleton spec's two scenarios both continue to assert `route-audience-placeholder`.

**Alternative phrasing for (A)**: switch to `/a/${SESSION_ID}` (bare UUID). Same result; either is fine — the implementer picks. The spec edit is small enough to be inline with this leaf's commit; it's NOT a separate task.

### §7 — One spec file, six scenarios; NOT split per concern

Six scenarios is a lot for one spec. Three options:

- **(A — chosen)** One file `audience-live-session.spec.ts` with six `test()` blocks under one `describe()`. Each block creates its own fresh context (`storageState` per-block) or uses the project-level state; the scenarios are independent. Estimated wall-clock: ~30-40s per block (alice-login + create-session is the dominant cost; the seed + assertion is cheap) → ~3-4 min total for the spec. Acceptable.
- **(B)** Split into per-concern files: `audience-graph-mount.spec.ts`, `audience-anonymous-render.spec.ts`, `audience-obs-no-input.spec.ts`, `audience-obs-dimensions.spec.ts`. Cleaner naming but quadruples the file count and the testMatch regex grows accordingly.
- **(C)** Pay debt down into the existing `audience-skeleton-smoke.spec.ts`. Rejected — the skeleton spec's purpose is "placeholder route reachability"; mixing graph-route concerns into it muddies the intent.

Decision: (A). The participant's `participant-graph-render.spec.ts` is one file with one scenario; the audience's first behavioural spec absorbs six because **all six are pinning different observable behaviours of the same route landing**. The single-file shape keeps the inherited-debt list visible as a coherent unit (re-reading the spec a year from now, the reader sees the six debts as one ledger).

### §8 — Real session creation per scenario, NOT a shared fixture session

The participant-graph-render precedent creates a fresh session per scenario (alice-creates + ben-claims). For the audience, the moderator session-claim flow doesn't apply (no debater slots; audience visitors are subscribers, not claimants). But each scenario still creates a real session via `POST /api/sessions` because:

- Real session ⇒ server's `canSeeSessionAnonymously` predicate returns truthy ⇒ anonymous subscribe succeeds.
- Real session ⇒ the WS server-side `trackSession` handler resolves a real session row + emits the live-session events.
- Synthetic UUID without a backing session ⇒ server rejects the subscribe with `not-found`; the `audience-graph-root` testid still renders (the route mounts regardless of subscribe success), but the seed-event scenario tier wouldn't reflect a realistic broadcast.

**Alternative**: drive everything against a single fixture session created in `beforeAll`. Rejected — session creation is cheap (~200ms per session); per-scenario creation gives clean isolation and matches the participant precedent.

**Alternative**: use a synthetic UUID with no backing session. Rejected per above.

### §9 — Locale-prefixed route reuses the same component; no separate `<AudienceLocalizedRoute>`

The locale-prefixed `<Route path="/:locale/sessions/:sessionId">` mounts the same `AudienceLiveRoute` component. The `<App>`'s locale-negotiation `useEffect` (lines 142-146 of App.tsx) reads the URL and flips `i18n.language`; the route component doesn't need to know about locale.

`useParams<{ sessionId: string; locale?: string }>()` would surface `locale` to the route if needed, but it isn't — the locale-driven label localization happens inside `<AudienceGraphView>` via `useTranslation()` against the surface-wide i18n instance.

**Alternative**: separate route components for locale-prefixed and bare URLs. Rejected — duplicates code for no behavioral difference.

### §10 — Effort estimate stays at 1d despite the six-scenario Playwright spec

The `.tji` effort for this leaf is `1d`. Spec implementation alone (six scenarios mirroring participant-graph-render structure) is realistically ~3-4 hours; route component + Vitest cases + window-seam edit ~1-2 hours; spec-config widening + skeleton-spec URL adjustment ~30 min. Total: ~5-7 hours = 1d ± buffer.

The estimate holds, but the implementer should treat the spec as the dominant cost and seed it with the participant-graph-render precedent verbatim. If the spec grows beyond six scenarios at implementation time (e.g. discovering an additional event-ordering edge case worth pinning), bumping to 1.5d is a defensible call; the orchestrator/closer registers the actual effort post-shipment.

## Open questions

1. **Subscribe-rejection-aware messaging for private sessions.** When an anonymous visitor hits a private session, the server's `canSeeSessionAnonymously` returns false and the WS subscribe fails. The route this leaf adds mounts `<AudienceGraphView>` which displays an empty canvas (no events to render). A user-facing "this session is private; sign in" message lives downstream — but no WBS task currently scopes it. Recommendation: register `audience.aud_url_routing.aud_private_session_sign_in_cta` (~0.5d) as a follow-up tech-debt leaf via the closer. **Not blocking this leaf** — the broadcast-clean aesthetic of an empty canvas for an inaccessible session is the broadcaster's responsibility (don't share private URLs), not the audience surface's.

(All other open questions resolved by the Decisions above.)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/routes/AudienceLiveRoute.tsx` — NEW; reads `useParams<{ sessionId }>`, calls `useWsClient().trackSession(sessionId)` in a `useEffect`, renders `<AudienceGraphView />` wrapped in `<div className="h-screen w-screen">` (height fix — `SurfaceHost` uses `min-h-screen`, not `h-screen`).
- `apps/audience/src/routes/AudienceLiveRoute.test.tsx` — NEW; 5 Vitest cases (render, trackSession-on-mount, trackSession-on-navigate, malformed-uuid, locale-prefix × en-US/pt-BR parametrization).
- `apps/audience/src/App.tsx` — two `<Route>` entries inserted above wildcard: `/sessions/:sessionId` and `/:locale/sessions/:sessionId`, both mounting `<AudienceLiveRoute>`.
- `apps/audience/src/main.tsx` — `window.__aConversaWsStore = audienceWsStore` made unconditional (DEV gate dropped; matches participant precedent at `apps/participant/src/main.tsx:42-50`; tree-shaking in the compose production build eliminated the gated assignment — see attempt 5).
- `apps/audience/src/mount.test.tsx` — window-seam Vitest case added; 5 existing cases switched from `/a/sessions/<uuid>` to `/a/placeholder-fallback/<uuid>` (Cytoscape canvas init throws under happy-dom; wildcard route avoids that path).
- `playwright.config.ts` — `chromium-audience-skeleton` `testMatch` widened to `/audience-(skeleton-smoke|live-session)\.spec\.ts$/`.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — URLs switched to `/a/placeholder-fallback/${SESSION_ID}` per Decision §6 (synthetic UUID now matches the live route, not the wildcard).
- `tests/e2e/audience-live-session.spec.ts` — NEW; 6 Playwright scenarios: authenticated event delivery, live projection rendering, anonymous WS delivery, canvas mount on `/sessions/:id`, OBS no-input audit at graph-route tier, OBS dimension audit at graph-route tier (1920×1080 edge-to-edge). Pays down cumulative four-leaf deferred-e2e debt inherited from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init` plus graph-route extensions from `aud_obs_no_input_required` and `aud_obs_sizing_defaults`.
