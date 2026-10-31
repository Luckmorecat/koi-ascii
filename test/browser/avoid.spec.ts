import { expect, test, type Page } from '@playwright/test';
import { mount, open, running, type JsonOptions } from './helpers';
import type { Box } from './fixture/main';

// Readability zones (`avoid`, setAvoid, setAvoidFade). Elements can't go
// through the JSON mount options, so each test lists them with setAvoid in
// the page. The pond is paused and every sample redraws the same state
// (manual draws measure zones too, D8), so two samples differ only by the
// zones.

const BOX = { left: 0, top: 0, width: 480, height: 320 };
const NOON = { mode: 'fixed', phase: 0.5 } as const;
/** The element the pond fades under, page px. */
const TEXT: Box = { left: 160, top: 140, width: 160, height: 40 };
/** pad + feather + a cell or two of glyphs and the halo's reach: past this the zone changes nothing. */
const REACH = 12 + 8 + 64;

/** Adds an absolutely placed element at `box` and keeps it as window.koiZone. */
function addElement(page: Page, box: Box): Promise<void> {
  return page.evaluate((box) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    document.body.append(el);
    Object.assign(window, { koiZone: el });
  }, box);
}

interface Diff {
  /** Pixels that differ inside the element's box (page px → device px). */
  inside: number;
  /** Pixels that differ outside the box but within its pad and a cell of it. */
  ring: number;
  /** Pixels that differ farther than REACH from the box. */
  outside: number;
  /** Mean luminance (0…255) inside the box, before and after. */
  lumA: number;
  lumB: number;
}

/** Redraws pond `i` twice, with `a` then `b` applied, and compares the two frames. */
function compare(page: Page, i: number, zones: [boolean, boolean], text: Box = TEXT): Promise<Diff> {
  return page.evaluate(
    ([i, zones, text, reach]) => {
      const m = window.koiTest.ponds[i];
      const core = m.core!;
      const gl = core.gl;
      const el = (window as unknown as { koiZone: Element }).koiZone;
      const grab = (on: boolean) => {
        m.handle.setAvoid(on ? [el] : []);
        if (!core.redraw()) throw new Error('nothing drawn');
        const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const a = grab(zones[0]);
      const b = grab(zones[1]);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const canvas = core.canvas.getBoundingClientRect();
      const k = w / canvas.width;
      // The element's box in canvas css px.
      const x0 = text.left - canvas.left;
      const y0 = text.top - canvas.top;
      let inside = 0;
      let ring = 0;
      let outside = 0;
      let lumA = 0;
      let lumB = 0;
      let nIn = 0;
      for (let row = 0; row < h; row++) {
        // readPixels rows run bottom-up.
        const y = (h - 1 - row + 0.5) / k;
        for (let col = 0; col < w; col++) {
          const x = (col + 0.5) / k;
          const p = (row * w + col) * 4;
          const differs = a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2];
          const dx = Math.max(x0 - x, 0, x - (x0 + text.width));
          const dy = Math.max(y0 - y, 0, y - (y0 + text.height));
          const isIn = dx === 0 && dy === 0;
          if (isIn) {
            nIn++;
            lumA += 0.299 * a[p] + 0.587 * a[p + 1] + 0.114 * a[p + 2];
            lumB += 0.299 * b[p] + 0.587 * b[p + 1] + 0.114 * b[p + 2];
          }
          if (!differs) continue;
          if (isIn) inside++;
          else if (Math.hypot(dx, dy) < 12 + 20) ring++;
          if (Math.hypot(dx, dy) > reach) outside++;
        }
      }
      return { inside, ring, outside, lumA: lumA / nIn, lumB: lumB / nIn };
    },
    [i, zones, text, REACH] as const,
  );
}

async function pond(page: Page, options: JsonOptions): Promise<number> {
  const i = await mount(page, BOX, { time: NOON, ...options });
  await running(page, i);
  await page.evaluate((i) => {
    const m = window.koiTest.ponds[i];
    m.handle.pause();
    m.handle.setAvoidFade({ feather: 8 });
  }, i);
  return i;
}

test.beforeEach(({ page }) => open(page));

test('a zone fades the pond under its element and nowhere else', async ({ page }) => {
  const i = await pond(page, {});
  await addElement(page, TEXT);
  const on = await compare(page, i, [false, true]);
  expect(on.inside).toBeGreaterThan(200);
  expect(on.outside).toBe(0);
  // Pond: toward its dark background.
  expect(on.lumB).toBeLessThan(on.lumA);

  // Off again, strength 0, and a zero-size element all draw exactly as without zones.
  expect((await compare(page, i, [false, false])).inside).toBe(0);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setAvoidFade({ strength: 0 }), i);
  expect((await compare(page, i, [false, true])).inside).toBe(0);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setAvoidFade({ strength: 1 }), i);
  await page.evaluate(() => ((window as unknown as { koiZone: HTMLElement }).koiZone.style.display = 'none'));
  expect((await compare(page, i, [false, true])).inside).toBe(0);
  // It counts again when it comes back.
  await page.evaluate(() => ((window as unknown as { koiZone: HTMLElement }).koiZone.style.display = ''));
  expect((await compare(page, i, [false, true])).inside).toBeGreaterThan(200);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
});

