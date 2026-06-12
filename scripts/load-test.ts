// Basic load test — concurrent subscribers + event-rate ceiling
// against the local compose stack.
//
// Refinement: tasks/refinements/deployment/load_test.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
//              docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.deployment_tests.load_test
//
// Run via `make load-test` against a dev-mode stack (`make up` —
// the synthetic seam is production-gated off, see ADR 0041). Three
// phases, each with a floor assertion (exit non-zero on violation)
// and a full metrics report on stdout:
//
//   A. Ingest throughput — LOAD_SESSIONS concurrent walkthrough
//      synthetic-session creations; each replays the full example
//      debate through the production validate->append->broadcast
//      write path in one transaction. Metric: events appended / s.
//   B. Concurrent audience — one `structured` synthetic session
//      flipped public; LOAD_SUBSCRIBERS authenticated WS connections,
//      each subscribe + catch-up(0) (anonymous catch-up is deferred
//      in v0 — the handler answers `forbidden`), plus one anonymous
//      subscriber kept in the fan-out accounting (ADR 0029 path).
//      Metrics: success rate, time-to-caught-up p50/p95.
//   C. Live fan-out ceiling — with the phase-B subscribers attached,
//      the authenticated host connection drives LOAD_PROPOSES
//      wording-only capture-node proposes in the protocol's
//      sequence-gated (deliberately serialized) loop. Metrics:
//      round-trip proposes / s, broadcast delivery completeness.
//
// Auth: the harness seeds a driver user row (psql via docker compose
// exec — the harness targets the local stack by design) and mints
// the session cookie with the server's own signSessionToken, so
// Authelia stays out of the measured path. This only works because
// the dev stack's SESSION_TOKEN_SECRET is known from .env — exactly
// the property production denies.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import { signSessionToken, SESSION_COOKIE_NAME } from '../apps/server/src/auth/session-token.js';

// --- Knobs ---------------------------------------------------------

