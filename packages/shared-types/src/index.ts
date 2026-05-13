// Public surface of `@a-conversa/shared-types`.
//
// Per ADR 0010 (directory layout) and ADR 0021 (event envelope), this
// package owns the cross-workspace TypeScript contracts: event
// envelopes today, WS message and API types as later tasks land them.

export * from './events.js';
export * from './limits.js';
export * from './ws-envelope.js';
