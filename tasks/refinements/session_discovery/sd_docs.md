# sd_docs — DESIGN.md + docs update

## TaskJuggler entry

`session_discovery.sd_docs`, defined in
[`tasks/75-session-discovery.tji:96`](../../75-session-discovery.tji).
Back-link `note` on that task points here.

## Effort estimate

0.5d (from the WBS).

## Inherited dependencies

`depends !sd_e2e` — the discovery feature is fully built, reachable, and
end-to-end-pinned against the compose stack. This task records the finished
state in the prose docs; it ships **no code**. Every behavioral claim the
docs make is already pinned by a committed test (see Decisions D1).

**Settled (landed) — the feature this task documents:**

- `sd_schema` — `sessions.started_at TIMESTAMPTZ NULL`; NULL ⟺ lobby,
  non-NULL ⟺ started. `ended_at` already existed (NULL ⟺ live, non-NULL ⟺
  ended). Migration
  [`apps/server/migrations/0018_sessions_started_at.sql`](../../../apps/server/migrations/0018_sessions_started_at.sql)
  adds the column, backfills, and creates the public-list index. See
  [`sd_schema.md`](sd_schema.md).
- `sd_my_sessions_endpoint` — `GET /api/sessions/mine` (authenticated)
  ([`apps/server/src/sessions/routes.ts:2169`](../../../apps/server/src/sessions/routes.ts)),
  role-annotated rows (`host`|`moderator`|`debater-A`|`debater-B`), lobby +
  ended included. See [`sd_my_sessions_endpoint.md`](sd_my_sessions_endpoint.md).
- `sd_public_sessions_endpoint` — `GET /api/sessions/public` (anonymous)
  ([`routes.ts:2336`](../../../apps/server/src/sessions/routes.ts)); the gate
  is `privacy = 'public' AND started_at IS NOT NULL`
  ([`routes.ts:2406`](../../../apps/server/src/sessions/routes.ts)) — the
  load-bearing lobby-secrecy rule, listing-fields-only, no host identity / no
  participant data. See
  [`sd_public_sessions_endpoint.md`](sd_public_sessions_endpoint.md).
- `sd_session_list_component` —
  [`apps/root/src/discovery/SessionList.tsx`](../../../apps/root/src/discovery/SessionList.tsx)
  (shared search / date-filter / pagination / status-column list with a
  `renderRowActions` slot).
- `sd_my_sessions_page` —
  [`apps/root/src/routes/MySessionsRoute.tsx`](../../../apps/root/src/routes/MySessionsRoute.tsx)
  at `/sessions/mine` (auth-gated).
- `sd_public_sessions_page` —
  [`apps/root/src/routes/PublicSessionsRoute.tsx`](../../../apps/root/src/routes/PublicSessionsRoute.tsx)
  at `/sessions` (anonymous).
- `sd_join_live_link` —
  [`apps/root/src/discovery/joinLiveHref.ts`](../../../apps/root/src/discovery/joinLiveHref.ts)
  +
  [`apps/root/src/discovery/JoinLiveLink.tsx`](../../../apps/root/src/discovery/JoinLiveLink.tsx).
  Role-aware matrix: host/moderator → `/m/sessions/:id/{lobby,operate}`;
  debater-A/-B → `/p/sessions/:id/lobby` (lobby) / `/p/sessions/:id` (live);
  anon public → `/a/sessions/:id`; ended → no link.
- `sd_see_replay_link` —
  [`apps/root/src/discovery/seeReplayHref.ts`](../../../apps/root/src/discovery/seeReplayHref.ts)
  +
  [`apps/root/src/discovery/SeeReplayLink.tsx`](../../../apps/root/src/discovery/SeeReplayLink.tsx).
  Ended rows only → `/a/replay/:id`.
- `sd_e2e` —
  [`tests/e2e/discovery-flows.spec.ts`](../../../tests/e2e/discovery-flows.spec.ts)
  drives the whole assembled feature cross-surface. See [`sd_e2e.md`](sd_e2e.md).

**Pending:** none. This is the last leaf in M11 (`m_session_discovery`);
all other `session_discovery.*` leaves are at 100%. Closing this task closes
the milestone.

## What this task is

A docs-only pass that folds the finished Session Discovery feature into the
prose design record so a future developer learns the feature from the docs,
not by reverse-engineering the routes. Three edits:

1. **`DESIGN.md`** — a short product-level account of session discovery: that
   a returning user finds their own sessions and an anonymous visitor browses
   public ones, the lobby-secrecy promise, and the role-aware entry points
   into the existing `/m`, `/p`, `/a` surfaces.
