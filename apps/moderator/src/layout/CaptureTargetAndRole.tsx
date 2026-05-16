// `<CaptureTargetAndRole>` — small two-surface composer that fills the
// `bottom-strip-edge-role` sub-slot of `<BottomStripCapture>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//   (also:    tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//             Decision §8 — pre-authorised the slot-sharing composition
//             this wrapper realises.)
//
// The bottom-strip scaffold (`mod_bottom_strip_capture`) exposes a
// single `edgeRoleSelector` render-prop slot keyed to the stable
// `bottom-strip-edge-role` testid. The capture-target chip
// (`mod_target_auto_suggest`) originally filled the slot directly;
// this wrapper composes the chip alongside `<EdgeRoleSelector>` so
// both surfaces share the same slot. The wrapper is a single
// responsibility: it owns the two-surface layout (Tailwind
// `flex items-center gap-2`) inside the shared slot. Both children
// are self-contained — the chip and the selector each read their
// own slices from `useCaptureStore` and write back through their own
// setters; the wrapper carries no state and forwards no props.

import type { ReactElement } from 'react';

import { CaptureTargetChip } from './CaptureTargetChip';
import { EdgeRoleSelector } from './EdgeRoleSelector';

export function CaptureTargetAndRole(): ReactElement {
  return (
    <div data-testid="capture-target-and-role" className="flex items-center gap-2">
      <CaptureTargetChip />
      <EdgeRoleSelector />
    </div>
  );
}
