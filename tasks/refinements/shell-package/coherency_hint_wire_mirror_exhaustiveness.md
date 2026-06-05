# Add a TypeScript exhaustiveness guard to the `WireCoherencyHint` switches (prevent server↔shell hint-kind drift from shipping silently)

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.coherency_hint_wire_mirror_exhaustiveness` (lines 217–222).

> Path note: this refinement lives in `tasks/refinements/shell-package/` (hyphen) alongside its 14 siblings and matching the `tasks/refinements/shell-package/…` references the WBS itself uses (e.g. `tasks/27-shell-package.tji:200`). The task id's area segment is `shell_package` (underscore); the on-disk directory is `shell-package`.

## Effort estimate

0.5d (`effort 0.5d`, `allocate team`). This is a small, surgical hardening: add explicit exhaustive `never`-defaults to a handful of discriminated-union switches and pin the behavior with Vitest. No new dependency, no wire change, no server change.

## Inherited dependencies

- **Settled — `shell_package.shell_diagnostic_highlights_extract`** (`depends !shell_diagnostic_highlights_extract`, [tasks/27-shell-package.tji:176–192](../../27-shell-package.tji)). Refinement: [shell_diagnostic_highlights_extract.md](shell_diagnostic_highlights_extract.md). That task lifted `diagnostic-highlights.ts` (the `WireCoherencyHint`/`WireDiagnostic` unions, `diagnosticIdentityKey`, `affectedEntities`, the per-kind `coherencyHintIdentityKey` / `coherencyHintAffectedEntities` switches) and the `activeDiagnostics` WS-store slot into `packages/shell/src/diagnostics/`. Its **Decision §5** chose to mirror the wire interfaces inside the shell rather than promote them to `@a-conversa/shared-types`, explicitly accepting that the shell mirror can drift from the server union and deferring shared-types promotion as a separate architectural decision. *That accepted drift is exactly what this task hardens against.*

- **Source of debt (already-landed fix) — `replay_test.test_mode.test_mode_diagnostic_inspector_e2e_tracking`** (2026-06-05). Refinement: [../replay_test/test_mode_diagnostic_inspector_e2e_tracking.md](../replay_test/test_mode_diagnostic_inspector_e2e_tracking.md). That task hit a Playwright timeout because the shell's `WireCoherencyHint` union lagged the server's `HintKind` union by the three annotation-family kinds, so a `non-self-referential-annotation-contradicts` hint hit the silent `default → []` branch in `coherencyHintIds`, the ids span never rendered, and the e2e assertion timed out. It fixed the *data* drift by mirroring the three missing interfaces; it registered **this** task to fix the *structural* hole (the silent default) so the next such drift can't ship.

## What this task is

Make the exhaustiveness of every switch over `WireCoherencyHint['kind']` (and its sibling switches over `WireDiagnostic['kind']`) **explicit and uniform**, so that adding a new coherency-hint kind to the shell's wire mirror produces a **compile error at every consumer that must handle it** instead of a silent runtime no-op.

Concretely:

1. Add an explicit exhaustive `never`-default to the two `WireCoherencyHint` switches in the shell's canonical mirror (`coherencyHintIdentityKey`, `coherencyHintAffectedEntities` in `packages/shell/src/diagnostics/diagnostic-highlights.ts`), and to the parallel top-level `WireDiagnostic` switches in the same file (`diagnosticIdentityKey`, `affectedEntities`).
2. **Remove the silent `default: return []`** from `coherencyHintIds` (and the parallel `affectedIds` over `WireDiagnostic`) in `apps/test-mode/src/diagnostics/DiagnosticInspector.tsx` — the catch-all that actually masked the drift — and replace it with the same explicit `never`-default.
3. Pin all six known hint kinds with Vitest so the "every kind is handled" contract is a committed regression test, not just a compile-time property.

This task does **not** re-add any wire interface (the data drift is already resolved — all six kinds mirror) and does **not** touch the server, the wire envelope, or any projector.

## Why it needs to be done

The shell deliberately keeps a hand-maintained mirror of the server's coherency-hint shapes (predecessor Decision §5). With a mirror, two independent drifts are possible:

- **Server union grows, Wire union not updated** — a new server hint arrives over the wire as untyped data the shell doesn't know about.
- **Wire union grows, a consumer switch not updated** — someone mirrors a new server kind into `WireCoherencyHint` but forgets one of the four switches that fan out over it.

The 2026-06-05 timeout was the first drift class manifesting through the second: the Wire union lagged, and because `coherencyHintIds` had `default: return []`, even when the typed data *did* eventually carry the kind, the switch swallowed it. The `default: return []` is the dangerous pattern — it defeats TypeScript's exhaustiveness check. Under `strict` + `noImplicitReturns`, a switch with **no** default over a discriminated union and a non-`void` return type already errors when a member is added (the new member's path returns `undefined`). A catch-all `default` silently restores totality and hides the gap. This task removes the catch-alls and makes the exhaustive contract explicit so a future maintainer can't reintroduce a swallowing default without a reviewer noticing.

The exhaustiveness guard closes the **second** drift class at compile time. It does **not** by itself close the first (server-grows-but-Wire-mirror-not-updated) — that needs a kind-parity test, registered as a follow-up below.

## Inputs / context

Real file paths with line numbers (verified at write time):

- **`packages/shell/src/diagnostics/diagnostic-highlights.ts`** — the canonical mirror.
  - `WireCoherencyHint` union (six members): `diagnostic-highlights.ts:155–161` (constituent interfaces at `:108–153`).
  - `diagnosticIdentityKey` top-level switch over `WireDiagnostic['kind']`: ends `:250–252`; no default (implicit exhaustiveness today).
  - `coherencyHintIdentityKey` switch over `WireCoherencyHint['kind']`: `:254–269`; six cases, **no default**.
  - `affectedEntities` top-level switch over `WireDiagnostic['kind']`: `:287–305`; no default.
  - `coherencyHintAffectedEntities` switch over `WireCoherencyHint['kind']`: `:307–331`; six cases, **no default**.
- **`apps/test-mode/src/diagnostics/DiagnosticInspector.tsx`** — the read-only diagnostics panel (a `replay_test.test_mode` surface).
  - `coherencyHintIds` switch over `WireCoherencyHint['kind']`: `:71–88`; six cases **plus `default: return []`** ← the silent catch-all that masked the timeout.
  - `affectedIds` top-level switch over `WireDiagnostic['kind']`: starts `:91`; check for and remove any parallel silent default.
  - Imports `WireCoherencyHint`, `WireDiagnostic` from `@a-conversa/shell` (`:30`).
- **`apps/server/src/diagnostics/coherency-hint-detection.ts`** — the source of truth. `export type HintKind` (six members): `:128–134`; `CoherencyHint` union: `:261–267`. Re-exported from `apps/server/src/diagnostics/index.ts:28`. The shell's six `WireCoherencyHint` kinds currently match this set exactly.
- **`apps/moderator/src/graph/diagnosticSuggestions.ts`** — `coherencyHintSuggestions` switch over `WireCoherencyHint['kind']`: `:133–148`; six cases, no default (implicit exhaustiveness, *not* a silent-default risk today).
- **Established exhaustiveness idiom already in-tree** (reuse, do not invent):
  - `const _exhaustive: never = …` inline pattern: `apps/moderator/src/graph/affectedEntities.ts`, `apps/moderator/src/graph/eventSummary.ts`, `apps/moderator/src/graph/disputationOutcome.ts`, `apps/audience/src/App.tsx`, `apps/server/src/errors.ts`.
  - `function assertNever(x: never): never { throw … }` helper pattern: `apps/moderator/src/graph/resolutionPlan.ts:196–198` (used at `:262–263`); `apps/server/src/test-mode/synthetic/rekey.ts`.
- **`tsconfig.base.json:1–25`** — `strict: true`, `noFallthroughCasesInSwitch: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. `noImplicitReturns` is on via `strict`. The shell extends this base.
- **ADR 0022** (`docs/adr/0022-no-throwaway-verifications.md`) — every empirical verification lands as a committed test; pure logic → Vitest. The compile-time guard is enforced by `tsc` at the CI build gate; the committed regression pin is the all-six-kinds Vitest case.

