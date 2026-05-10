# No auth for public-session viewer page

**TaskJuggler entry**: `audience.aud_shell.aud_no_auth_for_public` — [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji)
**Effort estimate**: 0.5d

## What and why

The audience surface for **public** sessions must render without requiring authentication — anyone with the URL can load the page. Per [docs/architecture.md — frontend surfaces](../../../docs/architecture.md#frontend-surfaces), public sessions have a public viewer URL that mirrors session privacy.

## Decisions

- Audience routes (`/sessions/:id`) check the session's `privacy` field on first load:
  - `public`: skip auth entirely; render with read-only WebSocket subscription.
  - `private`: redirect to login (handled by `aud_auth_for_private`, separate sibling task).
- The backend exposes a public-readable session-metadata endpoint (`GET /sessions/:id/meta`) that returns `{ privacy }` without authentication so the audience client can decide which path to take.
- WebSocket subscription for public sessions doesn't require a session token — the server accepts unauthenticated subscribers for public sessions (read-only).

## Acceptance criteria

- Loading `/sessions/<public-session-id>` renders without authentication.
- The unauthenticated WebSocket subscription delivers events for public sessions.
- The unauthenticated path does **not** work for private sessions (returns 401 / redirects to login).
- A Playwright test covers both: anonymous access succeeds for a public session, fails for a private one.
