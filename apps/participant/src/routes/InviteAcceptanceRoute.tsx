// `<InviteAcceptanceRoute>` — the participant's claim-the-debater-slot
// route, mounted at `/sessions/:id/invite?role=...` under the surface's
// `/p` basename.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
// Predecessor: tasks/refinements/backend/session_invite_self_claim_endpoint.md
//              (the `POST /api/sessions/:id/invite/claim` handler this
//              route POSTs against; the typed error envelope shape is
//              fixed by that endpoint).
// Sibling:     tasks/refinements/participant-ui/part_ws_client.md
//              (the surface-wide `<WsClientProvider>` this route
//              consumes via `useWsClient()`; this leaf closes that
//              refinement's deferred-debt block by installing the first
//              per-session `client.trackSession(sessionId)` lifecycle
//              against a real `:id` from `useParams()`).
// ADRs:        0002 (cookie-only auth — the claim POST relies on the
//                    same-origin `aconversa-session` cookie via
//                    `credentials: 'include'`; the body is `{ role }`
//                    only, no `userId`),
//              0021 (post-COMMIT `participant-joined` broadcast lands
//                    in the per-session slice via `applyEvent` — the
//                    route does not extend the reducer),
//              0022 (no throwaway verifications — every testid the
//                    route emits is asserted by the Vitest case set
//                    + the Playwright happy-path / not-found scenarios),
//              0026 (host owns auth chrome; surface only reads the
//                    host-supplied `useAuth()` — no second auth fetch).
//
// Flow:
//
//   1. Read `:id` from the path via `useParams<{ id: string }>()`.
//   2. Read `?role=...` from the query via `useSearchParams()`; the
//      role hint is required (a malformed URL renders the terminal
//      "invalid invite URL" panel and does not expose the join button).
//   3. Subscribe to the per-session WS via `client.trackSession(id)`
//      on mount; pair with `untrackSession` on cleanup. Idempotent
//      re-tracking is safe per `ws-client.test.ts:547`.
//   4. Render the pre-claim hint ("You're joining this debate as
//      <role> as <screenName>") + the primary "Join this debate"
//      button.
//   5. On click, POST `{ role }` to
//      `/api/sessions/${id}/invite/claim`. On 200, navigate to
//      `/sessions/${id}/lobby` (the placeholder lobby route lives in
//      this leaf; `part_lobby_view` replaces it). On a typed error,
//      surface a discriminating panel per the Decision §3 mapping
//      table; the button stays visible only for retryable codes.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useWsClient } from '@a-conversa/shell';

import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';
import { mapInviteAcceptanceError } from '../error-mapper/inviteAcceptanceError';

