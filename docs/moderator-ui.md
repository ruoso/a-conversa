# Moderator UI

> Status: Early design. Flow-level sketch; specific widget choices, layout details, and visual-design specifics defer to UI prototyping.

The moderator is the sole operator of the structuring tool. Their UI is the most complex surface in `a-conversa` — every methodology operation runs through it. This document sketches the moderator's flows: what they do, in what order, and what feedback the UI gives them. For the underlying procedure see [methodology.md](methodology.md); for the data model see [data-model.md](data-model.md); for the surrounding system see [architecture.md](architecture.md).

## Responsibilities recap

The moderator:

- Captures each statement made by a debater into the graph.
- Proposes classifications (kinds for nodes, roles for edges).
- Draws edges between nodes.
- Proposes decompositions and interpretive splits.
- Runs the diagnostic tests when a facet is disputed.
- Captures defeaters offered during operationalization.
- Captures axiom-marks proposed by participants (per-participant — Ben's bedrock is recorded separately from Anna's).
- Captures meta-moves (reframes / scope changes / methodological stances).
- Watches for structural diagnostics (cycles, contradictions, multi-warrants, dangling claims) and triggers their resolution.
- **Commits** proposals once all participants are voting `agree`. Commit is the moment a proposal lands.
- Snapshots segments at natural breaks.
- Does not debate substance.

## Layout (sketch)

A three-pane layout, biased toward graph visibility:

- **Graph canvas** — the live shared graph, taking the majority of the screen. Same structural content the audience sees, plus operator affordances (selection, drag-to-create-edge, context menus on nodes/edges, hover details).
- **Right sidebar** — three stacked panes:
  1. **Pending proposals** — list of in-flight proposals with per-participant vote indicators and a commit button per proposal. For *facet-valued* proposals (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) each row identifies the `(entity, facet)` being voted on and the candidate value being named; for *structural* proposals (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) each row identifies the proposal as a whole. The wire-level distinction is settled in [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md).
  2. **Diagnostic flags** — structural problems the system has surfaced (cycles, contradictions, multi-warrants, dangling claims).
  3. **Change history** — reverse-chronological scroller of past events; click to highlight what changed at that point on the graph.
- **Bottom strip** — capture pane: wording textarea + edge-target selector + Propose button + mode banner. Classification and substance affordances live on each node card (see F1), not in the bottom strip, because they're sequenced *after* wording commits and target a specific existing node — they aren't part of the initial capture gesture.

Specific widget choices defer to UI prototyping. The flows below are layout-agnostic.

## Core flows

### F1. Capture a new statement

The most common operation. Debater speaks; moderator captures. Capture is *sequential and per-facet* — wording first, then classification, then substance — per [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md). Each facet is a separate moderator gesture in methodology order.

**Step 1 — capture the wording (in the bottom-strip capture pane).**

