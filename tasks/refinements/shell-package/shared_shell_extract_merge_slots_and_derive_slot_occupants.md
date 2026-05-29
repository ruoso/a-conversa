# Lift `mergeSlots` + `deriveSlotOccupants` (+ the supporting `SLOT_ROLES` / `SlotRole` / `SlotOccupant` / `SlotOccupants` / `ParticipantRow` type cluster) into `@a-conversa/shell`

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.shared_shell_extract_merge_slots_and_derive_slot_occupants` (lines 276-289).
**Effort estimate**: 0.5d (WBS budget — the helpers' bodies are byte-identical across the two callers post-`part_lobby_view_ws_absence_merge_fix`; the deliverable's bulk is the consolidated Vitest suite + the import-rewire of two route files + the per-workspace deletion of the duplicated type-and-constant cluster).

## Inherited dependencies

- `shell_package.shell_substrate_extraction` (settled — [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md)). The foundational precedent for the `packages/shell/src/<area>/` directory layout, the colocated Vitest suite shape, and the root re-export convention via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts). The strict `.tji`-edge predecessor named in [`tasks/27-shell-package.tji:279`](../../27-shell-package.tji#L279).
- `audience.aud_shell.aud_state_management` (settled — see `audience/aud_state_management.md` Decision §4). The strict `.tji`-edge predecessor that *gated* this lift on the audience surface becoming the third caller. **The expected trigger did not materialise the way the WBS deferral language anticipated**: the audience surface landed `apps/audience/src/state/sessionRoster.ts` (a `userId → screenName` projector keyed differently from `deriveSlotOccupants`'s role-keyed slot map, with no HTTP-prefetch+WS-overlay composition because the audience has no `/api/sessions/:id/participants` REST seam). Decision §1 of this leaf addresses the missed-trigger pattern head-on.
- `audience.aud_graph_rendering` (settled — container for the audience graph-rendering work-stream, including [`aud_axiom_mark_decoration`](../audience/aud_axiom_mark_decoration.md) and every nameplate / per-participant styling leaf). Strict `.tji`-edge predecessor. None of the leaves in this container introduced a role-keyed slot map or an HTTP-prefetch overlay; the audience reads roster identity from its broadcast WS stream.
- `participant_ui.part_session_join.part_lobby_view_ws_absence_merge_fix` (settled — [`tasks/refinements/participant-ui/part_lobby_view_ws_absence_merge_fix.md`](../participant-ui/part_lobby_view_ws_absence_merge_fix.md)). **Source of debt.** §7 ("Out of scope") of that refinement is the explicit deferral language that registered this leaf: *"extracting `mergeSlots` + `deriveSlotOccupants` to `@a-conversa/shell` (deferred — still only two callers; moderator + participant now both carry the fixed shape, deferral can close when third caller surfaces, likely audience view in M6)."* The fix it landed is what made the two callers' bodies byte-identical (the participant gained the third `events` arg + the `latest`-map pre-filter; the moderator's shape was already there from `mod_invite_participants_rest_prefetch`). Prose-only context (no `.tji` edge — the WBS edge runs through the audience predecessors instead because they were the speculative trigger surface; the source-of-debt edge is captured here in prose).
- `moderator_ui.mod_session_setup.mod_invite_participants_rest_prefetch` (settled — [`tasks/refinements/moderator-ui/mod_invite_participants_rest_prefetch.md`](../moderator-ui/mod_invite_participants_rest_prefetch.md)). The other half of the source-of-debt pair. §8 ("Out of scope") records the original cross-workspace duplication after the moderator's invite view adopted the HTTP-prefetch+WS-overlay composition: *"extracting `mergeSlots` to `@a-conversa/shell` (deferred — only two callers today; pattern repeats when audience adds a participant-list surface; YAGNI deferral)."* Prose-only context.
- `participant_ui.part_session_join.part_lobby_view` (settled — [`tasks/refinements/participant-ui/part_lobby_view.md`](../participant-ui/part_lobby_view.md)). §6 ("Out of scope") of the participant lobby implementation that first introduced `deriveSlotOccupants` on the participant side as a verbatim port of the moderator's reducer: *"deferred helper extraction — `deriveSlotOccupants` inline, future lift when third caller surfaces."* Prose-only context.
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_votes_by_facet_projector_v2` (settled 2026-05-28 — [`tasks/refinements/shell-package/extract_votes_by_facet_projector_v2.md`](extract_votes_by_facet_projector_v2.md)). **Decision precedent for "lift now even though the third workspace never materialised."** That leaf relaxed the "wait for a third workspace" half of the deferral policy on strength of two byte-identical post-alignment projector bodies across two workspaces. Decision §1 here mirrors that precedent.
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_pending_axiom_mark_projector_v2` (settled — [`tasks/refinements/shell-package/extract_pending_axiom_mark_projector_v2.md`](extract_pending_axiom_mark_projector_v2.md)). **Counter-precedent for "re-defer when neither precondition is met."** That leaf chose Option A (re-defer) when the projector had ONE caller by design and methodology excluded additional callers. Decision §1 here explains why this leaf does NOT follow the re-defer path: the present helpers have TWO callers with byte-identical bodies (the votes-by-facet condition), not one caller with methodology-excluded additional callers (the pending-axiom-mark condition).
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_facet_status_rules` (settled — [`tasks/refinements/shell-package/extract_facet_status_rules.md`](extract_facet_status_rules.md)). Sibling-shape precedent for substrate lifts that ship a `packages/shell/src/<area>/` directory + colocated test file + barrel re-export through the root `index.ts`.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_axiom_marks_extraction` (settled — [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md)). Another sibling-shape precedent for the lift recipe.
- Prose-only context (NOT a `.tji` edge): ADR 0021 (event envelope — discriminated union with Zod). The lift preserves the `event.kind` discriminant access pattern; `participant-joined` / `participant-left` payload narrowing follows the same shape both helpers already use.
- Prose-only context (NOT a `.tji` edge): ADR 0022 (no throwaway verifications). The consolidated Vitest suite is the test artefact — no scratch verifications.
- Prose-only context (NOT a `.tji` edge): ADR 0006 (Vitest as the unit-test framework). The colocated `packages/shell/src/slots/slots.test.ts` runs under Vitest, following the pattern every other shell-substrate subsystem uses.

## What this task is

The half-day mechanical refactor that lifts the **HTTP-prefetch + WS-overlay slot-merge helpers** — `mergeSlots(httpRows, wsOccupants, events)` + `deriveSlotOccupants(events)` + their supporting type-and-constant cluster (`SLOT_ROLES` / `SlotRole` / `SlotOccupant` / `SlotOccupants` / `ParticipantRow`) — out of two route-file callers (`apps/moderator/src/routes/InviteParticipants.tsx` + `apps/participant/src/routes/LobbyRoute.tsx`) into a single canonical home at `packages/shell/src/slots/`, then rewires both call sites to import from `@a-conversa/shell` and deletes the per-workspace copies.

Today the helpers exist as **two mirrors** in lockstep after `part_lobby_view_ws_absence_merge_fix` (the participant's three-arg `mergeSlots` adoption) and `mod_invite_participants_rest_prefetch` (the moderator's HTTP-prefetch+merge composition):

- [`apps/moderator/src/routes/InviteParticipants.tsx:67-68`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L67) — `SLOT_ROLES` / `SlotRole`. [Lines 103-107](../../../apps/moderator/src/routes/InviteParticipants.tsx#L103) — `SlotOccupant` / `SlotOccupants`. [Lines 116-120](../../../apps/moderator/src/routes/InviteParticipants.tsx#L116) — `ParticipantRow`. [Lines 137-162](../../../apps/moderator/src/routes/InviteParticipants.tsx#L137) — `deriveSlotOccupants`. [Lines 185-214](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185) — `mergeSlots`. Two in-workspace consumers: the route's own `useMemo` deriving `slotOccupants` from the WS event log + the `useMemo` calling `mergeSlots(prefetchedRows, slotOccupants, events)` for the rendered slot rows.
- [`apps/participant/src/routes/LobbyRoute.tsx:85-86`](../../../apps/participant/src/routes/LobbyRoute.tsx#L85) — `SLOT_ROLES` / `SlotRole`. [Lines 116-120 / 124](../../../apps/participant/src/routes/LobbyRoute.tsx#L116) — `SlotOccupant` / `SlotOccupants`. [Lines 122-126](../../../apps/participant/src/routes/LobbyRoute.tsx#L122) — `ParticipantRow`. [Lines 154-176](../../../apps/participant/src/routes/LobbyRoute.tsx#L154) — `deriveSlotOccupants`. [Lines 185-214](../../../apps/participant/src/routes/LobbyRoute.tsx#L185) — `mergeSlots`. Single in-workspace consumer (the route's own `useMemo`s).

The two `deriveSlotOccupants` bodies differ only stylistically: the moderator copy extracts `const role = event.payload.role` to a local before assignment (line 146); the participant copy inlines `event.payload.role` (line 161). Both compile to identical behaviour and the consolidated body picks one of the two styles (Decision §4 — inline form, matching the participant copy, since it avoids the variable-introduction overhead and matches the symmetric `event.payload.user_id` / `event.payload.screen_name` reads in the same block).

The two `mergeSlots` bodies are byte-identical (the moderator's [lines 202-214](../../../apps/moderator/src/routes/InviteParticipants.tsx#L202) match the participant's [lines 202-214](../../../apps/participant/src/routes/LobbyRoute.tsx#L202) character-for-character including comments). The single canonical home preserves the same body verbatim.

After this leaf:

- A new directory `packages/shell/src/slots/` lands with:
  - `slots.ts` — the canonical `mergeSlots` + `deriveSlotOccupants` pair + the supporting `SLOT_ROLES` / `SlotRole` / `SlotOccupant` / `SlotOccupants` / `ParticipantRow` exports.
  - `slots.test.ts` — the union of the two predecessor surfaces' Vitest coverage (the moderator side's slot-merge cases from `mod_invite_participants_rest_prefetch` + the participant side's WS-absence-propagation cases from `part_lobby_view_ws_absence_merge_fix` + the empty-list / single-event-kind / both-arms cases from `part_lobby_view`). Collapses duplicate seed-log scaffolding.
  - `index.ts` — barrel re-export.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) adds a new `// ─── slots ───` re-export block. Position: at the end of the existing per-subsystem export blocks (alphabetical sibling-area order places `slots` after `screen-name` and before `votes-by-facet`; the file's current order is auth → screen-name → login-logout → i18n → ws → annotations → axiom-marks → facet-pill → facet-status → mount-contract → error-mapper → votes-by-facet, which is roughly load-order not alphabetical; Decision §3 picks placement after `screen-name` consistent with the existing sibling-area convention used by `votes-by-facet`'s lift).
