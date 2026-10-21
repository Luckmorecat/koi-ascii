import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';

test.beforeEach(({ page }) => open(page));

/** The last pond-space point pond `i` received, or null. */
const lastMove = (page: Page, i: number) =>
  page.evaluate((i) => window.koiTest.ponds[i].moves.at(-1) ?? null, i);
const moveCount = (page: Page, i: number) => page.evaluate((i) => window.koiTest.ponds[i].moves.length, i);
const inside = (page: Page, i: number) => page.evaluate((i) => window.koiTest.ponds[i].core!.pond.pointer.inside, i);

async function expectPoint(page: Page, i: number, x: number, y: number): Promise<void> {
  const p = await lastMove(page, i);
  expect(p).not.toBeNull();
  expect(p![0]).toBeCloseTo(x, 0);
  expect(p![1]).toBeCloseTo(y, 0);
}

test.describe('canvas mode', () => {
  test('maps the pointer into the canvas', async ({ page }) => {
    const i = await mount(page, { left: 50, top: 40, width: 400, height: 300 }, { interactive: 'canvas' });
    await running(page, i);
    await page.mouse.move(50 + 120, 40 + 70);
    await expectPoint(page, i, 120, 70);
    expect(await inside(page, i)).toBe(true);
    await page.mouse.move(600, 500);
    expect(await inside(page, i)).toBe(false);
  });

  test('two ponds each map into their own canvas', async ({ page }) => {
    const a = await mount(page, { left: 0, top: 0, width: 300, height: 200 }, { interactive: 'canvas' });
    const b = await mount(page, { left: 350, top: 250, width: 300, height: 200 }, { interactive: 'canvas' });
    await running(page, a);
    await running(page, b);
    await page.mouse.move(350 + 30, 250 + 20);
    await expectPoint(page, b, 30, 20);
    expect(await moveCount(page, a)).toBe(0);
    await page.mouse.move(200, 150);
    await expectPoint(page, a, 200, 150);
    await expectPoint(page, b, 30, 20);
  });
});

test.describe('window mode', () => {
  test('maps the pointer even under covering content', async ({ page }) => {
    const i = await mount(page, { left: 50, top: 40, width: 400, height: 300 }, { interactive: 'window' });
    await running(page, i);
    await page.evaluate(() => {
      const cover = document.createElement('div');
      Object.assign(cover.style, { position: 'fixed', inset: '0', zIndex: '1' });
      cover.addEventListener('pointermove', (e) => e.stopPropagation());
      document.body.append(cover);
    });
    await page.mouse.move(50 + 120, 40 + 70);
    await expectPoint(page, i, 120, 70);
    expect(await inside(page, i)).toBe(true);
    await page.mouse.move(600, 500);
    expect(await inside(page, i)).toBe(false);
  });

  test('maps through page scroll', async ({ page }) => {
    await page.evaluate(() => {
      document.body.style.height = '3000px';
    });
    const i = await mount(page, { left: 50, top: 300, width: 400, height: 300 }, { interactive: 'window' });
    await running(page, i);
    await page.evaluate(() => window.scrollTo(0, 100));
    await page.mouse.move(50 + 120, 300 - 100 + 70);
    await expectPoint(page, i, 120, 70);
    // Scrolling under a still pointer re-maps it.
    await page.evaluate(() => window.scrollTo(0, 150));
    await expect.poll(() => lastMove(page, i)).toEqual([120, 120]);
  });

  test('two ponds each map into their own rect', async ({ page }) => {
    const a = await mount(page, { left: 0, top: 0, width: 300, height: 200 }, { interactive: 'window' });
    const b = await mount(page, { left: 350, top: 250, width: 300, height: 200 }, { interactive: 'window' });
    await running(page, a);
    await running(page, b);
    await page.mouse.move(350 + 30, 250 + 20);
    await expectPoint(page, b, 30, 20);
    expect(await inside(page, b)).toBe(true);
    expect(await moveCount(page, a)).toBe(0);
    expect(await inside(page, a)).toBe(false);
    await page.mouse.move(200, 150);
    await expectPoint(page, a, 200, 150);
    expect(await inside(page, a)).toBe(true);
    expect(await inside(page, b)).toBe(false);
  });
});
