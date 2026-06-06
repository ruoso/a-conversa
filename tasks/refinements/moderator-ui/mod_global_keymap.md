# Moderator global keymap — a single declarative shortcut registry + a unified action-chord dispatcher (kind shortcuts, propose, commit, snapshot, esc)

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_keyboard_shortcuts.mod_global_keymap`.

```
task mod_keyboard_shortcuts "Keyboard shortcuts" {
  depends !mod_capture_flow, !mod_decompose_flow, !mod_diagnostic_flow, !mod_snapshot_flow, root_app.root_moderator_cutover
  task mod_global_keymap "Global keymap — kind shortcuts, propose, commit, snapshot, esc" {
    effort 1d
    allocate team
  }
  task mod_keymap_help_overlay "Keymap help overlay" {
    effort 0.5d
    allocate team
    depends !mod_global_keymap
  }
}
```

## Effort estimate

**1d.** Confirmed. Most of the moderator's keyboard bindings already exist — they landed piecemeal across the capture / decompose / diagnostic / snapshot flows. This task is not "build the shortcuts"; it is **assemble the scattered bindings into one introspectable, testable, documented whole** and add the one missing piece's infrastructure. The deliverable is:

1. A declarative registry module `apps/moderator/src/layout/globalKeymap.ts` (~120 lines) — the single source of truth enumerating every moderator shortcut as structured data, derived (not duplicated) from the existing shortcut tables in [`packages/i18n-catalogs/src/keyboard-shortcuts.ts`](../../../packages/i18n-catalogs/src/keyboard-shortcuts.ts). This is what `mod_keymap_help_overlay` (the dependent sibling) renders.
2. A single document-level dispatcher hook `apps/moderator/src/layout/useGlobalKeymap.ts` (~60 lines) mounted once at `OperateRoute`, consolidating the **action-chord class** of shortcuts — it absorbs `useSnapshotShortcut`'s `Cmd/Ctrl+S` binding and is the home where the (deferred) commit chord will land.
3. The composition swap in `apps/moderator/src/routes/Operate.tsx` (`useSnapshotShortcut()` → `useGlobalKeymap()`) and retirement of the now-folded-in `useSnapshotShortcut.ts`.
4. A small i18n addition (the action/navigation **label** keys the registry references that don't already exist) and the colocated Vitest + a Playwright regression-pin extension.

The genuinely new live binding — `Cmd/Ctrl+Shift+Enter` to commit the currently-selected proposal — is **deferred** (Decision §5): it requires a proposal-selection model that does not exist yet. This task registers the commit entry (flagged unreachable) and names the concrete follow-up; it does not ship a blind global commit handler.

## Inherited dependencies

Settled (this task consolidates pre-existing seams; it does not change any wire contract):

- **`moderator_ui.mod_capture_flow`** (parent — done across many subtasks). Established the bottom-strip capture pane and the shared keymap seam [`apps/moderator/src/layout/captureKeymap.ts`](../../../apps/moderator/src/layout/captureKeymap.ts) — `attachCaptureKeymap(handlers)` with the modifier-bail / repeat-skip / editable-target-bail / case-insensitive-match contract. The single-letter kind shortcuts (`f`/`p`/`v`/`n`/`d`) are wired by [`apps/moderator/src/layout/ClassificationPalette.tsx:96`](../../../apps/moderator/src/layout/ClassificationPalette.tsx); the edge-role (`s`/`r`/`q`/`b`/`g`/`e`/`x`), meta-move-kind (`m`/`c`/`t`), and `Esc` consumers are wired by their own bottom-strip components (see Inputs).
- **`moderator_ui.mod_capture_flow.mod_propose_action`** (done). The `Cmd/Ctrl+Enter` propose chord is a React `onKeyDown` on the wording textarea itself ([`apps/moderator/src/layout/CaptureTextInput.tsx:117-123`](../../../apps/moderator/src/layout/CaptureTextInput.tsx)) — deliberately textarea-scoped (you must be composing to propose). Decision §4 records why this task does NOT lift it into the global dispatcher.
- **`moderator_ui.mod_decompose_flow`** (done). Established the capture-pane *mode* concept (`decompose` / `interpretive-split` / `operationalization` / `warrant-elicitation` / `capture-defeater` / `meta-move`) and the mode-aware `Esc` priority recorded in [`captureKeymap.ts:307-329`](../../../apps/moderator/src/layout/captureKeymap.ts) (exit-mode when in a mode, else clear-target).
- **`moderator_ui.mod_diagnostic_flow`** (done). No keyboard surface of its own that this task consolidates; listed because the parent `mod_keyboard_shortcuts` depends on it (the diagnostic flow must be reachable on the operate route before the keymap that drives the whole console lands).
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_action`** (done — 2026-05-31, [`mod_snapshot_action.md`](mod_snapshot_action.md)). Shipped [`apps/moderator/src/layout/useSnapshotShortcut.ts`](../../../apps/moderator/src/layout/useSnapshotShortcut.ts) (document-level `Cmd/Ctrl+S` → `useSnapshotFlowStore.getState().open()`) and the `isMacPlatform()` platform-detection helper. Its Decision §4.d explicitly hands the `Cmd/Ctrl+S` binding to THIS task to lift into the unified dispatcher and promises the hook is "a thin attach/detach + dispatch shim" so the consolidation "can rewrite the listener wiring without touching the store or the button." This task makes good on that promise.
- **`root_app.root_moderator_cutover`** (done). The `/sessions/:id/operate` route is reachable through the shell; mounting the dispatcher at `OperateRoute` scope guarantees the keymap is bound exactly when the moderator is operating a session.
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — [`i18n_keyboard_shortcuts_policy.md`](../frontend-i18n/i18n_keyboard_shortcuts_policy.md)). The english-mnemonic / locale-independent shortcut policy and the canonical `KIND_TO_SHORTCUT` / `EDGE_ROLE_TO_SHORTCUT` / `META_MOVE_KIND_TO_SHORTCUT` tables + `buildShortcutMatrix()`. The policy module states (lines 36-38) that "non-classification / non-role shortcuts (commit, snapshot, esc, etc.) … live with the moderator UI's own keymap definition" — that definition is precisely the registry this task builds.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — the english-mnemonic shortcut policy lives in this ADR's Consequences; the registry's `labelKey` indirection (chord shown beside a *localized* term/action label) is the mechanism it prescribes.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_keyboard_shortcuts.mod_keymap_help_overlay`** (downstream — depends on `!mod_global_keymap`, [tasks/30-moderator-ui.tji:704-708](../../30-moderator-ui.tji)). Reads the `GLOBAL_KEYMAP` registry this task ships and renders `<chord> : <localized label>` per the policy doc. The overlay owns its own presentational copy ("Press the shortcut to…"); the registry owns the structured chord + the `labelKey` pointer.
- **`moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord`** (NEW — registered by this task; see Decision §5 + Acceptance criteria). The live `Cmd/Ctrl+Shift+Enter` commit chord + the proposal-selection model it requires. The closer registers it in the WBS under `mod_keyboard_shortcuts` and wires it into the milestone at [tasks/99-milestones.tji:101](../../99-milestones.tji) that already depends on `moderator_ui.mod_keyboard_shortcuts`.

## What this task is

Turn the moderator's keyboard surface — today a set of bindings scattered across ~7 independent `attachCaptureKeymap` consumers plus the standalone `useSnapshotShortcut` and the textarea-local propose chord — into a coherent **global keymap**: one declarative registry that names every shortcut, and one unified dispatcher for the cross-cutting action chords. The five categories the task title enumerates map to the registry as:

- **kind shortcuts** (`f`/`p`/`v`/`n`/`d`) — already live (ClassificationPalette); *registered*, derived from `KIND_TO_SHORTCUT`.
- **propose** (`Cmd/Ctrl+Enter`) — already live (textarea-scoped); *registered*, dispatcher does not duplicate it (Decision §4).
- **commit** (`Cmd/Ctrl+Shift+Enter`) — *registered but not yet reachable*; live binding deferred to `mod_proposal_selection_commit_chord` (Decision §5).
- **snapshot** (`Cmd/Ctrl+S`) — already live; *consolidated* into the new dispatcher (folds in `useSnapshotShortcut`).
- **esc** (exit-mode / clear-target) — already live (captureKeymap mode-aware branch); *registered*; the per-component listeners stay (Decision §6).

The reference for the full intended set is the design doc's keyboard sketch:

[docs/moderator-ui.md — Keyboard shortcuts (sketch), lines 201–216](../../../docs/moderator-ui.md):

> - `f` / `p` / `v` / `n` / `d` — propose classification (fact / predictive / value / normative / definitional)
> - `Cmd+Enter` — propose (commit the current capture as a proposal on the graph)
> - `Cmd+Shift+Enter` — commit currently-selected proposal (enabled only when all participants vote agree)
> - `Cmd+D` — decompose selected node
> - `Cmd+W` — elicit warrant
> - `Cmd+O` — operationalization test
> - `Cmd+S` — snapshot
> - `Esc` — exit current mode, return to default
>
> Specific bindings defer to UI prototyping. The principle is "everything reachable from the keyboard."

Note the task title scopes this leaf to **kind / propose / commit / snapshot / esc**; the mode-entry chords (`Cmd+D`/`Cmd+W`/`Cmd+O`) are NOT in this task's title and are not live today (the modes are entered via context menu / buttons). They are registered as `category: 'mode'`, `reachable: false` entries for completeness so the help overlay can show the planned set, and their live bindings remain future work outside this leaf (Decision §7).

Concretely the deliverable is:

- **One new registry module**: `apps/moderator/src/layout/globalKeymap.ts`. Exports an ordered `GLOBAL_KEYMAP: readonly GlobalShortcut[]` plus the `GlobalShortcut` / `Chord` types. Shape:

  ```ts
  type Chord = {
    // The base key, lowercased ('f', 'enter', 'escape', 's'); matched
    // against event.key.toLowerCase().
    key: string;
    // Modifier requirements. 'platform' means metaKey on macOS, ctrlKey
    // elsewhere (the Cmd/Ctrl chord family); true/false/absent are exact.
    platformModifier?: boolean;
    shift?: boolean;
  };
  type GlobalShortcut = {
    id: string;                 // stable, e.g. 'action.snapshot', 'kind.fact'
    category: 'kind' | 'edge-role' | 'meta-move-kind' | 'mode' | 'action' | 'navigation';
    chord: Chord;
    labelKey: string;           // i18n key for the localized term/action label
    reachable: boolean;         // false → declared but no live binding yet
  };
  ```

  The `kind` / `edge-role` / `meta-move-kind` entries are **generated** by iterating `KIND_TO_SHORTCUT` / `EDGE_ROLE_TO_SHORTCUT` / `META_MOVE_KIND_TO_SHORTCUT` so the registry cannot drift from the methodology tables (Decision §2). The `action` / `navigation` / `mode` entries (propose, commit, snapshot, esc, decompose/warrant/operationalization) are declared literally with their chords and `reachable` flags.

- **One new dispatcher hook**: `apps/moderator/src/layout/useGlobalKeymap.ts`. A `useEffect`-mounted single `document`-level `keydown` listener that owns the **action-chord class only**: `Cmd/Ctrl+S` → `useSnapshotFlowStore.getState().open()` (lifted verbatim from `useSnapshotShortcut`, including `preventDefault()`, `event.repeat` bail, NO editable-target bail, and `isMacPlatform()`-based modifier selection). It is the seam the deferred commit chord plugs into later. Detaches on unmount. Returns nothing.

- **One consolidation**: delete `apps/moderator/src/layout/useSnapshotShortcut.ts` (its `isMacPlatform()` helper moves to `useGlobalKeymap.ts` or a small shared `platform.ts`; keep it exported for test visibility). Update `apps/moderator/src/routes/Operate.tsx` to call `useGlobalKeymap()` where it called `useSnapshotShortcut()`.

- **i18n keys** in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — only the registry `labelKey` targets that do not already exist. The kind / role / meta-move labels already exist (`methodology.kind.<id>` etc.); `moderator.snapshotAction.label` and `moderator.proposeAction.label` and `moderator.commitButton.label` already exist. The genuinely-new key is the navigation label for `Esc`: `moderator.globalKeymap.escLabel` (en-US "Exit mode / clear target"; pt-BR / es-419 PENDING in `*.review.json`). If a mode-entry label is needed and no methodology key fits, add `moderator.globalKeymap.<mode>Label` likewise.

## Why it needs to be done

- **`mod_keymap_help_overlay` is blocked on a single source of truth.** The overlay must render the moderator's complete shortcut list with localized labels. Without the registry it would have to re-scrape bindings from ~9 separate listener call sites and hardcode the chord strings — guaranteeing drift the moment any shortcut changes. The policy doc (lines 31-38) already anticipates "the moderator UI's own keymap definition" as the home for the non-methodology shortcuts; this task is that home.
- **The snapshot binding was shipped on the explicit promise of consolidation.** `mod_snapshot_action` Decision §4.d and the `useSnapshotShortcut.ts` header (lines 35-40) both state the hook exists in its small self-contained form *so that this task can lift it into the unified dispatcher*. Leaving it unconsolidated would leave that promise unkept and the "global keymap" a misnomer.
- **The commit shortcut named in the design doc has never had a home.** `mod_commit_button` deliberately deferred a keyboard shortcut (commit is click-only today). The design doc says `Cmd+Shift+Enter` commits the *currently-selected* proposal — which needs a selection model the console does not have. This task makes the gap explicit and concrete (Decision §5) rather than leaving it implicit in a sketch.

## Inputs / context

- [docs/moderator-ui.md — Keyboard shortcuts (sketch), lines 201–223](../../../docs/moderator-ui.md) — the canonical shortcut set + the english-mnemonic locale-independence statement + the `<KEY>: <localized label>` overlay contract.
- [docs/moderator-ui.md — F-flows, lines 47–162](../../../docs/moderator-ui.md) — the actions the chords drive (propose at L47, commit at L49, decompose at L64, snapshot at L160). Confirms commit targets a *selected* proposal row in the pending-proposals pane (L183: "The graph view is the operator's 'ambient awareness' mode … The sidebar is the 'focus mode' — a consolidated list for working through pending proposals one by one").
- [`packages/i18n-catalogs/src/keyboard-shortcuts.ts`](../../../packages/i18n-catalogs/src/keyboard-shortcuts.ts) — `KIND_TO_SHORTCUT` (L70-76), `EDGE_ROLE_TO_SHORTCUT` (L156-164), `META_MOVE_KIND_TO_SHORTCUT` (L222-226), `buildShortcutMatrix()` (L265-287), and the `KEYBOARD_SHORTCUT_POLICY = 'english-mnemonic'` constant (L85). The registry imports these tables directly — they are the source of truth for the single-letter entries.
- [`apps/moderator/src/layout/captureKeymap.ts`](../../../apps/moderator/src/layout/captureKeymap.ts) — `attachCaptureKeymap(handlers)` (L213-336) and the `CaptureKeymapHandlers` interface (L71-141). The single-letter + `Esc` listeners that stay component-owned (Decision §6). The mode-aware `Esc` branch (L307-329) is the behavior the `navigation` registry entry documents.
- [`apps/moderator/src/layout/useSnapshotShortcut.ts`](../../../apps/moderator/src/layout/useSnapshotShortcut.ts) — the `Cmd/Ctrl+S` hook (L61-99) being folded in; `isMacPlatform()` (L54-59) being preserved. Its header (L35-40) is the consolidation hand-off.
- [`apps/moderator/src/layout/CaptureTextInput.tsx:117-123`](../../../apps/moderator/src/layout/CaptureTextInput.tsx) — the textarea-local `Cmd/Ctrl+Enter` propose handler that stays where it is (Decision §4).
- [`apps/moderator/src/routes/Operate.tsx:153,204-210`](../../../apps/moderator/src/routes/Operate.tsx) — `useSnapshotShortcut()` is called at route top (L153) and an `attachCaptureKeymap({ onEnterMetaMove })` is mounted in a `useEffect` (L205). This task replaces the `useSnapshotShortcut()` call with `useGlobalKeymap()`; the F8 meta-move `attachCaptureKeymap` mount stays (Decision §6).
- The component-owned `attachCaptureKeymap` consumers that stay (Decision §6): [`ClassificationPalette.tsx:96`](../../../apps/moderator/src/layout/ClassificationPalette.tsx), [`EdgeRoleSelector.tsx:108`](../../../apps/moderator/src/layout/EdgeRoleSelector.tsx), [`MetaMoveKindSelector.tsx:99`](../../../apps/moderator/src/layout/MetaMoveKindSelector.tsx), [`CaptureTargetChip.tsx:194`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx), [`ProposalModeExitAffordance.tsx:174`](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx), [`MetaMoveModeExitButton.tsx:38`](../../../apps/moderator/src/layout/MetaMoveModeExitButton.tsx).
- [`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts) — the existing snapshot e2e carrier (`Cmd/Ctrl+S` flips `data-snapshot-flow-open`). This task's regression pin extends/keeps it green after the consolidation (Acceptance criteria).
- [`tasks/refinements/moderator-ui/mod_snapshot_action.md`](mod_snapshot_action.md) — the most recent keymap-adjacent refinement; the template for shape, depth, test discipline, and the module-scoped-store idiom.

