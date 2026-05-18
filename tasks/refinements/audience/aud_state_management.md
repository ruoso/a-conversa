# Audience state-management setup

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_state_management` (effort `1d`, depends `!aud_ws_client`; no embedded `note` block, no `complete 100` yet).

**Effort estimate**: 1d

**Inherited dependencies**:

- `!audience.aud_shell.aud_ws_client` (settled — the audience surface now mounts `<WsClientProvider store={audienceWsStore}>` inside [`apps/audience/src/main.tsx:47-88`](../../../apps/audience/src/main.tsx#L47), the singleton `audienceWsStore = createDefaultWsStore()` lives at [`apps/audience/src/ws/wsStore.ts:31`](../../../apps/audience/src/ws/wsStore.ts#L31), and a TypeScript-narrowed read-only barrel re-exports the store plus two selector hooks `useAudienceSessionEvents` / `useAudienceConnectionStatus` from [`apps/audience/src/ws/index.ts:16-18`](../../../apps/audience/src/ws/index.ts#L16). The Cucumber subscribe-only wire contract is already pinned at [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) with 3 scenarios. See [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md#L106-L113)).
- `!audience.aud_shell.aud_app_skeleton` (settled, transitive — audience builds as a Vite library bundle exporting `mount(props): UnmountFn` + `SurfaceModule` with `requiredAuthLevel: 'public'`; the `/a/*` route is wired into the root host's `SurfaceHost`; basename strip + URL-prefix locale read happen inside [`apps/audience/src/App.tsx:61-77`](../../../apps/audience/src/App.tsx#L61)).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_shell.part_state_management` (shipped 2026-05-16 — the canonical "Zustand-stores + barrel + devtools wrapper + smoke suite" recipe; the participant uses `createDefaultWsStore()` verbatim AND adds three local-UI slices `useVoteStore`/`useSelectionStore`/`useUiStore`. The audience inherits the *shape* of the recipe but the slice list is even narrower than the participant's — see Decision §1 below for why the audience adds *no* interactive local-UI slices in v0).
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_session_join.part_lobby_view` + `part_entity_detail_panel` (shipped — these landed the per-event-log projection helpers `deriveSlotOccupants` / `mergeSlots` (lobby) and `participantRosterFrom` / `screenNameFor` (detail panel). The audience's `useAudienceSessionRoster` selector mirrors the participant's `participantRosterFrom` semantics — Decision §4 picks duplicate-for-v0 over extract-to-shell because the moderator's roster is keyed by *role* (not user), so the audience would be the second general-roster caller, not the third).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_shell.mod_state_management` (shipped 2026-05-11 — the original Zustand-stores recipe; moderator-local slices include `useCaptureStore` which the audience has no analog for). The audience's stores directory may be empty at this leaf's close — see Decision §1.

## What this task is

The state-derivation layer that sits between the raw event log (already feeding `audienceWsStore.sessionState[sessionId].events` via the WS substrate from `aud_ws_client`) and the future audience UI tasks (graph rendering, vote tallies, axiom-mark decoration, segment markers). After this leaf:

- A new directory `apps/audience/src/state/` ships three pure-function projection helpers + three composing selector hooks. None of the helpers touch React or Zustand; the hooks are thin Zustand selectors over `audienceWsStore`. All artifacts compose to a single consumer-facing entry — a `useAudienceSession(sessionId)` hook returning a stable `AudienceSessionView` object — which the downstream `aud_graph_rendering.*` family will read as its single dependency on this leaf.
- The three pure projectors (in `apps/audience/src/state/`):
  - **`sessionRosterFrom(events)`** → `ReadonlyMap<userId, screenName>` — walks `participant-joined`/`participant-left` envelopes; same `set-on-joined / delete-on-left` semantics as the participant's [`apps/participant/src/detail/participantRoster.ts:75-91`](../../../apps/participant/src/detail/participantRoster.ts#L75). Returns a frozen `EMPTY_AUDIENCE_ROSTER` reference when no joins have been seen (the empty-map identity trick the rest of the codebase already uses).
  - **`sessionModeFrom(events)`** → `SessionMode` (`'lobby' | 'operate'`) — walks `session-mode-changed` envelopes; returns `'lobby'` as the v0 default until the first envelope arrives. Read-only consumer of [`packages/shared-types/src/events.ts:474-484`](../../../packages/shared-types/src/events.ts#L474)'s `SessionMode` discriminated union; the audience tracks the latest authoritative value and exposes it for the future audience UI to switch its rendered chrome (lobby = roster + waiting screen, operate = graph canvas) per Decision §5.
  - **`sessionIdFromPathname(pathname)`** → `string | null` — parses the canonical audience URL grammar `/{locale}?/sessions/{uuid}` (with the audience's `/a` basename already stripped by React Router) and returns the trailing UUID or `null` for malformed/wildcard URLs. Mirrors the basename-strip pattern already in `apps/audience/src/App.tsx:61-69`; the audience's wildcard placeholder route does NOT yet land a `:id` param consumption — this helper is the v0 source of truth until `aud_url_routing.aud_session_url` lands a real React Router pattern.
- Three composing selector hooks (in `apps/audience/src/state/`):
  - **`useAudienceSessionRoster(sessionId)`** → `ReadonlyMap<userId, screenName>` — `useMemo`-wrapped projection over `useAudienceSessionEvents(sessionId)` calling `sessionRosterFrom`. Stable empty-map reference when no joins.
  - **`useAudienceSessionMode(sessionId)`** → `SessionMode` — `useMemo`-wrapped projection over the same event slice calling `sessionModeFrom`.
  - **`useAudienceSessionId()`** → `string | null` — calls `sessionIdFromPathname(stripAudienceBasename(window.location.pathname))` inside a `useSyncExternalStore` subscribing to `'popstate'` (and a one-shot pathname snapshot on mount). The hook is parameterless — every audience consumer reads the same singleton session id derived from the URL.
- One composing facade hook (also in `apps/audience/src/state/`):
  - **`useAudienceSession()`** → `AudienceSessionView` — returns `{ sessionId, connectionStatus, events, roster, sessionMode }` as one object. The downstream `aud_graph_rendering.*` family imports this single hook; the more focused hooks above remain exported for consumers that want one slice without the others (e.g. a future status chip).
- A `state/index.ts` barrel re-exports the projectors, the hooks, the facade, and the relevant types (`AudienceSessionView`, `SessionMode` re-export from `@a-conversa/shared-types` for source-stability).
- The audience workspace's stores directory (`apps/audience/src/stores/`) is **deliberately NOT created** at this leaf — Decision §1 explains why: the audience has no interactive local-UI state (no vote buffer, no selection, no zoom toggle), so the moderator/participant Zustand-slices pattern has no analog. A `stores/` directory lands the moment the first interactive widget needs one; until then, all audience state is derived from the server-state slice (`audienceWsStore`) or the URL.
- A Vitest suite covers each projector as a pure function (cases-anchored, ~3-5 cases per projector) + each selector hook through a small React harness (initial state + post-event-applied re-render + stable-reference-when-no-change). The composing `useAudienceSession()` hook gets one end-to-end harness case that seeds the store, asserts every field of the returned view, then dispatches an event and asserts the view recomputes.

Out of scope (deferred to existing or future leaves):

- **Full graph projection** — `nodes` / `edges` / `proposed` / `agreed` / `disputed` state slices, the Cytoscape-shaped `{ data, classes }` records, per-facet status, per-participant axiom-mark decoration, annotation rendering. All of these are `aud_graph_rendering.*` deliverables (the subgroup at [`tasks/50-audience-and-broadcast.tji:75-119`](../../50-audience-and-broadcast.tji#L75)). This leaf intentionally stops at the *common* derivations every audience UI surface will need (session id, connection status, raw events, roster, session mode); per-feature projection is owned by the per-feature leaf.
- **Vote tally projection** — the audience-facing per-proposal vote breakdown lands with `aud_graph_rendering.aud_per_facet_visualization` (a 2-day leaf). The raw vote events are reachable through `useAudienceSessionEvents`; the tally derivation is the future leaf's scope.
- **Animation-driving state** — "currently-fading" / "just-arrived" entity slots that `aud_animations.*` will need to drive the proposed-to-agreed transitions. Those slots are per-feature; this leaf does not pre-empt.
- **Segment markers** — `aud_segment_markers.*` reads from a different event stream (snapshot events); this leaf does not derive segment state.
- **Producer-facing diagnostic chip** — no consumer reads `useAudienceConnectionStatus()` today, and this leaf does not add one. Per `aud_ws_client.md`'s Out-of-scope §4, the chip is intentionally absent from the broadcast surface.
- **Persistence / localStorage / sessionStorage / cookies.** Audience state is fully ephemeral: a refreshed tab re-derives from the WS replay. Matches the moderator + participant policy and the project's no-tokens-in-storage discipline.
- **Selection state / zoom / tab toggles** — audience has no interactive widgets in v0. No `useSelectionStore` / `useUiStore` analogs (Decision §1).
- **Authenticated public/private discrimination at the state layer** — `useAudienceSession()` does not branch on `auth.status`; that's `aud_no_auth_for_public`'s scope (which widens the `SurfaceHost` gate). The state layer is auth-agnostic.
- **Per-session subscription wiring** (`client.trackSession(sessionId)`). `aud_ws_client.md`'s Out-of-scope §2 forwarded this to the first audience leaf with a real `:id` route (either `aud_url_routing.aud_session_url` or `aud_graph_rendering.aud_cytoscape_init`). This leaf surfaces `useAudienceSessionId()` so the future leaf has a stable source, but does NOT call `trackSession` itself.
- **Extracting `sessionRosterFrom` into `@a-conversa/shell`** — Decision §4 keeps the helper audience-local for v0. The participant's `participantRosterFrom` is the only other general-purpose roster projector today (the moderator's `deriveSlotOccupants` is role-keyed, not user-keyed); the audience is the *second* general caller, not the third. Per the convention recorded in [`apps/participant/src/detail/participantRoster.ts:22-24`](../../../apps/participant/src/detail/participantRoster.ts#L22) ("the third caller (audience) is the natural extraction trigger"), extraction is the *next* general caller's trigger, not this leaf's. See Decision §4 for the explicit duplicate-vs-extract reasoning and the follow-up registration.
- **Cucumber scenario at the WS-protocol layer.** The audience subscribe-only wire path is already pinned by [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) (3 scenarios landed by `aud_ws_client`). This leaf is *state derivation from the events the wire delivers*, not a new wire behavior. Per the "Behavior + e2e coverage growth" steer in `ORCHESTRATOR.md`, Cucumber pins protocol / broadcast / projector outputs observable at the system seam; pure projection helpers consumed only by audience UI are Vitest territory. Decision §6 records the disposition.
- **Playwright spec for the audience state plumbing.** No visible UI surfaces this leaf's state — the audience placeholder route at [`apps/audience/src/App.tsx:40-48`](../../../apps/audience/src/App.tsx#L40) is unchanged. Per `ORCHESTRATOR.md`'s UI-stream e2e policy + deferred-e2e exception, this is the textbook "component not yet reachable" case. The natural inheritor is `aud_graph_rendering.aud_cytoscape_init` — the first audience leaf to surface a visible event-driven affordance. See Decision §7.

## Why it needs to be done

`m_audience_mvp` (M6, [`tasks/99-milestones.tji`](../../99-milestones.tji)) — the milestone at which a producer can point OBS at an audience URL and see the live debate graph — has every leaf under `audience.*` as a direct or transitive dependency. `aud_graph_rendering.aud_cytoscape_init` (`depends !aud_shell, !graph_lib_decision`) and every other graph leaf transitively depends on `aud_shell`; this leaf is the last `aud_shell` task that needs to land before the graph subgroup's bottleneck `aud_cytoscape_init` becomes ready. After this leaf, the audience's full `aud_shell` precondition stack is closed except for the auth-widening pair (`aud_no_auth_for_public` + `aud_auth_for_private`), which is structurally independent and can land in parallel.

Concretely, the chain a real producer will hit:

1. Producer points OBS at `/a/sessions/<uuid>`; SurfaceHost auth-gates (today; widens with `aud_no_auth_for_public`).
2. Audience bundle dynamic-imports; `<WsClientProvider>` opens the socket; `audienceWsStore.sessionState[sid].events` starts populating from the `event-applied` broadcasts after the subscribe ack.
3. **Today** (before this leaf): the placeholder route renders; no audience UI reads `events`, no UI projects events into anything renderable, no UI knows what `sessionId` is (the URL parsing lives only inside `App.tsx`'s i18n-locale read).
4. **After this leaf**: `useAudienceSession()` returns a stable `{ sessionId, connectionStatus, events, roster, sessionMode }` view. The first `aud_graph_rendering.*` leaf can land its UI by importing one hook and getting every common derivation for free. The audience knows whether to render the lobby or operate chrome (session mode); knows who the debaters are (roster); knows whether the connection is live (status); knows which session it's watching (id).

Downstream concretely:

- **`aud_graph_rendering.aud_cytoscape_init`** — reads `useAudienceSession().events` as the input to the Cytoscape projector. Also reads `useAudienceSession().roster` for per-participant axiom-mark decoration in the same leaf (the roster ships ready in this leaf so the graph leaf has no separate roster-derivation step).
- **`aud_graph_rendering.aud_proposed_styling`** + siblings — read `events` for per-state styling decisions. The events list is already filtered to a single session by this leaf's selector, so styling leaves don't re-implement session scoping.
- **`aud_graph_rendering.aud_per_facet_visualization`** — derives per-facet state from `events` (vote tally). The audience-side derivation is its own pure-function helper inside that leaf; this leaf's `useAudienceSession()` provides the raw events the helper consumes.
- **`aud_animations.*`** — the "currently-fading" / "just-arrived" slots will be derived from `events` (timing-based filters on the most recent envelopes). This leaf's events slice is the input.
- **`aud_segment_markers.*`** — read snapshot events (a different envelope subset). Same `useAudienceSession().events` source; the segment leaf derives its own filtering.

Architecturally, this leaf is the **third realization of the "shell substrate + surface-local state layer" division of labor** (after the moderator's `mod_state_management` and the participant's `part_state_management`). The audience surface differs from the other two in one structural way: **it has no interactive local-UI state**. The moderator captures and proposes; the participant votes and selects; the audience just watches. Per Decision §1, this difference manifests as *no `apps/audience/src/stores/` directory* at all — the third surface lands the recipe by *not* needing the Zustand-slice piece of it, only the projection-helpers-and-selector-hooks piece. This is the cleanest signal that the recipe's parts are genuinely separable; the participant proved you can ship a surface with the WS layer plus three local slices, and the audience proves you can ship a surface with just the WS layer plus pure-function derivations.

The audience is also the **first** read-only surface to derive `sessionMode`. The participant tracks mode for navigation handoff inside `LobbyRoute.tsx:469` (lobby → operate); the moderator owns the mode transition (the `change-session-mode` envelope) but does not derive *current* mode from the event log (it derives mode from local route state). The audience's `sessionModeFrom` is the first read-only projection of the canonical mode signal, and the helper is the natural extraction target if a fourth caller surfaces — but the convention recorded under Decision §4 says: extract on the third *general* caller, and this is the second.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37) — surfaces consume shared services from `@a-conversa/shell`; surface-local state stays surface-local. The audience's `useAudienceSession()` and its projectors live in `apps/audience/src/state/`, not in the shell — see Decision §4.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every projector + every hook lands with a committed Vitest case. The store integration is exercised through React harness tests; no manual "I seeded the store and watched the hook update" smoke.
- [ADR 0021 — event-envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — `Event = EventEnvelope<K>` per [`packages/shared-types/src/events.ts:590`](../../../packages/shared-types/src/events.ts#L590) is the projector input type; payload-shape narrowing follows `event.kind === '...'` discriminators (the same pattern the participant's `participantRosterFrom` uses).
- [ADR 0028 — session-mode-changed event](../../../docs/adr/) — the dedicated `session-mode-changed` envelope (per [`packages/shared-types/src/events.ts:474-484`](../../../packages/shared-types/src/events.ts#L474)) is the canonical mode-transition signal. The participant's `LobbyRoute.tsx:469` filter and this leaf's `sessionModeFrom` are the two consumers.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — projector input/output types use `readonly` + discriminated unions; no `any`. The audience tsconfig already references `@a-conversa/shared-types` and `@a-conversa/shell`; no tsconfig change needed.
- [ADR 0006 — Vitest](../../../docs/adr/0006-vitest.md) — the smoke + harness test layer this leaf grows.

### Sibling refinements

- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — the predecessor. Established `audienceWsStore`, the two narrowed selector hooks, the TypeScript-narrowed barrel, and the three-Cucumber-scenarios wire pin. This leaf builds on top of the read-only barrel — every selector hook this leaf adds consumes the barrel's `useAudienceSessionEvents` / `useAudienceConnectionStatus`, NOT `audienceWsStore` directly (the indirection keeps the future "swap to a typed projection store" path open without touching every consumer).
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the skeleton precedent. The basename-strip pattern at lines 214-217 of `aud_app_skeleton.md` (and the live code at [`apps/audience/src/App.tsx:61-69`](../../../apps/audience/src/App.tsx#L61)) is the precursor this leaf's `useAudienceSessionId()` formalizes into a pure helper + a `useSyncExternalStore` hook.
- [`tasks/refinements/participant-ui/part_state_management.md`](../participant-ui/part_state_management.md) — the closest analog. Shape this leaf inherits: pure-function projectors with explicit empty-reference identity; selector hooks that wrap projectors with `useMemo`; barrel re-exporting both; no local-store React provider (Zustand singletons or in-hook `useSyncExternalStore`). Shape this leaf deliberately does NOT inherit: the three local-UI slices (`useVoteStore` / `useSelectionStore` / `useUiStore`) — see Decision §1.
- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](../participant-ui/part_entity_detail_panel.md) — the source of `participantRosterFrom`'s set-on-joined / delete-on-left semantics (its Decision §5). This leaf's `sessionRosterFrom` is a duplicate-by-rewrite of the same algorithm with an audience-prefixed name and identical behaviour; the duplicate-vs-extract decision is Decision §4.
- [`tasks/refinements/participant-ui/part_lobby_view.md`](../participant-ui/part_lobby_view.md) — the source of the `session-mode-changed` consumption pattern in `LobbyRoute.tsx:469`. The audience's `sessionModeFrom` derives the *current* mode from the *full* event log (the participant filter is single-event-triggered for navigation); the audience needs the persistent value because rendered chrome depends on it.
- [`tasks/refinements/moderator-ui/mod_state_management.md`](../moderator-ui/mod_state_management.md) — the original Zustand-slices recipe. The audience does not need it; this leaf documents the absence (Decision §1).
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) — the shell-substrate contract this leaf consumes (via `aud_ws_client`'s consumption); no new substrate.

### Live code the leaf integrates with

- [`apps/audience/src/ws/index.ts:16-18`](../../../apps/audience/src/ws/index.ts#L16) — the read-only barrel. This leaf's selector hooks consume `useAudienceSessionEvents` (the events-by-sessionId selector) and `useAudienceConnectionStatus`. The new `useAudienceSession()` facade re-exports `connectionStatus` through its returned view object.
- [`apps/audience/src/ws/useAudienceSessionEvents.ts:27-29`](../../../apps/audience/src/ws/useAudienceSessionEvents.ts#L27) — the events selector. Already implements the `EMPTY_EVENTS` frozen-array trick this leaf's `sessionRosterFrom` mirrors with `EMPTY_AUDIENCE_ROSTER`.
- [`apps/audience/src/ws/wsStore.ts:31`](../../../apps/audience/src/ws/wsStore.ts#L31) — the audience-side singleton store (`createDefaultWsStore()`). This leaf does NOT import the store directly; it goes through the narrowed selector hooks to honour the TypeScript-narrowing posture from `aud_ws_client` Decision §6.
- [`apps/audience/src/App.tsx:61-77`](../../../apps/audience/src/App.tsx#L61) — the existing basename-strip + locale-read in the placeholder route. This leaf does NOT modify `App.tsx`; the new `useAudienceSessionId()` hook reads `window.location.pathname` independently. The duplicate `stripAudienceBasename` logic between `App.tsx` and the new hook is acceptable for v0 because (a) the App-level read is for locale negotiation, the hook-level read is for session-id parsing, and (b) consolidating both into a shared helper is a 3-line refactor a future leaf (likely `aud_url_routing.aud_session_url` when it lands a real `<Route path="/:locale?/sessions/:id">` pattern) can do cheaply. Decision §3 below documents.
- [`packages/shared-types/src/events.ts:474-484`](../../../packages/shared-types/src/events.ts#L474) — `SessionMode` + `sessionModeChangedPayloadSchema`. The audience's `sessionModeFrom` reads `event.kind === 'session-mode-changed'` envelopes and returns `event.payload.new_mode`.
- [`packages/shared-types/src/events.ts:590-594`](../../../packages/shared-types/src/events.ts#L590) — `Event` discriminated-union type. The projector input type.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — the `participant-joined` / `participant-left` payload schemas the roster walks. The participant's `participantRosterFrom` already encodes the contract; this leaf's `sessionRosterFrom` mirrors it.
- [`apps/participant/src/detail/participantRoster.ts:42-91`](../../../apps/participant/src/detail/participantRoster.ts#L42) — the algorithm this leaf's `sessionRosterFrom` duplicates. Same set-on-joined / delete-on-left semantics; same `Object.freeze(new Map())` empty-reference trick.
- [`apps/participant/src/routes/LobbyRoute.tsx:107-113`](../../../apps/participant/src/routes/LobbyRoute.tsx#L107) — `CONTENT_EVENT_KINDS` is the participant-specific lobby→operate fallback heuristic; the audience does NOT need it because the audience renders the lobby/operate chrome based on the *current* session mode, not navigation. This leaf reads `'session-mode-changed'` directly per ADR 0028; the participant's heuristic is structurally different.

### Existing infrastructure this leaf rides

- [`apps/audience/package.json`](../../../apps/audience/package.json) — current deps. This leaf adds **no new runtime dependencies**. `react` is already pinned for the `useMemo` + `useSyncExternalStore` consumers; `@a-conversa/shared-types` is already a workspace dep for the `Event` / `SessionMode` imports; `@a-conversa/shell` is already a workspace dep (consumed transitively through the WS barrel).
- [`apps/audience/vite.config.ts`](../../../apps/audience/vite.config.ts) — Vite library-mode build. The new `src/state/*` files compile through the same build with no config change.
- [`apps/audience/tsconfig.json`](../../../apps/audience/tsconfig.json) — already references `packages/shared-types` (transitively via shell) and `packages/shell`. No tsconfig change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/state/sessionRoster.ts` — NEW. The pure `sessionRosterFrom(events): ReadonlyMap<userId, screenName>` projector + `EMPTY_AUDIENCE_ROSTER` constant. Documented as a duplicate-from-participant (Decision §4); the file header points at both this refinement and the participant's `participantRoster.ts`. ~50 LOC.
- `apps/audience/src/state/sessionMode.ts` — NEW. The pure `sessionModeFrom(events): SessionMode` projector. Re-exports `SessionMode` from `@a-conversa/shared-types` for caller convenience. ~30 LOC.
- `apps/audience/src/state/sessionId.ts` — NEW. The pure `sessionIdFromPathname(pathname): string | null` helper + a `stripAudienceBasename(pathname)` helper. ~40 LOC.
- `apps/audience/src/state/useAudienceSessionRoster.ts` — NEW. `useMemo`-wrapped selector hook over `useAudienceSessionEvents(sessionId)`. ~25 LOC.
- `apps/audience/src/state/useAudienceSessionMode.ts` — NEW. Same shape as `useAudienceSessionRoster`. ~25 LOC.
- `apps/audience/src/state/useAudienceSessionId.ts` — NEW. `useSyncExternalStore`-backed hook over `window`'s `popstate` event + a one-shot snapshot. ~40 LOC.
- `apps/audience/src/state/useAudienceSession.ts` — NEW. The composing facade hook + the exported `AudienceSessionView` interface. ~40 LOC.
- `apps/audience/src/state/index.ts` — NEW. Barrel re-exporting all projectors, all hooks, the facade, the `AudienceSessionView` type, and a re-export of `SessionMode` from `@a-conversa/shared-types`. ~25 LOC.
- `apps/audience/src/state/sessionRoster.test.ts` — NEW. Vitest cases (~5 cases, ~80 LOC): empty events → `EMPTY_AUDIENCE_ROSTER` identity; one join sets entry; second join overrides screen name; join + leave deletes; out-of-order left-before-join is a no-op.
- `apps/audience/src/state/sessionMode.test.ts` — NEW. Vitest cases (~4 cases, ~60 LOC): empty events → `'lobby'`; first `session-mode-changed → 'operate'` returns `'operate'`; multiple transitions → last value wins; events without any `session-mode-changed` → `'lobby'` default.
- `apps/audience/src/state/sessionId.test.ts` — NEW. Vitest cases (~6 cases, ~70 LOC): `/sessions/<uuid>` → UUID; `/en-US/sessions/<uuid>` → UUID (locale-prefixed); `/` → `null`; `/sessions/` → `null`; `/sessions/<malformed>` → `null` (UUID regex check); `stripAudienceBasename('/a/sessions/<uuid>')` → `/sessions/<uuid>`; `stripAudienceBasename('/a')` → `/`; `stripAudienceBasename('/p/foo')` → `/p/foo` (no strip if no audience basename).
- `apps/audience/src/state/useAudienceSessionRoster.test.tsx` — NEW. React harness Vitest cases (~3 cases, ~70 LOC): initial empty events → empty map; after store seeded with a join → map contains entry; stable map reference across renders when no event changed (the `EMPTY_AUDIENCE_ROSTER` identity check that prevents downstream re-render churn).
- `apps/audience/src/state/useAudienceSessionMode.test.tsx` — NEW. React harness Vitest cases (~3 cases, ~70 LOC): initial → `'lobby'`; after `session-mode-changed` → `'operate'`; stable reference (primitive equality, but the hook-result identity matters for downstream `useMemo` deps).
- `apps/audience/src/state/useAudienceSessionId.test.tsx` — NEW. React harness Vitest cases (~4 cases, ~90 LOC): initial pathname `/a/sessions/<uuid>` → UUID; pathname `/a` → `null`; `popstate` event re-derives; `unmount` removes the `popstate` listener (the cleanup is what `useSyncExternalStore` already guarantees if `subscribe` returns the unsub, but the test pins it).
- `apps/audience/src/state/useAudienceSession.test.tsx` — NEW. End-to-end React harness Vitest case (~2 cases, ~80 LOC): mount with a seeded store + a known pathname; assert every field of the returned view; dispatch an event into the store; assert the view re-renders with the updated `events` / `roster` / `sessionMode` slices; `connectionStatus` updates when `audienceWsStore.getState().setConnectionStatus('open')` fires.
- `pnpm-lock.yaml` — NOT modified (no dep changes).

### Files this task does NOT touch

- `apps/audience/src/App.tsx` — placeholder route unchanged. No `useAudienceSession()` consumer yet; the placeholder body does NOT subscribe to the new hooks (a future-task wire-up that adds `useAudienceSession()` to the placeholder body would conflict with `aud_graph_rendering.aud_cytoscape_init`'s eventual placeholder replacement — see Decision §1's twin to `part_state_management` Decision §7 on production-route wiring).
- `apps/audience/src/main.tsx` — provider stack unchanged. The new state hooks resolve through React's render cycle; the singleton `audienceWsStore` is already mounted under `<WsClientProvider>` by `aud_ws_client`'s landed code.
- `apps/audience/src/ws/*` — the WS barrel + the two existing selector hooks + the singleton store are unchanged. This leaf consumes them; it does NOT widen them. The TypeScript-narrowed read-only barrel from `aud_ws_client` Decision §6 stays narrow — the new state helpers go in a *different* barrel (`state/index.ts`) so the WS barrel's narrowing intent (write-side surface deliberately absent) stays legible.
- `apps/audience/src/stores/` — NOT created (Decision §1). The audience has no Zustand local-UI slice analog.
- `apps/audience/package.json` — no dep changes.
- `apps/audience/vite.config.ts` / `apps/audience/tsconfig.json` / `apps/audience/src/index.css` — no build / TS / style changes.
- `packages/shell/` — no extraction of `sessionRosterFrom` or `sessionModeFrom` at this leaf (Decision §4). Substrate consumed unchanged.
- `packages/shared-types/` — no envelope schema change. `SessionMode` and `sessionModeChangedPayloadSchema` are already shipped.
- `apps/moderator/`, `apps/participant/`, `apps/root/`, `apps/server/` — no cross-surface change. The participant's `participantRosterFrom` stays put; the moderator's `deriveSlotOccupants` stays put; no shell extraction means no consumer-side migration.
- `tests/e2e/` — no Playwright change (Decision §7 — e2e deferred to `aud_graph_rendering.aud_cytoscape_init`).
- `tests/behavior/` — no Cucumber change (Decision §6 — pure projection layer, no wire seam).
- `packages/i18n-catalogs/` — no new i18n keys.
- `.tji` files — the `complete 100` marker for `aud_state_management` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (every decision below is a direct application of an existing ADR or a scoped projection-shape policy).

### Projector shape (`apps/audience/src/state/sessionRoster.ts`)

```ts
// `sessionRoster.ts` — audience-side per-event-log projector returning a
// `userId → screenName` resolver for the session's currently-present
// participants.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §4 — duplicate-for-v0 over extract-to-shell; the audience
//   is the second general-roster caller after the participant. The
//   convention recorded at apps/participant/src/detail/participantRoster.ts:22-24
//   reserves the third caller as the extraction trigger; this leaf is
//   the second.)
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//   (Decision §5 — canonical source for the set-on-joined /
//   delete-on-left semantics this projector mirrors.)
//
// Algorithm + behaviour: identical to participantRosterFrom in the
// participant workspace. Diverges from the moderator's deriveSlotOccupants
// (which keys by role, not userId, because the moderator's invite panel
// renders slot rows, not voter attribution).

import type { Event } from '@a-conversa/shared-types';

export const EMPTY_AUDIENCE_ROSTER: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>(),
);

export function sessionRosterFrom(events: readonly Event[]): ReadonlyMap<string, string> {
  const roster = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      roster.set(event.payload.user_id, event.payload.screen_name);
      continue;
    }
    if (event.kind === 'participant-left') {
      roster.delete(event.payload.user_id);
      continue;
    }
  }
  if (roster.size === 0) {
    return EMPTY_AUDIENCE_ROSTER;
  }
  return roster;
}
```

### Projector shape (`apps/audience/src/state/sessionMode.ts`)

```ts
// `sessionMode.ts` — audience-side per-event-log projector returning the
// session's current mode (`'lobby' | 'operate'`).
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §5 — `'lobby'` is the v0 default until the first
//   `session-mode-changed` envelope arrives. The audience needs the
//   persistent mode value because rendered chrome depends on it: lobby
//   = roster + waiting screen, operate = graph canvas. The participant's
//   single-event-triggered filter at LobbyRoute.tsx:469 is structurally
//   different — that's a navigation trigger, not a render switch.)
// ADRs: 0028 (session-mode-changed dedicated event).

import type { Event, SessionMode } from '@a-conversa/shared-types';

const DEFAULT_MODE: SessionMode = 'lobby';

export function sessionModeFrom(events: readonly Event[]): SessionMode {
  let mode: SessionMode = DEFAULT_MODE;
  for (const event of events) {
    if (event.kind === 'session-mode-changed') {
      mode = event.payload.new_mode;
    }
  }
  return mode;
}
```

### URL helper shape (`apps/audience/src/state/sessionId.ts`)

```ts
// `sessionId.ts` — audience-side URL helpers for resolving the
// currently-viewed session id from the browser pathname.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §3 — duplicate `stripAudienceBasename` of the inline
//   logic in apps/audience/src/App.tsx:61-69; the App-level read is
//   for locale negotiation, this read is for session-id parsing.
//   Consolidation is deferred to aud_url_routing.aud_session_url
//   when that leaf lands a real <Route path="/:locale?/sessions/:id">
//   pattern that supersedes both reads.)
//
// Canonical audience URL grammar (per aud_app_skeleton.md §"Locale
// negotiation"): `/a/{locale}?/sessions/{uuid}`. The root host strips
// `/a` when matching the SurfaceHost route; this helper expects the
// already-stripped path under the audience basename (or strips it
// itself via stripAudienceBasename for window.location.pathname reads).

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stripAudienceBasename(pathname: string): string {
  if (pathname === '/a') return '/';
  if (pathname.startsWith('/a/')) return pathname.substring(2);
  return pathname;
}

export function sessionIdFromPathname(pathname: string): string | null {
  // The pathname can be `/sessions/<uuid>` or `/{locale}/sessions/<uuid>`.
  // Split on `/sessions/` and take the trailing segment up to the next
  // boundary; reject anything that's not a strict UUID.
  const marker = '/sessions/';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const tail = pathname.substring(idx + marker.length);
  const candidate = tail.split('/')[0]?.split('?')[0];
  if (candidate === undefined || candidate === '') return null;
  if (!UUID_REGEX.test(candidate)) return null;
  return candidate;
}
```

### Selector hook shape (`apps/audience/src/state/useAudienceSessionRoster.ts`)

```ts
import { useMemo } from 'react';

import { useAudienceSessionEvents } from '../ws/index.js';
import { sessionRosterFrom } from './sessionRoster.js';

export function useAudienceSessionRoster(sessionId: string): ReadonlyMap<string, string> {
  const events = useAudienceSessionEvents(sessionId);
  return useMemo(() => sessionRosterFrom(events), [events]);
}
```

Stable empty-map identity is preserved through `sessionRosterFrom`'s `EMPTY_AUDIENCE_ROSTER` early-return; the `useMemo` keeps the projection result stable across renders that don't change the events slice.

### Selector hook shape (`apps/audience/src/state/useAudienceSessionMode.ts`)

```ts
import { useMemo } from 'react';

import type { SessionMode } from '@a-conversa/shared-types';

import { useAudienceSessionEvents } from '../ws/index.js';
import { sessionModeFrom } from './sessionMode.js';

export function useAudienceSessionMode(sessionId: string): SessionMode {
  const events = useAudienceSessionEvents(sessionId);
  return useMemo(() => sessionModeFrom(events), [events]);
}
```

### URL hook shape (`apps/audience/src/state/useAudienceSessionId.ts`)

```ts
import { useSyncExternalStore } from 'react';

import { sessionIdFromPathname, stripAudienceBasename } from './sessionId.js';

function snapshotSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionIdFromPathname(stripAudienceBasename(window.location.pathname));
}

function subscribeToPathname(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function useAudienceSessionId(): string | null {
  return useSyncExternalStore(subscribeToPathname, snapshotSessionId, snapshotSessionId);
}
```

- `useSyncExternalStore` is the React-18 idiom for subscribing to non-React state without provoking tearing under concurrent rendering; the third argument (the SSR snapshot) is the same as the client snapshot because the audience surface only ever runs in a browser (no SSR path).
- `popstate` fires on `history.back()` / `forward()` / direct pathname changes via the browser address bar. React Router's `useNavigate(...)` triggers a `popstate` indirectly through its history wrapper; for the audience's single wildcard route today, no in-app navigation happens — but the hook is forward-compatible with `aud_url_routing.aud_session_url`'s eventual route table.

### Facade hook shape (`apps/audience/src/state/useAudienceSession.ts`)

```ts
import type { Event, SessionMode } from '@a-conversa/shared-types';
import type { WsConnectionStatus } from '@a-conversa/shell';

import {
  useAudienceConnectionStatus,
  useAudienceSessionEvents,
} from '../ws/index.js';
import { useAudienceSessionId } from './useAudienceSessionId.js';
import { useAudienceSessionMode } from './useAudienceSessionMode.js';
import { useAudienceSessionRoster } from './useAudienceSessionRoster.js';

export interface AudienceSessionView {
  /** The session id parsed from the URL (`null` until a `/sessions/<uuid>` URL is reached). */
  readonly sessionId: string | null;
  /** The WS connection status surfaced by the shell client. */
  readonly connectionStatus: WsConnectionStatus;
  /** The ordered event stream for the active session, or empty if no session id. */
  readonly events: readonly Event[];
  /** The currently-present-participants roster, or empty if no session id. */
  readonly roster: ReadonlyMap<string, string>;
  /** The current session mode, `'lobby'` by default until a `session-mode-changed` is observed. */
  readonly sessionMode: SessionMode;
}

