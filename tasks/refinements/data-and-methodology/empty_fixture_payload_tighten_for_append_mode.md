# Tighten empty fixture payloads and flip to append-mode

**TaskJuggler entry**: `data_and_methodology.data_methodology_tests.dm_e2e_tests.empty_fixture_payload_tighten_for_append_mode` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 587-600). Embedded note: *"Source of debt: r23_loader_replay_through_append_for_walkthrough (2026-05-30). The bundled empty fixture's payloads predate the tightened Zod schemas (session-created omits now-required created_at; participant-joined carries an extra participant_id per projection-from-log.steps.ts L192-203). Tighten those payloads and flip the empty fixture's load sites to appendEvent-mode so the no-option default can be flipped to append-mode, completing the raw-INSERT divergence closure started by R23."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The surface is small and well-bounded: edit four payload literals in one fixture file (one field added, three fields removed), update five call sites to pass `{ appendEvent: appendSessionEvent }`, and remove the raw-INSERT branch from the loader. Two new Vitest cases pin the tightened gate. R23 already shipped the dual-mode plumbing (callback injection, `validateEvent` step, the `appendSessionEvent` re-export from `apps/server/src/events/index.ts`) — this task is the migration-and-flip tail that closes the raw-INSERT escape hatch.

## Inherited dependencies

**Settled:**