## Constraints / requirements

- **One registry, no duplication of the methodology tables.** `globalKeymap.ts` generates its `kind` / `edge-role` / `meta-move-kind` entries by iterating the imported `*_TO_SHORTCUT` tables. A Vitest test asserts the generated entries' keys equal the table contents exactly, so a future edit to a table flows into the registry (and the help overlay) automatically.
- **Chord collision-freedom is regression-locked.** The single-letter tables are already proven disjoint (`keyboard-shortcuts.test.ts`). This task adds a test asserting the `action` / `navigation` chords are mutually distinct as `(platformModifier, shift, key)` triples and do not collide with the single-letter set under the dispatcher's matching rules.
- **The dispatcher is a single listener, mounted once at `OperateRoute`.** Strict-mode double-mount safe (attach/detach pairs cleanly). Detaches when the route unmounts, returning `Cmd/Ctrl+S` to the browser default elsewhere in the shell. This preserves `useSnapshotShortcut`'s exact lifecycle.
- **Snapshot binding behavior is preserved byte-for-byte.** `Cmd/Ctrl+S` still: requires the platform modifier (`metaKey` on macOS, `ctrlKey` otherwise; rejects the wrong-platform modifier and `altKey`), allows `shift`, matches `event.key.toLowerCase() === 's'`, calls `preventDefault()` to swallow the save dialog, bails on `event.repeat`, does NOT bail on editable-target. The consolidation is a code-location change, not a behavior change.
- **No competing propose chord.** The dispatcher does NOT bind `Cmd/Ctrl+Enter`; the textarea handler keeps ownership (Decision §4). The registry's propose entry is `reachable: true` (it works today) but the dispatcher does not handle it.
- **Commit is declared, not handled.** The registry's commit entry is `reachable: false`; the dispatcher contains no commit handler. No `Cmd/Ctrl+Shift+Enter` keystroke does anything until `mod_proposal_selection_commit_chord` lands.
- **The single-letter + capture-pane `Esc` listeners are NOT removed.** They keep their component-local visibility gates and store-slice refs (Decision §6). The registry documents them; the dispatcher does not duplicate them.
- **`labelKey` indirection, locale-independent chords.** Per the policy doc, the chord glyphs (`Cmd/Ctrl+S`, `Esc`, `f`) are locale-independent strings the help overlay composes; the registry stores only the structured chord + a `labelKey` pointing at the *localized* term/action label. No chord string is translated.
- **i18n discipline.** Any new key ships in en-US (authored) + pt-BR / es-419 (`*.review.json` PENDING). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes.
- **No WS send, no projection read, no wire-contract change** from this task. It is pure frontend re-organization plus a data table. No Cucumber scenario is warranted (nothing crosses the protocol or replay boundary).

