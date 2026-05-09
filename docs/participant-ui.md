# Participant (debater) UI

> Status: Early design. Flow-level sketch; specific widget choices, layout details, and visual-design specifics defer to UI prototyping.

The participant UI is the debater's tablet — read-only on the graph plus per-facet voting controls on pending proposals. It is the surface through which debaters express agreement, dispute, or withdrawal, and it is the only way debaters interact with the platform mechanically (substantive proposals are made verbally and captured by the moderator). For the moderator counterpart see [moderator-ui.md](moderator-ui.md).

## Responsibilities recap

The debater (using their tablet):

- Sees the live graph in read-only form (same content the audience sees).
- Votes **per facet** on every pending proposal — agree, dispute, or no-vote-yet on each individual facet.
- Withdraws agreement on a previously-agreed facet (which sends it back to `disputed`).
- Proposes axiom-marks on their own positions (declaring "nothing could change my mind").
- Sees their own vote state across pending proposals (so they can review and revise).
- Sees structural diagnostics (cycles, contradictions, multi-warrants, dangling claims) so they can engage with what the methodology is surfacing.

The debater **does not** directly edit the graph or capture statements. All structural changes go through the moderator. Substantive proposals (decomposition, meta-moves, etc.) are made verbally; the moderator captures.

## Layout (sketch)

The tablet UI has two primary regions, switchable by tab or split-view depending on orientation:

- **Graph view** — read-only render of the live shared graph. Same visual conventions as the audience view (per-facet states distinct), with the addition of the debater's **own per-facet vote indicators** so they can see at a glance "I agreed N1's wording but haven't voted on its classification yet."
- **Pending proposals pane** — list of in-flight proposals awaiting the debater's vote. Each proposal expands to show its facets with per-facet vote controls. A badge on the tab indicates how many facets are awaiting their vote.

A persistent **status indicator** shows the debater's role (`debater A` or `debater B`), screen name, and a small count of "facets awaiting your vote."

Specific layout (split vs. tabbed, landscape vs. portrait) defers to UI prototyping. The flows below are layout-agnostic.

## Per-facet voting (the central design)

When the moderator proposes a capture, several facets are proposed simultaneously — typically wording, classification, and (if connecting) edge shape and edge substance. **Each facet is its own proposal with its own vote.** The debater sees them listed separately and can agree or dispute each independently.

Worked example. Maria captures Anna's "Modern accredited zoos do more good than harm." The moderator's UI bundles three proposals; Ben's tablet sees:

- **Wording**: "Modern accredited zoos do more good than harm." [Agree] [Dispute]
- **Classification**: `normative`. [Agree] [Dispute]
- **Edge** (if connecting): `supports → N0` (a higher-level claim). [Agree] [Dispute]

Ben can:

- Agree all three (the common path for clean captures).
- Agree wording but dispute classification ("yes that's what she said, but I think it's a value claim, not normative").
- Agree wording and classification but dispute edge ("that's right, but it doesn't support N0 — it's parallel").
- Any other combination.

This per-facet split is **the** mechanism that lets debaters concede structure without conceding substance. "I agree this is a `predictive` claim" is a real and meaningful move; it does not commit Ben to "I agree the prediction will hold." Without per-facet voting, the agreement rule would force structural concessions to imply substantive ones, which would be wrong.

A small UX accelerator: an **"Agree all"** gesture per proposal bundle, for cases where the debater is content with everything the moderator captured. This is still per-facet voting (each facet's vote lands separately) — the gesture just sets all of them to `agree` in one tap.

## Core flows

### P1. View the graph

Default state. The graph view shows the live shared graph with current per-facet states rendered visually. The debater can pan, zoom, tap nodes/edges to see details (wording, classification, owner, axiom marks, current substance state).

For each entity displayed, the debater also sees their own vote state on any pending facets — a small per-debater indicator next to each `proposed` or `disputed` facet showing whether they've voted, and how.

### P2. Vote on a pending proposal

The most common operation.

1. **Notification** — when the moderator publishes a new proposal, the pending-proposals tab badge increments. The graph view also visually flashes the affected entity briefly.
2. **Open the proposal** — tap the badge or the affected entity on the graph. The proposal expands showing each facet.
3. **Vote per facet** — for each facet, tap [Agree] or [Dispute]. The vote is recorded immediately (single-tap; no confirmation modal — the methodology already provides deliberation).
4. **(Optional) "Agree all"** — for unanimous bundles, a single tap sets every facet of the proposal to `agree`.
5. **State update** — the moderator's pending-proposals pane updates with the new vote indicators. Once all participants are voting `agree` on a facet, the moderator can commit.

The debater's vote is **provisional until the moderator commits.** A debater can change their vote (from agree to dispute, or vice versa) up until commit lands.

The other debater's votes are **visible** on each pending facet. Each debater sees how the other has voted in real time, before the moderator commits. This matches the format's transparency ethos (proposals, diagnostics, and history are all visible) and lets each side see exactly where they agree and disagree as votes land. The risk of social pressure to align is real but is outweighed by the value of seeing the disagreement in real time.

### P3. Withdraw agreement

When the debater later realizes they shouldn't have agreed.

1. **Find the facet** — either via the graph view (tap the entity, find the facet) or via a "my agreements" history view.
2. **Tap the existing agree vote** — a withdraw confirmation appears (this is bigger than a normal vote since it reverses a committed change).
3. **Confirm withdrawal** — the facet transitions back to `disputed`; the change history records the withdrawal; the methodology re-runs for that facet.

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

A history view (accessible from the status indicator) shows recent events in reverse chronological order — proposals, votes, commits, withdrawals, snapshots. Used to retrace what happened, especially after taking a moment off-camera or returning from a break. Read-only; the debater cannot edit history.

## Visual state representation

The participant tablet uses the same visual conventions as the audience view (see [moderator-ui.md — visual state representation](moderator-ui.md#visual-state-representation)) for entity states (`proposed` / `agreed` / `disputed` / `meta-disagreement`). It adds:

- **Per-participant vote indicators** — small per-facet markers next to each `proposed` / `disputed` facet showing each participant's current vote, including the other debater's. Each debater sees their own and the other's vote state in real time, pre-commit. These indicators also appear in the pending-proposals pane (sidebar / tab) for systematic walkthrough — both surfaces are kept in sync, mirroring the moderator UI.
- **Pending count badge** — a number on the pending-proposals tab indicating how many facets across all proposals still need this debater's vote.
- **Diagnostic flags** — same visual treatment as the moderator UI; tappable to focus.

## Touch interactions

The tablet is touch-first. Key gestures:

- **Tap a vote button** — single tap, no modal confirmation, vote lands immediately.
- **Tap an entity on the graph** — opens the entity's detail panel (facet states, vote controls if pending, withdraw option if agreed).
- **"Agree all" gesture** — single tap on a per-bundle "Agree all" button.
- **Withdrawal confirmation** — two-tap (tap the agreed facet, tap "withdraw" in the dialog). Deliberately one extra tap.
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
