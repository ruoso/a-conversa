// `<GraphContextMenu>` — small fixed-position menu rendered at a cursor
// location when the moderator right-clicks a node, an edge, or the empty
// pane on the graph canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_context_menus.md
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// `<GraphCanvasPane>` opens this menu in response to ReactFlow's
// `onNodeContextMenu` / `onEdgeContextMenu` / `onPaneContextMenu`
// callbacks. The menu doesn't know what got right-clicked — it receives
// a pre-built `items` array whose `onSelect` callbacks already close over
// the target. That keeps the component a thin presentation layer: it
// renders, it closes on outside-click or Escape, and that's all.
//
// **Action stubs.** Each `MenuItem.onSelect` is a stub today — the
// downstream capture / proposal flows (`mod_capture_flow.*`,
// `mod_propose_*`, `mod_axiom_*`) replace each stub with the real action
// handler. The menu shell intentionally doesn't carry per-action
// behavior; doing so would couple this task to the unfinished downstream
// flows. The stub mechanism is documented in the refinement under
// "Decisions."

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * One menu entry. `id` is the per-menu identifier (used for the
 * `data-testid` and the React key); `labelKey` resolves through
 * `useTranslation` to the localized label; `onSelect` is the action
 * the moderator picked — fired before the menu closes.
 *
 * Optional `disabled` (`mod_operationalization_mode`) renders the
 * button as `disabled` + `aria-disabled="true"`, kept in the menu's
 * tab order so the moderator learns the option exists even when its
 * methodology gate is not currently satisfied. The selection path
 * skips `onSelect` when the item is disabled (defensive — the
 * underlying `<button disabled>` already blocks click events; the
 * guard pins the contract for tests).
 */
export interface MenuItem {
  /** Stable per-menu identifier — used for `data-testid` and `key`. */
  readonly id: string;
  /** i18n key under the `moderator.contextMenu.*` namespace. */
  readonly labelKey: string;
  /** Action handler — fired when the moderator selects this item. */
  readonly onSelect: () => void;
  /**
   * Methodology / availability gate. When `true` the rendered button
   * is `disabled` + `aria-disabled="true"` and the click path skips
   * `onSelect`. Optional and defaults to `false`.
   */
  readonly disabled?: boolean;
}

export interface GraphContextMenuProps {
  /** Cursor x-coordinate where the menu opens (client coordinates). */
  readonly x: number;
  /** Cursor y-coordinate where the menu opens (client coordinates). */
  readonly y: number;
  /** What got right-clicked. Stamped on the menu root for tests. */
  readonly targetKind: 'node' | 'edge' | 'pane';
  /**
   * The id of the right-clicked entity, or `null` when the menu was
   * opened from a pane right-click (no target entity).
   */
  readonly targetId: string | null;
  /** The action items to render (in order). */
  readonly items: readonly MenuItem[];
  /**
   * Close handler — fired on outside-click, Escape, or after a menu
   * item is selected. `<GraphCanvasPane>` flips its menu state to
   * `null` in response.
   */
  readonly onClose: () => void;
}

export function GraphContextMenu(props: GraphContextMenuProps): ReactElement {
  const { x, y, targetKind, targetId, items, onClose } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLUListElement | null>(null);

  // Click-outside: window-level mousedown with a `contains()` check on
  // the menu root. Window-level (not document or React listener) so the
  // menu also closes when the user mousedowns inside another React
  // portal (e.g. the right sidebar) — the moderator's expectation is
  // "click anywhere outside the menu and it goes away." Composes with
  // ReactFlow's pan-start listener: mousedown starts the pan AND
  // closes the menu, which is the desired behavior.
  //
  // Escape: same handler module, so both close-paths share the cleanup.
  useEffect(() => {
    function handleMouseDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <ul
      ref={rootRef}
      role="menu"
      data-testid="graph-context-menu"
      data-target-kind={targetKind}
      data-target-id={targetId ?? ''}
      style={{ position: 'fixed', top: y, left: x, zIndex: 50 }}
      className="min-w-[12rem] rounded-md border border-slate-200 bg-white py-1 shadow-md"
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            data-testid={`graph-context-menu-item-${item.id}`}
            disabled={item.disabled ?? false}
            aria-disabled={item.disabled ?? false}
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
            onClick={() => {
              if (item.disabled === true) {
                return;
              }
              item.onSelect();
              onClose();
            }}
          >
            {t(item.labelKey)}
          </button>
        </li>
      ))}
    </ul>
  );
}