## Acceptance criteria

- New `apps/moderator/src/layout/globalKeymap.ts` exports `GLOBAL_KEYMAP` (ordered `readonly GlobalShortcut[]`) plus the `GlobalShortcut` / `Chord` types. It contains: the 5 `kind` entries, 7 `edge-role` entries, 3 `meta-move-kind` entries (all generated from the shortcut tables), the `action` entries propose (`reachable: true`) / snapshot (`reachable: true`) / commit (`reachable: false`), the `navigation` entry esc (`reachable: true`), and the `mode` entries decompose / warrant-elicitation / operationalization (`reachable: false`).
- New `apps/moderator/src/layout/useGlobalKeymap.ts` mounts a single `document`-level `keydown` listener that fires `useSnapshotFlowStore.getState().open()` on `Cmd/Ctrl+S` with the exact bail rules listed under Constraints, and detaches on unmount.
- `apps/moderator/src/layout/useSnapshotShortcut.ts` is deleted; `isMacPlatform()` survives (re-homed and still exported for tests).
- `apps/moderator/src/routes/Operate.tsx` calls `useGlobalKeymap()` in place of `useSnapshotShortcut()`; the F8 `attachCaptureKeymap` mount is untouched.
- Committed Vitest cases (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/layout/globalKeymap.test.ts` — `(a)` every `kind` registry entry's key matches `KIND_TO_SHORTCUT`; same for `edge-role` vs `EDGE_ROLE_TO_SHORTCUT` and `meta-move-kind` vs `META_MOVE_KIND_TO_SHORTCUT` (drift guard); `(b)` the registry contains exactly the expected ids (snapshot present + reachable, propose present + reachable, commit present + NOT reachable, esc present + reachable); `(c)` all `action`/`navigation`/`mode` chords are mutually distinct `(platformModifier, shift, key)` triples; `(d)` no `action`/`navigation` chord key collides with a single-letter shortcut key under the matching rules; `(e)` every entry's `labelKey` resolves to a non-empty string in all three locales.
  - `apps/moderator/src/layout/useGlobalKeymap.test.ts` — the snapshot-binding cases migrated from the retired `useSnapshotShortcut.test.tsx`: `(a)` `Cmd+S` (macOS-shaped) fires `open()`; `(b)` `Ctrl+S` (non-macOS-shaped) fires `open()`; `(c)` bare `s` does not; `(d)` `Cmd+Shift+S` still fires (shift allowed); `(e)` `preventDefault()` invoked on match; `(f)` `event.repeat` ignored; `(g)` detaches on unmount; `(h)` editable-target focus does NOT bail; `(i)` `Cmd/Ctrl+Shift+Enter` (commit chord) is a no-op in this task (no handler) — pins the deferral so the follow-up's first commit test fails-first against a real gap.
  - Update to `apps/moderator/src/routes/Operate.test.tsx` — the route mounts `useGlobalKeymap` and `Cmd/Ctrl+S` still flips `data-snapshot-flow-open` (the existing snapshot-trigger route case keeps passing through the renamed hook).
- **Playwright regression pin** — extend (do not replace) [`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts): the existing `Cmd/Ctrl+S → data-snapshot-flow-open="true"` test must remain green after the consolidation. This is the e2e for the only user-visible *behavior change* this task makes (the dispatcher swap). No new spec is required because the registry's rendered surface is the help overlay's concern (`mod_keymap_help_overlay` scopes that e2e) and the kind / esc bindings are already exercised by the capture-flow specs.
- **Commit-chord e2e is deferred — surface not yet reachable.** There is no selected-proposal affordance to drive, so a `Cmd/Ctrl+Shift+Enter` e2e cannot exist yet. It is deferred to `mod_proposal_selection_commit_chord`, which makes the surface reachable and MUST scope the Playwright spec (select a proposal → `Cmd/Ctrl+Shift+Enter` → commit fires when all-agree, no-op otherwise). Vitest case `(i)` above is the interim pin. (Only this one future task inherits the deferral — no catch-all debt pile-up.)
- **New follow-up task registered**: `moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord` — "Proposal-selection model + `Cmd/Ctrl+Shift+Enter` commit-of-selected chord", effort **1.5d**, depends `!mod_global_keymap` and `moderator_ui.mod_pending_proposals_pane`. Deliverable: a selected-proposal store slice + row-selection affordance on the pending-proposals pane, the dispatcher's commit handler (commits the selected proposal when its commit gate is open; no-op otherwise), the registry flip to `reachable: true`, and the deferred Playwright spec. (Closer registers in the WBS under `mod_keyboard_shortcuts` and wires it into the milestone at [tasks/99-milestones.tji:101](../../99-milestones.tji).)
- **Native-speaker translation review** of any new pt-BR / es-419 keys is human-only work — surfaced to the parking lot, not a WBS task.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

