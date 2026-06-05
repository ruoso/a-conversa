# `snapshot_jump_ui` — jump-to-snapshot action across replay and test mode

**TaskJuggler entry**: [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) — task `replay_test.snapshots.snapshot_jump_ui` (line 127, under `replay_test.snapshots`, "Snapshot surfaces").

**Effort estimate**: 1d.

## Inherited dependencies

The leaf declares `depends !snapshot_list_ui` (`tasks/60-replay-and-test-mode.tji:130`); the `snapshots` parent block adds two group edges (`tasks/60-replay-and-test-mode.tji:115`) that every snapshot-surface leaf inherits:

- `replay_test.snapshots.snapshot_list_ui` — **settled** (Done 2026-06-05; see [`snapshot_list_ui.md`](snapshot_list_ui.md)). Shipped, in `@a-conversa/shell`, a **presentational `SnapshotList`** component and a **`useSessionSnapshots(sessionId)`** data hook:
  - `SnapshotList` props ([`packages/shell/src/snapshot-list/SnapshotList.tsx:28-35`](../../../packages/shell/src/snapshot-list/SnapshotList.tsx)): `{ status: 'loading'|'ready'|'error'; snapshots: readonly SnapshotRecord[]; onSelect: (snapshotId: string) => void; onRetry?: () => void }`. Selecting a row fires `onSelect(snapshotId)` — **but the component does nothing with the selection itself; wiring the navigation is exactly this task.**
  - `useSessionSnapshots` ([`packages/shell/src/snapshot-list/useSessionSnapshots.ts:20-24,49`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.ts)): returns `{ status, snapshots: readonly SnapshotRecord[], retry }`, fetching `GET /api/sessions/:id/snapshots` (raw `fetch`, `credentials: 'include'`, defensive narrowing).
  - `SnapshotRecord` ([`packages/shell/src/snapshot-list/types.ts:12-17`](../../../packages/shell/src/snapshot-list/types.ts)): `{ snapshotId: string; label: string; logPosition: number; createdAt: string }` — **the record carries `logPosition`**, so a selected snapshot's position is already in hand client-side.
  - Public re-exports at [`packages/shell/src/index.ts:140-149`](../../../packages/shell/src/index.ts).
- `data_and_methodology.event_types.snapshot_events` — **settled**. `snapshotCreatedPayloadSchema` ([`packages/shared-types/src/events.ts:623`](../../../packages/shared-types/src/events.ts)): `{ snapshot_id: uuid, label: string (1–128), log_position: positive int }`. Snapshots are events; `log_position` is the snapshot event's own sequence.
- `backend.replay_endpoints.list_snapshots` — **settled** (Done 2026-06-04). `GET /sessions/:id/snapshots` → `{ snapshots: [{ snapshotId, label, logPosition, createdAt }] }`, ascending `logPosition`, visibility-gated 404. The create→list producer→consumer seam is additionally Cucumber-pinned by `snapshot_creation_ui` (Done 2026-06-05).
- `replay_test` stream root — `depends backend.backend_tests.be_e2e_tests.auth_flow_integration` (`tasks/60-replay-and-test-mode.tji:30`), the OIDC-handshake safety net every replay-UI leaf inherits. Settled.

**Settled but not a `.tji` edge — the resolution semantics to mirror:** the backend already defines snapshot→position resolution in [`apps/server/src/projection/snapshot-resolution.ts:28-37`](../../../apps/server/src/projection/snapshot-resolution.ts) (`resolveSnapshotPosition(snapshots, snapshotId): number`, throwing `SnapshotNotFoundError` on miss), refined in [`tasks/refinements/data-and-methodology/snapshot_resolution.md`](../data-and-methodology/snapshot_resolution.md). The position vocabulary is **event-sequence space** — `logPosition` is already in that space; resolution never invents a new vocabulary. This task's client-side jump mirrors that semantics on the already-loaded `SnapshotRecord[]`.

**Pending — decisive for the e2e decision:** there is **still no reachable replay or test-mode frontend surface.** The root app ([`apps/root/src/App.tsx:42-55`](../../../apps/root/src/App.tsx)) mounts only `/m`, `/p`, `/a`; there is no `apps/replay`, no `apps/test-mode`, and **no client-side "current position" / replay-player state anywhere** (`packages/shell` and `apps/*` have no `useReplay`, no position store). The surface tasks (`replay_test.replay_ui.*`, `replay_test.test_mode.*`) are all unbuilt. This is what makes the jump affordance built here **not yet reachable** — see Acceptance criteria §4.

