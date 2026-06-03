// Operate route for `/sessions/:id/operate` — the moderator console.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_capture_pane_wording_only.md
// (prior:     tasks/refinements/moderator-ui/mod_interpretive_split_mode.md,
//             tasks/refinements/moderator-ui/mod_propose_decomposition.md,
//             tasks/refinements/moderator-ui/mod_propose_action.md,
//             tasks/refinements/moderator-ui/mod_edge_role_selector.md,
//             tasks/refinements/moderator-ui/mod_target_auto_suggest.md,
//             tasks/refinements/moderator-ui/mod_classification_palette.md,
//             tasks/refinements/moderator-ui/mod_capture_text_input.md,
//             tasks/refinements/moderator-ui/mod_edge_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md,
//             tasks/refinements/moderator-ui/mod_graph_canvas_pane.md,
//             tasks/refinements/moderator-ui/mod_layout_shell.md,
//             tasks/refinements/moderator-ui/mod_bottom_strip_capture.md,
//             tasks/refinements/moderator-ui/mod_mode_banner.md,
//             tasks/refinements/moderator-ui/mod_right_sidebar.md,
//             tasks/refinements/moderator-ui/mod_decompose_mode.md,
//             tasks/refinements/moderator-ui/mod_multi_component_capture.md)
//
// Composes the three-pane `<OperateLayout>` (`mod_layout_shell`) with
// `<GraphCanvasPane sessionId={id} />` (`mod_graph_canvas_pane` +
// `mod_node_rendering` + `mod_edge_rendering`) wired into the graph
// slot, `<RightSidebar>` (`mod_right_sidebar`) into the right slot, and
// `<BottomStripCapture>` (`mod_bottom_strip_capture`) into the bottom
// strip with `<ModeBanner>` (`mod_mode_banner`) filling the strip's
// `modeBanner` sub-slot, `<CaptureTextInput>` (`mod_capture_text_input`)
// filling the strip's `textInput` sub-slot,
// `<CaptureTargetAndRole>` (`mod_edge_role_selector` — wraps
// `<CaptureTargetChip>` from `mod_target_auto_suggest` alongside
// `<EdgeRoleSelector>`) filling the strip's `edgeRoleSelector`
// sub-slot, and `<ProposeAction>` (`mod_propose_action`) filling the
// strip's `proposeAction` sub-slot. The session id from the route
// param threads into the canvas so the node + edge projection layers
// subscribe to the right per-session slice.
//
// **Per `pf_mod_capture_pane_wording_only`**: the classification
// palette is NOT mounted in the strip's `classificationPalette`
// sub-slot — the capture-pane gesture is wording-only per ADR 0030 §1,
// and classification moves to the per-node card by a downstream task.
// The `<ClassificationPalette>` component stays exported (the node-card
// task uses it inline on a node card).
//
// **WS provider mount + per-route session lifecycle.** This is the
// only WS-driving route in v1 (the `/login`, `/screen-name`,
// `/sessions/new`, `/sessions/:id/lobby` routes make no WS calls).
// Mounting `<WsClientProvider>` here keeps the WS connection scoped
// to the route that needs it. The inner-component split is required
// to read `useWsClient()` from inside the provider's React subtree;
// the `useEffect` calls `client.trackSession(id)` on mount and
// `client.untrackSession(id)` on unmount, paired with the provider's
// connect / close lifecycle (per `mod_propose_action` Decision §3).
//
// The submit gesture on `<CaptureTextInput>` now fires the real
// propose round-trip via `useProposeAction()`'s `propose()` (replacing
// the `noopSubmit` stub that landed before `mod_propose_action`). The
// `<ProposeAction />` button is mounted alongside the textarea —
// both gestures funnel through the same hook.
//
// `route-operate` and `session-id` test ids are preserved so the
// router-level `App.test.tsx` cases continue to pass — `session-id`
// is an `sr-only` span pinned out of the layout flow rather than
// a visible paragraph inside the (former) graph-pane placeholder.

