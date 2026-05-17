# 0028 — Dedicated `session-mode-changed` wire event for the lobby → operate transition

- **Date**: 2026-05-17
- **Status**: Accepted

## Context

The participant tablet's lobby surface (`/p/sessions/:id/lobby`) and operate surface (`/p/sessions/:id`) are two distinct routes; the debater watches the lobby fill with both debater slots, then needs to transition to the operate canvas the moment the moderator advances the session out of the lobby. The moderator-side gesture is the strict-gated "Enter session" button at [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526); the moderator's `handleEnterSession` callback runs a client-side `navigate('/sessions/:id/operate')`.

The first cut at the participant-side handoff (commit `ec395ce` landing the `part_session_start_handoff` task — [refinement](../../tasks/refinements/participant-ui/part_session_start_handoff.md)) used a **first-content-event heuristic**: the participant's lobby `useEffect` watches the per-session WS events slice for the first event whose `kind` is in a `CONTENT_EVENT_KINDS` tuple (`node-created`, `edge-created`, `entity-included`, `proposal`, `commit`), and navigates the debater to the operate route on arrival. The heuristic works for v1 because no other surface in the app can emit those event kinds — only the moderator's operate-mode capture / propose / commit flows can — so their appearance in the events slice is a sufficient proxy for "the moderator is now in operate mode."

The heuristic's predecessor refinement (Decisions §1 + §4) registered three accepted edge cases as architectural debt:

1. The lobby can't distinguish "moderator hasn't started yet, no content seeded" from "moderator started but is mid-typing without sending the first content event." A debater watching the lobby waits through the moderator's typing of the first proposal with no signal that the mode has actually changed.
2. An accidental content event from anything other than the moderator (e.g. a future participant-side propose affordance in the lobby) would auto-navigate prematurely. The heuristic depends on the assumption that no non-operate route can emit content events; future product changes could break that assumption.
3. Replay of historical sessions can't distinguish lobby phase from operate phase without a dedicated phase marker. A replay tool walking the event log has to apply the same heuristic to reconstruct the phase boundary.

The predecessor's Decision §4 registered the follow-up task that lifts the implementation to a dedicated wire event when the architectural debt becomes warranted; the orchestrator-brief'd `part_session_start_handoff_dedicated_event` task is the home of that follow-up. THIS ADR is the protocol decision the task lands.

## Decision

