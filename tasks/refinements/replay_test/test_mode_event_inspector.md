# Refinement — `replay_test.test_mode.test_mode_event_inspector`

**Inspect the event at the current scrubber position.**

## TaskJuggler entry

- Task: `test_mode_event_inspector` — [`tasks/60-replay-and-test-mode.tji:103`](../../60-replay-and-test-mode.tji).
- Parent group: `test_mode` ([`tasks/60-replay-and-test-mode.tji:70`](../../60-replay-and-test-mode.tji)).
- Grandparent stream: `replay_test` ([`tasks/60-replay-and-test-mode.tji:22`](../../60-replay-and-test-mode.tji)).

## Effort estimate

**1d** ([`tasks/60-replay-and-test-mode.tji:104`](../../60-replay-and-test-mode.tji)). Budget: a standalone read-only `EventInspector` component that renders the envelope metadata + raw payload of the one event at the current position (~0.4d), mounting it as a sibling section inside the shipped scrubber layout (~0.1d), `testMode.inspector.*` i18n keys across all three catalogs + `.review.json` companions (~0.2d), Vitest+RTL component tests (~0.2d), and extending the existing scrubber Playwright spec with inspector assertions (~0.1d).

## Inherited dependencies

`test_mode_event_inspector` declares one direct edge and inherits the `test_mode` group / `replay_test` stream edges through its ancestors.

**Direct:**