const NO_SESSION_PLACEHOLDER_ID = '__none__';

export function useAudienceSession(): AudienceSessionView {
  const sessionId = useAudienceSessionId();
  const lookupKey = sessionId ?? NO_SESSION_PLACEHOLDER_ID;
  const connectionStatus = useAudienceConnectionStatus();
  const events = useAudienceSessionEvents(lookupKey);
  const roster = useAudienceSessionRoster(lookupKey);
  const sessionMode = useAudienceSessionMode(lookupKey);
  return {
    sessionId,
    connectionStatus,
    events,
    roster,
    sessionMode,
  };
}
```

- The `NO_SESSION_PLACEHOLDER_ID` sentinel keeps the React hook contract stable (same hooks called in the same order on every render); the underlying `useAudienceSessionEvents` returns `EMPTY_EVENTS` for the sentinel id (no envelopes were ever applied to it), so `events`/`roster`/`sessionMode` correctly degrade to empty / default when no session is being viewed.
- The returned object is freshly minted per render; consumers that need stable identity for `useEffect` dependency arrays should destructure individual fields (which ARE stable across no-change renders by virtue of Zustand's selector identity for `events`/`connectionStatus`, and `useMemo`'s identity for `roster`/`sessionMode`).

### Barrel shape (`apps/audience/src/state/index.ts`)

```ts
// Audience workspace's state-derivation barrel.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//
// Single import point downstream audience UI leaves use to consume
// derived state. The `useAudienceSession()` facade is the canonical
// entry; the focused projectors + selectors are exported for the rare
// consumer that wants one slice without the others (e.g. a future
// producer-facing status chip that only needs `useAudienceConnectionStatus`).
//
// Separate from `apps/audience/src/ws/index.ts`'s read-only barrel
// (which intentionally narrows the WS-client surface per aud_ws_client
// Decision §6). The narrowing intent stays legible by keeping the two
// barrels separate.

