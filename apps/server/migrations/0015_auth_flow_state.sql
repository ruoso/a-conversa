-- Transient, server-side OIDC authorization-flow state shared by app instances.
-- ADR: docs/adr/0035-postgres-backed-oidc-flow-state.md
CREATE TABLE IF NOT EXISTS auth_flow_state (
  state         text PRIMARY KEY,
  nonce         text NOT NULL,
  code_verifier text NOT NULL,
  expires_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_flow_state_expires_at_idx ON auth_flow_state (expires_at);