## What this task is

Build the **jump-to-snapshot action**: the wiring that turns a snapshot-list row selection into a *navigation to that snapshot's position*, reusable across both the replay viewer and test mode. `snapshot_list_ui` deliberately stopped at a pure `onSelect(snapshotId)` callback that "does nothing" so the navigation could be wired here; this task supplies that wiring as a surface-agnostic piece, the same way the list itself was built ahead of its consumers.

Concretely, two small artifacts in `@a-conversa/shell`, beside the snapshot-list:

1. **A client-side `resolveSnapshotPosition(snapshots, snapshotId): number | null`** — a pure helper that looks up a selected `snapshotId` in an already-loaded `SnapshotRecord[]` and returns its `logPosition` (or `null` if absent). It mirrors the server helper of the same name ([`apps/server/src/projection/snapshot-resolution.ts:28`](../../../apps/server/src/projection/snapshot-resolution.ts)) but operates on the client camelCase record and **returns `null` rather than throwing** (a UI click handler must not throw — see Decision §5).
2. **A connected `SnapshotJumpList` component** — composes `useSessionSnapshots(sessionId)` + `SnapshotList` + the resolver, and exposes a single host callback **`onJump(position: number)`** instead of the raw `onSelect(snapshotId)`. The host mounts `<SnapshotJumpList sessionId={…} onJump={setPosition} />`; when the viewer picks a row, the component resolves the row's `snapshotId` to its `logPosition` and calls `onJump(logPosition)`. Load/error/empty states pass straight through from the underlying hook+list. This is the reusable "jump affordance" both in-stream surfaces will mount (see "Why").

It builds **no surface, no route, no position state** — the surface that owns "current position" (the replay player / the test-mode scrubber) does not exist yet; this task hands that future surface a ready-to-mount affordance whose only output is a resolved position number.

## Why it needs to be done

The jump action is the third and final leaf of `replay_test.snapshots`: creation (`snapshot_creation_ui`, the moderator write-path + pinned record contract), listing (`snapshot_list_ui`, the REST-sourced read view), and now **navigation** — making a listed snapshot actually take you somewhere. Two downstream surfaces consume it:

- `replay_test.replay_ui.replay_chapter_jumping` (1d) — "Jump to next/prev snapshot via chapter markers"; `depends !replay_seek_bar, data_and_methodology.replay_primitive.snapshot_resolution`. The replay viewer's chapter index *is* the snapshot list, and jumping to a chapter is jumping to its `logPosition`.
- `replay_test.test_mode.test_mode_timeline_scrubber` (3d) — the per-event scrubber; `depends !test_mode_load_session, data_and_methodology.replay_primitive.position_navigation`. Test mode navigates by position and will mount the snapshot list as a positional shortcut.

Both navigate in **position** space (the same event-sequence vocabulary as `GET /sessions/:id/state?position=N` and the seek bar). Centralizing the `snapshotId → logPosition` resolution once, at the jump boundary, keeps both surfaces *position-only* and prevents each from re-implementing the lookup. Building the reusable jump piece now — ahead of those surfaces — is the same "build the reusable piece, wire it later" sequencing the WBS encodes by giving `snapshot_jump_ui` its own 1d leaf before any consuming surface.

The backend it stands on is fully shipped and Cucumber-pinned (list endpoint + the create→list round-trip), and the list/hook it composes shipped in `snapshot_list_ui`, so this task is purely client-side composition: resolve, wire, expose a position.

## Inputs / context

