# Refinement — `landing_page.landing_walkthrough_seed`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:42-54`
(`task landing_page.landing_walkthrough_seed`). Gates milestone M8-landing via
`walkthrough_demo_stepper` (`tasks/47-landing-page.tji:116-128`,
`depends !landing_walkthrough_seed`) and through it the rest of the landing
chain.

## Effort estimate

`0.5d` (from the `.tji` block). This is a packaging / location task — copy a
frozen asset, wrap it in a thin typed module, and pin the copy with tests. No
content authoring.

## Inherited dependencies

`depends data_and_methodology.data_methodology_tests.dm_e2e_tests.walkthrough_replay_e2e`
— the task that encoded and validated the "Should zoos exist?" walkthrough
event log. The following are **settled** and inherited as-is:

- **The canonical log exists and is frozen.** 266 events live at
  `packages/test-fixtures/src/fixtures/walkthrough/events.json` (3,966 lines, a
  JSON array of event envelopes). Decision R (2026-05-30) on the `.tji` note
  is **use it as-is — no fresh authoring, no content rewrite**.
- **Every event is schema-valid.** `walkthrough_replay_e2e` validated all 266
  events with `validateEvent` (`packages/shared-types/src/events.ts:918`) and
  replayed the full log through the projector under Cucumber + pglite
  (`tests/behavior/projection/walkthrough-replay.feature`), asserting the
  committed/disputed/axiom-marked end state. The log is a tested, deterministic
  artifact — this task does not re-validate its *content*, only guards its
  *copy*.
- **Event envelope shape.** Each record has `{ id, session_id, sequence, kind,
  actor, payload, created_at }`; `Event` is a discriminated union on `kind`
  (`packages/shared-types/src/events.ts:861-863`).

**Pending:** none. The source asset is committed and green.

## What this task is

Expose the frozen walkthrough event log as a **shippable production asset** the
landing bundle can load, instead of reaching into the test-only
`@a-conversa/test-fixtures` package. Concretely:

1. Copy `packages/test-fixtures/src/fixtures/walkthrough/events.json` verbatim
   into `apps/root` as a bundled asset (proposed:
   `apps/root/src/walkthrough/walkthrough-events.json`).
2. Add a thin typed module (proposed: `apps/root/src/walkthrough/index.ts`)
   that imports that JSON and exports it as `readonly Event[]`, typed against
   the canonical `@a-conversa/shared-types` `Event` type — the exact shape the
   `@a-conversa/graph-view` `GraphView` consumes
   (`packages/graph-view/src/GraphView.tsx:351`, `readonly events: readonly
   Event[]`).
3. Pin the copy with Vitest: a drift guard asserting the shipped copy is
   structurally identical to the canonical fixture, plus a `validateEvent`
   sweep over the shipped array.

"Curated" in the task title means *the canonical log, used in full* — there is
no subsetting here. Choosing which steps the demo pauses on is the narration
script's job (`walkthrough_narration_script`,
`tasks/47-landing-page.tji:102-114`); the seed ships every event.

## Why it needs to be done

`walkthrough_demo_stepper` (`tasks/47-landing-page.tji:116-128`) is the
interactive demo at the heart of the landing page: it loads the seed log and,
on each scrubber position, projects `events[0..pos]` and re-renders through
`@a-conversa/graph-view`. That demo ships in production (`apps/root`), so it
needs the event log as a **production** asset.

The canonical log today lives in `@a-conversa/test-fixtures`, which is
`"private": true` (`packages/test-fixtures/package.json:4`) and exists to seed
databases in backend/Cucumber tests via a `loadFixture(name, client)` loader
that requires a DB client (`packages/test-fixtures/src/loader.ts`,
`packages/test-fixtures/src/index.ts:11-12`). Pulling a test fixtures package —
and its DB-oriented loader — into the production landing bundle is exactly what
the `.tji` note forbids: *"expose it as a shippable production asset rather than
importing from a test-only fixtures package."* This task creates the clean
production seam the demo builds on.