import { useEffect, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '@a-conversa/shell';
import { OperateLayout } from '../layout/OperateLayout';
import { BottomStripCapture } from '../layout/BottomStripCapture';
import { CaptureTargetAndRole } from '../layout/CaptureTargetAndRole';
import { CaptureTextInput } from '../layout/CaptureTextInput';
import { DecomposeComponentsGrid } from '../layout/DecomposeComponentsGrid';
import { DecomposeModeExitButton } from '../layout/DecomposeModeExitButton';
import { InterpretiveSplitModeExitButton } from '../layout/InterpretiveSplitModeExitButton';
import { InterpretiveSplitReadingsGrid } from '../layout/InterpretiveSplitReadingsGrid';
import { OperationalizationCapturePanel } from '../layout/OperationalizationCapturePanel';
import { OperationalizationModeExitButton } from '../layout/OperationalizationModeExitButton';
import { WarrantElicitationCapturePanel } from '../layout/WarrantElicitationCapturePanel';
import { WarrantElicitationModeExitButton } from '../layout/WarrantElicitationModeExitButton';
import { CaptureDefeaterCapturePanel } from '../layout/CaptureDefeaterCapturePanel';
import { CaptureDefeaterModeExitButton } from '../layout/CaptureDefeaterModeExitButton';
import { MetaMoveCapturePanel } from '../layout/MetaMoveCapturePanel';
import { MetaMoveModeExitButton } from '../layout/MetaMoveModeExitButton';
import { MetaMoveProposeAction } from '../layout/MetaMoveProposeAction';
import { ProposeAction } from '../layout/ProposeAction';
import { ProposeCaptureDefeaterAction } from '../layout/ProposeCaptureDefeaterAction';
import { ProposeDecompositionAction } from '../layout/ProposeDecompositionAction';
import { ProposeInterpretiveSplitAction } from '../layout/ProposeInterpretiveSplitAction';
import { useProposeAction } from '../layout/useProposeAction';
import { GraphCanvasPane } from '../graph/GraphCanvasPane';
import { ModeBanner } from '../layout/ModeBanner';
import { IsOughtPrompt } from '../layout/IsOughtPrompt';
import { BlockingDiagnosticBanner } from '../layout/BlockingDiagnosticBanner';
import { ChangeHistoryPane } from '../layout/ChangeHistoryPane';
import { DiagnosticFlagPane } from '../layout/DiagnosticFlagPane';
import { PendingProposalsPane } from '../layout/PendingProposalsPane';
import { RightSidebar } from '../layout/RightSidebar';
import { SnapshotActionButton } from '../layout/SnapshotActionButton';
import { SnapshotLabelInputMount } from '../layout/SnapshotLabelInputMount';
import { useSnapshotFlowStore } from '../layout/useSnapshotFlowStore';
import { useSnapshotShortcut } from '../layout/useSnapshotShortcut';
import { useCaptureStore } from '../stores/captureStore';
import { attachCaptureKeymap } from '../layout/captureKeymap';
import { WsClientProvider, useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';

export function OperateRoute(): ReactElement {
  const auth = useAuth();
  const { id = '' } = useParams<{ id: string }>();
  // The provider is mounted unconditionally; its internal effect is a
  // no-op when `auth.status !== 'authenticated'`. `<RequireAuth
  // mode="authenticated-only">` higher up in `App.tsx` guarantees the
  // precondition in normal flow, but the inert-when-not-authed
  // contract keeps the route robust to test renders that bypass the
  // gate (e.g., `App.test.tsx`'s router-level cases).
  //
  // The moderator's `useWsStore` is passed as the WS client's store so the
  // shell client dispatches inbound envelopes into the moderator-side
  // slice (which extends `BaseWsStoreState` with the moderator-specific
  // `activeDiagnostics` projection). Without this prop the client would
  // write to its own default in-package store and the moderator's
  // `useWsStore` consumers would never see any updates.
  return (
    <WsClientProvider
      auth={{ status: auth.status }}
      clientOptions={{ store: useWsStore }}
      store={useWsStore}
    >
      <OperateRouteInner sessionId={id} />
    </WsClientProvider>
  );
}

/**
 * Inner half of the route — runs INSIDE the `<WsClientProvider>` so
 * `useWsClient()` resolves. Pairs `trackSession(sessionId)` on mount
 * with `untrackSession(sessionId)` on unmount so the server's
 * subscription registry stays clean across navigation.
 *
 * The propose handler comes from `useProposeAction()` and is passed
 * into both `<CaptureTextInput>` (the keyboard path) and is what
 * `<ProposeAction>` triggers internally (the pointer path).
 */
function OperateRouteInner(props: { sessionId: string }): ReactElement {
  const { sessionId } = props;
  const client = useWsClient();
  const { propose } = useProposeAction();
  // F10 snapshot trigger — mount the Cmd/Ctrl+S shortcut once at route
  // scope (Decision §8 of mod_snapshot_action.md keeps the binding
  // alive whenever the moderator is on the operate page) and reflect
  // the trigger flag onto the layout root as a stable Playwright seam.
  useSnapshotShortcut();
  const isSnapshotLabelInputOpen = useSnapshotFlowStore((state) => state.isLabelInputOpen);
  // Read the mode to drive the bottom-strip slot swap. In decompose
  // mode the `textInput` slot mounts `<DecomposeComponentsGrid>`
  // (mod_multi_component_capture) and the `classificationPalette` +
  // `edgeRoleSelector` slots collapse to `null` so the grid can
  // stretch across the strip's body width — Decision §3 of
  // mod_multi_component_capture.md.
  const mode = useCaptureStore((s) => s.mode);
  const isDecomposeMode = mode === 'decompose';
  const isInterpretiveSplitMode = mode === 'interpretive-split';
  // `isProposalMode` collapses both structural-restructure proposals
  // (decompose, interpretive-split) into a single gate for the three
  // slot swaps the two modes share — Decision §5 of
  // mod_interpretive_split_mode.
  const isProposalMode = isDecomposeMode || isInterpretiveSplitMode;
  // Parallel gate for operationalization mode — Decision §D6 of
  // mod_operationalization_mode.md keeps `isProposalMode` semantically
  // tied to the structural-restructure modes (decompose, interpretive
  // split) and adds this sibling gate for the diagnostic-test mode.
  const isOperationalizationMode = mode === 'operationalization';
  // Parallel gate for warrant-elicitation mode — Decision §D2 of
  // mod_warrant_elicitation_mode.md mirrors the operationalization-mode
  // gate verbatim (both are diagnostic-test modes with the unified
  // capture-panel + per-mode exit-button slot-swap shape).
  const isWarrantElicitationMode = mode === 'warrant-elicitation';
  // Parallel gate for capture-defeater mode — introduced by
  // mod_defeater_node_creation.md to mount the F6 capture pane +
  // propose-action into the bottom-strip's `textInput` +
  // `proposeAction` slots when the moderator is composing a defeater.
  const isCaptureDefeaterMode = mode === 'capture-defeater';
  // Parallel gate for meta-move mode — introduced by
  // mod_meta_move_action.md to mount the F8 capture pane +
  // propose-action into the bottom-strip when the moderator is
  // composing a meta-move (Decision §1 — bottom-strip mode-entry).
  const isMetaMoveMode = mode === 'meta-move';

  useEffect(() => {
    if (sessionId === '') return;
    void client.trackSession(sessionId);
    return () => {
      void client.untrackSession(sessionId);
    };
  }, [client, sessionId]);

  // F8 capture-flow entry binding — attach the keymap's
  // `onEnterMetaMove` handler at route scope so F8 anywhere outside an
  // editable target enters meta-move mode (Decision §2 of
  // mod_meta_move_action.md). The handler reads `enterMetaMoveMode`
  // from the store via `getState()` so the closure stays stable across
  // store transitions.
  useEffect(() => {
    return attachCaptureKeymap({
      onEnterMetaMove: () => {
        useCaptureStore.getState().enterMetaMoveMode();
      },
    });
  }, []);

  // Install the `window.__testHooks.killWebSocket` test seam — reached
  // by `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`
  // (Scenario 3 reconnect sub-step) and by future moderator reconnect
  // e2e scenarios (vote-mid-flight, commit-mid-flight, withdraw-then-
  // reconnect). Refinement:
  // `tasks/refinements/moderator-ui/mod_pw_reconnect_seed_visible_styling.md`
  // (Decisions §D3 — install lives in `OperateRouteInner` because
  // `useWsClient()` only resolves here, INSIDE `<WsClientProvider>`).
  //
  // **Not gated on `import.meta.env.DEV`.** Same rationale as the
  // `__aConversaWsStore` exposure at `apps/moderator/src/main.tsx` — the
  // compose stack's production-mode build (used by `make up-prod-mode`
  // and the runtime image's Vite `production` build mode) would tree-
  // shake away a DEV-gated branch, leaving the e2e spec without its
  // entry point.
  //
  // **Not security-sensitive.** The natural reconnect path is what the
  // client already runs on every TCP-level disconnect; the hook just
  // lets a test trigger it deterministically. Per D7, the install lives
  // ONLY on this surface (audience + participant surfaces do not get
  // the hook installed until they have their own reconnect e2e).
  useEffect(() => {
    const w = window as unknown as {
      __testHooks?: { killWebSocket?: () => void };
    };
    const hooks = w.__testHooks ?? {};
    hooks.killWebSocket = (): void => {
      client.killWebSocket();
    };
    w.__testHooks = hooks;
    return () => {
      if (w.__testHooks !== undefined) {
        delete w.__testHooks.killWebSocket;
      }
    };
  }, [client]);

  return (
    // The operate console is a viewport-height flex column: the blocking
    // banner (when present) takes its natural height at the top and the
    // `<OperateLayout>` grid fills the remainder (`flex-1`/`min-h-0`). The
    // grid used to be a hard `h-screen` (100vh); with any in-flow sibling
    // above it — i.e. the banner — that pushed total content past the
    // viewport and tripped the e2e no-scrollbars harness. Bounding the
    // column to `h-screen` + `overflow-hidden` keeps the page scrollbar-free
    // whether or not the banner is showing.
    <main data-testid="route-operate" className="flex h-screen w-screen flex-col overflow-hidden">
      {/*
       * `session-id` survives the placeholder removal — `App.test.tsx`
       * asserts the router captured the path param. Tailwind's
       * `sr-only` utility hides it visually (1px clipped box,
       * `position: absolute`) so it never pushes the
       * `<OperateLayout>` grid off the viewport; still readable to
       * assistive tech and queryable by test id.
       */}
      <span data-testid="session-id" className="sr-only">
        {sessionId}
      </span>
      {/*
       * Sibling BEFORE `<OperateLayout>` so the blocking-diagnostic status
       * indicator sits at the top of the console flow, above the three-pane
       * grid, and is unaffected by the right sidebar's per-pane collapse
       * state (mod_blocking_diagnostic_banner Decision §D1). It self-hides
       * when no blocking diagnostic is active.
       */}
      <BlockingDiagnosticBanner sessionId={sessionId} />
      <OperateLayout
        dataSnapshotFlowOpen={isSnapshotLabelInputOpen}
        graphPane={<GraphCanvasPane sessionId={sessionId} />}
        bottomStrip={
          <BottomStripCapture
            modeBanner={
              <>
                <ModeBanner />
                <IsOughtPrompt />
                <DecomposeModeExitButton />
                <InterpretiveSplitModeExitButton />
                <OperationalizationModeExitButton />
                <WarrantElicitationModeExitButton />
                <CaptureDefeaterModeExitButton />
                <MetaMoveModeExitButton />
              </>
            }
            textInput={
              isWarrantElicitationMode ? (
                <WarrantElicitationCapturePanel />
              ) : isOperationalizationMode ? (
                <OperationalizationCapturePanel />
              ) : isCaptureDefeaterMode ? (
                <CaptureDefeaterCapturePanel />
              ) : isMetaMoveMode ? (
                <MetaMoveCapturePanel />
              ) : isProposalMode ? (
                isInterpretiveSplitMode ? (
                  <InterpretiveSplitReadingsGrid />
                ) : (
                  <DecomposeComponentsGrid mode="decompose" />
                )
              ) : (
                <CaptureTextInput
                  onSubmit={() => {
                    void propose();
                  }}
                />
              )
            }
            // Per `pf_mod_capture_pane_wording_only` (ADR 0030 §1) the
            // classification palette is no longer mounted in the bottom
            // strip — the capture-pane gesture is wording-only, and
            // classification moves to the per-node card by a downstream
            // task. The `classificationPalette` slot intentionally stays
            // absent (the `<BottomStripCapture>` scaffold renders its
            // placeholder when null, which is fine — the slot is
            // structural).
            classificationPalette={null}
            edgeRoleSelector={
              isWarrantElicitationMode ||
              isOperationalizationMode ||
              isCaptureDefeaterMode ||
              isMetaMoveMode ||
              isProposalMode ? null : (
                <CaptureTargetAndRole />
              )
            }
            proposeAction={
              isDecomposeMode ? (
                <ProposeDecompositionAction />
              ) : isInterpretiveSplitMode ? (
                <ProposeInterpretiveSplitAction />
              ) : isCaptureDefeaterMode ? (
                <ProposeCaptureDefeaterAction />
              ) : isMetaMoveMode ? (
                <MetaMoveProposeAction />
              ) : isOperationalizationMode || isWarrantElicitationMode ? null : (
                <ProposeAction />
              )
            }
          />
        }
        rightSidebar={
          <>
            <SnapshotActionButton />
            <RightSidebar
              pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}
              diagnosticFlagsSlot={<DiagnosticFlagPane sessionId={sessionId} />}
              changeHistorySlot={<ChangeHistoryPane sessionId={sessionId} />}
            />
          </>
        }
      />
      {/*
       * Sibling of `<OperateLayout>` so the fixed-position overlay
       * covers the entire layout from `z-50+` without participating in
       * the grid (mod_snapshot_label_input Decision §3).
       */}
      <SnapshotLabelInputMount />
    </main>
  );
}
