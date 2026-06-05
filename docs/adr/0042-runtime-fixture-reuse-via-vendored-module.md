# 0042 — Reusing test-fixture data at runtime via a build-time vendored module

## Status

Accepted

## Context

ADR 0041 established synthetic-session generation as a non-production-gated
backend seam: scenarios are server-side builder functions
`(sessionId, hostUserId, idFactory) -> Event[]` that mint a fresh, fully
persisted session through the production write path. ADR 0041 shipped two
small hand-authored builders (`empty`, `structured`) and explicitly deferred
the rich case:

> Reusing the rich `walkthrough` fixture at runtime would require a
> non-destructive, typed id-re-keyer; that is deferred to a follow-up
> scenario-library task rather than forcing the destructive loader online.

That follow-up (`test_mode_synthetic_scenario_library`) needs the canonical
`walkthrough` fixture's ~800-event log available **to the running server** so a
re-keyer can instantiate it into a fresh session. The fixture's canonical home
is `packages/test-fixtures/src/fixtures/walkthrough/` (five JSON files: meta,
users, session, participants, events), inside the `@a-conversa/test-fixtures`
package.

Two hard constraints decide how the server can reach that data:

- **`@a-conversa/test-fixtures` is a `devDependency` of the server**
  (`apps/server/package.json`). The production image runs
  `pnpm install --frozen-lockfile --prod` (`Dockerfile:140`), which prunes
  devDependencies — the package is **not installed** in the runtime layer.
- **The runtime stage copies only specific compiled `dist` trees**
  (`Dockerfile:144–176`): `apps/server/dist`, `apps/root/dist`,
  `packages/shared-types/dist`, the migration SQL, and the frontend bundles.
  `packages/test-fixtures` — neither its source nor any `dist` — is copied at
  all. Its fixture JSON files are physically absent from the runtime image.

Critically, this is **also the environment the e2e runs in**. `make up`
(used by `pnpm run test:e2e` and CI) builds the server from this same
Dockerfile, then the dev compose override flips `NODE_ENV=development`
(`compose.dev.yaml`) so the gated test-mode routes register. So the server
that the Playwright synthetic-session e2e drives is **non-production but
devDependency-pruned**: a runtime `import('@a-conversa/test-fixtures')` —
static or dynamic — fails with `MODULE_NOT_FOUND` exactly where the feature is
exercised.

`apps/server` is compiled with `tsc -b` (no bundler), so JSON imports are not
inlined into the emitted JS, and `tsc` does not copy non-`.ts` assets into
`dist`. The only artifact reliably present at runtime under a copied path is
**compiled TypeScript emitted into `apps/server/dist`**.

## Decision

Fixture data consumed by a runtime (dev-gated) code path is **vendored into the
server as a build-time-generated, committed TypeScript module** — not imported
from the `@a-conversa/test-fixtures` devDependency at runtime.

1. A codegen script reads the canonical fixture JSON from
   `packages/test-fixtures/src/fixtures/<name>/` and emits a typed module under
   `apps/server/src/test-mode/synthetic/` exporting the parsed fixture data as
   `const` blobs. The module is **committed** so `tsx` (dev), `vitest`, and
   `tsc -b` (build) all see it identically, and it compiles into
   `apps/server/dist` and ships via the existing Dockerfile `COPY`.
2. A **drift-guard Vitest test** re-reads the canonical fixture (test-time can
   import the devDependency) and asserts deep-equality with the committed
   vendored data, failing CI if the fixture changes without the codegen being
   re-run. The committed copy is a build-input snapshot of a single source of
   truth, not a fork.
3. `@a-conversa/test-fixtures` **stays a devDependency.** The codegen script and
   the drift-guard test run at build/test time and may import it; the server
   runtime never does. `loadFixture`'s destructive `TRUNCATE` stays a test-only
   primitive, consistent with ADR 0041.
4. The re-keyer that consumes the vendored data is a **pure, exhaustively-typed
   transform** over the wire `Event` discriminated union — see
   `tasks/refinements/replay_test/test_mode_synthetic_scenario_library.md`.

## Consequences

- The rich `walkthrough` fixture (and future fixtures) become reusable as
  synthetic scenarios with **no new runtime dependency**, **no Dockerfile
  change**, and **no runtime filesystem read** — the vendored module is just
  compiled TS in `dist`.
- The walkthrough scenario builder stays **synchronous**
  (`(sessionId, hostUserId, idFactory) -> Event[]`), so it plugs into the
  existing ADR-0041 scenario registry with no change to the builder signature
  or the route.
- The fixture data ships in the production image (where test-mode never
  registers) as inert dead weight — a few hundred KB, acceptable.
- A committed generated artifact and its codegen script are new maintenance
  surface; the drift-guard test contains the risk by making divergence a red
  build rather than a silent staleness.
- Rejected — **promote `@a-conversa/test-fixtures` to a runtime
  `dependency`:** it would still require the Dockerfile to copy the package's
  files into the runtime stage (only enumerated `dist` trees are copied today),
  pulls the destructive `loadFixture` into the production runtime graph, and
  ships fixture data via a package whose purpose is test support — more coupling
  than vendoring a data snapshot.
- Rejected — **dynamic `import('@a-conversa/test-fixtures')` behind the
  `NODE_ENV` gate:** the package is absent from the pruned image, so the import
  throws `MODULE_NOT_FOUND` in the very compose/e2e environment the feature is
  tested in. Graceful degradation would make the scenario unavailable exactly
  where it must work.
- Rejected — **copy raw fixture JSON into `apps/server/dist` and read it via
  `fs`/`import.meta.url` at runtime:** `tsc` does not copy non-`.ts` assets, so
  this needs a bespoke copy step plus a Dockerfile edit, and it introduces a
  dev-source-tree vs `dist` path duality. A compiled TS module sidesteps both.

## References

- ADR 0041 (synthetic-session generation — the dev-gated seam this fulfills),
  ADR 0015 (Dockerfile multi-stage `--prod` install), ADR 0021 (event
  envelope), ADR 0006 (Vitest), ADR 0010 (pnpm workspaces).
- Refinement:
  `tasks/refinements/replay_test/test_mode_synthetic_scenario_library.md`.
- Predecessor refinement:
  `tasks/refinements/replay_test/test_mode_synthetic_session.md`.
