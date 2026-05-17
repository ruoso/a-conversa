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
