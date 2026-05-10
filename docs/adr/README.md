# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for `a-conversa`. An ADR captures a single architectural choice, the context that forced the choice, the decision itself, and the consequences accepted with it.

## Convention

- Files are named `NNNN-short-slug.md`, numbered sequentially starting at `0001`. Numbers are never reused; superseded ADRs stay in place and are linked from their replacement.
- Each ADR uses the standard four-section format: **Status**, **Context**, **Decision**, **Consequences**.
- Status is one of: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.
- The **Decision** and **Context** sections are immutable once accepted. To change the decision itself, write a new ADR that supersedes the old one.
- Operational scaffolding (e.g., the run command for a stack-validation smoke test) is mutable. Amend it in place, with a brief `## Amendments` section appended at the bottom noting the date and what changed, so the audit trail stays visible without breaking the immutability of the decision proper.
- Keep them short — a page or two of clear prose, no fluff.

The long-term home and tooling for the ADR log is owned by the `deployment.deployment_docs.adr_log` task; this directory is its initial seat.
