# Classify each diagnostic as blocking or advisory

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.blocking_vs_advisory_classification`
**Effort estimate**: 0.5d
**Inherited dependencies**: All five diagnostic detectors (`cycle_detection`, `contradiction_detection`, `multi_warrant_detection`, `dangling_claim_detection`, `coherency_hint_detection`) settled. Transitively the unified `DiagnosticEntry` discriminated union shipped by `diagnostic_event_emission` — that union is this task's input type. Indirectly: `pending_consequences_stub` (the sixth detector — excluded from the v1 `DiagnosticEntry` union per its stub-framing, therefore not classified here either; future re-promotion adds the entry kind to both modules together).

## What this task is

The five surfaced diagnostic kinds (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`) fall into two methodological categories per [`docs/methodology.md`](../../../docs/methodology.md) lines 210–227 ("Resolution of structural diagnostics"):

- **Blocking** — "Logical problems block forward progress until **acknowledged**" (line 216). The participants must engage with the diagnostic — resolve, axiom-mark, or otherwise consciously dispose of it — before the methodology should permit further commits on the affected facet.
- **Advisory** — "Methodological opportunities — visible but non-blocking" (line 223). The participants may act on them or leave them; they exist to nudge.

This task delivers a pure, per-kind classifier: given a `DiagnosticEntry` (the discriminated union shipped by `diagnostic_event_emission`), return `'blocking'` or `'advisory'`. The classifier is the read-side primitive that downstream consumers — the moderator UI's diagnostic panel, the eventual commit-gating logic, the WS broadcaster's severity tag — can call to bucket each entry without re-deriving the methodology mapping themselves.

The file lives at `apps/server/src/diagnostics/classification.ts` alongside the detectors and the event-emission aggregator. The barrel re-exports the public surface. A small helper, `partitionBySeverity`, splits a list of entries into the two buckets for the common "render blocking first" presentation pattern.

**The classifier does NOT wire into commit-gating in this task.** The methodology engine's `commit_logic` handler is settled and shipped (round-3 / round-4 work); modifying it to consult the classifier and refuse-on-blocking is a separate, downstream task. See the "Boundary with the methodology engine" section under Decisions.

## Why it needs to be done

The five diagnostic detectors are pure read functions today; the unified `DiagnosticEntry` envelope carries the discriminator but no severity field. Without this task:

- The moderator UI has no canonical mapping from diagnostic kind to UI presentation (red-bordered blocker panel vs. yellow advisory nudge). Each consumer would have to re-encode the kind → severity table.
- The eventual commit-gating consumer (a future task that may sit on `commit_logic` or on a higher-level methodology service) would have no shared primitive to call. Encoding the table inline in each consumer is the obvious anti-pattern.
- The WS broadcaster's per-client message shape has no severity hint, which the audience and participant displays need to render diagnostics differently.

The classification is **methodologically determined**, not configurable: the methodology doc explicitly enumerates each kind under the blocking / advisory headings. The classifier is the code-level expression of that doc-level enumeration.

Per `docs/methodology.md` lines 214–227 the doc-level mapping is unambiguous:

- **Cycle in `supports`** — blocking (line 218).
- **Contradiction** — blocking (line 219).
- **Multiple competing warrants on one data→claim** — advisory (line 225).
- **Dangling claim** — advisory (line 226).
- **Coherency hints** — advisory ("advisory only; no required resolution," line 227).

This task lands that table as code.

## Inputs / context