1. **Centerpiece = a declarative `GLOBAL_KEYMAP` registry (data), not a behavioral mega-refactor.**
   - **Why.** Most bindings already work; the missing thing is a single, introspectable description of them for the help overlay (the dependent sibling) and for the human reading the keymap. A data table is the smallest abstraction that has exactly one or two call sites today (the overlay + the dispatcher) and pins observable structure via tests. It matches the policy module's stated intent ("the moderator UI's own keymap definition").
   - **Alternative rejected — let `mod_keymap_help_overlay` scrape/hardcode the bindings.** Guarantees drift: a shortcut change in any of ~9 listeners would silently diverge from the overlay. The registry + the drift-guard test make divergence a failing test.
   - **Alternative rejected — extend `buildShortcutMatrix()` in the i18n package to carry the action/navigation chords.** That module is locale × methodology-term; the action chords (propose/commit/snapshot/esc) are moderator-app concerns, not i18n-catalog concerns. Keeping the moderator keymap in the moderator app honors the package boundary the policy doc draws (L36-38).

2. **The single-letter entries are generated from the existing tables, not duplicated.**
   - **Why.** `KIND_TO_SHORTCUT` et al. are the source of truth and are already collision-locked. Generating the registry's `kind`/`edge-role`/`meta-move-kind` rows by iterating them means the registry cannot drift; the drift-guard test asserts equality. Duplicating the letters into the registry would create a second source of truth to keep in sync.

