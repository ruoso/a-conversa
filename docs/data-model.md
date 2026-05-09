# Data model

> Status: Early design phase. Evolving.

This document defines the structure of a debate graph in `a-conversa`: nodes, edges, ownership, graph properties, structural diagnostics, and how the graph's state and history are represented.

## Nodes

A **node** represents a single statement (or, after decomposition, a single component of an originally-compound utterance). Nodes are first-class entities with the following properties:

### Statement kind

Every node carries one statement kind:

- `fact` — empirical, in-principle verifiable.
- `predictive` — empirical claim about the future or a counterfactual.
- `value` — about what is good, desirable, important.
- `normative` — about what ought to be done.
- `definitional` — about what a term means.

Two further node states are tracked separately from kind:

- `axiom` — a node whose holder declares "nothing could change my mind" on it. Often a terminal value or a foundational fact-commitment. Visually distinct. Surfacing axioms is one of the primary success states of a debate (see [methodology](methodology.md)).
- `meta-disagreement` — a node where participants could not agree on classification or decomposition; carries both proposed classifications side by side. A last-resort state (see [methodology](methodology.md)).

### Ownership

Every node has an **owner**, indicating who contributed it:

- `A` or `B` — the debater who said it.
- `agreed` — both debaters accept this statement (its content and classification). A node typically starts owned by the originating debater and is promoted to `agreed` if the other debater explicitly accepts it.
- `moderator` — moderator-introduced (e.g., a warrant they extracted from an implicit data→claim move). Moderator-introduced nodes still require both debaters' agreement before they land in the graph (same agreement rule as everything else).

Ownership is shown visually (color, marker, or similar — UX detail to be designed).

### Content, facets, and status

A node is not a single thing that is `agreed` or `disputed` as a whole. It carries multiple **facets**, each with its own independent status. A node's wording can be `agreed` while its classification is `disputed` and its substance is `proposed`. The node is "fully agreed" only when every facet has landed (see [methodology — facets](methodology.md#facets)).

Node facets:

- `wording` — the statement text. Does the captured text faithfully represent what was said?
- `classification` — the statement kind (`fact` / `predictive` / `value` / `normative` / `definitional`).
- `substance` — do the participants agree on the content's truth/holding? A `disputed` substance facet is what makes a node function as a `claim` (rather than as `data`) in the disputation test.

Each facet's `status` is one of:

- `proposed` — the facet has been proposed but not yet agreed. Visible on the graph in a distinct state, awaiting agreement.
- `agreed` — all participants have agreed; the facet's value is locked in.
- `disputed` — at least one participant has rejected the proposed value. Stays visible while methodology runs to resolve.
- `meta-disagreement` — irreducible disagreement; both proposed values carried side by side.

The same status enum applies uniformly to every facet of every entity, and to standalone operations (decompositions, axiom-marks). Each status transition is recorded as a separate event in the change history.

Operations that create new entities (capturing a statement, decomposing a node, extracting a warrant) produce entities whose facets each start as `proposed`. Agreeing to the operation does not pre-agree any facet of the resulting entities — each requires its own symmetric agreement.

## Edges

