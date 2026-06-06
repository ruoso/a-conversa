# Moderator proposal-selection model + `Cmd/Ctrl+Shift+Enter` commit-of-selected chord

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord`.

```
task mod_keyboard_shortcuts "Keyboard shortcuts" {
  depends !mod_capture_flow, !mod_decompose_flow, !mod_diagnostic_flow, !mod_snapshot_flow, root_app.root_moderator_cutover
  task mod_proposal_selection_commit_chord "Proposal-selection model + Cmd/Ctrl+Shift+Enter commit-of-selected chord" {
    effort 1.5d
    allocate team
    depends !mod_global_keymap, moderator_ui.mod_pending_proposals_pane
  }
}
```

## Effort estimate

**1.5d.** Confirmed. The wire contract, the commit gate, the per-row commit dispatch, and the dispatcher seam all already exist — this task adds (a) a small selection-model store slice, (b) a click-to-select affordance + selected-state styling on the pending-proposals rows, (c) a thin React-bound bridge hook that registers an imperative "commit the selected proposal" callback into a module store, (d) one new branch in the existing `useGlobalKeymap` dispatcher that invokes that callback on the commit chord, (e) the registry flip `reachable: false → true`, and (f) the Playwright spec that the predecessor deferred. No new wire format, no projector change, no new dependency. The 0.5d over the snapshot-consolidation baseline is the selection model + the e2e seeding.

## Inherited dependencies

Settled (this task builds on finished seams; it changes no wire contract):

- **`moderator_ui.mod_keyboard_shortcuts.mod_global_keymap`** (done — 2026-06-06, [`mod_global_keymap.md`](mod_global_keymap.md)). The direct source of this task. It shipped:
  - the declarative registry [`apps/moderator/src/layout/globalKeymap.ts`](../../../apps/moderator/src/layout/globalKeymap.ts) with the commit entry already declared but flagged unreachable (`id: 'action.commit'`, `chord: { key: 'enter', platformModifier: true, shift: true }`, `reachable: false` — L117-126);
  - the unified document-level dispatcher [`apps/moderator/src/layout/useGlobalKeymap.ts`](../../../apps/moderator/src/layout/useGlobalKeymap.ts) with the explicit seam comment "the commit chord (`Cmd/Ctrl+Shift+Enter`) plugs in here once `mod_proposal_selection_commit_chord` ships the proposal-selection model" (~L91-95) and the `isMacPlatform()` platform-modifier helper (L50-55);
  - the deferred-e2e debt this task pays down (its Acceptance criteria §"Commit-chord e2e is deferred" names *this* task as the owner of the Playwright spec) and the interim Vitest no-op pin (`useGlobalKeymap.test.tsx` case `(i)`) this task converts from a no-op assertion into an invokes-the-handler assertion.
  Its Decision §5 is the binding rationale: commit targets the *currently-selected* proposal and the console had no selection model, so the live binding was deferred rather than shipping a blind global commit.
- **`moderator_ui.mod_pending_proposals_pane`** (parent — done; [tasks/30-moderator-ui.tji:419](../../30-moderator-ui.tji)). Established the pending-proposals sidebar and its rows. The current row component [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) renders one `PendingProposalRow` per derived pending proposal (L830-844), each row a non-interactive `<li>` in v1 with `data-testid="pending-proposal-row"` + `data-proposal-id="<proposalEventId>"` and a per-row `commit-button`. The pane explicitly left row interactivity to siblings (the "No selection / click handler" constraint, ~L39-44) — this task is the sibling that adds it.
- **`moderator_ui.mod_commit_button`** (done — [`mod_commit_button.md`](mod_commit_button.md)). Shipped the per-row commit button + the commit gate. The button calls `useCommitAction(commitTarget)` (`PendingProposalsPane.tsx:365`) and renders `data-commit-state` / `data-commit-gate-reason` driven by `deriveAllAgree(...)`. The chord reuses this exact gate and dispatch path — it is the keyboard equivalent of clicking the selected row's commit button.
- **`per_facet_refactor.moderator_ui.pf_mod_pending_proposals_pane_facet_keyed`** (done — [`pf_mod_pending_proposals_pane_facet_keyed.md`](../per-facet-refactor/pf_mod_pending_proposals_pane_facet_keyed.md), [ADR 0030](../../../docs/adr/0030-per-facet-commit-and-vote.md)). Split the commit envelope into the `target: 'facet' | 'proposal'` discriminated union and rewrote `useCommitAction` to dispatch on the arm. `commitTargetForProposal()` (`PendingProposalsPane.tsx:194-219`) maps a row to its single commit target. The chord reuses `commitTargetForProposal` on the *selected* row — it does not re-derive the arm.
- **`root_app.root_moderator_cutover`** (done). `/sessions/:id/operate` is reachable; `useGlobalKeymap()` and the new bridge hook both mount under `OperateRouteInner`, inside the `<WsClientProvider>`.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — the registry's commit `labelKey` (`moderator.commitButton.label`) already resolves in all three locales; any new selection-affordance aria-label follows the same authored-en + PENDING-pt/es discipline.
- **[ADR 0030 — Per-facet commit and vote](../../../docs/adr/0030-per-facet-commit-and-vote.md)** — the commit envelope's `target` arms; unchanged by this task (the chord sends exactly what the button sends).

Pending edges (this task is a leaf; nothing depends on it today):

- The milestone the predecessor's closer wired this task into — `moderator_ui.mod_keyboard_shortcuts` is depended on by [tasks/99-milestones.tji:101](../../99-milestones.tji); completing this leaf completes the container.

## What this task is

Give the moderator a **selected pending proposal** and make `Cmd/Ctrl+Shift+Enter` commit it. Concretely:

1. **A selection model** — a module-scoped Zustand slice `useSelectedProposalStore` holding `selectedProposalId: string | null` with `select(id)` / `clear()`, mirroring the existing graph `useSelectionStore` idiom ([`apps/moderator/src/stores/selectionStore.ts`](../../../apps/moderator/src/stores/selectionStore.ts)). The id is the row's stable `proposalEventId` (the same value already on `data-proposal-id`).
2. **A row-selection affordance** — clicking a pending-proposal row body selects it (sets the store); the selected row renders a `data-selected="true"` attribute + a selection ring. Clicking the row's existing `commit-button` / `withdraw` / `mark-meta-disagreement` controls keeps doing exactly what it does today (the chord does not change those). Selection is single-select and is cleared when the selected proposal leaves the pending list (committed / withdrawn) or on `Esc` / pane background click.
3. **A React-bound bridge hook** — `useProposalCommitChord()`, mounted once under `OperateRouteInner`, that captures the React-context-only `WsClient` (`useWsClient()`) and `sessionId` (`useParams`) and registers a single stable imperative callback into a module store. When invoked, the callback reads the *current* selected id, events, facet/vote indices, and `expectedSequence` fresh via `getState()`, recomputes the commit gate with the same `deriveAllAgree(...)` the button uses, and — only if the gate is open — dispatches the commit via the shared dispatch core. Gate closed / nothing selected ⇒ no-op.
4. **One dispatcher branch** — `useGlobalKeymap`'s document listener gains the `Cmd/Ctrl+Shift+Enter` match, which calls `useCommitChordStore.getState().run?.()` — symmetric with how it already calls `useSnapshotFlowStore.getState().open()` for `Cmd/Ctrl+S`.
5. **The registry flip** — `globalKeymap.ts`'s `action.commit` entry `reachable: false → true`; the drift-guard test and the dispatcher no-op pin update to match.
6. **The deferred Playwright spec** — select a pending proposal that all participants have agreed → `Cmd/Ctrl+Shift+Enter` → commit fires (row clears); the negative path (not all-agree) → chord no-ops.

The design doc binds the chord to the *selected* proposal in the sidebar "focus mode":

[docs/moderator-ui.md — Keyboard shortcuts (sketch), L207](../../../docs/moderator-ui.md):

> - `Cmd+Shift+Enter` — commit currently-selected proposal (enabled only when all participants vote agree)

[docs/moderator-ui.md — L183](../../../docs/moderator-ui.md):

> The sidebar is the "focus mode" — a consolidated list for working through pending proposals one by one.

## Why it needs to be done

- **The keymap advertises a binding that does nothing.** `mod_global_keymap` registered `action.commit` as `reachable: false` and the keymap-help overlay can already show it as forthcoming. Until this task lands, `Cmd/Ctrl+Shift+Enter` is dead, and the "everything reachable from the keyboard" principle (docs/moderator-ui.md L216) has a hole exactly where the doc is most specific.
- **The predecessor's deferred-e2e debt points here by name.** `mod_global_keymap` Acceptance criteria say the commit-chord Playwright spec "is deferred to `mod_proposal_selection_commit_chord`, which makes the surface reachable and MUST scope the Playwright spec." This task is the wiring task that inherits that debt and pays it down (UI-stream e2e policy: wiring tasks include the deferred scenarios).
- **The sidebar's "work through proposals one by one" UX needs a focus target.** Commit is currently click-only, one button per row. For a moderator running a live session, a keyboard commit of the proposal they're focused on is the difference between mouse-hunting and a fluid keyboard loop — but only once "the proposal they're focused on" is a real, selectable thing.

## Inputs / context

- [docs/moderator-ui.md — L201-216](../../../docs/moderator-ui.md) — the shortcut sketch (commit-selected at L207, "enabled only when all participants vote agree") and the sidebar focus-mode framing (L183).
- [`apps/moderator/src/layout/globalKeymap.ts:117-126`](../../../apps/moderator/src/layout/globalKeymap.ts) — the `action.commit` registry entry (`chord: { key: 'enter', platformModifier: true, shift: true }`, `labelKey: 'moderator.commitButton.label'`, `reachable: false`). This task flips `reachable` to `true`. Types: `Chord` (L43-47), `GlobalShortcut` (L55-61).
- [`apps/moderator/src/layout/useGlobalKeymap.ts`](../../../apps/moderator/src/layout/useGlobalKeymap.ts) — the unified dispatcher: single `document` `keydown` in a `useEffect` (~L57-103), the snapshot branch firing `useSnapshotFlowStore.getState().open()` (~L87-89), `isMacPlatform()` (L50-55), and the commit-chord seam comment (~L91-95) where the new branch lands.
- [`apps/moderator/src/layout/useGlobalKeymap.test.tsx`](../../../apps/moderator/src/layout/useGlobalKeymap.test.tsx) — case `(i)` currently pins `Cmd/Ctrl+Shift+Enter` as a no-op; this task converts it to "invokes the registered commit handler" + "no-op when no handler registered."
- [`apps/moderator/src/layout/globalKeymap.test.ts`](../../../apps/moderator/src/layout/globalKeymap.test.ts) — drift-guard case `(b)` asserts "commit present + NOT reachable"; this task updates it to "present + reachable."
- [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) — rows rendered L830-844; `PendingProposalRow` props L298-308; the per-row commit button `data-testid="commit-button"` / `data-commit-state` / `data-proposal-id` (L487-503) driven by `useCommitAction(commitTarget)` (L365); `commitTargetForProposal()` arm-mapping (L194-219); the "no selection in v1" constraint comment (~L39-44). The `<li>` already carries `data-testid="pending-proposal-row"` + `data-proposal-id`.
- [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts) — `useWsClient()` (import L43, call L213), `useParams` sessionId (L210-211), `expectedSequence` via `useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0` (L246-247), the module-scoped in-flight `useCommitStore` (L100-117), `slotKey()` (L191-196), the `UseCommitActionArgs` facet/proposal union (L159-176), and the `commit()` dispatch body sending the `target`-armed envelope (L206-291). The chord shares this dispatch path.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts) — the commit gate: `deriveAllAgree(entries, currentParticipantIds, proposal?)` (L480-530) returning `CommitGate` (`CommitGate` / `CommitGateReason` L424-439), `deriveCurrentParticipants(events)` excluding the moderator (L548-562), `derivePerProposalFacets(...)` (L290-363). The chord computes the gate with these — no second gate.
- [`apps/moderator/src/stores/selectionStore.ts:20-33`](../../../apps/moderator/src/stores/selectionStore.ts) — `SelectionState` (`selected | null`, `select`, `clear`) wrapped in `withDevtools('moderator/selection', …)`. The template for `useSelectedProposalStore`.
- [`apps/moderator/src/layout/useSnapshotFlowStore.ts:19-40`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts) — the module-scoped store + `getState()` idiom the dispatcher uses for snapshot, and `resetSnapshotFlowStore()` test seam. The template for `useCommitChordStore`'s reset helper.
- [`apps/moderator/src/ws/wsStore.ts:46`](../../../apps/moderator/src/ws/wsStore.ts) — `useWsStore` (`create<BaseWsStoreState>()`); `sessionState[sessionId].events` + `.lastAppliedSequence`, both reachable via `getState()`.
- [`packages/shell/src/ws/WsClientProvider.tsx:150-156`](../../../packages/shell/src/ws/WsClientProvider.tsx) — `useWsClient()` throws if called outside `<WsClientProvider>`; the client is **not** a module singleton. This is the constraint that forces the bridge-hook design (Decision §2).
- [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) — `OperateRoute` reads `useParams` (L113), renders `<OperateRouteInner sessionId={id} />`; `useGlobalKeymap()` is called at route top (~L153). The new `useProposalCommitChord()` mounts alongside it under `OperateRouteInner` (inside the provider).
- [`tests/e2e/full-session-walkthrough.spec.ts`](../../../tests/e2e/full-session-walkthrough.spec.ts) — the all-agree-then-commit harness: `authedContext(browser, username)` three-context setup (moderator + alice + ben), `voteAgreeOnFacet(facetName, expectWording)` (L209-222) iterating participants to `agree`, `commitPendingRowByPrefix(prefix)` locating `[data-testid="commit-button"]` within a row and asserting the row clears (`toHaveCount(0)`, L319-326). The new spec reuses this scaffolding, substituting a row click + keyboard chord for the button click.
- [`tests/e2e/methodology-full-flow.spec.ts:1563,1666`](../../../tests/e2e/methodology-full-flow.spec.ts) — `[data-testid="pending-proposal-row"][data-proposal-id="…"]` addressing; confirms the row testid + `data-proposal-id` contract the spec selects on.
- [`tests/e2e/fixtures/authed-context.ts:48-53`](../../../tests/e2e/fixtures/authed-context.ts) — `authedContext` storage-state auth fixture used by the harness.
- [`tasks/refinements/moderator-ui/mod_global_keymap.md`](mod_global_keymap.md) — the predecessor; the template for shape, the registry/dispatcher idiom, and the deferral being discharged here.

## Constraints / requirements

- **The chord is the keyboard equivalent of the selected row's commit button — same gate, same envelope, same in-flight store.** It MUST commit iff the selected row's `deriveAllAgree(...)` is `{ ok: true }` (i.e. exactly when that row's `commit-button` would be `data-commit-state="enabled"`), and it MUST send the identical `target`-armed envelope `commitTargetForProposal(selectedRow)` produces. No second gate, no duplicated envelope-shaping, no divergence between button and chord behavior.
- **No competing listener; the chord lives in the unified dispatcher.** `useGlobalKeymap` gains exactly one branch matching `(platformModifier, shift, key='enter')`; it does NOT add a second `document` listener. The branch calls `useCommitChordStore.getState().run?.()` and nothing else — all React-bound work stays in the bridge hook.
- **WsClient stays inside React.** `useGlobalKeymap` and its tests MUST NOT gain a `useWsClient()` dependency (the snapshot-only dispatcher tests must keep running without a `<WsClientProvider>`). The client is captured only inside `useProposalCommitChord()` and reaches the dispatcher solely through the registered callback (Decision §2).
- **Selection is a model, not a view artifact.** `selectedProposalId` lives in a module store; filtering/scrolling the pane does not change it. The selected id is cleared when it no longer appears in the derived pending list (committed / withdrawn / superseded) so the chord can never fire against a stale target. `Esc` and a pane-background click also clear it.
- **Selection does not disturb existing row affordances.** Clicking `commit-button`, `withdraw-proposal-button`, or `mark-meta-disagreement-button` must not be swallowed by the row's select handler (the row select fires on the row body, and those controls `stopPropagation` or are excluded). The existing per-row commit-by-click path is unchanged.
- **Single-select.** Selecting a second row replaces the first; there is no multi-select.
- **`event.repeat` bail + `preventDefault()`** on the commit chord match the dispatcher's existing action-chord discipline (held key does not re-fire; the browser does not also act on the chord). No editable-target bail — `Cmd/Ctrl+Shift+Enter` is not a text-editing chord.
- **Registry flip is the only registry change.** `action.commit.reachable: true`; the chord, labelKey, and category are unchanged.
- **No wire-contract change, no projector change, no new broadcast.** The chord sends the existing `commit` envelope (ADR 0030 arms). No Cucumber scenario is warranted — nothing new crosses the protocol or replay boundary; the commit wire path is already pinned by the per-facet refactor's server scenarios.
- **i18n discipline.** If a selection affordance needs an accessible label (e.g. `aria-label` / `aria-selected`), the new key ships authored in `en-US` + PENDING in `pt-BR` / `es-419` (`*.review.json`); `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes. The commit `labelKey` already resolves in all three locales.

