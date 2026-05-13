# auth_callback_next_param_note

**Source**: [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) F-013
**TaskJuggler**: `backend_hardening.documentation.auth_callback_next_param_note`
**Type**: Documentation-only follow-up.

## Goal

Pin the future-design contract that any `?next=<url>` parameter added to the OIDC callback / post-login redirect path MUST be validated against the configured `APP_BASE_URL`'s origin — never used as an unvalidated redirect target. Document the rationale where the redirect happens so the next contributor sees it.

## Context

[`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) at line 682 has the returning-user redirect: `return reply.redirect(oidcConfig.appBaseUrl, 302)`. The redirect target is a server-side fixed value — there's no user-controlled `?next=` parameter today, so there's no open-redirect surface.

When the frontend eventually grows a "remember where the user was trying to go" feature (a common UX request — e.g., `GET /sessions/:id` → unauthenticated → redirect to `/auth/login?next=/sessions/:id` → after OIDC callback, land on `/sessions/:id`), the temptation will be to read `?next=` from the query string and pass it to `reply.redirect()` directly. **That** is the open-redirect bug.

## Decisions

- **No code change today.** No `?next=` parameter exists.
- **Add a code comment** at line 682 of `apps/server/src/auth/routes.ts` (immediately above the redirect call) that names:
  - The current safe shape (fixed `APP_BASE_URL`).
  - The future-`?next=` constraint: any user-supplied redirect target MUST be parsed via `new URL(next, APP_BASE_URL).origin === new URL(APP_BASE_URL).origin` — reject anything else.
  - Cross-reference this refinement so an auditor can trace the design intent.

## Acceptance

- Code comment in `apps/server/src/auth/routes.ts` near the `reply.redirect(oidcConfig.appBaseUrl, ...)` call.
- `complete 100` on `auth_callback_next_param_note` in `tasks/25-backend-hardening.tji`.

## Status

- [x] Refinement landed.
- [x] Code comment added.
- [x] `complete 100` in tji.
