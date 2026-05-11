// Step definitions for tests/behavior/backend/http-server.feature.
//
// Refinement: tasks/refinements/backend/http_server.md
// ADR:        docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.api_skeleton.http_server
//
// The Cucumber `Before` hook in support/world.ts spins up a pglite
// handle for every scenario — that's a noticeable upfront cost but
// keeps the World shape uniform across the suite (DB-touching and
// DB-free scenarios coexist; the few extra ms here are not worth a
// World-variant split). These steps construct their own Fastify
// instance per scenario via `createServer()`, exercise it via
// `.inject(...)` (no port bind, no network), and tear it down in an
// `After` hook for scenarios that built one. Pure in-process — no
// race against the OS, no port conflicts in parallel runs.
//
// **Type-resolution note.** `fastify` itself lives only under
// `apps/server/node_modules` (it's a workspace-local dep, not a root
// dep), so the test tsconfig's resolver doesn't see the
// `FastifyInstance` type directly. The step file therefore types the
// instance via `Awaited<ReturnType<typeof createServer>>` — TypeScript
// resolves the type transitively through the imported `createServer`
// symbol without the step file needing a direct `fastify` import.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { createServer } from '../../../apps/server/src/server.js';
import type { AConversaWorld } from '../support/world.js';

type AppInstance = Awaited<ReturnType<typeof createServer>>;

// Subset of fastify's `LightMyRequest.Response` we actually assert
// against. Keeping the carrier minimal avoids dragging
// fastify-internal types (which live under apps/server/node_modules,
// not the test tsconfig's resolver) into this step file.
//
// `headers` is included so request_logging scenarios can assert
// against `x-request-id` (and so a future readiness probe could
// assert against, say, `cache-control`). Header values from
// `light-my-request` are typed `string | string[] | undefined`; we
// keep the same `unknown`-friendly carrier on the World so step defs
// can narrow per-assertion.
interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}

// Extend the AConversaWorld's scratch space with the HTTP-specific
// carriers. Step defs read/write these via `this.scratch` so the
// World type itself doesn't need to grow per-scenario fields. Each
// field is optional with `?` so `exactOptionalPropertyTypes` lets us
// `delete` the field on teardown rather than assigning `undefined`.
interface HttpScratch {
  httpServer?: AppInstance;
  lastResponse?: InjectedResponse;
}

function scratch(world: AConversaWorld): HttpScratch {
  // `world.scratch` is typed `Record<string, unknown>` on the World;
  // the cast narrows to the HTTP-specific shape. The
  // no-unnecessary-type-assertion rule is suppressed here because the
  // structural compatibility between `Record<string, unknown>` and
  // an interface of optional fields is exactly the gap we're crossing.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as HttpScratch;
}

Given('an HTTP server built from createServer', async function (this: AConversaWorld) {
  const app = await createServer({ logger: false });
  await app.ready();
  scratch(this).httpServer = app;
});

When('a GET request is sent to {string}', async function (this: AConversaWorld, url: string) {
  const app = scratch(this).httpServer;
  assert.ok(app, 'http server not initialized — Given step missing');
  const response = await app.inject({ method: 'GET', url });
  scratch(this).lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

Then('the response status is {int}', function (this: AConversaWorld, expected: number) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured — When step missing');
  assert.equal(res.statusCode, expected);
});

Then(
  'the response body is JSON with status {string}',
  function (this: AConversaWorld, expectedStatus: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    const parsed = JSON.parse(res.body) as { status?: unknown };
    assert.equal(parsed.status, expectedStatus);
  },
);

// Used by tests/behavior/backend/healthz.feature — the /healthz
// response carries a `version` field stamped from
// `npm_package_version` (or '0.0.0' fallback). The exact value is
// environment-dependent so we only assert it's a non-empty string.
Then('the response body has a non-empty version string', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured — When step missing');
  const parsed = JSON.parse(res.body) as { version?: unknown };
  assert.equal(typeof parsed.version, 'string');
  assert.ok(
    typeof parsed.version === 'string' && parsed.version.length > 0,
    `expected non-empty version string, got ${JSON.stringify(parsed.version)}`,
  );
});

// Used by tests/behavior/backend/request-logging.feature — the
// request_logging task wires Fastify's per-request id into the
// response as `x-request-id` via an `onRequest` hook. The exact
// value is environment-dependent (Fastify generates a fresh id per
// request when no inbound header is set), so we only assert the
// header is a non-empty string.
Then(
  'the response has a non-empty {string} header',
  function (this: AConversaWorld, headerName: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    // Header lookups in node http are case-insensitive; light-my-request
    // canonicalizes to lowercase, so we lowercase the requested name
    // before indexing. The carrier type is `Record<string, unknown>`
    // so we narrow per-call.
    const value = res.headers[headerName.toLowerCase()];
    assert.equal(
      typeof value,
      'string',
      `expected ${headerName} to be a string, got ${typeof value}`,
    );
    assert.ok(
      typeof value === 'string' && value.length > 0,
      `expected non-empty ${headerName} header, got ${JSON.stringify(value)}`,
    );
  },
);

// Tear down the per-scenario Fastify instance. The world-level `After`
// in support/world.ts handles the pglite handle; this hook only
// touches the Fastify carrier so it's idempotent across scenarios
// that didn't construct one.
After(async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = s.httpServer;
  if (app) {
    await app.close();
    // Use `delete` rather than assigning `undefined`; the field is
    // declared optional and exactOptionalPropertyTypes rejects the
    // explicit-undefined form.
    delete s.httpServer;
  }
});
