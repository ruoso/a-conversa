# a-conversa — design notes

> Status: Early design phase. This document evolves through Q&A as decisions get made. Open questions are explicitly marked. As any single concern grows, it gets extracted to its own file under `docs/`.

## Vision

`a-conversa` is a debate platform whose primary use case is the format for a YouTube show. The hypothesis: most disagreements are either (a) people contradicting themselves without realizing it, or (b) people talking past each other because they're treating the same statement as different *kinds* of thing (one calls it a fact, the other a value).

The platform aims to slow debate down and force clarity to build slowly, by classifying every statement and only proceeding when both sides agree on the classification.

The platform will be open source. The YouTube show is the proof of concept; if it succeeds, others can adopt the same format with the same tooling.

## Format

- Two debaters, defending different positions on a topic.
- One moderator, who is the sole operator of the structuring tool.
- Real-time classification: the moderator labels each statement as it is made. The debate intentionally slows so the structure can keep up.
- A single, shared, live-growing graph is the visible artifact — what the audience sees being assembled.
- **Both debaters must agree on every change to the graph before the debate moves on.** Disagreement about classification is itself diagnostic and gets handled by an explicit methodology.
- Any participant (moderator or either debater) may propose any operation — classification, decomposition, edge, contradiction, etc. The moderator is the sole operator of the tool; participants propose verbally and the moderator executes if everyone agrees.

## Diagnostic goals

1. **Internal contradictions** — when a debater's nodes conflict with each other, the graph makes this visible and prompts resolution.
2. **Category mismatches** — when the two debaters classify the same content differently, that is itself the disagreement to surface (and is typically resolved by decomposition).
3. **Bedrock axioms** — when "nothing could change my mind", the system marks the node as an axiom. Surfacing axioms is a primary success state — the debate has identified the irreducible disagreement.

## Two orthogonal classifications

Every node carries a **statement kind** (fact / predictive / value / normative / definitional). Every edge carries an **argument role** (supports / rebuts / qualifies / bridges / defines / contradicts) drawn from Toulmin. The two dimensions are independent; both matter for surfacing where debaters talk past each other. See [docs/data-model.md](docs/data-model.md).

## Document index

- [docs/data-model.md](docs/data-model.md) — nodes, edges, ownership, graph properties, structural diagnostics, visibility and history.
- [docs/methodology.md](docs/methodology.md) — classification procedure, decomposition, diagnostic tests, axioms, meta-disagreement, agreement rule.
- [docs/example-walkthrough.md](docs/example-walkthrough.md) — simulated debate ("Should zoos exist?") produced by three sub-agents (Anna, Ben, Maria) with neutral prompts. Exercises the platform's procedure end-to-end and surfaces design questions about sub-IDs, annotations, defeater objects, and segment snapshots.

## Out of scope (for v1)

- AI-assisted classification — manual tagging by the moderator only.
- Async / many-participant debate — real-time, two debaters + one moderator.
- Public archive / search across debates.

## Open questions

Cross-cutting and product-level questions only. Doc-specific opens live in [docs/data-model.md](docs/data-model.md) and [docs/methodology.md](docs/methodology.md).

- **Moderator's tool UX** — what does the moderator actually interact with on screen? Capture, classify, decompose, connect, commit, view-history — what do those operations look like as UI?
- **Production setup** — one screen mirrored to viewers, or separate capture and display surfaces?
- **Pre-debate prep workflow** — do debaters submit positions in advance? Could become a standalone use case ("map your own worldview" without a live debate).
- **Persistence and export** of completed debate graphs and their change histories.
- **Walkthrough-surfaced items still pending:** sub-IDs vs. fresh IDs after decomposition; defeater objects (concrete retraction conditions modeled explicitly); segment snapshots (immutable named graph states alongside live view and change history).
