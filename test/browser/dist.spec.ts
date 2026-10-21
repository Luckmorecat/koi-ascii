import { expect, test } from '@playwright/test';
import { open } from './helpers';

// The published file, as `npm run build` writes it (playwright.config.ts
// builds before starting the server).
test('the built dist/index.js mounts a running pond', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(async () => {
    const url = '/dist/index.js';
    const lib = (await import(/* @vite-ignore */ url)) as typeof import('../../src/index');
    const container = window.koiTest.container({ left: 0, top: 0, width: 400, height: 300 });
    const failures: string[] = [];
    lib.createKoiPond(container, { seed: 1, onError: (e) => failures.push(e.code) });
    Object.assign(window, { distPond: { container, failures } });
  });
  const state = () =>
    page.evaluate(() => {
      const { container, failures } = (window as unknown as { distPond: { container: HTMLElement; failures: string[] } })
        .distPond;
      const canvas = container.firstElementChild as HTMLCanvasElement | null;
      const gl = canvas?.getContext('webgl2');
      return {
        children: container.childNodes.length,
        tag: canvas?.tagName,
        // The backing store is sized on the first frame.
        size: [canvas?.width, canvas?.height],
        context: !!gl && !gl.isContextLost(),
        failures,
      };
    });
  await expect.poll(state, { timeout: 15_000 }).toEqual({
    children: 1,
    tag: 'CANVAS',
    size: [400, 300],
    context: true,
    failures: [],
  });
  expect(errors).toEqual([]);
});
