# 0039 — Shared read-only graph-view package (`@a-conversa/graph-view`)

## Status

Accepted (2026-06-03)

## Context

ADR 0004 chose Cytoscape.js as the single renderer for every read-only
surface — participant tablet, audience/broadcast, replay/test — and stated
that "read-only surfaces share one renderer" so a visual fix propagates
across surfaces from one place. Until now that sharing was aspirational: the
audience surface's pure projector plus its Cytoscape renderer live entirely
inside `apps/audience/src/graph/` and are reachable only from the audience
app.

The public landing page (milestone M8-landing) needs that same read-only
renderer to drive a client-side walkthrough of a *precomputed* event log —
no WebSocket, no session, no server (`tasks/47-landing-page.tji:114-126`,
`walkthrough_demo_stepper`). `apps/root` cannot import from `apps/audience`:
apps are leaf Vite bundles, not workspace libraries, and cross-app imports
break both the dependency graph and ADR 0026's surface-bundle model.

The audience renderer is already structured as a pure pipeline, which makes
the extraction a lift-and-shift rather than a rewrite:

- `projectGraph(events)` is a pure function from an event array to Cytoscape
  element descriptors — no store, no network, no side effects
  (`apps/audience/src/graph/projectGraph.ts:328`).
- `buildAudienceLayoutOptions(elements)` and `selectDeterministicRoots` make
  layout a pure function of the element set
  (`apps/audience/src/graph/layoutOptions.ts:99`).
- `STYLESHEET` is a module-scope singleton, diff-by-reference stable
  (`apps/audience/src/graph/stylesheet.ts:188`).
- The eight DOM overlays compose over `useCytoscapeOverlayPlacements`
  (`apps/audience/src/graph/cytoscapeOverlayHooks.ts:108`).

The only audience-specific coupling inside the renderer is that
`AudienceGraphView` calls `useAudienceSession()` internally to fetch
`events`/`sessionId` (`apps/audience/src/graph/GraphView.tsx:332`), and that
node/edge labels are localized through `useTranslation()` against
`methodology.kind.*` / `methodology.edgeRole.*` keys
(`apps/audience/src/graph/GraphView.tsx:432,444`).

## Decision

Extract the pure read-only rendering pipeline into a new workspace package
`@a-conversa/graph-view`, consumed by both `apps/audience` and `apps/root`,
following the `@a-conversa/shell` UI-package template (ESNext / Bundler
tsconfig, Vite build + `tsc --emitDeclarationOnly` declarations, single
`source`-conditioned export).

**Surface-agnostic — MOVES into the package:** `projectGraph` and its
element/data types, the `GraphView` core, `layoutOptions`, `stylesheet` plus
the typography and broadcast-dimension constants, `cytoscapeOverlayHooks`,
the `annotations` projection, all eight DOM overlay components,
`cytoscapeTestEnv`, and their Vitest suites.

**Invert the data source.** The package's `GraphView` takes a precomputed
`events: readonly Event[]` prop plus an opaque `instanceKey` string (the
per-render identity the overlays' seen-key gates need, supplied today by the
audience `sessionId`). It calls no store / session / WebSocket hook. Label
localization stays via react-i18next `useTranslation()` — i18n is a host
concern, not a data-source concern, and keeping it inside the renderer keeps
the projector's emitted labels consistent across surfaces.

**Audience-specific — STAYS in `apps/audience`:** the `useAudienceSession()`
wiring, the WS/Zustand store, and route mounting. `apps/audience` keeps a
thin `AudienceGraphView` adapter that calls the hook and passes
`events`/`sessionId` into the package component, preserving the existing
public component API and the `cyRef` observability seam — so the audience
surface and its full test suite see no behavior change.

**Peer dependencies** (consumers bring their own versions): `react`,
`react-dom`, `cytoscape`, `react-i18next`, `@a-conversa/shared-types`,
`@a-conversa/i18n-catalogs`. Consumers MUST provide the `methodology.kind.*`
and `methodology.edgeRole.*` i18n keys in their i18next bootstrap
(`apps/audience` already does; `apps/root` via the shared catalog).

