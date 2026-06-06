# Moderator keymap help overlay — a `?`-toggled dialog that renders the live `GLOBAL_KEYMAP` registry as `<chord> : <localized label>`

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_keyboard_shortcuts.mod_keymap_help_overlay`.

```
task mod_keyboard_shortcuts "Keyboard shortcuts" {
  ...
  task mod_keymap_help_overlay "Keymap help overlay" {
    effort 0.5d
    allocate team
    depends !mod_global_keymap
  }
}
```

## Effort estimate

**0.5d.** Confirmed. The hard part — the single declarative source of truth — already shipped as `GLOBAL_KEYMAP` in `mod_global_keymap` (commit `e800764f`). This task is the *presentational* consumer the registry was built for: a modal that reads the registry, composes the platform glyph, resolves each `labelKey`, and renders the list grouped by category. Every seam it needs already exists and is copy-shaped from the snapshot-label modal. The deliverable is:

1. A toggle store `apps/moderator/src/layout/useKeymapHelpStore.ts` (~40 lines) — a boolean `isOpen` with idempotent `open()` / `close()` / `toggle()`, mirroring [`useSnapshotFlowStore.ts`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts).
2. A `?`-toggle hook `apps/moderator/src/layout/useKeymapHelpShortcut.ts` (~35 lines) — a document-level `keydown` listener that toggles the store on a bare `?`, **bailing on editable-target focus** (reusing `EDITABLE_TARGET_SELECTOR` from [`captureKeymap.ts:199`](../../../apps/moderator/src/layout/captureKeymap.ts)) and on the platform modifier, mounted once at `OperateRoute`.
3. The overlay component `apps/moderator/src/layout/KeymapHelpOverlay.tsx` (~140 lines) — the `role="dialog"` modal that maps `GLOBAL_KEYMAP` to category-grouped rows of `formatChord(chord)` + `t(labelKey)`, dims `reachable: false` rows with a localized "coming soon" badge, and closes on Esc / backdrop / close-button.
4. A colocated `formatChord(chord)` glyph composer (~25 lines) — turns the structured `Chord` into a display string (`⌘+S` / `Ctrl+S`, `?`, `Esc`, `⇧+Enter`) using `isMacPlatform()` from [`useGlobalKeymap.ts:50`](../../../apps/moderator/src/layout/useGlobalKeymap.ts).
5. A thin mount bridge `apps/moderator/src/layout/KeymapHelpMount.tsx` (~20 lines) mounted as a sibling of `<OperateLayout>` (next to `<SnapshotLabelInputMount>`), plus a help button beside `<SnapshotActionButton>` in the right sidebar.
6. One new registry entry — `navigation.help` (`?`) added to `GLOBAL_KEYMAP` so the overlay documents how to open itself — plus the small i18n addition for the overlay chrome and the help label.
7. Colocated Vitest for the store / hook / overlay / glyph composer, an updated `Operate.test.tsx`, and a **new Playwright spec** (the overlay is reachable, so e2e is in scope — not deferred).

## Inherited dependencies

Settled:

- **`moderator_ui.mod_keyboard_shortcuts.mod_global_keymap`** (done — 2026-06-06, [`mod_global_keymap.md`](mod_global_keymap.md), commit `e800764f`). Shipped the declarative registry [`apps/moderator/src/layout/globalKeymap.ts`](../../../apps/moderator/src/layout/globalKeymap.ts) — `GLOBAL_KEYMAP: readonly GlobalShortcut[]` (export at L175-182), the `Chord` (L43-47) and `GlobalShortcut` (L55-61) types, and the `reachable` flag (the commit entry is declared `reachable: false` at L117-126). This task is the registry's primary stated consumer: its module header (L8-11) names "`mod_keymap_help_overlay` (the dependent sibling) renders each entry as `<chord> : <localized label>`," and `mod_global_keymap` Decision §3 fixes the contract — **the registry stores the structured chord + a `labelKey`; the overlay composes the platform glyph and resolves the localized label**. The same task also re-homed `isMacPlatform()` to [`useGlobalKeymap.ts:50-55`](../../../apps/moderator/src/layout/useGlobalKeymap.ts) and exported it for reuse.
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_label_input`** (done — the modal template). Established the overlay-modal idiom this task copies: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, a fixed full-viewport backdrop, a centered card, close-on-Esc / close-on-backdrop / close-button, a local Esc `useEffect` (not the global keymap), and the **no-focus-trap / no-focus-restoration in v1** decisions (its Decision §5, §7). [`SnapshotLabelInputModal.tsx`](../../../apps/moderator/src/layout/SnapshotLabelInputModal.tsx) (backdrop+card L157-159; local Esc listener ~L94-104) and the [`SnapshotLabelInputMount.tsx`](../../../apps/moderator/src/layout/SnapshotLabelInputMount.tsx) subscription-bridge pattern are the direct templates.
- **`moderator_ui.mod_snapshot_flow.mod_snapshot_action`** (done). Source of the `useSnapshotFlowStore` idempotent-toggle store idiom ([`useSnapshotFlowStore.ts`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts)) this task mirrors, and of `isMacPlatform()`. Its refinement explicitly forecast (Decision §4 / pending edges) that "the keymap-help overlay will list `Cmd/Ctrl+S` next to the localized label 'Snapshot'" — this task makes good on that.
- **`frontend_i18n.i18n_keyboard_shortcuts_policy`** (done — [`i18n_keyboard_shortcuts_policy.md`](../frontend-i18n/i18n_keyboard_shortcuts_policy.md)). The english-mnemonic / locale-independent chord policy + the `<KEY>: <localized label>` overlay contract this task realizes. Chords are not translated; only the label is.
- **`root_app.root_moderator_cutover`** (done). The `/sessions/:id/operate` route is reachable through the shell; mounting the help toggle + overlay at `OperateRoute` scope binds them exactly when the moderator is operating a session. The overlay IS rendered on a reachable route → Playwright is in scope.
- **[ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)** — every empirical check ships as a committed Vitest / Playwright case.
- **[ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)** — the english-mnemonic shortcut policy lives in this ADR's Consequences; the `labelKey` indirection (chord glyph beside a *localized* label) is the mechanism it prescribes. The overlay resolves `labelKey` via `useTranslation()`'s `t()`.

