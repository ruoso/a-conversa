# Moderator capture-pane mode banner

**TaskJuggler entry**: `moderator_ui.mod_layout.mod_mode_banner` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 0.5d
**Inherited dependencies**: `moderator_ui.mod_layout.mod_bottom_strip_capture` (settled — `<BottomStripCapture>` exposes a `modeBanner` render-prop slot with the stable `bottom-strip-mode-banner` `data-testid`).

## What this task is

Land the `<ModeBanner>` component that fills `<BottomStripCapture>`'s `modeBanner` slot. The banner reads `mode` from `useCaptureStore` and renders a localized label + a brief description so the moderator sees, at a glance, which capture flow the bottom strip is currently in (idle, capture-statement, decompose, capture-defeater, operationalization, warrant-elicitation, meta-move, axiom-mark). The label is short ("Idle", "Capture statement", "Decompose", etc.); the description is one sentence of contextual guidance that orients a moderator who has just switched modes. Both come from the i18n catalogs.

## Why it needs to be done

`mod_bottom_strip_capture` parked the banner as a placeholder so `mod_mode_banner` could land it independently. Downstream capture-flow tasks (`mod_capture_text_input`, `mod_classification_palette`, `mod_edge_role_selector`, `mod_propose_action`, and the F2/F3/F5/F6/F8 mode-entry tasks) each switch `captureStore.mode` to a different value; without a banner, the moderator has no visible cue that the mode changed. The banner is the visual anchor the downstream tasks switch *into*: each new mode-entry task just calls `setMode('<mode>')` and the banner updates.

This is also the first store-reading component to mount into the bottom strip. The scaffold task left a comment hinting at this: *"`mod_mode_banner` will be the first to read `useCaptureStore((s) => s.mode)` and inject a `modeBanner` child."* This task discharges that hint.

## Inputs / context

- [tasks/refinements/moderator-ui/mod_bottom_strip_capture.md](mod_bottom_strip_capture.md) — predecessor; the `modeBanner` slot prop and the `bottom-strip-mode-banner` testid are the integration points.
- [apps/moderator/src/layout/BottomStripCapture.tsx](../../../apps/moderator/src/layout/BottomStripCapture.tsx) — the scaffold this banner plugs into.
- [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts) — `CaptureMode` enum:
  `'idle' | 'capture-statement' | 'decompose' | 'capture-defeater' | 'operationalization' | 'warrant-elicitation' | 'meta-move' | 'axiom-mark'`. The banner is the first consumer of `mode`.
- [docs/moderator-ui.md](../../../docs/moderator-ui.md) — Layout (sketch) describes the strip's top edge as the mode banner; the F1–F8 capture flows correspond 1:1 to the non-idle `CaptureMode` values.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the per-mode rendering and the i18n parity round-trip are committed Vitest cases.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — all user-facing strings ship through `@a-conversa/i18n-catalogs` with parity across en-US / pt-BR / es-419.
- [tasks/refinements/moderator-ui/mod_right_sidebar.md](mod_right_sidebar.md) — the i18n / parity / `useTranslation` patterns established for moderator chrome; this task follows the same shape.

## Constraints / requirements

- **Component owns presentation, store owns state.** `<ModeBanner>` reads `useCaptureStore((s) => s.mode)` and renders. No setter calls, no event emission — switching modes is the responsibility of the downstream mode-entry tasks (F2 enters `decompose`, F6 enters `capture-defeater`, etc.).
- **Eight modes covered.** Every `CaptureMode` value has a localized `label` + `description` in all three v1 locales (en-US / pt-BR / es-419). Catalog keys: `moderator.modeBanner.<mode>.label` and `moderator.modeBanner.<mode>.description` for each of the eight modes — sixteen keys per locale, forty-eight total new leaf paths.
- **Wires into the slot, doesn't change the scaffold.** `<BottomStripCapture>` keeps its existing API; `OperateRoute` (or wherever `<BottomStripCapture>` is mounted) passes `<ModeBanner />` as the `modeBanner` prop. The scaffold's outer banner slot keeps its `bottom-strip-mode-banner` testid; `<ModeBanner>` renders inside it.
- **Stable inner test ids.** The banner exposes `mode-banner-label` and `mode-banner-description` so downstream tests can assert which mode the strip is in without reading store internals. A `data-mode="<mode>"` attribute on the banner root captures the active mode in a single attribute for spec-readable assertions.
- **Accessibility.** The banner is `role="status"` with `aria-live="polite"` — mode changes announce themselves to assistive tech without interrupting the moderator's current keyboard focus. The label is in a `<span>` (not a heading) so it doesn't fight the operate-pane's document outline.
- **Tailwind palette consistent with the scaffold.** `text-slate-700` / `text-slate-500` on a `bg-slate-100` parent — label slightly darker than description. No new colors; reuses the scaffold's slate palette.
- **No business logic.** The banner does not validate mode transitions, does not warn on disallowed sequences, does not interact with `wsStore`. It only displays.

## Acceptance criteria

