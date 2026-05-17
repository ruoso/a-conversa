// `<LobbyPlaceholderRoute>` — placeholder destination for the
// post-claim navigation.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Decision §1 — navigate to `/sessions/${id}/lobby`
//              with a dedicated placeholder route so the URL settles
//              on the canonical lobby URL and the future
//              `part_lobby_view` has an unambiguous removal target).
// ADRs:        0022 (no throwaway verifications — the placeholder
//                    testid + the session-id testid are the pinned
//                    seams for the happy-path Playwright spec),
//              0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()` for the identity row).
//
// !!! REMOVE-ME-WHEN-PART-LOBBY-VIEW-LANDS !!!
//
// This route exists so the invite-acceptance route's success
// navigation has a destination. The real lobby UX — slot occupancy,
// ready-state badges, the moderator's "enter session" signal —
// belongs to `participant_ui.part_session_join.part_lobby_view`
// (the next sibling WBS leaf, `depends !part_invite_acceptance`).
// When that leaf lands, replace this component's body with the real
// implementation (or delete this file entirely if the lobby route
// moves to a new module).
//
// The route renders the same chrome as the invite-acceptance route
// (`<ParticipantLayout>` with `<ParticipantChrome>` header +
// `<ParticipantStatusIndicator>` footer) so the user sees no chrome
// flicker on the in-surface navigation; only the main region content
// changes. The body shows a one-line "You're in the lobby" message
// and surfaces the path's `:id` under the stable `session-id` testid
// (mirrors the moderator's `Lobby.tsx` placeholder shape) so the
// Playwright happy-path scenario can assert the session id round-tripped
// through the navigation.

import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';

function LobbyPlaceholderBody(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  return (
    <div data-testid="lobby-placeholder" className="mx-auto max-w-2xl p-6">
      <p className="text-sm text-slate-700">{t('participant.lobbyPlaceholder.body')}</p>
      <p data-testid="session-id" className="mt-2 text-xs text-slate-500">
        {id}
      </p>
    </div>
  );
}

export function LobbyPlaceholderRoute(): ReactElement {
  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<LobbyPlaceholderBody />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}