## Inputs / context

- **Source asset (copy from):**
  `packages/test-fixtures/src/fixtures/walkthrough/events.json` — 266-event
  JSON array, the canonical "Should zoos exist?" log.
- **Test-fixtures package is private / test-only:**
  `packages/test-fixtures/package.json:4` (`"private": true`), public API is
  the DB-loader at `packages/test-fixtures/src/index.ts:11-12`. No barrel
  re-exports `events.json` as data; no non-test consumer exists today.
- **Canonical `Event` type + validator:**
  `packages/shared-types/src/events.ts:861-863` (`Event`, a discriminated union
  on `kind`) and `:918` (`validateEvent`).
- **Consumer's prop contract:** `packages/graph-view/src/GraphView.tsx:351`
  (`readonly events: readonly Event[]`), importing `Event` from
  `@a-conversa/shared-types` (`packages/graph-view/src/GraphView.tsx:319`).
  graph-view does **not** re-export `Event`.
- **apps/root build + deps:** Vite 8 (`apps/root/vite.config.ts`); current
  `dependencies` are `@a-conversa/i18n-catalogs`, `@a-conversa/shell`, `react`,
  `react-dom`, `react-router-dom` (`apps/root/package.json`). It does **not**
  yet depend directly on `@a-conversa/shared-types` (it gets it transitively
  via `@a-conversa/shell`). No `apps/root/public/` directory exists.
- **JSON-import precedent in this monorepo:**
  `packages/i18n-catalogs/src/config.ts` uses
  `import enUS from './catalogs/en-US.json' with { type: 'json' };` — the
  established pattern for a typed JSON import into a TS module.
- **Deliberate relative-path-import precedent (avoid the package):**
  `tests/behavior/steps/fixtures.steps.ts:11` imports the loader by relative
  path specifically to avoid depending on `@a-conversa/test-fixtures` as a
  package.
- **Predecessor refinement:**
  `tasks/refinements/data-and-methodology/walkthrough_replay_e2e.md` (fixture
  encoding + projector-replay validation, Done 2026-05-30).
- **Refinement shape:** `tasks/refinements/README.md`.

## Constraints / requirements

1. **Verbatim copy.** The shipped asset must be structurally identical to
   `packages/test-fixtures/src/fixtures/walkthrough/events.json` — all 266
   events, same order, same payloads. No content rewrite, no subsetting, no
   reordering.
2. **No production dependency on `@a-conversa/test-fixtures`.** `apps/root`
   must not gain a `dependencies` *or* `devDependencies` entry on the private
   test-fixtures package, and the production bundle must not import its loader.
   The seam exists precisely to sever that link.
3. **Typed at the seam.** The exported module must be typed `readonly Event[]`
   (`@a-conversa/shared-types`) so `walkthrough_demo_stepper` can pass it
   straight to `GraphView` without a cast at the call site. This means adding
   `@a-conversa/shared-types` as a **direct** dependency of `apps/root`
   (promoting the currently-transitive dep), keeping the import non-phantom.
4. **Bundle-loadable, no runtime fetch required.** The asset is imported as a
   module (Vite JSON import), not fetched from a `public/` URL. The module's
   shape (a single default/named export of the array) must remain compatible
   with `await import()` code-splitting so a later task
   (`walkthrough_demo_stepper` / `landing_demo_mobile_fallback`) can lazy-load
   it off the initial paint without restructuring this module.
5. **No runtime validation in the prod path.** `validateEvent` runs in the
   test, not on page load — the asset is frozen and test-pinned, so paying to
   re-parse 266 events on every visit buys nothing. The prod module uses a
   static cast; the drift + validation tests guarantee the cast is sound.
6. **No `.tji` edits, no commit, no ADR to the fixture.** This refinement only
   describes the work; the implementer lands code, the closer updates the WBS.

## Acceptance criteria

Per ADR 0022 (no throwaway verifications) every check below is a durable,
committed test artifact — no scratch scripts.

