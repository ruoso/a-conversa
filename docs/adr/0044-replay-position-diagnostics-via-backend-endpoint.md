# 0044 — Replay-position structural diagnostics are served by a backend endpoint, not duplicated client-side

## Status

Accepted (2026-06-05)

## Context

Test mode's timeline scrubber lets an operator walk a saved session to any
event-sequence position `0..head`. Several read-only panels hang off the
scrubber's lifted `position` seam
([`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx`](../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx)):
the event inspector and the changed-highlights panel are already shipped, and
`replay_test.test_mode.test_mode_diagnostic_inspector` adds a panel that shows
the **structural diagnostics** (cycles, contradictions, multi-warrants,
dangling claims, coherency hints) the methodology engine would surface for the
projected state *at the current position*.

The two shipped panels are pure client-side reads: the changed-highlights
panel re-projects the graph with `@a-conversa/graph-view`'s `projectGraph`
([`packages/graph-view/src/projectGraph.ts`](../../packages/graph-view/src/projectGraph.ts)),
and the event inspector reads the already-loaded event array. Neither touches
the server. ADR 0039 (shared read-only graph-view package) and ADR 0043
(client-side replay position-navigation in shell) established the pattern:
**the client re-implements projection-family logic it can import, rather than
reach into `apps/server`** (apps are leaf Vite bundles, not workspace
libraries; no frontend package depends on `apps/server`).

The diagnostic detectors do not fit that pattern cheaply. They live in
[`apps/server/src/diagnostics/`](../../apps/server/src/diagnostics/) —
`computeAllDiagnostics(projection)` plus the five detector functions
(`detectSupportsCycles`, `detectContradictions`, `detectMultiWarrants`,
`detectDanglingClaims`, `detectCoherencyHints`), aggregated and exported from
[`apps/server/src/diagnostics/index.ts`](../../apps/server/src/diagnostics/index.ts),
with severity via `classifyDiagnostic` / `partitionBySeverity` in
[`classification.ts`](../../apps/server/src/diagnostics/classification.ts).
Every detector reads the server's `Projection` **class**
([`apps/server/src/projection/projection.ts`](../../apps/server/src/projection/projection.ts))
— its `.nodes()` / `.edges()` / `.getNode()` / `.getEdgesBySource()`
iterators, its pending/committed proposal maps, and `deriveFacetStatus(...)`
([`apps/server/src/projection/facet-status.ts`](../../apps/server/src/projection/facet-status.ts)),
which walks per-participant votes and proposal history. None of that internal
state is on the wire: `GET /sessions/:id/state?position=N`
([`apps/server/src/replay/routes.ts`](../../apps/server/src/replay/routes.ts))
serializes resolved facet *values*, not the derivation inputs the detectors
need, and diagnostics are deliberately **not** persisted to the event log
(they are derived views, recomputable on replay — see
[`apps/server/src/diagnostics/event-emission.ts`](../../apps/server/src/diagnostics/event-emission.ts)).
The only existing client-side diagnostics code in `@a-conversa/shell`
(`projectDiagnosticHighlights`, `diagnosticIdentityKey`) is a *consumption*
layer that turns already-computed wire diagnostics into graph highlights — not
a detection layer.

So unlike the position primitive ADR 0043 ported (four trivial integer
functions, pinned by a mirrored truth table), porting the detectors
client-side means re-implementing the whole detection layer **and** a
client-side `Projection` with facet-status derivation and proposal
resolution — a large, tightly-coupled surface with a real parity-maintenance
burden against the methodology engine, the source of truth. ADR 0043 accepted
duplication precisely because the duplicated logic was trivial; that rationale
does not extend here.

## Decision

Serve replay-position structural diagnostics from a **dedicated backend
endpoint** rather than recomputing them on the client.

- Add `GET /api/sessions/:id/diagnostics?position=N` (a sibling of
  `get_at_position` under `backend.replay_endpoints`). It calls
  `projectAtPosition(events, sessionId, position)` then
  `computeAllDiagnostics(projection)` and returns the wire-shaped
  `DiagnosticEntry[]` for that position, classified by severity. It reuses the
  exact server detectors — **one source of truth, zero parity risk**. This
  endpoint is its own WBS leaf
  (`backend.replay_endpoints.get_diagnostics_at_position`); the test-mode
  diagnostic-inspector panel depends on it.
- The `position` query parameter is the same event-sequence value the client
  emits via the shell position helper (ADR 0043) and that
  `get_at_position` already accepts, so the two replay endpoints agree on every
  stop.
- The test-mode `DiagnosticInspector` panel is a thin read-only client: given
  `{ sessionId, position }`, it fetches the endpoint for the current position
  and renders the returned blocking/advisory entries. It owns no detection
  logic and no position state.

## Consequences

- The diagnostic-inspector panel makes a server round-trip per position it
  reads, unlike the pure-client event-inspector and changed-highlights panels.
  Acceptable: test mode is a low-traffic developer/producer tool, the position
  the client sends is already server-validated, and a stale-response guard
  keyed on `(sessionId, position)` keeps the panel correct under rapid
  scrubbing. No debounce is required for v1.
- The detection layer stays single-sourced in `apps/server`. When the
  methodology engine's diagnostic rules change, the test-mode panel tracks them
  for free — no client mirror to keep in lockstep (contrast ADR 0043's
  deliberate two-copy truth-table sync, justified only by triviality).
- A new public replay endpoint widens the server surface by one read route. It
  is a read-only GET over an existing session log, behind the same auth as the
  other replay endpoints; it adds no write path and no new persistence.
- A future shared server/client diagnostics core (so a fully-offline replay
  surface could compute diagnostics without the server) remains possible but is
  out of scope — there is no offline replay surface today, and ADR 0039's
  precedent is duplication across the boundary only where the duplicated logic
  is small. The detection layer is not.

## Alternatives considered

- **Port the detectors + a client `Projection` into `@a-conversa/shell`**
  (mirroring the ADR 0043 position-navigation port and shell's existing
  `computeFacetStatuses` / `projectDiagnosticHighlights`). Rejected: the
  detectors are not trivial integer logic — they need the full projection
  iterators, proposal maps, and `deriveFacetStatus` derivation, a large surface
  tightly coupled to the methodology engine. Duplicating it client-side creates
  an ongoing parity burden against the source of truth and far exceeds a
  read-only panel's scope. ADR 0043 accepted duplication *because* the logic was
  four trivial functions; this fails that test.
- **Extend `GET /sessions/:id/state?position=N` to include a `diagnostics`
  field** so the export-position panel and the diagnostic panel share one
  fetch. Rejected: it conflates two concerns (raw projected state vs. derived
  diagnostics), bloats every state fetch with a computation most callers don't
  want, and couples two independently-evolving panels. A dedicated, separately
  cacheable endpoint per concern matches the existing one-route-per-concern
  shape of `backend.replay_endpoints`.
- **Reuse the live WS `diagnostic` broadcast** the audience consumes.
  Rejected: that stream carries fired/cleared diagnostics for the session's
  *live head* only; it cannot answer "what diagnostics hold at past position
  N?", which is exactly the scrubber's question.