- [`r23_loader_replay_through_append_for_walkthrough`](./r23_loader_replay_through_append_for_walkthrough.md) (done — `complete 100` on 2026-05-30; its Status block explicitly registers this task as the tightening follow-up). The loader's dual-mode shape — `LoadFixtureOptions.appendEvent?: (client, event) => Promise<void>`, the `fixtureEventToEnvelope` normalize at [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts) L227-237, the validate-then-append branch at L244-257 — is the seam this task narrows to required-and-only.
- [`walkthrough_replay_e2e`](./walkthrough_replay_e2e.md) (done — `complete 100` on 2026-05-30). Established the canonical at-scale fixture and the discipline cover at [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) L82-117 (per-event iteration through `validateEvent`) that this task mirrors for the empty fixture.
- [`data_and_methodology.event_types.event_validation`](./event_validation.md) (done — `complete 100` on 2026-05-10). `validateEvent` at [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L865-901; `EventValidationError` at L852-854. Throws on any envelope or per-kind payload mismatch.
- `backend.api_skeleton` (all sub-tasks `complete 100`). `appendSessionEvent(client, event): Promise<Event>` at [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) L88-106; re-exported from [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts) post-R23. Caller-validates contract; helper writes `(id, session_id, sequence, kind, actor, payload)` and lets `created_at` fall back to the DB default.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — validate-on-write invariant. With this task, the loader honors it on every fixture load, not just the walkthrough.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as committed test code.

**Pending:** (none — every load-bearing input is settled on `main` as of 2026-05-30.)

## What this task is

Tighten the bundled `empty` fixture's event payloads so each event passes `validateEvent`, then flip every known `loadFixture('empty', …)` call site to pass `{ appendEvent: appendSessionEvent }`, then remove the loader's raw-INSERT escape branch so `appendEvent` becomes mandatory — closing the raw-INSERT vs. append-API divergence that R23 closed for the walkthrough fixture for the entire bundled-fixture surface.

Concretely the deliverable is:

1. **Fixture payload tightening** — edit [`packages/test-fixtures/src/fixtures/empty/events.json`](../../../packages/test-fixtures/src/fixtures/empty/events.json) in place:
   - Seq 1 (`session-created`, L2-14): add `created_at: "2026-01-01T00:00:00.000Z"` to the payload (currently L8-12 has only `host_user_id`, `privacy`, `topic`). Per the schema at [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L204-213, `created_at: z.string().datetime({ offset: true })` is required on the payload (separate from the envelope's own `created_at` column).
   - Seq 2/3/4 (`participant-joined`, L15-59): remove the extra `participant_id` field from each payload (currently L22, L37, L52). Per the schema at [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L223-231, only `user_id`, `role`, `screen_name`, `joined_at` are valid; `participant_id` is not declared and `validateEvent` rejects unknown fields. (The participant rows themselves live in [`packages/test-fixtures/src/fixtures/empty/participants.json`](../../../packages/test-fixtures/src/fixtures/empty/participants.json), where the participant ids continue to be authoritative — this fixture has always carried participants independently of the event log.)

2. **Loader API narrowing** — at [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts):
   - Make `LoadFixtureOptions.appendEvent` required (drop the `?` at L75-77).
   - Make `loadFixture`'s third parameter required (drop the `?` at L146).
   - Delete the raw-INSERT branch from `insertEvents` (L260-273); the function becomes a single normalize-then-validate-then-append loop.
   - Rewrite the file-header comment block (L1-47) — the "two modes" framing is obsolete; the new framing is "validate-then-append is the only mode; caller injects the helper to keep the leaf-package layering intact."

3. **Call-site flips** — five call sites in the test layer pass `{ appendEvent: appendSessionEvent }`:
   - [`tests/behavior/steps/fixtures.steps.ts`](../../../tests/behavior/steps/fixtures.steps.ts) L14, L18 (the two `loadFixture(name, this.client)` calls behind `When I load the "..." fixture` and `... again`). The L53 error-path call inside `try / catch` for the unknown-fixture scenario does not reach `insertEvents` (it throws at the listFixtures check) — but for type consistency it gets the same option too.
   - [`tests/behavior/steps/projection-cache.steps.ts`](../../../tests/behavior/steps/projection-cache.steps.ts) L72.
   - [`tests/behavior/steps/projection-incremental.steps.ts`](../../../tests/behavior/steps/projection-incremental.steps.ts) L89.
   - [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L180 (the parameterized `loadFixture(name, this.client)` behind `When I load the "..." fixture for projection` in [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) L20 — exercised today with `"empty"`).
   - All five files already import from `apps/server/src/` via relative path (the R23 walkthrough rewire established the pattern at [`tests/behavior/steps/projection-walkthrough-replay.steps.ts`](../../../tests/behavior/steps/projection-walkthrough-replay.steps.ts) L165, L180; backend-side steps at [`tests/behavior/steps/backend-create-session.steps.ts`](../../../tests/behavior/steps/backend-create-session.steps.ts) L35 do likewise). The `appendSessionEvent` import lands once per file, alongside the existing imports.

4. **Bypass-rationale cleanup** — at [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L184-217 the "I read the empty-fixture events out of session_events and project them" step builds `Event` envelopes by hand specifically to bypass `validateEvent` (per the L192-203 narrative on the loose payloads). With the fixture tightened, the bypass is no longer needed: the hand-rolled envelope construction at L204-215 collapses to `rows.map(rowToValidatedEvent)` (the helper already lives at L162-164). The L184-217 step body shrinks; the rationale comment at L192-203 is removed (the obsolete justification would mislead future readers); the `asEventKind` helper at L169-171 becomes dead code and is deleted with it. This is in-scope cleanup — the obsolete bypass is a load-bearing source of debt; leaving it would invite reintroduction of loose payloads.

5. **Two new Vitest cases** — see D3. (a) extends [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) with a per-event iteration through `validateEvent` for the empty fixture (mirroring the existing walkthrough cover at L90-107); (b) extends [`apps/server/src/events/fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts) with an end-to-end load of the empty fixture through the real `appendSessionEvent` helper, asserting the four expected rows land in `session_events`.

The walkthrough's 5 Cucumber scenarios, the existing 4 schema-cover Vitest cases at [`loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts), the empty fixture's 3 scenarios in [`tests/behavior/fixtures/load.feature`](../../../tests/behavior/fixtures/load.feature), the empty-fixture scenario in [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) L15-27, and the cache / incremental scenarios that load the empty fixture all stay green after the rewrite — they are the integration regression cover that the migration preserves end-to-end behavior.

## Why it needs to be done

**R23 closed half the divergence; this task closes the other half.** R23 routed the walkthrough fixture through `validateEvent` + `appendSessionEvent` but left the raw-INSERT branch in place so the bundled `empty` fixture could keep loading (its payloads predate the tightened Zod schemas — see [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L192-203 and the file-header rationale at [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts) L14-24). The branch is a documented technical-debt escape hatch; while it exists, any future fixture author can take the easy path of authoring loose payloads and have them work in tests — silently bypassing the schema gate that production write paths enforce. Closing the branch makes the loader fail loudly on the next loose-payload slip rather than swallowing it.

**The empty fixture is the canonical "fresh session" seed for many tests.** It seeds the cache scenarios at [`tests/behavior/steps/projection-cache.steps.ts`](../../../tests/behavior/steps/projection-cache.steps.ts) L72, the incremental-replay scenarios at [`tests/behavior/steps/projection-incremental.steps.ts`](../../../tests/behavior/steps/projection-incremental.steps.ts) L89, the loader's idempotency / unknown-fixture scenarios in [`tests/behavior/fixtures/load.feature`](../../../tests/behavior/fixtures/load.feature), and the projection round-trip scenario in [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) L15-27. Each of those tests is one place a future schema tightening could regress silently if the loader didn't enforce `validateEvent`. After this task they all transitively enforce the gate.

**It removes a load-bearing comment from the codebase.** The 23-line narrative at [`projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L184-217 explains why the step bypasses `validateEvent` — it's the kind of comment that future readers stumble over and copy without understanding ("oh, you can build `Event` envelopes by hand here"). Tightening the fixture lets the step use the canonical `rowToValidatedEvent` helper (already defined at L162-164) and lets the rationale disappear.

**It is the last data-and-methodology e2e task on the M7 critical path.** Per [`tasks/99-milestones.tji`](../../99-milestones.tji) L79, `m_end_to_end_debate` already depends on this task as one of four `dm_e2e_tests.*` entries; landing it unblocks the M7 progression without further fixture-migration scaffolding.

## Inputs / context

**Source files the implementer edits:**

- [`packages/test-fixtures/src/fixtures/empty/events.json`](../../../packages/test-fixtures/src/fixtures/empty/events.json) L1-60 — the fixture itself.
  - L8-12 — add `created_at: "2026-01-01T00:00:00.000Z"` to `session-created` payload (D1 picks the timestamp).
  - L22, L37, L52 — delete the `participant_id` line from each `participant-joined` payload.
- [`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts) L1-47, L75-77, L143-147, L239-274 — the file-header comment rewrite, the type narrowing on `LoadFixtureOptions` and `loadFixture`, the deletion of the raw-INSERT branch.
- [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) — adds the empty-fixture iteration case alongside the walkthrough cases (extending the existing file, mirroring the L90-107 shape).
- [`apps/server/src/events/fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts) — adds a second `describe` block / `it` case for the empty fixture, reusing the in-file `applyMigrations` helper and the same pglite setup (mirrors the walkthrough case at L133-134).
- [`tests/behavior/steps/fixtures.steps.ts`](../../../tests/behavior/steps/fixtures.steps.ts) L11, L13-19, L50-57 — add `appendSessionEvent` import; pass `{ appendEvent: appendSessionEvent }` to all `loadFixture` calls.
- [`tests/behavior/steps/projection-cache.steps.ts`](../../../tests/behavior/steps/projection-cache.steps.ts) L72 (and the imports block at the top) — same pattern.
- [`tests/behavior/steps/projection-incremental.steps.ts`](../../../tests/behavior/steps/projection-incremental.steps.ts) L89 (and the imports block) — same pattern.
- [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L177-218 (and the imports block) — pass `{ appendEvent: appendSessionEvent }` to L180; collapse the L184-217 step body to use `rowToValidatedEvent`; delete the L192-203 rationale comment and the `asEventKind` helper at L169-171.

**Source files the implementer reads (but does NOT edit):**

- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) L204-213 (`sessionCreatedPayloadSchema`), L223-231 (`participantJoinedPayloadSchema`), L703-730 (`eventPayloadSchemas` registry), L852-854 (`EventValidationError`), L865-901 (`validateEvent`). The schemas the tightened payloads must satisfy.
- [`packages/test-fixtures/src/fixtures/empty/participants.json`](../../../packages/test-fixtures/src/fixtures/empty/participants.json) — the participant rows (still 3, still in the canonical roles). The fixture's participant ids live here, not in the event payloads; removing `participant_id` from the payloads does not break the participant table.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) (`handleParticipantJoined` reads `user_id`, `role`, `screen_name`, `joined_at` from the payload; does NOT read `participant_id` — confirmed safety of the field removal). `handleSessionCreated` reads no payload fields at all — adding `created_at` is invisible to the dispatcher.
- [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) L57-62 (structural client), L88-106 (helper body). Helper does NOT include `created_at` in the INSERT — DB default fills in. This is the same behavior change R23 surfaced for the walkthrough; per its D2 the projection layer's behavior does not depend on payload `created_at` survival.
- [`apps/server/src/events/index.ts`](../../../apps/server/src/events/index.ts) — re-exports `appendSessionEvent` post-R23; the new call sites can import via the barrel or the direct file path matching the surrounding file's convention.
- [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) L82-117 — the walkthrough's per-event-iteration test that the empty-fixture case mirrors.
- [`apps/server/src/events/fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts) L1-60 (file-header rationale + `applyMigrations` helper), L133-134 (the walkthrough `loadFixture` calls that the new empty-fixture case sits beside).
- [`tests/behavior/fixtures/load.feature`](../../../tests/behavior/fixtures/load.feature) — the three scenarios (events count = 4, participants count = 3, idempotency on second load, unknown-fixture error) must continue to pass post-tightening. None of the assertions touch the payload fields being changed (all are DB-row counts or roles from `session_participants`, not from event payloads).
- [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) L15-27 — the empty-fixture projection scenario; its assertions are on projection state (`sessionState`, participant count, roles), not on payload fields, so it stays green with the simplified step.

**Architectural inputs:**

- [ADR 0006 — Vitest](../../../docs/adr/0006-test-framework-vitest.md) — the two new discipline tests live at the Vitest layer (one in `@a-conversa/test-fixtures`, one in `@a-conversa/server`), matching R23.
- [ADR 0007 — Cucumber + pglite](../../../docs/adr/0007-test-framework-behavior.md) — the Cucumber scenarios on top stay unchanged; they are the integration regression cover.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — validate-on-write contract. After this task, the loader honors it on every fixture load.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — both new discipline tests ship as committed Vitest cases.

## Constraints / requirements

- **Tightened payloads must satisfy `validateEvent` event-by-event.** Each of the 4 empty-fixture events round-trips through `rowToEnvelope` + `validateEvent` without throwing. The new Vitest case at `loader.test.ts` (D3a) pins this.
- **No new fixture files; only existing ones change.** The empty fixture remains a 4-event session-open seed; the change is purely payload-shape tightening. `meta.json`, `users.json`, `session.json`, `participants.json` are untouched.
- **`participant_id` is removed from event payloads only; it remains the authoritative key in `participants.json`.** The fixture's `session_participants` table rows continue to carry their independent participant ids (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa{1,2,3}`); projection dispatchers and `session_participants` queries are unaffected. The field's removal is from the event-log payload (where the schema rejects it) only.
- **The fixture's narrative `created_at` value matches what was previously on the envelope row.** Seq 1's `created_at` payload field gets `"2026-01-01T00:00:00.000Z"` — the same timestamp the envelope column carries today (events.json L13). Keeping them aligned avoids any surprise where a future reader sees the envelope and payload disagreeing on the session-creation instant.
- **`loadFixture`'s third parameter becomes required.** The `LoadFixtureOptions` type loses the `?` on `appendEvent`; the third parameter loses the `?` on the function signature. Type-level rejection at every prior call site is the migration trigger — the build will not compile until every call site is migrated. The runtime path is also single-branch: `insertEvents` has no fallback.
- **`appendEvent` callback signature is unchanged from R23.** Still `(client: LoadFixtureClient, event: Event) => Promise<void>`. All five new call sites pass `appendSessionEvent` — whose `(client: SessionEventAppendClient, event: Event): Promise<Event>` signature is structurally compatible with the loader's callback type (the loader does not care about the helper's return value; the structural-client interfaces overlap on `query`).
- **`created_at` semantics match R23 D2.** When the empty fixture is loaded via append-mode, `session_events.created_at` is populated by the DB default (`NOW()`), not the fixture's encoded timestamp. The empty-fixture-consuming tests do not read `session_events.created_at` (cache / incremental / projection-from-log scenarios all read projection state, not event-row timestamps), so the behavior change is invisible.
- **Layering invariant preserved.** `@a-conversa/test-fixtures` does NOT gain a workspace dep on `@a-conversa/server`. Callback injection remains the seam — same rationale as R23 D1.
- **No new package added; no Playwright cover.** This is `data_and_methodology.data_methodology_tests.dm_e2e_tests.*` (backend / loader), not UI-stream. Vitest + the existing Cucumber scenarios are the right cover. The UI-stream e2e policy does not apply to this task.
- **No new event kinds, no shared-types schema changes.** The fixture is brought into alignment with the existing schemas; the schemas themselves do not change.
- **`tests/behavior/fixtures/load.feature` assertions stay green.** Event count = 4 (unchanged); participant count = 3 (unchanged); participant roles = moderator / debater-A / debater-B (unchanged — these come from `session_participants`, not the event payloads).
- **`tests/behavior/projection/from-log.feature` L15-27 stays green.** The simplified step body produces the same projection (`sessionState: "open"`, 3 participants in the canonical roles, 0 nodes / edges / pending) because the dispatcher reads the same fields it always read; tightening just removes an extra `participant_id` field the dispatcher ignored and adds a `created_at` field the `session-created` handler also ignores.
- **Cache and incremental scenarios stay green.** Their assertions are on `lastAppliedSequence`, participant fingerprints (built from `userId`, not `participant_id`), and projection equality — all preserved.
- **Test discipline per ADR 0022.** Both new discipline tests are committed Vitest cases; no transient verification.

## Acceptance criteria

**Pinned per ADR 0022 — every check ships as committed test code.**

Fixture tightening:

- [ ] **`packages/test-fixtures/src/fixtures/empty/events.json` seq 1 (`session-created`) payload now carries `created_at: "2026-01-01T00:00:00.000Z"`** alongside the existing `host_user_id` / `privacy` / `topic` fields.
- [ ] **`packages/test-fixtures/src/fixtures/empty/events.json` seq 2, 3, 4 (`participant-joined`) payloads no longer carry the extra `participant_id` field.** Each payload retains only `user_id`, `role`, `screen_name`, `joined_at`.
- [ ] **No other fixture file under `packages/test-fixtures/src/fixtures/empty/` is edited.**

Loader narrowing:

- [ ] **`LoadFixtureOptions.appendEvent` is required (no `?`).**
- [ ] **`loadFixture`'s third parameter is required (no `?`).**
- [ ] **The raw-INSERT branch is removed from `insertEvents`.** The function has a single normalize-then-validate-then-append loop.
- [ ] **The `loader.ts` file-header comment is rewritten** to describe the single-mode behavior; the "two modes" framing is gone; the registered-follow-up note (which pointed at this task) is removed.
- [ ] **Type signature changes propagate to `packages/test-fixtures/src/index.ts`** if the index re-exports `LoadFixtureOptions` — the public surface matches the new required-callback shape.

Call-site migration:

- [ ] **All `loadFixture('empty', client)` call sites pass `{ appendEvent: appendSessionEvent }`:**
  - [`tests/behavior/steps/fixtures.steps.ts`](../../../tests/behavior/steps/fixtures.steps.ts) L14, L18, L53.
  - [`tests/behavior/steps/projection-cache.steps.ts`](../../../tests/behavior/steps/projection-cache.steps.ts) L72.
  - [`tests/behavior/steps/projection-incremental.steps.ts`](../../../tests/behavior/steps/projection-incremental.steps.ts) L89.
  - [`tests/behavior/steps/projection-from-log.steps.ts`](../../../tests/behavior/steps/projection-from-log.steps.ts) L180.
- [ ] **`appendSessionEvent` is imported into each of those five files** via relative path (matching R23's pattern in `projection-walkthrough-replay.steps.ts`) or via the `@a-conversa/server`-style path used by sibling backend-* steps — implementer's call per file convention.
- [ ] **A `tsc` / `pnpm run check` pass would fail before this step is complete** — the required-callback type signature is what makes the migration discoverable.

Bypass-rationale cleanup:

- [ ] **`projection-from-log.steps.ts` L184-217 step body simplifies to `rowToValidatedEvent`.** The hand-rolled envelope construction at L204-215 is replaced with `const events: Event[] = rows.map(rowToValidatedEvent);`.
- [ ] **The L192-203 rationale comment is removed** (the loose-payload narrative no longer applies).
- [ ] **The `asEventKind` helper at L169-171 is removed** (no remaining callers after the cleanup).

New Vitest cases:

- [ ] **`packages/test-fixtures/src/loader.test.ts` gains "empty fixture event-log schema cover".** A new `describe` block whose `it` iterates the 4 empty-fixture events through `validateEvent` (mirroring the walkthrough cover at L90-107). Loads the fixture file via `readFile(join(FIXTURES_DIR, 'empty', 'events.json'), 'utf8')` and asserts every event validates. Per D3 this pins the structural assertion.
- [ ] **`apps/server/src/events/fixture-append-mode.test.ts` gains "empty fixture load through append-mode".** A new `it` case loads the empty fixture via the real `appendSessionEvent` against a fresh pglite handle (reusing the in-file `applyMigrations` helper), `SELECT`s `(id, session_id, sequence, kind, actor, payload)` from `session_events`, and asserts exactly 4 rows with the expected `(sequence, kind, actor)` triples per fixture order. Per D3 this pins the end-to-end load contract.

Existing tests stay green:

- [ ] All three scenarios in [`tests/behavior/fixtures/load.feature`](../../../tests/behavior/fixtures/load.feature) pass.
- [ ] The empty-fixture scenario in [`tests/behavior/projection/from-log.feature`](../../../tests/behavior/projection/from-log.feature) L15-27 passes.
- [ ] The cache and incremental scenarios that consume the empty fixture pass.
- [ ] All Cucumber scenarios using the walkthrough fixture (`tests/behavior/projection/walkthrough-replay.feature`) pass.
- [ ] All existing Vitest cases in [`packages/test-fixtures/src/loader.test.ts`](../../../packages/test-fixtures/src/loader.test.ts) pass — the walkthrough's three schema-cover cases, the listFixtures case, and the R23 validation-gate case.
- [ ] The walkthrough semantics-preservation case in [`apps/server/src/events/fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts) — note that with the raw-INSERT branch removed, the existing R23 case at L133-134 NO LONGER HAS A RAW-INSERT MODE TO COMPARE AGAINST. Per D4 below the case is reframed to a single load through append-mode asserting the projection-relevant column shape; the two-mode comparison framing is replaced.
- [ ] All other existing Vitest suites pass — including [`apps/server/src/projection/replay.test.ts`](../../../apps/server/src/projection/replay.test.ts).
- [ ] All existing Playwright suites pass.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/test-fixtures build` clean.
- [ ] `pnpm -F @a-conversa/server build` clean.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by 2 (the two new cases) and the R23 walkthrough-comparison case loses a `describe`/`it` if it folded; per D4 the net delta is +1 on `loader.test.ts` (empty schema cover) and the existing `fixture-append-mode.test.ts` case is reshaped, not removed.
- [ ] `pnpm run test:behavior:smoke` green; Cucumber baseline unchanged.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `empty_fixture_payload_tighten_for_append_mode` after `allocate team` (L588-589). The milestone `m_end_to_end_debate` already lists this task in its `depends` block at [`tasks/99-milestones.tji`](../../99-milestones.tji) L79 — no milestone-side edit is needed.

Tech-debt registration:

- [ ] **None.** This task is itself the registered follow-up that R23 created; closing it closes the raw-INSERT vs. append-API divergence for all bundled fixtures. No further fixture-migration work is needed at this layer.

## Decisions

- **D1 — Tighten the payloads in place; do NOT add a "v2-empty" fixture alongside the existing one.** Rationale:
  - **The current empty fixture has no production-equivalent dependency on its loose payloads.** The dispatcher reads `user_id` / `role` / `screen_name` / `joined_at` (confirmed by reading `apps/server/src/projection/replay.ts` `handleParticipantJoined`); `session_participants` rows live in their own fixture file. Removing `participant_id` and adding `created_at` does not break any current consumer.
  - **The narrative timestamp choice (`2026-01-01T00:00:00.000Z`) matches the envelope row.** Each event in the fixture already carries an envelope-level `created_at` (L13, L28, L43, L58 of `events.json`); seq 1's payload `created_at` gets the same value as its envelope so the narrative is self-consistent for human readers.
  - **A versioned-coexistence approach would double the surface area.** Two empty fixtures means two sets of callers to keep aligned, two sets of comments explaining "use the v2 one because v1 has loose payloads," and a longer-lived bypass-rationale comment at `projection-from-log.steps.ts`. The opposite of debt reduction.
  - **Alternative considered: leave the empty fixture's payloads untightened and add a small `appendEvent`-shaped wrapper that re-keys participant payloads on the fly.** Rejected — preserves the loose payloads on disk, where future fixture-authoring will reach for them as a template; the goal is to eliminate the loose-payload template from the repo, not paper over it.
  - **Alternative considered: extend the `participant-joined` schema to accept `participant_id` (Zod `.passthrough()` or `.optional()`).** Rejected — broadens the production schema to accommodate a test-fixture quirk; reverses the intended direction of ADR 0021 (the tightened-schema-on-write invariant).

- **D2 — Make `appendEvent` mandatory; remove the raw-INSERT branch entirely.** Rationale:
  - **The whole point of this task is to close the divergence.** Leaving a raw-INSERT branch — even as a dormant internal path — invites reintroduction of loose-payload fixtures by future authors who take the easy path. Removing the branch makes the schema gate a compile-time-and-runtime invariant of the loader.
  - **All five known call sites are reachable from `apps/server/src/`.** Per the import-pattern evidence in `tests/behavior/steps/backend-*.steps.ts`, the `tests/behavior/` layer freely imports backend modules; the same layer is where every `loadFixture` call lives. Wiring `appendSessionEvent` at each call site is the established convention.
  - **Type-level required-ness is the migration trigger.** Dropping the `?` on `LoadFixtureOptions.appendEvent` means `pnpm run check` fails until every caller is migrated — far better than a runtime "you must pass appendEvent" check that would only surface on a code path some test happens to take.
  - **Alternative considered: keep the raw-INSERT branch as an internal escape hatch, but flip every known caller to append-mode.** Rejected — leaves the loose-payload template alive in the codebase; future fixture authors will find the raw-INSERT branch and use it.
  - **Alternative considered: keep the raw-INSERT branch but add `validateEvent` to it (so it validates but writes via raw SQL).** Rejected — produces a third mode (validate-then-raw-INSERT) whose only consumer is "callers that don't want to wire `appendEvent`," which after this task does not exist. The dual-mode-with-validation framing is a worse seam than single-mode-required.
  - **Alternative considered: make the loader directly import `appendSessionEvent` (eliminate the callback-injection seam).** Rejected — same layering inversion R23 D1 rejected. The leaf-package invariant on `@a-conversa/test-fixtures` is load-bearing.

- **D3 — Two Vitest cases at different layers: structural in `loader.test.ts`, end-to-end in `fixture-append-mode.test.ts`.** Rationale:
  - **Each case pins a distinct contract.** The structural case asserts "the on-disk empty fixture is now schema-valid" — a per-event iteration through `validateEvent` analogous to the walkthrough's L90-107 cover. The end-to-end case asserts "the tightened fixture, loaded via the real `appendSessionEvent` against a real pglite handle, produces the four expected `session_events` rows." Bundling them into one case loses the diagnostic signal on which property failed.
  - **The cases live in the same files R23 established for the walkthrough.** `loader.test.ts` holds the per-fixture iteration tests; `fixture-append-mode.test.ts` holds the end-to-end pglite tests. Symmetric placement makes the test surface easy to navigate.
  - **The end-to-end case does not need a two-mode comparison.** R23's case compared the walkthrough across raw-INSERT and append-mode to show semantics-preservation in the migration moment. Post-D2 there is only one mode, so the empty-fixture case just asserts the rows are present and well-shaped (`(sequence, kind, actor)` triples in the expected order). Per D4 the R23 case itself is reshaped to match.
  - **Alternative considered: a single combined Vitest case that loads the empty fixture and validates as a side effect.** Rejected — loss of diagnostic signal on whether a failure is about the fixture's shape or the loader's behavior.
  - **Alternative considered: a Cucumber scenario in `tests/behavior/fixtures/load.feature` asserting "every event payload validates."** Rejected — Cucumber prose for "every event validates against its Zod schema" is awkward; Vitest at the package layer matches the existing pattern. The existing load.feature scenarios continue to act as the integration regression cover.

- **D4 — Reshape R23's `fixture-append-mode.test.ts` walkthrough case rather than delete it.** With the raw-INSERT branch removed (per D2), the case's current two-mode comparison framing is meaningless — there is no raw-INSERT mode to compare against. The case is rewritten to a single load through append-mode that asserts the projection-relevant column shape (`(id, session_id, sequence, kind, actor)` round-trips; `payload` is non-null JSONB; row count matches the fixture's event count). Rationale:
  - **The contract that mattered survives — what changes is the framing.** The original purpose was "fixture-loader writes the same rows production would write." Post-D2 this is "fixture-loader writes well-shaped rows via the production helper" — same contract, simpler check.
  - **Keeping the case live is the regression cover.** Deleting it would lose the only pglite-backed assertion that `loadFixture('walkthrough', ...)` produces a complete event log; the Cucumber walkthrough-replay scenarios assert on projection state, not on row-level shape.
  - **Symmetric to the new empty-fixture case.** Both cases become "load + assert row shape" — the file's test surface is uniform.
  - **Alternative considered: delete the R23 case entirely** since the Cucumber walkthrough-replay scenarios cover the integration. Rejected — loses the row-shape pin at the layer where it is cheapest to assert.

- **D5 — Empty fixture's `created_at` payload value matches the envelope row's value.** Seq 1's payload `created_at` gets `"2026-01-01T00:00:00.000Z"`, the same value as `events.json` L13. Rationale:
  - **Self-consistent narrative for human readers.** A future maintainer reading the fixture sees the envelope `created_at` and the payload `created_at` agree on when the session was created — no implicit "the envelope says X but the payload says Y" mystery.
  - **The DB-stored row's `created_at` falls back to `NOW()`** (per the helper's INSERT contract), so the encoded payload `created_at` is narrative-only at load time — the same status it has on disk today. The fixture's encoded envelope `created_at` is similarly narrative-only post-tightening (the envelope `created_at` is not preserved either, since the helper writes only the six core columns).
  - **Alternative considered: pick `"2026-05-30T00:00:00.000Z"`** (the R23 ship date) or some other "more recent" timestamp. Rejected — gratuitous departure from the fixture's existing temporal anchor; the existing timestamps are coherent with the participant `joined_at` values and the user `created_at` values in `users.json`.

- **D6 — The bypass-rationale cleanup at `projection-from-log.steps.ts` L184-217 is in scope, not deferred.** Rationale:
  - **The rationale comment is a load-bearing piece of misleading information once the fixture is tightened.** It tells future readers "the empty fixture's payloads are loose; build envelopes by hand to bypass `validateEvent`" — which is no longer true. Leaving it pollutes the codebase with reverse-true documentation.
  - **The replacement is one line** (`const events: Event[] = rows.map(rowToValidatedEvent);`) — the helper already exists at L162-164; the cleanup is mechanical.
  - **It removes dead helpers too.** `asEventKind` at L169-171 becomes unreachable; its sole caller is the L210 hand-rolled envelope construction.
  - **The from-log.feature L15-27 scenario must continue to pass.** The simplified step's assertions are projection-state assertions (`sessionState`, participant count, roles); none of them are affected by whether the envelope was built by hand or via `rowToValidatedEvent`.
  - **Alternative considered: leave the bypass comment and hand-rolled envelope path in place** (the fixture passing `validateEvent` does not strictly require the step to use `rowToValidatedEvent`). Rejected — leaves a load-bearing-but-now-false comment in the codebase; the next reader will trip on it.

## Open questions

(none — all decided in D1–D6. The only implementation-time judgment call is which import path each of the five step files uses for `appendSessionEvent` — barrel via `@a-conversa/server`-style relative path vs. direct `events/append.js` file — and that's settled by "match the existing import style in each file," consistent with R23 D6.)

## Status

**Done** — 2026-05-30.

- `packages/test-fixtures/src/fixtures/empty/events.json` — added `created_at: "2026-01-01T00:00:00.000Z"` to seq-1 (`session-created`) payload; removed `participant_id` from seq 2/3/4 (`participant-joined`) payloads.
- `packages/test-fixtures/src/loader.ts` — made `appendEvent` required on `LoadFixtureOptions`; removed raw-INSERT escape branch from `insertEvents`; rewrote file-header comment to single-mode framing.
- `packages/test-fixtures/src/index.ts` — updated `LoadFixtureOptions` public-surface comment to reflect required callback.
- `packages/test-fixtures/src/loader.test.ts` — added "empty fixture event-log schema cover" describe block iterating all 4 events through `validateEvent`.
- `packages/test-fixtures/README.md` — refreshed public-API example; removed R23 deferred-work note (this task closes it).
- `apps/server/src/events/fixture-append-mode.test.ts` — reshaped walkthrough case to single-load row-shape check (removed two-mode comparison per D4); added "loadFixture append-mode — empty fixture row shape" describe block loading via real `appendSessionEvent` against pglite, asserting 4 rows with expected (sequence, kind, actor) triples.
- `tests/behavior/steps/fixtures.steps.ts` — added `appendSessionEvent` import + `appendForFixture` bridge; passed `{ appendEvent: appendForFixture }` at all 3 `loadFixture` call sites.
- `tests/behavior/steps/projection-cache.steps.ts` — same import + bridge pattern; passed option.
- `tests/behavior/steps/projection-incremental.steps.ts` — same import + bridge pattern; passed option.
- `tests/behavior/steps/projection-from-log.steps.ts` — same import + bridge pattern; passed option; collapsed empty-fixture step body to `rows.map(rowToValidatedEvent)`; removed `asEventKind` helper, bypass-rationale comment, and stale `EventKind` import; refreshed file-header comment.
