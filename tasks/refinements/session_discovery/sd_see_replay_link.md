# sd_see_replay_link — "See replay" → audience replay mode

## TaskJuggler entry

`session_discovery.sd_frontend.sd_see_replay_link`, defined in
[`tasks/75-session-discovery.tji:79`](../../75-session-discovery.tji).
Back-link `note` on that task points here.

## Effort estimate

0.5d (from the WBS).

## Inherited dependencies

`depends !sd_session_list_component` — the shared list component, both
discovery pages, and the sibling "join live" affordance are already shipped:

**Settled (landed):**

- `sd_schema` — `sessions.started_at TIMESTAMPTZ NULL` exists; NULL ⟺ lobby,
  non-NULL ⟺ started. `ended_at` already existed (NULL ⟺ live, non-NULL ⟺
  ended). The lifecycle status this task keys on derives from these two fields.
- `sd_my_sessions_endpoint` / `sd_public_sessions_endpoint` — both list
  endpoints carry `id`/`topic`/`startedAt`/`endedAt` on each row (My Sessions
  also carries `role`); that is everything the replay affordance needs.
- `sd_session_list_component` —
  [`apps/root/src/discovery/SessionList.tsx`](../../../apps/root/src/discovery/SessionList.tsx)
  exposes a role-agnostic `renderRowActions?: (row: SessionListRow) => ReactNode`
  slot (declared line 97, rendered into the row's actions cell line 409).
  `SessionListRow` is `{ id, topic, startedAt: string|null, endedAt: string|null }`
  (lines 51–58). The component derives its own lifecycle status from
  `startedAt`/`endedAt`; this task derives the same status independently for
  the affordance decision.
- `sd_join_live_link` —
  [`apps/root/src/discovery/joinLiveHref.ts`](../../../apps/root/src/discovery/joinLiveHref.ts)
  + [`apps/root/src/discovery/JoinLiveLink.tsx`](../../../apps/root/src/discovery/JoinLiveLink.tsx)
  established the **pure-helper + thin-`<Link>`-component** pattern this task
  mirrors. It owns join-live for **lobby/live** rows only and explicitly leaves
  **ended** rows to this task (its Decision D4). Both pages already wire a
  `renderRowActions` slot this task extends:
  - [`apps/root/src/routes/MySessionsRoute.tsx:103-110`](../../../apps/root/src/routes/MySessionsRoute.tsx)
    renders `SessionRoleBadge` + `JoinLiveLink` in the actions cell.
  - [`apps/root/src/routes/PublicSessionsRoute.tsx:54`](../../../apps/root/src/routes/PublicSessionsRoute.tsx)
    renders `JoinLiveLink` (no role — anonymous public rows).

**Pending (downstream / adjacent, not blocking):**

- `sd_e2e` (`depends !sd_frontend`) — already enumerates the see-replay
  Playwright coverage for this task ("see-replay lands in the audience replay
  surface"); see Acceptance criteria. No new e2e debt is registered here.
- `backend.replay_endpoints.anonymous_public_session_log` (ADR 0045 §2
  follow-up) — relaxes `GET /sessions/:id/events` to serve anonymous requests
  for public sessions. **Not this task's concern and not blocking:** this task
  only builds the navigation affordance; the audience replay route's data gate
  is owned by ADR 0045 and that follow-up. Until it lands, an anonymous click
  on a public ended row's replay is gated by the existing auth surface and gets
  the `PrivateSessionCta` sign-in affordance — the correct, already-specified
  behavior, not a regression introduced here.

## What this task is

Add the per-row **"see replay"** affordance to the discovery lists and route it
to the audience surface's **replay** route for the row's session:

- `/a/replay/:sessionId` (the audience replay variant —
  [`apps/audience/src/App.tsx:195-196`](../../../apps/audience/src/App.tsx),
  reachable under the root app's `/a` basename per ADR 0026).

Concretely: a pure availability/href helper + a small localized `<Link>`
component, wired into the existing `renderRowActions` slot of both pages
**beside** the join-live link. This is the direct counterpart to
`sd_join_live_link` — same shape, different destination and a different
lifecycle gate.

## Why it needs to be done

`sd_join_live_link` deliberately renders **nothing** for ended rows (its
matrix returns `null` once `endedAt != null`). Without this task an ended
session — the most common thing in My Sessions over time, and a first-class
citizen of the Public list — has no action at all: the row is a dead end. The
whole point of replay (ADR 0043/0045) is that a finished debate stays viewable;
this affordance is the entry point from the discovery surface into that replay
experience. It completes the actions cell so every listed row that *can* be
viewed offers a way in.

## Inputs / context

- WBS task + product constraints:
  [`tasks/75-session-discovery.tji:18-22,79-84`](../../75-session-discovery.tji)
  — "'See replay' launches the audience surface's replay mode (visibility
  gating per ADR 0045)"; the refinement decides started-vs-ended availability.
- Audience replay route (verbatim from the audience surface's own router,
  mounted under the root app's `/a` basename):
  [`apps/audience/src/App.tsx:195-196`](../../../apps/audience/src/App.tsx) —
  `<Route path="/replay/:sessionId">` and `/:locale/replay/:sessionId` ⇒
  `/a/replay/:id`. (The live `/sessions/:id` variant is `sd_join_live_link`'s
  destination; this task uses the replay variant.)
- Predecessor affordance pattern to mirror exactly:
  [`apps/root/src/discovery/joinLiveHref.ts`](../../../apps/root/src/discovery/joinLiveHref.ts)
  (pure `(row, role) → href|null`) +
  [`apps/root/src/discovery/JoinLiveLink.tsx`](../../../apps/root/src/discovery/JoinLiveLink.tsx)
  (localized `<Link>`, renders `null` when the href is `null`).
- The list component's per-row slot:
  [`apps/root/src/discovery/SessionList.tsx:97,409`](../../../apps/root/src/discovery/SessionList.tsx)
  (`renderRowActions`); `SessionListRow` shape at lines 51–58.
- Page wiring to extend:
  [`apps/root/src/routes/MySessionsRoute.tsx:103-110`](../../../apps/root/src/routes/MySessionsRoute.tsx)
  and
  [`apps/root/src/routes/PublicSessionsRoute.tsx:54`](../../../apps/root/src/routes/PublicSessionsRoute.tsx).
- i18n catalog `discovery` block:
  [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  (and `pt-BR.json`, `es-419.json`) — already holds `discovery.status.*`,
  `discovery.mySessions.role.*`, and the `discovery.joinLive.*` sub-block. This
  task adds a `discovery.seeReplay` sub-block.
- ADRs:
  - **0045** (audience replay surface visibility gating) — the replay routes
    live in the public audience bundle and are **reachable anonymously**, but
    the *data* is gated by the session's own visibility through the existing
    `GET /sessions/:id/events` endpoint. Authenticated viewer who `canSeeSession`
    → full log; anonymous viewer of a not-yet-public-readable session → the
    `PrivateSessionCta` sign-in affordance. The replay-anonymity predicate is
    `privacy = 'public'` **regardless of `ended_at`**. The gate lives at the
    audience route / data layer — **not** in this link.
  - **0043** (client-side replay position navigation in `@a-conversa/shell`) —
    replay is entered via the `/a/{locale}/replay/{id}` route; position
    navigation/seek is owned by downstream audience-replay leaves, not by this
    affordance. This task only needs the *entry* URL.
  - **0026** (micro-frontend root app dispatches surface bundles by URL prefix;
    `/a/*` → `SurfaceHost` → audience bundle).
  - **0024** (`react-i18next` + ICU; three locales en-US/pt-BR/es-419;
    render-layer localization only — no English-coded enum leakage).
  - **0022** (every verification is a committed test).

## Constraints / requirements

1. **Availability gate: ended rows only.** The "see replay" affordance is
   shown when, and only when, the row is **ended** (`endedAt != null`). Lobby
   rows have no log to replay; live rows are served by join-live (joining the
   live audience feed is the head of the same log, so a parallel "replay"
   action would be redundant and confusing). Implement as a pure function over
   the row so it is exhaustively unit-testable independent of React. See
   Decision D2 for the started-inclusive alternative and why it was rejected.

2. **Role-agnostic — no `role` parameter.** Replay visibility is enforced at
   the audience route / data layer by session **privacy** (ADR 0045), not by
   the caller's role, so the affordance does not branch on role. The helper
   takes only the row. (This is the key shape difference from `joinLiveHref`,
   which needs role to pick `/m` vs `/p` vs `/a`.) Both lists therefore show
   the same replay link for an ended row; My Sessions owners reach their own
   private replays through the authenticated endpoint, public rows are public.

3. **`null` href ⇒ no link rendered.** For non-ended rows the helper returns
   `null` and the component renders nothing — matching `JoinLiveLink`'s
   contract, so the two affordances compose in one cell without conflict
   (disjoint lifecycle states: join-live = lobby/live, see-replay = ended).

4. **Destination is the replay route, locale-unprefixed.** Link to
   `/a/replay/:id` (no locale segment); the audience surface negotiates its own
   locale, exactly as `joinLiveHref` links `/a/sessions/:id` without a locale
   prefix.

5. **Keep `SessionList` role-agnostic and slot-driven.** The affordance lives
   in the discovery helper + link component supplied through `renderRowActions`,
   never inside `SessionList` (preserves the predecessor's deliberate seam).

6. **Cross-surface navigation uses react-router `<Link>`**, matching the
   `JoinLiveLink` / `CallToActionSection` precedent — not a raw anchor or
   `window.location`. The root `BrowserRouter` resolves `/a/*` to `SurfaceHost`,
   which lazy-loads the audience bundle (ADR 0026). No full-page reload.

7. **Localization** per ADR 0024: add a `discovery.seeReplay` block (visible
   label + accessible label) to all three catalogs (en-US, pt-BR, es-419). No
   new English-coded enum values leak into payloads.

8. **Accessibility:** the link is a real anchor (via `<Link>`) with a per-row
   accessible name (topic-interpolated, mirroring `discovery.joinLive.ariaLabel`)
   and WCAG-AA contrast; it must survive the axe checks the discovery pages run
   (ADR 0040).

## Acceptance criteria

All verifications are **committed tests per ADR 0022** — no throwaway probes.

1. **Availability/href unit test (Vitest).** Pin the pure helper across all
   three lifecycle states: ended (`endedAt != null`) → `/a/replay/:id`; live
   (`startedAt != null, endedAt == null`) → `null`; lobby (`startedAt == null`)
   → `null`. Mirrors `joinLiveHref.test.ts`.
2. **Component test (Vitest + RTL).** Render the see-replay link for an ended
   row and assert the resolved `href` (`/a/replay/:id`) and the localized
   accessible name; assert nothing is rendered for a live and a lobby row.
3. **Page-wiring tests (Vitest).** Extend the existing `MySessionsRoute` and
   `PublicSessionsRoute` test files: an ended row's actions cell renders the
   see-replay link (alongside the role badge in My Sessions; standalone in
   Public); a live/lobby row does not. Confirms the two affordances coexist in
   the one `renderRowActions` cell.
4. **i18n completeness.** The existing catalog-parity test
   (`packages/i18n-catalogs`) stays green with `discovery.seeReplay.*` present
   in all three locales.
5. **e2e — already owned by `sd_e2e`, no new debt.** The discovery Playwright
   task `sd_e2e` (`tasks/75-session-discovery.tji:87-91`, `depends !sd_frontend`)
   already enumerates the see-replay e2e: "see-replay lands in the audience
   replay surface." The affordance is reachable on already-routed pages
   (`/sessions/mine`, `/sessions`), so e2e is **not** deferred to a future
   wiring task — the centralized discovery spec running after all of
   `sd_frontend` exercises it. No future task to register. (This follows the
   sibling `sd_join_live_link`'s precedent exactly.)

## Decisions

- **D1 — Pure availability helper + thin link component, in
  `apps/root/src/discovery/`.** Add `seeReplayHref(row): string | null`
  (e.g. `seeReplayHref.ts`) returning `/a/replay/${id}` for ended rows and
  `null` otherwise, plus a `SeeReplayLink` component that renders a localized
  `<Link>` when the href is non-null. Directly mirrors the sibling
  `joinLiveHref.ts` + `JoinLiveLink.tsx` split. *Alternatives rejected:*
  (a) inlining the gate into each page's `renderRowActions` — duplicates the
  rule across two call sites and resists exhaustive unit testing; (b) folding
  see-replay into `joinLiveHref` as a fourth column — conflates two
  destinations with different gates (join-live keys on role, see-replay does
  not) and would force a role parameter the replay link does not want.

- **D2 — Availability is ended-only, not all-started.** The WBS note frames the
  choice as "started vs. ended." Chosen: **ended-only** (`endedAt != null`).
  Rationale: (1) it keeps see-replay strictly **disjoint** from join-live
  (lobby/live), so each row shows exactly one primary action and the shared
  actions cell never offers two competing "enter the session" links; (2) a live
  session's replay head *is* its live feed — "join live" already lands the user
  there, so a parallel replay link is redundant; (3) ADR 0045's
  `privacy='public'` (regardless of `ended_at`) predicate is about *data* access
  at the audience route, not about *when the discovery UI should surface the
  affordance* — the route remains free to serve a live session's log if reached
  directly. *Alternative rejected — started-inclusive (live + ended):* would
  double up with join-live on every live row, contradict `sd_join_live_link`'s
  Decision D4 ("disjoint lifecycle states"), and add UI ambiguity for no user
  benefit, since live rows already route to the live audience feed.

- **D3 — No role parameter; gating is the audience route's job.** Per
  Constraint 2, replay visibility is enforced server-side by session privacy
  (ADR 0045), so the link is identical for every viewer of an ended row. The
  authenticated owner of a private ended session reaches their replay through
  the existing authenticated `GET /sessions/:id/events`; an anonymous viewer of
  a not-yet-anonymously-readable session gets `PrivateSessionCta`. *Alternative
  rejected:* hiding the link for rows the caller "can't see" — the discovery
  endpoints only ever return rows the caller is entitled to list (own sessions,
  or public sessions), so there is nothing extra to hide, and replicating the
  ADR 0045 gate client-side would duplicate authority and risk drift.

- **D4 — Destination `/a/replay/:id`, locale-unprefixed.** Use the audience
  replay route (`apps/audience/src/App.tsx:195-196`) without a locale segment,
  matching `joinLiveHref`'s locale-free `/a/sessions/:id`; the audience surface
  negotiates locale itself (ADR 0024). *Alternative rejected:* prefixing the
  active locale (`/a/{locale}/replay/:id`) — inconsistent with the established
  join-live link and unnecessary, since the surface owns locale negotiation.

- **D5 — Helper/component live in the root app, not a shared package.** Same
  rationale as `sd_join_live_link` D5: replay navigation targets a root-app-
  mounted surface and depends on the root router's `/a` dispatch (ADR 0026); no
  consumer exists outside the root app today. *Alternative rejected:* a shared
  package now — speculative, YAGNI.

- **D6 — Both affordances share the one `renderRowActions` cell.** This task
  adds `SeeReplayLink` beside the existing badge/`JoinLiveLink` in each page's
  slot. Because join-live (lobby/live) and see-replay (ended) are non-null for
  disjoint lifecycle states (D2), a row shows exactly one of them. *Alternative
  rejected:* a second `SessionList` render slot — unnecessary API surface; one
  composed cell suffices, consistent with `sd_join_live_link` D4.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-13.

- Pure availability helper `apps/root/src/discovery/seeReplayHref.ts` — returns `/a/replay/:id` for ended rows (`endedAt != null`), `null` for lobby/live; role-agnostic.
- Unit tests `apps/root/src/discovery/seeReplayHref.test.ts` — three lifecycle cases: ended → href, live → null, lobby → null.
- Link component `apps/root/src/discovery/SeeReplayLink.tsx` — thin localized `<Link>` that renders nothing when href is null, mirrors `JoinLiveLink` shape exactly.
- Component tests `apps/root/src/discovery/SeeReplayLink.test.tsx` — ended href+a11y label assertions; null for live/lobby.
- `apps/root/src/routes/MySessionsRoute.tsx` wired: `SeeReplayLink` added beside `SessionRoleBadge` + `JoinLiveLink` in `renderRowActions`.
- `apps/root/src/routes/PublicSessionsRoute.tsx` wired: `SeeReplayLink` added beside `JoinLiveLink` in `renderRowActions`.
- `apps/root/src/routes/MySessionsRoute.test.tsx` extended: ended row shows see-replay and role badge, no join-live.
- `apps/root/src/routes/PublicSessionsRoute.test.tsx` extended: ended public row shows see-replay, no join-live.
- i18n catalogs (`en-US.json`, `pt-BR.json`, `es-419.json`) — `discovery.seeReplay.label` and `discovery.seeReplay.ariaLabel` added to all three locales.