2. **`docs/architecture.md`** — the engineering shape: the two listing
   endpoints, the `started_at` lifecycle marker and the lobby-secrecy gate,
   the shared root-app discovery surface and its routes, and how a list row
   dispatches into a surface.
3. **`docs/adr/0029` amendment pass** — 0029's Consequences currently assert
   "HTTP routes continue to require a valid cookie." The shipped anonymous
   `GET /api/sessions/public` is the first HTTP route to relax that. Amend
   0029 in place (Decisions D2) to record the extension and its distinct gate.

## Why it needs to be done

`DESIGN.md` and `docs/architecture.md` are the canonical entry points for
anyone picking up the system (the
[memory index](../../../DESIGN.md) names `DESIGN.md` as the design doc to read
first). Today neither mentions session discovery at all: `DESIGN.md` has no
session-lifecycle or discovery section, and `docs/architecture.md`'s
"Sessions and the global graph" (`docs/architecture.md:11`) and "Frontend
surfaces" (`docs/architecture.md:77`) sections predate the feature — they
describe entering a session by direct URL, with no listing surface and no
lobby state. A reader cannot discover that `/sessions` and `/sessions/mine`
exist, nor that the public list deliberately hides lobby sessions, from the
current prose. The amendment pass is required because the anonymous HTTP
listing endpoint contradicts a Consequence that ADR 0029 wrote down as a
boundary; leaving 0029 unamended would make the ADR record actively wrong
(the ADR README amendment-pass rule,
[`docs/adr/README.md:14-22`](../../../docs/adr/README.md), exists for exactly
this case). The task also gates milestone M11.

## Inputs / context

- **WBS task + product constraints (the lobby-secrecy rule and role-aware
  entry points to document):**
  [`tasks/75-session-discovery.tji:10-22,96-101`](../../75-session-discovery.tji).
- **DESIGN.md current shape** — headings: Vision (`DESIGN.md:7`), Format
  (`DESIGN.md:15`), Diagnostic goals (`:24`), Two orthogonal classifications
  (`:30`), Document index (`:34`), Languages (`:43`), Out of scope (`:47`),
  Open questions (`:53`). No session-discovery section exists; the Document
  index already points at `docs/architecture.md` for "sessions … frontend
  surfaces … replay."
- **docs/architecture.md current shape** — relevant headings: "Sessions and
  the global graph" (`docs/architecture.md:11`), "State model: event-sourced"
  (`:43`), "Replay" (`:69`), "Frontend surfaces" (`:77`, lists the `/m`/`/p`/`/a`
  surfaces and `/{locale}/sessions/{id}` / `/{locale}/replay/{id}` routes),
  "Identity" (`:111`). No listing endpoints, no `started_at`, no lobby state
  documented anywhere.
- **The endpoints, verbatim from the handlers (cite these, don't paraphrase
  the gate):**
  - `GET /api/sessions/mine` — authenticated, role-annotated, lobby + ended
    included
    ([`apps/server/src/sessions/routes.ts:2169`](../../../apps/server/src/sessions/routes.ts)).
  - `GET /api/sessions/public` — anonymous, gate
    `privacy = 'public' AND started_at IS NOT NULL`
    ([`routes.ts:2336,2406`](../../../apps/server/src/sessions/routes.ts)),
    listing-fields-only.
- **The lifecycle markers** — `started_at` (NULL ⟺ lobby) and `ended_at`
  (NULL ⟺ live) on the `sessions` row; migration
  [`apps/server/migrations/0018_sessions_started_at.sql`](../../../apps/server/migrations/0018_sessions_started_at.sql).
- **The role-aware routing matrix to render in prose** —
  [`apps/root/src/discovery/joinLiveHref.ts`](../../../apps/root/src/discovery/joinLiveHref.ts)
  +
  [`apps/root/src/discovery/seeReplayHref.ts`](../../../apps/root/src/discovery/seeReplayHref.ts):
  host/moderator → `/m/sessions/:id/{lobby,operate}`; debater → `/p/sessions/:id/{lobby,·}`;
  anon public → `/a/sessions/:id`; ended → `/a/replay/:id`.
- **ADR 0029** —
  [`docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md`](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md).
  Decides anonymous **WS subscribe** for public, **live** (`ended_at IS NULL`)
  sessions. Its Consequences include "HTTP routes continue to require a valid
  cookie" and "`canSeeSessionAnonymously` … PUBLIC + not-ended only." Heading
  structure: Context / Decision / Consequences / Alternatives considered /
  Stack-validation tests / Amendments. It already carries one prior
  `## Amendments` entry (2026-06-05, deferring anonymous catch-up to ADR 0045).