**The lobby → operate transition is signalled by a dedicated `'session-mode-changed'` wire event in the existing per-session WebSocket event stream.** The event is emitted by a new host-only HTTP endpoint `POST /api/sessions/:id/start` (the moderator's `handleEnterSession` POSTs to it before navigating locally); the event flows through the existing `app.wsBroadcast.emit({ event })` post-commit broadcast path; the participant's lobby `useEffect` consumes it as the primary trigger for the lobby → operate auto-navigation.

Concrete shape:

1. **New `EventKind`**: `'session-mode-changed'` appended to the `eventKinds` tuple in [`packages/shared-types/src/events.ts`](../../packages/shared-types/src/events.ts) (after `'entity-removed'`). Registered in `eventPayloadSchemas` and `EventPayloadMap` in lockstep (the exhaustive `Record<EventKind, ...>` type annotation enforces this at compile time).
2. **Payload schema**: `{ previous_mode: 'lobby' | 'operate', new_mode: 'lobby' | 'operate', changed_by: <uuid>, changed_at: <iso8601> }`. The mode field uses a closed Zod enum (`z.enum(['lobby', 'operate'])`); v1 ships two modes. The `previous_mode` field is included for wire-trace self-description (a reader looking at one event in isolation knows the transition's full shape; no multi-event reasoning required) and forward compatibility with a future third mode.
3. **Forward-only SQL migration**: `apps/server/migrations/0013_session_events_session_mode_changed.sql` widens the `session_events_kind_check` to include `'session-mode-changed'`. Same DROP + ADD pattern as `0012_session_events_entity_removed.sql` (the ADR 0027 precedent).
4. **New HTTP endpoint**: `POST /api/sessions/:id/start` in [`apps/server/src/sessions/routes.ts`](../../apps/server/src/sessions/routes.ts), sibling to the existing `POST /api/sessions/:id/end`. Host-only (403 `not-a-moderator` for non-host), visibility-gated (404 `not-found` for invisible-or-non-existent), state-gated (422 `session-already-ended` for ended sessions), idempotent on re-POST (200 with the session row; no second event emitted). Transactional `withTransaction` shape: FOR UPDATE on `sessions`, MAX(sequence)+1 allocator, `validateEvent`, `appendSessionEvent`, post-commit `app.wsBroadcast.emit({ event })`.
5. **Moderator-side trigger**: `handleEnterSession` at [`apps/moderator/src/routes/InviteParticipants.tsx:517-526`](../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526) grows a `try { await fetch('/api/sessions/${sessionId}/start', { method: 'POST', credentials: 'include' }) } catch {}` call BEFORE the existing local `navigate('/sessions/:id/operate')`. The fetch is awaited so the event has been committed and broadcast by the time the moderator's operate route mounts; the catch is silent so a backend hiccup doesn't strand the moderator (the participant-side fallback heuristic still catches the moderator's first capture).
6. **Participant-side consumer**: the lobby's auto-navigation `useEffect` at [`apps/participant/src/routes/LobbyRoute.tsx:417-456`](../../apps/participant/src/routes/LobbyRoute.tsx#L417-L456) grows a primary trigger predicate (`event.kind === 'session-mode-changed' && event.payload.new_mode === 'operate'`) ABOVE the existing `CONTENT_EVENT_KINDS` fallback. The fallback is short-circuited when the primary matches; both paths are individually pinned by Vitest cases.
7. **Projector arm**: the server-side projector at [`apps/server/src/projection/replay.ts`](../../apps/server/src/projection/replay.ts) grows a `case 'session-mode-changed':` arm that flips a `currentMode: 'lobby' | 'operate'` field on the projection (default `'lobby'`). The field is event-sourced (no SQL `sessions.current_mode` column) — single source of truth.

Why `'session-mode-changed'` and not the alternatives surveyed:

- **`'debate-started'`** — terminal-only semantics (you can't `debate-started` again; you can't transition the other way). Rejected because the mode-change framing is bidirectional and extensible (a future `'concluded'` or `'paused'` mode fits the same event without renaming).
- **`'session-started'`** — confusing semantic overlap with the existing `'session-created'` event. A reader unfamiliar with the codebase would reasonably assume `'session-started'` = "session is live now," which is when `'session-created'` already fires. The mode-change framing avoids the collision.
- **`'session-mode-changed'`** (chosen) — self-describing, bidirectional, extensible. The payload's `previous_mode` + `new_mode` discriminator makes the wire-trace self-explanatory.

Why a single `'session-mode-changed'` event and not a per-envelope `phase`/`mode` field on every event envelope:

- **Cross-cut size.** A per-envelope phase field would require every event-construction call site server-side to set the field and every event-consumer client-side to be aware of it — hundreds of call sites (`appendSessionEvent`, `validateEvent`, every projector arm, every test fixture, every Cucumber step that constructs an event). A dedicated event kind is one-cut.
- **Single source of truth.** Phase is derivable from the event log (walk forward, take the last `session-mode-changed.new_mode`, default to `'lobby'`); a per-envelope field would either be redundant (the projector derives it anyway) or authoritative (the writer sets it per event), and authoritative-per-event opens a new bug class — what if the writer sets the wrong phase? what if two consecutive events disagree? Event-sourced derivation has one source of truth.
- **Discrete-event semantics for a discrete transition.** The mode change is one transition with one timestamp; a per-envelope field smears the transition signal across N events. A dedicated event with `previous_mode`/`new_mode`/`changed_at` is one event with one transition record.

Why two modes (`{ lobby, operate }`) and not three or more:

- **Minimum sufficient surface for v1.** Matches the two-route URL split the participant surface already has. Future modes (e.g. `'concluded'`, `'paused'`) are easy extensions — a one-line change to the closed Zod enum, a forward-only SQL migration to widen the CHECK constraint, an ADR amendment documenting the new value.
- **No conflation with `'session-ended'`.** Unifying the lifecycle into a three-mode `{ lobby, operate, concluded }` framing would overlap with the existing `'session-ended'` event (which has its own payload `{ ended_at }` and its own POST endpoint). Conflating them adds transition-mapping concerns without buying anything. If a future `'paused'` mode emerges that has no terminal counterpart, that's the right time to widen the enum.

Why heuristic-as-fallback (the existing `CONTENT_EVENT_KINDS` predicate stays in `LobbyRoute.tsx`):

- **Replay of historical sessions where no `'session-mode-changed'` event ever lands.** A future replay tool walking an old event log (or a developer reproducing an issue from a session predating this ADR) still gets the correct auto-navigation behaviour via the content-event predicate.
- **Defense-in-depth against the moderator-side POST failing.** The amended `handleEnterSession` (Decision §3 of the refinement) silently falls back to the local navigate on POST failure; the participant's first-content-event predicate is the safety net that gets the participant onto the operate route once the moderator captures their first statement.
- **Cost of keeping the heuristic is ~15 LOC and a handful of Vitest cases.** Negligible; the upside (correctness under replay + defense-in-depth) is real.

Backward compatibility:

- **Sessions in flight when this lands**: none. Pre-MVP; the manual-browser smoke at `m_manual_lobby_smoke` is the closest thing to a live session, and it's an ephemeral developer workflow.
- **Pre-this-ADR event-log replays**: handled by the content-event fallback. A replay where no `'session-mode-changed'` ever lands still triggers the participant's auto-navigation via the heuristic.
- **Forward compat for future modes**: the closed Zod enum is the source of truth. Adding a new value is a one-line change + a SQL migration + an ADR amendment per the [ADR amendment-pass rule](README.md#amendment-pass-rule).

## Consequences

- **New event kind `'session-mode-changed'`** in the wire vocabulary. Registered in [`packages/shared-types/src/events.ts`](../../packages/shared-types/src/events.ts) (`eventKinds`, `eventPayloadSchemas`, `EventPayloadMap`); validated by `validateEvent` per ADR 0021; widened in the SQL CHECK via the new `0013_session_events_session_mode_changed.sql` migration per ADR 0020.

- **New HTTP endpoint `POST /api/sessions/:id/start`** in `apps/server/src/sessions/routes.ts`. Host-only; visibility-gated; state-gated; idempotent on re-POST. Sibling to the existing `POST /api/sessions/:id/end`; same transactional shape; same post-commit broadcast.

- **Moderator-side `handleEnterSession` grows a fetch call.** Single-line addition: `try { await fetch('/api/sessions/${sessionId}/start', { method: 'POST', credentials: 'include' }) } catch {}`. The handler's signature changes from `() => void` to `() => Promise<void>`; the JSX `onClick={handleEnterSession}` posture is unaffected (React fires-and-forgets the returned promise).

- **Participant-side `useEffect` grows a primary trigger predicate.** The existing `CONTENT_EVENT_KINDS` fallback stays in place; the new predicate short-circuits ahead of it when an `'operate'`-bound `'session-mode-changed'` lands. The `useRef<boolean>` re-fire guard, the `{ replace: true }` posture, and the `void` navigate call are all preserved from the predecessor.

- **Projector grows a `currentMode` field.** Default `'lobby'`; flipped by the new projector arm. The field is exported from the projection but only consumed by (a) the participant's `useEffect` via the per-session events slice (indirect; the event is the canonical signal, the projection field is the projector's mirror) and (b) the endpoint's idempotency check (read `currentMode`; if already `'operate'`, return 200 without emitting). A future replay surface is the third anticipated consumer.

- **Cucumber wire-path pin lands at `tests/behavior/backend/session-start.feature`.** Per ORCHESTRATOR.md's Cucumber-growth steer, this is the gold-standard pin for the protocol addition. Scenarios mirror the `ws-withdraw.feature` style: host happy path, non-host rejection, idempotent re-POST, ended-session rejection, invisible-session rejection.

- **Playwright spec amendment**: `tests/e2e/participant-graph-render.spec.ts` (the spec the predecessor amended to seed a `node-created` event for the auto-navigation) is amended again to seed `'session-mode-changed'` as the primary trigger. The Cytoscape-render assertions stay valid because the spec still seeds a `node-created` AFTER the navigation has fired (so the operate route has something to render).

- **Heuristic stays as defense-in-depth fallback.** The `CONTENT_EVENT_KINDS` constant + the fallback predicate in `LobbyRoute.tsx` are not removed. A future v2 hardening task can drop the heuristic if/when the new event is universally adopted across all session creation paths and replay tooling explicitly relies on it; v1 keeps both for safety. Open direction (NOT an open question of this ADR): when to retire the heuristic — defer to a future task that surfaces a concrete motivator.

- **Audience-surface consumer (future).** The audience surface's lobby/operate split is M6/M7 work; when it lands it will consume the same event kind for its own auto-navigation. No protocol change required at that point.

- **Amendment-pass on ADR 0021**: optional. The event-envelope ADR doesn't pin per-kind timing semantics; the new kind is one more entry in the closed registry. The implementer makes the call based on whether the addition is structurally novel enough to warrant a backlink (it's not — `'session-mode-changed'` is structurally identical to `'session-created'` and `'session-ended'`; no envelope shape change, no projector pattern change). Default posture: no amendment-pass entry needed on 0021.

- **Open future direction (NOT an open question of this ADR)**: a third mode `'concluded'` may emerge if a product change introduces a "paused but not ended" state, or if the lifecycle modelling unifies with `'session-ended'`. At that point: widen the Zod enum, add a SQL migration to widen the CHECK constraint, write an amendment on this ADR documenting the new value. v1 explicitly does NOT pre-commit to a multi-mode lifecycle; the two-mode enum is the minimum sufficient surface.

## Stack-validation tests

The `participant_ui.part_graph_view.part_session_start_handoff_dedicated_event` task lands the executable validation:

- **Vitest** at `packages/shared-types/src/events.test.ts` pins the payload schema (valid happy path; rejects invalid enum value; rejects missing fields; rejects malformed `changed_at`).
- **Vitest** at `apps/server/src/projection/replay.test.ts` pins the projector arm (initial `currentMode` is `'lobby'`; after a `'session-mode-changed'` with `new_mode: 'operate'`, `currentMode` is `'operate'`; replay-order invariance).
- **Vitest** at `apps/server/src/sessions/routes.test.ts` pins the new endpoint (happy path; non-host → 403; ended-session → 422; invisible-session → 404; idempotent re-POST → 200 with no second event).
- **Vitest** at `apps/moderator/src/routes/InviteParticipants.test.tsx` pins the moderator-side fetch + navigate (fetch called with the right URL/method/credentials; navigates regardless of fetch outcome; does NOT fetch when `bothDebatersPresent` is false).
- **Vitest** at `apps/participant/src/routes/LobbyRoute.test.tsx` pins the participant-side predicate (primary trigger on `'session-mode-changed'` with `new_mode: 'operate'`; primary does NOT fire on `new_mode: 'lobby'`; fallback heuristic still fires on every `CONTENT_EVENT_KINDS` entry; primary takes precedence when both are present; exactly-once guard).
- **Cucumber** at `tests/behavior/backend/session-start.feature` pins the wire-path round-trip end-to-end through pglite — the GOLD-STANDARD protocol pin per ORCHESTRATOR.md.
- **Playwright** at `tests/e2e/participant-graph-render.spec.ts` (amended) drives the cross-route observable behaviour: the spec seeds `'session-mode-changed'` into the participant's WS store, asserts the URL flips to `/p/sessions/:id`, asserts the operate route mounts.

All tests are committed red-first then green per ADR 0022 (the implementer's failing-first verification is recorded in the task's Status block).