Pending edges (this task FEEDS them; does NOT depend on them):

- **`moderator_ui.mod_keyboard_shortcuts.mod_proposal_selection_commit_chord`** (READY leaf — [tasks/30-moderator-ui.tji:711-716](../../30-moderator-ui.tji)). The deferred `Cmd/Ctrl+Shift+Enter` commit chord. **This task wires the overlay so the commit chord surfaces automatically once it flips to `reachable: true`.** The overlay renders *every* `GLOBAL_KEYMAP` entry — including `action.commit` (`reachable: false`) — as a dimmed "coming soon" row today; the moment `mod_proposal_selection_commit_chord` sets `reachable: true`, the same overlay code drops the badge and shows it as a live binding. No overlay change is needed when the commit chord lands (Decision §1). That task is also where the commit-chord Playwright spec lives (inherited from `mod_global_keymap`); it does NOT inherit any debt from *this* task.

## What this task is

Build the moderator's keyboard-shortcut reference panel: a `?`-toggled modal dialog, reachable on the operate route, that renders the live `GLOBAL_KEYMAP` registry as a category-grouped list of `<chord glyph> : <localized label>`. It is a **read-only presentational view of data that already exists** — no new shortcut behavior, no wire contract, no projection. The five things it adds:

- a tiny `isOpen` toggle store (mirrors `useSnapshotFlowStore`);
- a `?` document-level toggle hook (the only new *binding* — a navigation chord, with the editable-target bail that the snapshot chord deliberately omits);
- the overlay component itself (the bulk of the work — layout, grouping, glyph composition, close paths, a11y);
- one registry row (`navigation.help`) so the overlay lists how it is opened;
- the overlay-chrome i18n keys.

