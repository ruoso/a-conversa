# Refinement — `landing_page.extract_readonly_graph_package`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:23-39`
(`task landing_page.extract_readonly_graph_package`). Gates milestone
M8-landing via `walkthrough_demo_stepper`
(`tasks/47-landing-page.tji:114-126`, `depends !extract_readonly_graph_package`).

## Effort estimate

`3d` (from the `.tji` block).

## Inherited dependencies

`depends audience.aud_graph_rendering` — the roll-up of the audience graph
refinement chain. The renderer this task lifts is the cumulative product of
that chain, so the following are **settled** and inherited as-is (no
re-litigation; this is a lift-and-shift refactor, not a redesign):

- **Pure projector.** `projectGraph(events)` is a pure function — no store,
  no network (`apps/audience/src/graph/projectGraph.ts:328`). It stamps both
  `data.facetStatuses` and `data.rollupStatus` on every element
  (`aud_proposed_styling` §1), promotes endpoint-referenced annotations to
  graph nodes (`annotations.ts`), and renders at propose-time per ADR 0027.
- **Module-scope stylesheet.** `STYLESHEET` is a reference-stable singleton
  (`stylesheet.ts:188`); state colors key on `data.rollupStatus` via
  attribute-equality selectors (`aud_agreed_styling` §4).
- **Deterministic breadthfirst layout.** Pure function of the element set
  via `selectDeterministicRoots` (`layoutOptions.ts:99`); broadcast-tuned
  `SPACING_FACTOR` / `PADDING` / `BROADCAST_DIMENSIONS` are named exports
  (`aud_layout_engine` §4).
- **One-shot first-render auto-fit**, `fit: false` thereafter
  (`aud_layout_engine` §3, `GraphView.tsx:358-367`).
- **`cyRef` callback is the sole observability seam** — no
  `window.__aConversaAudienceCyInstance` test hook (`aud_cytoscape_init` §8,
  `GraphView.tsx:319-327`).
- **Typography from `@a-conversa/i18n-catalogs`** — `BROADCAST_FONT_STACK`
  is consumed, not duplicated (`aud_clean_typography` §1).
- **Eight DOM overlays** compose over `useCytoscapeOverlayPlacements`
  (`cytoscapeOverlayHooks.ts:108`; `GraphView.tsx:310-317`).

**Pending:** none. The renderer is complete and shipping in `apps/audience`;
nothing in the source data model is in flux for this task.

## What this task is

Lift the audience surface's pure read-only graph renderer — the projector,
the Cytoscape `GraphView`, layout options, stylesheet, overlay hooks, and the
eight DOM overlays — out of `apps/audience/src/graph/` into a new workspace
package `@a-conversa/graph-view`, consumed by **both** `apps/audience` and
`apps/root`. The package exposes a read-only graph view that takes a
**precomputed event log via props** (no WebSocket, no session, no store, no
server wiring). `apps/audience` is refactored onto the package with **no
behavior change** and keeps its full test suite green. The task carries
ADR 0039, which fixes the package boundary: what is genuinely
surface-agnostic read-only rendering versus what stays audience-specific.

## Why it needs to be done

The public landing page's centrepiece is a self-contained, client-side
interactive walkthrough of the encoded "Should zoos exist?" debate
(`tasks/47-landing-page.tji:1-20`). `walkthrough_demo_stepper`
(`tasks/47-landing-page.tji:114-126`) projects `events[0..pos]` and
re-renders the graph on each step — it needs exactly the audience renderer,
but `apps/root` cannot import from `apps/audience` (apps are leaf Vite
bundles, not libraries — ADR 0026). The renderer must live in a shared
package first. This task is the structural precondition: it unblocks
`walkthrough_demo_stepper`, which gates M8-landing, which gates M9
(Deployment). It also finally realizes ADR 0004's "read-only surfaces share
one renderer" as a real package boundary.

## Inputs / context

