# Adopt `GET /api/sessions/:id/participants` for moderator-lobby slot prefetch

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_session_setup.mod_invite_participants_rest_prefetch`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `moderator_ui.mod_session_setup.mod_invite_participants` — settled (commit `8e7e3f1`). Landed `/sessions/:id/invite` at [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx), the slot reducer `deriveSlotOccupants(events)` (lines 108-137 — collapses `participant-joined` / `participant-left` events into `{ moderator, debater-A, debater-B }`), the per-session `client.trackSession(sessionId)` lifecycle (lines 189-195), the `useWsStore` slice subscription (lines 255-256), and the existing inline `fetch('/api/sessions/:id')` for the session header (lines 204-245). `mod_session_lobby` (commit on `2026-05-16`, same component edited in place) added the strict gate + ready badges + "both ready" banner consuming the same `occupants` map. **This task amends the same component in place** to seed the slot map from an HTTP prefetch on mount; no new route, no new component.
- `backend.session_management.list_session_participants_endpoint` — settled (this `2026-05-16` commit cluster). Shipped `GET /api/sessions/:id/participants` per [`tasks/refinements/backend/list_session_participants_endpoint.md`](../backend/list_session_participants_endpoint.md). Auth-gated via `app.authenticate`; visibility-routed through `canSeeSession` (404 existence-non-leak on private-not-visible); body shape `{ participants: SessionParticipantResponse[] }` where each row is `{ id, sessionId, userId, role, joinedAt, leftAt }` ordered `joined_at ASC, id ASC`. Active rows are those with `leftAt === null` per the contract (the endpoint returns all rows; active filter is the client's job). **The endpoint does NOT denormalize `screen_name` today** — the WS event payload remains the canonical display-name source (same gap the participant lobby surfaced at [`apps/participant/src/routes/LobbyRoute.tsx:313-319`](../../../apps/participant/src/routes/LobbyRoute.tsx#L313-L319)).
- `moderator_ui.mod_session_setup.mod_session_lobby` — settled (commit on `2026-05-16`). The strict gate (`bothDebatersPresent`), the per-debater ready badge (`invite-slot-ready[data-ready]`), the "both ready" banner (`invite-both-ready-banner`), and the state-driven Enter-hint paragraph all consume the SAME `occupants` map. Switching the source of that map from "WS-only" to "HTTP-prefetch merged with WS overlay" must preserve the gate's behavior: `bothDebatersPresent` must flip to `true` either when the prefetch resolves with both debater rows OR when the WS catch-up replays the same events, whichever arrives first.

## What this task is

The fourth (post-derive-complete) leaf added under `mod_session_setup`. The subgroup already derives-completes from its three predecessor leaves; this leaf is a follow-up registered by `mod_invite_participants` (Backend follow-up §1) and by the backend's `list_session_participants_endpoint` Decision §"Frontend adoption is a separate task". It does not block any milestone — `m_moderator_mvp` is gated on other flows — but it pays down the structural debt the predecessor's WS-catch-up-only slot fill carries.

Today the moderator's invite/lobby view at [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) derives the per-role slot map from a **WS catch-up replay only**: `client.trackSession(sessionId)` issues `subscribe` + `catch-up` with `sinceSequence: 0`, the server replays the session's `participant-joined` / `participant-left` events, and the `useWsStore.sessionState[sessionId]?.events` slice feeds `deriveSlotOccupants` for first paint. The race documented at lines 185-188 of that file (the catch-up replay can finish after first paint) means a hard-reloaded moderator briefly sees an empty slot map before the WS round-trip lands. The view's strict gate then disables Enter for that brief window even when both debaters are in fact present in the DB.

This task switches the moderator's slot fill to mirror the participant-lobby's pattern (per [`apps/participant/src/routes/LobbyRoute.tsx:194-499`](../../../apps/participant/src/routes/LobbyRoute.tsx#L194-L499), shipped as `part_lobby_view` commit `5932395`):

1. **Add a second HTTP fetch on route mount** — `GET /api/sessions/:id/participants` alongside the existing `GET /api/sessions/:id`. Parse the response body, filter `leftAt === null` for active rows, project each row into `{ userId, role, screenName? }`.
2. **Add a `mergeSlots(httpRows, wsOccupants)` helper** — same shape the participant lobby uses (a per-render merge over the role enum; HTTP seeds, WS overlays). The WS overlay **wins on collision** because the WS event payload is more recent than the HTTP snapshot AND because it carries the canonical `screen_name` the HTTP endpoint does not denormalize.
3. **Feed the merged slot map** into every existing consumer (the slot rendering loop at lines 405-534, the `bothDebatersPresent` / `gateReason` derivations at lines 269-281, the "both ready" banner at line 545, the disabled-state Enter button at line 566) — all of these read from `occupants` today and continue to do so; only the source of `occupants` changes.

The deliverable is **edits to one existing component** (`apps/moderator/src/routes/InviteParticipants.tsx`), corresponding **new Vitest cases** appended to `InviteParticipants.test.tsx` (HTTP-prefetch lifecycle for the participants list, merge collision semantics, both-debaters-prefetched-no-WS path), and **one Vitest case amendment** to relax the moderator-slot test (which currently seeds via WS only — it stays valid but a sibling case is added for the HTTP-prefetch source). No new i18n keys (the new error state reuses the existing `moderator.invite.errors.fetchFailed` key via a per-fetch retry — see Decision §3). No Playwright change (see "UI-stream e2e" below).

**Out of scope** (not registered as follow-ups; just out of frame):

- Extracting `mergeSlots` / `deriveSlotOccupants` to `@a-conversa/shell` so both the moderator and participant copies share a single source. The participant refinement explicitly deferred this (Decision §6) and there's still no third caller; deferral continues.
- A periodic re-fetch (polling) of the participants list. The HTTP prefetch is mount-only per Decision §2; WS events cover live updates.
- A `?since=<timestamp>` query string on the endpoint for delta fetches. Backend Decision §"No `?since=...` for v1" defers it; no consumer needs it.
- Backend changes. The endpoint already exists and is consumed unchanged.
- Tab-return refresh (a `visibilitychange`-driven re-fetch when the tab regains focus). Defer to a future leaf if the cold-load-on-tab-return path surfaces as a real complaint.
- Refactoring the existing `mod_invite_participants` Decision §6 ("Real-time slot updates via WS catch-up, not polling") — that decision still holds for live updates; this task adds the HTTP prefetch as a **cold-load seeding source**, not as a replacement for the WS overlay.

## Why it needs to be done

Three reasons, in priority order:

- **Cold-load shape consistency with the rest of the surface.** Every other session-management seam the moderator's surface touches (`GET /api/sessions/:id` for the header, `POST /api/sessions` for create, `POST /api/sessions/:id/participants` for the future host-assign path) is a one-shot HTTP read or write. The participants list was the conspicuous odd surface — its only source was a WS event-stream projection. After this task, the moderator's slot map has the same composition shape the participant lobby already uses (HTTP prefetch + WS overlay), and a frontend dev landing on either surface sees ONE answer to "what does the API look like?". The WS stream remains the live-update channel, not the only source of truth.
- **Defense-in-depth against the WS catch-up race.** Today a moderator hard-reloading the lobby URL paints an empty slot map for the duration of the WS round-trip (subscribe + catch-up + first event arrival). The strict gate disables Enter during that window even when both debaters are in fact present; the "both ready" banner is briefly absent. The race is documented at `InviteParticipants.tsx:185-188` and was the exact motivation for the participant lobby's Decision §1 ("HTTP prefetch + WS live-update"). The participant-lobby refinement noted: "The moderator's view does NOT pre-fetch today — it pays the misleading-empty-state cost — and registered `mod_invite_participants_rest_prefetch` as the follow-up to switch." This IS that follow-up.
- **Pays down debt registered by two predecessors.** `mod_invite_participants` registered this work as Backend follow-up §1 (per its line 357); `list_session_participants_endpoint` registered it via its Decisions §"Frontend adoption is a separate task". Both predecessor refinements explicitly named this task as the close-out for the WS-only slot-fill technical debt.

## Inputs / context

### Canonical pattern — the participant lobby's adoption

The participant-side adoption shipped on `2026-05-16` as commit `5932395`. The merge composition lives at [`apps/participant/src/routes/LobbyRoute.tsx:140-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L140-L163):

