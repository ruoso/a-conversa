# Rewrite fixture loader to drive the append API for the walkthrough fixture

**TaskJuggler entry**: `data_and_methodology.data_methodology_tests.dm_e2e_tests.r23_loader_replay_through_append_for_walkthrough` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 574-585). Embedded note: *"Source of debt: walkthrough_replay_e2e — the fixture loader uses truncate-then-raw-INSERT today, bypassing event validation. Rewrite to route walkthrough fixture events through the append API (event_validation + backend.api_skeleton both complete) so the largest fixture exercises the same code path as production. Any raw-INSERT vs. append-API divergence will surface here first."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The mechanical surface is small: extend `loadFixture`'s contract with an opt-in append seam, wire the walkthrough Cucumber step to inject `appendSessionEvent` + `validateEvent`, keep the existing raw-INSERT path as the default so the `empty` fixture (whose payloads predate the tightened Zod schemas — see [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L184-217) stays untouched. The hard work — authoring the fixture, encoding the 22 turns, the five Cucumber scenarios — already shipped under [`walkthrough_replay_e2e`](./walkthrough_replay_e2e.md). This task is the loader-rewrite tail.

## Inherited dependencies

**Settled:**

- [`walkthrough_replay_e2e`](./walkthrough_replay_e2e.md) (done — `complete 100` on 2026-05-30; per its Status block this task is explicitly registered as the loader-rewrite follow-up). The walkthrough fixture exists at [`packages/test-fixtures/src/fixtures/walkthrough/`](../../../packages/test-fixtures/src/fixtures/walkthrough/) (266 events, deterministic IDs / sequence, every event already passes `validateEvent` per the discipline cover at [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) L74-91).
- [`data_and_methodology.event_types.event_validation`](./event_validation.md) (done — `complete 100` on 2026-05-10). `validateEvent` lives in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L865 (re-exported from [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts) as the server's typed wrapper). The walkthrough loader test already imports it from `@a-conversa/shared-types` — no new dependency.
- `backend.api_skeleton` (all sub-tasks `complete 100`). The append helper `appendSessionEvent(client, event): Promise<Event>` lives in [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) L88-106. Contract per the file's header doc: caller is responsible for `validateEvent`; caller owns sequence allocation; helper runs `INSERT INTO session_events (id, session_id, sequence, kind, actor, payload)` inside the supplied client's transaction; helper does NOT emit broadcasts (that's the route's post-COMMIT responsibility). The helper is NOT yet exported from the server's `events` barrel — re-exporting it is part of this task's scope.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — settles the validate-on-write invariant. The loader honors it for the walkthrough path after R23.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed test.

**Pending:** (none — every load-bearing input is settled on `main` as of 2026-05-30.)

## What this task is

Rewrite the events-insertion step of [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts) so the walkthrough fixture's events route through the same `validateEvent` → `appendSessionEvent` path that production writes use, eliminating the raw-INSERT divergence flagged by the file's `TODO(R23)` (L175-180) and by [`walkthrough_replay_e2e`](./walkthrough_replay_e2e.md)'s D6 + tech-debt registration.

Concretely the deliverable is:

1. **Loader API extension** — `loadFixture(name, client, options?: LoadFixtureOptions)` gains a third parameter. `LoadFixtureOptions.appendEvent` is an injected callback `(client, event: Event) => Promise<void>` (per D1 below this is the layering escape hatch — the loader stays free of any `apps/server` dependency; callers wire the helper). When `appendEvent` is supplied, the loader: for each fixture-event record, normalizes it to the camelCase `Event` envelope shape, runs `validateEvent` (rejecting on failure with the existing `EventValidationError`), then invokes `appendEvent(client, validatedEvent)`. When `appendEvent` is omitted, the existing raw-INSERT path (`insertEvents` at L171-189) runs unchanged — the `empty` fixture and any other current caller keeps working without modification.

2. **Walkthrough step rewire** — [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) L150 + L165 swap `await loadFixture('walkthrough', this.client)` to `await loadFixture('walkthrough', this.client, { appendEvent: appendSessionEvent })`, importing `appendSessionEvent` directly from `../../../apps/server/src/events/append.js` (the same relative-import pattern other backend Cucumber steps already use — see [`tests/behavior/steps/backend-create-session.steps.ts`](../../../tests/behavior/steps/backend-create-session.steps.ts) L35). The server's `events` barrel ([`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts)) gains a `export { appendSessionEvent }` line so the import path is the public surface, not the file directly.

3. **Discipline tests** at [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) (extending the existing file, not a new one):
   - **`appendEvent`-mode loader produces the same DB rows as raw-INSERT mode** for the walkthrough fixture. Loads the walkthrough into a pglite handle twice (once each path), reads back `SELECT id, session_id, sequence, kind, actor, payload FROM session_events ORDER BY sequence`, and asserts row-set equality on those six columns (`created_at` is the only column expected to differ — see D2 below). This pins the rewrite as semantics-preserving.
   - **`appendEvent`-mode rejects a malformed event at load time.** Synthesizes a minimal-mismatch event (e.g., a fabricated walkthrough-shaped event with an unknown `kind`, OR an in-test mutated copy of the walkthrough events array with one payload field stripped), runs the loader's per-event normalize-and-validate path against it, and asserts the call throws `EventValidationError` with the expected `code`. This pins the validation-gate contract.

The walkthrough's existing 5 Cucumber scenarios + 4 Vitest schema-cover cases stay green unchanged — that IS the integration regression cover for the rewrite (per D3 below).

## Why it needs to be done

**The walkthrough is the canonical at-scale event log; it is the highest-payoff place to close the raw-INSERT / append-API divergence.** [`walkthrough_replay_e2e.md`](./walkthrough_replay_e2e.md) D6 deferred this rewrite on the rationale that "the current truncate-then-INSERT loader produces the same projection as the future append-through-API loader, assuming the fixture's events are valid (which D2 enforces)." That assumption is currently load-bearing on the Vitest discipline cover at [`loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) L74-91 — a fixture-author's slip that introduces an invalid event would pass through `loadFixture` silently (raw INSERT writes the row regardless) and only fail the separate `validateEvent` iteration test. Once R23 lands, the contract is enforced at the loader seam itself; the fixture and the production write path share one validation gate.

**The append helper IS the production write surface.** [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) header doc: "Before this task [`ws_event_broadcast`], six call sites in `apps/server/src/sessions/routes.ts` each ran their own `INSERT INTO session_events (...)`... With this helper, the SQL lives in one place." Today the fixture loader is the seventh call site running its own SQL — defeating the helper's single-surface goal exactly for the test-mode path most exercised by downstream tests. Routing the walkthrough through `appendSessionEvent` removes that drift, so a future change to the events SQL surface (column reorder, schema-on-write extension, future `inserted_by` column, etc.) lands once.

**Downstream tests that hit the walkthrough fixture inherit the validation discipline transitively.** Per [`seed_data_for_tests`](./seed_data_for_tests.md) L51 the walkthrough is canonical — every Playwright / Cucumber test that needs "a substantial debate" loads it. Each of those downstream test loads runs the same loader; with R23 they each enforce `validateEvent` end-to-end without having to duplicate the discipline cover.

## Inputs / context

**Source files the implementer edits:**

- [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts) — the rewrite target.
  - L62-70 `FixtureEvent` interface — the snake-case on-disk shape; reused by both paths.
  - L98-124 `loadFixture` — extend signature; thread `options` through to `insertEvents`.
  - L171-189 `insertEvents` — the function holding the `TODO(R23):` comment; gains an `options.appendEvent` branch and keeps the raw-INSERT path for the no-option case.
- [`packages/test-fixtures/src/index.ts`](../../../packages/test-fixtures/src/index.ts) — exports `loadFixture` + `listFixtures`; the new `LoadFixtureOptions` type joins the export list.
- [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) — extend with the two new Vitest cases (D3).
- [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts) — add `export { appendSessionEvent } from './append.js'` so the public surface includes the helper (currently only re-exports `validateEvent` and friends).
- [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) L18-20, L150, L165 — add the `appendSessionEvent` import (relative path consistent with other `backend-*.steps.ts` files) and pass it as the `appendEvent` option to both `loadFixture` calls.

**Source files the implementer reads (but does NOT edit):**

- [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) L88-106 — `appendSessionEvent(client, event): Promise<Event>`. Structural client shape at L57-62 (`query<TRow>(text, params?): Promise<{rows: TRow[]}>`); pglite's handle satisfies this. The helper does NOT include `created_at` in the INSERT — the DB default (`NOW()`) fills in. The walkthrough's encoded narrative timestamps are NOT preserved through the append path (D2 below decides this is acceptable).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L865 — `validateEvent(raw: unknown): Event`. Throws on schema mismatch. Already imported by `loader.test.ts` L17.
- [`packages/shared-types/src/events/index.ts`](../../../packages/shared-types/src/events/index.ts) — the `Event` type the callback signature uses; already a transitive dep of `@a-conversa/test-fixtures`.
- [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L130-146 — `rowToEnvelopeShape` is the canonical snake-case-row → camelCase-envelope transform; the loader's normalize step mirrors it (per D4 the loader inlines a private helper of the same shape rather than reaching into the test layer).
- [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L184-217 — the empty-fixture-bypasses-`validateEvent` rationale that justifies keeping raw-INSERT as the default no-option behavior (D5 below).
- [`packages/test-fixtures/src/fixtures/walkthrough/events.json`](../../../packages/test-fixtures/src/fixtures/walkthrough/events.json) — 266 events, all already authored to satisfy `validateEvent` per the existing discipline cover. No fixture edits are needed; the rewrite is loader-only.
- [`tests/behavior/projection/walkthrough-replay.feature`](../../../tests/behavior/projection/walkthrough-replay.feature) — the 5 Cucumber scenarios that act as the rewrite's integration regression cover.

**Architectural inputs:**

- [ADR 0006 — Vitest](../../../docs/adr/0006-test-framework-vitest.md) — the new discipline tests live at the Vitest layer (loader-package internal).
- [ADR 0007 — Cucumber + pglite](../../../docs/adr/0007-test-framework-behavior.md) — the integration regression cover (walkthrough-replay.feature) is at this layer; unchanged.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — validate-on-write contract.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — both discipline tests ship as committed Vitest cases; no probe-and-discard.

## Constraints / requirements

- **The default (no-option) loader behavior is unchanged.** Existing callers (the empty fixture's call sites in `tests/behavior/steps/*.ts`, [`tests/behavior/fixtures/`](../../../tests/behavior/fixtures/) scenarios, `apps/server/src/sessions/routes.feature` smoke uses) continue to work without modification. This is what makes the rewrite scope-bounded — the empty fixture's payload-tightening is registered as a separate follow-up (see Tech-debt registration).
- **No new package dependency on `@a-conversa/server` for `@a-conversa/test-fixtures`.** Per D1 the loader stays a leaf package with `@a-conversa/shared-types` as its only workspace dep; callers inject `appendSessionEvent`. This preserves the natural layering (apps → packages, never the reverse) and matches how `tests/behavior/steps/*.ts` already wires up server modules.
- **The loader's normalize step is private and complete.** When the `appendEvent` option is supplied, the loader maps every `FixtureEvent` row to a camelCase `Event` envelope shape (`session_id` → `sessionId`, `created_at` → `createdAt`) before calling `validateEvent`. The mapping logic mirrors `rowToEnvelopeShape` in `projection-from-log.steps.ts` L130-146 but lives inside `loader.ts` (no cross-package reach into test code).
- **Sequence allocation is taken as-given from the fixture.** The fixture's encoded `sequence` field is the authoritative monotonic ordering; the loader does NOT recompute it. `appendSessionEvent`'s docstring notes the caller is responsible for sequence allocation — the loader's "caller" obligation is satisfied by reading the field straight off the fixture record.
- **`created_at` in the DB row reflects the DB default (NOW()), not the fixture's encoded timestamp,** when the append path is used. This is a behavior change from the raw-INSERT path (which writes the fixture's encoded `created_at`). The walkthrough's coda assertions are graph-state assertions and don't reference timestamps; the step's row-read at [`projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) L152 still produces ISO-formatted strings that re-pass `validateEvent` on round-trip. (See D2.)
- **`validateEvent` is invoked exactly once per event in append-mode** — at the loader, before the helper call. The helper does not re-validate (per its own contract). The fixture's existing 266-event discipline cover in `loader.test.ts` L74-91 stays — it remains the dry "read from disk, validate, never touch DB" path; the new "load into DB through append" path is its integration counterpart.
- **Cucumber scenarios run on pglite per ADR 0007.** The walkthrough step's pglite handle is passed to both `loadFixture` and the injected `appendSessionEvent`; the helper's structural client requirement (`query<TRow>(text, params?): Promise<{rows: TRow[]}>`) is satisfied by pglite's native return shape.
- **No new event kinds, no schema changes, no fixture edits.** The fixture is already valid. R23 is loader-only.
- **No new Playwright cover.** This is `data_and_methodology.data_methodology_tests.dm_e2e_tests.*` (backend / loader), not UI-stream. The Cucumber + Vitest layers are the right cover.
- **Test discipline per ADR 0022.** Both new discipline tests are committed Vitest cases; no transient verification.

## Acceptance criteria

**Pinned per ADR 0022 — every check ships as committed test code.** Per D1 the layer split is: append-mode contract pinned at the Vitest layer (`packages/test-fixtures/src/loader.test.ts`); integration regression pinned at the existing Cucumber layer (`walkthrough-replay.feature`); no new Playwright cover.

Loader API (extending [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts)):

- [ ] **`loadFixture` accepts a third `options` parameter** typed as `LoadFixtureOptions`. The interface declares one optional field: `appendEvent?: (client: LoadFixtureClient, event: Event) => Promise<void>`. The interface is exported from [`packages/test-fixtures/src/index.ts`](../../../packages/test-fixtures/src/index.ts).
- [ ] **When `options.appendEvent` is omitted**, `insertEvents` behaves byte-identically to today's raw-INSERT path (including writing the fixture's encoded `created_at`). The empty-fixture-using scenarios in [`tests/behavior/fixtures/`](../../../tests/behavior/fixtures/) and [`tests/behavior/steps/projection-cache.steps.ts`](../../../tests/behavior/steps/projection-cache.steps.ts) + similar stay green with zero edits.
- [ ] **When `options.appendEvent` is supplied**, `insertEvents` normalizes each `FixtureEvent` row to a camelCase `Event` envelope, calls `validateEvent` (re-thrown errors keep `EventValidationError`'s typed `code` / `kind` / `issues` fields per [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — but since `validateEvent` is the shared-types primitive, the call site simply lets the underlying error propagate), then calls `options.appendEvent(client, validatedEvent)`.
- [ ] **`TODO(R23)` comment removed** from `insertEvents`. The header comment block at the top of `loader.ts` (L8-19) is rewritten to describe the new dual-mode behavior (raw-INSERT default + opt-in append-API mode), with the same level of doc-comment care the existing comment shows.

Server surface (extending [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts)):

- [ ] **`appendSessionEvent` re-exported** from the events barrel. The walkthrough step file imports it via `../../../apps/server/src/events/index.js` (same shape as other `backend-*.steps.ts` server imports) or `../../../apps/server/src/events/append.js` directly — implementer's call; whichever matches the surrounding convention in `projection-walkthrough-replay.steps.ts`.

Walkthrough step rewire (editing [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts)):

- [ ] **Both `loadFixture` calls pass `{ appendEvent: appendSessionEvent }`** (L150 and L165). The `appendSessionEvent` import lands alongside the existing imports.

New Vitest cases (extending [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts)):

- [ ] **`appendEvent`-mode produces the same `session_events` rows as raw-INSERT mode** for the walkthrough fixture. Loads the walkthrough twice (a fresh pglite handle per load, migrations applied), `SELECT`s the rows ordered by `sequence`, and asserts equality on `(id, session_id, sequence, kind, actor, payload)` — `created_at` is allowed to differ. The test uses the real `appendSessionEvent` from `apps/server/src/events/append.js`. Per D3 below this case PINS the rewrite as semantics-preserving on the columns the projection reads.
- [ ] **`appendEvent`-mode throws `EventValidationError` on a malformed event.** A synthetic fixture-event with a deliberately broken payload (e.g., `kind: 'snapshot-created'` with `payload: { not_a_real_field: true }` — chosen so the failure surfaces at the payload stage rather than the envelope stage) is handed to the loader's normalize-then-validate path; the call rejects with `EventValidationError` carrying `code: 'payload-invalid'`. The test runs the normalize-then-validate logic via a small in-test driver that mirrors the loader's per-event loop (since calling the full `loadFixture` with a custom malformed fixture would require setting up a synthetic fixture directory; the per-event driver is the focused cover). Per D3 below this case PINS the validation-gate contract.

Existing tests stay green:

- [ ] All five Cucumber scenarios in [`tests/behavior/projection/walkthrough-replay.feature`](../../../tests/behavior/projection/walkthrough-replay.feature) pass — this IS the integration regression that the rewrite preserves end-to-end behavior.
- [ ] All four existing Vitest cases in [`loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) (the `listFixtures` case + the three walkthrough schema-cover cases) pass.
- [ ] All Cucumber scenarios using the empty fixture pass (the no-option default path is unchanged).
- [ ] Every existing Vitest suite passes — including [`apps/server/src/projection/replay.test.ts`](../../../apps/server/src/projection/replay.test.ts)'s 12-event walkthrough.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/test-fixtures build` clean.
- [ ] `pnpm -F @a-conversa/server build` clean.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by 2 (the two new `loader.test.ts` cases).
- [ ] `pnpm run test:behavior:smoke` green; Cucumber baseline unchanged.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `r23_loader_replay_through_append_for_walkthrough`.

Tech-debt registration:

- [ ] **`empty_fixture_payload_tighten_for_append_mode` (future task — ~0.5d).** The bundled empty fixture's payloads predate the tightened Zod schemas (`session-created` omits the now-required `created_at`; `participant-joined` carries an extra `participant_id` per [`projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L192-203). Tightening those payloads + flipping the empty fixture's load sites to `appendEvent`-mode would close the second half of the divergence (empty fixture's load path also through the append API). Out of scope here because the empty fixture is consumed by ~10 unrelated test files; the tightening + migration is its own focused work. Closer registers in M1 ([`tasks/99-milestones.tji`](../../99-milestones.tji)).

## Decisions

- **D1 — Callback injection, NOT a workspace dependency on `@a-conversa/server`.** Rationale:
  - **The natural layering is apps → packages, never the reverse.** `@a-conversa/test-fixtures` is a leaf package; pulling `@a-conversa/server` into its `package.json` would invert the dependency graph (server depends on shared-types; test-fixtures depends on shared-types — both leaves) and additionally drag the fastify runtime + server transitive deps into a test-support package that doesn't otherwise need them.
  - **Caller-injection is the same pattern the loader already uses for the DB client.** `loadFixture(name, client)` already takes a structural-shaped `LoadFixtureClient` rather than importing `pg` directly. Adding `options.appendEvent` mirrors this — the loader stays agnostic; the caller wires the concrete helper.
  - **The Cucumber steps already cross the apps/server boundary.** [`tests/behavior/steps/backend-create-session.steps.ts`](../../../tests/behavior/steps/backend-create-session.steps.ts) and ~14 other `backend-*.steps.ts` files already import from `../../../apps/server/src/`. Wiring `appendSessionEvent` through one more step file is the established pattern, not a new precedent.
  - **Alternative considered: add `@a-conversa/server` as a workspace dep of `@a-conversa/test-fixtures`.** Rejected — inverts the layering and drags fastify/runtime transitive deps into a test-support package.
  - **Alternative considered: extract `appendSessionEvent` to a new `@a-conversa/event-write` (or similar) shared package.** Rejected — the single-call-site economy doesn't justify a new package; the helper's home in `apps/server/src/events/` matches where the transaction surface lives, which is the right home for it long-term. If a second non-server consumer appears (e.g., the projection replay path also needs the append helper for some future use case), revisit and extract.
  - **Alternative considered: hardcode the loader to always use `appendSessionEvent`, by importing it directly.** Rejected — same layering inversion as Option A, and additionally breaks the empty-fixture's loose-payload path (the empty fixture currently can't pass `validateEvent` per the `projection-from-log.steps.ts` L192-203 rationale).

- **D2 — `created_at` falls back to DB default in append-mode; fixture-encoded narrative timestamps are NOT preserved on disk.** `appendSessionEvent`'s INSERT (L92-104) deliberately omits `created_at` to centralize the timestamp policy at the DB layer. The walkthrough's encoded timestamps (`2026-03-01T18:00:01.000Z`-style ISO strings) are narrative-only — the coda assertions don't reference them; `projectFromLog` reads `sequence`, not `created_at`. Rationale:
  - **Behavior alignment with production.** Production writes go through `appendSessionEvent` and get DB-default timestamps; matching that in fixtures keeps the test path honest.
  - **Round-trip validation still passes.** The walkthrough step at [`projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) L150-167 reads rows back and converts each `created_at` to ISO via `row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)` (L108-109) — the DB default produces a valid TIMESTAMPTZ that converts cleanly, so the read-back `validateEvent` keeps passing.
  - **The fixture file is untouched.** The encoded timestamps remain in `events.json` as narrative-correlation metadata for human readers, even though they don't make it into the DB on the append path. Future tooling that reads the fixture (e.g., a walkthrough-replay UI surface) can still consume the narrative timestamps.
  - **Alternative considered: extend `appendSessionEvent` with an optional `createdAt` parameter** so the fixture's timestamps round-trip. Rejected — changes a production helper's surface to serve a test-only need; the centralized-timestamp policy is the explicit goal of the helper's current shape.
  - **Alternative considered: write `created_at` separately after the append call** (an `UPDATE session_events SET created_at = ... WHERE id = ...` per event). Rejected — defeats the point of routing through the helper; adds a second per-event write.

- **D3 — Two new Vitest cases instead of one combined case (or a Cucumber-only cover).** Rationale:
  - **Each case carries a distinct contract.** The semantics-preservation case pins "the rewrite doesn't change observable DB state on the projection-relevant columns"; the validation-gate case pins "an invalid event throws at load time, not silently writes to DB." Bundling them into one case loses the diagnostic signal on failure.
  - **The walkthrough's existing 5 Cucumber scenarios are the integration regression cover.** They take ~200 events through `loadFixture` + `projectFromLog` + the coda checklist; if the rewrite breaks anything observable to the projection, those scenarios fail. The new Vitest cases pin the contract-level properties (row equality, validation-throws) that the Cucumber scenarios can't economically express.
  - **Vitest at the `@a-conversa/test-fixtures` package layer matches the existing discipline cover.** The 266-event `validateEvent` iteration test already lives there (L74-91); the two new cases are siblings.
  - **Alternative considered: add a new `.feature` file** (e.g., `tests/behavior/loader/append-mode.feature`). Rejected — over-engineering for two case-shapes; Vitest is the right granularity. The package-level test file is the home for loader-package-internal discipline.
  - **Alternative considered: a single Vitest case that does both behaviors** (load both paths, assert equality + assert one malformed event throws). Rejected — loss of diagnostic signal on which property failed.

- **D4 — The snake-case → camelCase normalize is private to the loader, NOT lifted from `tests/behavior/steps/`.** The transform mirrors `rowToEnvelopeShape` (L130-146 of `projection-from-log.steps.ts`) but lives in `loader.ts`. Rationale:
  - **`@a-conversa/test-fixtures` is a publishable package surface; `tests/behavior/` is test code.** A package importing from `tests/behavior/` inverts the layering even worse than depending on `apps/server`.
  - **The transform is 6 lines.** Duplicating it is cheaper than the layering cost.
  - **Both copies validate the same envelope shape.** If the envelope shape drifts, both transforms would fail to compile against the updated `Event` type; the duplication doesn't hide drift.
  - **Alternative considered: move `rowToEnvelopeShape` to `@a-conversa/shared-types`** as a helper. Rejected — shared-types is the schema package, not a row-shape converter package; the loader's per-row read is one of two known call sites today; if a third call site appears, revisit and extract then.

- **D5 — Raw-INSERT remains the default (no-option) loader behavior.** Rationale:
  - **The empty fixture's payloads predate the tightened Zod schemas** (per `projection-from-log.steps.ts` L192-203). Forcing all fixtures through `validateEvent` in this task would require fixing the empty fixture's payloads — out of scope.
  - **Opt-in keeps the rewrite scope-bounded.** The walkthrough is the canonical at-scale fixture (per `seed_data_for_tests` R51); routing it through append-API closes the highest-payoff divergence today. Other fixtures migrate in their own time.
  - **Registered follow-up.** `empty_fixture_payload_tighten_for_append_mode` (see Tech-debt registration) names the empty-fixture migration; once it lands the no-option default can flip.
  - **Alternative considered: make append-mode the default and require empty-fixture callers to opt out.** Rejected — breaks every existing empty-fixture caller in one task; the migration is better staged.

- **D6 — The new server-barrel export of `appendSessionEvent` is additive, NOT a rename of any existing surface.** [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts) gains one new `export` line; existing callers in [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) that already import the helper continue to work via their current import paths. Rationale:
  - **Additive surface = zero-blast-radius API change.**
  - **Public-surface declaration matches the helper's "single SQL surface" goal.** Naming `appendSessionEvent` in the barrel signals it's the canonical write helper, not a private utility.

## Open questions

(none — all decided in D1–D6. The only implementation-time judgment call is which import path the walkthrough step uses for `appendSessionEvent` — barrel vs. direct file — and that's settled by D6's "either; pick to match the file's existing import style.")

## Status

**Done** — 2026-05-30.

- `packages/test-fixtures/src/loader.ts` — dual-mode rewrite: raw-INSERT default preserved; opt-in `appendEvent` callback path validates via `validateEvent` then routes through the caller-supplied helper; `TODO(R23)` removed; header doc updated.
- `packages/test-fixtures/src/index.ts` — exports new `LoadFixtureOptions` type.
- `packages/test-fixtures/src/loader.test.ts` — adds validation-gate test (`rejects a malformed event at load time with EventValidationError`).
- `packages/test-fixtures/package.json` — adds `main`/`types`/`exports` fields and `@electric-sql/pglite` devDep.
- `apps/server/src/events/index.ts` — re-exports `appendSessionEvent` from the events barrel.
- `apps/server/src/events/fixture-append-mode.test.ts` (new) — semantics-preservation test: append-mode produces same `(id, session_id, sequence, kind, actor, payload)` rows as raw-INSERT for the walkthrough fixture.
- `apps/server/package.json` — adds `@a-conversa/test-fixtures` + pglite devDeps.
- `apps/server/tsconfig.json` — references `packages/test-fixtures`.
- `tests/behavior/steps/projection-walkthrough-replay.steps.ts` — wires `appendForFixture` callback (i.e., `appendSessionEvent`) to both `loadFixture` calls.
- `Dockerfile` — adds `packages/test-fixtures/package.json` to both `deps` and `runtime` manifest-copy blocks so the new workspace package is installed in the image.
- Tech-debt registered: `empty_fixture_payload_tighten_for_append_mode` (tighten empty fixture payloads + flip to append-mode; ~0.5d) wired to `m_end_to_end_debate` (M7).
