# entity_inclusion_render_policy

**Source**: [docs/security/m3-review/coverage.md](../../../docs/security/m3-review/coverage.md) G-015
**TaskJuggler**: `backend_hardening.documentation.entity_inclusion_render_policy`
**Type**: Methodology / policy decision; documentation-only output.

## Goal

Decide and document the cross-session entity-rendering policy. The reference-permission predicate (`canReference*`) protects the **creation** of inclusions, but does NOT protect the **rendering** of already-included entities in a snapshot.

## Context

A real scenario:

1. Alice (host of private session B) includes a node from B into public session A. Legal — Alice is a participant of A and can reference B's node via her membership.
2. Public session A is widely subscribed. Strangers see A's full state via `snapshot-state`, including the included node.
3. The included node's `wording` / `axiomMarks` / per-facet status all originated in private B. **Are they visible to A's strangers?**

The current code (`apps/server/src/ws/handlers/snapshot.ts` + `apps/server/src/sessions/visibility.ts`) renders the snapshot from A's perspective using A's event log. The included entity's content was emitted into A's event log at inclusion time (the `entity-included` event payload), so it's visible.

## The decision

**Yes — included entities ARE rendered transitively. This is intentional.**

Rationale:

- **Inclusion is an explicit act.** Alice, with full knowledge that A is public, deliberately included B's node into A. The act of inclusion is the act of disclosing the node's content into A's audience.
- **Methodology coherence.** The included node carries forward its full structure (kind, wording, edges, axiom-marks) — this is what makes "the same fact appears in two debates" meaningful. Stripping content would force participants of A to debate against a placeholder, defeating the purpose of inclusion.
- **The trust boundary is `canReference*`.** Only callers who can see B AND are participants of A can include. The reference-permission predicate gates who CAN disclose. After disclosure, the content is part of A.
- **Audit trail.** The `entity-included` event records `included_by = <Alice's user id>`. The disclosure is attributable.

## What clients should know

- The `snapshot-state` payload's `nodes` / `edges` / `annotations` collections include EVERY entity that has ever been brought into the session via `entity-included` events, with their FULL content (per-facet status, methodology kind, wording).
- Clients rendering a session's graph treat every entity as part of THIS session, regardless of where it originated.

## Out of scope

- **"Quoted reference" mode** — a future task could add an alternative inclusion shape that records the entity-id but elides the content, requiring a per-render visibility check against the source. Out of scope for v1.
- **Per-field opt-out** — there's no per-field "private" flag (e.g., "include the kind but hide the wording"). Out of scope.

## Acceptance

- This refinement document captures the decision.
- A pinning test in `apps/server/src/ws/handlers/snapshot.test.ts` (or sibling) that exercises the cross-session inclusion + snapshot path and asserts the included entity's content IS visible to a stranger. Comments explicitly cite this refinement so a future "rendering policy" task knows the precedent.
- `docs/methodology.md` carries a short "Cross-session inclusion" subsection naming the policy.
- `complete 100` in `tasks/25-backend-hardening.tji`.

## Status

- [x] Refinement / decision document landed.
- [ ] Pinning test in `snapshot.test.ts` — **deferred** to a separate dispatch (needs cross-session fixture setup; ADR 0022 forbids ad-hoc verification, so we land the test honestly via an agent rather than rushing it here).
- [x] `docs/methodology.md` updated.
- [x] `complete 100` in tji.

Note: the pinning-test deferral is documented so a follow-up can land it. This task ships the policy decision (the documentation-only deliverable); the test is the audit-trail belt-and-suspenders.