**Vitest (in `apps/root`):**

1. **Module loads and is non-empty.** Importing the seed module yields a
   `readonly Event[]` of length 266; `events[0].kind === 'session-created'`
   (the first envelope) and the topic payload is `"Should zoos exist?"`.
2. **Drift guard.** A test reads the canonical fixture
   (`packages/test-fixtures/src/fixtures/walkthrough/events.json`, via a
   test-only relative-path JSON import — not a package dependency, mirroring
   `tests/behavior/steps/fixtures.steps.ts:11`) and asserts **deep structural
   equality** with the shipped copy. If the two ever diverge, this test fails
   loudly — that is the entire guard against silent drift between the canonical
   log and its shipped copy.
3. **Schema sweep.** `validateEvent` (`@a-conversa/shared-types`) is run over
   every event in the shipped array and all 266 pass — the shipped copy is a
   valid `Event[]`, justifying the static cast in the prod module.

**Full-suite gate:** `apps/root`'s existing Vitest suite stays green; the
workspace build (`apps/root` Vite build) succeeds with the new module and the
promoted `@a-conversa/shared-types` dependency; lint/typecheck clean. Run per
the global build-and-test gate before the closer commits.

**Playwright e2e — deferred, because the surface is not yet reachable.** This
task ships a data module + a typed loader; **nothing renders it** (no route
mounts the demo, no event surface drives it) until `walkthrough_demo_stepper`
lands. Per the UI-stream e2e policy this is a true deferral, and the
unit/component coverage above stands in for now. The Playwright coverage is
**already owned by existing WBS leaves** that both depend (transitively or
directly) on this task:

- `walkthrough_demo_stepper` (`tasks/47-landing-page.tji:116-128`) — mounts
  `@a-conversa/graph-view` over this seed and steps it; its refinement scopes
  the component/Playwright coverage that first renders the seed.
- `landing_e2e` (`tasks/47-landing-page.tji:168-178`) — the anonymous-visit
  spec that steps the demo through to its final graph state.

**No new e2e task is registered** — the deferral points at leaves that already
exist and already depend on this work, so it adds no inherited-debt to any
`*_pw_*` catch-all.

No Cucumber scenario is in scope: this task changes no wire behavior, broadcast
shape, or projector output. The fixture's projector-replay behavior is already
pinned by `walkthrough_replay_e2e`'s Cucumber feature; the seed is consumed by
a pure client projector downstream.

## Decisions

1. **Co-locate the asset in `apps/root`, do not create a new package.** Only
   one consumer exists today — the landing demo in `apps/root`. The seed is
   shipped as `apps/root/src/walkthrough/`.
   - *Rationale:* bias toward the simpler abstraction with one call site.
     Contrast `extract_readonly_graph_package`, which created
     `@a-conversa/graph-view` precisely because it had **two** consumers
     (`apps/audience` + `apps/root`); a workspace package + its ADR/boundary is
     justified by shared consumption, which the seed does not have.
   - *Rejected:* a new `@a-conversa/walkthrough-seed` workspace package —
     premature; it would carry a package boundary and an ADR for a
     single-consumer JSON blob. If a second surface ever needs the curated
     seed, promote it then (the typed module is a clean lift).

2. **Copy the JSON; do not import the fixture across the package boundary in
   prod.** The shipped asset is a committed copy under `apps/root`, guarded by
   a drift test — not a relative-path import of the test-fixtures file in
   production code.
   - *Rationale:* the `.tji` note mandates severing the production→test-package
     link; a committed copy makes the asset's provenance explicit and lets the
     prod bundle stand alone. The drift guard (criterion 2) makes the canonical
     relationship loud and machine-checked rather than relying on discipline.
   - *Rejected:* a build-time copy/codegen script — adds build machinery, hides
     the asset behind generation, and a stale generated file that still passes
     would be worse than a committed file a test compares. A committed copy +
     failing-on-drift test is the ADR-0022-aligned pin.
   - *Rejected:* importing the canonical fixture by relative path in production
     code (à la the test-step precedent) — that keeps the prod bundle coupled to
     a `private` test package's internal layout, exactly what the task removes.
     The relative-path read is used **only in the test** (criterion 2), where
     coupling to the canonical source is the point.

