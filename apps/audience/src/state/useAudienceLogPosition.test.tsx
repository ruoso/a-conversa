// Vitest React-harness cases for `useAudienceLogPosition`.
//
// Refinement: tasks/refinements/audience/aud_url_position_param.md
//   (Acceptance criteria §2 — five cases pinned: bare path, locale
//   prefix, no query, invalid value, navigation re-render; §4 — barrel
//   re-export confirmed by importing the hook through `./index.js`.)
// ADRs:        0022 (no throwaway verifications).

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { useAudienceLogPosition } from './useAudienceLogPosition.js';
import { useAudienceLogPosition as useAudienceLogPositionFromBarrel } from './index.js';

const UUID = '00000000-0000-4000-8000-000000000099';

function PositionProbe(): ReactElement {
  const position = useAudienceLogPosition();
  return createElement(
    'span',
    { 'data-testid': 'probe-audience-log-position' },
    position === null ? '__null__' : String(position),
  );
}

function renderAt(initialPath: string): void {
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [initialPath] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/sessions/:sessionId',
          element: createElement(PositionProbe),
        }),
        createElement(Route, {
          path: '/:locale/sessions/:sessionId',
          element: createElement(PositionProbe),
        }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe('useAudienceLogPosition', () => {
  it('(a) returns the parsed integer for `/sessions/<uuid>?position=42`', () => {
    renderAt(`/sessions/${UUID}?position=42`);
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('42');
  });

  it('(b) returns the parsed integer under the locale-prefixed shape `/en-US/sessions/<uuid>?position=42`', () => {
    renderAt(`/en-US/sessions/${UUID}?position=42`);
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('42');
  });

  it('(c) returns null when the query string is absent', () => {
    renderAt(`/sessions/${UUID}`);
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('__null__');
  });

  it('(d) returns null for an invalid value `?position=abc`', () => {
    renderAt(`/sessions/${UUID}?position=abc`);
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('__null__');
  });

  it('(e) re-renders with the new value when the URL changes from `?position=42` to `?position=43`', () => {
    function Navigator(): ReactElement {
      const navigate = useNavigate();
      return createElement(
        'button',
        {
          'data-testid': 'probe-navigate-43',
          type: 'button',
          onClick: () => {
            void navigate(`/sessions/${UUID}?position=43`);
          },
        },
        'go',
      );
    }
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/sessions/${UUID}?position=42`] },
        createElement(Navigator),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/sessions/:sessionId',
            element: createElement(PositionProbe),
          }),
        ),
      ),
    );
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('42');
    act(() => {
      screen.getByTestId('probe-navigate-43').click();
    });
    expect(screen.getByTestId('probe-audience-log-position').textContent).toBe('43');
  });

  it('(f) is re-exported from the state barrel', () => {
    function BarrelProbe(): ReactElement {
      const position = useAudienceLogPositionFromBarrel();
      return createElement(
        'span',
        { 'data-testid': 'probe-barrel-log-position' },
        position === null ? '__null__' : String(position),
      );
    }
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/sessions/${UUID}?position=99`] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/sessions/:sessionId',
            element: createElement(BarrelProbe),
          }),
        ),
      ),
    );
    expect(screen.getByTestId('probe-barrel-log-position').textContent).toBe('99');
  });
});
