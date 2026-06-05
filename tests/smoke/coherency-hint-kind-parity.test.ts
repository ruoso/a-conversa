// Cross-boundary parity pin: the server's `HintKind` union (the source of
// truth, apps/server/src/diagnostics/coherency-hint-detection.ts) and the
// shell's hand-maintained `WireCoherencyHint` mirror (packages/shell) must
// enumerate exactly the same coherency-hint kinds.
//
// The predecessor task (`coherency_hint_wire_mirror_exhaustiveness`) made every
// shell-side switch exhaustive *against the shell's own union* via `never`
// defaults. Those guards are blind, by construction, to the shell union itself
// falling behind the server: each switch stays total against a stale union and
// nothing errors. Only an assertion that imports BOTH unions into one compile
// unit can catch the *server-union-grows / Wire-mirror-lags* drift — the
// first-order cause of the 2026-06-05 diagnostics-panel Playwright timeout,
// where a `non-self-referential-annotation-contradicts` hint arrived over the
// wire but the shell's stale mirror silently dropped it.
//
// Both imports are `import type` (fully erased at runtime): no runtime coupling
// between the `tests/` tree and either workspace, and no new dependency edge.
// The `tests/` cross-workspace tree is the repo's sanctioned home for reaching
// into both `apps/server/src/**` and `packages/**/src` via relative paths (see
// the tests/tsconfig.json header, the behavior steps, and wsStoreSeed.test.ts).
// `@a-conversa/server` is `private` with no package entrypoint and no workspace
// imports it; the deep-relative type-only import sidesteps that entirely.

import { describe, expect, it } from 'vitest';

import type { HintKind } from '../../apps/server/src/diagnostics/coherency-hint-detection.js';
import type { WireCoherencyHint } from '../../packages/shell/src/index.js';

type WireHintKind = WireCoherencyHint['kind'];

// ─── compile-time directional parity ───────────────────────────────────────
// Two directional assignability checks rather than one opaque `Equal<>` so a
// failure names which side drifted. The fear case (server grows, Wire lags)
// trips `serverSubsetOfWire`; a stale-Wire-keeps-a-removed-server-kind trips
// `wireSubsetOfServer`. Each helper resolves to the literal `true` only when
// the subset relation holds; drift flips it to `false`, and `const x: true`
// then fails `tsc --noEmit -p tests/tsconfig.json`.
type SubsetOf<Sub, Super> = [Sub] extends [Super] ? true : false;

const serverSubsetOfWire: SubsetOf<HintKind, WireHintKind> = true;
const wireSubsetOfServer: SubsetOf<WireHintKind, HintKind> = true;

// ─── runtime set-equality pin (self-materializing) ──────────────────────────
// Exhaustive `Record<…, true>` literals: the compiler forces each to list
// exactly its union's members (a missing OR an extra key is a compile error),
// so the lists cannot be satisfied by editing the test alone — adding a
// not-yet-mirrored kind to the Wire-keyed record fails to compile until that
// kind exists in `WireCoherencyHint`, forcing the real mirror update.
// `Object.keys()` then materializes the two sets at runtime without the server
// needing a runtime `HintKind` enumeration (it exports none — `HintKind` is a
// type only).
const serverHintKinds: Record<HintKind, true> = {
  'incomplete-warrant-missing-bridges-to': true,
  'incomplete-warrant-missing-bridges-from': true,
  'self-contradicts': true,
  'annotation-of-annotation-chain': true,
  'self-referential-annotation-contradicts': true,
  'non-self-referential-annotation-contradicts': true,
};

const wireHintKinds: Record<WireHintKind, true> = {
  'incomplete-warrant-missing-bridges-to': true,
  'incomplete-warrant-missing-bridges-from': true,
  'self-contradicts': true,
  'annotation-of-annotation-chain': true,
  'self-referential-annotation-contradicts': true,
  'non-self-referential-annotation-contradicts': true,
};

describe('coherency-hint kind parity (server `HintKind` ↔ shell `WireCoherencyHint`)', () => {
  it('asserts mutual compile-time exhaustiveness between the two unions', () => {
    // The directional consts are referenced here so the compile-time contract
    // is not an unused var; their `true` *type* is the real assertion — drift
    // in either direction makes one of them fail `tsc`.
    expect(serverSubsetOfWire && wireSubsetOfServer).toBe(true);
  });

  it('materializes equal runtime kind sets, including the 2026-06-05 timeout kind', () => {
    const serverSet = new Set(Object.keys(serverHintKinds));
    const wireSet = new Set(Object.keys(wireHintKinds));

    expect(serverSet).toEqual(wireSet);
    expect(serverSet.size).toBe(6);
    // The exact kind that hit a swallowing default and never rendered on
    // 2026-06-05 — pinned on both sides of the boundary.
    expect(serverSet.has('non-self-referential-annotation-contradicts')).toBe(true);
    expect(wireSet.has('non-self-referential-annotation-contradicts')).toBe(true);
  });

  it('guard bites — an incomplete `Record<HintKind, true>` fails to compile', () => {
    // @ts-expect-error — one known member is intentionally omitted, so the
    // literal is incomplete and `tsc` must reject it. If the parity machinery
    // ever stopped catching a missing member, this suppression would go unused
    // and `tsc` would fail the build — pinning the guard's *value*, not just
    // its presence (matches the predecessor pin at
    // packages/shell/src/diagnostics/diagnostic-highlights.test.ts:334-364).
    const incompleteHintKinds: Record<HintKind, true> = {
      'incomplete-warrant-missing-bridges-to': true,
      'incomplete-warrant-missing-bridges-from': true,
      'self-contradicts': true,
      'annotation-of-annotation-chain': true,
      'self-referential-annotation-contradicts': true,
      // 'non-self-referential-annotation-contradicts' intentionally omitted.
    };
    expect(incompleteHintKinds).toBeDefined();
  });
});