1. **Type the wording** into the capture text field. Free-form text, multi-line allowed.
2. **(Optional) connect** to existing structure: pick a target node and an edge role (`supports`, `rebuts`, `qualifies`, etc.). The most-recently-active node is **auto-suggested as the default target**, pre-filled in the connect pane; one keystroke or click clears it if the suggestion is wrong. This trades a moment of latent error for capture speed during live debate; the override is one gesture away.
3. **Propose**. The capture gesture emits `node-created` (global, with the typed text as the inline wording — wording lives inline on the entity-creation event per ADR 0030; there is no separate `propose-wording` proposal kind), `entity-included` (in session), and — if connecting — `edge-created` (with the role + endpoints inline as the candidate value for the edge's shape facet) and its `entity-included`. The graph shows the new node (and edge) immediately; its wording facet (and edge-shape facet) enter `proposed` with the inline value as the candidate. The node's classification and substance facets enter `awaiting-proposal`; the edge's substance facet likewise. The pending-proposals pane fills in with one row per facet currently at `proposed`.
4. **Wait for votes on wording (and edge shape, if any).** Debaters' tablets show the wording row (and edge-shape row); they vote agree / dispute. The right sidebar's vote indicators update as votes arrive.
5. **Commit wording (and edge shape)** once all participants are voting `agree` on that facet. The commit button on the `(entity, facet)` row becomes enabled. Wording transitions to `committed`; the audience sees the commit animate.

**Step 2 — propose classification (on the node card, sequenced behind wording).** Once wording has committed, a "Propose classification" affordance appears on the node card alongside the participant-visible classification facet row. The moderator triggers it, picks the kind from the classification palette (`fact` / `predictive` / `value` / `normative` / `definitional`; single-key shortcut per kind), and proposes. This emits a `classify-node` proposal naming the kind as the candidate value on the `(node, classification)` facet. The classification facet transitions from `awaiting-proposal` to `proposed`. Participants vote; the moderator commits when all-agree. The server refuses out-of-sequence `classify-node` proposals at the wire if wording hasn't been agreed (the affordance is hidden in that case in the UI, but the server is the integrity boundary; see ADR 0030).

**Step 3 — propose substance (on the node card, sequenced behind classification).** Once classification has committed, a "Propose substance" affordance appears on the node card. The moderator triggers it, names an initial candidate substance value, and proposes via a `set-node-substance` proposal on the `(node, substance)` facet. Substance transitions from `awaiting-proposal` to `proposed` and from there is engaged through edges (supports, rebuts, contradicts), through the disputation test, and through the per-facet vote/commit lifecycle.

(Edge substance follows the same pattern when an edge is created: edge shape commits first, then `set-edge-substance` proposes a candidate on `(edge, substance)`.)

Each facet is its own proposal; debaters vote on each facet individually. Wording / classification / substance are *not bundled* at capture (they used to be in the original sketch; see ADR 0030 for the diagnosis and the move to the sequential model). On the debater tablets each facet appears as its own per-facet row (see [participant-ui.md — per-facet voting](participant-ui.md#per-facet-voting-the-central-design)). The moderator commits each facet as it reaches all-agree, in methodology order.

### F2. Decompose

Triggered when a statement bundles multiple claims, surfaced either by the moderator or by either debater.

1. **Select the parent node**.
2. **Enter decomposition mode** (shortcut or node context menu). The capture pane changes to multi-component capture.
3. **Capture each component** — wording + proposed kind. Add as many as needed.
4. **Propose** the decomposition. The graph shows the parent plus its proposed components, in `proposed` state.
5. **Vote and commit**. Once committed, the parent is removed from the visible graph; the components remain. Each component's facets start in `proposed` and run through their own lifecycles — agreeing to the decomposition does not pre-agree the components' wording, classification, or substance.

Interpretive splits use the same flow with a different proposal kind.

### F3. Run a diagnostic test

When a facet's proposal is disputed, the moderator runs a methodology test.

- **Operationalization** (`Cmd+O`, sketch): select target → trigger → capture the participant's verbal answer in the capture pane. The answer drives next steps:
  - Empirical evidence → propose re-classification as `fact` / `predictive`.
  - Different value/principle → propose re-classification as `value` / `normative`.
  - Truth-by-meaning → propose re-classification as `definitional`.
  - "Nothing could change my mind" → propose an axiom-mark for that participant (F5).
  - Specific retraction conditions → propose defeaters (F6).
  - Different answers from the two debaters → strong signal of compound; propose decomposition (F2).
- **Is-ought check**: usually a moderator mental check; if the statement carries prescriptive load, propose a `normative` component or extract a normative warrant as a new node.
- **Disputation test**: reads the substance facet. The UI shows whether substance is `agreed` (node serves as data) or `disputed` (node is a claim).
- **Warrant elicitation** (`Cmd+W`): when role disagreement persists, capture the unstated bridge as a new node with `bridges-from` and `bridges-to` edges to the data and claim.

The mode banner indicates which test is in progress so participants and audience know what's being asked.

### F4. Draw an edge

Quick gesture for relating two existing nodes.

1. **Click and drag** from source node to target node on the graph canvas.
2. **Pick the edge role** from a palette that appears on drop.
3. **Propose**. Edge appears in `proposed` state with vote indicators in the sidebar.
4. **Vote and commit** as usual.

### F5. Capture an axiom-mark

When a participant declares "nothing could change my mind" on a node.

1. **Select the node**.
2. **Trigger `Axiom-mark`**, indicating the proposing participant (the one declaring it).
3. **Propose**. A pending axiom-mark decoration appears on the node, attributed to that participant.
4. **Vote and commit**. Once committed, the axiom-mark renders visibly on the node, tagged by participant.

Axiom marks are per-participant. Multiple axiom-marks may accumulate on one node (Anna and Ben both holding it as bedrock — an unanticipated structural finding when it happens).

### F6. Capture a defeater

During operationalization, if a participant names retraction conditions ("I'd retract X if Y were true"):

1. **Trigger `Capture defeater`** with X (the target) selected.
2. **Type the retraction condition's wording** (Y) — this becomes a new node.
3. **The system creates the new node and a `rebuts` edge** from the new node to the target.
4. **The participant pre-commits** to the rebut: the moderator proposes the rebuts edge's `substance` as `agreed`.
5. **The retraction-condition node's substance stays `proposed`** (Y hasn't been established).
6. **Vote and commit** through the normal lifecycle.

End state: the defeater sits in the graph with `agreed` edge substance and unagreed source substance — the rebut does not currently fire but would activate if the retraction condition is ever established. (See [data-model.md — edges](data-model.md#edges) for the conditional reading of edge substance.)

### F7. Resolve a structural diagnostic

When the system surfaces a blocking diagnostic (cycle in `supports`, contradiction):

1. **The diagnostic appears as a flag** in the sidebar, with the affected nodes/edges highlighted on the graph.
2. **Click the flag** to focus the affected region.
3. **Methodology suggestions** appear: decompose, amend, break-edge, accept-as-bedrock (axiom-marks each side).
4. **Pick a path** and run through the lifecycle.

Blocking diagnostics persist as a banner / status indicator until acknowledged (resolved or accepted-as-bedrock — see [methodology.md](methodology.md#blocking-diagnostics)). Advisory diagnostics (multi-warrant, dangling, coherency hints) appear too but don't block.

### F8. Capture a meta-move

When a participant proposes a reframe / scope change / methodological stance.

1. **Trigger `Capture meta-move`** with relevant target node(s) selected.
2. **Type the meta-move content**.
3. **Classify the kind** — `reframe` / `scope-change` / `stance`.
4. **Propose**. The meta-move appears as a special annotation on the targeted entity.
5. **Vote and commit**. A contested meta-move stays visible as `disputed` — it cannot be quietly absorbed. If a participant starts arguing as if a contested meta-move had been accepted, the moderator can refuse to capture downstream content until the meta-move is resolved.

### F9. Withdraw agreement (post-commit) vs. withdraw a proposal (pre-commit)

Two distinct gestures, with different meanings and different event kinds. Both surface in the moderator UI but in different places.

**Withdraw agreement (`withdraw-agreement` event).** When a participant later realizes they shouldn't have agreed to a facet that has *already been committed* (or has reached all-agree on its current candidate). This is the gesture the methodology calls "withdraw agreement" — see [methodology.md — the commit step](methodology.md#the-commit-step).

1. **Participant signals withdrawal from their tablet** — they tap the withdraw control on the agreed/committed facet row (see [participant-ui.md — P3](participant-ui.md#p3-withdraw-agreement)). This emits a `withdraw-agreement` event keyed by `(entity, facet, participant)` per [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md).
2. **The relevant facet returns to `disputed`** — flagged on the graph and in the change-history scroller.
3. **The methodology re-runs** for that facet (back to whichever diagnostic test fits).

**Withdraw a proposal (`withdraw-proposal` event).** A different gesture: the *proposer* rescinds a pending proposal that has not yet been committed. The pre-commit candidate value goes away; if it was a facet-valued proposal, the facet drops back to its prior status (often `awaiting-proposal` for a never-previously-agreed facet, or `agreed` / `committed` for an `edit-wording` against an already-agreed facet); if it was a structural proposal, the propose-time-emitted structural entities are removed via `entity-removed` per [ADR 0027](adr/0027-entity-and-facet-layers-strict-separation.md). The proposer-only sidebar row carries a "Withdraw proposal" affordance for this; the moderator sees and operates it the same way for their own proposals.

The two gestures are not interchangeable: `withdraw-agreement` rescinds *a participant's prior agreement*; `withdraw-proposal` rescinds *the candidate value on the table*.

### F10. Snapshot a segment

At natural breaks (commercial, end of segment, end of show).

1. **Trigger `Snapshot`** (shortcut or sidebar button).
2. **Type a label** (e.g., "Segment 1 close").
3. **The current event-log position is named**; replay can refer to this snapshot.

## Visual state representation

Every entity (node, edge, annotation) renders in a state determined by its facets. Suggested visual conventions (subject to detailed UI design):

- **`awaiting-proposal`** — the facet's row on the node card shows an empty-state placeholder with a "Propose…" affordance for the moderator; no candidate value to render on the graph yet. Distinct from `proposed`: nothing to agree or dispute. See [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- **`proposed`** — dashed outline, faded fill. The audience reads "this is being decided."
- **`agreed`** — solid outline, full color. Stable structure.
- **`committed`** — visually equivalent to `agreed` for v1; the distinction is in the event log (commit landed). Withdrawal control surfaces on the row.
- **`disputed`** — solid outline plus a contrast disagreement marker (small red corner badge or similar). Methodology in progress.
- **`withdrawn`** — solid outline with a withdrawal indicator; the facet is back in dispute and gathering fresh votes on the same candidate.
- **`meta-disagreement`** — split rendering: the entity shows both proposed values side by side.

Within a single node, multiple facets can be in different states simultaneously. The UI distinguishes them:

- **Wording** — the displayed text; visual state reflects the wording facet.
- **Classification** — a label or color tag; visual state reflects the classification facet.
- **Substance** — shown by node role: a `disputed` substance node is a *claim* awaiting support; an `agreed` substance node can serve as `data`. (Visual: claims may have a prominent "needs support" outline, data may render flatter.)
- **Axiom marks** — per-participant decorations, one per participant who marked.

Per-participant vote indicators appear in **both places**: on the graph (next to each pending facet, for ambient awareness) and in the right sidebar's pending-proposals pane (for systematic walkthrough). Each pending facet shows three small indicators (one per participant) with states: *not-yet-voted* (gray), *agree* (green), *dispute* (red), *withdrawn* (yellow). The commit button per row in the sidebar becomes enabled only when all three are green. For facet-valued proposals the commit targets `(entity, facet)` — committing names the facet's current candidate as the agreed value — and for structural proposals the commit targets the proposal id (see [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md) on the mixed wire model).

The graph view is the operator's "ambient awareness" mode — they can see at a glance which facets have which vote state. The sidebar is the "focus mode" — a consolidated list for working through pending proposals one by one. Both surfaces are kept in sync.

## Modes

The capture pane carries a small **mode banner** indicating what the moderator is currently doing:

- *Capture statement* (default)
- *Capture decomposition components*
- *Capture defeater*
- *Capture meta-move*
- *Elicit warrant*
- *Run operationalization test*
- *Snapshot label*

Modes are deliberate — the moderator switches in for a specific operation and exits when done. A persistent mode banner makes it visible to both moderator and audience what kind of capture is in flight.

## Keyboard shortcuts (sketch)

The moderator's hands need to stay on the keyboard to keep up with live debate.

- `f` / `p` / `v` / `n` / `d` — propose classification (fact / predictive / value / normative / definitional)
- `Cmd+Enter` — propose (commit the current capture as a proposal on the graph)
- `Cmd+Shift+Enter` — commit currently-selected proposal (enabled only when all participants vote agree)
- `Cmd+D` — decompose selected node
- `Cmd+W` — elicit warrant
- `Cmd+O` — operationalization test
- `Cmd+S` — snapshot
- `Esc` — exit current mode, return to default

The classification shortcuts (`f` / `p` / `v` / `n` / `d`) stay
english-mnemonic regardless of UI locale; the keymap help overlay shows
the localized methodology label next to each shortcut (so a pt-BR
moderator sees `F: Fato` and an es-419 moderator sees `F: Hecho`).
Rationale + executable mapping in
[tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md](../tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md)
and [`packages/i18n-catalogs/src/keyboard-shortcuts.ts`](../packages/i18n-catalogs/src/keyboard-shortcuts.ts).

Specific bindings defer to UI prototyping. The principle is "everything reachable from the keyboard."

## Change history pane

The right sidebar's change-history scroller shows the most recent events in reverse chronological order. Each entry shows:

- Event kind (proposal / vote / commit / withdraw-agreement / withdraw-proposal / snapshot / etc.)
- Actor (who made it)
- Brief payload summary
- Timestamp

Clicking an entry highlights the affected nodes/edges on the graph in a transient visual flash, helping the moderator see "what just changed" quickly. The pane is read-only — the moderator does not edit history; they propose new changes that land as forward events.

## V1 defaults (resolved)

- **Audio capture / transcription assist** — none in v1. The moderator types every statement. Revisit only if typing turns out to be a bottleneck during prototyping.
- **Default attachment behavior** — auto-suggest the most-recently-active node as target, with a one-gesture clear override. Captured in F1.

## Deferred to UI prototyping

- **Producer/director affordances on the moderator UI.** If the producer surface is cut from v1, do snapshot triggers and OBS scene cues end up on the moderator UI? Tied to the producer-surface deferred decision in [architecture.md](architecture.md#open-architectural-questions).
- **Capture pane position.** Bottom strip vs. right sidebar bottom vs. floating. Resolve during UI prototyping.
- **Multi-monitor support.** Some moderators may want the graph on one screen and capture on another. Resolve during UI prototyping.