const VALID_ROLES = ['debater-A', 'debater-B'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

type ClaimStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | {
      kind: 'error';
      i18nKey: string;
      isRetryable: boolean;
      isTerminal: boolean;
      code: string;
    };

export function InviteAcceptanceRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const rawRole = searchParams.get('role') ?? '';
  const role = (VALID_ROLES as readonly string[]).includes(rawRole)
    ? (rawRole as ValidRole)
    : undefined;

  const client = useWsClient();

  // Inherited from `part_ws_client` Decision §1: the per-session
  // subscription lifecycle. Idempotent re-tracking on a remount is
  // safe per `ws-client.test.ts:547`; the cleanup pairs trackSession
  // with untrackSession so the server's subscription registry stays
  // clean. Mirrors the moderator's pattern at
  // `apps/moderator/src/routes/InviteParticipants.tsx:189-195`
  // line-for-line.
  useEffect(() => {
    if (id === '') return;
    void client.trackSession(id);
    return () => {
      void client.untrackSession(id);
    };
  }, [client, id]);

  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<InviteAcceptanceRouteBody id={id} role={role} />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

function InviteAcceptanceRouteBody({
  id,
  role,
}: {
  id: string;
  role: ValidRole | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ClaimStatus>({ kind: 'idle' });

  // Belt-and-suspenders against the mid-mount auth-status flip. The
  // chrome's identity row + the host's SurfaceHost cleanup are the
  // primary defenses; this guard prevents `.screenName` access if
  // React re-renders between the auth flip and the host's tear-down
  // (mirrors `part_auth_flow` Decision §3 + the `<PlaceholderRouteBody>`
  // shape).
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div
        data-testid="route-invite-acceptance"
        data-state="not-authenticated"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="participant-not-authenticated" className="text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  // Malformed-URL gate. The endpoint's body schema would 400 anyway,
  // but discriminating the malformed-URL case at the route layer
  // keeps the user-facing message accurate (a 400 from the server
  // would surface as the generic-validation panel, which is the
  // wrong story for a malformed invite URL).
  if (role === undefined) {
    return (
      <div
        data-testid="route-invite-acceptance"
        data-state="invalid-url"
        className="mx-auto max-w-2xl p-6"
      >
        <p
          data-testid="invite-acceptance-error-invalid-url"
          role="alert"
          aria-live="polite"
          className="text-sm text-red-700"
        >
          {t('participant.inviteAcceptance.errors.invalidUrl')}
        </p>
      </div>
    );
  }

  const roleLabel = t(
    role === 'debater-A'
      ? 'participant.inviteAcceptance.roleLabels.debaterA'
      : 'participant.inviteAcceptance.roleLabels.debaterB',
  );

  const handleClaim = useCallback(async (): Promise<void> => {
    setStatus({ kind: 'submitting' });
    try {
      const response = await fetch(`/api/sessions/${id}/invite/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (response.status === 200) {
        // Per Decision §1: navigate to the placeholder lobby route.
        // `part_lobby_view` replaces the destination. `replace: true`
        // keeps the back-button from re-landing on the invite URL
        // (which would re-fire the claim and hit `user-already-joined`).
        // The `void` swallows react-router 7+'s promise return shape.
        void navigate(`/sessions/${id}/lobby`, { replace: true });
        return;
      }
      const errBody = (await response.json().catch(() => ({}))) as {
        error?: { code?: string };
        code?: string;
      };
      // The platform's error envelope uses `error.code` (per
      // `errorEnvelopeRef` in the server). A defensive fallback to
      // top-level `code` covers a future envelope-shape change.
      const code = errBody.error?.code ?? errBody.code ?? 'unknown';
      const mapped = mapInviteAcceptanceError(code, response.status);
      setStatus({ kind: 'error', ...mapped, code });
    } catch {
      const mapped = mapInviteAcceptanceError('network', 0);
      setStatus({ kind: 'error', ...mapped, code: 'network' });
    }
  }, [id, role, navigate]);

  const buttonVisible = status.kind !== 'error' || status.isRetryable;

  return (
    <div data-testid="route-invite-acceptance" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.inviteAcceptance.title')}</h1>
      <p data-testid="invite-acceptance-hint" className="mt-2 text-sm text-slate-700">
        {t('participant.inviteAcceptance.hint', { role: roleLabel, name: auth.user.screenName })}
      </p>
      {buttonVisible ? (
        <button
          type="button"
          data-testid="invite-acceptance-join-button"
          disabled={status.kind === 'submitting'}
          onClick={() => {
            void handleClaim();
          }}
          className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {status.kind === 'submitting'
            ? t('participant.inviteAcceptance.joining')
            : t('participant.inviteAcceptance.joinButton')}
        </button>
      ) : null}
      {status.kind === 'error' ? (
        <p
          data-testid={`invite-acceptance-error-${status.code}`}
          role="alert"
          aria-live="polite"
          className="mt-4 text-sm text-red-700"
        >
          {t(status.i18nKey)}
        </p>
      ) : null}
      {status.kind === 'error' && status.isTerminal && status.code === 'user-already-joined' ? (
        <button
          type="button"
          data-testid="invite-acceptance-go-to-lobby"
          onClick={() => {
            void navigate(`/sessions/${id}/lobby`, { replace: true });
          }}
          className="mt-4 inline-flex rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700"
        >
          {t('participant.inviteAcceptance.goToLobby')}
        </button>
      ) : null}
    </div>
  );
}