- **ADR amendment-pass convention** —
  [`docs/adr/README.md:14-22`](../../../docs/adr/README.md): "update
  operational text in place AND append a one-line `## Amendments` entry stating
  what changed and linking to the new ADR. Decision/Context stay untouched.
  Historical Amendment text is itself immutable — never edit a prior
  amendment, only add new ones."
- **Doc-only commit gate** — per the established convention, a commit touching
  only docs/refinements skips the global build+test gate; the pre-commit hook
  is the safety net
  ([`docs/dev-environment.md`](../../../docs/dev-environment.md)).

## Constraints / requirements

1. **Docs-only; no code, no schema, no test files.** The edits are confined to
   `DESIGN.md`, `docs/architecture.md`, and
   `docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md`. No source,
   migration, or spec file changes.
2. **Describe only shipped behavior.** Every behavioral assertion the prose
   makes must already be true of the code and pinned by a committed test (the
   endpoint Cucumber scenarios and `discovery-flows.spec.ts`). Do not document
   aspirational or deferred behavior as if it shipped.
3. **The lobby-secrecy rule stated exactly.** The public list shows
   `privacy = 'public' AND started_at IS NOT NULL` — public **and started**.
   Unstarted (lobby) public sessions and all private sessions are absent. State
   that the gate lives server-side in the endpoint, not just in the UI; the UI
   pin is defence in depth.
4. **The public list spans live *and* ended public sessions.** Unlike the WS
   subscribe gate (which requires `ended_at IS NULL`), the listing gate is
   `started_at`-only, so an ended public session still appears — that is the
   discovery path to its replay (`/a/replay/:id`). Document this divergence and
   defer replay-content visibility to ADR 0045 rather than restating it.
5. **`My Sessions` is the authenticated, role-annotated counterpart.** It
   includes the caller's lobby and ended sessions and carries the role badge
   that drives the join-live destination. Note it requires a valid cookie
   (unchanged HTTP posture).
6. **ADR amendments follow the README mechanic.** Update 0029's stale
   operational text in place, append a new dated `## Amendments` entry; leave
   Context/Decision and the prior amendment untouched.
7. **No invented routes or endpoints.** Use the real paths above. The surfaces
   are the existing `/m`, `/p`, `/a` micro-frontends (ADR 0026); discovery
   adds list surfaces in the root app, not new surfaces.

## Acceptance criteria