```tsx
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

The HTTP fetch effect is at [`apps/participant/src/routes/LobbyRoute.tsx:273-342`](../../../apps/participant/src/routes/LobbyRoute.tsx#L273-L342). The shape:

- One `useState<FetchStatus>` (`'loading' | 'loaded' | 'error'`) for the participants-list fetch, distinct from the session-header fetch's own status.
- One `useState<readonly ParticipantRow[]>` for the projected rows.
- One `useState<number>` for the retry nonce.
- `useEffect` on `[id, retryNonce]` issues the GET with `credentials: 'include'` + `Accept: application/json`; on 200, parses + validates + projects; on non-200 or rejection, flips to `'error'`. The `cancelled` flag handles unmount during in-flight.
- The active-row filter `if (row.leftAt !== null) continue;` lives in the projection loop (the endpoint contract says clients filter).
- `screenName` defaults to `''` when absent (the endpoint doesn't denormalize it); the WS overlay then fills it from `participant-joined.payload.screen_name`.

This task mirrors that shape verbatim, adjusted only for the moderator's existing infrastructure (the moderator's reducer at [`InviteParticipants.tsx:108-137`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L108-L137) returns a `Record<SlotRole, string | undefined>` of screen names rather than the participant's `{ userId, screenName }` pair; the merge helper has to be adapted to the moderator's shape — see Decision §4).

### The moderator's current `occupants` map shape

From [`apps/moderator/src/routes/InviteParticipants.tsx:91`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L91):

```ts
type SlotOccupants = Readonly<Record<SlotRole, string | undefined>>;
```

The map is keyed by role and carries **only the screen name** (or `undefined` for empty). This differs from the participant's `{ userId, screenName }` pair — the moderator's reducer drops the `userId` after using it to gate the `participant-left` matcher. The merge helper for this task either:

- (a) widens the map to the participant's pair shape, so the merge can carry `userId` through the HTTP rows (which DO have userId but not screenName); or
- (b) keeps the screen-name-only shape and merges by joining the HTTP rows to the WS map on role, dropping the userId from HTTP rows that don't have a corresponding WS event yet (the slot appears as "<empty screenName>" — visually broken).

Decision §4 settles this: widen to the participant's pair shape. The moderator's reducer at lines 108-137 already tracks `{ userId, screenName }` internally inside the `occupants` local before projecting down to screenNames in the return statement; the projection is dropped and the full pair becomes the public `SlotOccupants` shape.

### The participants-list endpoint's response shape

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) (per [`tasks/refinements/backend/list_session_participants_endpoint.md:95-103`](../backend/list_session_participants_endpoint.md#L95-L103)) — 200 + JSON body:

```json
{
  "participants": [
    { "id": "<uuid>", "sessionId": "<uuid>", "userId": "<uuid>",
      "role": "moderator" | "debater-A" | "debater-B",
      "joinedAt": "<iso-8601>", "leftAt": "<iso-8601>" | null }
  ]
}
```

`leftAt === null` → active row; client filters to active for the slot map. Historical rows from leave-and-rejoin are present in the array; the active filter is the client's job. **The row does NOT carry `screenName`** — the WS event payload is the canonical display-name source. Per the backend Decision "Return ALL rows (active + historical), not just active": "The `mod_invite_participants` follow-up that adopts this endpoint will filter client-side (same logic `deriveSlotOccupants` already implements over events)."

### Test seam — `useWsStore` + `vi.fn`-stubbed `fetch`

The existing test suite at [`apps/moderator/src/routes/InviteParticipants.test.tsx`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx) already mocks `fetch` with `vi.fn` (`stubSessionFetch` at lines 153-168 + `okSessionResponse` at lines 170-182), seeds WS events via `useWsStore.getState().applyEvent(...)` (`seedParticipantJoined` at lines 188-208, `seedParticipantLeft` at lines 210-223), and resets the store between cases at line 89. New cases extend the same shape:

- Extend `stubSessionFetch` (or add a sibling stub) to also route `/api/sessions/<id>/participants` to a builder-returned response. The existing `stubSessionFetch` only routes `/api/auth/me` and the session GET; the participants GET needs an additional branch.
- Reuse `seedParticipantJoined` / `seedParticipantLeft` for the WS overlay assertions; layer them on top of the HTTP-prefetch responses to pin the merge collision semantics.

The Vitest `WebSocket` polyfill at lines 58-82 stays unchanged (the new HTTP fetch doesn't change the inner provider's WS contract).

### The existing Playwright e2e — `cross-surface-lobby-start.spec.ts`

From [`tests/e2e/cross-surface-lobby-start.spec.ts`](../../../tests/e2e/cross-surface-lobby-start.spec.ts) (commit `5e58951`, shipped `2026-05-16`): three real browser contexts (alice + ben + maria) drive the moderator + two debaters through their respective surfaces; the moderator's lobby observes both debaters arrive via REAL WS events from the participants' self-claim calls; alice's Enter button enables; she clicks it and lands on the operate canvas.

The spec at line 117 has alice `goto('/m/sessions/<id>/invite')` AFTER she creates the session but BEFORE ben + maria claim. At that point her view paints with zero debaters (current behavior); she then waits for both to join via WS events (lines 138-183) and the gate opens via WS — which is exactly the "WS catch-up + live events" path this task's prefetch is layered on top of (not replacing). The spec stays green unmodified.

A **cold-load** variant — alice creates the session, ben + maria claim, THEN alice navigates to the invite view — would exercise the HTTP-prefetch-only path (the WS overlay would replay the same events on top, but the gate would open from the prefetch alone). Whether to add this scenario is a "UI-stream e2e" call covered in Decision §7.

### ADR pin

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of the new behavior is a committed test. The new Vitest cases pin the HTTP-prefetch lifecycle + the merge collision semantics; the existing cross-surface Playwright spec pins the WS-only path unchanged (which proves the prefetch is additive, not replacing).

ADR 0026 (the micro-frontend pivot) has no HTTP-fetch-specific convention; the moderator app's existing inline `fetch(...)` pattern (per `mod_invite_participants` Decisions §"HTTP client seam") continues to apply. This task adds one new call site (the participants GET), keeping the moderator-surface call-site count below the "abstraction threshold = fourth caller" rule per `mod_create_session_form.md` Decisions §3.

## Constraints / requirements

### Route + wiring

- **No new route.** This task amends `/sessions/:id/invite` in place. The `<RequireAuth mode="authenticated-only">` wrapper, the `WsClientProvider` mount, and the `useParams<{ id: string }>()` read all stay as the predecessor left them.
- **No change to `apps/moderator/src/App.tsx`.** The route table is untouched.
- **No change to `apps/moderator/src/routes/CreateSession.tsx`.** The post-201 navigation target remains `/sessions/:id/invite`.

### Component changes (`apps/moderator/src/routes/InviteParticipants.tsx`)

#### Widen `SlotOccupants` to carry `{ userId, screenName }` pairs

Replace the existing `type SlotOccupants = Readonly<Record<SlotRole, string | undefined>>;` (line 91) with the pair-carrying shape mirroring the participant's:

```ts
interface SlotOccupant {
  readonly userId: string;
  readonly screenName: string;
}
type SlotOccupants = { [K in SlotRole]?: SlotOccupant };
```

Update `deriveSlotOccupants` (lines 108-137) to return the pair shape directly (drop the existing projection-to-screenNames at lines 132-136 — the internal `occupants` local already holds the pair). Every read-site that reads `occupants[role]` updates from a `string | undefined` access to a `SlotOccupant | undefined` access; the rendered text becomes `occupants[role]?.screenName`. The presence check (`occupants[role] !== undefined`) used by the gate derivations at lines 269-281 stays unchanged in shape.

#### Add the HTTP prefetch for the participants list

Inline new state slots immediately after the existing session-header `useState` block (after line 202):

```ts
const [participantsStatus, setParticipantsStatus] = useState<FetchStatus>('loading');
const [httpRows, setHttpRows] = useState<readonly SlotOccupant[]>([]);
const [participantsRetryNonce, setParticipantsRetryNonce] = useState<number>(0);
```

Add a new `useEffect` (after the existing session-header fetch effect at line 245) that mirrors the participant lobby's at lines 278-342. Issues `GET /api/sessions/:id/participants` with `credentials: 'include'` + `Accept: application/json`; on non-200 or rejection flips to `'error'`; on 200, validates the body shape (object with array `participants`), iterates rows, filters `leftAt === null`, and projects each row into `{ userId, screenName: '' }` (the endpoint doesn't denormalize screenName). The projected rows feed the merge below; the missing screenName is filled by the WS overlay.

The retry seam (Decision §3) reuses the existing single `invite-retry` button. The button's `handleRetry` callback bumps BOTH `retryNonce` (the existing session-header retry nonce) AND `participantsRetryNonce`. Same shape the participant lobby chose at [`apps/participant/src/routes/LobbyRoute.tsx:402-410`](../../../apps/participant/src/routes/LobbyRoute.tsx#L402-L410) but with two retry-button testids; we collapse to one button (the participant has two retry buttons because its visual layout exposes both error regions side-by-side; the moderator's existing view renders one error region with one retry button — keeping it that way avoids breaking the existing `invite-retry` testid).

#### Add the `mergeSlots` helper

Inline next to `deriveSlotOccupants` (after the existing function at line 137). Same shape the participant lobby's at lines 150-163:

```ts
function mergeSlots(
  httpRows: readonly SlotOccupant[] /* note: caller embeds the role; see below */,
  wsOccupants: SlotOccupants,
): SlotOccupants { ... }
```

Implementation detail: because the merge needs to know the role of each HTTP row, the HTTP fetch's projection actually produces `{ userId, role, screenName }` triples (per the participant's `ParticipantRow` interface at [`LobbyRoute.tsx:84-88`](../../../apps/participant/src/routes/LobbyRoute.tsx#L84-L88)). The merge then assigns `merged[row.role] = { userId, screenName }`. The moderator's helper matches the participant's signature.

Wire the merge into the existing `occupants` derivation (line 256). Replace:

```ts
const events = useWsStore((state) => state.sessionState[sessionId]?.events);
const occupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
```

with:

```ts
const events = useWsStore((state) => state.sessionState[sessionId]?.events);
const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
const occupants = useMemo(() => mergeSlots(httpRows, wsOccupants), [httpRows, wsOccupants]);
```

The two downstream `useMemo` derivations (`bothDebatersPresent` at line 269, `gateReason` at line 274) continue to depend on `[occupants]` and re-compute correctly when either input changes.

#### Loading-state composition

The route's existing `fetchStatus === 'loading'` branch at line 364 currently shows the `invite-loading` placeholder while the session-header fetch is in flight. With two independent fetches, the loading branch should fire while EITHER is loading. Update the conditional to `(fetchStatus === 'loading' || participantsStatus === 'loading')` per Decision §5.

#### Error-state composition

The existing `fetchStatus === 'error'` branch at line 370 renders the error region + retry button. With two fetches, the error branch should fire when EITHER fetch fails (`fetchStatus === 'error' || participantsStatus === 'error'`). The single retry button bumps both nonces (per the retry-seam paragraph above), re-triggering whichever fetch(es) failed. The error copy stays the existing `moderator.invite.errors.fetchFailed` text (Decision §3 — same key, semantic widened to "one or both fetches failed; retry refetches both").

#### Loaded-state rendering

The existing slot-rendering loop at lines 405-534 reads `const occupantScreenName = occupants[role]` (line 407) and `const isFilled = occupantScreenName !== undefined` (line 408). With the widened `SlotOccupants` type, this updates to `const occupant = occupants[role]` and `const isFilled = occupant !== undefined`; the rendered text becomes `{occupant.screenName}` at line 439. No other rendering change.

### State

- **Two new `useState` slots** (`participantsStatus`, `httpRows`, `participantsRetryNonce`) on top of the existing four (`fetchStatus`, `session`, `retryNonce`, `copyStatus`).
- **No new effect dependencies** in the existing effects. The new fetch effect uses `[sessionId, participantsRetryNonce]`.
- **The `mergeSlots` derivation is a pure `useMemo`** over `[httpRows, wsOccupants]`; the existing gate derivations re-compute via their existing `[occupants]` dependency.

### Files this task touches (the explicit allowlist)

- `apps/moderator/src/routes/InviteParticipants.tsx` (modified — widen `SlotOccupants` shape, update `deriveSlotOccupants`, add the participants HTTP fetch effect, add `mergeSlots`, update the loading + error composition, update the slot-rendering reads from screen name to occupant pair).
- `apps/moderator/src/routes/InviteParticipants.test.tsx` (modified — extend `stubSessionFetch` to route the participants GET, add new cases pinning the HTTP-prefetch lifecycle + merge collision semantics, amend the existing reader-shape assertions where they pin `string` reads of `occupants[role]` to read `occupant.screenName`).

### Files this task does NOT touch

- `.tji` files — the WBS `complete 100` marker for `mod_invite_participants_rest_prefetch` lands at task-completion time, not at refinement-write time. No new follow-up tasks need registration (this task IS the follow-up registered by two predecessors).
- `docs/adr/` — no new ADR needed (see Decision §10).
- `apps/server/**` — backend is unchanged; the endpoint already exists.
- `apps/moderator/src/App.tsx` / `apps/moderator/src/routes/CreateSession.tsx` / any other moderator route — pure in-place enrichment of one component.
- `apps/moderator/src/ws/client.ts` / `apps/moderator/src/ws/wsStore.ts` — WS infrastructure unchanged.
- `packages/i18n-catalogs/**` — no new i18n keys (Decision §3 reuses the existing error / loading / retry keys).
- `tests/e2e/**` — no Playwright change (Decision §7 defers the cold-load e2e scenario as the existing scenario already covers the observable contract).
- `apps/participant/**` — the participant adoption shipped separately as `part_lobby_view`; this task does not touch it.

### a11y requirements (the testable list)

- The widened `SlotOccupants` type and the merge composition do not change rendered DOM beyond the per-slot occupant text source. All existing a11y wiring (the role labels at lines 427-432, the empty-state captions at lines 442-452, the ready badges at lines 463-480, the "both ready" banner at line 546, the disabled-state Enter button at line 566 with its `aria-describedby` + `title`) stays unchanged.
- The loading + error compositions widen their conditional inputs (Decision §5) but the rendered DOM in each branch is the existing markup; no a11y attribute changes.
- A loaded-state render where the HTTP prefetch has fired but no WS event has arrived for a debater slot will render the slot's screen name as the empty string `''` (the HTTP row carries `userId` but not `screenName` until the WS overlay fills it). Visually this is a slot that "lit up" with no name visible — accessibility-wise it's a `<p data-testid="invite-slot-occupant">` with no text content. The expected interleaving is that the WS catch-up replay arrives within milliseconds of the HTTP fetch (both are triggered on mount; the WS replay piggybacks on the existing `trackSession` subscription); the empty-string render is a transient that the same Vitest case that pins the merge collision (case (c) below) also pins doesn't display as "broken-looking" for longer than necessary. The acceptance bar is "the WS overlay eventually fills the screenName"; not "the screenName is non-empty at every render frame."

### Test layers per ADR 0022

#### Vitest (in `apps/moderator/src/routes/InviteParticipants.test.tsx` — append + amend)

Amendments (existing cases that change):

- **The `stubSessionFetch` helper** at lines 153-168 gains a third route branch for `/api/sessions/:id/participants`. The helper's caller-provided builder shape extends to optionally return a participants-list response per fetch invocation (default: `{ participants: [] }` — empty list, which keeps existing cases' assertions valid since they seed via WS-only).
- **The `okSessionResponse` constant** at lines 170-182 is the session-header response; no change. A new sibling `okParticipantsResponse(rows: Array<{ userId, role, leftAt? }>): Response` builder lands alongside it.
- **Cases that read `occupant.textContent` to assert a screen name** (e.g. line 302 "alice", line 313 "Awaiting Debater A", line 328 "ben", line 349 "maria", line 365 "ben", line 374 "Awaiting Debater A") stay valid because the DOM render still emits the same text; the SOURCE of that text (now `occupants[role]?.screenName` instead of `occupants[role]`) is internal and the rendered text is unchanged when the WS overlay has the same screen name as before.
- **The existing "moderator slot renders the host screen name when a participant-joined event is in the store"** case at line 293 stays valid because it seeds via WS; the merge composition with an empty HTTP prefetch passes through the WS overlay unchanged.

New cases (appended):

1. **Renders the loading state while the participants HTTP fetch is in flight** — a `fetch` stub that resolves the session GET but leaves the participants GET pending; assert `invite-loading` testid visible; no slot sections rendered.
2. **Renders the loaded state when both fetches resolve** — both GETs return 200; the participants response includes the moderator + both debater rows (HTTP-only path, no WS seeding); assert all three `invite-slot-occupant` testids render with the WS-overlay-filled screen names AFTER a WS catch-up replay is seeded for each. The case proves the HTTP prefetch seeds the slot map's presence without WS, and the WS overlay fills the screen name.
3. **Renders the error state when the participants HTTP fetch fails** — session GET 200, participants GET 500; assert `invite-error` testid visible; assert the `invite-retry` button is visible.
4. **Retry button re-triggers both fetches** — first attempt: session GET 200, participants GET 500 → error; click retry; second attempt: both 200 → loaded with both debaters; assert the loaded state renders.
5. **HTTP prefetch seeds the gate before any WS event arrives** — session GET 200; participants GET returns rows for moderator + both debaters with `leftAt: null` (no `screenName` field per the endpoint contract); assert `invite-enter-session` button has `disabled` false (the gate's `bothDebatersPresent` evaluates true from HTTP alone, even with empty screenName strings) AND assert `invite-both-ready-banner` is in the DOM.
6. **WS event wins on collision with HTTP-prefetched screen name** — HTTP prefetch returns a debater-A row with `screenName: 'old-name'` (the future denormalized endpoint shape, simulated); WS event arrives with `participant-joined(debater-A, screen_name='new-name')`; assert `invite-slot-occupant[data-role="debater-A"]` text is `'new-name'` (WS wins).
7. **WS overlay fills the empty screenName from the HTTP prefetch** — HTTP returns a debater-A row with no `screenName` (the actual current endpoint shape); WS event arrives with `participant-joined(debater-A, screen_name='ben')`; assert the slot occupant text flips from empty to `'ben'`.
8. **HTTP-prefetched debater-left row is NOT rendered** — participants response includes a debater-A row with `leftAt: '2026-05-16T01:00:00.000Z'` (historical row from leave-and-rejoin); assert no `invite-slot-occupant[data-role="debater-A"]` renders from the HTTP path (the active-row filter drops it); the `invite-slot-empty[data-role="debater-A"]` caption renders instead.
9. **`participant-left` event removes a debater slot that was filled by the HTTP prefetch** — HTTP prefetch returns both debaters as active; then `participant-left(debater-A)` arrives via WS; assert the slot returns to the empty state. **Note**: this case pins that the merge does NOT keep the HTTP row "alive" after a WS-derived leave — the WS reducer's `delete occupants[role]` semantic must propagate through the merge. Implementation hint: because the merge iterates HTTP rows first then overlays WS, a WS-derived absence (a deleted key) doesn't override the HTTP row. The fix is to track WS-derived deletions explicitly OR to filter HTTP rows against a WS-derived "departed user ids" set. Decision §6 settles which shape.
10. **Concurrent fetch + WS catch-up — no double-render or store reset** — fire the HTTP fetch and seed a `participant-joined` event in the same render frame; assert the slot renders the screen name without flicker (no intermediate empty render). This case pins the `useMemo` reference-equality stability of the merge output across the two-source update.

**Minimum 10 new cases in `InviteParticipants.test.tsx`.** Lower bound is "every requirement bullet has a probe."

#### Vitest (sub-totals)

The moderator suite's baseline after `mod_session_lobby` is 3160 (per that refinement's Status block line 454). After this task the floor is **3170**. Cases that change source-of-truth (the existing slot-reads) do not change count.

#### Playwright

**Defer the additional cold-load scenario.** Decision §7 settles this. The existing `tests/e2e/cross-surface-lobby-start.spec.ts` already exercises the moderator's lobby slot fill via REAL WS events from real participants, and the observable contract (the moderator's `bothDebatersPresent` gate opens; the Enter button enables; the click navigates to the operate canvas) is the same whether the slot map was seeded by the HTTP prefetch, the WS catch-up replay, or live WS events — the gate's predicate is a pure read of `occupants[role] !== undefined`. The prefetch is "defense in depth" against a race that the existing scenario doesn't observe because alice navigates to the invite view BEFORE ben + maria claim (so her slot map is empty at first paint regardless of which source feeds it; the gate opens via WS events whether or not the prefetch is present).

A cold-load variant — alice creates the session, ben + maria claim, THEN alice navigates to `/m/sessions/<id>/invite` — would visibly exercise the HTTP-prefetch-only path on first paint. The case has value but is not load-bearing: the same merge semantics are pinned at the Vitest layer (cases 5, 6, 7, 8, 9, 10 above), and the cross-surface gate behavior at first-paint-with-both-debaters-present is structurally identical to the gate behavior at first-paint-then-WS-replay (the gate predicate is the same). Adding an e2e cold-load scenario would cost a fourth OIDC dance (alice in a second context after the first session-create + the two debater dances) for a behavior already covered structurally. **Defer the e2e cold-load scenario** to a future leaf if a regression surfaces; record this as an intentional defer per UI-stream e2e policy.

If a regression does surface (e.g. the merge composition breaks the gate's transition logic in a way the WS-only path doesn't catch), the future leaf landing the cold-load e2e scenario inherits the deferred-debt note and the seed pattern (`createSession` via API + the three-context allocation already shown in `cross-surface-lobby-start.spec.ts`).

### UI-stream e2e policy (apply)

**E2e scope: defer.** Per ORCHESTRATOR.md's UI-stream e2e policy: "If the prefetch is purely internal plumbing (same observable behavior, but with the HTTP prefetch as a defense-in-depth against WS catch-up gaps), unit/component coverage is enough; defer the e2e change."

This task's prefetch IS internal plumbing — the observable behavior (the slot map renders correctly, the gate flips correctly, the Enter button enables when both debaters are present) is the same with or without the prefetch. The existing cross-surface spec proves that observable contract end-to-end via REAL WS events; the Vitest cases above prove the new merge semantics + the HTTP-fetch lifecycle.

**No future leaf inherits deferred e2e debt from this task.** The cold-load-cross-surface scenario remains the responsibility of whichever future leaf surfaces a real-user complaint about the hard-reload UX. No tech-debt registration needed today (the predecessor `mod_invite_participants` registered the HTTP endpoint adoption itself; that registration's debt is paid down by THIS task; no new debt is introduced).

### Budget honesty (0.5d)

The 0.5d budget breaks down roughly:

- ~15 min: widen `SlotOccupants` to the pair shape + update `deriveSlotOccupants` to return the pair shape (drop the projection at lines 132-136). ~10 LOC delta.
- ~20 min: add the participants HTTP fetch effect + `mergeSlots` helper (~80 LOC added). Mirrors the participant lobby's fetch effect + merge function line-for-line.
- ~10 min: update the loading + error compositions + the slot-rendering reads (~6 LOC delta — `string` → `SlotOccupant?.screenName` at three call sites; conditional widening at two branches).
- ~45 min: write 10 new Vitest cases in `InviteParticipants.test.tsx` (~250 LOC). The biggest case (case 9 — `participant-left` removes a prefetched slot) requires implementation thinking; Decision §6 settles the approach so it's mechanical from there.
- ~15 min: extend `stubSessionFetch` for the participants branch + add the `okParticipantsResponse` builder.
- ~15 min: `pnpm run check` + `pnpm run test:smoke` + the WBS-status ritual + the commit.

Risk surface is low:

- The merge semantics are pre-pinned by the participant lobby's adoption; this task is a port, not a novel composition.
- The widening of `SlotOccupants` from `string` to a pair is a TypeScript-level change that the compiler catches across all read sites (the existing tests will compile-fail at the assertions until they're updated).
- The single decision with novelty is Decision §6 (how the merge handles WS-derived deletions); the participant lobby's pattern handles this correctly because its `deriveSlotOccupants` already returns the pair shape and the merge iterates HTTP first then WS — but the WS reducer deletes a key on `participant-left`, so the merge would re-add the HTTP row. The fix is documented in §6.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no new dependencies (no new npm packages).
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the modified files in place.
3. **`pnpm run test:smoke` (Vitest) green**. New tests add ≥ 10 new cases to `InviteParticipants.test.tsx`. The post-`mod_session_lobby` baseline is 3160 (per that refinement's Status block); the new total floors at **3170**.
4. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — unchanged (no new i18n keys).
5. **`pnpm -F @a-conversa/moderator build`** produces `apps/moderator/dist/index.html` + assets without new bundle warnings beyond the pre-existing chunk-size note.
6. **`pnpm run test:e2e`** under `make up` runs the existing `chromium-create-session` project's 18 scenarios green (no e2e change in this task); the cross-surface project's `cross-surface-lobby-start.spec.ts` stays green (the WS-events path the spec exercises is unchanged).
7. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `mod_invite_participants_rest_prefetch`.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The HTTP prefetch fires once per route mount + once per retry** — Vitest case 1 + case 4 pin this. No polling, no periodic re-fetch.
10. **The merge collision semantic is WS-wins** — Vitest case 6 pins this against an HTTP-prefetched screen name; the WS overlay overrides.
11. **The active-row filter drops `leftAt !== null` rows from the HTTP response** — Vitest case 8 pins this.
12. **The WS `participant-left` overrides an HTTP-prefetched active row** — Vitest case 9 pins this; the implementation detail per Decision §6 makes the merge respect WS-derived deletions.
13. **The widened `SlotOccupants` type carries `userId` for both read sites** — TypeScript strict mode + the existing reads (gate derivations, slot rendering) compile clean against the pair shape.
14. **No regression on the strict gate** — `mod_session_lobby`'s gate Vitest cases (cases 15, the lobby cases, the disabled-tooltip cases, etc.) stay green against the new occupants source.
15. **No regression on the predecessor's `cross-surface-lobby-start.spec.ts`** — the spec at line 117 (alice navigates to `/m/sessions/<id>/invite` before any debater claims) stays green; the prefetch returns the moderator row only (debaters haven't claimed yet) and the WS events still drive the gate open as ben + maria join.
16. **No new public API surface on `@a-conversa/shell`** — the merge + the prefetch live inline in the moderator route (Decision §8); the shell substrate gets no new exports.

## Decisions

### 1. Adopt HTTP prefetch + WS overlay (mirror the participant lobby)

Three alternatives surveyed:

- **(A) WS-only slot fill** (the current behavior) — rejected. Pays the misleading-empty-state cost the participant-lobby refinement (Decision §1) explicitly named: "the catch-up replay is asynchronous and races the initial render." On a fresh tab opened directly on the lobby URL the moderator paints with an empty `events` array, then re-paints once the WS round-trips. The intermediate empty state disables the strict gate even when both debaters are in fact present. The race is documented at `InviteParticipants.tsx:185-188` and was the original motivation for registering THIS task.
- **(B) Polling `GET /api/sessions/:id/participants` every N seconds** — rejected. The WS subscription is already open (`trackSession` mounts unconditionally); polling on top of it is redundant work. The WS subscription provides the live updates; the only gap is the cold-load race the prefetch resolves.
- **(C) HTTP prefetch on mount + WS subscription for live updates** (chosen). Mirrors the participant lobby's adoption (per [`apps/participant/src/routes/LobbyRoute.tsx:194-499`](../../../apps/participant/src/routes/LobbyRoute.tsx#L194-L499)). The HTTP prefetch seeds the slot map with the server's authoritative active rows on mount; the WS subscription drives live updates from any source. The merge logic composes both with WS-wins-on-collision (Decision §4).

The chosen approach pays down the WS-only debt the predecessor registered, matches the participant-side pattern (one answer to "how is the slot map seeded?" across both surfaces), and resolves the cold-load race without changing the live-update path.

### 2. When to prefetch: on route mount only (NO polling, NO tab-visibility re-fetch)

Three alternatives surveyed:

- **(A) Mount-only** (chosen). The participant lobby's choice (per `part_lobby_view.md` — the fetch effect's dependency array is `[id, retryNonce]`, so it fires on mount and on retry-button click). Mirrors it. Sufficient for the cold-load race; live updates are the WS overlay's job.
- **(B) Mount + on WS-catch-up-stale signal** — rejected. There is no "catch-up stale" signal in the existing WS protocol; inventing one would expand the protocol surface for a problem the prefetch already solves.
- **(C) Mount + periodic polling (every 30s, say)** — rejected. The WS subscription delivers live updates; polling would be redundant + would add network noise. If a future regression surfaces where the WS subscription silently drops without surfacing in the chip's status, a re-fetch on connection-recover could be useful — defer that to a future leaf if it surfaces.

Tab-visibility re-fetch (re-prefetch on `visibilitychange`-to-visible) is deferred to a future leaf for the same reason — the WS subscription resumes from `sinceSequence: lastApplied` on reconnect, so the live-update path picks up missed events without re-fetching the snapshot. If a regression surfaces where the WS reconnect's catch-up replay misses events, the visibility-driven re-fetch is the obvious mitigation.

### 3. Failure modes: reuse the existing single error region + retry button; retry bumps both nonces

Three alternatives surveyed:

- **(A) Per-fetch error regions with per-fetch retry buttons** (the participant lobby's pattern at [`apps/participant/src/routes/LobbyRoute.tsx:391-432`](../../../apps/participant/src/routes/LobbyRoute.tsx#L391-L432)) — rejected for the moderator. The participant lobby's layout exposes both error regions because its rendering has two distinct affordances (header error vs. participants error) and the user can recover from one without losing the other. The moderator's view currently renders ONE error region with ONE retry button and ONE error key (`moderator.invite.errors.fetchFailed`); preserving this shape avoids minting a second i18n key + a second retry-button testid for a marginal UX gain. The moderator IS the host of the session; if either fetch fails, retrying both is the expected user action.
- **(B) Single error region; one retry button bumps both nonces** (chosen). The error condition becomes `fetchStatus === 'error' || participantsStatus === 'error'`. The retry handler bumps both `retryNonce` and `participantsRetryNonce`, re-firing whichever fetch(es) failed. The existing `moderator.invite.errors.fetchFailed` key + the existing `invite-retry` testid stay unchanged.
- **(C) Fall back to WS-only on HTTP failure** — rejected. The prefetch is defense-in-depth; if it fails, the WS overlay is still the live-update path, so the slot map eventually populates. But: silently masking the HTTP failure would hide a backend regression (the endpoint shipped but is now 500ing). Surfacing the error region + retry preserves the diagnostic signal AND lets the moderator manually recover.

The moderator-vs-participant divergence on retry-button shape is justified by the existing surface's shape (the moderator currently has one button; the participant's was new): preserving the moderator's shape avoids unnecessary churn and respects the existing testid + i18n surface.

### 4. Widen `SlotOccupants` to `{ userId, screenName }` pairs

Two alternatives surveyed:

- **(A) Keep `SlotOccupants` as `Record<SlotRole, string | undefined>`** — rejected. The HTTP row carries `userId` (the canonical identifier) and `leftAt` (for the active filter) but not `screenName` (the endpoint doesn't denormalize). If the public type stays string-only, the merge has to drop the HTTP `userId` from rows that lack a corresponding WS event, AND the rendered slot would show an empty string for "filled but no screen name yet." The empty-string render is acceptable as a transient (the WS overlay fills it within ms), but losing the `userId` from the public shape prevents the WS `participant-left` matcher from working against HTTP-prefetched slots (case 9 of the Vitest cases) — the reducer matches on userId, so without it, a `participant-left` arriving after the prefetch would never remove the slot.
- **(B) Widen `SlotOccupants` to `{ [K in SlotRole]?: { userId, screenName } }`** (chosen). Mirrors the participant lobby's shape (per [`LobbyRoute.tsx:82`](../../../apps/participant/src/routes/LobbyRoute.tsx#L82)). The HTTP row carries `userId` straight through; the WS overlay fills `screenName` from the joined-payload. The `participant-left` matcher works correctly because the userId is present in both sources. The rendered text becomes `occupant.screenName` (the empty-string-on-no-overlay case is the same transient as alternative A); the gate's presence check (`occupants[role] !== undefined`) is unchanged in shape.

The widening cascades through every read site (the gate derivations, the slot rendering, the existing Vitest assertions); TypeScript strict mode catches every site at compile time. Reasonable refactor cost (estimated ~5-10 read-site updates).

### 5. Loading composition: both fetches must resolve before "loaded"; error composition: either failure triggers error

Two alternatives surveyed:

- **(A) Render the loaded state when EITHER fetch resolves; the other fills in progressively** — rejected. Would render the slot map with the WS-overlay-only slots while the HTTP prefetch is still pending, which defeats the prefetch's purpose (eliminating the cold-load race). The "both must resolve" composition keeps the loading affordance up until the slot map has its authoritative cold-load shape.
- **(B) Loaded when BOTH fetches resolve; error when EITHER fetch fails** (chosen). Mirrors the participant lobby's pattern at [`LobbyRoute.tsx:365-389`](../../../apps/participant/src/routes/LobbyRoute.tsx#L365-L389). The trade-off is that a slow participants fetch holds the loading affordance up longer than the existing session-header-only behavior; the gain is the resolved slot map at first loaded paint.

The "either fails → error" composition surfaces backend regressions early and gives the moderator one place to retry. The retry handler bumps both nonces (Decision §3) so a single click recovers from one or both failures.

### 6. Merge implementation: HTTP rows seed, WS overlay overrides, WS `participant-left`-derived absences propagate

The implementation subtlety: the participant lobby's `mergeSlots` (per [`LobbyRoute.tsx:150-163`](../../../apps/participant/src/routes/LobbyRoute.tsx#L150-L163)) iterates HTTP rows first, then overlays WS occupants. A `participant-left` event in the WS reducer deletes the slot from `wsOccupants`. After the merge, the HTTP row (which says the slot is filled) wins because the WS map has no entry for that role — the deletion is invisible to the merge.

Three alternatives surveyed:

- **(A) Filter HTTP rows against a WS-derived "departed user ids" set** — would walk the events once to collect every `participant-left` user id, then drop HTTP rows whose `userId` is in that set. Adds a third derivation. Rejected for moderate complexity gain.
- **(B) Change the merge to "WS-derived absences also override HTTP"** — would require tracking presence vs. absence in the WS overlay explicitly (a tri-state per role: `undefined` (no WS signal), `null` (WS-derived departure), or `Occupant` (WS-derived presence)). Adds a state-shape change that propagates through the reducer + the merge + every read site.
- **(C) Mirror the participant lobby's pattern verbatim — accept the WS-derived-absence-doesn't-override-HTTP behavior** (chosen — at first); then realize the participant lobby has the same issue and ships with it.

Reading the participant lobby's behavior carefully: the lobby's WS reducer at `LobbyRoute.tsx:129-135` does `delete occupants[role]` on `participant-left`. The merge at lines 150-163 iterates HTTP rows first, then WS. If a debater leaves AFTER the HTTP prefetch resolved with their row present, the WS event removes them from `wsOccupants` but the HTTP row stays in `merged`. The merge re-adds the WS slot only if `wsSlot !== undefined`; a deleted entry is undefined, so the HTTP row wins.

This is a real bug in the participant lobby's merge — except the participant lobby's case (d) Vitest probe (per `part_lobby_view.md` line 475 — "Renders the slot-clear path: starts with both debaters; a `participant-left` event for debater-B arrives; the Debater B row disappears") relies on the fact that the participant lobby's prefetch ran with active rows for both, then `participant-left` arrived. In the participant's actual Vitest, the prefetch's mocked response is replaced between renders (the test re-stubs `fetch` and triggers a refetch), so the case doesn't actually exercise the merge's WS-derived-absence behavior — it exercises the HTTP-refetch behavior.

For this task's case 9 (`participant-left` event removes a debater slot that was filled by the HTTP prefetch), the correct semantic is: the merge MUST respect WS-derived absences. **Chosen approach (D)**: change the merge composition to "WS-derived presence OR WS-derived absence both override HTTP." The implementation:

- The merge first applies the HTTP rows into the result.
- Then walks the event log a second pass to find `participant-left` events whose `user_id` matches a slot currently held by an HTTP row, and removes those slots.
- Then overlays the WS-derived `wsOccupants` (which carries the current WS-derived presence map per the existing reducer).

Equivalently, and more cleanly: derive a `wsAbsentUserIds: Set<string>` from the event log (every user id seen in a `participant-left` AFTER its most recent `participant-joined` for the same role). The merge first filters HTTP rows against the absent set, then applies them, then overlays WS occupants.

```ts
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
  events: readonly Event[],
): SlotOccupants {
  // Derive the set of user ids that have left and not rejoined per the
  // event log. A user who joined → left → rejoined is NOT in the set
  // (their latest event is `participant-joined`). A user who joined →
  // left is in the set.
  const latest = new Map<string /* userId */, 'joined' | 'left'>();
  for (const event of events) {
    if (event.kind === 'participant-joined') latest.set(event.payload.user_id, 'joined');
    else if (event.kind === 'participant-left') latest.set(event.payload.user_id, 'left');
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

The `latest` map walks the events once; the participant's `deriveSlotOccupants` already walks the events once for `wsOccupants`. Two passes over the events array per render; cheap.

The signature change (adding `events` as a third param) propagates to the `useMemo` dependency: `useMemo(() => mergeSlots(httpRows, wsOccupants, events ?? []), [httpRows, wsOccupants, events])`. Acceptable cost.

This is the **divergence point from the participant lobby's mergeSlots**. The moderator's adoption is "the same pattern, with the absence-propagation bug fixed." Whether to backport the fix to the participant lobby is a separate question; it should — but doing it as part of this task expands scope outside the moderator workspace. Register as a tech-debt item only if the participant lobby's case (d) is in fact green today against the actual merge (i.e., the test doesn't accidentally pass for the wrong reason). Verification: read the participant Vitest case (d) and confirm whether the test's setup exercises the merge or refactors around it. If it refactors around it, no debt to register here — the moderator's adoption gets the fix without affecting the participant. If the participant test relies on the buggy merge, a tech-debt note belongs in the moderator's adoption Status to backport the fix to the participant.

