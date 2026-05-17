# Backport the WS-absence-propagating `mergeSlots` fix to the participant lobby

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_session_join.part_lobby_view_ws_absence_merge_fix`
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `!participant_ui.part_session_join.part_lobby_view` (settled — commit `5932395`). Ships the participant pre-debate lobby at `/p/sessions/:id/lobby`. Module: [`apps/participant/src/routes/LobbyRoute.tsx`](../../../apps/participant/src/routes/LobbyRoute.tsx); tests: [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx). The merge composition is [`LobbyRoute.tsx:150-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L150-L163); it iterates HTTP rows first and overlays WS occupants — leaving the participant-left-against-prefetched-row case underivable (see "Why it needs to be done"). The slot reducer is [`LobbyRoute.tsx:116-138`](../../../apps/participant/src/routes/LobbyRoute.tsx#L116-L138); the `useMemo` derivation is at [`LobbyRoute.tsx:349-351`](../../../apps/participant/src/routes/LobbyRoute.tsx#L349-L351). The existing Vitest case (d) at [`LobbyRoute.test.tsx:294-313`](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L294-L313) does NOT exercise the bug (the default `defaultParticipantsOk` HTTP stub at [`LobbyRoute.test.tsx:120-147`](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L120-L147) seeds only the moderator + caller as debater-A, so the `participant-left(OTHER_DEBATER_USER_ID)` event in case (d) clears a slot whose HTTP prefetch never contained it).
- `!moderator_ui.mod_session_setup.mod_invite_participants_rest_prefetch` (settled — commit `7965806`). Ships the canonical fix-pattern. Module: [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx); the fixed `mergeSlots(httpRows, wsOccupants, events)` is at [`InviteParticipants.tsx:185-214`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185-L214); the corresponding case 9 Vitest probe is at [`InviteParticipants.test.tsx:1222-1259`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx#L1222-L1259). The Decision §6 narrative is at [`mod_invite_participants_rest_prefetch.md` lines 372-428](../moderator-ui/mod_invite_participants_rest_prefetch.md). The Status block at [`mod_invite_participants_rest_prefetch.md:478`](../moderator-ui/mod_invite_participants_rest_prefetch.md#L478) explicitly registered this leaf as the close-out and named the depended-upon fix-pattern.

## What this task is

A surgical port of the moderator's three-arg `mergeSlots(httpRows, wsOccupants, events)` shape — including the `latest`-signal-per-user-id pre-filter that drops HTTP rows whose latest WS event is `participant-left` — into the participant lobby's `LobbyRoute.tsx`. After this leaf:

- `mergeSlots` in [`LobbyRoute.tsx:150-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L150-L163) gains a third parameter `events: readonly Event[]`. Its body adopts the moderator's pattern: walk the events once to build `latest: Map<userId, 'joined' | 'left'>`; filter HTTP rows whose `latest.get(row.userId) === 'left'` out of the merged map; then overlay `wsOccupants` (WS-derived presence still wins on collision).
- The `useMemo` at [`LobbyRoute.tsx:351`](../../../apps/participant/src/routes/LobbyRoute.tsx#L351) updates to pass the events array as the third arg, with `events ?? []` matching the existing `deriveSlotOccupants` call's nil-coalesce (lines 349-350). The dependency list grows to `[httpRows, wsOccupants, events]`.
- A new Vitest case is appended to [`LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx) — mirrors the moderator's case 9 verbatim, adjusted for the participant test's `seedJoined`/`seedLeft` helpers and the participant's `stubFetch` HTTP-prefetch helper. The case is FAILING-FIRST: it must fail against the current `mergeSlots` (proving the bug), then pass after the fix.
- The existing case (d) is amended in a follow-up commit-internal change OR left as-is. Decision §3 settles which (left as-is — it exercises a complementary path: a WS-only debater-B who left, which the WS reducer's own `delete` handles correctly; the new case is the one that pins the prefetch-vs-WS-leave merge).

The deliverable is **edits to one component file + one test file**, no new modules, no new i18n keys, no new ADR. The fix replicates the moderator's pattern line-for-line — this is a known-good shape, not a novel composition.

**Out of scope** (intentionally not part of this leaf):

- Extracting `mergeSlots` + `deriveSlotOccupants` into `@a-conversa/shell`. The `part_lobby_view` refinement Decision §6 deferred this when there was only one caller; `mod_invite_participants_rest_prefetch` Decision §8 deferred it again when the moderator became the second. Now BOTH callers carry the fixed shape and the deferral can finally be closed — but doing the extraction in the same commit as the fix risks the fix landing differently in the extracted helper. Stays deferred; a future leaf (when a third caller surfaces, likely the audience view in M6) closes it.
- Touching the moderator route. The moderator already carries the fixed shape; this task only backports.
- Backend changes. The `participant-left` broadcast contract is already pinned at the Cucumber layer ([`tests/behavior/backend/participant-assignment.feature:80-93`](../../../tests/behavior/backend/participant-assignment.feature#L80-L93)); no protocol change.
- A Cucumber scenario. The WS-broadcast contract for `participant-left` is the backend's, and it's already pinned. The frontend merge bug is a client-side observation bug, not a protocol seam. See Decision §4.
- A second Playwright e2e for the cross-context "ben sees maria leave" path. Decision §5 settles: the existing `tests/e2e/participant-lobby.spec.ts` two-context scenario covers the cross-context arrive path; the leave path is symmetric and the Vitest case pins the observable contract (HTTP-prefetched row + `participant-left` event → slot empty) at the merge layer.
- A `?since=<seq>` filter on `GET /api/sessions/:id/participants`. Out of scope; would mask the bug rather than fix it.
- Refactoring the slot reducer at [`LobbyRoute.tsx:116-138`](../../../apps/participant/src/routes/LobbyRoute.tsx#L116-L138). The reducer is correct as shipped — it tracks the WS-derived presence map via the `delete occupants[role]` semantic on `participant-left`. The bug is the merge composition's blindness to that deletion; the reducer doesn't need changes.

## Why it needs to be done

State the bug crisply.

**Misbehavior**: when the participant lobby's HTTP prefetch resolves with a debater row present and a subsequent `participant-left` event for that same debater arrives via WS (e.g. the moderator removes the debater, or the debater leaves, while the caller is in the lobby), the caller's slot map continues to show the departed debater in their old slot. The departed-debater row is "alive" forever in the merged view — only on a hard reload (which re-fetches the participants list and gets the now-`leftAt`-stamped row, which the active-row filter drops) does the slot return to empty.

**Expected behavior**: the slot map should reflect the WS-derived departure — the slot returns to the empty state within one React render of the `participant-left` event arriving, the "waiting for the other debater" hint reappears, and the `lobby-both-debaters-present` banner clears.

**Where in the code**: [`apps/participant/src/routes/LobbyRoute.tsx:150-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L150-L163) — the participant lobby's `mergeSlots(httpRows, wsOccupants)`. The merge iterates HTTP rows first then overlays WS occupants; the WS reducer at lines 129-135 deletes the slot on `participant-left`, so the overlay loop's `if (wsSlot !== undefined) merged[role] = wsSlot` clause never re-adds the deletion. The HTTP row wins because the WS map has no entry for that role — the deletion is invisible to the merge.

The bug was first surfaced and confirmed in the Status block of [`tasks/refinements/moderator-ui/mod_invite_participants_rest_prefetch.md:478`](../moderator-ui/mod_invite_participants_rest_prefetch.md#L478): "Confirmed participant-side latent bug: `apps/participant/src/routes/LobbyRoute.tsx:150-163` carries the same `mergeSlots` issue this task fixed — a WS `participant-left` does NOT override an HTTP-prefetched row containing the leaver." The participant's existing Vitest case (d) at [`LobbyRoute.test.tsx:294-313`](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L294-L313) passes today because its HTTP-prefetch stub seeds only the moderator + caller (debater-A) — the departing debater (`OTHER_DEBATER_USER_ID` filling debater-B) was added via WS seed `seedJoined(3, 'debater-B', ...)`, so the subsequent `seedLeft(4, OTHER_DEBATER_USER_ID)` clears the WS slot, and the merge correctly reports debater-B empty (the HTTP prefetch never had debater-B). Case (d) is structurally valid but does NOT cover the prefetch-vs-WS-leave race that this task addresses.

Why it matters for M5: the lobby is the entry point for participants joining a session — the first surface a debater stays on after claiming. A debater whose partner is removed (or leaves) sees a permanently-stuck slot, with the "ready" affordances downstream (when `mod_session_lobby`'s "both ready" banner eventually drives a start-debate trigger from the participant side) reading from this same `slots` derivation. A stuck slot is the kind of silent data-skew that is invisible in dev (the lobby usually renders correctly after one round of events) but fires the first time a real debater leave-and-rejoin sequence happens in production.

## Inputs / context

### The bug surface — the participant lobby's `mergeSlots`

From [`apps/participant/src/routes/LobbyRoute.tsx:150-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L150-L163) (the published, buggy shape):

```ts
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
): SlotOccupants {
  const merged: SlotOccupants = {};
  for (const row of httpRows) {
    merged[row.role] = { userId: row.userId, screenName: row.screenName };
  }
  for (const role of SLOT_ROLES) {
    const wsSlot = wsOccupants[role];
    if (wsSlot !== undefined) merged[role] = wsSlot;
  }
  return merged;
}
```

### The canonical fix — the moderator's `mergeSlots`

From [`apps/moderator/src/routes/InviteParticipants.tsx:185-214`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185-L214) (the moderator's fixed shape — `mod_invite_participants_rest_prefetch` Decision §6):

```ts
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
  events: readonly Event[],
): SlotOccupants {
  const latest = new Map<string, 'joined' | 'left'>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      latest.set(event.payload.user_id, 'joined');
    } else if (event.kind === 'participant-left') {
      latest.set(event.payload.user_id, 'left');
    }
  }
  const merged: SlotOccupants = {};
  for (const row of httpRows) {
    if (latest.get(row.userId) === 'left') continue;
    merged[row.role] = { userId: row.userId, screenName: row.screenName };
  }
  for (const role of SLOT_ROLES) {
    const wsSlot = wsOccupants[role];
    if (wsSlot !== undefined) merged[role] = wsSlot;
  }
  return merged;
}
```

The fix has three properties that matter:

1. **`latest`-signal-per-user-id**, not a flat "ever left" set. A user who joined → left → rejoined has `latest` value `'joined'` (the latest event wins); their HTTP row is NOT filtered. This handles the rejoin case correctly without an extra pass.
2. **HTTP row drop is by `userId`, not by `role`**. The HTTP row carries `userId`; the WS `participant-left` payload carries `user_id`. The role on the HTTP row may differ from the role on a future re-join (a host removes the debater and a different user claims the slot), but the per-userId match handles the "this person left" semantic the WS event encodes.
3. **WS overlay still wins on collision** (last loop unchanged). A WS-derived presence event (`participant-joined`) for the same role overrides the HTTP row even if the userId differs — the seam where the merge prefers the WS event because it is more recent than the HTTP snapshot.

### The `useMemo` call site

From [`apps/participant/src/routes/LobbyRoute.tsx:349-351`](../../../apps/participant/src/routes/LobbyRoute.tsx#L349-L351):

```ts
const events = useWsStore((state) => state.sessionState[id]?.events);
const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
const slots = useMemo(() => mergeSlots(httpRows, wsOccupants), [httpRows, wsOccupants]);
```

After the fix:

```ts
const events = useWsStore((state) => state.sessionState[id]?.events);
const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
const slots = useMemo(
  () => mergeSlots(httpRows, wsOccupants, events ?? []),
  [httpRows, wsOccupants, events],
);
```

Same nil-coalesce posture (`events ?? []`) the existing `deriveSlotOccupants` call uses; same `useMemo` dependency-array discipline.

### The test seam — participant lobby Vitest helpers

From [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx):

- The `stubFetch(handlers)` helper at [lines 86-104](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L86-L104) accepts per-route overrides for `header` and `participants` builders. The new case uses a per-test stub that returns both debater rows from the participants endpoint (overriding `defaultParticipantsOk` at lines 120-147 which only includes moderator + caller-debater-A).
- `seedJoined(sequence, role, userId, screenName)` at [lines 173-195](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L173-L195) seeds a `participant-joined` event through the same `applyEvent` reducer the WS dispatch would invoke.
- `seedLeft(sequence, userId)` at [lines 197-212](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L197-L212) seeds a `participant-left` event.
- `renderRoute(opts)` at [lines 149-166](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L149-L166) mounts the route under `MemoryRouter` with the `:id` param bound to `SESSION_ID`.
- `useWsStore.getState().reset()` in the `afterEach` at line 84 keeps cases isolated.

The new case mirrors moderator's case 9 (per [`InviteParticipants.test.tsx:1222-1259`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx#L1222-L1259)) verbatim, adjusted for the participant's helpers and testids (`lobby-participant-debater-A` rather than the moderator's `invite-slot-occupant[data-role="debater-A"]`).

### ADR pins

- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The new Vitest case IS the empirical verification of the fix; it must FAIL against the current `mergeSlots` (proving the bug) and PASS after the third-arg-with-`latest`-filter fix (proving the fix). Per ADR 0022, this is the bug-pinning test that stays in the suite forever.
- [ADR 0021 — event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). The merge's `latest`-map walk switches on `event.kind === 'participant-joined' | 'participant-left'` and reads `event.payload.user_id` from both shapes (per `participantJoinedPayloadSchema` and `participantLeftPayloadSchema` at [`packages/shared-types/src/events.ts:202-220`](../../../packages/shared-types/src/events.ts#L202-L220)). Both payloads carry `user_id` — the merge's per-userId filter is type-safe against the discriminated union.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md). No substrate change — the fix lives inline in the participant route per Decision §2.

### Why a Cucumber scenario is NOT scoped

Per the "Behavior + e2e coverage growth" section added to [`ORCHESTRATOR.md`](../../../ORCHESTRATOR.md) on commit `41e39e8`: "Backend / WS / projector / methodology-engine tasks: prefer Cucumber when the contract is observable at the protocol or replay layer." This task is a **UI-stream task** (`participant_ui.*`), and the bug is purely in client-side merge composition — the WS broadcast contract for `participant-left` is already pinned at the backend Cucumber layer (per [`tests/behavior/backend/participant-assignment.feature:80-93`](../../../tests/behavior/backend/participant-assignment.feature#L80-L93) "Host removes a debater — left_at flips and a participant-left event lands"). The broadcast wire shape is correct; the bug is that the participant lobby's React hook ignores the broadcast when it conflicts with an earlier HTTP snapshot. Cucumber against the protocol layer would re-prove the broadcast shape already pinned; the right pin is Vitest at the hook-state layer + Playwright if the bug is also observable in rendered DOM cross-context.

## Constraints / requirements

### Route + wiring

- No new route. The `/p/sessions/:id/lobby` route stays as `part_lobby_view` left it.
- No change to [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx). The route table is untouched.
- No change to [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx) or to the WS substrate.
- No change to the existing slot reducer at [`LobbyRoute.tsx:116-138`](../../../apps/participant/src/routes/LobbyRoute.tsx#L116-L138). The reducer's `delete occupants[role]` semantic is correct; the fix lives at the merge layer.

### Component changes (`apps/participant/src/routes/LobbyRoute.tsx`)

#### Update `mergeSlots` to the three-arg shape

Replace the existing `function mergeSlots(httpRows, wsOccupants): SlotOccupants` at lines 150-163 with the three-arg fixed shape from the moderator's `InviteParticipants.tsx:185-214`. The body adopts the moderator's `latest`-map pattern verbatim:

- Walk `events` once, building `latest: Map<string, 'joined' | 'left'>` keyed by `event.payload.user_id`. The later events overwrite earlier ones, so the map ends with the latest signal per user.
- Filter the HTTP-row loop: `if (latest.get(row.userId) === 'left') continue;` before assigning the row to `merged[row.role]`.
- Keep the WS overlay loop unchanged (last loop in the moderator's pattern).

Update the docblock to reference the moderator's fix as the canonical pattern, and reference this task's refinement + Decision §1 as the divergence-justification. Drop the now-stale claim that this implementation diverges by-omission from the moderator (the participant lobby now matches).

#### Update the `useMemo` call site

At [`LobbyRoute.tsx:351`](../../../apps/participant/src/routes/LobbyRoute.tsx#L351):

```ts
// Before:
const slots = useMemo(() => mergeSlots(httpRows, wsOccupants), [httpRows, wsOccupants]);

// After:
const slots = useMemo(
  () => mergeSlots(httpRows, wsOccupants, events ?? []),
  [httpRows, wsOccupants, events],
);
```

The third arg `events ?? []` matches the nil-coalesce on the existing `deriveSlotOccupants(events ?? [])` call (line 350). The `useMemo` dependency-array grows to three entries.

### Test changes (`apps/participant/src/routes/LobbyRoute.test.tsx`)

#### Add a new Vitest case (FAILING-FIRST)

Append a new `describe` block — `'LobbyRoute — HTTP-prefetched debater leaves via WS'` — with one `it` case named `(k) participant-left event removes a debater slot that was filled by the HTTP prefetch`. The case mirrors moderator's case 9 verbatim, adjusted for the participant test's helpers:

1. Stub fetch so the participants endpoint returns BOTH debaters as active (override `defaultParticipantsOk`). Use the existing `stubFetch({ participants: () => ... })` shape; the per-test stub returns the moderator row, the caller row (debater-A), AND a second debater (debater-B, `OTHER_DEBATER_USER_ID`) — all with `leftAt: null`.
2. Render the route.
3. Wait for `lobby-participant-debater-B` to appear (the HTTP prefetch landed both debaters; the merged slot map should render both rows even before any WS event arrives).
4. Seed `seedLeft(1, OTHER_DEBATER_USER_ID)` — the other debater leaves via WS.
5. Wait for `lobby-participant-debater-B` to DISAPPEAR (the fix-pattern's `latest`-filter drops the prefetched debater-B row).
6. Assert the `lobby-waiting-for-debater` hint reappears with "Debater B" in its text.
7. Assert `lobby-both-debaters-present` has count 0.
8. Assert `lobby-participant-debater-A` is still present (only B left).

The case must FAIL against the current `mergeSlots` (which would keep the prefetched debater-B alive forever — `lobby-participant-debater-B` would NOT disappear, the waitFor would time out). It must PASS after the three-arg fix.

Per ADR 0022, the case stays in the suite as the permanent pin against future regressions on this seam.

#### No amendment to case (d)

The existing case (d) at [lines 294-313](../../../apps/participant/src/routes/LobbyRoute.test.tsx#L294-L313) stays unchanged. It covers a complementary path (a WS-only debater-B who left, exercising the WS reducer's own `delete` correctly through the unchanged WS-overlay loop) and is structurally valid. The new case is additive, not a replacement; together they pin both the WS-reducer-clear path AND the HTTP-prefetch-filter path.

Decision §3 settled this; the case (d) → new-case rename consideration was rejected as it would lose the WS-only-clear pin.

### State + perf

- The merge gains one event-array walk per render where `slots` re-derives. Cheap — the events array is bounded by the session lifetime (a few dozen events for the lobby's surface) and the walk is O(events). Same cost the moderator's adopted merge pays.
- The `useMemo` dependency grows to three entries; `events` is the same Zustand selector output the existing `wsOccupants` `useMemo` already depends on transitively (since `wsOccupants` is derived from `events`). Adding `events` directly to the `slots` deps doesn't add a new re-derive trigger — when `events` changes, `wsOccupants` changes too, and the merge would re-derive either way. The explicit dep is hygiene (the linter's exhaustive-deps rule will flag the omission).
- No new state slots, no new effects, no new fetches.

### Files this task touches (the explicit allowlist)

- `apps/participant/src/routes/LobbyRoute.tsx` (modified — `mergeSlots` signature widened to `(httpRows, wsOccupants, events)`, body adopts the moderator's `latest`-map filter, docblock updated; the `useMemo` call site at line 351 updated to pass `events ?? []` and grow its deps).
- `apps/participant/src/routes/LobbyRoute.test.tsx` (modified — one new `describe`/`it` block appended, no edits to existing cases).

### Files this task does NOT touch

- `.tji` files — the WBS `complete 100` marker lands at task-completion time, not at refinement-write time.
- `docs/adr/` — no new ADR (see Decision §6).
- `apps/server/**` — backend is unchanged; the WS broadcast contract is correct and already pinned.
- `apps/moderator/**` — the moderator already carries the fixed shape.
- `apps/participant/src/App.tsx`, `apps/participant/src/main.tsx`, `apps/participant/src/ws/**` — no route, mount, or WS-substrate change.
- `apps/participant/src/routes/InviteAcceptanceRoute.tsx` and its tests — the invite route does not derive slots.
- `packages/i18n-catalogs/**` — no new i18n keys (no new copy; the same `lobby-waiting-for-debater` hint reappears when the slot returns to empty, no new affordance).
- `packages/shared-types/**` — the `Event` type + the `participant-joined` / `participant-left` payload schemas are unchanged.
- `tests/e2e/**` — see Decision §5; no Playwright addition.
- `tests/behavior/**` — see Decision §4; no Cucumber addition.

### a11y requirements

- The fix changes only the conditions under which existing slot rows render — the rendered DOM, ARIA attributes, and focus behavior are unchanged. The `lobby-participant-*` testids' presence/absence is the only behavior change.
- The "waiting for the other debater" hint at [`LobbyRoute.tsx:481-491`](../../../apps/participant/src/routes/LobbyRoute.tsx#L481-L491) reappears when the slot returns to empty — same text, same testid, same DOM placement as the WS-only clear case (d) already exercises.

### Test layers per ADR 0022

#### Vitest (in `apps/participant/src/routes/LobbyRoute.test.tsx` — append)

One new case (per the spec under "Test changes" above). The case is FAILING-FIRST; the implementation must make it pass.

**Suite delta**: `LobbyRoute` suite gains one case (existing 10 cases (a)-(j) → 11 with the new (k)). Vitest repo baseline TBD by the Implementer (run `pnpm run test:smoke` before to capture, then after to confirm +1).

#### Cucumber (deferred — see Decision §4)

No new Cucumber scenario. The `participant-left` WS broadcast contract is already pinned at [`tests/behavior/backend/participant-assignment.feature:80-93`](../../../tests/behavior/backend/participant-assignment.feature#L80-L93); the bug is purely a client-side merge composition issue, not a wire-format or replay-boundary issue.

#### Playwright (deferred — see Decision §5)

No new Playwright scenario. The existing two-context `tests/e2e/participant-lobby.spec.ts` scenario already covers the cross-context arrive path via REAL WS events; the leave path is symmetric and the Vitest case pins the observable contract at the hook-state layer where the bug actually lives. Adding a cross-context "ben sees maria leave" e2e would cost another OIDC dance + a `DELETE /api/sessions/:id/participants/:userId` round-trip for a behavior structurally pinned at the merge layer.

The lobby IS reachable via `/p/sessions/:id/lobby` (commit `5932395`) and the bug IS observable in rendered DOM in principle — but the existing Vitest case 9 pattern (moderator side, [`InviteParticipants.test.tsx:1222-1259`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx#L1222-L1259)) is the same shape this task uses, and that pattern was accepted as sufficient for the moderator's bug-fix without an additional Playwright pin. Same posture here.

### Budget honesty (0.25d)

The 0.25d budget breaks down roughly:

- ~5 min: copy the moderator's `mergeSlots` body into the participant's `LobbyRoute.tsx`, widen the signature, update the docblock. ~25 LOC delta (the merge body grows by ~10 lines for the `latest`-map walk; the docblock grows by ~5 lines).
- ~3 min: update the `useMemo` call site at line 351 to pass the third arg + grow its deps.
- ~10 min: write the new Vitest case mirroring moderator's case 9 (~40 LOC). Mostly mechanical — the per-test fetch stub returns both debaters; seed a `participant-left`; assert the slot disappears.
- ~5 min: run the failing-first cycle — Vitest before the fix (confirm the new case fails for the right reason), Vitest after the fix (confirm it passes), full `pnpm run check` + `pnpm run test:smoke` green.
- ~5 min: WBS-status ritual + the commit.

Risk surface is **minimal**:

- The fix-pattern is published, proven, and tested at the moderator side (case 9 passes against the same merge body).
- The merge's signature widening is a TypeScript-level change that the compiler catches at the single call site.
- The new Vitest case is mechanical — the participant test's helpers are the right shape; only the per-test fetch stub differs from the existing cases.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dependencies.
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the modified files in place.
3. **`pnpm run test:smoke` (Vitest) green** — the new case (k) in `LobbyRoute.test.tsx` passes after the fix. Vitest count: `LobbyRoute` suite grows by exactly one case (10 → 11); repo total grows by one.
4. **Failing-first verification** — the Implementer runs the new Vitest case AGAINST THE CURRENT `mergeSlots` (the buggy two-arg shape) and confirms it FAILS (the test would expect `lobby-participant-debater-B` to disappear after the WS leave but would observe it staying), then applies the fix and confirms it PASSES. Both observations are reported in the Implementer's summary so the Closer's Status block can cite the failing-first run.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — unchanged (no new i18n keys).
6. **`pnpm -F @a-conversa/participant build`** produces `apps/participant/dist/` artifacts without new bundle warnings.
7. **`pnpm run test:e2e`** under `make up` runs the existing participant-lobby spec at `tests/e2e/participant-lobby.spec.ts` green (no e2e change in this task; the existing scenarios stay green).
8. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `part_lobby_view_ws_absence_merge_fix`.
9. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
10. **The `mergeSlots` shape matches the moderator's** — the participant's `mergeSlots` body is a line-for-line port of [`InviteParticipants.tsx:185-214`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L185-L214) (signature, `latest`-map walk, HTTP-row filter, WS overlay).
11. **No regression on the existing 10 Vitest cases** — cases (a) through (j) at `LobbyRoute.test.tsx` continue to pass. In particular case (d) (the WS-only debater-B clear) stays valid because the WS overlay loop is unchanged.
12. **No regression on `participant-lobby.spec.ts`** — both scenarios (single-debater happy path + two-debater cross-context arrive) stay green.
13. **No regression on `participant-invite-acceptance.spec.ts`** — the post-claim navigation to the lobby continues to work.
14. **The fix is observable**: a debater whose other debater leaves via `participant-left` after the HTTP prefetch landed sees their slot return to empty within one React render. Pinned by Vitest case (k).

## Decisions

### 1. Port the moderator's three-arg `mergeSlots` line-for-line (NOT a per-userId set extracted helper)

Three alternatives surveyed:

- **(A) Refactor the participant `deriveSlotOccupants` reducer to ALSO track "departed user ids"** — would extend the reducer's return shape from `SlotOccupants` to `{ occupants, absentUserIds }` and have the merge consume the absent set. Rejected: would couple the reducer to the merge's needs; the reducer's current contract is clean (it's a presence map), and the moderator's pattern keeps the reducer untouched. Extending the reducer would also break parity with the moderator (where the reducer stayed unchanged).
- **(B) Extract a shared helper `latestSignalPerUser(events): Map<string, 'joined' | 'left'>` into `@a-conversa/shell`** — would unify the moderator's and participant's `latest`-map walks. Rejected for this task: the merge body is ~10 LOC, the duplication is small, and `mod_invite_participants_rest_prefetch` Decision §8 explicitly deferred the `mergeSlots` + `deriveSlotOccupants` extraction. Adopting the shared helper in this task would force the moderator to be updated in the same commit (otherwise the helper has only one caller), which violates one-leaf-one-commit. Stays inline.
- **(C) Port the moderator's three-arg shape verbatim** (chosen). The merge body is small, the pattern is published, the failing-first Vitest case is mechanical, and the divergence between the moderator and participant (which `mod_invite_participants_rest_prefetch` Decision §6 documented as a deliberate fix-on-the-moderator-side) collapses into convergence. Both surfaces now carry the SAME merge shape; if a future leaf extracts the merge into the shell substrate, both call sites have the same signature to lift.

The chosen approach pays down the registered tech debt with minimum surface area; the convergence is the precondition for the future extraction.

### 2. The fix lives inline in `LobbyRoute.tsx`, NOT in the slot reducer

Two alternatives surveyed:

- **(A) Push the WS-derived-absence semantic INTO `deriveSlotOccupants`** — would have the reducer's output include the per-userId "departed" state and have the merge consume it. Rejected: the reducer's current contract — "the per-role presence map from the events" — is correct and matches the moderator's pattern; the bug is in the merge composition, not the reducer. Pushing the fix into the reducer would couple two concerns (the WS-derived presence map AND the cross-source merge) into one helper.
- **(B) Keep the reducer unchanged; fix the merge** (chosen). The merge is the composition layer; the bug is at the composition layer. The merge gains the event-log walk for the `latest` map (cheap, bounded) and the HTTP-row filter; the reducer stays as-is.

### 3. Leave case (d) unchanged; the new case is additive

Two alternatives surveyed:

- **(A) Replace case (d) with the new combined case** — would merge "WS-only clear" and "HTTP-prefetched clear" into one. Rejected: case (d) exercises a complementary path (the WS reducer's own `delete` against a slot the WS reducer also filled) that the unchanged WS-overlay loop drives. Removing case (d) would lose the pin against a regression in the reducer's `delete` semantic.
- **(B) Keep case (d); add a new case (k) for the HTTP-prefetch path** (chosen). The two cases pin two different code paths (the WS reducer's clear behavior AND the merge's HTTP-row filter). The total Vitest delta is +1 case.

### 4. No Cucumber scenario added

Per the new "Behavior + e2e coverage growth — don't lose sight of it" section of [`ORCHESTRATOR.md`](../../../ORCHESTRATOR.md) (commit `41e39e8`): the right pin for backend / WS / projector tasks crossing the protocol or replay boundary is Cucumber. This task is a **UI-stream task** and the bug is purely client-side merge composition. The `participant-left` WS broadcast contract is already pinned at [`tests/behavior/backend/participant-assignment.feature:80-93`](../../../tests/behavior/backend/participant-assignment.feature#L80-L93) — a Cucumber scenario here would re-prove the broadcast wire shape (which IS correct) rather than the client-side merge (which is the actual bug). The bug never crosses the protocol seam.

If a future regression in the broadcast itself surfaced (e.g. the server stopped emitting `participant-left` after a removal), the backend Cucumber would catch it. The participant lobby's symptom (a stuck slot) would also surface — but the root cause would be backend, not the merge. The right pin for the current bug is at the merge layer.

### 5. No Playwright scenario added

Two alternatives surveyed:

- **(A) Add a three-context Playwright scenario** — alice creates a session, ben + maria claim, alice removes maria, ben's lobby observes maria's slot returning to empty. Would faithfully exercise the cross-context observable behavior. Cost: a fourth OIDC dance (alice's, plus ben's, plus maria's, plus a `DELETE /api/sessions/:id/participants/:userId` round-trip from alice's context). The host-only DELETE is gated by `app.authenticate` + `requireSessionHost`; alice's first context has the cookie.
- **(B) Defer the Playwright scenario** (chosen). The bug lives in a single React hook (`mergeSlots`); the observable contract (`lobby-participant-debater-B` disappears within one render of the WS event) is pinned at the Vitest layer with the same fidelity. The moderator's adopted-from-the-same-fix Vitest case 9 was accepted as sufficient without an additional Playwright pin; same posture here. The existing `tests/e2e/participant-lobby.spec.ts` two-context scenario covers the cross-context arrive path via REAL WS events, proving the WS-driven slot derivation chain end-to-end; the leave path is symmetric and the deltas are at the merge layer.

The deferral is intentional + reversible. If a future regression surfaces where the cross-context leave path breaks in a way the Vitest case doesn't catch, the future leaf landing the e2e scenario inherits the deferred-debt note. No tech-debt registration is needed today — no follow-up leaf is identified; the deferral is "we don't currently see a coverage gap."

### 6. No new ADR

Every decision here is either a direct application of an existing convention (port the moderator's fix-pattern), a scoped UI policy that doesn't constrain other tasks (test layout, no Cucumber, no Playwright), or a re-affirmation of an earlier ADR (ADR 0022's "every empirical verification is a committed test" — the new Vitest case IS the verification; ADR 0021's discriminated-union envelope — the merge's payload reads are type-safe). No new architectural choice is introduced.

### 7. The shell-extraction follow-up stays deferred

Both `part_lobby_view` Decision §6 and `mod_invite_participants_rest_prefetch` Decision §8 deferred the extraction of `mergeSlots` + `deriveSlotOccupants` into `@a-conversa/shell` until a third caller surfaces. After this leaf, both existing callers carry the SAME `mergeSlots` shape — the convergence precondition for the extraction is met, but the third-caller precondition is not. The audience view (M6) will likely be the third caller; that future leaf can lift both copies into the shell substrate at extraction time. This task does NOT extract; it converges.

If the audience-side leaf surfaces with a different merge shape (e.g. observers don't see HTTP rows at all), the extraction's scope changes — but that's the future leaf's concern.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Ported the moderator's three-arg `mergeSlots(httpRows, wsOccupants, events)` line-for-line into [`apps/participant/src/routes/LobbyRoute.tsx`](../../../apps/participant/src/routes/LobbyRoute.tsx) (signature widened, body adopts the `latest`-signal-per-userId map walk + HTTP-row drop filter, WS overlay loop unchanged). The docblock now points at the moderator's `InviteParticipants.tsx:185-214` as the canonical pattern and cites Decision §1 + the convergence-precondition rationale.
- The `useMemo` call site updated to pass `events ?? []` as the third arg and grow its dependency array to `[httpRows, wsOccupants, events]` — matching the nil-coalesce posture the sibling `deriveSlotOccupants(events ?? [])` call already uses.
- Appended a new `describe`/`it` block to [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx) — case `(k) participant-left event removes a debater slot that was filled by the HTTP prefetch`, mirroring moderator's case 9 verbatim with a per-test fetch stub returning both debater rows from the participants endpoint.
- **Failing-first verification** confirmed against current HEAD: the new case fails against the pre-fix two-arg `mergeSlots` (the HTTP-prefetched debater-B stays alive forever) and passes after the three-arg fix lands. Both observations captured in the Implementer's return summary.
- Vitest delta: 3744 (post-rebase baseline) → 3745 (+1 — the new case 11 in the `LobbyRoute` suite). `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/participant build` all green.
- Cucumber + Playwright unchanged per Decision §4 + §5 (the bug is purely a client-side merge composition issue; the `participant-left` WS broadcast contract is already pinned at `tests/behavior/backend/participant-assignment.feature:80-93`).
- Convergence precondition for the deferred `@a-conversa/shell` extraction of `mergeSlots` + `deriveSlotOccupants` is met (moderator + participant now carry the identical 3-arg shape); a new shell-extraction leaf is registered under `shell_package` with dependencies on the M6 audience-view tasks that will become the third caller.
- One follow-up surfaced during e2e regression check: the pre-existing `loginAs()` screen-name capitalization bug ("alice" vs "Alice") in `tests/e2e/fixtures/auth.ts` re-fired on `tests/e2e/participant-lobby.spec.ts`. Confirmed unrelated to this change (same 2 tests fail on pristine HEAD); the existing `backend_hardening.data_hygiene.e2e_login_as_case_insensitive` leaf's note was amended with a second source-of-debt citation rather than registering a duplicate.
