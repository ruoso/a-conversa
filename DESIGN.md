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
- **All participants — both debaters and the moderator — must agree on every change to the graph before it lands.** Disagreement about classification is itself diagnostic and gets handled by an explicit methodology.
- Any participant may propose any operation — classification, decomposition, edge, contradiction, etc. The moderator is the sole operator of the tool; participants propose verbally and the moderator commits the change once everyone agrees.

## Diagnostic goals

1. **Internal contradictions** — when a debater's nodes conflict with each other, the graph makes this visible and prompts resolution.
2. **Category mismatches** — when the two debaters classify the same content differently, that is itself the disagreement to surface (and is typically resolved by decomposition).
3. **Bedrock axioms** — when "nothing could change my mind", the system marks the node as an axiom. Surfacing axioms is a primary success state — the debate has identified the irreducible disagreement.

## Two orthogonal classifications

Every node carries a **statement kind** (fact / predictive / value / normative / definitional). Every edge carries an **argument role** (supports / rebuts / qualifies / bridges-from / bridges-to / defines / contradicts) drawn from Toulmin. The two dimensions are independent; both matter for surfacing where debaters talk past each other. See [docs/data-model.md](docs/data-model.md).

## Document index

- [docs/data-model.md](docs/data-model.md) — nodes, edges, ownership, graph properties, structural diagnostics, visibility and history, event types.
- [docs/methodology.md](docs/methodology.md) — classification procedure, decomposition, diagnostic tests, axioms, meta-disagreement, agreement rule, the commit step.
- [docs/architecture.md](docs/architecture.md) — engineering shape: event-sourced state model, sessions and the global graph (nodes/edges M-N to sessions), server-authoritative real-time, frontend surfaces, identity, deployment, replay, test mode.
- [docs/moderator-ui.md](docs/moderator-ui.md) — the moderator surface: layout sketch, core flows (capture, decompose, run diagnostic test, capture defeater, axiom-mark, meta-move, snapshot), visual state representation, keyboard shortcuts.
- [docs/participant-ui.md](docs/participant-ui.md) — the debater tablet: per-facet voting (the central design), withdrawal flow, axiom-mark proposal, view of structural diagnostics and change history.
- [docs/example-walkthrough.md](docs/example-walkthrough.md) — simulated debate ("Should zoos exist?") produced by three sub-agents (Anna, Ben, Maria) with neutral prompts. Exercises the platform's procedure end-to-end.

## Languages

The platform's UI is localized for **English (US)**, **Brazilian Portuguese**, and **Latin American Spanish** (`en-US`, `pt-BR`, `es-419`). The methodology vocabulary (statement kinds, edge roles, facet states, diagnostic kinds) is presented in the active locale; the underlying data model remains English-coded so events and replay stay durable across locale changes. Participant-supplied content — statement wordings on nodes — is **not** translated; it stays in whatever language the participants spoke. A debate in pt-BR may have a moderator running their UI in en-US, and that mismatch is supported. See [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](docs/adr/0024-frontend-i18n-react-i18next-with-icu.md).

## Out of scope (for v1)

- AI-assisted classification — manual tagging by the moderator only.
- Async / many-participant debate — real-time, two debaters + one moderator.
- Public archive / search across debates.

## Open questions

Cross-cutting and product-level questions only. Doc-specific opens live in [docs/data-model.md](docs/data-model.md), [docs/methodology.md](docs/methodology.md), and [docs/architecture.md](docs/architecture.md).

- **Pre-debate prep workflow** — do debaters submit positions in advance? Could become a standalone use case ("map your own worldview" without a live debate). Out of scope for v1.
