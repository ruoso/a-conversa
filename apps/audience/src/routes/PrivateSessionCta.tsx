// `<PrivateSessionCta>` — per-session sign-in CTA rendered when an
// anonymous visitor reaches a session URL whose subscribe was rejected
// with `not-found` (the existence-non-leak code per ADR 0029).
//
// Refinement: tasks/refinements/audience/aud_private_session_sign_in_cta.md
//   (Decision §1 — sibling overlay of `<AudienceGraphView>`, NOT a
//    replacement; Decision §2 — conditional wording honoring the
//    existence-non-leak rule; Decision §6 — `'unauthenticated'` and
//    `'needs-screen-name'` render the panel; `'authenticated'` and
//    `'loading'` render `null`.)
// ADRs:
//   - 0029 (anonymous-WS subscribe; existence-non-leak),
//   - 0026 (shell owns auth chrome — `<LoginButton>` consumed as-is),
//   - 0002 (OIDC handshake target — the LoginButton href),
//   - 0013 (TypeScript strict — exhaustive `switch (status)`).
//
// The panel is the audience surface's first `useAuth()` consumer inside
// `<AudienceLiveRoute>`. The placeholder route's `<AnonymousChrome>`
// (under `audience-sign-in`) is the other audience-side consumer; the
// two affordances are distinguished by testid.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { LoginButton, useAuth } from '@a-conversa/shell';

export function PrivateSessionCta(): ReactElement | null {
  const { t } = useTranslation();
  const { status, user } = useAuth();

  let visible: boolean;
  switch (status) {
    case 'unauthenticated':
    case 'needs-screen-name':
      visible = true;
      break;
    case 'authenticated':
      // Defensive narrow mirroring `<PlaceholderRoute>` (`App.tsx`): a
      // mid-mount flip between `status` and `user` can leave `user`
      // undefined briefly while status is `'authenticated'`. Treat it
      // as anonymous so the CTA still offers a sign-in path.
      visible = user === undefined;
      break;
    case 'loading':
      visible = false;
      break;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid="audience-private-session-cta"
      className="absolute inset-0 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
    >
      <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('audience.privateSession.title')}
        </h2>
        <p className="mt-2 text-sm text-slate-700">{t('audience.privateSession.body')}</p>
        <div className="mt-4">
          <LoginButton className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" />
        </div>
      </div>
    </div>
  );
}
