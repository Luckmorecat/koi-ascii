import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';

test.beforeEach(({ page }) => open(page));

function rendererStats(page: Page, i: number) {
  return page.evaluate((i) => {
    const { gpu, software } = window.koiTest.ponds[i].core!.stats;
    return { gpu, software };
  }, i);
}

test('runs on the hardware GPU', async ({ page }) => {
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
  await running(page, i);
  const stats = await rendererStats(page, i);
  expect(stats.gpu).not.toMatch(/SwiftShader|llvmpipe|softpipe|Software/i);
  expect(stats.software).toBe(false);
});

// The software path still renders on the GPU: only the reported renderer is spoofed.
test('takes the software path when the renderer reports SwiftShader', async ({ page }) => {
  await page.addInitScript(() => {
    const get = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, p: GLenum) {
      return p === 0x9246 ? 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' : get.call(this, p);
    };
  });
  await open(page);
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 });
  await running(page, i);
  expect((await rendererStats(page, i)).software).toBe(true);
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
