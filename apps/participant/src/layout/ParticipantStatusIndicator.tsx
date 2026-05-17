// `<ParticipantStatusIndicator>` — persistent connection-state chip for
// the participant tablet footer.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
// Design doc: docs/participant-ui.md ("A persistent status indicator")
//
// Visual surface (one row, ~48 px tall, lives inside the layout's
// `participant-footer` slot):
//
//     [colored-dot]  [localized label]
//
// The chip is structure + presentation only. The connection-state value
// it visualizes comes from `useParticipantConnectionStatus()` (below)
// — today a derived/stubbed source (Decision §2), tomorrow a one-line
// swap to `useWsStore((s) => s.connectionStatus)` once `part_ws_client`
// makes the store callable from the participant surface.
//
// State → visual mapping (per-state Tailwind utility classes are inline
// pending `packages/ui-tokens` per ADR 0005):
//
//   idle          slate-400   "Not connected"
//   connecting    amber-500   "Connecting…"
//   open          emerald-500 "Live"
//   reconnecting  amber-500   "Reconnecting…"
//   closed        rose-500    "Disconnected"
//
// The container is `role="status"` + `aria-live="polite"` so screen
// readers announce state transitions without interrupting the user;
// the label is the announced text.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { WsConnectionStatus } from '@a-conversa/shell';

import { useParticipantConnectionStatus } from './useParticipantConnectionStatus';

const DOT_CLASSES: Record<WsConnectionStatus, string> = {
  idle: 'bg-slate-400',
  connecting: 'bg-amber-500',
  open: 'bg-emerald-500',
  reconnecting: 'bg-amber-500',
  closed: 'bg-rose-500',
};

const TONE: Record<WsConnectionStatus, 'neutral' | 'transient' | 'healthy' | 'error'> = {
  idle: 'neutral',
  connecting: 'transient',
  open: 'healthy',
  reconnecting: 'transient',
  closed: 'error',
};

const LABEL_KEY: Record<WsConnectionStatus, string> = {
  idle: 'participant.statusIndicator.idle',
  connecting: 'participant.statusIndicator.connecting',
  open: 'participant.statusIndicator.open',
  reconnecting: 'participant.statusIndicator.reconnecting',
  closed: 'participant.statusIndicator.closed',
};

export function ParticipantStatusIndicator(): ReactElement {
  const { t } = useTranslation();
  const status = useParticipantConnectionStatus();
  return (
    <div
      data-testid="participant-status-indicator"
      data-status={status}
      data-status-tone={TONE[status]}
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-slate-700"
    >
      <span
        data-testid="participant-status-indicator-dot"
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASSES[status]}`}
      />
      <span data-testid="participant-status-indicator-label">{t(LABEL_KEY[status])}</span>
    </div>
  );
}
