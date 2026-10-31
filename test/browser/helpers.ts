import { expect, type Page } from '@playwright/test';
import type { Box } from './fixture/main';
import type { KoiPondOptions } from '../../src/index';

export const FIXTURE = '/test/browser/fixture/index.html';

/** Opens the fixture page and waits for `window.koiTest`. */
export async function open(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => !!window.koiTest);
}

/**
 * Options a spec can send: JSON only, so no `avoid` (elements; specs call
 * setAvoid inside page.evaluate) and no `onError` (the fixture's).
 */
export type JsonOptions = Omit<KoiPondOptions, 'onError' | 'avoid'>;

/** Mounts a pond and returns its index. */
export function mount(page: Page, box: Box, options: JsonOptions = {}): Promise<number> {
  return page.evaluate(([box, options]) => window.koiTest.mount(box, options), [box, options] as const);
}

export function frames(page: Page, i: number): Promise<number> {
  return page.evaluate((i) => window.koiTest.ponds[i].frames, i);
}

/** Waits until pond `i` is up and has drawn a few frames. */
export async function running(page: Page, i: number, atLeast = 3): Promise<void> {
  await expect.poll(() => frames(page, i), { timeout: 15_000 }).toBeGreaterThanOrEqual(atLeast);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
}

/** Frame count after `ms` minus before: 0 means the loop is stopped. */
export async function framesDuring(page: Page, i: number, ms = 400): Promise<number> {
  const before = await frames(page, i);
  await page.waitForTimeout(ms);
  return (await frames(page, i)) - before;
}
