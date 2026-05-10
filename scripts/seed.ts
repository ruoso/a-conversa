// Deferred-implementation stub for `make seed` /
// `foundation.dev_env.seed_data_script`.
//
// The refinement (tasks/refinements/foundation/seed_data_script.md) asks
// this script to load the example walkthrough fixture into the running
// dev database via the application's event-append API. Two prerequisites
// are not built yet:
//
//   1. `packages/test-fixtures/` — owned by
//      `data_and_methodology.schema.seed_data_for_tests`
//      (tasks/refinements/data-and-methodology/seed_data_for_tests.md).
//      That task creates the fixtures workspace and the `loadFixture`
//      helper this script will wrap.
//   2. The application's event-append API — first lands with
//      `backend.api_skeleton` (tasks/20-backend.tji) and is exercised by
//      the auth + session-management tasks downstream of it.
//
// Until both exist, this script parses its arguments, reports what it
// would seed, names the deferred prerequisites, and exits 1 — never
// silently succeeding. The wiring (package.json `seed` script and the
// `seed:` Makefile target) is in place so contributors discover the
// eventual entry point.
//
// When the prerequisites land, replace the stub body below with the
// real `loadFixture` invocation through the event-append API and drop
// this header.

const DEFAULT_FIXTURE = 'walkthrough';

function parseFixture(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixture' && i + 1 < argv.length) {
      return argv[i + 1]!;
    }
    if (arg !== undefined && arg.startsWith('--fixture=')) {
      return arg.slice('--fixture='.length);
    }
  }
  if (env.FIXTURE !== undefined && env.FIXTURE !== '') {
    return env.FIXTURE;
  }
  return DEFAULT_FIXTURE;
}

const fixture = parseFixture(process.argv.slice(2), process.env);

console.error('============================================================');
console.error(' make seed: NOT YET IMPLEMENTED');
console.error('============================================================');
console.error(`  requested fixture: ${fixture}`);
console.error('');
console.error('  This is a deferred-implementation stub. The real seed run');
console.error('  needs two prerequisites that do not exist yet:');
console.error('');
console.error('    1. packages/test-fixtures/ — owned by');
console.error('       data_and_methodology.schema.seed_data_for_tests');
console.error('       (tasks/refinements/data-and-methodology/seed_data_for_tests.md)');
console.error('');
console.error('    2. the application event-append API — lands with');
console.error('       backend.api_skeleton (tasks/20-backend.tji)');
console.error('');
console.error('  Until both land, `make seed` exits 1 on purpose. See');
console.error('  tasks/refinements/foundation/seed_data_script.md for the');
console.error('  full plan.');
console.error('============================================================');

process.exit(1);
