// Shared filesystem path for the auth-state JSON written by
// `tests/e2e/global-auth.setup.ts` and consumed by every project that
// needs an authed `alice` page.
//
// Lives in a one-line module so the setup spec and the Playwright
// config import it from the same canonical location without
// depending on each other.

import { resolve } from 'node:path';

export const AUTH_STORAGE_STATE_PATH = resolve(
  process.cwd(),
  'tests/e2e/.auth/alice.storage-state.json',
);
