# Participant (debater) UI

> Status: Early design. Flow-level sketch; specific widget choices, layout details, and visual-design specifics defer to UI prototyping.

The participant UI is the debater's tablet — read-only on the graph plus per-facet voting controls on pending proposals. It is the surface through which debaters express agreement, dispute, or withdrawal, and it is the only way debaters interact with the platform mechanically (substantive proposals are made verbally and captured by the moderator). For the moderator counterpart see [moderator-ui.md](moderator-ui.md).

## Responsibilities recap

The debater (using their tablet):

- Sees the live graph in read-only form (same content the audience sees).
- Votes **per facet** on every pending proposal — agree, dispute, or no-vote-yet on each individual facet.
- **Withdraws agreement** on a previously-agreed (or committed) facet, which sends it back to `disputed`. This is the `withdraw-agreement` event introduced in [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md); it is distinct from rescinding a still-pending proposal (a proposer-only `withdraw-proposal` gesture).
- Proposes axiom-marks on their own positions (declaring "nothing could change my mind").
- Sees their own vote state across pending proposals (so they can review and revise).
- Sees structural diagnostics (cycles, contradictions, multi-warrants, dangling claims) so they can engage with what the methodology is surfacing.

The debater **does not** directly edit the graph or capture statements. All structural changes go through the moderator. Substantive proposals (decomposition, meta-moves, etc.) are made verbally; the moderator captures.

## Layout (sketch)

The tablet UI has two primary regions, switchable by tab or split-view depending on orientation:

- **Graph view** — read-only render of the live shared graph. Same visual conventions as the audience view (per-facet states distinct), with the addition of the debater's **own per-facet vote indicators** so they can see at a glance "I agreed N1's wording but haven't voted on its classification yet."
- **Pending proposals pane** — list of in-flight proposals awaiting the debater's vote. Each row identifies what is being voted on: for facet-valued proposals, the `(entity, facet)` and the candidate value being named; for structural proposals (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) the proposal as a whole. The mixed wire model is settled in [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md). A badge on the tab indicates how many rows are awaiting this debater's vote.

A persistent **status indicator** shows the debater's role (`debater A` or `debater B`), screen name, and a small count of "facets awaiting your vote."

Specific layout (split vs. tabbed, landscape vs. portrait) defers to UI prototyping. The flows below are layout-agnostic.

## Per-facet voting (the central design)

Capture is **sequential and per-facet** per [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md): the moderator proposes wording first (the node-creation gesture itself carries the wording inline), then — once wording has been agreed and committed — classification, then substance. Each facet is its own proposal with its own vote, and votes / commits / `withdraw-agreement` events are keyed by `(entity, facet)`. The participant's detail panel for a node always renders three facet rows (wording / classification / substance); for an edge it always renders two (shape / substance). The *visible content* of each row depends on that facet's current status.

**Per-facet row states (the always-rendered model).**

For each of a node's three facets (wording / classification / substance) and an edge's two facets (shape / substance):