3. **Chords are stored structurally with a `platformModifier` flag; the help overlay composes the glyphs.**
   - **Why.** The `Cmd`-vs-`Ctrl` choice is platform-dependent and the policy is "locale-independent chord, localized label." Storing `{ key, platformModifier, shift }` lets the dispatcher match correctly on either platform and lets the overlay render `Cmd/Ctrl+S` (or platform-specific glyphs) without the registry hardcoding a display string. The `labelKey` points at the localized term/action so the overlay shows `Cmd/Ctrl+S : Snapshot` / `… : Instantâneo`.
   - **Alternative rejected — store a prebaked display string per chord.** Would bake platform + locale assumptions into the data and force the overlay to re-parse them. Structured chord + labelKey keeps presentation in the presentational layer.

4. **Propose (`Cmd/Ctrl+Enter`) stays textarea-owned; the dispatcher does not bind it.**
   - **Why.** Proposing requires composed text, which requires textarea focus — so a *focused-element* handler is the correct scope, exactly as `mod_propose_action` shipped it. A document-level propose chord would either double-fire with the textarea handler or need the textarea handler removed (a larger, riskier change with no UX benefit — you cannot propose without focusing the textarea to type anyway). The registry declares propose as `reachable: true` and the overlay lists it; the binding's *home* is unchanged.
   - **Alternative rejected — lift propose into the dispatcher and drop the textarea handler.** Adds a global listener that must NOT bail on editable-target (so it fires while typing), then must special-case "only when the capture textarea is focused" — reconstructing the textarea handler at the document level for no gain.

