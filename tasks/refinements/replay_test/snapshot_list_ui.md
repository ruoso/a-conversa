# `snapshot_list_ui` — snapshot list view

**TaskJuggler entry**: [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) — task `replay_test.snapshots.snapshot_list_ui` (line 121, under `replay_test.snapshots`, "Snapshot surfaces").

**Effort estimate**: 1d.

## Inherited dependencies

The leaf declares `depends !snapshot_creation_ui` (`tasks/60-replay-and-test-mode.tji:124`); the `snapshots` parent block adds two group edges (`tasks/60-replay-and-test-mode.tji:115`) that every snapshot-surface leaf inherits:

- `replay_test.snapshots.snapshot_creation_ui` — **settled** (Done 2026-06-05; see [`snapshot_creation_ui.md`](snapshot_creation_ui.md)). That task did *not* build UI; it pinned the **shared-snapshot-record contract** end to end: a snapshot created through the moderator write-path lands as a `snapshot-created` event and is then retrievable, in the same session, via `GET /sessions/:id/snapshots`. The producer→consumer link this list view stands on is therefore already verified by Cucumber (`tests/behavior/backend/list-session-snapshots.feature`).
- `data_and_methodology.event_types.snapshot_events` — **settled**. `snapshotCreatedPayloadSchema` in [`packages/shared-types/src/events.ts:623`](../../../packages/shared-types/src/events.ts): `{ snapshot_id: uuid, label: string (1–128), log_position: positive int }`. Snapshots are events, not a separate table.
- `backend.replay_endpoints.list_snapshots` — **settled** (Done 2026-06-04; see [`tasks/refinements/backend/list_snapshots.md`](../backend/list_snapshots.md)). Ships `GET /sessions/:id/snapshots`, returning `{ snapshots: [{ snapshotId, label, logPosition, createdAt }] }` ordered by `logPosition` **ascending**, gated by the session-visibility predicate (404 on invisible/absent). Route: [`apps/server/src/replay/routes.ts:528`](../../../apps/server/src/replay/routes.ts); read helper `readSessionSnapshots` in [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts).
- `replay_test` stream root — `depends backend.backend_tests.be_e2e_tests.auth_flow_integration` (`tasks/60-replay-and-test-mode.tji:30`), the OIDC-handshake safety net every replay-UI leaf inherits. Settled.

**Pending (not a `.tji` edge, but decisive for the e2e decision):** there is **no replay or test-mode frontend surface yet.** The root app (`apps/root/src/App.tsx:41-56`) mounts only `/m` (moderator), `/p` (participant), `/a` (audience). No `apps/replay`, no `apps/test-mode`, and no route renders any replay/test-mode component today. The surface tasks (`replay_test.replay_ui.*`, `replay_test.test_mode.*`) are all unbuilt. This is what makes the snapshot list component **not yet reachable** — see Acceptance criteria §4.

## What this task is

Build the **snapshot list view**: the read-only UI that lists a session's snapshots fetched from `GET /sessions/:id/snapshots`, in chapter order, so a viewer can see the snapshot markers that punctuate a recorded session. This is the consumption counterpart to the creation surface — where `snapshot_creation_ui` proved that moderator-created snapshots *land* in the shared record, this task *renders* that record for replay and test-mode viewers.

Concretely, two artifacts:

1. **A presentational `SnapshotList` component** — given a list of snapshot records plus a load state, renders one row per snapshot (label, `#logPosition`, `createdAt`), handles the loading / error / empty / ready states, and exposes an `onSelect(snapshotId)` callback so a host can wire navigation. It is route-agnostic and surface-agnostic: it takes data and a callback, nothing more.
2. **A `useSessionSnapshots(sessionId)` data hook** — fetches `GET /api/sessions/:id/snapshots` following the project's established raw-`fetch` + `useState` idiom (see [`apps/moderator/src/layout/useSessionEventLogPrefetch.ts:78-146`](../../../apps/moderator/src/layout/useSessionEventLogPrefetch.ts)), returning `{ status: 'loading' | 'ready' | 'error', snapshots, retry }`, with a defensive narrowing guard on the parsed payload.

This is distinct from the moderator's existing [`SnapshotMarkerStrip`](../../../apps/moderator/src/graph/SnapshotMarkerStrip.tsx) (`apps/moderator/src/graph/SnapshotMarkerStrip.tsx:1`), which renders snapshots from the **live in-memory WS event log** (`projectSnapshots` selector, `apps/moderator/src/graph/selectors.ts:599`), shows at most 5, newest-first, and is bound to the moderator operate console. This task's list is **REST-sourced** (works for any recorded session, including completed ones with no live socket), unbounded, and ordered for navigation — the data source the replay/test-mode surfaces require.

