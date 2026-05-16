// Tests for `<RightSidebar>` — the moderator's stacked sub-pane scaffold.
//
// Refinement: tasks/refinements/moderator-ui/mod_right_sidebar.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The three stable sub-pane regions render with their `data-testid`
//      IDs and the container stack id.
//   2. Each slot prop lands in the matching pane body region; downstream
//      tasks (pending-proposals / diagnostic-flags / change-history) can
//      rely on the slot mapping.
//   3. The empty-state placeholder renders when a slot is omitted so the
//      stack is visible during the build-out phase.
//   4. Each header is an `aria-expanded` toggle button; clicking it
//      collapses / expands only its own body.
//   5. Clicking a header foregrounds that pane in `uiStore`
//      (`setActiveSidebarPane`) and surfaces the highlight class on the
//      matching header.
//   6. Accessibility wiring: every pane is a `<section role="region">`
//      with `aria-labelledby` pointing at its header; every header is a
//      `<button aria-controls={bodyId}>`; the toggle button has a
//      localized `aria-label` that depends on expand state.
//   7. The pane title and placeholder copy come from the catalog — a
//      round-trip across the three v1 locales (en-US / pt-BR / es-419)
//      asserts each title key resolves non-empty and is locale-distinct.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { RightSidebar } from './RightSidebar';
import { useUiStore } from '../stores/uiStore';
import { createI18nInstance } from '@a-conversa/shell';

beforeEach(async () => {
  // Reset the active pane to the store's documented default so each
  // test starts from the same active-pane baseline.
  useUiStore.setState({ activeSidebarPane: 'pending-proposals' });
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('RightSidebar — stacked sub-pane scaffold', () => {
  it('renders the container and three pane regions with stable test ids', () => {
    render(<RightSidebar />);
    expect(screen.getByTestId('operate-right-sidebar-stack')).toBeTruthy();
    expect(screen.getByTestId('right-sidebar-pane-pending-proposals')).toBeTruthy();
    expect(screen.getByTestId('right-sidebar-pane-diagnostic-flags')).toBeTruthy();
    expect(screen.getByTestId('right-sidebar-pane-change-history')).toBeTruthy();
  });

  it('renders each pane title from the i18n catalog', () => {
    render(<RightSidebar />);
    expect(screen.getByTestId('right-sidebar-pane-title-pending-proposals').textContent).toBe(
      'Pending proposals',
    );
    expect(screen.getByTestId('right-sidebar-pane-title-diagnostic-flags').textContent).toBe(
      'Diagnostic flags',
    );
    expect(screen.getByTestId('right-sidebar-pane-title-change-history').textContent).toBe(
      'Change history',
    );
  });

  it('renders the empty-state placeholder when no slot is provided', () => {
    render(<RightSidebar />);
    for (const key of ['pending-proposals', 'diagnostic-flags', 'change-history']) {
      const placeholder = screen.getByTestId(`right-sidebar-pane-placeholder-${key}`);
      expect(placeholder.textContent).toBe('Coming soon');
    }
  });

  it('routes the pendingProposalsSlot into the pending-proposals pane body', () => {
    render(<RightSidebar pendingProposalsSlot={<span data-testid="pp-child">PP-CONTENT</span>} />);
    const body = screen.getByTestId('right-sidebar-pane-body-pending-proposals');
    const child = screen.getByTestId('pp-child');
    expect(body.contains(child)).toBe(true);
    // The placeholder for the filled slot must NOT render alongside the
    // real content.
    expect(screen.queryByTestId('right-sidebar-pane-placeholder-pending-proposals')).toBeNull();
  });

  it('routes the diagnosticFlagsSlot into the diagnostic-flags pane body', () => {
    render(<RightSidebar diagnosticFlagsSlot={<span data-testid="df-child">DF-CONTENT</span>} />);
    const body = screen.getByTestId('right-sidebar-pane-body-diagnostic-flags');
    const child = screen.getByTestId('df-child');
    expect(body.contains(child)).toBe(true);
    expect(screen.queryByTestId('right-sidebar-pane-placeholder-diagnostic-flags')).toBeNull();
  });

  it('routes the changeHistorySlot into the change-history pane body', () => {
    render(<RightSidebar changeHistorySlot={<span data-testid="ch-child">CH-CONTENT</span>} />);
    const body = screen.getByTestId('right-sidebar-pane-body-change-history');
    const child = screen.getByTestId('ch-child');
    expect(body.contains(child)).toBe(true);
    expect(screen.queryByTestId('right-sidebar-pane-placeholder-change-history')).toBeNull();
  });

  it('starts with every pane expanded (aria-expanded=true, body rendered)', () => {
    render(<RightSidebar />);
    for (const key of ['pending-proposals', 'diagnostic-flags', 'change-history']) {
      const header = screen.getByTestId(`right-sidebar-pane-header-${key}`);
      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId(`right-sidebar-pane-body-${key}`)).toBeTruthy();
    }
  });

  it('toggling a header collapses ONLY that pane', () => {
    render(<RightSidebar />);
    const header = screen.getByTestId('right-sidebar-pane-header-diagnostic-flags');
    act(() => {
      fireEvent.click(header);
    });
    // The clicked pane collapses.
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('right-sidebar-pane-body-diagnostic-flags')).toBeNull();
    // The other panes remain expanded.
    expect(
      screen
        .getByTestId('right-sidebar-pane-header-pending-proposals')
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByTestId('right-sidebar-pane-body-pending-proposals')).toBeTruthy();
    expect(
      screen.getByTestId('right-sidebar-pane-header-change-history').getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByTestId('right-sidebar-pane-body-change-history')).toBeTruthy();
    // Toggle again re-expands.
    act(() => {
      fireEvent.click(header);
    });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('right-sidebar-pane-body-diagnostic-flags')).toBeTruthy();
  });

  it('clicking a header sets that pane as active in uiStore', () => {
    render(<RightSidebar />);
    // Default is `pending-proposals` per the store's initial state.
    expect(useUiStore.getState().activeSidebarPane).toBe('pending-proposals');
    act(() => {
      fireEvent.click(screen.getByTestId('right-sidebar-pane-header-change-history'));
    });
    expect(useUiStore.getState().activeSidebarPane).toBe('change-history');
    act(() => {
      fireEvent.click(screen.getByTestId('right-sidebar-pane-header-diagnostic-flags'));
    });
    expect(useUiStore.getState().activeSidebarPane).toBe('diagnostic-flags');
  });

  it('highlights the active pane header with bg-slate-200 (vs bg-slate-100 inactive)', () => {
    render(<RightSidebar />);
    // pending-proposals is active by default.
    const ppHeader = screen.getByTestId('right-sidebar-pane-header-pending-proposals');
    const dfHeader = screen.getByTestId('right-sidebar-pane-header-diagnostic-flags');
    expect(ppHeader.className.split(/\s+/)).toContain('bg-slate-200');
    expect(dfHeader.className.split(/\s+/)).toContain('bg-slate-100');
    // Click diagnostic-flags → it becomes active, pending-proposals
    // drops back to inactive.
    act(() => {
      fireEvent.click(dfHeader);
    });
    expect(dfHeader.className.split(/\s+/)).toContain('bg-slate-200');
    expect(ppHeader.className.split(/\s+/)).toContain('bg-slate-100');
  });

  it('sets data-active="true" on the active pane region and "false" on inactive ones', () => {
    render(<RightSidebar />);
    const ppSection = screen.getByTestId('right-sidebar-pane-pending-proposals');
    const dfSection = screen.getByTestId('right-sidebar-pane-diagnostic-flags');
    const chSection = screen.getByTestId('right-sidebar-pane-change-history');
    expect(ppSection.getAttribute('data-active')).toBe('true');
    expect(dfSection.getAttribute('data-active')).toBe('false');
    expect(chSection.getAttribute('data-active')).toBe('false');
  });

  it('marks each pane as a `<section role="region">` with aria-labelledby pointing at its header', () => {
    render(<RightSidebar />);
    for (const key of ['pending-proposals', 'diagnostic-flags', 'change-history']) {
      const section = screen.getByTestId(`right-sidebar-pane-${key}`);
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('role')).toBe('region');
      const headerId = section.getAttribute('aria-labelledby');
      expect(headerId).toBeTruthy();
      const header = screen.getByTestId(`right-sidebar-pane-header-${key}`);
      expect(header.id).toBe(headerId);
    }
  });

  it('wires aria-controls on every header to the body element id', () => {
    render(<RightSidebar />);
    for (const key of ['pending-proposals', 'diagnostic-flags', 'change-history']) {
      const header = screen.getByTestId(`right-sidebar-pane-header-${key}`);
      const controlsId = header.getAttribute('aria-controls');
      expect(controlsId).toBeTruthy();
      const body = screen.getByTestId(`right-sidebar-pane-body-${key}`);
      expect(body.id).toBe(controlsId);
    }
  });

  it('localizes the toggle aria-label by expand state (Collapse pane / Expand pane)', () => {
    render(<RightSidebar />);
    const header = screen.getByTestId('right-sidebar-pane-header-change-history');
    // Expanded → "Collapse pane" (the action available when expanded).
    expect(header.getAttribute('aria-label')).toBe('Collapse pane');
    act(() => {
      fireEvent.click(header);
    });
    expect(header.getAttribute('aria-label')).toBe('Expand pane');
  });
});

