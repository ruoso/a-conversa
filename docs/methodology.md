# Methodology

> Status: Early design phase. Evolving.

This document describes the procedure participants follow during a debate: how statements are captured, classified, decomposed, agreed on, and how disagreements about classification are resolved. For the underlying graph structure (nodes, edges, diagnostics), see [data-model.md](data-model.md).

## Agreement rule

The foundational rule of the format: **all participants — both debaters and the moderator — must agree on every change to the graph before it lands.** No exceptions. The agreement rule is what slows the debate down; that is the point. Clarity is a function of slow.

Anyone may propose any change. The moderator is the sole operator of the tool, so debaters propose verbally and the moderator commits the change once they observe agreement (see "The commit step" below).

Agreement is **per-facet and per-participant**. Each facet of an entity (node wording, classification, substance; edge shape and substance; annotation content) tracks each participant's stance individually. A facet advances to `agreed` only when every current participant is voting `agree` *and* the moderator commits (see "The commit step" below).

### The commit step

A proposed change appears on the graph in `proposed` state from the moment it is made. Participants verbally express agreement or disagreement. **The moderator commits the change** — transitions it to `agreed` and applies its effects — when they observe agreement from every participant. Until commit, the change is work-in-progress.

The explicit commit step matters because:

- Implicit agreement (everyone nods vaguely) doesn't accidentally land changes the participants didn't fully consider.
- The moderator's role is structural, not interpretive. They don't decide whether agreement has been reached on the merits; they enact it once participants have expressed it.
- It gives the participants a clear handoff moment: until the moderator commits, you can still object.

A participant may **withdraw agreement** they previously gave. An `agreed` facet transitions back to `disputed`; the original commit and the withdrawal are both recorded in the change history. Withdrawal is allowed because real reasoning has second thoughts, and the format would be brittle if it didn't accommodate them.

## The change lifecycle

**Every change to the graph requires agreement, regardless of what it is.** Capturing a statement, classifying a node, drawing an edge, decomposing a node, marking an axiom, drawing a `contradicts` edge — every operation runs through the same workflow. There are no special cases that bypass the agreement rule.

### States

Every proposed change moves through these states:

- `proposed` — someone has proposed the change. **The proposal is visible on the graph in a distinct state from the moment it is made**, awaiting agreement.
- `agreed` — all participants have voted `agree` and the moderator has committed; the change has been applied.
- `disputed` — at least one participant has rejected the proposal. It remains visible while the methodology runs to resolve.
- `meta-disagreement` — the disagreement turned out to be irreducible; both proposed shapes are carried side by side. Last-resort fallback (see below).

Visibility of proposed changes is the property that prevents stonewalling. A debater who refuses to agree to (say) a `contradicts` edge against their own claims cannot make the proposal vanish — only delay or block its transition to `agreed`. The audience sees the proposal regardless.

### Symmetric agreement

Agreement is **symmetric**: all participants — the moderator and both debaters — must agree before any change lands. Nobody has unilateral standing on any operation, including taxonomy/classification. The speaker is the source of their own wording, but the captured wording still requires symmetric agreement; the moderator may propose a classification, but it still requires symmetric agreement; either debater may propose a `rebuts` edge, but it still requires symmetric agreement.

### Facets

Most graph entities have **multiple facets**, and each facet runs through its own independent lifecycle. Agreeing on a node's classification is not the same as agreeing on its content; agreeing on an edge's shape is not the same as agreeing the relation holds. Facets keep these separable.

A **node** has at minimum these facets:

- **Wording** — does the captured text faithfully represent what was said?
- **Classification** — what kind of statement is it (`fact` / `predictive` / `value` / `normative` / `definitional`)?
- **Substance** — do we agree the content is true / the claim holds?

An **edge** has these facets:

- **Shape** — what type of edge is it, between which endpoints?
- **Substance** — does the relation actually hold? (Does the data actually support? Does the contradiction actually obtain? Does the warrant actually license the inference?)

Each facet has its own status (`proposed`/`agreed`/`disputed`/`meta-disagreement`) and runs through the standard lifecycle independently. A node's wording can be `agreed` while its classification is `disputed` and its substance is `proposed` (not yet engaged). The entity as a whole is "fully agreed" only when all its facets are agreed.

