# Per-locale keyboard shortcut policy for moderator palette

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_keyboard_shortcuts_policy`
**Effort estimate**: 0.5d
**Inherited dependencies**: `frontend_i18n.i18n_methodology_glossary` (must land first)

## What this task is

Decide whether the moderator's classification-palette keyboard shortcuts (`f`/`p`/`v`/`n`/`d` for `fact`/`predictive`/`value`/`normative`/`definitional`) stay bound to the english-derived mnemonic regardless of UI locale, or rebind per locale to match the localized first letter. Capture the decision in the refinement; the moderator UI's `mod_classification_palette` and `mod_keymap_help_overlay` tasks consume it.

## Why it needs to be done

The moderator UI uses keyboard shortcuts for the high-frequency operations (classification, commit, snapshot, esc) so the operator can drive the tool without leaving the keyboard. The english mnemonics (`f` for `fact`, `v` for `value`, etc.) align with the english labels; when the labels are localized, the mnemonics either stay (and become "the f key picks Fato") or rebind (and the `h` key picks `Hecho` in es-419). The decision affects:

- The `mod_classification_palette` task's keymap definition.
- The `mod_keymap_help_overlay` task's rendering of shortcut hints.
- Operator training docs — if shortcuts vary by locale, the training material is locale-specific.
- Visual-regression baselines for `mod_keymap_help_overlay` (per `i18n_testing`).

## Inputs / context

- [docs/moderator-ui.md](../../../docs/moderator-ui.md) — the moderator UI design; keyboard-driven operation is a primary mode.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — Decision section: shortcuts stay english-mnemonic (recorded in the ADR as the policy).
- [`tasks/refinements/frontend-i18n/i18n_methodology_glossary.md`](./i18n_methodology_glossary.md) — the localized labels the shortcuts bind to.

The five statement kinds in each locale:

| English (shortcut) | pt-BR first letter | es-419 first letter |
| --- | --- | --- |
| `fact` (`f`) | Fato (`f`) | Hecho (`h`) |
| `predictive` (`p`) | Preditiva (`p`) | Predictiva (`p`) |
| `value` (`v`) | Valor (`v`) | Valor (`v`) |
| `normative` (`n`) | Normativa (`n`) | Normativa (`n`) |
| `definitional` (`d`) | Definicional (`d`) | Definicional (`d`) |

In pt-BR, the english mnemonics coincidentally still match the first letter of each localized label. In es-419, only `fact -> Hecho` breaks the mnemonic; the other four hold.

## Constraints / requirements

- The decision is **load-bearing for the moderator UI keyboard model**; it must be settled before `mod_classification_palette` lands.
- Whatever the decision, the `mod_keymap_help_overlay` must show both the shortcut key AND the localized label, so the moderator sees "F: Fato" or "F: Fact" rather than just "F".
- The policy must extend to non-classification shortcuts the same way (commit, snapshot, esc) — those are not methodology-derived, so they stay as-is; documented here for clarity.
- Operator training docs (when they land) reflect the policy.

## Acceptance criteria

- The decision is written into ADR 0024's Decision/Consequences section and surfaced in this refinement.
- `mod_classification_palette`'s refinement (when it lands) cites this decision rather than re-litigating it.
- The keymap help overlay rendering shows the shortcut + localized label in every locale.
- A note in `docs/moderator-ui.md` (or a follow-up touch on it) records that shortcuts stay english-mnemonic regardless of UI locale.

## Decisions

- **Recommendation (accepted in ADR 0024): keep english mnemonic shortcuts.** Rationale:
  - The moderator is a single trained operator per session; consistency across deployments (especially for shared tooling like in-house show templates) wins over local-mnemonic agreement.
  - Four of five pt-BR labels and four of five es-419 labels still match the english mnemonic by happy coincidence; only `fact -> Hecho` in es-419 breaks it. Rebinding for one of five labels would be inconsistent and confusing.
  - The keymap help overlay surfaces the localized label next to the shortcut key, so the moderator sees "F: Hecho" and can reason about it.
  - Operator training docs ship as english-keyed reference material; localized labels are runtime annotations.
- **Non-methodology shortcuts** (commit, snapshot, esc, pane focus, etc.) are not derived from methodology vocabulary and stay as-is across locales.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.** Policy materialised as a small TypeScript module under
`packages/i18n-catalogs/`.

Artifacts:

- `packages/i18n-catalogs/src/keyboard-shortcuts.ts` — exports
  `METHODOLOGY_KINDS`, `KIND_TO_SHORTCUT`, `KEYBOARD_SHORTCUT_POLICY`
  (set to `'english-mnemonic'`), `getShortcutForKind(kind, locale)`,
  and `buildShortcutMatrix()`. The `locale` parameter is accepted for
  forward compatibility but ignored under the current policy.
- `packages/i18n-catalogs/src/keyboard-shortcuts.test.ts` — 15 Vitest
  cases covering: policy mode constant, every kind's specific
  mnemonic, totality of `KIND_TO_SHORTCUT`, single-lowercase-ASCII
  shape, no within-table collisions, locale-independent resolution
  through `getShortcutForKind`, totality of the
  `(SupportedLocale x MethodologyKind)` matrix, no within-locale
  collisions on the matrix, every locale row equals the canonical
  english-mnemonic table, and the documented per-locale rows from
  the refinement table.
- `packages/i18n-catalogs/src/index.ts` — re-exports the new module's
  public surface (`KIND_TO_SHORTCUT`, `METHODOLOGY_KINDS`,
  `KEYBOARD_SHORTCUT_POLICY`, `getShortcutForKind`,
  `buildShortcutMatrix`, plus the `MethodologyKind` /
  `KeyboardShortcutPolicy` types).
- `docs/moderator-ui.md` — the "Keyboard shortcuts (sketch)" section
  gained a one-line cross-reference recording that the classification
  shortcuts stay english-mnemonic regardless of UI locale and citing
  this refinement.

The decision itself (english-mnemonic, locale-independent) was already
captured in ADR 0024's Consequences and in the refinement's Decisions
block; this task lands the executable form (mapping module + tests)
that `mod_classification_palette` and `mod_keymap_help_overlay` will
import.