The overlay groups the registry's six categories under localized section headers — **kind** (`f`/`p`/`v`/`n`/`d`), **edge-role**, **meta-move-kind**, **action** (propose / snapshot / commit), **navigation** (esc / help), **mode** (decompose / warrant / operationalization) — and renders each row's chord on the left, localized label on the right. Rows whose registry entry is `reachable: false` (today: `action.commit` and the three `mode.*` entries) render dimmed with a localized "coming soon" badge and a `data-keymap-entry-reachable="false"` attribute, so the panel honestly advertises the *planned* design without implying the binding is live.

The canonical intent is the design doc's keyboard sketch and its overlay contract:

[docs/moderator-ui.md — Keyboard shortcuts (sketch), lines 201–223](../../../docs/moderator-ui.md):

> The principle is "everything reachable from the keyboard."

…rendered as `<KEY>: <localized label>` per the english-mnemonic policy.

## Why it needs to be done

- **The registry was built for this consumer and has no UI today.** `mod_global_keymap` shipped `GLOBAL_KEYMAP` whose module header (L8-11) names this overlay as call site #1. Until this task lands, the moderator has no way to *see* the shortcut set; the registry is introspectable by code and tests but invisible to the operator. The design doc's "everything reachable from the keyboard" principle is undermined if the keyboard surface itself is undiscoverable.
- **It is the natural display home for the deferred commit chord.** The orchestrator's standing intent (and `mod_global_keymap` Decision §5) is that the commit chord be *registered now, reachable later*. A help overlay that renders the full registry — reachable and not — means the commit binding becomes visible (as "coming soon") immediately and live (badge gone) the instant `mod_proposal_selection_commit_chord` flips the flag, with zero overlay churn. This task wires that behavior once.
- **Discoverability is the whole point of a keymap.** The single-letter kind/role chips are already shown inline on their palettes, but the cross-cutting action chords (`Cmd/Ctrl+S`, propose, the planned commit) have no on-screen reference. A `?`-toggled cheat-sheet is the de-facto convention (GitHub, Gmail, Slack) and the cheapest way to make the full set learnable.

## Inputs / context

