// Screen-name form route for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_screen_name_setup.md
//   (predecessor: tasks/refinements/moderator-ui/mod_auth_flow.md)
// Backend contract: POST /auth/screen-name (apps/server/src/auth/routes.ts).
// Backend validator (mirrored client-side): apps/server/src/auth/screen-name.ts
// TaskJuggler: moderator_ui.mod_shell.mod_screen_name_setup
//
// First-login surface. The OIDC callback set the `aconversa-auth-pending`
// cookie; this route POSTs `{ screenName }` to `/auth/screen-name`, the
// backend trims + NFKC-normalizes + validates, writes the row, swaps
// cookies (pending → session), and returns `{ userId, screenName }`. On
// success the form calls `auth.refresh()` and navigates back to `/login`,
// which then renders the welcome banner.
//
// `mod_screen_name_setup` layers UX polish on top of `mod_auth_flow`'s
// working bones: client-side mirror of the backend's NFKC + control-char
// + bidi-override + printable-class checks (so the user gets immediate
// inline feedback before a round-trip), accessibility wiring
// (aria-invalid / aria-describedby / aria-live + a character-count
// helper), and focus management (autoFocus on mount + re-focus after a
// server-side error so screen-reader users hear the announcement).

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { MAX_SCREEN_NAME_LENGTH } from '@a-conversa/shared-types';

import { useAuth } from '../auth/useAuth';

/**
 * Map a backend `ErrorEnvelope.code` value onto a localization key
 * under the `auth.screenName.errors` namespace. Unknown codes fall back
 * to the generic message. Mirrors the backend's
 * `apps/server/src/auth/routes.ts` envelopes.
 *
 * With the client-side mirror in place (see `validateClientSide`
 * below), the server-side `screen-name-invalid` envelope should only
 * surface for corner cases the client missed (e.g. a post-NFKC re-trim
 * that yielded empty after the client's pre-NFKC trim accepted it).
 * The `invalidCharacter` localized message is the safest fallback in
 * that corner — empty / whitespace / too-long paths are caught client-
 * side first.
 */
function errorCodeToI18nKey(code: string): string {
  switch (code) {
    case 'screen-name-invalid':
      return 'auth.screenName.errors.invalidCharacter';
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

// ─────────────────────────────────────────────────────────────────────
// Client-side mirror of `apps/server/src/auth/screen-name.ts`.
//
// The backend is authoritative — these checks exist to give the user
// immediate inline feedback BEFORE a round-trip. Any input that passes
// these client checks then goes to the server, which re-runs the same
// pipeline and is the final word. Any input that fails these client
// checks is rejected with a localized inline error and never POSTed.
//
// Duplication-not-import rationale: the backend module is under
// `apps/server` and cannot be imported across the app boundary without
// extracting a shared package. The mirror is ~25 lines; extracting a
// package for that is more weight than it buys. If this set of rules
// changes, both modules need to update — that's a known maintenance
// cost documented here.
// ─────────────────────────────────────────────────────────────────────

/**
 * Bidi-override + zero-width + invisible-format codepoints rejected by
 * the backend's `FORBIDDEN_FORMAT_CODEPOINTS`. Mirrored here verbatim.
 */
const FORBIDDEN_FORMAT_CODEPOINTS: ReadonlySet<number> = new Set<number>([
  // Bidi-override (UAX #9 explicit formatting):
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  // Zero-width + invisible-format:
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff,
]);

/**
 * C0 (U+0000..U+001F), DEL (U+007F), and C1 (U+0080..U+009F) control
 * chars. Built from `\u`-escapes for source-readability + ESLint
 * `no-control-regex` compliance, matching the backend module.
 */

const CONTROL_CHAR_RE = /[ --]/u;

/**
 * Printable Unicode-property class: Letter / Number / Punctuation /
 * Symbol / Space-separator. The `u` flag enables `\p{...}`.
 */
const PRINTABLE_CHARS_RE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u;

/**
 * Discriminated result of `validateClientSide`. Mirrors the backend's
 * `ScreenNameValidationResult`. On success the canonical (post-NFKC,
 * trimmed) value is returned so the POST body carries exactly what the
 * backend would have normalized to anyway, avoiding the asymmetric
 * "client sent X, backend persists NFKC(X)" surprise.
 */
type ClientValidationResult =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'whitespace-only' | 'too-long' | 'invalid-character';
    };

/**
 * Mirror of `validateScreenName` from `apps/server/src/auth/screen-name.ts`.
 * Pipeline matches the backend exactly: trim → NFKC + re-trim →
 * length-after-NFKC → control-char reject → format-codepoint reject →
 * printable-class reject.
 */
function validateClientSide(input: string): ClientValidationResult {
  if (input.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'whitespace-only' };
  }
  const normalized = trimmed.normalize('NFKC').trim();
  if (normalized.length === 0) {
    return { ok: false, reason: 'whitespace-only' };
  }
  if (normalized.length > MAX_SCREEN_NAME_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  if (CONTROL_CHAR_RE.test(normalized)) {
    return { ok: false, reason: 'invalid-character' };
  }
  for (const ch of normalized) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && FORBIDDEN_FORMAT_CODEPOINTS.has(cp)) {
      return { ok: false, reason: 'invalid-character' };
    }
  }
  if (!PRINTABLE_CHARS_RE.test(normalized)) {
    return { ok: false, reason: 'invalid-character' };
  }
  return { ok: true, value: normalized };
}

