# Catalog workspace + per-app integration

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_catalog_workflow`
**Effort estimate**: 1d
**Inherited dependencies**: `frontend_i18n.i18n_library_choice` (sibling — must land first)

## What this task is

Create the `packages/i18n-catalogs` pnpm workspace, populate it with the three per-locale JSON catalogs (`en-US.json`, `pt-BR.json`, `es-419.json` — initially mostly empty, just the structural skeleton), wire it into each `apps/*` workspace's `package.json`, and configure the `react-i18next` instance per app to load from this package.

## Why it needs to be done

Every UI task that renders translatable text needs a place to put its strings. This task creates that place. It also lands the lint rule + type-safety story so missing keys (e.g., a new `en-US` string with no `pt-BR` equivalent) fail loudly rather than silently falling back. Downstream consumers: every `mod_*`, `part_*`, `aud_*`, `replay_*`, `test_mode_*` task that lands user-facing strings, plus the three catalog-content tasks (`i18n_methodology_glossary`, `i18n_diagnostic_descriptions`, `i18n_error_code_catalog`).

## Inputs / context

- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the library + per-locale-workspace decision.
- [docs/adr/0005-styling-tailwind-with-shared-tokens.md](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the shared-tokens-as-data precedent. `packages/i18n-catalogs` follows the same shape: data exported by a package, consumed by every UI workspace.
- [docs/adr/0010-directory-layout-pnpm-workspaces.md](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) — the workspace layout this package joins; the `packages/i18n-catalogs` slot.
- [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) — where the new workspace is declared.

## Constraints / requirements

- **Workspace name**: `@a-conversa/i18n-catalogs`.
- **Workspace path**: `packages/i18n-catalogs/`.
- **Exported shape**: `import enUS from '@a-conversa/i18n-catalogs/en-US.json'` (or via a barrel module exporting a `Catalogs` object). The runtime `t(...)` calls in each app point at this package.
- **Catalog format**: JSON, namespaced. Proposed namespaces: `chrome` (generic UI labels: buttons, dialog titles), `methodology` (statement kinds, edge roles, facet states), `diagnostics` (diagnostic descriptions), `errors` (ApiError code -> message mapping). Per-namespace files OR a single nested object per locale; revisit on first content load.
- **Type-safety**: the catalog keys are extracted into a TypeScript union (via a small build step or via the `i18next` types module augmentation) so `t('chrome.commit')` is type-checked. Mistypes are compile errors.
- **Lint rule**: a CI check that flags any key present in `en-US.json` but missing from `pt-BR.json` or `es-419.json`. Initial implementation can be a small Node script in `packages/i18n-catalogs/scripts/check-parity.ts` run via `pnpm --filter @a-conversa/i18n-catalogs run check`.
- **No locale catalog content lands in this task** — just the skeleton, the wiring, and one or two example keys (e.g., `chrome.hello`) to prove the chain works.

## Acceptance criteria

- `packages/i18n-catalogs/` workspace exists with `package.json`, `tsconfig.json`, `src/index.ts`, three per-locale JSON files (`en-US.json`, `pt-BR.json`, `es-419.json`), and a README.
- `pnpm-workspace.yaml` includes the new package.
- Each `apps/*` workspace lists `@a-conversa/i18n-catalogs` under `dependencies` and mounts the `react-i18next` provider in its `main.tsx`.
- A `pnpm --filter @a-conversa/i18n-catalogs run check` script runs the parity-check and exits non-zero on missing keys.
- A CI step runs the parity-check (added by `i18n_testing` or by amending an existing `ci_*` task — TBD; out of scope for this task to wire CI itself).
- `pnpm -r typecheck` passes; lint passes.
- One example key resolves correctly in a vitest smoke (`expect(t('chrome.hello')).toBe('hello, world')` for `en-US`; same for `pt-BR` / `es-419` with locale-appropriate strings).

## Decisions

- **Catalog location**: `packages/i18n-catalogs/` (per ADR 0024).
- **Namespacing**: yes — split by `chrome` / `methodology` / `diagnostics` / `errors`. Keeps the per-namespace files small and lets lazy-loading split bundles by namespace too.
- **Fallback chain**: `pt-BR` -> `pt` -> `en-US`; `es-419` -> `es` -> `en-US`; `en-US` -> `en`. (Settled in `i18n_locale_negotiation`; included here as a cross-reference.)
- **Translator workflow (v1)**: maintainer-edited JSON via PR. Crowdin / Lokalise / Weblate integration deferred. Captured as Open question below.
- **Catalog drift detection**: parity-check script in CI; failing build on missing key.

## Open questions

- **External translator workflow.** If/when external translators are engaged, do they get repo write access (PRs against `packages/i18n-catalogs/`) or do we adopt Crowdin / Lokalise / Weblate? Deferred to v1.x.
- **Namespacing split-by-file vs. single nested object.** The acceptance criteria above accept either; revisit on first content load (`i18n_methodology_glossary`) when the actual structure becomes visible. **As implemented**: single nested object per locale (`{ chrome: {...}, methodology: {...}, diagnostics: {...}, errors: {...} }`), shipped under i18next's `translation` namespace; `t('chrome.hello')` resolves through dotted-key lookup. Per-file split deferred until catalog volume justifies it.
- **CI integration.** The parity-check script lands here; the CI job that runs it lands either as a sub-task of `i18n_testing` or as an amendment to an existing `ci_*` task. Resolve in `i18n_testing`.

## Status

**Done** — 2026-05-11. Landed as:

- New workspace [`packages/i18n-catalogs/`](../../../packages/i18n-catalogs/) registered in [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml) (via the existing `packages/*` glob) and in the root [`tsconfig.json`](../../../tsconfig.json) `references` list.
- Three locale catalogs in `packages/i18n-catalogs/src/catalogs/`: `en-US.json`, `pt-BR.json`, `es-419.json`. Each ships the four-namespace skeleton (`chrome` / `methodology` / `diagnostics` / `errors`) and the acceptance-criteria example key `chrome.hello` (en-US: `"hello, world"`, pt-BR: `"olá, mundo"`, es-419: `"hola, mundo"`).
- `packages/i18n-catalogs/src/config.ts` — canonical `i18next.init` options (`buildInitOptions(locale)`), the supported-locale union (`SUPPORTED_LOCALES`), the namespace union (`NAMESPACES`), and the fallback chain (`FALLBACK_LNG`). Re-exported from `src/index.ts`.
- `packages/i18n-catalogs/scripts/check-parity.ts` — bidirectional parity check (en-US ↔ pt-BR, en-US ↔ es-419). Runs via `pnpm --filter @a-conversa/i18n-catalogs run check`; exits non-zero on missing or extra keys. CI wiring deferred to `i18n_testing` per the Open question.
- `packages/i18n-catalogs/README.md` — contributor docs (consuming pattern, adding a string, fallback chain, namespacing rationale, translator workflow note).
- Per-app integration: each of `apps/moderator`, `apps/participant`, `apps/audience` lists `@a-conversa/i18n-catalogs` (workspace) plus the three pinned runtime libs (`i18next@26.1.0`, `i18next-icu@2.4.3`, `react-i18next@17.0.7`) under `dependencies`, references the package in `tsconfig.json`, and provides an `src/i18n.ts` bootstrap exporting `initI18n(locale)` that mounts the ICU plugin + `initReactI18next` and calls `i18next.init(buildInitOptions(locale))`. The per-app `main.tsx` (created by `mod_app_skeleton` / `part_app_skeleton` / `aud_app_skeleton`) calls `initI18n` before mounting the React root.
- Vitest unit coverage: `packages/i18n-catalogs/src/config.test.ts` — 15 cases covering supported-locale order, namespace list, fallback-chain entries, `buildResources` / `buildInitOptions` shape, the acceptance-criteria `t('chrome.hello')` round-trip in all three locales, and a fallback-chain round-trip (pt-BR caller, en-US-only key → returns en-US value). Wired into the smoke pass via the existing `vitest run tests/smoke packages apps` glob.
- `complete 100` marker added in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `pnpm install`, `pnpm run check`, and `pnpm run test:smoke` (1033 tests, +15 new) all green.
