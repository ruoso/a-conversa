# Persistent status indicator

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_status_indicator`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_shell.part_landscape_layout` (settled — `<ParticipantLayout>` ships at [`apps/participant/src/layout/ParticipantLayout.tsx`](../../../apps/participant/src/layout/ParticipantLayout.tsx) with a fixed-height `participant-footer` slot that takes children via a render-prop; this task plugs the status-indicator chip into that slot via the `footer={...}` prop on the layout call in `App.tsx`. See [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md#L20-L26) Decision §3 — the footer was deliberately left empty by that leaf so this leaf can land its chip without coordinating commits).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_auth_flow` (settled — `useAuth()` is consumed in the surface; the host-supplied `screenName` is read for the chrome's identity row. The status indicator itself does NOT read `useAuth()` directly today — the chrome header already carries identity — but the same consumption shape governs the future role-badge expansion when that lands; see [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md#L103-L146)).
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — the canonical `WsConnectionStatus` discriminated union [`'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'`] lives in [`packages/shell/src/ws/store-contract.ts:31`](../../../packages/shell/src/ws/store-contract.ts#L31); the `BaseWsStoreState` it slots into is the same shape any participant-side `useWsStore` will adopt — see Decisions §2 for how this leaf consumes it without depending on a not-yet-landed store).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_ws_client` (**not yet complete**; the WS-client wire-up leaf transitively requires `part_state_management` which is also not complete). The implication for this leaf — see Decision §2 — is that the real `useWsStore().connectionStatus` source is not callable from the participant surface today. This leaf ships with a derived/stubbed source and a single-prop seam so `part_ws_client` (or whichever leaf first makes `useWsStore` callable) wires the real source in a one-line follow-up.

## What this task is

The persistent connection-status chip that lives in the participant tablet's `participant-footer` region. After this leaf:

- A new `<ParticipantStatusIndicator>` component under [`apps/participant/src/layout/ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx) renders a single-row, ~48 px-tall chip that visualizes the current WS connection state (icon + colored dot + localized label) and exposes a stable container testid (`participant-status-indicator`) plus per-state structural attributes (`data-status="<state>"`, `data-status-tone="<tone>"`) for testing.
- The chip is plugged into the layout's footer slot at the `<PlaceholderRoute>` call site in [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx) — i.e. `footer={<ParticipantStatusIndicator />}` replaces the current `footer={null}`. Every participant URL (today the wildcard route; tomorrow the invite-acceptance flow, the lobby, the operate view) inherits the persistent chip because every route mounts through the same chrome.
- The state source today is a derived/stubbed signal (Decision §2) — `'connecting'` while the surface is mounted but the WS isn't yet wired, transitioning to `'open'` if a global flag set by a future `part_ws_client` is observed. Wiring the real `useWsStore().connectionStatus` is a follow-up leaf (existing `part_ws_client`); the chip's *source seam* lands as a single React-hook function `useParticipantConnectionStatus()` so the future wiring is a one-line internal swap with no caller-side change.
- The visual surface is bound: a colored dot (per-state Tailwind utility), a localized label (one ICU key per state), and an accessible `role="status"` + `aria-live="polite"` region so screen readers announce transitions. No icons-from-an-icon-pack today (deferred to a future tokens / icon-pack leaf); the dot is a `<span>` with a Tailwind background-color class.
- Test layers per ADR 0022: a Vitest component-shape suite at `apps/participant/src/layout/ParticipantStatusIndicator.test.tsx` (state → expected attribute + label across all five states; ARIA contract; stable testid); an extension to the existing Vitest mount-boundary case in `apps/participant/src/mount.test.tsx` (the chip is visible inside the footer for the authenticated path); an extension to the existing Playwright scenario in `tests/e2e/participant-skeleton-smoke.spec.ts` (the chip is visible in the footer with an expected initial state — `'connecting'` since the stubbed source).

Out of scope (deferred to existing or future leaves):

- **Not the role badge** ("debater A" / "debater B"). The role is per-session participant-row data that lands when the moderator's invite-claim flow assigns a participant their `role` field; the surface reads it via session state (`part_state_management` + the `part_session_join.part_invite_acceptance` claim flow), neither of which is complete. Adding a role badge today would mean stubbing a second source AND inventing a session-state-to-role mapping shape that the real `part_invite_acceptance` is the right place to settle. The current refinement file's stub Decision ("Left-aligned: role badge + screen name") is superseded by Decision §3 below — the role badge lands in a follow-up that already exists transitively (see Decision §6 / tech-debt).
- **Not the pending-vote count badge.** Pending counts derive from `useUiStore().pendingProposalCount` or an equivalent derived value off `useWsStore().sessionState[*].pendingProposals`. Neither store is callable from the participant today (`part_state_management` not complete). The badge lands in `part_proposals_tab` ("Pending proposals tab with count badge") which already has a stable WBS slot under `part_pending_proposals` — no new leaf needed.
- **Not the screen-name display in the chip.** The chrome header already carries `participant-identity` per the just-landed `part_landscape_layout`; duplicating the screen name in the footer would create two seams of truth for "who is logged in" without adding affordance. If a UX pass later wants a role + screen-name chip in the footer, the chip's right slot is free to absorb it — but landing it today before the role data exists would create a dangling testid.
- **Not the diagnostics-list entry / change-history affordance.** `docs/participant-ui.md` §P6 + §P7 describe diagnostics + history as accessible "from the status indicator", but each is a separate leaf (`part_diagnostics_list`, `part_history_list`) that this chip does not anchor — the chip is the *visual* persistent affordance; the navigation entry points land when their owning leaves do.
- **Not a moderator mirror.** The moderator has no equivalent visible status chip today (a search of `apps/moderator/src/` finds only logic-level `useWsStore((s) => s.connectionStatus)` reads inside commit-gate predicates, no rendered indicator — see [`apps/moderator/src/layout/PendingProposalsPane.tsx:434`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L434)). This leaf does not mirror a moderator pattern; it establishes the pattern. If the moderator later wants the same chip, it can copy the participant's shape (the chip is structurally portable — it has no participant-specific assumption beyond reading from a shell-owned `WsConnectionStatus`).
- **Not a real-time tap target.** The chip does not navigate, open a panel, or expose imperative controls today; it is read-only visual cue. A future leaf (`part_diagnostics_list`?) can wire a tap-to-open-diagnostics affordance into the same chip when that surface exists.
- **Not a portrait-mode redesign.** The footer is fixed-height at 48 px; the chip is sized for it. Portrait-orientation behavior is out of scope per the same boundary `part_landscape_layout` set.

## Why it needs to be done

`m_manual_lobby_smoke` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a human drives `moderator → invite → debater login → lobby`, and `part_status_indicator` is one of the WBS leaves the milestone directly depends on (see the `depends` list on `m_manual_lobby_smoke`). The chain a real debater hits today (after the just-landed [`part_landscape_layout`](part_landscape_layout.md) at commit `992ab60`):

1. Debater clicks the moderator-emitted invite URL `/p/sessions/<uuid>/invite?role=debater-A`.
2. Root host's `/p/*` route renders `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`; auth-gate passes (after `f93e80b`'s new-user redirect fix); the host calls `surface.mount({...})`.
3. `<App>` mounts the wildcard `<PlaceholderRoute>` which composes `<ParticipantLayout header={<ParticipantChrome />} main={<PlaceholderRouteBody />} footer={null} />`.
4. **Today**: the footer is a visible 48 px bordered band at the bottom of the viewport with zero content. The debater sees their identity in the header but has no live cue that their browser is actually talking to the backend. On a flaky cafe network — exactly the conditions the M3-lobby smoke is meant to exercise — "I clicked the invite URL and I'm on the lobby page" is ambiguous: is the lobby empty because nobody else has joined, or because my WS dropped two minutes ago and the state shown is stale?
5. **After this leaf**: the footer paints a localized chip — "Connecting…", then "Live" once the WS is up, then "Reconnecting…" on a transient drop, then "Disconnected" if the drop persists. The debater always knows whether their view of the lobby (or, later, the live debate) reflects current server state. The moderator's lobby view ([`tasks/refinements/moderator-ui/mod_lobby_view.md`](../moderator-ui/mod_lobby_view.md) / equivalent) trusts that when it shows "Debater A is in the lobby", the debater's surface is actually connected — that trust requires the debater's own surface to surface its connectedness so the human at the tablet can self-verify.

Downstream concretely:

- **`part_session_join.part_invite_acceptance`** — when the invite-claim POST fires, the chip's "connecting" → "open" transition is the user-visible cue that the claim's broadcast actually reached the server. Without the chip, the claim's "you're now in the lobby" message could read as confirmed even if the underlying WS never opened.
- **`part_session_join.part_lobby_view`** — the lobby's "other debater hasn't joined yet" empty state needs the chip in the footer to disambiguate "they haven't joined" from "my view is stale".
- **`part_pending_proposals` / `part_voting`** — the operate view's per-facet vote affordances are dangerous to expose under a non-`'open'` WS (the vote may not actually land); the chip's state is the user-visible counterpart to the moderator's already-existing commit-gate predicate.
- **`part_unit_status_indicator`** (under `part_tests.part_unit_tests`, effort 0.5d) — the canonical Vitest target this leaf produces; that leaf's existing 0.5d budget covers a richer second pass once role + pending count are wired.

Architecturally, this leaf is also the **first realization of the shell's `WsConnectionStatus` type as a user-visible affordance.** The moderator reads `connectionStatus` only as a logic-level gate (`commit-disabled when !== 'open'`); the participant chip is the first place the discriminated union actually surfaces to the user as a localized, colored visual. If the moderator later wants the same surface (which it likely will — debaters and moderators both benefit from a connection cue), it copies the participant chip's shape without re-deciding state→label mapping.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md#L17-L20) — "All participants — both debaters and the moderator — must agree on every change to the graph before it lands." Agreement requires that participants are actually connected; the chip is the user-visible "am I in the conversation" cue.
- [docs/participant-ui.md — Layout (sketch)](../../../docs/participant-ui.md#L21-L31) — "A persistent **status indicator** shows the debater's role (`debater A` or `debater B`), screen name, and a small count of facets awaiting their vote." The current refinement file's surface mirrors this; the present refinement scopes down to **connection status only** for M3-lobby (Decision §3 explains the carve-out).
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L130-L138) — landscape tablet orientation; the chip is sized for a 48 px footer row.
- [ADR 0005 — Tailwind CSS with shared design tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — Tailwind is the styling system; `packages/ui-tokens` is deferred. The chip uses inline Tailwind utility classes (per-state background-color via `bg-emerald-500` / `bg-amber-500` / `bg-rose-500` / `bg-slate-400` for the dot; per-state text via `text-slate-700`). When tokens land, the per-state palette swaps in a single commit (mirroring the moderator's `OperateLayout` future-token-swap).
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest state-→-visual cases + the extended Playwright assertion are the regression pins; no manual "I disconnected the wifi and the chip turned amber" smoke.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — host-supplied i18n; each state's label is a single ICU-free string key (no plural arms, no interpolation) under `participant.statusIndicator.<state>` (Decision §5).
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L48-L75) — the surface owns its mounted region; the chip is the surface's affordance, not the host's. Decision 3 fixes that the surface consumes from the host substrate (`@a-conversa/shell`); this leaf reads `WsConnectionStatus` from the shell (type-only import today, value-only later).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the predecessor. Decision §3 ("The footer slot is empty today; `part_status_indicator` plugs the chip in") and the test-layer §3.1 ("the participant-footer is empty") are explicitly relaxed by this leaf — the Playwright scenario this leaf extends asserts the footer contains the chip (rather than `toBeEmpty()`) after this leaf lands. The `participant-footer` testid + 48 px height contract are inherited unchanged.
- [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L172) — the mount provider stack (`<I18nProvider>` + `<AuthValueProvider>`). The chip consumes `useTranslation()` and (eventually) `useWsStore()`; both work inside this provider stack with zero modification.
- [`tasks/refinements/participant-ui/part_auth_flow.md`](part_auth_flow.md) — the `useAuth()` consumption pattern. Not consumed in this leaf (the chip is identity-agnostic) but the same provider-readiness invariant applies.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — declares `useUiStore` (pending-count source) + `useVoteStore` + `useSelectionStore`. Not consumed in this leaf; pending-count badge lands when both this stub and `part_state_management` are complete, in a follow-up that already exists transitively (`part_pending_proposals.part_proposals_tab`).
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md#L20-L31) — the canonical `WsConnectionStatus` shape (`'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'`). The chip's state enum mirrors this exactly; the leaf does NOT introduce a sibling participant-local enum (Decision §4).

### Live code the surface plugs into

- [`apps/participant/src/layout/ParticipantLayout.tsx:75-81`](../../../apps/participant/src/layout/ParticipantLayout.tsx#L75) — the `<footer data-testid="participant-footer" ...>` region. Already a flex row (`flex items-center justify-between`) sized to `h-12` with `px-4` horizontal padding; the chip slots in as the left-aligned child (with `null` or future right-aligned content sliding into the `justify-between` right slot).
- [`apps/participant/src/App.tsx:131-139`](../../../apps/participant/src/App.tsx#L131) — the `<PlaceholderRoute>` composes `<ParticipantLayout>` with `footer={null}` today; this leaf changes that single line to `footer={<ParticipantStatusIndicator />}`. No other change to `App.tsx`.
- [`apps/participant/src/main.tsx:33-50`](../../../apps/participant/src/main.tsx#L33) — the mount entrypoint. **Not modified** by this leaf; the provider wiring is already correct. The chip is a leaf React component that reads from the provider stack and renders.
- [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) — the existing mount-boundary case. **Extended by one assertion**: the chip's container testid (`participant-status-indicator`) is visible inside `participant-footer` after mount, with `data-status="connecting"` as the initial state (the stubbed source's initial value per Decision §2).
- [`packages/shell/src/ws/store-contract.ts:31`](../../../packages/shell/src/ws/store-contract.ts#L31) — the canonical `WsConnectionStatus` discriminated union. Imported type-only (`import type { WsConnectionStatus } from '@a-conversa/shell'`) so the leaf adds zero runtime dependency on the shell's WS subsystem (the surface doesn't subscribe to a store today; the type is the only shell-side touchpoint).

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) — the predecessor's e2e spec. **This leaf extends the first scenario** (`authenticated user hits /p/sessions/<uuid>/invite?role=debater-A and sees the placeholder`) by replacing the existing `await expect(layoutFooter).toBeEmpty();` assertion (line 98) with assertions that the chip is visible inside the footer, carries `data-status="connecting"` (the stubbed initial state), and the label text matches the en-US `participant.statusIndicator.connecting` value. No new scenario, no new fixture, no new Playwright project. The second + third scenarios are unchanged (the chip is unaffected by the `participant-identity` content and is not reached by the unauthenticated-deflection scenario).
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` project unchanged.

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the `participant` namespace today has four sub-namespaces (`placeholder`, `identity`, `notAuthenticated`, `chrome`) with five keys total. This leaf adds one new sub-namespace (`statusIndicator`) with five new keys — one per `WsConnectionStatus` arm (`idle`, `connecting`, `open`, `reconnecting`, `closed`).
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — both gain the five new dotted keys under `pending`, mirroring the `i18n_participant_chrome_native_review` pattern landed by `part_landscape_layout`.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/layout/ParticipantStatusIndicator.tsx` — NEW. The chip component + the `useParticipantConnectionStatus()` hook (state source seam — Decision §2) + the per-state class/label mapping table.
- `apps/participant/src/layout/ParticipantStatusIndicator.test.tsx` — NEW. Vitest cases (one per state) pinning the visual + accessibility contract.
- `apps/participant/src/App.tsx` — modified. The `<PlaceholderRoute>` changes `footer={null}` to `footer={<ParticipantStatusIndicator />}`. No other change.
- `apps/participant/src/mount.test.tsx` — modified. The existing authenticated case grows one assertion: the chip's container testid is visible inside the footer with `data-status="connecting"`. No new case.
- `tests/e2e/participant-skeleton-smoke.spec.ts` — modified. The existing first scenario's `await expect(layoutFooter).toBeEmpty();` (line 98) is replaced by chip-visible + `data-status="connecting"` + en-US-label assertions. No new scenario; second + third scenarios unchanged.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Five new keys under `participant.statusIndicator.*` (one per `WsConnectionStatus` arm).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same five keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same five keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds the five dotted keys to `pending`.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — provider wiring already correct.
- `apps/participant/src/layout/ParticipantLayout.tsx` — the layout's footer slot is consumed unchanged. No new prop, no new testid, no geometry change.
- `apps/participant/src/index.css` — Tailwind reset already in place.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep, no new build config, no new project reference. `@a-conversa/shell` is already pinned (used today for `useAuth`); the chip's `import type { WsConnectionStatus } from '@a-conversa/shell'` rides the existing import.
- `packages/shell/` — `WsConnectionStatus` consumed unchanged. No new shell substrate.
- `apps/root/` / `apps/server/` / `apps/moderator/` / `apps/audience/` — no cross-surface change.
- `playwright.config.ts` — no new Playwright project; existing `chromium-participant-skeleton` covers the extended assertion.
- `.tji` files OTHER than `tasks/35-frontend-i18n.tji` — the `complete 100` marker for `part_status_indicator` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42). The native-review chain leaf for the new i18n keys lands in `tasks/35-frontend-i18n.tji` (see Tech-debt registration below).
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0005 / 0022 / 0024 / 0026 or a scoped UI policy).

### Component shape (`apps/participant/src/layout/ParticipantStatusIndicator.tsx`)

Sketch:

```tsx
// `<ParticipantStatusIndicator>` — persistent connection-state chip for
// the participant tablet footer.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
// Design doc: docs/participant-ui.md ("A persistent status indicator")
//
// Visual surface (one row, ~48 px tall, lives inside the layout's
// `participant-footer` slot):
//
//     [colored-dot]  [localized label]
//
// The chip is structure + presentation only. The connection-state value
// it visualizes comes from `useParticipantConnectionStatus()` (below)
// — today a derived/stubbed source (Decision §2), tomorrow a one-line
// swap to `useWsStore((s) => s.connectionStatus)` once `part_ws_client`
// makes the store callable from the participant surface.
//
// State → visual mapping (per-state Tailwind utility classes are inline
// pending `packages/ui-tokens` per ADR 0005):
//
//   idle          slate-400  "Not connected"
//   connecting    amber-500  "Connecting…"
//   open          emerald-500 "Live"
//   reconnecting  amber-500  "Reconnecting…"
//   closed        rose-500   "Disconnected"
//
// The container is `role="status"` + `aria-live="polite"` so screen
// readers announce state transitions without interrupting the user;
// the label is the announced text.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { WsConnectionStatus } from '@a-conversa/shell';

import { useParticipantConnectionStatus } from './useParticipantConnectionStatus';

const DOT_CLASSES: Record<WsConnectionStatus, string> = {
  idle: 'bg-slate-400',
  connecting: 'bg-amber-500',
  open: 'bg-emerald-500',
  reconnecting: 'bg-amber-500',
  closed: 'bg-rose-500',
};

const TONE: Record<WsConnectionStatus, 'neutral' | 'transient' | 'healthy' | 'error'> = {
  idle: 'neutral',
  connecting: 'transient',
  open: 'healthy',
  reconnecting: 'transient',
  closed: 'error',
};

const LABEL_KEY: Record<WsConnectionStatus, string> = {
  idle: 'participant.statusIndicator.idle',
  connecting: 'participant.statusIndicator.connecting',
  open: 'participant.statusIndicator.open',
  reconnecting: 'participant.statusIndicator.reconnecting',
  closed: 'participant.statusIndicator.closed',
};

export function ParticipantStatusIndicator(): ReactElement {
  const { t } = useTranslation();
  const status = useParticipantConnectionStatus();
  return (
    <div
      data-testid="participant-status-indicator"
      data-status={status}
      data-status-tone={TONE[status]}
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-slate-700"
    >
      <span
        data-testid="participant-status-indicator-dot"
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASSES[status]}`}
      />
      <span data-testid="participant-status-indicator-label">{t(LABEL_KEY[status])}</span>
    </div>
  );
}
```

- The chip is the *left-aligned* child of the footer's `justify-between` flex row. The footer's right slot stays free for future content (e.g. the pending-vote count badge when `part_state_management` lands). No need for a `<></>` fragment or a second wrapper.
- `data-status="<state>"` mirrors the `WsConnectionStatus` literal; `data-status-tone="<tone>"` is a coarser grouping that downstream styling (or visual-regression tests) can pin without coupling to the five-arm enum.
- `role="status"` + `aria-live="polite"` is the WAI-ARIA pattern for a non-interrupting live region; it announces transitions on assistive tech without stealing focus (`aria-live="assertive"` would interrupt — wrong for a passive cue).
- The label is a single ICU-free key per state — no plurals, no interpolation. Locales sign off five strings.
- No `<button>`, no `onClick`, no `tabIndex`; the chip is read-only. Future leaves (diagnostics-list entry point, etc.) decide whether to upgrade to interactive.

### State source seam (`apps/participant/src/layout/useParticipantConnectionStatus.ts`)

A separate file so the swap is mechanical:

```tsx
// `useParticipantConnectionStatus` — the seam between the participant
// status-indicator chip and the WS subsystem.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
//   (Decision §2 — stubbed source today, one-line swap when
//   `part_ws_client` lands).
//
// Today: returns `'connecting'` (a sentinel "we know something is meant
// to happen here; it hasn't yet" value that matches what a real WS
// would report between mount and the first `'open'`). Decision §2
// explains why this is preferable to `'idle'` or `'open'` as a stub.
//
// Tomorrow (after `part_ws_client` lands and a participant-local
// `useWsStore` becomes callable): replace the body with
// `return useWsStore((s) => s.connectionStatus);`. The component above
// changes zero lines.

import type { WsConnectionStatus } from '@a-conversa/shell';

export function useParticipantConnectionStatus(): WsConnectionStatus {
  // Stubbed source — see Decision §2. The future implementation reads
  // from `useWsStore((s) => s.connectionStatus)`.
  return 'connecting';
}
```

- The function is a React-hook-named function (prefixed `use*`) even though it has no internal hook calls today, so the eventual `useWsStore(...)` swap doesn't change the call-site contract. ESLint's `react-hooks/rules-of-hooks` is satisfied because the caller treats it as a hook.
- The stub returns `'connecting'`, not `'open'` or `'idle'`. The rationale (Decision §2): from the user's perspective, between page-load and a real WS handshake the surface IS connecting; lying as `'open'` would over-claim healthy state and lying as `'idle'` would under-claim. `'connecting'` is the honest sentinel.

### What the chip MUST NOT do

- **No `fetch`, no `WebSocket`, no subscription side effects.** The chip is a render-only consumer of the (stubbed today, real tomorrow) state source. Any side effects belong inside the WS-client wire-up leaf.
- **No `useAuth()`, no `useUiStore()`, no `useParams()`, no `useNavigate()`.** The chip is connection-state-only. Identity is already in the chrome header; pending-count is a future content for the footer's right slot (different concern); route awareness is irrelevant.
- **No conditional rendering of the container.** All five states render the chip with the same structural shape (container + dot + label); only the dot's color class and the label's text vary. This keeps the testid stable across states so the e2e + Vitest selectors don't need to branch.
- **No animation, no transition CSS, no spinner.** The dot is a static colored circle today; animated states (e.g. a pulse on `connecting`) are a future visual-polish concern (potentially part of `part_visual_regression.part_vr_state_styling` which already exists). Today's chip is a JSX leaf.
- **No `window.location` reads or writes.** No router awareness.
- **No `useEffect`.** The chip is pure render; the source hook may grow a `useEffect` later (when it wraps a real store subscription), but the component itself doesn't.

### Test layers per ADR 0022

Three pins, each anchoring a different observable property:

1. **Vitest component-shape (NEW)** — `apps/participant/src/layout/ParticipantStatusIndicator.test.tsx`. Cases:
   - (a) For each `WsConnectionStatus` arm (`'idle'`, `'connecting'`, `'open'`, `'reconnecting'`, `'closed'`), mount the chip with the source hook stubbed to that value (via `vi.mock('./useParticipantConnectionStatus')` or by passing the value through a test-only prop — Decision §7). Assert: container has `data-status="<state>"`, `data-status-tone="<expected-tone>"`, and the label text matches the en-US `participant.statusIndicator.<state>` value. 5 cases.
   - (b) The container carries `role="status"` and `aria-live="polite"`. 1 case (sufficient to pin the ARIA contract; not per-state because the attributes don't vary).
   - (c) The dot child carries `aria-hidden="true"` (the colored dot is decorative; the label is the announced text). 1 case.
   - Total: 7 cases. Smoke count grows by +7.
2. **Vitest mount-boundary (extended)** — `apps/participant/src/mount.test.tsx`. The existing authenticated case grows one assertion: `screen.getByTestId('participant-status-indicator')` is visible AND its `data-status` attribute is `'connecting'` (the stubbed source's initial value). Pins the wiring end-to-end (App.tsx → layout footer slot → chip), not just the chip in isolation. Case count unchanged (existing case gains the assertion).
3. **Playwright (extended)** — `tests/e2e/participant-skeleton-smoke.spec.ts`. The existing first scenario's `await expect(layoutFooter).toBeEmpty();` (line 98) is replaced by:
   ```ts
   const statusIndicator = layoutFooter.getByTestId('participant-status-indicator');
   await expect(statusIndicator).toBeVisible();
   await expect(statusIndicator).toHaveAttribute('data-status', 'connecting');
   await expect(statusIndicator).toContainText('Connecting…');
   ```
   The other two scenarios are unchanged; the chip doesn't interact with the authenticated-identity scenario's assertions, and the unauthenticated-deflection scenario never paints the surface so the chip is unreachable in that branch.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default per `ORCHESTRATOR.md`.** The participant surface is reachable from the root (`/p/*` lands in `SurfaceHost`); the chip is part of the surface's persistent chrome and is the first user-perspective check that the WS-state seam exists. Extending the existing first scenario with three chip-visible assertions covers the user-perspective contract without inventing a new spec file or fixture. The extended scenario runs under the same `make up` compose stack `part_landscape_layout` already targeted.

No e2e is deferred from this leaf.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~30 min: write `ParticipantStatusIndicator.tsx` + `useParticipantConnectionStatus.ts` (~80 LOC total including the per-state mapping tables and comments).
- ~1h: write `ParticipantStatusIndicator.test.tsx` (~120 LOC for the 7 cases, including the test-fixture wrapper that re-mounts the chip with a per-case source-hook stub).
- ~15 min: thread the `footer={<ParticipantStatusIndicator />}` change through `App.tsx`; extend the mount-boundary assertion.
- ~30 min: extend the Playwright first scenario; verify under `make up`.
- ~30 min: add five new i18n keys across en-US + pt-BR + es-419 + the two review.json pending lists; verify catalog parity check.
- ~1h: visual sanity at 1280×720 + 1024×768 viewports (each of the five states the test-hook stub can drive locally; verify dot color contrast against the slate-100 footer background; verify the label remains readable in the active locale at the chosen Tailwind text size).
- ~1h: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + the WBS-status ritual.

Risk surface is modest. The two non-trivial decisions (stubbed source vs. wired source; deferring role+pending-count) are explicitly settled below. The chip shape is structurally simple (a `<div>` with two `<span>`s). The biggest implementation hazard is the test-fixture for the per-state source-hook stub; Decision §7 picks the simpler of two viable patterns.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move (other than the harmless `@a-conversa/i18n-catalogs` workspace re-link triggered by JSON edits).
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new chip component, the source-hook stub, the extended `mount.test.tsx` all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)). The `WsConnectionStatus` type-only import resolves without pulling in any runtime shell-WS code.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessors pinned; bundle filename / sidecar shape unchanged; the new component is tree-shaken into the existing `participant-<hash>.js` (no separate asset).
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests). ESLint's `react-hooks/rules-of-hooks` is satisfied by the `useParticipantConnectionStatus` name even though the stub has no internal hooks today.
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+7** (seven new `ParticipantStatusIndicator.test.tsx` cases). The extended `mount.test.tsx` case does not change the case count.
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the five new `participant.statusIndicator.*` keys are present in all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e`** under `make up` runs the extended `participant-skeleton-smoke.spec.ts` green inside the existing `chromium-participant-skeleton` project. Total scenario count in the spec is unchanged (3 — one extended, two unchanged).
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The chip owns no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|useState\|window\.` under `apps/participant/src/layout/ParticipantStatusIndicator.tsx` (and `useParticipantConnectionStatus.ts`) returns zero matches (Decision §1: chip is render-only).
10. **The five state literals match the shell** — `apps/participant/src/layout/ParticipantStatusIndicator.tsx`'s per-state mapping tables (DOT_CLASSES, TONE, LABEL_KEY) have exactly the five keys `idle`, `connecting`, `open`, `reconnecting`, `closed` — verified by TypeScript's exhaustive `Record<WsConnectionStatus, ...>` checks (a missing key fails the build).
11. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_status_indicator` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
12. **Predecessor's existing assertions unchanged** — `tests/e2e/participant-skeleton-smoke.spec.ts`'s second and third scenarios pass without modification; the first scenario's layout-shape assertions (region testids, identity-in-header, header-product-label) pass unchanged; only the footer's "is empty" assertion is replaced by chip-visible assertions.

## Decisions

### 1. Scope to connection-status only for M3-lobby; defer role + pending-count

Three alternatives surveyed for the chip's content:

- **(A) Full per-design chip — role badge + screen name + pending-vote count + connection status indicator** (matches `docs/participant-ui.md`'s sketch and the prior refinement stub). Rejected for M3-lobby. The role badge needs the moderator's invite-claim flow to land (`part_session_join.part_invite_acceptance` — open WBS leaf, not yet shipped) AND a session-state store to read from (`part_state_management` — open WBS leaf, not yet shipped). The pending-vote count needs the same store AND the WS-client wire-up to feed it (`part_ws_client`). Building the full chip today would mean stubbing three sources (role, screen-name, pending-count) and inventing the data-flow shape that the real owning leaves are the right place to settle. The screen-name display would also duplicate the chrome header's identity row, creating two seams of truth.
- **(B) Just the screen-name display** (a chrome-mirror of the chrome header). Rejected. Adds zero new affordance — the header already carries the same data — and creates two seams of truth for "who is logged in". The chip would be visually redundant.
- **(C) Connection-status indicator only** (chosen). Single, complete affordance. Source seam is well-defined (shell-owned `WsConnectionStatus`). The chip ships today with a stubbed source (Decision §2) and is wired to the real source in a one-line follow-up when `part_ws_client` makes a participant-local `useWsStore` callable. Role badge + pending count land in their own future leaves without re-deciding the chip's outer shape (each adds a child element into the chip's container; the existing testid + container ARIA stay).

This narrowing supersedes the prior refinement stub's "Decisions" bullet ("Left-aligned: role badge + screen name. Right-aligned: pending vote count badge"). The future evolution path is preserved: when role data exists, a sibling `<ParticipantRoleBadge />` mounts as the chip's first child; when pending-count exists, a sibling `<ParticipantPendingCount />` mounts in the footer's right-aligned slot. Neither evolution requires this leaf to change.

Why this scope is the *right* M3-lobby minimum: the milestone's user-visible test is "two debaters open invite URLs and land in the lobby". For that to be trustworthy on a flaky network, debaters need a persistent cue that they're actually connected. The role badge and pending count add value during operate (P2 voting, P3 withdrawal) but neither is on the M3-lobby critical path. The connection chip IS.

### 2. Stubbed source today; wire the real `useWsStore` in `part_ws_client`'s follow-up

Three alternatives surveyed for "where does `WsConnectionStatus` come from today":

- **(A) Wire the real `useWsStore` now**, landing a transitive subset of `part_state_management` + `part_ws_client` (minimum needed to make `useWsStore.connectionStatus` callable from the participant). Rejected. Both predecessor leaves have explicit refinements (`part_state_management.md`, `part_ws_client.md` — not yet written, but the leaf exists). Pulling a transitive subset of them into this leaf would (a) blur the WBS scope boundary, (b) commit to a `useWsStore` API shape before the owning leaf decides it (and the moderator's `useWsStore` shape may or may not be the right participant equivalent — that's `part_state_management`'s call), and (c) inflate this leaf's budget past 1d.
- **(B) Stub the source with a hard-coded `'open'`** so the chip always reads "healthy". Rejected. False signal: on a real flaky network the chip would read healthy while the WS was silently down. The whole point of the chip is to NOT lie.
- **(C) Stub the source with `'connecting'` (chosen)**, isolated in `useParticipantConnectionStatus.ts` so the future swap is mechanical. Rationale:
  - `'connecting'` is the honest sentinel between page-load and a real WS handshake — when the WS lands, the user perceives the transient state correctly even today.
  - The function is a hook (prefixed `use*`) even though it has no internal hooks today; this keeps the call-site contract stable across the swap.
  - The swap when `part_ws_client` lands is a single line of code inside `useParticipantConnectionStatus.ts` (replace the `return 'connecting'` with `return useWsStore((s) => s.connectionStatus)`); no chip-component change, no test-fixture rewrite (the Vitest cases already stub the hook per-state), no Playwright change (the e2e asserts `data-status="connecting"` which remains the surface's *initial* state under the real source).
  - **Risk on the Playwright assertion**: if `part_ws_client` lands and the WS opens fast enough that by the time Playwright reads `data-status` the value is already `'open'`, the e2e flakes. Mitigation lives with `part_ws_client`'s closer: that follow-up either (i) updates the e2e to accept both `'connecting'` and `'open'` (the chip transitions through both), or (ii) instruments a way to await `'open'`. Today's leaf is not responsible for that future migration.

The chosen approach is *load-bearing* on the source-hook seam being a single function in its own file. Inlining the stub inside the chip component would force the future swap to either touch the chip (breaking the structure-only invariant) or hide the swap inside a context-provider scaffold (over-engineered for a single read). The standalone hook file is the simplest path that keeps both invariants.

### 3. Five-arm state enum matching the shell's `WsConnectionStatus` exactly

Three alternatives surveyed for the chip's state shape:

- **A simplified two-arm enum** (`'healthy'` / `'unhealthy'`) collapsed from the shell's five arms. Rejected. The user-visible affordance benefits from disambiguating "connecting" (first load) from "reconnecting" (transient drop) from "closed" (durable disconnect) — they have different urgencies and the user should perceive them differently (amber for both transients; rose for durable failure).
- **A participant-local enum** independent of the shell's `WsConnectionStatus`. Rejected. The chip is meant to be a render-only mirror of the shell's state; introducing a translation layer (`WsConnectionStatus → ParticipantStatusKind`) adds work for zero affordance and creates a coupling point that drifts whenever the shell's enum gains an arm.
- **Use the shell's `WsConnectionStatus` literally as the chip's discriminant** (chosen). The chip's mapping tables (`DOT_CLASSES`, `TONE`, `LABEL_KEY`) are `Record<WsConnectionStatus, ...>` so a future shell-side arm addition fails the participant build until the chip catches up — a structural guarantee that the chip stays in sync.

This decision is what makes the future wiring change one line: the source hook returns `WsConnectionStatus`; the chip already handles every arm; no caller-side or chip-side change when the source flips real.

### 4. Per-state visual: colored dot + label only; no icon pack, no animation

Three alternatives surveyed for the chip's visual surface:

- **Icon pack** (Heroicons / Lucide / Material Icons) per-state (`wifi` / `wifi-slash` / `loader`). Rejected for this leaf. No icon pack is currently a workspace dep; adding one introduces a new runtime dep + a bundle-size delta + a per-locale a11y label discipline (the icon's `aria-label` would also need an ICU key per state — 10 keys instead of 5). The Tailwind colored dot is sufficient as a state-cue and ships with zero new dep. A future leaf can introduce icons as a polish pass without changing the chip's outer shape (the dot becomes an icon `<svg>`; the testids stay).
- **Animated treatment** (e.g. a CSS pulse on `connecting` / `reconnecting`). Rejected for this leaf. Adds visual-noise on a tablet that the user is meant to focus on the debate, not the chip. The transient amber on `connecting` / `reconnecting` is sufficient. A future visual-polish leaf (already-existing `part_visual_regression.part_vr_state_styling`) can decide whether animation adds value once the chip is in user hands.
- **Static colored dot + localized label** (chosen). Five colors (slate-400 / amber-500 / emerald-500 / amber-500 / rose-500) deliberately reusing amber for both transient states so the user perceives "yellow ⇒ in flux" without having to memorize the connecting/reconnecting distinction; rose for failure; emerald for healthy; slate for the no-attempt sentinel.

### 5. One ICU-free key per state; no plural arms, no interpolation

Two alternatives surveyed for the i18n surface:

- **One ICU select per chip** (`participant.statusIndicator.label` keyed off the state) — single key, ICU select arm per state. Rejected. The ICU select syntax for `WsConnectionStatus` would be `{status, select, idle{...} connecting{...} open{...} reconnecting{...} closed{...} other{...}}` — verbose, parses through the `i18next-icu` plugin on every render, and the parity-checker has to verify the ICU select arms match the discriminant. The translator's job is also harder (they edit a multi-line ICU template instead of five plain strings).
- **One plain key per state, five keys total** (chosen). Each key is a simple string with no ICU parsing cost. The chip's per-state `LABEL_KEY` table maps state literal → catalog key, and `t(LABEL_KEY[status])` does a direct lookup. The native-speaker review surface is five independent strings — straightforward to sign off.

Five keys is a small i18n footprint, comparable to other surface affordances; the trade is favorable.

### 6. Native review chain extension; no other follow-ups needed

- **`frontend_i18n.i18n_participant_status_indicator_native_review`** — pt-BR + es-419 native-speaker review of the five new `participant.statusIndicator.*` keys. Effort: 0.25d. Mirrors the existing `i18n_participant_chrome_native_review` / `i18n_participant_identity_native_review` / `i18n_participant_placeholder_native_review` task shape; chains after the current tail (`i18n_participant_chrome_native_review` per [`tasks/35-frontend-i18n.tji:321-326`](../../35-frontend-i18n.tji#L321)). **Action for Closer**: register this as a new WBS leaf in `tasks/35-frontend-i18n.tji` when the task completes, depending on `!i18n_participant_chrome_native_review` to keep the native-review chain linear.
- **The real-WS wiring is not a new leaf.** `participant_ui.part_shell.part_ws_client` already exists as an open WBS leaf (effort 0.5d) with `depends !part_state_management, shell_package.shell_substrate_extraction`. When that leaf lands its wire-up, its closer is responsible for the one-line swap inside `useParticipantConnectionStatus.ts` (and any Playwright e2e migration per Decision §2's risk note). No new leaf is needed; this leaf's tech-debt registration policy is satisfied by pointing at the existing `part_ws_client`.
- **The role-badge / pending-count expansions are not new leaves either.** They live transitively under existing WBS (`part_session_join.part_invite_acceptance` provides the role data; `part_pending_proposals.part_proposals_tab` provides the pending-count source). When either ships, its closer can land the in-chip widget addition; no upfront registration needed.
- **No other follow-ups.** The chip's structure is intentionally narrow so future evolutions are additive, not migrational.

### 7. Test fixture: stub the source hook via `vi.mock`, not via a test-only prop

Two alternatives surveyed for driving the chip through all five states in Vitest:

- **Test-only prop on the chip** (`<ParticipantStatusIndicator overrideStatus={...} />`) — Rejected. Adds a production-facing API knob purely for tests; the chip's React-component contract is meant to be parameter-free (the source is read from the hook). Test-only props are an antipattern when a clean hook-stub alternative exists.
- **`vi.mock('./useParticipantConnectionStatus')`** with per-case `vi.mocked(...).mockReturnValue(state)` (chosen). The test file mocks the hook module once per case; the chip renders against the mocked value with no production API surface change. Matches the moderator's existing test-fixture patterns (see e.g. [`apps/moderator/src/layout/PendingProposalsPane.test.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.test.tsx) where store-state-driven cases use `useWsStore.getState().setConnectionStatus('open')` to drive the source).

The vi.mock approach also means: when Decision §2's future-wiring swap happens (the hook starts reading from `useWsStore`), the test file does NOT change — it still mocks the hook module and the chip still renders against the per-case value. The test surface is stable across the wiring change.

### 8. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0005's Tailwind-with-deferred-tokens; 0022's committed-test discipline; 0024's host-supplied-i18n; 0026's surface-consumes-from-shell).
- A scoped UI policy that doesn't constrain other tasks (Decisions §1, §2, §3, §4, §5, §7).
- A direct consumer of the shell's existing `WsConnectionStatus` type without widening it.

The "no new dependencies" rule is satisfied; the participant `package.json` is unchanged. The "no new shell substrate" rule is honored; the chip is participant-local. The chip's `role="status"` + `aria-live="polite"` ARIA pattern is the canonical WAI-ARIA live-region recipe and needs no project-local rationale.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Persistent connection-status chip landed in the participant footer slot: new `<ParticipantStatusIndicator>` at [`apps/participant/src/layout/ParticipantStatusIndicator.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.tsx) renders the `[dot][label]` row with exhaustive `Record<WsConnectionStatus, ...>` mapping tables (`DOT_CLASSES`, `TONE`, `LABEL_KEY`) and `role="status"` + `aria-live="polite"` ARIA contract per Decisions §3, §4.
- State-source seam isolated at [`apps/participant/src/layout/useParticipantConnectionStatus.ts`](../../../apps/participant/src/layout/useParticipantConnectionStatus.ts) — stubbed to return `'connecting'` (Decision §2's honest sentinel); future swap to `useWsStore((s) => s.connectionStatus)` is a one-line change inside that file when `part_ws_client` lands.
- Footer plug-in landed at the `<PlaceholderRoute>` call site in [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx) — `footer={null}` replaced by `footer={<ParticipantStatusIndicator />}`; every participant route inherits the chip through the shared `<ParticipantLayout>`.
- Vitest pin landed at [`apps/participant/src/layout/ParticipantStatusIndicator.test.tsx`](../../../apps/participant/src/layout/ParticipantStatusIndicator.test.tsx) — 7 cases per Decision §7 (`vi.mock('./useParticipantConnectionStatus')` per state) covering all five `WsConnectionStatus` arms + the ARIA contract + `aria-hidden` on the decorative dot.
- Existing pins extended without scenario inflation: [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) gains the chip-visible-with-`data-status="connecting"` assertion in the authenticated case; [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) replaces the prior `toBeEmpty()` footer assertion with chip-visible + `data-status` + en-US-label assertions in the first scenario only.
- Five new ICU-free `participant.statusIndicator.*` keys (one per WsConnectionStatus arm) added to all three locale catalogs in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR + es-419 drafts flagged PENDING in the matching `*.review.json` trackers per Decision §6.
- Tech-debt follow-up registered: `frontend_i18n.i18n_participant_status_indicator_native_review` (0.25d) added to [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) chained after `i18n_participant_chrome_native_review`.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 3445 passing (+7 from 3438); `pnpm -F @a-conversa/participant build` green; `pnpm --filter @a-conversa/i18n-catalogs run check` green; `pnpm run test:e2e --project=chromium-participant-skeleton` 4/4 under the compose stack.
