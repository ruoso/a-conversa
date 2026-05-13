# flow_state_sweep_cadence_note

**Source**: [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-012
**TaskJuggler**: `backend_hardening.documentation.flow_state_sweep_cadence_note`
**Type**: Documentation-only follow-up.

## Goal

Document the OIDC flow-state sweep cadence (60 s) + the 60s timing-observation window it leaves between sweeps.

## Context

[`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) maintains an in-process `Map<state, FlowStateEntry>` with a 5-min entry TTL. A `setInterval(60_000, sweep)` runs every 60 seconds, removing expired entries. Between sweeps, expired entries are still in the map.

Two implications:

1. **Memory ceiling between sweeps**: bounded by the new size cap from [`flow_state_map_bound`](./flow_state_map_bound.md) (default 1000 entries). The eager-sweep on cap-hit covers worst-case bursts.

2. **Timing-observation window**: an attacker measuring response time on `/auth/callback?state=<expired>` could distinguish "entry was in the map, expired, took longer to look up" from "entry was never in the map." This is a low-impact timing oracle — the leak is the existence of a recent (within 60s) failed flow, not the user identity.

## Decisions

- **No code change today.** The sweep cadence is fine for v1.
- **Document the trade-off** in code comments at the `setInterval` site + in this refinement.
- **Future hardening** options if the timing leak becomes a concern:
  - Tighter sweep cadence (e.g., 10 s) — minor cost increase.
  - Constant-time `take()` — pad lookup to a fixed duration regardless of hit/miss/expired.
  - Random per-entry expiry jitter — makes window-correlation harder for an attacker.
- Choose nothing for v1 because the impact (knowing a recent failed-state) is not actionable against this auth design.

## Acceptance

- Code comment at the `setInterval` site in `flow-state.ts` referencing this refinement.
- `complete 100` in `tasks/25-backend-hardening.tji`.

## Status

- [x] Refinement landed.
- [x] Code comment added.
- [x] `complete 100` in tji.