- **WBS block & acceptance hint:** `tasks/47-landing-page.tji:23-39`.
- **Renderer source to lift** (`apps/audience/src/graph/`):
  - `projectGraph.ts:328` — pure projector + element/data types.
  - `GraphView.tsx:330` — the React mount; **the coupling to remove** is at
    `GraphView.tsx:331-332` (`useTranslation()` stays; `useAudienceSession()`
    must become a prop) and `GraphView.tsx:505,510` (`sessionId` passed into
    overlays).
  - `layoutOptions.ts:99` — layout builder + named constants.
  - `stylesheet.ts:188` — stylesheet singleton + typography/state-color
    constants.
  - `cytoscapeOverlayHooks.ts:108` — `useCytoscapeOverlayPlacements`,
    `useSeenKeysGate`.
  - `annotations.ts` — annotation-endpoint promotion.
  - `PerFacetPillOverlay.tsx`, `AxiomMarkOverlay.tsx`, `AnnotationOverlay.tsx`,
    `NodeAppearOverlay.tsx`, `WithdrawalHaloOverlay.tsx`,
    `DiagnosticFireOverlay.tsx`, `DiagnosticEdgeFireOverlay.tsx`,
    `DecompositionFadeOverlay.tsx` — the eight overlays.
  - `cytoscapeTestEnv.ts` — Cytoscape test environment helper.
  - Co-located Vitest suites: `projectGraph.test.ts`, `GraphView.test.tsx`,
    `layoutOptions.test.ts`, `cytoscapeOverlayHooks.test.tsx`,
    `*Overlay.test.tsx`, `annotations.test.ts`.
- **Audience consumers (stay in `apps/audience`):**
  `routes/AudienceLiveRoute.tsx:34` (imports `AudienceGraphView`),
  `state/useAudienceSession.ts` (the facade over the WS store).
- **Package-template references:** `packages/shell/package.json`
  (UI-package shape: `source`-conditioned export, Vite + `tsc` declaration
  build, peer-deps for react/i18n/shared deps); `packages/shell/tsconfig.json`
  (`module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`,
  `emitDeclarationOnly`, project references).
- **Workspace wiring:** `pnpm-workspace.yaml` (`packages/*` glob); root
  `tsconfig.json` `references` array (add the new package); `apps/audience`
  and `apps/root` `package.json` + `tsconfig.json` (add the dependency +
  reference).
- **ADRs:** 0039 (this task's boundary ADR — authored alongside this
  refinement); 0004 (graph libraries — Cytoscape for read-only surfaces);
  0010 (pnpm-workspace package layout); 0026 (micro-frontend root app +
  shared `shell` substrate); 0024 (react-i18next + ICU); 0027 (propose-time
  rendering).

## Constraints / requirements

1. **No behavior change in `apps/audience`.** The existing public component
   API (`AudienceGraphView` with its `cyRef` prop) and the rendered output
   stay identical. `apps/audience`'s full Vitest suite passes unchanged
   (tests move with the code or import from the package; assertions are not
   weakened).
2. **No session/WS/server coupling crosses the package boundary.** The
   package's `GraphView` takes `events: readonly Event[]` and an opaque
   `instanceKey: string` (replacing the audience `sessionId` used by the
   overlays' seen-key gates). It calls no store, hook-into-WS, or session
   API. `useAudienceSession()` stays in `apps/audience` behind a thin
   adapter.
3. **i18n stays inside the renderer** via `useTranslation()`; the package
   declares `react-i18next` and `@a-conversa/i18n-catalogs` as peer deps.
   Consuming apps must register the `methodology.kind.*` /
   `methodology.edgeRole.*` keys (audience already does; root via the shared
   catalog).
4. **Package shape follows the `@a-conversa/shell` template** (ADR 0010 /
   0026): `name: @a-conversa/graph-view`, `private`, `type: module`, single
   `source`-conditioned `"."` export, Vite build + `tsc -b
   --emitDeclarationOnly` for declarations, peer deps for
   react/react-dom/cytoscape/react-i18next/shared-types/i18n-catalogs (also
   in devDeps for local test/build). tsconfig extends `tsconfig.base.json`
   with `module: ESNext` / `moduleResolution: Bundler` / `jsx: react-jsx` and
   a project reference to `../shared-types`.
5. **Workspace integration:** add `{ "path": "packages/graph-view" }` to the
   root `tsconfig.json` references; add the dependency + project reference to
   both `apps/audience` and `apps/root`. (`apps/root` consumption is wired by
   `walkthrough_demo_stepper`; this task just makes the package importable —
   adding it to `apps/root`'s manifest now is optional and may be left to the
   wiring task.)
6. **ADR 0039 boundary holds:** the moves/stays split in §Decision matches
   ADR 0039 exactly. Any deviation discovered during implementation amends
   the refinement, not the ADR's Decision section (ADR convention).
7. **Amendment sweep at completion:** append an `## Amendments` entry to
   ADR 0004 noting the read-only renderer is now `@a-conversa/graph-view`
   (per the ADR amendment-pass rule). This is implementer work at
   task-completion time; the refinement-authoring step did not edit ADR 0004.

## Acceptance criteria

Per ADR 0022 (no throwaway verifications) — every check below is a committed,
repeatable test or a structural fact in the repo:

1. `@a-conversa/graph-view` exists under `packages/graph-view/` with the
   package/tsconfig shape in constraint 4; `pnpm -w build` and `pnpm -w
   typecheck` succeed across the workspace.
2. The package exports a read-only `GraphView` whose data input is a
   precomputed `events` array (+ `instanceKey`), with **no** import of any
   WebSocket / session / store / server module. (Enforceable as a unit
   assertion / lint over the package's import graph, and visible in the
   public type.)
3. The renderer's Vitest suites (`projectGraph.test.ts`,
   `GraphView.test.tsx`, `layoutOptions.test.ts`,
   `cytoscapeOverlayHooks.test.tsx`, the `*Overlay.test.tsx` set,
   `annotations.test.ts`) live with the package and pass; they pin the same
   observable behavior they pinned in `apps/audience` (projection output,
   layout determinism, state-color selectors, overlay placement/gates).