test('zones the pond will not draw are not measured, and are measured afresh once they are', async ({ page }) => {
  const i = await pond(page, {});
  await addElement(page, TEXT);
  /** Element reads during one redraw with the zone listed. */
  const reads = () =>
    page.evaluate((i) => {
      const m = window.koiTest.ponds[i];
      const el = (window as unknown as { koiZone: HTMLElement }).koiZone;
      m.handle.setAvoid([el]);
      let n = 0;
      const own = el.getBoundingClientRect.bind(el);
      el.getBoundingClientRect = () => (n++, own());
      m.core!.redraw();
      delete (el as Partial<HTMLElement>).getBoundingClientRect;
      return n;
    }, i);
  expect(await reads()).toBe(1);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setAvoidFade({ strength: 0 }), i);
  expect(await reads()).toBe(0);
  await page.evaluate((i) => void (window.koiTest.ponds[i].core!.renderer!.raw = true), i);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setAvoidFade({ strength: 1 }), i);
  expect(await reads()).toBe(0);
  await page.evaluate((i) => void (window.koiTest.ponds[i].core!.renderer!.raw = false), i);
  // Moved while unmeasured: the next drawn frame has it where it is now.
  const moved = { ...TEXT, top: 40 };
  await page.evaluate((top) => ((window as unknown as { koiZone: HTMLElement }).koiZone.style.top = `${top}px`), moved.top);
  const after = await compare(page, i, [false, true], moved);
  expect(after.inside).toBeGreaterThan(200);
  expect(after.outside).toBe(0);
});

test('the raw view shows no fade; the debug outline draws the zones even at strength 0', async ({ page }) => {
  const i = await pond(page, {});
  await addElement(page, TEXT);
  const render = (flags: { raw?: boolean; showAvoid?: boolean }) =>
    page.evaluate(([i, flags]) => void Object.assign(window.koiTest.ponds[i].core!.renderer!, flags), [i, flags] as const);
  await render({ raw: true });
  expect((await compare(page, i, [false, true])).inside).toBe(0);
  await render({ raw: false, showAvoid: true });
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setAvoidFade({ strength: 0 }), i);
  const outlined = await compare(page, i, [false, true]);
  // The outline runs along the padded box, around the element (its cells
  // reach a little inside it), and nothing else changes at strength 0.
  expect(outlined.ring).toBeGreaterThan(50);
  expect(outlined.outside).toBe(0);
});

test('a zone follows its element as the page scrolls', async ({ page }) => {
  const i = await pond(page, {});
  // A fixed pond under a page that scrolls.
  await page.evaluate((i) => {
    window.koiTest.ponds[i].container.style.position = 'fixed';
    const tall = document.createElement('div');
    tall.style.height = '3000px';
    document.body.append(tall);
  }, i);
  // Low in the pond, then scrolled up by more than the zone's reach, so the
  // two positions' fades can't overlap.
  const low = { ...TEXT, top: 240 };
  await addElement(page, low);
  expect((await compare(page, i, [false, true], low)).outside).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 180));
  const scrolled = await compare(page, i, [false, true], { ...low, top: low.top - 180 });
  expect(scrolled.inside).toBeGreaterThan(200);
  // Nothing left at the old place.
  expect(scrolled.outside).toBe(0);
});

test('on paper the zone fades toward the light background, never toward ink', async ({ page }) => {
  const i = await pond(page, { palette: 'paper' });
  await addElement(page, TEXT);
  const on = await compare(page, i, [false, true]);
  expect(on.inside).toBeGreaterThan(200);
  expect(on.lumB).toBeGreaterThan(on.lumA);
});

test('setAvoid before the renderer is up applies once it is; after destroy it does nothing', async ({ page }) => {
  await addElement(page, TEXT);
  const i = await page.evaluate(
    ([box, time]) => {
      const i = window.koiTest.mount(box, { time });
      const h = window.koiTest.ponds[i].handle;
      h.setAvoid([(window as unknown as { koiZone: Element }).koiZone]);
      h.setAvoidFade({ strength: 0.5, feather: 8 });
      return i;
    },
    [BOX, NOON] as const,
  );
  await running(page, i);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  expect((await compare(page, i, [false, true])).inside).toBeGreaterThan(100);
  await page.evaluate((i) => {
    const h = window.koiTest.ponds[i].handle;
    h.destroy();
    h.setAvoid([document.body]);
    h.setAvoidFade({ strength: 1 });
  }, i);
});

test('without WebGL2 the options and setters are accepted and do nothing (A3)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      if (id === 'webgl2') return null;
      return (getContext as (...a: unknown[]) => RenderingContext | null).call(this, id, ...rest);
    } as typeof getContext;
  });
  await open(page);
  const i = await page.evaluate((box) => {
    const i = window.koiTest.mount(box, { avoid: [document.body, { element: document.body, pad: 4 }], avoidFade: { strength: 0.5 } });
    window.koiTest.ponds[i].handle.setAvoid([document.body]);
    return i;
  }, BOX);
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([
    'webgl2-unavailable: The koi pond needs WebGL2, which this browser does not provide.',
  ]);
  await page.evaluate((i) => {
    const h = window.koiTest.ponds[i].handle;
    h.setAvoid([document.body]);
    h.setAvoidFade({ feather: 20 });
    h.destroy();
  }, i);
  expect(pageErrors).toEqual([]);
});
