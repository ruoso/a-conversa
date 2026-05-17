# Dedicated `session-mode-changed` wire event for the lobby → operate transition

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_session_start_handoff_dedicated_event` (block at lines 101-108). Registered as tech-debt in commit `ec395ce`, which closed `participant_ui.part_graph_view.part_session_start_handoff` (the predecessor 0.5d leaf that landed the first-content-event heuristic).

**Effort estimate**: 2d — backend-heavy. The deliverable spans a new `EventKind` + payload schema in `@a-conversa/shared-types`, a forward-only SQL `CHECK`-constraint widening migration, a moderator-originating HTTP endpoint (POST `/api/sessions/:id/start`) wired into `handleEnterSession`, an `appendSessionEvent`-driven event emission + post-commit WS broadcast, a Cucumber wire-path pin against pglite, a Vitest unit pin on the new endpoint handler, a participant-side `useEffect` swap inside `<LobbyRouteAuthenticatedBody>`, the existing Playwright spec amended to seed the new event kind, and a new ADR for the protocol addition. The predecessor's 0.5d heuristic ships intact as a defense-in-depth fallback (Decision §7), so most of the touched-files surface is additive rather than rewrite.

## Inherited dependencies

**Settled:**

- `participant_ui.part_graph_view.part_session_start_handoff` (done — commit `ec395ce`, 2026-05-17). The predecessor heuristic. Ships a participant-side `useEffect` inside `<LobbyRouteAuthenticatedBody>` at [`apps/participant/src/routes/LobbyRoute.tsx:417-456`](../../../apps/participant/src/routes/LobbyRoute.tsx#L417-L456) that watches the per-session WS `events` slice for the first event whose `kind` is in the `CONTENT_EVENT_KINDS` tuple (`node-created`, `edge-created`, `entity-included`, `proposal`, `commit`) and auto-navigates the debater to `/p/sessions/${id}`. **Load-bearing finding for this task**: the heuristic is the surface this leaf extends — the auto-navigation `useEffect` grows a second trigger predicate (the new `session-mode-changed` event kind) and the existing five-kind content trigger is retained as a fallback per Decision §7. The refinement at [`tasks/refinements/participant-ui/part_session_start_handoff.md`](part_session_start_handoff.md) (specifically Decisions §1 + §4) is the source-of-debt for THIS task.
- `moderator_ui.mod_session_setup.mod_session_lobby` (done — commit `8e3...` per its Status block dated 2026-05-16). Ships the moderator's strict-gated "Enter session" button + `handleEnterSession` callback at [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526). **Load-bearing**: `handleEnterSession` is the trigger point this leaf grows from a pure client-side `navigate(...)` into a `navigate(...)` preceded by a server call that emits the new event. The strict gate (`bothDebatersPresent`) stays as-is; this leaf does NOT relax it. The handler's defense-in-depth `if (!bothDebatersPresent) return` early-out is preserved.
- `backend.websocket_protocol.ws_event_broadcast` (done — `app.wsBroadcast.emit({ event })` is the canonical post-commit broadcast surface; the new server-side endpoint emits one envelope through it, mirroring `end-session`'s pattern at [`apps/server/src/sessions/routes.ts:1925-1927`](../../../apps/server/src/sessions/routes.ts#L1925-L1927)).
- `backend.websocket_protocol.ws_subscribe_to_session` (done — the participant lobby's `client.trackSession(id)` lifecycle at [`apps/participant/src/routes/LobbyRoute.tsx:207-213`](../../../apps/participant/src/routes/LobbyRoute.tsx#L207-L213) means the new event lands in the per-session events slice through the same subscription path content events already use; no second subscription needed).
- `data_and_methodology.schema.session_events_table` (done — `apps/server/migrations/0010_session_events.sql` is the table this leaf widens the `kind` CHECK constraint of; the precedent for the widening pattern is `apps/server/migrations/0012_session_events_entity_removed.sql` per ADR 0027).
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) (the canonical envelope shape this leaf's payload conforms to — `{ id, sessionId, sequence, kind, actor, payload, createdAt }`; schema-on-write via `validateEvent` before `appendSessionEvent`).
- [ADR 0020 — Postgres write-path locking and event ordering](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) (FOR UPDATE row lock + MAX(sequence)+1 inside the transaction; same pattern as `end-session` / `commit` / `propose`).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) (every behavioural assertion below is a committed Vitest case, Cucumber scenario, or Playwright assertion).
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) (the precedent for "add a new event kind in lockstep with a SQL CHECK migration"; same shape this leaf follows for `session-mode-changed`).
- [ADR 0023 — Web framework Fastify](../../../docs/adr/0023-web-framework-fastify.md) (the new HTTP endpoint lives at `app.post('/api/sessions/:id/start', ...)` per the same authoring conventions as `app.post('/api/sessions/:id/end', ...)` in `sessions/routes.ts`).

**Pending:** (none — every input the implementation consumes is settled on `main` as of commit `0a0a727`.)

## What this task is

Lift the participant-side `session_start_handoff` from the first-content-event heuristic introduced by the predecessor to a dedicated `session-mode-changed` wire event that is emitted by the server at the precise moment the moderator advances the session out of the lobby. After this leaf:

- A new `'session-mode-changed'` `EventKind` ships in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) (appended to the `eventKinds` tuple at L128-152, registered in `eventPayloadSchemas` at L449-472, registered in `EventPayloadMap` at L482-497) with payload schema `{ previous_mode: 'lobby', new_mode: 'operate', changed_by: <uuid>, changed_at: <iso8601> }`. The `previous_mode` / `new_mode` fields use a closed Zod enum (`z.enum(['lobby', 'operate'])`); Decision §1 settles the two-mode v1 scope (a future "concluded" mode is documented as an open direction).
- A new forward-only SQL migration at `apps/server/migrations/0013_session_events_session_mode_changed.sql` widens the `session_events.kind` `CHECK` constraint to include `'session-mode-changed'` (same DROP + ADD pattern as `0012_session_events_entity_removed.sql`).
- A new HTTP endpoint `POST /api/sessions/:id/start` is registered in [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) (alongside the existing `POST /api/sessions/:id/end` block at L1738-1931 — same shape: `preHandler: app.authenticate`, host-only authority via the existing `requireHost` pattern, visibility check via `canSeeSession`, transactional FOR UPDATE on `sessions` + MAX(sequence)+1 allocator + `validateEvent` + `appendSessionEvent` + post-commit `app.wsBroadcast.emit({ event })`). The endpoint takes no body parameters beyond the session id in the URL; it returns the session row (mirroring `end-session`).
- The moderator's `handleEnterSession` at [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526) grows a `fetch('/api/sessions/${sessionId}/start', { method: 'POST', credentials: 'include' })` call BEFORE the existing `navigate(...)`. The fetch is `await`ed so the moderator's local navigation happens after the event has been committed and broadcast (Decision §3 settles the ordering choice against the alternatives).
- The participant's `useEffect` inside `<LobbyRouteAuthenticatedBody>` (at [`LobbyRoute.tsx:435-456`](../../../apps/participant/src/routes/LobbyRoute.tsx#L435-L456)) grows a new trigger predicate: any event whose `kind === 'session-mode-changed'` AND whose `payload.new_mode === 'operate'` ALSO triggers the navigate, in addition to the existing content-event predicate. The existing `CONTENT_EVENT_KINDS` heuristic is RETAINED as a fallback (Decision §7 settles the disposition); both trigger paths are pinned by separate Vitest cases.
- The Playwright spec at [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) is amended in the same commit: the seed step swaps from a `node-created` event to a `session-mode-changed` event with `new_mode: 'operate'`. The auto-navigation assertion + the existing Cytoscape-render assertions stay structurally identical (the spec still seeds a `node-created` AFTER the navigation has fired, so the Cytoscape canvas has something to render once the operate route mounts; what changes is which event drives the lobby → operate transition).
- A new Cucumber feature file at `tests/behavior/backend/session-start.feature` (with steps at `tests/behavior/steps/backend-session-start.steps.ts`) pins the wire-path contract: a host posts to `/api/sessions/:id/start`, the server emits a `session-mode-changed` event with the right payload, every subscribed WS connection observes the broadcast, the event lands in `session_events` at the right sequence. This is the GOLD-STANDARD backend pin per ORCHESTRATOR.md's Cucumber-growth steer; the scenarios mirror the style of `tests/behavior/backend/ws-withdraw.feature`.
- A new ADR (`docs/adr/0028-session-mode-changed-wire-event.md`) records the protocol addition rationale, the alternatives surveyed (e.g. per-envelope mode field, richer state machine), the backward-compatibility posture (heuristic retained), and the migration plan.

**Out of scope** (deferred or untouched):

- **A richer multi-mode state machine** (e.g. `lobby → operate → concluded → archived` with a state-machine projector). Decision §1 documents the two-mode v1 scope; a future ADR can extend the enum if "concluded" / "paused" / etc. become real product needs.
- **A per-envelope `phase` or `mode` field on every event envelope** (the alternative bias-guided in the orchestrator brief — see Decisions §2). Rejected per Decision §2; the single `session-mode-changed` event is the smaller cross-cut.
- **Removal of the `CONTENT_EVENT_KINDS` heuristic from `LobbyRoute.tsx`**. Decision §7 retains it as defense-in-depth (replay of historical sessions without the new event still works; an out-of-band content event during the lobby phase still triggers a sensible navigation). The follow-up question of "when to drop the heuristic entirely" is documented as an open direction in the new ADR, NOT as an open question in this refinement.
- **A moderator-side surfacing of the new endpoint's failure modes** (toast, error region). The endpoint's 4xx surface is the existing `ApiError` envelope shape; the moderator's `handleEnterSession` swallows non-200s and falls back to the local navigate (Decision §3 settles the "navigate anyway" posture so a backend hiccup doesn't strand the moderator). A future polish task can surface a fail-loud toast if the silent fallback proves user-hostile.
- **Audience-surface auto-navigation off `session-mode-changed`**. The audience surface is M6/M7 work; its lobby/operate split is not yet shipped. When `aud_session_start_handoff` (future) lands, it will consume the same event kind — no protocol change required at that point.
- **A `session.current_mode` column on the `sessions` table** (read-time state derivation rather than event-sourced). Decision §4 settles the event-sourced posture; the projector reads the event log to derive the current mode (no SQL column change beyond the migration's CHECK widening).
- **A second event kind for the operate → concluded transition** (e.g. `session-ended` already covers terminal state). Decision §1 explicitly scopes v1 to `{ lobby, operate }`; the existing `session-ended` event is the terminal marker, no overlap.
- **i18n catalog changes** — none. The mode names (`'lobby'` / `'operate'`) are wire-level enum values, not user-facing strings; the participant route's chrome carries any visible text.
- **Replay-surface changes** — the future replay surface (`docs/replay-ui.md`, not yet shipped) consumes the event log; the new event kind appears in replay automatically (no replay-specific code).
- **Removal of the manual `page.goto` step in the Playwright spec**. The predecessor already removed it; this leaf inherits the post-amendment shape and only swaps the seeded event kind.

## Why it needs to be done

The predecessor's heuristic works for the v1 product surface but loses signal in three specific edge cases that the predecessor's Decisions §1 + §4 documented as accepted trade-offs:

1. **Lobby cannot distinguish "moderator hasn't started yet" from "moderator started but is mid-typing first statement"**. Today both states render identically — the lobby's "waiting for the moderator to start" hint stays visible until the first content event lands. A debater watching the lobby has no signal that the moderator HAS entered operate mode; they only learn it when the first proposal arrives. Latency is bounded by the moderator's typing speed (typically 1-10s), but for a methodology where the debater is supposed to be watching from the moment the debate begins, the gap is real product noise.
2. **An out-of-band content event during the lobby phase would auto-navigate prematurely.** Today no route in the app can emit `node-created` / `edge-created` / `entity-included` / `proposal` / `commit` from the lobby (per the predecessor's audit), but the heuristic depends on this assumption. A future product change that adds (e.g.) a participant-side "propose a topic" affordance to the lobby would break the assumption; the participant would auto-navigate to the operate route even though the moderator hasn't started yet. The dedicated event removes this coupling.
3. **Replay of historical sessions can't distinguish lobby phase from operate phase without a dedicated phase marker.** A future replay surface that walks the event log and renders "what happened when" would have to apply the same heuristic ("first content event = end of lobby phase") to reconstruct the phase boundary. The heuristic is a derived signal; an explicit `session-mode-changed` event is a direct signal that replay tooling can read in O(1) per phase change.

The dedicated event also has architectural upside beyond the three edge cases:

- **Semantic clarity on the wire.** A wire trace showing `session-mode-changed: { previous_mode: 'lobby', new_mode: 'operate' }` is self-describing; a wire trace showing `node-created: { wording: "...", ... }` only implies the mode change. Operability and debuggability both improve.
- **Replay-correctness for the projector.** The projector's `currentMode` derivation becomes one-step instead of inferential (walk events, take the last `session-mode-changed.new_mode`, default to `'lobby'`). Today no projector cares because no consumer asks; once a consumer DOES ask (the future replay surface; a hypothetical "is the session live or in lobby?" health endpoint; a moderator-side "rewind to lobby" affordance), the event-sourced derivation is one-line.
- **Backward compatibility with the heuristic preserved.** The heuristic stays as fallback (Decision §7), so sessions in flight when this lands (none yet — pre-MVP, the WBS is still M0/M1 work for most paths) continue to navigate correctly even without the new event. Pre-this-leaf event-log replays where no `session-mode-changed` ever lands still work via the content-event fallback.
- **Foundation for downstream cross-surface consumers.** The audience surface (future) will need the same lobby → operate transition signal; landing it as a first-class event kind means the audience consumes the same wire shape the participant does, no second protocol round.

The trade-off accepted by the predecessor (2d of protocol work vs. 0.5d of heuristic) is now justified — the 2d budget is the cost of paying down the architectural debt registered in the predecessor's Decisions §1 + §4, and the orchestrator's tech-debt registration policy (per ORCHESTRATOR.md) makes this task the right place to do it.

## Inputs / context

### Wire-format precedents — the canonical event-kind addition shape

The cleanest precedent for "add a new event kind across `eventKinds` + payload schema + server emit + SQL CHECK migration + ADR" is the `entity-removed` addition that landed with ADR 0027:

- [`apps/server/migrations/0012_session_events_entity_removed.sql`](../../../apps/server/migrations/0012_session_events_entity_removed.sql) — the forward-only DROP + ADD widening of `session_events_kind_check`. The full mirrored list is duplicated (every prior kind, plus the new one). This leaf's `0013_session_events_session_mode_changed.sql` follows the same shape line-for-line; the only delta is appending `'session-mode-changed'` to the inner list.
- [`packages/shared-types/src/events.ts:128-152`](../../../packages/shared-types/src/events.ts#L128-L152) — `eventKinds` tuple. This leaf appends `'session-mode-changed'` at the tail (after `'entity-removed'`) with a header comment grouping it under "session lifecycle" (logically it's a lifecycle event, even though the SQL migration places it at the end for forward-only audit clarity).
- [`packages/shared-types/src/events.ts:426-445`](../../../packages/shared-types/src/events.ts#L426-L445) — `entityRemovedPayloadSchema`. The pattern this leaf mirrors: a short top-level comment block citing the refinement + ADR; a Zod object schema with one field per payload concern; a `type FooPayload = z.infer<typeof fooPayloadSchema>` export.
- [`packages/shared-types/src/events.ts:449-472`](../../../packages/shared-types/src/events.ts#L449-L472) — `eventPayloadSchemas` registry. This leaf adds `'session-mode-changed': sessionModeChangedPayloadSchema` to the closed `Record<EventKind, z.ZodTypeAny>` (the explicit type annotation forces exhaustiveness; missing the new kind is a typecheck error).
- [`packages/shared-types/src/events.ts:482-497`](../../../packages/shared-types/src/events.ts#L482-L497) — `EventPayloadMap`. This leaf adds `'session-mode-changed': SessionModeChangedPayload` to the closed interface.

### The trigger point — moderator's `handleEnterSession`

From [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526):

```tsx
const handleEnterSession = useCallback((): void => {
  if (sessionId === '') return;
  // Defense-in-depth: the button carries `disabled={!bothDebatersPresent}`
  // so the native attribute already blocks click events when the
  // gate is closed; this guard keeps the handler honest in case a
  // future refactor swaps the native disabled attribute for
  // `aria-disabled` (which doesn't block clicks).
  if (!bothDebatersPresent) return;
  void navigate(`/sessions/${sessionId}/operate`, { replace: false });
}, [bothDebatersPresent, navigate, sessionId]);
```

The amended handler (Decision §3) becomes:

```tsx
const handleEnterSession = useCallback(async (): Promise<void> => {
  if (sessionId === '') return;
  if (!bothDebatersPresent) return;
  // POST to `/api/sessions/:id/start` BEFORE navigating locally so
  // the `session-mode-changed` event has been committed + broadcast
  // by the time the moderator's operate route mounts. The fetch is
  // awaited but its failure is non-fatal — Decision §3 explains the
  // "navigate anyway" fallback posture against the alternatives.
  try {
    await fetch(`/api/sessions/${sessionId}/start`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Network failure or non-200; fall through to the local navigate
    // so a backend hiccup doesn't strand the moderator. The
    // participant's CONTENT_EVENT_KINDS heuristic (Decision §7 of
    // this refinement) still triggers on the moderator's first
    // capture, so the participant lands on the operate route either
    // way.
  }
  void navigate(`/sessions/${sessionId}/operate`, { replace: false });
}, [bothDebatersPresent, navigate, sessionId]);
```

The `useCallback`'s dependency array is unchanged (the three dependencies are identical). The handler's signature changes from `() => void` to `() => Promise<void>` (the JSX `onClick={handleEnterSession}` treats both identically — React fires-and-forgets the returned promise).

### The wire shape — `wsBroadcast.emit({ event })` is the post-commit broadcast

From [`apps/server/src/sessions/routes.ts:1923-1927`](../../../apps/server/src/sessions/routes.ts#L1923-L1927) (the `end-session` precedent):

```ts
// Post-commit broadcast emit (see
// tasks/refinements/backend/ws_event_broadcast.md).
for (const evt of appendedEvents) {
  app.wsBroadcast.emit({ event: evt });
}
```

The new endpoint mirrors this exactly: collect the one `session-mode-changed` envelope from `appendSessionEvent`'s return, then `app.wsBroadcast.emit({ event })` AFTER the transaction commits. The post-commit-emit invariant (a broadcast that observed a rolled-back row would be lying) is preserved.

### The participant-side trigger — extend the existing `useEffect`

From [`apps/participant/src/routes/LobbyRoute.tsx:417-456`](../../../apps/participant/src/routes/LobbyRoute.tsx#L417-L456) (the predecessor's heuristic):

```ts
const navigate = useNavigate();
const handoffFiredRef = useRef<boolean>(false);
useEffect(() => {
  if (handoffFiredRef.current) return;
  if (id === '') return;
  const eventsList = events ?? [];
  const triggered = eventsList.some((event) =>
    (CONTENT_EVENT_KINDS as readonly string[]).includes(event.kind),
  );
  if (!triggered) return;
  handoffFiredRef.current = true;
  void navigate(`/sessions/${id}`, { replace: true });
}, [events, id, navigate]);
```

The amended hook (Decision §7) extends the trigger predicate:

```ts
const navigate = useNavigate();
const handoffFiredRef = useRef<boolean>(false);
useEffect(() => {
  if (handoffFiredRef.current) return;
  if (id === '') return;
  const eventsList = events ?? [];
  // Primary trigger: a dedicated `session-mode-changed` event with
  // `new_mode: 'operate'` is the canonical signal that the moderator
  // has advanced the session out of the lobby. Per ADR 0028 this is
  // the architecturally clean path; the CONTENT_EVENT_KINDS heuristic
  // below stays as defense-in-depth fallback (Decision §7 of this
  // refinement; ADR 0028 documents the heuristic-as-fallback posture).
  const modeChanged = eventsList.some(
    (event) =>
      event.kind === 'session-mode-changed' &&
      event.payload.new_mode === 'operate',
  );
  const contentTriggered =
    !modeChanged &&
    eventsList.some((event) =>
      (CONTENT_EVENT_KINDS as readonly string[]).includes(event.kind),
    );
  if (!modeChanged && !contentTriggered) return;
  handoffFiredRef.current = true;
  void navigate(`/sessions/${id}`, { replace: true });
}, [events, id, navigate]);
```

The `useRef<boolean>` guard, the `{ replace: true }` posture, the `void` call posture, and the single-pass `.some()` walk all stay identical to the predecessor's shape. The new event-kind check is added as the primary predicate; the existing content-event predicate becomes the secondary fallback (short-circuited when the primary matched).

### The destination — the participant operate route

Unchanged from the predecessor: [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx). The route is mounted at `/sessions/:id` per [`apps/participant/src/App.tsx:135`](../../../apps/participant/src/App.tsx#L135) and runs the per-session `trackSession` lifecycle on mount (idempotent with the lobby's prior call).

### Cucumber gold-standard — the `ws_withdraw_proposal_message` precedent

From [`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md) and its [Cucumber feature](../../../tests/behavior/backend/ws-withdraw.feature):