This is the distinction the format depends on: "I agree this is a `predictive` claim" (classification facet: agreed) is not the same as "I agree the prediction will hold" (substance facet: separate question, separately tracked). Without facets, conceding the structure would imply conceding the content, which would be wrong.

### Kinds of dispute (and how they resolve)

Disputes are all the same shape — a facet `proposed` and blocked from advancing — but the methodology applies different tools depending on which facet is in dispute:

- **Wording dispute** ("that's not quite what I said") → edit until everyone agrees on the wording.
- **Classification dispute** ("that's a value claim, not a fact") → run the diagnostic tests (operationalization, is-ought, disputation, warrant elicitation). Often surfaces compound structure and leads to decomposition.
- **Compoundness dispute** ("that statement is actually multiple statements") → propose a decomposition; if agreed, the workflow resets on the resulting components.
- **Edge-shape dispute** ("the edge type should be `qualifies`, not `rebuts`") → re-propose with the corrected type or endpoints.
- **Substance dispute on a node** ("the claim isn't true / isn't supported") → engaged through edges (support, rebut, contradict, decompose) and the disputation test. A node's `disputed` substance facet is what makes it function as a `claim` rather than as `data`.
- **Substance dispute on an edge** ("the contradiction doesn't actually hold" / "the data doesn't actually support the claim") → propose a resolution: decompose, amend, mark as bedrock disagreement, or let it stay `disputed`.

Each tool produces further proposed changes that run through the same lifecycle.

### Changes that create new entities

Some operations create new graph entities — capturing a statement creates a node, drawing an edge creates an edge, decomposing a node removes one node and creates its components, extracting a warrant creates a node and an edge, etc.

When such an operation lands as `agreed`, the new entities exist on the graph but **each of their facets starts as `proposed`**. The workflow resets for them. Each facet requires its own symmetric agreement before it advances.

For decomposition specifically: agreeing to decompose N into A + B agrees to the *structural restructuring* (N is removed; A and B exist as entities). It does not pre-agree any facet of A or B — A's wording, A's classification, A's substance, B's wording, B's classification, B's substance, and any edges into or out of A or B are each separate proposed changes that need their own agreement. A complex decomposition can therefore generate many follow-on proposals, each going through the standard lifecycle on each of its facets.

### Worked examples

- **Capturing a statement.** Anna says "zoos do more good than harm." Maria proposes a node N1 with that wording → wording facet `proposed`. Everyone agrees the wording is faithful → wording facet `agreed`. Maria proposes classification `normative` → classification facet `proposed`. Everyone agrees → classification facet `agreed`. The substance facet is still `proposed` and gets engaged later through Anna's supports, Ben's rebuttals, and the disputation test. N1 is "fully agreed" only when all three facets land.
- **Classification dispute.** Maria proposes N1 is `normative`. Ben disputes — he thinks it's a `value` claim. Classification facet → `disputed`. Diagnostic tests run (operationalization, is-ought, etc.); resolution may be a re-classification, a decomposition into components with different kinds, or `meta-disagreement`. Throughout, N1's wording facet may already be `agreed` and stays so.
- **Decomposition.** Maria proposes splitting N1 into A + B. Decomposition facet `proposed`. Everyone agrees → N1 is removed, A and B exist. All of A's and B's facets start `proposed`. Each is its own change with its own lifecycle.
- **Contradicts edge.** Anna proposes a `contradicts` edge between N1 and N2. Shape facet `proposed`. Everyone agrees on the shape → shape facet `agreed`. Substance facet (does the contradiction actually hold?) is `proposed`; if Ben disputes, substance facet → `disputed`; methodology runs (decompose? amend? accept-as-bedrock?). The edge stays visible in `disputed` substance throughout.
- **Axiom-marking.** Ben proposes an axiom mark on N9 for himself. The axiom mark is a graph operation with its own lifecycle. All participants agree (or run methodology — operationalization, etc.) that yes, Ben holds N9 as bedrock → the axiom mark lands. The agreement here is on the *fact of Ben's bedrock commitment*, not on whether N9 is true. Anna may or may not have her own axiom mark on N9 (a separate change with its own lifecycle). N9's other facets are independent.

## Classification procedure