- [`apps/moderator/src/layout/globalKeymap.ts`](../../../apps/moderator/src/layout/globalKeymap.ts) — the registry this task renders. `GLOBAL_KEYMAP` export (L175-182), `Chord` type (L43-47), `GlobalShortcut` type (L55-61, note `category` and `reachable`), the generated kind/edge-role/meta-move-kind rows (L65-94), the declared action rows incl. `action.commit` `reachable: false` (L98-127), `navigation.esc` (L129-140), and the `reachable: false` `mode.*` rows (L142-168). This task ADDS a `navigation.help` row.
- [`apps/moderator/src/layout/useGlobalKeymap.ts:50-55`](../../../apps/moderator/src/layout/useGlobalKeymap.ts) — `isMacPlatform()`, exported and reused by `formatChord`. Note (L33-34, L91-95) the dispatcher's snapshot binding deliberately has **no editable-target bail** — the `?` toggle's bail contract is the opposite, which is why it lives in its own hook (Decision §2).
- [`apps/moderator/src/layout/captureKeymap.ts:199`](../../../apps/moderator/src/layout/captureKeymap.ts) — `EDITABLE_TARGET_SELECTOR = 'input, textarea, select, [contenteditable="true"]'`, reused by the `?` hook so typing `?` into the capture wording does not open the overlay. The `editable-target / modifier-bail / repeat-skip` contract (L12, L35-36, L228-229) is the precedent.
- [`apps/moderator/src/layout/useSnapshotFlowStore.ts`](../../../apps/moderator/src/layout/useSnapshotFlowStore.ts) — the idempotent boolean-toggle store this task mirrors for `useKeymapHelpStore` (open/close no-op when already in target state; a `reset*Store()` test seam).
- [`apps/moderator/src/layout/SnapshotLabelInputModal.tsx`](../../../apps/moderator/src/layout/SnapshotLabelInputModal.tsx) — the modal template: `role="dialog"` / `aria-modal` / `aria-labelledby`, fixed backdrop + centered card (`fixed inset-0 z-50 flex items-center justify-center …` ~L157-159), local window-level Esc `useEffect` (~L94-104), backdrop-click close (~L136-140), input-focus-on-mount via `useRef` (NOT `autoFocus`, to keep Playwright keyboard assertions deterministic).
- [`apps/moderator/src/layout/SnapshotLabelInputMount.tsx`](../../../apps/moderator/src/layout/SnapshotLabelInputMount.tsx) — the thin subscription-bridge (subscribe to the store, render the modal when open). `KeymapHelpMount` copies this shape.
- [`apps/moderator/src/layout/ClassificationPalette.tsx`](../../../apps/moderator/src/layout/ClassificationPalette.tsx) — the existing `<kbd>` chip rendering (key-chip element ~L142-148 + `KEY_CHIP_CLASSES` ~L68-69). The overlay's chord glyph reuses the same `<kbd>` styling vocabulary for visual consistency.
- [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) — `useGlobalKeymap()` is called at route top (L155); the right-sidebar slot mounts `<SnapshotActionButton />` then `<RightSidebar>` (L353-361); `<SnapshotLabelInputMount />` is the overlay sibling of `<OperateLayout>` (L364-369). This task calls `useKeymapHelpShortcut()` near L155, adds a help button beside `<SnapshotActionButton>` (L355), and mounts `<KeymapHelpMount />` after `<SnapshotLabelInputMount />` (L369).
- [`tests/e2e/moderator-snapshot.spec.ts`](../../../tests/e2e/moderator-snapshot.spec.ts) — the operate-route Playwright harness (login → create session → seed participants → `invite-enter-session` → wait for `/operate`, then assert on `data-testid` seams). The new keymap-help spec reuses this navigation chain.
- [`tasks/refinements/moderator-ui/mod_snapshot_label_input.md`](mod_snapshot_label_input.md) — the modal a11y / focus / Esc decisions this task stays consistent with.

## Constraints / requirements

- **The overlay is a pure read of `GLOBAL_KEYMAP`.** It maps over the registry in registry order, grouped by `category`. It must NOT hardcode any chord or label string and must NOT enumerate a fixed id list — adding/removing a registry row (or flipping a `reachable` flag) changes the rendered panel with no overlay edit. A Vitest test asserts the overlay renders exactly one row per `GLOBAL_KEYMAP` entry.
- **`reachable` drives presentation, not omission.** Every entry renders. `reachable: false` rows get a localized "coming soon" badge and `data-keymap-entry-reachable="false"`; `reachable: true` rows get `data-keymap-entry-reachable="true"`. This is the seam that makes the commit chord surface automatically.
- **Chord glyphs are composed in the presentational layer, locale-independent.** `formatChord(chord)` reads the structured `Chord` + `isMacPlatform()`: `platformModifier` → `⌘` (macOS) / `Ctrl` (else); `shift` → `⇧` / `Shift`; `key` → uppercased single letters, `Enter` for `enter`, `Esc` for `escape`, `?` verbatim. No chord string is translated (policy); only the label resolves via `t(labelKey)`.
- **The `?` toggle is a navigation chord with an editable-target bail.** Its hook: bails on `event.repeat`; bails when `document.activeElement` matches `EDITABLE_TARGET_SELECTOR` (so typing `?` into the capture wording does nothing); bails when a platform modifier is held (so `⌘?` is not eaten); matches `event.key === '?'` (shift is implicit in producing `?`, so shift is NOT separately enforced); toggles the store. This is the *opposite* bail contract from the snapshot chord, which is why it is a separate hook (Decision §2).
- **The overlay's Esc is local, not the global keymap.** Mirroring `mod_snapshot_label_input` Decision §5, the modal owns a local window-level Esc `useEffect` that closes it and detaches on unmount. Esc here must close the overlay even though `navigation.esc` (exit-mode/clear-target) also listens at the capture layer — when the overlay is open it is the topmost surface; closing it is the correct Esc semantics. The local listener is mounted only while the overlay is open.
- **No focus trap, no focus restoration in v1.** Consistent with `mod_snapshot_label_input` Decision §7 — out of a 0.5d budget and marginal for a read-only cheat-sheet. The close button is focused on mount (via `useRef`, not `autoFocus`) so Esc/Enter/Tab land somewhere sane. (If a later pass wants a trap, it is a cleanup, not a WBS task — see Open questions.)
- **Strict-mode-safe lifecycle.** The `?` hook and the overlay's Esc listener attach/detach cleanly on double-mount; the toggle store's `open`/`close` are idempotent.
- **`labelKey` resolution must be total.** Every `GLOBAL_KEYMAP` entry's `labelKey` already resolves in all three locales (pinned by `globalKeymap.test.ts(e)`). The new `navigation.help` entry's `labelKey` and all overlay-chrome keys must likewise resolve — a Vitest test asserts non-empty resolution across en-US / pt-BR / es-419.
- **i18n discipline.** New keys ship authored in en-US + drafted in pt-BR / es-419 (`*.review.json` PENDING). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes. Chord glyphs are never catalog entries.
- **No WS send, no projection read, no wire-contract change.** Pure frontend. No Cucumber scenario is warranted (nothing crosses the protocol or replay boundary).