## Why it needs to be done

`snapshot_jump_ui` `depends !snapshot_list_ui` (`tasks/60-replay-and-test-mode.tji:129`): the jump-to-snapshot action is an affordance *on* list rows, so it needs the list to exist first. Downstream of that, the replay viewer's chapter jumping (`replay_chapter_jumping`) and the test-mode timeline scrubber (`test_mode_timeline_scrubber`) both navigate by snapshot/position and will mount this list (or compose its hook) in their surfaces. Building the list as a standalone, well-tested, surface-agnostic component now — ahead of those surfaces — is exactly the "build the reusable piece, wire it later" sequencing the WBS encodes by giving `snapshot_list_ui` its own 1d leaf before any consuming surface.

The backend contract it consumes is fully shipped and Cucumber-pinned (list endpoint + the write→read round-trip from `snapshot_creation_ui`), so this task is purely the client-side consumer: fetch, narrow, render, expose selection.

## Inputs / context

- WBS leaf: `tasks/60-replay-and-test-mode.tji:121` (`snapshot_list_ui`), parent block lines 114–131, group dependency line 115, direct dependency line 124.
- REST contract: [`tasks/refinements/backend/list_snapshots.md`](../backend/list_snapshots.md). Response `{ snapshots: [{ snapshotId, label, logPosition, createdAt }] }`, **ascending `logPosition`**, visibility-gated 404. Route handler [`apps/server/src/replay/routes.ts:528`](../../../apps/server/src/replay/routes.ts), read helper `readSessionSnapshots` in [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts).
- Record shape on the wire (camelCase): `{ snapshotId, label, logPosition, createdAt }`. Matches the moderator's local `Snapshot` interface ([`apps/moderator/src/graph/selectors.ts:585`](../../../apps/moderator/src/graph/selectors.ts)).
- Established client fetch idiom (raw `fetch`, `credentials: 'include'`, `Accept: application/json`, status-check-before-parse, defensive narrowing, `{status, …, retry}` return): [`apps/moderator/src/layout/useSessionEventLogPrefetch.ts:78-146`](../../../apps/moderator/src/layout/useSessionEventLogPrefetch.ts). No React Query / SWR in the codebase — raw `fetch` + `useState` is the convention.
- Existing live-mode snapshot rendering to mirror visually (not reuse — different data source): [`apps/moderator/src/graph/SnapshotMarkerStrip.tsx:1`](../../../apps/moderator/src/graph/SnapshotMarkerStrip.tsx), selector [`apps/moderator/src/graph/selectors.ts:599`](../../../apps/moderator/src/graph/selectors.ts).
- Component-test convention (Vitest + React Testing Library, i18n instance, store/prop-driven data — no MSW in current suite): [`apps/moderator/src/layout/BlockingDiagnosticBanner.test.tsx`](../../../apps/moderator/src/layout/BlockingDiagnosticBanner.test.tsx). ADRs 0006 (Vitest), 0003 (React).
- Shell package (the cross-surface substrate every UI surface consumes): [`packages/shell/src/`](../../../packages/shell/src/); WBS [`tasks/27-shell-package.tji`](../../27-shell-package.tji). ADR 0010 (pnpm workspaces).
- Position-navigation primitives that the jump/chapter tasks will pair with this list (not needed by the list itself, but they define the snapshot→position semantics): `apps/server/src/projection/snapshot-resolution.ts`, [`tasks/refinements/data-and-methodology/snapshot_resolution.md`](../data-and-methodology/snapshot_resolution.md).
- Root-app surface routing (shows there is no replay/test route): [`apps/root/src/App.tsx:41`](../../../apps/root/src/App.tsx).
- e2e policy: refinement-writer brief, "UI-stream e2e policy" (`replay_test.*` is in scope). ADRs 0008 (Playwright), 0022 (no throwaway verifications).

## Constraints / requirements

