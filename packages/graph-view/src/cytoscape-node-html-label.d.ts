// Hand-written declarations for `cytoscape-node-html-label` (the package
// ships no types). The plugin registers a `nodeHtmlLabel` core method that
// renders an HTML string (from `tpl(data)`) positioned over each matching
// node, tracking pan/zoom via Cytoscape events. Used by the per-node HTML
// rendering (`per_facet_step_pill`; ADR 0004 2026-06-06 amendment).

declare module 'cytoscape-node-html-label' {
  import type { Ext } from 'cytoscape';

  /** One label spec passed to `cy.nodeHtmlLabel([...])`. */
  export interface NodeHtmlLabelOptions {
    /** Cytoscape selector for the nodes this label applies to. */
    readonly query?: string;
    readonly halign?: 'left' | 'center' | 'right';
    readonly valign?: 'top' | 'center' | 'bottom';
    readonly halignBox?: 'left' | 'center' | 'right';
    readonly valignBox?: 'top' | 'center' | 'bottom';
    readonly cssClass?: string | null;
    /** Returns the HTML string for a node, given its `data`. */
    readonly tpl?: (data: Record<string, unknown>) => string;
  }

  /** The `nodeHtmlLabel` core method the plugin registers. The `Core`
   *  interface is NOT augmented here (augmenting it from this module
   *  shadows `@types/cytoscape`'s `Core` and loses its methods); the one
   *  call site in `GraphView` casts `cy` to this shape instead. */
  export type NodeHtmlLabelFn = (
    options: ReadonlyArray<NodeHtmlLabelOptions>,
    params?: { readonly enablePointerEvents?: boolean },
  ) => void;

  /** The default export is a Cytoscape extension registrar (`cytoscape.use(...)`). */
  const nodeHtmlLabel: Ext;
  export default nodeHtmlLabel;
}
