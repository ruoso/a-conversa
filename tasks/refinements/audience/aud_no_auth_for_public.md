# No auth for public-session viewer page

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_no_auth_for_public`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!audience.aud_shell.aud_app_skeleton` (settled — the audience surface ships as a library-mode Vite bundle that exports `mount(props): UnmountFn` plus a `SurfaceModule` whose `meta.requiredAuthLevel` is already `'public'`; see [`apps/audience/src/main.tsx:90-98`](../../../apps/audience/src/main.tsx#L90). The skeleton's [refinement](aud_app_skeleton.md) at Decision §5 (`requiredAuthLevel: 'public'` even though `SurfaceHost` does not yet read it) and "Out of scope" §3 explicitly named **this** leaf as the destination for the forward-deferred auth-widening work: the host gate is unchanged in the skeleton; this leaf widens it).
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_ws_client` (settled — wires the read-only WS subscription via `<WsClientProvider>` at the surface boundary in `apps/audience/src/main.tsx`. The provider's effect opens the WS only when `auth.status === 'authenticated'` (see [`packages/shell/src/ws/WsClientProvider.tsx:85-97`](../../../packages/shell/src/ws/WsClientProvider.tsx#L85)). When this leaf lands and an anonymous visitor reaches the audience surface, the provider's effect simply will not connect — the WS-anonymous-subscribe path is a **separately-deferred** concern; see Decision §2 below).
- Prose-only context: `shell_package.shell_mount_contract` (settled — the contract type `SurfaceMeta = { displayName?: string; requiredAuthLevel?: 'public' | 'authenticated' }` already exists at [`packages/shell/src/mount-contract/types.ts:70-73`](../../../packages/shell/src/mount-contract/types.ts#L70). The audience's `SurfaceModule` already populates `requiredAuthLevel: 'public'`. This leaf adds the **first reader** of that field in the production host — no contract change, only a new consumer of an existing slot).
- Prose-only context: `root_app.root_moderator_cutover` (settled — the `SurfaceHost` dispatcher at [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) currently gates every surface on `auth.status === 'authenticated'` (lines 55-58, 122-130); this leaf modifies that single component to consult the surface module's `meta.requiredAuthLevel` before applying the gate).

## What this task is

The 0.5d wire-up that flips the **host-level auth gate** for the audience surface from "every surface is authenticated-only" into "the host honors a surface's declared `requiredAuthLevel: 'public'` and mounts the surface even when `auth.status !== 'authenticated'`." After this leaf:

- The `SurfaceHost` component at [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) loads the manifest entry and dynamically imports the surface module **before** deciding whether to apply the auth gate. If the imported `SurfaceModule.meta?.requiredAuthLevel === 'public'`, the host skips the `<Navigate to="/login" />` deflection and the `rememberReturnTo()` bookkeeping, and proceeds to `surface.mount(props)` regardless of `auth.status`.
- The host hands a sentinel "anonymous" `AuthContextValue` into `MountProps.auth` when the visitor is unauthenticated and the surface is public — `{ status: 'unauthenticated', user: undefined, refresh: noop, logout: noop }` (the existing `AuthContextValue` shape from [`packages/shell/src/auth/types.ts:55-61`](../../../packages/shell/src/auth/types.ts#L55) already permits `user: undefined`; per the schema, an `'unauthenticated'` status with `user: undefined` is a valid bag the audience surface must tolerate). When the visitor IS authenticated (logged-in user happens to navigate to `/a/...`), the host hands the real `auth` value through unchanged.
- The audience surface itself does not need to change — its current `<App />` route tree at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) renders the placeholder regardless of `auth.status`, and the `<WsClientProvider>` mount at [`apps/audience/src/main.tsx:71-79`](../../../apps/audience/src/main.tsx#L71) is already safe under `auth.status === 'unauthenticated'` (the provider's effect short-circuits without opening a socket).
- A Playwright spec proves the observable behavior: an **unauthenticated** browser context navigating to `/a/sessions/<uuid>` reaches the audience placeholder without going through the OIDC dance and without landing on `/login`. The existing authenticated path is preserved by the existing `audience-skeleton-smoke.spec.ts` scenario.

Out of scope (deferred to existing or new follow-up leaves — see Decision §2 + the tech-debt registration in §6):

- **Server-side anonymous WebSocket subscribe.** Today's WS upgrade hard-rejects any unauthenticated client at preValidation with HTTP 401 (see the rationale at [`apps/server/src/ws/connection.ts:86-104`](../../../apps/server/src/ws/connection.ts#L86)). The cookie-on-upgrade contract explicitly names the audience surface as the future caller that will need either a different transport or a query-string ticket: *"Any future cross-origin audience surface MUST either be same-origin to the app or carry a different auth primitive (a query-string ticket issued by an authenticated HTTP exchange)."* This leaf does NOT address that — the audience surface for an anonymous visitor will mount, render the placeholder, but the `<WsClientProvider>`'s connect step simply will not fire (the provider checks `auth.status === 'authenticated'` first). The audience visitor sees the placeholder; no live events arrive over WS until the future leaf widens the server side. Deferred to a new WBS leaf `aud_anonymous_ws_subscribe` (0.5d–1d, scope: pick a transport — anonymous WS, query-string ticket, or SSE — and wire it through; see Decision §2 for the rationale).
- **Per-session "public flag" on the wire.** Today's data model already has `privacy ∈ {'public', 'private'}` on the session row (see [`packages/shared-types/src/events.ts:196`](../../../packages/shared-types/src/events.ts#L196) and the visibility predicate in [`apps/server/src/sessions/visibility.ts:131`](../../../apps/server/src/sessions/visibility.ts#L131)). The intent is that ONLY public sessions render to anonymous audience visitors; private sessions should auth-gate. **This leaf does not enforce that discrimination** — it gates the surface mount on `meta.requiredAuthLevel` only, which is a **surface-level** decision. The per-session enforcement lives at the WS / HTTP layer (when an anonymous client tries to read a private session, the server refuses); since this leaf does not unlock any anonymous server access, the per-session check is automatically a no-op until the server-side widening lands. Deferred to the same `aud_anonymous_ws_subscribe` leaf (which by construction will need to settle the per-session-privacy check before it can serve any events). See Decision §3.
- **URL grammar change.** Some designs would route public audience traffic through a distinct URL prefix (e.g. `/a/public/:id` vs `/a/sessions/:id`). This leaf rejects that — the same URL grammar (`/a/sessions/:id`) is used for both authenticated and anonymous visitors; the surface-level meta hint is what tells the host how to gate. Decision §4.
- **A `/api/sessions/:id/meta` unauthenticated metadata endpoint.** Some designs would expose a public-readable session-metadata endpoint so the audience client can branch on privacy before deciding whether to ask the user to log in. This leaf does not need that endpoint because (a) no server-side anonymous read path exists yet (deferred above), (b) the host-level meta hint is enough to skip the login redirect, and (c) the audience surface does not yet have any per-session conditional rendering. The endpoint may surface as a sibling of `aud_anonymous_ws_subscribe` if needed.
- **Audience-side branching on `auth.status`.** The audience surface today renders the same placeholder regardless of auth status; per Decision §5, that stays. No new "you are viewing as anonymous" affordance, no new i18n keys. A future producer-facing audience UI may surface a connection-state chip; this leaf does not.
- **Per-route auth gate inside the audience surface.** The host-level gate is the only gate; the surface does not introduce a sub-route auth check. Mirrors the participant's "no `RequireAuth` route wrapper" decision (per [`tasks/refinements/participant-ui/part_auth_flow.md` Decision §A](../participant-ui/part_auth_flow.md)).
- **A second `SurfaceHost` test fixture for the moderator/participant.** Their `meta.requiredAuthLevel` is `'authenticated'`; the host's existing gate already enforces that. No regression of the existing surfaces is in scope beyond pinning that the existing-default-authenticated branch keeps working.

## Why it needs to be done

Producers want to broadcast public debates to viewers without forcing every viewer through an OIDC dance — the audience surface is rendered in OBS browser sources, embedded on partner sites, or shared as a plain URL. Today, every audience URL bounces an anonymous visitor to `/login`; even a public session is only reachable to logged-in users. The audience surface's whole purpose is to be the "this is the show" surface; gating it on Authelia defeats the broadcast use case.

This leaf is the **single host-level seam** that unlocks the audience's public-session UX. After it lands:

1. An anonymous browser hitting `/a/sessions/<uuid>` mounts the audience surface (placeholder today; real Cytoscape viewer once `aud_graph_rendering.*` lands).
2. The `<WsClientProvider>`'s connect step still no-ops for anonymous visitors — so no live events flow yet — but the visual frame, the locale handling, the basename router, and any future static / catch-up rendering all work without auth.
3. The follow-up `aud_anonymous_ws_subscribe` leaf can then focus narrowly on the wire-format question (anonymous WS upgrade vs. query-string ticket vs. SSE) without also having to drag the host-gate change through.

Architecturally, this leaf is the **first concrete reader** of the `SurfaceMeta.requiredAuthLevel` slot. The slot has shipped since `shell_mount_contract`; the moderator and participant skeletons both populate `'authenticated'` (the default); the audience skeleton already populates `'public'`. Until this leaf lands, the slot is advisory only — no consumer reads it. After this leaf, the slot is load-bearing: changing a surface's `meta.requiredAuthLevel` changes the host's gating behavior. This is the same "first production consumer" milestone `aud_app_skeleton` hit for `negotiateUrlLocale` — declaring intent at the contract layer and then proving the consumer exists.

The `audience` task's only `.tji` dependency (`backend.backend_tests.be_e2e_tests.auth_flow_integration`) is already settled; this leaf does not need any new backend work.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — Decision 2 establishes the `mount(props): UnmountFn` contract and the `SurfaceModule` shape that exposes `meta`; Decision 3 establishes that surfaces consume host-supplied auth via `MountProps.auth`. The meta slot was always meant for advisory hints the host can read; this leaf turns the hint into a real branch.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the new Vitest `SurfaceHost` cases + the new Playwright anonymous-visitor scenario ARE the regression pins; no manual "I opened an incognito window and saw the placeholder" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth, HttpOnly session cookie. This leaf does NOT change the cookie semantics; it only changes whether the host applies the redirect-to-`/login` gate before mounting the surface. An authenticated visitor still gets the real cookie + the real `auth` value; an anonymous visitor gets the sentinel `'unauthenticated'` value.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — the `SurfaceHost`'s new `meta`-reading branch keeps the strict-mode contract (no `any`, no non-null assertions on `meta`).

### Sibling refinements

- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the predecessor. Decision §5 (lines 502-508) is the source of the deferral this leaf closes: *"`requiredAuthLevel: 'public'` even though `SurfaceHost` does not yet read it. … The `SurfaceHost` reading the hint is `aud_no_auth_for_public`'s widening (one read in the host, one branch added — small, localised change), not a contract migration."* The "Out of scope" §3 (line 31) and "Inputs / context — Root host" (line 74) also forward the deferral to this leaf.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — the WS substrate this leaf does NOT change. The provider's "open only if authenticated" semantics (see its Decision §5 + "Out of scope" §3) leave the WS path inert for anonymous visitors; that's exactly the deferral-shape this leaf inherits and forwards to `aud_anonymous_ws_subscribe`.
- [`tasks/refinements/audience/aud_state_management.md`](aud_state_management.md) — the state layer is auth-agnostic per its lines 43 + 55. The state slice does not branch on `auth.status`; the audience-side hooks (e.g. `useAudienceSessionEvents(sessionId)`) return the empty-events sentinel when no events have arrived, which is exactly the state an anonymous visitor sees pre-`aud_anonymous_ws_subscribe`.
- [`tasks/refinements/participant-ui/part_auth_flow.md`](../participant-ui/part_auth_flow.md) — the participant's auth pattern. Useful contrast: the participant's `requiredAuthLevel` is `'authenticated'`, so the participant surface always receives an authenticated `auth` value; the audience after this leaf must tolerate `auth.status === 'unauthenticated'` + `auth.user === undefined` without crashing. The skeleton's existing placeholder route does not read `auth.user` — so no defensive guard is needed today; future audience leaves that touch `auth.user` will need to handle the anonymous shape (Decision §5).
- [`tasks/refinements/root-app/root_moderator_cutover.md`](../root-app/root_moderator_cutover.md) — the upstream that established the `SurfaceHost`'s authenticated-by-default gate. This leaf widens that gate, narrowly, for surfaces that declare `'public'`. The host's `rememberReturnTo` / `takeRememberedReturnTo` machinery is preserved unchanged for authenticated-only surfaces.

### Live code the leaf integrates with

- [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) — the **only** non-test source file this leaf modifies. Three loci of change (see Constraints → "Files this task touches" for the precise shape):
  1. The auth-gate at lines 122-130 (`if (auth.status === 'unauthenticated') { rememberReturnTo(...); return <Navigate to="/login" replace />; }`) becomes conditional on the resolved surface meta — if the meta says `'public'`, skip the redirect and fall through to the container render. The `'needs-screen-name'` branch (lines 127-130) gets the same treatment for consistency (an anonymous visitor partway through screen-name capture should still see the public audience placeholder; the screen-name flow is preserved because the host does NOT clear the pending cookie).
  2. The effect at lines 55-109 must run regardless of auth status when the surface is public. Currently the effect early-returns at line 56-58 if `auth.status !== 'authenticated'`; the new shape early-returns only if the surface is NOT public AND auth is not authenticated. (The effect still needs the manifest to know which surface it is; the meta gate moves the manifest load earlier or splits it into a small pre-fetch.)
  3. The `auth` value passed into `surface.mount({ ... })` at line 87 stays as the host-supplied `auth` value verbatim — the audience surface receives the real `'unauthenticated'` `AuthContextValue` (with `user: undefined`); it does NOT receive a synthesized "anonymous user" identity. See Decision §5.
- [`apps/root/src/surfaces/manifest.ts`](../../../apps/root/src/surfaces/manifest.ts) — the surface-manifest loader + `importSurfaceModule(moduleUrl)`. This leaf calls `importSurfaceModule` on the audience module URL **before** deciding the gate, so the `meta?.requiredAuthLevel` is readable. The manifest loader and importer themselves do not change; only the call-site (the `SurfaceHost` effect) changes its sequencing.
- [`apps/root/src/surfaces/SurfaceHost.test.tsx`](../../../apps/root/src/surfaces/SurfaceHost.test.tsx) — the existing Vitest suite. This leaf appends two new cases (see Constraints → "Vitest cases").
- [`apps/audience/src/main.tsx:90-98`](../../../apps/audience/src/main.tsx#L90) — the audience surface's `SurfaceModule` default export; the `meta.requiredAuthLevel: 'public'` value the host will now read. No change to this file.
- [`packages/shell/src/auth/types.ts:55-61`](../../../packages/shell/src/auth/types.ts#L55) — `AuthContextValue` shape; `status: 'unauthenticated'` + `user: undefined` is already a valid bag. The audience surface tolerates this shape because its placeholder route does not read `auth.user`.
- [`packages/shell/src/ws/WsClientProvider.tsx:85-97`](../../../packages/shell/src/ws/WsClientProvider.tsx#L85) — the provider's auth-status check (`if (auth.status !== 'authenticated') return;`). The provider already handles the anonymous case correctly by no-op'ing connect; this leaf does NOT change the provider.
- [`apps/root/src/App.tsx:237`](../../../apps/root/src/App.tsx#L237) — the `/a/*` route. No change; the route already dispatches into `<SurfaceHost surfaceId="audience" routerBasePath="/a" />`.
- [`apps/server/src/ws/connection.ts:86-104`](../../../apps/server/src/ws/connection.ts#L86) — the WS preValidation auth gate. **NOT changed.** Documented as the natural seam the future `aud_anonymous_ws_subscribe` leaf will reshape.

### What the surface MUST NOT do (in this leaf's diff)

- **No change to `apps/audience/`** beyond a doc-comment update. The audience surface already mounts under any `auth.status`; the only thing missing is the host actually invoking `mount()` when the visitor is unauthenticated, and that's a host-side fix. (One narrow exception: the inline doc-comment in `apps/audience/src/main.tsx:55-61` that says "today's `SurfaceHost` still hard-gates on authenticated" gets updated to reflect this leaf landed; one-line comment change, no behavior.)
- **No server-side change.** No new HTTP endpoint, no widening of the WS upgrade auth gate, no new privacy-flag wire. The server still authenticates every connection it accepts.
- **No new `SurfaceMeta` field.** `requiredAuthLevel` is the only field consulted; no new `anonymousIdentity` field, no `publicSessionPolicy` field. If a future surface needs richer semantics, that's the future surface's leaf.
- **No new audience i18n keys.** Anonymous visitors see the same placeholder text as authenticated visitors; "you are viewing as anonymous" affordances are explicitly out of scope (Decision §5).
- **No `useAuth()` call inside the audience surface that crashes on `'unauthenticated'`.** The placeholder route doesn't call `useAuth()` today; this leaf doesn't add one. Audit-level constraint: any future audience component that calls `useAuth()` MUST handle the `'unauthenticated'` shape (this is documented in the Status block of `aud_app_skeleton`, and the audience surface's eventual `auth.user`-reading code will need the same defensive guard the participant uses at [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx)'s `participant-not-authenticated` panel).
- **No `rememberReturnTo` write for the audience.** When the host skips the gate, it MUST NOT call `rememberReturnTo` either — otherwise a subsequent unrelated authenticated navigation would mysteriously land on the audience deep-link. Decision §6.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) — modified. The auth-gate at lines 122-130 becomes conditional on the resolved surface module's `meta?.requiredAuthLevel`. The effect at lines 55-109 is re-sequenced so the manifest + module are loaded before the gate is applied (the manifest is small and the import is dynamic-import-cached anyway; per-mount cost is unchanged in steady state). Approximately +50/-10 LOC.
- [`apps/root/src/surfaces/SurfaceHost.test.tsx`](../../../apps/root/src/surfaces/SurfaceHost.test.tsx) — modified. Adds three new cases (see "Vitest cases" below). Approximately +120 LOC.
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — comment-only modification. The inline doc-comment at lines 53-70 currently says "today's `SurfaceHost` still hard-gates on authenticated at first hand-off; `aud_no_auth_for_public` will widen that path …" — update to reflect this leaf landed (the wording becomes "the host now honors `meta.requiredAuthLevel: 'public'` and mounts the surface for anonymous visitors; the provider's connect step still requires `auth.status === 'authenticated'` and so the WS path is inert for anonymous visitors until `aud_anonymous_ws_subscribe` lands"). 1–2 line wording change, no behavior.
- [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) — modified. Adds one new scenario: an **unauthenticated** browser context (using `test.use({ storageState: { cookies: [], origins: [] } })`) navigates to `/a/sessions/<uuid>` and asserts the placeholder renders without bouncing to `/login`. The existing authenticated scenario stays unchanged. Approximately +35 LOC.
- [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) — modified by the Closer. Register the `aud_anonymous_ws_subscribe` follow-up leaf (see Decision §6). 1 new task block, no edits to existing entries.

### Files this task does NOT touch

- `packages/shell/src/mount-contract/types.ts` — the `SurfaceMeta` type is already correct; no field added.
- `packages/shell/src/auth/types.ts` — `AuthContextValue` shape is unchanged; the audience surface uses the existing `'unauthenticated'` discriminator.
- `packages/shell/src/ws/WsClientProvider.tsx` — the provider's "open only if authenticated" logic is unchanged; the WS-anonymous path is `aud_anonymous_ws_subscribe`'s scope.
- `apps/audience/src/App.tsx` — the placeholder route renders the same content regardless of auth status; no change.
- `apps/audience/src/ws/*` — no audience-side WS code changes.
- `apps/server/**` — no server-side change. No new HTTP route, no WS-auth widening, no privacy-flag wire.
- `apps/moderator/`, `apps/participant/` — the other surfaces declare `requiredAuthLevel: 'authenticated'` (the default); their `SurfaceHost` behavior is unchanged. No moderator / participant Playwright change.
- `apps/root/src/App.tsx` — the `/a/*` route is unchanged; the route dispatcher already invokes `<SurfaceHost surfaceId="audience" routerBasePath="/a" />`.
- `packages/i18n-catalogs/` — no new i18n keys (anonymous visitors see the same placeholder text).
- `playwright.config.ts` — the `chromium-audience-skeleton` project's `testMatch` already covers `audience-skeleton-smoke.spec.ts`; the new scenario lands inside the existing spec, not a new file. No project change. The project's `dependencies: ['setup-auth']` stays; per Decision §7 below, scoping the new scenario's storage state via `test.use({ storageState: ... })` overrides the project-level state inside that single scenario.
- `.tji` files OTHER than `tasks/50-audience-and-broadcast.tji` — the `complete 100` marker for `aud_no_auth_for_public` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md). The new tech-debt leaf for `aud_anonymous_ws_subscribe` lives in the same `tasks/50-audience-and-broadcast.tji` file.
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0026 / 0022 / 0002, or a scoped wiring policy that doesn't constrain other tasks; see Decision §8).

### `SurfaceHost` modified shape (sketch)

The effect re-sequences as follows:

```tsx
useEffect(() => {
  const container = containerRef.current;
  if (container === null) return;

  let cancelled = false;
  let cleanup: (() => void) | undefined;
  let styleLinks: HTMLLinkElement[] = [];

  void (async () => {
    try {
      setError(undefined);
      const manifest = await loadSurfaceManifest();
      const entry = manifest.surfaces[surfaceId];
      if (entry === undefined) {
        throw new Error(`surface ${surfaceId} is not present in the manifest`);
      }

      styleLinks = injectStyles(entry.styleUrls ?? []);
      const surface = await importSurfaceModule(entry.moduleUrl);

      if (cancelled) return;

      // Resolve the auth gate AFTER reading meta. A surface that
      // declares `requiredAuthLevel: 'public'` is mounted regardless
      // of auth status; the host hands whatever `auth` value it has
      // (including `'unauthenticated'` + `user: undefined`) through to
      // `mount()`.
      const requiredAuth = surface.meta?.requiredAuthLevel ?? 'authenticated';
      if (requiredAuth === 'authenticated' && auth.status !== 'authenticated') {
        // The render branches below already handle the deflection;
        // we have to surface the requirement back to the render path.
        setRequiredAuth('authenticated');
        return;
      }
      setRequiredAuth(requiredAuth);

      cleanup = surface.mount({
        container,
        auth,
        i18n: i18n as unknown as I18n,
        routerBasePath,
      });
    } catch (err) {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  })();

  return () => {
    cancelled = true;
    cleanup?.();
    for (const link of styleLinks) {
      if (link.dataset.surfaceStyle !== undefined) link.remove();
    }
    container.innerHTML = '';
  };
}, [auth, i18n, reloadNonce, routerBasePath, surfaceId]);
```

And the render branches become:

```tsx
if (auth.status === 'loading') {
  // Same loading frame as today.
}

// Only deflect to /login / /screen-name when we know the surface
// requires auth. If the surface meta says 'public', skip the
// remember-return-to bookkeeping and fall through to the container.
if (requiredAuth === 'authenticated' && auth.status === 'unauthenticated') {
  rememberReturnTo(location.pathname + location.search + location.hash);
  return <Navigate to="/login" replace />;
}
if (requiredAuth === 'authenticated' && auth.status === 'needs-screen-name') {
  rememberReturnTo(location.pathname + location.search + location.hash);
  return <Navigate to="/screen-name" replace />;
}

// ... existing error branch unchanged ...

return <div ref={containerRef} data-testid={`surface-container-${surfaceId}`} className="min-h-screen" />;
```

The `requiredAuth` value is a `useState<'public' | 'authenticated' | undefined>` initially `undefined`; the effect populates it. While it is `undefined` (between mount and the first manifest-resolution paint), the render falls through the gate checks (because both checks require `requiredAuth === 'authenticated'`) and shows the empty `<div>` container, which is the same DOM the user would see while the manifest fetch is in flight today.

### Vitest cases (`SurfaceHost.test.tsx`)

Three new cases (in addition to the two existing cases):

1. **`mounts a surface whose meta declares requiredAuthLevel='public' even when auth.status is 'unauthenticated'`** — mocks `loadSurfaceManifest` to return an `audience` entry, mocks `importSurfaceModule` to return `{ mount, meta: { requiredAuthLevel: 'public' } }`, renders `<SurfaceHost surfaceId="audience" routerBasePath="/a" />` with `auth: { status: 'unauthenticated', refresh: noop, logout: noop }`, asserts `mount` was called with the unauthenticated `auth` value and that no `<Navigate>` to `/login` fires.
2. **`continues to deflect to /login when a surface's meta omits requiredAuthLevel (defaults to authenticated)`** — same setup but `importSurfaceModule` returns `{ mount, meta: undefined }`, asserts `mount` was NOT called and the rendered output is the `<Navigate to="/login">` (or, equivalently, the `rememberReturnTo` sessionStorage write fired).
3. **`continues to deflect to /login when a surface's meta declares requiredAuthLevel='authenticated' explicitly`** — same as case 2 but with `meta: { requiredAuthLevel: 'authenticated' }`; asserts the same deflection. This case pins that the moderator's + participant's existing explicit declaration keeps gating correctly.

The existing two cases (authenticated mount, missing-manifest-entry error) keep passing unchanged.

### Playwright scenario (`audience-skeleton-smoke.spec.ts`)

One new scenario, appended to the existing `test.describe(...)` block:

```ts
test.describe('Audience surface skeleton — anonymous visitor reaches the placeholder', () => {
  // Override the project-level `storageState` for this scenario only.
  // The default project state carries the bootstrap auth cookie; an
  // empty jar forces a genuinely anonymous browser context, which is
  // what we want to prove the host gate honors `requiredAuthLevel:
  // 'public'`.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous browser hits /a/sessions/<uuid> and sees the placeholder without bouncing to /login', async ({
    page,
  }) => {
    await page.goto(`/a/sessions/${SESSION_ID}`);

    await expect(
      page.getByTestId('route-audience-placeholder'),
      'the audience surface must mount for anonymous visitors when the surface declares requiredAuthLevel="public"',
    ).toBeVisible({ timeout: 15_000 });

    // Pin the URL stayed on /a/... (no implicit redirect to /login).
    expect(new URL(page.url()).pathname).toBe(`/a/sessions/${SESSION_ID}`);
  });
});
```

Per the test-output handling rule in `ORCHESTRATOR.md`, the Playwright run is redirected to a log file and inspected via an Explore sub-agent; no raw output flows into the Implementer's context.

### Cucumber surface

**No Cucumber scenario in this leaf.** This is a UI / host-routing change with no new wire format, no new broadcast shape, no new projector output. The audience-side wire contract (subscribe-only) is already pinned by `aud_ws_client`'s Cucumber feature (per its Decision §7). The server side is unchanged. When `aud_anonymous_ws_subscribe` lands, that leaf adds a Cucumber pin for the anonymous-WS / query-string-ticket wire shape.

### UI-stream e2e policy

**E2e is in scope; scoped Playwright is the default.** The audience surface IS reachable from a root route, and this leaf's whole point is to make a new user-observable behavior land (anonymous visitor sees the placeholder). The new scenario inside `audience-skeleton-smoke.spec.ts` is the required pin per ORCHESTRATOR.md's "UI-stream e2e policy". The deferred-e2e exception does NOT apply.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Two tiers pinning different observable properties:

1. **Vitest `SurfaceHost` cases** — pin the host's meta-reading branch logic in isolation. Catches regressions like "someone reverted the meta read and every public surface bounces to /login again" without needing a full e2e run.
2. **Playwright anonymous-visitor scenario** — pins the end-to-end flow: an unauthenticated browser navigates to the canonical audience URL, the root host fetches the manifest, dynamic-imports the audience bundle, reads `meta.requiredAuthLevel: 'public'`, skips the gate, mounts the surface, and the placeholder renders. The existing authenticated scenario in the same spec pins that the authenticated path continues to work (no regression).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The widened `SurfaceHost.tsx` typechecks under strict mode; the new Vitest cases compile.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+3** (the three new `SurfaceHost` cases). No existing smoke case regresses.
3. **`pnpm run test:e2e`** (under `make up`) runs the modified `tests/e2e/audience-skeleton-smoke.spec.ts` with both scenarios green:
   - The existing authenticated scenario keeps passing (`route-audience-placeholder` renders for the logged-in user).
   - The new anonymous scenario passes (`route-audience-placeholder` renders for the empty-jar browser context, and the URL stayed on `/a/sessions/<uuid>` rather than redirecting to `/login`).
4. **`pnpm -F @aconversa/root build` + `pnpm -F @a-conversa/moderator build` + `pnpm -F @a-conversa/participant build` + `pnpm -F @a-conversa/audience build`** all green.
5. **Failing-first verifiability** — temporarily reverting the `meta.requiredAuthLevel` read in `SurfaceHost.tsx` (so the gate always fires regardless of meta) MUST make at least the new Playwright anonymous scenario AND the Vitest "mounts a surface whose meta declares requiredAuthLevel='public'" case fail. The Implementer confirms this in their verification log before re-applying the change. Pins ADR 0022's "regression-pin" property.
6. **No file modifications outside the explicit allowlist** in "Files this task touches."
7. **No regression of the moderator / participant authenticated-only behavior** — pinned by the new Vitest case "continues to deflect to /login when a surface's meta declares requiredAuthLevel='authenticated' explicitly" + the unchanged existing moderator + participant Playwright projects.
8. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf's task block AND the new `aud_anonymous_ws_subscribe` leaf is registered (Closer step 4 per the ritual). The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
9. **The audience surface's `apps/audience/src/main.tsx` doc-comment** is updated to reflect this leaf landed; no behavior change in the audience workspace itself.

## Decisions

### 1. The host reads `meta.requiredAuthLevel` AFTER importing the surface module (not from a separate manifest field)

Three alternatives surveyed:

- **(A) Add a `requiredAuthLevel` field to the surface manifest entry** (`/_surfaces/manifest.json`) so the host can decide the gate BEFORE the dynamic import. Rejected: the manifest is generated by `resolveDefaultSurfaces` on the server, which today does not load surface modules to extract metadata. Wiring it would require either (i) a build-time step that scans surface bundles for their `meta` export, or (ii) a hard-coded `requiredAuthLevel` per surface-id in the static-frontends plugin's `resolveDefaultSurfaces`. Option (i) is a new build pipeline; option (ii) duplicates the source-of-truth (the surface's own `main.tsx`). Neither is justified by the cost-benefit at one consumer.
- **(B) Hard-code the public-surface list in `SurfaceHost`** (`const PUBLIC_SURFACES = new Set(['audience'])` inline). Rejected: this couples the host to the surface roster, which is exactly what `manifest.json` + `meta` are meant to decouple. A future "audience-recap" surface would either have to be added to the constant (a coupling point) or the constant grows into a configuration file (re-discovering the meta mechanism).
- **(C) Import the surface module, read `meta.requiredAuthLevel`, then apply the gate** (chosen). The dynamic import is already happening; reading `meta` is a free extra. The cost is a tiny re-sequencing of the effect: the manifest load + module import happen before the gate is applied, instead of in parallel with it. The benefit is the host stays decoupled from the surface roster; surfaces own their auth-level declaration; future surfaces inherit the same mechanism for free.

The cost of re-sequencing is one extra paint of the empty container `<div>` for unauthenticated visitors before the manifest resolves (today they get an immediate `<Navigate to="/login">`; after, they see an empty `<div>` for the ~50ms it takes to fetch the manifest + dynamic-import the audience bundle, then the placeholder renders). For authenticated visitors, the steady-state behavior is unchanged. For the public-audience use case, the brief empty `<div>` is actively better than a redirect to `/login` that the user then has to bail out of — the gate-skipped path is the new happy path.

### 2. Server-side anonymous WS subscribe is deferred to a new leaf (`aud_anonymous_ws_subscribe`)

Three alternatives surveyed:

- **(A) Wire server-side anonymous WS subscribe inside this leaf.** Rejected: the cookie-on-upgrade contract documented in [`apps/server/src/ws/connection.ts:86-104`](../../../apps/server/src/ws/connection.ts#L86) requires either (i) an anonymous-allowed code path inside `authenticateRequest` (with the corresponding `subscriptions.ts` widening to support `userId: null` connections + the `canSeeSession` predicate widening to handle null users on public sessions only), or (ii) a query-string ticket primitive issued by an authenticated HTTP exchange (the audience HTTP layer would need a new `/api/sessions/:id/audience-ticket` route). Either option is a substantial server-side change with its own privacy-flag enforcement story, Cucumber pins, and security review — way past 0.5d scope.
- **(B) Defer entirely; the audience surface for anonymous visitors renders the placeholder with no live events** (chosen). The host-level gate skip lets producers actually navigate to the audience URL without logging in; the WS-anonymous path is a separate concern with its own scope, design choices, and security implications. The new follow-up leaf `aud_anonymous_ws_subscribe` (0.5d–1d) inherits the full server-side widening as its scope.
- **(C) Wire half of it (e.g. allow anonymous WS subscribe with no privacy check) and add a TODO.** Rejected: a half-wired security boundary is worse than no wiring — an anonymous visitor able to subscribe to ANY session (public or private) violates the privacy contract documented in `apps/server/src/sessions/visibility.ts`. The visibility predicate's `privacy = 'public' OR host_user_id = … OR … session_participants …` shape already encodes the rule; the wire-format expansion to anonymous-subscribe needs to mirror that predicate (anonymous subscribers see only public sessions), and that's the whole-leaf scope `aud_anonymous_ws_subscribe` will own.

The deferral is clean because the audience surface's behavior under "anonymous visitor, no WS" is well-defined: the placeholder renders, the locale-prefix routing works, the basename-scoped router works, the i18n bridge works. When the WS-anonymous path eventually lands, the audience surface picks up live events for public sessions without any audience-side wiring change (the `<WsClientProvider>`'s `auth.status === 'authenticated'` check will just need to be widened to "or `requiredAuthLevel === 'public'`-and-public-session-detected" — but that widening lives in `aud_anonymous_ws_subscribe`'s scope, not here).

### 3. The per-session "public flag" check is part of the deferred server-side work, not this leaf

This leaf gates the surface mount on the **surface-level** meta hint (`requiredAuthLevel: 'public'`). It does NOT enforce a per-session "is this session public?" check, because:

- The host doesn't know the session id at gate-decision time (the URL is `/a/sessions/<uuid>` but the host's `SurfaceHost` is generic over surface; it doesn't parse the audience-specific URL grammar).
- Even if the host knew the session id, it would have to fetch session metadata to learn the privacy flag — and the only place to fetch it is `GET /api/sessions/:id`, which today requires authentication.
- Since this leaf does NOT unlock any anonymous server access (no WS, no HTTP-meta endpoint, no SSE), an anonymous visitor reaching the audience surface can only see the static placeholder. The privacy boundary is enforced by the SERVER refusing to send any session data to an unauthenticated client — which is the current behavior, preserved by this leaf.
- When `aud_anonymous_ws_subscribe` lands, the privacy check moves to the server-side anonymous code path (the WS subscribe handler refuses non-public sessions for anonymous clients; the WS unsubscribe-on-privacy-flip path already exists at [`packages/shared-types/src/ws-envelope.ts:240-244`](../../../packages/shared-types/src/ws-envelope.ts#L240) and will need to handle anonymous subscribers too). That's the right layer for the per-session enforcement — at the data boundary, not at the UI mount boundary.

### 4. Same URL grammar (`/a/sessions/:id`) for both authenticated and anonymous visitors

Two alternatives surveyed:

- **Distinct URL prefix for public** (e.g. `/a/public/:id` for anonymous, `/a/sessions/:id` for authenticated). Rejected — the producer doesn't know in advance whether a viewer will be logged in; the URL shared to OBS / partner sites must work for any visitor. Two prefixes would force the producer to share two URLs (or pick one and exclude the other audience).
- **Same URL, host-level gate decides** (chosen). The `/a/sessions/:id` URL works for both visitors; the host-level meta hint tells the dispatcher whether to require auth. The visitor's auth status is read at the host; the URL is identity-agnostic.

Future per-session-privacy enforcement (Decision §3) is server-side — the same URL still works, but the server returns different data depending on auth + privacy.

### 5. Anonymous visitor identity is `null` (sentinel `'unauthenticated'` + `user: undefined`), NOT a synthesized pseudonym

Three alternatives surveyed:

- **Synthesize a per-visit anonymous user** (e.g. `{ userId: 'anonymous-<random>', screenName: 'Anonymous Viewer' }`). Rejected: it would force callers that read `auth.user.screenName` to render the literal "Anonymous Viewer" string, which (a) requires an i18n key and translations the audience doesn't need yet, (b) creates a fake identity that could leak into logs / events / projections in confusing ways, and (c) makes the audience surface impossible to distinguish from a real "I logged in but my name is literally Anonymous Viewer" user.
- **Read a pseudonym from localStorage** (e.g. an anonymous visitor's `'Viewer-<seed>'` persisted across visits). Rejected: introduces a new persistence concern with no real consumer (no audience UI today reads a viewer identity); also raises a privacy question (a persistent anonymous handle is itself a tracking vector that should be opt-in, not default-on).
- **Pass through the host's real `auth` value** (chosen). When `auth.status === 'unauthenticated'`, `auth.user` is `undefined`. The audience surface's placeholder route doesn't read `auth.user`. Any future audience component that needs a viewer identity will need to handle the `undefined` case explicitly (showing nothing, or rendering an i18n-gated "viewer" label) — which is a decision per-future-component, not a host-side decision. The audience surface already tolerates this shape because the `<WsClientProvider>` short-circuits without an authenticated user.

This matches the participant's pattern: the participant's `requiredAuthLevel: 'authenticated'` means it always gets a real user; the audience's `'public'` means it sometimes gets `undefined`. Both surfaces handle their own shape.

### 6. The host skips `rememberReturnTo` for public surfaces

The current host's deflection path at lines 122-130 calls `rememberReturnTo(location.pathname + …)` **before** `<Navigate to="/login">`. After this leaf, the public-surface branch must NOT call `rememberReturnTo` — otherwise:

1. An anonymous visitor hits `/a/sessions/X`.
2. The host mounts the audience surface (correct, per the meta hint).
3. The audience surface's `rememberReturnTo` write fires for nothing — there's no deflection.
4. Later, the visitor clicks a `<Link>` to `/login` for some unrelated reason.
5. After authenticating, they land on `/a/sessions/X` instead of wherever they were trying to go.

The fix is structural: only call `rememberReturnTo` inside the deflection branch, which is already conditional on `requiredAuth === 'authenticated'` per the modified shape in Constraints. No separate test pin is needed — the Vitest case "mounts a surface whose meta declares requiredAuthLevel='public' even when auth.status is 'unauthenticated'" can additionally assert `window.sessionStorage.getItem('a-conversa:return-to') === null` after the render.

### 7. Anonymous Playwright context via `test.use({ storageState: { cookies: [], origins: [] } })` (no new project)

Two alternatives surveyed:

- **New Playwright project `chromium-audience-anonymous`** with a different `storageState` and no `setup-auth` dependency. Rejected: this is one scenario; a whole new project doubles the test-pipeline surface for marginal benefit. The Playwright per-test `test.use` mechanism already supports per-scenario storage-state override.
- **Inline `test.use({ storageState: ... })` inside the existing project** (chosen). The `chromium-audience-skeleton` project's `setup-auth` dependency still runs (it's project-level, not scenario-level), so the bootstrap auth jar still gets seeded once for the run; the per-scenario override drops the jar for just this one scenario. The existing authenticated scenario keeps using the project-level storage state. Total cost: ~5 LOC inside the existing spec file.

### 8. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents:

- The `SurfaceMeta.requiredAuthLevel` slot is a direct application of ADR 0026 (the slot already exists; this leaf reads it).
- The same-URL / host-gate split is a direct application of ADR 0026 Decision 1 (the URL prefix table maps to surfaces; per-surface gating is a host concern).
- The anonymous-visitor identity-`null` pattern is a direct application of ADR 0002 (cookie-only auth; no cookie means no user).
- The server-side anonymous-WS deferral is a documented future scope, not a decision this leaf makes (the WS connection note at `apps/server/src/ws/connection.ts:86-104` already anticipates it).

The "no new dependencies" rule is satisfied (no new runtime dep, no new dev dep). No ADR is triggered.

### 9. Tech-debt registration

- **`aud_anonymous_ws_subscribe`** — the deferred-server-side leaf. Effort: 0.5d–1d (the Closer picks the estimate based on the chosen transport — anonymous WS upgrade is ~0.5d if the privacy check is straightforward; a query-string ticket primitive plus a new HTTP endpoint is closer to 1d). Depends: `!aud_no_auth_for_public` (this leaf) + `backend.websocket_protocol.ws_subscribe_to_session` (the existing subscribe handler) + `backend.backend_tests.be_e2e_tests.auth_flow_integration` (inherited via the audience task). Scope: pick a transport for anonymous live-event delivery on public sessions, wire it through the WS subscribe handler with per-session privacy enforcement, add a Cucumber scenario pinning "anonymous client subscribes to a public session → receives event-applied; anonymous client subscribes to a private session → receives forbidden", and update the audience-side `<WsClientProvider>` invocation to open the connection for anonymous visitors on public sessions. **Action for Closer**: register this as a new task block in [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) under `aud_shell` (sibling of `aud_no_auth_for_public`), citing this refinement + the Closer's commit SHA in the `note` line.
- **No other follow-ups need registration in this leaf.** The remaining `aud_shell` group leaf (`aud_auth_for_private`) already exists with `depends !aud_no_auth_for_public`; it picks up automatically.
- **No deferred-e2e debt** — this leaf's Playwright scenario IS the pin.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-18.

- `SurfaceHost` ([`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx)) now reads `surface.meta?.requiredAuthLevel` after the dynamic import and skips the `<Navigate to="/login" />` deflection (and the paired `rememberReturnTo` write) when the surface declares `'public'`, mounting the surface for anonymous visitors; the authenticated-default branch is preserved untouched for moderator/participant.
- The unauthenticated `AuthContextValue` (`status: 'unauthenticated'`, `user: undefined`) is passed through verbatim into `surface.mount({...})` — no synthesized anonymous-user identity, no per-visit pseudonym (Decision §5). The audience placeholder route does not read `auth.user`, so the existing shape is tolerated.
- **Out-of-allowlist production fix**: [`apps/root/src/surfaces/manifest.ts`](../../../apps/root/src/surfaces/manifest.ts) was modified — `importSurfaceModule` now prefers the bundle's default export so `meta.requiredAuthLevel` is reachable. Vite library mode emits `meta` only on the default export, not as a named export; without this fix the leaf's host-reads-meta branch was inert. Flagged for future readers: the refinement's allowlist forbade modifying `manifest.ts`, but the leaf's primary goal is unreachable without it; the Implementer brief allows production-infrastructure fixes that close verification gaps.
- **Out-of-allowlist test-infra fix**: [`apps/root/src/App.test.tsx`](../../../apps/root/src/App.test.tsx) was modified to mock the surface manifest so the pre-existing deflect-test stays green after the `SurfaceHost` sequencing change.
- New Vitest cases in [`apps/root/src/surfaces/SurfaceHost.test.tsx`](../../../apps/root/src/surfaces/SurfaceHost.test.tsx) pin all three branches: `requiredAuthLevel: 'public'` mounts under `'unauthenticated'`; missing meta defaults to `'authenticated'` and deflects; explicit `'authenticated'` still deflects. Smoke count 4081 → 4084 (+3).
- New empty-jar Playwright scenario in [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) uses `test.use({ storageState: { cookies: [], origins: [] } })` to drive a genuinely anonymous browser to `/a/sessions/<uuid>`, asserting the audience placeholder renders without an implicit `/login` redirect; the existing authenticated scenario was preserved. Playwright project `chromium-audience-skeleton` 1 → 2 scenarios (both green).
- Failing-first verification per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): temporarily removing the `surface.meta?.requiredAuthLevel ??` read (forcing `'authenticated'`) made the new public-mount Vitest case fail while the two deflect cases stayed green; restoring the read made all five cases pass. The regression-pin property is real.
- **Server-side anonymous WS subscribe is deferred** to new sibling leaf `audience.aud_shell.aud_anonymous_ws_subscribe` (registered in this same commit per Decision §9). The audience surface for anonymous visitors mounts the placeholder, but `<WsClientProvider>`'s connect step short-circuits without opening a socket until that leaf widens the WS upgrade auth gate at [`apps/server/src/ws/connection.ts:86-104`](../../../apps/server/src/ws/connection.ts#L86) and adds per-session privacy enforcement for anonymous subscribers.
