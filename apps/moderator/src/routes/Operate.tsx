// Operate route for `/sessions/:id/operate` — the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// (prior:     tasks/refinements/moderator-ui/mod_propose_decomposition.md,
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
// `<ClassificationPalette>` (`mod_classification_palette`) filling the
// strip's `classificationPalette` sub-slot,
// `<CaptureTargetAndRole>` (`mod_edge_role_selector` — wraps
// `<CaptureTargetChip>` from `mod_target_auto_suggest` alongside
// `<EdgeRoleSelector>`) filling the strip's `edgeRoleSelector`
// sub-slot, and `<ProposeAction>` (`mod_propose_action`) filling the
// strip's `proposeAction` sub-slot. The session id from the route
// param threads into the canvas so the node + edge projection layers
// subscribe to the right per-session slice.
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
import { ClassificationPalette } from '../layout/ClassificationPalette';
import { DecomposeComponentsGrid } from '../layout/DecomposeComponentsGrid';
import { DecomposeModeExitButton } from '../layout/DecomposeModeExitButton';
import { InterpretiveSplitModeExitButton } from '../layout/InterpretiveSplitModeExitButton';
import { InterpretiveSplitReadingsGrid } from '../layout/InterpretiveSplitReadingsGrid';
import { ProposeAction } from '../layout/ProposeAction';
import { ProposeDecompositionAction } from '../layout/ProposeDecompositionAction';
import { ProposeInterpretiveSplitAction } from '../layout/ProposeInterpretiveSplitAction';
import { useProposeAction } from '../layout/useProposeAction';
import { GraphCanvasPane } from '../graph/GraphCanvasPane';
import { ModeBanner } from '../layout/ModeBanner';
import { IsOughtPrompt } from '../layout/IsOughtPrompt';
import { DiagnosticSuggestionsPanel } from '../layout/DiagnosticSuggestionsPanel';
import { PendingProposalsPane } from '../layout/PendingProposalsPane';
import { RightSidebar } from '../layout/RightSidebar';
import { useCaptureStore } from '../stores/captureStore';
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

  useEffect(() => {
    if (sessionId === '') return;
    void client.trackSession(sessionId);
    return () => {
      void client.untrackSession(sessionId);
    };
  }, [client, sessionId]);

  return (
    <main data-testid="route-operate">
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
      <OperateLayout
        graphPane={<GraphCanvasPane sessionId={sessionId} />}
        bottomStrip={
          <BottomStripCapture
            modeBanner={
              <>
                <ModeBanner />
                <IsOughtPrompt />
                <DecomposeModeExitButton />
                <InterpretiveSplitModeExitButton />
              </>
            }
            textInput={
              isProposalMode ? (
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
            classificationPalette={isProposalMode ? null : <ClassificationPalette />}
            edgeRoleSelector={isProposalMode ? null : <CaptureTargetAndRole />}
            proposeAction={
              isDecomposeMode ? (
                <ProposeDecompositionAction />
              ) : isInterpretiveSplitMode ? (
                <ProposeInterpretiveSplitAction />
              ) : (
                <ProposeAction />
              )
            }
          />
        }
        rightSidebar={
          <RightSidebar
            pendingProposalsSlot={<PendingProposalsPane sessionId={sessionId} />}
            diagnosticFlagsSlot={<DiagnosticSuggestionsPanel sessionId={sessionId} />}
          />
        }
      />
    </main>
  );
}
