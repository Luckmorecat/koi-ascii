import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';
import type { KoiPondOptions, KoiPondPalette } from '../../src/index';

// Palettes and intensity, checked by sampling the drawn pixels (no golden
// images). Every sample redraws the current state and reads the drawing
// buffer in the same task, so it sees exactly one frame.

type RGB = [number, number, number];

interface Sample {
  /** The most common colour: the background, since most of a pond is empty water. */
  mode: RGB;
  /** Share of pixels that are exactly `mode`. */
  modeShare: number;
  /** Every pixel has r = g = b. */
  grey: boolean;
  /** Largest channel value of any pixel, per channel. */
  max: RGB;
}

const BOX = { left: 0, top: 0, width: 320, height: 240 };
const NOON = { mode: 'fixed', phase: 0.5 } as const;
const NIGHT = { mode: 'fixed', phase: 0 } as const;

/** Redraws pond `i` and summarises its pixels; `keep` stores them for `differing`. */
function sample(page: Page, i: number, keep?: string): Promise<Sample> {
  return page.evaluate(
    ([i, keep]) => {
      const core = window.koiTest.ponds[i].core!;
      const gl = core.gl;
      if (!core.redraw()) throw new Error('nothing drawn');
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (keep) ((window as unknown as { kept: Record<string, Uint8Array> }).kept ??= {})[keep] = px;
      const counts = new Map<number, number>();
      let grey = true;
      const max: [number, number, number] = [0, 0, 0];
      for (let p = 0; p < px.length; p += 4) {
        const key = (px[p] << 16) | (px[p + 1] << 8) | px[p + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (px[p] !== px[p + 1] || px[p + 1] !== px[p + 2]) grey = false;
        for (let c = 0; c < 3; c++) max[c] = Math.max(max[c], px[p + c]);
      }
      let best = 0;
      let n = 0;
      for (const [key, c] of counts) if (c > n) [best, n] = [key, c];
      return { mode: [best >> 16, (best >> 8) & 255, best & 255], modeShare: n / (w * h), grey, max };
    },
    [i, keep ?? ''] as const,
  ) as Promise<Sample>;
}

/** Pixels that differ between two kept samples. */
function differing(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([a, b]) => {
      const kept = (window as unknown as { kept: Record<string, Uint8Array> }).kept;
      let n = 0;
      for (let p = 0; p < kept[a].length; p += 4) {
        if (kept[a][p] !== kept[b][p] || kept[a][p + 1] !== kept[b][p + 1] || kept[a][p + 2] !== kept[b][p + 2]) n++;
      }
      return n;
    },
    [a, b] as const,
  );
}

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function canvasBackground(page: Page, i: number): Promise<string> {
  return page.evaluate((i) => window.koiTest.ponds[i].container.querySelector('canvas')!.style.backgroundColor, i);
}

async function pond(page: Page, options: Omit<KoiPondOptions, 'onError'>): Promise<number> {
  const i = await mount(page, BOX, options);
  await running(page, i);
  return i;
}

function setRender(page: Page, i: number, flags: { raw?: boolean; glow?: boolean }): Promise<void> {
  return page.evaluate(([i, flags]) => void Object.assign(window.koiTest.ponds[i].core!.renderer!, flags), [i, flags] as const);
}

test.beforeEach(({ page }) => open(page));

// The preset backgrounds as drawn. Explicit backgrounds are exact; `pond`
// keeps today's background graded by the time of day (#06131a at noon is
// (7, 21, 27) on screen), so it is compared within a tolerance.
const EXPLICIT: Record<string, string> = {
  mono: '#0b0b0b',
  phosphor: '#020a04',
  amber: '#0c0600',
  paper: '#f3efe6',
  brand: '#14102a',
};

for (const [phaseName, time] of [['noon', NOON], ['night', NIGHT]] as const) {
  test(`every preset draws on its own background at ${phaseName}`, async ({ page }) => {
    for (const name of ['pond', ...Object.keys(EXPLICIT)]) {
      const i = await pond(page, { palette: name as KoiPondPalette, time });
      const s = await sample(page, i);
      expect(s.modeShare, name).toBeGreaterThan(0.4);
      if (name === 'pond') {
        if (phaseName === 'noon') hex('#06131a').forEach((v, c) => expect(Math.abs(s.mode[c] - v), name).toBeLessThanOrEqual(2));
      } else {
        // Light backgrounds stay light at night, dark ones are not graded (Q5, Q14).
        expect(s.mode, name).toEqual(hex(EXPLICIT[name]));
      }
      await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
    }
  });
}

