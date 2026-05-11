# Pick i18n library + ICU plugin

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_library_choice`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.repo_skeleton`, `foundation.stack_decisions.frontend_framework_decision` (both settled)

## What this task is

Settle the i18n library choice for all four React frontend surfaces and land [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) recording the decision. Pins the runtime dependencies (`i18next`, `react-i18next`, `i18next-icu`, `i18next-browser-languagedetector`) and writes the ADR; no per-app wiring lands in this task — that's `i18n_catalog_workflow`'s job.

## Why it needs to be done

Every downstream UI task that renders translatable text (moderator shell, participant shell, audience shell, replay surface, classification palette, edge role selector, diagnostic descriptions, error messages) needs the library to be settled first. The choice also determines the catalog format (JSON, namespaced) which `i18n_catalog_workflow` builds against, the ICU MessageFormat syntax which `i18n_methodology_glossary` and `i18n_diagnostic_descriptions` write against, and the locale-detector wiring which `i18n_locale_negotiation` configures.

## Inputs / context

- [docs/adr/0003-frontend-framework-react.md](../../../docs/adr/0003-frontend-framework-react.md) — React is the framework; constrains the choice to React-compatible stacks.
- [docs/adr/0005-styling-tailwind-with-shared-tokens.md](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the shared-tokens-as-data pattern that the catalog workspace mirrors.
- [docs/adr/0010-directory-layout-pnpm-workspaces.md](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) — pnpm workspaces; the catalogs package fits the `packages/*` shape.
- [docs/adr/0021-event-envelope-discriminated-union-with-zod.md](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — methodology enums stay English in the event log.
- [docs/adr/0023-web-framework-fastify.md](../../../docs/adr/0023-web-framework-fastify.md) — `ApiError` shape; `code` is locale-stable, `message` stays English.

Candidates surveyed: `react-i18next` + `i18next` + `i18next-icu`; `@lingui/core`; `react-intl` (FormatJS); home-rolled. See the ADR for the full comparison.

## Constraints / requirements

- React-native API (hooks-first; works inside functional components).
- ICU MessageFormat support for plural + gender (pt-BR and es-419 both need it).
- `t(...)` callable outside React components — required for Cytoscape `style` callbacks on the audience surface.
- Pure-JSON catalogs (so the catalog workspace ships data, not code).
- Suspense / lazy-loading compatible — only the active locale's catalog should land in the bundle.
- No new build-tool step (no Babel/swc macros) that would force a retrofit of the existing Vite + `tsc -b` pipeline.

## Acceptance criteria

- ADR 0024 lands at `docs/adr/0024-frontend-i18n-react-i18next-with-icu.md`, status `Accepted`.
- Versions pinned in the ADR's Decision section (anticipated baseline: `i18next` ^23.x, `react-i18next` ^14.x, `i18next-icu` ^2.x, `i18next-browser-languagedetector` ^8.x).
- Amendment lines appended to ADRs 0003, 0005, 0010, 0021, 0023 pointing at ADR 0024.
- `tj3 project.tjp` parses clean after `tasks/35-frontend-i18n.tji` lands.

## Decisions

- **Library: `react-i18next` ^14 + `i18next` ^23 + `i18next-icu` ^2.** Rationale: hooks-first API, ICU plural/select via the plugin, callable outside components, plain-JSON catalogs, no build-tool retrofit. Captured in ADR 0024.
- **Locale detector: `i18next-browser-languagedetector` ^8** on moderator + participant + private-audience surfaces only. Public audience + replay use URL prefix (decided in `i18n_locale_negotiation`).
- **Mounting pattern**: each `apps/*` workspace mounts a single `I18nextProvider` (or `initReactI18next`) at the React root in `main.tsx`. Configuration (loadPath / fallback chain / namespaces) is read from `packages/i18n-catalogs/src/config.ts` (created by `i18n_catalog_workflow`).
- **Pin policy**: exact versions on first install per the ADR 0023 / 0010 convention.

## Open questions

(none — all decided)
