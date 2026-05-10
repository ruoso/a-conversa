// Barrel for `apps/server/src/methodology/handlers`.
//
// Refinement: tasks/refinements/data-and-methodology/commit_logic.md
//
// Per-action handler modules. Each file exports a `Validator<TAction>`
// for one `ActionKind`. The engine's `installHandlers` (in
// `engine.ts`) imports each and registers it via
// `registerActionHandler`. Handler files do not self-register —
// registration is centralized in the engine so circular-import
// hazards are avoided: handlers depend on `types.ts` and
// `primitives.ts`; `engine.ts` depends on the handlers.
//
// **What's real here today.** `commitHandler` (`commit_logic`) and
// `voteHandler` (`withdrawal_logic`, which owns all three vote arms
// `agree` / `dispute` / `withdraw`) are the real validators. The
// remaining two — `placeholderProposeHandler` and
// `placeholderMarkMetaDisagreementHandler` — are still placeholders
// inherited from `agreement_state_machine`; the sibling tasks
// (`meta_disagreement_logic` and proposal-specific tasks) will
// replace them when they land.

export { commitHandler } from './commit.js';
export { placeholderProposeHandler } from './propose.js';
export { voteHandler } from './vote.js';
export { placeholderMarkMetaDisagreementHandler } from './markMetaDisagreement.js';
