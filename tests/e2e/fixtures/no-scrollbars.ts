// Playwright fixture that fails any e2e test if a DOM element is
// presenting a visible scrollbar by default.
//
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//
// **Why.** The product's surfaces should fit their viewport without
// forcing the user to scroll. A scrollbar that appears unexpectedly is
// a layout regression — the kind of thing Vitest snapshots and unit
// tests will not see because they don't lay out a real viewport. The
// fixture wraps every e2e spec with an auto-running afterEach that
// asks the browser which elements are currently presenting a scroll
// affordance and fails the test if any do.
//
// **Opt-out: `data-allow-scroll`.** Some elements legitimately scroll
// (a chat transcript, a long autocomplete dropdown, a code preview).
// Adding `data-allow-scroll` on the element — or any ancestor — marks
// the subtree as a known-scrollable region and excludes it from the
// probe. The attribute value is ignored; presence is enough.
//
// **Usage.** Replace
//
//   import { test, expect } from '@playwright/test';
//
// with
//
//   import { test, expect } from './fixtures/no-scrollbars';
//
// (adjust the relative path for the spec's location). Nothing else
// changes — the auto fixture runs after every test body without the
// spec mentioning it.
//
// **What counts as a scrollbar.** For each visible element we ask the
// browser for its computed `overflow-x` / `overflow-y` and its
// `scrollWidth` / `scrollHeight` vs `clientWidth` / `clientHeight`. A
// bar is present on an axis when:
//
//   - the computed overflow on that axis is `scroll` (the browser
//     paints the track even without overflow), OR
//   - the computed overflow is `auto` AND content actually overflows
//     by more than 1 px (tolerance covers fractional-pixel artefacts).
//
// `<html>` and `<body>` get a special case: their default computed
// overflow is `visible`, but the viewport still scrolls when content
// overflows. The probe treats them as scrollable when content
// overflows and the overflow on that axis is not `hidden`.

import {
  test as base,
  expect,
  type TestType,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
} from '@playwright/test';

// Re-export the commonly-used Playwright types so specs can swap a
// single `from '@playwright/test'` import for this module without
// splitting type-only imports into a second line. The named exports
// `Page` and `Locator` below are referenced inside this file too.
export type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
} from '@playwright/test';

import type { Page as PageType, Locator as LocatorType } from '@playwright/test';

