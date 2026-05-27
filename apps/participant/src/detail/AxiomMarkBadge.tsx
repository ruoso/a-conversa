// `<AxiomMarkBadge>` — participant-local chromatic badge for one
// committed axiom-mark, rendered in the entity detail panel's Section 4
// (axiom-mark attribution row).
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel_chromatic_axiom_mark_badge.md
//   Decision §1.b — participant-local re-port (not a cross-workspace
//   import of the moderator's primitive, not a shell extraction yet).
//   The shell-side lift waits for the audience surface to become the
//   third caller (named-future-task `shell_package.extract_axiom_mark_badge`).
//
// Prop shape: takes a resolved `screenName` directly (the participant
// workspace has the roster locally via `participantRoster.ts`); the
// moderator's primitive takes a raw `AxiomMark` because the moderator
// does not yet have a participants projection. Same DOM shape, same
// chromatic palette (`axiomMarkColorFor` from `@a-conversa/shell`), same
// deterministic per-participant color.
//
// ADRs:
//   - 0003 (React);
//   - 0005 (Tailwind utility classes — the chromatic class triple
//           originates in `@a-conversa/shell`'s `AXIOM_MARK_PALETTE`);
//   - 0024 (react-i18next — the `aria-label` resolves through
//           `participant.detailPanel.axiomMarkBadge.srLabel`).

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor } from '@a-conversa/shell';

export interface AxiomMarkBadgeProps {
  readonly participantId: string;
  readonly screenName: string;
}

function AxiomMarkBadgeImpl(props: AxiomMarkBadgeProps): ReactElement {
  const { participantId, screenName } = props;
  const { t } = useTranslation();
  const color = axiomMarkColorFor(participantId);
  const srLabel = t('participant.detailPanel.axiomMarkBadge.srLabel', { screenName });
  return (
    <span
      data-testid={`participant-detail-panel-axiom-mark-badge-${participantId}`}
      data-participant-id={participantId}
      title={screenName}
      aria-label={srLabel}
      role="img"
      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm ${color.bg} ${color.text} ring-1 ${color.ring} text-[11px] font-semibold leading-none`}
    >
      A
    </span>
  );
}

export const AxiomMarkBadge = memo(AxiomMarkBadgeImpl);