5. **Commit (`Cmd/Ctrl+Shift+Enter`) is registered but deferred — it needs a proposal-selection model that does not exist.**
   - **Why.** The design doc binds commit to the *currently-selected* proposal (L207). The console has no selected-proposal concept (`grep` for `selectedProposal` / `focusedProposal` / roving focus returns nothing) and `mod_commit_button` deliberately shipped commit as click-only, one button per row. A blind global commit chord would have no defensible target — committing "the top one" or "the only one" invents semantics the doc does not endorse and would be wrong when multiple proposals are pending. The honest move is to register the binding (so the keymap is complete and the overlay can show it as forthcoming via `reachable: false`) and carve the selection model + live handler into a concrete follow-up. This is genuine agent-implementable work (a store slice, a row-selection affordance, a dispatcher handler, an e2e), not an "audit/revisit" task.
   - **Alternative rejected — ship `Cmd/Ctrl+Shift+Enter` commits the sole pending proposal, no-op otherwise.** Surprising and inconsistent (works with one row, silently dead with two), and diverges from the doc's "selected proposal" model. Better to wait for the selection model than to ship a chord whose behavior the moderator cannot predict.
   - **Alternative rejected — defer the entire commit entry (omit from the registry).** The keymap would then be silently incomplete and the help overlay could never advertise the planned binding. `reachable: false` lets the overlay choose to show it as "coming soon" or hide it, while keeping the registry honest about the full design.