The gold-standard backend protocol pin shape:

1. A `Feature:` block with a multi-paragraph narrative explaining the wire contract, the authority rules, the rejection paths, and the integration depth (pglite + real WS upgrade via `app.injectWS`).
2. `Refinement:` and `ADRs:` footer block citing the source-of-truth documents.
3. One scenario per happy path; one scenario per rejection path; each scenario drives the wire-frame round-trip end-to-end through pglite and inspects the receiving client's arrived frames.
4. Step definitions in `tests/behavior/steps/backend-*.steps.ts` reuse the existing world/carrier pattern (auth-gated app + cookie + WS client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts`.

This leaf's Cucumber feature follows the same shape. Scenarios:

- **Host POSTs `/api/sessions/:id/start` → `session-mode-changed` event lands** — the wire-path round-trip lands the event row in pglite-backed `session_events` at the next sequence; every subscribed WS client receives the matching `event-applied` broadcast envelope.
- **Non-host attempts POST → 403 `not-a-moderator`** — the authority gate rejects non-host callers.
- **POST against an already-started session → idempotent or 422?** — Decision §5 settles "idempotent: a second POST is a no-op success (returns the same session row, emits no second event)"; the scenario pins this.
- **POST against an ended session → 422 `session-already-ended`** — reuses the existing rejection code from the `end-session` handler.
- **POST against an invisible / non-existent session → 404 `not-found`** — existence-non-leak rule.

### Live code the leaf plugs into

- [`apps/server/src/sessions/routes.ts:1738-1931`](../../../apps/server/src/sessions/routes.ts#L1738-L1931) — the `POST /api/sessions/:id/end` block. The new `POST /api/sessions/:id/start` block lives here as a sibling, immediately above or below the end-session block. Same `preHandler: app.authenticate`, same `app.withTransaction` shape, same FOR UPDATE on `sessions`, same MAX(sequence)+1 allocator, same `validateEvent` + `appendSessionEvent` + post-commit broadcast.
- [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — `canSeeSession`. Existence-non-leak predicate, reused.
- [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) — `appendSessionEvent(client, event)`. Single SQL surface for INSERTs.
- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — `validateEvent`. Schema-on-write per ADR 0021.
- [`apps/server/src/projection/replay.ts:937`](../../../apps/server/src/projection/replay.ts#L937) — the existing `session-ended` arm in the projection's case-switch over event kinds. The projector grows a `session-mode-changed` arm in this leaf (Decision §4 — record-only; flips a `currentMode` field on the projection that is exported but not yet consumed by any sibling — the v1 read sites are the future replay surface and the participant `useEffect`'s primary trigger).
- [`apps/participant/src/routes/LobbyRoute.tsx:100-110`](../../../apps/participant/src/routes/LobbyRoute.tsx#L100-L110) — the `CONTENT_EVENT_KINDS` constant. Stays unchanged in this leaf (Decision §7 retains the fallback predicate as-is; no kinds added or removed).
- [`apps/participant/src/routes/LobbyRoute.tsx:417-456`](../../../apps/participant/src/routes/LobbyRoute.tsx#L417-L456) — the auto-navigation `useEffect`. Amended in this leaf to add the primary `session-mode-changed` trigger ABOVE the existing fallback predicate.
- [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526) — `handleEnterSession`. Amended in this leaf to `await fetch('/api/sessions/${sessionId}/start', { method: 'POST', credentials: 'include' })` before the existing navigate.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — the Playwright spec. Amended in this leaf to seed a `session-mode-changed` event instead of (or alongside) a `node-created` event.

### ADR pins

- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the envelope shape this leaf's new payload conforms to.
- [ADR 0020 — Postgres write-path locking and event ordering](../../../docs/adr/0020-postgres-write-path-locking-and-event-ordering.md) — FOR UPDATE row lock + MAX(sequence)+1 inside the transaction; same pattern the new POST endpoint follows.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion is a committed Vitest case, Cucumber scenario, or Playwright assertion. The Cucumber pin is the protocol-layer gold standard for this leaf.
- [ADR 0023 — Web framework Fastify](../../../docs/adr/0023-web-framework-fastify.md) — the new HTTP endpoint authoring convention.
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the precedent for adding a new event kind in lockstep with a SQL CHECK migration; same shape this leaf follows.
- **New: ADR 0028 — Dedicated `session-mode-changed` wire event for lobby → operate transition** (written in this leaf; see Decisions §1).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_session_start_handoff.md`](part_session_start_handoff.md) — the predecessor. Decisions §1 + §4 are this leaf's source-of-debt; Decision §7 (handler inline in `LobbyRoute.tsx`) is inherited unchanged (the new trigger predicate lives in the SAME `useEffect` as the existing fallback).
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the originating predecessor. The Playwright spec it shipped is the one this leaf amends.
- [`tasks/refinements/backend/ws_withdraw_proposal_message.md`](../backend/ws_withdraw_proposal_message.md) — the Cucumber gold-standard cited in ORCHESTRATOR.md. Style + structure precedent for this leaf's Cucumber pin.
- [`tasks/refinements/moderator-ui/mod_proposed_entity_canvas_visibility.md`](../moderator-ui/mod_proposed_entity_canvas_visibility.md) — the precedent for adding a new event kind in lockstep with an ADR (0027) + a SQL CHECK migration (0012). Style precedent for this leaf's payload-schema + migration shape.
- [`tasks/refinements/moderator-ui/mod_session_lobby.md`](../moderator-ui/mod_session_lobby.md) — the upstream that ships the moderator's "Enter session" button + `handleEnterSession`. Strict-gate (`bothDebatersPresent`) stays as-is; this leaf only grows the handler's body.

