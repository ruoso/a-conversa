# 0045 — Audience replay surface: visibility gating and anonymous public-session replay

- **Date**: 2026-06-05
- **Status**: Accepted

## Context

[ADR 0026](0026-micro-frontend-root-app.md) makes the audience a public-by-default micro-frontend under `/a/*`; [ADR 0029](0029-anonymous-ws-subscribe-for-public-sessions.md) lets an anonymous browser receive **live** events for a public session over the WS substrate, gated by `canSeeSessionAnonymously` (`apps/server/src/sessions/visibility.ts`) whose predicate is `privacy = 'public' AND ended_at IS NULL`. [ADR 0039](0039-shared-read-only-graph-view-package.md) extracted the read-only Cytoscape renderer into `@a-conversa/graph-view`, a props-in component consumed by both the live audience adapter (`apps/audience/src/graph/GraphView.tsx`) and the test-mode scrubber (`apps/test-mode/src/scrubber/TimelineScrubber.tsx:99`).

The replay viewer (`replay_test.replay_ui.replay_mode_audience_surface`) is "the replay-mode variant of the audience surface": the **same** `@a-conversa/graph-view` renderer, but fed from a saved event **log** instead of the live WS stream, mounted in the public audience bundle at `/a/{locale}/replay/{id}` (locale from the URL prefix, mirroring the live audience routes). The log it reads comes from `GET /sessions/:id/events` (ADR-less refinement `tasks/refinements/backend/get_session_log.md`), consumed client-side via `useSessionEventLog` (`packages/shell/src/session-log/useSessionEventLog.ts`).

Two facts collide:

1. `GET /sessions/:id/events` is **authenticated-only by design** — `preHandler: app.authenticate` (`apps/server/src/replay/routes.ts`) throws `401 auth-required` for an anonymous request, *before* any visibility check; the visibility gate is `canSeeSession` (`public OR host OR participant incl. historical`). An anonymous viewer of the public replay URL therefore cannot load any log.
2. ADR 0029 deferred exactly this: *"replay of a public session for an anonymous viewer is a useful feature, but introducing it now widens the security surface … deferred to a future leaf."* That leaf is now in front of us.

A replay also differs from a live broadcast in one visibility-relevant way: replays target **past** sessions, which are usually `ended`. The live anonymous predicate `canSeeSessionAnonymously` excludes ended sessions (`ended_at IS NULL`), so it cannot be reused verbatim for replay — a replay-visibility predicate must be `privacy = 'public'` **regardless of** `ended_at`.

The shape of the choice:

1. **Visibility-gate the replay surface via the existing authenticated endpoint; anonymous viewers see a sign-in CTA.** Authenticated viewers replay any session they can see (`canSeeSession`); anonymous viewers are funnelled through the same `PrivateSessionCta` the live route uses. Anonymous public-session replay (no sign-in) is a *separately scoped* backend follow-up.
2. **Build anonymous public-session log access now**, folding the endpoint relaxation + a new predicate into the replay-surface task.
3. **Require authentication for all replay**, dropping the public/URL-locale framing entirely.

## Decision

Adopt **Option 1**, with the anonymous public-session path scoped as an explicit, named follow-up rather than deferred to a vague "later."

**Replay-surface auth posture (lands now, in `replay_mode_audience_surface`).** The replay routes live in the public audience bundle and are reachable anonymously, but the **data** is gated by the session's own visibility through the existing `GET /sessions/:id/events` endpoint:

- An **authenticated** viewer who can see the session (`canSeeSession`: host, participant incl. historical, or any public session) gets the full log and the replayed graph renders.
- An **anonymous** viewer — or an authenticated viewer who cannot see the session — gets no log; the surface renders the same sign-in affordance the live route uses (`apps/audience/src/routes/PrivateSessionCta.tsx`), reused verbatim. The privacy boundary stays at the server's data layer; the UI never decides visibility.
- The replay surface renders the reconstructed state at the log **head** (the complete session). Position navigation — scrub, play/pause, seek, chapter-jump, `?position` deep-linking — is owned by the downstream `replay_playback_controls` / `replay_seek_bar` / `replay_url_position_loading` / `replay_chapter_jumping` leaves and is out of scope for the surface task.

**Anonymous public-session replay (scoped follow-up — `backend.replay_endpoints.anonymous_public_session_log`).** A future backend leaf relaxes the event-log read so an anonymous viewer can replay a **public** session (live *or* ended) without signing in, mirroring ADR 0029's "one transport, two auth postures" exactly:

