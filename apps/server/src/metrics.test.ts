// Vitest unit tests for the periodic metrics emitter.
//
// Refinement: tasks/refinements/deployment/basic_metrics.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.basic_metrics
//
// Coverage:
//   1. `collectAppMetrics` field shape — every documented field is a
//      number; a bare instance without the WS subscriptions
//      decoration reports zeros instead of throwing (the lazy /
//      guarded registry read).
//   2. Registry-backed counts thread through: subscriptions recorded
//      on `app.wsSubscriptions` appear in the bag.
//   3. The interval emitter writes one `app-metrics` JSON line per
//      tick through the app logger (fake timers + capture stream).
//   4. `app.close()` stops the timer — no lines after close.
//
// No port bind, no network (ADR 0022). The capture stream is the
// same pattern logger.test.ts uses for redact assertions.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectAppMetrics,
  METRICS_INTERVAL_MS,
  METRICS_LOG_MSG,
  metricsEmitterPlugin,
  type AppMetrics,
} from './metrics.js';
import { wsSubscriptionsPlugin } from './ws/subscriptions.js';

/** Fields every metrics bag must carry, per the refinement. */
const METRIC_FIELDS: ReadonlyArray<keyof AppMetrics> = [
  'wsConnections',
  'wsSubscribedSessions',
  'wsSubscriptions',
  'eventLoopDelayP99Ms',
  'eventLoopDelayMaxMs',
  'rssBytes',
  'heapUsedBytes',
  'uptimeSec',
];

/** Minimal histogram stand-in for direct collectAppMetrics calls. */
const zeroHistogram = { percentile: () => 0, max: 0 };

interface CapturedLine {
  msg?: unknown;
  metrics?: Record<string, unknown>;
}

function captureStream(lines: CapturedLine[]): { write(msg: string): void } {
  return {
    write(msg: string): void {
      lines.push(JSON.parse(msg) as CapturedLine);
    },
  };
}

describe('collectAppMetrics', () => {
  it('reports zeros for WS counts on a bare instance (no wsSubscriptions decoration)', async () => {
    const app = Fastify({ logger: false });
    await app.ready();

    const bag = collectAppMetrics(app, zeroHistogram);
    expect(bag.wsConnections).toBe(0);
    expect(bag.wsSubscribedSessions).toBe(0);
    expect(bag.wsSubscriptions).toBe(0);
    for (const field of METRIC_FIELDS) {
      expect(typeof bag[field], `field ${field}`).toBe('number');
    }

    await app.close();
  });

  it('threads registry counts through the bag', async () => {
    const app = Fastify({ logger: false });
    await app.register(wsSubscriptionsPlugin);
    await app.ready();

    app.wsSubscriptions.subscribe('00000000-0000-4000-8000-0000000000a1', 'sess-1');
    app.wsSubscriptions.subscribe('00000000-0000-4000-8000-0000000000a1', 'sess-2');
    app.wsSubscriptions.subscribe('00000000-0000-4000-8000-0000000000a2', 'sess-1');

    const bag = collectAppMetrics(app, zeroHistogram);
    expect(bag.wsSubscribedSessions).toBe(2);
    expect(bag.wsSubscriptions).toBe(3);

    await app.close();
  });

  it('converts histogram nanoseconds to milliseconds', async () => {
    const app = Fastify({ logger: false });
    await app.ready();

    const bag = collectAppMetrics(app, {
      percentile: () => 12_345_678, // ns
      max: 98_765_432, // ns
    });
    expect(bag.eventLoopDelayP99Ms).toBeCloseTo(12.35, 2);
    expect(bag.eventLoopDelayMaxMs).toBeCloseTo(98.77, 2);

    await app.close();
  });
});

describe('metricsEmitterPlugin interval', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function buildEmittingApp(
    lines: CapturedLine[],
    intervalMs: number,
  ): Promise<FastifyInstance> {
    const app = Fastify({
      logger: { level: 'info', stream: captureStream(lines) },
    });
    await app.register(metricsEmitterPlugin, { intervalMs });
    await app.ready();
    return app;
  }

  function metricsLines(lines: CapturedLine[]): CapturedLine[] {
    return lines.filter((line) => line.msg === METRICS_LOG_MSG);
  }

  it('emits one app-metrics line per tick with the full field set', async () => {
    vi.useFakeTimers();
    const lines: CapturedLine[] = [];
    const app = await buildEmittingApp(lines, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(metricsLines(lines)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(metricsLines(lines)).toHaveLength(3);

    const bag = metricsLines(lines)[0]?.metrics;
    expect(bag).toBeDefined();
    for (const field of METRIC_FIELDS) {
      expect(typeof bag?.[field], `field ${field}`).toBe('number');
    }

    await app.close();
  });

  it('stops emitting after close', async () => {
    vi.useFakeTimers();
    const lines: CapturedLine[] = [];
    const app = await buildEmittingApp(lines, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(metricsLines(lines)).toHaveLength(1);

    await app.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metricsLines(lines)).toHaveLength(1);
  });

  it('defaults to the documented 60s cadence', () => {
    expect(METRICS_INTERVAL_MS).toBe(60_000);
  });
});
