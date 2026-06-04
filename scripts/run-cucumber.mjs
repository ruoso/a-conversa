#!/usr/bin/env node
// Behaviour-suite runner. Plain ESM (no tsx) so it boots on every Node
// major we target, then re-launches cucumber under the right flags.
//
// Why a wrapper instead of a one-liner in package.json:
//
//   The behaviour scenarios drive PGlite (WASM) on every scenario. On
//   Node 22+/24+, V8's memory-protection-keys hardening makes the WASM
//   JIT teardown / `ThreadIsolation::Unregister*` path hit a buggy
//   assertion and SIGSEGV (see the comment in cucumber.cjs).
//   `--no-memory-protection-keys` disables that PKU code-memory
//   protection and is the root-cause fix on those Node versions.
//
//   But that flag does NOT exist on Node 20 — the runtime pinned for CI
//   and the Docker image (ADR 0001 / ADR 0015). Passing it there aborts
//   node before anything runs:
//
//       node: bad option: --no-memory-protection-keys   (exit 9)
//
//   which is exactly the CI failure this script fixes. Node 20 also
//   lacks the MPK hardening, so it never hits the crash and simply
//   doesn't need the flag.
//
//   The flag isn't reported via `process.allowedNodeEnvironmentFlags`
//   (it isn't permitted in NODE_OPTIONS), so we probe for it directly
//   and only forward it when the running node accepts it. Same script,
//   green on both the Node 22+ dev machines and the Node 20 CI/Docker
//   runtime.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const MPK_FLAG = '--no-memory-protection-keys';

// Probe: a no-op `node <flag> -e ''` exits 0 when the flag is known and
// non-zero ("bad option") when it isn't. Cheap and version-agnostic.
function nodeSupportsFlag(flag) {
  const probe = spawnSync(process.execPath, [flag, '-e', ''], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

const cucumberBin = fileURLToPath(
  new URL('../node_modules/@cucumber/cucumber/bin/cucumber.js', import.meta.url),
);

const nodeArgs = [
  ...(nodeSupportsFlag(MPK_FLAG) ? [MPK_FLAG] : []),
  cucumberBin,
  // Forward any extra CLI args (tag filters, specific feature paths, …).
  ...process.argv.slice(2),
];

// tsx loads the TypeScript step definitions; `source` resolves workspace
// packages to TS without an upstream build (ADR 0010). Applied only to
// the cucumber child, not to this wrapper or the probe above.
const result = spawnSync(process.execPath, nodeArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import tsx --conditions=source']
      .filter(Boolean)
      .join(' '),
  },
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
