# Pin server↔Wire coherency-hint kind parity (catch *server-union-grows-but-Wire-mirror-lags* drift)

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.coherency_hint_server_kind_parity_test` (lines 225–230).

> Path note: this refinement lives in `tasks/refinements/shell-package/` (hyphen) alongside its 15 siblings and matching the `tasks/refinements/shell-package/…` references the WBS itself uses. The task id's area segment is `shell_package` (underscore); the on-disk directory is `shell-package`.

## Effort estimate

0.5d (`effort 0.5d`, `allocate team`). One new test file plus, at most, no config change: a committed compile-time + runtime parity assertion that the server's `HintKind` set and the shell's `WireCoherencyHint['kind']` set are mutually exhaustive. No source change, no wire change, no server change, no new dependency edge.

## Inherited dependencies

- **Settled — `shell_package.coherency_hint_wire_mirror_exhaustiveness`** (`depends !coherency_hint_wire_mirror_exhaustiveness`, [tasks/27-shell-package.tji:217–223](../../27-shell-package.tji)). Refinement: [coherency_hint_wire_mirror_exhaustiveness.md](coherency_hint_wire_mirror_exhaustiveness.md) (status **Done — 2026-06-05**). That task added explicit exhaustive `never`-defaults to every switch over `WireCoherencyHint['kind']`/`WireDiagnostic['kind']` in `packages/shell/src/diagnostics/diagnostic-highlights.ts` and removed the silent `default: return []` in `apps/test-mode/src/diagnostics/DiagnosticInspector.tsx`. It closed the *Wire-union-grows-but-a-switch-lags* drift class at compile time. Its **Acceptance criteria → Residual gap** and **Decision §3** explicitly registered *this* task to close the complementary, still-open drift class.

- **Transitive source of debt — `replay_test.test_mode.test_mode_diagnostic_inspector_e2e_tracking`** (2026-06-05). The original Playwright timeout: the shell's `WireCoherencyHint` union silently lagged the server's `HintKind` union by three annotation-family kinds, so a `non-self-referential-annotation-contradicts` hint hit a swallowing default and never rendered. The predecessor fixed the *data* drift and the *silent-default* structural hole; the *cross-boundary parity* hole — the one that lets the Wire mirror lag the server in the first place — is what this task pins.

## What this task is

Add a single committed test that asserts the **server's `HintKind` set and the shell's `WireCoherencyHint['kind']` set are equal** — every server hint kind is mirrored by exactly one Wire kind and vice-versa — so that a server-side hint-kind addition (or removal/rename) **fails a test even when nobody touches the shell's Wire mirror**.

This is the *complementary cross-boundary assertion* to the predecessor's per-switch exhaustiveness guards. The exhaustiveness guards make each shell switch total *against the shell's own union*; they cannot detect that the shell's union itself has fallen behind the server. Only an assertion that imports **both** unions into one compile unit can. This refinement homes that assertion in the **`tests/` cross-workspace tree** — the one tree in the repo that, by documented design, reaches into both `apps/server/src/**` and `packages/**/src` — rather than in `apps/test-mode` (see **Decision §1** for why the predecessor's tentatively-named home is superseded).

Concretely, a new file `tests/smoke/coherency-hint-kind-parity.test.ts`:

1. **Type-only deep-relative imports** of `HintKind` (from `apps/server/src/diagnostics/coherency-hint-detection.ts`) and `WireCoherencyHint` (from `packages/shell/src/diagnostics/diagnostic-highlights.ts` via the shell barrel) — both erased at runtime, so no runtime workspace resolution and **no new dependency edge** is introduced.
2. **Compile-time directional assertions** that `HintKind` is assignable to `WireCoherencyHint['kind']` *and* the reverse — mutual exhaustiveness. Drift in either direction makes one assignment fail `tsc`.
3. **A runtime set-equality pin** using two exhaustive `Record<…, true>` object literals (one keyed by `HintKind`, one by `WireCoherencyHint['kind']`): the compiler forces each literal to enumerate exactly its union's members, and `Object.keys()` materializes the two sets so a Vitest `expect` compares them.
4. **A negative "guard bites" pin** (`@ts-expect-error`) demonstrating that an *incomplete* `Record<HintKind, true>` literal fails to compile — pinning the guard's value, not just its presence, matching the predecessor's idiom at [packages/shell/src/diagnostics/diagnostic-highlights.test.ts:334–364](../../../packages/shell/src/diagnostics/diagnostic-highlights.test.ts).

This task does **not** change any source, does **not** promote the hint types to `@a-conversa/shared-types`, and does **not** add a runtime dependency between any two workspaces.

## Why it needs to be done

The shell deliberately keeps a **hand-maintained mirror** of the server's coherency-hint shapes (predecessor-of-predecessor `shell_diagnostic_highlights_extract` Decision §5 chose to mirror the wire interfaces in the shell rather than promote them to shared-types, explicitly accepting drift risk). With a mirror, two independent drifts are possible:

- **Wire union grows, a consumer switch not updated** — *closed* by `coherency_hint_wire_mirror_exhaustiveness` (the `never`-defaults).
- **Server union grows, Wire mirror not updated** — **still open.** If the server adds a `HintKind` and nobody mirrors it into `WireCoherencyHint`, every shell switch stays exhaustive *against the stale union* and nothing errors; the new kind arrives over the wire as data the shell silently drops. This is the *first-order* cause of the 2026-06-05 timeout.

The exhaustiveness guards are blind to the second class by construction: they only see the shell's union. A parity test is the only thing that pins the two unions together. Per the predecessor's **Decision §3**, this was deferred (not folded in) precisely because it crosses a workspace boundary the predecessor's surgical guard task did not — making it a distinct, reviewable decision about *where* such a cross-boundary test lives and *how* it imports both sides without creating a runtime coupling.

## Inputs / context

Real file paths with line numbers (verified at write time, 2026-06-05):

- **`apps/server/src/diagnostics/coherency-hint-detection.ts`** — source of truth.
  - `export type HintKind` (six members): `:128–134` — `incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts`, `annotation-of-annotation-chain`, `self-referential-annotation-contradicts`, `non-self-referential-annotation-contradicts`.
  - `CoherencyHint` discriminated union: `:261–267`.
  - Re-exported from `apps/server/src/diagnostics/index.ts:28` (`type HintKind`) — the barrel is the stable handle, but for a *type-only* import the deep path to `coherency-hint-detection.ts` is equally erased and matches the `tests/`-tree idiom.
- **`packages/shell/src/diagnostics/diagnostic-highlights.ts`** — the canonical Wire mirror.
  - `WireCoherencyHint` union (six members): `:155–161`; constituent interfaces `:108–153` with `kind` literals at `:110, :117, :124, :131, :140, :148` — the same six strings as `HintKind` (parity holds today).
  - Re-exported from the shell barrel `packages/shell/src/index.ts:198` (`type WireCoherencyHint`).
- **The `tests/` cross-workspace tree** — the home for this assertion.
  - [`tests/tsconfig.json`](../../../tests/tsconfig.json): `include: ["**/*.ts", "**/*.tsx"]` (`:32`) — any `.ts` under `tests/` is compiled by `typecheck:tests`. `moduleResolution: "Bundler"` (`:6`), `noEmit: true` (`:9`). The header comment (`:13–22`) documents that the tree is **not a pnpm workspace** and that behavior steps "reach into `apps/server/src/**` via relative paths" — i.e. cross-workspace reach is this tree's *sanctioned* behavior, not a violation.
  - **Established deep-relative-import precedent** (reuse, do not invent):
    - Server source from `tests/`: `tests/behavior/steps/backend-create-session.steps.ts:8` (`import { … } from '../../../apps/server/src/auth/index.js'`); sibling steps files import `apps/server/src/auth`, `apps/server/src/test-mode/routes`.
    - Package source from `tests/smoke/`: `tests/smoke/wsStoreSeed.test.ts:37` (`import { … } from '../../packages/shared-types/src/events'`). The same file's `:31` comment confirms the `@a-conversa/*` package name is **not runtime-resolvable from the `tests/` tree** — so deep-relative is the idiom, and *type-only* imports (erased) sidestep the resolution question entirely.
  - **Run/gate wiring** (root [`package.json`](../../../package.json)): `test:smoke` = `pnpm run build && vitest run tests/smoke packages apps` (`:18`) — Vitest executes everything under `tests/smoke`; `typecheck:tests` = `tsc --noEmit -p tests/tsconfig.json` (`:29`); both fold into `check` (`:30`). A file at `tests/smoke/*.test.ts` is therefore **double-gated**: type-checked by `typecheck:tests` *and* executed by Vitest in `test:smoke`. Existing smoke tests confirm the slot is live: `tests/smoke/{hello,dev-user-pool,wsStoreSeed}.test.ts`.
- **Dependency graph** (verified in the three `package.json` files): `@a-conversa/server` is `private: true` with **no `main`/`exports`/`types` entrypoint** (not a published/importable package); `@a-conversa/shell` is importable (has `exports`) and peer-depends only on `@a-conversa/shared-types`; `apps/test-mode` depends on `@a-conversa/shell` but **not** the server; **no workspace imports `@a-conversa/server` anywhere** in `apps/*`/`packages/*`. The shell↔server pair has *no* dependency edge in either direction.
- **Established type-assertion idiom** (reuse): the predecessor's "guard bites" `@ts-expect-error` + `never` pin at [packages/shell/src/diagnostics/diagnostic-highlights.test.ts:334–364](../../../packages/shell/src/diagnostics/diagnostic-highlights.test.ts).
- **`tsconfig.base.json:1–25`** — `strict: true`, `noFallthroughCasesInSwitch: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. The `tests/` project extends this base.
- **ADR 0022** ([docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)) — every empirical verification lands as a committed test; pure/type logic → Vitest + the `tsc` gate. **ADR 0007** (Cucumber+pglite) and **ADR 0008** (Playwright) — the layering this task is *not* in (see Decision §4).
- **Milestone**: this task already appears in `m_replay_mvp` (M8) `depends` at [tasks/99-milestones.tji:87](../../99-milestones.tji) — no milestone wiring is owed to the closer.

## Constraints / requirements

1. **No source change, no server change, no wire change, no new dependency edge.** The assertion is a test only. Imports of both unions must be **`import type`** (fully erased) so no runtime coupling between `tests/` and either workspace is introduced. Do not add `@a-conversa/server` to any `package.json`; do not add `apps/server` as a project reference anywhere.
2. **Both unions in one compile unit.** The test must import the *real* server `HintKind` — not a hand-copied list and **not** the shell's `WireCoherencyHint['kind']` standing in for it (that would be circular and assert nothing). The whole point is to compare the shell mirror against the *server* source of truth.
3. **Mutual exhaustiveness, both directions.** Assert `HintKind ⊆ WireCoherencyHint['kind']` *and* `WireCoherencyHint['kind'] ⊆ HintKind`. The fear case (server grows, Wire lags) trips the first direction; a stale-Wire-removed-server-kind trips the second. Prefer **two directional assignability assertions** over a single opaque `Equal<>` so a failure names *which* side drifted.
4. **The runtime pin must be self-materializing, not hand-copied.** Use exhaustive `Record<HintKind, true>` and `Record<WireCoherencyHint['kind'], true>` object literals: the compiler forces each literal to list exactly its union's members (a missing key *or* an extra key is a compile error), and `Object.keys()` yields the two real sets for a `Vitest` set-equality `expect`. This makes the lists impossible to satisfy by lazily editing the test alone — adding a not-yet-mirrored kind to the Wire-keyed `Record` fails to compile until the kind exists in `WireCoherencyHint`, forcing the actual mirror update.
5. **Reuse the `tests/`-tree deep-relative import idiom** (`../../apps/server/src/diagnostics/coherency-hint-detection.js`, `../../packages/shell/src/index.js`) — matching the behavior steps and `wsStoreSeed.test.ts`. Use the `.js` specifier suffix that the existing `tests/` imports use under `moduleResolution: "Bundler"`. **No `tests/tsconfig.json` `paths` edit is required** with deep-relative imports; do not add one unless the implementer finds the barrel path needs it (and if so, mirror the existing `@a-conversa/shared-types` mapping shape at `:24`).
6. **ESLint-clean.** Type-aware rules run over `tests/`. Resolve the standalone-`const`-assertion unused-var concern by *referencing* the directional-assertion consts inside the `expect` (e.g. `expect(serverSubsetOfWire && wireSubsetOfServer).toBe(true)`), not by an eslint-disable. Deep-relative source imports keep types concrete (not `any`), so `no-unsafe-*` will not fire.
7. **Build + test gate** (global CLAUDE.md rule + `docs/dev-environment.md` pre-commit hook): `check` (lint + format + `typecheck` + `typecheck:tests`) and the Vitest run must pass before commit. Redirect noisy output to a file and inspect via an Explore sub-agent (memory: test-output handling).

## Acceptance criteria (testable; ADR 0022)

1. **New file `tests/smoke/coherency-hint-kind-parity.test.ts`** exists, importing `HintKind` (server) and `WireCoherencyHint` (shell) as **type-only** deep-relative imports, and is picked up by both `typecheck:tests` (via `tests/tsconfig.json` `include`) and `test:smoke` (Vitest over `tests/smoke`).
2. **Bidirectional compile-time parity assertion present.** Two directional assignability checks (server⊆wire and wire⊆server) such that adding a `HintKind` member without mirroring it into `WireCoherencyHint` (or vice-versa) makes the file fail `tsc --noEmit -p tests/tsconfig.json`. The directional results are referenced at runtime by the Vitest assertion (no unused-var).
3. **Runtime set-equality pin.** Exhaustive `Record<HintKind, true>` and `Record<WireCoherencyHint['kind'], true>` literals; a Vitest `it(...)` asserts `new Set(Object.keys(serverRecord))` deep-equals `new Set(Object.keys(wireRecord))` and that both have the six known members (including `non-self-referential-annotation-contradicts` — the exact kind that timed out on 2026-06-05).
4. **Negative "guard bites" pin.** A `// @ts-expect-error`-guarded fragment shows that an *incomplete* `Record<HintKind, true>` literal (one key omitted) fails to compile — so the test *itself fails* if the parity machinery ever stops catching a missing member (matching the predecessor's pin at `diagnostic-highlights.test.ts:334–364`). Per ADR 0022, the `@ts-expect-error` is the committed artifact, checked by `tsc` in CI.
5. **`typecheck:tests`, ESLint, and the `test:smoke` Vitest run all pass.** Capture output to a file; verify via Explore.
6. **No new Playwright spec — and this is *not* a deferred-e2e exception.** This task is under `shell_package.*`, not a UI-stream area, and adds **no user-visible behavior** — the rendering of all six coherency-hint kinds (including `non-self-referential-annotation-contradicts`) in the diagnostics panel is already Playwright-covered by `replay_test.test_mode.test_mode_diagnostic_inspector_e2e_tracking` (the panel is reachable and e2e-covered today). The change is a compile-time + pure-logic contract; per ADR 0022 layer routing it is pinned by Vitest + the `tsc` gate, not a redundant browser spec. (Stated explicitly to satisfy the UI-stream e2e policy's "say why no new e2e" requirement.)
7. **No Cucumber scenario.** This crosses **no runtime protocol, broadcast, or replay seam** — the test references the server's internal `HintKind` *type* at compile time only; it changes no wire envelope, no broadcast shape, no projector output. Per the backend/WS policy, a pure compile-time contract is correctly pinned by the type-checker + Vitest, not by a `tests/behavior` scenario.

### No registered follow-up

This task *closes* the residual gap the predecessor opened; it does not open a new one. The one larger alternative it forgoes — promoting the hint types to `@a-conversa/shared-types` so drift becomes structurally impossible and **both** the exhaustiveness guard and this parity test become unnecessary — is **not** WBS work: it is an architectural design call the predecessor's Decision §3 already routed to the human-review parking lot (it touches the server's diagnostics emission and warrants its own ADR). It stays there; this refinement does not re-register it. See **Decision §3**.

## Decisions

**§1 — Home the parity test in the `tests/` cross-workspace tree, not in `apps/test-mode` (supersedes the predecessor's tentatively-named home).**
*Chosen:* a single Vitest file under `tests/smoke/`, importing both unions type-only via deep-relative paths.
*Why the predecessor's `apps/test-mode` home is superseded:* the predecessor's Decision §3 named `apps/test-mode` as "the natural home" on the belief that it could "take a test-only typed import of the server's exported `HintKind`." Direct verification at write time shows that belief does not hold: `@a-conversa/server` is `private: true` with **no `main`/`exports`/`types` entrypoint** (not importable by package name), **no `apps/*` workspace imports the server at all**, and `apps/test-mode`'s `tsconfig` is `composite: true` with `rootDir: "src"` — a deep relative import reaching `../../../server/src/**` would pull server source into test-mode's composite program and break `tsc -b` project-reference hygiene. Crucially, the shell's own test suite documents the inverse rule as deliberate discipline: it reproduces server formulas by string-construction *specifically to avoid importing `apps/server/*`* ("the workspace-boundary discipline"). Making `apps/test-mode` the first `apps/*` module to reach into `apps/server/src` would contradict that established rule. The `tests/` tree is the **only** tree the repo sanctions for cross-workspace reach (its `tsconfig` header documents exactly this), and it *already* imports both `apps/server/src/**` (behavior steps) and `packages/**/src` (smoke tests). Homing the parity test there **reuses the existing seam, adds zero dependency edges, and honors the boundary discipline** — strictly better than test-mode on every axis. This is a refinement-level correction of a tentative pre-registration, surfaced in the return summary so the orchestrator/closer notes the home change.
*Alternative rejected — test in `apps/server` importing `@a-conversa/shell` as a dev-dependency:* the server *could* take a `devDependency` on the (importable) shell and see both unions. Rejected: it makes the server (a backend) depend, even in dev, on a React UI package — pulling the shell's React-flavored type graph into the server's build and inverting the intended layering. Worse than the `tests/`-tree home.

**§2 — Cross-boundary parity is asserted at compile time (type-only imports) plus a self-materializing runtime set-equality; the runtime "all six kinds enumerated" pin already exists shell-side.**
*Chosen:* `import type` both unions (erased — no runtime coupling), assert mutual assignability at compile time, and materialize both sets at runtime via exhaustive `Record<…, true>` literals for a `Vitest` `expect`.
*Why not a purely runtime cross-check of the server's kinds:* there is **no runtime enumeration of `HintKind`** exported by the server (no `HINT_KINDS` array; `HintKind` is a type). A runtime cross-check of the *server's actual values* would require adding such an export — a server change, out of scope for a 0.5d test task. The `Record<HintKind, true>` literal is the bridge: it is *compile-forced* to enumerate the server type's members yet is a *runtime* object, giving a value-level set without a server runtime export. The complementary "every kind is routed at runtime" pin is already committed shell-side by the predecessor (`diagnostic-highlights.test.ts` all-six positive pin) and in the test-mode panel test — this task does not duplicate it.
*Alternative rejected — opaque single `Equal<A,B>` type:* a one-shot `Equal<HintKind, WireCoherencyHint['kind']>` would pin equality but, on failure, not say which side drifted. Two directional assertions localize the regression.

**§3 — Do not fold in (or re-register) the shared-types promotion.**
*Chosen:* leave `HintKind`/the hint shapes where they are; the parity test is the chosen mechanism for *this* task.
*Rationale:* promoting the canonical hint-kind union to `@a-conversa/shared-types` (which both the server and the shell already depend on) is the strongest long-term fix — it would make drift structurally impossible and obsolete *both* the predecessor's guard and this test. But it is a larger-than-0.5d refactor that touches the server's diagnostics emission and is exactly the shared-types promotion that `shell_diagnostic_highlights_extract` Decision §5 *explicitly declined to pre-register* (it warrants its own ADR). The predecessor's Decision §3 already surfaced it for the human-review parking lot, not as a WBS leaf. Per the tech-debt rule ("never defer an architectural design call as a WBS task"), this refinement keeps it in the parking lot and does not mint a task for it.

**§4 — Test layer is Vitest + the `tsc`/`typecheck:tests` gate; no Playwright, no Cucumber.**
*Chosen:* Vitest under `tests/smoke` for the runtime set-equality and the `@ts-expect-error` negative pin; CI `typecheck:tests` for the compile-time directional contract.
*Rationale:* ADR 0022 routes pure/compile-time logic to Vitest + the type-checker; the user-visible rendering is already e2e-covered by the predecessor chain; no runtime protocol/replay/broadcast seam is crossed, so Cucumber (ADR 0007) and Playwright (ADR 0008) are both unwarranted.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- New file `tests/smoke/coherency-hint-kind-parity.test.ts` created; picked up by both `typecheck:tests` (via `tests/tsconfig.json` `include`) and `test:smoke` (Vitest over `tests/smoke`).
- Bidirectional compile-time parity assertion: `SubsetOf<HintKind, WireHintKind> = true` and `SubsetOf<WireHintKind, HintKind> = true`; referenced by the runtime `expect` to avoid unused-var.
- Runtime set-equality pin: exhaustive `Record<HintKind, true>` and `Record<WireHintKind, true>` literals; Vitest asserts the two `Object.keys()` sets are equal and size 6, including `non-self-referential-annotation-contradicts` (the 2026-06-05 timeout kind).
- Negative "guard bites" `@ts-expect-error` pin: incomplete `Record<HintKind, true>` (one member omitted) must fail `tsc` — matches predecessor pin at `packages/shell/src/diagnostics/diagnostic-highlights.test.ts:334–364`.
- Home is `tests/smoke/` per Decision §1 (supersedes predecessor's tentative `apps/test-mode` home); uses deep-relative `import type` idiom matching existing `tests/` tree precedents.
- No source change, no wire change, no server change, no new dependency edge.
- Verification: `pnpm run check` green; `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test:e2e:compose` green.