1. **Presentational/data split.** Keep the rendering component pure (props in, `onSelect` callback out) and the fetch in a separate hook. This is what lets both replay and test-mode mount the list, and what makes the component RTL-testable without a network.
2. **Reuse the existing fetch idiom — no new data-layer dependency.** Raw `fetch` against `/api/sessions/:id/snapshots`, `credentials: 'include'`, status-check-before-parse, defensive narrowing of the `snapshots` array. Do **not** introduce React Query/SWR (would be a new dependency and break convention).
3. **Render in the endpoint's order — ascending `logPosition`.** The REST surface already returns chapter order; the list renders it as-given (no client re-sort, no reversal). This differs deliberately from the moderator strip's newest-first reversal: this list is a navigable chapter index, not a recency ticker. (See Decision §3.)
4. **Handle all four load states explicitly:** loading, error (with a `retry`), empty (a visible "no snapshots" affordance, not a blank), ready. The empty case is first-class — a recorded session with zero snapshots is normal.
5. **No write affordance.** This is a read-only consumer. No create/delete/relabel controls — creation lives solely on the moderator surface (`snapshot_creation_ui` §1).
6. **Localized strings via the shell i18n instance**, per the existing component convention (`createI18nInstance` in the test convention reference). No hard-coded UI English.
7. **Surface-agnostic placement.** The component must not import from `apps/moderator`, `apps/replay`, or any single surface — it belongs in the shared substrate so the future replay/test surfaces import it without a cross-app dependency. (See Decision §2.)

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **Component tests (Vitest + RTL)** for `SnapshotList`, covering each state:
   - **ready** — given N snapshot records, renders N rows in `logPosition`-ascending order, each showing label, `#logPosition`, and `createdAt`;
   - **select** — clicking a row fires `onSelect` with that row's `snapshotId`;
   - **empty** — given `[]`, renders the explicit no-snapshots affordance (asserted by test id / role), not a blank node;
   - **loading** and **error** — render the loading and error affordances; the error state exposes a working `retry` control.
   Follows the convention in [`BlockingDiagnosticBanner.test.tsx`](../../../apps/moderator/src/layout/BlockingDiagnosticBanner.test.tsx) (RTL `render`/`screen`/`fireEvent`, shell i18n instance).
2. **Hook tests (Vitest)** for `useSessionSnapshots`: stub `fetch` and assert it requests `/api/sessions/:id/snapshots` with `credentials: 'include'`; a 200 with a well-formed body yields `status: 'ready'` and the parsed, narrowed snapshots; a non-200 yields `status: 'error'` and `retry` re-issues the request; a malformed/garbage body is rejected by the narrowing guard (→ `error`, no throw). Fetch-stubbing is local to these tests (no new MSW dependency).
3. **No Cucumber scenario for this task.** It adds no wire/broadcast/projector behavior at the system seam — it is a *client* of an already-shipped, already-Cucumber-pinned endpoint (`list-session-snapshots.feature`, plus the `snapshot_creation_ui` round-trip). Per the backend/WS pin rule, client-only consumption of an existing REST surface does not warrant a new Cucumber scenario.
4. **Playwright e2e is deferred — because the surface is not yet reachable.** No route renders this component and no event surface drives it (`apps/root/src/App.tsx:41` mounts no replay/test surface; `apps/replay`/`apps/test-mode` do not exist). A Playwright spec requires a running app reachable at a URL, which does not exist for this component, so full deferral — not a thin presence-spec — is the correct call here. The Vitest component + hook coverage in §1–§2 stands in for now. **The deferred snapshot-list e2e is inherited by `replay_test.snapshots.snapshot_jump_ui`** (the direct dependent, which adds the jump affordance on these rows): its refinement MUST scope a Playwright spec that exercises *list render → click row → jump*, and MUST be implemented against (or sequenced after) a reachable replay/test surface. If no replay/test surface exists when `snapshot_jump_ui` is implemented, that refinement forwards the e2e debt to the first surface that mounts the list — `replay_test.replay_ui.replay_chapter_jumping` (replay viewer) and `replay_test.test_mode.test_mode_timeline_scrubber` (test-mode), whose refinements must then cover snapshot-list-render + jump in their Playwright specs. No *new* WBS task is created for this debt — `snapshot_jump_ui` already exists and is the registered inheritor (one inheritance, well under the catch-all overload threshold). The closer should note this inheritance against `snapshot_jump_ui` so its refinement-writer picks it up.
5. **Green gate.** `make` build + the full test suite pass with the new component and hook tests (per the global build-and-test-before-commit rule).

## Decisions

**§1 — This is a real UI build (the consumption surface), not a contract pin.** *Rationale:* unlike its predecessor `snapshot_creation_ui` — which found the creation UI already shipped on the moderator surface and reduced to pinning the write→read seam — there is **no existing snapshot *list* view sourced from REST.** The moderator's `SnapshotMarkerStrip` reads the live in-memory event log and is moderator-bound; replay/test mode operate on recorded sessions with no live socket and need the REST-sourced list. So this task genuinely produces the `SnapshotList` component + `useSessionSnapshots` hook. *Alternative rejected:* "reuse `SnapshotMarkerStrip`/`projectSnapshots`" — rejected because that path depends on a live WS event stream and the moderator's Zustand store; it cannot serve a recorded-session replay/test surface and is capped at 5 newest markers, which is wrong for a navigable chapter index.