## Constraints / requirements

1. **No new wire interface, no server change, no wire-envelope change.** The data drift is already resolved; this task is structural hardening only. Do not re-add any `WireCoherencyHint` member.
2. **Reuse the existing exhaustiveness idiom.** Use the in-tree `const _exhaustive: never = hint;` pattern (or a small file-local `assertNever(hint: never): never` helper matching `resolutionPlan.ts:196`). Do **not** add a new exported public API to `@a-conversa/shell` for this — keep the helper file-local. No new dependency.
3. **The default must be unreachable for all six known kinds** (so it type-checks as `never` today) and must **fail to compile** the moment a seventh kind is added to `WireCoherencyHint`/`WireDiagnostic` without a corresponding `case`.
4. **Runtime safety in the read-only panel.** `DiagnosticInspector` is a read-only inspector; the default must not white-screen the panel for genuinely-untyped runtime data. The `never`-default throwing is acceptable because (a) it is unreachable for typed data and (b) the compile gate makes the typed path total — but if the implementer prefers a defensive runtime fallback in the panel, it must still keep the compile-time `never` assertion so drift is caught at build time (i.e. `const _exhaustive: never = hint;` first, then a safe `return []`/throw). The compile-time `never` assignment is the non-negotiable part; the runtime tail is the implementer's call.
5. **`noFallthroughCasesInSwitch` interaction.** Each `case` already returns; do not introduce fallthrough. The `never`-default sits after the last returning case.
6. **Build + test gate** (global CLAUDE.md rule + `docs/dev-environment.md` pre-commit hook): `tsc`/lint/Vitest must pass before commit. Redirect noisy output to a file and inspect via an Explore sub-agent (memory: test-output handling).

