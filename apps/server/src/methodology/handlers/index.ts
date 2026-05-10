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
// **What's real here today.** `commitHandler` is the real validator
// (this task — `commit_logic`). The other three handlers are still
// placeholders inherited from `agreement_state_machine`; the sibling
// tasks `withdrawal_logic` / `vote_logic`, `meta_disagreement_logic`,
// and proposal-specific tasks will replace them when they land.

export { commitHandler } from './commit.js';
export { placeholderProposeHandler } from './propose.js';
export { placeholderVoteHandler } from './vote.js';
export { placeholderMarkMetaDisagreementHandler } from './markMetaDisagreement.js';