**§2 — The component lives in the shell package (`@aconversa/shell`), not in a surface app.** *Rationale:* the snapshot list is, by definition, a **cross-surface** component — both the replay viewer and the test-mode app render it — and it has **no single-surface owner** to co-locate in (the moderator strip is a different, surface-specific component). The shell is the substrate "consumed by every UI surface." Placing the route-agnostic component + hook there lets both future surfaces import it with no cross-app dependency. *Tension acknowledged:* the shell's extraction guideline prefers waiting for a third caller before promoting a component out of a surface. That guideline guards against *prematurely extracting* a component that currently lives happily in one surface — it does not force a genuinely owner-less, cross-surface component into an arbitrary app first. Here there is no surface to extract *from* (neither consumer exists yet), and both in-stream consumers are known, so the shell is the honest home. *Alternative rejected:* "build it inside the first replay/test surface app and have the other import across apps" — rejected because that app does not exist yet (this task does not depend on it), and cross-app component imports are exactly what the shell exists to prevent. *Alternative rejected:* "put it in `apps/moderator` beside `SnapshotMarkerStrip`" — rejected: it is not a moderator task and the moderator must not become a dependency of replay/test surfaces.

**§3 — Render in ascending `logPosition` order, as the endpoint returns it; no client re-sort or reversal.** *Rationale:* snapshots are chapter markers along the session timeline; a list used for *navigation* reads most naturally in chapter order, and the REST surface already guarantees ascending `logPosition`, so the component stays a faithful renderer with no ordering logic of its own to test or drift. *Alternative rejected:* "newest-first, mirroring `SnapshotMarkerStrip`'s reversal" — rejected: the strip optimizes for *recency* in a live console (what did I just snapshot?); a replay/test chapter index optimizes for *position* (where in the session is each chapter?). Different job, different order.

**§4 — Reuse the raw-`fetch` + `useState` idiom; no new data-fetching dependency.** *Rationale:* the codebase has a single, consistent client-fetch convention ([`useSessionEventLogPrefetch.ts`](../../../apps/moderator/src/layout/useSessionEventLogPrefetch.ts)) with status-check-before-parse and defensive narrowing; matching it keeps the hook idiomatic and adds zero dependencies. *Alternative rejected:* introducing React Query/SWR — a new dependency and an architectural seam for a single GET, against convention; would warrant an ADR and isn't justified here.

**§5 — No new ADR.** *Rationale:* nothing here adds a dependency, an architectural seam, or a security trade-off. React (0003), Vitest (0006), Playwright (0008), pnpm-workspace package placement (0010), and the snapshot-as-event / REST-list contracts are all already decided and shipped. The component-placement and ordering calls above are scope decisions that belong in this refinement, not a new ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `packages/shell/src/snapshot-list/types.ts` — `SnapshotRecord` shape (camelCase, matches REST wire format: `snapshotId`, `label`, `logPosition`, `createdAt`).
- `packages/shell/src/snapshot-list/useSessionSnapshots.ts` — raw-`fetch` + `useState` hook (`GET /api/sessions/:id/snapshots`, `credentials: 'include'`), returns `{ status, snapshots, retry }` with defensive narrowing guard.
- `packages/shell/src/snapshot-list/SnapshotList.tsx` — presentational component rendering all four load states (loading, error+retry, empty, ready), rows in ascending `logPosition` order, fires `onSelect(snapshotId)` on click.
- `packages/shell/src/snapshot-list/index.ts` — barrel re-exporting component, hook, and types.
- `packages/shell/src/snapshot-list/SnapshotList.test.tsx` — Vitest+RTL: ready/select/empty/loading/error states + cross-locale catalog parity (en-US, pt-BR, es-419).
- `packages/shell/src/snapshot-list/useSessionSnapshots.test.tsx` — Vitest: request shape (`credentials: include`), well-formed 200→ready, non-200→error+retry re-issue, malformed-body→error ×2.
- `packages/shell/src/index.ts` — public exports for `SnapshotList`, `useSessionSnapshots`, `SnapshotRecord`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — new `snapshotList.*` i18n keys scoped to the component.
- Playwright e2e deferred — no replay/test surface yet reachable. Debt inherits to `replay_test.snapshots.snapshot_jump_ui` per §4: its refinement must scope a list-render → click → jump Playwright spec against a reachable surface.