- `<ModeBanner>` component at `apps/moderator/src/layout/ModeBanner.tsx` reads `useCaptureStore((s) => s.mode)` and renders `label` + `description` from the catalog. Stable inner test ids (`mode-banner-label`, `mode-banner-description`) and a `data-mode` attribute on the root.
- `OperateRoute` (`apps/moderator/src/routes/Operate.tsx`) passes `<ModeBanner />` into `<BottomStripCapture>`'s `modeBanner` prop. No other change to the route.
- Committed Vitest cases under `apps/moderator/src/layout/ModeBanner.test.tsx` cover: (a) the banner mounts inside the `bottom-strip-mode-banner` slot when `<OperateRoute>` renders, (b) each of the eight `CaptureMode` values renders its localized label + description, (c) the banner is reachable via `role="status"`, (d) the `data-mode` attribute reflects the store value, (e) the per-locale parity round-trip resolves all sixteen keys in all three v1 locales and the non-en-US values differ from en-US (translation, not copy).
- New i18n keys ship in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` under `moderator.modeBanner.<mode>.{label,description}` for the eight modes.
- `pnpm --filter @a-conversa/i18n-catalogs run check` (catalog parity) passes.
- `pnpm run check` + `pnpm run test:smoke` green; `pnpm -F @a-conversa/moderator build` succeeds; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Banner renders per-mode label + description, not a generic "Mode: X" formatter.** Hard-coding the catalog shape per mode (eight `<mode>.label` + eight `<mode>.description` keys) keeps translators in control of the phrasing per mode rather than forcing every locale through one parameterized template. A `decompose` description in Portuguese reads naturally; a single template with `{mode}` injected would not.
- **Idle is a real mode, not the absence of one.** The `idle` mode gets a label and a description in every locale (en-US: "Idle" / "Waiting for the moderator's next move."). Hiding the banner in idle would create a visible-or-invisible toggle and make the strip's geometry jump; rendering an explicit idle label keeps the strip's height stable across modes.
- **`role="status"` + `aria-live="polite"`.** The banner is informational, not interactive — it announces the current mode the same way a status line does. `polite` (not `assertive`) lets the moderator finish their current keystroke before the screen reader announces a mode change.
- **`data-mode="<mode>"` on the banner root.** Tests can assert the active mode in one read (`expect(banner.getAttribute('data-mode')).toBe('decompose')`) without depending on the label string's wording, which translators may revise.
- **No mode-specific styling yet.** Every mode renders with the same Tailwind classes; if the design wants color-coded modes later (e.g. a red banner for `meta-move` to signal contention), that lands as a follow-up styling task. This refinement only owns the data wiring.
- **Banner mounts even when the slot is empty (`<BottomStripCapture modeBanner={undefined} />`).** Once `OperateRoute` always passes `<ModeBanner />`, the scaffold's placeholder copy is unreachable through the route. The scaffold still keeps the placeholder for tests that render `<BottomStripCapture>` directly, but the production tree never shows `[mode banner]`.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/layout/ModeBanner.tsx` — reads `useCaptureStore((s) => s.mode)`, renders a label + description from the catalog under `moderator.modeBanner.<mode>.{label,description}`. Stable inner test ids (`mode-banner`, `mode-banner-label`, `mode-banner-description`) plus a `data-mode="<mode>"` attribute on the root. `role="status"` + `aria-live="polite"` so screen readers announce mode changes politely without preempting the moderator's keyboard focus. Tailwind classes match the scaffold's slate palette (`text-slate-700` label, `text-slate-500` description, on the scaffold's `bg-slate-100` parent).
- New `apps/moderator/src/layout/ModeBanner.test.tsx` — 63 committed Vitest cases (ADR 0022): stable test ids; the polite-status accessibility surface; the default `idle` rendering; per-mode label + description for each of the eight `CaptureMode` values (`idle`, `capture-statement`, `decompose`, `capture-defeater`, `operationalization`, `warrant-elicitation`, `meta-move`, `axiom-mark`); store-change → banner update; the slot integration (mounting inside `<BottomStripCapture>`'s `bottom-strip-mode-banner` slot replaces the scaffold's placeholder); and the per-locale parity round-trip (48 case combinations: 16 keys × 3 locales) plus the "non-en-US differs from en-US" sanity assertion.
- `apps/moderator/src/routes/Operate.tsx` — passes `<ModeBanner />` into `<BottomStripCapture>`'s `modeBanner` prop. The scaffold's `[mode banner]` placeholder is now unreachable through the route; the scaffold-only render still shows the placeholder for `BottomStripCapture.test.tsx` (unchanged).
- New i18n keys in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` under `moderator.modeBanner.<mode>.{label,description}` for each of the eight modes — 16 leaves per locale, 48 new leaf paths total.
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes (86 keys across the three v1 locales, up from 70).
- Smoke tests: 1748 → 1811 (+63 Vitest cases under `ModeBanner.test.tsx`). `pnpm run check` clean, `pnpm run test:smoke` green, `pnpm -F @a-conversa/moderator build` succeeds. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — `mod_capture_flow.*` mode-entry tasks and the F2/F3/F5/F6/F8 flow tasks — switch the banner by calling `useCaptureStore.getState().setMode('<mode>')`; no banner changes required.