test('intensity 0 leaves only the background and keeps rendering', async ({ page }) => {
  for (const palette of ['pond', 'paper', 'phosphor'] as const) {
    const i = await pond(page, { palette, intensity: 0, time: NOON });
    const s = await sample(page, i);
    expect(s.modeShare, palette).toBe(1);
    await running(page, i, (await page.evaluate((i) => window.koiTest.ponds[i].frames, i)) + 3);
  }
});

test('setPalette and setIntensity apply on the next frame and the fish carry on', async ({ page }) => {
  const i = await pond(page, { time: NOON });
  const before = await page.evaluate((i) => {
    const core = window.koiTest.ponds[i].core!;
    (window as unknown as { pondBefore: unknown }).pondBefore = core.pond;
    return core.pond.time;
  }, i);
  expect((await sample(page, i)).modeShare).toBeLessThan(1);

  await page.evaluate((i) => window.koiTest.ponds[i].handle.setPalette('paper'), i);
  expect((await sample(page, i)).mode).toEqual(hex('#f3efe6'));
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setIntensity(0), i);
  expect((await sample(page, i)).modeShare).toBe(1);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.setIntensity(1), i);
  expect((await sample(page, i)).modeShare).toBeLessThan(1);

  // Same pond, still swimming: no remount.
  await expect
    .poll(() =>
      page.evaluate(
        (i) => {
          const core = window.koiTest.ponds[i].core!;
          return core.pond === (window as unknown as { pondBefore: unknown }).pondBefore ? core.pond.time : -1;
        },
        i,
      ),
    )
    .toBeGreaterThan(before);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
});

test('a palette set before the renderer is up, and after a context restore, still applies', async ({ page }) => {
  const i = await page.evaluate(
    ([box, time]) => {
      const i = window.koiTest.mount(box, { time });
      window.koiTest.ponds[i].handle.setPalette('amber');
      return i;
    },
    [BOX, NOON] as const,
  );
  await running(page, i);
  expect((await sample(page, i)).mode).toEqual(hex('#0c0600'));

  await page.evaluate((i) => {
    const ext = window.koiTest.ponds[i].core!.gl.getExtension('WEBGL_lose_context')!;
    Object.assign(window, { koiLoseContext: ext });
    ext.loseContext();
  }, i);
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].core!.renderer === null, i)).toBe(true);
  await page.evaluate(() => (window as unknown as { koiLoseContext: WEBGL_lose_context }).koiLoseContext.restoreContext());
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].restored, i)).toBe(1);
  await running(page, i, (await page.evaluate((i) => window.koiTest.ponds[i].frames, i)) + 3);
  expect((await sample(page, i)).mode).toEqual(hex('#0c0600'));
});

test('a light background gets no halo; a dark one does', async ({ page }) => {
  // Toggling the glow pass changes nothing on paper, so no halo was drawn.
  // Paused, so both samples draw the same state.
  const paper = await pond(page, { palette: 'paper', time: NIGHT });
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), paper);
  await sample(page, paper, 'paper-glow');
  await setRender(page, paper, { glow: false });
  await sample(page, paper, 'paper-plain');
  expect(await differing(page, 'paper-glow', 'paper-plain')).toBe(0);

  const brand = await pond(page, { palette: 'brand', time: NIGHT });
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), brand);
  await sample(page, brand, 'brand-glow');
  await setRender(page, brand, { glow: false });
  await sample(page, brand, 'brand-plain');
  expect(await differing(page, 'brand-glow', 'brand-plain')).toBeGreaterThan(0);
});

test('time of day keeps a ramp on its stops: mono stays grey at night', async ({ page }) => {
  for (const time of [NOON, NIGHT]) {
    const i = await pond(page, { palette: 'mono', time });
    expect((await sample(page, i)).grey).toBe(true);
  }
});

test('filter: saturation 0 greys the pond; invert on a light background; tint multiplies', async ({ page }) => {
  const grey = await pond(page, {
    palette: { mode: 'filter', background: '#eeeeee', saturation: 0, invert: true },
    time: NIGHT,
  });
  const g = await sample(page, grey);
  expect(g.mode).toEqual(hex('#eeeeee'));
  expect(g.grey).toBe(true);

  const red = await pond(page, { palette: { mode: 'filter', background: '#000000', tint: '#ff0000' }, time: NOON });
  const r = await sample(page, red);
  expect(r.mode).toEqual([0, 0, 0]);
  expect(r.max[0]).toBeGreaterThan(64);
  expect(r.max.slice(1)).toEqual([0, 0]);
});