## Acceptance criteria

- New `apps/moderator/src/layout/useKeymapHelpStore.ts` — boolean `isOpen` with idempotent `open()` / `close()` / `toggle()` and a `resetKeymapHelpStore()` test seam, mirroring `useSnapshotFlowStore`.
- New `apps/moderator/src/layout/useKeymapHelpShortcut.ts` — document-level `keydown` hook that toggles the store on bare `?` with the bail rules under Constraints (repeat, editable-target, platform-modifier), detaching on unmount.
- New `apps/moderator/src/layout/KeymapHelpOverlay.tsx` — `role="dialog"` / `aria-modal="true"` / `aria-labelledby` modal that renders `GLOBAL_KEYMAP` grouped by `category` under localized section headers, one row per entry (`formatChord(chord)` + `t(labelKey)`), `reachable: false` rows dimmed with a "coming soon" badge + `data-keymap-entry-reachable="false"`, closing on Esc / backdrop-click / close-button. Carries `data-testid="keymap-help-overlay"`; rows carry `data-testid="keymap-help-row-<id>"`.
- New `formatChord` glyph composer (colocated with the overlay or in a small `formatChord.ts`) using `isMacPlatform()`.
- New `apps/moderator/src/layout/KeymapHelpMount.tsx` — subscription bridge rendering the overlay when open; mounted in `Operate.tsx` as a sibling of `<OperateLayout>` after `<SnapshotLabelInputMount />`. A help button (`data-testid="keymap-help-button"`, localized `aria-label`) added beside `<SnapshotActionButton />` opens the store; `useKeymapHelpShortcut()` called at route top.
- `apps/moderator/src/layout/globalKeymap.ts` gains a `navigation.help` entry — `chord: { key: '?' }`, `labelKey: 'moderator.globalKeymap.helpLabel'`, `reachable: true`. `globalKeymap.test.ts`'s expected-id set is updated to include it (and its labelKey resolution is covered by the existing case `(e)`).
- New i18n keys ship in en-US (authored) + pt-BR / es-419 (`*.review.json` PENDING): `moderator.globalKeymap.helpLabel` (e.g. "Show keyboard shortcuts"), `moderator.keymapHelp.title`, `moderator.keymapHelp.closeLabel`, `moderator.keymapHelp.comingSoon`, and one section-header key per category (`moderator.keymapHelp.category.kind` / `.edgeRole` / `.metaMoveKind` / `.action` / `.navigation` / `.mode`). `pnpm --filter @a-conversa/i18n-catalogs run check` parity passes.
- Committed Vitest cases (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)):
  - `apps/moderator/src/layout/useKeymapHelpStore.test.ts` — `(a)` `open()` sets `isOpen` true and is a no-op when already open; `(b)` `close()` sets false / no-op when already closed; `(c)` `toggle()` flips; `(d)` `reset` returns to closed.
  - `apps/moderator/src/layout/useKeymapHelpShortcut.test.tsx` — `(a)` bare `?` toggles the store; `(b)` `?` while an `input`/`textarea` is `activeElement` is a no-op (editable-target bail); `(c)` `⌘?` / `Ctrl+?` is a no-op (platform-modifier bail); `(d)` `event.repeat` ignored; `(e)` detaches on unmount.
  - `apps/moderator/src/layout/KeymapHelpOverlay.test.tsx` — `(a)` renders exactly one row per `GLOBAL_KEYMAP` entry, grouped by category, in registry order; `(b)` each row shows `formatChord` output + the resolved `t(labelKey)`; `(c)` `reachable: false` rows (e.g. `action.commit`, `mode.decompose`) carry `data-keymap-entry-reachable="false"` + the "coming soon" badge, `reachable: true` rows carry `"true"` without it; `(d)` `role="dialog"` + `aria-modal="true"` + `aria-labelledby` present; `(e)` Esc / backdrop-click / close-button each close the store; `(f)` every rendered `labelKey` + every overlay-chrome key resolves non-empty in en-US / pt-BR / es-419.
  - `apps/moderator/src/layout/formatChord.test.ts` — chord→glyph for: platform-modifier on macOS (`⌘+S`) vs non-macOS (`Ctrl+S`) (mock `isMacPlatform`/`navigator`); `shift` (`⇧+Enter`); special keys (`escape`→`Esc`, `enter`→`Enter`, `?`→`?`); a bare single letter uppercased.
  - Update to `apps/moderator/src/routes/Operate.test.tsx` — the route mounts `<KeymapHelpMount />` and `useKeymapHelpShortcut`; `?` flips the overlay open (assert overlay present), Esc closes it.
