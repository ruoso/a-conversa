# sd_session_list_component — Shared paginated session-list component

## TaskJuggler entry

`session_discovery.sd_frontend.sd_session_list_component` — defined in
[`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 51–56).
Back-link: this refinement expands the one-line note there.

Part of milestone **M11 `m_session_discovery`** (`tasks/99-milestones.tji`,
registered 2026-06-12). First task under the `sd_frontend` group; the
foundation the four sibling `sd_frontend` tasks build on
(`sd_my_sessions_page`, `sd_public_sessions_page`, `sd_join_live_link`,
`sd_see_replay_link` all `depends !sd_session_list_component`).

## Effort estimate

2d (`effort 2d`, `allocate team`).

## Inherited dependencies

`depends !!sd_api` — both list endpoints (`sd_my_sessions_endpoint`,
`sd_public_sessions_endpoint`) are settled.

- **Settled** — `GET /api/sessions/mine` (authenticated, role-annotated) returns
  `{ sessions: MySessionResponse[]; total: integer }`, each row
  `{ id, hostUserId, privacy, topic, createdAt, startedAt, endedAt, role }` with
  `role ∈ { host, moderator, debater-A, debater-B }`; sorted
  `started_at DESC NULLS FIRST, created_at DESC` (lobby rows first). Done
  2026-06-12 (`tasks/refinements/session_discovery/sd_my_sessions_endpoint.md`).
- **Settled** — `GET /api/sessions/public` (anonymous, started-only) returns
  `{ sessions: PublicSessionResponse[]; total: integer }`, each row exactly
  `{ id, topic, startedAt, endedAt }` (no host identity, no privacy, no role);
  sorted `started_at DESC, created_at DESC`. Done 2026-06-12
  (`tasks/refinements/session_discovery/sd_public_sessions_endpoint.md`).
- **Settled** — both endpoints share the same query-param surface:
  `topic` (substring, bounded `MIN_TOPIC_SEARCH_LENGTH`=3 ..
  `MAX_TOPIC_SEARCH_LENGTH`=64), `startedAfter` / `startedBefore`
  (ISO-8601 `date-time`, on `started_at`), `limit` (default 50, max 200),
  `offset` (default 0, max `MAX_SESSION_LIST_OFFSET`=100 000), all in
  `packages/shared-types/src/limits.ts`. `total` is the full match count before
  limit/offset — the pagination denominator (clients stop when
  `offset + sessions.length >= total`). Identical param shapes by design (sd_my
  D4 / sd_public D4) precisely so one component can drive both.
- **Settled** — root-app frontend substrate: React + react-router-dom v7
  (`apps/root/`), react-i18next + ICU catalogs (ADR 0024,
  `packages/i18n-catalogs/`), Tailwind v4 (ADR 0005), Vitest +
  React Testing Library + happy-dom (ADR 0006).

## What this task is

A single reusable React component — the **presentation + interaction shell** for
both discovery lists. It renders a topic search box, a start-date range filter,
a paginated table/list of sessions sorted by start time, and a pagination
control. It owns the genuinely shared complexity: the search/filter/page **query
state**, input debouncing, the 3-char search minimum, the pagination arithmetic,
and the loading / empty / error rendering states. It does **not** know which
endpoint backs it, whether the caller is authenticated, or what a row's
"join live" / "see replay" link should be — those differences are injected by
the page that mounts it (`sd_my_sessions_page`, `sd_public_sessions_page`).

Concretely, the component takes (a) an injected async **fetcher**
`(query) => Promise<{ rows, total }>` that the page wires to its endpoint, and
(b) a per-row **actions slot** the page uses to render role badges + the
role-aware "join live" / "see replay" affordances (built by the later
`sd_join_live_link` / `sd_see_replay_link` tasks). Both pages map their
endpoint's row shape into a small shared view-model the component renders. It is
localized in en-US / pt-BR / es-419 and meets WCAG A/AA.

## Why it needs to be done

The `.tji` (lines 3–8, 50–56) calls for "My Sessions" and "Public Sessions": two
paginated, searchable lists that differ only in **data source** and **link
affordances**, not in shape. Building the search/filter/pagination/loading
machinery twice — once per page — would duplicate the only non-trivial part and
guarantee the two surfaces drift. This task factors that machinery into one
component so the two pages reduce to "supply a fetcher + supply row actions."

Everything downstream in the `sd_frontend` group depends on it:
`sd_my_sessions_page` and `sd_public_sessions_page` mount it;
`sd_join_live_link` and `sd_see_replay_link` populate its per-row actions slot;
`sd_e2e` exercises the assembled surfaces. None can start until the shared
component exists and its contract (the view-model, the fetcher signature, the
actions slot) is fixed.

## Inputs / context

- **Endpoint contracts to consume** —
  `MySessionResponse` schema (`apps/server/src/sessions/routes.ts:449-520`) and
  its `MySessionListResponse` wrapper (`routes.ts:529-567`);
  `PublicSessionResponse` schema (`routes.ts:581-610`) and its
  `PublicSessionListResponse` wrapper. Both wrappers are
  `{ sessions: Row[]; total: integer }`; `total` is the pre-limit/offset count
  (`routes.ts:538-567` documents the `offset + sessions.length >= total` stop
  condition). These are the shapes the two pages map into the component's
  view-model.
- **Search / pagination caps** — `packages/shared-types/src/limits.ts`:
  `MIN_TOPIC_SEARCH_LENGTH` (3), `MAX_TOPIC_SEARCH_LENGTH` (64),
  `MAX_SESSION_LIST_OFFSET` (100 000). The component imports these constants
  rather than spelling magic numbers — same single-source-of-truth posture the
  backend uses (D5). The endpoints already reject below-min / over-cap params
  with 400; the component mirrors the lower bound client-side (don't fire a
  search until ≥3 chars) so a too-short query is a no-op, not a 400.
- **Root app + routing** — `apps/root/src/App.tsx:40-55` (the
  `BrowserRouter`/`Routes` dispatcher; the discovery pages add routes here in
  their own tasks — this component renders no route itself). `apps/root/` is
  package `@a-conversa/root`.
- **Representative root-app component + its test** —
  `apps/root/src/landing/CallToActionSection.tsx` (a `useTranslation()` +
  Tailwind component) and `apps/root/src/landing/CallToActionSection.test.tsx`
  (driven through `apps/root/src/testing/renderWithProviders.tsx`, which wraps
  `I18nProvider` + auth context + `MemoryRouter`). This is the unit-test harness
  this component's tests use.
- **i18n** — react-i18next + ICU (ADR 0024). Source catalogs at
  `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; consumed via
  `const { t } = useTranslation()` and `t('namespace.key')`
  (e.g. `CallToActionSection.tsx`). This component adds a `discovery.*` key block
  to all three catalogs (D6).
- **Styling** — Tailwind v4 (ADR 0005), utility classes inline as in
  `CallToActionSection.tsx:46-59`. No new design-token package needed.
- **Accessibility convention** — `@axe-core/playwright` WCAG A/AA scans
  (ADR 0040) as run in `tests/e2e/landing-demo.spec.ts:416-465`, plus the
  keyboard-order / visible-focus checks (`landing-demo.spec.ts:475-535`). Axe is
  Playwright-driven; this component is not yet route-reachable, so its axe
  coverage is deferred to the page tasks that mount it (D8, and the e2e-policy
  note under Acceptance criteria).
- **Shared-vs-local package pattern** — shared packages live under `packages/*`
  with peer-dep boundaries (`@a-conversa/shell`, `@a-conversa/graph-view`,
  ADR 0039); root-app-only UI lives under `apps/root/src/` (the `landing/`,
  `routes/` folders). The placement decision (D1) turns on which of these the
  component belongs in.
- **API-call pattern** — there is no fetch-wrapper / client module; the codebase
  calls `fetch()` directly with `credentials: 'include'` for authenticated
  routes (`apps/root/src/App.tsx:20-24`). The component does **not** call
  `fetch` itself — the injected fetcher does (D2), and each page writes the
  `fetch` call its endpoint needs (mine: `credentials: 'include'`; public: plain
  anonymous `fetch`).
- **ADRs** — 0003 (React), 0005 (Tailwind), 0006 (Vitest), 0008 (Playwright),
  0022 (no throwaway verifications), 0024 (i18n), 0026 (micro-frontend root
  app), 0039 (shared read-only package precedent), 0040 (axe-playwright).

## Constraints / requirements

- **Data-source-agnostic.** The component must not import an endpoint URL, an
  auth helper, or either response schema. It receives a fetcher and a row
  view-model from its mounting page (D2). This is what lets one component back
  both an authenticated and an anonymous list.
- **One row view-model both pages map into.** The component renders a minimal
  display shape — at least `{ id, topic, startedAt, endedAt }` (the fields common
  to both endpoints) plus a lifecycle status derived from them. Per-row role
  badges and links are **not** view-model fields; they come through the actions
  slot (D2, D3).
- **Lifecycle status is derived, displayed, never re-fetched.** From
  `(startedAt, endedAt)`: `startedAt == null` ⟶ *lobby*; `startedAt != null &&
  endedAt == null` ⟶ *live*; `endedAt != null` ⟶ *ended*. The component shows a
  localized status indicator; the actions slot uses the same derivation to pick
  join-live vs see-replay (the page owns that, D3). (Public-list rows are never
  lobby — that set is started-only — so the lobby state only appears in My
  Sessions.)
- **Topic search**: a debounced text input; fires the fetcher only once the
  trimmed value is ≥ `MIN_TOPIC_SEARCH_LENGTH` (3) or empty (empty = clear
  filter); caps input at `MAX_TOPIC_SEARCH_LENGTH` (64). Below-min, non-empty
  input shows a localized hint and does not fetch (D5).
- **Date filter**: two optional date inputs (from / to) that map to
  `startedAfter` / `startedBefore`. The component converts the locale-aware day
  selection to ISO-8601 `date-time` bounds before handing them to the fetcher
  (the endpoints take `date-time`, sd_public D4). Setting either bound excludes
  lobby (NULL-`started_at`) rows server-side — so in My Sessions a date filter
  hides lobby sessions; the component surfaces this with a localized note when a
  date bound is active and lobby rows would otherwise show (D7).
- **Pagination**: prev/next controls plus a localized "showing X–Y of `total`"
  summary, driven by `(offset, limit, total)`. Next is disabled when
  `offset + rows.length >= total`; prev disabled at `offset == 0`. The component
  owns `offset`; `limit` is a prop (default `DEFAULT_PAGE_SIZE`, D4). Changing
  the search or date filter resets `offset` to 0.
- **Sort is fixed and server-owned.** Rows render in received order
  (start-time DESC, lobby-first for mine). No client-side sort toggle (the
  `.tji` fixes "sorted by start time").
- **Loading / empty / error states.** While a fetch is in flight: a loading
  affordance that does not clear the current rows abruptly (no layout thrash).
  Empty result: a localized empty-state. Fetch rejection: a localized error
  state with a retry affordance. All three are component-owned (they're identical
  for both pages).
- **Fully localized.** Every visible string resolves through `t()` against a new
  `discovery.*` block in all three catalogs (D6); no hard-coded English. ICU
  plurals/interpolation for the "showing X–Y of N" summary.
- **Accessible (WCAG A/AA).** Labeled controls (search input, date inputs,
  pagination buttons), a table/list with proper semantics and a caption/aria
  label, visible focus, keyboard-operable pagination, status communicated as
  text (not color alone). Targets the same rule set the project's axe scans
  enforce (`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`).
- **No new dependency, no new ADR-level seam.** Built from React +
  react-i18next + Tailwind already in `apps/root`. No data-fetching library, no
  table library, no new shared package (D1).

## Acceptance criteria

Per ADR 0022, every check below lands as a committed test at the right layer —
no throwaway probes. This is a **UI component task whose surface is not yet
route-reachable** (no route renders it until `sd_my_sessions_page` /
`sd_public_sessions_page`), so its pinning layer is **Vitest +
React Testing Library** (ADR 0006) through `renderWithProviders`. The Playwright
e2e + axe coverage is **deferred** — see the e2e-policy note below. Test output
is redirected to a file and inspected via an Explore sub-agent per the project
test-output convention; no raw inline dumps.

1. **Component exists** under `apps/root/src/discovery/` (D1) — e.g.
   `SessionList.tsx` — exporting a typed component that takes a fetcher, a `limit`
   prop, and a per-row actions render-slot, with no import of an endpoint URL,
   auth helper, or response schema (the data-source-agnostic constraint).
2. **Renders rows from an injected fetcher (Vitest)**: given a stub fetcher
   returning a known `{ rows, total }`, the component renders each row's topic and
   a derived lifecycle status; lobby / live / ended map to distinct localized
   status text from `(startedAt, endedAt)`.
3. **Actions slot (Vitest)**: the per-row actions render-slot is invoked with the
   row and its output appears in that row — proving the page (not the component)
   supplies role badges and join-live/see-replay links.
4. **Topic search (Vitest)**: typing ≥3 chars (after debounce) calls the fetcher
   with the `topic` query value and `offset` reset to 0; a 1–2 char non-empty
   value does **not** call the fetcher and shows the min-length hint; clearing the
   box refetches without a `topic`.
5. **Date filter (Vitest)**: setting from/to inputs calls the fetcher with
   `startedAfter` / `startedBefore` as ISO `date-time` bounds and resets `offset`;
   when a bound is active the lobby-exclusion note is shown.
6. **Pagination (Vitest)**: next/prev move `offset` by `limit` and refetch; the
   "showing X–Y of total" summary is correct; next is disabled when
   `offset + rows.length >= total`; prev disabled at offset 0.
7. **Loading / empty / error (Vitest)**: an in-flight fetch shows the loading
   affordance without dropping current rows; an empty result shows the empty
   state; a rejected fetch shows the error state with a working retry that
   refetches.
8. **Localization (Vitest)**: rendering under each of en-US / pt-BR / es-419 via
   `renderWithProviders` shows that locale's strings; no raw `discovery.*` key
   leaks (every key resolves). The `discovery.*` block is present in all three
   `packages/i18n-catalogs/src/catalogs/*.json`.
9. **Accessibility unit-level (Vitest)**: search input, date inputs, and
   pagination buttons have accessible names; the list/table has an accessible
   name; status is conveyed as text. (Full axe WCAG scan is deferred — see
   below.)
10. **`pnpm run check` green** (build + lint + unit).
11. tj3 parse stays clean — the **closer** adds `complete 100` and the
    `## Status` block; the implementer does not edit the `.tji`.

**e2e + axe deferred — component not yet reachable.** Per the UI-stream e2e
policy, full Playwright + `@axe-core/playwright` (ADR 0040) coverage is deferred
**because no route renders this component yet** — there is no page mounting it
and no event surface driving it until the sibling tasks land. Vitest +
React Testing Library (criteria 2–9) is the standing coverage in the interim.
The deferral targets **already exist in the WBS** (no new task to register):

- `sd_my_sessions_page` (`.tji` lines 57–61) — mounts this component on the
  authenticated route; its refinement MUST scope a Playwright spec + axe scan
  that exercises the rendered list (rows, search, date filter, pagination,
  loading/empty states) and the role badges.
- `sd_public_sessions_page` (`.tji` lines 63–67) — mounts it on the anonymous
  route; its refinement MUST scope the same for the public list.
- `sd_e2e` (`.tji` lines 83–88) — the cross-flow catch-all already scoped to
  walk search/date/pagination, role-aware join-live routing, the lobby-secrecy
  pin at the UI layer, and see-replay landing.

Three deferral targets, each owning a slice — the debt is **not** piled onto a
single catch-all. The implementers of the two page tasks pay the axe/Playwright
debt for the surface they make reachable; `sd_e2e` covers the assembled
end-to-end flow. No `mod_pw_*`-style inheritance build-up here.

## Decisions

**D1 — Place the component in the root app (`apps/root/src/discovery/`), not a
new shared package.**
Chosen: a root-app-local component alongside `landing/` and `routes/`.
*Rationale:* both consumers today are root-app routes (`sd_my_sessions_page`,
`sd_public_sessions_page` are `apps/root` pages per their `.tji` notes); there is
no second app that needs it now. The `.tji` explicitly leaves placement to the
refinement and conditions a shared package on "if the audience surface later
wants it" — a future that isn't here. Extracting to `packages/*` means a
peer-dep boundary, its own build/test wiring, and a published contract, all to
serve one app — the premature-abstraction tax the project's "reuse existing
seams, simpler abstraction with one or two call sites today" bias warns against.
If the audience surface (or any second app) later needs the same list, the lift
to a shared package is mechanical and warrants its own task then. *Alternative
rejected:* create `packages/session-list` now — speculative; no current second
consumer, and the component leans on root-app conventions (router, auth chrome)
that would have to be peer-injected for no present benefit. This stays within an
existing seam, so it needs no ADR.

**D2 — Presentational shell driven by an injected async fetcher; the component
owns query/UI state, the page owns data access.**
Chosen: the component takes `fetchPage(query) => Promise<{ rows, total }>` and
owns the search/date/offset state, debounce, pagination math, and
loading/empty/error rendering; each page writes the `fetch` call (endpoint +
auth + row→view-model mapping) behind that fetcher. *Rationale:* the genuinely
shared, error-prone logic is the query-state machine and pagination arithmetic —
factoring *that* into the component is the whole point; the genuinely different
parts are the endpoint, the auth posture (mine credentialed, public anonymous),
and the row shape — keeping *those* in the page keeps endpoint/auth knowledge out
of a component that backs an anonymous surface. *Alternatives rejected:*
(a) a purely controlled/dumb component where both pages re-implement debounce +
pagination state — duplicates the only hard part and invites drift, the exact
thing this task exists to prevent; (b) a component that owns `fetch` and is
parameterized by an endpoint URL + auth flag — pushes endpoint and trust-model
branching into the shared component (a public-surface component that knows how to
send credentials is a smell), and forces it to branch on row shape. The injected
fetcher is the seam that splits "shared mechanics" from "per-page specifics"
cleanly.

**D3 — Per-row role badges and join-live/see-replay links come through a render
slot the page supplies; they are not view-model fields.**
Chosen: the component renders topic + start/end time + derived status, and calls
a page-supplied `renderRowActions(row)` for the rest of the row. *Rationale:* the
two lists' rows diverge precisely in their affordances — My Sessions shows a
role badge (`role` from `/api/sessions/mine`) and routes join-live by role;
Public Sessions has no role and always routes anonymous-audience. Those links are
themselves later tasks (`sd_join_live_link`, `sd_see_replay_link`) that depend on
this one; a render slot lets them slot their output in without this component
growing knowledge of routing or roles. *Alternative rejected:* bake a `role`
field and link logic into the component — couples the shared component to the
authenticated row shape and to routing rules the public list doesn't share, and
would force the public page to pass dummy roles.

**D4 — UI page size default 20 (`DEFAULT_PAGE_SIZE`), passed as `limit`; page
controls are prev/next, not numbered pages.**
Chosen: a `DEFAULT_PAGE_SIZE = 20` constant the component uses as the default
`limit` prop, with prev/next + an "X–Y of total" summary. *Rationale:* 20 is a
comfortable single-screen list and well under the API's max of 200; the API's
own default of 50 is tuned for programmatic callers, not a scannable UI page.
Prev/next + a total-count summary is the minimal accessible pagination that
satisfies the `.tji`'s "pagination" requirement and matches the
`offset + sessions.length >= total` stop contract the endpoints document
(`routes.ts:538-567`); numbered-page jumping is extra surface (and extra count
math) with no requirement behind it. *Alternative rejected:* numbered pagination
or infinite scroll — numbered pages add complexity for no required benefit;
infinite scroll fights the "searchable, date-filtered, paginated" framing and is
worse for the keyboard/screen-reader story.

**D5 — Reuse the backend search/pagination caps from
`packages/shared-types/src/limits.ts`; enforce the 3-char minimum client-side.**
Chosen: import `MIN_TOPIC_SEARCH_LENGTH`, `MAX_TOPIC_SEARCH_LENGTH`,
`MAX_SESSION_LIST_OFFSET` and gate input against them; don't fire a search below
3 chars (show a hint instead), cap input at 64, never page past the offset cap.
*Rationale:* single source of truth — the same constants the endpoints validate
against (sd_public D3); a too-short query becoming a silent no-op is a better UX
than a 400 round-trip. *Alternative rejected:* re-declare the limits in the
frontend — drifts the moment the backend caps change; the constants already live
in a shared package the root app can import.

**D6 — New `discovery.*` catalog block in all three locales; machine/AI
translations land now, native-speaker review is parking-lot.**
Chosen: add the `discovery.*` keys (search label + min-length hint, date-filter
labels + lobby-exclusion note, status labels lobby/live/ended, pagination
summary + prev/next labels, empty-state, error-state + retry) to en-US, pt-BR,
es-419 (ADR 0024). *Rationale:* the `.tji` mandates localization in all three;
the implementer can produce serviceable pt-BR/es-419 strings (as the existing
catalogs were). *Out of scope as a WBS task:* native-speaker sign-off on the
pt-BR/es-419 wording is human review work, not agent-implementable — it is
surfaced to the parking lot in this refinement's return summary, not encoded as
a task. *Alternative rejected:* ship en-US only and defer the other locales —
violates ADR 0024 and the `.tji`'s explicit three-locale requirement; the page
tasks' axe/e2e run per-locale and would fail on missing keys.

**D7 — Surface the date-filter ⟶ lobby-exclusion side effect in the UI rather
than hide or work around it.**
Chosen: when a date bound is active, show a localized note that lobby (not-yet-
started) sessions are excluded by the date filter. *Rationale:* the endpoints
exclude NULL-`started_at` rows whenever a date bound is present (sd_my D4) —
this is correct server behavior, but to a My Sessions user it looks like their
lobby session "disappeared" when they set a date. A one-line note makes the
behavior legible instead of surprising. The public list is unaffected (it has no
lobby rows), so the note is conditional on lobby rows being possible. *Alternative
rejected:* client-side re-merge lobby rows back in when a date filter is active —
fights the server contract, breaks the `total`/pagination math, and re-implements
filtering the backend already owns.

**D8 — Defer Playwright + axe to the page tasks that make the component
reachable; pin behavior with Vitest now.**
Chosen: Vitest + React Testing Library is the standing coverage; full axe WCAG
scans and Playwright flows are scoped into `sd_my_sessions_page`,
`sd_public_sessions_page`, and `sd_e2e` (all pre-existing WBS leaves).
*Rationale:* the UI-stream e2e policy's deferred-e2e exception applies cleanly —
**no route renders this component and no event surface drives it** until the page
tasks land, so there is nothing for Playwright to navigate to and nothing for axe
(which scans a rendered page) to scan. The component's behavior is fully
exercisable in jsdom through the injected-fetcher seam (D2). The deferral is
**not** "full deferral to a single catch-all": three distinct targets each own a
reachable slice, and the page tasks already exist, so no debt accumulates on
`sd_e2e`. *Alternative rejected:* a thin Playwright "component-presence" spec
now — there is no route to mount it on yet, so there is literally no page to
assert against; the policy's "if the component IS rendered" clause does not
apply because nothing renders it until D1's sibling tasks.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- `apps/root/src/discovery/SessionList.tsx` — shared, data-source-agnostic paginated session-list component; owns query/debounce/pagination state and loading/empty/error rendering; injected `fetchPage` fetcher + per-row `renderRowActions` slot.
- `apps/root/src/discovery/SessionList.test.tsx` — 14 Vitest specs covering criteria 2–9: row rendering + derived lifecycle status (lobby/live/ended), actions slot, debounced topic search + min-length hint + clear, date filter → ISO bounds + offset reset + lobby-exclusion note (suppressed when `lobbyRowsPossible={false}`), pagination math/summary/edge-disabling, loading-without-row-drop + empty + error/retry, per-locale rendering (en-US/pt-BR/es-419, no key leaks), a11y accessible-names, and `deriveLifecycleStatus` unit.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — new top-level `discovery.*` block.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — new top-level `discovery.*` block.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — new top-level `discovery.*` block.
- Playwright + axe coverage deferred to `sd_my_sessions_page`, `sd_public_sessions_page`, and `sd_e2e` (pre-existing WBS leaves, no new task registered); component not yet route-reachable.
- Native-speaker review of machine-authored pt-BR/es-419 `discovery.*` strings tracked under the umbrella parking-lot entry (2026-05-30); no per-key entry appended per triage instruction.