- [`docs/methodology.md`](../../../docs/methodology.md) lines 210–227 — "Resolution of structural diagnostics" section. Explicit per-kind classification under "Blocking diagnostics" (lines 214–219) and "Advisory diagnostics" (lines 221–227).
- [`docs/data-model.md`](../../../docs/data-model.md) lines 165–197 — "Structural diagnostics" umbrella. The "Coherency violations" subsection (line 195) explicitly reaffirms: "Unusual edge/kind configurations [...] are flagged as advisory hints. Not errors; not blockers. Just nudges that something might warrant a closer look."
- [`docs/data-model.md`](../../../docs/data-model.md) line 167 — "[Structural diagnostics] are typically expected to be resolved before the debate moves on (the agreement rule extends here too — participants should agree on a resolution path)." This is the soft norm behind the methodology doc's harder per-kind table.
- [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts) — the `DiagnosticEntry` discriminated union over `kind: 'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'`. This task classifies that union.
- [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — `CoherencyHint` discriminated union over three sub-kinds: `incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts`. The sub-kinds are checked individually for divergent severity (see Decisions — they all classify the same way).
- [`apps/server/src/diagnostics/pending-consequences.ts`](../../../apps/server/src/diagnostics/pending-consequences.ts) — pending-consequences is NOT in the `DiagnosticEntry` union; not classified here. Future re-promotion classifies it as advisory (the data-model doc frames it as "signalling commitments" — informational, never blocking).
- [`tasks/refinements/data-and-methodology/diagnostic_event_emission.md`](./diagnostic_event_emission.md) — the immediately prior sibling. Its "Severity / advisory grouping" open-question entry pre-decides that the classifier attaches severity downstream without modifying the entry shape; this task delivers that classifier.
- [`tasks/refinements/data-and-methodology/commit_logic.md`](./commit_logic.md) — the commit handler is shipped at 100%. Modifying it to consult the classifier is OUT of scope here; future work.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest unit tests for the in-memory classification; Cucumber + pglite scenarios for the round-tripped projection-and-partition path.

## Constraints / requirements

- **Pure function.** `classifyDiagnostic(entry: DiagnosticEntry): Severity` is a total function over the union; deterministic; no I/O, no side effects, no detection logic.
- **Per-kind classification.** The mapping is from the top-level `kind` discriminator (and, in principle, from coherency-hint sub-kinds — but see Decisions; in v1 all three sub-kinds map the same way).
- **Doc-grounded mapping.** Every classification cites `docs/methodology.md` line 214–227 or `docs/data-model.md` line 165–197. The classifier is the code-level expression of a settled doc-level table; no pragmatic reasoning supplants the doc.
- **No modification of the `DiagnosticEntry` shape.** The entry stays severity-less; severity is attached at classification time, not at construction time. This matches the diagnostic-event-emission task's decision to keep entries pure-from-projection.
- **No modification of the methodology engine.** `commit_logic` and its sibling handlers are not touched. Wiring commit-gating to consult the classifier is a separate downstream task.
- **No modification of the projection layer or the event log.** The classification is a read-side primitive over `DiagnosticEntry`; it does not extend `ProjectionChange`, does not introduce a new event kind, does not produce a `session_events.kind = 'classification'` row.
- **`partitionBySeverity` is a thin helper.** Pure function; returns `{ blocking: DiagnosticEntry[]; advisory: DiagnosticEntry[] }`; round-trip property — every input entry lands in exactly one bucket; empty input → empty buckets; preserves input order within each bucket. The helper exists for the common UI case ("render blocking first") and to keep the round-trip property test-able in one call.
- **Total over the union.** TypeScript's exhaustiveness check on the discriminator catches a missing case at compile time; the runtime function does not have a default branch that could silently classify a new kind as advisory.
- **Verifications per ADR 0022.** Vitest unit at `apps/server/src/diagnostics/classification.test.ts`; Cucumber + pglite scenario at `tests/behavior/diagnostics/classification.feature` with step defs at `tests/behavior/steps/diagnostics-classification.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/classification.ts` exports:
  - `Severity` — string-literal union `'blocking' | 'advisory'`.
  - `classifyDiagnostic(entry: DiagnosticEntry): Severity` — total per-kind classifier. The per-kind mapping is:
    - `'cycle'` → `'blocking'` (methodology.md line 218).
    - `'contradiction'` → `'blocking'` (methodology.md line 219).
    - `'multi-warrant'` → `'advisory'` (methodology.md line 225).
    - `'dangling-claim'` → `'advisory'` (methodology.md line 226).
    - `'coherency-hint'` → `'advisory'` for all three sub-kinds (methodology.md line 227; data-model.md line 197).
  - `partitionBySeverity(entries: DiagnosticEntry[]): { blocking: DiagnosticEntry[]; advisory: DiagnosticEntry[] }` — pure helper. Preserves input order within each bucket.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `Severity`, `classifyDiagnostic`, and `partitionBySeverity`.
- `apps/server/src/diagnostics/classification.test.ts` covers:
  - **`classifyDiagnostic` per kind** (5 cases): one cycle → blocking; one contradiction → blocking; one multi-warrant → advisory; one dangling-claim → advisory; one coherency-hint → advisory.
  - **`classifyDiagnostic` per coherency-hint sub-kind** (3 cases): `incomplete-warrant-missing-bridges-to` → advisory; `incomplete-warrant-missing-bridges-from` → advisory; `self-contradicts` → advisory. The sub-kind tests document the explicit decision that all three classify the same way (per the methodology doc's line-227 blanket-advisory rule).
  - **`partitionBySeverity` round-trip** (1 case): given a mixed list `[cycle, multi-warrant, contradiction, dangling-claim, coherency-hint]`, the partition has `{ blocking: [cycle, contradiction], advisory: [multi-warrant, dangling-claim, coherency-hint] }`; the union of the two buckets is the input list (set-equality); each entry appears in exactly one bucket; order within each bucket preserves input order.
  - **`partitionBySeverity` empty input → empty buckets** (1 case).
- `tests/behavior/diagnostics/classification.feature` covers (1 scenario):
  - Build a session through pglite's `session_events` table that produces both a blocking diagnostic (a three-node `supports` cycle) AND an advisory diagnostic (a multi-warrant pattern on a separate (D, C) pair). Project the log; call `computeAllDiagnostics`; pass through `partitionBySeverity`. Assert the cycle entry is in the `blocking` bucket; assert the multi-warrant entry is in the `advisory` bucket; assert each bucket has exactly the expected kind(s).
- Step defs at `tests/behavior/steps/diagnostics-classification.steps.ts`. UUID prefix `c8...` (free; the diagnostics step files cover `c1` through `c7`).
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `blocking_vs_advisory_classification` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- This is the last diagnostics task; with it shipped, the diagnostics group is fully `complete 100`. Methodology engine is already fully `complete 100`. Therefore the M2 milestone (`m_methodology_engine_complete` in `tasks/99-milestones.tji`) also gets `complete 100` per the refinement README's milestone-propagation rule.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; the existing 557-vitest / 106-cucumber baseline is preserved and extended.

## Decisions

- **Per-kind classification — directly from `docs/methodology.md` lines 214–227.** Not pragmatic, not inferred — the doc enumerates the mapping explicitly. The classifier encodes the table; the tests pin the encoding.

  | Diagnostic kind | Severity | Doc citation |
  |---|---|---|
  | `cycle` | blocking | methodology.md line 218 |
  | `contradiction` | blocking | methodology.md line 219 |
  | `multi-warrant` | advisory | methodology.md line 225 |
  | `dangling-claim` | advisory | methodology.md line 226 |
  | `coherency-hint` | advisory | methodology.md line 227 + data-model.md line 197 |

- **Coherency-hint sub-kinds all classify as advisory.** The methodology doc says "Coherency hints — advisory only; no required resolution" with no per-sub-kind qualifier; the data-model doc reaffirms "Not errors; not blockers. Just nudges." There is no sub-kind that should block. The test file asserts each sub-kind individually so a future reader (or a future hint kind added to the union) sees the decision encoded per-sub-kind rather than buried under a generic kind-level rule. If a future variant ever needs to be blocking, the decision will be a one-line change in `classification.ts` plus a sub-kind branch on `entry.hint.kind`.

- **`pending-consequences` is NOT classified here.** It is not in the `DiagnosticEntry` union per the diagnostic-event-emission refinement's stub-framing. Forward-compatibility: when v1.x re-promotes it, the addition to this classifier is one line (`case 'pending-consequence': return 'advisory';` per the data-model doc's "signalling commitments" framing — informational, never blocking).

- **Public API shape — top-level functions, not a singleton object or a class.** Two functions plus a string-literal type alias. No state, no construction; tree-shakable; trivially testable. The diagnostic-event-emission task picked a class only for the stateful `DiagnosticBus`; the rest of the module is plain functions, and this task follows the latter pattern.

- **`partitionBySeverity` preserves input order within each bucket.** Stable partition. Two consumers want order: the moderator UI ("render in the order the detectors found them"), and tests ("a deterministic order is testable without sorting"). The pure-function alternative (`entries.filter(e => classify(e) === 'blocking')` + the dual) would also be stable but does two passes over the list; the single-pass helper is the same big-O, slightly faster, and ergonomically nicer.

- **Boundary with the methodology engine: future work, NOT this task.** The methodology doc says blocking diagnostics block forward progress *until acknowledged*. The word "acknowledged" is doing work — it is not "resolved" — and operationalizing it as a runtime check requires:
  - A notion of "acknowledged" on each diagnostic: a participant action (vote, gesture, explicit "noted") that flips a per-diagnostic acknowledgment flag.
  - A storage mechanism for that flag: either a new `session_events.kind = 'diagnostic-acknowledged'` row, or a side-channel `acknowledgments` table, or a projection-derived state.
  - A check inside `commit_logic` (or a wrapper) that consults `classifyDiagnostic` plus the acknowledgment state before allowing the commit to land.

  None of those exists today. The acknowledgment-event design alone is a non-trivial schema decision that mirrors the proposal/vote/commit pattern; it deserves its own refinement and ADR, not a side-effect of this 0.5d task. **The future task: `commit_gating_on_blocking_diagnostics` (provisional name).** This task delivers only the classifier and the partition helper; the gating wiring is its consumer.

- **No `session_events.kind = 'diagnostic-classified'`.** Like the diagnostic-event-emission task, this is derived data — classification is a pure function of the entry's kind. Persisting it would conflate authored events with inferred state and break the replay round-trip.

- **No modification of `commit_logic` or any other methodology handler.** Confirmed up-front and constraint-bound. The classifier is delivered as a stand-alone primitive; the handler-level wiring (gating, surface notification, UI consumer) is downstream.

- **TypeScript `Severity` is a string-literal union, not an enum.** Project-wide pattern — `FacetStatus`, `DiagnosticKind`, every other discriminator type in this codebase is a string-literal union. Enums add a runtime artifact (TypeScript erases `as const` unions; it doesn't erase `enum`); the union is the idiomatic choice.

- **`classifyDiagnostic` is exhaustive via TypeScript's discriminated-union narrowing.** The switch statement covers all five `DiagnosticKind` cases; the function has no `default` branch. Adding a sixth kind to the union (e.g., re-promoting pending-consequence) is a compile error in this file until classified — that is intentional. Tests assert all five current branches.

- **Test layout (Vitest).** `apps/server/src/diagnostics/classification.test.ts`. Synthetic `DiagnosticEntry` constructors (the same pattern as event-emission.test.ts) — no projection needed; the classifier is pure over the union and tests build entries as TS literals. The Cucumber scenario covers the projection-to-partition integration.

- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/classification.feature` + `tests/behavior/steps/diagnostics-classification.steps.ts`. One scenario: build a session with both a blocking diagnostic (cycle) and an advisory diagnostic (multi-warrant), project, partition, assert per-bucket contents. UUID prefix `c8...`.

- **Reusing `c8...` UUIDs.** The diagnostics step files use `c1` through `c7` for cycle, contradiction, multi-warrant, dangling-claim, coherency-hint, pending-consequences, and event-emission respectively. `c8...` is free and lands this file in the established naming convention.

## Open questions

- **How does commit-gating consult this classifier?** Open and out of scope. The downstream "commit_gating_on_blocking_diagnostics" task (not yet WBS-listed) will decide: does `commit_logic` import `classifyDiagnostic` directly, or does a wrapper `MethodologyService` consult it before delegating to the handler? Both work; the wrapper keeps the handler pure but adds a layer. The decision belongs with that future task, not here.
- **Does "acknowledged" need its own event kind?** Open. The acknowledgment notion is foreshadowed in the methodology doc but has no event-log representation today. Designing it is a separate refinement (and likely a new ADR — the event-log schema is one of the project's structural commitments).
- **Should the classifier produce more than two levels?** No. The methodology doc has exactly two categories; the data model echoes them. Three-or-more-level severity (e.g., `critical / warning / info`) is the kind of thing a UI-presentation layer can derive — `multi-warrant` is "more actionable" than `coherency-hint` even though both are advisory — without the classifier needing to carry that distinction.
- **Should the classifier accept a `DiagnosticKind` directly, in addition to a full `DiagnosticEntry`?** No. The current signature on `DiagnosticEntry` keeps the door open for future kinds whose severity depends on per-variant fields (e.g., a hypothetical contradiction variant where same-owner contradictions are blocking but cross-owner ones are advisory). Today no kind needs the payload; a future kind might. Accepting the full entry costs nothing and keeps the contract stable.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/diagnostics/classification.ts` — new file. Exports `Severity` (`'blocking' | 'advisory'`), `classifyDiagnostic(entry)` (pure, exhaustive switch over `DiagnosticEntry.kind` — no `default` branch; adding a sixth kind without classification is a TS compile error), and `partitionBySeverity(entries)` (single-pass partition; preserves input order within each bucket; round-trips by multiset). Per-kind mapping cited inline from `docs/methodology.md` lines 218 (cycle → blocking), 219 (contradiction → blocking), 225 (multi-warrant → advisory), 226 (dangling-claim → advisory), and 227 (coherency-hint → advisory; reaffirmed by `docs/data-model.md` line 197). All three coherency-hint sub-kinds (`incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts`) classify the same way; the doc has no per-sub-kind qualifier.
- `apps/server/src/diagnostics/index.ts` — barrel re-exports `classifyDiagnostic`, `partitionBySeverity`, and `Severity`.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `blocking_vs_advisory_classification`.
- `tasks/99-milestones.tji` — `complete 100` added to `m_methodology_engine_complete` (M2). With this task shipped, all diagnostics-group and methodology-engine-group tasks are at `complete 100`, so the milestone propagates per the refinement README's task-completion ritual.

Tests:

- `apps/server/src/diagnostics/classification.test.ts` — 10 Vitest cases across three groups. **`classifyDiagnostic` per kind** (5 cases): cycle → blocking; contradiction → blocking; multi-warrant → advisory; dangling-claim → advisory; coherency-hint → advisory. **`classifyDiagnostic` per coherency-hint sub-kind** (3 cases): `incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts` — each separately asserted as advisory so the per-sub-kind decision is visible to a future reader. **`partitionBySeverity`** (2 cases): a mixed list `[cycle, multi-warrant, contradiction, dangling-claim, coherency-hint]` partitions into `{ blocking: [cycle, contradiction], advisory: [multi-warrant, dangling-claim, coherency-hint] }` with preserved input order, multiset round-trip, and exactly-one-bucket property; empty input → empty buckets.
- `tests/behavior/diagnostics/classification.feature` — 1 Cucumber + pglite scenario. Builds a session that simultaneously surfaces a cycle (three-node `supports` chain A → B → C → A with substance commits) and a multi-warrant pattern (two warrants W1, W2 bridging a disjoint (D, K) pair via `bridges-from` + `bridges-to` edges). Projects the round-tripped log; calls `computeAllDiagnostics`; partitions by severity. Asserts the cycle entry lands in `blocking` with node set `{A, B, C}`; asserts exactly one multi-warrant entry lands in `advisory` on `(D, K)` with warrant set `{W1, W2}` and no multi-warrant entry in `blocking`; asserts every entry lands in exactly one bucket (round-trip property over the DB-round-tripped detector output).
- `tests/behavior/steps/diagnostics-classification.steps.ts` — step defs. UUID prefix `c8...` (free; the diagnostics step files cover `c1` through `c7`). Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`) and the established proposal-vote-commit pattern. Lifecycle event ids live in the `900xxx` band per the project-wide convention.

Test deltas:

- Vitest: 567 passed (was 557; +10 new classification cases).
- Cucumber: 107 scenarios passed (was 106; +1 new classification scenario), 543 steps total.
- Playwright smoke: 1 passed (unchanged).

`pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent (clean parse).

Boundary with the methodology engine: the classifier is delivered as a stand-alone primitive. `commit_logic` and its sibling handlers are not touched in this task. The downstream task that wires blocking-diagnostic acknowledgment into commit-gating (provisional name: `commit_gating_on_blocking_diagnostics`) will consume `classifyDiagnostic` from its commit-time check, but that work requires a notion of "acknowledged" on each diagnostic (per the methodology doc's "until acknowledged" framing in line 216) which has no event-log representation today — that schema decision is out of scope here and recorded as the leading open question above.

With this task complete, M2 is complete: the methodology engine handles every facet operation (classify, decompose, axiom-mark, defeater capture, meta-move, break-edge, amend-node, annotations, meta-disagreement, wording edits, withdrawal, commit) and the diagnostics module surfaces every v1-scoped structural pattern (cycles, contradictions, multi-warrants, dangling-claims, coherency hints) plus the stub for pending-consequences, with a unified event-emission abstraction and a per-kind severity classifier on top.