This task ships **no executable verification** — it is a docs-only commit, so
the [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
"no-throwaway-verifications" rule is satisfied vacuously: there is no probe to
promote to a committed test because there is no code under test. The
behavioral claims the docs make are *already* pinned by the committed tests
that landed with the feature (the `my-sessions` / `public-sessions` Cucumber
features and `tests/e2e/discovery-flows.spec.ts`); this task adds prose, not
guarantees. Acceptance is therefore by review against these concrete checks:

1. **`DESIGN.md` gains a session-discovery account.** A reader learns, from
   `DESIGN.md` alone, that (a) a returning authenticated user finds their own
   sessions and an anonymous visitor browses public ones; (b) the public list
   deliberately hides lobby (unstarted) and private sessions — the
   lobby-secrecy promise; (c) a list row routes the visitor into the right
   existing surface by role/lifecycle. Cross-links to
   `docs/architecture.md` for the engineering shape.
2. **`docs/architecture.md` documents the engineering shape.** It names both
   endpoints (`GET /api/sessions/mine`, `GET /api/sessions/public`), the
   `started_at`/`ended_at` lifecycle markers and the server-side lobby-secrecy
   gate, the root-app discovery routes (`/sessions`, `/sessions/mine`), and the
   role-aware dispatch into `/m`/`/p`/`/a`. The public-list gate is quoted as
   `privacy = 'public' AND started_at IS NOT NULL` and its live-and-ended span
   is stated.
3. **ADR 0029 is amended, not rewritten.** The stale "HTTP routes continue to
   require a valid cookie" Consequence is corrected in place to carve out the
   anonymous read-only `GET /api/sessions/public` listing (and its distinct
   `started_at`-based gate, vs the WS path's `ended_at IS NULL`); a new dated
   `## Amendments` entry records the change. Context, Decision, and the prior
   2026-06-05 amendment are untouched. `grep -n "valid cookie" docs/adr/0029-*.md`
   no longer reads as an absolute.
4. **No dangling references.** Every file path / route / endpoint named in the
   new prose resolves to a real artifact (the implementer spot-checks the
   added links the way the predecessor refinements' links resolve).

**No future task is registered.** This task closes M11; nothing is deferred to
a successor WBS leaf (see Decisions D3 for the one item routed to the parking
lot instead).

## Decisions

- **D1 — Docs follow the tests; the tests are the source of truth, not the
  prose.** The committed endpoint Cucumber scenarios and
  `discovery-flows.spec.ts` are the authoritative record of *what the feature
  does*; this task's prose is a human-readable index into that behavior. The
  docs therefore describe only what those tests already pin (Constraint 2), and
  this is why a docs-only commit is acceptable under ADR 0022 — there is no
  unverified claim being introduced. *Alternative rejected:* treating the docs
  as a second, independent specification that could drift from the tests —
  two sources of truth for the same behavior is exactly the drift the
  task-completion ritual exists to prevent.

- **D2 — Amend ADR 0029 in place; do not write a new anonymous-HTTP-listing
  ADR.** The anonymous-access *principle* is identical across the two
  transports: public-only, existence-non-leak (a hidden session is
  indistinguishable from a nonexistent one), and no synthesized anonymous
  identity. The HTTP listing applies that same posture to a second transport;
  it is not a new principle, and 0029 is literally the
  "anonymous-access-for-public-sessions" decision record. Keeping the policy in
  one ADR — extended by an amendment that notes the HTTP listing's *stricter*
  `started_at`-based gate (lobby-secrecy) and its *wider* live-and-ended span —
  is more legible than fragmenting anonymous-public-access across two ADRs a
  reader must reconcile. The TJI note (`:100`) and both endpoint refinements
  (`sd_public_sessions_endpoint`, `sd_my_sessions_endpoint`) already framed this
  as "a scope extension of 0029, not a new ADR." *Alternatives rejected:*
  (a) a new ADR (e.g. `0050-anonymous-http-session-listing`) — defensible, but
  it would split one anonymous-access policy across two records and still
  require the 0029 amendment to correct the now-false Consequence, so it adds a
  document without removing the amendment; (b) leaving 0029 unamended and only
  documenting the endpoint in `architecture.md` — leaves the ADR record stating
  a boundary the system no longer honors, the precise staleness the
  amendment-pass rule forbids.

- **D3 — A pt-BR / es-419 native-speaker review of the `discovery.*` catalog
  strings is *not* a WBS task.** The discovery UI strings shipped in all three
  locale catalogs with the page tasks, and catalog parity is already pinned by
  the i18n-catalog parity test. A *translation-quality* sign-off is a human
  judgment call, not agent-implementable work, so it must not become a WBS leaf
  (the brief's "never defer to an audit/revisit task" rule). It is surfaced in
  this refinement's return summary for the parking lot
  (`tasks/parking-lot.md`), not registered as a successor task. *Alternative
  rejected:* a `sd_i18n_review` leaf — it would be picked up by the
  orchestrator, fail to resolve (no implementer can sign off native-speaker
  quality), and spawn a successor — the self-perpetuating loop the brief warns
  against.

- **D4 — Document discovery under the existing session sections, no new
  top-level doc.** In `DESIGN.md` the account attaches to the session/format
  narrative; in `architecture.md` it extends "Sessions and the global graph"
  and "Frontend surfaces" rather than adding a peer top-level section. The
  feature is an entry surface onto existing sessions, not a new subsystem, so it
  belongs beside the session prose it depends on. *Alternative rejected:* a
  standalone `docs/session-discovery.md` — over-weights a 0.5d listing feature
  and scatters session prose across two files; the Document index already
  points readers at `architecture.md` for sessions and surfaces.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-13.

- `DESIGN.md`: added "Finding and entering sessions" section — My/Public list overview, lobby-secrecy promise (`privacy = 'public' AND started_at IS NOT NULL`), role-aware entry matrix into `/m`/`/p`/`/a` surfaces; cross-links `docs/architecture.md`.
- `docs/architecture.md`: added "Session lifecycle markers" + "Session discovery" under Sessions (both endpoints, `started_at` gate quoted verbatim, live-and-ended span, WS-vs-HTTP divergence) and "Discovery surface" under Frontend surfaces (`/sessions`, `/sessions/mine`, role×lifecycle dispatch table).
- `docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md`: corrected stale "HTTP routes continue to require a valid cookie" Consequence to carve out anonymous read-only `GET /api/sessions/public`; appended dated `2026-06-13` Amendments entry recording the stricter `started_at` gate and wider live-and-ended span; Context/Decision and prior 2026-06-05 amendment untouched.
- No code, schema, or test changes — docs-only commit per constraint; behavioral claims already pinned by Cucumber endpoint scenarios and `tests/e2e/discovery-flows.spec.ts`.
- Tech-debt follow-up: pt-BR/es-419 native-speaker review of `discovery.*` catalog strings is not a WBS task (human judgment, not agent-implementable); covered by the existing parking-lot umbrella entry (2026-05-30 — "do not append per-key entries").
- Closes milestone M11 (`m_session_discovery`) — last unmet dependency.
