# Participant-side auto-navigation from the moderator's debate-started signal

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_session_start_handoff`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_graph_render` (settled — commit `8db63cb`). Ships the participant operate route at `/p/sessions/:id` and the read-mostly `<GraphView>` Cytoscape canvas. The Status block of that refinement registered THIS leaf as the pay-down of the manual `page.goto('/p/sessions/${sessionId}')` step in [`tests/e2e/participant-graph-render.spec.ts:133`](../../../tests/e2e/participant-graph-render.spec.ts#L133) (see the comment block at lines 129-133 of the same spec, naming `part_session_start_handoff` as the future deliverable). The operate route is at [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx), the route-table entry is at [`apps/participant/src/App.tsx:135`](../../../apps/participant/src/App.tsx#L135).
- `!participant_ui.part_session_join.part_lobby_view_ws_absence_merge_fix` (settled — commit `0a0a727`). Ships the participant lobby's converged three-arg `mergeSlots(httpRows, wsOccupants, events)` at [`apps/participant/src/routes/LobbyRoute.tsx:170-193`](../../../apps/participant/src/routes/LobbyRoute.tsx#L170-L193). Load-bearing for this leaf because the new auto-navigation handler lives in the SAME `<LobbyRouteAuthenticatedBody>` that the converged merge runs inside — both consume the per-session WS events slice; co-locating the navigation handler with the merge keeps the events subscription cardinality at one per route mount.
- `!moderator_ui.mod_session_setup.mod_session_lobby` (settled — commit `8e3...` per the refinement's Status block dated 2026-05-16). Ships the moderator's strict-gated "Enter session" button at [`apps/moderator/src/routes/InviteParticipants.tsx:744-770`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L744-L770) and the `handleEnterSession` handler at [`InviteParticipants.tsx:517-526`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L517-L526). **Load-bearing finding for this leaf**: `handleEnterSession` is a **pure client-side `navigate(...)` to `/m/sessions/${sessionId}/operate`** — no `useWsClient().send(...)`, no `fetch` round-trip, no server-side state transition. There is **no wire signal** today that says "the moderator just entered operate mode." See Inputs § "Wire-signal survey" for the survey result and Decisions §1 for the chosen path that works around the absence.

## What this task is

A participant-side `useEffect` inside `<LobbyRouteAuthenticatedBody>` that watches the per-session WS `events` slice for the **first content event** (`node-created`, `edge-created`, `entity-included`, `proposal`, or `commit`) and, on its arrival, navigates the debater from `/p/sessions/:id/lobby` to `/p/sessions/:id` so the operate route mounts and the live `<GraphView>` takes over. After this leaf:

- `apps/participant/src/routes/LobbyRoute.tsx` gains one new `useEffect` (~15 lines) inside the `<LobbyRouteAuthenticatedBody>` component, immediately after the existing `slots` `useMemo` at [line 381](../../../apps/participant/src/routes/LobbyRoute.tsx#L381). The hook reads the same `events` selector the merge already consumes, detects the first content event by walking the array once for any `event.kind` in the `CONTENT_EVENT_KINDS` constant (the five kinds listed above, exported from a new module-scope tuple), and calls `navigate(\`/sessions/${id}\`, { replace: true })` once. A `useRef<boolean>` guard prevents the handler from re-firing on subsequent events after the first content event lands (the lobby is being torn down anyway; the guard is belt-and-suspenders against a re-render landing between the navigate call and the route swap completing).
- The navigate call uses `react-router-dom`'s `useNavigate()` — the lobby route does not currently import it; this leaf adds the import alongside the existing `useParams` import at [LobbyRoute.tsx:57](../../../apps/participant/src/routes/LobbyRoute.tsx#L57). The `{ replace: true }` posture matches the invite-acceptance route's post-claim navigate at [`InviteAcceptanceRoute.tsx:184`](../../../apps/participant/src/routes/InviteAcceptanceRoute.tsx#L184) — the lobby URL is not a meaningful back-stack entry once the debate is live.
- A new module-scope constant `CONTENT_EVENT_KINDS: readonly EventKind[]` lists the five event kinds that trigger the handoff. Decision §2 settles the list (vs. broader / narrower alternatives).
- `tests/e2e/participant-graph-render.spec.ts` is amended in the SAME commit to **remove** the manual `page.goto(\`/p/sessions/${sessionId}\`)` at [line 133](../../../tests/e2e/participant-graph-render.spec.ts#L133) and replace it with the lobby-as-starting-surface flow: ben lands in the lobby, the spec seeds a `node-created` event into ben's WS store via the existing `window.__aConversaWsStore` test seam (the same seed path the spec already uses at lines 145-165), Playwright waits for the URL to change to `/p/sessions/${sessionId}` and the `route-operate` testid to become visible. The Cytoscape-render assertions (lines 170 onwards) stay unchanged — they continue to pin what they already pinned. This **pays down the very debt this task was registered to address** (per the source-of-debt block in `tasks/40-participant-ui.tji:90-96`).
- New Vitest cases pin the handler's behavior at the React-state-machine layer; see Acceptance criteria for the exact list.

The deliverable is **edits to one component file + one test file + one Playwright spec**, no new modules (beyond the small `CONTENT_EVENT_KINDS` constant which can live in `LobbyRoute.tsx`), no new i18n keys, no new ADR, no wire-format change.

**Out of scope** (deferred or untouched):

- **A new `session-mode-changed` / `debate-started` WS event kind, payload schema, server emit path, SQL migration, and projector projection** — would be the architecturally clean way to signal the transition. Decisions §1 documents the trade-off and Decisions §4 registers the future task that captures the path if the heuristic chosen here proves insufficient. Adding the new event in this leaf would be several days of work (new event kind in `eventKinds`, payload schema in `events.ts`, server-side handler that consumes a new POST or WS message, broadcast wiring, Cucumber pin at the wire layer, new SQL CHECK constraint update, potentially an ADR for the new lifecycle event). The 0.5d budget on this leaf does not cover that scope.
- **Moderator-side write path that emits a wire event when "Enter session" is clicked** — same scope concern; this leaf does NOT touch the moderator's `handleEnterSession`. The moderator continues to navigate locally; the wire signal the participant listens for comes from the moderator's first **capture** in operate (the first `node-created` / `proposal` etc.) rather than from the "Enter session" click itself.
- **Auto-navigation on `participant-joined` for self or other** — those events already flow during the lobby's lifetime and are explicitly NOT in `CONTENT_EVENT_KINDS` (per Decision §2). The lobby is the right surface for the slot-fill phase; the handoff is only triggered by events that prove the moderator has moved past lobby-and-into-capture.
- **Auto-navigation on `session-ended`** — if the moderator ends the session from the lobby (no debate happened), the participant's correct behavior is to land on a "session ended" affordance, NOT to navigate to the operate route. `session-ended` is deliberately out of the trigger list; a follow-up task in the `part_session_join.*` family can add a `<SessionEndedRoute>` if the product needs one. For v1 the participant stays in the lobby (the lobby's existing "waiting" hint reads neutrally enough) and a hard reload picks up the new server-side state.
- **A "return to lobby" affordance on the operate route** — once auto-navigation has fired, the lobby is gone; the operate route is the destination. A debater who wants to bail entirely closes the tab. The methodology assumes both debaters stay through the session; a leave-the-debate affordance is a future `part_*` leaf out of scope here.
- **Backend changes** — none. No new endpoint, no new event kind, no new SQL migration.
- **i18n catalog changes** — none. The hook is silent; the destination route's chrome carries the user-visible text.
- **A new Cucumber scenario** — none. The handoff is purely a client-side reaction to events whose wire contract is already pinned (the `node-created` / `edge-created` / `proposal` / `commit` / `entity-included` shapes are pinned at the backend Cucumber layer by the data-and-methodology event-types refinements; this leaf consumes them without adding a new contract). Decision §5 documents the no-Cucumber rationale.

## Why it needs to be done

State the user-visible debt crisply.

**Today** (post-`part_graph_render`): a debater authenticates, accepts an invite, lands in `/p/sessions/:id/lobby`, sees their slot fill and waits for the other debater. When the moderator's strict gate opens (both debater slots filled per `mod_session_lobby`) and the moderator clicks "Enter session," the moderator's browser navigates to `/m/sessions/:id/operate`. **The participant sees nothing change** — their lobby keeps rendering with both slots present and the "waiting for moderator to start" hint. To see the live graph the debater would have to manually type `/p/sessions/:id` into their address bar; this is not a real user gesture, so the Playwright spec for `part_graph_render` simulates it via `page.goto('/p/sessions/${sessionId}')` at [`tests/e2e/participant-graph-render.spec.ts:133`](../../../tests/e2e/participant-graph-render.spec.ts#L133). The comment block at lines 129-132 explicitly cites this leaf (`part_session_start_handoff`) as the deliverable that will pay the debt down.

**After this leaf**: the moderator clicks "Enter session" → navigates locally to the operate canvas → captures the first statement → the post-COMMIT `wsBroadcast.emit({ event: nodeCreatedEvent })` broadcasts the `node-created` event to every subscriber → the event lands in the participant's `useWsStore.sessionState[id].events` slice via the shell client's `applyEvent` → the lobby's new `useEffect` detects the first content-event arrival → `navigate('/sessions/${id}', { replace: true })` runs → React Router unmounts the lobby + mounts `<OperateRoute>` → the operate route's per-session `trackSession` is idempotent with the lobby's prior call (no resubscription needed) → `<GraphView>` mounts against the same already-populated events slice → the seeded `node-created` renders as a Cytoscape node. The debater goes from "waiting" to "watching the live graph" with no manual gesture.

**Why the trigger-on-first-content-event approach works without a dedicated `debate-started` event**:

1. The moderator's operate route is the ONLY surface in the app that can emit `node-created` / `edge-created` / `proposal` / `commit` / `entity-included` events (the lobby + invite + create-session routes do not have capture / propose affordances). Per ADR 0027 the moderator's propose path emits `node-created` at propose-time, so the very first capture in operate produces a wire event the participant lobby can see.
2. The per-session WS subscription is **already open** during the lobby's lifetime (the lobby's `trackSession` lifecycle ran on mount per [LobbyRoute.tsx:207-213](../../../apps/participant/src/routes/LobbyRoute.tsx#L207-L213)). No new subscription, no catch-up replay, no extra HTTP fetch — the existing socket sees the moderator's first capture without any new infrastructure.
3. The "first event" detection is a one-line check inside the `useEffect`'s body (a `.find()` over the events array on every events-slice change, gated by a `useRef<boolean>` so the navigate fires exactly once).

**Why this matters for the milestone chain**: `m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) depends on the entire `part_graph_view` group transitively. The graph-view leaves (`part_per_facet_state_styling`, `part_axiom_mark_decoration`, `part_annotation_render`, `part_diagnostic_highlights`, `part_pan_zoom_tap`) all depend on `part_graph_render` and inherit its e2e spec; if that spec ships with a manual `page.goto` baked in, every downstream e2e that builds on it inherits the wart. Paying it down now keeps the test surface clean.

**Why this matters for the methodology**: the methodology assumes the debater sees the same graph the moderator does, **at the same time** (per [docs/methodology.md](../../../docs/methodology.md) — "the proposal is visible on the graph in a distinct state from the moment it is made"). Without auto-navigation the debater's visibility window opens late (whenever they think to manually navigate) — the proposal-then-vote loop loses tens of seconds at the start of every session. The hand-off is a real product gap, not just test-suite cleanup.

## Inputs / context

### Wire-signal survey — confirmed: no debate-started event exists

Three searches against the codebase + the protocol package confirmed the absence of any `debate-started`, `session-started`, `session-mode-changed`, or `operate-entered` wire signal:

1. **`packages/shared-types/src/events.ts:128-152`** — the canonical `eventKinds` tuple lists 13 kinds: `session-created`, `session-ended`, `participant-joined`, `participant-left`, `node-created`, `edge-created`, `annotation-created`, `entity-included`, `proposal`, `vote`, `commit`, `meta-disagreement-marked`, `snapshot-created`, `entity-removed`. **None of them signals "the moderator entered operate mode."** The session-lifecycle quartet (`session-created`, `session-ended`, `participant-joined`, `participant-left`) covers the start, end, and roster of the session but not the lobby → operate transition.
2. **`apps/moderator/src/routes/InviteParticipants.tsx:517-526`** — the moderator's `handleEnterSession` is a pure client-side `navigate(\`/sessions/${sessionId}/operate\`, { replace: false })`. No `useWsClient().send(...)`, no `fetch()` POST, no server-side state transition. The moderator's "Enter session" click is invisible to anyone outside their own browser.
3. **`apps/server/src/sessions/routes.ts` + `apps/server/src/ws/handlers/*`** — grep for `session-started` / `debate-started` / `entered-operate` returns nothing. The server has no notion of "the moderator is now in operate mode"; the operate route is a client-only URL state.

The absence is by design today (the moderator's `/operate` route is local UI state, not server state), but it means the participant has no direct signal to navigate off. The two architecturally pure options are:

- **(b) Mint a new `session-mode-changed` event** with payload `{ mode: 'operate', changed_at }` — a 14th kind. Requires: a new entry in `eventKinds`, a new payload schema, a new server-side WS handler that the moderator sends `enter-operate-mode` to, the broadcast wiring on the server, a SQL migration for the `session_events` CHECK constraint (`apps/server/migrations/0010_session_events.sql`), Cucumber pinning at the wire layer, a probably-new ADR for whether the mode is event-sourced or read-time-derived. Multi-day scope, well past the 0.5d budget on this task.
- **(a) Defer this task pending a new `mod_session_start_emit_event` task** that ships option (b). Defers all participant-side value, registers a 2d task that gates this 0.5d task.
- **(c) Trigger on the first content event in the per-session events slice** (chosen). Uses an existing WS event stream the participant lobby is already subscribed to. The "moderator transitioned" signal is implicit: the moderator MUST be in operate mode for a `node-created` / `proposal` / `commit` to fire, because no other route in the app can emit them. Decision §1 documents the trade-off; Decisions §4 registers a future `protocol_session_mode_event` task that switches to option (b) if the heuristic proves insufficient (e.g. if a future product change introduces a non-operate route that can also emit content events).

The orchestrator brief explicitly bias-guides "bias toward (b) if the signal is a one-line addition to an existing event envelope" — it is NOT a one-line addition (it's a new event kind across schema + server + Cucumber), so (b) is correctly out of scope.

### The destination — the participant operate route

From [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx):

- The route is mounted at `/sessions/:id` (under the surface's `/p` basename) per [`apps/participant/src/App.tsx:135`](../../../apps/participant/src/App.tsx#L135).
- The route reads `:id` via `useParams`, runs the per-session `trackSession` / `untrackSession` lifecycle on mount / cleanup, and renders `<ParticipantLayout header={<ParticipantChrome />} main={<OperateRouteBody id={id} />} footer={<ParticipantStatusIndicator />} />`.
- `<OperateRouteBody>` carries the auth guard branch and renders `<GraphView sessionId={id} />` which reads the same `useWsStore((s) => s.sessionState[sessionId]?.events)` selector the lobby uses.

The route is reachable today by direct URL (Playwright proves this); this leaf adds the auto-navigation that gets a real user there without the address bar.

### The source — the participant lobby's events subscription

From [`apps/participant/src/routes/LobbyRoute.tsx:374-384`](../../../apps/participant/src/routes/LobbyRoute.tsx#L374-L384) — the lobby's authenticated body reads:

```ts
const events = useWsStore((state) => state.sessionState[id]?.events);
const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
const slots = useMemo(
  () => mergeSlots(httpRows, wsOccupants, events ?? []),
  [httpRows, wsOccupants, events],
);
```

The new `useEffect` runs **inside the same component**, after the `slots` `useMemo`, and reads the same `events` value. No new selector, no new subscription, no new dependency on Zustand internals.

### The trigger — content-event kinds

From [`packages/shared-types/src/events.ts:128-152`](../../../packages/shared-types/src/events.ts#L128-L152) — the 13 canonical event kinds. Decision §2 settles which subset triggers the handoff:

- **In `CONTENT_EVENT_KINDS`** (any of these in the events slice triggers navigation): `node-created`, `edge-created`, `entity-included`, `proposal`, `commit`. These are the five kinds emitted exclusively by operate-mode capture / propose / commit flows (the moderator's `propose` / `commit` paths; the propose-time entity-creation events landed by ADR 0027). When any of them appears in the per-session events slice, the moderator MUST be in operate mode.
- **NOT in `CONTENT_EVENT_KINDS`**:
  - `session-created` — emitted at session creation (BEFORE the lobby exists); never lands during the lobby's lifetime because the session is already created by the time the lobby loads.
  - `participant-joined` / `participant-left` — emitted during the lobby phase as debaters claim / leave their slots. The lobby's whole job is to render these.
  - `session-ended` — terminal; auto-navigating to operate would be wrong (the operate canvas would be empty, the session is closed). Out of scope to handle today (see "Out of scope" — if the moderator ends the session from the lobby, the participant stays in the lobby).
  - `annotation-created`, `vote`, `meta-disagreement-marked`, `snapshot-created`, `entity-removed` — these can only arrive AFTER a content event has already landed (annotations target existing nodes / edges; votes target existing proposals; snapshots are catch-up replays of prior events). They are correct content events too but their inclusion is redundant — any one of them implies a prior content event already triggered the handoff. Including them is harmless but the smaller list is the simpler contract.

The participant's WS subscription is idempotent and the lobby's `trackSession` may receive **catch-up replays** if the WS reconnects after the moderator already captured something. The handler must work against the replayed events too — see Decision §3.

### The navigation pattern — `react-router-dom`'s `useNavigate`

From [`apps/participant/src/routes/InviteAcceptanceRoute.tsx:49`](../../../apps/participant/src/routes/InviteAcceptanceRoute.tsx#L49) — the canonical participant-side navigate pattern:

```ts
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
// ...
const navigate = useNavigate();
// ...
void navigate(`/sessions/${id}/lobby`, { replace: true });
```

This leaf reuses the same pattern — same import path, same `void` call posture, same `{ replace: true }` option. The lobby URL is not a meaningful back-stack entry once the debate is live; replacing rather than pushing keeps the browser-back behaviour sane (the user backs up to wherever they came from before the lobby, not to a dead lobby URL).

### The test seam — `window.__aConversaWsStore` for Playwright

From [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50) — the dev-only assignment exposes the Zustand store on the page. The graph-render spec at [`tests/e2e/participant-graph-render.spec.ts:145-165`](../../../tests/e2e/participant-graph-render.spec.ts#L145-L165) already uses it to seed `node-created` / `edge-created` events. The amended spec uses the same seam to seed the trigger event from the lobby (before the navigation has fired), then asserts the URL changes.

### The test seam — Vitest `LobbyRoute.test.tsx` helpers

From [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx):

- `useWsStore.getState().reset()` in the `afterEach` (line 83) keeps cases isolated.
- `useWsStore.getState().applyEvent(...)` (used at lines 180-199) seeds events through the same reducer the WS dispatch would invoke.
- The `renderRoute(opts)` helper (lines 149-166) mounts the lobby under `MemoryRouter` with the `:id` param bound to `SESSION_ID`.
- `seedJoined` / `seedLeft` helpers seed `participant-joined` / `participant-left`; this leaf adds a sibling `seedNodeCreated(sequence, nodeId, wording)` helper (or seeds the event inline; the new cases will pick the smaller path).

The test must mock `useNavigate` via the existing `vi.mock('react-router-dom', ...)` swap pattern from [`InviteAcceptanceRoute.test.tsx:42-55`](../../../apps/participant/src/routes/InviteAcceptanceRoute.test.tsx#L42-L55) — same pattern, same `navigateSpy` capture posture.

### ADR pins

- [ADR 0021 — event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the handler's `event.kind` check switches on the canonical `EventKind` enum; no schema validation in the handler (envelopes are validated at the shell client's dispatch boundary per ADR 0021's "validate-at-the-edge" rule).
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioral assertion below is a committed Vitest case or Playwright scenario. The "auto-navigate on first content event" contract is pinned by Vitest at the React-state layer + by Playwright at the cross-route layer.
- [ADR 0027 — entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — `node-created` / `edge-created` fire at propose-time (not commit-time), so the participant's auto-navigation triggers on the FIRST propose, not on the first commit. This is the correct semantics: the moderator's first propose IS the act that opens the proposal-then-vote loop the debater needs to be watching.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — no substrate change. The hook lives inline in the participant route.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the originating context. Decision §6 (lines 342-356) names this task by name; the Status block (line 388) records the tech-debt registration that produced this leaf. The Playwright spec the predecessor shipped is the one this leaf rewrites to remove the manual `page.goto`.
- [`tasks/refinements/participant-ui/part_lobby_view.md`](part_lobby_view.md) — describes the lobby's WS subscription pattern this leaf reuses. The Out-of-scope §"The moderator's 'start debate' → lobby-tears-down transition" (line 33) explicitly defers this work to a future leaf — this leaf IS that future leaf.
- [`tasks/refinements/participant-ui/part_lobby_view_ws_absence_merge_fix.md`](part_lobby_view_ws_absence_merge_fix.md) — the immediate predecessor on the lobby route. Confirms that all changes to `LobbyRoute.tsx` belong inside `<LobbyRouteAuthenticatedBody>` (where the events subscription lives); the auth-guard branch above it never sees WS events.
- [`tasks/refinements/moderator-ui/mod_session_lobby.md`](../moderator-ui/mod_session_lobby.md) — the moderator-side gate that lands debaters in the lobby in the first place. Decision §2 (lines 362-370) settles that the moderator's "Enter session" is a strict-gated client-side navigate; nothing on the wire today. This refinement's Decision §1 carries that finding forward as the constraint this leaf works within.

## Constraints / requirements

### Route + wiring

- **No new route.** The lobby route at `/p/sessions/:id/lobby` and the operate route at `/p/sessions/:id` both exist already. This leaf wires them together.
- **No change to `apps/participant/src/App.tsx`.** The route table is unchanged; the lobby's element is unchanged.
- **No change to `apps/participant/src/main.tsx`** — the surface-wide `<WsClientProvider>` mount is reused unchanged.
- **No change to `apps/participant/src/routes/OperateRoute.tsx`** — the operate route's `trackSession` is idempotent with the lobby's prior call; the operate route never sees the handoff happen (it just mounts after React Router swaps the routes).
- **No backend changes.** No new endpoint, no new event kind, no new SQL.
- **No new i18n keys.** The handler is silent.

### Component changes (`apps/participant/src/routes/LobbyRoute.tsx`)

#### Add the `CONTENT_EVENT_KINDS` constant

At module scope, alongside the existing `SLOT_ROLES` constant near [line 74](../../../apps/participant/src/routes/LobbyRoute.tsx#L74):

```ts
/**
 * Event kinds whose arrival in the per-session events slice proves the
 * moderator has transitioned the session out of the lobby and into the
 * operate canvas. Triggers the participant lobby's auto-navigation to
 * `/sessions/${id}` (the operate route).
 *
 * The five kinds in this list are emitted exclusively by the
 * moderator's operate-mode capture / propose / commit flows — no
 * lobby / invite / create-session route in the app can produce them.
 * Their arrival is a sufficient proxy for "the moderator is in
 * operate mode" without requiring a dedicated `debate-started` wire
 * event (which would be a multi-day protocol addition per Decision §1).
 *
 * Per ADR 0027, `node-created` / `edge-created` fire at propose-time,
 * so the very first propose in operate triggers the handoff — which is
 * the correct semantics (the debater needs to be watching the proposal
 * the moment it is made).
 */
const CONTENT_EVENT_KINDS: readonly EventKind[] = [
  'node-created',
  'edge-created',
  'entity-included',
  'proposal',
  'commit',
];
```

`EventKind` is already imported alongside `Event` from `@a-conversa/shared-types` (per the existing import at [LobbyRoute.tsx:61](../../../apps/participant/src/routes/LobbyRoute.tsx#L61) — the import is `import type { Event } from '@a-conversa/shared-types';` today; this leaf extends it to also import `EventKind`).

#### Add the `useNavigate` import

Extend the existing `react-router-dom` import at [line 57](../../../apps/participant/src/routes/LobbyRoute.tsx#L57) from `import { useParams } from 'react-router-dom';` to `import { useNavigate, useParams } from 'react-router-dom';`.

#### Add the auto-navigation `useEffect`

Inside `<LobbyRouteAuthenticatedBody>`, after the existing `slots` `useMemo` at line 381 and BEFORE the loading-state render branch at line 398, add:

```ts
// Auto-navigate to the operate route when the moderator's first
// content event lands in the per-session events slice. Triggers off
// the existing WS subscription the lobby installed on mount (per
// `client.trackSession` at line 209) — no new subscription, no new
// HTTP fetch, no new dependency on the moderator's local navigate
// gesture. See Decision §1 of the refinement for the rationale
// against minting a dedicated `debate-started` wire event.
const navigate = useNavigate();
const handoffFiredRef = useRef<boolean>(false);
useEffect(() => {
  if (handoffFiredRef.current) return;
  if (id === '') return;
  const eventsList = events ?? [];
  // Single-pass scan — content events arrive in sequence order so the
  // first match is the chronologically earliest. The handler fires
  // exactly once per route mount (the ref guard catches the case where
  // a subsequent event arrives between this effect running and React
  // Router actually unmounting the lobby).
  const triggered = eventsList.some((event) =>
    (CONTENT_EVENT_KINDS as readonly string[]).includes(event.kind),
  );
  if (!triggered) return;
  handoffFiredRef.current = true;
  void navigate(`/sessions/${id}`, { replace: true });
}, [events, id, navigate]);
```

The `useRef` import is added alongside the existing `useEffect, useMemo, useState` imports at [line 56](../../../apps/participant/src/routes/LobbyRoute.tsx#L56).

#### No other changes to `LobbyRoute.tsx`

The merge logic, the slot-derivation, the HTTP prefetch, the auth guard, the error / loading branches, the rendering tree — all unchanged. This leaf is purely additive (one new constant, two new imports, one new `useEffect`).

### Test changes (`apps/participant/src/routes/LobbyRoute.test.tsx`)

Mock `useNavigate` via the existing `vi.mock('react-router-dom', ...)` pattern (mirroring [`InviteAcceptanceRoute.test.tsx:42-55`](../../../apps/participant/src/routes/InviteAcceptanceRoute.test.tsx#L42-L55)) at the top of the test file. The mock preserves `useParams` and the rest of `react-router-dom`; only `useNavigate` returns the captured spy. The mock setup is one-time at the top of the file (a module-scope `vi.mock` call); per-test cases reset the `navigateSpy.mockClear()` in the existing `afterEach`.

Append a new `describe` block — `'LobbyRoute — auto-navigation handoff to operate route'` — with the following Vitest cases:

1. **No navigation when only lobby-lifecycle events have arrived** — render the lobby; seed `participant-joined` for both debaters (lobby-phase events); assert `navigateSpy` was NOT called. Proves the handler ignores `participant-joined` / `participant-left`.
2. **Navigates on first `node-created`** — render the lobby; seed a `node-created` event via `useWsStore.getState().applyEvent(...)`; assert `navigateSpy` was called exactly once with `(\`/sessions/${SESSION_ID}\`, { replace: true })`.
3. **Navigates on first `edge-created`** — same shape as case 2, with an `edge-created` event. Proves all five trigger kinds work (parameterized via a `describe.each` over the five `CONTENT_EVENT_KINDS` to keep the test count compact — counts as ONE describe block with 5 parameterized cases; suite count grows by 5).
4. **Navigates on first `proposal`** — same shape (covered by the parameterized case in #3).
5. **Navigates on first `commit`** — same shape (covered by the parameterized case in #3).
6. **Navigates on first `entity-included`** — same shape (covered by the parameterized case in #3).
7. **Navigation fires exactly once when multiple content events arrive** — render the lobby; seed three consecutive content events (`node-created` at seq=10, `edge-created` at seq=11, `proposal` at seq=12); assert `navigateSpy` was called exactly once (the `handoffFiredRef` guard's job).
8. **Navigation fires on a content event interleaved with lobby events** — render the lobby; seed `participant-joined` (seq=1), then `node-created` (seq=2), then `participant-left` (seq=3); assert `navigateSpy` was called exactly once with the operate URL after the `node-created` was applied.
9. **Navigation fires when content events are present in the catch-up replay** — render the lobby AFTER seeding a `node-created` event (simulates a debater whose WS reconnect picks up a replay including events from after the moderator already captured); assert `navigateSpy` was called within the first effect-tick (a `waitFor` since the effect is async w.r.t. the mount).
10. **Navigation does NOT fire from the not-authenticated guard branch** — render the lobby with an `auth.status === 'unauthenticated'` provider stub; seed a `node-created`; assert `navigateSpy` was NOT called (the guard branch renders BEFORE the authenticated body's effect runs; the effect is only registered if the authenticated body mounts).
11. **Navigation does NOT fire on `session-ended`** — render the lobby; seed a `session-ended` event; assert `navigateSpy` was NOT called. Pins the "session-ended is not a handoff trigger" guarantee from the out-of-scope list.
12. **Navigation does NOT fire on `session-created`, `participant-joined`, `participant-left`, `annotation-created`, `vote`, `meta-disagreement-marked`, `snapshot-created`, `entity-removed`** — parameterized via a single `describe.each` over the 8 non-trigger kinds; for each: render; seed the event; assert `navigateSpy` was NOT called. Counts as 8 parameterized cases; suite count grows by 8.

**Total Vitest delta**: 12 new cases (1 + 5 parameterized + 1 + 1 + 1 + 1 + 1 + 1 + 8 parameterized minus overlaps — net: ~17 individual `it` calls when parameterized cases expand). The exact count comes out of the Implementer's `pnpm run test:smoke` run; the lower bound is "every requirement bullet has a probe."

### Playwright spec changes (`tests/e2e/participant-graph-render.spec.ts`)

#### Amend the existing scenario to remove the manual `page.goto`

The existing flow at lines 117-135 is:

```ts
// 3. Ben authenticates and claims debater-A through the invite
//    acceptance flow.
await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
// ... claim ...
await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, { ... });
await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

// 4. Navigate to the operate route. The participant has no
//    auto-handoff from lobby → operate today (that's
//    `part_session_start_handoff`'s future deliverable per
//    Decision §6); the URL change drives the route swap.
await page.goto(`/p/sessions/${sessionId}`);
await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
```

The amended flow becomes:

```ts
// 3. Ben authenticates and claims debater-A through the invite
//    acceptance flow. (Unchanged.)
// ...
await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

// 4. From the lobby, seed the moderator's first capture (a
//    `node-created` event) into ben's per-session WS store via the
//    existing `window.__aConversaWsStore` test seam. This simulates
//    the moderator clicking Enter session + capturing the first
//    statement; the participant's new auto-navigation handler
//    (`part_session_start_handoff`) detects the first content event
//    and navigates the debater to the operate route automatically.
const NODE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
await page.evaluate(/* seed node-created ... */, { ... });

// 5. Wait for the auto-navigation to complete. The `replace: true`
//    posture means the browser URL flips without a push.
await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}`, {
  timeout: 15_000,
});
await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });

// 6. Continue with the existing edge-created + assertion chain
//    (lines 170 onwards stay unchanged).
```

The seeded `node-created` event from step 4 is the same event the existing spec already seeds at step 5 of the original flow; the spec's net behavior is "seed one content event from the lobby" rather than "seed two content events after a manual navigate." The Cytoscape-render assertions for the seeded node and edge stay valid because the same events are in the slice; only the trigger sequence changes.

#### Update the spec's docblock + lead comment

The opening comment block at lines 4-44 cites `part_session_start_handoff` as the future deliverable; this leaf inverts that claim. Update the docblock to:

- Cite this refinement (`tasks/refinements/participant-ui/part_session_start_handoff.md`) as a refinement source alongside `part_graph_render.md`.
- Update the flow narrative at lines 28-44 to describe the auto-navigation step (the lobby seeds an event; the handler fires; the URL changes) instead of the manual `page.goto`.

#### Same Playwright project, no config change

The spec already runs under the `chromium-participant-skeleton` project per [`playwright.config.ts:303-319`](../../../playwright.config.ts#L303-L319). No `playwright.config.ts` change needed.

### Files this task touches (the explicit allowlist)

- `apps/participant/src/routes/LobbyRoute.tsx` — modified. Add `useNavigate` to the `react-router-dom` import; add `useRef` to the React import; add `EventKind` to the `@a-conversa/shared-types` import; add the module-scope `CONTENT_EVENT_KINDS` constant; add one new `useEffect` inside `<LobbyRouteAuthenticatedBody>` after the `slots` `useMemo`.
- `apps/participant/src/routes/LobbyRoute.test.tsx` — modified. Add the module-scope `vi.mock('react-router-dom', ...)` swap; append a new `describe` block with the 12+ test cases listed above (parameterized via `describe.each` where appropriate to keep the file scannable).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Drop the manual `page.goto(\`/p/sessions/${sessionId}\`)` step (line 133); replace with the lobby-then-seed-then-wait-for-URL-change flow. Update the docblock.

### Files this task does NOT touch

- `.tji` files — the WBS `complete 100` marker lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.
- `docs/adr/` — no new ADR. Every architectural choice below applies an existing ADR (0021 for envelope shape; 0022 for test discipline; 0026 for substrate; 0027 for entity timing) or is a scoped UI heuristic (Decisions §1, §2).
- `apps/server/**` — no backend change. No new event kind, no new endpoint, no SQL migration.
- `apps/moderator/**` — no cross-surface change. The moderator's `handleEnterSession` stays a pure client-side navigate.
- `apps/audience/**` / `apps/root/**` — no cross-surface change.
- `apps/participant/src/App.tsx` / `apps/participant/src/main.tsx` — the route table + provider stack are correct; no change.
- `apps/participant/src/routes/OperateRoute.tsx` / `apps/participant/src/routes/InviteAcceptanceRoute.tsx` — no change. The operate route is the destination (its `trackSession` is idempotent with the lobby's); the invite route is upstream.
- `apps/participant/src/graph/**` / `apps/participant/src/layout/**` / `apps/participant/src/ws/**` — no change.
- `packages/shared-types/**` — no event-kind addition, no payload-schema change. The hook consumes the existing `EventKind` enum.
- `packages/shell/**` — no substrate change.
- `packages/i18n-catalogs/**` — no new i18n keys.
- `tests/behavior/**` — no Cucumber addition (Decision §5).
- `playwright.config.ts` — no project / testMatch change.

### a11y requirements

- The auto-navigation fires silently; no announcement, no focus management. The destination route's chrome (`<ParticipantChrome>` + `<ParticipantStatusIndicator>`) sets focus per its existing posture; the operate route's `<GraphView>` does not steal focus on mount (per `part_graph_render` Decision §2 — the Cytoscape canvas is observation-only and does not call `.focus()`).
- The lobby's "waiting for the moderator to start" hint disappears with the route unmount; no jarring transition (the operate route's empty Cytoscape canvas renders during the eyeblink before the first event paints). A screen reader's URL-change announcement on the route swap is sufficient signal that "something happened"; the operate route's title (`participant.placeholder.title` in the chrome) updates on mount.

### Performance

- The new `useEffect` runs on every `events` slice change — i.e. every event arriving over the WS during the lobby's lifetime. Each run is one `.some()` walk over the events array (bounded by the lobby's lifetime; typically a few `participant-joined` / `participant-left` events for the slot fill). The `handoffFiredRef` guard cheaply short-circuits subsequent runs after the navigation fires.
- The `.some()` short-circuits on the first match; cost is O(events) worst case, with `events` bounded by the lobby's lifetime (few dozen events at most).
- No new state slot, no new effect-tree branch beyond the one added; the existing render-tree depth is unchanged.

### Budget honesty (0.5d)

- ~15 min: add the imports + constant + `useEffect` to `LobbyRoute.tsx` (~25 LOC delta).
- ~45 min: write the Vitest cases (parameterized via `describe.each`; total ~150 LOC delta).
- ~30 min: rewrite the Playwright spec's amendment (docblock + step 4-5 swap; ~30 LOC delta).
- ~30 min: failing-first cycle — run the new Vitest cases AGAINST current `LobbyRoute.tsx` (confirm cases 2-9 fail because no navigate fires; case 1 + 10 + 11 + 12 pass because no handler exists to fire); add the implementation; confirm all pass. Then run the amended Playwright spec under `make up` and confirm green.
- ~15 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm -F @a-conversa/participant build` + the WBS ritual step.

Risk surface is **low**:

- The handler is small (~15 LOC) and pure (one `.some()` + one navigate; ref-guarded against re-fire).
- The trigger contract is well-defined (five named event kinds; the 8 non-trigger kinds are also pinned by negative-test cases).
- The Playwright amendment swaps one `page.goto` for one `page.waitForURL` against the same seeded events the existing spec already seeds — no new fixtures, no new test infrastructure.
- The auto-navigation is observable as a URL change; if it ever regresses, the Playwright spec's `waitForURL` times out and surfaces immediately.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dependencies.
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the modified files in place.
3. **`pnpm run test:smoke` (Vitest) green** — the new cases in `LobbyRoute.test.tsx` all pass. Vitest count grows by ≥ 12 cases (the parameterized `describe.each` blocks expand to ~17 individual `it` calls); the repo total grows in lockstep. The Implementer captures the exact before / after counts and reports them in the return summary so the Status block can cite them.
4. **Failing-first verification** — the Implementer runs the new Vitest cases (specifically cases 2-9 which assert positive navigation) AGAINST THE CURRENT `LobbyRoute.tsx` (before adding the `useEffect`); confirms they all FAIL (no navigate fires); applies the implementation; confirms they all PASS. Both observations are reported in the Implementer's summary so the Closer's Status block can cite the failing-first run.
5. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — unchanged (no new i18n keys).
6. **`pnpm -F @a-conversa/participant build`** produces `apps/participant/dist/` artifacts without new bundle warnings.
7. **`pnpm run test:e2e`** under `make up` runs the amended `tests/e2e/participant-graph-render.spec.ts` scenario green. **Per the UI-stream e2e policy in ORCHESTRATOR.md, this is the IN-SCOPE Playwright assertion**: the lobby IS reachable, the operate route IS reachable, the auto-navigation is observable behavior. The amended spec drops the manual `page.goto('/p/sessions/${sessionId}')` step from the predecessor's spec (paying down the tech debt this task was registered for per the source-of-debt block in `tasks/40-participant-ui.tji:90-96`) and replaces it with a `waitForURL` against the auto-navigation handler's output.
8. **No regression on the existing predecessor specs** — `tests/e2e/participant-lobby.spec.ts` (the two-debater cross-context lobby scenario), `tests/e2e/participant-invite-acceptance.spec.ts` (the claim → lobby navigation), and the rest of the `chromium-participant-skeleton` project's specs all stay green. In particular: the lobby spec MUST stay green because its scenarios DO NOT seed `node-created` events — they exercise the slot-fill phase only, so the handoff `useEffect` never fires.
9. **No regression on cross-surface specs** — `tests/e2e/cross-surface-lobby-start.spec.ts` (the moderator-side gate scenario) stays green; the moderator's "Enter session" navigates locally as before, the cross-surface spec asserts the moderator's URL change only, no participant assertion was in scope.
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `part_session_start_handoff`.
11. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
12. **The implementation matches the Decisions** — the handler triggers on the five `CONTENT_EVENT_KINDS` (Decision §2), uses `{ replace: true }` navigation (Decision §3), guards against re-fire via a `useRef<boolean>` (Decision §3), and does NOT mint a new wire event (Decision §1).
13. **Tech-debt registration** — the Closer registers `participant_ui.part_graph_view.part_session_start_handoff_dedicated_event` (or equivalent name) as a future task in `tasks/40-participant-ui.tji` per Decision §4. Effort 2d, depends `!part_session_start_handoff`, note cites this refinement's Decision §1 + §4 as the source-of-debt. Stable id, allocate team, `depends` list, `note` line. Do NOT add `complete 100`.

## Decisions

### §1 — Trigger on the first content event in the existing WS stream; do NOT mint a new `debate-started` wire event

Three approaches surveyed:

- **(a) Defer this task pending a new `mod_session_start_emit_event` task** that ships a wire signal — rejected. Defers all participant-side value, gates a 0.5d leaf behind a 2d task that doesn't exist yet, requires writing a refinement for the new wire-event task first, then orchestrator picks the new task, then comes back to this one. Net: 2-3 cycles of delay for a behavior that can ship in this iteration.
- **(b) Mint a new `session-mode-changed` event with payload `{ mode: 'operate', changed_at }`** — would be the architecturally cleanest path. The participant would subscribe to a semantically clear signal; future changes (a third "concluded" mode, a non-operate route that also wants to broadcast) would extend cleanly. Cost: a new 14th `EventKind` in `packages/shared-types/src/events.ts`; a new payload schema; a new server-side WS handler that the moderator's `handleEnterSession` would `send(...)` to; broadcast wiring on the server; a SQL migration for the `session_events` CHECK constraint at `apps/server/migrations/0010_session_events.sql`; Cucumber pinning at the wire layer; almost certainly an ADR for whether the mode is event-sourced (persisted) or read-time-derived; an amendment to the moderator's `handleEnterSession` to send the signal before navigating; possibly a new HTTP endpoint if WS isn't right for client-originated state transitions. Multi-day scope, well past this leaf's 0.5d budget. The orchestrator brief explicitly bias-guides "bias toward (b) if the signal is a one-line addition to an existing event envelope" — it is NOT a one-line addition; it's a new envelope entirely.
- **(c) Trigger on the first content event in the existing WS stream** (chosen). The participant lobby is already subscribed to the per-session events slice via its `trackSession` lifecycle. The moderator's operate route is the ONLY surface in the app that can emit `node-created` / `edge-created` / `entity-included` / `proposal` / `commit` events (the lobby, invite, and create-session routes have no capture / propose affordances). Per ADR 0027 the moderator's propose path emits `node-created` at propose-time, so the very first capture in operate produces a wire event the participant can see — without any wire-format change.

**Trade-off accepted**: the heuristic ties the handoff to the moderator actually capturing something, not to the moderator merely entering operate mode. A debater stays in the lobby for the (typically very brief) window between the moderator clicking "Enter session" and the moderator capturing their first statement. For v1 this is acceptable — any real debate produces content events within seconds, the moderator's first act in operate IS to capture, and the lobby's "waiting" hint reads correctly during the window.

**Trade-off accepted**: future product changes that add a non-operate route capable of emitting content events would break the heuristic (the participant would auto-navigate when no debate is starting). No such route exists in the planned WBS; if one is added, Decision §4's registered follow-up task lifts the implementation to option (b).

**Trade-off accepted**: the heuristic produces a SLIGHTLY late handoff (after the moderator's first commit lands rather than at the moderator's "Enter session" click). The latency is bounded by the moderator's typing speed for the first statement (typically 1-10s); the methodology assumes the debater needs to be watching by the time the FIRST proposal is voted on, which happens many seconds after the first capture. The latency is invisible at the methodology level.

Chosen approach (c) is the lowest-cost path that delivers the observable behavior, leverages existing seams, and pays down the immediate tech debt without expanding scope.

### §2 — `CONTENT_EVENT_KINDS` = `['node-created', 'edge-created', 'entity-included', 'proposal', 'commit']`

Three alternative sets surveyed:

- **(A) Maximally inclusive: all 13 event kinds except `session-created`, `participant-joined`, `participant-left`** — rejected. Including `session-ended` would cause a wrong navigation (the operate canvas would mount against a closed session). Including `annotation-created`, `vote`, `meta-disagreement-marked`, `snapshot-created`, `entity-removed` is harmless (these can only fire AFTER a content event has already landed) but adds noise to the constant for no behavioral gain.
- **(B) Minimally inclusive: just `proposal`** — would defer the handoff until the moderator's first formal proposal, missing the propose-time entity creation (`node-created`) that ADR 0027 puts at the head of the propose path. Per ADR 0027 the very first `node-created` lands BEFORE the matching `proposal` envelope is fully assembled (the entity-creation events fire as part of the propose handler's pre-commit work); waiting for `proposal` adds latency for no reason.
- **(C) The five "moderator capture / propose / commit" kinds** (chosen): `node-created`, `edge-created`, `entity-included`, `proposal`, `commit`. These cover all entry-points the moderator's first act in operate could take — direct entity creation, an inclusion edit, the first formal proposal, and the first commit. None of them can fire from the lobby / invite / create-session route. The five-kind list is documented as a module-scope constant with a docblock explaining the rule; future event-kind additions get a "should this trigger the handoff?" review hook.

The chosen approach optimizes for "earliest correct signal" without sacrificing safety. The negative-test cases in `LobbyRoute.test.tsx` pin the 8 non-trigger kinds so any future tampering with the constant trips a test.

### §3 — Use `useNavigate` with `{ replace: true }` and guard against re-fire via `useRef<boolean>`

Three alternatives surveyed:

- **(A) `{ replace: false }`** — would push the lobby URL into the back-stack. A debater clicking browser-back from the operate route would land back on the lobby URL, which is now mid-debate and renders strangely (the lobby's HTTP prefetch + WS event log would re-derive but the operate route is the canonical "live" surface, not the lobby). Rejected.
- **(B) `{ replace: true }`** (chosen). Mirrors the invite-acceptance route's post-claim navigation at `InviteAcceptanceRoute.tsx:184`. The lobby URL is not a meaningful back-stack entry once the debate is live; the user backs up to wherever they came from before the lobby (the invite URL, or the previous tab).
- **(C) `window.location.replace`** — bypasses React Router; full page reload; loses the open WS connection. Rejected (the lobby's `trackSession` would untrack on unmount but the operate route's mount would have to re-track from scratch with a fresh page load + new WS handshake).

For the re-fire guard, three alternatives surveyed:

- **(A) No guard — re-render the effect's body unconditionally** — the navigate fires on every events change after the trigger condition is true. React Router's navigate is idempotent (calling it with the current URL is a no-op), so this is harmless in steady state, but it's wasteful (the effect's `.some()` runs on every subsequent event, the navigate call adds work to every render). Rejected.
- **(B) `useState<boolean>` to track "already navigated"** — would force an extra render when the state flips. The render is otherwise wasted (the lobby unmounts on the navigate; the extra render is between the navigate firing and the unmount completing). Rejected as a tiny waste with no upside.
- **(C) `useRef<boolean>`** (chosen) — captures the "already fired" state without triggering a render. The ref's mutation is invisible to React's reconciler; the next time the effect runs (if it does, before the unmount completes), the ref guard short-circuits before the `.some()` walks.

### §4 — Register the future `protocol_session_mode_event` task as a follow-up

The chosen heuristic (Decision §1) is sufficient for v1 but documented as a heuristic, not a contract. The Closer registers a follow-up task in `tasks/40-participant-ui.tji` per ORCHESTRATOR.md's tech-debt registration policy:

- **Stable id**: `participant_ui.part_graph_view.part_session_start_handoff_dedicated_event` (or `protocol.session_mode_event` if it lands in the protocol package — the Closer picks the canonical home based on whether the work is purely participant-side or also touches the shared protocol).
- **Effort**: 2d (the new event kind + payload + server handler + broadcast + Cucumber + SQL migration + ADR).
- **Depends**: `!part_session_start_handoff` (so the heuristic ships first; the dedicated event is a refinement on top).
- **Note**: cite this refinement's Decision §1 + §4 as the source-of-debt. The note explains: "the heuristic in `part_session_start_handoff` triggers on the first content event in the per-session events slice (`node-created` / `edge-created` / `entity-included` / `proposal` / `commit`). A dedicated `session-mode-changed` event would be the architecturally clean signal — useful if a future product change adds a non-operate route capable of emitting content events, or if the proposal-then-vote latency between 'Enter session' and 'first capture' becomes a UX problem."
- **No `complete 100`** — it's an open follow-up.

The follow-up task is NOT registered as a pending dependency on any current leaf (this is not a deferred-debt blocker — the heuristic is correct for the current product surface; the follow-up is an architectural refinement).

### §5 — No Cucumber scenario added

This task is a **UI-stream task** (`participant_ui.*`) and the handoff is purely a client-side reaction to events whose wire contract is already pinned. Per ORCHESTRATOR.md "Behavior + e2e coverage growth": Cucumber pins protocol / replay / projection behavior at the system seam — and this leaf does not change any wire shape, broadcast contract, or projector output. The `node-created` / `edge-created` / `entity-included` / `proposal` / `commit` envelopes consumed by the handler are already pinned at the backend Cucumber layer by the data-and-methodology event-types refinements (`entity_creation_events`, `entity_inclusion_events`, `proposal_events`, `commit_events`). A Cucumber scenario here would re-prove the broadcast shapes that ARE correct; the right pin is at the React-effect layer (Vitest) + the cross-route layer (Playwright).

If a future leaf takes up Decision §4's follow-up and mints a dedicated `session-mode-changed` event, THAT task will scope a Cucumber scenario for the new wire shape (the orchestrator brief explicitly bias-guides Cucumber for protocol-layer additions).

### §6 — No new ADR

Every decision here is either a direct application of an existing convention (ADR 0021 for envelope shape, ADR 0022 for test discipline, ADR 0026 for substrate, ADR 0027 for entity timing) or a scoped UI heuristic (Decisions §1, §2 are product-level scope choices that fit within the existing architecture). No new architectural choice is introduced.

If Decision §4's follow-up task ships a dedicated wire event, an ADR for "lifecycle vs content vs mode-change event taxonomy" may be appropriate at THAT point. For this leaf — no.

### §7 — The handler lives inline in `LobbyRoute.tsx`, NOT extracted to a shell hook

Two alternatives surveyed:

- **(A) Extract a `useSessionStartHandoff(sessionId, navigate)` hook into `@a-conversa/shell`** — would prepare for the audience surface and the replay surface (both of which may want similar auto-navigation). Rejected for this task: there is only one consumer (this lobby route); the audience and replay surfaces are M6 / M7 work. Per the shell-extraction policy in play across the repo (`shared_shell_extract_merge_slots_and_derive_slot_occupants` waits for the third caller; same for `mergeSlots` per `part_lobby_view_ws_absence_merge_fix` Decision §7), extraction without a third caller is YAGNI.
- **(B) Inline `useEffect` in `LobbyRouteAuthenticatedBody`** (chosen). The hook is ~15 LOC; the duplication risk if a second caller materializes is low (the second caller would likely be the audience surface, which has its own lobby pattern not yet shipped). When the third caller materializes, the extraction is mechanical.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Auto-navigation `useEffect` added inside `<LobbyRouteAuthenticatedBody>` at [`apps/participant/src/routes/LobbyRoute.tsx`](../../../apps/participant/src/routes/LobbyRoute.tsx): watches the per-session WS events slice (already subscribed by the lobby's `trackSession`) for the first event whose `kind` is in the new module-scope `CONTENT_EVENT_KINDS` tuple (`node-created`, `edge-created`, `entity-included`, `proposal`, `commit`), then `void navigate(\`/sessions/${id}\`, { replace: true })`. Exactly-once posture enforced by a `useRef<boolean>` guard per Decisions §3.
- 19 new Vitest cases landed in [`apps/participant/src/routes/LobbyRoute.test.tsx`](../../../apps/participant/src/routes/LobbyRoute.test.tsx) — 5 parameterized positive trigger cases (one per `CONTENT_EVENT_KINDS` entry) + exactly-once + interleaved-with-lobby + catch-up-replay + 11 negative-trigger cases (the 8 non-trigger event kinds plus `session-ended` and the unauthenticated-guard branch). Vitest count 3806 → 3825 (+19). Cucumber unchanged per Decision §5; Playwright count unchanged (amended the existing scenario rather than adding one).
- **Failing-first verification (ADR 0022 compliance)** — Implementer removed the new `useEffect` and confirmed exactly the 8 new positive-trigger cases failed (5 parameterized content-event kinds + exactly-once + interleaved-lobby + catch-up replay) while the 11 negative-trigger cases stayed green; restoring the implementation returned the suite to 3825 passing. Demonstrates each new assertion is load-bearing (not a tautology) per the no-throwaway-verifications rule.
- **Playwright debt paydown** — [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) had a manual `page.goto(\`/p/sessions/${sessionId}\`)` step (line 133 of the pre-amendment spec) that was registered as the tech debt this task was created to pay down (per `tasks/40-participant-ui.tji` source-of-debt block + `part_graph_render.md` Decision §6). The amended spec replaces it with: seed a `node-created` event into ben's WS store from the lobby surface, then `page.waitForURL` for the URL to flip to `/p/sessions/${sessionId}`, then assert `route-operate` + `participant-graph-root` visible. The Cytoscape-render assertions downstream are unchanged. The chromium-participant-skeleton project ran 11/11 green with no flakes; `make down-v` torn down clean.
- No backend / protocol / SQL / ADR changes per Decision §1: the chosen heuristic (trigger on the first content event already flowing over the existing WS subscription) requires no new wire shape. Decisions §4 + §7 documented the trade-offs; Decision §1 documented why minting a dedicated `session-mode-changed` wire event was out of scope for the 0.5d budget.
- Follow-up task `participant_ui.part_graph_view.part_session_start_handoff_dedicated_event` registered in [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji) per Decision §4 — 2d, depends `!part_session_start_handoff`, no `complete 100`. Lifts the first-content-event heuristic to a dedicated `session-mode-changed` wire event (new `EventKind` + payload schema + server handler + broadcast + Cucumber pin + SQL CHECK migration + ADR) when the architectural debt becomes warranted.