3. **Bundle as a typed module import; leave a lazy-load seam, don't take it.**
   The asset is a JSON import wrapped in a `readonly Event[]` module (Vite
   native JSON import, per `packages/i18n-catalogs/src/config.ts`). The module
   shape stays `await import()`-friendly.
   - *Rationale:* the demo needs the full log to step through it; a runtime
     `fetch` from `public/` would add a request plus loading/error states for
     no benefit on a frozen asset. Whether to code-split the ~4k-line blob off
     the initial hero paint is a demo/perf decision owned by
     `walkthrough_demo_stepper` and `landing_demo_mobile_fallback`; this module
     is shaped to allow it without rework. (If initial-bundle size becomes a
     concern, those tasks switch to `await import('./walkthrough')` — no change
     here.)
   - *Rejected:* shipping to `apps/root/public/` and fetching at runtime —
     defers a decision the demo tasks are better placed to make and forces
     loading-state handling now; not warranted for a small frozen asset.

4. **Promote `@a-conversa/shared-types` to a direct `apps/root` dependency.**
   The typed export needs the canonical `Event` type, currently reached only
   transitively via `@a-conversa/shell`.
   - *Rationale:* importing a type from a transitively-resolved package is a
     phantom dependency (ADR 0010, pnpm workspace hygiene); a direct import
     gets a direct dep. `validateEvent` for the test sweep lives in the same
     package, so the one dependency serves both the typed export and the test.
   - *Rejected:* exporting the seed as `unknown[]` and casting at the
     `GraphView` call site — pushes the cast to every consumer and drops type
     safety at the seam this task is creating.

5. **No ADR.** This task reuses existing seams only — Vite JSON import, an
   `apps/root/src` module, the established `Event` type, the test-fixtures
   source. It introduces no new dependency (the shared-types promotion is an
   existing workspace package), no new architectural boundary, and no
   security-relevant trade-off.
   - *Rationale:* same call as `split_public_and_home_routes` (D6) — a
     packaging task on existing seams does not clear the ADR bar. The decisions
     above are recorded here, which is where task-scope decisions belong.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Created `apps/root/src/walkthrough/walkthrough-events.json` — verbatim, byte-identical copy of the canonical fixture at `packages/test-fixtures/src/fixtures/walkthrough/events.json` (266 events, "Should zoos exist?" log).
- Created `apps/root/src/walkthrough/index.ts` — typed seed module exporting `readonly Event[]`; performs a cheap outer-envelope key-rename (snake_case → camelCase) so the export is type-sound with the `Event` discriminated union; payload forwarded untouched.
- Created `apps/root/src/walkthrough/index.test.ts` — Vitest suite "walkthrough seed" with 3 specs: module-loads (266 events, `session-created`, topic "Should zoos exist?"), drift guard (deep-equal vs canonical fixture via runtime `readFile`), and schema sweep (`validateEvent` over all 266 events).
- Updated `apps/root/package.json` — promoted `@a-conversa/shared-types` to a direct dependency (previously transitive via `@a-conversa/shell`).
- Updated `apps/root/tsconfig.json` — added `shared-types` project reference; widened `include` to glob `.json` (mirroring `i18n-catalogs`).
- Updated `pnpm-lock.yaml` — regenerated for the new direct dependency.
- Deviations (both in-scope, no new task): (1) snake_case→camelCase outer-envelope rename in the module (not Zod validation) for type soundness; (2) drift guard uses runtime `readFile` instead of static JSON import to avoid `TS6307/TS6059` under `apps/root`'s composite `tsc -b`.
- Playwright e2e deferred per refinement — surface not yet reachable; coverage owned by `walkthrough_demo_stepper` and `landing_e2e` (existing WBS leaves).
