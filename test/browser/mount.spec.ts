import { expect, test } from '@playwright/test';
import { mount, open, running } from './helpers';

test.beforeEach(({ page }) => open(page));

test('runs on software WebGL2 (SwiftShader)', async ({ page }) => {
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
  await running(page, i);
  const stats = await page.evaluate((i) => {
    const { gpu, software } = window.koiTest.ponds[i].core!.stats;
    return { gpu, software };
  }, i);
  expect(stats.gpu).toMatch(/SwiftShader/i);
  expect(stats.software).toBe(true);
});

test('appends one canvas that fills the container', async ({ page }) => {
  const i = await mount(page, { left: 30, top: 20, width: 400, height: 300 });
  await running(page, i);
  const result = await page.evaluate((i) => {
    const { container } = window.koiTest.ponds[i];
    const canvas = container.firstElementChild as HTMLCanvasElement;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    };
    return {
      children: container.childNodes.length,
      tag: canvas.tagName,
      ariaHidden: canvas.getAttribute('aria-hidden'),
      canvas: rect(canvas),
      container: rect(container),
    };
  }, i);
  expect(result.children).toBe(1);
  expect(result.tag).toBe('CANVAS');
  expect(result.ariaHidden).toBe('true');
  expect(result.canvas).toEqual(result.container);
});

test('leaves html, head, body, the container and window globals alone', async ({ page }) => {
  const snapshot = () =>
    page.evaluate(() => {
      const attrs = (el: Element) => Array.from(el.attributes, (a) => `${a.name}=${a.value}`);
      return {
        html: attrs(document.documentElement),
        head: document.head.innerHTML,
        body: attrs(document.body),
        bodyChildren: Array.from(document.body.children)
          .filter((el) => !el.classList.contains('pond'))
          .map((el) => el.outerHTML),
        window: Object.getOwnPropertyNames(window).sort(),
        document: Object.getOwnPropertyNames(document).sort(),
      };
    });
  const before = await snapshot();
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
  const style = await page.evaluate((i) => window.koiTest.ponds[i].container.getAttribute('style'), i);
  await running(page, i);
  expect(await snapshot()).toEqual(before);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].container.getAttribute('style'), i)).toBe(style);
});
