# Data model

> Status: Early design phase. Evolving.

This document defines the structure of a debate graph in `a-conversa`: nodes, edges, ownership, graph properties, structural diagnostics, and how the graph's state and history are represented.

## Sessions and scope

A debate is conducted within a **session**. Each session is independent and has its own authenticated participants. Nodes and edges, however, have global identity — the same node (with its wording) can be referenced in many sessions; the same structural edge can appear in many sessions. This M-N relationship lets one session build on another (e.g., citing prior episodes' axioms).

Concretely, what's global vs. session-scoped:

- **Global to a graph entity:** a node's `wording`; an edge's `shape` (role + endpoints).
- **Session-scoped:** every other facet (`classification`, `substance`), per-participant agreement, axiom marks, annotations, and structural diagnostics. The participants making and reading these facets are themselves session-scoped.

A node referenced in a new session starts fresh — its session-scoped facets begin in `proposed` and run through the standard lifecycle in the new session, with the new session's participants. State does not auto-inherit. (Future versions may offer opt-in inheritance with imported state landing as starting proposals; out of scope for v1.)

The rest of this document describes the graph as it appears within a single session — that is the graph the methodology operates on. See [architecture.md](architecture.md) for the multi-session storage and orchestration story.

## Nodes

A **node** represents a single statement on the graph. Nodes are first-class entities with the following properties.

### Statement kind

Every node carries one statement kind:

- `fact` — empirical, in-principle verifiable.
- `predictive` — empirical claim about the future or a counterfactual.
- `value` — about what is good, desirable, important.
- `normative` — about what ought to be done.
- `definitional` — about what a term means.

The kind is the value of the node's `classification` facet (see "Content, facets, and status" below). When the classification facet is in `meta-disagreement` state, the node carries two proposed kinds side by side until resolution.

The five values above (and the edge roles, facet states, vote choices, annotation kinds, and diagnostic kinds defined elsewhere in this document) are **wire-format identifiers, not display labels** — their localized renderings for non-English UI locales are a frontend render-layer concern, recorded in [ADR 0024](adr/0024-frontend-i18n-react-i18next-with-icu.md) and the methodology glossary refinement.

### Axiom marks

A node can carry one or more **axiom marks**. Each axiom mark is made by a specific participant and records "this participant declares no evidence would change their mind on this node." Axiom marks are **per-participant** — Ben may hold N9 as an axiom while Anna does not, or both may hold the same node as axiomatic from their respective frames. An axiom-mark is a graph operation recorded in the change history (not a graph entity in its own right) and is rendered visually on the node it marks. Surfacing axioms is a primary success state of the format. See [methodology — axioms](methodology.md#axioms--terminal-values).

### Ownership

Every node has an **owner**, indicating who contributed it:

- `A` or `B` — the debater who said it (or first proposed it).
- `moderator` — moderator-introduced (e.g., a warrant they extracted from an implicit data→claim move).

Ownership is **independent of agreement**. A node owned by `A` may have all of its facets agreed by all participants — that's an "agreed" node, but its ownership remains `A` (it originated with A). Agreement is per-facet, per-participant (see below).

Ownership is shown visually (color, marker, or similar — UX detail to be designed).

### Per-participant agreement tracking

Each participant (debater A, debater B, moderator) records their agreement on each facet of each entity individually. A facet's overall status is derived from the per-participant votes on its most-recent unresolved proposal *plus* whether the moderator has committed it. See [methodology — the commit step](methodology.md#the-commit-step) for the workflow:

- `proposed` — a proposal exists but has not been committed yet. This covers both "still gathering votes" and "all voted agree, awaiting moderator commit." The proposal is visible on the graph throughout.
- `agreed` — the moderator has committed the proposal (which requires every current participant to be voting `agree` at commit time).
- `disputed` — at least one participant has voted `dispute` on the most-recent proposal, blocking commit.
- `meta-disagreement` — the moderator has marked the proposal as meta-disagreement; both proposed values are carried side by side.

"Agreed" is transient over the participant set: any change in who counts as a participant in the debate would re-open every facet for re-agreement. (In the live YouTube-show format the participant set is fixed, so this is mostly a theoretical concern; it matters for async / replay scenarios.)

Participants may **withdraw agreement** they previously gave. A `withdraw` vote sends the facet back to `disputed` and effectively supersedes the prior commit; the original commit and the withdrawal are both recorded in the change history.

For the full event-level catalog, see [Event types](#event-types) below.

### Content, facets, and status

A node is not a single thing that is `agreed` or `disputed` as a whole. It carries multiple **facets**, each with its own independent status. A node's wording can be `agreed` while its classification is `disputed` and its substance is `proposed`. The node is "fully agreed" only when every facet has landed (see [methodology — facets](methodology.md#facets)).

Node facets:

- `wording` — the statement text. Does the captured text faithfully represent what was said?
- `classification` — the statement kind (`fact` / `predictive` / `value` / `normative` / `definitional`).
- `substance` — do the participants agree on the content's truth/holding? A `disputed` substance facet is what makes a node function as a `claim` (rather than as `data`) in the disputation test.

Each facet's `status` is one of:

- `proposed` — a value has been proposed but not yet committed. Visible on the graph in a distinct state, awaiting agreement and the moderator's commit.
- `agreed` — the moderator has committed the proposal (requiring every current participant to be voting `agree`); the facet's value is locked in.
- `disputed` — at least one participant has rejected the proposed value, blocking commit. Stays visible while methodology runs to resolve.
- `meta-disagreement` — irreducible disagreement; both proposed values carried side by side.

The same status enum applies uniformly to every facet of every entity, and to standalone operations (decompositions, axiom-marks). Each status transition is recorded as a separate event in the change history.

Operations that create new entities (capturing a statement, decomposing a node, extracting a warrant) produce entities whose facets each start as `proposed`. Agreeing to the operation does not pre-agree any facet of the resulting entities — each requires its own symmetric agreement.

## Edges

Edges are **explicit, first-class entities**. The moderator creates each edge deliberately; edges are not auto-derived from node properties. The system provides **coherency guidance** (warning when an edge type doesn't fit the typical pattern for the node kinds involved) but does not prevent the moderator from creating an edge — guidance is advisory, not strict validation.

Edges have an **owner** (`A`, `B`, or `moderator`) — the participant who proposed the edge. Like node ownership, edge ownership is independent of agreement.

Like nodes, edges have multiple facets, each with its own independent status:

- `shape` — the edge's role/type (`supports`, `rebuts`, etc.) and its endpoints (which nodes it connects).
- `substance` — does the relation hold *if the source's content is true*?

The substance facet uses a **conditional reading**: participants can agree the relation holds (e.g., "if this data were true, it would support that claim") independently of whether the source's own content is substantively established. This separation matters — it lets the format capture commitments like "I'd accept that as a rebut, if it turned out to be the case" without requiring the source to be agreed-true first.

Whether the relation is **actively firing** on the graph right now — whether the data actually supports, whether the contradiction actually obtains, whether the warrant actually licenses the inference — is the conjunction `edge.substance ∧ source.substance`. Both must be `agreed` for the relation to take current effect.

This conditional reading also gives **defeaters** a natural home: a defeater is a regular node (the retraction condition, with its own `wording`, `classification`, `substance` facets) plus a `rebuts` edge to the defeated target whose substance is `agreed` but whose source's substance is not yet `agreed`. The pre-commitment is structural; the rebut sits in the graph but does not currently fire. If the source ever becomes substantively established, the rebut activates. (See [methodology.md](methodology.md) for how defeaters are captured during the operationalization test.)

> Future development: the system could surface "pending consequences" as a structural diagnostic — `agreed`-substance edges whose source substance is not yet agreed, signalling commitments that would fire if the source were established. Out of scope for v1; recorded as a possible future feature.

Edges have no `wording` facet — they are structural, not utterances. (Their `content` if any lives in annotations, see below.)

A proposed `contradicts` edge between two nodes typically lands its `shape` facet quickly (the proposal is observable: yes, A is claiming a `contradicts` between N1 and N2) while its `substance` facet may stay `disputed` indefinitely as the methodology runs (does the contradiction obtain, conditional on both endpoints being true?). The edge is visible throughout, in whatever per-facet state it currently occupies.

### Edge roles

Edges carry one of the following roles, drawn from the Toulmin model with additions. All roles are directed (source → target):

- `supports` — source provides evidence or backing for target. Covers data→claim and backing→warrant.
- `rebuts` — source challenges or refutes target.
- `qualifies` — source hedges the scope or degree of target ("usually", "in most cases", "except when X").
- `bridges-from` — outgoing from a warrant node to the data node it draws on.
- `bridges-to` — outgoing from a warrant node to the claim node it licenses.
- `defines` — source provides the meaning of a term used in target.
- `contradicts` — source and target conflict; both cannot be true. Directed. If a contradiction is genuinely symmetric (each rules out the other in the same way), it is represented as **two** `contradicts` edges in opposite directions; this avoids special-casing symmetric edges in storage and rendering. Treated uniformly regardless of owner — there is no separate "internal" vs. "external" contradiction (see "Structural diagnostics").

### Warrants and bridging

Warrants are ordinary nodes — they have wording, classification, and substance facets, an owner, axiom marks if applicable, and may carry their own incoming and outgoing edges (e.g., backing as `supports → warrant`).

The "bridge" relationship — that a warrant licenses the inference from a specific data node to a specific claim node — is expressed by **two ordinary directed edges from the warrant**:

- An edge with role `bridges-from` from the warrant `W` to the data node `D`.
- An edge with role `bridges-to` from the warrant `W` to the claim node `C`.

This keeps the data model simple: every relation is a directed edge between two nodes. No hyperedges, no triples, no edges-on-edges. The "Toulmin step" (data → claim, licensed by warrant) is detected by the system as a **structural pattern** when these three nodes and two edges co-occur, and is surfaced for diagnostics like "multiple competing warrants on one (D, C) pair."

A `supports` edge directly from `D` to `C` may still exist independently (claiming the data supports the claim with an implicit warrant). When an explicit warrant is later added, the participants decide whether the direct `supports` edge should remain (the warrant supplements it) or be replaced (the warrant fully accounts for the inference).

### Annotations

Both nodes and edges may carry **annotations** — notes attached to the entity that record participant context the participants want preserved without modifying the entity's core meaning. Examples from the walkthrough: Ben's note that D1's accreditation boundary "does argumentative work" (an annotation accepted as part of agreeing to D1, but recording his concern); a "declines to press" methodological stance attached to a node Ben chose not to argue.

An annotation has its own owner, content, and the standard facet set (`wording` for the annotation text; `substance` if the annotation makes a substantive claim). Annotations are first-class proposed changes that go through the same agreement lifecycle as nodes and edges. An annotation can itself be disputed, decomposed, or retracted.

Annotations are visually distinct from the entity they annotate (smaller text, attached marker, or similar — UX to be designed) but stay co-located with the entity in the current view.

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
- A participant axiom-marks one of the nodes in the cycle (the chain terminates at that participant's foundational commitment, so it doesn't need further support from inside the cycle).

### Contradictions

A `contradicts` edge between two nodes is itself a structural problem: both cannot be true. Contradictions are treated uniformly — there is no special handling for "internal" (same owner) vs. "external" (different owners) contradictions; a contradiction is a contradiction. Resolution paths:

- Decompose one or both nodes (most common — the apparent contradiction reveals that the two statements are about different things, or each is compound and the conflict is between specific components).
- Amend one node so the conflict no longer holds.
- The relevant participants each axiom-mark the position they hold; the `contradicts` edge stays. This accepts the contradiction as the bedrock disagreement of the debate (a primary success state, not a failure).

A debate of substance will typically have at least one prominent contradiction at its center — that's the disagreement under discussion. Marking it explicitly makes the goal of the debate visible.

### Multiple competing warrants on one data→claim move

When two or more warrants both bridge the same (data, claim) pair, and they assert different bridges, this is a strong signal that **the claim is bundling multiple things**. Each warrant is anchoring on a different aspect of the claim. The system highlights this pattern as a likely-decomposition prompt; the typical resolution is to decompose the claim into its components, after which each warrant attaches to a different component.

### Dangling claims

A node positioned as a claim (i.e., something a debater is defending) with no incoming `supports`, `rebuts`, or `bridges-to` is "dangling." Not an error — claims can stand briefly before being supported — but tracked as a state. A claim that remains dangling for long is either being implicitly accepted or implicitly conceded; the moderator can prompt for support or for explicit disposition.

### Coherency violations

Unusual edge/kind configurations (per "Coherency guidance" above) are flagged as advisory hints. Not errors; not blockers. Just nudges that something might warrant a closer look.

## Visibility and history

### Current view

The visible graph always shows the **full current tree** — there is no collapsing or hiding of nodes. Whatever is currently in the graph is rendered. This is deliberate: collapsing would let unresolved structure hide from the audience, undermining the whole point.

Earlier states of the graph are **not** kept visible. When a statement is decomposed, the raw utterance disappears from the current view, replaced by its components. When a node is amended, the prior wording is no longer shown. The current view shows the current best understanding.

### Change history

Every graph operation is recorded in a per-session **change history** event log. The history captures every per-facet status transition, every participant vote, every commit, every withdrawal, every operation that doesn't produce a persistent entity (decomposition, interpretive split, axiom-mark, meta-move, wording edit). Each event records the actor, timestamp, and any payload specific to the event kind.

**Operations that aren't graph entities live only in the change history.** Decompositions, interpretive splits, axiom-marks, and meta-moves are events recorded in history; their *effects* (nodes added or removed, axiom rendering, etc.) appear on the graph. The change-history view (see [methodology.md](methodology.md)) is the primary surface for past operations; their effects unfold on the live graph and through replay.

The change history is available out-of-band — for replay, audit, post-debate analysis, and possibly a separate production view (e.g., a side-display showing the most recent N operations as the audience watches the main graph). The history does not clutter the live graph.

Granularity is **fine-grained**: each individual proposal, each individual participant vote, each individual commit is its own event. This gives per-event timeline scrubbing in test/replay mode (see [architecture.md — test mode](architecture.md#test-mode)) and full audit fidelity.

### Event types

The change history is an append-only log of typed events. Events fall into the categories below.

#### Session lifecycle

- `session-created` — initializes a session. Payload: host, privacy (public/private), creation timestamp.
- `session-ended` — closes a session (deliberate end-of-show). Optional in v1.
- `participant-joined` — participant joins. Payload: participant id, role (`moderator` / `debater-A` / `debater-B`), screen name, timestamp.
- `participant-left` — participant leaves. Affects derivation of "all current participants have agreed" for in-flight proposals.

#### Global entity creation

These create entities in the *global* graph and typically co-occur with `entity-included` for the originating session.

- `node-created` — payload: node id, wording, creator, timestamp.
- `edge-created` — payload: edge id, role (`supports` / `rebuts` / etc.), source-node-id, target-node-id, creator, timestamp.
- `annotation-created` — payload: annotation id, content, target-entity-id (node or edge), creator, timestamp.

#### Session inclusion

- `entity-included` — the session begins referencing an existing global entity. Payload: session id, entity-id, by-whom, timestamp.

#### Proposals

A proposal is a proposed change to the session's view of the graph, awaiting agreement. All proposals share the same lifecycle (`proposed` → `agreed` / `disputed` / `meta-disagreement`) but vary in payload by `kind`:

- `classify-node` — proposes a statement kind for a node within this session. Payload: node, proposed kind.
- `set-node-substance` — proposes whether the node's content holds. Payload: node, proposed value (`agreed` or `disputed`).
- `set-edge-substance` — proposes whether the relation holds (conditional reading; "if source were true, would the relation hold?"). Payload: edge, proposed value.
- `edit-wording` — proposes editing a node's wording. Payload depends on `kind`:
  - `kind: reword` — payload `{ node, new_wording }`. The node's `wording` is updated in place; prior wording lives only in the change history.
  - `kind: restructure` — payload `{ node, new_wording, new_node_id }`. The proposal supersedes the old node with a freshly-created node (`new_node_id`, created via a paired `node-created` event) carrying the new wording. The old node becomes invisible in the projected graph after this event commits.
- `decompose` — proposes splitting a node into components. Payload: parent node, list of components (each with proposed wording / classification).
- `interpretive-split` — proposes splitting along reading seams. Payload: parent node, list of readings.
- `axiom-mark` — proposes that a named participant holds a node as bedrock. Payload: node, participant.
- `meta-move` — proposes a reframe / scope change / methodological stance. Payload: kind (reframe | scope-change | stance), content, target.
- `break-edge` — proposes removing an edge (for cycle resolution; "this support doesn't actually hold"). Payload: edge.
- `amend-node` — proposes changing a node's content beyond a wording edit (used in contradiction resolution). Payload: node, new content.
- `annotate` — proposes a new annotation on an existing entity. Payload: target entity, content.

Each proposal event records: proposer, target session, proposal kind, payload, timestamp. Each proposal gets an id used by votes and the commit.

#### Votes

- `vote` — a participant signals their stance on a proposal. Payload: proposal id, participant, vote (`agree` | `dispute` | `withdraw`), timestamp. Withdraw applies only to a previously-agreed proposal and sends the facet/operation back to `disputed`.

#### Resolutions

- `commit` — the moderator commits a proposal that has all participants currently voting `agree`. Payload: proposal id, moderator, timestamp. This is the event that transitions the relevant facet/operation to `agreed` and applies its effects.
- `meta-disagreement-marked` — the moderator marks a proposal as meta-disagreement (last-resort fallback after methodology has run). Payload: proposal id, moderator, timestamp. Both proposed values are carried side by side.

#### Snapshots

- `snapshot-created` — names a position in the event log for replay reference. Payload: label, log position, creator, timestamp.

### Visible-graph derivation

The session's visible graph at any event-log position is computed from the event log according to these rules. The `session_nodes` and `session_edges` join tables are an index into the event log (recording every entity ever referenced in this session) and not a representation of the visible state — visibility is purely a function of the event log.

**Node visibility.** A node is visible in the session iff:

1. An `entity-included` event for the node has been committed for this session, **and**
2. The node has not been **superseded** by a subsequent committed event of one of these kinds:
   - `decompose` whose payload's parent references this node;
   - `interpretive-split` whose payload's parent references this node;
   - `edit-wording` with `kind: restructure` whose payload's `node` (old node id) references this node.

Once superseded, the node remains in `session_nodes` (the table is monotonic) but is no longer rendered in the visible graph. The same global node may be re-included in a different session and behave normally there; supersession is per-session.

**Edge visibility.** An edge is visible iff:

1. An `entity-included` event for the edge has been committed for this session, **and**
2. No subsequent committed `break-edge` event references this edge, **and**
3. Both endpoint nodes are currently visible per the rule above.

When a node becomes invisible, every edge with that node as source or target becomes invisible automatically. No explicit edge-removal event is needed; the projection computes edge visibility from endpoint state.

**Annotation visibility.** An annotation is visible iff:

1. An `annotation-created` event has fired for the annotation in this session's history, **and**
2. The annotation's target entity (node or edge) is currently visible.

If the target becomes invisible, the annotation does too.

**Implication for restructure.** When a node is restructured, the `edit-wording` event with `kind: restructure` supersedes the old node. The new node (created via a paired `node-created` event) is included in this session and rendered in its place. Edges that pointed at the old node become invisible by virtue of the missing endpoint — they do not auto-follow to the replacement. If participants want analogous edges on the new node, they must propose them explicitly.

### Facet status derivation

A facet's overall status is derived from the per-participant votes on the most-recent unresolved proposal for that facet:

- No proposal yet, or proposal exists with at least one participant who hasn't voted → `proposed`.
- All current participants voting `agree`, awaiting moderator commit → `proposed` (still — the moderator's commit is what lands it).
- Most-recent proposal has been `commit`-ed → facet `agreed`, value = proposed value.
- At least one participant currently voting `dispute` (and no successful subsequent commit) → `disputed`.
- Moderator marked the facet as `meta-disagreement-marked` → `meta-disagreement`, carrying both proposed values.
- `withdraw` vote sends the facet back to `disputed` (effectively superseding the prior commit).

The change history is the source of truth; the in-memory projection computes current facet status by replaying the log.

## Surfacing operations in the UI

Operations that aren't graph entities (decompositions, axiom-marks, interpretive splits, meta-moves) are reviewable through **the change history view**, which is the primary surface for past operations. Their *effects* on the graph (nodes added or removed, axiom rendering, etc.) appear on the live graph as commits happen, and replay through the timeline scrubber. The graph state itself stays simple — only nodes, edges, and their annotations — while the change-history view fills in everything else.

## Event-log growth policy (v1)

The `session_events` table is append-only and **NEVER pruned** in v1. Events are replay-authoritative — the projected session state is computed from the log, never from a separate "current state" table — so deletion is structurally unsafe.

At projected v1 volume (a YouTube show producing a few sessions per week, each session emitting on the order of 10^2–10^3 events) storage is comfortably within a single Postgres instance. A future archival task lands when ANY of these triggers fires:

1. The `session_events` table exceeds ~100 GB.
2. Application storage cost dominates the deployment bill.
3. A regulatory or compliance data-retention requirement appears.

When the trigger fires, the archival task should dump per-session event logs to object storage (S3-shaped) once the session is `ended` AND older than N days, leaving a session-level "archived" pointer in Postgres. Replay endpoints fetch the dump on first access.

See [`tasks/refinements/backend-hardening/session_events_growth_policy_note.md`](../tasks/refinements/backend-hardening/session_events_growth_policy_note.md).