6. **The single-letter + capture-pane `Esc` listeners stay component-owned; this task does not lift all ~7 `attachCaptureKeymap` consumers into the dispatcher.**
   - **Why.** Each consumer carries component-local state (visibility gates like `targetEntityId !== null`, store-slice refs, the re-press-no-op asymmetry) inside its handler closure. The shared `attachCaptureKeymap` already gives them a uniform bail contract, the shortcut tables are disjoint, and multiple `document` listeners do not conflict (each returns early on no-match). Lifting all of them into one dispatcher — rethreading every component's local gate through a central handler — is a multi-component refactor with real regression surface that does not fit a 1d task, and buys little: the bindings already work. The known cosmetic wart (two listeners both reacting to `Esc` — `onClearTarget` after `onExitMode`) is benign today, because entering a mode already clears the staged target, so the second handler is a no-op (documented in [`captureKeymap.ts:288-294`](../../../apps/moderator/src/layout/captureKeymap.ts)). "esc" is delivered by this task as a *registered, overlay-visible* binding backed by the existing handlers — not as a rewrite.
   - **Alternative rejected — full single-dispatcher consolidation now.** The strongest reading of `mod_snapshot_action` Decision §4.d ("lift all listeners"), but it overflows 1d and risks regressing six working capture surfaces for an internal-tidiness gain. The *action-chord* consolidation (snapshot, the genuinely cross-cutting document-scoped chords) is the part that pays for itself and is what this task does. Whether to later fold the single-letter listeners into the dispatcher is an optional cleanup, surfaced to the parking lot — not registered as a WBS task (it has no user-observable deliverable and risks the self-perpetuating "refactor X" loop).