- **`awaiting-proposal`** — no candidate value has yet been named for this facet. The row shows an empty-state placeholder ("Waiting for moderator to propose…"). No vote buttons. Common state for a freshly captured node's `classification` and `substance` rows, before the moderator has sequenced their `classify-node` / `set-node-substance` gestures.
- **`proposed`** — a candidate value is on the table, gathering votes. The row shows the candidate value and **[Agree] [Dispute]** buttons.
- **`disputed`** — at least one participant has voted `dispute`. The row shows the candidate value, the per-participant vote indicators, and **[Agree] [Dispute]** buttons (the debater can still change their vote on the live candidate).
- **`agreed`** — all participants are voting `agree`, awaiting moderator commit. The row shows the candidate value and a **[Withdraw]** button (emits `withdraw-agreement`, sending the facet back to `disputed`).
- **`committed`** — moderator has committed; the agreed value is the facet's value of record. The row shows the committed value and a **[Withdraw]** button (also emits `withdraw-agreement`).
- **`withdrawn`** — a previously-agreed facet was withdrawn by some participant; the facet is back in dispute on the same candidate. The row shows the candidate value, per-participant indicators (with the withdrawer's vote shown as withdrawn), and **[Agree] [Dispute]** buttons.
- **`meta-disagreement`** — the disagreement was registered as irreducible; both candidate values are shown side by side. No vote buttons (the facet is in its terminal state for now).

Worked example. Maria captures Anna's "Modern accredited zoos do more good than harm." She types the wording and proposes; the `node-created` event carries the wording inline. On Ben's tablet, the new node's detail panel shows:

- **Wording**: "Modern accredited zoos do more good than harm." — status `proposed`, candidate value visible, **[Agree] [Dispute]**.
- **Classification**: status `awaiting-proposal`, empty-state placeholder ("Waiting for moderator to propose…"), no buttons.
- **Substance**: status `awaiting-proposal`, empty-state placeholder, no buttons.

Ben votes [Agree] on wording. Anna does too. Maria commits. Wording is now `committed`; its row shows a **[Withdraw]** button.

Now Maria proposes `normative` classification (a `classify-node` proposal — a *separate* moderator gesture, sequenced after the wording commit). Ben's panel updates:

- **Wording**: `committed`, **[Withdraw]**.
- **Classification**: `normative` — status `proposed`, **[Agree] [Dispute]**.
- **Substance**: still `awaiting-proposal`.

Ben can:

- Agree the classification (the common path).
- Dispute the classification ("I think it's a value claim, not normative") without disturbing the already-committed wording.

This per-facet, sequenced-in-methodology-order split is **the** mechanism that lets debaters concede structure without conceding substance. "I agree this is a `predictive` claim" is a real and meaningful move; it does not commit Ben to "I agree the prediction will hold." Without per-facet voting, the agreement rule would force structural concessions to imply substantive ones, which would be wrong.

**On bulk voting.** The earlier sketch carried an "Agree all" accelerator that set every facet of a bundled proposal to `agree` in one tap. The sequential model removes the bundle: a single proposal targets a single facet, and the facet rows below it on the node card are `awaiting-proposal` until the moderator sequences them in. There is no longer a single-tap "agree all three facets at once" gesture for a single node — each facet is offered to vote on only when the moderator names a candidate for it. **No "Agree all" affordance in v1.** If a future need surfaces for bulk-agreeing the currently-proposed facet across multiple selected entities (an across-entities bulk gesture), that would be its own deferred decision; the across-facets-of-one-entity flavor is precluded by the sequential model.

## Core flows

### P1. View the graph

Default state. The graph view shows the live shared graph with current per-facet states rendered visually. The debater can pan, zoom, tap nodes/edges to see details (wording, classification, owner, axiom marks, current substance state).

For each entity displayed, the debater also sees their own vote state on any pending facets — a small per-debater indicator next to each `proposed` or `disputed` facet showing whether they've voted, and how.

### P2. Vote on a pending proposal

The most common operation. Each pending proposal targets a single facet (for facet-valued proposals) or a single structural move (for structural proposals like `decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) — see [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md).

1. **Notification** — when the moderator publishes a new proposal, the pending-proposals tab badge increments. The graph view also visually flashes the affected entity briefly.
2. **Open the entity** — tap the badge or the affected entity on the graph. The detail panel expands showing all facet rows for that entity (three for nodes, two for edges); the row whose status is `proposed` or `disputed` has the vote buttons.
3. **Vote on the live facet row** — tap [Agree] or [Dispute] on the row whose facet is currently being decided. The vote is recorded immediately (single-tap; no confirmation modal — the methodology already provides deliberation). For structural proposals, votes / commits stay proposal-keyed and the proposal's row in the pending-proposals pane carries the buttons.
4. **State update** — the moderator's pending-proposals pane updates with the new vote indicators. Once all participants are voting `agree` on a facet, the moderator can commit.

The debater's vote is **provisional until the moderator commits.** A debater can change their vote (from agree to dispute, or vice versa) up until commit lands. When the moderator names a new candidate on the same facet (e.g., a fresh `classify-node` after the previous candidate was disputed), prior per-participant votes on that facet are cleared and everyone votes again on the new candidate (per ADR 0030).

A participant may change their vote (agree ↔ dispute) at any time before the moderator commits the facet. The opposite-of-current-vote button remains visible alongside the "You voted X" indicator; tapping it dispatches a fresh `vote` envelope (the server applies latest-vote-wins per [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md)). The same single-tap-no-confirmation policy applies to the change-vote click; the chosen-side button is hidden (not just disabled) so a no-op envelope cannot be dispatched.

The other debater's votes are **visible** on each pending facet. Each debater sees how the other has voted in real time, before the moderator commits. This matches the format's transparency ethos (proposals, diagnostics, and history are all visible) and lets each side see exactly where they agree and disagree as votes land. The risk of social pressure to align is real but is outweighed by the value of seeing the disagreement in real time.

### P3. Withdraw agreement

When the debater later realizes they shouldn't have agreed to a facet that has already reached all-agree (or been committed). This is the `withdraw-agreement` gesture defined in [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md); it is a *distinct event kind* from changing a still-uncommitted vote (which is just a fresh `vote` on the live candidate) and from withdrawing a still-pending proposal (`withdraw-proposal`, a proposer-only gesture).

1. **Find the facet** — either via the graph view (tap the entity, find the facet) or via a "my agreements" history view. The row's status is `agreed` or `committed`.
2. **Tap the [Withdraw] button** — a withdraw confirmation appears (this is bigger than a normal vote since it reverses an agreement that was provisionally final).
3. **Confirm withdrawal** — the tablet emits a `withdraw-agreement` event keyed by `(entity_kind, entity_id, facet, participant)`. The facet transitions back to `disputed`; the change history records the withdrawal; the methodology re-runs for that facet.

Withdrawal is intentionally one extra tap compared to normal voting — it has larger consequences and merits a moment of confirmation.

### P4. Propose a change (verbal + tablet)

Substantive proposals (capture, decomposition, meta-moves, etc.) are made **verbally** during the debate. The moderator listens and captures. The tablet does not need quick-action buttons for these in v1 — the format is conversational.

The exception is **axiom-marks**, which the debater can initiate directly from the tablet (see P5). This is structural enough that a tablet action is appropriate.

### P5. Mark a node as your axiom

When the debater wants to declare "nothing would change my mind on this."

1. **Select the node** in the graph view.
2. **Tap "Mark as my axiom"** in the node's action panel.
3. **Confirm** — the system creates a proposal: `axiom-mark(node, participant=this debater)`. The proposal appears in everyone's pending-proposals pane.
4. **Vote** — the proposing debater's initiating tap counts as their `agree`. The other participants (the other debater and moderator) vote.
5. **Moderator commits** when all are agree. The axiom-mark renders visibly on the node, attributed to this debater.

The methodology may also flow the other direction: during operationalization, the debater says verbally "nothing would change my mind"; the moderator captures the axiom-mark proposal; the debater votes agree on their own axiom-mark. Both paths produce the same result.

### P6. View structural diagnostics

Diagnostic flags (cycles, contradictions, multi-warrants, dangling claims) appear on the graph view as visual highlights and in a diagnostics list accessible from the status indicator. The debater can tap a flag to focus the affected region. Diagnostics are read-only on the participant tablet — resolution proposals are made verbally and captured by the moderator.

### P7. View change history

A history view (accessible from the status indicator) shows recent events in reverse chronological order — proposals, votes, commits, withdraw-agreement, withdraw-proposal, snapshots. Used to retrace what happened, especially after taking a moment off-camera or returning from a break. Read-only; the debater cannot edit history.

## Visual state representation

The participant tablet uses the same visual conventions as the audience view (see [moderator-ui.md — visual state representation](moderator-ui.md#visual-state-representation)) for facet states (`awaiting-proposal` / `proposed` / `agreed` / `committed` / `disputed` / `withdrawn` / `meta-disagreement`; the seven-value enum is settled in [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md)). It adds:

- **Per-participant vote indicators** — small per-facet markers next to each `proposed` / `disputed` facet showing each participant's current vote, including the other debater's. Each debater sees their own and the other's vote state in real time, pre-commit. These indicators also appear in the pending-proposals pane (sidebar / tab) for systematic walkthrough — both surfaces are kept in sync, mirroring the moderator UI.
- **Pending count badge** — a number on the pending-proposals tab indicating how many facets across all proposals still need this debater's vote.
- **Diagnostic flags** — same visual treatment as the moderator UI; tappable to focus.

## Touch interactions

The tablet is touch-first. Key gestures:

- **Tap a vote button** — single tap, no modal confirmation, vote lands immediately.
- **Tap an entity on the graph** — opens the entity's detail panel (all facet rows, with per-row buttons depending on each facet's status; see "Per-facet voting").
- **Withdrawal confirmation** — two-tap (tap [Withdraw] on the agreed/committed facet row, confirm in the dialog). Deliberately one extra tap. Emits `withdraw-agreement` per [ADR 0030](adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- **Pinch / pan** — graph navigation.

Touch targets are sized for confident tapping during live debate (large enough that a glance-down-then-tap doesn't misfire).

## V1 defaults (resolved)

- **Tablet form factor and orientation** — landscape (matches typical lap-held debate posture and gives more horizontal room for the graph).
- **How new proposals are surfaced** — visual flash on the affected entity in the graph view plus tab badge increment on the pending-proposals tab. No audible cues (disruptive on camera).
- **Multi-pending-proposal handling** — list view with most-recent at top. Tap to expand a proposal.
- **Undo before commit** — no separate undo gesture; the debater navigates to the proposal and changes their vote. Aligns with the "everything is explicit" ethos.
- **Other debater's votes** — visible in real time on each pending facet. Captured in P2 above.
- **Verbal-action shortcuts on the tablet** — none in v1. The moderator listens; substantive proposals are made verbally.

(All decisions reachable in code without further chat-level deliberation; UI prototyping is the next step.)
