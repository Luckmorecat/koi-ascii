import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';
import type { KoiPondOptions, KoiPondSky } from '../../src/index';

// The `sky` option and setSky(). Only the darker night draws anything so far;
// each check redraws the current state (nothing advances), so two samples of
// one pond differ only by what changed in between.

const BOX = { left: 0, top: 0, width: 320, height: 240 };
const NOON = { mode: 'fixed', phase: 0.5 } as const;
const NIGHT = { mode: 'fixed', phase: 0.95 } as const;

type Kept = { kept: Record<string, Uint8Array> };

/** Redraws pond `i`, keeps its pixels under `key` and returns their mean brightness (0…255). */
function sample(page: Page, i: number, key: string): Promise<number> {
  return page.evaluate(
    ([i, key]) => {
      const core = window.koiTest.ponds[i].core!;
      const gl = core.gl;
      if (!core.redraw()) throw new Error('nothing drawn');
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ((window as unknown as Kept).kept ??= {})[key] = px;
      let sum = 0;
      for (let p = 0; p < px.length; p += 4) sum += px[p] + px[p + 1] + px[p + 2];
      return sum / ((px.length / 4) * 3);
    },
    [i, key] as const,
  );
}

/** Pixels that differ between two kept samples. */
function differing(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([a, b]) => {
      const kept = (window as unknown as Kept).kept;
      let n = 0;
      for (let p = 0; p < kept[a].length; p += 4) {
        if (kept[a][p] !== kept[b][p] || kept[a][p + 1] !== kept[b][p + 1] || kept[a][p + 2] !== kept[b][p + 2]) n++;
      }
      return n;
    },
    [a, b] as const,
  );
}

function setSky(page: Page, i: number, sky: KoiPondSky | undefined): Promise<void> {
  return page.evaluate(([i, sky]) => window.koiTest.ponds[i].handle.setSky(sky as KoiPondSky), [i, sky] as const);
}

async function pond(page: Page, options: Omit<KoiPondOptions, 'onError'>): Promise<number> {
  const i = await mount(page, BOX, options);
  await running(page, i);
  // Hold the frame loop, so samples see exactly the state they redraw.
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  return i;
}

test.beforeEach(({ page }) => open(page));

test('at night the defaults darken a dark pond; sky false and darkNight false do not', async ({ page }) => {
  const i = await pond(page, { time: NIGHT, sky: false });
  const off = await sample(page, i, 'off');

  await setSky(page, i, { darkNight: false });
  await sample(page, i, 'noDark');
  expect(await differing(page, 'off', 'noDark')).toBe(0);

  await setSky(page, i, undefined);
  const dark = await sample(page, i, 'default');
  expect(await differing(page, 'off', 'default')).toBeGreaterThan(0);
  // Water and background ×0.7 at full night, caustics halved.
  expect(dark).toBeLessThan(off * 0.85);
  expect(dark).toBeGreaterThan(off * 0.5);

  await setSky(page, i, false);
  await sample(page, i, 'offAgain');
  expect(await differing(page, 'off', 'offAgain')).toBe(0);
});

test('by day, and on a light palette at night, the defaults change nothing', async ({ page }) => {
  for (const [name, options] of [
    ['pond at noon', { time: NOON }],
    ['paper at night', { time: NIGHT, palette: 'paper' }],
    ['light filter at night', { time: NIGHT, palette: { mode: 'filter', background: '#f4f1ea', invert: true } }],
  ] as const) {
    const i = await pond(page, { ...options, sky: true });
    await sample(page, i, `${name} on`);
    await setSky(page, i, false);
    await sample(page, i, `${name} off`);
    expect(await differing(page, `${name} on`, `${name} off`), name).toBe(0);
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

test('setSky applies on the next frame and the fish carry on; after destroy it is a no-op', async ({ page }) => {
  const i = await mount(page, BOX, { time: NIGHT });
  await running(page, i);
  const before = await page.evaluate((i) => {
    const core = window.koiTest.ponds[i].core!;
    (window as unknown as { pondBefore: unknown }).pondBefore = core.pond;
    return core.pond.time;
  }, i);
  await setSky(page, i, false);
  await expect
    .poll(() =>
      page.evaluate((i) => {
        const core = window.koiTest.ponds[i].core!;
        return core.pond === (window as unknown as { pondBefore: unknown }).pondBefore ? core.pond.time : -1;
      }, i),
    )
    .toBeGreaterThan(before);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].core!.renderer!.sky.darkNight, i)).toBe(false);

  await page.evaluate((i) => {
    const h = window.koiTest.ponds[i].handle;
    h.destroy();
    h.setSky(true);
    h.setSky(3 as never);
  }, i);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
});

test('a sky set before the renderer is up still applies, and invalid input only warns', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  const i = await page.evaluate(
    ([box, time]) => {
      const i = window.koiTest.mount(box, { time, sky: { stars: 'yes' } as never });
      window.koiTest.ponds[i].handle.setSky({ darkNight: false, moon: true });
      return i;
    },
    [BOX, NIGHT] as const,
  );
  await running(page, i);
  expect(await page.evaluate((i) => ({ ...window.koiTest.ponds[i].core!.renderer!.sky }), i)).toEqual({
    stars: true,
    fireflies: true,
    darkNight: false,
    moon: true,
    sun: false,
  });
  expect(warnings).toEqual(['koi-ascii: sky.stars must be true or false; got "yes", using true.']);
});
