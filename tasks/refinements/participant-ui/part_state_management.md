# Participant state-management setup

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_state_management`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_shell.part_app_skeleton` (settled — the participant workspace builds as a Vite library bundle exporting `MountFn`/`SurfaceModule`; `apps/participant/src/main.tsx` wraps the surface tree in `<I18nProvider>` + `<AuthValueProvider>` + `<BrowserRouter>`; the surface has a `dist/`-emitting build, a Vitest harness, and one Playwright spec under `chromium-participant-skeleton`; see [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L172)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_auth_flow` (settled — `useAuth()` is consumed in the surface chrome; identity is host-supplied, NOT a slice of any participant store; see [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md#L103-L146)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_landscape_layout` (settled — `<ParticipantLayout>` is the surface's chrome shell with stable footer/header/main slot testids; the layout itself is structure-only and reads no store; see [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md#L96-L121)).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_status_indicator` (settled — the connection-status chip reads from a one-line stubbed source-hook `useParticipantConnectionStatus()` at [`apps/participant/src/layout/useParticipantConnectionStatus.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts); Decision §2 of that refinement pre-committed that the future swap to `useWsStore((s) => s.connectionStatus)` is the one-line follow-up in `part_ws_client`. This leaf does NOT close that wiring debt — `part_ws_client` does — but this leaf supplies the `useWsStore` shape and the participant workspace's `stores/` barrel that the swap will import from. See Decision §5 below).
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — `BaseWsStoreState`, `BaseWsSessionState`, `WsConnectionStatus`, `WsStoreLike`, `createDefaultWsStore`, plus the WS client + provider all live in `@a-conversa/shell`; see [`packages/shell/src/ws/store-contract.ts`](../../../packages/shell/src/ws/store-contract.ts) and [`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts). This leaf consumes them; it does NOT widen the shell).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_shell.mod_state_management` (shipped 2026-05-11 — the canonical Zustand-stores precedent: three focused local-UI slices under `apps/moderator/src/stores/`, an opt-in dev-only devtools wrapper, and a single `stores.test.tsx` smoke suite. This leaf mirrors that recipe with participant-shaped slices; see [`tasks/refinements/moderator-ui/mod_state_management.md`](../moderator-ui/mod_state_management.md) and the live code at [`apps/moderator/src/stores/index.ts`](../../../apps/moderator/src/stores/index.ts)).

## What this task is

The Zustand-based local-state plumbing the rest of the participant surface plugs into. After this leaf:

- A new `apps/participant/src/stores/` directory ships with three focused slices, one tiny `devtools.ts` wrapper, and a barrel `index.ts` — exactly mirroring the moderator's `apps/moderator/src/stores/` shape so future readers don't have to re-derive the convention.
- The three slices, all in-memory only:
  - **`useVoteStore`** — per-`(proposalId, facetId)` pending agree/dispute votes the debater has tapped but the surface has not yet sent to the backend. The slice is "local UI state" in the strict sense: it holds the *button-pressed* signal so multiple components (the per-facet button strip, the voting summary, an eventual "agree all" gesture) can read a consistent local view. The actual round-trip lives in `part_voting.part_vote_single_tap` / `.part_change_vote_pre_commit` (future leaves) which will consume this slice as their pre-send buffer.
  - **`useSelectionStore`** — currently-selected entity on the graph canvas. One selection at a time, discriminated by `EntityKind` (mirrors the moderator's `selectionStore.ts` line-for-line — same `EntityKind` import from `@a-conversa/shared-types`, same `{ kind, id } | null` shape, same `select` / `clear` API).
  - **`useUiStore`** — global participant-UI toggles. Today: which tab the bottom-of-main switcher is on (`'graph'` vs. `'proposals'`, per `docs/participant-ui.md`'s "two primary regions, switchable by tab or split-view") and the graph-canvas zoom level (matching the moderator's `[MIN_ZOOM, MAX_ZOOM]` clamp). The pending-vote count badge — which `docs/participant-ui.md` lists as a UI affordance — is NOT a store slice; it's a derived selector off `useVoteStore` + the future `useWsStore.sessionState[*].pendingProposals` (see Decision §3 — derived, not stored).
- A participant-local **`useWsStore`** at `apps/participant/src/ws/wsStore.ts` that returns the shell's `createDefaultWsStore()` factory output (re-exported as a singleton). Unlike the moderator's `wsStore.ts` which *extends* `BaseWsStoreState` with a participant-specific `activeDiagnostics` projection, the participant has no equivalent projection requirement today: the participant tablet reads `pendingProposals` for the per-facet voting controls and `connectionStatus` for the status chip, both of which are already on the base shape. Decision §2 picks "delegate to `createDefaultWsStore()`" over "extend the base contract" because the participant has no read demand the base doesn't already satisfy.
- The barrel at `apps/participant/src/stores/index.ts` re-exports all three local slices + the WS store + the shell's `WsConnectionStatus`/`BaseWsSessionState` types — the single import point downstream leaves use (matching the moderator's `apps/moderator/src/stores/index.ts:14-19` re-export-from-sibling-ws-dir convention).
- A devtools wrapper at `apps/participant/src/stores/devtools.ts` — a verbatim copy of the moderator's `apps/moderator/src/stores/devtools.ts` (10 LOC, opt-in via `import.meta.env.DEV` so prod tree-shakes the middleware). Each slice wraps its state-creator with `withDevtools('participant/<slice>', ...)` so the Redux DevTools store list reads coherently.
- A Vitest smoke suite at `apps/participant/src/stores/stores.test.tsx` that mirrors the moderator's `stores.test.tsx` cover: default values per slice, per-field setters, `reset()`/`clear()`/`removeVote()`, zoom clamping, plus a React-component-re-renders probe per slice. This is the acceptance-pin contract per ADR 0022 — the "trivial component reads from each store and re-renders on update" requirement the moderator stub's AC §3 baked in carries forward.

Out of scope (deferred to existing or future leaves):

- **The real WS subscription wiring.** This leaf supplies the `useWsStore` hook (the singleton returned by `createDefaultWsStore()`) but does NOT register it with a `<WsClientProvider>` or subscribe the participant surface to any session. The provider wiring + `createWsClient()` setup is `part_ws_client`'s deliverable; without it, `useWsStore.getState().connectionStatus` stays at the factory default of `'idle'` forever (no writer fires). This leaf's job is the *store*, not the client that drives it.
- **The status-indicator swap.** `apps/participant/src/layout/useParticipantConnectionStatus.ts` currently returns the literal `'connecting'`; the one-line swap to `useWsStore((s) => s.connectionStatus)` is `part_ws_client`'s closer per [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md#L326-L336) Decision §2. This leaf does NOT touch that file — but it does make the swap mechanically possible by landing the `useWsStore` import target. See Decision §5 for the rationale.
- **The vote-send round-trip.** `useVoteStore` holds the local buffer; the `POST`-vote-envelope round-trip lives in `part_voting.part_vote_single_tap` (which reads from this slice, sends via `useWsClient()` from the shell, then calls `removeVote()` on the slice on ack). This leaf ships the slice + the API surface; the consumer wiring is the future leaf's job.
- **The "agree all" gesture state.** `part_voting.part_agree_all_gesture` may want a transient "agree-all in flight" boolean similar to the moderator's `useCaptureStore.proposing` slice. Adding it now would pre-commit a shape the consuming task is the right place to settle. This leaf's `useVoteStore` API is intentionally narrow (set/remove per facet); per-bundle aggregate writers land when their consuming leaf decides.
- **The pending-proposals tab badge count slice.** Per Decision §3, the count is a derived selector (`Object.keys(sessionState[sid].pendingProposals).length - Object.keys(votedByFacet).length` or similar), not a stored field. The actual selector implementation lands in `part_pending_proposals.part_proposals_tab` (the WBS slot that owns the badge). This leaf does NOT add a `pendingProposalCount` field to `useUiStore`.
- **Persistence / localStorage / sessionStorage.** All slices are in-memory only, matching the moderator's `mod_state_management.md` Decision and the no-tokens-in-storage discipline carried through from the project's auth policy. A fresh tab is a fresh state.
- **A `useCaptureStore` equivalent.** Capture is the moderator's responsibility (debaters do not author proposals from the tablet — they vote on what the moderator captures, per `docs/participant-ui.md` "The debater **does not** directly edit the graph or capture statements"). The participant's slice list is intentionally shorter than the moderator's because the participant's surface area is narrower.
- **Real-time vote-update subscription** ("other debater's votes visible in real time" per `docs/participant-ui.md` P2). That data lives on `useWsStore.sessionState[sid].pendingProposals[pid]` (`ProposalStatusPayload` already carries per-participant vote state per the existing schema — see [`packages/shared-types/src/events.ts:340-357`](../../../packages/shared-types/src/events.ts#L340)). The graph + proposals views read from that field directly when they land; no participant-local mirror needed.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the M3-lobby milestone the orchestrator picks against today. This leaf is two structural blocks deep on that milestone's dependency frontier:

- `part_ws_client` (`depends !part_state_management, shell_package.shell_substrate_extraction`) — the WS-client wire-up cannot land without a `useWsStore` to feed. Once this leaf ships, `part_ws_client` is a 0.5d follow-up that lifts the moderator's `wsClient.ts` pattern (one `createWsClient({ store, url, getAuthState })` call + one `<WsClientProvider>` mount + the `useParticipantConnectionStatus` swap).
- Downstream of `part_ws_client`: the entire `part_session_join` group (lobby + invite-acceptance) needs `connectionStatus !== 'idle'` to be live, which requires the store to exist.

The chain a real debater hits today (after the four shipped `part_shell` leaves):

1. Debater clicks the invite URL `/p/sessions/<uuid>/invite?role=debater-A`.
2. Host gates auth; participant surface mounts; chrome paints with identity + status chip reading `'connecting'` (the stub).
3. **Today**: the chip stays at `'connecting'` forever because there is no `useWsStore` for the chip's source hook to ever swap to; downstream voting + invite-acceptance + lobby views cannot land because they all assume `useWsStore` is callable.
4. **After this leaf**: `useWsStore` is callable. The chip stays at `'connecting'` (still the stub source) but the swap target exists. `part_ws_client` can now land its `createWsClient({ store: useWsStore, ... })` call + the chip's source swap, at which point the chip flips to `'open'` on first handshake. The `useVoteStore` + `useSelectionStore` + `useUiStore` are also unblocked for `part_voting` / `part_graph_view` / `part_pending_proposals`.

Downstream concretely:

- **`part_ws_client`** — reads `useWsStore` (this leaf's export) as the store to pass into `createWsClient({ store: useWsStore, ... })`; performs the one-line swap inside `useParticipantConnectionStatus.ts` to `return useWsStore((s) => s.connectionStatus);`.
- **`part_voting.part_vote_single_tap`** — calls `useVoteStore().setVote(proposalId, facetId, 'agree')` on button tap, then sends via `useWsClient()`, then `removeVote(proposalId, facetId)` on ack.
- **`part_pending_proposals.part_proposals_tab`** — derives the badge count from `useWsStore((s) => s.sessionState[currentSessionId]?.pendingProposals)` + `useVoteStore` (already-voted set), surfaces it on the layout's footer right slot (the slot `part_status_indicator` deliberately left open per its Decision §3).
- **`part_graph_view.part_entity_detail_panel`** — calls `useSelectionStore().select({ kind: 'node', id })` on tap; the detail-panel route reads `useSelectionStore((s) => s.selected)` to know what to show.

Architecturally, this leaf is also the **second realization of the `mod_state_management` pattern** (after the moderator itself). Codifying the same "three focused slices + a devtools wrapper + a stores barrel + one Vitest smoke suite" recipe twice makes it a pattern the audience surface (next surface to land) can copy without ADR-level deliberation. The participant's slice list is shorter than the moderator's because the participant authors no proposals, but the *shape* of the shape is identical.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md#L17-L20) — "All participants — both debaters and the moderator — must agree on every change to the graph before it lands." The vote slice is the local-pre-send buffer for that agreement.
- [docs/participant-ui.md](../../../docs/participant-ui.md#L21-L31) — the two primary regions ("graph view" + "pending proposals pane"); the tab switcher this leaf's `useUiStore.currentTab` will drive.
- [docs/participant-ui.md P2](../../../docs/participant-ui.md#L60-L72) — "vote per facet" + "single-tap voting (no confirmation modal)" + "change vote pre-commit" — the consumption shape the `useVoteStore` API is sized for.
- [docs/participant-ui.md V1 defaults](../../../docs/participant-ui.md#L130-L138) — landscape tablet; multi-pending-proposal handling is a list view; undo-before-commit is "navigate and change your vote" (no separate undo store).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest store-shape cases + the React re-render probes are the regression pins; no manual "I tapped the button and saw the state update" smoke.
- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region. The participant's local-UI stores are participant-local (they don't live in `@a-conversa/shell` — only the *substrate* WS store contract does); this leaf's stores stay in `apps/participant/src/stores/` per the same boundary the moderator's `mod_state_management` honored. Decision §4 below records the not-in-shell rationale explicitly.
- [ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — strict TypeScript; the slice types use discriminated-union shapes (`Selection`, `VoteValue`) so consumers narrow correctly without `any`.
- [ADR 0005](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — not styling-relevant per se, but the deferred-tokens posture means slice keys don't reference design tokens; tokens-package consumers consume CSS, not stored state.

### Sibling refinements

- [`tasks/refinements/moderator-ui/mod_state_management.md`](../moderator-ui/mod_state_management.md) — the canonical precedent. What carries over verbatim: Zustand (Decision below mirrors), three focused slices + barrel + devtools wrapper, in-memory persistence, dev-only devtools, smoke-test contract ("trivial component reads from each store and re-renders on update"). What is intentionally different: participant slices are *different slices* (no capture; vote-buffer is participant-only).
- [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L120) — "NOT added: zustand, @dagrejs/dagre, reactflow, cytoscape — those land with the real participant UI in future leaves (`part_state_management`, `part_graph_view`, etc.)". This leaf is the one adding `zustand` to `apps/participant/package.json` deps.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md#L325-L336) Decision §2 — the stubbed `useParticipantConnectionStatus` source is the contract this leaf inherits; the closer-of-`part_ws_client` swaps it (not this leaf). The participant `useWsStore` this leaf exports is the eventual swap target.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md#L20-L31) — the `BaseWsStoreState` / `WsConnectionStatus` / `createDefaultWsStore` contract this leaf consumes. The "single-fetch consolidation" line applies here too: the participant has exactly one `useWsStore` singleton; the WS subsystem's writes are the only source of truth for connection-state.
- [`tasks/refinements/moderator-ui/mod_ws_client.md`](../moderator-ui/mod_ws_client.md) — the moderator's WS-client wire-up that `part_ws_client` will mirror. Useful context for understanding what this leaf's `useWsStore` will be plugged into.

### Live code the leaf integrates with

- [`apps/moderator/src/stores/index.ts:1-19`](../../../apps/moderator/src/stores/index.ts#L1) — the barrel shape this leaf's `apps/participant/src/stores/index.ts` mirrors: per-slice named exports + types + a sibling `../ws/wsStore.js` re-export. The participant barrel does the same thing with participant slice names.
- [`apps/moderator/src/stores/devtools.ts:1-37`](../../../apps/moderator/src/stores/devtools.ts#L1) — the entire file, ~20 LOC including comments. This leaf copies it verbatim into `apps/participant/src/stores/devtools.ts` (per Decision §4, the wrapper is participant-local; cross-surface extraction is premature).
- [`apps/moderator/src/stores/selectionStore.ts:1-33`](../../../apps/moderator/src/stores/selectionStore.ts#L1) — the participant's `useSelectionStore` is line-for-line identical except for the devtools name (`'participant/selection'` vs. `'moderator/selection'`). Same `EntityKind` import, same `Selection`/`SelectionState` types, same `select`/`clear` API.
- [`apps/moderator/src/stores/uiStore.ts:1-47`](../../../apps/moderator/src/stores/uiStore.ts#L1) — the moderator's `useUiStore`. The participant's equivalent uses different field names (`currentTab` instead of `activeSidebarPane`; same `zoom` + same clamp helper) but the same shape (one `set` per field, one `clamp` for zoom, a `withDevtools` wrap, exported `MIN_ZOOM`/`MAX_ZOOM` constants).
- [`apps/moderator/src/ws/wsStore.ts:1-194`](../../../apps/moderator/src/ws/wsStore.ts#L1) — the moderator's WS store extension. The participant does NOT extend; Decision §2 picks `createDefaultWsStore()` directly. The participant's `apps/participant/src/ws/wsStore.ts` is therefore ~5 lines: one `createDefaultWsStore()` call assigned to a module-level `useWsStore` singleton + a type re-export.
- [`packages/shell/src/ws/defaultStore.ts:39-142`](../../../packages/shell/src/ws/defaultStore.ts#L39) — `createDefaultWsStore()` factory. Returns a `UseBoundStore<StoreApi<BaseWsStoreState>>` — the participant's `useWsStore` is exactly this type, with no widening.
- [`packages/shell/src/ws/store-contract.ts:31`](../../../packages/shell/src/ws/store-contract.ts#L31) — the `WsConnectionStatus` discriminated union (five arms). The participant store inherits all five via `BaseWsStoreState`.
- [`packages/shared-types/src/events/enums.ts:49`](../../../packages/shared-types/src/events/enums.ts#L49) — the `EntityKind` discriminated union used by `useSelectionStore.Selection.kind`.
- [`packages/shared-types/src/events.ts:340-357`](../../../packages/shared-types/src/events.ts#L340) — the `VotePayload` Zod schema (`{ proposal_id, participant, vote: 'agree'|'dispute'|'withdraw', voted_at }`). The participant's `VoteValue` slice type aligns to the `vote` enum's `'agree' | 'dispute'` arms (withdraw is a separate flow per `docs/participant-ui.md` P3 — see Decision §6 for why withdraw is NOT in `useVoteStore`).
- [`apps/moderator/src/stores/stores.test.tsx:1-182`](../../../apps/moderator/src/stores/stores.test.tsx#L1) — the canonical store-smoke pattern. The participant `stores.test.tsx` mirrors the case shape (initial values per slice, setters mutate, reset/clear/remove return defaults, zoom clamps, three React probes that re-render on slice updates).

### Existing infrastructure this leaf rides

- [`apps/participant/package.json`](../../../apps/participant/package.json) — current deps. This leaf adds `zustand@5.0.13` (matching the moderator's pinned version) to the runtime `dependencies`. No other dep changes.
- [`apps/participant/vite.config.ts`](../../../apps/participant/vite.config.ts) — Vite library-mode build. The new `src/stores/*` + `src/ws/wsStore.ts` files compile through the same build with no config change.
- [`apps/participant/tsconfig.json:15-19`](../../../apps/participant/tsconfig.json#L15) — project references already include `packages/shell` (added by `part_app_skeleton`). The new store files import `BaseWsStoreState`/`WsConnectionStatus`/`createDefaultWsStore` from `@a-conversa/shell` and `EntityKind` from `@a-conversa/shared-types` (also already a reference). No `tsconfig.json` change.
- [`apps/moderator/src/stores/captureStore.test.ts`](../../../apps/moderator/src/stores/captureStore.test.ts) — the moderator's *second* per-slice test file (the file split rationale: `stores.test.tsx` covers the smoke shape; the second file covers slice-specific decompose-mode logic). The participant doesn't need a second file at this leaf's scope — all coverage fits in `stores.test.tsx`. The split lands later if `useVoteStore` grows enough surface to justify it (a likely candidate when `part_change_vote_pre_commit` and `part_agree_all_gesture` add more API).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/package.json` — modified. Adds `"zustand": "5.0.13"` to `dependencies` (pinned, matching the moderator's version). No other changes.
- `apps/participant/src/stores/voteStore.ts` — NEW. `useVoteStore` slice (per-facet pending votes).
- `apps/participant/src/stores/selectionStore.ts` — NEW. `useSelectionStore` slice (mirrors moderator's verbatim except devtools name).
- `apps/participant/src/stores/uiStore.ts` — NEW. `useUiStore` slice (current tab + zoom).
- `apps/participant/src/stores/devtools.ts` — NEW. Copy of moderator's `devtools.ts` with the devtools-name namespace updated to `participant/<slice>`.
- `apps/participant/src/stores/index.ts` — NEW. Barrel re-exporting all three local slices + types + the sibling `../ws/wsStore.js` exports.
- `apps/participant/src/stores/stores.test.tsx` — NEW. Vitest smoke suite mirroring the moderator's `stores.test.tsx`: initial values per slice, per-field setters, `reset`/`clear`/`removeVote`, zoom clamping, three React re-render probes.
- `apps/participant/src/ws/wsStore.ts` — NEW. The participant `useWsStore` singleton — a thin `createDefaultWsStore()` call exported as a module-level binding. No state extension; the base contract is sufficient (Decision §2).
- `apps/participant/src/ws/wsStore.test.ts` — NEW. Tiny Vitest spec confirming the participant `useWsStore` (a) is a callable Zustand hook returning a state object that satisfies `BaseWsStoreState`, (b) starts with `connectionStatus === 'idle'`, and (c) the shell-supplied writer `setConnectionStatus('open')` updates the value (proves the factory wired the setter correctly — the participant-side regression pin against a `createDefaultWsStore()` change that silently breaks the writer).
- `pnpm-lock.yaml` — modified. `pnpm install` after the `package.json` change re-resolves; the moderator's `zustand@5.0.13` entry already exists in the lockfile so the participant entry should reuse it (workspace dedup).

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — provider stack unchanged. The stores are zustand singletons that don't need a React provider; the WS *client* will need `<WsClientProvider store={useWsStore}>` but that's `part_ws_client`'s wire-up, not this leaf's.
- `apps/participant/src/App.tsx` — no consumer wiring today. The placeholder route doesn't yet read any of the new slices. A reader probe is *embedded in* `stores.test.tsx` (the React-component-re-renders-on-update test cases), not in `App.tsx` — the AC mirror of the moderator's "trivial component reads from each store" is satisfied by the test-harness components in the test file, not by a production-route subscription. This is a deliberate narrowing of the moderator's AC §3 (Decision §7 below records why); the deferred consumer wiring lands organically in the consuming leaves.
- `apps/participant/src/layout/useParticipantConnectionStatus.ts` — NOT modified. The swap is `part_ws_client`'s closer, not this leaf's. The participant's `useWsStore` lands; the swap that wires it does not.
- `apps/participant/src/layout/ParticipantStatusIndicator.tsx` / `ParticipantLayout.tsx` — unchanged. The chip's source is still the stubbed hook; the layout doesn't read stores.
- `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` / `apps/participant/src/index.css` — no build / TS / style changes.
- `packages/shell/` — `BaseWsStoreState` + `createDefaultWsStore()` consumed unchanged. No new shell substrate; the participant slices are participant-local (Decision §4).
- `apps/moderator/` / `apps/audience/` / `apps/root/` — no cross-surface change.
- `apps/server/` — no backend change.
- `tests/e2e/` — no Playwright change at this leaf (see "UI-stream e2e policy" below).
- `packages/i18n-catalogs/` — no new i18n keys (the stores hold UI state, not strings; the user-facing copy lives in catalogs and is keyed by the *consumer*, not the store).
- `.tji` files — the `complete 100` marker for `part_state_management` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (every decision below is a direct application of an existing ADR or a scoped slice-shape policy).

### Slice shape (`apps/participant/src/stores/voteStore.ts`)

```tsx
// `useVoteStore` — per-`(proposalId, facetId)` pending votes the debater
// has tapped but the surface has not yet sent to the backend.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// The slice is "local UI state" in the strict sense — it holds the
// button-pressed signal so multiple components can read a consistent
// local view (the per-facet button strip, an "Agree all" gesture, an
// eventual voting summary). The actual round-trip lives in
// `part_voting.part_vote_single_tap` (future leaf) which reads from
// this slice, sends via the shell's `useWsClient()`, and calls
// `removeVote(proposalId, facetId)` on the server's ack envelope.
//
// Per `docs/participant-ui.md` P2: single-tap votes with no
// confirmation modal; vote changes are allowed up to commit (so the
// slice's `setVote` is the same writer for both "first vote" and
// "change vote"). Withdraw is NOT in this slice — withdrawal is the
// post-commit P3 flow with a confirmation dialog and a different
// wire-envelope shape (`vote: withdraw`), owned by `part_withdraw.*`.

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

/**
 * The two pre-commit vote values a debater can cast on a single facet.
 * Mirrors the `vote` enum's pre-commit arms in
 * `packages/shared-types/src/events.ts:353` (the third arm, `'withdraw'`,
 * is the P3 post-commit flow and lives in a different store path).
 */
export type VoteValue = 'agree' | 'dispute';

/**
 * A vote keyed by the pair `(proposalId, facetId)` flattened to a
 * single string. The flattening keeps the slice flat (`Record<string, VoteValue>`)
 * instead of nested (`Record<proposalId, Record<facetId, VoteValue>>`),
 * which simplifies the setter / remover / iteration and matches how
 * Zustand examples typically index sparse key-spaces.
 */
function voteKey(proposalId: string, facetId: string): string {
  return `${proposalId}::${facetId}`;
}

export interface VoteState {
  /** Pending votes keyed by `voteKey(proposalId, facetId)`. */
  votes: Readonly<Record<string, VoteValue>>;
  /** Set or change the pending vote on a facet. Same writer for first-vote and change-vote. */
  setVote: (proposalId: string, facetId: string, value: VoteValue) => void;
  /** Remove the pending vote on a facet (called by the consumer on server ack, or by the user clearing). */
  removeVote: (proposalId: string, facetId: string) => void;
  /** Read the pending vote on a facet, or `undefined` if none. */
  getVote: (proposalId: string, facetId: string) => VoteValue | undefined;
  /** Reset to no pending votes — called on session change / surface unmount. */
  reset: () => void;
}

export { voteKey };

export const useVoteStore = create<VoteState>()(
  withDevtools('participant/vote', (set, get) => ({
    votes: {},
    setVote: (proposalId, facetId, value) =>
      set((state) => ({
        votes: { ...state.votes, [voteKey(proposalId, facetId)]: value },
      })),
    removeVote: (proposalId, facetId) =>
      set((state) => {
        const key = voteKey(proposalId, facetId);
        if (!(key in state.votes)) return state;
        const next = { ...state.votes };
        delete next[key];
        return { votes: next };
      }),
    getVote: (proposalId, facetId) => get().votes[voteKey(proposalId, facetId)],
    reset: () => set({ votes: {} }),
  })),
);
```

- `voteKey` is exported so test code (and the consuming leaf) can build keys for assertions without re-deriving the convention.
- `removeVote` is the early-exit on a missing key path (no spurious `set` if the key wasn't there) — matches the moderator's `untrackSubscription` pattern at [`packages/shell/src/ws/defaultStore.ts:62-68`](../../../packages/shell/src/ws/defaultStore.ts#L62).
- `getVote` is the convenience reader for consumers that don't want to deref the map themselves; the underlying `votes` map is still readable directly via `useVoteStore((s) => s.votes[voteKey(p, f)])`.

### Slice shape (`apps/participant/src/stores/selectionStore.ts`)

Verbatim copy of [`apps/moderator/src/stores/selectionStore.ts`](../../../apps/moderator/src/stores/selectionStore.ts) except:
- File header refinement reference points at this refinement instead of `mod_state_management.md`.
- `withDevtools('participant/selection', ...)` instead of `'moderator/selection'`.

The `Selection` type (`{ kind: EntityKind; id: string }`) and the `select`/`clear` API are identical — the surfaces share the same `EntityKind` discriminator from `@a-conversa/shared-types`, so the moderator's selection vocabulary IS the participant's.

### Slice shape (`apps/participant/src/stores/uiStore.ts`)

```tsx
// `useUiStore` — global participant-UI chrome toggles.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// Holds the participant's view preferences inside a single session:
// which top-of-main tab (`'graph'` vs. `'proposals'`) is foregrounded,
// and the graph-canvas zoom level. Persistence is in-memory only.

import { create } from 'zustand';

import { withDevtools } from './devtools.js';

/**
 * The two tabs the top-of-main switcher offers per `docs/participant-ui.md`'s
 * "two primary regions, switchable by tab or split-view". The set is
 * closed at v1; future tabs (e.g. a my-agreements view) add as
 * literal members here.
 */
export type ParticipantTab = 'graph' | 'proposals';

/** Bounds chosen to match the moderator's `[MIN_ZOOM, MAX_ZOOM]`. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export interface UiState {
  /** Which top-of-main tab is foregrounded. */
  currentTab: ParticipantTab;
  /** Graph-canvas zoom level, clamped to `[MIN_ZOOM, MAX_ZOOM]`. */
  zoom: number;
  setCurrentTab: (tab: ParticipantTab) => void;
  setZoom: (zoom: number) => void;
}

function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export const useUiStore = create<UiState>()(
  withDevtools('participant/ui', (set) => ({
    currentTab: 'graph',
    zoom: 1,
    setCurrentTab: (currentTab) => set({ currentTab }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  })),
);
```

- Default tab is `'graph'` — `docs/participant-ui.md` P1 names viewing the graph as the "default state". A debater opens the surface to look at the graph; the proposals tab is the per-vote drill-down.
- `MIN_ZOOM`/`MAX_ZOOM` mirror the moderator's bounds for cross-surface consistency (a debater + moderator looking at the same graph at the same zoom level perceive the same canvas).

### WS store (`apps/participant/src/ws/wsStore.ts`)

```tsx
// `useWsStore` — participant-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//   (Decision §2 — delegates to the shell's `createDefaultWsStore()`
//   factory instead of extending `BaseWsStoreState` with a participant-
//   specific projection; the participant has no projection requirement
//   the base contract does not already satisfy).
//
// The actual WS client + provider wiring lives in `part_ws_client`
// (future leaf, 0.5d, depends `!part_state_management`). Until that
// lands, `useWsStore.getState().connectionStatus` stays at the factory
// default `'idle'` — no writer fires. This file's job is to export the
// singleton so the future leaf has a stable target to import.

import type { BaseWsSessionState, BaseWsStoreState } from '@a-conversa/shell';
import { createDefaultWsStore } from '@a-conversa/shell';

/**
 * Re-export the shell types under the participant's local names for
 * symmetry with the moderator's `apps/moderator/src/ws/wsStore.ts:35`
 * re-export pattern. Consumers can import either the local names or
 * the shell names; the moderator did the local re-export for source-
 * stability across the shell extraction (per `shell_substrate_extraction`
 * Decision §"WsStore extraction shape" path C).
 */
export type WsSessionState = BaseWsSessionState;
export type WsState = BaseWsStoreState;
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * The participant's singleton WS store. The `createDefaultWsStore()`
 * factory call happens at module-load time (matching the moderator's
 * `useWsStore` shape) so the participant has exactly one store the
 * future `part_ws_client` plugs into via `createWsClient({ store: useWsStore, ... })`.
 */
export const useWsStore = createDefaultWsStore();
```

- Five lines of substantive code. No state widening, no projection, no per-payload `activeDiagnostics` map (the participant has no equivalent diagnostic-halo UI; if a diagnostic-flag highlight lands later via `part_graph_view.part_diagnostic_highlights`, it can read `useWsStore((s) => s.sessionState[sid]?.lastDiagnostic)` directly off the base — no projection needed for one-most-recent visualization).
- Module-load-time factory call: the participant has exactly one WS store; multiple tabs of the same surface would have multiple stores (one per tab), which is the right semantics (each tab is its own connection).
- The type re-exports give consumers two import paths (`from '@a-conversa/shell'` or `from '../ws/wsStore.js'`); a future audit can pick one if convergence pays off, but at this leaf's scope both are fine.

### Stores barrel (`apps/participant/src/stores/index.ts`)

```tsx
// Barrel for the participant's local-state Zustand stores.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//
// Three focused local-UI slices — vote (pending facet votes), selection
// (currently-selected entity), and UI chrome (current tab + zoom). The
// server-state slice (`useWsStore`) lives in `apps/participant/src/ws/`
// and is re-exported here for convenience so callers have one barrel
// for every participant-side Zustand store (mirrors the moderator's
// `apps/moderator/src/stores/index.ts`).

export { useVoteStore, voteKey, type VoteValue, type VoteState } from './voteStore.js';
export { useSelectionStore, type Selection, type SelectionState } from './selectionStore.js';
export {
  useUiStore,
  type ParticipantTab,
  type UiState,
  MIN_ZOOM,
  MAX_ZOOM,
} from './uiStore.js';
export {
  useWsStore,
  type WsConnectionStatus,
  type WsSessionState,
  type WsState,
} from '../ws/wsStore.js';
```

### Devtools wrapper (`apps/participant/src/stores/devtools.ts`)

Verbatim copy of [`apps/moderator/src/stores/devtools.ts`](../../../apps/moderator/src/stores/devtools.ts) except for the file-header refinement reference. The wrapper itself is identical: `import.meta.env.DEV`-gated `devtools` middleware with a name + `enabled: true` flag, cast back to the bare-mutator shape so call-sites stay `create<State>()((set) => ({ ... }))`.

### What the stores MUST NOT do

- **No `fetch`, no `WebSocket`, no `setTimeout`, no `useEffect`.** All slices are pure state holders + writers; side effects belong in consumers. The WS-store factory's setters are called only by the shell client; the local stores' setters are called only by React event handlers.
- **No localStorage / sessionStorage / cookies.** In-memory only, per the moderator's policy + the project's no-tokens-in-storage discipline.
- **No cross-slice writes.** `useVoteStore.setVote` does not call into `useUiStore.setCurrentTab` to switch to the proposals tab; the consumer is the right place to coordinate (and the moderator's stores don't cross-write either, with the documented exception of `useCaptureStore.enterDecomposeMode` which is a single slice's mode-coupled atomic set).
- **No imports from `apps/participant/src/layout/*` or `apps/participant/src/App.tsx`.** The dep graph runs layout/route → stores, never the reverse. Circular imports kill tree-shaking.
- **No `useWsStore` extension** (Decision §2). The participant uses the shell's base contract verbatim.

### Test layers per ADR 0022

Two pins, each anchoring a different observable property:

1. **Vitest store-smoke (NEW)** — `apps/participant/src/stores/stores.test.tsx`. Cases (mirroring the moderator's `stores.test.tsx`):
   - **`useVoteStore`** (5 cases):
     - (a) Starts with empty `votes`.
     - (b) `setVote(p, f, 'agree')` writes the key; `getVote(p, f)` reads back.
     - (c) `setVote(p, f, 'dispute')` after a prior `'agree'` overwrites in place (the change-vote pre-commit path).
     - (d) `removeVote(p, f)` clears the key; `removeVote` on an absent key is a no-op (no `set` call).
     - (e) `reset()` clears all pending votes.
   - **`useSelectionStore`** (2 cases, mirroring moderator):
     - (a) Starts with `selected === null`.
     - (b) `select({ kind, id })` stores; `clear()` resets.
   - **`useUiStore`** (3 cases, mirroring moderator):
     - (a) Starts with `currentTab === 'graph'` + `zoom === 1`.
     - (b) `setCurrentTab('proposals')` switches.
     - (c) `setZoom` clamps to `[MIN_ZOOM, MAX_ZOOM]` + `NaN → 1`.
   - **React re-render probes** (3 cases, mirroring moderator's three probes):
     - (a) `<VoteProbe>` subscribed to `useVoteStore((s) => s.votes)` re-renders when `setVote` fires.
     - (b) `<SelectionProbe>` subscribed to `useSelectionStore((s) => s.selected)` re-renders when `select` fires.
     - (c) `<UiProbe>` subscribed to `useUiStore((s) => s.currentTab)` re-renders when `setCurrentTab` fires.
   - Total: **13 cases**. Smoke count grows by +13.

2. **Vitest WS-store-smoke (NEW)** — `apps/participant/src/ws/wsStore.test.ts`. Three cases:
   - (a) `useWsStore.getState().connectionStatus === 'idle'` at module-load.
   - (b) `useWsStore.getState().setConnectionStatus('open')` updates `connectionStatus`; selector subscribers re-render (one tiny `<Probe>` test).
   - (c) `useWsStore.getState().sessionState` starts as `{}` and a `useWsStore.getState().applyProposalStatus(payload)` for a fresh session populates `sessionState[sid].pendingProposals[pid]` (the participant's read path for the future pending-tab badge — pins the base contract works for the participant's consumption shape).
   - Total: **3 cases**. Smoke count grows by +3.

**Grand total: +16 Vitest smoke cases.**

### UI-stream e2e policy (apply)

**E2e is deferred from this leaf — the state primitives this task adds are not yet wired into any user-visible flow.** This is the textbook deferred-e2e case from `ORCHESTRATOR.md`'s "Deferred-e2e exception — when the component is not yet reachable":

- The three local slices (`useVoteStore`, `useSelectionStore`, `useUiStore`) have **zero production consumers** after this leaf. The placeholder route doesn't subscribe to them; the chrome header doesn't subscribe to them; the status chip's source is the stubbed hook, not `useWsStore`. There is no user-perspective behavior change a Playwright spec could pin.
- The participant `useWsStore` similarly has **zero production consumers** — the WS client is not wired (`part_ws_client` is the leaf that registers `<WsClientProvider store={useWsStore}>`), so the store's writers never fire; `connectionStatus` stays at the factory default `'idle'`. A Playwright assertion like "`data-status="idle"` is visible in the chip" would fail today because the chip's source hook is still the stub returning `'connecting'` (and the source-hook swap is `part_ws_client`'s closer, not this leaf's).

**The unit/component coverage that stands in for the deferred e2e:** the 16 Vitest smoke cases above pin every slice's observable contract — initial state, every setter's mutation, every reset/clear path, the React-component-re-renders-on-update invariant (three slices × one probe each = three probes), zoom clamping, and the WS-store factory's writer wiring. The Vitest layer covers everything a Playwright spec at this leaf's scope *could* assert, since there is no user-visible production behavior to drive.

**The wiring tasks that inherit this deferred-e2e debt:**

- **`participant_ui.part_shell.part_ws_client`** (existing WBS leaf, 0.5d, `depends !part_state_management`) — this is the leaf that (a) registers `<WsClientProvider store={useWsStore}>` so `connectionStatus` actually transitions, (b) performs the one-line swap inside `useParticipantConnectionStatus.ts` to read from `useWsStore`, and (c) makes the participant tablet reach a user-visible state where Playwright can assert `data-status="connecting" → "open"` transitions on a real handshake. **Its refinement MUST scope a Playwright spec extension** that asserts the connection-state transition end-to-end (the natural place — extend the existing `tests/e2e/participant-skeleton-smoke.spec.ts` first scenario with a "wait for `data-status="open"`" assertion after the WS handshake completes).
- **`participant_ui.part_voting.part_vote_single_tap`** (existing WBS leaf) — the first consumer of `useVoteStore` in a user-visible flow. **Its refinement MUST scope a Playwright spec** that asserts a per-facet vote button tap (a) calls `useVoteStore.setVote`, (b) sends the vote envelope over the WS, (c) reflects the ack visually, (d) clears the slice via `useVoteStore.removeVote`. This is the e2e debt this leaf cannot close because the consumer doesn't exist yet.
- **`participant_ui.part_graph_view.part_entity_detail_panel`** (existing WBS leaf) — the first consumer of `useSelectionStore` in a user-visible flow. **Its refinement MUST scope a Playwright spec** that asserts tapping a node selects it (writes the slice) and the detail panel renders the selected entity.
- **`participant_ui.part_pending_proposals.part_proposals_tab`** (existing WBS leaf) — the first consumer of `useUiStore.currentTab` in a user-visible flow. **Its refinement MUST scope a Playwright spec** that asserts tab-switching renders the right region.

The four future leaves above all already exist as open WBS leaves; their Refinement-Writers will pick up the e2e debt as part of the standard "wiring task inherits deferred e2e" pass that `ORCHESTRATOR.md`'s policy bakes in. No new tech-debt leaf needs to be registered for this leaf's deferral — the consuming leaves already own the e2e debt by virtue of being the first user-visible consumers of the slices.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~30 min: `apps/participant/package.json` zustand pin + `pnpm install` + verify the lockfile dedup hits.
- ~30 min: write `apps/participant/src/stores/devtools.ts` (copy-from-moderator); `apps/participant/src/stores/selectionStore.ts` (copy-from-moderator with two name swaps).
- ~30 min: write `apps/participant/src/stores/uiStore.ts` (similar shape to moderator with different field names).
- ~45 min: write `apps/participant/src/stores/voteStore.ts` (new shape; the per-facet key encoding + the setter/remover/getter/reset API).
- ~30 min: write `apps/participant/src/stores/index.ts` barrel + thread the moderator-pattern re-export of `../ws/wsStore.js`.
- ~15 min: write `apps/participant/src/ws/wsStore.ts` (~5 LOC + comments).
- ~1.5h: write `apps/participant/src/stores/stores.test.tsx` (13 cases, ~150 LOC including the three React probes) + `apps/participant/src/ws/wsStore.test.ts` (3 cases, ~50 LOC).
- ~30 min: run `pnpm -F @a-conversa/participant typecheck` + `build` + `test:smoke` + `pnpm run check`; fix any TypeScript strict-mode issues (likely zero, given the moderator pattern is the precedent).
- ~30 min: `pnpm exec eslint` over the new files + Prettier pass.
- ~1h: full task-completion ritual + commit message + any tj3 validation.

Risk surface is small: the moderator's `mod_state_management` pattern is two months proven; the participant slices are narrower; no new dependency beyond the moderator's already-pinned `zustand@5.0.13`; no shell-substrate widening; no consumer wiring (the leaf is structurally pure plumbing). The biggest implementation hazard is the React re-render probes — Zustand's selector identity rules can bite if the probe component subscribes to a derived value that doesn't shallow-equal; the moderator's `stores.test.tsx` is the pattern (subscribe to a single primitive or an object slice that the writer replaces by reference).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — the new `zustand@5.0.13` dep resolves from the workspace lockfile (it's already present for the moderator); no new top-level pnpm install warnings beyond the pre-existing baseline.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new slice files compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)); the `VoteState`/`SelectionState`/`UiState`/`WsState` interfaces narrow correctly without `any`; the `BaseWsStoreState` / `createDefaultWsStore` imports from `@a-conversa/shell` resolve via the existing project reference.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessors pinned; bundle filename / sidecar shape unchanged; the new slice + store code tree-shakes into the existing `participant-<hash>.js` (no separate asset; no `index.html` change).
4. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new `.ts` / `.tsx` files are picked up by the existing `apps/**/*.{ts,tsx}` ESLint glob; the new test file is picked up by `typecheck:tests`.
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+16** (13 from `stores.test.tsx` + 3 from `ws/wsStore.test.ts`). The new cases match the cases-anchored shape described under Constraints → "Test layers".
6. **No new Playwright spec** — e2e is deferred per the UI-stream policy above; the existing `tests/e2e/participant-skeleton-smoke.spec.ts` continues to pass unchanged (no assertion against the new stores; the stores are unreachable from any user flow today).
7. **`pnpm --filter @a-conversa/i18n-catalogs run check`** still green — no catalog changes in this leaf, so the assertion is just that nothing regressed.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No new top-level dependency** beyond `zustand@5.0.13` (already in the moderator workspace; new only to the participant). `pnpm-lock.yaml` diff should be minimal — primarily a `apps/participant`-scoped dedup edge.
10. **The three local slices honor the no-cross-write / no-side-effects rules** — a grep over `apps/participant/src/stores/` for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|setTimeout\|window\.` returns zero matches; a grep for cross-slice imports (e.g. `useUiStore` importing from `voteStore.js`) returns zero matches.
11. **The participant `useWsStore` uses `createDefaultWsStore()` directly without state widening** — `apps/participant/src/ws/wsStore.ts` does NOT call `create<...>()` with a custom initializer; it imports and invokes `createDefaultWsStore()` from `@a-conversa/shell`. A grep for `'apps/participant/src/ws/wsStore.ts'` for `activeDiagnostics` / `diagnosticIdentityKey` returns zero matches (those are moderator-specific projections).
12. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_state_management` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
13. **Predecessor's existing assertions unchanged** — `apps/participant/src/mount.test.tsx`'s existing assertions pass unchanged; `apps/participant/src/layout/*.test.tsx` (ParticipantLayout + ParticipantStatusIndicator) pass unchanged; `tests/e2e/participant-skeleton-smoke.spec.ts`'s three scenarios pass unchanged.

## Decisions

### 1. Library: Zustand (matching `mod_state_management`)

Three alternatives surveyed:

- **(A) Zustand** (chosen) — the moderator's pattern. `mod_state_management` shipped 2026-05-11; the moderator surface has been running on Zustand for three months. Pattern is two-deep proven (capture/selection/ui slices + the wsStore extension); the project pin is `zustand@5.0.13`; the devtools wrapper is reusable across workspaces. Adopting Zustand for the participant is zero new ADR-level decision: it's the project's chosen client-state library.
- **(B) Redux Toolkit / RTK Query** — rejected. Heavier API surface, more boilerplate per slice, no per-surface team-context advantage; would require an ADR amendment to allow two competing client-state libraries side by side.
- **(C) React Context + `useReducer`** — rejected. Manageable for a single tab/zoom state but does not scale to the per-facet vote slice's writers, the inevitable `part_change_vote_pre_commit` ergonomics, or the future `useWsStore` integration (which is already Zustand-shaped via the shell's `WsStoreLike`). Adopting Context here would force a translation layer when consumers also read `useWsStore`.

The chosen approach inherits the moderator's package pin (`zustand@5.0.13`) verbatim. No version bump.

### 2. WS store: delegate to `createDefaultWsStore()`; do not extend `BaseWsStoreState`

Three alternatives surveyed:

- **(A) Extend `BaseWsStoreState` with participant-specific projections** (mirroring the moderator's `apps/moderator/src/ws/wsStore.ts` that adds `activeDiagnostics`). Rejected: the participant has no equivalent projection requirement today. The moderator extends because `<GraphCanvasPane>` reads `activeDiagnostics` keyed by `diagnosticIdentityKey` for the per-entity diagnostic halo; the participant tablet's diagnostic surface (per `docs/participant-ui.md` P6) is a list view + tap-to-focus, not a halo overlay, so the most-recent envelope already on the base shape (`lastDiagnostic`) is sufficient. Adding the projection now would pre-commit a shape the actual consuming leaf (`part_graph_view.part_diagnostic_highlights`) is the right place to settle.
- **(B) Build a participant-local store from scratch** with a `create<ParticipantWsState>()((set) => ({ ...same as defaultStore }))` initializer. Rejected: duplicates `createDefaultWsStore`'s body (~100 LOC) for no benefit; introduces a drift surface where the shell's base contract grows a writer that the participant's hand-rolled store doesn't get.
- **(C) Use `createDefaultWsStore()` directly** (chosen). One line — `export const useWsStore = createDefaultWsStore();` — and the participant gets every base writer the shell client expects. When/if the participant grows a projection requirement (e.g. `part_graph_view.part_diagnostic_highlights` adopts the moderator's halo shape), that future leaf can switch this file to extend the base, and the swap is local (no other participant code needs to change because the consumed reads are all base-shape reads). This decision is also the cleanest signal that the shell's substrate is doing its job — a new surface lands without having to re-implement the WS-store contract.

Type re-exports (`WsSessionState`, `WsState`, `WsConnectionStatus`) follow the moderator's pattern at [`apps/moderator/src/ws/wsStore.ts:35-59`](../../../apps/moderator/src/ws/wsStore.ts#L35) for source-stability across consumers that may want to import "the participant WS shape" by name without knowing it's the base shape.

### 3. The pending-vote count badge is a derived selector, not a `useUiStore` slice

Three alternatives surveyed:

- **(A) Store `pendingProposalCount` as a numeric field on `useUiStore`**, written by a separate effect that subscribes to `useWsStore.sessionState` + `useVoteStore.votes` and computes the count. Rejected: introduces a second source of truth (the count derives from the stored data; storing it separately means the count can drift if the effect misses an update). Also requires a `useEffect` somewhere to drive the writer — the stores are meant to be pure state holders (Constraints).
- **(B) Compute the count inside the consuming component** as `Object.keys(sessionState[sid].pendingProposals).length - Object.keys(votedByFacet).length` (or the moral equivalent — the math depends on whether "pending" means "the moderator has proposed it" or "this debater hasn't voted on it yet"; per `docs/participant-ui.md`'s "facets awaiting their vote" it's the latter). Rejected: too inline; multiple consumers (the badge, the proposals tab, eventually the operate-view's pending count) would each re-derive.
- **(C) Compute via a derived selector** (chosen) — a small helper function in `apps/participant/src/stores/selectors.ts` (or co-located with the consumer) that takes the two store states and returns the count. The selector is testable in isolation, multiple consumers can share it, and the underlying data stays single-sourced. **This leaf does NOT add the selector** — that's `part_pending_proposals.part_proposals_tab`'s deliverable; this leaf only commits to the *shape* (derived, not stored) so future readers don't try to add `pendingProposalCount` as a `useUiStore` field.

### 4. Stores live in `apps/participant/src/stores/`, NOT in `@a-conversa/shell`

Two alternatives surveyed:

- **Move `useSelectionStore` / `useUiStore` into `@a-conversa/shell`** (since the selection shape is moderator-mirror-able and the zoom-clamp logic is generic). Rejected: the shell substrate's contract per [`shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) is for *cross-surface primitives* (auth, i18n, WS, mount contract, error mapper, screen-name form). Per-surface local-UI state is not in scope; the moderator's stores are moderator-local, the participant's stores stay participant-local. Cross-surface convergence of selection / zoom / tab shapes is a future-tokens-or-shared-primitives concern, not a state-management one.
- **Keep stores participant-local** (chosen). Same shape as the moderator's `apps/moderator/src/stores/`; the convergence-when-needed posture is the right one. If the audience surface lands and discovers identical `useSelectionStore` needs, the extraction-to-shell decision can land then (an ADR amendment to `shell_substrate_extraction` if it crosses the substrate boundary; or a `packages/ui-state/` workspace if it stays as a non-substrate shared lib).

### 5. Don't perform the `useParticipantConnectionStatus` swap in this leaf

Two alternatives surveyed:

- **Swap the stubbed source-hook in this leaf** (since this leaf provides the swap target). Rejected — would conflate concerns:
  - This leaf's job is the *store*, not its consumers. Touching `useParticipantConnectionStatus.ts` to wire it would expand the file allowlist into the layout dir, blurring the leaf's structural boundary.
  - The swap depends on `part_ws_client` registering the WS client (otherwise `useWsStore.getState().connectionStatus` stays at `'idle'` and the chip would visibly regress from the user-meaningful `'connecting'` to the technically-correct-but-confusing `'idle'`). Swapping here without `part_ws_client`'s wire-up would be a worse UX than the current stub.
  - The Playwright assertion in `tests/e2e/participant-skeleton-smoke.spec.ts` currently pins `data-status="connecting"`; the swap would flip the assertion (this leaf would have to update the spec to `data-status="idle"`, then `part_ws_client` would have to update it back to `"connecting"` → `"open"`). Two flips for the wrong reason.
- **Leave the swap to `part_ws_client`** (chosen). This leaf supplies the import target; `part_ws_client` lands the wire-up + the swap + the spec update in one coherent change. The stubbed chip continues to display `'connecting'` until `part_ws_client` lands, at which point it transitions to `'open'` on first handshake.

### 6. `useVoteStore` covers pre-commit vote and change-vote; NOT withdrawal

Two alternatives surveyed:

- **One slice that covers both pre-commit (`agree`/`dispute`) and post-commit (`withdraw`)** — same setter, broader value enum. Rejected: the `VotePayload` schema distinguishes the three values at the wire layer ([`packages/shared-types/src/events.ts:353`](../../../packages/shared-types/src/events.ts#L353)), and the user-flow per `docs/participant-ui.md` P3 is fundamentally different — withdraw goes through a confirmation dialog ("deliberate extra tap") because it reverses a committed change. Stuffing it into the same `setVote()` writer would lose the dialog-required signal AND would let a consumer accidentally write a `'withdraw'` value without going through the P3 flow. Type-level guardrails matter when the API surface is touched by many future consumers.
- **`useVoteStore` covers only `'agree' | 'dispute'` (chosen)**. The `VoteValue` type omits `'withdraw'`. A future `part_withdraw.*` leaf decides whether to add a parallel `useWithdrawStore` slice with its own confirmation-dialog state, or to build the withdraw flow as a one-shot send-via-`useWsClient()` with no local buffer (the latter is more likely given the confirmation gate already serializes the intent). Either way, that decision is the future leaf's, not this one's.

### 7. Skip the "trivial component reads from each store" production wiring

The moderator's `mod_state_management.md` AC §3 reads "A trivial component reads from each store and re-renders on update", and its Status block records `OperateRoute` subscribing to each store to satisfy that AC. The participant has no equivalent route ready to take on the role (the wildcard `PlaceholderRoute` exists, but adding three store subscriptions to it for no UX reason would be ceremony, not contract).

Two alternatives surveyed:

- **Mirror the moderator's AC §3 verbatim** by adding store subscriptions to `<PlaceholderRouteBody>` — e.g. render the current tab and zoom and a pending-vote count next to the placeholder text. Rejected: pollutes the placeholder body with state-management noise that has nothing to do with the body's contract (the body is the route content that gets replaced by `part_session_join.part_invite_acceptance`; adding three throwaway subscriptions ages with the body's deletion).
- **Satisfy the re-render contract via Vitest probes** (chosen). The three React-component-re-renders-on-update test cases in `stores.test.tsx` (Constraints → "Test layers") are the same assertion the moderator's AC §3 was satisfying — they prove the slices integrate with React's render cycle correctly. The probes are throwaway-in-the-best-sense (they live in a test file, not production code), so they don't age into the future-route's deletion. This is a strictly *narrower* interpretation of the moderator's AC; it preserves the regression-pin force without paying the production-wiring cost.

The deferred-e2e debt is registered above (UI-stream e2e policy); the same logic — "no consumer yet, so the user-perspective probe waits for the consumer" — applies symmetrically to the production-wiring probe.

### 8. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0022's committed-test discipline; 0013's strict TypeScript; 0026's surface-consumes-from-shell-substrate; 0010's pnpm-workspaces).
- A direct mirror of `mod_state_management`'s pattern (Decisions §1, §4, §7).
- A scoped slice-shape policy that doesn't constrain other tasks (Decisions §2, §3, §5, §6).
- A direct consumer of the shell's existing `createDefaultWsStore()` factory without widening.

The "no new dependencies" rule is satisfied: the only new dep is `zustand@5.0.13`, which is already in the moderator workspace under the same pin. The "no new shell substrate" rule is honored: the participant's stores are participant-local; the shell is consumed unchanged.

### 9. Tech-debt registration

- **No new WBS leaf needs to be registered by this leaf's Closer.** The deferred-e2e debt is inherited by four existing open WBS leaves (per the "UI-stream e2e policy" section above): `part_ws_client`, `part_voting.part_vote_single_tap`, `part_graph_view.part_entity_detail_panel`, `part_pending_proposals.part_proposals_tab`. Each of those is the natural first user-visible consumer of one of the slices and already exists with the appropriate `depends` edges; their Refinement-Writers will scope the e2e coverage when those leaves land. Per `ORCHESTRATOR.md`'s tech-debt registration policy, the Closer does NOT need to add new tech-debt tasks for debt already inheritable by named existing leaves.
- **No i18n native-review leaf** — this leaf adds zero i18n keys (the stores hold UI state, not strings). The participant native-review chain (currently tailed by `i18n_participant_status_indicator_native_review` per `part_status_indicator`'s Closer) is unchanged.
- **No follow-up on the `useUiStore.pendingProposalCount` selector** — Decision §3 explicitly defers the derived selector to `part_pending_proposals.part_proposals_tab`, which already exists as an open WBS leaf with `depends !part_pending_proposals` (transitively `!part_shell`). That leaf will land the selector when it lands the badge.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Three local-UI Zustand slices land under `apps/participant/src/stores/` mirroring the moderator's `mod_state_management` recipe: `voteStore.ts` (per-`(proposalId, facetId)` pending-vote buffer with `setVote`/`removeVote`/`getVote`/`reset` + exported `voteKey`), `selectionStore.ts` (verbatim moderator mirror except `withDevtools('participant/selection', ...)`), and `uiStore.ts` (`currentTab` default `'graph'` + zoom clamped to `[MIN_ZOOM, MAX_ZOOM]`).
- Opt-in dev-only devtools wrapper at `apps/participant/src/stores/devtools.ts` (copy of moderator's wrapper, namespaced `participant/<slice>`), plus a barrel at `apps/participant/src/stores/index.ts` re-exporting all three slices, their types, and the sibling `../ws/wsStore.js` exports — matching the moderator's `apps/moderator/src/stores/index.ts` convention.
- Participant-side `useWsStore` singleton at `apps/participant/src/ws/wsStore.ts` delegates to the shell's `createDefaultWsStore()` factory per Decision §2 (no `BaseWsStoreState` widening; participant has no projection requirement the base contract does not satisfy). Local type re-exports (`WsSessionState`, `WsState`, `WsConnectionStatus`) provided for source-stability symmetry with the moderator.
- Vitest pins at `apps/participant/src/stores/stores.test.tsx` (13 cases: 5 vote + 2 selection + 3 ui + 3 React re-render probes) and `apps/participant/src/ws/wsStore.test.ts` (3 cases: idle default + setter mutates + sessionState/applyProposalStatus). Test count: 3445 → 3461 (+16).
- `apps/participant/package.json` adds `"zustand": "5.0.13"` pinned to the moderator's version; `pnpm-lock.yaml` reused the existing workspace entry (single dedup edge).
- No `useParticipantConnectionStatus` swap performed (Decision §5 — that swap is `part_ws_client`'s closer); no `<WsClientProvider>` wiring (Decision §2 + UI-stream e2e policy — that's `part_ws_client`'s deliverable); no production-route store subscription (Decision §7 — the React-component-re-renders-on-update assertion is satisfied via in-test probes).
- E2e deferred per the UI-stream policy in this refinement: four existing WBS leaves inherit the debt as the first user-visible consumers — `participant_ui.part_shell.part_ws_client` (connection-state transition Playwright + the `useParticipantConnectionStatus` swap to `useWsStore`), `participant_ui.part_voting.part_vote_single_tap` (per-facet vote-tap → `useVoteStore.setVote` → ack → `removeVote` Playwright), `participant_ui.part_graph_view.part_entity_detail_panel` (`useSelectionStore`-driven detail-panel Playwright), and `participant_ui.part_pending_proposals.part_proposals_tab` (`useUiStore.currentTab` tab-switch Playwright + pending-vote count selector).
