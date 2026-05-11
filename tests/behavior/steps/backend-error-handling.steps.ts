// Step definitions for tests/behavior/backend/error-handling.feature.
//
// Refinement: tasks/refinements/backend/error_handling.md
// TaskJuggler: backend.api_skeleton.error_handling
//
// The shared http-server step defs already provide the generic
// `When a GET request is sent to "..."` and `Then the response status
// is <int>` steps; we reuse them via the same `world.scratch.httpServer`
// / `world.scratch.lastResponse` carriers (the field names are
// established in http-server.steps.ts).
//
// This file adds two scenario-specific steps:
//
//   1. `Given an HTTP server with an error-handling test route
//      registered` — constructs `createServer({ logger: false })`,
//      registers a test route that throws `ApiError.badRequest(...)`,
//      and stashes the instance on `world.scratch.httpServer` so the
//      shared `When` step can inject against it.
//   2. `Then the response body envelope has error code "..." and
//      message "..."` — parses `lastResponse.body` as JSON, asserts
//      the canonical `{ error: { code, message, ... } }` envelope.
//
// The `After` hook in http-server.steps.ts tears down `httpServer`;
// we deliberately reuse the same carrier so the existing teardown
// works without modification.

import { Given, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { ApiError } from '../../../apps/server/src/errors.js';
import { createServer } from '../../../apps/server/src/server.js';
import type { AConversaWorld } from '../support/world.js';

type AppInstance = Awaited<ReturnType<typeof createServer>>;

interface InjectedResponse {
  statusCode: number;
  body: string;
}

// Same carrier names as in http-server.steps.ts so the shared
// `When`/`Then status` steps and the existing `After` teardown hook
// pick the instance up without modification.
interface HttpScratch {
  httpServer?: AppInstance;
  lastResponse?: InjectedResponse;
}

function scratch(world: AConversaWorld): HttpScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as HttpScratch;
}

Given(
  'an HTTP server with an error-handling test route registered',
  async function (this: AConversaWorld) {
    const app = await createServer({ logger: false });
    // Throws an ApiError so the centralized handler can serialize it
    // into the canonical envelope. The route exists only for this
    // scenario; the per-scenario teardown in http-server.steps.ts
    // closes the instance afterwards.
    app.get('/test/throw/bad-request', () => {
      throw ApiError.badRequest('missing the foo field');
    });
    await app.ready();
    scratch(this).httpServer = app;
  },
);

Then(
  'the response body envelope has error code {string} and message {string}',
  function (this: AConversaWorld, expectedCode: string, expectedMessage: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    // The canonical envelope is `{ error: { code, message, ... } }`;
    // we read both fields off the parsed body and compare verbatim.
    const parsed = JSON.parse(res.body) as { error?: { code?: unknown; message?: unknown } };
    assert.ok(parsed.error, 'response body has no top-level `error` field');
    assert.equal(parsed.error.code, expectedCode);
    assert.equal(parsed.error.message, expectedMessage);
  },
);