- The events read accepts an anonymous request (no/invalid cookie → `request.authUser = undefined`, not a 401), preferring a **single endpoint with two auth postures** over a parallel public-only endpoint (consistent with ADR 0029's transport choice; the authenticated contract and its existing Cucumber pins update in place rather than forking).
- Anonymous requests are gated by a new **replay-visibility predicate** `canReplaySessionAnonymously(executor, sessionId)` → `SELECT 1 FROM sessions WHERE id = $1 AND privacy = 'public'` (no `ended_at` filter — replay is inherently historical). Authenticated requests keep `canSeeSession` unchanged.
- The **existence-non-leak rule** is preserved: a private or nonexistent session is indistinguishable from the outside (`not-found` / 404). No anonymous identity is synthesized (per ADR 0029's no-tracking stance); the transport stays same-origin with no query-string ticket (the cross-origin ticket primitive remains the deferred answer ADR 0029 already documented).
- The change crosses the HTTP/replay protocol seam, so it is pinned by committed **Cucumber** scenarios per [ADR 0022](0022-no-throwaway-verifications.md): anonymous + public-ended → 200 log; anonymous + public-live → 200 log; anonymous + private → 404; authenticated paths unchanged.

The follow-up leaf's refinement scopes the Playwright coverage for the now-reachable anonymous-public replay path (paying down the surface task's deferred anonymous-e2e debt — see Consequences).

## Consequences

- **The replay surface ships implementable as a frontend-first task.** It reuses the shipped `@a-conversa/graph-view` renderer (ADR 0039), the shipped `useSessionEventLog` loader, and the shipped `PrivateSessionCta`, against the shipped authenticated `GET /sessions/:id/events`. No backend change blocks it; authenticated replay works on day one.
- **Anonymous viewers see a sign-in wall until the follow-up lands.** This is a deliberate v1 narrowing — the same posture ADR 0029 took when it deferred anonymous catch-up. A shared public-replay link works immediately for any signed-in viewer; the no-sign-in public experience is one backend leaf away.
- **A new visibility predicate will join the family.** `canReplaySessionAnonymously` (public, ended-agnostic) sits beside `canSeeSession` (authenticated, full rule) and `canSeeSessionAnonymously` (public + not-ended, live only). The three compose; none drifts the others' signatures. The replay predicate is strictly the live-anonymous predicate minus the `ended_at IS NULL` clause.
- **Deferred anonymous-e2e debt is registered, not lost.** The surface task lands Playwright for its two *reachable-today* behaviors (authenticated viewer → graph renders; anonymous viewer → sign-in CTA). The anonymous-public-session-replays-without-sign-in behavior is not reachable until the follow-up relaxes the endpoint; its Playwright spec is scoped into `backend.replay_endpoints.anonymous_public_session_log`. This is the only deferred e2e pointing at that leaf.
- **No new transport, no new bundle.** Replay is routes inside the existing public audience app, not a new micro-frontend; the audience app's existing `requiredAuthLevel: 'public'`, URL-locale negotiation, and axe/Playwright harness all apply unchanged.
- **The cross-origin embed case stays deferred.** As in ADR 0029, the same-origin cookie-or-no-cookie posture covers both authenticated and (future) anonymous replay; a query-string ticket primitive remains the unbuilt answer for third-party embedding.

## Alternatives considered

- **Build anonymous public-session access inside the surface task (Option 2).** Rejected as the *default* scope: it folds a protocol-seam backend change (endpoint relaxation + new predicate + Cucumber) into a frontend variant task, inflating a 2d estimate and coupling two distinct review surfaces. Splitting it keeps the surface task a clean frontend slice and gives the backend change its own Cucumber-pinned leaf in the `backend.replay_endpoints` family where the sibling endpoints already live. The work is *named and scoped*, not deferred to a vague audit.
- **Authenticated-only replay (Option 3).** Rejected: it contradicts the task's explicit framing ("mirroring the audience surface", URL-prefix locale — the public-surface conventions) and forecloses the shareable public-replay link the product wants. The chosen posture keeps the surface public and gated-by-data, with the no-sign-in path a scoped enhancement rather than an architectural dead end.
- **A parallel public-only event-log endpoint.** Rejected for the follow-up in favor of relaxing the existing endpoint to two auth postures, consistent with ADR 0029's single-transport choice — a second endpoint would duplicate the cursor-pagination logic and create a second source of truth for the read shape.
- **Reuse `canSeeSessionAnonymously` verbatim for replay.** Rejected: its `ended_at IS NULL` clause excludes ended sessions, which are the primary replay target. The replay predicate must drop that clause.
- **Render the replay surface at position 0 (empty graph) by default.** Rejected: an empty graph is a confusing landing state for a surface with no scrubber yet. Rendering at the log head shows the complete session — the most informative single frame until the downstream playback controls add scrubbing from the start.

## Stack-validation tests

Per [ADR 0022](0022-no-throwaway-verifications.md), the auth posture lands behind real wiring in `apps/audience/src/routes/` (the replay route + its reuse of `PrivateSessionCta`) and is pinned by Vitest component tests over the load-state matrix plus a Playwright spec over the two reachable end-to-end behaviors, as spelled out in [`tasks/refinements/replay_test/replay_mode_audience_surface.md`](../../tasks/refinements/replay_test/replay_mode_audience_surface.md). The anonymous public-session relaxation and its Cucumber + Playwright coverage land with `backend.replay_endpoints.anonymous_public_session_log`.

## Amendments

(none)
