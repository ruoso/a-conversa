# Backend hardening refinements (M3-review)

Refinement documents for the tasks under
[`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji), grouped by
the security-review surface each one came from.

## Source documents

Every leaf task here rolls up at least one finding from the three independent
M3 security reviews, preserved verbatim under
[`docs/security/m3-review/`](../../../docs/security/m3-review/):

- `auth.md` — AuthN / AuthZ / secrets (F-NNN auth)
- `inputs.md` — Input validation, injection, info leaks, DoS (F-NNN inputs)
- `coverage.md` — Test-coverage gaps for adversarial scenarios (G-NNN)

The aggregating milestone is `m_backend_review` (**M3-review**) in
[`tasks/99-milestones.tji`](../../99-milestones.tji); M9 (deployment) depends
on it.

## Refinement-document convention

Each per-task refinement opens with the source finding id (e.g.
`auth.md F-001`, `inputs.md F-002`, `coverage.md G-001`) so the audit trail
is bidirectional — a finding can be traced to its closing task; a task can be
traced to the finding that motivated it.

Refinements follow the same shape as the rest of the project
([`tasks/refinements/README.md`](../README.md)):

- Goal / Context / Decisions / Acceptance / Status block.
- The Decisions section cross-references the relevant ADR(s) and the source
  finding by anchor.
- The Status block updates as the task progresses; the task-completion ritual
  (refinement `## Status` block + `complete 100` in the `.tji` file + the
  corresponding commit) is the same as every other refinement in the project.

## Cross-cutting themes (consider when picking a task)

Three patterns from the reviews mean some tasks naturally land together:

1. **Subscription invalidation** — `subscription_lifecycle/*` closes three
   findings at once (G-001, G-002, G-003) with a single helper that walks
   the subscription registry and emits a server-initiated `unsubscribed`
   push. Refinement should design that helper first; the three leaves are
   the consumers.

2. **JWT revocation** — `auth_hardening.jwt_revocation_jti_denylist` is the
   structural fix for F-001 / F-006 / G-005. `logout_no_revocation_pin`
   (under `protocol_test_pinning`) is the placeholder test that should land
   FIRST (cheap, pins current behavior) and then be UPDATED by the denylist
   task to assert revocation.

3. **DoS / resource ceilings** — `resource_limits_and_dos/*` is mostly
   one-liner config / schema tightenings. Reasonable to batch the smallest
   ones into a single task if a contributor wants — but each leaf documents
   a distinct invariant.