- [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) loses [`SLOT_ROLES`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L67), [`SlotRole`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L68), [`SlotOccupant`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L103), [`SlotOccupants`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L107), [`ParticipantRow`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L116), [`deriveSlotOccupants`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L137), and [`mergeSlots`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185); imports the five exports from `@a-conversa/shell` and rewires every in-file reference. Other helpers in the same file (the copy-affordance state machine at lines 462-481, the role-iteration render at line 609) reference `SLOT_ROLES` and `SlotRole` from the shell import. No call-site behavioural change.
- [`apps/moderator/src/routes/InviteParticipants.test.tsx`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx) loses the `describe('deriveSlotOccupants', …)` and `describe('mergeSlots', …)` blocks (the cases move into the consolidated shell suite). The route-level integration tests (mount + interaction) stay in place — they exercise the route's behaviour, not the lifted helpers' unit semantics.
- [`apps/participant/src/routes/LobbyRoute.tsx`](../../../apps/participant/src/routes/LobbyRoute.tsx) loses the same five symbols (`SLOT_ROLES` lines 85-86, `SlotOccupant` lines 116-120, `SlotOccupants` line 124, `ParticipantRow` lines 122-126, `deriveSlotOccupants` lines 154-176, `mergeSlots` lines 185-214); imports from `@a-conversa/shell`; rewires in-file references (the role-iteration render at line 580, the prefetch filter at line 391, etc.).
- [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx) (or its sibling) loses the equivalent helper-level `describe` blocks; route-level integration tests stay.
- All call-site behaviour is byte-identical; the lift is a pure refactor.

