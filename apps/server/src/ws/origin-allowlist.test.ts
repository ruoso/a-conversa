// @vitest-environment node
//
// Vitest unit tests for the WebSocket `Origin`-header allowlist gate
// (`ws_origin_allowlist`).
//
// Refinement: tasks/refinements/backend-hardening/ws_origin_allowlist.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.auth_hardening.ws_origin_allowlist
// Source:      docs/security/m3-review/auth.md F-002
//
// **Coverage.** The Origin-allowlist surface, hermetically driven by
// `__buildTestWsApp`'s `originAllowlist` option (so we never need to
// flip `NODE_ENV` or set env vars to exercise the prod posture):
//
//   1. Prod-style allowlist `['https://app.example.com']` + an
//      attacker-style `Origin: https://attacker.com` → upgrade rejected
//      with HTTP 403. The gate fires BEFORE the cookie check so a
//      valid cookie does NOT save the off-origin upgrade.
//   2. Prod allowlist `['https://app.example.com']` + the listed
//      origin → the cookie check becomes the gate (auth-required when
//      no cookie; hello frame when authenticated).
//   3. Prod allowlist with multiple entries → each entry independently
//      allows the upgrade.
//   4. Prod allowlist + missing `Origin` header → upgrade rejected.
//   5. Dev sentinel `'*'` → any Origin or missing Origin accepted; the
//      cookie check is the only gate.
//
// All tests use `app.injectWS(...)` against an in-process Fastify
// instance built by `__buildTestWsApp` — no mocks of the WS library,
// no mocks of `resolveWsOriginAllowlist` (the env resolver has its own
// unit tests; this file exercises the gate that consumes its output).
//
// The gate's posture vs. missing Origin is asymmetric on purpose:
// dev accepts (curl / `injectWS` / non-browser clients commonly omit
// the header), prod rejects (a real browser ALWAYS sends Origin on a
// WS upgrade; absence is a probe).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import { WS_ORIGIN_ALLOWLIST_ANY, type WsOriginAllowlist } from '../ws-origin-allowlist.js';
import {
  __buildTestWsApp,
  __getOpenConnectionsForTests,
  ORIGIN_NOT_ALLOWED_CODE,
} from './connection.js';
import {
  FIXTURE_SCREEN_NAME,
  FIXTURE_USER_ID,
  TEST_SESSION_SECRET,
  makeMemoryPool,
} from './test-helpers.js';

type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
};

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

interface OpenedWs {
  ws: WsLike;
  next: () => Promise<string>;
}

async function openWsClient(
  app: FastifyInstance,
  options?: { headers?: Record<string, string> },
): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;
  const ws = await app.injectWS('/api/ws', options ?? {}, {
    onInit(client: unknown) {
      (client as WsLike).on('message', (data: unknown) => {
        const text = toUtf8(data);
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(text);
        } else {
          queue.push(text);
        }
      });
    },
  });
  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });
  return { ws, next };
}

/**
 * Build the WS test app with the canonical fixture user pre-seeded
 * and an explicit origin allowlist. The default `'*'` sentinel applies
 * when callers don't pass `originAllowlist` — this helper always
 * passes one so the gate's posture is explicit per test.
 */
async function buildOriginTestApp(allowlist: WsOriginAllowlist): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool: makeMemoryPool([
      { id: FIXTURE_USER_ID, screenName: FIXTURE_SCREEN_NAME, deletedAt: null },
    ]),
    sessionTokenSecret: TEST_SESSION_SECRET,
    originAllowlist: allowlist,
  });
}

