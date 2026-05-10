# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for `a-conversa`. An ADR captures a single architectural choice, the context that forced the choice, the decision itself, and the consequences accepted with it.

## Convention

- Files are named `NNNN-short-slug.md`, numbered sequentially starting at `0001`. Numbers are never reused; superseded ADRs stay in place and are linked from their replacement.
- Each ADR uses the standard four-section format: **Status**, **Context**, **Decision**, **Consequences**.
- Status is one of: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.
- ADRs are immutable once accepted. To change a decision, write a new ADR that supersedes the old one.
- Keep them short — a page or two of clear prose, no fluff.

The long-term home and tooling for the ADR log is owned by the `deployment.deployment_docs.adr_log` task; this directory is its initial seat.
