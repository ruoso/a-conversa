module.exports = {
  default: {
    paths: ['tests/behavior/**/*.feature'],
    // Load both step definitions and support modules (World + hooks).
    // Cucumber doesn't have a separate "support" config key; the
    // convention is that everything imported here registers its own
    // hooks/step-defs as a side effect.
    import: ['tests/behavior/steps/**/*.ts', 'tests/behavior/support/**/*.ts'],
    // Force process.exit() once the test run completes. Backstop for
    // Node 24+: V8's WASM JIT teardown crashes (jit_page allocation
    // erase check) when pglite has been used, which happens in every
    // scenario via the per-scenario PGlite handle. forceExit bypasses
    // the FINAL teardown by exiting immediately.
    //
    // forceExit alone is insufficient: the same crash also fires on the
    // per-scenario `this.db.close()` (see tests/behavior/support/world.ts)
    // mid-run, which forceExit cannot guard. The root-cause fix lives in
    // scripts/run-cucumber.mjs (invoked by the `test:behavior:smoke`
    // script in package.json), which runs cucumber under
    // `node --no-memory-protection-keys` to disable V8's PKU code-memory
    // protection (the `ThreadIsolation::Unregister*` path that hits the
    // buggy assertion). That flag only exists on Node 22+, so the runner
    // probes for it and forwards it only when supported — Node 20 (the
    // CI/Docker runtime, ADR 0001/0015) lacks both the flag and the
    // crash. This forceExit is kept here as defense-in-depth.
    forceExit: true,
  },
};
