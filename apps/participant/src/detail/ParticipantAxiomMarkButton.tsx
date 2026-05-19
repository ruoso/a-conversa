// `<ParticipantAxiomMarkButton>` — the participant's per-node axiom-mark
// button, mounted into `<EntityDetailPanel>`'s `actionSlot` from
// `OperateRoute.tsx` alongside `<ParticipantVoteButtons>`. One button
// per selected node; only visible when the current participant doesn't
// already hold an axiom mark on this node.
//
// Refinement: tasks/refinements/participant-ui/part_axiom_mark.md
//             (sibling to `part_voting`'s `<ParticipantVoteButtons>` —
//             the participant-side wire-action button pattern). Lives
//             next to `<EntityDetailPanel>` because the panel's
//             `actionSlot` is the only consumer today (the YAGNI
//             "promote on the third caller" rule).
//
// **Methodology semantics** (`docs/methodology.md` §"Axioms / terminal
// values"). Axiom-marks are PER-PARTICIPANT — only the debater
// themselves can hold a node as bedrock. The engine enforces this via
// `axiom-mark-not-self`; the participant surface passes
// `connection.user.id` so the rule passes naturally.
//
// Spec contract — the e2e methodology spec selects this button via:
//
//   [data-testid="participant-axiom-mark-button"][data-node-id="<id>"]
//
// Wire-action — binds a per-`nodeId` `useAxiomMarkAction` callback.
// Button reflects the hook's `inFlight` / `lastError` state:
//
//   - `inFlight === true` → button is `disabled` + `aria-disabled`;
//     `data-axiom-mark-state` flips to `"in-flight"`.
//   - `lastError !== undefined` → an inline error region renders next
//     to the button with `role="alert"` and the localized message.
//
// Visibility — the button suppresses itself when the current
// participant already holds a committed axiom-mark on this node (the
// `alreadyMarked` prop). Edges are not eligible at all (`edge-id` has
// no axiom-mark semantic); the route only mounts this button when the
// selection kind is `'node'`.
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes);
//   - 0022 (no throwaway verifications — covered by the unit tests in
//           `useAxiomMarkAction.test.tsx` for the wire side and by the
//           Phase 7.1 e2e spec for the integration side);
//   - 0024 (i18n via react-i18next — all chrome strings go through
//           `useTranslation()`);
//   - 0026 (participant-workspace-only; no shell export until a third
//           caller materialises — same posture as
//           `<ParticipantVoteButtons>` itself).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useAxiomMarkAction } from './useAxiomMarkAction';

export interface ParticipantAxiomMarkButtonProps {
  /** The selected node's id (axiom-marks attach only to nodes). */
  readonly nodeId: string;
  /** The authenticated participant's user id — goes onto the wire verbatim. */
  readonly currentParticipantId: string;
  /**
   * True when the current participant already holds a committed
   * axiom-mark on this node. Drives the component's empty-state — if
   * already marked, render nothing (the panel's `axiomMarks`
   * attribution section surfaces the existing mark; no second
   * affordance is needed).
   */
  readonly alreadyMarked: boolean;
}

export function ParticipantAxiomMarkButton(
  props: ParticipantAxiomMarkButtonProps,
): ReactElement | null {
  const { nodeId, currentParticipantId, alreadyMarked } = props;
  const { t } = useTranslation();

  const { markAsAxiom, inFlight, lastError } = useAxiomMarkAction({
    nodeId,
    participantId: currentParticipantId,
  });

  // Empty-state — the current participant already marked this node;
  // suppress the button entirely.
  if (alreadyMarked) return null;

  // Wire-error message text. The localized template interpolates
  // `{code}` + `{message}`; the timeout case uses the pre-localized
  // fallback already on `lastError.message`. Mirrors
  // `<ParticipantVoteButtons>`'s wire-error shaping.
  let wireMessage: string | undefined;
  if (lastError !== undefined) {
    wireMessage =
      lastError.code === 'timeout'
        ? lastError.message
        : t('participant.axiomMarkButton.wireError', {
            code: lastError.code,
            message: lastError.message,
          });
  }

  const markState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';

  return (
    <section
      data-testid="participant-detail-panel-axiom-mark-section"
      className="flex flex-col gap-1"
    >
      <h3 className="text-xs uppercase tracking-wide text-slate-500">
        {t('participant.detailPanel.sectionTitle.markAxiom')}
      </h3>
      <button
        type="button"
        data-testid="participant-axiom-mark-button"
        data-node-id={nodeId}
        data-axiom-mark-state={markState}
        disabled={inFlight}
        aria-disabled={inFlight}
        aria-label={t('participant.axiomMarkButton.ariaLabel')}
        onClick={() => {
          void markAsAxiom();
        }}
        className={
          inFlight
            ? 'rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-400'
            : 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50'
        }
      >
        {inFlight
          ? t('participant.axiomMarkButton.inFlightLabel')
          : t('participant.axiomMarkButton.label')}
      </button>
      {wireMessage !== undefined ? (
        <p
          data-testid="participant-axiom-mark-button-wire-error"
          data-node-id={nodeId}
          role="alert"
          aria-label={t('participant.axiomMarkButton.errorRoleLabel')}
          className="text-[10px] text-red-700"
        >
          {wireMessage}
        </p>
      ) : null}
    </section>
  );
}
