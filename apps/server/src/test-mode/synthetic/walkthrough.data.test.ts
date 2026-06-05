// Drift-guard — the vendored walkthrough data must equal its source.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_scenario_library.md
// ADRs:        docs/adr/0042-runtime-fixture-reuse-via-vendored-module.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// The committed `walkthrough.data.ts` is a build-time snapshot of the
// canonical fixture in `@a-conversa/test-fixtures` (ADR 0042). At
// test-time the package source is reachable, so this re-reads the
// canonical JSON and asserts deep-equality with the vendored copy —
// failing CI if the fixture ever changes without
// `pnpm -F @a-conversa/server gen:walkthrough-data` being re-run. The
// committed copy is a snapshot of one source of truth, not a fork.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { walkthroughFixtureData } from './walkthrough.data.js';

const here = dirname(fileURLToPath(import.meta.url));

// apps/server/src/test-mode/synthetic → repo root → the canonical fixture
// source. Mirrors the path the codegen script reads from.
const FIXTURE_DIR = join(
  here,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'test-fixtures',
  'src',
  'fixtures',
  'walkthrough',
);

function readCanonical(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

describe('walkthrough.data — vendored snapshot vs canonical fixture', () => {
  it('matches the canonical session / participants / events (re-run codegen on drift)', () => {
    expect(walkthroughFixtureData.session).toEqual(readCanonical('session.json'));
    expect(walkthroughFixtureData.participants).toEqual(readCanonical('participants.json'));
    expect(walkthroughFixtureData.events).toEqual(readCanonical('events.json'));
  });
});