4. `apps/audience` is refactored onto the package: `AudienceGraphView` is now
   a thin adapter that calls `useAudienceSession()` and renders the package
   `GraphView`; the audience app's **entire existing test suite stays green**
   with no assertion weakened. (This is the WBS note's headline acceptance
   gate.)
5. ADR 0039 is committed; ADR 0004 carries the `## Amendments` entry from
   constraint 7.

**E2e (Playwright) — deferred, because no new user-reachable surface is
created by this task.** This is a pure refactor: the audience surface's
behavior and route are unchanged (covered by audience Vitest + its own
already-deferred Playwright on `aud_session_url` / `aud_visual_regression`),
and the package is not yet rendered by any new flow — `apps/root` does not
mount it until `walkthrough_demo_stepper` lands. The unit/component coverage
in criteria 3-4 takes the place of e2e for now. The Playwright coverage that
exercises this package in its new home is owned by **existing** WBS leaves:
`landing_page.walkthrough_demo_stepper` (`tasks/47-landing-page.tji:114-126`,
which mounts the package into the landing demo) and the milestone catch-all
`landing_page.landing_e2e` (`tasks/47-landing-page.tji:166-176`, the
anonymous-visit-steps-the-demo Playwright spec). Both already exist and
already depend (transitively) on this task — **no new task to register**, and
no inherited-debt inflation on a `mod_pw_*`-style catch-all.

## Decisions

1. **Props-in, not hook-in (the core inversion).** The package `GraphView`
   takes `events` + `instanceKey` as props; `apps/audience` keeps a thin
   `AudienceGraphView` adapter that calls `useAudienceSession()` and passes
   the values down. *Rationale:* this is the single coupling that made the
   renderer audience-specific (`GraphView.tsx:332`); a plain prop is the
   simplest store-agnostic seam, has exactly two call sites (audience adapter
   + future landing stepper), and preserves the audience component's public
   API so its tests don't change. *Rejected:* dependency-injecting the
   store/hook into the package — leaks the session/WS concept into a package
   meant to know nothing about sessions (ADR 0039 alternatives).
2. **i18n stays inside the renderer.** Label localization remains via
   `useTranslation()`; the package peer-depends on `react-i18next` +
   `@a-conversa/i18n-catalogs` and requires the host to register the
   `methodology.*` keys. *Rationale:* the projector's labels must be
   consistent across surfaces; pushing i18n out to each consumer would
   duplicate the kind/role label logic. *Rejected:* emitting raw kind/role
   keys and localizing in each app — duplicates logic, invites drift.
3. **New focused package, not `@a-conversa/shell`.** *Rationale:* shell is
   the auth/mount/WS substrate every surface (including the ReactFlow
   moderator) loads; folding a heavy Cytoscape renderer + eight overlays into
   it would force the moderator bundle to carry Cytoscape. A focused
   read-only package keeps shell lean (ADR 0039). *Rejected:* cross-app
   import from `apps/audience` — apps are leaf bundles, not libraries
   (ADR 0026).
4. **Broadcast framing ships as the package default, exposed as config.**
   `BROADCAST_DIMENSIONS`, the one-shot fit, and broadcast font sizing stay
   the default with constants as named exports. *Rationale:* preserves
   audience behavior exactly (constraint 1) while leaving the
   non-broadcast override seam for the landing demo to use later — without
   forking the renderer or scope-creeping a configurable-framing API into
   this task. *Rejected:* parameterizing all framing now — premature; the
   landing demo's needs are settled in `walkthrough_demo_stepper` /
   `landing_demo_mobile_fallback`.
