// Public API for @a-conversa/test-fixtures.
//
// Tests import `loadFixture` to reset the database to a known state and
// `listFixtures` to enumerate the bundled fixture names. The actual
// loader implementation lives in ./loader; this file just re-exports.
//
// See ./loader.ts and ../README.md for the deferred R23 note (replay
// through the application's event-append code is rewritten in once that
// code path exists).

export { loadFixture, listFixtures } from './loader.js';
export type { LoadFixtureClient } from './loader.js';
