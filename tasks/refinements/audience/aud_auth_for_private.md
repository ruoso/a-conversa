# Wire audience surface to shell's AuthContext for private sessions

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_auth_for_private` (effort `0.5d`, depends `!aud_no_auth_for_public, shell_package.shell_substrate_extraction`; embedded `note` records the post-ADR-0026 reshape — "the OAuth callback handling, login/logout, and screen-name capture all live in apps/root/ + @aconversa/shell. The audience surface only consumes useAuth() from shell to auth-gate private-session viewer pages; the auth UX itself is the root's responsibility.").

**Effort estimate**: 0.5d — one consumer-side `useAuth()` call inside the existing placeholder route, a small `<LoginButton>` chrome rendered when anonymous, two new Vitest mount-boundary cases, one new Playwright assertion appended to the existing anonymous scenario. No new package, no new server endpoint, no new i18n key.

**Inherited dependencies**:

- `!audience.aud_shell.aud_no_auth_for_public` (settled — the host now reads `surface.meta?.requiredAuthLevel` and mounts the audience for anonymous visitors; the host hands the real `AuthContextValue` (including `status: 'unauthenticated'`, `user: undefined`) verbatim into `MountProps.auth`; the audience surface's `main.tsx` already wraps the React tree in `<AuthValueProvider value={props.auth}>` so `useAuth()` is callable from any audience component; see [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) and [`apps/audience/src/main.tsx:57`](../../../apps/audience/src/main.tsx#L57). The [`aud_no_auth_for_public.md` Decision §5](aud_no_auth_for_public.md) explicitly named **this leaf** as the first audience-side reader of `auth.user`: *"any future audience component that calls `useAuth()` MUST handle the `'unauthenticated'` shape."* This leaf is that future component.).
- `!shell_package.shell_substrate_extraction` (settled — `AuthValueProvider`, `useAuth`, the canonical `AuthContextValue` / `AuthStatus` / `AuthUser` types, the `<LoginButton>` chrome, and the `logout()` helper all live in `@a-conversa/shell`; see [`packages/shell/src/auth/index.ts`](../../../packages/shell/src/auth/index.ts), [`packages/shell/src/auth/types.ts:23-61`](../../../packages/shell/src/auth/types.ts#L23), [`packages/shell/src/login-logout/LoginButton.tsx`](../../../packages/shell/src/login-logout/LoginButton.tsx), and [`packages/shell/src/index.ts:13-29`](../../../packages/shell/src/index.ts#L13).).
- Prose-only context (NOT a `.tji` edge): `!audience.aud_shell.aud_anonymous_ws_subscribe` (settled — the WS upgrade gate accepts cookie-less upgrades, `canSeeSessionAnonymously` enforces "public AND not-ended" at subscribe time, and a subscribe to a private session by an anonymous client returns the canonical `not-found` error envelope per the existence-non-leak rule. See [`apps/server/src/sessions/visibility.ts:217-226`](../../../apps/server/src/sessions/visibility.ts#L217) and [`apps/server/src/ws/handlers/subscribe.ts:95-123`](../../../apps/server/src/ws/handlers/subscribe.ts#L95). This leaf does NOT add a subscribe call — the audience's per-session subscribe lives in the future `aud_url_routing.aud_session_url` task; this leaf only lands the **chrome-side affordance** that lets an anonymous viewer of what they suspect is a private session sign in and retry.).
- Prose-only context: `participant_ui.part_shell.part_auth_flow` (settled — the canonical "consumer-side `useAuth()` wire-up inside a surface" pattern. The participant added a `participant-identity` chip + a defensive `participant-not-authenticated` panel. This leaf mirrors the **pattern** (one in-surface `useAuth()` consumption + a `data-testid`-pinned affordance per branch) but **not** the chrome shape — the audience aesthetic differs from the participant's; see Decision §1 below.).
- Prose-only context: `moderator_ui.mod_shell.mod_route_auth_gate` (settled — the moderator's [`RequireAuth`](../../../apps/moderator/src/auth/RequireAuth.tsx) wrapper is the canonical "exhaustive `switch` over `AuthStatus`" shape; this leaf reuses the switch discipline but NOT the route-gate semantics — the audience has one wildcard route today and the host-level gate already discriminates `'public'` from `'authenticated'`; replicating `RequireAuth` here would be parallel logic with no caller. See Decision §3.).

## What this task is

The 0.5d wire-up that turns the audience surface from "renders the same placeholder regardless of auth state" into "consumes `useAuth()` once and surfaces a `<LoginButton>` chrome when the visitor is anonymous." After this leaf:

- The audience surface's `<App>` (or `<PlaceholderRoute>`) calls `useAuth()` exactly once. The hook reads from the host's `<AuthValueProvider value={props.auth}>` already wrapped around the React tree in [`apps/audience/src/main.tsx:57`](../../../apps/audience/src/main.tsx#L57); no new fetch, no new provider, no new context.
- The surface renders an unobtrusive chrome under `data-testid="audience-sign-in"` containing the shell's `<LoginButton>` **only** when `auth.status === 'unauthenticated'` OR `auth.status === 'needs-screen-name'`. The button's text resolves to the existing `auth.login.button` i18n key the shell already ships; no new audience i18n key. The chrome lives inside the existing `<main>` of the placeholder route so it inherits the existing layout container — small, bottom-aligned, clear of the future graph viewport.
- When `auth.status === 'authenticated'`, the surface renders **no auth chrome**. Rationale: an authenticated visitor at an audience URL is almost always a moderator or participant double-checking the broadcast view; cluttering that view with "Signed in as X" chrome works against the audience's broadcast-clean aesthetic (see Decision §1). The placeholder DOM is identical to the pre-leaf shape for the authenticated branch — the existing `route-audience-placeholder` testid remains the sole assertion seam for that path.
- When `auth.status === 'loading'`, the surface renders no chrome (the bootstrap interval is brief and transient; adding text would flash). The placeholder still renders; the chrome is simply absent until `status` settles.
- A defensive narrow tolerates `auth.user === undefined` while `auth.status === 'authenticated'` (the mid-mount logout-flip window the participant's `part_auth_flow` Decision §A documents — same race here, same defense). On that signal the surface degrades to the unauthenticated chrome: a `<LoginButton>` becomes visible so the visitor can sign back in.
- The Vitest mount-boundary file at [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) grows two new cases: one for the unauthenticated branch (the `<LoginButton>` chrome renders, `audience-sign-in` testid visible, `route-audience-placeholder` still visible) and one for the mid-mount auth-flip defensive guard (the surface re-renders with the LoginButton when `auth.user` is undefined under `'authenticated'`). The existing authenticated case grows one negative assertion: the `audience-sign-in` testid is **absent**.
- The Playwright spec at [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) extends the **existing anonymous scenario** (lines 81-101) with one assertion: the `audience-sign-in` testid is visible and contains an `<a>` element pointing at `/api/auth/login` (the shell's `<LoginButton>` semantics). The existing authenticated scenario grows a negative assertion: the `audience-sign-in` testid is NOT present. No new Playwright project, no new spec file.

Out of scope (deferred to existing or future leaves — see Decision §6 + the tech-debt registration in §7):

- **Per-session subscribe-rejection-aware UX.** When the audience surface eventually does `useWsClient().trackSession(sessionId)` (in `aud_url_routing.aud_session_url`), an anonymous viewer of a **private** session will receive a wire `not-found` error envelope (per `aud_anonymous_ws_subscribe.md` Decision §3 — existence-non-leak collapse). The "this might be a private session you have access to; sign in to retry" contextual messaging belongs in the leaf that lands the subscribe — this leaf cannot wire the contextual message because there is no subscribe call yet. The static `<LoginButton>` chrome this leaf installs is the **transport** for that future flow; the contextual wording lives downstream. See Decision §6.
- **An identity affordance for authenticated visitors** (a `Signed in as <screenName>` chip, a logout button). The audience's broadcast-clean aesthetic argues against. See Decision §1.
- **OBS-embed chrome suppression** (e.g. a `?chrome=off` query param or a `data-attribute` on the surface container that hides the `audience-sign-in` chip for OBS browser sources). The chrome this leaf installs is small enough that OBS embeds of public sessions can tolerate it; if a future producer surfaces a real complaint, a sibling task lands the suppression. See Decision §7.
- **A per-route `<RequireAuth>` wrapper inside the audience surface.** The host's surface-level gate already discriminates `'public'` (always mount) from `'authenticated'` (deflect to `/login`); the audience declares `'public'` so the host's gate is the *only* gate; replicating a route-level switch inside the audience adds no behaviour. See Decision §3.
- **A `useAuth()`-consuming login/logout subcomponent factored out into `@a-conversa/shell`** beyond what `shell_substrate_extraction` already shipped. The shell exports `<LoginButton>` and `logout()`; the audience consumes them as-is.
- **Audience-side branching on `auth.status` for the existing placeholder content** (showing a different title or body for anonymous vs authenticated). The placeholder copy stays identical; the only branch is the chrome.
- **A new audience i18n key.** The `<LoginButton>` resolves its own label via `auth.login.button` (already in `en-US.json:14`, mirrored across pt-BR and es-419). No `audience.signIn.*` key added.
- **A second Playwright project for "audience-with-anonymous-chrome".** The existing `chromium-audience-skeleton` project's two scenarios (authenticated + anonymous, per `aud_no_auth_for_public`) carry the new assertion delta inline. No project change.
- **A second `mount.test.tsx` file** (e.g. `mount.auth.test.tsx`). The two new cases append to the existing file.
- **Server-side change.** No new endpoint, no privacy-flag wire, no WS-handler widening. The server already returns `not-found` for an anonymous probe of a private session; this leaf does not interact with the server seam at all.
- **A `requiredAuthLevel` semantic change.** The audience surface continues to declare `'public'` so the host mounts it for both authenticated and anonymous visitors. The leaf's auth-aware chrome is a **runtime** branch inside the mounted surface, not a re-gate at the host.

## Why it needs to be done

The audience surface is the project's "this is the show" surface — broadcast-quality live view of a debate, mostly rendered into OBS browser sources or shared as a plain URL. After `aud_no_auth_for_public` + `aud_anonymous_ws_subscribe` landed:

1. An anonymous visitor reaching `/a/sessions/<uuid>` of a **public** session sees the placeholder and (once `aud_session_url` + `aud_cytoscape_init` land) live events flow over WS — the happy path.
2. An anonymous visitor reaching `/a/sessions/<uuid>` of a **private** session also sees the placeholder, but the future subscribe call will be rejected with `not-found` (existence-non-leak rule). Today they have **no way in** — the audience surface offers no sign-in affordance, so the visitor can only guess that the URL is broken or that they need to sign in somewhere else.

This leaf installs the minimal affordance an anonymous visitor needs: a `<LoginButton>` chrome that, when clicked, initiates the OIDC handshake (the shell's `<LoginButton>` is a full-page `<a href="/api/auth/login">` per its own implementation — Authelia is a foreign origin and the handshake cannot be done via `fetch`; see [`packages/shell/src/login-logout/LoginButton.tsx:30-34`](../../../packages/shell/src/login-logout/LoginButton.tsx#L30)). After authenticating, the visitor lands back at the audience URL via the existing OIDC callback machinery, the surface re-mounts with `auth.status === 'authenticated'`, the chrome disappears, and (once `aud_session_url` lands) the per-session subscribe runs with the authenticated `canSeeSession` predicate — admitting the host / participant who has access to the private session.

The leaf is also the **first audience-side reader of the shell's `useAuth()` substrate**. The audience-skeleton's mount wires `<AuthValueProvider value={props.auth}>` already, but no audience component has called `useAuth()`; the `aud_no_auth_for_public.md` Decision §5 explicitly named **this leaf** as that future first reader. Validating the consumer-side seam now (with the small chrome affordance) avoids a "we wired the provider but never consumed it; turns out a downstream typing change broke the substrate read" surprise when `aud_session_url` lands its bigger consumer.

Downstream consumers of this leaf:

- **`aud_url_routing.aud_session_url`** — lands per-session routing + the `useWsClient().trackSession(sessionId)` subscribe call. Reads `useAuth()` to (a) decide which subscribe predicate the server will apply (server-discriminated automatically; no client-side branch needed beyond status), and (b) attach the contextual "this is a private session you may have access to; sign in to retry" wording when the subscribe is rejected with `not-found` while `auth.status === 'unauthenticated'`. The `audience-sign-in` chrome this leaf installs is the visual transport for that contextual flow.
- **`aud_graph_rendering.aud_cytoscape_init`** — pure consumer of WS events; auth-agnostic at the rendering layer. The chrome this leaf installs becomes invisible (covered by the graph viewport) once the graph renders, OR co-exists at the bottom of the layout — the layout decision lives in `aud_cytoscape_init`'s scope.
- **Future `aud_session_url`-co-landed UX** — may surface a "viewing as anonymous" inline chip near the chrome (deferred; not this leaf's scope).

Architecturally, this leaf validates ADR 0026 Decision 3 ("each surface consumes auth from the host via `MountProps.auth`, not by re-running OIDC") for the audience the same way `part_auth_flow` validated it for the participant. The validation is *partial* because the audience is the FIRST surface to consume `useAuth()` under a `requiredAuthLevel: 'public'` declaration — every prior consumer (moderator, participant) declared `'authenticated'` and was guaranteed `auth.status === 'authenticated'` at mount time. The audience must tolerate all four `AuthStatus` branches and degrade gracefully; that's the new shape this leaf pins.

## Inputs / context

### ADRs

- [**ADR 0026 — micro-frontend root app**](../../../docs/adr/0026-micro-frontend-root-app.md) — Decision 2 fixes the surface mount contract (`mount(props): UnmountFn` + `MountProps.auth`); Decision 3 fixes that the root owns auth chrome and surfaces own only their mounted region. The audience consumes `useAuth()` and `<LoginButton>` from the shell; it does NOT re-implement the OIDC handshake or the screen-name form or a `/logout` button. Consequences §1's "auth chrome single-sources" promise is honored: a single `auth.login.button` i18n key, a single `<LoginButton>` component, a single `/api/auth/login` redirect target.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the new Vitest mount-boundary cases + the extended Playwright assertions ARE the regression pins. No manual "I clicked sign-in in incognito and it worked" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — cookie-only auth, full-page redirect to `/api/auth/login` (not `fetch`). The `<LoginButton>` from the shell respects this contract verbatim.
- [ADR 0029 — anonymous WebSocket subscribe for public sessions](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — establishes that the server's anonymous-WS path returns `not-found` for private-session subscribes (existence-non-leak). This leaf installs the **client-side affordance** that lets an anonymous viewer recover from that rejection (by signing in and retrying) — but the rejection-aware **contextual wording** is downstream; see Out-of-scope above.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — the new `useAuth()`-driven `switch (status)` is exhaustive (mirrors `RequireAuth.tsx:84-119`); a future `AuthStatus` member triggers a compile error here, forcing the audience surface to acknowledge the new state.

### Sibling refinements

- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — the predecessor. Decision §5 (the anonymous-identity-`null` discipline) is the load-bearing constraint this leaf inherits: `auth.user` is `undefined` for anonymous; the audience surface must handle that shape without crashing or synthesizing a fake user. The "Out of scope" §6 (no audience-side branching on `auth.status` for the existing placeholder content) is unchanged: this leaf does NOT branch the placeholder copy; it only adds the chrome.
- [`tasks/refinements/audience/aud_anonymous_ws_subscribe.md`](aud_anonymous_ws_subscribe.md) — the immediate WS predecessor. Decision §3 (anonymous-on-private → `not-found`) is the server-side behavior this leaf's affordance is downstream of; Decision §9 (`allowAnonymous` provider opt-in) is already populated in `main.tsx:85`. This leaf does NOT extend the WS substrate.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — establishes the audience's WS provider mount + the surface boundary. Read-only relative to this leaf; no provider change.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — establishes the surface bundle + the `route-audience-placeholder` testid + the `requiredAuthLevel: 'public'` meta. The placeholder testid stays the outer wrapper; the new `audience-sign-in` testid is a sibling child element inside the same `<main>`.
- [`tasks/refinements/participant-ui/part_auth_flow.md`](../participant-ui/part_auth_flow.md) — the canonical "in-surface consumer-side `useAuth()`" pattern. Mirrored partially: the audience reuses the discipline (one `useAuth()` call, exhaustive `switch`, defensive `auth.user === undefined` guard) but NOT the chrome shape (no `Signed in as <screenName>` chip; broadcast-clean aesthetic — see Decision §1).
- [`tasks/refinements/moderator-ui/mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md) — the pre-ADR-0026 moderator pattern that built OIDC + screen-name + logout from scratch inside the moderator workspace. **Deliberately not mirrored**; everything that file built has since moved into `@a-conversa/shell` + `apps/root/` per ADR 0026, and the audience consumes those instead.
- [`tasks/refinements/moderator-ui/mod_route_auth_gate.md`](../moderator-ui/mod_route_auth_gate.md) — the moderator's per-route `RequireAuth` wrapper. **Deliberately not mirrored** here — the audience has one wildcard route and the host-level gate already discriminates; see Decision §3.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) — the canonical `useAuth()` + `<LoginButton>` + `logout()` exports this leaf consumes; the no-OIDC-profile-data audit invariant (`AuthUser = { userId, screenName }` only) is preserved — the audience reads neither field directly from the shell's auth surface in this leaf.