- WBS leaf: `tasks/60-replay-and-test-mode.tji:127` (`snapshot_jump_ui`), parent block lines 114–132, group dependency line 115, direct dependency line 130, root edge line 30.
- The piece this task wires onto: `SnapshotList` props ([`packages/shell/src/snapshot-list/SnapshotList.tsx:28-35`](../../../packages/shell/src/snapshot-list/SnapshotList.tsx), `onSelect` at line 31), `useSessionSnapshots` ([`packages/shell/src/snapshot-list/useSessionSnapshots.ts:20-24,49`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.ts)), `SnapshotRecord` ([`packages/shell/src/snapshot-list/types.ts:12-17`](../../../packages/shell/src/snapshot-list/types.ts)), shell barrel ([`packages/shell/src/index.ts:140-149`](../../../packages/shell/src/index.ts)). Predecessor refinement: [`snapshot_list_ui.md`](snapshot_list_ui.md).
- Resolution semantics to mirror (server): [`apps/server/src/projection/snapshot-resolution.ts:28-74`](../../../apps/server/src/projection/snapshot-resolution.ts) — `resolveSnapshotPosition`, plus `nextSnapshotPosition`/`prevSnapshotPosition` (next/prev are the consumers' concern, not this task's; see Decision §1). Refinement: [`tasks/refinements/data-and-methodology/snapshot_resolution.md`](../data-and-methodology/snapshot_resolution.md).
- Position-loading endpoint the *surface* (not this task) will call with the emitted position: `GET /sessions/:id/state?position=N` → `{ sessionId, sequence, projection }`, refined in [`tasks/refinements/backend/get_at_position.md`](../backend/get_at_position.md). This task emits the `position`; it does not fetch state.
- Single-snapshot deep-link endpoint that this task deliberately does **not** use: `GET /sessions/:id/snapshots/:snapshotId` → bare `SnapshotRecord`, refined in [`tasks/refinements/backend/get_snapshot.md`](../backend/get_snapshot.md). Reserved for resolving an id with no list in hand (URL deep-link), which is `replay_url_position_loading` / chapter-deep-link territory, not list-driven jump. See Decision §2.
- Established client fetch idiom + fetch-stub component-test pattern: shipped alongside the list — [`packages/shell/src/snapshot-list/useSessionSnapshots.test.tsx`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.test.tsx), [`packages/shell/src/snapshot-list/SnapshotList.test.tsx`](../../../packages/shell/src/snapshot-list/SnapshotList.test.tsx). ADRs 0006 (Vitest), 0003 (React).
- Shell package home (cross-surface substrate): [`packages/shell/src/`](../../../packages/shell/src/), WBS [`tasks/27-shell-package.tji`](../../27-shell-package.tji), ADR 0010 (pnpm workspaces). Placement reasoning already settled in [`snapshot_list_ui.md`](snapshot_list_ui.md) §2.
- Root-app routing (shows no replay/test route renders this): [`apps/root/src/App.tsx:42`](../../../apps/root/src/App.tsx).
- Inherited e2e debt: [`snapshot_list_ui.md`](snapshot_list_ui.md) §4 names this task as the registered inheritor of the deferred *list-render → click → jump* Playwright spec. e2e policy: refinement-writer brief, "UI-stream e2e policy" (`replay_test.*` in scope). ADRs 0008 (Playwright), 0022 (no throwaway verifications).

## Constraints / requirements

1. **Wire onto the shipped list — do not fork it.** Reuse `SnapshotList` and `useSessionSnapshots` from `@a-conversa/shell` as-is. The jump component is a thin composition over them; it must not re-implement fetching, narrowing, row rendering, or load-state handling.
2. **Resolve client-side from the already-loaded list.** The selected `snapshotId` is one of the rows the user just saw, and each `SnapshotRecord` already carries `logPosition`; resolution is a local array lookup, not a network call. Do **not** fetch `GET /sessions/:id/snapshots/:snapshotId` per selection (Decision §2).
3. **Emit a position, not an id.** The host callback is `onJump(position: number)`, in event-sequence space — the same vocabulary as `get_at_position`, the seek bar, and `position_navigation`. The component must not leak `snapshotId` to the host; resolution happens at this boundary (Decision §3).
4. **Resolver is a pure, total function returning `number | null`.** No throw, no side effects. On a miss (unknown id / empty list) it returns `null` and the component performs no jump (Decision §5).
5. **Pass load states straight through.** loading / error (+ a working retry) / empty / ready come from `useSessionSnapshots` + `SnapshotList`; the jump wrapper adds no new state surface of its own beyond resolving selection to a position.
6. **No write affordance, no new dependency, no new architectural seam.** Read-only consumer; raw `fetch` only via the existing hook; no React Query/SWR; no new store. Localized strings come from the shell i18n instance — reuse the existing `snapshotList.*` keys; introduce a new key (in all three catalogs en-US, pt-BR, es-419) only if a jump-specific affordance label is genuinely needed.
7. **Surface-agnostic placement.** Lives in `@a-conversa/shell` beside `snapshot-list`; must not import from `apps/moderator`, `apps/replay`, `apps/test-mode`, or any single surface. Placement reasoning is settled in [`snapshot_list_ui.md`](snapshot_list_ui.md) §2 and reused here.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **Unit tests (Vitest)** for `resolveSnapshotPosition(snapshots, snapshotId)`:
   - a known `snapshotId` → that record's `logPosition`;
   - an unknown `snapshotId` → `null` (no throw);
   - an empty list → `null` (no throw);
   - given records with duplicate `logPosition`, resolution returns the matched record's position by `snapshotId` (id is the key, not position).