describe('ws_origin_allowlist — prod-style allowlist (array)', () => {
  let app: FastifyInstance;
  const ALLOWED = 'https://app.example.com';

  beforeEach(async () => {
    app = await buildOriginTestApp([ALLOWED]);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an upgrade carrying an off-allowlist Origin with HTTP 403 (BEFORE the cookie check)', async () => {
    // A valid session cookie does NOT save the upgrade — the Origin
    // check fires first. This is the load-bearing F-002 invariant:
    // even a perfectly-authenticated client from an off-origin page
    // cannot complete the WS handshake.
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    await expect(
      openWsClient(app, {
        headers: {
          origin: 'https://attacker.example.com',
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });

  it('rejects an upgrade with no Origin header at all with HTTP 403', async () => {
    // The prod posture REQUIRES Origin — a real browser always sends
    // it on a WS upgrade; absence is a probe.
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    await expect(
      openWsClient(app, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });

  it('passes the cookie gate when Origin is on the allowlist (hello frame arrives)', async () => {
    // Listed Origin + valid cookie → the cookie gate becomes the only
    // gate. The hello frame proves the full pipeline ran.
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const { ws, next } = await openWsClient(app, {
      headers: {
        origin: ALLOWED,
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
    } finally {
      ws.terminate();
    }
  });

  it('falls through to the cookie gate (anonymous upgrade) when Origin is allowed but no cookie is present', async () => {
    // Listed Origin + no cookie → the Origin gate passes; per ADR
    // 0029 + `aud_anonymous_ws_subscribe`, the cookie gate no longer
    // emits 401 for a missing cookie — it falls through to anonymous
    // and the upgrade completes with `connection.user === undefined`.
    // Demonstrates the gates compose (Origin first, cookie second);
    // anonymous upgrade does NOT relax the Origin contract above.
    const { ws, next } = await openWsClient(app, { headers: { origin: ALLOWED } });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
      const open = __getOpenConnectionsForTests();
      expect(open).toHaveLength(1);
      expect(open[0]?.user).toBeUndefined();
    } finally {
      ws.terminate();
    }
  });
});

describe('ws_origin_allowlist — prod-style allowlist with multiple entries', () => {
  let app: FastifyInstance;
  const FIRST = 'https://app.example.com';
  const SECOND = 'https://staging.example.com';

  beforeEach(async () => {
    app = await buildOriginTestApp([FIRST, SECOND]);
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts each listed Origin independently', async () => {
    // Both entries pass the gate. Run them sequentially so the open-
    // connections inspector reads cleanly between cases.
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    for (const origin of [FIRST, SECOND]) {
      const { ws, next } = await openWsClient(app, {
        headers: { origin, cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      try {
        const raw = await next();
        const parsed = JSON.parse(raw) as { type?: unknown };
        expect(parsed.type).toBe('hello');
      } finally {
        ws.terminate();
      }
    }
  });

  it('still rejects an off-allowlist Origin (no leak across allowlist entries)', async () => {
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    await expect(
      openWsClient(app, {
        headers: {
          origin: 'https://attacker.example.com',
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/);
    expect(__getOpenConnectionsForTests()).toHaveLength(0);
  });
});

describe('ws_origin_allowlist — dev sentinel (`*`)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildOriginTestApp(WS_ORIGIN_ALLOWLIST_ANY);
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts any Origin header (cookie gate is the only gate)', async () => {
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const { ws, next } = await openWsClient(app, {
      headers: {
        origin: 'https://anything-goes.example',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
    } finally {
      ws.terminate();
    }
  });

  it('accepts a missing Origin header (curl / non-browser clients OK in dev)', async () => {
    const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
    const { ws, next } = await openWsClient(app, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
    } finally {
      ws.terminate();
    }
  });

  it('accepts an unauthenticated upgrade as anonymous (the cookie gate now falls through to anonymous per ADR 0029)', async () => {
    // Per ADR 0029 + `aud_anonymous_ws_subscribe`, the cookie gate
    // no longer 401s for a missing cookie — it falls through to
    // anonymous and the upgrade completes. The dev-sentinel Origin
    // gate accepts any Origin; the cookie gate's anonymous path
    // accepts the cookie-less upgrade. The connection lands with
    // `user === undefined`.
    const { ws, next } = await openWsClient(app, {
      headers: { origin: 'https://anything-goes.example' },
    });
    try {
      const raw = await next();
      const parsed = JSON.parse(raw) as { type?: unknown };
      expect(parsed.type).toBe('hello');
      const open = __getOpenConnectionsForTests();
      expect(open).toHaveLength(1);
      expect(open[0]?.user).toBeUndefined();
    } finally {
      ws.terminate();
    }
  });
});

describe('ws_origin_allowlist — exported constants', () => {
  // Lock-in tests for the wire-code constant. A future PR that renames
  // `ORIGIN_NOT_ALLOWED_CODE` (without updating monitoring rules /
  // documentation that pin the kebab string) trips here.
  it('exports the canonical `origin-not-allowed` wire code', () => {
    expect(ORIGIN_NOT_ALLOWED_CODE).toBe('origin-not-allowed');
  });
});
