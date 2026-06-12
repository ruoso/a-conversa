// Periodic application-metrics log line — the v1 "metrics pipeline."
//
// Refinement: tasks/refinements/deployment/basic_metrics.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.basic_metrics
//
// Per ADR 0033 there is NO custom metrics pipeline in v1: Railway's
// dashboard covers service-level CPU / RAM / network, and
// application-level metrics are emitted as structured Pino log lines
// on a low-cadence interval so they land in the same log search as
// everything else. This plugin owns that interval.
//
// One line per tick, `level: info`, constant `msg: 'app-metrics'`
// (the Railway search key), all data under a `metrics` bag per the
// structured-logging conventions (docs/observability.md):
//
//   - wsConnections          open WebSocket connections
//   - wsSubscribedSessions   sessions with >=1 subscriber
//   - wsSubscriptions        total (connection, session) pairs
//   - eventLoopDelayP99Ms    p99 event-loop delay over the interval
//   - eventLoopDelayMaxMs    max event-loop delay over the interval
//   - rssBytes / heapUsedBytes  process memory
//   - uptimeSec              process uptime (anchors lines to a deploy)
//
// **Why event-loop delay and not "event-log lag".** The event
// append -> projection -> WS broadcast path is synchronous and
// in-process — there is no queue whose depth could lag, so the
// literal "event-log lag" metric ADR 0033 sketched is structurally
// zero. The failure mode it was meant to catch (the fan-out falling
// behind under load) manifests as event-loop delay, which
// `monitorEventLoopDelay` measures directly. See the refinement's
// Decisions.
//
// **Why no per-handler latency aggregation.** Every request
// completion line already carries `responseTime`; v1 documents the
// log query instead of duplicating it with an in-process histogram.
//
// The interval timer is `unref()`ed (never holds the process open)
// and cleared on `onClose`. The per-tick registry read is lazy and
// decoration-guarded so plugin registration order doesn't matter and
// a bare test instance without the WS plugins still emits a line.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { countOpenWsConnections } from './ws/connection.js';

/**
 * Emission cadence. A constant, not an env var — same stance as the
 * readyz ping timeout: tune it when a real deployment proves it
 * wrong. Tests override via the plugin option below.
 */
export const METRICS_INTERVAL_MS = 60_000;

/**
 * The constant `msg` value — the Railway log-search key for the
 * whole metrics time series (substring query: `app-metrics`).
 */
export const METRICS_LOG_MSG = 'app-metrics';

/** The per-tick metrics bag, as logged under the `metrics` key. */
export interface AppMetrics {
  readonly wsConnections: number;
  readonly wsSubscribedSessions: number;
  readonly wsSubscriptions: number;
  readonly eventLoopDelayP99Ms: number;
  readonly eventLoopDelayMaxMs: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly uptimeSec: number;
}

/**
 * Options for the plugin. Production passes nothing; tests shrink
 * the interval so a tick happens inside a fake-timer advance.
 */
export interface MetricsEmitterOptions {
  readonly intervalMs?: number;
}

/** Nanoseconds (histogram resolution) to milliseconds, 2 decimals. */
function nsToMs(ns: number): number {
  return Math.round(ns / 10_000) / 100;
}

/**
 * Collect one tick's metrics bag. Exported for the test that pins
 * the field shape without spinning the interval.
 */
export function collectAppMetrics(
  app: FastifyInstance,
  histogram: { percentile(p: number): number; max: number },
): AppMetrics {
  // Lazy, decoration-guarded registry read: a bare instance without
  // the WS plugins reports zeros rather than throwing.
  const subscriptionStats = app.hasDecorator('wsSubscriptions')
    ? app.wsSubscriptions.stats()
    : { sessions: 0, connections: 0, subscriptions: 0 };

  const memory = process.memoryUsage();

  return {
    wsConnections: countOpenWsConnections(),
    wsSubscribedSessions: subscriptionStats.sessions,
    wsSubscriptions: subscriptionStats.subscriptions,
    eventLoopDelayP99Ms: nsToMs(histogram.percentile(99)),
    eventLoopDelayMaxMs: nsToMs(histogram.max),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    uptimeSec: Math.round(process.uptime()),
  };
}

const metricsEmitterPluginAsync: FastifyPluginAsync<MetricsEmitterOptions> = (app, opts) => {
  const intervalMs = opts.intervalMs ?? METRICS_INTERVAL_MS;

  // Event-loop delay histogram: enabled for the process lifetime,
  // reset after every tick so each line reports the delay over ITS
  // interval (not a since-boot aggregate that dilutes spikes).
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const timer = setInterval(() => {
    app.log.info({ metrics: collectAppMetrics(app, histogram) }, METRICS_LOG_MSG);
    histogram.reset();
  }, intervalMs);
  // Never hold the process open: the emitter observes, it doesn't
  // own lifecycle.
  timer.unref();

  app.addHook('onClose', (_instance, done) => {
    clearInterval(timer);
    histogram.disable();
    done();
  });

  return Promise.resolve();
};

/**
 * `fastify-plugin`-wrapped so the registration in `createServer()`
 * attaches to the root scope regardless of encapsulation, matching
 * the sibling observability plugins.
 */
export const metricsEmitterPlugin = fp(metricsEmitterPluginAsync, {
  name: 'a-conversa-metrics-emitter',
  fastify: '5.x',
});
