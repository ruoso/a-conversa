// Per-session in-memory projection cache.
//
// Refinement: tasks/refinements/data-and-methodology/projection_caching.md
// TaskJuggler: data_and_methodology.projection.projection_caching
//
// The server holds one live `Projection` per active session. The cache
// hydrates on demand by calling the constructor-injected `EventLoader`,
// applies new events via `applyEventIncremental`, and evicts entries
// that haven't been accessed within `idleTimeoutMs`. The cache class
// itself stays decoupled from `pg` — production wiring of a real
// `pg`-driven `EventLoader` lands with `backend.api_skeleton`.
//
// Concurrent first-load deduplication is the one non-obvious mechanism:
// two callers that both `getProjection(s)` while no entry is cached
// share a single in-flight Promise so the loader runs exactly once.
// `inFlight` clears in a `finally`, so a rejected hydration leaves no
// poisoned entry and the next call retries.
//
// `evictIdle(now)` is pull-shaped — no internal `setInterval`. The
// server task that owns the cache schedules the periodic call; the
// class stays test-friendly with `now` injected directly.

import type { Event } from '@a-conversa/shared-types';

import { applyEventIncremental } from './incremental.js';
import { Projection } from './projection.js';
import { projectFromLog } from './replay.js';
import type { ProjectionChange } from './types.js';

export type EventLoader = (sessionId: string) => Promise<Event[]>;

interface CachedEntry {
  projection: Projection;
  lastAccessedAt: Date;
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface ProjectionCacheOptions {
  loader: EventLoader;
  idleTimeoutMs?: number;
}

export class ProjectionCache {
  readonly #loader: EventLoader;
  readonly #idleTimeoutMs: number;
  readonly #entries = new Map<string, CachedEntry>();
  readonly #inFlight = new Map<string, Promise<Projection>>();

  constructor(options: ProjectionCacheOptions) {
    this.#loader = options.loader;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  get size(): number {
    return this.#entries.size;
  }

  get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  async getProjection(sessionId: string): Promise<Projection> {
    const cached = this.#entries.get(sessionId);
    if (cached !== undefined) {
      cached.lastAccessedAt = new Date();
      return cached.projection;
    }
    return this.#hydrate(sessionId);
  }

  async applyEvent(sessionId: string, event: Event): Promise<ProjectionChange[]> {
    // Hydrate via `getProjection` so concurrent first-call apply +
    // get share the same in-flight Promise and the loader runs once.
    const projection = await this.getProjection(sessionId);
    const changes = applyEventIncremental(projection, event);
    const entry = this.#entries.get(sessionId);
    if (entry !== undefined) {
      entry.lastAccessedAt = new Date();
    }
    return changes;
  }

  evict(sessionId: string): void {
    this.#entries.delete(sessionId);
  }

  evictIdle(now: Date): void {
    const cutoff = now.getTime() - this.#idleTimeoutMs;
    for (const [sessionId, entry] of this.#entries) {
      if (entry.lastAccessedAt.getTime() < cutoff) {
        this.#entries.delete(sessionId);
      }
    }
  }

  #hydrate(sessionId: string): Promise<Projection> {
    const existing = this.#inFlight.get(sessionId);
    if (existing !== undefined) return existing;

    const promise = (async (): Promise<Projection> => {
      const events = await this.#loader(sessionId);
      const projection = projectFromLog(events, sessionId);
      this.#entries.set(sessionId, {
        projection,
        lastAccessedAt: new Date(),
      });
      return projection;
    })().finally(() => {
      this.#inFlight.delete(sessionId);
    });

    this.#inFlight.set(sessionId, promise);
    return promise;
  }
}