5. **E2e deferred to existing landing leaves, not a new task.** *Rationale:*
   per the UI-stream e2e policy, this task creates no newly-reachable surface
   (audience unchanged; package not yet mounted anywhere new). The wiring
   that makes it user-visible is `walkthrough_demo_stepper` →
   `landing_e2e`, both already WBS leaves that depend on this task. Scoping a
   fresh Playwright task would inflate debt with nothing to exercise yet.

## Open questions

(none — all decided)

## Implementation amendments

Discovered during implementation; recorded here (not in ADR 0039's
Decision) per constraint 6 / the ADR amendment convention. The package
boundary in §Decision and ADR 0039 is unchanged.

1. **A second WS coupling required inversion.** Beyond
   `useAudienceSession()`, the two diagnostic overlays read live
   diagnostic state from the audience WS store via
   `useAudienceActiveDiagnostics(sessionId)` — ephemeral state not
   derivable from the `events` log. The package `GraphView` therefore
   takes a **third prop** `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`
   (defaulting to an empty map; the landing demo omits it) and passes it
   to the diagnostic overlays, which now accept it as a plain `active`
   prop. The audience adapter supplies it from
   `useAudienceActiveDiagnostics()`. Constraint 2 ("no store/WS/session
   coupling crosses the boundary") holds — this is the same props-in
   inversion as `events`, applied to the diagnostic stream.
2. **`instanceKey` is threaded into the diagnostic seen-key gate**
   (`${instanceKey}\0${identityKey}\0${nodeId}`). Behavior-identical to
   the audience's prior composite within a continuous mount; gives the
   gate the per-render scope the opaque key is meant to carry.
3. **`@a-conversa/shell` is an additional shared peer dependency** of the
   new package (alongside react/react-dom/cytoscape/react-i18next/
   shared-types/i18n-catalogs in constraint 4). The lifted renderer
   consumes shared UI primitives + helpers from shell (`FacetPill`,
   `AxiomMarkBadge`, `flattenActiveDiagnostics*`, `diagnosticIdentityKey`,
   the `EMPTY_*` sentinels, several types). This is graph-view depending
   on shell, not the reverse — shell stays lean.
4. **`./test-utils` export subpath.** `cytoscapeTestEnv` moved into the
   package; the audience `AudienceLiveRoute` suite + the new adapter
   suite import the happy-dom installer via
   `@a-conversa/graph-view/test-utils`, keeping the main barrel free of
   test-only helpers.
5. **Audience adapter test added.** A focused
   `apps/audience/src/graph/GraphView.test.tsx` pins the store→prop
   wiring the adapter owns (event log, URL-session scoping, live
   diagnostics); the renderer's own behavior is pinned by the package
   suites moved per criterion 3.

## Status

**Done** — 2026-06-03.

- Created `packages/graph-view/` workspace package (`package.json`, `tsconfig.json`, `vite.config.ts`, `src/index.ts`) with `@a-conversa/graph-view` name, following the `@a-conversa/shell` template shape (ADR 0010/0026).
- Moved all 31 source + test files from `apps/audience/src/graph/` into `packages/graph-view/src/` via git rename, including projector, layout, stylesheet, overlay hooks, eight DOM overlays, and all co-located Vitest suites.
- Extracted store coupling: `GraphView` now takes `events: readonly Event[]`, `instanceKey: string`, and `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` as props (no WebSocket/session/store import crosses the package boundary).
- `apps/audience` refactored onto a thin `AudienceGraphView` adapter (`apps/audience/src/graph/GraphView.tsx`) that calls `useAudienceSession()` + `useAudienceActiveDiagnostics()` and renders the package `<GraphView>`; adapter test suite added at `apps/audience/src/graph/GraphView.test.tsx` (4 cases).
- Wired workspace: `apps/audience/package.json` + `tsconfig.json`, root `tsconfig.json` references, and `AudienceLiveRoute.test.tsx` updated.
- Amended `docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md` noting the read-only renderer now lives in `@a-conversa/graph-view`; `docs/adr/0039-shared-read-only-graph-view-package.md` committed (new ADR for the package boundary).
- Implementation amendments documented in `## Implementation amendments`: `activeDiagnostics` third prop, `instanceKey` in the diagnostic seen-key gate, `@a-conversa/shell` peer dependency, `./test-utils` export subpath.
- Verification: 350 tests pass; `typecheck`, `build`, `eslint` clean; Playwright green.
