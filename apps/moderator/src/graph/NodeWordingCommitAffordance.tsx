// `<NodeWordingCommitAffordance>` — per-node inline commit affordance for
// the `wording` facet, mounted on `<StatementNode>`.
//
// Sibling:    apps/moderator/src/graph/EdgeShapeCommitAffordance.tsx
//             (the per-edge inline commit affordance for the `shape`
//             facet — same pattern, different facet/entity_kind).
//
// **Visibility gate.** Mounted by `<StatementNode>` ONLY when the
// node's wording facet is `'agreed'`. Once the moderator commits the
// facet (wording → `'committed'`), this affordance unmounts and
// `<NodeCardClassificationPalette>` takes over.
//
// **One button.** Single action — "land the agreed wording facet" —
// no value to pick (the agreed wording is the candidate).
//
// **Dispatch.** A click fires `useCommitAction({ entity_kind: 'node',
// entity_id, facet: 'wording' })` — the wire envelope is
// `commit { target: 'facet', entity_kind: 'node', entity_id, facet:
// 'wording' }` per ADR 0030 §2 + the `wsCommitPayloadSchema`
// discriminated union.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommitAction, type WireError } from '../layout/useCommitAction.js';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-800 hover:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface NodeWordingCommitAffordanceProps {
  /** The node id this affordance mounts on; the commit envelope's `entity_id`. */
  readonly nodeId: string;
}

export function NodeWordingCommitAffordance(props: NodeWordingCommitAffordanceProps): ReactElement {
  const { nodeId } = props;
  const { t } = useTranslation();
  const { commit, inFlight, lastError } = useCommitAction({
    entity_kind: 'node',
    entity_id: nodeId,
    facet: 'wording',
  });

  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // `onNodeClick` — the affordance is mounted INSIDE the node card.
    event.stopPropagation();
    void commitRef.current();
  }

  const label = inFlight
    ? t('moderator.commitButton.inFlightLabel')
    : t('moderator.commitButton.label');
  const ariaLabel = t('moderator.commitButton.ariaLabel');
  const commitState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';

  return (
    <div
      data-testid={`node-wording-commit-affordance-${nodeId}`}
      data-node-id={nodeId}
      className="mt-1 flex w-full flex-col gap-1"
    >
      <button
        type="button"
        data-testid={`node-wording-commit-affordance-button-${nodeId}`}
        data-node-id={nodeId}
        data-commit-state={commitState}
        aria-label={ariaLabel}
        disabled={inFlight}
        onClick={handleClick}
        className={BUTTON_CLASSES}
      >
        {label}
      </button>
      {lastError !== undefined ? (
        <NodeWordingCommitErrorRegion nodeId={nodeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface NodeWordingCommitErrorRegionProps {
  readonly nodeId: string;
  readonly error: WireError;
}

function NodeWordingCommitErrorRegion(props: NodeWordingCommitErrorRegionProps): ReactElement {
  const { nodeId, error } = props;
  return (
    <p
      data-testid={`node-wording-commit-affordance-error-${nodeId}`}
      data-error-code={error.code}
      role="alert"
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