const BASE_URL = process.env['LOAD_BASE_URL'] ?? 'http://localhost:3000';
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/api/ws`;
const SESSIONS = intEnv('LOAD_SESSIONS', 5);
const SUBSCRIBERS = intEnv('LOAD_SUBSCRIBERS', 50);
const PROPOSES = intEnv('LOAD_PROPOSES', 100);

// Floors — deliberately ~10x under expected capacity: a violation
// means a regression in kind, not modest hardware.
const MIN_INGEST_EPS = intEnv('LOAD_MIN_INGEST_EPS', 50);
const MAX_CAUGHT_UP_P95_MS = intEnv('LOAD_MAX_CAUGHT_UP_P95_MS', 5_000);
const MIN_PROPOSE_RPS = intEnv('LOAD_MIN_PROPOSE_RPS', 5);

const DRIVER_OAUTH_SUBJECT = 'loadtest:driver';
const DRIVER_USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaa1111';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// --- Small helpers --------------------------------------------------

function fail(msg: string): never {
  console.error(`\n[load-test] FAIL: ${msg}`);
  process.exit(1);
}

function readEnvFile(): Record<string, string> {
  const file = existsSync('.env') ? '.env' : '.env.example';
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

function psql(sql: string): string {
  const env = readEnvFile();
  return execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      env['POSTGRES_USER'] ?? 'aconversa',
      '-d',
      env['POSTGRES_DB'] ?? 'aconversa',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

interface WsEnvelope {
  type: string;
  id: string;
  inResponseTo?: string;
  payload?: Record<string, unknown>;
}

/** Thin promise-oriented wrapper over a ws connection. */
class WsClient {
  private readonly socket: WebSocket;
  private readonly waiters: Array<{
    match: (env: WsEnvelope) => boolean;
    resolve: (env: WsEnvelope) => void;
  }> = [];
  /** Every event-applied sequence seen on this connection. */
  readonly appliedSequences: number[] = [];

  constructor(cookie?: string) {
    this.socket = new WebSocket(WS_URL, {
      headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    this.socket.on('message', (data: Buffer) => {
      const env = JSON.parse(data.toString()) as WsEnvelope;
      if (env.type === 'event-applied') {
        const event = env.payload?.['event'] as { sequence?: number } | undefined;
        if (typeof event?.sequence === 'number') this.appliedSequences.push(event.sequence);
      }
      for (let i = 0; i < this.waiters.length; i += 1) {
        const waiter = this.waiters[i];
        if (waiter !== undefined && waiter.match(env)) {
          this.waiters.splice(i, 1);
          waiter.resolve(env);
          return;
        }
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  next(match: (env: WsEnvelope) => boolean, timeoutMs = 15_000): Promise<WsEnvelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timed out waiting for envelope'));
      }, timeoutMs);
      this.waiters.push({
        match,
        resolve: (env) => {
          clearTimeout(timer);
          resolve(env);
        },
      });
    });
  }

  async request(type: string, payload: Record<string, unknown>): Promise<WsEnvelope> {
    const id = randomUUID();
    const reply = this.next((env) => env.inResponseTo === id);
    this.socket.send(JSON.stringify({ type, id, payload }));
    return reply;
  }

  close(): void {
    this.socket.close();
  }
}

async function api(
  path: string,
  cookie: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

// --- The phases ------------------------------------------------------

async function main(): Promise<void> {
  // Preflight + driver identity.
  const health = await fetch(`${BASE_URL}/healthz`).catch(() => undefined);
  if (health?.status !== 200) fail(`stack not reachable at ${BASE_URL} (make up first)`);

  const secret = process.env['SESSION_TOKEN_SECRET'] ?? readEnvFile()['SESSION_TOKEN_SECRET'];
  if (secret === undefined || secret === '') fail('SESSION_TOKEN_SECRET not resolvable');

  psql(
    `INSERT INTO users (id, oauth_subject, screen_name)
     VALUES ('${DRIVER_USER_ID}', '${DRIVER_OAUTH_SUBJECT}', 'Load Driver')
     ON CONFLICT (oauth_subject) DO NOTHING;`,
  );
  const driverId = psql(`SELECT id FROM users WHERE oauth_subject = '${DRIVER_OAUTH_SUBJECT}';`);
  const cookie = await signSessionToken({ sub: driverId }, secret);

  // ---- Phase A: ingest throughput -----------------------------------
  console.log(`[load-test] phase A: ${String(SESSIONS)} concurrent walkthrough creations`);
  const aStart = Date.now();
  const created = await Promise.all(
    Array.from({ length: SESSIONS }, async () => {
      const res = await api('/api/test-mode/synthetic-sessions', cookie, {
        method: 'POST',
        body: { scenario: 'walkthrough' },
      });
      if (res.status !== 201) fail(`synthetic-session create returned ${String(res.status)}`);
      return res.body['sessionId'] as string;
    }),
  );
  const aWallMs = Date.now() - aStart;
  const idList = created.map((id) => `'${id}'`).join(',');
  const aEvents = Number(
    psql(`SELECT count(*) FROM session_events WHERE session_id IN (${idList});`),
  );
  const ingestEps = aEvents / (aWallMs / 1000);

  // ---- Phase B: concurrent anonymous audience ------------------------
  console.log(`[load-test] phase B: ${String(SUBSCRIBERS)} anonymous subscribers`);
  const pubRes = await api('/api/test-mode/synthetic-sessions', cookie, {
    method: 'POST',
    body: { scenario: 'structured' },
  });
  if (pubRes.status !== 201) fail(`structured create returned ${String(pubRes.status)}`);
  const publicSessionId = pubRes.body['sessionId'] as string;
  const flip = await api(`/api/sessions/${publicSessionId}/privacy`, cookie, {
    method: 'PATCH',
    body: { privacy: 'public' },
  });
  if (flip.status !== 200) fail(`privacy flip returned ${String(flip.status)}`);
  const publicLogLength = Number(
    psql(`SELECT count(*) FROM session_events WHERE session_id = '${publicSessionId}';`),
  );

  // The timed audience connections authenticate: anonymous catch-up /
  // snapshot are deferred in v0 (the handlers answer `forbidden`; see
  // aud_anonymous_ws_subscribe + the catch-up handler's anonymous
  // branch), and the subscribe + broadcast fan-out path is identical
  // for anonymous vs authenticated connections. One extra ANONYMOUS
  // subscriber (no catch-up) is kept in the fan-out accounting so the
  // ADR 0029 path stays exercised end to end.
  const subscribers: WsClient[] = [];
  const caughtUpMs: number[] = [];
  await Promise.all(
    Array.from({ length: SUBSCRIBERS }, async () => {
      const t0 = Date.now();
      const client = new WsClient(cookie);
      subscribers.push(client);
      await client.open();
      const sub = await client.request('subscribe', { sessionId: publicSessionId });
      if (sub.type !== 'subscribed') fail(`subscribe answered ${sub.type}`);
      const caught = await client.request('catch-up', {
        sessionId: publicSessionId,
        sinceSequence: 0,
      });
      if (caught.type !== 'caught-up') fail(`catch-up answered ${caught.type}`);
      caughtUpMs.push(Date.now() - t0);
    }),
  );
  const anonViewer = new WsClient();
  await anonViewer.open();
  const anonSub = await anonViewer.request('subscribe', { sessionId: publicSessionId });
  if (anonSub.type !== 'subscribed') fail(`anonymous subscribe answered ${anonSub.type}`);
  // Joins the fan-out delivery accounting (its baseline is 0 replay
  // frames — it never catches up), but not the catch-up timings.
  subscribers.push(anonViewer);
  caughtUpMs.sort((a, b) => a - b);
  const caughtP50 = percentile(caughtUpMs, 50);
  const caughtP95 = percentile(caughtUpMs, 95);

  // ---- Phase C: live fan-out ceiling ---------------------------------
  console.log(
    `[load-test] phase C: ${String(PROPOSES)} sequence-gated proposes, fan-out x${String(SUBSCRIBERS)}`,
  );
  const baselinePerSubscriber = subscribers.map((s) => s.appliedSequences.length);
  const driver = new WsClient(cookie);
  await driver.open();
  const dsub = await driver.request('subscribe', { sessionId: publicSessionId });
  if (dsub.type !== 'subscribed') fail(`driver subscribe answered ${dsub.type}`);

  let lastSeq = publicLogLength;
  const cStart = Date.now();
  for (let i = 0; i < PROPOSES; i += 1) {
    // A propose can append more than one event (propose-time fan-out
    // per ADR 0027); if our expectedSequence went stale between the
    // broadcast frames, the gate answers sequence-mismatch — refresh
    // and retry the same propose (bounded).
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const applied = driver.next(
        (env) =>
          env.type === 'event-applied' &&
          ((env.payload?.['event'] as { sequence?: number } | undefined)?.sequence ?? 0) > lastSeq,
      );
      const reply = await driver.request('propose', {
        sessionId: publicSessionId,
        expectedSequence: lastSeq,
        proposal: {
          kind: 'capture-node',
          node_id: randomUUID(),
          wording: `Load statement ${String(i)}`,
        },
      });
      if (reply.type === 'proposed') {
        await applied;
        lastSeq = Math.max(lastSeq, ...driver.appliedSequences);
        break;
      }
      const code = reply.payload?.['code'];
      if (code === 'sequence-mismatch' && attempts < 5) {
        // Abandon the waiter (its eventual timeout must not surface
        // as an unhandled rejection), let in-flight broadcast frames
        // land, then refresh the gate.
        applied.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 50));
        lastSeq = Math.max(lastSeq, ...driver.appliedSequences);
        continue;
      }
      fail(`propose ${String(i)} answered ${reply.type}: ${JSON.stringify(reply.payload)}`);
    }
  }
  const cWallMs = Date.now() - cStart;
  const appendedByC = lastSeq - publicLogLength;
  const proposeRps = PROPOSES / (cWallMs / 1000);

  // Give broadcasts a moment to drain, then check delivery completeness.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const expectedPerSubscriber = appendedByC;
  let deliveredTotal = 0;
  let fullyDelivered = 0;
  subscribers.forEach((s, i) => {
    const got = s.appliedSequences.length - (baselinePerSubscriber[i] ?? 0);
    deliveredTotal += got;
    if (got >= expectedPerSubscriber) fullyDelivered += 1;
  });

  for (const s of subscribers) s.close();
  driver.close();

  // ---- Report + floors ------------------------------------------------
  const report = {
    phaseA: {
      sessions: SESSIONS,
      events: aEvents,
      wallMs: aWallMs,
      eventsPerSec: round2(ingestEps),
    },
    phaseB: {
      subscribers: SUBSCRIBERS,
      catchUpEvents: publicLogLength,
      caughtUp: caughtUpMs.length,
      p50Ms: caughtP50,
      p95Ms: caughtP95,
    },
    phaseC: {
      proposes: PROPOSES,
      eventsAppended: appendedByC,
      wallMs: cWallMs,
      proposesPerSec: round2(proposeRps),
      broadcastFramesExpected: expectedPerSubscriber * subscribers.length,
      broadcastFramesDelivered: deliveredTotal,
      subscribersFullyDelivered: fullyDelivered,
    },
  };
  console.log(`[load-test] report\n${JSON.stringify(report, null, 2)}`);

  if (ingestEps < MIN_INGEST_EPS) {
    fail(`ingest ${String(round2(ingestEps))} events/s below floor ${String(MIN_INGEST_EPS)}`);
  }
  if (caughtUpMs.length !== SUBSCRIBERS) {
    fail(`${String(caughtUpMs.length)}/${String(SUBSCRIBERS)} subscribers caught up`);
  }
  if (caughtP95 > MAX_CAUGHT_UP_P95_MS) {
    fail(`caught-up p95 ${String(caughtP95)}ms above floor ${String(MAX_CAUGHT_UP_P95_MS)}ms`);
  }
  if (proposeRps < MIN_PROPOSE_RPS) {
    fail(`propose rate ${String(round2(proposeRps))}/s below floor ${String(MIN_PROPOSE_RPS)}`);
  }
  if (fullyDelivered !== subscribers.length) {
    fail(
      `${String(fullyDelivered)}/${String(subscribers.length)} subscribers received every broadcast`,
    );
  }
  console.log('[load-test] PASS: all floors met');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