## Constraints / requirements

### Files this task touches (the explicit allowlist)

- `packages/shared-types/src/events.ts` — modified. Append `'session-mode-changed'` to `eventKinds`; add `sessionModeChangedPayloadSchema` (Zod object with `previous_mode`, `new_mode`, `changed_by`, `changed_at`); register in `eventPayloadSchemas`; add to `EventPayloadMap`; export `SessionModeChangedPayload` type.
- `packages/shared-types/src/events.test.ts` — modified. Vitest cases for the new payload schema (valid happy-path; rejects invalid `new_mode` enum value; rejects missing fields; rejects malformed `changed_at`).
- `apps/server/migrations/0013_session_events_session_mode_changed.sql` — NEW. Forward-only DROP + ADD widening of the `session_events_kind_check` to include `'session-mode-changed'`. Header comment block follows the `0012_session_events_entity_removed.sql` template (cite refinement + ADR 0028 + ADR 0020).
- `apps/server/src/sessions/routes.ts` — modified. Add a new `app.post('/api/sessions/:id/start', { preHandler: app.authenticate, schema: { ... }, ... }, async (request, reply) => { ... })` block. Same authority + visibility + transactional shape as `POST /api/sessions/:id/end`. Returns the session row on success; emits one `session-mode-changed` event; broadcasts the event post-commit.
- `apps/server/src/sessions/routes.test.ts` — modified. Vitest cases for the new endpoint: happy path (host POSTs, event emitted, response is session row); non-host → 403; non-existent session → 404; ended session → 422; idempotent re-POST of an already-started session (Decision §5).
- `apps/server/src/projection/replay.ts` — modified. Add a `case 'session-mode-changed':` arm in the projector's switch (mirroring the existing `case 'session-ended':` arm at L937). Flips the projection's `currentMode` field to `event.payload.new_mode`. The field is added to the projection types in `apps/server/src/projection/types.ts` (default `'lobby'`).
- `apps/server/src/projection/types.ts` — modified. Add `currentMode: 'lobby' | 'operate'` (default `'lobby'`) to the projection type.
- `apps/server/src/projection/replay.test.ts` — modified. Add Vitest cases pinning the projector's `currentMode` derivation (initial: `'lobby'`; after a `session-mode-changed` with `new_mode: 'operate'`: `'operate'`; replay-order-invariant: same input event log → same `currentMode` regardless of replay batching).
- `apps/moderator/src/routes/InviteParticipants.tsx` — modified. Amend `handleEnterSession` to `await fetch('/api/sessions/${sessionId}/start', ...)` before the existing `navigate(...)`. The function signature changes from `() => void` to `() => Promise<void>`; the dependency array is unchanged.
- `apps/moderator/src/routes/InviteParticipants.test.tsx` — modified. Add Vitest cases pinning: `handleEnterSession` calls `fetch` with the right URL + method + credentials posture; navigates regardless of fetch success (Decision §3 — silent fallback); does NOT call `fetch` when `bothDebatersPresent` is false.
- `apps/participant/src/routes/LobbyRoute.tsx` — modified. Amend the auto-navigation `useEffect` to add the primary `session-mode-changed` predicate ABOVE the existing `CONTENT_EVENT_KINDS` fallback. The constant + the fallback predicate stay unchanged (Decision §7).
- `apps/participant/src/routes/LobbyRoute.test.tsx` — modified. Add Vitest cases (parameterized where appropriate to keep the file scannable): primary trigger fires on `session-mode-changed` with `new_mode: 'operate'`; primary trigger does NOT fire on `session-mode-changed` with `new_mode: 'lobby'`; fallback trigger still fires on every `CONTENT_EVENT_KINDS` entry (the predecessor's 5 parameterized cases stay green); the primary takes precedence when both are present in the events slice; the exactly-once guard still fires once when the primary AND the fallback are both seeded.
- `tests/e2e/participant-graph-render.spec.ts` — modified. Swap the seeded event from `node-created` (the trigger) to `session-mode-changed` (the new trigger). The Cytoscape-render assertions stay valid because the spec seeds a `node-created` AFTER the navigation completes (so the operate route has something to render).
- `tests/behavior/backend/session-start.feature` — NEW. The gold-standard backend Cucumber pin. Scenarios per the "Cucumber gold-standard" section above.
- `tests/behavior/steps/backend-session-start.steps.ts` — NEW. Step definitions for the feature; reuse the existing world/carrier pattern from `backend-ws-*.steps.ts`.
- `docs/adr/0028-session-mode-changed-wire-event.md` — NEW. The ADR. See Decisions §1 for the structure.
- `docs/ws-protocol.md` — modified. Add a section documenting the new event kind + payload shape (mirrors the `entity-removed` section that ADR 0027 work added).

### Files this task does NOT touch

- `.tji` files — the WBS `complete 100` marker lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.
- `apps/audience/**` / `apps/root/**` — no cross-surface change. The audience surface's lobby/operate split is M6/M7 work; it will consume the new event kind when `aud_session_start_handoff` lands.
- `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The operate route is the destination; it never sees the handoff happen.
- `packages/shell/**` — no substrate change. The new event kind flows through the existing shell-package WS client without any code change (the client's dispatch validates incoming envelopes via the `EventPayloadMap` enum which now includes the new kind).
- `packages/i18n-catalogs/**` — no new i18n keys. The mode enum values are wire-level, not user-facing.
- `apps/server/src/methodology/**` — no engine action kind. The mode change is a pure session-lifecycle event, not a methodology action; the engine has no involvement.

### Wire-format invariants

- **Payload shape (`{ previous_mode, new_mode, changed_by, changed_at }`)**. The `previous_mode` field is present even though it's redundant with the projector's prior state — it makes the event self-describing on the wire (a trace reader doesn't have to look at the previous event to know what state transitioned). Decision §6 settles the field set against alternatives.
- **Mode enum is a closed Zod enum** (`z.enum(['lobby', 'operate'])`). Adding a future `'concluded'` value is a new task; v1 ships with the two-mode enum.
- **`changed_by` is the actor's user id** (the host's user id, since the host is the only authorised caller). Symmetric with the existing `actor` field on the envelope (mirroring `entity-removed.removed_by` per ADR 0027's payload pattern).
- **`changed_at` is ISO-8601 with offset** (`z.string().datetime({ offset: true })`). Same shape every other timestamp field on every payload uses.
- **Event sequence allocation** mirrors `end-session`: FOR UPDATE on `sessions`, MAX(sequence)+1, `validateEvent`, `appendSessionEvent`.

### Endpoint authority + state predicates

- **Authority**: host-only. The same `requireHost` pattern (or its inline equivalent) the `end-session` endpoint uses at [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts). Non-host → 403 `not-a-moderator` (existing rejection code; no new code minted).
- **Visibility**: `canSeeSession` — invisible-or-non-existent → 404 `not-found` (existence-non-leak rule; same shape every read+write endpoint enforces).
- **State**: the session MUST be live (not ended). An ended session → 422 `session-already-ended` (existing rejection code from the `end-session` handler).
- **Idempotency**: a re-POST of an already-started session is a no-op success (returns the session row; emits NO second event). Decision §5 settles this against the 422 alternative.

### Test coverage layering (per ADR 0022)

- **Pure-logic / shape pins** → Vitest at `packages/shared-types/src/events.test.ts` (payload schema), `apps/server/src/projection/replay.test.ts` (projector arm), `apps/server/src/sessions/routes.test.ts` (endpoint handler), `apps/moderator/src/routes/InviteParticipants.test.tsx` (moderator-side fetch + navigate), `apps/participant/src/routes/LobbyRoute.test.tsx` (participant-side `useEffect` predicate).
- **Wire-path against pglite** → Cucumber at `tests/behavior/backend/session-start.feature`. **This is the GOLD-STANDARD pin per ORCHESTRATOR.md's Cucumber-growth steer; the protocol addition this task lands is exactly the kind of work Cucumber is for.**
- **Cross-surface observable behaviour** → Playwright amendment to `tests/e2e/participant-graph-render.spec.ts`. The spec seeds the new event kind to drive the auto-navigation; the existing Cytoscape assertions stay valid.

### Backward compatibility

- **Sessions in flight when this lands**: none (pre-MVP — most paths are still M0/M1 work; the manual-browser smoke at `m_manual_lobby_smoke` is the closest thing to a live session, and it's an ephemeral developer workflow).
- **Event-log replays that pre-date this leaf**: handled via the CONTENT_EVENT_KINDS heuristic which stays as fallback (Decision §7). A replay of an old session log where no `session-mode-changed` ever lands still triggers the participant's auto-navigation via the content-event predicate.
- **Forward compat for the new event kind**: the SQL CHECK migration is forward-only per ADR 0020; no rollback path beyond restoring from backup. The shared-types registry is exhaustive over `EventKind`, so missing the new kind anywhere is a typecheck error (no silent drift possible).

### Performance

- **Server-side endpoint**: one DB transaction (FOR UPDATE + MAX(sequence) + INSERT); one event broadcast. Same cost profile as `end-session`. No measurable performance impact.
- **Participant-side `useEffect`**: the trigger predicate grows from one `.some()` walk to two; both short-circuit on first match. The fallback predicate is gated by `!modeChanged` so the second `.some()` only runs when the first didn't match — net cost is the same as the predecessor's heuristic.
- **Moderator-side `handleEnterSession`**: adds one HTTP round-trip (~100ms) before the navigate. The moderator's perception is "click the button, brief pause, land on operate canvas"; the pause is bounded by the round-trip time and is the right semantics (the navigate completes AFTER the server has acknowledged the mode change).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dependencies.
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the modified files in place.
3. **`pnpm run test:smoke` (Vitest) green** — the new cases across `events.test.ts`, `routes.test.ts` (sessions), `replay.test.ts`, `InviteParticipants.test.tsx`, and `LobbyRoute.test.tsx` all pass. Vitest count grows by ≥ 20 cases (the implementer reports exact before / after in the return summary so the Status block can cite them).
4. **`pnpm run test:behavior:smoke` (Cucumber) green** — the new `session-start.feature` scenarios pass against pglite; the existing scenarios stay green. Cucumber count grows by ≥ 5 scenarios (one per scenario listed in the gold-standard section). **This is the in-scope protocol-layer pin per ORCHESTRATOR.md's Cucumber-growth steer.**
5. **`pnpm --filter @a-conversa/shared-types run build`** green — the new event kind + payload schema build clean.
6. **`pnpm --filter @a-conversa/server run build`** green — the new endpoint + projector arm build clean.
7. **`pnpm -F @a-conversa/participant build`** + **`pnpm -F @a-conversa/moderator build`** green — the surface bundles include the amended hooks.
8. **Failing-first verification (ADR 0022 compliance)** — the Implementer runs the new Vitest cases for the participant-side primary trigger AGAINST the pre-amendment `LobbyRoute.tsx` (heuristic-only); confirms the primary-trigger cases fail (no navigation fires on a `session-mode-changed` event alone if the existing heuristic's content-event predicate isn't also present); applies the amendment; confirms all pass. Both observations are reported in the Implementer's summary.
9. **`pnpm run test:e2e`** under `make up` runs the amended `tests/e2e/participant-graph-render.spec.ts` scenario green. The amended spec seeds `session-mode-changed` instead of `node-created` to drive the auto-navigation; the Cytoscape-render assertions downstream stay valid.
10. **Migration smoke** — `make db-migrate` (or the equivalent migration runner the dev environment uses) applies `0013_session_events_session_mode_changed.sql` clean; a subsequent INSERT into `session_events` with `kind = 'session-mode-changed'` succeeds; an INSERT with `kind = 'invalid'` fails the CHECK as before.
11. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `part_session_start_handoff_dedicated_event`.
12. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
13. **ADR 0028 lands in the same commit** as the implementation, per the `docs/adr/README.md` convention. Status: `Accepted`. The amendment-pass rule (`docs/adr/README.md` §"Amendment-pass rule") is run: ADR 0021's event-envelope ADR may grow an `## Amendments` entry citing 0028 if the event-kind addition is non-trivial enough to warrant the backlink; the implementer makes the call based on the precedent ADR 0027 set when it amended 0021.
14. **The implementation matches the Decisions** — the primary trigger is `session-mode-changed` (Decision §1); the heuristic is retained as fallback (Decision §7); the moderator fetches BEFORE navigating (Decision §3); the endpoint is idempotent on re-POST (Decision §5); the payload carries `previous_mode` even though redundant (Decision §6); the projector flips `currentMode` (Decision §4).

## Decisions

### §1 — Event name: `session-mode-changed`; payload mode enum: `'lobby' | 'operate'`

Three alternative names surveyed:

- **(A) `debate-started`** — verb-tense matches the moderator's UI button ("Enter session" / "Start debate"). Rejected: terminal-only semantics (you can't `debate-started` again; you can't transition the other way). The orchestrator brief's note suggests `session-mode-changed` precisely because it's bidirectional and extensible (a future "concluded" mode fits without renaming).
- **(B) `session-started`** — matches the existing `session-ended` lifecycle event for symmetry. Rejected: confusing semantic overlap with `session-created` (the existing event that fires at session creation time; a debater unfamiliar with the codebase would reasonably assume `session-started` = "session is live now" which is when `session-created` already fires). The mode-change framing avoids this collision.
- **(C) `session-mode-changed`** (chosen) — matches the orchestrator brief's suggestion. Self-describing, bidirectional, extensible. The payload's `previous_mode` + `new_mode` discriminator makes the wire-trace self-explanatory.

Three alternative mode-enum scopes surveyed:

- **(I) Two modes `{ lobby, operate }`** (chosen for v1). The minimum sufficient surface; matches the two-route URL split the participant surface already has (`/p/sessions/:id/lobby` and `/p/sessions/:id`). Future modes are easy extensions (the closed Zod enum is the source of truth; adding a value is a one-line change + a SQL migration + an ADR amendment).
- **(II) Three modes `{ lobby, operate, concluded }`** — would unify the `session-ended` event into the mode-change framing. Rejected: `session-ended` is already in the wire vocabulary, lands at a different point in the session lifecycle (the host POSTs to `/end`), and carries a different payload (`{ ended_at }`). Conflating them now adds a transition-mapping concern (an `operate → concluded` mode change vs. a `session-ended` event — which one fires?) without buying anything. If a future product change introduces a "paused but not ended" state, that's the right time to widen the enum.
- **(III) Free-form string mode** (`z.string()` instead of `z.enum(...)`) — rejected on type-safety grounds. The whole point of the closed Zod enum is that a typo in the mode value is caught at parse time, not at runtime in the projector.

**ADR 0028 documents this decision** as the canonical record. The ADR's "Decision" section covers the name choice + the two-mode scope; the "Consequences" section covers the migration + the heuristic-as-fallback + the future-extension path.

### §2 — Single `session-mode-changed` event over a per-envelope `phase` / `mode` field

The orchestrator brief explicitly raised "Why a single `session-mode-changed` event is preferable to a richer state machine or session-phase enum on every event envelope" as a question for the ADR. The alternative would be to add a `phase: 'lobby' | 'operate'` field to the base envelope shape (`packages/shared-types/src/events.ts:506-540` — the envelope shape after the per-kind payload schemas) so EVERY event carries the current phase. Rejected:

- **Cross-cut size.** Every event-construction call site server-side would have to set the field; every event-consumer client-side would have to be aware of it. The cross-cut spans hundreds of call sites (every `appendSessionEvent` call, every `validateEvent` call, every projector arm, every test fixture, every Cucumber step that constructs an event). A dedicated event kind is one-cut.
- **Phase derivation is event-sourced.** The current phase is derivable from the event log (walk forward, take the last `session-mode-changed.new_mode`, default to `'lobby'`). A per-envelope phase field would either be redundant (the projector derives it anyway) or authoritative (the writer sets it explicitly per event), and authoritative-per-event opens a new bug class (what if the writer sets the wrong phase? what if two consecutive events disagree?). Event-sourced derivation has one source of truth.
- **The mode-change is a discrete event with a transition timestamp.** A phase field on every envelope smears the transition signal across N events (the transition is "the envelope where the field first reads `'operate'`"). A dedicated event with a `changed_at` field is one event with one timestamp.

ADR 0028 documents this alternative + the rejection.

### §3 — Moderator POSTs BEFORE navigating; falls back to local navigate on POST failure

Three alternatives surveyed:

- **(A) POST then navigate** (chosen). The moderator's local navigation happens AFTER the server has committed the mode change + broadcast the event. The participant's auto-navigation can fire before, during, or after the moderator's local navigate (the two are independent socket events from the participant's POV). The fetch is `await`ed but its failure is non-fatal — `try { await fetch(...) } catch {}` swallows network errors; the `navigate(...)` runs regardless.
- **(B) Navigate then POST** — the moderator's UI feels snappier (no perceived round-trip pause), but the participant's auto-navigation might land BEFORE the moderator's because the post-navigate POST hasn't fired yet, and a slow network could leave a gap where the participant is on the operate route and the moderator is mid-transition. Rejected: the symmetry "both navigate at the same logical moment" is the right UX. The participant's `useEffect` only fires when the event lands; an earlier-than-moderator participant arrival isn't a real bug, but the (A) ordering is more semantically correct.
- **(C) Block the navigate on POST success** — refuse to navigate if the POST fails. Rejected: a backend hiccup would strand the moderator in the lobby with a non-functional "Enter session" button. The CONTENT_EVENT_KINDS heuristic (Decision §7) is still in place as a participant-side fallback, so even if the POST fails, the moderator's first capture in operate will trigger the participant's auto-navigation via the fallback path. The fail-silent posture is correct.

The amended `handleEnterSession` uses `try { await fetch(...) } catch {}` for the silent fallback; the catch block is a comment-only no-op that documents why it's empty.

### §4 — Projector arm + `currentMode` field on the projection; no SQL `sessions.current_mode` column

The projector's case-switch over event kinds (at [`apps/server/src/projection/replay.ts:937`](../../../apps/server/src/projection/replay.ts#L937)) grows a `case 'session-mode-changed':` arm. The arm flips a `currentMode: 'lobby' | 'operate'` field on the projection (default `'lobby'`).

Alternatives surveyed:

- **(A) Projector field only, no SQL column** (chosen). Event-sourced derivation; the projection is the read-time source of truth; no SQL schema change beyond the migration's CHECK widening. Consistent with the entity-vs-facet separation principle (ADR 0027) — visibility and other read-time state are projector-derived, not SQL-column-stored.
- **(B) Add `sessions.current_mode` column** + UPDATE in the transaction — read-time fast (one column read; no event-log walk), but doubles the source of truth (a projector-derived `currentMode` and a SQL column that could disagree if a writer forgets to UPDATE the column). Rejected: same concern that drove the entity-vs-facet separation; event-sourced + projector-derived has one source of truth.
- **(C) Defer the projector arm to a future task** — leave the event in the log but no projector reads it. Rejected: ADR 0022 says every behavioural assertion is a committed test; the projector arm is the testable contract for "the event flips the projection's mode field." Without the arm there's nothing to assert in the projector layer; the only consumers are the participant's `useEffect` (UI-layer) and the (future) replay surface. The projector arm + the test pin is the right place to land the contract.

### §5 — Endpoint is idempotent on re-POST

A re-POST of `/api/sessions/:id/start` against an already-started session is a no-op success: returns the session row (200), emits NO second event, NO broadcast. Alternative: return 422 `session-already-started`. Rejected:

- **The "Enter session" button is the only caller today**, and the strict-gate `disabled={!bothDebatersPresent}` plus the inline `if (!bothDebatersPresent) return` guard already prevents the button from being clicked twice in the lobby phase (after the first POST the moderator's local navigate happens and the lobby surface unmounts; there's no second click). The idempotent behaviour is the safer default for callers that might POST defensively (e.g. a future retry layer; a moderator who double-clicks before the navigate happens).
- **A 422 would force the moderator's `handleEnterSession` to handle the error case**, which is exactly the "swallow errors" posture Decision §3 chose against. Returning 200 unconditionally for "already in this state" keeps the caller-side logic minimal.
- **No real cost.** The check is one SELECT on the projection's `currentMode` (or an inline event-log scan); the second POST returns 200 without emitting an event.

The Cucumber feature pins this scenario explicitly ("Idempotent re-POST against an already-started session"). The endpoint reads the projection's `currentMode` field; if it's already `'operate'`, returns 200 with the session row.

### §6 — Payload includes `previous_mode` even though redundant

The payload is `{ previous_mode: 'lobby', new_mode: 'operate', changed_by: <uuid>, changed_at: <iso8601> }`. The `previous_mode` field is redundant (the projector knows the previous mode by walking the event log; a wire-trace reader can infer it from "no prior `session-mode-changed`" → `'lobby'`). Chosen anyway:

- **Self-describing wire trace.** A reader looking at one event in isolation knows what state the system transitioned from. The alternative ("infer from prior events") forces multi-event reasoning for what should be a one-step lookup.
- **Forward-compatible with future modes.** When a third mode `'concluded'` lands, the `previous_mode` field disambiguates `operate → concluded` from `lobby → concluded` (the former is the canonical path; the latter would be a moderator skipping the operate phase, perhaps the session ended without anyone capturing anything). The transition record is preserved per-event.
- **Cost is one enum value** — 4-8 bytes on the wire, one field in the schema. Negligible.

### §7 — Heuristic retained as fallback; not removed

The predecessor's `CONTENT_EVENT_KINDS` heuristic stays in `LobbyRoute.tsx` as a fallback predicate (short-circuited when the primary `session-mode-changed` predicate already matched). Three alternatives surveyed:

- **(A) Remove the heuristic entirely** — the predecessor's tests are deleted; the file shrinks by ~15 LOC. Rejected: replay of historical sessions without the new event would break (no auto-navigation; the lobby stays open until the user manually navigates). Pre-MVP this is mostly moot, but the heuristic is cheap to keep and the additional defense-in-depth is genuinely useful for the "what if the new endpoint fails and the moderator falls back to local navigate?" path (Decision §3). The participant's first-content-event trigger is the safety net.
- **(B) Keep the heuristic + a feature-flag to disable it** — over-engineered for v1. The heuristic is cheap, the fallback is correct, no real reason to gate it behind a flag.
- **(C) Keep the heuristic, primary trigger is the new event** (chosen). The `useEffect`'s predicate is `modeChanged || contentTriggered` (short-circuit semantics; modeChanged takes precedence). The behaviour is: if the primary event ever lands, navigate; if not, the first content event still triggers. Both paths are pinned by separate Vitest cases.

The new ADR's "Backward compatibility" section documents the heuristic-as-fallback posture as the canonical decision; a future task can drop the heuristic if/when the new event is universally adopted across all session creation paths (a v2 hardening step, not a v1 concern).

### §8 — No engine routing for the action

The new POST endpoint enforces the host-only authority gate + the session-not-ended state predicate directly (mirroring the `end-session` handler's inline checks). The mode change is a pure session-lifecycle event, not a methodology action; there's no `MethodologyAction.changeSessionMode` variant, no `validateAction` routing.

Rationale:

- **The mode change has no methodology consequence.** Propose / vote / commit / mark-meta-disagreement route through the engine because they have methodology-defined rules (proposer authority, unanimity, valid sub-kinds, etc.). The mode change has lifecycle rules (host-only, not-already-ended) that are simple authority + state checks; the engine has no business with them.
- **The existing `session-created` and `session-ended` endpoints don't route through the engine either** — they're inline `app.post(...)` handlers in `sessions/routes.ts`. The new `session-mode-changed` endpoint is a sibling, consistent with the lifecycle pattern.
- **If a future product change introduces methodology rules** for the mode change (e.g. "can only enter operate mode if at least one entity has been pre-seeded"), promoting to engine-routed becomes a clean refactor at that point. v1 has no such rules.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- New `'session-mode-changed'` `EventKind` ships in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) with payload schema `{ previous_mode, new_mode, changed_by, changed_at }` (Zod `z.enum(['lobby', 'operate'])` per Decision §1), registered exhaustively in `eventPayloadSchemas` and `EventPayloadMap`. Payload-schema cases land in `packages/shared-types/src/events.test.ts`; `REPRESENTATIVE_PAYLOADS` and `PAYLOAD_CORRUPTIONS` entries land in `apps/server/src/events/validate.test.ts`.
- Host-only `POST /api/sessions/:id/start` endpoint added to [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) (FOR UPDATE on `sessions`, MAX(sequence)+1, `validateEvent`, `appendSessionEvent`, post-commit `app.wsBroadcast.emit({ event })` — same shape as `POST /api/sessions/:id/end`). Idempotent re-POST (Decision §5) returns the session row with no second emit. Eight new Vitest cases land in `apps/server/src/sessions/routes.test.ts`.
- Projector grows a `case 'session-mode-changed':` arm in [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts), flipping the new `#currentMode` field on the projection (default `'lobby'`) declared in [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) + [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) (new `SessionMode` type + `SessionModeChanged` change variant). Three new projector-arm cases land in `apps/server/src/projection/replay.test.ts`.
- ADR [`docs/adr/0028-session-mode-changed-wire-event.md`](../../../docs/adr/0028-session-mode-changed-wire-event.md) lands in the same commit, **Status flipped Proposed → Accepted** per the `docs/adr/README.md` convention. The wire-protocol companion note lands in [`docs/ws-protocol.md`](../../../docs/ws-protocol.md).
- Forward-only migration [`apps/server/migrations/0013_session_events_session_mode_changed.sql`](../../../apps/server/migrations/0013_session_events_session_mode_changed.sql) widens the `session_events_kind_check` CHECK constraint to include `'session-mode-changed'` (DROP + ADD pattern mirroring `0012_session_events_entity_removed.sql`). Verified on the live compose stack via `\d session_events` after `make up` — the live constraint now includes the new kind.
- Cucumber gold-standard wire pin: new [`tests/behavior/backend/session-start.feature`](../../../tests/behavior/backend/session-start.feature) + steps at [`tests/behavior/steps/backend-session-start.steps.ts`](../../../tests/behavior/steps/backend-session-start.steps.ts) drive the round-trip end-to-end through pglite (host POST → event row at next sequence → broadcast envelope arrives on subscribed clients; non-host → 403; non-existent → 404; ended → 422; idempotent re-POST). **Cucumber grows 231 → 236 scenarios (+5, 1576 → 1628 steps) — the ORCHESTRATOR.md "lagging-suite steer" target hit.**
- Moderator-side handoff: [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) — `handleEnterSession` becomes async, `await fetch('/api/sessions/${sessionId}/start', { method: 'POST', credentials: 'include' })` BEFORE the existing navigate, with a silent-fallback `try { ... } catch {}` per Decision §3. Four new POST-handoff Vitest cases land in `apps/moderator/src/routes/InviteParticipants.test.tsx`. Participant-side: [`apps/participant/src/routes/LobbyRoute.tsx`](../../../apps/participant/src/routes/LobbyRoute.tsx) — `useEffect` predicate extended with the primary `session-mode-changed` + `new_mode: 'operate'` trigger; the predecessor's `CONTENT_EVENT_KINDS` heuristic is **retained as defense-in-depth fallback** (Decision §7) so historical-log replay and any POST-failure paths still navigate correctly. Six new primary-trigger cases (t–y) land in `apps/participant/src/routes/LobbyRoute.test.tsx`.
- Failing-first verification per ADR 0022 confirmed: with the new `modeChanged` predicate in `LobbyRoute.tsx`'s `useEffect` forced to `false`, exactly 3 of the new positive cases failed (t/v/x — the ones that depend on the primary trigger firing in isolation, without the content-event fallback also being seeded); cases u/w/y stayed green precisely because they don't depend on the primary alone. Restoring the implementation flipped all 36 LobbyRoute tests back to green.
- Test deltas: Vitest 3825 → 3855 (+30 cases, 176 files unchanged); Cucumber 231 → 236 scenarios (+5 in the new feature file, 1576 → 1628 steps); Playwright participant suite holds at 11/11 with the amended [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) now seeding `session-mode-changed` as the primary trigger — all green against the live compose stack, no Authelia-capitalization flakes surfaced.