- **Playwright spec — e2e IS in scope (overlay is reachable).** New `tests/e2e/moderator-keymap-help.spec.ts` (reusing the `moderator-snapshot.spec.ts` operate-route navigation chain): `(1)` pressing `?` on the operate route shows `keymap-help-overlay`; `(2)` a known reachable row renders its chord + label (assert the snapshot row shows `Cmd/Ctrl+S` and the localized "Snapshot" label); `(3)` a `reachable: false` row (`keymap-help-row-action.commit`) is present with `data-keymap-entry-reachable="false"` (proves the commit chord is advertised-but-dim — the wiring the orchestrator asked for); `(4)` Esc closes the overlay; `(5)` the help button opens it; `(6)` typing `?` into the capture wording textarea does NOT open the overlay (editable-target bail). This is NOT deferred — the route renders the overlay and the toggle drives it.
- **No inherited deferred-e2e debt.** `mod_global_keymap` deferred the commit-chord behavioral e2e to `mod_proposal_selection_commit_chord` (not to this overlay task); this task's commit-row assertion is presence/badge only, which is fully reachable now. No `mod_pw_*` catch-all is touched.
- **No new follow-up task is registered by this refinement.** The commit chord's own `reachable: true` flip + behavioral e2e already live in the pending `mod_proposal_selection_commit_chord` leaf; this overlay needs no change when that lands (Decision §1). The mode-entry live bindings remain sketch-level (parking lot, per `mod_global_keymap` Decision §7) — not a WBS task.
- **Native-speaker translation review** of the new pt-BR / es-419 keys is human-only work — surfaced to the parking lot, not a WBS task.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

