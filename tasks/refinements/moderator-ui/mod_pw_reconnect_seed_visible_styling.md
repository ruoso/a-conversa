# Pay down deferred reconnect-mid-decompose Playwright sub-step — wire `window.__testHooks.killWebSocket()` + lift the seed regression cover

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_pw_reconnect_seed_visible_styling` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at lines 331-339).

**Effort estimate**: 1d (per the `.tji` allocation). Breakdown: ~0.25d to grow `WsClient` with a `killWebSocket()` method + shell-side Vitest covering "force-close runs the natural onclose→reconnect path"; ~0.25d to wire the moderator-side exposure on `window.__testHooks` from `OperateRouteInner` (lifecycle-correct install + teardown); ~0.5d to extend Scenario 3 of `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts` with the reconnect-mid-decompose sub-step (kill, wait for status return to `'open'`, assert the per-component nodes still carry `data-facet-status="proposed"`, guard against a brief flash to undefined during catch-up).

## Inherited dependencies

**Settled:**

- `moderator_ui.mod_graph_rendering.migrate_off_compute_facet_statuses_onto_proposal_status_broadcast` (done — landed the server-side `emitPendingProposalStatusFrames(connection, projection, sessionId, log)` seed helper, called from `apps/server/src/ws/handlers/snapshot.ts:205` + `apps/server/src/ws/handlers/catch-up.ts:570` after `snapshot-state`; landed the shell-side per-entity store cell `pendingProposalFacetStatus: Map<\`${entityKind}:${entityId}:${facetName}\`, FacetStatus>` that the seed envelopes write into; re-wired `GraphCanvasPane` + `PendingProposalsPane` + `ProposalFacetBreakdown` to read from the broadcast-derived map. The seed contract is pinned at the handler-integration layer via [`apps/server/src/ws/handlers/snapshot.test.ts`](../../../apps/server/src/ws/handlers/snapshot.test.ts) (snapshot-after-pending seed assertions) and [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) case-2 at L493/L843. What is NOT yet pinned end-to-end is that a moderator browser losing its WS connection mid-decompose actually rebuilds per-component canvas styling from the seed envelopes after reconnect; that is this task's scope.).
- `backend.websocket_protocol.facet_status_server_decompose_component_facets` (done — `apps/server/src/ws/broadcast/proposal-status.ts:267`'s exported `facetTargetsForProposal(payload)` returns N per-component `FacetTarget[]` for pending decompose / interpretive-split; the seed helper iterates each pending proposal in projection order and emits one envelope per target.).
- `moderator_ui.mod_graph_rendering.mod_proposed_entity_canvas_visibility` (done — established the four-scenario spec at [`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts); Scenario 3 at L230-285 drives the 2-component decompose propose-time canvas and asserts three nodes carry `data-facet-status="proposed"`. That fixture is the natural extension point — the reconnect sub-step lands at the end of the existing test body, no new file.).
- [ADR 0008 — Playwright as the E2E framework](../../../docs/adr/0008-e2e-framework-playwright.md) — the harness this spec mounts under; `page.evaluate(...)` is the canonical bridge for poking a same-origin test seam.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the kill-hook ships as a committed test seam (production-reachable code path with a real test that exercises it), not a `DEV`-gated probe; same discipline that justified the existing `window.__aConversaWsStore` exposure at [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) L36-55.

**Pending:** (none — every input the task touches is settled on `main`.)

## What this task is

Pay down the deferred-e2e debt left by `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`. The migration landed the seed envelopes (so a moderator that reconnects mid-decompose receives one `proposal-status` per pending facet target after `snapshot-state`) and pinned the wire contract at the handler-integration layer, but the e2e sub-step that exercises the actual browser-reconnect path was deferred because the shell `WsClient` had no programmatic way for a Playwright spec to force-close the socket.

This task ships two artifacts:

1. **`WsClient.killWebSocket()` method.** A new public method on `WsClient` (`packages/shell/src/ws/client.ts`) that force-closes the underlying socket WITHOUT flipping `explicitlyClosed`, so the existing `s.onclose` handler runs its natural path: `socket = undefined`, `rejectAllPending(...)`, `scheduleReconnect()`. The method is a one-line wrapper around `socket?.close()` that's deliberately reachable from production code (no `import.meta.env.DEV` gate) so the test seam survives the production-mode build (per the `__aConversaWsStore` rationale at [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) L48-54).

2. **`window.__testHooks.killWebSocket` exposure + Playwright sub-step.** The moderator's `OperateRouteInner` (where `useWsClient()` resolves) installs the hook on `window.__testHooks.killWebSocket` via a `useEffect`, with a cleanup that deletes the property on unmount. Scenario 3 of [`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts) grows a final sub-step that calls the hook via `page.evaluate`, waits for the connection status to return to `'open'`, and asserts the three nodes still carry `data-facet-status="proposed"`. A separate assertion guards against a brief flash to undefined during the catch-up window (the post-`snapshot-state` / pre-seed-envelope sliver) — Playwright's `expect.poll` watcher rejects if it ever observes `data-facet-status === null` or `''` on any of the three nodes.

The seed contract itself does NOT change here. The migration's handler-integration tests stay the source of truth for "the server emits N seed envelopes in the right order with the right payload shape"; this task pins "the moderator browser actually consumes them on reconnect and ends up with the same canvas styling it had before the kill."

## Why it needs to be done

The migration's Acceptance Criteria §Playwright explicitly scoped the reconnect sub-step (L139-142 of [`migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md`](./migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md)) and the rejected-alternative there is clear: *"the alternative — letting the reconnect be unsimulated — would leave the seed contract un-pinned and is rejected."* The migration shipped without it only because the kill-hook was non-trivial scope to wire alongside the wire-shape + store-rewrite work. With the seed contract now landed and pinned server-side, the unpinned slice is exactly this: does a real moderator browser, after losing its WS connection mid-decompose, consume the seed envelopes correctly and render the per-component nodes with `data-facet-status="proposed"` again?

A regression here is silent. The handler-integration tests will keep passing (the server-side seed math is unchanged). The shell-store Vitest cases will keep passing (the store's `applyProposalStatus` per-entity write is unchanged). The visible canvas styling would only break if a future change to envelope ordering, the snapshot/seed dispatch sequence in the catch-up branch, or the per-entity-cell write timing introduced a race where the first render after `snapshot-state` flushes BEFORE the seed envelopes apply. That's exactly the failure mode the migration's D7 ordering decision was designed to prevent ("seed envelopes go AFTER `snapshot-state`, NOT before") — but without a browser-level e2e watching the canvas through the reconnect cycle, the ordering pin is theoretical. This task makes the ordering pin observable.

The kill-hook is also reusable. Future moderator e2e scenarios that need to exercise reconnect (vote-mid-flight reconnect, commit-mid-flight reconnect, withdraw-then-reconnect) get the same seam for free. The hook's design — public method on `WsClient`, surface-side `window.__testHooks` wiring — keeps the shell client free of `window`-touching code (audience + participant don't get a kill-hook installed unless their own surface wires it) while giving the moderator a stable Playwright entry point.

## Inputs / context

**Design / contract:**

- The seed contract is canonical in the migration's D7 at [`migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md`](./migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md) L207-211 — "Reconnect-seed envelopes are sent on the requesting connection only (NOT broadcast), and after `snapshot-state` (NOT before)."
- The wire dispatch order on the receiving side is fixed by [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) L286-308's `emitEnvelope` — `dispatchToStore(envelope)` runs synchronously before external handlers, so the per-entity cell write at `applyProposalStatus` completes BEFORE React reads the store. The risk this e2e pins is not at the receiver — it's at the cross-envelope boundary (a render that scheduled between `snapshot-state` apply and the first seed envelope's apply would observe a fresh `applySnapshot` with an empty `pendingProposalFacetStatus` for the just-arrived entities).

**Runtime inputs (real file references the implementer reads + edits):**

- [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) L231-235 — the closure-local `socket: WsLike | undefined` + `explicitlyClosed: boolean` are the two pieces of state `killWebSocket()` interacts with.
- [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) L391-420 — `attachSocket(s)`'s `s.onclose` handler is the natural reconnect path. `killWebSocket()` MUST NOT flip `explicitlyClosed` (otherwise `scheduleReconnect` short-circuits at L340).
- [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) L510-523 — `close()` is the explicit-close path; `killWebSocket()` is its inverse-intent twin (close the socket but allow reconnect).
- [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) L125-146 — the `WsClient` interface gets a single new member `killWebSocket: () => void`.
- [`packages/shell/src/ws/ws-client.test.ts`](../../../packages/shell/src/ws/ws-client.test.ts) — the existing test seam (`makeSocket` factory injection + `scheduleTimeout`/`cancelTimeout` overrides) lets a Vitest case construct a client with a fake `WsLike`, call `client.killWebSocket()`, and assert the natural reconnect path ran.
- [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) L95-120 — `OperateRoute` mounts `<WsClientProvider>`; `OperateRouteInner` runs INSIDE the provider, so `useWsClient()` resolves there. A new `useEffect` installs `window.__testHooks.killWebSocket = () => client.killWebSocket()` on mount and deletes the property on cleanup.
- [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) L36-55 — the existing `__aConversaWsStore` precedent for un-gated `window` exposure of a test seam. Same rationale carries over verbatim (the production-mode build tree-shakes a `DEV`-gated branch, so the exposure stays unconditional).
- [`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts) L230-285 — Scenario 3 (2-component decompose propose). The reconnect sub-step lands at the END of this test body, after the existing three-node assertion at L279-284.
- [`apps/server/src/ws/broadcast/proposal-status.ts`](../../../apps/server/src/ws/broadcast/proposal-status.ts) L697-720 — `emitPendingProposalStatusFrames(connection, projection, sessionId, log)` is the server-side seed helper; the moderator's reconnect drives this code path via the `catch-up` handler at [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) L570.
- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) L493 + L843 — D7 case-2 assertions; this task does NOT modify these (the wire-layer contract stays pinned there).
- [`apps/server/src/ws/handlers/snapshot.test.ts`](../../../apps/server/src/ws/handlers/snapshot.test.ts) — snapshot-after-pending seed assertions; this task does NOT modify these either.

**ADR-level inputs:**

- [ADR 0008](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright + compose-stack layering; `page.evaluate` is the canonical bridge to a same-origin test seam.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — empirical checks ship as committed tests; the kill-hook + the spec sub-step land together in the same commit cluster.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the seed contract this e2e pins is the per-component facet-status broadcast that 0027's decompose/interpretive-split decision motivates.

## Constraints / requirements

- The `killWebSocket()` method MUST trigger the natural reconnect path. Concretely: after the call, the client's onclose-handler runs, sets `socket = undefined`, rejects pending requests with `'ws connection closed'`, and calls `scheduleReconnect()` (which transitions status to `'reconnecting'` and schedules `openSocket()` via the configured `scheduleTimeout`).
- The method MUST NOT flip `explicitlyClosed = true`. Doing so would short-circuit `scheduleReconnect` at [`client.ts`](../../../packages/shell/src/ws/client.ts) L340 and the test would observe a `'closed'` terminal state instead of a reconnect.
- The method MUST be a no-op when `socket === undefined` (idempotent against a client that is already reconnecting or already closed); the underlying `socket?.close()` already handles this via optional chaining.
- The moderator-side `window.__testHooks` install MUST clean up on unmount. A stale `killWebSocket` pointing at an old `WsClient` instance after route navigation would crash on a subsequent test invocation (the closure-captured `socket` is undefined post-unmount; the call is harmless but the test would not observe a real kill).
- The `window.__testHooks` namespace is introduced as the canonical surface for future test seams. Single-letter properties (`window.__killWs`) are rejected — the namespaced object scales as more hooks land (e.g., `force-emit-envelope`, `drain-pending`) without polluting the global namespace and without name collisions across surfaces.
- The Playwright sub-step MUST reuse Scenario 3's existing fixture chain (no new test file, no duplicate moderator-reach-operate path). The reconnect assertion lands at the end of the existing test body.
- The sub-step MUST guard against a flash-to-undefined regression. A simple post-reconnect assertion that the nodes carry `data-facet-status="proposed"` is necessary but not sufficient — the failure mode the seed envelopes prevent is a sliver where `snapshot-state` has applied (so the projection has rebuilt) but the seed envelopes have not yet written the per-entity facet-status cells. The watcher uses `expect.poll` with a sample period inside the catch-up window and rejects if any sampled value is `null` / `''` / `'awaiting-proposal'`.
- The kill-hook MUST NOT be exposed on the audience or participant surfaces in this task. They have no reconnect-mid-decompose flow today; adding the global there would expand the production-reachable test seam surface beyond what's needed.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every empirical check ships as a committed test. The layering is: shell-side Vitest pins the `killWebSocket()` mechanics; the moderator-side Playwright sub-step pins the browser-observable reconnect-seed contract.

Shell-side Vitest (per ADR 0022 — extended in [`packages/shell/src/ws/ws-client.test.ts`](../../../packages/shell/src/ws/ws-client.test.ts)):

- [ ] **`killWebSocket()` invokes `socket.close()` on the underlying `WsLike`.** A client constructed with a fake `makeSocket` that records `close()` calls observes one `close()` invocation after `client.killWebSocket()` returns. Idempotent: a second call with `socket === undefined` is a silent no-op (no error thrown).
- [ ] **`killWebSocket()` runs the natural reconnect path.** After `killWebSocket()` fires (and the fake socket synthetically emits `onclose`), the client's status transitions to `'reconnecting'` and `scheduleTimeout` is invoked with a delay matching `nextBackoffMs()`. The subsequent `openSocket()` is called when the scheduled callback runs.
- [ ] **`killWebSocket()` does NOT flip `explicitlyClosed`.** A client whose `killWebSocket` was called and whose fake socket then emits `onclose` ends up in `'reconnecting'`, NOT `'closed'`. (Mirror assertion: a client where `close()` was called and `onclose` then fires ends up in `'closed'` — the existing test case for `close()` is the contrast.)
- [ ] **`killWebSocket()` rejects pending requests with `'ws connection closed'`.** A `send('subscribe', ...)` promise in-flight at the moment of `killWebSocket()` rejects with the same `'ws connection closed'` error the natural close path produces (existing `rejectAllPending` contract).

Moderator-side Playwright (per UI-stream e2e policy — `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`):

- [ ] **Existing Scenario 3 stays green.** The pre-reconnect assertion that three nodes carry `data-facet-status="proposed"` after the 2-component decompose propose is unchanged.
- [ ] **Reconnect sub-step: kill → seed-driven re-render.** After Scenario 3's pre-reconnect assertion, the spec calls `await page.evaluate(() => window.__testHooks.killWebSocket())`. It then waits up to 10s for `useWsStore.getState().connectionStatus === 'open'` (via `page.waitForFunction` against `window.__aConversaWsStore.getState().connectionStatus`). After the status returns to `'open'`, the spec re-asserts the three statement-node testids exist and each carries `data-facet-status="proposed"`.
- [ ] **Reconnect sub-step: no flash to undefined / awaiting-proposal during catch-up.** Concurrently with the kill, the spec installs an `expect.poll` watcher (sample period 50ms, window 10s, against `page.locator('[data-testid^="statement-node-"]')`) that fails if any sampled iteration observes a node whose `data-facet-status` attribute is `null`, `''`, `'undefined'`, or `'awaiting-proposal'`. The watcher pins the migration's D7 ordering ("seed envelopes go AFTER `snapshot-state`, NOT before"); a regression that flips the order would surface here as a sampled-`null` failure.

Moderator-side install Vitest (per ADR 0022 — extended in [`apps/moderator/src/routes/OperateRoute.test.tsx`](../../../apps/moderator/src/routes/OperateRoute.test.tsx) or a new sibling):

- [ ] **Mount installs `window.__testHooks.killWebSocket`.** After `<OperateRoute>` mounts (via the existing test scaffolding that resolves `<WsClientProvider>`), `window.__testHooks?.killWebSocket` is a function reference.
- [ ] **Unmount removes `window.__testHooks.killWebSocket`.** After the route unmounts, `window.__testHooks.killWebSocket` is undefined. A subsequent re-mount re-installs the property pointing at the new client instance.

Existing tests stay green:

- [ ] All existing shell-side `ws-client.test.ts` cases continue to pass — the `WsClient` interface grew by one method; existing constructors / call sites are unchanged.
- [ ] All existing moderator Vitest suites pass — the new `useEffect` in `OperateRouteInner` is additive.
- [ ] The other three Scenarios (1, 2, the propose-with-edge variants) in [`moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts) are unchanged — the reconnect sub-step is contained inside Scenario 3.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/shell build` succeeds.
- [ ] `pnpm -F @a-conversa/moderator build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ≥ 6 (4 shell-side `killWebSocket` cases + 2 moderator install/unmount cases).
- [ ] The Playwright suite (`pnpm test:e2e` against `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`) is green, with Scenario 3's runtime increasing by the reconnect window (≤ 12s additional).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_pw_reconnect_seed_visible_styling`.

## Decisions

- **D1 — Add a public `killWebSocket(): void` method to the `WsClient` interface (NOT a Symbol-keyed back-door, NOT an `import.meta.env.DEV`-gated branch).** The shell's `WsClient` already documents two test seams at [`client.ts`](../../../packages/shell/src/ws/client.ts) L24-28 (`makeSocket` factory injection + `scheduleTimeout`/`cancelTimeout` overrides); the kill-hook is the third member of the same family. It lands as a regular public interface member so callers (test seams, the moderator's `window.__testHooks` install) reference it through normal typed code, not via `as unknown`. Rationale:
  - **Co-locates the test-seam declaration with the existing ones.** The docblock at L24-28 grows by one line; future readers see a unified test-seam contract.
  - **Production-reachable + tree-shake-resistant.** Same rationale as the `__aConversaWsStore` exposure at [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) L48-54 — the production-mode build (used by `make up-prod-mode` and the runtime image) tree-shakes a `DEV`-gated branch, leaving the e2e spec without its entry point. The method ships unconditionally; the cost is one extra public method on the interface.
  - **No security exposure.** The method does nothing the user can't already do by closing their browser tab. The natural reconnect path is what the client already does on every TCP-level disconnect; the hook just lets a test trigger it deterministically.
  - **Alternatives considered:**
    - **(B) Symbol-keyed back-door (`(client as any)[Symbol.for('a-conversa.killWebSocket')]()`).** Rejected — the typed-interface case is cleaner; the back-door pattern is what `DEV`-gated branches encourage when the codebase shouldn't admit a test seam exists, but `__aConversaWsStore` is already public so the convention is established.
    - **(C) Add a `disconnect-for-test` opt to `CreateWsClientOptions` that wires an emit-via-the-options-callback path.** Rejected — option-bag bloat with no benefit; the method-on-interface shape is simpler and discoverable.
    - **(D) Inject a fake `WsLike` factory at construction time so tests don't need a kill method on the client at all.** Rejected for the e2e use-case — the Playwright spec doesn't construct the client, it reaches the production client through the real `WsClientProvider` mount path. The `makeSocket` factory is unreachable from `page.evaluate`. The Vitest unit tests CAN and DO use `makeSocket` injection (that's how the existing reconnect tests work); the kill method is for the production-runtime case the Vitest seam can't reach.

- **D2 — `killWebSocket()` implementation: `socket?.close()` only, no `explicitlyClosed` flip, no manual `rejectAllPending` or `scheduleReconnect` invocation.** The browser `WebSocket.close()` triggers `onclose` synchronously (in tests, deterministically via the fake's `dispatchEvent`); the existing `s.onclose` handler at [`client.ts`](../../../packages/shell/src/ws/client.ts) L400-408 already does the full natural-reconnect path. Rationale:
  - **Minimum new code, maximum reuse of the existing reconnect contract.** The onclose path is the EXACT path a TCP-level disconnect follows. The kill hook should NOT diverge from it; doing so would let the test exercise a code path the production runtime never hits.
  - **Idempotent against `socket === undefined`.** A client mid-reconnect (between the old socket's `onclose` and the next `openSocket()`) has `socket === undefined`; `socket?.close()` is a no-op. The test can safely call the hook without checking client status.
  - **Alternatives considered:**
    - **(B) Synthesize the onclose effects directly (`rejectAllPending(...) + scheduleReconnect()`).** Rejected — duplicates the onclose handler's body; a future change to the onclose path would have to be mirrored in two places.
    - **(C) Provide an optional `code`/`reason` parameter so the test can simulate specific WS close codes.** Rejected for v1 — YAGNI; the only client behavior conditional on the close code today is at `s.onclose` which ignores the code entirely (the explicit-vs-natural branch is gated on `explicitlyClosed`, NOT the close code). If a future test needs to assert behavior on close code 1008 (policy violation), this method can grow the parameter then.

- **D3 — Surface-side `window.__testHooks` exposure lives in `OperateRouteInner` (NOT in `mount.tsx`, NOT in `<WsClientProvider>`).** The `WsClient` instance only exists after `<WsClientProvider>` mounts. `useWsClient()` is the typed accessor; it can only be called inside the provider. `OperateRouteInner` is the natural install site because it already runs inside `<WsClientProvider>` and owns a `useEffect` lifecycle for session tracking. Rationale:
  - **Lifecycle-correct install + teardown.** A `useEffect(() => { window.__testHooks = { killWebSocket: () => client.killWebSocket() }; return () => { delete window.__testHooks?.killWebSocket; }; }, [client])` installs on mount and cleans on unmount. The dependency on `client` re-installs if the provider somehow swaps the client (it doesn't today, but the dependency is correct).
  - **Doesn't bleed into shell code.** The shell's `<WsClientProvider>` stays surface-agnostic; the moderator opts in. The audience and participant surfaces don't install the hook, so their `window.__testHooks?.killWebSocket` is undefined (callers do optional chaining per the predecessor's harness language).
  - **Mirrors the `__aConversaWsStore` precedent but improves on it.** `__aConversaWsStore` is installed at `mount.tsx` time (before any auth gate) because it's a store reference, not a client reference. `__testHooks.killWebSocket` is installed only AFTER the user has reached `/m/sessions/:id/operate` (which requires auth + the lobby-gate flow) — strictly narrower exposure window.
  - **Alternatives considered:**
    - **(B) Install in `mount.tsx` alongside `__aConversaWsStore`.** Rejected — the client doesn't exist at mount time; the install would have to capture a lazy getter. Cleaner to install where the client is in scope.
    - **(C) Install inside `<WsClientProvider>` itself, gated on a new prop `installTestHooks?: boolean`.** Rejected — adds a prop the shell has to maintain for one consumer; the moderator-side `useEffect` is simpler and keeps the shell client interface narrow.
    - **(D) Expose via a custom hook `useTestHookInstall(client)` in the shell.** Rejected — same shell-coupling cost as (C) with extra indirection.

- **D4 — Establish `window.__testHooks` as the canonical namespaced test-seam object (NOT a flat `window.__killWs` global, NOT a renamed `__aConversaTestHooks`).** The predecessor refinement's L142 language (`window.__testHooks?.killWebSocket?.()`) already named this namespace; this task formalises it. The existing `__aConversaWsStore` stays as-is (renaming it would require a coordinated update across e2e helpers and is out of scope), but new test seams land under `__testHooks`. Rationale:
  - **Scales without polluting the global namespace.** Future hooks (`forceEmitEnvelope`, `drainPending`, `replayFromSnapshot`) add properties on the same object instead of new globals.
  - **Matches the predecessor's documented expectation.** The migration refinement at L142 specifically wrote `window.__testHooks?.killWebSocket?.()`; this task lands exactly that shape, so any reader cross-referencing the two docs sees a consistent contract.
  - **The brand prefix `__aConversa-` on the existing store global is a holdover from the audience-side `aud_*` rationale.** New surfaces can settle on the unbranded `__testHooks` because Playwright runs against same-origin code where the namespace collision risk is zero. The brand stays useful for store-level globals that might collide with library globals; `__testHooks` is for harness-only utilities.
  - **Alternatives considered:**
    - **(B) Flat `window.__aConversaKillWebSocket`.** Rejected per the namespace-scaling argument; also diverges from the predecessor's documented expectation.
    - **(C) Reuse the existing `__aConversaWsStore` and expose `killWebSocket` as a method on the store handle.** Rejected — `__aConversaWsStore` is the Zustand store `useWsStore` itself; methods on it must obey the store's read-write contract (mutations go through actions, not arbitrary methods). The kill hook is a client-level operation, not a store mutation; conflating the two muddies both APIs.

- **D5 — Sub-step lives at the end of Scenario 3's existing test body (NOT a new test file, NOT a separate `test()` case in the same file).** Scenario 3 already drives the moderator-reach-operate → propose-statement → enter-decompose-mode → fill-rows → propose-decomposition chain. The reconnect sub-step starts from EXACTLY the state Scenario 3 ends in (three nodes, all `data-facet-status="proposed"`); spinning up a parallel fixture would duplicate the chain for no benefit. Rationale:
  - **Reuses ~85% of Scenario 3's wall-clock cost.** The expensive part of the test is reaching the post-decompose-propose state; the kill + reconnect window is ~10s on top of that. A separate `test()` would re-run the moderator-reach-operate + propose-statement + enter-decompose-mode + propose-decomposition chain just to redo the kill — that's a 30s+ test for a 10s assertion.
  - **The sub-step IS Scenario 3's deferred assertion.** Per the migration's L142, the reconnect sub-step was scoped INSIDE the Scenario 3 fixture. Landing it as a separate test would diverge from the migration's stated shape.
  - **Naming convention.** Scenario 3's test title grows from `"Scenario 3: 2-component decompose propose → parent + 2 children all render with data-facet-status=\"proposed\""` to `"Scenario 3: 2-component decompose propose → parent + 2 children all render with data-facet-status=\"proposed\" (incl. reconnect-seed re-render)"`. The cross-reference to this refinement lands in the test docblock.
  - **Alternatives considered:**
    - **(B) New file `tests/e2e/moderator-reconnect-seed.spec.ts`.** Rejected — the fixture chain duplication has no test-isolation benefit (the two tests would share state via the global compose stack anyway); and the new file would surface in the Playwright report as if it tested a different concern from Scenario 3, when it pins the same contract.
    - **(C) Separate `test()` in the same file that reuses a shared `before` hook to reach the post-decompose state.** Rejected — Playwright `beforeEach` would still run the chain per-test (no test-isolation between them), and the reader has to bounce between two tests to understand a single contract.

- **D6 — Flash-to-undefined watcher uses `expect.poll` (NOT a single post-reconnect assertion, NOT a CDP event listener).** The failure mode this task pins is a sliver: the seed envelopes arriving AFTER `snapshot-state` but BEFORE the first post-snapshot render are what populate the per-entity cells; a regression to either ordering would let one render observe an empty `pendingProposalFacetStatus` for the just-arrived entities. `expect.poll` with a 50ms sample period inside the catch-up window is the right granularity — fine-grained enough to catch a sub-100ms flash, coarse enough not to dominate the test runtime. Rationale:
  - **Single post-reconnect assertion is insufficient.** By the time the test waits for `connectionStatus === 'open'` and reads the canvas, the seed envelopes have already applied; a flash-to-undefined during catch-up would not be observed.
  - **`expect.poll` with `fail-on-mismatch` semantics is exactly the watcher shape needed.** Sample period 50ms, window 10s, callback returns the current `data-facet-status` of each node; the matcher rejects if any sampled value is `null` / `''` / `'undefined'` / `'awaiting-proposal'`.
  - **Alternatives considered:**
    - **(B) Listen to React profiler hooks via CDP to record every render's DOM state during the reconnect window.** Rejected — CDP-level instrumentation is heavy; the failure mode is observable via plain DOM polling.
    - **(C) Use MutationObserver inside `page.evaluate` to record every attribute change on the node testids.** Rejected — equivalent observability to `expect.poll` but more code; `expect.poll` is the Playwright-idiomatic shape and integrates with the test report.

- **D7 — Audience + participant surfaces do NOT get the kill-hook installed in this task.** This is a moderator-only test seam for now. The audience surface has its own reconnect story (anonymous WS upgrade per ADR 0029); the participant surface has its own pending-proposals migration tracked separately (`participant_ui.part_pending_proposals.part_migrate_to_pending_proposal_facet_status` per the migration's Status block L236). When those flows need their own reconnect e2e, they can install the hook on their own routes. Rationale:
  - **Minimum production-reachable test-seam surface.** Each surface that installs the hook is a route where a malicious page could (in principle) trigger a WS disconnect via JS injection. That's already true of `window.__aConversaWsStore` (you can drain the store from a debugger), so the marginal exposure is tiny — but tiny ≠ zero, so install where there's actual test coverage requiring it.
  - **Composes cleanly when the participant + audience tasks land.** Each surface's `OperateRoute`-equivalent installs the hook itself, mirroring the moderator pattern. The shell `WsClient.killWebSocket()` method is shared; only the `window.__testHooks` install site is per-surface.
  - **Alternatives considered:**
    - **(B) Install the hook in `<WsClientProvider>` so every surface gets it.** Rejected — see D3(C); also expands the production-reachable surface beyond what's needed.

## Open questions

(none — all decided in D1–D7. The participant + audience reconnect e2e debt is tracked separately by the participant migration follow-up `participant_ui.part_pending_proposals.part_migrate_to_pending_proposal_facet_status` and is not surfaced as new debt by this task. If a future participant or audience refinement scopes a reconnect e2e of its own, the kill-hook landed here is the seam it composes against — the participant / audience `OperateRoute`-equivalent installs `window.__testHooks.killWebSocket` from its own component, calling the same `WsClient.killWebSocket()` method.)

## Status

**Done** — 2026-05-29.

- Added `killWebSocket(): void` to the `WsClient` interface and `createWsClient` implementation in `packages/shell/src/ws/client.ts` — calls `socket?.close()` without flipping `explicitlyClosed`, triggering the natural reconnect path
- Added 4 Vitest cases in `packages/shell/src/ws/ws-client.test.ts` covering close-call + idempotent, natural reconnect path, status contrast vs `close()`, and pending-promise rejection
- Added `killWebSocket: () => undefined` to the typed fake client in `packages/shell/src/ws/WsClientProvider.test.tsx`; same stub patched across 29 fake-WsClient call sites in `apps/moderator` and `apps/participant` test files
- Wired `window.__testHooks.killWebSocket` install/cleanup `useEffect` in `OperateRouteInner` at `apps/moderator/src/routes/Operate.tsx`
- Added `apps/moderator/src/routes/Operate.test.tsx` — 2 Vitest cases pinning mount-install, unmount-removal, and re-mount re-install semantics
- Extended Scenario 3 of `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts` with reconnect sub-step (`page.evaluate` kill → wait for `connectionStatus === 'open'` → re-assert three nodes carry `data-facet-status="proposed"`) plus `expect.poll` flash-to-undefined watcher; updated test title to include `(incl. reconnect-seed re-render)`