- **`!test_mode_timeline_scrubber`** — *settled (Done 2026-06-05)*. The sibling that built the per-event scrubber surface ([`tasks/60-replay-and-test-mode.tji:96`](../../60-replay-and-test-mode.tji); refinement [`test_mode_timeline_scrubber.md`](test_mode_timeline_scrubber.md)). It shipped exactly the seam this task plugs into:
  - the **lifted `position` state** in event-sequence space (`0..head`), owned by [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx:38-52`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx) and passed into `TimelineScrubber` as a `position` prop;
  - the **single-`<main>` panel layout** in [`apps/test-mode/src/scrubber/TimelineScrubber.tsx:83-151`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx), whose graph / controls / snapshots sections are siblings — the design notes at [`SessionScrubberContainer.tsx:1-14`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx) state explicitly that the inspector leaves *"attach here as siblings reading the same `position`"* rather than re-owning navigation. **This task is the first of those attachments.**
  - the full ascending `events: readonly Event[]` array (from `useSessionEventLog`), already a `TimelineScrubber` prop ([`TimelineScrubber.tsx:39-50`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx)).

**Inherited through ancestors (all settled):**

- **`data_and_methodology.replay_primitive`** + **`audience.aud_graph_rendering`** — from the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji)). Already realized and consumed by the scrubber; this task adds no graph or projection work.
- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — from the `replay_test` stream root ([`tasks/60-replay-and-test-mode.tji:30`](../../60-replay-and-test-mode.tji)). The OIDC handshake the authenticated test-mode surface rides on.

All inherited edges are settled; nothing this task needs is pending. **No inherited e2e debt** points at this leaf (the snapshot-jump debt was paid by `test_mode_timeline_scrubber` §5).

## What this task is

Add a read-only **event inspector** panel to the test-mode scrubber surface: as the operator scrubs, a panel beside the graph shows the **single event at the current position** in full — its envelope metadata and its raw payload — so design-iteration / debugging users can see *what* each event is, not just how it reshaped the graph. Concretely:

1. **A standalone `EventInspector` component** in `apps/test-mode/src/inspector/EventInspector.tsx`, props `{ events: readonly Event[]; position: number }` (read-only — no `setPosition`). It resolves the event at the current position with `events.find((e) => e.sequence === position)` and renders:
   - the envelope fields under stable `data-testid`s — `sequence`, `kind` (raw discriminant string), `actor` (UUID, or a localized "system" label when `null`), `createdAt` (ISO timestamp), and `id` / `sessionId` for traceability ([`packages/shared-types/src/events.ts:820-844`](../../../packages/shared-types/src/events.ts), ADR 0021);
   - the **raw payload** as a formatted block (`JSON.stringify(payload, null, 2)` in a `<pre>`), the honest full view for a debugging tool (Decision §2);
   - a **baseline state** when `position === 0` (the pre-history stop has no event — `find` returns `undefined`): an explanatory "baseline / before first event" readout, not an error (Decision §3).
2. **Mount it as a new sibling section** inside `TimelineScrubber`'s `<main>` ([`TimelineScrubber.tsx:83-151`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx)), passing the `events` + `position` it already holds — a `<section data-testid="test-mode-inspector">` peer of the graph / controls / snapshots sections (Decision §4).
3. **i18n keys** `testMode.inspector.*` in all three catalogs + their `.review.json` companions — the panel chrome only (aria-label, field labels, the null-actor and baseline strings). The raw `kind` discriminant and the payload field names are *data*, rendered verbatim, not translated (Decision §2).
4. **Test layers** (per ADR 0022): Vitest+RTL component tests for the inspector (per-kind / metadata / baseline / null-actor rendering), and an extension of the existing scrubber Playwright spec asserting the inspector tracks the position as the operator steps.

## Why it needs to be done

`test_mode_timeline_scrubber` turned the loaded log into a navigable replay and rendered the *graph* at each position — but the graph shows the cumulative projected state, not the discrete event that produced the current step. For design iteration and debugging — the whole reason test mode exists — the operator needs to read the event itself: its kind, its actor, and especially its payload. This task supplies that readout. It is the first of the four inspector/overlay leaves that hang off the scrubber's lifted-position seam (`test_mode_event_inspector`, `test_mode_changed_highlights`, `test_mode_diagnostic_inspector`, `test_mode_export_position`), and it validates the "sibling panel reads the lifted position" pattern the scrubber refinement set up (`test_mode_timeline_scrubber.md` Decision §4) at its first real call site.

## Inputs / context

- **The scrubber surface this attaches to** — [`apps/test-mode/src/scrubber/TimelineScrubber.tsx`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx): the `<main data-testid="test-mode-scrubber">` layout owner (lines 83-151) with sibling sections `test-mode-scrubber-graph` (line ~90, `<GraphView events={prefix} instanceKey={sessionId} />`), the prev/next/range controls, and `test-mode-scrubber-snapshots` (line ~142). Props at lines 39-50: `{ sessionId, events, position, setPosition }`. The inspector mounts as a new `<section>` peer here, reading `events` + `position` (Decision §4).
- **The lifted position seam** — [`apps/test-mode/src/scrubber/SessionScrubberContainer.tsx:38-52`](../../../apps/test-mode/src/scrubber/SessionScrubberContainer.tsx): `position` `useState`, `updatePosition` clamps every write, passed down to `TimelineScrubber`. The container header comment (lines 1-14) names the inspector panels as the intended sibling readers. The inspector reads, never writes, the position — it carries no `setPosition`.
- **The event prefix precedent** — [`TimelineScrubber.tsx:67-70`](../../../apps/test-mode/src/scrubber/TimelineScrubber.tsx) computes `prefix = events.filter((e) => e.sequence <= position)` for the graph. The inspector wants the *single* event at the stop, `events.find((e) => e.sequence === position)` — undefined at `position 0` (baseline), exactly one event for `1..head` (sequences are contiguous `1..head`, enforced by `applyEvent`).
- **The event envelope (what the inspector renders)** — [`packages/shared-types/src/events.ts:820-844`](../../../packages/shared-types/src/events.ts): `EventEnvelope<K>` = `{ id: string; sessionId: string; sequence: number; kind: K; actor: string | null; payload: PayloadFor<K>; createdAt: string }`; the `Event` discriminated union at [`events.ts:861-863`](../../../packages/shared-types/src/events.ts); the 17 `eventKinds` literals at [`events.ts:132-179`](../../../packages/shared-types/src/events.ts) (`session-created` … `proposal-withdrawn`), some with empty payloads (`session-ended`, `participant-left`, `proposal-withdrawn`). ADR 0021.
- **The route this lives under** — [`apps/test-mode/src/session-log/SessionLogRoute.tsx:95-97`](../../../apps/test-mode/src/session-log/SessionLogRoute.tsx): the ready, non-empty state renders `<SessionScrubberContainer sessionId={…} events={events} />`. No route change is needed; the inspector rides inside the existing scrubber subtree.
- **The old inert per-event readout (style precedent)** — superseded `SessionLogRoute` readout (commit `20672c57`) showed `sequence` / `kind` / `createdAt` per row, raw, under `test-mode-session-log-row-${sequence}`. The inspector shows the *same raw envelope vocabulary* for the single current event, plus the payload the old readout omitted.
- **The moderator semantic-summary helper (deliberately NOT reused)** — [`apps/moderator/src/graph/eventSummary.ts:60-172`](../../../apps/moderator/src/graph/eventSummary.ts) (`summarizeEvent` → text/i18n/none) and [`apps/moderator/src/layout/ChangeHistoryPane.tsx`](../../../apps/moderator/src/layout/ChangeHistoryPane.tsx) render kind-specific human summaries. They live in `apps/moderator` (a leaf bundle, not a workspace library — same non-importability as the position primitive, ADR 0043) and produce a *curated* summary, not the raw payload a debugging inspector wants. Rejected as the inspector's renderer (Decision §2).
- **i18n catalog** — [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json), the `testMode` namespace (`testMode.loadSession.*`, `testMode.scrubber.*`, `testMode.synthetic.*`). New keys land under `testMode.inspector.*`, matching the established camelCase-within-namespace shape. `pt-BR.json` + `.review.json` and `es-419.json` + `.review.json` companions; gate `pnpm --filter @a-conversa/i18n-catalogs run check`. ADR 0024.
- **The scrubber e2e to extend** — [`tests/e2e/test-mode-scrubber.spec.ts`](../../../tests/e2e/test-mode-scrubber.spec.ts) (project `chromium-test-mode-scrubber` in [`playwright.config.ts`](../../../playwright.config.ts), `dependencies: ['setup-auth']`), which already generates the `walkthrough` synthetic session and navigates to its `/t/sessions/:id`. The inspector assertions extend this spec (Decision §5). ADR 0008, ADR 0040 (axe).
- **ADRs** — 0021 (event envelope), 0043 (apps are leaf bundles, not importable — bears on the eventSummary reuse rejection), 0039 (graph-view), 0026 (micro-frontend mount), 0024 (react-i18next), 0006 (Vitest), 0008 (Playwright + compose), 0040 (axe-playwright), 0010 (pnpm workspaces), 0022 (no throwaway verification).

## Constraints / requirements

1. **Read-only; single source of position truth.** The inspector consumes the lifted `position` + `events` as props and renders the one event at that stop. It never owns or mutates position state (no `setPosition`), and it does not re-fetch the log — it reads the array the scrubber already holds.
2. **Resolve the event by sequence equality.** The displayed event is `events.find((e) => e.sequence === position)`. For `position 0` (the pre-history baseline stop) this is `undefined` and the inspector renders the **baseline state**, not an error or a blank.
3. **Render the raw envelope + raw payload.** Show `sequence`, `kind` (verbatim discriminant), `actor` (verbatim UUID, or the localized null-actor label), `createdAt` (verbatim ISO string), `id`, `sessionId`, and the full `payload` as `JSON.stringify(payload, null, 2)`. No per-kind semantic summarization, no cross-event reference resolution (the inspector shows one event's own fields).
4. **Mount as a sibling section in the existing layout.** Add `<section data-testid="test-mode-inspector">` inside `TimelineScrubber`'s `<main>`, peer to the graph / controls / snapshots sections. Do not restructure the shipped layout into the container (Decision §4); the edit to `TimelineScrubber.tsx` is one import + one section.
5. **i18n parity.** `testMode.inspector.*` chrome keys (aria-label, field labels, null-actor label, baseline message) land in all three catalogs + both `.review.json` companions; the raw `kind` string and payload field names stay untranslated data; `pnpm --filter @a-conversa/i18n-catalogs run check` exits zero.
6. **No new dependency.** Pure presentational React reading existing props. No data-fetching lib, no store, no new runtime package.
7. **Accessibility.** The section carries a localized `aria-label`; the payload `<pre>` is keyboard-reachable/scrollable; the existing scrubber spec's axe pass (ADR 0040) stays green with the new panel mounted.
8. **Build + check green.** `pnpm -F @a-conversa/test-mode build` and `pnpm run check` (lint + format + typecheck) stay green.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **Typecheck.** `pnpm -F @a-conversa/test-mode typecheck` exits zero; `EventInspector` is exported from `apps/test-mode/src/inspector/` and consumed by `TimelineScrubber.tsx` with `{ events, position }` props.
2. **Vitest+RTL for the inspector** (`apps/test-mode/src/inspector/EventInspector.test.tsx`):
   - given an event log and `position = head`, the panel renders the last event's `sequence` / `kind` / `actor` / `createdAt` under their `data-testid`s, and the payload block (`test-mode-inspector-payload`) contains the JSON-serialized payload;
   - changing the `position` prop to a mid-log sequence re-renders the panel with that event's fields (the inspector tracks position);
   - `position = 0` renders the **baseline** state (`test-mode-inspector-baseline`) and no envelope fields, without throwing;
   - an event with `actor === null` renders the localized null-actor label, not the literal `null`;
   - an empty-payload kind (e.g. `session-ended`) renders the panel with an empty/`{}` payload block, without throwing.
3. **Vitest catalog wiring.** The component reads its chrome strings from `testMode.inspector.*`; the i18n smoke/parity test sees the new keys in every catalog (no missing-key warnings).
4. **Playwright — inspector tracks position** (extension of [`tests/e2e/test-mode-scrubber.spec.ts`](../../../tests/e2e/test-mode-scrubber.spec.ts), **e2e in scope — the surface is reachable** at `/t/sessions/:id` and the inspector renders as a visible section): on the generated `walkthrough` synthetic session, the inspector section is present at the head position and shows the head event's `kind`; stepping **prev** updates the inspector to the previous event's `kind`/`sequence`; reaching `position 0` shows the baseline state. One assertion block, en-US only, real backend + real surface, reusing the spec's existing navigation and fixture (no new Playwright project, no new synthetic generation — Decision §5).
5. **`pnpm run test:smoke`** stays green; the unit/component count grows by the inspector cases.
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** green after the `testMode.inspector.*` additions (all three catalogs + `.review.json` companions).
7. **`pnpm -F @a-conversa/test-mode build` + `pnpm run check`** green.
8. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`** silent after `complete 100` is added (closer step).
9. **No file modifications outside the task allowlist** — the new `apps/test-mode/src/inspector/` component + test, the one-section edit to `apps/test-mode/src/scrubber/TimelineScrubber.tsx`, the two i18n catalog dirs, and the extended `tests/e2e/test-mode-scrubber.spec.ts`. No backend change; no new ADR (the seams are settled by ADR 0021 + ADR 0043 + the scrubber refinement).

**No Cucumber scenario.** This task adds no wire behavior, broadcast shape, or projector output — it is a pure client-side read of the already-loaded, already-Cucumber-pinned event log (`GET /api/sessions/:id/events`, `get_session_log`). The event envelope it renders is Zod-pinned at the type seam (ADR 0021). The new behavior is presentational, correctly pinned by Vitest + the extended Playwright spec.

## Decisions

### §1 — A standalone, read-only `EventInspector` reading the lifted position

**Chosen:** a new `apps/test-mode/src/inspector/EventInspector.tsx` taking `{ events, position }` and resolving `events.find((e) => e.sequence === position)`. **Rejected — fold the readout into `TimelineScrubber`:** the inspector is its own WBS leaf with its own effort and tests; inlining it would bloat the scrubber component and tangle navigation with display. **Rejected — give the inspector its own position state / navigation:** that forks navigation across the four inspector leaves and reintroduces the divergent-arithmetic problem the scrubber refinement's lifted position (Decision §4 there) and the shared `replay-position` helper exist to prevent. The inspector is a *reader* of the single lifted position.

### §2 — Render the raw envelope + raw payload; do not reuse the moderator semantic-summary helper

**Chosen:** display the envelope fields verbatim plus `JSON.stringify(payload, null, 2)`. The inspector is a design-iteration / debugging tool; the raw discriminant and full payload are precisely the useful signal, and this mirrors the old inert readout's raw-`kind` vocabulary while adding the payload it omitted. **Rejected — reuse `apps/moderator/src/graph/eventSummary.ts` `summarizeEvent`:** (a) it lives in the moderator app, a leaf Vite bundle not importable by another app (the same non-importability codified for the position primitive in ADR 0043) — adopting it would require porting it into `@a-conversa/shell`, a larger move than a 1d display task warrants; (b) it produces a *curated human summary* (one-line "Voted agree on …"), which is the moderator's change-history need, not the inspector's raw-truth need. If a future task wants a shared semantic summarizer across surfaces, porting `summarizeEvent` into `@a-conversa/shell` is the path — but that is speculative now and is **not** registered as a WBS task (no current second consumer). **Rejected — translate `kind` and payload keys:** they are stable data discriminants and field names, not UI prose; localizing them would add 17 kind keys × 3 catalogs of churn and obscure the raw value a debugger wants. Only the panel chrome is localized.

### §3 — Handle `position 0` as an explicit baseline state

**Chosen:** at `position 0` (the pre-history scrubber stop, where no event has sequence 0) the inspector renders a localized "baseline — before the first event" readout. **Rejected — render nothing / a blank panel:** an empty panel reads as a bug; the scrubber explicitly makes `0` a navigable stop (the baseline graph), so the inspector must have a first-class story for it. **Rejected — clamp the inspector to `position 1`:** that would desync the inspector from the scrubber's actual position (the graph would show baseline while the inspector showed event 1), breaking the single-source-of-truth invariant.

### §4 — Mount as a sibling section inside the scrubber's existing `<main>`, not by hoisting the layout

**Chosen:** add the inspector `<section>` directly inside `TimelineScrubber`'s `<main>`, peer to the graph / controls / snapshots sections, passing the `events` + `position` already in scope there. It is a two-line change (import + section), keeps one layout owner, and honors the container's stated intent that inspector panels are siblings reading the lifted position. **Rejected — hoist the panel layout up into `SessionScrubberContainer`** so it composes `<TimelineScrubber/>` + `<EventInspector/>` as true siblings: that refactors shipped, tested scrubber UI (moving `<main>`, re-homing `data-testid`s, updating scrubber tests) for an architectural tidiness not needed at this first attachment — the predecessor discipline is "build for today's call sites." When the 3rd/4th inspector panel lands and the single-`<main>` layout genuinely strains, hoisting the layout to the container is a contained refactor behind the same `position` prop — surfaced here as a note for the later inspector tasks, **not** encoded as work now.

### §5 — Extend the existing scrubber Playwright spec; no new e2e project

**Chosen:** add inspector assertions to [`tests/e2e/test-mode-scrubber.spec.ts`](../../../tests/e2e/test-mode-scrubber.spec.ts), reusing its `walkthrough`-synthetic-session fixture and navigation. The surface is reachable and the inspector is a visible section, so the UI-stream e2e policy puts e2e in scope — but the inspector shares the scrubber's exact surface, fixture, and auth bootstrap, so a new `chromium-test-mode-*` project would only re-pay setup cost. **Rejected — a dedicated `test-mode-inspector.spec.ts` + new Playwright project:** redundant backend round-trip and storage-state bootstrap for assertions that belong on the same page-load as the scrubber's. **Rejected — defer the e2e:** the deferral exception applies only when no surface renders the component; here the inspector renders on a reachable route, so deferral is not available and none is taken (no debt forwarded to any catch-all task).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `apps/test-mode/src/inspector/EventInspector.tsx` — new standalone read-only inspector component; props `{ events, position }`; resolves event by `events.find((e) => e.sequence === position)`; renders envelope fields (`sequence`, `kind`, `actor`, `createdAt`, `id`, `sessionId`) under `data-testid`s + raw payload as `JSON.stringify(payload, null, 2)` in a `<pre>`; baseline state at `position === 0`; null-actor localized label.
- `apps/test-mode/src/inspector/EventInspector.test.tsx` — Vitest+RTL suite (4 cases): head metadata + payload rendering, position tracking, baseline state, null-actor label.
- `apps/test-mode/src/scrubber/TimelineScrubber.tsx` — one import + one `<section data-testid="test-mode-inspector">` sibling section added inside the existing `<main>` layout (Decision §4).
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — `testMode.inspector.*` keys (aria-label, field labels, null-actor label, baseline message) added across all three catalogs.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`, `es-419.review.json` — pending review keys added for both companion files.
- `tests/e2e/test-mode-scrubber.spec.ts` — inspector assertions added to the existing scrubber spec: inspector section present at head, shows head event `kind`; stepping prev updates inspector to previous event's `kind`/`sequence`; position 0 shows baseline state.