7. **Mode-entry chords (`Cmd+D`/`Cmd+W`/`Cmd+O`) are registered `reachable: false`, not bound here.**
   - **Why.** They are absent from this leaf's title (which lists only kind / propose / commit / snapshot / esc) and are not live today (modes are entered via context menu / buttons; only F8 meta-move has a key). Registering them as unreachable keeps the keymap a complete description of the design's intent for the overlay, without this task taking on binding work outside its scope. Their live bindings are future work tracked outside this leaf; this task does not register a follow-up for them (they are sketch-level per docs/moderator-ui.md L213 "Specific bindings defer to UI prototyping") — surfaced to the parking lot if/when prioritized.

8. **No new ADR.** The registry is a small data table + a thin hook reusing the established `document`-keydown idiom and the existing shortcut-policy ADR (0024). No new dependency, no new architectural seam, no security-relevant trade-off. The one decision with ADR-level weight — the proposal-selection model — is deferred to `mod_proposal_selection_commit_chord`, whose refinement will raise an ADR if the selection model warrants one.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-06.

- Created `apps/moderator/src/layout/globalKeymap.ts` — declarative `GLOBAL_KEYMAP` registry (5 kind, 7 edge-role, 3 meta-move-kind entries generated from shortcut tables; action/navigation/mode entries declared with reachable flags).
- Created `apps/moderator/src/layout/useGlobalKeymap.ts` — unified document-level `keydown` dispatcher absorbing `Cmd/Ctrl+S` → snapshot, with commit chord registered-but-deferred; re-homes `isMacPlatform()`.
- Created `apps/moderator/src/layout/globalKeymap.test.ts` — drift-guard tests (a–e): table parity, id/reachability pins, chord distinctness, collision-freedom, labelKey resolution across all three locales.
- Created `apps/moderator/src/layout/useGlobalKeymap.test.tsx` — migrated snapshot binding cases (a–h) from retired hook + new case (i) commit-chord no-op deferral pin.
- Deleted `apps/moderator/src/layout/useSnapshotShortcut.ts` and `useSnapshotShortcut.test.tsx`; `isMacPlatform()` re-homed to `useGlobalKeymap.ts`.
- Edited `apps/moderator/src/routes/Operate.tsx` — swapped `useSnapshotShortcut()` → `useGlobalKeymap()`.
- Edited `apps/moderator/src/routes/Operate.test.tsx` — updated comment to reference new hook.
- Edited `tests/e2e/moderator-snapshot.spec.ts` — extended narration for regression-pin of `Cmd/Ctrl+S` after consolidation.
- Added i18n key `moderator.globalKeymap.escLabel` to `en-US.json`, `pt-BR.json`, `es-419.json`; PENDING translations tracked in `pt-BR.review.json` and `es-419.review.json`.
- Registered follow-up task `moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord` (1.5d) in `tasks/30-moderator-ui.tji`; wired into `m_audits` milestone via container `moderator_ui.mod_keyboard_shortcuts`.