describe('RightSidebar — i18n catalog parity', () => {
  // The acceptance criterion: every new `moderator.rightSidebar.*` key
  // resolves to a non-empty string in every v1 locale, and the
  // non-en-US value differs from en-US (a sanity check that we actually
  // translated, not just copied).
  const KEYS = [
    'moderator.rightSidebar.emptyPanePlaceholder',
    'moderator.rightSidebar.panes.pendingProposals.title',
    'moderator.rightSidebar.panes.diagnosticFlags.title',
    'moderator.rightSidebar.panes.changeHistory.title',
  ];
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('non-en-US locales differ from en-US for each title (translation, not copy)', async () => {
    await i18next.changeLanguage('en-US');
    const enValues = KEYS.map((k) => i18next.t(k));
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (let i = 0; i < KEYS.length; i++) {
        const v = i18next.t(KEYS[i] as string);
        expect(v, `${locale}::${KEYS[i] as string} should differ from en-US`).not.toBe(enValues[i]);
      }
    }
    await i18next.changeLanguage('en-US');
  });

  it('resolves the toggleAria ICU key to the matching string for each expanded value', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: true })).toBe(
      'Collapse pane',
    );
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: false })).toBe('Expand pane');
    await i18next.changeLanguage('pt-BR');
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: true })).toBe(
      'Recolher painel',
    );
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: false })).toBe(
      'Expandir painel',
    );
    await i18next.changeLanguage('es-419');
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: true })).toBe(
      'Contraer panel',
    );
    expect(i18next.t('moderator.rightSidebar.toggleAria', { expanded: false })).toBe(
      'Expandir panel',
    );
    await i18next.changeLanguage('en-US');
  });
});