## Acceptance criteria (testable; ADR 0022)

1. **Explicit exhaustive `never`-default present** on: `coherencyHintIdentityKey`, `coherencyHintAffectedEntities`, `diagnosticIdentityKey`, `affectedEntities` in `packages/shell/src/diagnostics/diagnostic-highlights.ts`; and on `coherencyHintIds` (+ `affectedIds`) in `apps/test-mode/src/diagnostics/DiagnosticInspector.tsx` **with the `default: return []` removed**.
2. **The guard bites — negative compile pin.** A committed type-level test demonstrates that a hypothetical extra kind triggers the guard: in a Vitest test file, a local helper that switches an extended union and reaches the `never`-default fails type-checking, asserted with `// @ts-expect-error` (so the test *fails* if the guard ever stops catching the extra member). This pins the guard's value, not just its presence. (Per ADR 0022 — pure type logic → Vitest; the `@ts-expect-error` is checked by `tsc` in CI.)
3. **All-six-kinds positive pin — shell.** A Vitest case in `packages/shell/src/diagnostics/diagnostic-highlights.test.ts` builds one payload per `WireCoherencyHint` kind (all six) and asserts `diagnosticIdentityKey(payload)` is a non-empty, kind-prefixed string and `affectedEntities(payload)` returns the expected non-empty `{nodes, edges}` for each. Extend the existing suite rather than duplicating fixtures. This is the regression pin that every known kind is routed.
4. **All-six-kinds positive pin — test-mode panel.** A Vitest/component test in `apps/test-mode/src/diagnostics/` asserts `coherencyHintIds` returns the expected non-empty id list for all six kinds (in particular `non-self-referential-annotation-contradicts` returns a non-empty list — the exact regression that timed out). If a co-located component test already exercises the inspector, extend it.
5. **`tsc --noEmit`, ESLint, and Vitest all pass** across `packages/shell` and `apps/test-mode` (build gate). Capture output to a file; verify via Explore.
6. **No new Playwright spec in this task — and this is *not* a deferred-e2e exception.** The user-visible behavior (all six coherency-hint kinds, including `non-self-referential-annotation-contradicts`, render in the diagnostics panel) is *already* exercised by the Playwright spec landed in `replay_test.test_mode.test_mode_diagnostic_inspector_e2e_tracking` (the panel is reachable and e2e-covered today). This task adds **no new user-visible behavior** — it converts a silent no-op into a compile error. Per ADR 0022 layer routing, a compile-time/pure-logic contract is pinned by Vitest + the `tsc` build gate, not by a redundant browser spec. (Documented here to satisfy the UI-stream e2e policy's "state explicitly why no new e2e" requirement: the surface is reachable, the behavior is already covered, the change is compile-time-only.)
7. **No Cucumber scenario.** This task crosses no protocol, broadcast, or replay seam — it is client-side type plumbing. Per the backend/WS policy, Vitest is the correct layer.

### Residual gap — registered follow-up

The exhaustiveness guard closes *Wire-union-grows-but-a-switch-lags* drift. It does **not** close *server-union-grows-but-Wire-mirror-lags* drift (the first-order cause of the 2026-06-05 timeout): if the server adds a `HintKind` and nobody mirrors it into `WireCoherencyHint`, every shell switch stays "exhaustive" against the stale union and nothing errors. Closing that needs a kind-parity check.

- **Deferred to `shell_package.coherency_hint_server_kind_parity_test`** (closer registers in WBS; milestone **M8 `m_replay_mvp`**, the same milestone this task feeds — see `tasks/99-milestones.tji:85–89`). Effort 0.5d. Concrete deliverable: a committed type-level + value-level test asserting the shell's `WireCoherencyHint['kind']` set is mutually exclusive-or-equal with the server's `HintKind` set (`apps/server/src/diagnostics/coherency-hint-detection.ts:128`), so a server-side kind addition fails a test even when the Wire mirror isn't touched. Natural home: `apps/test-mode` (the only workspace that already depends on `@a-conversa/shell` *and* can take a test-only typed import of the server's exported `HintKind`; server↔shell have no dependency edge in either direction — see Decisions §3). This is concrete, agent-implementable work (write one test + possibly one test-only dependency edge), not an audit.

## Decisions