2. **Component tests (Vitest + RTL)** for `SnapshotJumpList`, stubbing `fetch` locally (mirroring [`useSessionSnapshots.test.tsx`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.test.tsx)):
   - **jump** — given a sessionId whose fetch yields N snapshots, renders N rows (ascending `logPosition`) and clicking a row calls `onJump` exactly once with that row's **`logPosition`** (asserting it is the position, not the `snapshotId`);
   - **state pass-through** — loading renders the loading affordance; a non-200 renders the error affordance and its `retry` re-issues the fetch; an empty `{ snapshots: [] }` renders the no-snapshots affordance; in none of loading/error/empty is `onJump` ever called;
   - **miss is inert** — a selection that fails to resolve (defensive; not normally reachable from rendered rows) performs no jump.
3. **No Cucumber scenario.** This is a *client* of REST surfaces already shipped and already Cucumber-pinned (`list-session-snapshots.feature`, plus the `snapshot_creation_ui` create→list round-trip). It adds no wire/broadcast/projector behavior at the system seam, so per the backend/WS pin rule no new Cucumber scenario is warranted.
4. **Playwright e2e is deferred — because the surface is still not yet reachable, and the inherited list e2e debt is forwarded (not paid here).** No route renders `SnapshotJumpList` and no surface owns the "current position" state it jumps within ([`apps/root/src/App.tsx:42`](../../../apps/root/src/App.tsx) mounts no replay/test surface; `apps/replay`/`apps/test-mode` do not exist; no client position store exists). A Playwright spec requires a running app reachable at a URL, which does not exist for this component, so full deferral — not a thin presence-spec — is again the correct call. The Vitest unit + component coverage in §1–§2 stands in for now. [`snapshot_list_ui.md`](snapshot_list_ui.md) §4 explicitly anticipated this case and authorized forwarding when no surface exists at jump-implementation time. The combined **list-render → click row → jump-to-position** Playwright debt is therefore forwarded to the two existing WBS leaves that will first mount the list+jump in a reachable surface:
   - `replay_test.replay_ui.replay_chapter_jumping` (replay viewer chapter index) — **already a WBS leaf** (`tasks/60-replay-and-test-mode.tji`, `replay_ui` family);
   - `replay_test.test_mode.test_mode_timeline_scrubber` (test-mode scrubber) — **already a WBS leaf** (`test_mode` family).
   Each inherits exactly one deferral (well under the catch-all-overload threshold), and each is the genuine first-render site for this affordance. **No new WBS task is created** for this debt (both inheritors already exist, so no milestone wiring is needed). Each inheritor's refinement MUST scope a Playwright spec covering snapshot-list render → click a snapshot row → assert the surface navigates to that snapshot's position. The closer should note this inheritance against both `replay_chapter_jumping` and `test_mode_timeline_scrubber` so their refinement-writers pick it up.
5. **Green gate.** `make` build + the full test suite pass with the new resolver, component, and tests (per the global build-and-test-before-commit rule).

## Decisions

**§1 — This task builds the jump *wiring* (resolver + connected `SnapshotJumpList`), not a surface and not next/prev chapter navigation.** *Rationale:* `snapshot_list_ui` deliberately shipped a pure `onSelect(snapshotId)` that does nothing, leaving the navigation to be wired here; the natural, reusable form of that wiring is a connected component that both in-stream surfaces mount with a single `onJump` prop. Next/prev *chapter* stepping (`nextSnapshotPosition`/`prevSnapshotPosition`) is the consuming surfaces' concern — `replay_chapter_jumping` owns prev/next markers, and those helpers already exist server-side; this task is specifically the *jump-to-a-chosen-snapshot* action driven by list selection. *Alternative rejected:* "also build prev/next chapter stepping here" — rejected: that affordance lives on a seek bar / chapter strip that doesn't exist yet and belongs to `replay_chapter_jumping`; pulling it in would build UI for an absent surface.

