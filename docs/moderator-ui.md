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
  1. **Pending proposals** — list of in-flight proposals with per-participant vote indicators and a commit button per proposal.
  2. **Diagnostic flags** — structural problems the system has surfaced (cycles, contradictions, multi-warrants, dangling claims).
  3. **Change history** — reverse-chronological scroller of past events; click to highlight what changed at that point on the graph.
- **Bottom strip** — capture pane: text input, classification palette, edge-target selector, mode banner.

Specific widget choices defer to UI prototyping. The flows below are layout-agnostic.

## Core flows

### F1. Capture a new statement

The most common operation. Debater speaks; moderator captures.

1. **Type the wording** into the capture text field. Free-form text, multi-line allowed.
2. **Select the kind** from the classification palette (`fact` / `predictive` / `value` / `normative` / `definitional`). Single-key shortcut per kind speeds this.
3. **Connect** to existing structure (optional but typical): pick a target node and an edge role (`supports`, `rebuts`, `qualifies`, etc.). The most-recently-active node may be auto-suggested as default target — see open question on default attachment.
4. **Propose**. A capture proposal lands several events at once: `node-created` (global), `entity-included` (in session), `proposal: classify-node`, plus optionally `edge-created`, `entity-included`, `proposal: set-edge-substance` if connecting. The graph shows the new node and edge in `proposed` state. The pending-proposals pane fills in.
5. **Wait for votes**. Debaters' tablets show the proposals; they signal agree / dispute / withdraw. The right sidebar's vote indicators update as votes arrive.
6. **Commit** once all participants are voting `agree`. The commit button(s) become enabled. The node's wording, classification, and edge transition to `agreed`; the audience sees the commit animate.

The wording, classification, and edge are *separate proposals* under the data model — and debaters vote on each facet individually. Capture bundles them in the moderator's UI for fast entry, but on the debater tablets each facet appears as its own vote (e.g., "agree wording, dispute classification" is a real and supported move; see [participant-ui.md — per-facet voting](participant-ui.md#per-facet-voting-the-central-design)). The moderator commits each facet as it reaches all-agree.

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

### F9. Withdraw agreement

When a participant later realizes they shouldn't have agreed.

1. **Participant signals withdrawal** from their tablet.
2. **The relevant facet returns to `disputed`** — flagged on the graph and in the change-history scroller.
3. **The methodology re-runs** for that facet (back to whichever diagnostic test fits).

### F10. Snapshot a segment

At natural breaks (commercial, end of segment, end of show).

1. **Trigger `Snapshot`** (shortcut or sidebar button).
2. **Type a label** (e.g., "Segment 1 close").
3. **The current event-log position is named**; replay can refer to this snapshot.

## Visual state representation

Every entity (node, edge, annotation) renders in a state determined by its facets. Suggested visual conventions (subject to detailed UI design):

- **`proposed`** — dashed outline, faded fill. The audience reads "this is being decided."
- **`agreed`** — solid outline, full color. Stable structure.
- **`disputed`** — solid outline plus a contrast disagreement marker (small red corner badge or similar). Methodology in progress.
- **`meta-disagreement`** — split rendering: the entity shows both proposed values side by side.

Within a single node, multiple facets can be in different states simultaneously. The UI distinguishes them:

- **Wording** — the displayed text; visual state reflects the wording facet.
- **Classification** — a label or color tag; visual state reflects the classification facet.
- **Substance** — shown by node role: a `disputed` substance node is a *claim* awaiting support; an `agreed` substance node can serve as `data`. (Visual: claims may have a prominent "needs support" outline, data may render flatter.)
- **Axiom marks** — per-participant decorations, one per participant who marked.

Per-participant vote indicators are not on the graph itself — they live in the right sidebar's pending-proposals pane. Each pending proposal shows three small indicators (one per participant) with states: *not-yet-voted* (gray), *agree* (green), *dispute* (red), *withdrawn* (yellow). The commit button per proposal becomes enabled only when all three are green.

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

Specific bindings defer to UI prototyping. The principle is "everything reachable from the keyboard."

## Change history pane

The right sidebar's change-history scroller shows the most recent events in reverse chronological order. Each entry shows:

- Event kind (proposal / vote / commit / withdrawal / snapshot / etc.)
- Actor (who made it)
- Brief payload summary
- Timestamp

Clicking an entry highlights the affected nodes/edges on the graph in a transient visual flash, helping the moderator see "what just changed" quickly. The pane is read-only — the moderator does not edit history; they propose new changes that land as forward events.

## Open UI questions

- **Audio capture / transcription assist.** Is the moderator typing every statement, or does v1 wire in audio-to-text as a draft they edit? Affects speed-of-capture and accuracy. Out of scope for v1 unless typing turns out to be a bottleneck.
- **Default attachment behavior.** When capturing a new statement, is the most-recently-active node auto-suggested as target, or does the moderator always pick? Trade-off between speed and explicit-control.
- **Per-debater axiom-mark proposal flow.** Either path is supported: the debater can initiate an axiom-mark from their tablet, or the moderator can capture one based on hearing "nothing would change my mind" verbally. See [participant-ui.md — P5](participant-ui.md#p5-mark-a-node-as-your-axiom).
- **Producer/director affordances on the moderator UI.** If the producer surface is cut from v1, do snapshot triggers and OBS scene cues end up on the moderator UI?
- **Capture pane position.** Bottom strip vs. right sidebar bottom vs. floating. Affects ergonomics for long-form typing.
- **Multi-monitor support.** Some moderators may want the graph on one screen and capture on another. Does v1 support this, or one-screen-only?