**Broadcast framing stays the package default.** The OBS
`BROADCAST_DIMENSIONS` pins, the one-shot first-render `cy.fit`, and the
broadcast font sizing ship inside the package as the default behavior, with
the constants exposed as named exports so a non-broadcast consumer (the
landing demo) can later override viewport framing without forking the
renderer. This task changes nothing about the audience defaults.

## Consequences

- The audience renderer's refinement-chain decisions (`aud_cytoscape_init` …
  `aud_dom_overlay_extraction`) are now physically realized as one shared
  module; ADR 0004's "share one renderer" promise becomes a real package
  boundary rather than a per-app copy.
- `apps/root` gains a dependency on `@a-conversa/graph-view`; the
  `walkthrough_demo_stepper` task wires the component into the landing page.
  No server / auth / replay coupling crosses the boundary.
- i18n key coverage becomes a cross-surface contract: any new methodology
  kind or edge role must land in the shared catalog, or the renderer shows a
  missing-key label on every consuming surface.
- The package joins `@a-conversa/shell` as shared UI substrate (ADR 0026)
  but stays focused: only read-only surfaces pull Cytoscape, so the
  moderator (ReactFlow) bundle and `shell` itself stay lean.
- **Amendment sweep:** ADR 0004 receives an `## Amendments` entry recording
  that the read-only renderer is now the `@a-conversa/graph-view` package.
  The implementer performs this sweep at task completion; the refinement
  step that authored this ADR is scoped to the new file only and does not
  edit ADR 0004.

## Alternatives considered

- **Keep the renderer in `apps/audience` and import it from `apps/root`.**
  Rejected: apps are leaf Vite bundles, not workspace libraries; cross-app
  imports break the dependency graph and ADR 0026's surface-bundle model.
- **Put the renderer in `@a-conversa/shell`.** Rejected: shell is the
  auth / mount / WS substrate every surface loads, including the moderator.
  The graph renderer is heavy (Cytoscape + eight overlays) and only
  read-only surfaces need it; a focused package keeps shell lean and lets
  the moderator bundle avoid pulling Cytoscape.
- **Inject the audience store/hook into the package via DI.** Rejected:
  leaks the session/WS concept into a package meant to be store-agnostic. A
  plain `events` prop is the simpler seam with exactly two call sites today.

## Amendments

- **2026-06-03** — Implementation of
  `landing_page.extract_readonly_graph_package` surfaced details the
  Decision above under-specified; recorded here per the amendment-pass
  rule. The boundary (what moves vs. stays) is unchanged.
  - **Second data-source coupling inverted.** Beyond `useAudienceSession()`,
    the two diagnostic overlays read live diagnostic state from the WS
    store via `useAudienceActiveDiagnostics(sessionId)` — a coupling not
    derivable from the `events` log. To keep the package store-free, the
    package `GraphView` takes a third prop `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`
    (defaulting to an empty map) and passes it to the diagnostic overlays,
    which now accept the map as a plain `active` prop instead of calling
    the store. The audience adapter supplies it from
    `useAudienceActiveDiagnostics()`.
  - **`instanceKey` role made concrete.** The opaque `instanceKey` is
    threaded into the two diagnostic overlays' seen-key composite
    (`${instanceKey}\0${identityKey}\0${nodeId}`); within a single
    continuous mount this is behavior-identical to the audience's prior
    bare composite, and it gives the once-per-fire gate a real per-render
    scope as the Decision intends.
  - **`@a-conversa/shell` is a fifth shared peer dependency.** The lifted
    renderer pulls shared UI primitives + helpers from shell
    (`FacetPill`, `AxiomMarkBadge`, the `flattenActiveDiagnostics*` /
    `diagnosticIdentityKey` helpers, the `EMPTY_*` sentinels, and several
    types). `@a-conversa/graph-view` therefore peer-depends on shell in
    addition to the six deps listed under **Peer dependencies**. This is
    the package depending on shell (lean), NOT shell depending on the
    renderer — the moderator/ReactFlow bundle still avoids Cytoscape.
  - **`./test-utils` export subpath.** `cytoscapeTestEnv` moved into the
    package; consuming-app tests (`apps/audience`'s `AudienceLiveRoute`
    suite + the new adapter suite) import the happy-dom installer via the
    `@a-conversa/graph-view/test-utils` export so the main barrel stays
    free of test-only helpers.
