// Public API for @a-conversa/test-fixtures.
//
// Tests import `loadFixture` to reset the database to a known state and
// `listFixtures` to enumerate the bundled fixture names. The actual
// loader implementation lives in ./loader; this file just re-exports.
//
// `LoadFixtureOptions` is the opt-in seam that routes a fixture's
// event log through the production append helper instead of raw
// INSERTs — see ./loader.ts for the file header that documents the
// two modes.

export { loadFixture, listFixtures } from './loader.js';
export type { LoadFixtureClient, LoadFixtureOptions } from './loader.js';
