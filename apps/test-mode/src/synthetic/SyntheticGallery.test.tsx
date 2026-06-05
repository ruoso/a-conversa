// Vitest + RTL cases for the test-mode `<SyntheticGallery>` root view.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications); 0024
//   (react-i18next).
//
// Mocks `fetch` and asserts, per Acceptance §5: the list loading / ready
// (one affordance per scenario under the stable `data-testid`, reading
// `testMode.synthetic.*` keys) / error+retry states; that clicking
// generate POSTs and, on `201`, navigates to `/sessions/:returnedId`
// (asserted via a `MemoryRouter` location probe); and that a generate
// error surfaces a retry affordance.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { createI18nInstance } from '@a-conversa/shell';
import type { SyntheticScenarioDescriptor } from '@a-conversa/shared-types';

import { SyntheticGallery } from './SyntheticGallery';

const SCENARIOS: SyntheticScenarioDescriptor[] = [
  { key: 'empty', title: 'Empty session', description: 'A bare session.' },
  { key: 'structured', title: 'Structured session', description: 'A small worked log.' },
];

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fetchMock(): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function render(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <SyntheticGallery />
                <LocationProbe />
              </>
            }
          />
          <Route path="/sessions/:sessionId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    return Promise.resolve();
  });
  return result;
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SyntheticGallery — list loading', () => {
  it('renders the loading affordance while the scenario list is in flight', async () => {
    fetchMock().mockReturnValue(new Promise<Response>(() => undefined));
    await render();

    expect(screen.getByTestId('test-mode-synthetic-gallery')).toBeTruthy();
    const loading = screen.getByTestId('test-mode-synthetic-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toBe('Loading scenarios…');
  });
});

describe('SyntheticGallery — list ready', () => {
  it('renders one generate affordance per scenario, reading the synthetic chrome keys', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(200, { scenarios: SCENARIOS }));
    await render();

    // The localized chrome.
    expect(screen.getByText('Synthetic sessions')).toBeTruthy();

    // One affordance per scenario, under the stable testid.
    expect(await screen.findByTestId('test-mode-synthetic-scenario-empty')).toBeTruthy();
    expect(screen.getByTestId('test-mode-synthetic-scenario-structured')).toBeTruthy();

    // Localized per-scenario title (from the catalog, keyed by scenario key).
    expect(screen.getByTestId('test-mode-synthetic-scenario-empty').textContent).toContain(
      'Empty session',
    );

    // Generate buttons read the localized label.
    const generateEmpty = screen.getByTestId('test-mode-synthetic-generate-empty');
    expect(generateEmpty.textContent).toBe('Generate');
  });
});

describe('SyntheticGallery — list error + retry', () => {
  it('surfaces the error affordance and retries the fetch on click', async () => {
    const fetchFn = fetchMock();
    fetchFn
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 'internal-error' } }))
      .mockResolvedValueOnce(jsonResponse(200, { scenarios: SCENARIOS }));
    await render();

    const error = await screen.findByTestId('test-mode-synthetic-list-error');
    expect(error.getAttribute('role')).toBe('alert');

    fireEvent.click(screen.getByTestId('test-mode-synthetic-list-retry'));

    expect(await screen.findByTestId('test-mode-synthetic-scenario-empty')).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('SyntheticGallery — generate navigates on 201', () => {
  it('POSTs the chosen scenario and navigates to /sessions/:returnedId', async () => {
    const fetchFn = fetchMock();
    const NEW_ID = '00000000-0000-4000-8000-0000000000aa';
    fetchFn
      .mockResolvedValueOnce(jsonResponse(200, { scenarios: SCENARIOS }))
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: NEW_ID }));
    await render();

    fireEvent.click(await screen.findByTestId('test-mode-synthetic-generate-structured'));

    // Lands on the load route for the returned id. Poll until the
    // navigation settles — the generate POST resolves a microtask after
    // the click, so the `/` location probe is still mounted momentarily.
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(`/sessions/${NEW_ID}`);
    });

    // The POST carried the chosen scenario.
    const postCall = fetchFn.mock.calls.find(
      (call) => call[0] === '/api/test-mode/synthetic-sessions',
    );
    expect(postCall).toBeDefined();
    const init = postCall?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ scenario: 'structured' });
  });
});

describe('SyntheticGallery — generate error', () => {
  it('surfaces a generate-error affordance when the POST fails', async () => {
    const fetchFn = fetchMock();
    fetchFn
      .mockResolvedValueOnce(jsonResponse(200, { scenarios: SCENARIOS }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: 'validation-failed' } }));
    await render();

    fireEvent.click(await screen.findByTestId('test-mode-synthetic-generate-empty'));

    const generateError = await screen.findByTestId('test-mode-synthetic-generate-error-empty');
    expect(generateError.getAttribute('role')).toBe('alert');
    expect(generateError.textContent).toBe("Couldn't generate the session. Try again.");
  });
});