export { sessionRosterFrom, EMPTY_AUDIENCE_ROSTER } from './sessionRoster.js';
export { sessionModeFrom } from './sessionMode.js';
export { sessionIdFromPathname, stripAudienceBasename } from './sessionId.js';
export { useAudienceSessionRoster } from './useAudienceSessionRoster.js';
export { useAudienceSessionMode } from './useAudienceSessionMode.js';
export { useAudienceSessionId } from './useAudienceSessionId.js';
export { useAudienceSession, type AudienceSessionView } from './useAudienceSession.js';
export type { SessionMode } from '@a-conversa/shared-types';
```

### What the state layer MUST NOT do

- **No `fetch`, no `WebSocket`, no `setTimeout`** in projectors or hooks. All side effects belong to consumers (the WS substrate already populated the store via `aud_ws_client`'s landed code).
- **No localStorage / sessionStorage / cookies.** Audience state is fully ephemeral; a refreshed tab re-derives from the WS replay.
- **No direct `audienceWsStore` import** outside the existing `ws/` barrel's own files. Every new state file consumes the narrowed read-only barrel (`useAudienceSessionEvents` / `useAudienceConnectionStatus`) so the TypeScript-narrowing posture from `aud_ws_client` Decision §6 stays enforced.
- **No `useEffect`** in the new hooks — `useSyncExternalStore` is the only React-non-render mechanism this leaf uses, and it's the *correct* one for external-state subscription. A `useEffect`-driven manual subscription would re-introduce the tearing risk `useSyncExternalStore` was designed to fix.
- **No mutation of input arrays / maps.** Projectors return fresh `Map` instances (or the `EMPTY_AUDIENCE_ROSTER` frozen singleton); they never mutate the events slice they receive.
- **No cross-projector calls.** `sessionRosterFrom` does not call `sessionModeFrom`; each projector reads the events list once and walks it. Composition happens in the selector hooks (and the facade), not in the projectors.
- **No consumer wiring in production code.** The audience placeholder route does NOT subscribe to `useAudienceSession()` (Decision §1's twin of `part_state_management` Decision §7 — the React-component-re-renders-on-update probe lives in test code, not production).

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest projector unit tests** — `sessionRoster.test.ts` (5 cases), `sessionMode.test.ts` (4 cases), `sessionId.test.ts` (6 cases). Pure-function inputs/outputs; no React, no store. Catches "someone changed the participant-joined payload shape and the audience roster silently broke" or "someone changed the basename and the URL parser silently broke."
2. **Vitest selector-hook React harness tests** — `useAudienceSessionRoster.test.tsx` (3 cases), `useAudienceSessionMode.test.tsx` (3 cases), `useAudienceSessionId.test.tsx` (4 cases). Each harness mounts a tiny consumer component, asserts the initial value, dispatches an event (or pushes a pathname), asserts the consumer re-renders with the new value. The stable-reference cases prevent downstream re-render churn (the same property `useAudienceSessionEvents.test.ts` pins for the WS layer).
3. **Vitest facade integration test** — `useAudienceSession.test.tsx` (2 cases). One case asserts every field of the returned view at initial mount; one case asserts the view updates field-by-field after `audienceWsStore.getState().applyEvent(...)` + `setConnectionStatus('open')`.

**Grand total: ~30 Vitest cases (+30).**

**No Cucumber scenario** (Decision §6 — pure projection, no wire seam). **No Playwright spec** (Decision §7 — no visible UI added; deferred to `aud_graph_rendering.aud_cytoscape_init`).

### Failing-first verifiability (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md))

Each new test is independently failable:

- **`sessionRoster.test.ts`** — stubbing `sessionRosterFrom` to return `EMPTY_AUDIENCE_ROSTER` unconditionally breaks the "one join sets entry" case; replacing the `delete` arm with a `set('left', ...)` breaks the "join + leave deletes" case.
- **`sessionMode.test.ts`** — stubbing `sessionModeFrom` to return `'lobby'` always breaks the "first session-mode-changed → 'operate'" case; replacing the for-loop with a `find` (first instead of last) breaks the "multiple transitions" case.
- **`sessionId.test.ts`** — stubbing `sessionIdFromPathname` to return the raw tail (no UUID validation) breaks the "malformed UUID" rejection case; stubbing `stripAudienceBasename` to no-op breaks every `/a/`-prefixed assertion.
- **`useAudienceSessionRoster.test.tsx`** — dropping the `useMemo` and returning a fresh `sessionRosterFrom(events)` per render breaks the stable-reference case; reading from a different store breaks the post-event case.
- **`useAudienceSessionMode.test.tsx`** — wiring the hook to a different event kind (`'session-snapshot'` instead of `'session-mode-changed'`) breaks all cases.
- **`useAudienceSessionId.test.tsx`** — dropping the `subscribe` argument to `useSyncExternalStore` breaks the `popstate` re-derive case; replacing `snapshotSessionId` with `() => null` breaks every positive case.
- **`useAudienceSession.test.tsx`** — removing any field from the returned view fails the initial-mount assertion (the assertion is field-by-field, not a deep-equal); not calling `useAudienceConnectionStatus` breaks the `setConnectionStatus('open')` case.

### UI-stream e2e policy

**E2e is deferred from this leaf — the state primitives this task adds are not yet wired into any user-visible flow.** This is the textbook deferred-e2e case from `ORCHESTRATOR.md`'s "Deferred-e2e exception — when the component is not yet reachable":

- The three projectors + four hooks have **zero production consumers** after this leaf. The placeholder route at [`apps/audience/src/App.tsx:40-48`](../../../apps/audience/src/App.tsx#L40) doesn't subscribe to them; the audience surface has no chrome to subscribe to them; the WS hooks they consume are already pinned by `aud_ws_client`'s Vitest layer.
- There is no user-perspective behavior change a Playwright spec could pin. Asserting `data-testid` against derived state requires a visible affordance reading from `useAudienceSession()`; adding a debug-only DOM mirror would be removed by `aud_graph_rendering.aud_cytoscape_init` (the first leaf that surfaces a visible event-driven affordance) and would amount to throwaway verification under ADR 0022.

**The unit/component coverage that stands in for the deferred e2e:** the ~30 Vitest cases above pin every projector's pure-function contract, every selector hook's React-render-cycle integration, the URL hook's `useSyncExternalStore` subscription correctness, and the facade hook's end-to-end composition. The Vitest layer covers everything a Playwright spec at this leaf's scope *could* assert, since there is no user-visible production behavior to drive.

**The wiring task that inherits this deferred-e2e debt:**

- **`audience.aud_graph_rendering.aud_cytoscape_init`** (existing WBS leaf, `depends !aud_shell, !graph_lib_decision`) — the first audience leaf to surface a visible event-driven affordance (a node appearing on the canvas). Its refinement MUST scope a Playwright spec that asserts (a) `useAudienceSession().sessionId` resolves from the URL on mount, (b) `useAudienceSession().events` populates after the WS handshake, (c) a node-created event broadcast results in a visible node on the Cytoscape canvas. The audience-WS Playwright assertion deferred by `aud_ws_client.md` Decision §10 also inherits to this same leaf; together with this leaf's deferred-state e2e, that gives `aud_cytoscape_init` a single coherent Playwright scenario covering "audience visitor sees a node arrive over WS via the derived state layer." Per `ORCHESTRATOR.md`'s tech-debt registration policy, no new WBS leaf needs to be registered (the inheritor exists with the right `depends` edges).

### Budget honesty (1d)

- ~20 min: write `sessionRoster.ts` (the algorithm is a near-verbatim duplicate of `participantRosterFrom`; the audience-prefixed name + the comment block citing the duplicate decision are the only real work).
- ~15 min: write `sessionMode.ts` (smaller — a one-arm reduce returning the last `new_mode`).
- ~30 min: write `sessionId.ts` (UUID regex + the two helpers + careful tests on the malformed cases).
- ~45 min: write the three selector hooks (`useAudienceSessionRoster`, `useAudienceSessionMode`, `useAudienceSessionId`) including the `useSyncExternalStore` subscribe/snapshot wiring.
- ~30 min: write `useAudienceSession.ts` facade + the `AudienceSessionView` interface + the `NO_SESSION_PLACEHOLDER_ID` sentinel rationale comment.
- ~15 min: write `index.ts` barrel.
- ~2.5h: write all seven test files (~30 cases total, ~600 LOC including React harness boilerplate).
- ~30 min: full `pnpm run check` + `pnpm run test:smoke` + the WBS-status ritual prep + the commit.
- ~30 min: failing-first verification pass per ADR 0022 (toggle each projector to a wrong value, confirm the test fails with a useful diff, restore).

Risk surface is small:

- All projectors are pure functions over an already-validated event log; no Zod re-validation, no async, no error paths.
- The hooks compose existing primitives (`useAudienceSessionEvents` + `useMemo` + `useSyncExternalStore`); no novel React concurrency patterns.
- The biggest implementation hazard is the `useSyncExternalStore` SSR snapshot signature — React-18 requires the third argument to be a serializable snapshot identical to the client snapshot for hydration parity. Since the audience never SSRs, the third arg can be the same `snapshotSessionId` function the client uses; the test pins this.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move.
2. **`pnpm -F @a-conversa/audience typecheck` exits zero** — every new file compiles under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)). The projector input/output types use `readonly Event[]` and `ReadonlyMap`; the facade's `AudienceSessionView` interface has no `any`.
3. **`pnpm -F @a-conversa/audience build` exits zero** — same library-mode build the predecessors pinned; bundle filename / sidecar shape unchanged; the new state code tree-shakes into the existing `audience-<hash>.js`.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+30 approximately** (5 + 4 + 6 + 3 + 3 + 4 + 2 + a small buffer for React-harness setup cases). Author may adjust by ±5 if a case naturally splits.
6. **No Cucumber scenario change** — `pnpm run test:behavior:smoke` count unchanged. The audience subscribe-only wire contract is already pinned by `aud_ws_client`'s 3 scenarios (Decision §6).
7. **No Playwright spec change** — `pnpm run test:e2e --project=chromium-audience-skeleton` runs the **existing single scenario** green; no new scenario in this leaf (Decision §7 — deferred to `aud_graph_rendering.aud_cytoscape_init`). Total Playwright scenarios unchanged across all projects.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No `apps/audience/src/stores/` directory created** (Decision §1). A grep for the directory returns "does not exist."
10. **No `audienceWsStore` import outside the `ws/` directory** — a grep for `import .* audienceWsStore` under `apps/audience/src/state/` returns zero matches. The new state files consume the narrowed barrel (`useAudienceSessionEvents` / `useAudienceConnectionStatus`), preserving the TypeScript-narrowing posture from `aud_ws_client` Decision §6.
11. **No `useEffect` in the new hook files** — a grep for `useEffect` under `apps/audience/src/state/use*.ts` returns zero matches. `useSyncExternalStore` is the only non-render React hook used; `useMemo` is the only memoization hook.
12. **No new top-level dependency** — `apps/audience/package.json` is unchanged; `pnpm-lock.yaml` is unchanged.
13. **Failing-first verifiability documented and demonstrated** — for at least two projectors, the Implementer flips the output to a sentinel value, confirms the corresponding Vitest case fails with a useful diff, then restores. Mirrors the practice from `aud_ws_client.md`'s Status block's "Double failing-first verification" note.
14. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `aud_state_management` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
15. **Predecessor's existing assertions unchanged** — the audience-skeleton's Vitest mount-boundary case at `apps/audience/src/mount.test.tsx` passes unchanged; the three `apps/audience/src/ws/*.test.ts` files pass unchanged; `tests/e2e/audience-skeleton-smoke.spec.ts` passes unchanged; the three `ws-audience-subscribe.feature` scenarios pass unchanged.

## Decisions

### 1. No `apps/audience/src/stores/` directory — audience has no interactive local-UI state in v0

Three alternatives surveyed:

- **(A) No `stores/` directory** (chosen). The audience surface is read-only by design: no vote buffer (audience doesn't vote), no selection state (no tap-to-select in v0; the broadcast surface is a video feed, not an interactive panel), no zoom toggle (the canvas is auto-fit per `docs/audience-broadcast.md`'s OBS guidance — no user gesture), no tab switcher (single-region layout). The moderator's `useCaptureStore` / `useSelectionStore` / `useUiStore` triad and the participant's `useVoteStore` / `useSelectionStore` / `useUiStore` triad both have no audience analog. Creating an empty `stores/index.ts` would be ceremony, not contract — a placeholder file the future audience interactive widget (if one ever lands) would need to organize regardless. Skipping the directory is the cleanest signal that the recipe's three parts (server-state store, local-UI slices, projection helpers) are genuinely separable.
- **(B) Create an empty `stores/index.ts` for symmetry** with the moderator + participant. Rejected — empty barrels are diff-noise; they age into "what was this supposed to hold?" confusion. The third surface lands the recipe by *not* needing the slice piece, and the absence of `stores/` is documented here as the Decision; a future interactive-audience widget reads this decision and knows the directory was deliberately omitted, not forgotten.
- **(C) Move `useAudienceSession()` and friends into `apps/audience/src/stores/`** so the directory exists but holds derivation helpers instead of Zustand slices. Rejected — would conflate two distinct concepts (Zustand-backed mutable slices vs. derived selectors over the WS store); the moderator + participant both organize derived selectors *outside* `stores/` (the participant's `participantRoster.ts` lives in `detail/`, the participant's `lookupEntity.ts` lives in `detail/`). The audience's `state/` directory naming mirrors the established convention of co-locating derived state with the domain that owns it; for the audience, every derivation is "session-scoped state," hence `state/`.

The audience proves the recipe's parts are separable. The decision is explicit so a future reader doesn't add an empty `stores/` directory looking for a place to put something that doesn't yet exist.

### 2. Public API surface: `useAudienceSession()` facade + five focused exports

Three alternatives surveyed:

- **(A) Facade + focused exports** (chosen). The downstream `aud_graph_rendering.*` family imports `useAudienceSession()` and gets every common derivation; the focused exports (`useAudienceSessionRoster`, `useAudienceSessionMode`, `useAudienceSessionId`, `useAudienceConnectionStatus` re-exported from the WS barrel implicitly via the facade) stay available for the rare consumer that wants one slice. A future producer-facing status chip can `import { useAudienceConnectionStatus } from '../ws'` (already exposed); a future lobby-only chrome component can `import { useAudienceSessionMode } from '../state'` without pulling in the events list. The facade is the default; the focused hooks are the escape hatch.
- **(B) Only the facade — no focused exports.** Rejected — would force every consumer to read every field even when they need one (a status chip that only needs `connectionStatus` would have to subscribe to the events list too, which causes the chip to re-render on every `event-applied` broadcast — wasted reconciliation work that's an easy regression to introduce later).
- **(C) Only focused hooks — no facade.** Rejected — would force every consumer in `aud_graph_rendering.*` to import 4-5 hooks individually and compose them; the duplication multiplies across leaves and the facade's "single dependency on this leaf" property is lost. The facade is also the right place to land the `NO_SESSION_PLACEHOLDER_ID` sentinel so individual focused hooks don't all need to redundantly handle the `sessionId === null` case.

The chosen approach minimises both consumer-side duplication and unnecessary subscription churn.

### 3. URL handling: `useAudienceSessionId()` is `useSyncExternalStore` over `popstate`, NOT React Router's `useParams()`

Three alternatives surveyed:

- **(A) `useSyncExternalStore` over `popstate` + a pure `sessionIdFromPathname` helper** (chosen). The audience surface today has a *single wildcard route* (`<Route path="*" element={<PlaceholderRoute />} />` at [`apps/audience/src/App.tsx:80-82`](../../../apps/audience/src/App.tsx#L80)); React Router's `useParams()` returns `{ '*': '<everything-after-the-basename>' }` with no structured session-id extraction. Hand-parsing the pathname is required either way. Doing it through `useSyncExternalStore` keeps the hook independent of the route table — when `aud_url_routing.aud_session_url` lands a real `<Route path="/:locale?/sessions/:id">`, the hook can be swapped to read from `useParams()` (and the test contract stays the same: same input pathname → same output session id).
- **(B) `useParams()` from React Router.** Rejected today — the wildcard route doesn't expose a typed `:id` param. After `aud_url_routing.aud_session_url` lands, this becomes the right shape; the swap is a one-file edit when the time comes. Doing it now would force a route-table change in *this* leaf, which is `aud_url_routing.aud_session_url`'s scope.
- **(C) Read once on mount, no subscription.** Rejected — the audience may eventually navigate (e.g. a producer's "switch session" button in a control surface), and a no-subscription hook would silently return the stale id. The `useSyncExternalStore` subscription is cheap (one `popstate` listener per surface instance) and forward-compatible.

The `stripAudienceBasename` duplicate of `apps/audience/src/App.tsx:61-69`'s inline logic is acknowledged technical debt; consolidation lands with `aud_url_routing.aud_session_url`'s real route table.

### 4. `sessionRosterFrom` lives in `apps/audience/src/state/`, NOT in `@a-conversa/shell`

Three alternatives surveyed:

- **(A) Duplicate the participant's `participantRosterFrom` into the audience workspace** as `sessionRosterFrom` (chosen). The participant's `participantRoster.ts:22-24` reserves "the third caller (audience) is the natural extraction trigger" — but the audience IS the second *general* caller (the moderator's `deriveSlotOccupants` keys by role, not userId, and exists for a structurally different rendering surface — the slot-grid; it is NOT the same projector). Per the convention "extract on the third caller, not the second," this leaf duplicates. The duplication is explicit, documented in both the file header and this Decision, and ages cleanly: when a fourth general roster need surfaces (e.g. `replay-test` viewing a session's per-participant attribution), THAT leaf extracts to shell.
- **(B) Extract `participantRosterFrom` to `@a-conversa/shell`** in this leaf (move the helper from `apps/participant/src/detail/participantRoster.ts` to `packages/shell/src/projections/sessionRoster.ts`; update both the participant consumer and the new audience consumer). Rejected for v0 because:
  - It widens this leaf's scope from "audience state derivation" to "shell substrate extraction" — a cross-cutting change touching three workspaces (shell, participant, audience) with its own ADR-amendment-or-no-amendment question (does `shell_substrate_extraction`'s charter cover event-log projectors? probably yes, but the question deserves an explicit pass not done as a side effect).
  - The participant's existing test file (`participantRoster.test.ts`) would need either a move + import-path update OR a duplicate; either way, more diff than the audience-local duplicate.
  - The convention recorded in the participant's own header is "extract on the third caller, not the second"; respecting the convention keeps the code review's "why now?" question answerable with "because the convention said so."
- **(C) Import `participantRosterFrom` from the participant workspace directly** (`import { participantRosterFrom } from '@a-conversa/participant'`). Rejected — the audience workspace does NOT depend on the participant workspace in any other way (and adding the dep would be architecturally backward — audience is its own surface, not a participant feature). Cross-workspace imports between sibling apps are an antipattern even when they technically work.

The duplicate-for-v0 decision is registered as a follow-up trigger: **when the fourth general roster caller surfaces** (likely `replay-test` viewing arbitrary sessions; possibly a future `audience.aud_lobby_chrome` leaf that renders the roster as a waiting-screen list), THAT leaf MUST extract to `packages/shell/src/projections/sessionRoster.ts`. Per `ORCHESTRATOR.md`'s tech-debt registration policy, no new WBS leaf is registered today (the convention is the registration; the next general caller's Refinement-Writer is expected to land the extraction as part of the third-caller's scope).

### 5. Session-mode awareness: derive current mode from `session-mode-changed`; default `'lobby'`

Three alternatives surveyed:

- **(A) Walk `session-mode-changed` envelopes, return last `new_mode`, default `'lobby'`** (chosen). The audience UI will render fundamentally different chrome in lobby (roster + "waiting for the debate to start" message) vs. operate (graph canvas), per [`docs/audience-broadcast.md`](../../../docs/audience-broadcast.md). The mode signal is per [ADR 0028](../../../docs/adr/) the dedicated `session-mode-changed` envelope; deriving from this single signal keeps the audience aligned with the moderator (who emits the transition) and the participant (who navigates on the same signal). The `'lobby'` default for an empty event log matches the methodology: a fresh session starts in lobby; the first `session-mode-changed` lands when the moderator hits "Enter session."
- **(B) Use the participant's `CONTENT_EVENT_KINDS` fallback** (any `node-created` / `edge-created` / etc. event implies operate mode). Rejected — the participant's fallback exists for ADR 0028 backward compatibility (replay-correctness for pre-ADR-0028 sessions where `session-mode-changed` didn't exist). The audience is a forward-only consumer (the audience UI doesn't ship until M6, well after ADR 0028 landed); using the fallback would couple the audience's rendering to events whose semantics are about content, not mode. The dedicated signal is the right input.
- **(C) Don't track mode in this leaf** — let the future `aud_graph_rendering.*` family derive mode itself. Rejected — mode is genuinely common state every audience UI leaf will want (the lobby chrome leaf, the operate chrome leaf, the segment-marker leaf all branch on mode); deriving it three times in three places is the kind of duplication this leaf's "common derivations" scope exists to prevent.

The `'lobby'` default is also the safer fallback for a freshly-mounted audience surface that hasn't yet received the WS catch-up replay: showing the lobby chrome briefly before the real mode arrives is benign (debater perception: "the show is about to start"); showing the operate chrome briefly when the session is actually in lobby would be a visible flicker (an empty canvas for a frame).

### 6. No Cucumber scenario at this leaf

Three alternatives surveyed:

- **(A) No Cucumber scenario** (chosen). The audience subscribe-only wire path is already pinned by [`tests/behavior/backend/ws-audience-subscribe.feature`](../../../tests/behavior/backend/ws-audience-subscribe.feature) (3 scenarios landed by `aud_ws_client`). This leaf is state DERIVATION from the events the wire delivers — pure projection logic consumed only by audience UI. Per `ORCHESTRATOR.md`'s "Behavior + e2e coverage growth" steer, Cucumber pins protocol / broadcast / projector outputs observable at the system seam. The audience's projection helpers don't cross the wire boundary; they're consumed entirely client-side. Vitest covers them correctly.
- **(B) Add a Cucumber scenario that asserts the audience client subscribes, receives a `session-mode-changed` envelope, and the projector returns `'operate'`.** Rejected — would either (a) require the test to drive the JSDOM client through a fake WS upgrade path, which is not the Cucumber harness's shape (Cucumber drives the real server's WS upgrade), or (b) re-use the existing `ws-audience-subscribe.feature`'s 2nd scenario (subscribe-and-receive-live-broadcast) with a different envelope payload. Option (a) is the wrong tool; option (b) duplicates existing coverage without pinning the projector contract (the projector contract is at the React-render level, not the wire level).
- **(C) Add a Cucumber scenario for `aud_state_management` that pins the audience receives a `participant-joined` envelope and the future audience UI's roster eventually shows the participant.** Rejected — same issue as (B); also requires a visible audience UI to assert against, which doesn't exist until `aud_graph_rendering.*`.

The Vitest-only coverage at this layer is the right call. Cucumber lands again with the next audience leaf that crosses a system seam (likely `aud_no_auth_for_public`, which widens the WS auth-gate — that IS a wire-contract change).

### 7. No Playwright spec; deferred to `aud_graph_rendering.aud_cytoscape_init`

Three alternatives surveyed:

- **(A) Defer the Playwright assertion to `aud_graph_rendering.aud_cytoscape_init`** (chosen). Per `ORCHESTRATOR.md`'s UI-stream e2e policy + deferred-e2e exception, the audience IS a UI-stream area, BUT the state primitives this leaf adds have no visible UI surface. The audience-skeleton's existing Playwright spec at [`tests/e2e/audience-skeleton-smoke.spec.ts`](../../../tests/e2e/audience-skeleton-smoke.spec.ts) already pins surface-mount; this leaf's state layer lands beneath it. The first audience leaf that surfaces a visible state-driven affordance (a node appearing on the canvas) is the natural place to pin "an audience visitor sees the derived state become user-visible end-to-end." That leaf — `aud_graph_rendering.aud_cytoscape_init` — already exists with the right `depends` edges; its Refinement-Writer inherits this leaf's deferred-e2e debt + the deferred-WS debt from `aud_ws_client.md` Decision §10 together, giving one coherent Playwright scenario.
- **(B) Add a debug-only DOM mirror to the audience surface** (a `<div data-testid="audience-session-state">` that JSON-stringifies `useAudienceSession()`) and a Playwright scenario that asserts the mirror updates on event arrival. Rejected — the debug mirror would be removed by `aud_graph_rendering.aud_cytoscape_init` (replaced by the actual canvas + chrome); per ADR 0022 a test artifact that gets removed by the next leaf is throwaway verification.
- **(C) Add a Playwright spec asserting the URL parser correctly extracts the session id on a `/a/sessions/<uuid>` navigation.** Rejected — the parser has Vitest coverage that's strictly more thorough (covers malformed UUIDs, locale prefixes, missing markers); a Playwright assertion would only restate one of the Vitest cases more slowly + more fragilely.

The Playwright deferral is inherited debt on `aud_graph_rendering.aud_cytoscape_init`. Per `ORCHESTRATOR.md`'s tech-debt registration policy, no new WBS leaf needs to be registered (the inheritor exists).

### 8. Hooks consume the narrowed `ws/` barrel, NOT `audienceWsStore` directly

Two alternatives surveyed:

- **(A) Hooks consume `useAudienceSessionEvents` / `useAudienceConnectionStatus` from `../ws'` (chosen)**. Preserves the TypeScript-narrowed read-only posture from `aud_ws_client.md` Decision §6 — the `state/` files never see a `send`-side surface (because the barrel doesn't expose one). The indirection also keeps a future "swap the events selector for a typed projection store" path open without touching every state file (only the WS barrel's exported hook changes).
- **(B) Hooks consume `audienceWsStore` directly via `import { audienceWsStore } from '../ws/wsStore'`.** Rejected — would bypass the narrowed barrel and reach into the singleton store from a new directory; over time this erodes the narrowing intent (the next reader sees "audience/state imports the store directly, maybe I can too in audience/components"). Keeping every consumer outside `ws/` going through the barrel makes the narrowing self-enforcing.

### 9. Facade returns a fresh object each render; consumers destructure for stability

Two alternatives surveyed:

- **(A) Return a fresh `{ ... }` object per render** (chosen). Each field IS stable across no-change renders (Zustand selector identity for `events`/`connectionStatus`; `useMemo` identity for `roster`/`sessionMode`; primitive identity for `sessionId`/`sessionMode`). Consumers that need stable identity for `useEffect` dep arrays destructure individual fields — the standard React idiom for hook return objects.
- **(B) `useMemo` the entire returned object.** Rejected — the dep array would need to list every field, and the inner identity tracking IS already correct (the inner fields are individually stable); wrapping in an outer `useMemo` adds no protection but adds an extra comparison per render. The Zustand + `useMemo` chain inside the focused hooks is the right place for the identity work.

### 10. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0026's surface-consumes-from-shell-substrate; 0022's committed-test discipline; 0021's event-envelope discriminator; 0028's session-mode-changed signal; 0013's strict TypeScript; 0006's Vitest).
- A direct mirror of the participant's state-management shape (Decision §1's no-stores follows `part_state_management`'s slice-list-is-surface-specific; Decision §2's facade-plus-focused-hooks; Decision §8's barrel-narrowing-honored; Decision §9's freshly-minted-object-per-render is the participant + moderator's hook idiom).
- A scoped projection-shape policy that doesn't constrain other tasks (Decision §3's `useSyncExternalStore` over `useParams()`; Decision §4's duplicate-for-v0; Decision §5's lobby-default + dedicated-signal-only; Decision §6's no-Cucumber; Decision §7's deferred-Playwright).
- A deliberate non-decision deferred to a future leaf (Decision §3's URL-helper consolidation; Decision §4's third-general-caller extraction; Decision §7's wiring-leaf inherits the e2e debt).

The "no new dependencies" rule is satisfied. The "no new shell substrate" rule is honored. The "no new server-side change" rule is honored.

### 11. Tech-debt registration

- **No new WBS leaf needs to be registered by this leaf's Closer.** Three deferred items, all with named existing inheritors:
  - **Deferred Playwright e2e** (Decision §7) → inherits to `audience.aud_graph_rendering.aud_cytoscape_init` (existing WBS leaf with the right `depends` edges).
  - **`sessionRosterFrom` extraction to shell** (Decision §4) → inherits to whichever WBS leaf becomes the *third* general roster caller (typically `replay_test.*` viewing a session's attribution rows, OR a future `audience.aud_lobby_chrome` leaf that renders the roster as a waiting-screen list). The convention is the registration; no provisional task id needed.
  - **`stripAudienceBasename` consolidation between `App.tsx` and `sessionId.ts`** (Decision §3) → inherits to `audience.aud_url_routing.aud_session_url` (existing WBS leaf). That leaf lands a real `<Route path="/:locale?/sessions/:id">` pattern that supersedes both reads.
- **No i18n native-review leaf** — this leaf adds zero i18n keys.
- **No follow-up on per-session subscription wiring.** The `client.trackSession(sessionId)` lifecycle inherits to the first audience leaf with a real `:id` route (`audience.aud_url_routing.aud_session_url` or `audience.aud_graph_rendering.aud_cytoscape_init`), both of which already exist as open WBS leaves with the right `depends` edges.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-18.

- Landed the audience state-derivation layer as 8 source files under `apps/audience/src/state/`: 3 pure projectors (`sessionRoster.ts`, `sessionMode.ts`, `sessionId.ts`), 3 focused selector hooks via `useSyncExternalStore` (`useAudienceSessionRoster.ts`, `useAudienceSessionMode.ts`, `useAudienceSessionId.ts`), the `useAudienceSession.ts` facade returning `AudienceSessionView`, and an `index.ts` barrel — no `stores/` directory was created, which is itself the architectural signal that the audience surface has no interactive local-UI state (Decision §1).
- Co-located 7 Vitest files alongside the 8 source files (`sessionRoster.test.ts`, `sessionMode.test.ts`, `sessionId.test.ts`, `useAudienceSessionRoster.test.tsx`, `useAudienceSessionMode.test.tsx`, `useAudienceSessionId.test.tsx`, `useAudienceSession.test.tsx`), continuing the Vitest discipline established by earlier audience commits (`aud_app_skeleton`, `aud_ws_client`) per ADR 0006.
- `sessionRosterFrom` is a deliberate duplicate of the participant surface's `participantRosterFrom` — audience is the second general caller; extraction to `@aconversa/shell` is deferred to the future third general caller per Decision §4 (no provisional WBS leaf needed; the convention is the registration).
- `sessionModeFrom` derives the session mode strictly from `session-mode-changed` events per ADR 0028, defaulting to lobby in their absence — no heuristic fallback on participant-count or other signals (Decision §5).
- Triple failing-first verification per ADR 0022: each of the 3 projectors was stubbed in turn (`sessionRosterFrom → EMPTY_AUDIENCE_ROSTER`, `sessionModeFrom → DEFAULT_MODE`, `sessionIdFromPathname → null`) and the resulting expected failures (6 / 4 / 6 across roster/hook/facade tiers) were observed before each projector was restored to a passing implementation.
- Selector hooks consume only the narrowed `ws/` barrel — production code touches no `audienceWsStore` symbol directly, honoring Decision §8's barrel-narrowing rule.
- Cucumber and Playwright both deferred per refinement Decisions §6 (no new BDD scenarios — no UI behavior change) and §7 (Playwright wiring inherits to `audience.aud_graph_rendering.aud_cytoscape_init`, which is the first leaf that renders state into the DOM). Vitest counts moved 4052 → 4081 (+29); Cucumber + Playwright unchanged. No new tech-debt leaf registered — the 3 deferred items inherit cleanly to existing WBS leaves per Decision §11.