1. **The overlay renders the FULL registry — `reachable: false` rows dimmed with a "coming soon" badge — not only the live bindings.**
   - **Why.** This is the wiring the orchestrator asked for: it makes the deferred commit chord (and the planned mode chords) visible as forthcoming today, and live automatically the instant `mod_proposal_selection_commit_chord` flips `action.commit` to `reachable: true` — with zero overlay edit. The registry already encodes `reachable` precisely so a consumer can make this choice (`mod_global_keymap` Decision §5 created the flag for exactly this). A `data-keymap-entry-reachable` attribute + a badge is the minimal honest treatment: the panel advertises the design's intent without implying a dead key works.
   - **Alternative rejected — render only `reachable: true` entries.** The overlay would silently hide the commit binding until the follow-up lands, defeating the "register-now, show-as-forthcoming" intent and forcing a future overlay change to surface it. The flag exists to avoid exactly that.
   - **Alternative rejected — a separate "coming soon" section.** More chrome, more i18n, and it divorces a chord from its category group. A per-row badge keeps each binding in its natural category and reads cleanly.

2. **The `?` toggle lives in its own `useKeymapHelpShortcut` hook (with an editable-target bail), NOT folded into `useGlobalKeymap`; but `?` IS registered in `GLOBAL_KEYMAP` for self-documentation.**
   - **Why.** `useGlobalKeymap`'s matching contract is the platform-modifier action-chord family with a deliberate **no-editable-target-bail** rule (`Cmd+S` fires while typing — [`useGlobalKeymap.ts:33-34`](../../../apps/moderator/src/layout/useGlobalKeymap.ts)). The help toggle is a **bare key** that must do the **opposite** — bail on editable-target so typing `?` into the capture wording doesn't pop the panel. Folding two opposite bail contracts into one `onKeyDown` muddies the dispatcher; a tiny dedicated hook is simpler and lower-risk. This matches the established architecture: `mod_global_keymap` Decision §6 kept the component-owned capture listeners as separate document listeners precisely because "multiple document listeners do not conflict (each returns early on no-match)," and `mod_snapshot_label_input` Decision §5 keeps the modal's own Esc local rather than in the global keymap. Registering `?` in the registry (binding elsewhere) is the same precedent the registry already sets for `action.propose` (declared `reachable: true`, bound in the textarea) and `navigation.esc` (declared, bound in `captureKeymap`) — **a registry row is a description, not a binding site.** The overlay must list how it is opened, so `?` is registered.
   - **Alternative rejected — bind `?` inside `useGlobalKeymap`.** Requires restructuring the dispatcher's single snapshot-shaped matcher into per-chord branches with divergent bail rules, raising regression risk on the just-shipped, byte-for-byte-preserved snapshot binding for no architectural gain — `?` is not a platform-modifier action chord.
   - **Alternative rejected — don't register `?` in the registry at all (bind it ad hoc).** The overlay would then be unable to advertise its own opener, and the registry would no longer be "every moderator shortcut." A one-row addition keeps the registry honest.

3. **The overlay reuses the `SnapshotLabelInputModal` idiom; no focus trap / no focus restoration in v1.**
   - **Why.** Consistency with the only other moderator modal (same `role="dialog"`/`aria-modal`/backdrop/local-Esc shape, same `<KeymapHelpMount>` subscription-bridge mounted as a sibling of `<OperateLayout>`), and `mod_snapshot_label_input` already reasoned that a focus trap and focus restoration are out of budget and marginal — doubly so for a read-only cheat-sheet with no inputs. Close-button-focus-on-mount (via `useRef`, not `autoFocus`, to keep Playwright deterministic) is enough to make Esc/Tab land sanely.
   - **Alternative rejected — a non-modal popover / sidebar panel.** A cheat-sheet wants the operator's full attention and a single dismiss gesture; a modal is the right altitude and the codebase already has the pattern. A sidebar slot would fight the grid layout and the existing right-sidebar content.

