# Ensure no user input is required for OBS rendering

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_obs_no_input_required` (effort `0.25d`, no explicit `depends`; the parent `aud_obs_integration` declares `depends !aud_shell`, so this leaf inherits the shell-complete frontier — `aud_app_skeleton`, `aud_no_auth_for_public`, `aud_auth_for_private`, `aud_anonymous_ws_subscribe`, `aud_ws_client` are all settled at this leaf's start).

**Effort estimate**: 0.25d — one new Vitest case in `apps/audience/src/mount.test.tsx` (a DOM audit asserting the absence of input-gating elements after mount), one new Playwright assertion appended to the existing anonymous scenario in `tests/e2e/audience-skeleton-smoke.spec.ts` (the OBS-typical visit: anonymous browser, public session, no user interaction), and a short inline annotation in [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) recording the invariant. No new file, no new package, no new i18n key, no new ADR.

**Inherited dependencies**:

- `!audience.aud_shell.aud_app_skeleton` (settled — the audience surface mounts under `/a/*` via the root host's `<SurfaceHost surfaceId="audience" routerBasePath="/a" />` dispatch; the wildcard route renders the `route-audience-placeholder` testid; the placeholder body is static text + an optional `<LoginButton>` chrome — no click handlers, no modals, no auto-mounted media elements. See [`apps/audience/src/App.tsx:122-127`](../../../apps/audience/src/App.tsx#L122)).
- `!audience.aud_shell.aud_no_auth_for_public` (settled — the host honors `meta.requiredAuthLevel: 'public'`, skips the `/login` deflection for anonymous visitors, and hands the audience surface an `{ status: 'unauthenticated', user: undefined }` `AuthContextValue`. The OBS browser source has no cookie and no input device, so this is the load-bearing path: the surface MUST render for an anonymous-on-public visit without any user gesture).
- `!audience.aud_shell.aud_auth_for_private` (settled — the `<AnonymousChrome>` rendered under `audience-sign-in` is an **optional** affordance for the rare private-session-anonymous-viewer recovery path; it is NOT a required interaction. An OBS browser source pointed at a public session sees the chrome briefly while the placeholder is up, ignores it, and continues to the live broadcast view once `aud_session_url` + `aud_cytoscape_init` are wired. See [`tasks/refinements/audience/aud_auth_for_private.md`](aud_auth_for_private.md) Decision §7).
- `!audience.aud_shell.aud_anonymous_ws_subscribe` (settled — the WS upgrade gate accepts cookie-less upgrades for public sessions; the OBS visit opens a WS connection automatically on mount with `allowAnonymous: true`. No "click to subscribe" handshake, no consent banner).
- `!audience.aud_shell.aud_ws_client` (settled — `<WsClientProvider>` is mounted in `main.tsx`; connection opens automatically on mount for the OBS-typical anonymous-on-public path).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled — Cytoscape canvas renders read-only; `cy.userPanningEnabled() === true` and `cy.userZoomingEnabled() === true` mean pan/zoom are **available** if a producer manually gestures into the OBS source, but rendering does not gate on either. See [`apps/audience/src/graph/GraphView.tsx:197-199`](../../../apps/audience/src/graph/GraphView.tsx#L197) and `aud_cytoscape_init.md` Decision §7. The graph view is not yet **reachable** from any route — the wildcard placeholder is the only mounted route today — so this leaf's invariant pins the placeholder; the future `aud_url_routing.aud_session_url` and `aud_obs_render_smoke` extend the same invariant to the reachable graph view).

## What this task is

A 0.25d **invariant-pinning** leaf. It does not add a feature; it captures the load-bearing OBS-browser-source contract — *"the audience surface mounts, renders, and continues rendering live content without requiring any user gesture"* — as committed regression pins so a future change cannot silently break it.

OBS browser sources run a headless Chromium without an input device. Anything that would require a user gesture in a normal browser breaks the OBS embed:

- A `<dialog>` (or `[aria-modal="true"]`) panel blocking interaction until the user dismisses it.
- An `<audio autoplay>` / `<video autoplay>` element whose playback is gated by the browser's autoplay policy (Chromium requires a prior user activation for unmuted autoplay).
- A "click to start" / "tap to view" affordance that occupies the viewport until clicked.
- A `requestFullscreen()` call (only permitted from a user-gesture handler).
- A `Notification.requestPermission()` / `getUserMedia()` / `navigator.permissions` prompt blocking on a permission dialog.
- A consent banner / cookie modal that must be dismissed before the underlying content paints.

The current audience surface has none of these (confirmed by a `grep` over `apps/audience/src/` for the patterns above — only matches are prose comments referencing "broadcast video frame" and "the viewport (camera jumps are disorienting on video)"). This leaf's job is to **pin that observation as a committed test** so a future change — a "feature" PR adding an opt-in audio mute/unmute toggle, a "polish" PR adding a cookie banner for GDPR, a "convenience" PR adding a fullscreen affordance — surfaces as a failing test instead of as a silent OBS-embed regression weeks later.

After this leaf:

- A Vitest mount-time DOM audit (new case in [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx)) asserts, after the audience tree mounts under the anonymous-on-public branch (the OBS-typical input), that the rendered DOM contains: zero `<dialog>` elements, zero `[aria-modal="true"]` elements, zero `<audio>` elements, zero `<video>` elements, and that the only `role="link"` / `<button>` affordance present is the optional `<LoginButton>` inside the `audience-sign-in` testid (the recovery path for private-session viewers — anonymous viewer of a public session does not need to click it).
- A Playwright assertion appended to the existing anonymous scenario at [`tests/e2e/audience-skeleton-smoke.spec.ts:86-118`](../../../tests/e2e/audience-skeleton-smoke.spec.ts#L86) extends the load-and-never-interact contract: after the placeholder testid renders, with zero `page.click()` / `page.keyboard.*` / `page.mouse.*` events fired in the scenario, the same DOM-audit (no `<dialog>`, no `[aria-modal]`, no `<audio>`, no `<video>`) holds in a real Chromium context.
- An inline annotation block lands at the top of `App.tsx` (a 4-5 line comment) recording the OBS-no-input invariant, the testid pinning it (`route-audience-placeholder` + the audit selectors), and the two future tasks that extend the invariant to the reachable graph view (`aud_url_routing.aud_session_url` and `aud_tests.aud_obs_render_smoke`).

Out of scope (deferred to existing future leaves — see Decision §5):

- **Extending the audit to the rendered graph view.** Today the wildcard placeholder is the only reachable route; the graph view exists in `apps/audience/src/graph/GraphView.tsx` but no route mounts it. When `aud_url_routing.aud_session_url` (1d, in WBS at [`tasks/50-audience-and-broadcast.tji:351-356`](../../50-audience-and-broadcast.tji#L351)) makes the graph reachable, that leaf's Playwright spec must extend the no-input pin to the graph route. See Decision §5.
- **A visual / pixel-level smoke at OBS browser-source dimensions.** `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`, in WBS at [`tasks/50-audience-and-broadcast.tji:432-436`](../../50-audience-and-broadcast.tji#L432)) is the existing leaf scoped for the pixel-level "renders correctly at typical OBS dimensions (1920×1080, etc.)" assertion. This leaf only pins the **structural** no-input invariant — what the DOM contains and doesn't contain. The pixel smoke at OBS dimensions remains `aud_obs_render_smoke`'s scope; that leaf's refinement-writer extends the no-input pin to its larger Playwright scenario (load the URL at 1920×1080, never interact, assert the graph viewport visibly renders).
- **Disabling Cytoscape pan / zoom for OBS embeds.** Per `aud_cytoscape_init.md` Decision §7, the canvas keeps `userPanningEnabled: true` and `userZoomingEnabled: true` — these are **available** affordances, not **required** ones. The graph renders fully without any pan or zoom gesture. Disabling them would not improve the OBS no-input property; not disabling them does not regress it. The invariant is "no required input," not "no possible input."
- **A `?chrome=off` query-param to suppress the `<LoginButton>` chrome for OBS embeds.** Deferred per `aud_auth_for_private.md` Decision §7 (speculative until a producer complaint surfaces). The chrome is an **optional** affordance — it does not block the visitor from seeing the placeholder or (once the graph route lands) the live event stream. The OBS visitor ignores it; nothing requires a click.
- **A new ADR.** The OBS no-input contract is a direct application of the OBS-browser-source mounting context established prose-side in [`aud_app_skeleton.md`](aud_app_skeleton.md) ("the audience surface OWNS the locale for the duration of its mount because the page may render inside an OBS browser source that does not represent a human user") and is structurally what an unauthenticated visit of a public surface always permitted. This leaf is captured-property-as-test, not a new architectural choice. See Decision §6.
- **Server-side change.** No HTTP route, no WS handler, no schema delta. The server side is auth-agnostic and gesture-agnostic by construction; the no-input property lives entirely in the surface.
- **Touching the `<LoginButton>` / `<AnonymousChrome>` / `useAuth()` consumer pattern in `App.tsx`.** The chrome stays exactly as `aud_auth_for_private` left it — it is the recovery path for private-session viewers and is OPTIONAL for OBS-typical visits.

## Why it needs to be done

OBS browser sources are the **primary delivery surface** for the audience view. The project's audience-broadcast story (see `aud_app_skeleton.md` introductory paragraphs and the WBS structure around `aud_obs_integration`) treats embedded OBS as the canonical use case; the standalone-browser viewer is a secondary path. If the OBS embed breaks — even subtly, even temporarily — the show producer's broadcast goes dark.

The failure modes are quiet:

1. **A future PR adds a cookie consent banner** to satisfy a new region's privacy rules. The banner blocks the viewport until "Accept" is clicked. In a normal browser, the user clicks it and continues. In an OBS browser source, the banner stays up forever and the audience surface never renders. The producer sees a blank rectangle in their broadcast.
2. **A future PR adds an opt-in "audio commentary" feature** with a `<video autoplay muted>` element that becomes a `<video autoplay>` after the viewer interacts. In a normal browser, the muted autoplay works and the audio waits for a gesture. In an OBS browser source with audio-output disabled, the muted autoplay still works — but if a later PR drops the `muted` attribute, autoplay is blocked by the Chromium autoplay policy and the element never plays. Maybe the audio was never load-bearing — but the point is *the OBS visit's pixel output is now different from the normal-browser visit*, which is exactly what the OBS contract was supposed to prevent.
3. **A future PR adds a "click to enable live updates" affordance** to defer the WS connection until the user opts in (perhaps to reduce server load for non-interested viewers). In a normal browser, the user clicks and the events flow. In an OBS browser source, the click never comes and the broadcast view stays frozen on the initial snapshot forever.

Each of these is plausible polish work that a contributor unfamiliar with the OBS context could ship without realizing the OBS-embed implication. A committed test that **fails** when any of these patterns lands surfaces the OBS-context regression at PR-review time, not at producer-complaint time weeks later.

Downstream consumers of this leaf:

- **`aud_url_routing.aud_session_url`** — lands the real per-session route + the WS subscribe. Its refinement-writer must extend the no-input pin to the graph route (a Playwright scenario that loads `/a/sessions/<uuid>` without interaction and asserts the graph viewport visibly populates after seeded events). The DOM-audit selectors this leaf establishes become the reusable predicate the future spec calls.
- **`aud_obs_integration.aud_obs_sizing_defaults`** (sibling, 0.5d, not yet refined) — lands default sizing for typical OBS browser-source dimensions. Likely a Tailwind / CSS adjustment to the surface container. The no-input invariant this leaf pins continues to hold across the sizing change; the sizing leaf's Vitest pin reuses the audit predicate.
- **`aud_obs_integration.aud_obs_transparency`** (sibling, 0.5d, not yet refined) — background transparency for OBS compositing. CSS-only; the no-input audit remains valid through the transparency leaf.
- **`aud_obs_integration.aud_obs_setup_docs`** (sibling, 1d, not yet refined) — producer-facing OBS setup guide. The docs reference the no-input contract this leaf pins ("the audience URL renders without any user interaction; you can point an OBS browser source at it directly").
- **`aud_tests.aud_obs_render_smoke`** (1d, depends `!!aud_obs_integration`) — the canonical OBS-dimensions smoke. Inherits the no-input audit selectors from this leaf and extends them across the graph route + the OBS dimensions.

## Inputs / context

### ADRs

- [**ADR 0026 — micro-frontend root app**](../../../docs/adr/0026-micro-frontend-root-app.md) — Decision 2 fixes the `mount(props): UnmountFn` surface contract; Decision 3 fixes that the root owns auth chrome and the audience surface is "broadcast-clean." The OBS-typical visit is anonymous-on-public per Decision 3's prose; this leaf's no-input audit pins the structural correlate of that prose.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the new Vitest case + the appended Playwright assertion ARE the regression pins. No manual "I loaded the URL in OBS and it worked" smoke. The audit is repeatable, deterministic, and runs on every PR.
- [ADR 0029 — anonymous WebSocket subscribe for public sessions](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — the audience surface's WS subscribe runs automatically on mount for the anonymous-on-public path; no click-to-subscribe handshake. The no-input invariant builds on this: subscribe-automation is what makes the broadcast view continue updating without gesture once the graph route lands.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n.md) — the audience surface reads locale from the URL prefix, not from a dropdown / language picker. The locale negotiation is URL-driven; no user gesture is required to settle the locale.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — the audit's selectors are type-checked under strict mode; a regression to the audit shape surfaces as a compile error.

### Sibling refinements

- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — establishes the surface bundle, the placeholder route, and the prose-side reference to the OBS browser-source mounting context. This leaf pins the OBS-no-input property the skeleton's prose hinted at.
- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — establishes the anonymous-on-public mount path the OBS visitor uses. The `{ status: 'unauthenticated', user: undefined }` `AuthContextValue` shape is the load-bearing input for the new Vitest case here.
- [`tasks/refinements/audience/aud_auth_for_private.md`](aud_auth_for_private.md) — establishes the `<AnonymousChrome>` chrome (optional affordance, NOT required interaction). This leaf re-affirms the chrome's optionality structurally; Decision §7 of `aud_auth_for_private.md` explicitly defers `?chrome=off` suppression until a real producer complaint surfaces.
- [`tasks/refinements/audience/aud_anonymous_ws_subscribe.md`](aud_anonymous_ws_subscribe.md) — establishes the no-handshake subscribe path. The OBS visit's WS connection opens on mount with no gesture.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — establishes `<WsClientProvider>` auto-mount with `allowAnonymous: true`.
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — Decision §7 (defaults preserved for pan/zoom — available but not required) is the load-bearing prior decision for the "pan/zoom enabled is OK" line in Decision §3 below. Decision §9 (deferred-e2e debt aimed at `aud_url_routing.aud_session_url`) is the precedent for routing the graph-view no-input extension to the same future leaf.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Acceptance Criteria §11 defers pixel-level visual-quality pins to `aud_visual_regression`. This leaf similarly defers pixel-level OBS-dimensions assertions to `aud_obs_render_smoke`.

### Live code the leaf integrates with

- [`apps/audience/src/App.tsx:39-127`](../../../apps/audience/src/App.tsx#L39) — the placeholder route tree. **Not modified** beyond the inline annotation block (a 4-5 line comment near the existing `// Refinement:` header explaining the OBS-no-input invariant + the testid + the future-leaf pointers).
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — the mount entrypoint. **NOT modified.** The `<WsClientProvider allowAnonymous>` wire already opens connections automatically for the OBS-typical anonymous-on-public path.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. One new Vitest case appended after the existing three (~+50 LOC). Reuses the file's `StubWebSocket`, `beforeEach` / `afterEach` reset machinery, and `createI18nInstance('en-US')` bootstrap.
- [`apps/audience/src/graph/GraphView.tsx:197-199`](../../../apps/audience/src/graph/GraphView.tsx#L197) — confirms Cytoscape pan/zoom are enabled defaults (no `userPanningEnabled: false` or `userZoomingEnabled: false`); the canvas does NOT require any gesture to render. **NOT modified.**
- [`tests/e2e/audience-skeleton-smoke.spec.ts:86-118`](../../../tests/e2e/audience-skeleton-smoke.spec.ts#L86) — modified. ~+12 LOC: a DOM-audit assertion block appended to the anonymous scenario after the existing `audience-sign-in` href pin. No new scenario, no new describe block, no new spec file.
- `tests/e2e/fixtures/no-scrollbars.ts` — **NOT modified.** The existing test fixture continues to suppress scrollbars across all audience scenarios.

### What the surface MUST NOT contain (the audit predicate)

The Vitest + Playwright audit asserts, after mount under the anonymous-on-public input and after the placeholder renders:

- `container.querySelectorAll('dialog').length === 0` — no `<dialog>` (HTMLDialogElement) blocking interaction.
- `container.querySelectorAll('[aria-modal="true"]').length === 0` — no ARIA-modal panel.
- `container.querySelectorAll('audio').length === 0` — no `<audio>` element (avoids autoplay-policy regressions entirely; if a future leaf legitimately needs audio playback, that leaf updates this audit with a documented justification).
- `container.querySelectorAll('video').length === 0` — same rationale for `<video>`.
- `container.querySelectorAll('[data-requires-input="true"]').length === 0` — the audit reserves a `data-requires-input="true"` opt-out attribute for any future legitimately-input-gated element; an unannotated input-gating element fails the audit. (See Decision §4 for why an opt-out attribute exists.)

The audit deliberately does NOT assert "zero `<button>` or `<a>` elements" — the optional `<LoginButton>` inside `audience-sign-in` is a `<a>` element and is intentionally present. Buttons / links are AFFORDANCES, not REQUIREMENTS; the audit targets only the patterns that **gate** rendering on a gesture.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Two tiers pinning the same invariant at different fidelity:

1. **Vitest mount-time DOM audit** in `mount.test.tsx` — runs in happy-dom against the anonymous-on-public mount input. Fast, runs on every PR, catches regressions to the audited selectors before they reach Playwright.
2. **Playwright real-Chromium DOM audit** in `audience-skeleton-smoke.spec.ts` — runs in the same anonymous scenario that already exists. The audit asserts the same selectors but in a real browser context, catching regressions that only manifest under real DOM (e.g., a Vue-style portal that mounts a `<dialog>` outside the React root would escape the happy-dom audit but be caught in the Playwright audit because the Playwright audit queries `page.locator(...)` against the full document, not just the surface container).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) — modified. Inline annotation block added near the existing `// Refinement:` / `// ADRs:` header explaining the OBS-no-input invariant. Approximately +5 LOC of comment, zero behavior change.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. One new Vitest case appended after the three existing cases. Approximately +50 LOC.
- [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) — modified. Audit assertion block appended to the existing anonymous scenario. Approximately +12 LOC.

### Files this task does NOT touch

- `apps/audience/src/main.tsx` — no change. The mount entrypoint already wires `<WsClientProvider allowAnonymous>` for the OBS-typical path.
- `apps/audience/src/graph/` — no change. Cytoscape defaults (`userPanningEnabled: true`, `userZoomingEnabled: true`) are already correct per `aud_cytoscape_init.md` Decision §7; the no-input invariant tolerates them by construction (the audit targets gating elements, not optional affordances).
- `packages/shell/` — no change. `<LoginButton>` is an `<a href>` (full-page link, not an input gate); `<AnonymousChrome>` is an optional chrome the OBS visit ignores.
- `packages/i18n-catalogs/` — no change. No new i18n key; the invariant is structural, not user-facing.
- `apps/root/` — no change. The host's surface gate (`requiredAuthLevel: 'public'`) already permits the OBS-typical anonymous mount path.
- `apps/server/` — no change.
- `apps/moderator/`, `apps/participant/`, `apps/replay-test/` — none touched. The no-input invariant is audience-specific because OBS embeds are audience-specific; moderator + participant surfaces are user-driven and DO require input.
- `playwright.config.ts` — no project change.
- `apps/audience/package.json` / `apps/audience/vite.config.ts` — no new dependency.
- `docs/adr/` — no new ADR (Decision §6).
- `.tji` files — `complete 100` for this leaf lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md); no new follow-up tech-debt leaf is registered (the future audit extensions inherit into `aud_url_routing.aud_session_url` and `aud_tests.aud_obs_render_smoke`, both of which already exist in the WBS — see Decision §5).

### New Vitest case (sketch)

Appended after the existing three cases in `mount.test.tsx`:

```tsx
it('renders without any user-input-gating affordances for the OBS-typical anonymous-on-public path', async () => {
  // `aud_obs_no_input_required` — pins the OBS-browser-source contract:
  // a headless Chromium with no input device must be able to mount this
  // surface, render the placeholder (and, post-`aud_session_url`, the
  // live graph), and continue updating without any user gesture.
  // The audit targets gating patterns — `<dialog>`, `[aria-modal]`,
  // `<audio>` / `<video>` (autoplay-policy-gated), `[data-requires-input]`
  // — not optional affordances like the `<LoginButton>` chrome (which
  // is a plain `<a href>` link the OBS visit ignores).
  const i18n = await createI18nInstance('en-US');
  const auth: AuthContextValue = {
    status: 'unauthenticated',
    user: undefined,
    refresh: () => undefined,
    logout: () => undefined,
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  window.history.replaceState({}, '', '/a/sessions/00000000-0000-4000-8000-000000000099');

  let unmount!: () => void;
  act(() => {
    unmount = mount({
      container,
      auth,
      i18n: i18n as unknown as I18n,
      routerBasePath: '/a',
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
  });

  // The audit. Each selector targets a pattern that would silently
  // break an OBS browser-source embed.
  expect(container.querySelectorAll('dialog')).toHaveLength(0);
  expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
  expect(container.querySelectorAll('audio')).toHaveLength(0);
  expect(container.querySelectorAll('video')).toHaveLength(0);
  expect(container.querySelectorAll('[data-requires-input="true"]')).toHaveLength(0);

  // The optional chrome IS present and IS intentional — pin the
  // distinction so a future regression that removes the chrome
  // doesn't accidentally "satisfy" the audit by removing both
  // optional and required affordances. The chrome is the recovery
  // path for private-session viewers; OBS-typical public-session
  // visits ignore it.
  const signIn = screen.getByTestId('audience-sign-in');
  expect(signIn.querySelector('a')?.getAttribute('href')).toBe('/api/auth/login');

  act(() => {
    unmount();
  });
  expect(container.innerHTML).toBe('');
});
```

### New Playwright assertion (sketch)

Appended to the existing anonymous scenario at `audience-skeleton-smoke.spec.ts:89-117`, after the existing `audience-sign-in` href pin:

```ts
// `aud_obs_no_input_required` — the OBS browser-source contract: a
// headless Chromium with no input device mounts the surface, the
// placeholder renders, and no gating affordance is present. This
// scenario fires zero user-interaction events (no `.click()`, no
// `.keyboard.*`, no `.mouse.*`) — the assertions below confirm the
// surface reaches its rendered state without one.
await expect(page.locator('dialog')).toHaveCount(0);
await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
await expect(page.locator('audio')).toHaveCount(0);
await expect(page.locator('video')).toHaveCount(0);
await expect(page.locator('[data-requires-input="true"]')).toHaveCount(0);
```

### Inline annotation in `App.tsx` (sketch)

A comment block added near the existing `// ADRs:` block:

```tsx
// **OBS no-input invariant** (aud_obs_no_input_required). The audience
// surface mounts and renders without any required user gesture. The
// optional `<LoginButton>` chrome rendered under `audience-sign-in` is
// an affordance, not a requirement — the OBS-typical anonymous-on-
// public visit ignores it. Patterns that would gate rendering on a
// gesture (`<dialog>`, `[aria-modal]`, `<audio>` / `<video>` autoplay,
// `[data-requires-input="true"]`) are forbidden — pinned by a Vitest
// mount audit in `mount.test.tsx` and a Playwright audit in
// `audience-skeleton-smoke.spec.ts`. When `aud_url_routing.aud_session_url`
// makes the graph route reachable, that leaf extends the audit; the
// `aud_tests.aud_obs_render_smoke` leaf extends it across OBS-typical
// dimensions (1920×1080, etc.).
```

### Cucumber surface

**No Cucumber scenario in this leaf.** The OBS no-input invariant is a UI-DOM property, not a wire-format or projector-output property. The server is gesture-agnostic by construction (no server endpoint changes its behavior based on whether the client fired a gesture). Cucumber+pglite is the wrong layer; Vitest + Playwright is correct.

### UI-stream e2e policy disposition

**E2e is in scope; the existing Playwright spec carries the audit inline.** The audience surface IS reachable (the wildcard placeholder route renders for anonymous visitors after `aud_no_auth_for_public`), and the no-input property IS observable in a real Chromium context. The deferred-e2e exception does NOT apply at the placeholder tier — the audit lives in `audience-skeleton-smoke.spec.ts`.

The graph view is NOT yet reachable, so the audit at the **graph-route tier** is deferred per the deferred-e2e exception:

- Deferred to `aud_url_routing.aud_session_url` (1d, in WBS): when that leaf wires `<Route path="/sessions/:id" element={<AudienceLiveRoute />}>` and the live graph mounts, its Playwright spec MUST extend the no-input audit to the graph route — load the URL, never interact, assert (a) the graph viewport renders, (b) the same DOM-audit selectors (`<dialog>` / `[aria-modal]` / `<audio>` / `<video>` / `[data-requires-input]`) hold zero count even after seeded events arrive over WS. The `aud_session_url` refinement-writer reads this leaf's Status block to inherit the audit predicate.
- Deferred to `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`): the OBS-dimensions smoke extends the audit across 1920×1080 (and possibly 720p, 1440p) viewports. The pixel-level assertions are that leaf's scope; the no-input audit is the structural co-pin.

Both future leaves are already in the WBS; no new tech-debt leaf is registered here.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new Vitest case uses existing imports (`AuthContextValue`, `createI18nInstance`, `mount`, `audienceWsStore`); the new Playwright assertions use `page.locator(...).toHaveCount(...)` already imported via `expect, test` from `./fixtures/no-scrollbars`.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by exactly **+1** (the one new `mount.test.tsx` case). No existing smoke case regresses.
3. **`pnpm run test:e2e`** (under `make up`) runs the modified `tests/e2e/audience-skeleton-smoke.spec.ts` with both scenarios green. The anonymous scenario's new audit assertion block passes against the current placeholder shape (zero `<dialog>`, zero `[aria-modal]`, zero `<audio>`, zero `<video>`, zero `[data-requires-input]`).
4. **`pnpm -F @a-conversa/audience build`** green. The audience workspace's library-mode bundle is unchanged at the source level (only a comment block + test files differ); tree-shaking is unaffected.
5. **`pnpm -F @aconversa/root build`** + **`pnpm -F @a-conversa/moderator build`** + **`pnpm -F @a-conversa/participant build`** all green. The audience-side change does not break peer surfaces.
6. **Failing-first verifiability** — temporarily adding `<dialog open>OBS-breaking modal</dialog>` to `<PlaceholderRoute>` MUST make both the new Vitest case ("renders without any user-input-gating affordances...") AND the new Playwright audit assertion (`page.locator('dialog').toHaveCount(0)`) fail. Independently, temporarily adding `<video autoplay src="..."/>` MUST make the `'video'` selector assertion fail at both layers. The Implementer confirms both reversions in their verification log before re-applying. Pins ADR 0022's regression-pin property at two distinct loci against two distinct gating patterns.
7. **No file modifications outside the explicit allowlist** in "Files this task touches."
8. **No regression of the existing audience smoke pins** — the three pre-existing Vitest cases in `mount.test.tsx` (authenticated mount, anonymous mount with chrome, mid-mount flip with chrome) and the two pre-existing Playwright scenarios continue to pass unchanged.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf's task block. The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
10. **No new i18n key audit drift** — `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json` have no new `pending` entries from this leaf (no new keys added).
11. **No new ADR is committed** by this leaf (Decision §6). The pre-commit hook's `docs/adr/` check stays green without a new entry.

## Decisions

### 1. Audit by absence-of-selectors, not by attempting autoplay

Two alternatives surveyed:

- **(A) Positive autoplay test** — instantiate a `<video autoplay muted>` element in the test, navigate to the audience URL, and assert the video element plays. Rejected. (i) The audience surface does not contain a `<video>` element by design — testing autoplay behavior would require fabricating one solely for the test, which is exactly the anti-pattern ADR 0022 forbids ("no throwaway verifications"). (ii) Real autoplay policy behavior is environment-dependent (different across Chromium versions, headed vs. headless, audio-output-attached vs. not); a positive test would be flaky. (iii) The OBS contract is "no required input," not "autoplay works" — autoplay is one specific mechanism that REQUIRES input; the audit's job is to forbid the mechanism, not to validate its behavior in the audited surface.
- **(B) Absence-of-selectors audit** *(chosen)* — assert the rendered DOM does not contain the patterns that gate on user interaction. Each pattern (`<dialog>`, `[aria-modal="true"]`, `<audio>`, `<video>`, `[data-requires-input="true"]`) maps to a concrete OBS-breaking failure mode. The audit is deterministic, environment-independent, and runs in both happy-dom and real Chromium. A future legitimate need for a gating element (vanishingly unlikely for the audience surface, but possible) is handled by the `data-requires-input="true"` opt-out attribute (Decision §4) plus a refinement-document update explaining the new constraint.

### 2. The optional `<LoginButton>` chrome is NOT a violation — pin its presence positively

The new Vitest case asserts the chrome IS present (the `audience-sign-in` testid + the inner `<a href="/api/auth/login">`). Two alternatives surveyed:

- **(A) Treat the chrome as a violation and assert its absence** (require `?chrome=off` or similar suppression for the OBS path). Rejected. The OBS visit IGNORES the chrome — it is a static `<a>` link with no autoplay, no gating, no required interaction. Suppressing it adds complexity (a new query-param contract, new tests, new conditional rendering) for zero OBS benefit. The audit correctly targets gating patterns, not all interactive elements.
- **(B) Treat the chrome as intentional and assert its presence** *(chosen)*. The positive assertion serves a second purpose: if a future regression removes the chrome (perhaps "to clean up the OBS view"), the audit fails before the regression ships. This prevents the audit from silently passing in the degenerate state ("no chrome → no input-gating elements → audit green, but the private-session sign-in path is broken"). The audit explicitly distinguishes OPTIONAL affordances (chrome — present is OK) from REQUIRED interactions (gating elements — present is FORBIDDEN).

### 3. Cytoscape pan/zoom enabled defaults are NOT a violation

`aud_cytoscape_init.md` Decision §7 preserves `userPanningEnabled: true` and `userZoomingEnabled: true`. These are user-INITIABLE gestures (the user CAN pan or zoom if they want) — not user-REQUIRED gestures (the graph renders fully without either). The OBS visit never receives any gesture, so the canvas renders at its initial fit + zoom level forever; this is the desired broadcast behavior.

Two alternatives surveyed:

- **(A) Force `userPanningEnabled: false` + `userZoomingEnabled: false` for OBS embeds** (perhaps via a `?obs=1` query-param or a `requiredAuthLevel: 'public'` correlate). Rejected. (i) Disabling does not improve the no-input property — the canvas already renders without input. (ii) Disabling removes a legitimate use case (a producer manually panning the graph during a debate to highlight a specific node, via OBS's "transform-on-source" pointer-pass-through). (iii) The OBS no-input invariant is "no REQUIRED input," not "no POSSIBLE input."
- **(B) Leave the defaults alone** *(chosen)*. The audit does not target pan/zoom; the canvas renders without gesture; the invariant holds. If a future producer needs gesture-suppression for some specific compositing mode, a sibling task lands the suppression — that is `aud_obs_integration` scope, not this leaf's.

### 4. The `[data-requires-input="true"]` opt-out attribute

The audit reserves a `data-requires-input="true"` attribute as the named opt-out for any element that legitimately requires user input. Two alternatives surveyed:

- **(A) No opt-out — the audit always forbids gating elements** (any future legitimately-input-gated element fails the audit and the audit must be updated). Rejected. (i) Audit updates become friction: a contributor adding a legitimate input-gated affordance (e.g., a producer-facing diagnostic panel hidden behind a hotkey, only relevant for development) must also update the audit, which is easy to forget and creates a "the audit is broken" cargo-cult ("just delete that assertion"). (ii) The audit's value is the **declared intent** — "this element is a gating element, the contributor explicitly marked it as such" — not the act of forbidding any gating element absolutely.
- **(B) Reserve a `data-requires-input="true"` opt-out** *(chosen)*. Any element legitimately requiring input declares the attribute. The audit asserts zero elements have the attribute on the canonical OBS-typical path (anonymous-on-public mount). A future feature that needs a gating element on a different path (e.g., a moderator-only debug overlay) sets the attribute conditionally and the audit's input-shape (anonymous-on-public) does not see it. The declared intent is the discipline; the attribute is the marker. Refinement updates accompany any new use of the attribute.

The attribute namespace (`data-requires-input`) is new; no existing code uses it. The audit's `[data-requires-input="true"]` selector is the canonical reader.

### 5. Tech-debt registration: future audit extensions inherit into existing WBS leaves

The Vitest + Playwright audit this leaf installs pin the no-input invariant at the **placeholder route tier**. Two future tiers extend the audit:

- **Graph-route tier**: when `aud_url_routing.aud_session_url` (1d, [tasks/50-audience-and-broadcast.tji:351-356](../../50-audience-and-broadcast.tji#L351)) wires the live graph route, its Playwright spec extends the audit to assert the no-input invariant after WS events arrive and the graph visibly populates. The audit selectors (`<dialog>`, `[aria-modal]`, `<audio>`, `<video>`, `[data-requires-input]`) are reused verbatim.
- **OBS-dimensions tier**: `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`, [tasks/50-audience-and-broadcast.tji:432-436](../../50-audience-and-broadcast.tji#L432)) extends the audit across viewport sizes typical of OBS browser sources (1920×1080, possibly 720p / 1440p). The audit selectors hold across all viewports.

**No new WBS leaf is registered here.** Both future tiers already exist; their refinement-writers read this leaf's Status block to inherit the audit predicate. Decision §5's discipline is "the predicate IS the artifact; the audit's selectors are the reusable seam."

### 6. No new ADR

This task introduces no architectural choice. The OBS-browser-source mounting context is established prose-side in `aud_app_skeleton.md` and is structurally a property of the anonymous-on-public mount path. The audit's selector list (`<dialog>`, `[aria-modal]`, `<audio>`, `<video>`, `[data-requires-input]`) is a direct enumeration of well-known browser autoplay-policy and modal-rendering patterns — no new convention.

The `[data-requires-input="true"]` opt-out attribute (Decision §4) is a new attribute name, but it is documented in the refinement (Decision §4) + the inline annotation in `App.tsx`; an ADR would be over-weight for a single attribute used by a single audit predicate.

The "no new dependencies" rule is satisfied (no new runtime dep, no new dev dep). No ADR is triggered.

### 7. The audit lives in the existing `mount.test.tsx` + `audience-skeleton-smoke.spec.ts`, not in dedicated files

Two alternatives surveyed:

- **(A) Dedicated test files** — `mount.no-input.test.tsx` and `obs-no-input-smoke.spec.ts`. Rejected. (i) Adds file-discovery friction for a contributor investigating "why does my PR fail the audience tests?" (now they grep across multiple files instead of one). (ii) The audit shares the same `beforeEach` / `afterEach` setup as the existing cases; duplicating that setup in a new file violates DRY. (iii) The audit's failure mode (a regression to the no-input invariant) is structurally the same kind of regression the other mount cases catch (a `useAuth()` consumer change, an `<AnonymousChrome>` mis-render); colocating the audit with the existing cases keeps the failure-mode neighborhood tight.
- **(B) Append to existing files** *(chosen)*. One new case in `mount.test.tsx`, one new assertion block in `audience-skeleton-smoke.spec.ts`'s existing anonymous scenario. Minimum-blast-radius; reuses all existing setup.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/App.tsx` — added inline OBS no-input invariant annotation block (~+13 LOC comment) near the existing `// Refinement:` / `// ADRs:` header, recording the audit predicate, the pinning testids, and the two future leaves that extend the invariant (`aud_url_routing.aud_session_url`, `aud_tests.aud_obs_render_smoke`).
- `apps/audience/src/mount.test.tsx` — appended 4th Vitest case `'renders without any user-input-gating affordances for the OBS-typical anonymous-on-public path'` (~+58 LOC); audits zero `<dialog>` / `[aria-modal="true"]` / `<audio>` / `<video>` / `[data-requires-input="true"]` under the anonymous-on-public mount, plus positive `audience-sign-in` chrome-presence pin.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — appended OBS audit assertion block (~+12 LOC) to the existing anonymous scenario after the `audience-sign-in` href pin; audits the same 5 selectors in real Chromium with zero user-interaction events fired.
- No new file, no new dependency, no new ADR, no new i18n key — structural invariant captured as committed tests per ADR 0022.
- Future audit extensions inherit into existing WBS leaves: `aud_url_routing.aud_session_url` (graph-route tier) and `aud_tests.aud_obs_render_smoke` (OBS-dimensions tier) — no new tech-debt leaf registered (Decision §5).