**§1 — Make exhaustiveness explicit rather than relying on the implicit no-default + non-void-return property.**
*Chosen:* add an explicit `never`-default to every `WireCoherencyHint`/`WireDiagnostic` switch in the canonical mirror and remove the silent catch-all in the panel.
*Alternatives rejected:* (a) *Leave the shell switches as-is* (they already type-error on drift via `noImplicitReturns`) and only delete the panel's `default: return []`. Rejected: the implicit property is fragile — it silently evaporates the moment anyone adds a `default` or changes a return type to include `undefined`/`void`; the task title and the debt note both call for an explicit guard, and explicit-and-uniform is the durable, self-documenting contract. (b) *Only fix the named file* (`diagnostic-highlights.ts`) and leave the panel's silent default. Rejected: the panel's `default: return []` is the exact line that masked the timeout — fixing the mirror while leaving the proven hole open would be cosmetic.

**§2 — Reuse the in-tree `never`-assignment idiom; no new shared helper, no new exported API.**
*Chosen:* file-local `const _exhaustive: never = hint;` (matching `apps/moderator/src/graph/affectedEntities.ts` and four siblings), or a tiny file-local `assertNever(x: never): never` (matching `resolutionPlan.ts:196`).
*Alternatives rejected:* (a) *Export a shared `assertNever` from `@a-conversa/shell`.* Rejected: adds public API surface for a one-line idiom that already exists informally across the tree; the predecessor's bias was minimal shell surface. (b) *Add a lint rule enforcing exhaustive switches repo-wide.* Rejected: out of scope for a 0.5d task and a separate tooling decision; `tsc` already enforces it once the explicit default is in place.

**§3 — Defer the server↔Wire kind-parity test rather than fold it into this task; home it in `apps/test-mode`.**
*Chosen:* register `coherency_hint_server_kind_parity_test` as a separate 0.5d M8 leaf. Rationale: a parity test is the thing that actually prevents the first-order drift, but it requires a *new cross-workspace test dependency* — `apps/test-mode` would take a test-only typed import of the server's `HintKind`. Today the dependency graph has no server↔shell edge (`apps/server` doesn't depend on `@a-conversa/shell`; the shell is a leaf that can't import the server; `apps/test-mode` depends on the shell but not the server — verified in the three `package.json` files). Introducing that test-only edge is a distinct, reviewable decision, kept out of this surgical guard task per the "simpler abstraction / one or two call sites" bias.
*Alternative rejected:* *Promote the wire hint shapes / `HintKind` to `@a-conversa/shared-types`* so server and shell import one union and drift becomes structurally impossible. This is the strongest long-term fix and would obsolete both the guard's residual gap and the parity test — but it is a larger refactor than 0.5d, touches the server's diagnostics emission, and is exactly the shared-types promotion the predecessor's Decision §5 *explicitly declined to pre-register* as it warrants its own architectural decision. Not registered here as a WBS task; surfaced for the human-review parking lot instead (it is a design call, not mechanical work).

**§4 — Test layer is Vitest + the `tsc` build gate; no new Playwright, no Cucumber.**
*Chosen:* Vitest for the positive all-six-kinds pins and the `@ts-expect-error` negative guard pin; rely on CI `tsc` for the compile contract. Rationale: ADR 0022 routes pure/compile-time logic to Vitest; the user-visible rendering is already e2e-covered by the predecessor task, so a new browser spec would be redundant; no protocol/replay seam is crossed, so Cucumber is unwarranted.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- **Edited** `packages/shell/src/diagnostics/diagnostic-highlights.ts` — added file-local `assertNever` helper and explicit `never`-defaults to all four switches (`diagnosticIdentityKey`, `coherencyHintIdentityKey`, `affectedEntities`, `coherencyHintAffectedEntities`).
- **Edited** `apps/test-mode/src/diagnostics/DiagnosticInspector.tsx` — removed both silent `default: return []` in `coherencyHintIds` and `affectedIds`; replaced with compile-time `const _exhaustive: never` guard + runtime-safe `return []`.
- **Tests added** `packages/shell/src/diagnostics/diagnostic-highlights.test.ts` — "WireCoherencyHint exhaustiveness" describe: all-six-kinds positive pin over `diagnosticIdentityKey`/`affectedEntities` + `@ts-expect-error` negative guard pin.
- **Tests added** `apps/test-mode/src/diagnostics/DiagnosticInspector.test.tsx` — "every coherency-hint kind routes its affected ids" describe: six kinds including `non-self-referential-annotation-contradicts`, asserts no `-fallback` swallow.
- **Compile guard verified**: `tsc --noEmit` passes cleanly with `@ts-expect-error` correctly placed (needed, not unused) and all four `never`-defaults compile.
- **Tech-debt registered**: `shell_package.coherency_hint_server_kind_parity_test` added to `tasks/27-shell-package.tji`, wired to M8 `m_replay_mvp`.
