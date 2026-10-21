import { expect, test, type Page } from '@playwright/test';
import { framesDuring, mount, open, running } from './helpers';

test.beforeEach(({ page }) => open(page));

const calm = (page: Page, i: number) => page.evaluate((i) => window.koiTest.ponds[i].core!.pond.calm, i);

test.describe('reduced motion', () => {
  test('is off by default', async ({ page }) => {
    const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
    await running(page, i);
    expect(await calm(page, i)).toBe(false);
  });

  test('puts the pond in calm mode, live', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
    await running(page, i);
    expect(await calm(page, i)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => calm(page, i)).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => calm(page, i)).toBe(true);
  });
});

test('survives WebGL context loss and restore', async ({ page }) => {
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
  await running(page, i);
  await page.evaluate((i) => {
    const ext = window.koiTest.ponds[i].core!.gl.getExtension('WEBGL_lose_context')!;
    Object.assign(window, { koiLoseContext: ext });
    ext.loseContext();
  }, i);
  const hasRenderer = () => page.evaluate((i) => window.koiTest.ponds[i].core!.renderer !== null, i);
  await expect.poll(hasRenderer).toBe(false);
  expect(await framesDuring(page, i)).toBe(0);

  await page.evaluate(() => (window as unknown as { koiLoseContext: WEBGL_lose_context }).koiLoseContext.restoreContext());
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].restored, i)).toBe(1);
  expect(await hasRenderer()).toBe(true);
  expect(await framesDuring(page, i)).toBeGreaterThan(0);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
});

test.describe('device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sizes a 400×300 CSS pond to an 800×600 backing store', async ({ page }) => {
    const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
    await running(page, i);
    const size = () =>
      page.evaluate((i) => {
        const canvas = window.koiTest.ponds[i].container.firstElementChild as HTMLCanvasElement;
        return [canvas.width, canvas.height, window.devicePixelRatio];
      }, i);
    await expect.poll(size).toEqual([800, 600, 2]);
  });
});