4. **Chord glyphs are composed by an overlay-local `formatChord(chord)` using `isMacPlatform()`; the registry stores no display string.**
   - **Why.** `mod_global_keymap` Decision §3 already fixed this: the registry stores the structured `Chord` + a `labelKey`, and "the help overlay composes the glyphs." Presentation (platform glyph + `⇧`/`Cmd` rendering) stays in the presentational layer; `isMacPlatform()` is already exported from `useGlobalKeymap.ts` for exactly this reuse. A small unit-tested pure function keeps the mapping pinned.
   - **Alternative rejected — bake a display string into each registry row.** Re-litigated and rejected in `mod_global_keymap` Decision §3 (bakes platform + locale assumptions into data); honoring that keeps a single rendering rule.

5. **The `?` toggles (press again to close); Esc and the close button / backdrop also close.**
   - **Why.** Toggle-on-same-key is the conventional cheat-sheet behavior and is friendlier than open-only. The store's `toggle()` is the natural primitive; Esc/backdrop/close-button all call `close()`. Idempotent store methods keep double-fires harmless.

6. **No new ADR.** The overlay reuses the established modal idiom, the `react-i18next` `t()` path, the existing shortcut-policy ADR (0024), and the registry's existing `reachable` seam. No new dependency, no new architectural seam, no security-relevant trade-off. The one row added to the registry and the one new toggle hook follow patterns already settled by `mod_global_keymap` and `mod_snapshot_label_input`.

## Open questions

(none — all decided. A future focus-trap / focus-restoration pass for the moderator's modals is an optional cleanup with no user-observable deliverable on its own — surfaced to the parking lot, not encoded as a WBS task, consistent with `mod_snapshot_label_input` Decision §7.)

## Status

**Done** — 2026-06-06.

- `apps/moderator/src/layout/useKeymapHelpStore.ts` — idempotent `isOpen` toggle store with `open()` / `close()` / `toggle()` and `resetKeymapHelpStore()` test seam, mirroring `useSnapshotFlowStore`.
- `apps/moderator/src/layout/useKeymapHelpShortcut.ts` — document-level `keydown` hook toggling the store on bare `?`, bailing on repeat / editable-target / platform-modifier.
- `apps/moderator/src/layout/formatChord.ts` — pure `formatChord(chord)` glyph composer using `isMacPlatform()` (`⌘+S` / `Ctrl+S`, `⇧+Enter`, `Esc`, `?`).
- `apps/moderator/src/layout/KeymapHelpOverlay.tsx` — `role="dialog"` modal rendering full `GLOBAL_KEYMAP` grouped by category; `reachable: false` rows dimmed with "coming soon" badge + `data-keymap-entry-reachable="false"`.
- `apps/moderator/src/layout/KeymapHelpMount.tsx` — subscription bridge rendering the overlay when open; `apps/moderator/src/layout/KeymapHelpButton.tsx` — sidebar opener with `data-testid="keymap-help-button"`.
- `apps/moderator/src/layout/globalKeymap.ts` — gained `navigation.help` entry (`chord: { key: '?' }`, `reachable: true`); `globalKeymap.test.ts` updated with help-entry case.
- `apps/moderator/src/routes/Operate.tsx` — `useKeymapHelpShortcut()` called at route top; `<KeymapHelpButton />` added beside `<SnapshotActionButton />`; `<KeymapHelpMount />` mounted as sibling of `<OperateLayout>`; `Operate.test.tsx` updated with keymap-help describe block.
- i18n: `moderator.globalKeymap.helpLabel`, `moderator.keymapHelp.{title,closeLabel,comingSoon,category.*}` authored in `en-US.json`; drafted (PENDING review) in `pt-BR.json` / `es-419.json` + `*.review.json`.
- Vitest: `useKeymapHelpStore.test.ts`, `useKeymapHelpShortcut.test.tsx`, `KeymapHelpOverlay.test.tsx`, `formatChord.test.ts` (new); `Operate.test.tsx` (updated).
- Playwright: `tests/e2e/moderator-keymap-help.spec.ts` (6 scenarios: `?` opens overlay, reachable row chord+label, `reachable: false` row badge, Esc closes, help button opens, editable-target bail).
