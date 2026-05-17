// Global Vitest setup.
//
// React 18's `act()` machinery requires `globalThis.IS_REACT_ACT_ENVIRONMENT`
// to be `true` so that synchronous `ReactDOM.createRoot(...).render(...)`
// calls made outside of `@testing-library/react`'s wrappers (e.g. the
// surface `mount()` contract tests in apps/*/src/mount.test.tsx) do not
// emit "The current testing environment is not configured to support
// act(...)" warnings. The flag is a standard test-env marker and has no
// production effect.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Warnings-as-errors: any unmocked `console.error` / `console.warn` call
// during a test fails that test. The smoke suite is stderr-clean as of
// the cleanup that introduced this file, and any future regression
// (React `act` violations, unhandled promise warnings, library
// deprecations, accidental `console.error` in production code paths
// exercised by tests) must surface as a hard failure — not as scrollback
// noise that trains readers to ignore stderr.
//
// Tests that intentionally exercise an error path can opt out per-call
// the standard way:
//   `vi.spyOn(console, 'error').mockImplementation(() => undefined);`
// `vi.spyOn` replaces the property on `console` for the test's
// lifetime, bypassing the tracker; `vi.restoreAllMocks()` / explicit
// `mockRestore()` puts the tracker back in place for the next test.
// The tracker also routes the original output through so failing test
// output still shows the offending text.
import { afterEach } from 'vitest';

interface ConsoleCall {
  readonly method: 'error' | 'warn';
  readonly args: readonly unknown[];
}

let unexpectedConsoleCalls: ConsoleCall[] = [];

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

console.error = (...args: unknown[]): void => {
  unexpectedConsoleCalls.push({ method: 'error', args });
  originalConsoleError(...args);
};

console.warn = (...args: unknown[]): void => {
  unexpectedConsoleCalls.push({ method: 'warn', args });
  originalConsoleWarn(...args);
};

function formatArg(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

afterEach(() => {
  const calls = unexpectedConsoleCalls;
  unexpectedConsoleCalls = [];
  if (calls.length === 0) {
    return;
  }
  const summary = calls
    .map((call) => `  ${call.method}: ${call.args.map(formatArg).join(' ')}`)
    .join('\n');
  throw new Error(
    `Unexpected console output during test (${String(calls.length)} call${calls.length === 1 ? '' : 's'}):\n${summary}\n` +
      `If this output is intentional, silence it with ` +
      `\`vi.spyOn(console, '<error|warn>').mockImplementation(() => undefined)\` ` +
      `and assert on the spy.`,
  );
});
