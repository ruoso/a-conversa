# 0035 — Persist transient OIDC flow state in Postgres

- **Date**: 2026-05-30
- **Status**: Accepted

## Context

The OIDC authorization-code flow stores a short-lived record keyed by the
random `state` value. The record contains the nonce and PKCE verifier that the
callback must consume exactly once. The original implementation kept those
records in a process-local `Map`. That is sufficient for one Node process, but
a login fails if its callback reaches another instance or if the original
instance restarts during the flow.

The store is security-sensitive: nonce and PKCE verifier values must remain
server-side, and consuming a state value must remain atomic so callback replay
continues to fail. The service already depends on Postgres and already runs
forward-only SQL migrations. Redis would introduce another production service,
while a signed browser cookie would expose confidential flow material to the
client even if tampering were prevented.

## Decision

Persist production OIDC flow-state records in a Postgres table keyed by
`state`. Store the nonce, PKCE verifier, and expiry timestamp server-side. Use
an atomic `DELETE ... RETURNING` operation for one-shot callback consumption.

Retain the in-memory implementation as an injected test double. The production
default is a Postgres-backed implementation using the existing lazy singleton
`DbPool`. It preserves the existing hard capacity ceiling and periodically
deletes expired rows. Capacity enforcement is serialized across instances with
a Postgres advisory transaction lock inside the insert statement.

## Consequences

- A login can start on one app instance and complete on another, and an app
  restart no longer discards in-flight flows.
- The callback replay defense stays atomic across instances.
- Production auth-flow startup now requires the existing Postgres dependency
  and the new migration to be applied.
- Expired transient rows may remain until the periodic sweep or a capacity-edge
  insert, but they cannot be consumed after expiry.
- The injected in-memory store remains useful for hermetic route and unit tests;
  it is not the production default.