/**
 * Map a client-side `ClientValidationResult.reason` onto a localization
 * key. Symmetric with `errorCodeToI18nKey` but keyed off our own
 * discriminator rather than the server envelope's `code`.
 */
function clientReasonToI18nKey(
  reason: Exclude<ClientValidationResult, { ok: true }>['reason'],
): string {
  switch (reason) {
    case 'empty':
      return 'auth.screenName.errors.empty';
    case 'whitespace-only':
      return 'auth.screenName.errors.whitespaceOnly';
    case 'too-long':
      return 'auth.screenName.errors.tooLong';
    case 'invalid-character':
      return 'auth.screenName.errors.invalidCharacter';
  }
}

export function ScreenNameRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();

  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);

  // Focus management. The route exists for the sole purpose of capturing
  // a screen name; the input should be focused on mount so a keyboard or
  // screen-reader user lands ready to type. The React `autoFocus`
  // attribute has known issues with StrictMode double-mount + with
  // route-transition re-mounts; a `useRef` + one-shot `useEffect` is
  // the canonical replacement and behaves correctly in both cases.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  // Disable submit on empty-after-trim OR when a request is in flight.
  // Other rejects (too-long, invalid-character) surface as inline errors
  // when the user submits — the user should see WHY their input isn't
  // accepted rather than the button silently being disabled.
  const submitDisabled = submitting || trimmed.length === 0;

  async function submit(): Promise<void> {
    setErrorKey(undefined);
    const result = validateClientSide(value);
    if (!result.ok) {
      // Client-side mirror caught the input. Surface an inline error
      // and do NOT POST — the user is already focused on the input
      // (they just submitted from it), so no re-focus is needed.
      setErrorKey(clientReasonToI18nKey(result.reason));
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
        // Send the post-NFKC canonical form. The backend would NFKC the
        // input itself; sending the normalized form upfront keeps the
        // wire payload aligned with what gets persisted, and makes the
        // "I typed X, the server stored Y" surprise impossible.
        body: JSON.stringify({ screenName: result.value }),
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
      // Return focus to the input so a screen-reader user hears the
      // aria-live announcement and is positioned to retry. The user
      // pressed the submit button to get here, so focus may have
      // shifted away from the input.
      inputRef.current?.focus();
    } catch {
      setErrorKey('auth.screenName.errors.generic');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  const hasError = errorKey !== undefined;
  // `aria-describedby` points to both the helper (always present) and
  // the error region (conditional). Pointing to a non-existent id is a
  // no-op per ARIA — keeping the markup stable avoids ID churn on
  // error toggles.
  const describedBy = 'screen-name-helper screen-name-error';

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
          ref={inputRef}
          id="screen-name-input"
          data-testid="screen-name-input"
          type="text"
          value={value}
          maxLength={MAX_INPUT_LENGTH}
          autoComplete="off"
          inputMode="text"
          aria-invalid={hasError}
          aria-describedby={describedBy}
          onChange={(event) => {
            setValue(event.target.value);
            if (errorKey !== undefined) setErrorKey(undefined);
          }}
        />
        <p id="screen-name-helper" data-testid="screen-name-helper">
          {t('auth.screenName.helper', {
            used: trimmed.length,
            max: MAX_SCREEN_NAME_LENGTH,
          })}
        </p>
        {hasError && (
          <p
            id="screen-name-error"
            data-testid="screen-name-error"
            role="alert"
            aria-live="polite"
            aria-atomic="true"
          >
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
