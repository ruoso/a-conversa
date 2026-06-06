// `<ParticipantOperateFooter>` — the operate-route footer composition.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Decision §1 + §2)
//
// The operate route is the ONLY participant surface where structural
// diagnostics exist, so the diagnostics affordance must mount there and
// nowhere else (Constraint §3). Rather than push route awareness into
// the shared `<ParticipantStatusIndicator>` (which the lobby + invite
// footers reuse verbatim), this wrapper composes the existing status
// chip PLUS the operate-only diagnostics affordance + list. The other
// routes keep `footer={<ParticipantStatusIndicator />}` untouched.

import type { ReactElement } from 'react';

import { ParticipantStatusIndicator } from './ParticipantStatusIndicator';
import { ParticipantDiagnosticsList } from './ParticipantDiagnosticsList';

export interface ParticipantOperateFooterProps {
  readonly sessionId: string;
}

export function ParticipantOperateFooter(props: ParticipantOperateFooterProps): ReactElement {
  const { sessionId } = props;
  return (
    <div
      data-testid="participant-operate-footer"
      className="flex w-full items-center justify-between gap-4"
    >
      <ParticipantStatusIndicator />
      <ParticipantDiagnosticsList sessionId={sessionId} />
    </div>
  );
}