/** A snapshot of one element the probe judged to be presenting a scrollbar. */
export interface ScrollableElement {
  /** A human-readable selector-ish description (tag + id + testid + classes). */
  readonly selector: string;
  /** The lowercased tag name. */
  readonly tag: string;
  /** Which axes are presenting a bar — `'x'`, `'y'`, or both. */
  readonly axes: readonly ('x' | 'y')[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly overflowX: string;
  readonly overflowY: string;
}

/**
 * Walk the page's DOM and return every element that is currently
 * presenting a scrollbar. Elements (or any ancestor) carrying
 * `data-allow-scroll` are skipped.
 *
 * The walk runs entirely inside the page via `page.evaluate(...)` —
 * one round trip, no per-element protocol chatter.
 */
export async function findScrollableElements(page: PageType): Promise<ScrollableElement[]> {
  return page.evaluate(() => {
    // 1 px tolerance: layout engines round to fractional pixels and a
    // pristine layout can report scrollWidth one pixel larger than
    // clientWidth without painting any bar.
    const TOLERANCE = 1;

    function describe(el: Element): string {
      if (el === document.documentElement) return '<html>';
      if (el === document.body) return '<body>';
      const html = el as HTMLElement;
      let sel = el.tagName.toLowerCase();
      if (html.id) sel += `#${html.id}`;
      const testid = html.dataset.testid;
      if (testid !== undefined) sel += `[data-testid="${testid}"]`;
      if (typeof html.className === 'string' && html.className.length > 0) {
        const classes = html.className.split(/\s+/).filter(Boolean);
        if (classes.length > 0) sel += '.' + classes.join('.');
      }
      return sel;
    }

    function hasAllowScrollAncestor(el: Element): boolean {
      let cursor: Element | null = el;
      while (cursor !== null) {
        if (cursor instanceof HTMLElement && cursor.dataset.allowScroll !== undefined) {
          return true;
        }
        cursor = cursor.parentElement;
      }
      return false;
    }

    function isVisible(el: Element): boolean {
      if (el === document.documentElement || el === document.body) return true;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return true;
    }

    const results: Array<{
      selector: string;
      tag: string;
      axes: ('x' | 'y')[];
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
      overflowX: string;
      overflowY: string;
    }> = [];

    const all = document.querySelectorAll<HTMLElement>('*');
    for (const el of Array.from(all)) {
      if (hasAllowScrollAncestor(el)) continue;
      if (!isVisible(el)) continue;

      const style = window.getComputedStyle(el);
      const overflowsX = el.scrollWidth - el.clientWidth > TOLERANCE;
      const overflowsY = el.scrollHeight - el.clientHeight > TOLERANCE;

      const isRoot = el === document.documentElement || el === document.body;

      // `scroll` always paints a track. `auto` paints one only when
      // content actually overflows. `<html>` / `<body>` default to
      // `visible` but the viewport still scrolls when content overflows
      // unless the overflow is `hidden`.
      let xShows = style.overflowX === 'scroll' || (style.overflowX === 'auto' && overflowsX);
      let yShows = style.overflowY === 'scroll' || (style.overflowY === 'auto' && overflowsY);
      if (isRoot) {
        if (overflowsX && style.overflowX !== 'hidden') xShows = true;
        if (overflowsY && style.overflowY !== 'hidden') yShows = true;
      }

      if (!xShows && !yShows) continue;

      const axes: ('x' | 'y')[] = [];
      if (xShows) axes.push('x');
      if (yShows) axes.push('y');

      results.push({
        selector: describe(el),
        tag: el.tagName.toLowerCase(),
        axes,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      });
    }
    return results;
  });
}

/**
 * Assert that the given page has no element presenting a scrollbar.
 * Exposed for specs that want to assert mid-test (after a state
 * change), in addition to the auto fixture's end-of-test sweep.
 */
export async function expectNoScrollbars(page: PageType, locatorHint?: LocatorType): Promise<void> {
  const scrollers = await findScrollableElements(page);
  if (scrollers.length === 0) return;
  const lines = scrollers.map(
    (s) =>
      `  - ${s.selector}` +
      ` (axes=${s.axes.join(',')};` +
      ` overflow=${s.overflowX}/${s.overflowY};` +
      ` scrollWxH=${s.scrollWidth}x${s.scrollHeight};` +
      ` clientWxH=${s.clientWidth}x${s.clientHeight})`,
  );
  const hint =
    locatorHint !== undefined ? `\n(triggered after asserting on ${locatorHint.toString()})` : '';
  throw new Error(
    [
      `expectNoScrollbars: ${scrollers.length} element(s) are presenting a scrollbar.`,
      ...lines,
      '',
      'If an element is legitimately scrollable, add `data-allow-scroll`',
      'to it (or to any ancestor that bounds the scrollable region).',
    ].join('\n') + hint,
  );
}

// The auto fixture. The `_noScrollbarsGuard` fixture is declared as
// `auto: true` so every test that imports `test` from this module
// runs the probe after its body, without the spec mentioning the
// fixture by name.
//
// The probe skips when the test has already failed (the original
// failure should win — we don't want a scrollbar report drowning the
// real diagnostic) and skips when the page never navigated
// (`about:blank`) or was closed.
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & { _noScrollbarsGuard: void },
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = base.extend<{ _noScrollbarsGuard: void }>({
  _noScrollbarsGuard: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status !== 'passed') return;

      let url: string;
      try {
        url = page.url();
      } catch {
        return;
      }
      if (url === '' || url === 'about:blank') return;

      let scrollers: ScrollableElement[];
      try {
        scrollers = await findScrollableElements(page);
      } catch {
        return;
      }
      if (scrollers.length === 0) return;

      const lines = scrollers.map(
        (s) =>
          `  - ${s.selector}` +
          ` (axes=${s.axes.join(',')};` +
          ` overflow=${s.overflowX}/${s.overflowY};` +
          ` scrollWxH=${s.scrollWidth}x${s.scrollHeight};` +
          ` clientWxH=${s.clientWidth}x${s.clientHeight})`,
      );
      throw new Error(
        [
          `Scrollbar harness: ${scrollers.length} element(s) presented a scrollbar at end of test on ${url}.`,
          ...lines,
          '',
          'Add `data-allow-scroll` to any element that is legitimately scrollable',
          '(or to an ancestor that bounds the scrollable region).',
        ].join('\n'),
      );
    },
    { auto: true },
  ],
});

export { expect };
