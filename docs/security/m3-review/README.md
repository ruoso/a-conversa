# M3 security review

After M3 (backend MVP) landed on `main`, three independent sub-agent reviews
audited the surface that's about to be exposed to the public network. The
findings are preserved here verbatim so future contributors can trace each
follow-up task back to its source finding.

## Review documents

- [`auth.md`](./auth.md) — AuthN / AuthZ / secrets review (15 findings: 3 High, 4 Medium, 4 Low, 4 Informational).
- [`inputs.md`](./inputs.md) — Input validation, injection vectors, info leaks, DoS exposure (13 findings: 4 Medium, 5 Low, 4 Informational).
- [`coverage.md`](./coverage.md) — Test-coverage gap audit for adversarial / edge-case scenarios (19 gaps: 5 High, 9 Medium, 4 Low, 1 Informational).

## Follow-up WBS

Each finding rolls up into a task under `backend.hardening.*` in
[`tasks/25-backend-hardening.tji`](../../../tasks/25-backend-hardening.tji).
Refinement documents live at [`tasks/refinements/backend-hardening/`](../../../tasks/refinements/backend-hardening/).
The aggregating milestone is **M3-review** in [`tasks/99-milestones.tji`](../../../tasks/99-milestones.tji);
M9 (deployment) depends on it — public network exposure is gated on this work.

## Cross-cutting themes

Three patterns appear across multiple findings — each one is a single root
cause that fixing closes several findings at once.

1. **Subscription state is captured once and never revalidated.** Three
   High-severity coverage gaps (G-001 stale broadcasts after privacy flip,
   G-002 catch-up after visibility revoke, G-003 deleted user still writing)
   share the same root: the auth/visibility decision is made at subscribe /
   upgrade time, and the registry never re-checks. Owned by
   `backend.hardening.subscription_lifecycle`.

2. **Cookie is a 7-day portable bearer credential.** F-001 (logout doesn't
   revoke), F-004 (single shared secret, committed dev value), F-006 (no token
   binding), G-005 (no test pins the trade-off) stack to: cookie theft =
   casting votes / committing proposals as the victim for up to a week. Owned
   by `backend.hardening.auth_hardening.jwt_revocation_jti_denylist` (plus the
   smaller siblings).

3. **DoS / resource-ceiling story is consistently under-developed.** Inputs
   F-001..F-004 + F-013 + coverage G-013: no `bodyLimit`, no `maxPayload`, no
   per-connection subscription cap, no max length on user-authored text, no
   ceiling on catch-up replay rows, no offset cap on session listing, no
   bound on the `ILIKE` topic search. None is a CVE-class bug alone; together
   they let an authenticated client impose asymmetric server cost. Owned by
   `backend.hardening.resource_limits_and_dos`.