Out of scope (explicitly NOT done here):

- **Audience-side adoption.** The audience surface's [`sessionRoster.ts`](../../../apps/audience/src/state/sessionRoster.ts) is a *different shape* (a `userId → screenName` projector for voter attribution, not a role-keyed slot map for slot-row rendering) and consumes only the WS event log (no HTTP-prefetch overlay; the audience has no `/api/sessions/:id/participants` REST endpoint use). It does NOT subsume into the lifted helpers and is NOT rewired here. Decision §2 records why widening the shell helpers to cover both projectors is the wrong move.
- **Participant-detail-panel roster** ([`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts)). Also a `userId → screenName` projector keyed differently from the slot map. Out of scope for the same reason — different output shape, different consumer.
- **`/api/sessions/:id/participants` server endpoint contract.** Untouched. The shape of the `ParticipantRow` lifted into shell mirrors the current endpoint contract (`{ userId, role, screenName }` triple, `screenName` empty when omitted). If a future ADR changes the endpoint shape, the `ParticipantRow` type at `packages/shell/src/slots/` is the one place to update.
- **WS event payload schemas.** Untouched. `participant-joined` / `participant-left` payload shapes are owned by [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) per ADR 0021; the lifted helpers consume the existing discriminated-union narrowing without changes.
- **Polling / periodic re-fetch / delta-filtered prefetch.** Out of scope (mirroring the `mod_invite_participants_rest_prefetch` Decision §8 deferral language).
- **`SlotOccupants` shape widening.** Already settled by `mod_invite_participants_rest_prefetch` Decision (pair-carrying `{ userId, screenName }` shape). The lift preserves the pair shape verbatim; no further widening.
- **`mergeSlots` SIGNATURE changes.** The lift preserves the existing three-arg shape: `mergeSlots(httpRows: readonly ParticipantRow[], wsOccupants: SlotOccupants, events: readonly Event[]): SlotOccupants`. No options bag, no callback-shaped dispatcher, no second pre-filtered-occupants overload. Decision §5 rejects the alternatives.
- **`deriveSlotOccupants` SIGNATURE changes.** Preserves `deriveSlotOccupants(events: readonly Event[]): SlotOccupants`. No options bag, no role-filter parameter, no caller-supplied resolver hook.
- **Hoisting `Event` / `participant-joined` payload shape.** Already owned by `@a-conversa/shared-types`; both callers import from there today; the lifted helpers do the same.
- **Future `extract_*_v2` audit registration.** Not needed — there is no predecessor audit chain for this leaf; the deferral was registered ad-hoc in three sibling refinements (`part_lobby_view_ws_absence_merge_fix` §7, `mod_invite_participants_rest_prefetch` §8, `part_lobby_view` §6) and surfaces here directly. No `_v2` chain.

## Why it needs to be done

After `part_lobby_view_ws_absence_merge_fix` landed (commit aligning the participant's `mergeSlots` to the moderator's three-arg shape with the `latest`-map pre-filter), both client copies are byte-identical modulo a single stylistic detail in `deriveSlotOccupants` (`const role = event.payload.role` vs inlined `event.payload.role`). The cost of leaving the two-copy duplication in place is the standard cross-surface drift risk this shell-package work-stream exists to eliminate:

- A future change to the slot-merge semantics — a new "out-of-band absence" signal, a per-slot disambiguation when two `participant-joined` events fire for the same role with different `user_id`s, a refinement to the "WS wins on collision" rule, a clarification to the stale-event defense — has to be applied in two files in two different apps with two different test suites. Any update that lands in one but not the other silently desynchronises the moderator's invite view and the participant's lobby view — exactly the bug class `part_lobby_view_ws_absence_merge_fix` was scoped to fix (the bug *originated* from a one-arg-vs-three-arg divergence between the two copies; the duplication is itself the bug-class root cause).
- The `ParticipantRow` and `SlotOccupant` type aliases are stated twice with identical fields. Both surfaces consume the same `/api/sessions/:id/participants` endpoint; the response shape is one contract, not two. Hoisting the type into a shared subsystem lets the next surface that lands an HTTP-prefetch import the canonical type rather than re-declaring it.
- The `SLOT_ROLES` constant is stated twice with the same `['moderator', 'debater-A', 'debater-B'] as const` literal. Methodology-defined; one source of truth. Hoisting it removes the per-workspace re-statement and aligns it with the canonical `SlotRole` union the rest of the project would otherwise re-derive ad-hoc.
- The duplication adds ~120 lines of client-bundle weight per surface (the two function bodies + the type cluster + the constant). Both surfaces already ship `@a-conversa/shell` as a runtime dependency (ADR 0026 / `shell_substrate_extraction`); consolidation moves the code into the shared chunk without adding a new dependency edge.

The deferral-until-third-caller policy applied by `part_lobby_view_ws_absence_merge_fix.md` §7, `mod_invite_participants_rest_prefetch.md` §8, and `part_lobby_view.md` §6 was the right call **for the moment they were written** — at two callers with newly-converged shapes, the lift could ossify around the wrong API. The convergence is now empirical (two byte-identical bodies) and the shape has been pressure-tested by the bug-fix cycle (`part_lobby_view_ws_absence_merge_fix` was the pressure test; the three-arg shape passed). The policy's "wait for empirical convergence" pretext is satisfied.

Holding the lift back further for a third *workspace* would mean deferring against a future audience consumer that **demonstrably will not materialise in the expected shape**: the audience surface's roster need is a `userId → screenName` projector with no HTTP-prefetch overlay, not a role-keyed slot map with HTTP-prefetch+WS-overlay merge. The audience already landed its solution (`sessionRoster.ts`) and that solution is correctly scoped to the audience's needs; trying to subsume it into the same shell helpers would be the wrong abstraction (Decision §2). That's the YAGNI inversion: the lift now is cheap and removes a real drift surface; the lift-when-a-third-workspace-shows-up policy hedges against a speculative consumer that the predecessor refinements already named as "likely audience view in M6" and that the audience surface has already chosen not to be.

The follow-on benefits:

- **One source of truth for the client-side slot-merge composition.** A future methodology change edits one `packages/shell/src/slots/` block instead of two route files. The next surface to land an HTTP-prefetch+WS-overlay (the replay-test mode's lobby preview, a future operator console, the audience surface if a role-keyed view ever lands) imports from `@a-conversa/shell` directly — no cross-workspace port, no new fourth-caller registration.
- **Test consolidation.** Two Vitest suites covering the same merge-composition semantics collapse into one. The duplicate seed-log scaffolding (event-log fixtures, `ParticipantRow` array fixtures) is stated once.
- **Closes the predecessor deferral chain cleanly.** Three sibling refinements (`part_lobby_view_ws_absence_merge_fix` §7, `mod_invite_participants_rest_prefetch` §8, `part_lobby_view` §6) carry the deferral language; this leaf closes all three pointers simultaneously.
- **Pattern continuity with `extract_votes_by_facet_projector_v2`.** Same lift recipe (sibling shell subdirectory; consolidated Vitest suite; root barrel re-export; per-workspace collapse to import-rewire; no per-workspace carve-outs). Consistency reduces review friction.
- **Removes the load-bearing port-comment debt.** The participant's [`deriveSlotOccupants` docblock at lines 138-152](../../../apps/participant/src/routes/LobbyRoute.tsx#L138) carries the "Mirrors the moderator's reducer at `apps/moderator/src/routes/InviteParticipants.tsx:108-137` line-for-line" claim — accurate today, but only enforced by reviewer attention. After the lift the invariant is enforced by the type system: one shared module, two thin import sites.

## Inputs / context

### Source files (lift sources)

- [`apps/moderator/src/routes/InviteParticipants.tsx:67-68`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L67) — `SLOT_ROLES` constant + `SlotRole` derived type.
  ```ts
  const SLOT_ROLES = ['moderator', 'debater-A', 'debater-B'] as const;
  type SlotRole = (typeof SLOT_ROLES)[number];
  ```
- [`apps/moderator/src/routes/InviteParticipants.tsx:103-107`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L103) — `SlotOccupant` interface + `SlotOccupants` mapped type.
  ```ts
  interface SlotOccupant {
    readonly userId: string;
    readonly screenName: string;
  }
  type SlotOccupants = { [K in SlotRole]?: SlotOccupant };
  ```
- [`apps/moderator/src/routes/InviteParticipants.tsx:116-120`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L116) — `ParticipantRow` interface (HTTP-prefetch row shape).
- [`apps/moderator/src/routes/InviteParticipants.tsx:137-162`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L137) — `deriveSlotOccupants` reducer. Variable-extracting style (`const role = event.payload.role`).
- [`apps/moderator/src/routes/InviteParticipants.tsx:185-214`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185) — `mergeSlots` HTTP-prefetch+WS-overlay merge with `latest`-map pre-filter.
- [`apps/participant/src/routes/LobbyRoute.tsx:85-86`](../../../apps/participant/src/routes/LobbyRoute.tsx#L85) — `SLOT_ROLES` + `SlotRole` (verbatim duplicate).
- [`apps/participant/src/routes/LobbyRoute.tsx:116-124`](../../../apps/participant/src/routes/LobbyRoute.tsx#L116) — `SlotOccupant` + `SlotOccupants` (verbatim duplicate).
- [`apps/participant/src/routes/LobbyRoute.tsx:122-126`](../../../apps/participant/src/routes/LobbyRoute.tsx#L122) — `ParticipantRow` (verbatim duplicate).
- [`apps/participant/src/routes/LobbyRoute.tsx:154-176`](../../../apps/participant/src/routes/LobbyRoute.tsx#L154) — `deriveSlotOccupants` reducer. Inline style (`event.payload.role` directly). Functionally identical to the moderator's.
- [`apps/participant/src/routes/LobbyRoute.tsx:185-214`](../../../apps/participant/src/routes/LobbyRoute.tsx#L185) — `mergeSlots`. Byte-identical to the moderator's.

### Source files (call sites that survive the lift, with re-import path)

- Moderator route's `useMemo` deriving `slotOccupants` and the second `useMemo` calling `mergeSlots(prefetchedRows, slotOccupants, events)` — both compile against the shell-imported symbols after the lift; no other change.
- Participant route's analogous `useMemo`s — same.
- Moderator route's `SLOT_ROLES.map(role => …)` render at [line 609](../../../apps/moderator/src/routes/InviteParticipants.tsx#L609) + copy-affordance machinery at [lines 462-481](../../../apps/moderator/src/routes/InviteParticipants.tsx#L462) consume `SLOT_ROLES` / `SlotRole` from the shell import.
- Participant route's `SLOT_ROLES.map(role => …)` render at [line 580](../../../apps/participant/src/routes/LobbyRoute.tsx#L580) + prefetch role-filter at [line 391](../../../apps/participant/src/routes/LobbyRoute.tsx#L391) consume from the shell import.

### Shell-package destination

- [`packages/shell/src/`](../../../packages/shell/src/) — sibling-subsystem directory list (auth, axiom-marks, error-mapper, facet-pill, facet-status, i18n, login-logout, mount-contract, screen-name, votes-by-facet, ws, annotations). `slots/` becomes the thirteenth peer.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — root barrel; the new `// ─── slots ───` block lives between `screen-name` and `login-logout` (or at the end alongside `votes-by-facet`'s recent addition — Decision §3 picks the precise spot).
- [`packages/shell/package.json`](../../../packages/shell/package.json) — no new dependency edges (the lifted code uses `@a-conversa/shared-types`'s `Event` discriminated union; that package is already a peer of `@a-conversa/shell`).

### Type and event sources (not lifted, consumed as-is)

- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `Event` discriminated union, `participant-joined` / `participant-left` payload shapes. The lifted helpers import `Event` exactly as the two route files do today.

### ADRs

- ADR 0021 (event envelope — discriminated union with Zod). The lifted `deriveSlotOccupants` switches on `event.kind` and narrows `event.payload` per the ADR's pattern. No change to event shapes.
- ADR 0022 (no throwaway verifications). The consolidated Vitest suite is the test artefact; no scratch verifications.
- ADR 0006 (Vitest as the unit-test framework). The colocated test file follows the existing shell-package convention.
- ADR 0026 (micro-frontend root app — `@a-conversa/shell` as shared substrate). Both call-sites already depend on `@a-conversa/shell`; the lift moves code into the existing dependency, not a new one.

## Constraints / requirements

1. **Public signatures are preserved byte-for-byte.** `mergeSlots(httpRows, wsOccupants, events)` and `deriveSlotOccupants(events)` keep their parameter lists, parameter names, and return types exactly as they are at the two source sites. The lifted bodies are the same code, in the same shape, in a new module. No callback-dispatcher widening, no options bag, no second-arg-shape generalisation.
2. **The supporting type cluster (`SLOT_ROLES` / `SlotRole` / `SlotOccupant` / `SlotOccupants` / `ParticipantRow`) is lifted alongside the functions.** Hoisting only the functions while leaving the types per-workspace would force every consumer to re-declare the types to compile against the imports; net duplication unchanged. The type cluster lives in the same module (`packages/shell/src/slots/slots.ts`) and is exported from the same barrel.
3. **`Event` is consumed from `@a-conversa/shared-types`, not re-declared.** The lifted module imports the discriminated union exactly as the route files do today.
4. **No call-site behavioural change.** Pre-lift and post-lift `useMemo` outputs at each call site must be deep-equal for the same input arrays. Cucumber / Playwright suites that exercise the moderator invite view and the participant lobby continue to pass without modification.
5. **The consolidated Vitest suite covers the union of the two predecessor suites' cases.** Specifically: the moderator's HTTP-prefetch + merge-collision + both-debaters-prefetched cases from `mod_invite_participants_rest_prefetch`; the participant's WS-absence-propagation case from `part_lobby_view_ws_absence_merge_fix`; the empty-list / single-event-kind / stale-event-defense cases from `part_lobby_view`. Per ADR 0022, every test that lived in one of the source workspaces survives the lift either at the consolidated shell suite or at a route-level integration test that already exists; nothing is silently dropped.
6. **Stylistic alignment.** The lifted `deriveSlotOccupants` body uses the inline `event.payload.role` form (the participant's style at [line 161](../../../apps/participant/src/routes/LobbyRoute.tsx#L161)), not the variable-extracting form (the moderator's style at [line 146](../../../apps/moderator/src/routes/InviteParticipants.tsx#L146)). Decision §4 rationalises the choice.
7. **Barrel placement.** The `// ─── slots ───` block in [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) follows the existing per-subsystem convention. Decision §3 picks placement after `screen-name` (so the substrate's alphabetical order is preserved alongside the recent `votes-by-facet` addition).
8. **No per-workspace shim.** Both call-sites import directly from `@a-conversa/shell`. No per-workspace re-export of the lifted symbols (mirroring `extract_votes_by_facet_projector_v2` Decision §4 — symbols once internal to a workspace become non-internal at the lift; the barrel re-export is for workspace-internal symbols).
9. **Per-commit build+test gate.** Per the global user instruction "Always build and test before committing" plus the in-repo build cadence: the implementing commit runs `make build` + `make test` (or the equivalent pnpm targets) and confirms green before commit. The shell-package Vitest suite gains the consolidated cases; the moderator + participant routes' integration tests stay green.
10. **No changes to other shell-substrate subsystems.** The lift is scoped to `slots/`; no edits to `auth/`, `axiom-marks/`, `votes-by-facet/`, etc.

## Acceptance criteria

Per ADR 0022, every new behaviour and every preserved behaviour ships with a committed test. The acceptance criteria below name the tests that pin each requirement.

1. **`packages/shell/src/slots/slots.ts` exists** and exports `mergeSlots`, `deriveSlotOccupants`, `SLOT_ROLES`, `SlotRole`, `SlotOccupant`, `SlotOccupants`, `ParticipantRow`. Pinned by a TypeScript compile (the package builds with `tsc -b`) and by `packages/shell/src/slots/slots.test.ts` importing every named symbol.
2. **`packages/shell/src/slots/slots.test.ts` exists** and covers the union of the predecessor suites:
   - `describe('deriveSlotOccupants')` block:
     - (a) empty event log → empty `SlotOccupants`.
     - (b) single `participant-joined` → role-keyed occupant entry with `{userId, screenName}` pair.
     - (c) `participant-joined` followed by `participant-left` (same `user_id`) → empty `SlotOccupants` (the slot is cleared).
     - (d) `participant-joined` followed by `participant-left` (different `user_id`) → original slot still occupied (stale-event defense).
     - (e) two `participant-joined` for the same role with different `user_id`s → latest wins (the rejoin overwrites).
     - (f) other event kinds in the log → ignored (no spurious slot mutation).
   - `describe('mergeSlots')` block:
     - (g) HTTP rows + empty WS events + empty WS occupants → HTTP rows render in their slots.
     - (h) HTTP rows + WS occupants for the same slot → WS occupant wins (collision rule).
     - (i) HTTP rows + WS event log including a `participant-left` for one of the HTTP-prefetched user_ids → that HTTP row is filtered out (the `latest`-map pre-filter — the WS-absence-propagation case from `part_lobby_view_ws_absence_merge_fix`).
     - (j) HTTP rows + WS event log including a `participant-left` followed by a `participant-joined` for the same `user_id` → the row is NOT filtered (the `latest`-map ends at `'joined'`).
     - (k) empty HTTP rows + WS occupants → WS occupants render.
     - (l) both empty → empty `SlotOccupants`.
3. **The moderator route's `InviteParticipants.tsx` no longer declares any of the seven lifted symbols.** Pinned by `grep -E 'SLOT_ROLES|SlotRole|SlotOccupant\b|SlotOccupants|ParticipantRow|function deriveSlotOccupants|function mergeSlots' apps/moderator/src/routes/InviteParticipants.tsx` returning zero declaration matches (only import-side references and call-site references survive).
4. **The participant route's `LobbyRoute.tsx` no longer declares any of the seven lifted symbols.** Same grep posture against the participant file.
5. **Both routes import the seven symbols from `@a-conversa/shell`.** Pinned by an import-line grep against each file.
6. **The moderator route's integration tests pass** — the existing route-level Vitest cases (the route mount + the slot-row rendering + the copy-affordance interactions) remain green with no edits beyond import path updates if any tests directly invoked the helpers.
7. **The participant route's integration tests pass** — same posture.
8. **The consolidated Vitest suite at `packages/shell/src/slots/slots.test.ts` is green** under `pnpm --filter @a-conversa/shell test`.
9. **The full repo build+test is green** — `make build` + `make test` succeed before commit.
10. **Cucumber + Playwright deferral posture** — no Cucumber scenario is added for this leaf (the lift doesn't change wire format, broadcast shape, or projector output observable at the system seam). No Playwright spec is added for this leaf (the lift doesn't add a user-visible behaviour; both routes' Playwright coverage at `part_lobby_view`'s milestone-closing scenario + the moderator's existing invite-view e2e — if any — exercises the merge composition end-to-end via the byte-identical lifted code). UI-stream e2e policy: this task is `shell_package.*`, not `moderator_ui.*` / `participant_ui.*` / `audience.*`; substrate-package tests are the right pin per the convention established by every prior `shell_package.*` refinement.
11. **No new follow-up WBS leaf is registered.** The lift closes the deferral chain originating from `part_lobby_view_ws_absence_merge_fix` §7 + `mod_invite_participants_rest_prefetch` §8 + `part_lobby_view` §6 fully. Decision §1 records why no `_v2` audit chain is set up.

## Decisions

### §1 Lift now, even though the named third-workspace trigger (audience) did not materialise in the expected shape

**Decision**: Land the lift now, in this leaf. Do NOT re-defer to a future audit leaf modeled after `extract_pending_axiom_mark_projector_v2`.

**Rationale**: The deferral language in the three predecessor refinements (`part_lobby_view_ws_absence_merge_fix` §7, `mod_invite_participants_rest_prefetch` §8, `part_lobby_view` §6) named the audience surface as the *expected* third caller — "audience view in M6", "audience adds a participant-list surface". The expectation rested on the assumption that the audience would land an HTTP-prefetch+WS-overlay slot-merge view structurally analogous to the moderator's invite view and the participant's lobby view.

That assumption is now falsified: the audience surface landed [`apps/audience/src/state/sessionRoster.ts`](../../../apps/audience/src/state/sessionRoster.ts) (per `aud_state_management` Decision §4) as a `userId → screenName` projector keyed by user_id (not role), consuming only the WS event log (no HTTP-prefetch overlay; the audience has no `/api/sessions/:id/participants` REST seam in scope). The audience is structurally NOT a third caller of `mergeSlots` / `deriveSlotOccupants` — it is a different abstraction for a different rendering need.

This is the exact pattern `extract_votes_by_facet_projector_v2` Decision §1 addresses: the "wait for a third workspace" half of the deferral policy was a hedge against ossifying the wrong API. The hedge is now demonstrably moot — the API has been pressure-tested by `part_lobby_view_ws_absence_merge_fix` (the three-arg shape was the *fix*, and it works), and the speculative third workspace has chosen a different abstraction. Holding the lift back indefinitely against a fourth speculative consumer that nobody has named would be permanent-duplication-by-pretext.

**Alternatives considered**:

- **Option B — re-defer until a real third caller surfaces.** Modeled after `extract_pending_axiom_mark_projector_v2`'s Option A (close-audit-without-lift, register `_v3`). Rejected because the precondition shapes differ. `extract_pending_axiom_mark_projector_v2` re-deferred because it had ONE caller by design AND methodology excluded additional callers (the pending-axiom-mark projector lives in the participant surface alone; the audience renders only committed marks). The present helpers have TWO callers with byte-identical bodies AND a falsified third-caller expectation, not one caller with methodology-excluded additional callers. Following the `_v2` Option A path would re-defer against no real consumer trigger; there is no `_v3` precondition language to write that would not be tautological ("defer until a third caller exists" — the prior deferral language already said that, and the audience surface has answered "I'm not it").
- **Option C — widen the API to subsume the audience's `sessionRoster.ts`.** Rejected as the wrong abstraction. The audience's projector returns a `ReadonlyMap<string, string>` (userId → screenName) for voter-attribution lookup; the slot-merge projector returns a `SlotOccupants` (role → `{userId, screenName}`) for slot-row rendering. Different inputs (audience has no HTTP-prefetch row source), different outputs, different consumer shapes. A single helper with an options-bag dispatcher choosing between the two output shapes would be a YAGNI generalisation hiding two unrelated needs behind a contrived shared surface. Decision §2 records this in more detail.
- **Option D — partial lift (just `deriveSlotOccupants`, defer `mergeSlots`).** Rejected. The two functions ship together at both call sites and consume the same type cluster; splitting them across a lifted helper and a per-workspace helper would leave the `ParticipantRow` / `SlotOccupants` types duplicated for no benefit. Atomic lift.

### §2 Do NOT widen the lifted helpers to subsume the audience's `sessionRoster.ts`

**Decision**: The audience's `sessionRoster.ts` stays at [`apps/audience/src/state/sessionRoster.ts`](../../../apps/audience/src/state/sessionRoster.ts) unchanged. It is NOT a fourth-caller candidate post-lift; it is a separate abstraction.

**Rationale**: The audience projector's output (`userId → screenName`) is structurally what the participant-detail-panel roster (`apps/participant/src/detail/participantRoster.ts`) produces and what voter-attribution lookups need. The slot-merge projector's output (`role → {userId, screenName}`) is structurally what the moderator invite view and participant lobby view need to render role-shaped slot rows. The two abstractions share the underlying event walk (both iterate `participant-joined` / `participant-left`) but their output shapes, consumer interfaces, and composition models (audience: WS-only; moderator+participant: HTTP-prefetch + WS-overlay merge) diverge.

If the audience and participant-detail roster projectors are themselves the convergent pair worth lifting, that is a *different* future leaf: it would consolidate `apps/audience/src/state/sessionRoster.ts` + `apps/participant/src/detail/participantRoster.ts` into a `packages/shell/src/roster/` or `packages/shell/src/participant-roster/` subsystem. That leaf is registered (or will be registered when both copies' bodies are confirmed byte-identical) by the participant-detail-panel work-stream; it is NOT this leaf's job to pre-emptively register it. The `aud_state_management` Decision §4 already named the participant-detail roster as the second caller of the roster pattern and reserved the third as the extraction trigger; the audience landed as the second; the third will surface (if at all) in the participant-detail-panel work-stream's future progression.

**Alternatives considered**:

- **Single canonical projector with a result-shape options bag.** Rejected as the wrong abstraction. A function returning `SlotOccupants | ReadonlyMap<string, string>` depending on a `mode: 'slot' | 'roster'` argument would have two unrelated bodies hidden behind a shared surface — the slot mode would carry the role-keyed iteration + stale-event defense (which checks `occupants[role]?.userId === event.payload.user_id`); the roster mode would carry the user_id-keyed `set`/`delete` (which the audience's `sessionRoster.ts` does in two lines). The shared surface adds no genuine code reuse and obscures the divergent consumer-side semantics.
- **Inheritance / shared private helper.** Rejected. There is no useful private helper between the two — the role-keyed slot reducer has a 2D check (`role` AND `user_id`), the user_id-keyed roster has a 1D check (`user_id` only). Trying to factor a shared inner loop produces strictly worse code than the two independent loops.

### §3 Barrel placement in `packages/shell/src/index.ts`: after `screen-name`, before `login-logout`

**Decision**: The new `// ─── slots ───` re-export block goes immediately after the `// ─── screen-name ───` block (line 26 in the current `index.ts`) and before `// ─── login / logout ───` (line 29). Alphabetical sibling-area ordering.

**Rationale**: The current `index.ts` is mostly load-order-driven (auth first, screen-name next as auth-flow continuation, then login/logout, then i18n bootstrap, then WS, then UI subsystems). `slots/` sits adjacent to `screen-name/` semantically: both deal with per-session participant identity at the cold-load boundary. The placement keeps related concerns visually adjacent. The alternative (placing at the end alongside `votes-by-facet`) would be alphabetical but split a semantically related group.

**Alternatives considered**:

- **At the end alongside `votes-by-facet`.** Rejected as visually disjoint from the related auth/identity blocks.
- **At the top of the file (before `auth`).** Rejected — the auth block must be first per `shell_substrate_extraction` convention.

### §4 `deriveSlotOccupants` body style: inline `event.payload.role` (participant style), not variable-extracted (moderator style)

**Decision**: The lifted `deriveSlotOccupants` body uses the inline form:

```ts
if (event.kind === 'participant-joined') {
  occupants[event.payload.role] = {
    userId: event.payload.user_id,
    screenName: event.payload.screen_name,
  };
  continue;
}
```

matching the participant copy at [`apps/participant/src/routes/LobbyRoute.tsx:157-165`](../../../apps/participant/src/routes/LobbyRoute.tsx#L157), not the moderator copy's variable-extracted form (`const role = event.payload.role; occupants[role] = …`) at [`apps/moderator/src/routes/InviteParticipants.tsx:145-150`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L145).

**Rationale**: Stylistic symmetry with the sibling field reads in the same block (`event.payload.user_id`, `event.payload.screen_name`). The variable-extraction form was added to the moderator copy as a typecheck assist when the discriminated-union narrowing was first explored; it is no longer load-bearing (the union narrows on `event.kind === 'participant-joined'` regardless). The inline form is one line shorter and reads more uniformly with the rest of the block.

**Alternatives considered**:

- **Keep the variable-extracted form (moderator style).** Rejected — adds a one-line local with no semantic benefit; breaks the symmetry of payload-field reads in the same expression.
- **Stable-key pattern `const { role, user_id, screen_name } = event.payload`.** Rejected — would still need a rename to `userId` / `screenName` (the local types use camelCase; the event payload uses snake_case per ADR 0021), so the destructure does not net out as cleaner.

### §5 Preserve the three-arg `mergeSlots` signature verbatim; no API widening

**Decision**: The lifted `mergeSlots` signature is exactly:

```ts
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
  events: readonly Event[],
): SlotOccupants
```

No options bag, no callback-shaped dispatcher, no pre-computed-`latest`-map second-form overload, no per-arg defaults.

**Rationale**: The three-arg shape is the recently-pressure-tested API (`part_lobby_view_ws_absence_merge_fix` was the bug fix that converged on it). It has been live in production-equivalent test coverage on both surfaces and passed the WS-absence-propagation regression. Widening the API on lift would re-expose the ossification risk the deferral policy was designed to avoid — except now the lift would ossify around a *speculative* widening rather than the empirically-proven shape.

**Alternatives considered**:

- **Options bag**: `mergeSlots({ httpRows, wsOccupants, events })`. Rejected — three positional args are clear, named, ordered (cold-load → live-overlay → event-log); the options-bag form would add boilerplate at every call site without improving readability.
- **Pre-computed `latest`-map second form**: `mergeSlotsWithLatest(httpRows, wsOccupants, latest)`. Rejected — would force callers to pre-compute the `latest` map, leaking the implementation detail of the WS-absence-propagation mechanism into the caller's code. The current shape's encapsulation of the `latest` walk inside the merge is exactly what makes the helper composable; breaking that encapsulation for marginal hypothetical memoisation gains would be premature optimisation.
- **Callback-shaped dispatcher**: `mergeSlots(httpRows, wsOccupants, events, isAbsent: (userId, events) => boolean)`. Rejected — same rejection as `extract_votes_by_facet_projector_v2` Decision §5: callbacks at API boundaries that have one true implementation are a YAGNI anti-pattern.

### §6 Vitest case organisation: union of predecessor suites, deduplicated by behaviour

**Decision**: The consolidated `packages/shell/src/slots/slots.test.ts` has exactly two top-level `describe` blocks: `describe('deriveSlotOccupants')` and `describe('mergeSlots')`. Each block enumerates the union of cases from the predecessor suites, deduplicated by behaviour pinned (not by which surface the test originally lived in). Seed-log fixture builders are stated once at the file scope.

**Rationale**: Two `describe` blocks (one per public function) is the convention every other shell-substrate subsystem follows (`packages/shell/src/votes-by-facet/votes-by-facet.test.ts`, `packages/shell/src/facet-status/facet-status.test.ts`, etc.). Deduplicating by behaviour rather than by source ensures the file does not carry redundant cases ("same behaviour pinned twice from two different fixtures"); the file ends at ~12 cases instead of ~20.

**Alternatives considered**:

- **Per-source `describe` nesting**: `describe('mergeSlots') > describe('moderator-originated') > …`. Rejected — the nested level adds no signal once the symbols are canonical; the source surface stops being a useful axis of organisation post-lift.
- **Cucumber over Vitest**: rejected — the lift does not cross a wire-protocol or projector-output boundary; the per-build-cadence convention (every prior `shell_package.*` leaf is Vitest-only) applies.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- Created `packages/shell/src/slots/slots.ts` — canonical `mergeSlots` + `deriveSlotOccupants` + `SLOT_ROLES`/`SlotRole`/`SlotOccupant`/`SlotOccupants`/`ParticipantRow` exports.
- Created `packages/shell/src/slots/index.ts` — subsystem barrel re-export.
- Created `packages/shell/src/slots/slots.test.ts` — consolidated Vitest suite with `describe('SLOT_ROLES')`, `describe('deriveSlotOccupants')` (cases a–f + rejoin-after-leave + all-three-slots), and `describe('mergeSlots')` (cases g–l + all-three-with-overlay + absence-then-different-user).
- Edited `packages/shell/src/index.ts` — added `// ─── slots ───` re-export block between `screen-name` and `login-logout` (Decision §3).
- Edited `apps/moderator/src/routes/InviteParticipants.tsx` — deleted the seven local symbols (`SLOT_ROLES`, `SlotRole`, `SlotOccupant`, `SlotOccupants`, `ParticipantRow`, `deriveSlotOccupants`, `mergeSlots`); imports from `@a-conversa/shell`.
- Edited `apps/participant/src/routes/LobbyRoute.tsx` — same: deleted local symbols, imports from `@a-conversa/shell`.
- Closes the deferral chain from `part_lobby_view_ws_absence_merge_fix` §7 + `mod_invite_participants_rest_prefetch` §8 + `part_lobby_view` §6. No follow-up WBS leaf registered (Acceptance §11).
- Verification: `pnpm run check` green; Vitest 264/264 scenarios green; Cucumber 264/264 green; Playwright green (driver-run, deterministic chain — iter-0042).
