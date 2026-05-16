// Mount-contract regression pin.
//
// Refinement: tasks/refinements/shell-package/shell_mount_contract.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022, the contract's structural invariants ship as a committed
// test. The no-op-surface case pins two things at once:
//
//   1. Compile-time: declaring `const noopSurface: SurfaceModule = { mount:
//      () => () => {} }` typechecks. If a required field of `MountProps`
//      was removed, or `UnmountFn` was changed to `() => Promise<void>`,
//      or `SurfaceModule.mount` got a non-`MountFn` signature, this
//      annotation fails at `tsc` time.
//
//   2. Runtime: invoking `noopSurface.mount(props)` returns a callable
//      whose return is `undefined`. Catches the regression where a future
//      leaf narrows `UnmountFn` away from `() => void` and breaks the
//      "no-op surface fully satisfies the contract" invariant.
//
// The props bag is intentionally minimum-viable — a stub auth in `loading`,
// a no-op i18n, `routerBasePath: '/'`, no `ws`, no `locale`. The contract's
// value is letting consumers compile against minimal shapes; a test that
// demanded full stubs would miss exactly the regression we care about.

import { describe, expect, it } from 'vitest';

import type { AuthContextValue, I18n, MountProps, SurfaceModule } from './index.js';

describe('@a-conversa/shell mount-contract', () => {
  it('a no-op SurfaceModule satisfies the contract', () => {
    const noopSurface: SurfaceModule = {
      mount: () => () => {},
    };

    const auth: AuthContextValue = {
      status: 'loading',
      refresh: () => {},
      logout: () => {},
    };

    const i18n: I18n = {
      t: (key) => key,
      language: 'en-US',
      changeLanguage: async () => {},
    };

    const container = document.createElement('div');
    const props: MountProps = {
      container,
      auth,
      i18n,
      routerBasePath: '/',
    };

    const unmount = noopSurface.mount(props);
    expect(typeof unmount).toBe('function');
    expect(unmount()).toBeUndefined();
  });
});