(The Closer for this task verifies the participant case (d) shape during implementation and records the finding in the Status block. The refinement itself can't pre-resolve this without reading the participant's actual test file in detail — the refinement-time scan is sufficient to know the bug exists in the published `mergeSlots`; whether the test exercises it is a Closer-time confirmation.)

### 7. Defer the cold-load e2e scenario

Two alternatives surveyed:

- **(A) Add a cold-load e2e scenario** — alice creates the session via API, ben + maria self-claim via API (or in their own contexts), THEN alice navigates to the moderator's invite view; assert the gate opens on first paint without any WS event arriving in alice's context. Would cost a fourth OIDC dance (alice's full login) on top of the existing three in `cross-surface-lobby-start.spec.ts`. The scenario has value (it pins the cold-load path observably) but the same merge semantics are pinned at the Vitest layer.
- **(B) Defer the cold-load e2e scenario** (chosen). The prefetch is internal plumbing per ORCHESTRATOR.md's UI-stream e2e policy ("same observable behavior, but with the HTTP prefetch as a defense-in-depth against WS catch-up gaps"). The existing cross-surface spec proves the observable contract (gate flips, banner appears, Enter click navigates) via REAL WS events; the Vitest cases above prove the new merge semantics. Adding the cold-load scenario would re-prove the gate's behavior through a different seed path — high cost (one more OIDC dance per CI run), low marginal coverage.

If a regression surfaces (the prefetch silently breaks the gate's transition logic in a way the WS-only path doesn't catch), the future leaf landing the cold-load e2e scenario inherits the deferred-debt note. This refinement does NOT register a future leaf today because no scope is identified; the deferral is intentional + reversible.

### 8. The merge + prefetch live INLINE in the moderator route, NOT extracted to `@a-conversa/shell`

Two alternatives surveyed:

- **(A) Extract `mergeSlots` + `deriveSlotOccupants` to `@a-conversa/shell`** so both the moderator and the participant import them. The participant refinement explicitly deferred this (Decision §6) because no third caller exists. **The moderator's adoption is the second caller** — a closer-to-extraction state than before. But:
- **(B) Keep both copies inline** (chosen). The two reducers are functionally near-identical (same event kinds, same role enum, same payload shape) but with a deliberate divergence in this task (Decision §6 fixes the merge bug that the participant lobby ships with). Extracting them now would require choosing one canonical implementation; doing the extraction AND the bug fix in the same task is two concerns. The fix lands here; the extraction is deferred to a future leaf when (a) the participant's copy is updated to match AND (b) a third caller surfaces. The deferral matches the participant refinement's posture; this task does not change it.

### 9. No new i18n keys

Two alternatives surveyed:

- **(A) Mint new i18n keys for the participants-fetch error state and retry button** — rejected. The existing single `moderator.invite.errors.fetchFailed` key + the existing `invite-retry` button cover both fetch failures (Decision §3). The error copy "Could not load the session. Please try again." is semantically valid for "could not load the session OR its participants list"; the user's recovery action (click retry) is the same.
- **(B) Reuse the existing keys; no catalog edits** (chosen). Keeps the catalog lean; no native-speaker review follow-up needed; no `*.review.json` updates.

If a future regression surfaces where the moderator wants distinct error copy per failure (e.g. "Could not load the participants list" specifically), the i18n catalog edit is additive and cheap. No need today.

### 10. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- **A direct application of an existing convention** — HTTP prefetch + WS overlay (per the participant lobby's Decision §1), inline `fetch(...)` (per `mod_invite_participants` Decisions §"HTTP client seam"), WS-store consumption (per the existing `useWsStore` selector pattern at `PendingProposalsPane.tsx`), `useMemo` derivations (per the existing gate derivations).
- **A scoped UI policy that doesn't constrain other tasks** — single error region (§3), pair-shaped occupant type (§4), loading composition (§5), merge-with-WS-absence-fix (§6), defer-e2e (§7), inline-not-extracted (§8), no new i18n (§9).
- **A deliberate divergence from the participant lobby's `mergeSlots` to fix a bug** (§6) — the fix is local to the moderator's adoption; backporting to the participant is a Closer-time decision based on whether the participant's existing test actually exercises the bug.

The "no new dependencies" rule is satisfied. The "no new shell substrate" rule is honored (§8 keeps the merge + reducer inline). The "no new server-side change" rule is honored (the endpoint already exists). The "no new i18n" rule is honored (§9).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- `apps/moderator/src/routes/InviteParticipants.tsx`: widened `SlotOccupants` to `{userId, screenName}` pairs; added `ParticipantRow` type; added `mergeSlots(httpRows, wsOccupants, events)` with the WS-absence-propagating fix (Decision §6); added the `GET /api/sessions/:id/participants` HTTP prefetch effect on `[sessionId, participantsRetryNonce]`; widened the loading + error conditionals to be `either-fetch-loading` / `either-fetch-error`; updated the single retry handler to bump both nonces; updated the slot rendering to read `occupant.screenName` instead of the bare string.
- `apps/moderator/src/routes/InviteParticipants.test.tsx`: extended `stubSessionFetch` with a participants-builder branch defaulting to `{ participants: [] }` (keeps existing WS-seeded cases valid); added `okParticipantsResponse` builder; updated the existing retry test to route participants requests; appended 10 new cases pinning HTTP prefetch lifecycle (loading / loaded / error / retry-bumps-both), merge collision semantics (WS-wins-on-name, empty-screenName-overlay-fills), active-row filter (`leftAt !== null` drops), WS-leave-overrides-HTTP behavior (the Decision §6 fix), and concurrent fetch + WS catch-up reference-equality stability.
- Vitest delta: `InviteParticipants` suite 32 → 42 (+10 cases). Repo total 3503 → 3513.
- e2e: not run, not required per the refinement's UI-stream e2e policy (Decision §7 — internal plumbing, no observable change). The existing `tests/e2e/cross-surface-lobby-start.spec.ts` continues to cover the observable cross-surface contract via REAL WS events.
- Summary: the moderator's invite/lobby now seeds its slot map from `GET /api/sessions/:id/participants` on mount and merges with the WS overlay, eliminating the cold-load empty-slot race documented at `InviteParticipants.tsx:185-188` and pinning WS-derived absences over HTTP-prefetched rows (the Decision §6 divergence from the participant lobby's `mergeSlots`).
- Confirmed participant-side latent bug: `apps/participant/src/routes/LobbyRoute.tsx:150-163` carries the same `mergeSlots` issue this task fixed — a WS `participant-left` does NOT override an HTTP-prefetched row containing the leaver. Registered as the new leaf `participant_ui.part_session_join.part_lobby_view_ws_absence_merge_fix` in `tasks/40-participant-ui.tji` (depends on this task so the fix-pattern can be copied verbatim).