When a statement is made, the moderator proposes a classification (the value of the node's `classification` facet — its kind: fact / predictive / value / normative / definitional). If all participants accept, the moderator commits and the classification facet lands as `agreed`. If anyone disputes, the classification facet stays `disputed` and the diagnostic tests below run.

The classification is one facet of the node; the node's wording and substance facets each have their own independent agreement workflow.

### Vocabulary and localization

The five statement kinds (`fact`, `predictive`, `value`, `normative`, `definitional`) — and similarly the seven edge roles, the annotation kinds, the facet states, the vote choices, and the diagnostic kinds — are methodological commitments. Their English names are **canonical in the data model**: they are the values stored in the event log, in the Postgres schema, in the WebSocket payloads, in the OpenAPI spec. Their renderings in pt-BR (`Fato` / `Preditiva` / `Valor` / `Normativa` / `Definicional`) and in es-419 (`Hecho` / `Predictiva` / `Valor` / `Normativa` / `Definicional`) are **labels for the same commitments**, not separate methodologies. The canonical English-to-locale mapping is recorded in [tasks/refinements/frontend-i18n/i18n_methodology_glossary.md](../tasks/refinements/frontend-i18n/i18n_methodology_glossary.md) and locked once native-speaker + philosophical review signs off; see [ADR 0024](adr/0024-frontend-i18n-react-i18next-with-icu.md). The same rule applies to edge roles.

A consequence worth naming explicitly: a debate held in pt-BR may have a moderator running their UI in en-US (e.g., a non-Brazilian moderator brought in to operate the tool for a pt-BR show). The wordings on the nodes are pt-BR (participant-supplied content is never translated); the UI chrome and the methodology labels in that chrome are en-US. This is a supported configuration — the format intentionally separates participant content from operator chrome.

## Diagnostic tests

The moderator runs these out loud, on camera. Each test either resolves the disagreement directly *or* reveals that the statement is compound and points to the seam along which it should be decomposed.

### Operationalization test

> "What evidence would change your mind on this?"

- Empirical evidence → `fact` or `predictive` component.
- A different value or principle → `value` or `normative` component.
- "It's true by what the word means" → `definitional` component.
- "Nothing could change my mind" → an **axiom**.
- If the two debaters give *different* answers about what would change their mind, that is the strongest signal that the statement is compound — they are each pointing at different components.

If the participant names **specific retraction conditions** ("I'd retract this if X were the case"), capture each X as a regular node and add a `rebuts` edge from X to the target. The participant proposes the rebuts edge's `substance` as agreed (their pre-commitment that *if* X were true, it would defeat the target); X's own `substance` stays `proposed` (X hasn't been established). Under the conditional reading of edge substance (see [data-model.md](data-model.md)), this is structurally a **defeater**: a rebut sitting in the graph that doesn't currently fire, but would activate if X were ever substantively established. The methodology can revisit such defeaters when their source approaches `agreed` substance.

### Is-ought check

If the statement contains "should / ought / better / worse / right / wrong" or carries an implicit prescription, there is a `normative` component, regardless of phrasing.

If a purely descriptive statement is doing prescriptive work in the argument, the gap signals an unstated normative warrant — extract it as a separate node (a warrant that bridges the data→claim move).

### Disputation test

The disputation test reads a node's `substance` facet:

- If every participant votes `agree` on the content's truth and the moderator commits → the substance facet is `agreed`. The node functions as `data` and can carry a `supports` edge to a claim.
- If anyone disputes the content → the substance facet is `disputed`. The node is itself a claim that needs its own support.
- A node's role (data vs. claim) can change mid-debate as its substance facet transitions; an agreed-true node that someone later challenges moves back to `disputed` (via the withdrawal mechanism).

### Warrant elicitation

When role disagreement persists ("is X data or is X the claim?"), ask: *"What's the unstated bridge from X to your conclusion?"*

The articulated warrant is itself a new node, often the actual fact-or-value disagreement. Once the warrant is on the table, the original role disagreement frequently dissolves.

## Decomposition

Decomposition is a **first-class methodological move**, not a fallback. Anyone in the debate (the moderator or either debater) may call out that a statement is saying too much and propose breaking it down — decomposition is not gated on classification disagreement. The decomposition operation itself is recorded in the change history (it is not a graph entity); its effects (the parent removed, components added) appear on the graph as new proposed nodes. The standard agreement rule applies.

### Common decomposition seams

- Fact-component + value-component (e.g., "raising the wage will reduce poverty *and* that's good" → two nodes, one `predictive`, one `value`).
- Claim + implicit warrant (a stated data→claim move with an unstated bridge — the bridge becomes its own node).
- Description + prescription (a normative statement disguised as descriptive — extract the prescription).
- Assertion + assumed definition (a claim that depends on a contested definition — the definitional commitment becomes its own node).

### What happens to the raw utterance

When a decomposition is `agreed`, **the raw utterance is removed** from the current visible graph and replaced by its component nodes. The original wording is not kept as a visible node — the graph shows the current best understanding of what was said, not a record of every prior phrasing. The historical record (raw utterance, decomposition operation, who proposed and agreed) is preserved in the change history (see [data-model.md](data-model.md)).

The component nodes start as `proposed` and run through their own lifecycle (see [the change lifecycle](#the-change-lifecycle) above). Agreeing to the decomposition does not pre-agree the components' wording, classification, or any edges they will eventually carry — each is its own proposed change.

### Recursion

Each component is run through the methodology again: classify, and if disagreement or further compound structure surfaces, decompose further. Decomposition bottoms out when every facet of every leaf node has landed as `agreed` (and any edges among them have likewise landed).

## Editing wording: reword vs. restructure

When someone proposes editing a node's wording (because the original capture wasn't quite right, or because the participants want to refine after later context), the participants must agree on **what the edit means**:

- **Reword** — the edit produces a clearer phrasing of the same statement. The node ID is preserved; the wording facet's value changes (the prior wording is recorded in the change history). All edges into or out of the node remain attached.
- **Restructure** — the edit produces a meaningfully different statement, not the same node in better words. A new node is created (with its own facets in `proposed`) and the original node is **superseded** — removed from the visible graph. Edges incident to the original become invisible by virtue of the missing endpoint (see [data-model.md — visible-graph derivation](data-model.md#visible-graph-derivation)) and don't auto-follow to the new node; if participants want analogous edges on the replacement, they propose them explicitly.

If participants want to keep the original alongside a new statement, they shouldn't restructure — they should add a new node directly via the standard capture flow.

The choice between reword and restructure is itself a proposed change requiring agreement. If the participants disagree on whether an edit is a reword or a restructure, that disagreement runs through the standard methodology (often resolved by inspecting whether the edit changes which inferences land on the node).

## Interpretive splits

A statement may not bundle multiple claims as the speaker intended it, yet admit multiple *readings*, with the disagreement sitting at the seam between them. The moderator may propose splitting the statement along the interpretive seam even when neither debater raised the distinction, so the dispute can be argued precisely.

In the walkthrough ([example-walkthrough.md](example-walkthrough.md)), a defeater offered as "capability-frustration reduces to welfare deficits" was split by the moderator into an *epistemic* reading ("welfare deficits are our evidence for constitutive capacities") and a *metaphysical* reading ("capability-frustration *just is* welfare loss, ontologically"). The opposing debater's argument cleanly established the epistemic reading but not the metaphysical one — and the original claim needed the metaphysical reading to fail for it to fall. Neither debater had distinguished the two; the moderator did.

Interpretive splits are subject to the standard agreement rule: all participants must accept the split — and the debaters must agree which reading their argument applies to — before it lands. This protects against the moderator imposing a frame either side rejects.

Distinguishing interpretive split from ordinary decomposition:
- **Decomposition** — the speaker intended multiple claims and bundled them; the split surfaces what was already there.
- **Interpretive split** — the speaker may have intended one claim, but the wording admits multiple readings, and the disagreement lives at the seam; the split clarifies *what is being argued about*.

The graph treatment is the same in both cases: the parent node is replaced by component nodes in the current view; the change history records the original wording and the operation.

## Meta-moves

A **meta-move** is a proposal to relocate the debate — a claim that the real question is X, not the Y currently on the board. Examples: a *reframe* ("the netting question is the operational form of the deeper dispute"), a *scope change* ("we should be defending the typical case, not the edge case"), a *methodological stance* ("I won't press this point on principle, even though my opponent has conceded it"). Meta-moves are not substantive claims about the topic; they are claims about *what is being argued about* or *how it should be argued*.

Without explicit capture, meta-moves silently shift the terrain — the next several minutes of debate end up arguing a different question, with no one noticing that the old one was abandoned. The platform's response is to capture each meta-move as a first-class entry on the board, marked as such. The agreement rule applies: a contested meta-move stays visible as contested until accepted, rejected, or rendered moot by the debate moving past it.

If one side starts arguing as if a contested meta-move has been accepted, the moderator can refuse to capture downstream moves until the meta-move is resolved. Forcing the meta-move to land or fail before its terms govern the conversation is the protection against quiet relocation.

Surfacing meta-moves — rather than absorbing them — frequently locates where the actual disagreement sits, especially when both sides have been arguing past each other on a frame neither fully accepted. In the walkthrough, the located crux (N10) emerged from a contested reframe that the moderator captured as a meta-move; both debaters turned out to share the underlying axiom and to disagree only on whether the reframe was a faithful operationalization of it or a quiet demotion.

## Axioms / terminal values

When the operationalization test produces "nothing could change my mind", the node receives an **axiom mark** from the participant who declared it. Axiom marks are **per-participant** — Ben's axiom mark on N9 records Ben's bedrock; Anna may add her own axiom mark to the same node (an unanticipated structural finding: shared bedrock), or hold a different node as her axiom, or hold no axiom at all in this debate. Axiom marks are visually distinct on the node they mark.

The axiom-mark itself is a graph operation, not a graph entity — it is recorded as an event in the change history and rendered on the node it marks. Like every change, an axiom mark goes through the standard agreement lifecycle (proposed → committed by the moderator once everyone has agreed). Agreement on an axiom mark is roughly: "we all agree that this participant holds this node as bedrock for this debate" — not "we all agree the node is true."

Axioms are not a defect. They are often the most valuable output of the exercise: the debate dead-ends at "A holds X as bedrock, B holds Y as bedrock, and that is the real disagreement." Surfacing axioms is a primary success state.

Pragmatically, an axiom-marked node answers "what could end this debate from this participant's side?" with "nothing on this point, but at least we know where the bedrock is."

## Meta-disagreement fallback

When the diagnostic tests can't resolve a facet's dispute and decomposition can't either — for example, participants cannot agree on a single classification *and* cannot agree the statement is compound — the facet is marked as **meta-disagreement**: it carries both proposed values side by side. The debate proceeds.

Meta-disagreement is a per-facet status, not a node-wide one. A node's classification facet may be `meta-disagreement` (carrying two competing kinds) while its wording facet is `agreed` and its substance facet is `disputed`. The same applies to edges: an edge's shape facet may be `meta-disagreement` (two proposed roles for the same edge) while its substance facet is in some other state.

This honors "both sides must agree before moving on" without making it a hard block. The participants have agreed to *register* the disagreement and continue. Meta-disagreement is a last resort; the methodology is designed so that decomposition resolves most cases before this fallback is needed.

## Resolution of structural diagnostics

The data model tracks structural problems (cycles, contradictions, multi-warrant patterns; see [data-model.md](data-model.md)). The methodology for resolving them mirrors classification: anyone proposes a resolution, all participants must agree. Diagnostics fall into two categories with different forcing:

### Blocking diagnostics

Logical problems block forward progress until **acknowledged**. "Acknowledged" includes resolving the problem *or* accepting it as bedrock — the requirement is that participants engage with it, not necessarily eliminate it.

- **Cycle in `supports`** — break one `supports` edge (acknowledged as not actually holding), decompose a node in the cycle, or have a participant axiom-mark a node in the cycle (the chain terminates at that participant's bedrock).
- **Contradiction** — decompose one or both nodes (most common), amend one to remove conflict, or accept the contradiction as a bedrock disagreement (each side axiom-marks the position they hold; the `contradicts` edge stays).

### Advisory diagnostics

Methodological opportunities — visible but non-blocking. The participants may act on them or leave them; they exist to nudge.

- **Multiple competing warrants on one data→claim** — decompose the claim. After decomposition, each warrant attaches to a different component. Often surfaces a hidden compound structure, but if the participants don't see it that way, no requirement to act.
- **Dangling claim** — a soft prompt; the moderator asks for support or asks whether the claim is being conceded/accepted.
- **Coherency hints** — advisory only; no required resolution.