test('filter: an inverted filter takes the tint too', async ({ page }) => {
  // Paused, so both samples draw the same state; a grey background and
  // saturation 0 make the untinted picture grey.
  const plain = { mode: 'filter', background: '#eeeeee', invert: true, saturation: 0 } as const;
  const i = await pond(page, { palette: plain, time: NOON });
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  const untinted = await sample(page, i, 'invert-plain');
  await page.evaluate(([i, p]) => window.koiTest.ponds[i].handle.setPalette({ ...p, tint: '#00aa77' }), [i, plain] as const);
  const tinted = await sample(page, i, 'invert-tint');
  expect(await differing(page, 'invert-plain', 'invert-tint')).toBeGreaterThan(0);
  expect(untinted.grey).toBe(true);
  expect(tinted.grey).toBe(false);
  // The background stays put; only the ink takes the tint.
  expect(tinted.mode).toEqual(hex('#eeeeee'));
});

test('the raw view ignores the palette and intensity', async ({ page }) => {
  const i = await pond(page, { palette: 'paper', intensity: 0.3, time: NOON });
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  await setRender(page, i, { raw: true });
  const paperRaw = await sample(page, i, 'paper-raw');
  expect(paperRaw.mode).toEqual(hex('#06131a'));
  await page.evaluate((i) => {
    const { handle } = window.koiTest.ponds[i];
    handle.setPalette('pond');
    handle.setIntensity(1);
  }, i);
  await sample(page, i, 'pond-raw');
  expect(await differing(page, 'paper-raw', 'pond-raw')).toBe(0);
});

test.describe('software renderer', () => {
  // Still the GPU underneath: only the reported renderer is spoofed (see mount.spec.ts).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const get = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, p: GLenum) {
        return p === 0x9246 ? 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' : get.call(this, p);
      };
    });
    await open(page);
  });

  test('draws every mode', async ({ page }) => {
    for (const [palette, bg] of [
      ['mono', '#0b0b0b'],
      ['paper', '#f3efe6'],
      [{ mode: 'filter', background: '#202020', saturation: 0.5 }, null],
    ] as const) {
      const i = await pond(page, { palette: palette as KoiPondPalette, time: NOON });
      expect(await page.evaluate((i) => window.koiTest.ponds[i].core!.stats.software, i)).toBe(true);
      const s = await sample(page, i);
      expect(s.modeShare).toBeLessThan(1);
      if (bg) expect(s.mode).toEqual(hex(bg));
    }
  });
});

test.describe('colours are parsed by the browser', () => {
  test('any CSS colour works, alpha is dropped, var() falls back with a warning', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    const half = await pond(page, { palette: { mode: 'roles', background: 'rgb(200 40 40 / 0.5)' }, time: NOON });
    expect((await sample(page, half)).mode).toEqual([200, 40, 40]);
    expect(await canvasBackground(page, half)).toBe('rgb(200, 40, 40)');

    // oklch(0.7 0.1 200) is rgb(64, 177, 183) in sRGB (OKLab reference matrices).
    const ok = await pond(page, { palette: { mode: 'roles', background: 'oklch(0.7 0.1 200)' }, time: NOON });
    const m = (await sample(page, ok)).mode;
    [64, 177, 183].forEach((v, c) => expect(Math.abs(m[c] - v)).toBeLessThanOrEqual(3));
    // Alpha is dropped even at zero, where a drawn pixel would read back black.
    for (const alpha of ['0', '0.01']) {
      const clear = await pond(page, { palette: { mode: 'roles', background: `oklch(0.7 0.1 200 / ${alpha})` }, time: NOON });
      const mc = (await sample(page, clear)).mode;
      [64, 177, 183].forEach((v, c) => expect(Math.abs(mc[c] - v)).toBeLessThanOrEqual(3));
    }

    const bad = await pond(page, { palette: { mode: 'roles', background: 'var(--brand)' }, time: NOON });
    expect((await sample(page, bad)).mode).toEqual(hex('#06131a'));
    expect(warnings.some((w) => w.includes('var(--brand)'))).toBe(true);
    expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, bad)).toEqual([]);
  });

  test("the canvas background follows the palette unless 'background' is set", async ({ page }) => {
    const follow = await pond(page, { palette: 'paper' });
    expect(await canvasBackground(page, follow)).toBe('rgb(243, 239, 230)');
    await page.evaluate((i) => window.koiTest.ponds[i].handle.setPalette('brand'), follow);
    expect(await canvasBackground(page, follow)).toBe('rgb(20, 16, 42)');

    const fixed = await pond(page, { palette: 'paper', background: 'red' });
    expect(await canvasBackground(page, fixed)).toBe('red');
    await page.evaluate((i) => window.koiTest.ponds[i].handle.setPalette('brand'), fixed);
    expect(await canvasBackground(page, fixed)).toBe('red');
    // The drawn pond still uses the palette's background.
    expect((await sample(page, fixed)).mode).toEqual(hex('#14102a'));
  });
});