**§2 — Resolve `snapshotId → logPosition` client-side from the already-loaded list; do not call `GET /sessions/:id/snapshots/:snapshotId`.** *Rationale:* the user selects a row that was rendered from `useSessionSnapshots`, so the full `SnapshotRecord` (with `logPosition`) is already in memory; resolution is a local lookup with zero latency and no new error path. *Alternative rejected:* "fetch the single-snapshot endpoint on each select" — rejected: a redundant round-trip that re-fetches data already in hand, adding a loading/error state to a click handler for no benefit. The `get_snapshot` endpoint exists for the *different* case of resolving an id with **no list loaded** (a URL deep-link), which belongs to `replay_url_position_loading`, not list-driven jump.

**§3 — The host callback is `onJump(position: number)`, not `onSelect(snapshotId)`.** *Rationale:* every navigation surface in this stream speaks **position** (event-sequence space): `GET /sessions/:id/state?position=N`, the seek bar, `position_navigation`. Resolving the snapshot to a position at the jump boundary lets the replay viewer and test-mode scrubber stay position-only and share one navigation primitive, instead of each learning the snapshot record shape and re-implementing the lookup. *Alternative rejected:* "emit `snapshotId` and let each surface resolve" — rejected: duplicates the resolver at every call site and leaks snapshot-record knowledge into surfaces that otherwise only need positions.

**§4 — The component lives in `@a-conversa/shell`, beside `snapshot-list`.** *Rationale:* it is, like the list, a genuinely cross-surface, owner-less component with two known in-stream consumers (replay viewer + test mode) and no surface to extract *from* (neither consumer exists yet). This is the exact reasoning settled in [`snapshot_list_ui.md`](snapshot_list_ui.md) §2; it applies unchanged, so the jump piece co-locates with the list it wraps. *Alternative rejected:* "put it in the first replay/test surface app" — rejected: that app doesn't exist (this task doesn't depend on it), and cross-app component imports are what the shell exists to prevent.

**§5 — The client resolver returns `null` on miss; it does not throw `SnapshotNotFoundError` like its server twin.** *Rationale:* the server helper runs in request handlers where throwing maps cleanly to a 404; the client helper runs inside a React event handler where an uncaught throw would break the surface. The only caller selects from rendered rows, so a miss is effectively unreachable — but defensively returning `null` and performing no jump is the safe ergonomics for the UI path. *Alternative rejected:* "mirror the server and throw" — rejected as wrong for a click handler; it would convert a defensive impossibility into a crash.

**§6 — No new ADR.** *Rationale:* nothing here adds a dependency, an architectural seam, or a security trade-off. React (0003), Vitest (0006), Playwright (0008), pnpm-workspace package placement (0010), the shell-placement call (settled in `snapshot_list_ui` §2), and the snapshot-as-event / REST contracts are all already decided and shipped. The resolution-direction and `onJump`-shape calls above are scope decisions that belong in this refinement, not a new ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `packages/shell/src/snapshot-list/resolveSnapshotPosition.ts` — pure `number | null` resolver; mirrors server helper but returns `null` on miss instead of throwing (safe for UI click handlers).
- `packages/shell/src/snapshot-list/SnapshotJumpList.tsx` — connected component composing `useSessionSnapshots` + `SnapshotList` + resolver; exposes single `onJump(position: number)` host callback; load/error/empty pass straight through.
- `packages/shell/src/snapshot-list/resolveSnapshotPosition.test.ts` — Vitest unit tests: known id → logPosition, unknown id → null, empty list → null, duplicate-position records resolved by snapshotId.
- `packages/shell/src/snapshot-list/SnapshotJumpList.test.tsx` — Vitest+RTL component tests: jump emits logPosition (not snapshotId), loading/error+retry/empty pass-through with no jump, miss-is-inert via spy.
- `packages/shell/src/snapshot-list/index.ts` — barrel re-exports added for `SnapshotJumpList` and `resolveSnapshotPosition`.
- `packages/shell/src/index.ts` — shell public barrel re-exports added.
- e2e Playwright debt deferred (no reachable surface; no client position store). The combined list-render → click row → jump-to-position Playwright spec is inherited by two existing WBS leaves: `replay_test.replay_ui.replay_chapter_jumping` and `replay_test.test_mode.test_mode_timeline_scrubber`. Each inheritor's refinement **must** scope a Playwright spec covering snapshot-list render → click a snapshot row → assert the surface navigates to that snapshot's position.
- No new WBS task created for e2e debt (both inheritors already exist and are already gated into M8).
- No new i18n keys introduced — reuses existing `snapshotList.*` keys.
