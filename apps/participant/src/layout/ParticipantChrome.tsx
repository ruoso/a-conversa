// `<ParticipantChrome>` — header content for the participant surface.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Decision §9 — extract `<ParticipantChrome>` from
//              `App.tsx` so multiple routes can compose the same chrome
//              without duplicating the component or exporting it from a
//              file whose purpose is the route table).
// Predecessors: tasks/refinements/participant-ui/part_auth_flow.md
//                (the `useAuth()` consumption shape lands here),
//               tasks/refinements/participant-ui/part_landscape_layout.md
//                (the identity row migrates up into the header).
// ADRs:        0002 (no profile data — only `screenName` reaches the
//                    DOM; the same posture as `part_auth_flow`),
//              0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()` — no second auth fetch).
//
// Chrome content for the header row: left-aligned product label +
// right-aligned identity affordance. Mirrors the `part_auth_flow`
// `useAuth()` consumption shape exactly (status switch first, then
// `.user !== undefined` belt-and-suspenders, then `.screenName`
// access). Reuses the existing `participant.identity.signedInAs` ICU
// key — no new key for the identity row.
//
// When unauthenticated, the chrome renders the product label only
// (no identity row). The "not authenticated" body panel still lives
// inside each route's body (route content), not the chrome — auth-
// state messaging belongs in the content region per `part_auth_flow`
// Decision §3.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

export function ParticipantChrome(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  return (
    <>
      <span className="text-sm font-semibold text-slate-800">
        {t('participant.chrome.productLabel')}
      </span>
      {auth.status === 'authenticated' && auth.user !== undefined ? (
        <span data-testid="participant-identity" className="text-sm text-slate-700">
          {t('participant.identity.signedInAs', { name: auth.user.screenName })}
        </span>
      ) : null}
    </>
  );
}
