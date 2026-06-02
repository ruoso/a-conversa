# Refinement: `participant_ui.part_participant_tab_bar_rename`

> **TaskJuggler:** [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji) →
> `task part_participant_tab_bar_rename` ("Naming hygiene: rename
> `PendingProposalsTabBar` → `ParticipantTopTabBar`").

## Effort estimate

**0.5d.** Purely mechanical rename — file + component + props interface +
test file + barrel export + two import/JSX sites. No semantic change, no new
test logic. The half-day covers the rename, the green build/test gate, and the
careful "did I catch every reference" sweep.

## Inherited dependencies

The WBS block carries **no `depends` edge** — the note states it "can land at
any time post-`part_my_agreements_view`." The relationship is a soft
ordering, not a scheduler edge:

- **Settled — `participant_ui.part_my_agreements_view`** (Done 2026-05-27).
  That leaf added the third `<TabButton tab="my-agreements">` to the strip,
  which is what made the `PendingProposalsTabBar` name a misnomer (the
  component now hosts graph + proposals + my-agreements tabs). Its Decision §6
  + §8 explicitly registered this rename as tech-debt and named the target
  symbol `ParticipantTopTabBar`. See
  [`part_my_agreements_view.md`](part_my_agreements_view.md) §6 + §8.

- **Pending — none.** No predecessor work is outstanding. The rename touches a
  file that later participant tasks (`part_withdraw_proposal_gesture`,
  `part_withdraw_proposal_overlay_removal`) do not modify, so there is no merge
  ordering hazard either direction; it can land before or after them.

## What this task is

A symbol-and-file rename. `PendingProposalsTabBar` was created by
`part_proposals_tab` as a *two*-button strip (graph + proposals), and the name
fit. It has since grown a third tab (my-agreements) and is the participant
operate route's single top-of-main tab strip — so its concrete name now
under-describes it. Rename the component, its props interface, its source file,
its test file, and the barrel export to `ParticipantTopTabBar`, and update the
two consuming sites (the barrel-imported reference in `OperateRoute.tsx` and the
JSX usage). No behavior, markup, `data-testid`, i18n key, or props *shape*
changes — only identifiers.

## Why it needs to be done

`part_my_agreements_view` Decision §6 chose to *keep* the misleading name in
that leaf to keep the feature focused, and registered the rename as a separate
naming-hygiene leaf (Decision §8) so the churn lands in one reviewable,
behavior-neutral commit rather than smeared across a feature diff. This is that
leaf. The payoff is readability: a future reader opening
`apps/participant/src/proposals/` should not have to know the file's history to
understand that `ParticipantTopTabBar` is *the* top tab strip, not a
proposals-only widget. Downstream there are no consumers waiting on the new
name — this is pure maintenance debt paydown.

## Inputs / context

Real references (paths + lines current as of this refinement):

- [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx)
  — the component file. Renames:
  - line 1 — header comment `` `<PendingProposalsTabBar>` `` → `` `<ParticipantTopTabBar>` ``.
  - line 20 — `export interface PendingProposalsTabBarProps {`.
  - lines 36–39 — `export function PendingProposalsTabBar({ ... }: PendingProposalsTabBarProps)`.
  - The internal `TabButton` helper (lines 77–100) and **all `data-testid`
    strings** (`participant-proposals-tabbar`, `-badge`, `-${tab}`) stay
    byte-identical — see Decision §2.
- [`apps/participant/src/proposals/PendingProposalsTabBar.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.test.tsx)
  — rename the file to `ParticipantTopTabBar.test.tsx`; update line 1 comment,
  line 14 `import { PendingProposalsTabBar } from './PendingProposalsTabBar'`,
  the `renderBar` mount (line 54), the `describe('<PendingProposalsTabBar>')`
  label (line 59), and the two `isFlashing` mounts (lines 135, 173, 180). The
  `data-testid`-based queries inside the cases do **not** change.
- [`apps/participant/src/proposals/index.ts:8`](../../../apps/participant/src/proposals/index.ts#L8)
  — barrel export `export { PendingProposalsTabBar, type PendingProposalsTabBarProps } from './PendingProposalsTabBar';`
  → new symbols + `'./ParticipantTopTabBar'` module path.
- [`apps/participant/src/routes/OperateRoute.tsx:62-67`](../../../apps/participant/src/routes/OperateRoute.tsx#L62)
  — the barrel import block lists `PendingProposalsTabBar,` (line 65).
- [`apps/participant/src/routes/OperateRoute.tsx:392`](../../../apps/participant/src/routes/OperateRoute.tsx#L392)
  — the JSX usage `<PendingProposalsTabBar sessionId={id} isFlashing={arrival.isBadgeFlashing} />`.
- [`apps/participant/src/routes/OperateRoute.test.tsx:329`](../../../apps/participant/src/routes/OperateRoute.test.tsx#L329)
  — a comment that names `<PendingProposalsTabBar>`; update the prose for
  accuracy (no code change in that file).

**Not in scope** (verified references that must stay untouched):

- The four Playwright specs that query `participant-proposals-tabbar*` testids
  (`tests/e2e/cross-surface-participant-withdraw-proposal.spec.ts`,
  `tests/e2e/participant-pending-proposals.spec.ts`,
  `tests/e2e/participant-reconnect-seed-visible-styling.spec.ts`,
  `tests/e2e/participant-my-agreements.spec.ts`) — they select by `data-testid`,
  which does not change (Decision §2), so they need no edit and serve as the
  cross-surface regression net.
- Sibling refinement docs that mention `PendingProposalsTabBar` in prose
  (`part_proposals_tab.md`, `part_proposal_list_view.md`,
  `part_proposal_notification.md`, `part_my_agreements_view.md`, etc.) are
  historical records — per the README "don't edit the prior sections"
  discipline, refinements are frozen narrative and are **not** retroactively
  renamed.
- `usePendingProposalsCount`, `PendingProposalsPane`, `derivePendingProposals`,
  and the `participant.proposalsTab.*` i18n namespace keep their names — they
  are genuinely about *pending proposals*, not the tab strip. Only the strip
  symbol is the misnomer. See Decision §3.

## Constraints / requirements

1. **Symbol + file rename only.** `ParticipantTopTabBar`,
   `ParticipantTopTabBarProps`, `ParticipantTopTabBar.tsx`,
   `ParticipantTopTabBar.test.tsx`. The props shape, default values,
   rendered markup, class strings, and ARIA roles are byte-stable.
2. **`data-testid` values are frozen** (Decision §2). Every
   `participant-proposals-tabbar*` attribute string stays exactly as-is.
3. **No directory move.** The file stays in
   `apps/participant/src/proposals/` (Decision §4).
4. **No i18n key churn.** `participant.proposalsTab.*` keys are untouched
   (Decision §3).
5. **Use the file-move-preserving rename** so git records a rename, not a
   delete+add, keeping `git log --follow` history intact (`git mv` for both the
   component and the test file).
6. **Zero net new behavior.** Every existing Vitest case in the renamed test
   file passes with only the import/label identifier updated; no case is added,
   removed, or has its assertions changed.
7. **Build + test gate before commit** (global CLAUDE.md rule): `make` /
   `pnpm` build, typecheck, lint, and the participant Vitest suite are green.
   This commit touches source (`.tsx`/`.ts`), so the doc-only skip does **not**
   apply.

## Acceptance criteria

All criteria are pinned by the existing suite, renamed — no throwaway
verification scripts (ADR 0022: the renamed `ParticipantTopTabBar.test.tsx`
*is* the regression pin; it is a permanent part of the suite, not a one-off
check).

1. **Grep is clean.** After the change, a repo-wide search for the identifier
   `PendingProposalsTabBar` returns **only** frozen refinement-doc prose (the
   historical records listed under "Not in scope") — zero matches under
   `apps/`, `tests/`, or any barrel.
2. **Typecheck + build pass.** The participant app and the workspace build with
   no unresolved-import or unused-symbol errors (the barrel + `OperateRoute`
   import resolve to the new symbol).
3. **Lint passes.** ESLint (ADR 0011) + Prettier (ADR 0012) clean — no stale
   import ordering, no unused `PendingProposalsTabBar` binding.
4. **Vitest green, count unchanged.** `ParticipantTopTabBar.test.tsx` runs the
   same cases as before (the `part_proposals_tab` base cases + the
   `part_proposal_notification` flashing cases + the `part_my_agreements_view`
   third-tab cases). The participant smoke count is **net zero** delta — same
   cases, renamed.
5. **`OperateRoute.test.tsx` passes unchanged** — its only edit is the line-329
   comment; its assertions (which query by `data-testid`) are untouched and
   green.
6. **No Playwright change; existing specs green.** Because `data-testid` values
   are frozen, the four e2e specs that touch the strip continue to pass with no
   edit. See the e2e-policy note below.

### E2e policy — no new Playwright spec, by the "no user-visible change" rule

The UI-stream e2e policy's default ("e2e is in scope") presupposes the task
adds *user-visible behavior*. This task adds none: it is a pure identifier
refactor whose only observable contract — the `data-testid` selectors and the
rendered markup — is held **byte-stable** by Decision §2. The behavior the
strip exhibits is already exercised end-to-end by four existing specs
(`participant-pending-proposals`, `participant-my-agreements`,
`participant-reconnect-seed-visible-styling`,
`cross-surface-participant-withdraw-proposal`). Those specs are the e2e
regression net for this rename — if the rename accidentally broke a render
path, they fail. No new spec is scoped and no spec is deferred to a future
`part_pw_*` task, because there is no new reachable behavior to cover. This is
**not** a "deferred-e2e" case (the component is fully reachable and already
e2e-covered); it is a "nothing new to test end-to-end" case. The implementer
runs the existing participant e2e specs as part of the green-gate to confirm
the byte-stability claim.

## Decisions

### 1. New name is `ParticipantTopTabBar`

Chosen per the WBS title and `part_my_agreements_view` Decision §8, which both
name the target `ParticipantTopTabBar`. It describes the component's actual
role — the participant operate route's single top-of-main tab strip — without
re-encoding which tabs it currently hosts (so adding/removing a tab later won't
re-misname it). Alternatives surveyed:

- **`ParticipantTabBar`** — slightly shorter but loses the "top" placement cue
  that distinguishes it from any future bottom/side affordance. Rejected for
  marginal benefit; the registered name already has buy-in.
- **`OperateTabBar`** — ties the name to the *route* rather than the surface.
  Rejected — the route could be renamed independently; "Participant" is the
  stabler qualifier and matches the app/package naming.

### 2. `data-testid` values stay frozen (`participant-proposals-tabbar*`)

The strip's `data-testid="participant-proposals-tabbar"`, its `-badge` child,
and the `participant-proposals-tabbar-${tab}` button ids are queried by **four
Playwright specs** and several Vitest cases. They are a cross-surface
behavioral contract, not an implementation detail. Renaming them would (a) pull
four e2e specs into a "naming hygiene" diff, turning a behavior-neutral refactor
into a behavior-observable change, and (b) risk a missed selector breaking a
spec at runtime rather than compile time. The misnomer being paid down is the
*code symbol*, which readers of `apps/participant/src/` see; the testid is an
internal protocol string that no human reads as documentation. Keeping it frozen
is the lower-risk, tighter-scoped choice.

- **Alternative — rename testids to `participant-top-tabbar*` for full
  consistency.** Rejected: it converts a zero-risk symbol rename into a
  multi-spec edit with runtime-failure surface, contradicting the WBS note's
  "purely mechanical; no semantic change" framing. If a future task wants
  testid consistency, it should be its own scoped leaf that updates the strip +
  all four specs together with the e2e suite as the gate — not smuggled into
  this one.

### 3. Sibling symbols + i18n keys keep their `PendingProposals*` names

Only the *tab-strip* component is misnamed. `usePendingProposalsCount`,
`PendingProposalsPane`, `derivePendingProposals`, `PendingProposalRow`, and the
`participant.proposalsTab.*` catalog keys are all genuinely about pending
proposals (the count badge, the proposals pane, its selector). Renaming them
would be wrong (they'd then be misnamed in the *other* direction) and would
balloon the diff into the i18n catalogs + their pending native-review flags.
Scope stays surgical: one component, its props, its file, its test, its barrel
line, two call sites.

### 4. File stays in `apps/participant/src/proposals/`

`part_proposals_tab` Decision §5/§(C) chose a participant-local
`proposals/` directory and explicitly anticipated that "if a second
participant-side tab need ever arises, a future refactor can extract." That
extraction (moving the now-multi-purpose tab strip up to, say,
`apps/participant/src/layout/`) is a *different*, larger refactor with its own
import-churn surface. This leaf is scoped as a rename, not a relocation. Moving
the file would also muddy the git rename detection. Keep it in `proposals/`;
the directory name is a lesser misnomer than the symbol was and is out of
scope here.

- **Alternative — move to `apps/participant/src/layout/` in the same commit.**
  Rejected: couples a directory move (more import sites, larger blast radius)
  to a symbol rename; violates the one-reviewable-behavior-neutral-commit intent
  from `part_my_agreements_view` §8. If the directory placement bothers a future
  reader, it is a separately-scopeable leaf.

### 5. No new ADR

No architectural seam is added or amended — no new dependency, module
boundary, wire/projector behavior, or security trade-off. The ADR "amendment
-pass rule" (`docs/adr/README.md`) does not fire. This is a refactor under the
existing React (ADR 0003) + Vitest (ADR 0006) + ESLint/Prettier (ADRs
0011/0012) conventions, pinned by the existing suite per ADR 0022.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` → `ParticipantTopTabBar.tsx` (via `git mv`; component identifier, props interface, and function signature updated; `data-testid` strings byte-stable).
- `apps/participant/src/proposals/PendingProposalsTabBar.test.tsx` → `ParticipantTopTabBar.test.tsx` (via `git mv`; import path, `describe` label, and mount call identifiers updated; test assertions unchanged).
- `apps/participant/src/proposals/index.ts` — barrel export updated: old symbol/module path replaced with `ParticipantTopTabBar` / `ParticipantTopTabBarProps` / `'./ParticipantTopTabBar'`.
- `apps/participant/src/routes/OperateRoute.tsx` — barrel import and JSX usage updated to `ParticipantTopTabBar`.
- `apps/participant/src/routes/OperateRoute.test.tsx` — line-329 comment updated for accuracy; assertions (querying by `data-testid`) unchanged.
- Repo-wide grep for `PendingProposalsTabBar` clean outside frozen refinement docs (per acceptance criterion 1).
- No new tests, no `data-testid` changes, no behavior change; existing four Playwright specs serve as the unchanged e2e regression net.