### Live code the leaf integrates with

- [`apps/audience/src/App.tsx:34-84`](../../../apps/audience/src/App.tsx#L34) — the placeholder route tree. The `<PlaceholderRoute>` component currently reads only `useTranslation()`; this leaf adds the `useAuth()` consumption and the conditional `<LoginButton>` child element. The existing `route-audience-placeholder` testid + the `audience.placeholder.title` / `audience.placeholder.body` i18n keys are preserved unchanged.
- [`apps/audience/src/main.tsx:36-94`](../../../apps/audience/src/main.tsx#L36) — the mount entrypoint. **NOT modified.** The `<AuthValueProvider value={props.auth}>` wrap at line 57 already publishes the host-supplied auth into the audience's context; this leaf only consumes it. The inline doc-comment at lines 24-34 (mentioning that the audience's chrome will read `useAuth()` once private-session viewer pages land) gets a one-line update reflecting this leaf landed; no behavior change.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. The existing case grows one negative assertion (`audience-sign-in` absent for the authenticated input); two new cases appended (the unauthenticated render shows the LoginButton; the defensive guard renders the LoginButton when `auth.user === undefined` under `'authenticated'`).
- [`packages/shell/src/login-logout/LoginButton.tsx:19-35`](../../../packages/shell/src/login-logout/LoginButton.tsx#L19) — the `<LoginButton>` component the audience renders. Already accepts a `className` (so the audience can apply its own minimal-chrome styling) and a `data-testid` (the audience overrides to `audience-sign-in`). **NOT modified.**
- [`packages/shell/src/auth/types.ts:23-61`](../../../packages/shell/src/auth/types.ts#L23) — the `AuthUser` (`{ userId, screenName }`) + `AuthStatus` discriminator + `AuthContextValue` shape. The audience surface's switch is exhaustive over `AuthStatus`. **NOT modified.**
- [`packages/shell/src/auth/useAuth.ts`](../../../packages/shell/src/auth/useAuth.ts) — the hook. Reads from the context the audience's `<AuthValueProvider>` published; throws when called outside the provider. **NOT modified.**
- [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) — modified. The existing authenticated scenario (lines 43-67) grows one negative assertion; the existing anonymous scenario (lines 81-101) grows one positive assertion. No new scenarios, no new file.
- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — **NOT modified.** The existing `setup-auth` project + the per-scenario `test.use({ storageState: ... })` override from `aud_no_auth_for_public` continue to cover both branches.

### What the surface MUST NOT do (in this leaf's diff)

- **No new fetch.** The `useAuth()` hook reads from the host's already-fetched `<AuthValueProvider>`. The audience surface fires zero auth-related network calls.
- **No new state / store / context.** The audience does not introduce an audience-scoped auth store; the read flows through the host's value verbatim.
- **No `<Navigate>` to `/login`.** The audience never deflects — it renders the LoginButton inline so the visitor can choose to sign in or stay anonymous (a public-session OBS viewer chooses to stay anonymous; that path keeps working).
- **No synthesized anonymous user.** Per `aud_no_auth_for_public.md` Decision §5, `auth.user` stays `undefined` for the anonymous branch; the audience does NOT fabricate a `'Viewer'` row.
- **No new i18n key.** The `<LoginButton>` uses `auth.login.button` (existing). No `audience.signIn.*` key added. No catalog drift, no review-file updates.
- **No reads of `auth.error`.** The shell's auth surface exposes an `error?` slot for transient `/api/auth/me` failures; the audience does not branch on it (a brief auth-fetch failure resolves to `'unauthenticated'` at the host's `AuthProvider`, which the audience already handles). Avoiding the `error` read keeps the audience strictly read-from-status.
- **No logout affordance.** `auth.logout()` is exported by the shell and consumed by the moderator's logout button + the root's logout chrome; the audience does NOT render a logout button (broadcast-clean aesthetic + the rare authenticated visitor can use the moderator/root logout if needed). See Decision §1.
- **No reads of `auth.user.userId`.** The audience does not need a user id in this leaf; if a future leaf needs one (e.g. for an audience-side "you are also a participant in this session; switch to the participant view" affordance), that's that leaf's scope.
- **No server-side change.** No new HTTP route, no new WS handler, no privacy-flag wire.
- **No `requiredAuthLevel` meta change.** The audience continues to declare `'public'`; the host's surface-level gate is unchanged.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) — modified. The `<PlaceholderRoute>` adds the `useAuth()` consumption and the conditional `<LoginButton>` child. The exhaustive `switch (status)` over `AuthStatus` lives inside a small helper component (`AnonymousChrome` or inline) — either shape acceptable; the Implementer picks. Approximately +30/-2 LOC.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. One assertion added to the existing authenticated case; two new cases appended. Approximately +90 LOC.
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — comment-only modification. The inline doc-comment at lines 24-34 currently says the audience "only consumes useAuth() from shell to auth-gate private-session viewer pages" *(forward-looking)*; the wording becomes "the audience now consumes `useAuth()` inside its `<App>` and renders a `<LoginButton>` chrome for anonymous visitors so private-session viewers can sign in; per-session subscribe-rejection-aware messaging lives downstream in `aud_url_routing.aud_session_url`." 2-3 line wording change, no behavior.
- [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) — modified. Two assertions added across the two existing scenarios (authenticated → `audience-sign-in` NOT visible; anonymous → `audience-sign-in` visible + `href="/api/auth/login"`). Approximately +15 LOC.

### Files this task does NOT touch

- `apps/audience/src/main.tsx` — the entrypoint provider tree is unchanged; only the doc-comment.
- `packages/shell/src/` — no shell change. The `<LoginButton>`, `useAuth()`, `AuthValueProvider`, and `AuthContextValue` shape are all consumed as-is.
- `packages/i18n-catalogs/` — no new i18n keys; the existing `auth.login.button` key carries the LoginButton label across all three locales. No `audience.signIn.*` namespace.
- `apps/root/` — no host change. The host's `SurfaceHost` continues to apply `requiredAuthLevel: 'public'` gating and hands the same `AuthContextValue` through.
- `apps/server/` — no server change.
- `apps/moderator/`, `apps/participant/`, `apps/replay-test/` — none touched; no surface-roster change.
- `playwright.config.ts` — no project change; the `chromium-audience-skeleton` project's two existing scenarios carry the assertion delta inline.
- `apps/audience/package.json` / `apps/audience/vite.config.ts` / `apps/audience/tsconfig.json` — no new runtime or dev dependency; `@a-conversa/shell` is already pinned.
- `docs/adr/` — no new ADR (every decision below is a direct application of ADRs 0026 / 0022 / 0002 / 0029 / 0013; see Decision §8).
- `.tji` files — `complete 100` for this leaf lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md); no new follow-up tech-debt leaf is registered in this leaf (the downstream contextual-messaging work lives inside the already-existing `aud_url_routing.aud_session_url` task per Decision §6).

### `<PlaceholderRoute>` modified shape (sketch)

The existing component (currently 8 lines) grows the chrome:

```tsx
import { useAuth, LoginButton } from '@a-conversa/shell';

function AnonymousChrome(): ReactElement {
  // Tiny bottom-aligned affordance. Intentionally minimal — no
  // descriptive copy, no per-session messaging. The contextual
  // "this session is private; sign in to view" wording lives in
  // `aud_url_routing.aud_session_url` (downstream).
  return (
    <div data-testid="audience-sign-in" className="mt-6 text-sm text-slate-500">
      <LoginButton className="underline underline-offset-2" />
    </div>
  );
}

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  const { status, user } = useAuth();

  // Exhaustive `switch (status)` — a future addition to the
  // `AuthStatus` union triggers a compile error here, forcing the
  // audience surface to acknowledge the new state.
  let chrome: ReactElement | null = null;
  switch (status) {
    case 'authenticated':
      // Defensive guard: in the narrow window between a host-level
      // `auth.refresh()` flipping the value out of `'authenticated'`
      // and React re-rendering the surface with the new value,
      // `user` can be `undefined` while `status` is still
      // `'authenticated'`. Mirrors `part_auth_flow.md`'s
      // `participant-not-authenticated` fallback. The audience
      // degrades to the LoginButton chrome on this signal.
      chrome = user === undefined ? <AnonymousChrome /> : null;
      break;
    case 'unauthenticated':
    case 'needs-screen-name':
      chrome = <AnonymousChrome />;
      break;
    case 'loading':
      chrome = null;
      break;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }

  return (
    <main data-testid="route-audience-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('audience.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('audience.placeholder.body')}</p>
      {chrome}
    </main>
  );
}
```

The chrome is rendered as a child of the existing `<main>` so the layout container, the locale handling, and the existing testid all flow through unchanged.

### Vitest cases (`apps/audience/src/mount.test.tsx`)

Three cases total (the existing one grows; two new are appended):

1. **`mounts the audience route tree under the provided basename and returns an unmount fn`** *(existing, grows one assertion)* — current assertions preserved (placeholder testid, store writes-through, container clears on unmount). New assertion: `screen.queryByTestId('audience-sign-in')` returns `null` for the `'authenticated' + user populated` input. Pins the "no chrome for authenticated" branch.
2. **`mounts the audience for an unauthenticated visitor and renders the sign-in chrome`** *(new)* — `auth = { status: 'unauthenticated', user: undefined, refresh: noop, logout: noop }`; renders the surface; asserts `route-audience-placeholder` visible AND `audience-sign-in` visible AND the chrome contains an `<a>` whose `href` is `/api/auth/login`. Pins the unauthenticated branch end-to-end (placeholder + chrome co-exist; chrome is the shell's LoginButton; href matches ADR 0002's contract).
3. **`renders the sign-in chrome when auth.user is undefined under status='authenticated' (mid-mount flip)`** *(new)* — `auth = { status: 'authenticated', user: undefined, refresh: noop, logout: noop }`; asserts `audience-sign-in` visible. Pins the defensive narrow against the host's mid-mount status-flip race documented in `part_auth_flow.md` Decision §A.

A fourth case (`'needs-screen-name'` renders the chrome) is OPTIONAL — the branch is small enough that it can co-share case 2's assertion (the Implementer adds it if the test layout is clean; otherwise the `switch` exhaustiveness check + the case-2 pin together cover the branch by structural argument). Decision §4 settles this.

### Playwright assertions (`tests/e2e/audience-skeleton-smoke.spec.ts`)

The two existing scenarios each grow one assertion:

- **`authenticated user hits /a/sessions/<uuid> and sees the audience placeholder render`** (lines 44-66): after the existing `route-audience-placeholder` + `'Audience surface'` h1 assertions, append: `await expect(page.getByTestId('audience-sign-in')).toHaveCount(0);` — pins that the LoginButton chrome is NOT rendered for authenticated visitors.
- **`anonymous browser hits /a/sessions/<uuid> and sees the placeholder without bouncing to /login`** (lines 84-100): after the existing `route-audience-placeholder` + URL-pin assertions, append: `const signIn = page.getByTestId('audience-sign-in'); await expect(signIn).toBeVisible(); await expect(signIn.locator('a')).toHaveAttribute('href', '/api/auth/login');` — pins that the chrome IS rendered and its inner `<a>` points at the OIDC login endpoint.

The OIDC handshake itself is NOT exercised (clicking the link would drive the visitor through Authelia and back; that's the `setup-auth` project's job and is covered by every `chromium-*-skeleton` scenario that uses the storage state). The Playwright assertion pins the affordance's PRESENCE + HREF, not its end-to-end behavior.

Per the test-output handling rule in `ORCHESTRATOR.md`, the Playwright run is redirected to a log file and inspected via an Explore sub-agent.

### Cucumber surface

**No Cucumber scenario in this leaf.** This is a UI-only change with no new wire format, no new broadcast shape, no new projector output. The server's WS subscribe behaviour for anonymous + private sessions is already pinned by `aud_anonymous_ws_subscribe.md`'s three Cucumber scenarios at [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature). This leaf adds zero wire interaction.

### UI-stream e2e policy disposition

**E2e is in scope; the existing Playwright spec carries the assertions inline.** Per ORCHESTRATOR.md's UI-stream e2e policy, the audience surface IS reachable from a root route + the new chrome IS a user-observable behaviour; a Playwright pin is required. The deferred-e2e exception does NOT apply (the affordance is rendered in the placeholder route; no future "wiring" leaf is needed to make it reachable).

The Playwright assertion target is the `audience-sign-in` testid + its inner `<a>` `href`. The OIDC handshake itself stays out of scope (already covered by `setup-auth`).

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Two tiers pinning different observable properties:

1. **Vitest `mount.test.tsx` cases** — pin the in-surface `<App>` + `<PlaceholderRoute>` branching logic in isolation. Catches regressions like "someone deleted the `useAuth()` call and the chrome stopped rendering for anonymous viewers" without needing a full Playwright run.
2. **Playwright assertions in the existing audience-skeleton spec** — pin the end-to-end flow: an unauthenticated browser navigates to the canonical audience URL, the root host's `requiredAuthLevel: 'public'` gate skips deflection, the audience surface mounts, the placeholder + the `audience-sign-in` chrome both render, and the chrome's inner `<a>` points at `/api/auth/login`. The existing authenticated scenario pins the no-chrome path.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new `useAuth()` consumption in `App.tsx`, the exhaustive `switch (status)`, the new Vitest cases, and the augmented Playwright assertions all typecheck under strict mode. The `switch` is exhaustive over `AuthStatus`; an unhandled branch is a compile error per ADR 0013.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+2** (the two new `mount.test.tsx` cases). No existing smoke case regresses.
3. **`pnpm run test:e2e`** (under `make up`) runs the modified `tests/e2e/audience-skeleton-smoke.spec.ts` with both scenarios green:
   - The authenticated scenario keeps passing (`route-audience-placeholder` + `audience-sign-in` absent).
   - The anonymous scenario keeps passing (`route-audience-placeholder` + `audience-sign-in` visible + `href="/api/auth/login"`).
4. **`pnpm -F @a-conversa/audience build`** green. The audience workspace's library-mode bundle includes the `useAuth()` + `<LoginButton>` references resolved through `@a-conversa/shell`'s barrel; tree-shaking does not eliminate them.
5. **`pnpm -F @aconversa/root build`** + **`pnpm -F @a-conversa/moderator build`** + **`pnpm -F @a-conversa/participant build`** all green. The audience-side change does not break peer surfaces.
6. **Failing-first verifiability** — temporarily reverting the `<LoginButton>` rendering inside `AnonymousChrome` (so the chrome is empty) MUST make at least the new Playwright assertion `await expect(signIn.locator('a')).toHaveAttribute('href', '/api/auth/login');` fail. Independently, temporarily forcing the `switch` to never render `<AnonymousChrome />` MUST make the new Vitest case "mounts the audience for an unauthenticated visitor and renders the sign-in chrome" fail. The Implementer confirms both reversions in their verification log before re-applying. Pins ADR 0022's regression-pin property at two distinct loci.
7. **No file modifications outside the explicit allowlist** in "Files this task touches."
8. **No regression of the existing audience smoke pin** — `audience.placeholder.title` / `audience.placeholder.body` text still resolve in en-US, pt-BR, and es-419 (the catalog parity layer continues to pin this).
9. **No regression of the host-level gate** — the existing authenticated scenarios in `tests/e2e/i18n-moderator-smoke.spec.ts` / `tests/e2e/participant-skeleton-smoke.spec.ts` continue to pass (the moderator + participant surfaces still declare `requiredAuthLevel: 'authenticated'` and the host's deflection is preserved).
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf's task block. The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
11. **No new i18n key audit drift** — `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json` have no new `pending` entries from this leaf (the only key the leaf consumes, `auth.login.button`, already ships in all three locales).
12. **No new ADR is committed** by this leaf (Decision §8). The pre-commit hook's `docs/adr/` check stays green without a new entry.

## Decisions

### 1. No "Signed in as <screenName>" identity chip for authenticated visitors (broadcast-clean aesthetic)

The participant's `part_auth_flow` rendered a `participant-identity` chip ("Signed in as <screenName>") inside its placeholder. The moderator's `mod_auth_flow` similarly surfaces the screenName in the operate-view header. **The audience does neither.** Three alternatives surveyed:

- **(A) Mirror participant** — render `data-testid="audience-identity"` with `Signed in as <screenName>` for `auth.status === 'authenticated'`. Rejected. The audience's whole purpose is broadcast-quality embed in OBS; the OBS use case is anonymous-on-public-sessions (the OBS browser source has no cookie). The authenticated branch is rare — it's the moderator/producer double-checking the broadcast view. Rendering identity chrome for them clutters the broadcast aesthetic without serving a real need; the moderator can confirm "who am I" in the moderator console (their canonical surface), not in the audience view.
- **(B) Render an identity chip ONLY when authenticated AND `?identity=on` query param present** — opt-in identity. Rejected. New query-param contract, new tests, new opt-in semantic — overengineered for a single rare branch.
- **(C) Render no identity chrome for authenticated; render LoginButton chrome for anonymous only** *(chosen)*. Minimum-blast-radius. The authenticated path is identical to the pre-leaf shape (no DOM delta); the anonymous path gets the affordance that closes the private-session-sign-in gap. The chrome is asymmetric, but the asymmetry matches the use cases: authenticated visitors don't need a sign-in CTA, anonymous visitors do.

### 2. `<LoginButton>` chrome lives inside the `<main>` placeholder, not floated absolutely

Three alternatives surveyed:

- **(A) Float the chrome top-right via `position: absolute`** — fixed corner placement, doesn't share layout with the placeholder content. Rejected. When `aud_cytoscape_init` lands, the graph viewport will fill the `<main>` container; a floating chrome would overlap the viewport. Placing the chrome inside the existing `<main>` lets the future `aud_cytoscape_init` layout decision absorb / position / hide the chrome naturally inside the same layout container.
- **(B) Render the chrome above the placeholder (before the `<h1>`)** — banner-style. Rejected. Pushes the placeholder text down; visually inverts the "main content first, chrome second" reading order.
- **(C) Render the chrome below the placeholder copy** *(chosen)*. The placeholder `<h1>` + `<p>` render at their existing position; the chrome appears below with `mt-6` spacing — small, secondary, clearly an affordance and not the main content. When the graph viewer lands, the chrome's position naturally moves below the graph (or `aud_cytoscape_init` decides to hide it via the layout — that's downstream's scope).

### 3. No per-route `<RequireAuth>` wrapper inside the audience

The moderator landed `<RequireAuth>` ([`apps/moderator/src/auth/RequireAuth.tsx`](../../../apps/moderator/src/auth/RequireAuth.tsx)) as a route-level gate that branches on `AuthStatus` and `<Navigate>`s. The audience does NOT. Two alternatives surveyed:

- **(A) Mirror the moderator** — add an `audience/src/RequireAuth.tsx` or similar that gates a future `<Route path="/sessions/:id" element={<RequireAuth><AudienceSessionView /></RequireAuth>}>`. Rejected for THIS leaf. The audience has one wildcard route today and the host's surface-level gate already discriminates `'public'` (always mount) from `'authenticated'` (deflect). Replicating `RequireAuth` inside the audience adds parallel logic with no caller; if `aud_url_routing.aud_session_url` lands route-level gating later, the wrapper is its scope, not this leaf's.
- **(B) Inline the switch inside `<PlaceholderRoute>`** *(chosen)*. The audience's only route consumes `useAuth()` directly and branches the **chrome rendering**, not the **route rendering**. The placeholder testid stays the outer wrapper regardless of auth state — anonymous and authenticated visitors both see the placeholder; only the chrome differs. This matches the audience's "we accept any visitor" contract — the audience surface never `<Navigate>`s the visitor away based on auth state; instead it provides an in-place affordance to upgrade.

### 4. The `'needs-screen-name'` branch shares the unauthenticated chrome (no dedicated affordance)

Three alternatives surveyed:

- **(A) Treat `'needs-screen-name'` as `'authenticated'`** (no chrome) — the user has a session, just hasn't picked a name. Rejected. The visitor at the audience URL might want to sign back out / re-authenticate, and rendering no chrome leaves them with no audience-side affordance. The screen-name form lives at the root; deflecting to it requires `<Navigate to="/screen-name">` which contradicts Decision §3.
- **(B) Treat `'needs-screen-name'` as `'unauthenticated'`** (render LoginButton) *(chosen)*. The LoginButton's `<a href="/api/auth/login">` triggers a re-handshake which (per the existing OIDC redirect machinery) eventually lands the visitor on `/screen-name` if they're still in the needs-screen-name state. The flow is slightly indirect but uses only existing seams.
- **(C) Render a dedicated `audience-screen-name-cta`** with text "Finish signing in" pointing at `/screen-name`. Rejected. New i18n key, new testid, new branch — and the user reaching this state in the audience surface is exceptionally rare (it requires bouncing from `/screen-name` mid-flow to `/a/sessions/<uuid>`, which the root's `rememberReturnTo` machinery doesn't normally permit).

The `switch` therefore collapses `'unauthenticated'` and `'needs-screen-name'` into the same `<AnonymousChrome />` render. Vitest case 2 covers the `'unauthenticated'` branch; the `'needs-screen-name'` branch is covered by the exhaustive-`switch` structural argument (a regression deleting the case label triggers a compile error) plus an optional fourth Vitest case if the Implementer prefers explicit coverage.

### 5. The defensive `auth.user === undefined` under `'authenticated'` degrades to the chrome (not to a panel)

The participant's `part_auth_flow` rendered a `participant-not-authenticated` panel for this mid-mount flip. The audience does NOT — it degrades to the same `<AnonymousChrome />` the unauthenticated branch uses. Two alternatives surveyed:

- **(A) Render a dedicated `audience-not-authenticated` panel** with text "You appear to have signed out." Rejected. New i18n key (would need three locales + review files), new testid, and the panel duplicates the chrome's function (offer a way to sign back in).
- **(B) Render the same `<AnonymousChrome />`** *(chosen)*. The chrome already offers a sign-in path; degrading to it is the smallest possible response. The mid-mount flip is rare and transient; a more elaborate panel would surface visual noise for a state that resolves within a paint or two.

### 6. Per-session "this is a private session; sign in to view" contextual wording is deferred to `aud_url_routing.aud_session_url`

This leaf installs a static `<LoginButton>` chrome that is rendered identically for every anonymous visit, regardless of whether the underlying session is private (the surface can't tell — the existence-non-leak rule applies). The contextual messaging — *"this URL points at a session you can't see; if it's a private session you have access to, signing in may help"* — requires the surface to *attempt* a subscribe and *react* to the `not-found` rejection. The subscribe call is downstream's scope:

- `aud_url_routing.aud_session_url` (1d, depends `!aud_shell`) is the leaf that lands per-session routing + the `useWsClient().trackSession(sessionId)` call. Its scope will include the rejection-aware contextual wording (e.g. expanding the `audience-sign-in` chrome with a `<p>` of explanatory copy when an anonymous subscribe failed with `not-found`, while leaving the chrome unmodified for the OBS-embed public-session happy path where the subscribe succeeds and no rejection ever fires).
- This leaf's chrome is the **transport** for that future contextual flow. Installing it now means `aud_session_url` only needs to add the contextual `<p>` + the subscribe-rejection state, not the underlying affordance.

No new WBS task is registered for the contextual wording — `aud_url_routing.aud_session_url` already exists at [`tasks/50-audience-and-broadcast.tji:207-210`](../../50-audience-and-broadcast.tji#L207) with a 1d estimate; the refinement-writer for that task will scope the contextual messaging when its turn comes. This leaf's Status block will note the inherited hand-off so the next refinement-writer reads it.

### 7. No OBS-embed chrome suppression in this leaf

A producer embedding the audience surface in an OBS browser source for a public session is anonymous by construction (no cookie). They would see the `<LoginButton>` chrome at the bottom of the placeholder until the live event stream arrives (which today is never, because `aud_cytoscape_init` hasn't landed; eventually it will be "until the graph renders and visually dominates"). Two alternatives surveyed:

- **(A) Suppress the chrome under a `?chrome=off` query param** so OBS-embed URLs (`/a/sessions/<uuid>?chrome=off`) hide the affordance. Rejected for this leaf. New query-param contract, new test, new degradation rule — and the chrome is small enough (one underlined link below a placeholder paragraph) that an OBS embed at 1080p tolerates it without visual harm. If a producer surfaces a real complaint after `aud_cytoscape_init` lands, a sibling task `aud_obs_chrome_suppression` (0.25d, depends `!aud_auth_for_private`) lands the suppression — but that's speculative tech-debt today and is NOT registered in the WBS at this leaf's close.
- **(B) Render the chrome unconditionally** *(chosen)*. Smallest blast radius; the chrome's aesthetic cost is bounded. Future suppression is feasible without re-architecting the chrome (CSS-only via `?chrome=off` or `data-attribute`).

### 8. No new ADR

This task introduces no architectural choices that go beyond existing precedents:

- The `useAuth()` consumption pattern is a direct application of ADR 0026 Decision 3 (surface consumes auth from host) + `shell_substrate_extraction`'s shipped pattern.
- The `<LoginButton>` reuse is a direct application of ADR 0026 Consequences §1 (shell single-sources auth chrome) + ADR 0002 (cookie-only auth, full-page redirect for OIDC).
- The exhaustive `switch (status)` discipline is a direct application of ADR 0013 (TypeScript strict).
- The Playwright + Vitest regression-pin pair is a direct application of ADR 0022.
- The "anonymous-on-private → `not-found`" wire contract this leaf's chrome is downstream of is settled by ADR 0029; this leaf does not interact with the wire seam.

The "no new dependencies" rule is satisfied (no new runtime dep, no new dev dep). No ADR is triggered.

### 9. Tech-debt registration

- **No new WBS leaf is registered by this task.** The per-session contextual-messaging hand-off (Decision §6) lives inside the already-existing `aud_url_routing.aud_session_url` task; its refinement-writer reads this leaf's Status block to inherit the affordance. The future OBS-embed suppression (Decision §7) is speculative and is NOT registered until a real producer complaint surfaces.
- **No deferred-e2e debt.** This leaf's Playwright assertions (extensions to the two existing scenarios in `audience-skeleton-smoke.spec.ts`) ARE the e2e pins; no `aud_pw_*` catch-all task inherits coverage from this leaf.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/App.tsx` (+49/-2): `<PlaceholderRoute>` now calls `useAuth()` once; an exhaustive `switch (status)` over all four `AuthStatus` branches renders `<AnonymousChrome>` (which wraps `<LoginButton>` under `data-testid="audience-sign-in"`) for `unauthenticated`, `needs-screen-name`, and the defensive `authenticated + user === undefined` mid-mount flip; `authenticated` with a populated user renders no chrome.
- `apps/audience/src/mount.test.tsx` (+93): existing authenticated case gained a negative `audience-sign-in` assertion; two new Vitest cases added — `mounts the audience for an unauthenticated visitor and renders the sign-in chrome` and `renders the sign-in chrome when auth.user is undefined under status="authenticated" (mid-mount flip)`.
- `apps/audience/src/main.tsx` (+4/-2): comment-only update — inline doc-comment updated to reflect that `useAuth()` is now consumed inside `<App>` and that per-session subscribe-rejection-aware messaging lives downstream in `aud_url_routing.aud_session_url`.
- `tests/e2e/audience-skeleton-smoke.spec.ts` (+17): authenticated scenario asserts `audience-sign-in` count is 0; anonymous scenario asserts `audience-sign-in` is visible and inner `<a>` href is `/api/auth/login`.
- No new package dependency, no new i18n key, no server-side change, no new ADR.
- Per Decision §9, no tech-debt WBS leaf registered — the per-session contextual-messaging hand-off lives inside the already-existing `aud_url_routing.aud_session_url` task.
