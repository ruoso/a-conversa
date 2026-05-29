// Barrel for the shell's diagnostic-highlights subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md

export {
  affectedEntities,
  diagnosticIdentityKey,
  diagnosticSeverityFor,
  edgeHasDiagnostic,
  EMPTY_DIAGNOSTIC_HIGHLIGHTS,
  flattenActiveDiagnosticsForEdgeFire,
  flattenActiveDiagnosticsForFire,
  nodeHasDiagnostic,
  projectDiagnosticHighlights,
  type DiagnosticEdgeFireTuple,
  type DiagnosticFireTuple,
  type DiagnosticHighlight,
  type DiagnosticHighlightIndex,
  type DiagnosticHighlightKind,
  type DiagnosticHighlightSeverity,
  type WireCoherencyHint,
  type WireCoherencyHintDiagnostic,
  type WireContradictionDiagnostic,
  type WireCycleDiagnostic,
  type WireDanglingClaimDiagnostic,
  type WireDiagnostic,
  type WireIncompleteWarrantMissingBridgesFromHint,
  type WireIncompleteWarrantMissingBridgesToHint,
  type WireMultiWarrantDiagnostic,
  type WireSelfContradictsHint,
} from './diagnostic-highlights.js';