Edges are **explicit, first-class entities**. The moderator creates each edge deliberately; edges are not auto-derived from node properties. The system provides **coherency guidance** (warning when an edge type doesn't fit the typical pattern for the node kinds involved) but does not prevent the moderator from creating an edge — guidance is advisory, not strict validation.

Like nodes, edges have multiple facets, each with its own independent status:

- `shape` — the edge's role/type (`supports`, `rebuts`, etc.) and its endpoints (which nodes it connects).
- `substance` — does the relation actually hold? (Does the data actually support? Does the contradiction actually obtain? Does the warrant actually license the inference?)

A proposed `contradicts` edge between two nodes typically lands its `shape` facet quickly (the proposal is observable: yes, A is claiming a `contradicts` between N1 and N2) while its `substance` facet may stay `disputed` indefinitely as the methodology runs (does the contradiction actually hold?). The edge is visible throughout, in whatever per-facet state it currently occupies.

### Edge roles

Edges carry one of the following roles, drawn from the Toulmin model with additions:

- `supports` — source provides evidence or backing for target. Covers data→claim and backing→warrant.
- `rebuts` — source challenges or refutes target.
- `qualifies` — source hedges the scope or degree of target ("usually", "in most cases", "except when X").
- `bridges` — a warrant: relates a `data` node and a `claim` node, asserting that the data licenses the inference to the claim. Structurally a relation among three nodes (warrant, data, claim) — see "Warrants and bridging" below.
- `defines` — source provides the meaning of a term used in target.
- `contradicts` — source and target conflict; both cannot be true. Symmetric. Treated uniformly regardless of owner — there is no separate "internal" vs. "external" contradiction (see "Structural diagnostics").

### Warrants and bridging

A warrant connects a specific data→claim inference. It is a node (so it can have its own kind, owner, backing, rebuttals, etc.) but its argumentative purpose is to relate a (data, claim) pair. Modeled as a `bridges` relation between three nodes: the warrant `W`, the supporting data `D`, and the claim `C`.

> Implementation note (open): whether `bridges` is stored as a hyperedge, as a triple `(W, D, C)`, or as two edges with a shared bridge-group identifier is an implementation detail. The logical model is: a warrant bridges a specific data→claim pair, and the bridge can itself be an object that other things attach to.

### Coherency guidance

Some edge/node configurations are typical; others are unusual. The system provides advisory hints when an unusual configuration is created. Examples:

- A `defines` edge from a `definitional` node to a `claim` node — typical.
- A `supports` edge from a `value` node to a `fact` node — unusual; often signals that the "fact" is doing prescriptive work and may need decomposition.
- A `rebuts` edge from a `definitional` node to a `value` node — unusual; warrants a "are you sure?" prompt.

The list of typical/unusual patterns will grow with experience. The system never blocks; it nudges.

## Graph properties

### Full graph (cycles allowed)

The debate graph is a **full directed graph** — cycles are permitted. Cycles in `supports` chains are circular reasoning, which is a logical error; the system surfaces them so they can be explicitly resolved (see "Structural diagnostics").

Allowing cycles in the data model is deliberate: forbidding them at the structural level would force participants to suppress or hide circular reasoning when it occurs naturally in argument. Letting cycles appear and then making them visible turns "we just caught a circular argument" into a debate move rather than a paperwork error.

### Cross-debater linking

The graph is shared. Edges cross debater boundaries freely — debater B's `rebuts` edge can target debater A's `claim`, two debaters can both `support` a shared `agreed` fact, and so on. There are no separate sub-graphs per debater.

## Structural diagnostics

The system continuously surfaces structural patterns that signal logical or argumentative problems. These are **highlighted in the visible graph** and are typically expected to be resolved before the debate moves on (the agreement rule extends here too — participants should agree on a resolution path).

### Cycles in support

Any cycle in `supports` edges indicates circular reasoning. The system highlights the cycle. Resolution paths:

- Break one of the `supports` edges (the participants acknowledge it doesn't actually hold).
- Decompose one of the nodes in the cycle (the apparent loop turns out to be about different aspects of the node).
- Promote one of the nodes to `axiom` (the cycle dead-ends at a foundational commitment).

### Contradictions

A `contradicts` edge between two nodes is itself a structural problem: both cannot be true. Contradictions are treated uniformly — there is no special handling for "internal" (same owner) vs. "external" (different owners) contradictions; a contradiction is a contradiction. Resolution paths:

- Decompose one or both nodes (most common — the apparent contradiction reveals that the two statements are about different things, or each is compound and the conflict is between specific components).
- Amend one node so the conflict no longer holds.
- Promote both to `axiom` and accept that this is the bedrock disagreement of the debate (a primary success state, not a failure).

A debate of substance will typically have at least one prominent contradiction at its center — that's the disagreement under discussion. Marking it explicitly makes the goal of the debate visible.

### Multiple competing warrants on one data→claim move

When two or more warrants both bridge the same (data, claim) pair, and they assert different bridges, this is a strong signal that **the claim is bundling multiple things**. Each warrant is anchoring on a different aspect of the claim. The system highlights this pattern as a likely-decomposition prompt; the typical resolution is to decompose the claim into its components, after which each warrant attaches to a different component.

### Dangling claims

A node positioned as a claim (i.e., something a debater is defending) with no incoming `supports`, `rebuts`, or `bridges` is "dangling." Not an error — claims can stand briefly before being supported — but tracked as a state. A claim that remains dangling for long is either being implicitly accepted or implicitly conceded; the moderator can prompt for support or for explicit disposition.

### Coherency violations

Unusual edge/kind configurations (per "Coherency guidance" above) are flagged as advisory hints. Not errors; not blockers. Just nudges that something might warrant a closer look.

## Visibility and history

### Current view

The visible graph always shows the **full current tree** — there is no collapsing or hiding of nodes. Whatever is currently in the graph is rendered. This is deliberate: collapsing would let unresolved structure hide from the audience, undermining the whole point.

Earlier states of the graph are **not** kept visible. When a statement is decomposed, the raw utterance disappears from the current view, replaced by its components. When a node is amended, the prior wording is no longer shown. The current view shows the current best understanding.

### Change history

Every graph operation is recorded in a **change history** event log: classify, decompose, amend, connect (edge added), disconnect, mark-axiom, declare-meta-disagreement, mark-contradiction, mark-cycle, etc. Each event records who proposed it, who agreed, and the timestamp.

The change history is available out-of-band — for replay, audit, post-debate analysis, and possibly a separate production view (e.g., a side-display showing the most recent N operations as the audience watches the main graph). The history does not clutter the live graph.

## Open implementation questions

- Storage model for `bridges` (hyperedge vs. triple vs. edge-group).
- Whether structural diagnostics (cycles, contradictions) must be resolved before the debate proceeds, or merely visible. Likely a mix: some block (contradictions on the topic-level question), some warn (advisory coherency hints).
- Visual distinction between `proposed`, `agreed`, `disputed`, and `meta-disagreement` states — to be designed so the audience can read graph state at a glance.
