# 0047 — Parent supersession reaches the canvases by client-side derivation from the commit event, not wire emission

- **Date**: 2026-06-11
- **Status**: Accepted

## Context

The design docs are explicit that a committed structural operation supersedes its parent node. [`docs/methodology.md`](../methodology.md) L154–158: *"When a decomposition is `agreed`, **the raw utterance is removed** from the current visible graph and replaced by its component nodes."* [`docs/data-model.md`](../data-model.md) L276–289 defines the **visible-graph derivation**: *"visibility is purely a function of the event log"*, and a node is superseded by a subsequent committed event of one of three kinds — `decompose` referencing it as parent, `interpretive-split` referencing it as parent, or `edit-wording` with `kind: restructure` referencing it as the old node. Edges incident to a superseded node become invisible by virtue of the missing endpoint.

The server projection implements the rule: the `decompose` and `interpretive-split` commit arms in [`apps/server/src/projection/replay.ts`](../../apps/server/src/projection/replay.ts) L1291–1321 call `projection.setNodeVisible(parent_node_id, false)` (the restructure arm at L1261–1290 does the same for the old node). But the flip is internal — the `visibility-changed` change objects those arms push are a projection-local change feed, never serialized to the wire. The only removal event kind on the wire, `entity-removed`, is scoped by [ADR 0027](0027-entity-and-facet-layers-strict-separation.md) §3 to **withdrawn** proposals' propose-time-minted entities.

The frontend surfaces diverge:

- The moderator projector (`projectNodes`, [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../apps/moderator/src/graph/GraphCanvasPane.tsx) L612–872) and the participant projector ([`apps/participant/src/graph/projectGraph.ts`](../../apps/participant/src/graph/projectGraph.ts) L476–770) drop nodes only on `entity-removed` — a superseded parent stays rendered forever.
- The shared audience/replay projector ([`packages/graph-view/src/projectGraph.ts`](../../packages/graph-view/src/projectGraph.ts)) **already derives supersession client-side**: it records pending `decompose` / `interpretive-split` / `edit-wording.restructure` proposals (L608–611), and on observing the matching committed resolution adds the parent (or old node) to a superseded set (L675–680) and omits it from the emitted graph.

The 2026-06-10 parking-lot triage confirmed the docs as intended behavior (Option A — hide the parent) over amending the docs. The question this ADR settles: **how does parent supersession reach the moderator and participant canvases** — a newly emitted wire event, or the same derivation the audience projector already ships — and where does the rule live.

## Decision

**1. Supersession is derived client-side from events already on the wire.** No new event kind, no `entity-removed` emission for superseded parents. Every projector already consumes the proposal envelope (it renders pending proposals) and the proposal-keyed `commit` event; correlating the two yields the superseded node id in a single lookup. This is the model the docs themselves define — visibility is *"purely a function of the event log"* — and it is the only mechanism that corrects **already-recorded** event logs: an emitted event would fix future sessions only, leaving every existing recorded session, fixture, and synthetic-session log rendering superseded parents on the replay surface.

**2. The rule lives once, in `@a-conversa/shell`.** The walk that `packages/graph-view` ships is extracted into a pure shell helper (shape latitude to the implementer; the contract is *events-prefix in, set of superseded node ids out*), and all three surfaces consume it: `graph-view` refactors onto it (no behavior change), the moderator and participant projectors adopt it and filter superseded nodes plus their incident edges. Precedent: [ADR 0043](0043-client-side-replay-position-navigation-in-shell.md) established `@a-conversa/shell` as the home for client-side projection-family logic with multiple surface consumers; `graph-view` already depends on shell (`packages/graph-view/package.json` L28).

**3. The helper implements the full documented rule — all three superseding kinds** (`decompose`, `interpretive-split`, `edit-wording.restructure`), matching both the data-model list and the existing `graph-view` reference implementation. Scoping it to the two kinds in the motivating task's title would fork the rule across surfaces.

**4. Incident edges drop by the missing-endpoint rule**, evaluated per surface against the superseded-node set (each surface has its own edge model). Interpretive-split's inherited edges ([ADR 0046](0046-interpretive-split-edge-inheritance-commit-time-carry.md)) are unaffected — their endpoints are the reading nodes.

### Alternatives considered and rejected

- **Emit `entity-removed` for the parent at commit time** (extend ADR 0027 §3's mechanism). Rejected on three grounds. *Semantics*: withdrawal removes propose-time debris from the structure; supersession keeps the node in the historical record, hidden from the current graph, per-session (`docs/data-model.md` L287–289) — overloading one event kind with both meanings muddies provenance. *Back-compat*: existing event logs carry no such event, so the replay surface would still show superseded parents for every recorded session unless clients *also* derive — two mechanisms for one rule. *Consistency*: ADR 0027's own Consequences already state the parent "only flips off on commit per the existing Node visibility rules" — i.e., by derivation, not by a removal event.
- **A new `visibility-changed` wire event** mirroring the server projection's internal change feed. Rejected: same back-compat hole, plus a new event kind (migration, schema, Cucumber surface) whose entire content is computable from events already on the wire — protocol widening for zero information.
- **Per-projector inline derivation** (leave `graph-view`'s walk in place, copy it into the moderator and participant projectors). Rejected: three implementations of one methodology rule is exactly the duplication ADR 0027 §3 warned against when it rejected client-side ghost synthesis; the shell extraction gives one implementation, three consumers, unit-tested once.

**Why this does not contradict ADR 0027 §3**, which rejected implicit derivation for withdraw-removal: the withdraw rule was genuinely multi-step ("proposal withdrawn AND no committed facets") and not recoverable from any single event correlation, so an explicit event was the cheaper query. Supersession is a one-step correlation (committed structural resolution → parent id from its proposal envelope) that the docs define as derived state. Both decisions preserve the same property — "why isn't this entity visible?" stays a cheap, local question: an `entity-removed` lookup for withdrawals, a superseded-set membership test for supersession.

## Consequences

- **No protocol, schema, or migration change.** The wire shape is untouched; no new Cucumber scenario is owed at the protocol seam (the server projection's visibility flip is already pinned by its own tests).
- **`@a-conversa/shell` gains the supersession helper** with its own Vitest suite; `packages/graph-view` refactors onto it with existing tests pinning no behavior change; the moderator and participant projectors filter superseded nodes and incident edges.
- **Canvas-level filtering, not store deletion.** Superseded nodes' data (wording, ids) stays available to non-canvas consumers — the change-history pane, pending-proposal rows whose target was superseded, provenance chains.
- **E2e contracts change deliberately.** `tests/e2e/methodology-full-flow.spec.ts` phases that interact with the superseded N1 after its decompose commit retarget to still-visible nodes; `tests/e2e/full-session-walkthrough.spec.ts` AC-5b's deferral block is replaced by the real parent-removal assertion. Scoped in [`tasks/refinements/moderator-ui/mod_decompose_split_parent_visibility.md`](../../tasks/refinements/moderator-ui/mod_decompose_split_parent_visibility.md).
- **Amendment entry on ADR 0027** recording that this ADR settles the client-side mechanism for the Node-visibility flip its Consequences anticipated.
