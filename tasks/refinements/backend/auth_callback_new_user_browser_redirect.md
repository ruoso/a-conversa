# auth_callback_new_user_browser_redirect

**TaskJuggler**: `backend.auth.auth_callback_new_user_browser_redirect` (in [`tasks/20-backend.tji`](../../20-backend.tji))
**Effort**: 0.5d
**Inherited dependencies (declared in `.tji`)**: `backend.auth.oauth_callback_handler` (the handler being amended), `backend.auth.screen_name_collection` (the SPA route + form being reused).
**Inherited dependencies (prose-only)**: `root_app.root_moderator_cutover` (the root app owns the SPA routes after ADR 0026 moved auth chrome out of the moderator). NOT expressed as a `.tji` edge: adding it triggers a `SystemStackError` in tj3 3.8.1's recursive `calcPathCriticalnessEndSuccs` because the milestone graph `m_manual_lobby_smoke → m_backend_mvp → backend.auth (parent) → <this task> → root_app.root_moderator_cutover → backend.auth.session_token_management` makes the successor walk re-enter `backend.auth` through a sibling. The ordering is still enforced at the milestone level: `m_manual_lobby_smoke` lists both this task AND `root_app.root_moderator_cutover` as direct deps, so the relative order holds for scheduling.

## What this task is

Resolve the "raw JSON renders in browser after new-user callback" UX gap acknowledged in [`mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md) (Decisions §last bullet, Open questions §1). Today's new-user branch of `GET /api/auth/callback` returns a 200 JSON body `{ sub, oauthSubject, userId, needsScreenName: true }`; in a real browser the user dead-ends on the raw JSON view (confirmed by a tester on 2026-05-16). Amend the handler to 302-redirect (the `aconversa-auth-pending` cookie still set on that response) to a SPA route that renders the screen-name form. Amend the root SPA's `ScreenNameRoute` to render the form when the URL signals a callback-driven arrival, even though `/api/auth/me` returns 401 with only the pending cookie present.

## Why it needs to be done

[`m_manual_lobby_smoke`](../../99-milestones.tji) is the milestone at which a human can manually drive moderator → invite → debater-login → lobby. A first-login human cannot complete that flow today: after the OIDC dance the browser renders raw JSON on `/api/auth/callback` and there is no SPA-side affordance to advance. The Playwright suite hides this because [`tests/e2e/fixtures/auth.ts:342-358`](../../../tests/e2e/fixtures/auth.ts) POSTs `/api/auth/screen-name` directly from the test runner's request context — a workaround unavailable to a real browser. The milestone explicitly gates on this task (added 2026-05-16) so the smoke can be driven by an actual person.

## Inputs / context

- [`apps/server/src/auth/routes.ts:586-750`](../../../apps/server/src/auth/routes.ts) — the `/api/auth/callback` handler. Returning-user branch (688-715) already 302s to `oidcConfig.appBaseUrl`; new-user branch (717-748) is the one that needs the parallel redirect treatment.
- [`apps/server/src/auth/routes.ts:331-365`](../../../apps/server/src/auth/routes.ts) — `callbackResponseSchema` pins the new-user 200 JSON shape. The schema goes away (the SPA stops being the consumer); the OpenAPI response definitions shrink to the 302 + error cases.
- [`apps/root/src/App.tsx:122-154`](../../../apps/root/src/App.tsx) — `ScreenNameRoute`. Currently `Navigate to="/login"` when `auth.status === 'unauthenticated'`. Needs a branch that, when the URL carries the callback signal, renders the form despite `unauthenticated`.
- [`packages/shell/src/screen-name/`](../../../packages/shell/src/screen-name/) — `ScreenNameForm` and its server-error mapping live here. The form's POST already handles `auth-pending-cookie-invalid` (mapped to `auth.screenName.errors.pendingCookieInvalid`), so a stale-cookie surface degrades gracefully.
- [`tests/e2e/fixtures/auth.ts:222-240, 342-358`](../../../tests/e2e/fixtures/auth.ts) — the helper's storage-state short-circuit and the new-user JSON-detect branch. After this task, the helper navigates the browser through the screen-name form like a real user; the API-POST detour is removed.
- [`tasks/refinements/moderator-ui/mod_auth_flow.md:57-75, 139, 143`](../moderator-ui/mod_auth_flow.md) — the "screen-name-detection question" section explicitly considered both options (backend Accept-header branching, or a frontend `/auth-callback` route) and deferred. This task picks the **always-redirect** variant of the backend option.

## Constraints / requirements

- **Backend** ([`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts)):
  - New-user branch: replace `return { sub, oauthSubject, userId, needsScreenName: true }` with `return reply.redirect(<screen-name URL>, 302)`. Keep the `Set-Cookie` for the pending cookie. Keep `Cache-Control: no-store` (G-019 — see the same header on the returning-user branch).
  - The redirect target is built from `oidcConfig.appBaseUrl` so the redirect is same-origin under every deployment. Path + query are fixed at the call site: `/screen-name?from=callback`. No user-controllable URL component reaches `reply.redirect` (preserves the F-013 no-open-redirect invariant called out by `auth_callback_next_param_note`).
  - OpenAPI: drop the `200: callbackResponseSchema` from the route's `response` map; keep the `302` case and broaden its description to cover both branches. Delete the now-unreferenced `callbackResponseSchema` constant if no other handler consumes it.
  - Update the handler-level docstring (lines 591-604) to describe the new shape: both branches now 302; the difference is the cookie issued and the redirect target.
