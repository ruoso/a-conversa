# root_moderator_cutover

- **TaskJuggler entry**: [tasks/45-root-app.tji](../../45-root-app.tji#L31) — task `root_app.root_moderator_cutover`
- **Effort estimate**: 5d
- **Inherited dependencies**:
  - `root_app.root_pkg_skeleton` (settled — the root workspace exists, but it is still only a placeholder host rendering a static card; see [apps/root/src/main.tsx](../../../apps/root/src/main.tsx#L1) and [apps/root/src/App.tsx](../../../apps/root/src/App.tsx#L1)).
  - `moderator_ui.mod_shell` (settled — the moderator already ships its auth flow, auth gate, and route tree as a standalone SPA under unprefixed `/login`, `/screen-name`, and `/sessions/*`; see [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji#L32), [tasks/refinements/moderator-ui/mod_auth_flow.md](../moderator-ui/mod_auth_flow.md#L1), and [tasks/refinements/moderator-ui/mod_route_auth_gate.md](../moderator-ui/mod_route_auth_gate.md#L1)).
  - `shell_package.shell_mount_contract` (settled — `MountProps`, `UnmountFn`, `MountFn`, and `SurfaceModule` already exist in the shell package; see [packages/shell/src/mount-contract/types.ts](../../../packages/shell/src/mount-contract/types.ts#L78) and [tasks/refinements/shell-package/shell_mount_contract.md](../shell-package/shell_mount_contract.md#L1)).
  - `shell_package.shell_substrate_extraction` (settled — `AuthProvider`, `createI18nInstance`, `I18nProvider`, `ScreenNameForm`, `LoginButton`, the WS client surface, and the API-error mappers already live in `@a-conversa/shell`; see [tasks/refinements/shell-package/shell_substrate_extraction.md](../shell-package/shell_substrate_extraction.md#L1)).
  - `backend.auth.session_token_management` (settled — the root-hosted auth routes depend on the already-landed `GET /auth/me`, `POST /auth/screen-name`, and `POST /auth/logout` behavior; see [tasks/refinements/backend/session_token_management.md](../backend/session_token_management.md#L1)).
  - Absorbed predecessor responsibility: `moderator_ui.mod_extract_to_mountable_library` no longer exists as a standalone WBS leaf after commit `b723ca6783a55a1e4f418228d5329e6ec6fb3a44`. Its prior documented refinement path was `tasks/refinements/moderator-ui/mod_extract_to_mountable_library.md`, but that file is absent in the repo, so continuity for the mount conversion comes from the merged task note in [tasks/45-root-app.tji](../../45-root-app.tji#L31), [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md#L37), and the landed shell refinements above.

## What this task is

This task is the single public-contract-preserving cutover that turns the current placeholder root workspace into the real host app from [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md#L37), moves the moderator from a standalone self-bootstrapped SPA to a `mount(props): UnmountFn` surface consumed through `@a-conversa/shell`, and changes the moderator's public routes from `/sessions/*` to `/m/sessions/*` in the same commit that the root begins serving the replacement auth chrome and dispatcher. The root owns the top-level `BrowserRouter`, shell-backed auth/i18n providers, `/login`, `/screen-name`, `/logout`, `/auth/callback`, the surface manifest loader, and the `/m/*` dispatch handoff. The moderator stops owning standalone auth chrome, stops bootstrapping itself directly from `main.tsx`, and instead exports the mount contract while preserving its internal route semantics under the `/m` basename.

## Why it needs to be done

The current codebase is in the awkward halfway state ADR 0026 was written to eliminate. The root app exists but is only a static placeholder in [apps/root/src/App.tsx](../../../apps/root/src/App.tsx#L1). The moderator still boots itself directly in [apps/moderator/src/main.tsx](../../../apps/moderator/src/main.tsx#L28) and still declares unprefixed routes in [apps/moderator/src/App.tsx](../../../apps/moderator/src/App.tsx#L39). Leaving the work split across separate leaves would force the public route contract to break in the middle: either the root would start serving `/login` and `/screen-name` before the moderator moved under `/m/*`, or the moderator would move under `/m/*` before the root could dispatch and host the replacement auth chrome. The merged leaf keeps those user-reachable changes atomic.

Downstream, this cutover is what makes the micro-frontend architecture real instead of aspirational. Until it lands, `@a-conversa/shell` and the mount contract are proven only in isolation, the backend still serves a single-surface fallback shape in practice, and the Playwright coverage still exercises the moderator as the entry SPA rather than as a region mounted by the root host. This task is the handoff point where ADR 0026 stops being future tense.

## Inputs / context

- The owning WBS note in [tasks/45-root-app.tji](../../45-root-app.tji#L31) is explicit about the merged scope: root-level `AuthProvider` + `I18nProvider` + `BrowserRouter` wiring, `/login`, `/screen-name`, `/logout`, `/auth/callback`, the manifest loader, the `/m/*` dispatcher, and the moderator extraction to `mount(props): UnmountFn` all move together.
- The current root app is only scaffolding: [apps/root/src/main.tsx](../../../apps/root/src/main.tsx#L1) only mounts `<App />`, and [apps/root/src/App.tsx](../../../apps/root/src/App.tsx#L1) renders a placeholder “a-conversa root” card. There is no routing, no auth provider tree, and no manifest loading yet.
- The current moderator still owns the provider bootstrap and top-level router: [apps/moderator/src/main.tsx](../../../apps/moderator/src/main.tsx#L28) imports `BrowserRouter` and renders `<I18nProvider><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></I18nProvider>`. That ownership must move to the root host for ADR 0026 to be true.
- The moderator still declares standalone routes at [apps/moderator/src/App.tsx](../../../apps/moderator/src/App.tsx#L39): `/login`, `/screen-name`, `/sessions/new`, `/sessions/:id/invite`, `/sessions/:id/lobby`, and `/sessions/:id/operate`. This task does not redesign those screens; it rebases them under `/m` and removes the standalone auth entry routes from the moderator bundle.
- The mount contract the root must consume already exists in [packages/shell/src/mount-contract/types.ts](../../../packages/shell/src/mount-contract/types.ts#L78). `MountProps.routerBasePath` is the contract seam that lets the moderator keep an internal route tree while the host owns the public prefix.
- The root and the moderator are expected to reuse shell-owned substrate instead of duplicating it. That is already the design recorded in [tasks/refinements/shell-package/shell_substrate_extraction.md](../shell-package/shell_substrate_extraction.md#L1), and the live shell exports include `createI18nInstance` in [packages/shell/src/i18n/createI18nInstance.ts](../../../packages/shell/src/i18n/createI18nInstance.ts#L26) and `I18nProvider` in [packages/shell/src/i18n/I18nProvider.tsx](../../../packages/shell/src/i18n/I18nProvider.tsx#L17).
- ADR continuity is load-bearing. [docs/adr/0026-micro-frontend-root-app.md](../../../docs/adr/0026-micro-frontend-root-app.md#L37) fixes the architecture: URL-prefix dispatch, Vite library-mode surfaces, shell-owned shared substrate, and a root app that serves `/`, `/login`, `/screen-name`, and `/logout`. [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md#L31) requires the route and mount behavior here to land with committed tests, not one-off manual checks.
- Existing moderator auth/routing behavior that must survive the cutover is already pinned in tests and refinements: [tasks/refinements/moderator-ui/mod_auth_flow.md](../moderator-ui/mod_auth_flow.md#L1), [tasks/refinements/moderator-ui/mod_route_auth_gate.md](../moderator-ui/mod_route_auth_gate.md#L1), and the Playwright auth and moderator specs under [tests/e2e/auth-flow.spec.ts](../../../tests/e2e/auth-flow.spec.ts#L65), [tests/e2e/create-session-flow.spec.ts](../../../tests/e2e/create-session-flow.spec.ts#L42), [tests/e2e/invite-participants-flow.spec.ts](../../../tests/e2e/invite-participants-flow.spec.ts#L65), [tests/e2e/moderator-hover-details.spec.ts](../../../tests/e2e/moderator-hover-details.spec.ts#L68), and [tests/e2e/moderator-capture.spec.ts](../../../tests/e2e/moderator-capture.spec.ts#L1).
- The current locale/auth smoke still assumes the moderator is the entry SPA on `/` and `/screen-name`; see [tests/e2e/i18n-moderator-smoke.spec.ts](../../../tests/e2e/i18n-moderator-smoke.spec.ts#L54). This task must rewrite that coverage so the same user-visible routes are asserted through the root host instead of the moderator dist fallback.
- The ADR log rules in [docs/adr/README.md](../../../docs/adr/README.md#L1) matter here only as a guardrail: no new architectural dependency should be introduced by this task without a new ADR. This refinement assumes no new ADR is needed because it is implementing ADR 0026 rather than changing it.

## Constraints / requirements

- This task is one atomic public-contract-preserving transition. The root must start serving the replacement auth chrome and `/m/*` dispatcher in the same commit that the moderator stops owning standalone `/login`, `/screen-name`, `/logout`, and unprefixed `/sessions/*` entry behavior.
- The root must reuse the landed shell seams. No duplicate auth hook, i18n bootstrap, screen-name form, login button, error-mapper, or mount types may be introduced under `apps/root/` or reintroduced under `apps/moderator/`.
- The moderator must become a mountable library that exports the shell contract (`mount(props): UnmountFn`) and owns an internal router rooted at `props.routerBasePath`, not a self-bootstrapping SPA with its own top-level `createRoot()` and standalone `BrowserRouter`.
- The route surface must stay coherent for users and tests. `/login`, `/screen-name`, `/logout`, and `/auth/callback` become root-owned routes. Moderator user journeys move to `/m/sessions/new`, `/m/sessions/:id/invite`, `/m/sessions/:id/lobby`, and `/m/sessions/:id/operate`. There must be no intermediate state where both unprefixed and prefixed moderator paths are half-live.
- The root host must load the moderator through the surface-manifest path described by ADR 0026, not by statically importing moderator app code into the root bundle. The manifest fetch and prefix dispatch are part of the deliverable, not future follow-up.
- Existing moderator route-level auth semantics must remain intact after rebasing under `/m`: unauthenticated access still resolves to `/login`, `needs-screen-name` still resolves to `/screen-name`, and authenticated moderator routes still render only once the auth state is satisfied.
- The root must remain the only owner of top-level auth/i18n providers and top-level `BrowserRouter`. Moderator route components may consume those contexts through shell and may create an inner basename-scoped router only as required by the mount architecture.
- Any required test moves or rewrites are in scope. If a test today only passes because the moderator is still the entry SPA, that test must be rewritten to assert the same observable behavior through the root app rather than left stale or deleted.
- No new external dependency or architecture change is allowed without a new ADR. This task is constrained to the already-accepted ADR 0026 approach: pnpm workspace packages, Vite library-mode surfaces, plain ESM bundle dispatch, and shell-based shared substrate.

## Acceptance criteria

- `apps/root/` stops being a placeholder host. It ships the real provider/router/dispatcher shell, owns `/`, `/login`, `/screen-name`, `/logout`, and `/auth/callback`, and loads the moderator surface from the surface manifest described by ADR 0026.
- `apps/moderator/` exports a mountable surface compatible with `@a-conversa/shell`'s `MountFn`/`SurfaceModule` contract and no longer boots itself as the primary SPA entrypoint.
- The public moderator route contract is coherent and user-reachable through the root host only: `/m/sessions/new`, `/m/sessions/:id/invite`, `/m/sessions/:id/lobby`, and `/m/sessions/:id/operate` work, while the old unprefixed moderator entry routes are removed or redirected in a deliberate way that does not leave duplicate supported URLs.
- Root-hosted auth routes preserve moderator-era behavior: unauthenticated users can start at `/login`; new users can complete `/screen-name`; authenticated users can reach moderator routes under `/m/*`; logout clears the session and returns the browser to the root-owned unauthenticated flow.
- Committed verification covers both root auth routes and mounted moderator routes per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md#L31):
  - Vitest covers the root dispatcher and manifest-loader behavior, including prefix dispatch to moderator and the fallback behavior for unknown or failed surface-manifest entries.
  - Vitest covers the moderator mount boundary, including `mount(props)` using the provided basename and returning a working `UnmountFn`.
  - Playwright covers at least one root-authenticated flow that is user-reachable through the browser, not by direct API posting alone: `/login` to `/screen-name` to `/`, plus the handoff into a moderator route under `/m/*`.
  - Playwright covers at least one moderator journey through the root host under the new prefix, such as create-session to invite or invite to operate, so the mounted-region routing is proven in-browser rather than only by unit tests.
  - Existing moderator Playwright coverage that currently targets unprefixed `/sessions/*` is moved or rewritten to target `/m/sessions/*` and to enter through the root host when that is the real public surface.
- `pnpm run check` stays green after the route/test rewrites.
- `pnpm run test:smoke` stays green with any moved Vitest coverage.
- `pnpm run test:e2e` stays green with the root-hosted auth and `/m/*` moderator paths. Passing only direct moderator-dist specs is not sufficient for this task because the merged leaf's main risk is the host-to-surface transition.

## Decisions

- **Decision: one merged cutover, not separate root and moderator public-route transitions.**
  - Alternative: land root-owned auth routes first, then move moderator routes later.
  - Alternative: move moderator to `/m/*` first, then introduce the root host afterward.
  - Chosen because either staggered variant creates a period where the public contract is split across two apps or two route shapes. The WBS merge in commit `b723ca6783a55a1e4f418228d5329e6ec6fb3a44` is correct: the user-reachable route transition has to be atomic.

- **Decision: the root owns top-level providers, manifest loading, and public-prefix dispatch; the moderator owns only its mounted region.**
  - Alternative: keep the moderator owning its own top-level providers and have the root act as a thin redirector.
  - Alternative: fold moderator code directly into the root app instead of using `mount(props)`.
  - Chosen because ADR 0026 already fixes the seam: the root hosts shared auth/i18n/router state and dispatches bundles by prefix; surfaces consume shell and mount under a basename. Anything else would either duplicate substrate or bypass the mount contract that already landed.

- **Decision: the moderator route rebase to `/m/*` happens in the same commit that the root starts serving the replacement auth routes.**
  - Alternative: keep backward-compatible aliases from `/sessions/*` indefinitely.
  - Alternative: support both `/sessions/*` and `/m/sessions/*` during a transition window.
  - Rejected because the task note explicitly calls for a public-contract-preserving same-commit cutover rather than a long-lived dual-contract phase. Dual route families multiply Playwright and maintenance cost and blur which URL is canonical.

- **Decision: existing tests are rewritten to prove the mounted architecture, not merely retargeted mechanically.**
  - Alternative: keep current moderator e2e helpers/specs largely unchanged and only rewrite the URL strings.
  - Alternative: rely on Vitest at the mount boundary and skip Playwright updates because the moderator internals are already tested.
  - Rejected because the merged leaf's primary risk is not the moderator internals in isolation; it is the browser-visible handoff from the root host into the mounted moderator region. ADR 0022 requires that risk to be pinned with committed tests at the right layer, which here includes Playwright.

- **Decision: no new ADR is needed.**
  - Alternative: write a new ADR for the merged cutover leaf itself.
  - Rejected because the task is implementing ADR 0026 and respecting ADR 0022, not changing either architectural decision. If implementation reveals a need for a new dependency, a new dispatch mechanism, or a different route ownership model, that is a stop-and-write-an-ADR event, not part of this refinement's baseline.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Root host routing and auth chrome landed in [apps/root/src/App.tsx](../../../apps/root/src/App.tsx), including the root-owned `/login`, `/screen-name`, `/logout`, `/auth/callback`, `/`, and `/m/*` dispatch routes.
- Surface loading moved to the root host in [apps/root/src/surfaces/SurfaceHost.tsx](../../../apps/root/src/surfaces/SurfaceHost.tsx) and [apps/root/src/surfaces/manifest.ts](../../../apps/root/src/surfaces/manifest.ts), with remembered return-to handling and manifest-driven module/style loading.
- The moderator converted to a mountable surface in [apps/moderator/src/main.tsx](../../../apps/moderator/src/main.tsx) and now runs under the host-provided basename instead of booting as the primary SPA.
- Server-side multi-surface static serving was completed in [apps/server/src/routes/static-frontends.ts](../../../apps/server/src/routes/static-frontends.ts) and pinned in [apps/server/src/routes/static-frontends.test.ts](../../../apps/server/src/routes/static-frontends.test.ts), including the moderator surface manifest and CSS sidecar path.
- Browser coverage was rebased to the root-hosted public contract in [tests/e2e/create-session-flow.spec.ts](../../../tests/e2e/create-session-flow.spec.ts), [tests/e2e/invite-participants-flow.spec.ts](../../../tests/e2e/invite-participants-flow.spec.ts), [tests/e2e/moderator-hover-details.spec.ts](../../../tests/e2e/moderator-hover-details.spec.ts), [tests/e2e/moderator-graph-layout.spec.ts](../../../tests/e2e/moderator-graph-layout.spec.ts), and [tests/e2e/moderator-capture.spec.ts](../../../tests/e2e/moderator-capture.spec.ts).
- Participant-facing invite links now resolve through the root-owned participant prefix in [apps/moderator/src/routes/InviteParticipants.tsx](../../../apps/moderator/src/routes/InviteParticipants.tsx) and [apps/moderator/src/routes/InviteParticipants.test.tsx](../../../apps/moderator/src/routes/InviteParticipants.test.tsx).
- Verification completed against the landed cutover shape: `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, and `pnpm run test:e2e` all passed after the route, manifest, and session-seeding fixes.