// Skeleton-existence regression test for `@a-conversa/shell`.
//
// Refinement: tasks/refinements/shell-package/shell_pkg_skeleton.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Per ADR 0022, the package's empty skeleton still ships at least one
// committed test that pins observable behavior. The behavior here is the
// public barrel export: if the constant name, its value, or the re-export
// shape changes, this case fails.

import { describe, expect, it } from 'vitest';

import { SHELL_PACKAGE_VERSION } from './index.js';

describe('@a-conversa/shell barrel', () => {
  it('exports SHELL_PACKAGE_VERSION pinned to the skeleton version', () => {
    expect(SHELL_PACKAGE_VERSION).toBe('0.1.0');
  });
});
