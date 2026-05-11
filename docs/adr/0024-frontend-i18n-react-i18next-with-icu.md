# 0024 — Frontend i18n: `react-i18next` + ICU + per-locale catalogs in a shared workspace

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four React/TypeScript frontend surfaces — moderator, participant tablet, audience/broadcast, and replay/test — and needs to support three locales in v1: **English (US) `en-US`**, **Brazilian Portuguese `pt-BR`**, and **Latin American Spanish `es-419`**. Today none of the surfaces have an i18n layer; every label is hard-coded English. The architecture and prior decisions shape the i18n choice:

- [ADR 0003](0003-frontend-framework-react.md) locked the frontend framework as React, so the i18n stack must be React-native (or at least React-compatible).
- [ADR 0005](0005-styling-tailwind-with-shared-tokens.md) established the pattern of a shared `packages/ui-tokens` workspace feeding all four surfaces. Localization fits the same shape: catalogs-as-data consumed by every UI workspace.
- [ADR 0010](0010-directory-layout-pnpm-workspaces.md) settled the pnpm-workspaces layout and explicitly leaves room for new `packages/*` workspaces alongside `shared-types` and `ui-tokens`.
- [ADR 0021](0021-event-envelope-discriminated-union-with-zod.md) committed the event envelope and its discriminator `kind` values as English-coded identifiers in the durable event log. Translating those in the data model would break replay durability: a translation update would silently change the rendering of historical events.
- [ADR 0023](0023-web-framework-fastify.md) gave the `ApiError` envelope its `{ error: { code, message, details? } }` shape. The `code` field is the locale-stable contract; `message` is a developer aid.

The candidates surveyed:

- **`react-i18next` + `i18next` + `i18next-icu`** — most widely used React i18n stack; deep ecosystem; the ICU plugin gives proper plural/select for pt-BR (gendered noun/adjective agreement) and es-419 (gender + number). Plain JSON catalogs map cleanly onto a shared pnpm workspace. The `t(...)` function is callable outside React components, which matters because the audience surface drives Cytoscape style strings from non-component JS.
- **`@lingui/core` + `@lingui/react`** — compile-time macro extraction, ICU-native, type-safe. Excellent fit for monorepos but requires a Babel/swc macro step that conflicts with the current Vite + `tsc -b` pipeline (ADR 0015 / per-workspace tsconfig per ADR 0013). Adoption would force a build-tooling amendment we don't otherwise need.
- **`react-intl` (FormatJS)** — ICU-native, mature, used at scale; heavier runtime than `i18next`, and its `<FormattedMessage>` component-first API is awkward in the non-component code paths (Cytoscape style functions, validators, state machines).
- **Home-rolled** — viable for ~50 strings but the four surfaces are non-trivial. Pluralization + gender support in Portuguese and Spanish drags the home-rolled path toward reimplementing ICU. Not worth it.

The architectural constraint that picks `react-i18next` over the alternatives is the **non-component callable** requirement: the audience surface renders graph labels through Cytoscape's `data(...)` selectors, and the methodology glossary needs to resolve labels in places that aren't inside a React tree. `i18next.t(...)` is a plain function; `<FormattedMessage>` is not.

## Decision

The frontend uses **`react-i18next` ^14** backed by **`i18next` ^23**, with the **`i18next-icu` ^2** plugin (wrapping `intl-messageformat`) for ICU MessageFormat, and **`i18next-browser-languagedetector` ^8** on the moderator / participant / private-audience surfaces for locale negotiation. Exact versions are pinned on first install per the [ADR 0010](0010-directory-layout-pnpm-workspaces.md) / [ADR 0023](0023-web-framework-fastify.md) convention.

**Catalogs live in a dedicated workspace.** A new `packages/i18n-catalogs` workspace exports per-locale JSON catalogs (`en-US.json`, `pt-BR.json`, `es-419.json`) plus a small wiring module each app mounts at startup. Each `apps/*` workspace consumes the package and lazy-loads its active locale.

**Methodology vocabulary translates at the render layer only.** The English-coded enum values (`fact`/`predictive`/`value`/`normative`/`definitional` for statement kinds; the seven edge roles; annotation kinds; vote choices; diagnostic kinds; facet states) stay English-coded in:

- The Postgres schema (CHECK constraints in `apps/server/migrations/*.sql`).
- The Zod schemas in `packages/shared-types`.
- The WebSocket envelope payloads.
- The OpenAPI spec.
- The event log.

Only the **rendering layer** (React components, Cytoscape style mappers) substitutes the localized label, keyed off the canonical English value. The canonical English → pt-BR / es-419 glossary lives at [tasks/refinements/frontend-i18n/i18n_methodology_glossary.md](../../tasks/refinements/frontend-i18n/i18n_methodology_glossary.md) and is gated by native-speaker + philosophical review per locale.

**The backend stays locale-agnostic.** The `ApiError` envelope's `code` is the authoritative key; `message` stays English and ships in logs / OpenAPI examples / CLI debugging as a developer aid. The server does not parse `Accept-Language` in v1; locale negotiation is a frontend concern.

**Locale negotiation differs per surface.** Moderator + participant + private-audience surfaces use `i18next-browser-languagedetector` against `navigator.languages` plus a user-preference cookie. The public audience and replay surfaces use a **URL prefix** (`/{locale}/sessions/{id}`) so a producer pointing OBS at the URL picks the locale explicitly without requiring a user session.

**Right-to-left (RTL) is out of scope for v1** — the three locales are all LTR. Tailwind's `dir-*` utilities remain available if a future locale forces it.

## Consequences

- **Catalog-as-data substrate.** `packages/i18n-catalogs` mirrors the `packages/ui-tokens` shape: one source of truth, four consumers, no per-app duplication. Catalog updates ship as pure data with no schema migration.
- **Bundle-size impact on audience.** `i18next` + `react-i18next` + `i18next-icu` add ~30 KB gzipped, plus a per-locale catalog (~5-20 KB). The audience surface is the bundle-sensitive one per ADR 0003; mitigated via Suspense + lazy locale loading so only the active locale's bundle ships.
- **Methodology contract preserved.** Event-log durability holds: every recorded event reads back identically regardless of catalog updates. Replay viewers always render with the catalog active at viewing time (treated as cosmetic, not a record); the durable data is the event payload.
- **Glossary review is gating.** The pt-BR and es-419 renderings of the five statement kinds, seven edge roles, and diagnostic descriptions require native-speaker + philosophical review. The `frontend_i18n.i18n_methodology_glossary` task is the chokepoint; UI surfaces that render any methodology vocabulary inherit a dependency on it.
- **Keyboard shortcuts stay English-mnemonic.** The moderator's classification-palette shortcuts (`f`/`p`/`v`/`n`/`d`) remain bound to the English values regardless of UI locale; the keymap help overlay shows the localized label next to each shortcut. Rationale recorded in [tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md](../../tasks/refinements/frontend-i18n/i18n_keyboard_shortcuts_policy.md).
- **Participant-supplied content is not translated.** Statement wordings on nodes stay in whatever language the participants spoke. The UI chrome is independently localizable; a moderator running an en-US UI for a pt-BR debate is a supported configuration.
- **Authelia OIDC screens are configured, not reimplemented.** Authelia ships its own translations; the deployment-time YAML enables the three locales explicitly (tracked under `deployment.prod_compose.prod_oauth_config`).
- **A new contributor surface.** "How translations work" needs documentation (`packages/i18n-catalogs/README.md` when the workspace lands), and external-translator workflow is an open question for v1 (maintainer-edited JSON ships; Crowdin / Lokalise / Weblate revisit later).
- **Five ADRs receive Amendment lines.** ADRs 0003, 0005, 0010, 0021, 0023 each get a 2026-05-10 Amendment entry pointing here; Decision and Context sections remain untouched.

## Stack-validation tests

The library choice itself doesn't gain a throwaway smoke. The `i18n_library_choice` and `i18n_catalog_workflow` tasks land the real wiring inside `packages/i18n-catalogs` and the per-app skeleton tasks; the acceptance criteria there cover both the JSON-load path and the ICU plural-select path. Per [ADR 0022](0022-no-throwaway-verifications.md), no ad-hoc verification artifact is added at the ADR layer.
