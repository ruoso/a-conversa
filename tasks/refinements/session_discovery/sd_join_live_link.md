# sd_join_live_link — Role-aware "join live" routing

## TaskJuggler entry

`session_discovery.sd_frontend.sd_join_live_link`, defined in
[`tasks/75-session-discovery.tji:72`](../../75-session-discovery.tji).
Back-link `note` on that task points here.

## Effort estimate

1d (from the WBS).

## Inherited dependencies

`depends !sd_session_list_component` — the shared list component and both
discovery pages are already shipped:

**Settled (landed):**

- `sd_schema` — `sessions.started_at TIMESTAMPTZ NULL` exists; NULL ⟺ lobby,
  non-NULL ⟺ started. `ended_at` already existed (NULL ⟺ live).
- `sd_my_sessions_endpoint` — `GET /api/sessions/mine` returns each row with a
  single `role` enum (`host` | `moderator` | `debater-A` | `debater-B`) plus
  `startedAt` / `endedAt`. The fetcher
  (`apps/root/src/discovery/mySessionsFetcher.ts`) surfaces this as a
  `MySessionRole` type and a per-id `roles` map.
- `sd_public_sessions_endpoint` — `GET /api/sessions/public` returns only
  `privacy='public' AND started_at IS NOT NULL` rows, carrying just
  `id`/`topic`/`startedAt`/`endedAt` (no role, no lobby rows).
- `sd_session_list_component` —
  [`apps/root/src/discovery/SessionList.tsx`](../../../apps/root/src/discovery/SessionList.tsx)
  exposes a role-agnostic `renderRowActions?: (row: SessionListRow) => ReactNode`
  slot (lines 88–106). `SessionListRow` is
  `{ id, topic, startedAt: string|null, endedAt: string|null }` (lines 51–58).
  The component derives a lifecycle status (lobby/live/ended) from
  `startedAt`/`endedAt` for its own status column; this task derives the same
  status independently for routing.
- `sd_my_sessions_page` —
  [`apps/root/src/routes/MySessionsRoute.tsx:102`](../../../apps/root/src/routes/MySessionsRoute.tsx)
  passes `renderRowActions={(row) => <SessionRoleBadge role={roleById.current.get(row.id)} />}`,
  with `roleById` a stable `useRef(Map<string, MySessionRole>)` populated from
  the fetcher's `roles` map. The page is routed at `/sessions/mine`.
- `sd_public_sessions_page` —
  [`apps/root/src/routes/PublicSessionsRoute.tsx:49`](../../../apps/root/src/routes/PublicSessionsRoute.tsx)
  mounts `<SessionList fetchPage={fetchPublicSessions} lobbyRowsPossible={false} />`
  with **no** `renderRowActions` (explicitly deferred to this task and
  `sd_see_replay_link`). The page is routed at `/sessions`.

**Pending (downstream, not blocking):**

- `sd_see_replay_link` (sibling, also `depends !sd_session_list_component`) —
  owns the "see replay" affordance for ended/started rows. This task owns
  "join live" only; the two affordances share the actions cell (see Decisions
  D4).
- `sd_e2e` (`depends !sd_frontend`) — already enumerates the join-live
  Playwright coverage for this task (see Acceptance criteria).

## What this task is

Add the per-row **"join live"** affordance to the discovery lists and route it
to the correct micro-frontend surface based on the caller's role and the
session's lifecycle state:

- **host / moderator** → moderator surface (`/m/*`)
- **debater-A / debater-B** → participant surface (`/p/*`)
- **everyone else** (the public list's anonymous rows) → audience surface
  (`/a/*`)

Lobby-mode sessions route the moderator/participant into their **lobby** view;
started (live) sessions route them into their operate/debate view. The audience
link applies only to **started** sessions. Ended sessions get no join-live link
(that's `sd_see_replay_link`'s territory).

Concretely: a pure routing helper + a small localized link component, wired
into the `renderRowActions` slot of both pages.

## Why it needs to be done

The two discovery pages render rows but, today, only My Sessions shows a role
badge and neither offers a way to actually *get into* the session. This is the
payoff of the whole discovery feature: a returning user clicks a row and lands
in the right surface without thinking about which URL prefix corresponds to
their role. The role annotation already travels with each My Sessions row
precisely so the client can route without a second request
(`tasks/75-session-discovery.tji:18-20`); this task consumes it.

## Inputs / context

- WBS task + product constraints:
  [`tasks/75-session-discovery.tji:18-22,72-77`](../../75-session-discovery.tji).
- Surface route paths (verbatim from each surface's own router, mounted under
  its `/{m,p,a}` basename by the root app):
  - Moderator —
    [`apps/moderator/src/App.tsx:62,70`](../../../apps/moderator/src/App.tsx):
    lobby `/sessions/:id/lobby` ⇒ `/m/sessions/:id/lobby`; operate
    `/sessions/:id/operate` ⇒ `/m/sessions/:id/operate`.
  - Participant —
    [`apps/participant/src/App.tsx:133-135`](../../../apps/participant/src/App.tsx):
    invite `/sessions/:id/invite`, lobby `/sessions/:id/lobby`, live
    `/sessions/:id` ⇒ `/p/sessions/:id/lobby` and `/p/sessions/:id`.
  - Audience —
    [`apps/audience/src/App.tsx:182,195`](../../../apps/audience/src/App.tsx):
    live `/sessions/:sessionId` ⇒ `/a/sessions/:id` (replay
    `/replay/:sessionId` belongs to `sd_see_replay_link`).
- Root app router:
  [`apps/root/src/main.tsx:28`](../../../apps/root/src/main.tsx) wraps the app
  in a single `BrowserRouter`;
  [`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx) routes `/m/*`,
  `/p/*`, `/a/*` to `SurfaceHost` (lazy-loaded surface bundles per ADR 0026).
  `SurfaceHost` owns the auth gate (unauthenticated → redirect to `/login`
  with `return-to`).
- Established cross-surface navigation pattern: react-router `<Link to="…">`,
  e.g.
  [`apps/root/src/landing/CallToActionSection.tsx:54`](../../../apps/root/src/landing/CallToActionSection.tsx)
  (`<Link to="/m/sessions/new">`). The root `BrowserRouter` resolves the
  `/m/*` route to `SurfaceHost`, which mounts the surface bundle and applies
  the auth gate. No full-page reload is needed.
- i18n catalog `discovery` block:
  [`packages/i18n-catalogs/src/catalogs/en-US.json:2-54`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  (and `pt-BR.json`, `es-419.json`) — already holds
  `discovery.status.{lobby,live,ended}` and `discovery.mySessions.role.*`. This
  task adds a `discovery.joinLive` sub-block.
- `SessionRoleBadge` —
  [`apps/root/src/discovery/SessionRoleBadge.tsx`](../../../apps/root/src/discovery/SessionRoleBadge.tsx)
  (props: `role?: MySessionRole`; collapses `debater-A`/`debater-B` →
  `debater`). The companion convention for this task's component.
- ADRs: **0026** (micro-frontend root app dispatches surface bundles by URL
  prefix), **0024** (`react-i18next` + ICU; three locales; enum values stay
  English-coded in payloads, localization is render-layer-only), **0022**
  (every verification is a committed test).

## Constraints / requirements

1. **Routing matrix is the load-bearing logic.** Implement it as a pure
   function over `(row, role)` so it can be unit-tested exhaustively
   independent of React:

   | role (from `/mine`) | lobby (`startedAt==null`) | live (`startedAt!=null, endedAt==null`) | ended (`endedAt!=null`) |
   |---|---|---|---|
   | `host` / `moderator` | `/m/sessions/:id/lobby` | `/m/sessions/:id/operate` | — (no join-live) |
   | `debater-A` / `debater-B` | `/p/sessions/:id/lobby` | `/p/sessions/:id` | — |
   | `undefined` (public/anon) | — (unreachable¹) | `/a/sessions/:id` | — |

   ¹ The public list is started-only (`lobbyRowsPossible={false}`, endpoint
   gate), and My Sessions rows always carry a role, so the
   undefined-role-on-lobby cell never occurs; the helper returns `null`
   defensively.

2. **Debaters route into their slot, not the invite flow.** A `debater-A/-B`
   row means the caller already holds that slot (it came from a
   `session_participants` row), so route to lobby/live — `/p/sessions/:id/invite`
   is for *claiming* an unfilled slot and is out of scope here.

3. **`null` href ⇒ no link rendered.** When the matrix yields `null` (ended
   sessions, the defensive lobby/anon cell), the component renders nothing for
   the join-live affordance — the row's see-replay affordance (sibling task)
   covers ended rows.

4. **Keep `SessionList` role-agnostic.** Routing lives in the discovery helper
   + link component supplied through `renderRowActions`, never inside
   `SessionList` (preserves the predecessor's deliberate seam — `SessionListRow`
   has no `role` field).

5. **Cross-surface navigation uses react-router `<Link>`**, matching the
   `CallToActionSection` precedent — not a raw anchor or `window.location`.
   Auth enforcement is `SurfaceHost`'s job, not this component's; an
   unauthenticated click on a `/m` or `/p` link is correctly bounced through
   `/login` by the existing gate.

6. **Localization** per ADR 0024: add a `discovery.joinLive` block (visible
   label + accessible label) to all three catalogs (en-US, pt-BR, es-419).
   No new English-coded enum values leak into payloads.

7. **Accessibility:** the link is a real anchor (via `<Link>`) with an
   accessible name; it must survive the axe checks the discovery surface
   already runs.

## Acceptance criteria

All verifications are **committed tests per ADR 0022** — no throwaway probes.

1. **Routing-matrix unit test (Vitest).** Exhaustively pin the helper: every
   `(role, lifecycle-status)` cell of the matrix above maps to the exact
   expected href string (or `null`). Includes: `host`/`moderator` lobby→`/m/…/lobby`
   and live→`/m/…/operate`; `debater-A`/`debater-B` lobby→`/p/…/lobby` and
   live→`/p/sessions/:id`; `undefined` live→`/a/sessions/:id`; all `ended` and the
   defensive cells→`null`.
2. **Component test (Vitest + RTL).** Render the join-live link for
   representative rows and assert the resolved `href` attribute and the
   localized accessible name; assert nothing is rendered when the matrix yields
   `null`.
3. **Page-wiring tests (Vitest).** `MySessionsRoute` row actions render the
   role badge *and* a join-live link with the role-correct href;
   `PublicSessionsRoute` row actions render a join-live link routing to
   `/a/sessions/:id` for a started public row. (Extends the existing
   `MySessionsRoute`/`PublicSessionsRoute` test files.)
4. **i18n completeness.** The existing catalog-parity test
   (`packages/i18n-catalogs`) stays green with `discovery.joinLive.*` present
   in all three locales.
5. **e2e — already owned by `sd_e2e`, no new debt.** The discovery Playwright
   task `sd_e2e` (`tasks/75-session-discovery.tji:86-91`,
   `depends !sd_frontend`) already enumerates the join-live e2e: "routes
   join-live to /m, /p respectively" and "signed-out join-live on a public row
   lands in /a." This task does **not** defer new e2e debt — the affordance is
   reachable on already-routed pages, and the centralized discovery e2e spec
   (running after all of `sd_frontend`) exercises it. No future task to
   register.

## Decisions

- **D1 — Pure routing helper + thin link component, in
  `apps/root/src/discovery/`.** Add `joinLiveHref(row, role): string | null`
  (e.g. `joinLiveHref.ts`) and a `JoinLiveLink` component that renders a
  localized `<Link>` when the href is non-null. Mirrors the predecessor's
  `mySessionsFetcher.ts` + `SessionRoleBadge.tsx` split (pure logic separated
  from presentation). *Alternatives rejected:* (a) inlining the routing
  `switch` into each page's `renderRowActions` — duplicates the matrix across
  two call sites and resists exhaustive unit testing; (b) pushing routing into
  `SessionList` — breaks Constraint 4's role-agnostic seam.

- **D2 — Routing keys on `(role, lifecycle-status)`, status derived from
  `startedAt`/`endedAt`.** The helper recomputes lobby/live/ended from the row
  rather than threading a status enum, keeping it a self-contained pure
  function over the wire shape already on the row. *Alternative rejected:*
  having `SessionList` pass its derived status down — would couple the helper
  to the component's internal API for no gain.

- **D3 — Live debater lands on `/p/sessions/:id`, lobby on
  `/p/sessions/:id/lobby`; not the invite route.** Per Constraint 2 — the role
  already implies a held slot. *Alternative rejected:* routing through
  `/p/sessions/:id/invite` — that flow re-claims a slot and would be wrong for
  someone who already holds one.

- **D4 — Join-live and see-replay share the `renderRowActions` cell.** This
  task renders the join-live link (when applicable) within the same actions
  slot the role badge already occupies; `sd_see_replay_link` adds the replay
  link beside it. Both are non-null for disjoint lifecycle states (join-live:
  lobby/live; see-replay: started/ended per ADR 0045), so they compose without
  conflict. *Alternative rejected:* a second render slot on `SessionList` —
  unnecessary API surface; one actions cell composes fine.

- **D5 — Helper/component live in the root app, not a shared package.**
  Join-live routing navigates *between root-app-mounted surfaces* and depends on
  the root router's `/m`,`/p`,`/a` dispatch (ADR 0026); it has no consumer
  outside the root app today. *Alternative rejected:* a shared package now —
  speculative; YAGNI until a second consumer appears (the predecessor left the
  same door open for `SessionList` itself and chose root-app placement).

- **D6 — react-router `<Link>` for the cross-surface jump.** Follows the
  `CallToActionSection` precedent (Inputs); the root `BrowserRouter` resolves
  the surface route to `SurfaceHost`, which lazy-loads the bundle and runs the
  auth gate. *Alternative rejected:* `window.location.assign` / raw `<a>` with a
  hard reload — discards the SPA shell and the existing `return-to` auth
  handoff for no benefit, since `/m`,`/p`,`/a` are real routes in the same
  router.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-13.

- `apps/root/src/discovery/joinLiveHref.ts` — pure `(row, role) → href|null` routing matrix; exhaustively covers all 15 `(role, lifecycle)` cells of the spec matrix.
- `apps/root/src/discovery/JoinLiveLink.tsx` — localized `<Link>` component; renders nothing when the matrix returns `null`; uses `bg-emerald-700`/`bg-emerald-800` hover (WCAG AA compliant, ~4.8:1 contrast).
- `apps/root/src/discovery/joinLiveHref.test.ts` — Vitest unit test; all 15 matrix cells pinned.
- `apps/root/src/discovery/JoinLiveLink.test.tsx` — RTL component test; href/labels/null-render cases covered.
- `apps/root/src/routes/MySessionsRoute.tsx` — `renderRowActions` wired to render role badge + `JoinLiveLink` in the same cell.
- `apps/root/src/routes/MySessionsRoute.test.tsx` — extended with join-live wiring assertions.
- `apps/root/src/routes/PublicSessionsRoute.tsx` — `renderRowActions` added; renders `JoinLiveLink` routing to `/a/sessions/:id`.
- `apps/root/src/routes/PublicSessionsRoute.test.tsx` — extended with join-live wiring assertions.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `discovery.joinLive.label` and `discovery.joinLive.ariaLabel` to all three locales.
