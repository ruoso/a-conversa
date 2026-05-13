// Screen-name form route for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_auth_flow.md
// Backend contract: POST /auth/screen-name (apps/server/src/auth/routes.ts).
// TaskJuggler: moderator_ui.mod_shell.mod_auth_flow
//
// First-login surface. The OIDC callback set the `aconversa-auth-pending`
// cookie; this route POSTs `{ screenName }` to `/auth/screen-name`, the
// backend trims + validates, writes the row, swaps cookies (pending →
// session), and returns `{ userId, screenName }`. On success the form
// calls `auth.refresh()` and navigates back to `/login`, which then
// renders the welcome banner.
//
// `mod_screen_name_setup` (the next 0.5d sibling) layers UX polish on
// top — character-count helper, validation hints, error-recovery prose.
// This task lands working bones.

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/useAuth';

/**
 * Map a backend `ErrorEnvelope.code` value onto a localization key
 * under the `auth.screenName.errors` namespace. Unknown codes fall back
 * to the generic message. Mirrors the backend's
 * `apps/server/src/auth/routes.ts` envelopes.
 */
function errorCodeToI18nKey(code: string): string {
  switch (code) {
    case 'screen-name-invalid':
      // The handler emits one of three messages keyed off the
      // validation reason; we map the canonical code onto the
      // "validation failed somewhere" key. The whitespace/length-
      // specific keys are matched client-side BEFORE the POST (see
      // submit() — the trim + maxLength happen first), so this
      // branch typically lands on the generic-empty message.
      return 'auth.screenName.errors.empty';
    case 'screen-name-already-set':
      return 'auth.screenName.errors.alreadySet';
    case 'auth-pending-cookie-invalid':
      return 'auth.screenName.errors.pendingCookieInvalid';
    case 'validation-failed':
      return 'auth.screenName.errors.empty';
    default:
      return 'auth.screenName.errors.generic';
  }
}

/**
 * The maximum input length the textbox accepts. Defensive cap matching
 * the backend's `screenNameBodySchema.maxLength = 256`. The post-trim
 * 64-character check is the authoritative validation; this prevents the
 * user from typing megabytes by accident.
 */
const MAX_INPUT_LENGTH = 256;

/**
 * Length of a trimmed screen name above which the server returns
 * `too-long`. The client mirrors this for an immediate inline error.
 */
const MAX_TRIMMED_LENGTH = 64;

export function ScreenNameRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();

  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);

  const trimmed = value.trim();
  // Disable submit on empty-after-trim OR when a request is in flight.
  // Length-too-long is reported as an inline error rather than a
  // submit-disable so the user sees WHY it's invalid.
  const submitDisabled = submitting || trimmed.length === 0;

  async function submit(): Promise<void> {
    setErrorKey(undefined);
    if (trimmed.length === 0) {
      setErrorKey('auth.screenName.errors.empty');
      return;
    }
    if (trimmed.length > MAX_TRIMMED_LENGTH) {
      setErrorKey('auth.screenName.errors.tooLong');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/auth/screen-name', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ screenName: trimmed }),
      });
      if (response.ok) {
        // Server has swapped the pending cookie for the platform
        // session cookie. Re-check `/auth/me`, then send the user
        // back to /login (which will render the welcome banner).
        await auth.refresh();
        // `navigate` may return `void | Promise<void>` in router v7;
        // we don't await here because the navigation tear-down is
        // synchronous from this component's perspective — the route
        // unmounts immediately. Mark the return explicitly.
        void navigate('/login', { replace: true });
        return;
      }
      // Non-OK. Read the envelope's `error.code` if present.
      let code = 'unknown';
      try {
        const body: unknown = await response.json();
        if (
          body !== null &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error?: unknown }).error === 'object' &&
          (body as { error: Record<string, unknown> }).error !== null &&
          typeof (body as { error: Record<string, unknown> }).error['code'] === 'string'
        ) {
          code = (body as { error: { code: string } }).error.code;
        }
      } catch {
        // Body wasn't JSON. Fall through to generic.
      }
      setErrorKey(errorCodeToI18nKey(code));
    } catch {
      setErrorKey('auth.screenName.errors.generic');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main data-testid="route-screen-name">
      <h1 data-testid="route-title">{t('auth.screenName.title')}</h1>
      <form
        data-testid="screen-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="screen-name-input" data-testid="screen-name-label">
          {t('auth.screenName.label')}
        </label>
        <input
          id="screen-name-input"
          data-testid="screen-name-input"
          type="text"
          value={value}
          maxLength={MAX_INPUT_LENGTH}
          onChange={(event) => {
            setValue(event.target.value);
            if (errorKey !== undefined) setErrorKey(undefined);
          }}
        />
        {errorKey !== undefined && (
          <p data-testid="screen-name-error" role="alert">
            {t(errorKey)}
          </p>
        )}
        <button type="submit" data-testid="screen-name-submit" disabled={submitDisabled}>
          {t('auth.screenName.submit')}
        </button>
      </form>
    </main>
  );
}
