# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for `a-conversa`. An ADR captures a single architectural choice, the context that forced the choice, the decision itself, and the consequences accepted with it.

## Convention

- Files are named `NNNN-short-slug.md`, numbered sequentially starting at `0001`. Numbers are never reused; superseded ADRs stay in place and are linked from their replacement.
- Each ADR uses the standard four-section format: **Status**, **Context**, **Decision**, **Consequences**.
- Status is one of: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.
- The **Decision** and **Context** sections are immutable once accepted. To change the decision itself, write a new ADR that supersedes the old one.
- Operational scaffolding (e.g., the run command for a stack-validation smoke test) is mutable. Amend it in place, with a brief `## Amendments` section appended at the bottom noting the date and what changed, so the audit trail stays visible without breaking the immutability of the decision proper.
- Keep them short — a page or two of clear prose, no fluff.

## Amendment-pass rule

When a new ADR changes prior decisions or resolves their open questions, sweep the affected predecessors and append `## Amendments` entries before declaring the new ADR done. Common cases:

- **Tooling switch.** A new ADR changes the package manager, build tool, or run command. Every prior ADR with a stale `Stack-validation smoke test` invocation gets an Amendment line linking to the new ADR and updating the operational text.
- **Deferred-question resolver.** A new ADR settles a question marked "deferred" or "open" in an earlier one. Backlink and update the prior open-question text.
- **Tier-upgrade enabler.** A new ADR enables a setting that an earlier ADR's Consequences flagged as deferred (e.g., type-aware lint became possible only after a tsconfig landed). Amend the prior ADR to record the upgrade.

The mechanic: scan predecessors with `grep -n "<key term>" docs/adr/*.md` after a relevant decision lands; for each match that's now stale, update operational text in place AND append a one-line `## Amendments` entry stating what changed and linking to the new ADR. Decision/Context stay untouched. Historical Amendment text is itself immutable — never edit a prior amendment, only add new ones. The rule was made explicit on 2026-05-10 after a sweep of stale `npm install` commands across eight ADRs revealed the gap.

The long-term home and tooling for the ADR log is owned by the `deployment.deployment_docs.adr_log` task; this directory is its initial seat.
