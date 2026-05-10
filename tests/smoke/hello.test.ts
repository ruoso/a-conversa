// Stack-validation smoke test for ADR 0006 (Unit-test framework: Vitest +
// happy-dom + v8 coverage). Two tests: a trivial arithmetic assertion
// proves the runner executes, and a React Testing Library mount under
// happy-dom proves the React + DOM-shim path works. Throwaway — will be
// removed when the real per-workspace test setups land as part of
// `unit_test_runner_setup` and the per-app `*_unit_tests` tasks.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

describe('vitest smoke', () => {
  it('runs a trivial assertion', () => {
    expect(2 + 2).toBe(4);
  });

  it('mounts a React component under happy-dom', () => {
    function Hello(): React.ReactElement {
      return React.createElement('p', null, 'hello, vitest');
    }

    render(React.createElement(Hello));
    expect(screen.getByText('hello, vitest')).toBeTruthy();
  });
});