- **Frontend** ([`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx)):
  - `ScreenNameRoute`: read `useLocation().search`. If the query carries `from=callback`, render the existing `ScreenNameForm` regardless of `auth.status === 'unauthenticated'`. The `loading`, `needs-screen-name`, and `authenticated` branches stay unchanged.
  - No new auth state is introduced in `useAuth()`. The signal lives in the URL only; the gate is local to this route (per the Decisions section below).
  - The form's existing `onSuccess` path (`auth.refresh()` → `navigate(resolvePostAuthTarget())`) keeps working — the POST sets the platform session cookie, the refresh sees the 200, the navigate carries the user onward (typically to the sessionStorage-remembered return-to set by `SurfaceHost` before the OIDC dance).
- **Test fixture** ([`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts)):
  - Remove the `if (page.url().includes('/api/auth/callback'))` branch (lines 342-358) and its surrounding rationale comment block (lines 58-78).
  - For the new-user case, the browser lands on `/screen-name?from=callback` after the OIDC dance. The helper fills the rendered form's input and clicks submit; the existing post-submit flow carries the page to the remembered return-to. The post-helper poll on `/api/auth/me` still gates the return as before.
- **Server tests** ([`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts) and any sibling that asserts the new-user response shape):
  - Replace 200/JSON-body assertions with 302/`Location: <appBaseUrl>/screen-name?from=callback` assertions.
  - Pin that the pending cookie is still set on the 302 response (the cookie-bearing redirect contract for new users).
  - Pin that `Cache-Control: no-store` is still present (G-019 stays satisfied on both branches).

## Acceptance criteria

- `pnpm typecheck` clean.
- `pnpm test:smoke` (Vitest) green. The handler tests carry the new 302 expectations; the screen-name form / route tests cover the new `?from=callback` render path.
- `pnpm test:e2e --project=chromium-auth` green. The auth-flow spec's new-user scenario and the `landing-to-lobby` scenario both complete without the fixture's API-POST detour.
- Manual smoke: `make down-v && make up`, open `http://localhost:3000/` in a fresh private window, click "Create a session", complete OIDC for an Authelia user not previously seen, land on `/screen-name?from=callback`, fill the form, end up on `/m/sessions/new` ready to create a session.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` is appended to the leaf and the Status block is added below.

## Decisions

- **Always redirect, no Accept-header branching.** The original deferral in `mod_auth_flow.md` sketched "redirect when `Accept: text/html`, return JSON otherwise" so non-browser callers could keep the JSON contract. We're not preserving that: the OIDC callback URL is reached exclusively via a browser navigation following Authelia's 302; there is no legitimate non-browser caller. Always-redirect is simpler, eliminates a content-negotiation surface from the hot auth path, and matches what the returning-user branch already does.
- **Redirect target is `/screen-name?from=callback`.** A SPA-owned route the root app already serves. The `?from=callback` query parameter is the signal the SPA reads to bypass its "unauthenticated → /login" branch and render the form. Form submission's POST `/api/auth/screen-name` validates the pending cookie server-side; if it's missing or expired, the user gets the canonical 401 envelope which the form's existing error path renders (`auth.screenName.errors.pendingCookieInvalid`).
- **No new SPA-side auth state.** We do NOT add a "needs-screen-name-from-callback" status to `useAuth()`. The URL parameter is a per-route render gate, not a global auth state — keeping the change scoped to `ScreenNameRoute` avoids cross-cutting changes to the shell auth provider and the multiple consumers that switch on `auth.status`.
- **The OpenAPI schema for the new-user branch becomes 302, not 200.** The 200 callback response schema is deleted; the `callbackResponseSchema` constant goes away (or, if any test still imports it, narrows to the test-only fixture shape). Tests asserting the 200 JSON shape are rewritten as 302 + Location assertions.
- **Pick the backend option, not the frontend `/auth-callback`-route option.** The two alternatives sketched in `mod_auth_flow.md` were (a) backend 302 + SPA route, or (b) a frontend `/auth-callback` page that fetches the JSON itself. Option (a) is one round-trip; option (b) is two (the browser lands on the JSON page once, then fetches again from a different SPA route). (a) also avoids the awkward intermediate state where the URL bar reads `/api/auth/callback` (an API path) while the SPA owns the rendering.

## Open questions

(none — all decided)

## Status

_pending implementation_
