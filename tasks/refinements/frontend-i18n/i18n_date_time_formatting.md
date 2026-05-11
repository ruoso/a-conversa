# Locale-aware Intl.DateTimeFormat / Intl.NumberFormat plumbing

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_date_time_formatting`
**Effort estimate**: 0.5d
**Inherited dependencies**: `frontend_i18n.i18n_locale_negotiation` (must land first)

## What this task is

A small utility module (in `packages/i18n-catalogs/src/format.ts` or a sibling `packages/i18n-utils` workspace if a sibling lands first) wrapping `Intl.DateTimeFormat` and `Intl.NumberFormat` so every UI surface formats timestamps and numbers using the active locale without each call site reading the locale tag itself.

## Why it needs to be done

Every UI surface displays timestamps (event log entries, change history pane, snapshot labels, replay seek-bar) and occasional numbers (pending-count badge, playback-speed multiplier). The browser's `Intl` APIs handle this natively — no bespoke catalog needed — but the active locale tag has to thread through to each call site. A single wrapper keeps the locale-resolution logic in one place; without it, every call site re-reads `i18next.language` and the wiring drifts.

## Inputs / context

- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — Date/time formatting via `Intl`, locale threaded through.
- [`tasks/refinements/frontend-i18n/i18n_locale_negotiation.md`](./i18n_locale_negotiation.md) — the active-locale source.
- MDN: `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`.

## Constraints / requirements

- **Module location**: `packages/i18n-catalogs/src/format.ts` (preferred) or `packages/i18n-utils/` (if a sibling utils workspace is justified). Defer the workspace-split decision to the implementer; recommendation is "land in `i18n-catalogs` until a second utility forces a split."
- **Exported helpers**:
  - `formatDate(date, options?)` — wraps `Intl.DateTimeFormat`.
  - `formatTime(date, options?)` — wraps `Intl.DateTimeFormat` for time-only.
  - `formatDateTime(date, options?)` — wraps `Intl.DateTimeFormat` for combined.
  - `formatNumber(value, options?)` — wraps `Intl.NumberFormat`.
  - `formatRelativeTime(value, unit, options?)` — wraps `Intl.RelativeTimeFormat` for change-history "5 minutes ago" prose.
- **Locale source**: each helper reads from a single source — either an injected locale tag, or `i18next.language` if no tag is provided. Tests cover both.
- **No catalog entries** for date/time / number formatting; `Intl` covers them.
- **Memoization** of formatter instances (per-locale, per-options) — instantiation cost is non-trivial, and the same formatters get reused on every render.

## Acceptance criteria

- Module exists at the chosen location, exports the listed helpers.
- Vitest tests cover each helper in each of the three locales with at least one representative input (e.g., `formatDate(new Date('2026-05-10'), { dateStyle: 'long' })` in en-US, pt-BR, es-419 — assertions match the `Intl` runtime output).
- Memoization is exercised (formatter instance is reused across repeated calls with the same locale + options).
- Documentation in `packages/i18n-catalogs/README.md` mentions the helpers and how to call them from components.

## Decisions

- **`Intl` over a custom catalog.** Settled by ADR 0024.
- **Helper location in `packages/i18n-catalogs`** (not a separate utils workspace) until a second utility forces the split.
- **Memoized formatter instances** as a performance baseline.

## Open questions

- **`Intl.RelativeTimeFormat` polyfill.** Modern browsers (and Node 20) support it natively; the audience surface's OBS browser-source target uses a recent Chromium engine. No polyfill expected to be needed. Revisit if a supported browser target lacks it.
- **Time-zone handling.** Each session has a server-assigned timestamp (UTC). The frontend renders in the user's local time zone by default. Whether to add an explicit "show in show-time-zone" toggle (useful for live shows targeting a specific audience) is out of scope; capture as a follow-up if it surfaces.
