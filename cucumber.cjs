module.exports = {
  default: {
    paths: ['tests/behavior/**/*.feature'],
    // Load both step definitions and support modules (World + hooks).
    // Cucumber doesn't have a separate "support" config key; the
    // convention is that everything imported here registers its own
    // hooks/step-defs as a side effect.
    import: ['tests/behavior/steps/**/*.ts', 'tests/behavior/support/**/*.ts'],
    // Force process.exit() once the test run completes. Required on
    // Node 24+: V8's WASM JIT teardown crashes (jit_page allocation
    // erase check) when pglite has been used, which happens in every
    // scenario via the per-scenario PGlite handle. The crash fires
    // after all steps pass, producing a spurious non-zero exit (133).
    // forceExit bypasses the teardown by exiting immediately.
    forceExit: true,
  },
};
