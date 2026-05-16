# Landscape-orientation tablet layout

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_landscape_layout`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_shell.part_app_skeleton` (settled — the participant workspace builds as a Vite library bundle exporting `MountFn`/`SurfaceModule`; `apps/participant/src/main.tsx` wraps the surface tree in `<I18nProvider>` + `<AuthValueProvider>` + `<BrowserRouter basename={props.routerBasePath}>`; the placeholder `<App>` mounts under a single `<Route path="*">`; see [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx) and the refinement at [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L168)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_auth_flow` (settled — `useAuth()` is the canonical seam for surfacing the host-supplied `screenName`; the existing placeholder already renders `participant-identity`. This task moves identity into the shell's chrome region rather than as inline body copy, but preserves the consumption shape; see [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md#L103-L146)).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_layout.mod_layout_shell` (settled — the moderator's three-pane scaffold at [`apps/moderator/src/layout/OperateLayout.tsx`](../../../apps/moderator/src/layout/OperateLayout.tsx) is the canonical precedent for "structural shell with named region testids + render-prop slots." The participant shell mirrors the *shape* of that precedent — CSS Grid, named regions, stable testids, content-free slot props — even though the participant geometry is different; see [`tasks/refinements/moderator-ui/mod_layout_shell.md`](../moderator-ui/mod_layout_shell.md)).
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — `useAuth()`, the `AuthContextValue`/`AuthUser` types, and the i18n bridge all live in `@a-conversa/shell`; this task consumes them unchanged).

## What this task is

The persistent, landscape-oriented structural shell that the rest of the participant surface plugs into. After this leaf:

- A new `<ParticipantLayout>` component under `apps/participant/src/layout/ParticipantLayout.tsx` owns the chrome geometry (a slim header on top + a main content region below + a slim footer/status region at the bottom) and exposes four named-region testids (`participant-layout-root`, `participant-header`, `participant-main`, `participant-footer`) so downstream leaves can target them with Vitest + Playwright.
- The layout takes three render-prop slots — `header`, `main`, `footer` — mirroring the moderator's `OperateLayout` shape; downstream leaves (`part_status_indicator`, `part_session_join.part_invite_acceptance`, `part_session_join.part_lobby_view`, `part_graph_view`) compose by passing children into the matching slot rather than reaching into the layout's internals.
- The header carries the single piece of chrome this leaf actually paints: a left-aligned product label ("A Conversa — Participant") and a right-aligned identity row reading `useAuth()` and surfacing `participant-identity` with the host-supplied `screenName`. The identity row moves up here from the placeholder body so it persists across every participant URL once downstream leaves replace the wildcard route's body.
- The `main` region is the router-outlet-shaped slot; the current placeholder route's body (the "Participant surface" title + "Loading…" caption) is rebound into it so the existing `part_app_skeleton` + `part_auth_flow` testids (`route-participant-placeholder`, `participant-identity`, `participant-not-authenticated`) keep their current Playwright + Vitest assertions passing, just inside the new chrome.
- The `footer` region is the named slot reserved for `part_status_indicator`'s persistent role + screen-name + pending-count chip. This task lands an *empty* footer (the slot accepts children but receives none today); `part_status_indicator` plugs the chip into the same slot in its own commit.
- Tailwind classes pin the landscape-tablet geometry: the layout fills the viewport (`h-screen w-screen`) with CSS Grid (`grid-template-rows: 'auto 1fr auto'`); the layout reads naturally at a tablet-landscape width (≥ 1024 px) without breaking at narrower breakpoints; touch-target sizing assumptions (~48 px header + footer rows, matching `part_status_indicator`'s declared 48 px height) bake in.

Out of scope (deferred to existing or future leaves):

- **Not the full design system.** No new design tokens, no per-facet color palette, no typography scale beyond Tailwind defaults; `packages/ui-tokens` is still deferred per ADR 0005's Consequences and the moderator's `mod_layout_shell` followed the same "no tokens yet" path (see [`tasks/refinements/moderator-ui/mod_layout_shell.md`](../moderator-ui/mod_layout_shell.md#L46-L51)). Inline pixel values (`h-12` for the header, `h-12` for the footer) are placeholders; downstream leaves (or the eventual tokens package) swap them.
- **Not the status indicator content.** The footer slot exists; the chip that fills it is `part_status_indicator`'s deliverable (role badge + screen name + pending vote count + optional connection-status indicator; see [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md)). This task does not write the chip and does not subscribe to `useUiStore` for the badge count (no `useUiStore` exists yet — `part_state_management` lands it).
- **Not the lobby view, the graph view, the voting strip, or the invite-acceptance flow.** Each of those leaves replaces the `main` slot's body with its own route tree when it lands. The wildcard route from `part_app_skeleton` stays in place so the existing Playwright pins keep firing; downstream leaves swap the route shape when they need a real path grammar.
- **Not portrait orientation.** The layout reads OK at narrower breakpoints (no `min-width` blocker, no media-query gate) but the geometry is tuned for landscape per `docs/participant-ui.md`'s "V1 defaults (resolved) — tablet form factor and orientation — landscape". Portrait-specific tweaks (e.g. tab-stacked nav) are out of scope; if a future P-something feature demands portrait support, that leaf decides the geometry.
- **Not the four-state `AuthStatus` gate.** The `<PlaceholderRoute>` from `part_auth_flow` already handles the `auth.status !== 'authenticated'` branch inside `main`'s body; the chrome header's identity row uses the same `useAuth()` consumption shape but renders empty (no `participant-identity` element) when unauth'd. The "not authenticated" body panel stays inside the route body where it is, not the chrome.
- **Not an i18n surface for the document `<title>` element**, route titles, or document-level metadata. The product label in the chrome ("A Conversa — Participant" or similar) is one i18n key; document-`<title>` management is the root host's concern when it lands (`apps/root/` already manages the host's page title).
- **Not a layout context.** The composition surface is render-prop slots only (`<ParticipantLayout header={...} main={...} footer={...} />`), mirroring `OperateLayout`'s contract. Decision §5 explains why no `LayoutContext`/`useLayoutSlots` API is introduced.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a human drives `moderator → invite → debater login → lobby`. After the just-landed `part_auth_flow` (commit `3e6b928`) the chain a real debater hits is:

1. Debater clicks the moderator-emitted invite URL `https://app/p/sessions/<uuid>/invite?role=debater-A`.
2. Root host's `/p/*` route renders `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`. The host gates on `auth.status` (per `apps/root/src/surfaces/SurfaceHost.tsx`), bouncing to `/login` or `/screen-name` if needed.
3. With `auth.status === 'authenticated'`, the host calls `surface.mount({ container, auth, i18n, routerBasePath: '/p' })`. The participant's `main.tsx` wraps the React tree in `<I18nProvider><AuthValueProvider value={props.auth}><BrowserRouter basename={props.routerBasePath}><App /></BrowserRouter></AuthValueProvider></I18nProvider>`.
4. **Today**: `<App>` renders a single wildcard route whose body is the `<PlaceholderRoute>` — a `<main>` with the placeholder title, the "Loading…" caption, and the `participant-identity` row. There is no chrome around the body; the page has no header, no footer, no persistent identity affordance, no slot for the status chip, no slot the lobby view can plug into.
5. **After this leaf**: the wildcard route's body wraps inside `<ParticipantLayout>` — a landscape-grid scaffold with `participant-header` (carrying the product label + identity row), `participant-main` (the route body), and `participant-footer` (the empty status-chip slot). Every URL the debater hits from this point forward — the placeholder, then the invite-acceptance flow (`part_session_join.part_invite_acceptance`), then the lobby (`part_session_join.part_lobby_view`), then the operate view (downstream graph + voting leaves) — renders inside the same chrome.

Downstream concretely:

- **`part_status_indicator`** — plugs its role + screen-name + pending-count chip into the `footer` slot. The chip lands as the layout's `footer={<StatusIndicator />}` prop; the layout itself does not change. The 48 px footer-row geometry this task settles is the height budget the chip is sized for.
- **`part_session_join.part_invite_acceptance`** — replaces the wildcard route's body with the invite-claim flow. The chrome (header + footer) stays around it; the user sees "A Conversa — Participant" / `<screenName>` in the header throughout the claim flow.
- **`part_session_join.part_lobby_view`** — same shape; the lobby renders into `main` while the chrome persists.
- **`part_graph_view` + `part_voting`** — the operate view replaces `main`'s body with the graph canvas + voting strip; the layout's grid keeps the graph viewport stable (it gets `1fr` of the row stack, not the full viewport, so the graph honors the chrome above + below).

Architecturally, this leaf is the **structural validation that the moderator's `mod_layout_shell` pattern generalizes** — the same "CSS Grid + named regions + render-prop slots + stable testids + structure-only (no business logic)" recipe works for a different surface with a different geometry. The recipe will repeat for the audience surface; codifying it twice (moderator + participant) makes it a pattern, not a one-off.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md#L19-L20) — "All participants — both debaters and the moderator — must agree on every change to the graph before it lands." The participant tablet is the surface debaters use to express that agreement.
- [docs/participant-ui.md](../../../docs/participant-ui.md#L21-L31) — the participant UI sketch. The two primary regions are graph view + pending proposals pane plus a persistent status indicator. "Specific layout (split vs. tabbed, landscape vs. portrait) defers to UI prototyping" — but the V1 defaults section at [`docs/participant-ui.md` lines 130-138](../../../docs/participant-ui.md#L130-L138) settles "tablet form factor and orientation — landscape." This leaf honors the landscape default; the split-vs-tabbed decision lands when the actual graph + voting leaves wire their content into `main`.
- [docs/participant-ui.md — status indicator](../../../docs/participant-ui.md#L25-L31) — "A persistent status indicator shows the debater's role (debater A or debater B), screen name, and a small count of facets awaiting their vote." This leaf owns the *slot* the indicator goes into; `part_status_indicator` owns the chip.
- [ADR 0005 — Tailwind CSS with shared design tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — Tailwind is the styling system; `packages/ui-tokens` is deferred (no workspace yet). The moderator's `mod_layout_shell` carried the same "no tokens yet" path forward (inline `20rem` sidebar width, `6rem` strip height as Tailwind arbitrary values); the participant shell takes the same approach (inline `h-12` header + footer rows).
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest layout-shape cases + the extended Playwright scenarios below are the regression pins; no manual "I resized the window and it looked OK" smoke.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L48-L75) — Decision 1 fixes the URL prefix (`/p/*` → participant); Decision 3 fixes that the surface owns its mounted region only (the root owns the document-`<title>` and the top-of-page chrome); this leaf's "header" is the surface's *internal* top-of-region chrome, not the document chrome. The two coexist: the root has no visible top-of-window chrome inside a mounted surface (the host renders only the `<SurfaceHost>` outlet inside `/p/*`), so the participant's `participant-header` is the only visible top bar at any participant URL.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md) — the bootstrap layer. The shell-provider stack and the wildcard route this leaf builds inside. Decision §2 of that refinement (one wildcard route) explicitly handed off the layout choice to this leaf; the route stays a wildcard, but its body now mounts inside a layout component.
- [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md#L103-L146) — the auth-consumption pattern this leaf mirrors. The header's identity row uses the same `useAuth()` consumption, the same `auth.status !== 'authenticated' || auth.user === undefined` guard shape, and the same `participant-identity` stable testid; the body's `participant-not-authenticated` panel from `part_auth_flow` is not migrated up (it is route-body content, not chrome).
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md) — the consumer of this leaf's `footer` slot. Acceptance §1 of that refinement ("Indicator visible on every participant route") is unblocked by this leaf's persistent footer region — the chip lands once the layout owns the slot.
- [`tasks/refinements/moderator-ui/mod_layout_shell.md`](../moderator-ui/mod_layout_shell.md) — the canonical pattern this leaf mirrors. What carries over verbatim: render-prop slots (named children for each region), stable testid discipline, CSS Grid over Flexbox, viewport-filling (`h-screen w-screen`), per-region overflow containment, structure-only (no store reads inside the layout), inline pixel values where tokens are deferred. What is intentionally different: the participant geometry is row-stacked (header / main / footer) rather than the moderator's two-row-two-column grid (graph + sidebar / strip), reflecting the different surface (participant tablet is content-heavy with thin chrome; moderator is a multi-pane console).
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md#L20-L31) — the `useAuth()` contract the header consumes. No change to the substrate.

### Live code the surface plugs into

- [`apps/participant/src/App.tsx:1-84`](../../../apps/participant/src/App.tsx#L1) — the placeholder route tree. After this leaf:
  - `<App>` still mounts a single `<Route path="*" element={<PlaceholderRoute />} />`.
  - The `<PlaceholderRoute>` no longer renders a bare `<main>`. It returns `<ParticipantLayout header={<ParticipantChrome />} main={<PlaceholderRouteBody />} footer={null} />`.
  - `<PlaceholderRouteBody>` is the existing body content (the placeholder title, body caption, identity row, and the not-authenticated guard branch) extracted into a sibling component so the layout/body separation is structural rather than inline.
  - `<ParticipantChrome>` is a new component inside the same file that owns the header row: left-aligned product label (`participant.chrome.productLabel`) + right-aligned identity row (`useAuth()` + `participant-identity` testid + `participant.identity.signedInAs` ICU key) or empty when unauthenticated.
- [`apps/participant/src/main.tsx:33-50`](../../../apps/participant/src/main.tsx#L33) — the mount entrypoint. **Not modified** by this leaf; the provider wiring is already correct.
- [`apps/participant/src/index.css`](../../../apps/participant/src/index.css) — the Tailwind import + the `html, body, #root { height: 100%; margin: 0; }` reset. **Not modified**; the reset already gives the layout the viewport-height claim it needs.
- [`apps/moderator/src/layout/OperateLayout.tsx`](../../../apps/moderator/src/layout/OperateLayout.tsx) — the canonical precedent for the new `<ParticipantLayout>` component. The participant layout file follows the same module shape (header comment naming the refinement, exported `ParticipantLayoutProps` interface with three optional render-prop children, a single function exporting the JSX, stable `data-testid` on every region, inline grid styling via the `style` attribute for `gridTemplate*` properties since Tailwind v4 doesn't take dynamic template-area values).
- [`apps/moderator/src/layout/OperateLayout.test.tsx`](../../../apps/moderator/src/layout/OperateLayout.test.tsx) — the canonical Vitest pattern for layout-shape pins (six cases: regions render, each slot child lands in its region, layout root carries Tailwind utility classes, layout renders cleanly when slots are omitted). The participant layout's test file follows the same shape (four-region IDs vs. moderator's four; three slots vs. three; the rest identical).
- [`apps/moderator/src/routes/Operate.tsx:140-200`](../../../apps/moderator/src/routes/Operate.tsx#L140) — the canonical example of a route composing `<OperateLayout>` with per-slot children. The participant's `<PlaceholderRoute>` composes `<ParticipantLayout>` the same way.
- [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) — the existing mount-boundary case. **Extended by one assertion**: after the existing placeholder+identity assertions, also assert the four new region testids are visible (`participant-layout-root`, `participant-header`, `participant-main`, `participant-footer`). Pins that the layout wraps the placeholder route end-to-end, not just in isolation.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) — the predecessor's e2e spec. **This leaf extends it** (new test cases inside the existing first `test.describe`) rather than creating a sibling spec, following the same precedent `part_auth_flow` set: the spec's scope is "the participant skeleton renders correctly under `/p/*`" and the landscape layout is part of that contract.
- [`playwright.config.ts:303-312`](../../../playwright.config.ts#L303) — the `chromium-participant-skeleton` project. **Not modified**; the spec runs under the same project with the same fixture chain (`setup-auth` → cookie jar → `Desktop Chrome` profile at the default Playwright viewport of 1280×720, which exceeds the 1024 px landscape-tablet floor by a comfortable margin).

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json:430-445`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L430) — the `participant` namespace today has three sub-namespaces (`placeholder`, `identity`, `notAuthenticated`) with four keys total. This leaf adds one new sub-namespace (`chrome`) with one new key (`participant.chrome.productLabel`).
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json:207-210`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json#L207) — current `pending` list for pt-BR includes the four `participant.*` keys from the two predecessor leaves; this leaf appends `participant.chrome.productLabel` to the same list. es-419 review.json gets the same append.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/layout/ParticipantLayout.tsx` — NEW. The CSS-Grid landscape scaffold + four named-region testids + three render-prop slots.
- `apps/participant/src/layout/ParticipantLayout.test.tsx` — NEW. Vitest cases pinning the region IDs, slot routing, and Tailwind utility classes (mirrors `OperateLayout.test.tsx`).
- `apps/participant/src/App.tsx` — modified. The `<PlaceholderRoute>` wraps its current body in `<ParticipantLayout>` with a new `<ParticipantChrome>` in the header slot, the existing body in the main slot, and `null` in the footer. The three existing testids (`route-participant-placeholder`, `participant-identity`, `participant-not-authenticated`) stay on the body content, unchanged (except for the identity row, which migrates to the chrome — see Decision §2).
- `apps/participant/src/mount.test.tsx` — modified. Existing authenticated case grows one assertion (the four new region testids are visible). No new cases.
- `tests/e2e/participant-skeleton-smoke.spec.ts` — modified. The existing first scenario (`authenticated user hits /p/... and sees the placeholder`) grows assertions that the four region testids are visible AND that the `participant-header` contains the product label. No new scenarios; no new fixture; no change to the third `unauthenticated visit` scenario.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. One new key: `participant.chrome.productLabel` ("A Conversa — Participant" — the product name plus the surface name, matching the convention downstream leaves will follow to disambiguate surfaces in their chrome).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same key, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same key, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds `participant.chrome.productLabel` to the `pending` list.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — provider wiring already correct.
- `apps/participant/src/index.css` — Tailwind reset already in place; the layout's `h-screen` claim works with the existing reset.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep, no new build config, no new project reference. Tailwind v4 + `@tailwindcss/vite` are already wired by `part_app_skeleton`.
- `packages/shell/` — `useAuth()` consumed unchanged. No new shell surface; the layout is intentionally participant-local (Decision §7).
- `apps/root/` — host already gates `/p/*`; no change.
- `apps/server/` — no backend change.
- `apps/moderator/` / `apps/audience/` — no other surface affected.
- `playwright.config.ts` — no new Playwright project; existing `chromium-participant-skeleton` covers the extended spec.
- `.tji` files OTHER than `tasks/35-frontend-i18n.tji` — the `complete 100` marker for `part_landscape_layout` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42). The native-review chain leaf for the new i18n key lands in `tasks/35-frontend-i18n.tji` (see Tech-debt registration below).
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0005 / 0022 / 0026 or a direct mirror of the moderator's `mod_layout_shell`).

### Component shape (`apps/participant/src/layout/ParticipantLayout.tsx`)

Sketch (matches the `OperateLayout` shape line-for-line save for the geometry):

```tsx
// `<ParticipantLayout>` — landscape-oriented chrome shell for the
// participant tablet surface.
//
// Refinement: tasks/refinements/participant-ui/part_landscape_layout.md
// Design doc: docs/participant-ui.md (Layout (sketch))
//
// Geometry (CSS Grid, three row-stacked regions):
//
//     +-----------------------------------------------+
//     |             participant-header                |  <- h-12
//     +-----------------------------------------------+
//     |                                               |
//     |             participant-main                  |  <- 1fr
//     |                                               |
//     +-----------------------------------------------+
//     |             participant-footer                |  <- h-12
//     +-----------------------------------------------+
//
// The shell is structure-only: it owns the grid template, per-region
// scroll containment, and the stable `data-testid` selectors that
// downstream tasks (`part_status_indicator`,
// `part_session_join.part_invite_acceptance`,
// `part_session_join.part_lobby_view`, `part_graph_view`) target.
// Children pass in via three optional render-prop slots so callers can
// compose without the layout reaching into any store.
//
// Pixel sizing (`h-12` = 48px header + footer, matching
// `part_status_indicator`'s declared height budget) is a placeholder
// until `packages/ui-tokens` lands (deferred per ADR 0005). Mirrors the
// approach `mod_layout_shell` took.

import type { ReactElement, ReactNode } from 'react';

export interface ParticipantLayoutProps {
  /** Top chrome row — product label + identity affordance. */
  header?: ReactNode;
  /** Main content region — router-outlet-shaped slot. */
  main?: ReactNode;
  /** Bottom chrome row — reserved for `part_status_indicator`. */
  footer?: ReactNode;
}

export function ParticipantLayout(props: ParticipantLayoutProps): ReactElement {
  const { header, main, footer } = props;
  return (
    <div
      data-testid="participant-layout-root"
      className="grid h-screen w-screen bg-slate-50"
      style={{
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateAreas: '"header" "main" "footer"',
      }}
    >
      <header
        data-testid="participant-header"
        className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4"
        style={{ gridArea: 'header' }}
      >
        {header}
      </header>
      <section
        data-testid="participant-main"
        className="overflow-auto bg-white"
        style={{ gridArea: 'main' }}
      >
        {main}
      </section>
      <footer
        data-testid="participant-footer"
        className="flex h-12 items-center justify-between border-t border-slate-200 bg-slate-100 px-4"
        style={{ gridArea: 'footer' }}
      >
        {footer}
      </footer>
    </div>
  );
}
```

- `gridTemplateRows: 'auto 1fr auto'` claims the full viewport height; the header + footer take their natural height (48 px via `h-12`), and the main region absorbs the rest with `1fr`. Equivalent to a vertical Flexbox column with `flex: 1` on `main`, but expressed as Grid for parity with the moderator's pattern and so the named template areas read directly in the source.
- `h-screen w-screen` makes the layout fill the viewport; `overflow-auto` on the main region contains scrolling so the chrome never scrolls with the body.
- The header is a flex row (`flex items-center justify-between`) so the product label naturally sits left and the identity row naturally sits right. The footer is the same shape, ready for `part_status_indicator`'s left-aligned chip + right-aligned pending-count badge.
- `bg-white` on the header + main, `bg-slate-100` on the footer, `bg-slate-50` on the root: a quiet light palette consistent with the moderator's `OperateLayout`. No tokens yet (deferred per ADR 0005); the eventual tokens package or a follow-up themes the chrome.
- The component is structure-only — no `useAuth()`, no `useTranslation()`, no store subscriptions. The chrome's content (product label, identity row) lives in the caller (`<ParticipantChrome>` inside `App.tsx`).

### `<ParticipantChrome>` shape (inside `apps/participant/src/App.tsx`)

```tsx
function ParticipantChrome(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  return (
    <>
      <span className="text-sm font-semibold text-slate-800">
        {t('participant.chrome.productLabel')}
      </span>
      {auth.status === 'authenticated' && auth.user !== undefined ? (
        <span
          data-testid="participant-identity"
          className="text-sm text-slate-700"
        >
          {t('participant.identity.signedInAs', { name: auth.user.screenName })}
        </span>
      ) : null}
    </>
  );
}
```

- Mirrors the `part_auth_flow` `useAuth()` consumption shape exactly (status switch first, then `.user !== undefined` belt-and-suspenders, then `.screenName` access). Reuses the existing `participant.identity.signedInAs` ICU key — no new key for the identity row.
- When unauthenticated, the chrome renders the product label only (no identity row). The not-authenticated *body* panel still lives inside `<PlaceholderRouteBody>` (route content), not the chrome — auth-state messaging belongs in the content region per the predecessor's Decision §3.

### `<PlaceholderRoute>` rewrite (inside `apps/participant/src/App.tsx`)

```tsx
function PlaceholderRoute(): ReactElement {
  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<PlaceholderRouteBody />}
      footer={null}
    />
  );
}

function PlaceholderRouteBody(): ReactElement {
  // Existing body from `part_auth_flow`: the placeholder title, the body
  // caption, the not-authenticated guard branch. The identity row that
  // `part_auth_flow` landed inside this body MOVES UP into
  // <ParticipantChrome> (Decision §2); the body keeps the title +
  // body caption + the not-authenticated guard branch only.
  //
  // The outer wrapper changes from <main> to <div> (the layout's
  // <section data-testid="participant-main"> is the page's `main`
  // content region — only one <main> per page is semantically correct).
  // The `route-participant-placeholder` testid stays on the wrapper so
  // the predecessor's Playwright + Vitest pins keep matching.
  // ...
}
```

- The body's outer wrapper changes from `<main>` to `<div>` (only one `<main>` per page is semantically correct; the layout's `<section data-testid="participant-main">` is the page's `main` content region). The `route-participant-placeholder` testid stays on the wrapper — the predecessor's spec asserts `getByTestId('route-participant-placeholder')`, which is element-tag-agnostic.
- The body keeps its existing class names (`mx-auto max-w-2xl p-6`) so the placeholder text continues to read as a centered column inside the (now-wider) main region. Future leaves that own `main` (lobby, invite-acceptance, operate view) own their own layout inside the region.

### What the layout MUST NOT do

- **No business logic.** No `useAuth()`, no `useTranslation()`, no `useUiStore()` (the store doesn't exist yet anyway), no `useParams()`, no `useNavigate()`. The layout's only job is geometry + named slots + testids; everything else is caller responsibility. Mirrors `OperateLayout`'s "structure-only" promise.
- **No `window.location` reads or writes.** The layout doesn't know what URL it's on. Downstream leaves use `react-router-dom` hooks inside their slot content.
- **No new fetch / WebSocket subscription / effect.** No imperative side effects whatsoever; pure component.
- **No conditional rendering of regions.** All three regions always render — even when their slot prop is `null` / `undefined`. The empty regions just paint their background. This matches the moderator's pattern (`OperateLayout` renders all four regions even when no slot is provided) and means downstream leaves don't have to coordinate "render the footer only when status-indicator is wired in"; the footer is always there.
- **No portrait-orientation media queries.** The layout reads OK at narrower breakpoints because Tailwind's `h-screen` + `1fr` row work at any width, but no `md:` or `lg:` breakpoint variants pin a portrait-specific shape. Portrait support is out of scope.
- **No tokens import.** `packages/ui-tokens` is still deferred; the layout uses inline Tailwind utility classes (with arbitrary values where needed). When tokens land, the layout swaps them in (the moderator's `OperateLayout` will do the same swap — both surfaces benefit from a single tokens-package landing).

### Test layers per ADR 0022

Three pins, each anchoring a different observable property:

1. **Vitest layout-shape (NEW)** — `apps/participant/src/layout/ParticipantLayout.test.tsx`. Six cases, mirroring `OperateLayout.test.tsx`:
   - (a) The four stable `data-testid` regions render.
   - (b) The `header` child lands in the `participant-header` region.
   - (c) The `main` child lands in the `participant-main` region.
   - (d) The `footer` child lands in the `participant-footer` region.
   - (e) The layout root carries the Tailwind grid utility classes (`grid`, `h-screen`, `w-screen`) so the bundler chain (Tailwind v4 → Vite plugin → emitted CSS) provably runs over JSX in this workspace.
   - (f) The layout renders cleanly when any of the three slots is omitted (downstream tasks land their slot content one at a time; the footer specifically is empty today and must not break the layout).
2. **Vitest mount-boundary (extended)** — `apps/participant/src/mount.test.tsx`. The existing authenticated case grows one assertion: the four region testids (`participant-layout-root`, `participant-header`, `participant-main`, `participant-footer`) are visible after mount. Pins the route-tree-to-layout wiring end-to-end inside the mount boundary (not just the layout in isolation).
3. **Playwright (extended)** — `tests/e2e/participant-skeleton-smoke.spec.ts`. The existing first scenario (`authenticated user hits /p/sessions/<uuid>/invite?role=debater-A and sees the placeholder`) grows assertions:
   - The four region testids are visible.
   - The `participant-header` contains the product label text (`'A Conversa — Participant'` for en-US).
   - The `participant-identity` element (the predecessor's pin) is a descendant of `participant-header`, not the route body — this is the structural shift the leaf delivers.
   - The `participant-footer` is empty (no child elements); `part_status_indicator` fills it later.

   The existing second scenario (`authenticated visit surfaces the host-supplied screenName under participant-identity`) keeps its assertions but now resolves the testid inside the header rather than the body — no test change needed because `getByTestId('participant-identity')` is location-independent.

   The existing third scenario (`unauthenticated visit to /p/... lands on /login with the deep link remembered`) is unaffected; the deflection happens before the surface mounts, so the layout never paints in that branch.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default per `ORCHESTRATOR.md`.** The participant surface is reachable from the root (`/p/*` lands in `SurfaceHost` per `part_app_skeleton`), and the existing skeleton-smoke spec already runs against an authenticated `chromium-participant-skeleton` project. Extending the existing first scenario with layout-shape assertions covers the new chrome contract from the user-perspective; no new spec file, no new fixture, no new Playwright project. The extended scenarios run under the same `make up` compose stack the predecessor's spec already targets.

No e2e is deferred from this leaf.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~30 min: write `ParticipantLayout.tsx` (the layout component, mirroring `OperateLayout` line-for-line for the geometry differences).
- ~45 min: write `ParticipantLayout.test.tsx` (six Vitest cases mirroring `OperateLayout.test.tsx`).
- ~45 min: rewrite `App.tsx` to compose the layout + extract `ParticipantChrome` + `PlaceholderRouteBody`; update the existing mount-boundary case with the four new region-testid assertions.
- ~30 min: extend `participant-skeleton-smoke.spec.ts` with the layout-shape assertions in the existing first scenario.
- ~30 min: add the one new i18n key across en-US + pt-BR + es-419 + the two review.json `pending` lists.
- ~1.5h: iterate on the chrome's visual fit (header + footer height, padding, spacing of the product label vs. the identity row) at the Tailwind layer; verify the layout reads correctly at the default Playwright viewport (1280×720) and at a smaller breakpoint (e.g. 1024×768 — the landscape-tablet floor).
- ~1h: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + the WBS-status ritual.

Risk surface is small: the moderator's `mod_layout_shell` pattern is proven; the participant geometry is simpler (three row-stacked regions vs. moderator's two-row-two-column); the chrome's only auth-dependent element reuses the existing `participant-identity` testid + ICU key. No new dependency, no new build config, no new Playwright project, no new shell substrate.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move (other than the harmless `@a-conversa/i18n-catalogs` workspace re-link triggered by JSON edits).
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new `ParticipantLayout` component, the rewritten `App.tsx`, and the extended `mount.test.tsx` all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessor pinned; bundle filename / sidecar shape unchanged.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests). The new `apps/participant/src/layout/*.tsx` files are picked up by the existing `apps/**/*.{ts,tsx}` ESLint glob.
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+6** (six new `ParticipantLayout.test.tsx` cases). The existing `mount.test.tsx` case's added region-testid assertion does not change the case count.
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the one new `participant.chrome.productLabel` key is present in all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e`** under `make up` runs the extended `participant-skeleton-smoke.spec.ts` green inside the existing `chromium-participant-skeleton` project. The total scenario count in the spec is unchanged (3 — one extended, two unchanged); the extended scenario carries the new layout-shape assertions.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The layout owns no business logic** — a grep for `useAuth\|useTranslation\|useUiStore\|useParams\|useNavigate\|fetch\|XMLHttpRequest` under `apps/participant/src/layout/` returns zero matches.
10. **The four region testids are stable** — `participant-layout-root`, `participant-header`, `participant-main`, `participant-footer` appear in the Vitest assertions verbatim (no renaming during implementation).
11. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_landscape_layout` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
12. **Predecessor's existing assertions unchanged** — `tests/e2e/participant-skeleton-smoke.spec.ts`'s second and third scenarios pass without modification; the mount-boundary case's existing assertions pass with one additional assertion appended; the `route-participant-placeholder`, `participant-identity`, and `participant-not-authenticated` testids remain reachable.

## Decisions

### 1. Three row-stacked regions, CSS Grid, render-prop slots — mirror `mod_layout_shell`

Three alternatives surveyed:

- **(A) Two regions (header + main only)**, with the status chip rendered as a position-absolute overlay on top of `main`'s bottom edge. Rejected: the chip needs to be a tap-target on a tablet (per `docs/participant-ui.md`'s "touch targets are sized for confident tapping during live debate"); an absolute-positioned overlay would either capture taps that should reach the content underneath or be invisible to the layout's grid math. The footer-as-row keeps the chip's tap area honest.
- **(B) Four regions (header + main + bottom-strip + status-indicator-corner)**, with a dedicated tiny region for the connection-status indicator alone. Rejected: over-decomposed for the v1 status indicator's contract (the chip itself manages its internal left-aligned role + screen-name vs. right-aligned badge layout; the chrome doesn't need to subdivide further). When the status indicator's design eventually grows multi-element complexity, *it* subdivides, not the layout.
- **(C) Three regions: header + main + footer** (chosen). Header + footer are chrome (always-present, fixed-height tap-target rows); main is the routable content slot. Matches the participant tablet's three logical zones from `docs/participant-ui.md`: "graph view OR pending proposals" (main) + "status indicator" (footer) + "identity affordance" (header, where the per-`docs/participant-ui.md` status indicator does NOT live but where the persistent identity row goes since downstream leaves all want to know who is logged in).

The chosen approach matches `mod_layout_shell`'s recipe (CSS Grid + named slots + stable testids + structure-only) without copying its specific geometry. The participant's row-stack is simpler than the moderator's two-row-two-column because the participant surface is content-heavy (one logical region at a time) rather than multi-pane (graph + sidebar + bottom-strip-of-mode-aware-controls).

Cost: ~80 lines of layout code + ~70 lines of layout test. Benefit: a stable contract every downstream participant-UI leaf can plug into without re-deciding chrome geometry.

### 2. Identity row lives in the chrome header, not as inline body content

Two alternatives surveyed:

- **Keep identity in the body** (where `part_auth_flow` landed it) and add an empty header for downstream branding only. Rejected: the body changes per-route (placeholder today, lobby tomorrow, operate view after that); a body-resident identity row would either need to be repeated in every route component or wrapped in a body-level layout wrapper that lives inside `main`'s slot — both shapes duplicate the chrome's job. The chrome is the natural home for "always-visible identity affordance."
- **Move identity to the header** (chosen). The identity row's `participant-identity` testid and `participant.identity.signedInAs` ICU key stay; the rendering location moves up to the chrome. Downstream leaves that own `main` (lobby, operate, invite-acceptance) get the identity for free without each having to consume `useAuth()` themselves.

The body's `participant-not-authenticated` panel stays in the body for now (it is a route-content concern per `part_auth_flow` Decision §3, not chrome). If a future leaf wants a chrome-level "you appear to have signed out" affordance, that leaf decides.

### 3. The footer slot is empty today; `part_status_indicator` plugs the chip in

Two alternatives surveyed:

- **Build a stub `<StatusIndicatorPlaceholder>` and render it in the footer** (so the user sees something where the chip will eventually live). Rejected: the placeholder text would land in i18n catalogs only to be deleted when `part_status_indicator` lands; the testid would conflict with the eventual `status-indicator` testid that downstream leaf will use; users seeing a "(status indicator coming soon)" caption would be confused. Empty-but-present is the cleaner intermediate state.
- **Footer slot exists but receives no children today** (chosen). The layout renders the footer region (empty, but visible — bordered + background-tinted so the geometry is obvious during dev). `part_status_indicator` lands the chip in its own commit by passing a `footer={<StatusIndicator />}` prop to the layout in `<PlaceholderRoute>`. Zero coordination cost: this leaf and `part_status_indicator` don't have to ship in the same commit.

### 4. The product label uses one new i18n key (`participant.chrome.productLabel`)

Three alternatives surveyed:

- **No product label** — header is empty save for the identity row. Rejected: a chrome row with only a right-aligned identity reads as broken (no visual anchor on the left); future leaves like the lobby view will want to know what surface they are on (the moderator surface also has a product-label affordance, even if it lives inside `OperateLayout`'s slots rather than the layout itself).
- **Hard-coded "A Conversa" text** (not i18n-managed) — header reads `A Conversa` in every locale. Rejected: violates the project's "host-supplied i18n only" convention from ADR 0024; even brand-name copy gets a key so localizers can decide whether to translate the surface-disambiguator portion ("Participant" / "Participante" / etc.).
- **One new i18n key `participant.chrome.productLabel`** (chosen). Value: `"A Conversa — Participant"` in en-US (matches the moderator's eventual surface-naming convention; the moderator does not currently use a chrome-level label but if it grows one, it'll follow the same pattern). Drafts in pt-BR + es-419 land as `"A Conversa — Participante"` and `"A Conversa — Participante"` (or the Spanish equivalent), flagged PENDING in `*.review.json`. Native-speaker review chains the existing `i18n_participant_*_native_review` leaves.

One key minimizes the i18n surface this leaf opens; the moderator can later mirror with a `moderator.chrome.productLabel` key if it grows a chrome.

### 5. No layout-context for downstream slot consumption

Two alternatives surveyed:

- **Provide a `ParticipantLayoutContext`** that downstream leaves consume via `useParticipantLayoutSlots()` to imperatively register chip content into the footer. Rejected: over-engineered for v1. The current contract — pass children into the `<ParticipantLayout>` props from the caller — is the simpler shape and matches `mod_layout_shell`'s pattern (the moderator's `Operate.tsx` passes children into `<OperateLayout>` via props; no context). A layout context would be appropriate if downstream leaves needed to be deeply nested and reach up to the layout from inside the main region; that's not the case here because the chrome (header + footer) is composed at the same call site as the layout itself (`<PlaceholderRoute>`).
- **Render-prop slots only** (chosen). `<ParticipantLayout header={...} main={...} footer={...} />`; downstream leaves either modify `<PlaceholderRoute>` (during the migration period) or, once they own a real route, mount their own `<ParticipantLayout>` instance with their own header/main/footer composition.

When the participant surface grows multiple real routes (lobby, invite-acceptance, operate view), each route component mounts its own `<ParticipantLayout>` instance — that's the same shape `Operate.tsx` uses for `OperateLayout`. No context needed.

### 6. Pixel sizes inline, not tokens

Same trade as `mod_layout_shell` Decision §5. `packages/ui-tokens` is still deferred per ADR 0005's "Workspace realization deferred"; the layout uses inline Tailwind classes (`h-12` for header + footer, `1fr` for main, `bg-slate-50/100`, `border-slate-200`). When the tokens package lands, both layouts (moderator + participant) swap inline values for token references in the same commit — the cost of the duplicated inline values is small (eight class references total).

### 7. Mirror the moderator's `OperateLayout` module shape — same export style, same testid discipline, same structure-only constraint

Three alternatives surveyed:

- **Write a generic `<SurfaceLayout>` in `@a-conversa/shell`** that both the moderator and participant surfaces consume. Rejected: the two surfaces' geometries are different enough (moderator: two-row-two-column with bottom strip; participant: three-row-stacked with thin chrome) that the abstraction would need so many configuration props that each call site would read like a bespoke layout anyway. Better to keep two simple per-surface layouts than one parameterized shell layout. The shell substrate is for shared *primitives* (auth, i18n, WS, mount contract), not surface-specific *compositions*.
- **Inline the layout into `App.tsx`** instead of extracting a named component. Rejected: testability + reuse trade-off; an inline layout is hard to test in isolation (the moderator's `OperateLayout.test.tsx` is the proof case) and impossible to reuse across multiple route components when they land (each future route will compose `<ParticipantLayout header={...} main={<MyRoute/>} footer={...} />`).
- **Extract `<ParticipantLayout>` into `apps/participant/src/layout/`** (chosen). Mirrors the moderator's directory structure (`apps/moderator/src/layout/OperateLayout.tsx`); makes the layout reusable across future routes; gives the Vitest pins a stable target file path.

### 8. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0005's Tailwind-with-deferred-tokens; 0022's committed-test discipline; 0026's surface-owns-its-mounted-region; 0024's host-supplied-i18n).
- A direct mirror of `mod_layout_shell`'s pattern (Decisions §1, §6, §7).
- A scoped UI policy that doesn't constrain other tasks (Decisions §2, §3, §4, §5).

The "no new dependencies" rule is satisfied; the participant `package.json` is unchanged. The "no new shell substrate" rule (per `shell_substrate_extraction`'s contract: only auth/i18n/WS/mount-contract live in the shell) is honored; the layout is participant-local.

### 9. Tech-debt registration

- **`frontend_i18n.i18n_participant_chrome_native_review`** — pt-BR + es-419 native-speaker review of the one new `participant.chrome.productLabel` key. Effort: 0.25d. Mirrors the existing `i18n_participant_identity_native_review` task shape landed by `part_auth_flow`'s closer. **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes, chained after `!i18n_participant_identity_native_review` to keep the native-review chain linear (per the policy in `ORCHESTRATOR.md`).
- **No other follow-ups need registration.** The sibling leaf this work feeds (`part_status_indicator`) already exists as an open WBS leaf with `depends !part_landscape_layout`; it picks up the footer slot automatically. The downstream session-join + graph + voting leaves already exist with their own dependency edges and will mount their own `<ParticipantLayout>` instances when they land.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Added `<ParticipantLayout>` as a structure-only CSS-Grid shell with three row-stacked regions and four stable testids (`participant-layout-root`, `participant-header`, `participant-main`, `participant-footer`) at `apps/participant/src/layout/ParticipantLayout.tsx`; render-prop slots (`header` / `main` / `footer`) mirror the moderator's `OperateLayout` shape per Decision §1 / §7.
- Vitest layout-shape pins at `apps/participant/src/layout/ParticipantLayout.test.tsx` cover the six cases Acceptance §5 specifies (region IDs render, each slot child lands in its region, grid utility classes present, clean render when slots omitted); smoke count went 3432 → 3438 (+6).
- Rewrote `<PlaceholderRoute>` in `apps/participant/src/App.tsx` to compose the layout: extracted `<ParticipantChrome>` (product label + migrated `participant-identity` row reading `useAuth()`) and `<PlaceholderRouteBody>` (placeholder title + caption + not-authenticated guard, now wrapped in a `<div>` since the layout owns the page's single `<main>`-equivalent region); `route-participant-placeholder`, `participant-identity`, and `participant-not-authenticated` testids remain reachable.
- Extended `apps/participant/src/mount.test.tsx`'s existing authenticated case with four region-testid assertions (no new cases) and the first scenario of `tests/e2e/participant-skeleton-smoke.spec.ts` with region-testid + product-label + identity-in-header structural + empty-footer assertions (no new scenarios; the second / third scenarios are unchanged); 48/48 Playwright e2e pass.
- Landed one new i18n key (`participant.chrome.productLabel`) across `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` with the pt-BR + es-419 drafts flagged PENDING in the corresponding `*.review.json` trackers per Decision §4.
- Tech-debt registered: `frontend_i18n.i18n_participant_chrome_native_review` (0.25d) added to `tasks/35-frontend-i18n.tji` as the new tail of the native-review chain, depending on `!i18n_participant_identity_native_review` per Decision §9.
- Footer slot deliberately rendered empty today; `part_status_indicator` plugs its chip into the same slot in its own commit (Decision §3). No new shell substrate, no new dep, no new ADR.
- Workspace check (`pnpm run check`) and participant build (`pnpm -F @a-conversa/participant build`) green; behavior smoke 227/227 (no delta).
