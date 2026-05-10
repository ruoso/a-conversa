module.exports = {
  default: {
    paths: ['tests/behavior/**/*.feature'],
    // Load both step definitions and support modules (World + hooks).
    // Cucumber doesn't have a separate "support" config key; the
    // convention is that everything imported here registers its own
    // hooks/step-defs as a side effect.
    import: ['tests/behavior/steps/**/*.ts', 'tests/behavior/support/**/*.ts'],
  },
};
