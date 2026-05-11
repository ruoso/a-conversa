// Barrel for the WS broadcast surface.
//
// Refinement: tasks/refinements/backend/ws_event_broadcast.md
// TaskJuggler: backend.websocket_protocol.ws_event_broadcast
//
// Re-exports the bus, the per-connection sender registry, and the
// `event-applied` subscriber so callers reach a single import path.

export {
  WsBroadcastBus,
  wsBroadcastPlugin,
  type EventAppliedBusEvent,
  type WsBroadcastBusEventName,
  type WsBroadcastListener,
} from './bus.js';
export {
  WsConnectionSenderRegistry,
  wsConnectionSendersPlugin,
  type WsEnvelopeSender,
} from './connections.js';
export {
  buildEventAppliedBroadcastListener,
  wsEventAppliedBroadcastPlugin,
  type EventAppliedBroadcastListenerOptions,
} from './event-applied.js';
export {
  buildDiagnosticBroadcastListener,
  WsDiagnosticBroadcast,
  wsDiagnosticBusPlugin,
  wsDiagnosticBroadcastPlugin,
  type DiagnosticBroadcastActiveContext,
  type DiagnosticBroadcastListener,
  type DiagnosticBroadcastListenerOptions,
  type DiagnosticBroadcastStatus,
} from './diagnostic.js';
export {
  buildProposalStatusBroadcastListener,
  buildPoolEventLoader,
  wsProposalStatusBroadcastPlugin,
  type ProposalStatusBroadcastListenerOptions,
  type ProposalStatusEventLoader,
  type WsProposalStatusBroadcastOptions,
} from './proposal-status.js';