## Acceptance criteria

- **Selection store** — new `apps/moderator/src/stores/selectedProposalStore.ts` exports `useSelectedProposalStore` with `selectedProposalId: string | null`, `select(id: string)`, `clear()`, and a `resetSelectedProposalStore()` test seam, wrapped in `withDevtools('moderator/selected-proposal', …)`.
- **Row affordance** — `PendingProposalsPane.tsx` rows are clickable: clicking the row body sets `selectedProposalId`; the selected row renders `data-selected="true"` and a visible selection ring; clicking `commit-button` / `withdraw` / `mark-meta-disagreement` is unaffected. A pane-background click and `Esc` clear the selection; a selected id that leaves the derived pending list is cleared.
- **Bridge hook** — new `apps/moderator/src/layout/useProposalCommitChord.ts` exports `useProposalCommitChord()` (mounted in `OperateRouteInner`) that captures `useWsClient()` + the route `sessionId`, registers a stable callback into a new module store `useCommitChordStore` (`run: (() => void) | null`, `setRun`, plus `resetCommitChordStore()`), and clears the registration on unmount. The callback reads selection + events + `expectedSequence` fresh via `getState()`, computes the gate via `deriveAllAgree(...)`, and dispatches via the shared commit core only when `{ ok: true }`.
- **Shared dispatch core** — the envelope-shaping + in-flight (`useCommitStore`) logic currently inside `useCommitAction.commit()` is extracted to a pure function (e.g. `sendCommit(client, sessionId, expectedSequence, target)`) called by both the row hook and the chord callback, so button and chord cannot drift and share in-flight de-duplication.
- **Dispatcher branch** — `useGlobalKeymap.ts` matches `Cmd/Ctrl+Shift+Enter` (`platformModifier` + `shift` + `key === 'enter'`), calls `preventDefault()`, bails on `event.repeat`, and invokes `useCommitChordStore.getState().run?.()`.
- **Registry flip** — `globalKeymap.ts` `action.commit.reachable` is `true`.
- **Committed Vitest cases** (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/stores/selectedProposalStore.test.ts` — `select` / `clear` / replace-on-reselect / `reset`.
  - Update `apps/moderator/src/layout/globalKeymap.test.ts` — case `(b)` now asserts `action.commit` is present **and reachable**; the chord-distinctness/collision cases (`c`/`d`) still pass with commit reachable.
  - Update `apps/moderator/src/layout/useGlobalKeymap.test.tsx` — case `(i)` converts from no-op to: `(i1)` `Cmd/Ctrl+Shift+Enter` invokes `useCommitChordStore.getState().run` when one is registered (spy fired, `preventDefault` called, `event.repeat` ignored); `(i2)` with no `run` registered it is a safe no-op (no throw); existing snapshot cases `(a)-(h)` remain green with **no `<WsClientProvider>` required**.
  - `apps/moderator/src/layout/useProposalCommitChord.test.tsx` — `(a)` with a selected all-agree proposal, invoking the registered `run` sends the expected `commit` envelope (correct `target` arm) via a fake client; `(b)` gate closed (a participant not-agree / meta-disagreement) ⇒ `run` sends nothing; `(c)` no selection ⇒ no send; `(d)` a stale selection (id absent from pending) ⇒ no send + selection cleared; `(e)` unmount clears the registration (`getState().run === null`).
  - Component test on `PendingProposalsPane` — row click sets `selectedProposalId` + `data-selected`; clicking the commit button does not also toggle selection; pane-background click / `Esc` clears.
- **Playwright spec (the predecessor's deferred debt, paid here)** — new `tests/e2e/moderator-commit-chord.spec.ts` (reusing the `full-session-walkthrough` all-agree scaffolding): a moderator + two participants reach operate; a proposal is captured; both participants vote `agree` (`voteAgreeOnFacet`); the moderator clicks the pending-proposal row (asserts `data-selected="true"`) and presses `Cmd/Ctrl+Shift+Enter`; the row clears (`toHaveCount(0)`) — commit fired via keyboard. Negative beat: with a not-all-agree proposal selected, `Cmd/Ctrl+Shift+Enter` is a no-op (row stays; its `commit-button` is `data-commit-state` not-enabled). This is the user-visible behavior this task adds; it is **in scope, not deferred** (the surface is now reachable).
- **No new deferral / no catch-all debt.** This task introduces no further deferred e2e; it closes the only outstanding commit-chord deferral. Arrow-key roving focus across rows is **not** in scope (Decision §5) and is surfaced to the parking lot, not registered as a WBS task.
- **Native-speaker translation review** of any new pt-BR / es-419 key is human-only — surfaced to the parking lot, not a WBS task.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the closer's `complete 100`.

## Decisions

1. **Selection model = a dedicated module-scoped `useSelectedProposalStore` slice keyed by `proposalEventId`, separate from the graph `useSelectionStore`.**
   - **Why.** It clones the proven `selectionStore.ts` shape (`selected | null` + `select` / `clear` + `withDevtools`), so the dispatcher and the bridge hook can read it via `getState()` exactly like every other action-chord store. Keying on `proposalEventId` reuses the stable id already on `data-proposal-id`, so the row, the store, and the e2e all address proposals by one identifier.
   - **Alternative rejected — overload the existing `useSelectionStore`.** Its `Selection` is `{ kind: EntityKind, id }` for *committed* canvas entities; a pending proposal is an uncommitted event, not a graph node. Sharing the slice would conflate two selection domains (selecting a proposal would clear/cross-highlight a graph entity and vice versa) and force a `kind` discriminator that buys nothing. A separate one-field slice is smaller and has no cross-talk.
   - **Alternative rejected — keep selection as local `useState` in the pane (like the filter state).** The dispatcher and bridge hook live outside the pane and must read the selection via `getState()`; local component state is unreachable from the document listener. A module store is the seam that crosses that boundary.

2. **The chord match lives in the unified `useGlobalKeymap` dispatcher; the WsClient-bound commit work lives in a route-mounted bridge hook that registers an imperative callback into `useCommitChordStore`.**
   - **Why.** `mod_global_keymap` deliberately built one document-level dispatcher as "the home where the commit chord will land," and the snapshot branch already resolves to a module-store `getState().open()`. The commit branch resolves the same way — `getState().run?.()` — so the dispatcher stays a thin, context-free `keydown` router and its snapshot tests keep running with no `<WsClientProvider>`. The one thing that genuinely needs React — the `WsClient`, which `useWsClient()` throws for outside its provider ([WsClientProvider.tsx:150-156](../../../packages/shell/src/ws/WsClientProvider.tsx)) — is captured once inside `useProposalCommitChord()` and reaches the dispatcher only through the registered callback. Everything else the callback needs (selected id, events, `expectedSequence`, facet/vote indices) is already `getState()`-reachable, so the callback registers once (capturing the stable client) and reads volatile state fresh at invocation — no stale closure.
   - **Alternative rejected — give `useGlobalKeymap` a `useWsClient()` dependency and inline the commit.** Couples the whole dispatcher (and its snapshot-only unit tests) to the WS provider for the sake of one branch, forcing every `useGlobalKeymap` test to wrap a fake provider. The bridge keeps that coupling isolated to the one hook that needs it.
   - **Alternative rejected — a second standalone `document` listener for the commit chord.** Directly contradicts the predecessor's unified-dispatcher intent and reintroduces the scattered-listener problem `mod_global_keymap` consolidated. Two action-chord listeners is exactly what that task removed.

3. **Reuse the existing gate and dispatch path; extract a shared `sendCommit` core so the chord and the button cannot diverge.**
   - **Why.** The button's correctness is already proven by `deriveAllAgree` + `commitTargetForProposal` + the per-facet refactor's tests. The chord must be the keyboard alias of that button, so it calls the same gate and the same envelope-shaping. Extracting the envelope/in-flight body of `useCommitAction.commit()` into a pure `sendCommit(client, sessionId, expectedSequence, target)` lets both callers share it — and share the `useCommitStore` in-flight keying, so a chord and a button press for the same target de-duplicate rather than double-send.
   - **Alternative rejected — a chord-specific gate/dispatch.** Two gates drift the instant the commit rules change (per-facet refactor already changed them once). One gate, one dispatch core, two triggers.

4. **Row-selection affordance = click the row body; existing per-row controls are untouched.**
   - **Why.** A click on the row body is the minimal, discoverable way to choose the "focus" proposal the doc describes (L183, "working through pending proposals one by one"); `data-selected="true"` + a ring gives the moderator unambiguous feedback about what the chord will commit. The commit / withdraw / meta-disagreement buttons keep their direct behavior (clicking commit still commits *that* row regardless of selection), so the change is purely additive — it does not reinterpret any existing gesture.
   - **Alternative rejected — make the whole row a commit trigger.** Conflates "focus this proposal" with "commit this proposal" and collides with the explicit per-row controls; selecting to read a row would risk committing it.

5. **No arrow-key roving focus in this task.** Click-to-select plus the chord is a complete, shippable commit-by-keyboard loop and is exactly what the task title scopes ("proposal-selection model + commit chord"). Arrow-key navigation across rows is a separable UX enhancement with no bearing on the commit binding; bolting it on here widens the task past its 1.5d estimate and its title. It is surfaced to the parking lot as optional polish — **not** registered as a WBS task (it has no required deliverable here and would otherwise be speculative scope).

6. **No new ADR.** The selection slice clones the established `selectionStore` pattern; the bridge hook reuses the module-store `getState()` idiom the dispatcher already uses for snapshot; the commit wire path and gate are unchanged (ADR 0030 still governs). No new dependency, no new architectural seam, no security-relevant trade-off. The predecessor's Decision §8 anticipated raising an ADR here "if the selection model warrants one" — a one-field Zustand slice mirroring an existing store does not.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-06.

- `apps/moderator/src/stores/selectedProposalStore.ts` — new Zustand slice `useSelectedProposalStore` (`selectedProposalId: string | null`, `select`, `clear`, `resetSelectedProposalStore`) wrapped in `withDevtools('moderator/selected-proposal', …)`.
- `apps/moderator/src/stores/selectedProposalStore.test.ts` — Vitest cases: select / clear / replace-on-reselect / reset.
- `apps/moderator/src/layout/useCommitChordStore.ts` — new module-scoped store holding the bridge callback (`run: (() => void) | null`, `setRun`, `resetCommitChordStore()`).
- `apps/moderator/src/graph/facetStatusIndex.ts` — shared `deriveFacetStatusIndex` helper used by both `PendingProposalsPane` and `useProposalCommitChord` so facet-status computation cannot drift.
- `apps/moderator/src/layout/useProposalCommitChord.ts` — bridge hook mounted in `OperateRouteInner`; captures `useWsClient()` + `sessionId`, registers the commit callback into `useCommitChordStore`, clears on unmount.
- `apps/moderator/src/layout/useProposalCommitChord.test.tsx` — 5 Vitest cases (a–e): all-agree sends correct envelope; gate-closed no-ops; no selection no-ops; stale id clears selection; unmount clears registration.
- `apps/moderator/src/layout/useCommitAction.ts` — shared `sendCommit(client, sessionId, expectedSequence, target)` core extracted; used by both the row hook and the chord callback.
- `apps/moderator/src/layout/PendingProposalsPane.tsx` — row-click selection + `data-selected="true"` ring; `stopPropagation` on per-row controls; Esc / pane-background-click / stale-id clear; exports `commitTargetForProposal`; uses shared `sendCommit` helper.
- `apps/moderator/src/layout/PendingProposalsPane.test.tsx` — row-selection Vitest cases: click sets `selectedProposalId` + `data-selected`; commit-button click does not toggle selection; pane-background click / Esc clears.
- `apps/moderator/src/layout/useGlobalKeymap.ts` — `Cmd/Ctrl+Shift+Enter` branch added calling `useCommitChordStore.getState().run?.()`.
- `apps/moderator/src/layout/useGlobalKeymap.test.tsx` — case `(i)` converted: `(i1)` invokes registered run; `(i2)` safe no-op without registration.
- `apps/moderator/src/layout/globalKeymap.ts` — `action.commit.reachable: false → true`.
- `apps/moderator/src/layout/globalKeymap.test.ts` — case `(b)` updated to assert `action.commit` is present **and reachable**.
- `apps/moderator/src/routes/Operate.tsx` — mounts `useProposalCommitChord()` under `OperateRouteInner`.
- `tests/e2e/moderator-commit-chord.spec.ts` — Playwright spec: positive (all-agree row click + chord → row clears); negative (not-all-agree → chord no-ops).
- `tests/e2e/moderator-keymap-help.spec.ts` — updated: commit entry is now reachable; mode-row dimmed-exemplar assertions updated.
