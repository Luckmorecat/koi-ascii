import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';
import type { KoiPondOptions, KoiPondSky } from '../../src/index';
import { GLYPHS } from '../../src/glyphs';

// The `sky` option and setSky(). The darker night and the stars draw so far;
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

async function pond(page: Page, options: Omit<KoiPondOptions, 'onError'>, box = BOX): Promise<number> {
  const i = await mount(page, box, options);
  await running(page, i);
  // Hold the frame loop, so samples see exactly the state they redraw.
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  return i;
}

test.beforeEach(({ page }) => open(page));

test('at night the defaults darken a dark pond; sky false and darkNight false do not', async ({ page }) => {
  const i = await pond(page, { time: NIGHT, sky: false });
  const off = await sample(page, i, 'off');

  // The features that draw at night, all off.
  await setSky(page, i, { stars: false, fireflies: false, darkNight: false });
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

test('by day every feature, and on a light palette at night the darker night, change nothing', async ({ page }) => {
  for (const [name, options, sky] of [
    ['pond at noon', { time: NOON }, true],
    ['paper at night', { time: NIGHT, palette: 'paper' }, { stars: false, fireflies: false, darkNight: true }],
    [
      'light filter at night',
      { time: NIGHT, palette: { mode: 'filter', background: '#f4f1ea', invert: true } },
      { stars: false, fireflies: false, darkNight: true },
    ],
  ] as const) {
    const i = await pond(page, { ...options, sky });
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

// ---------------------------------------------------------------- stars

/** The size the star density is tuned at. */
const BIG = { left: 0, top: 0, width: 1280, height: 800 };
const M_WATER = 0;
const M_STAR = 8; // common.glsl
const G_STAR = Object.keys(GLYPHS).indexOf('STAR');
const G_SPACE = Object.keys(GLYPHS).indexOf('SPACE');

interface Cells {
  /** Cell class (M_*) per cell. */
  mat: number[];
  /** Glyph index per cell. */
  glyph: number[];
  /** Scene colour and density, 4 bytes per cell. */
  rgba: number[];
}

/** Redraws pond `i` and reads back the scene pass: what each character cell shows. */
function cells(page: Page, i: number): Promise<Cells> {
  return page.evaluate((i) => {
    const core = window.koiTest.ponds[i].core!;
    if (!core.redraw()) throw new Error('nothing drawn');
    const gl = core.gl;
    const r = core.renderer! as unknown as { cols: number; rows: number; scene: { fbo: WebGLFramebuffer } };
    const read = (attachment: number) => {
      const px = new Uint8Array(r.cols * r.rows * 4);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.scene.fbo);
      gl.readBuffer(attachment);
      gl.readPixels(0, 0, r.cols, r.rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      return px;
    };
    const col = read(gl.COLOR_ATTACHMENT0);
    const info = read(gl.COLOR_ATTACHMENT1);
    const mat: number[] = [];
    const glyph: number[] = [];
    for (let k = 0; k < info.length; k += 4) {
      glyph.push(info[k]);
      mat.push(info[k + 1]);
    }
    return { mat, glyph, rgba: [...col] };
  }, i);
}

const starCount = (c: Cells) => c.mat.filter((m) => m === M_STAR).length;

/** Cells flat (water or star) in both samples whose star status differs. */
function moved(a: Cells, b: Cells): number {
  let n = 0;
  a.mat.forEach((m, k) => {
    const flat = (x: number) => x === M_WATER || x === M_STAR;
    if (flat(m) && flat(b.mat[k]) && (m === M_STAR) !== (b.mat[k] === M_STAR)) n++;
  });
  return n;
}

/** Removes the fish (and their wakes) and lets the surface go flat. */
async function stillWater(page: Page, i: number): Promise<void> {
  await page.evaluate((i) => {
    const core = window.koiTest.ponds[i].core!;
    core.pond.fish.length = 0;
    core.pond.drops.length = 0;
    for (let f = 0; f < 900; f++) core.step(1 / 60);
  }, i);
}

test('at full night about 1.4 % of the water holds a star, few of them *', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NIGHT }, BIG);
  const c = await cells(page, i);
  const water = c.mat.filter((m) => m === M_WATER || m === M_STAR).length;
  const stars = starCount(c);
  expect(stars / water).toBeGreaterThan(0.011);
  expect(stars / water).toBeLessThan(0.017);
  const big = c.mat.filter((m, k) => m === M_STAR && c.glyph[k] === G_STAR).length;
  expect(big / stars).toBeLessThan(0.06);
});

test('stars show at night only, and sky.stars turns them off', async ({ page }) => {
  for (const [time, on] of [
    [NIGHT, true],
    [{ mode: 'fixed', phase: 0.05 }, true],
    [NOON, false],
    [{ mode: 'fixed', phase: 0.745 }, false], // golden hour
    [{ mode: 'fixed', phase: 0.78 }, false], // early blue hour
  ] as const) {
    const i = await pond(page, { time });
    expect(starCount(await cells(page, i)) > 0, `phase ${time.phase}`).toBe(on);
    await setSky(page, i, { stars: false });
    expect(starCount(await cells(page, i)), `phase ${time.phase}, stars off`).toBe(0);
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

test('on paper at night the stars thin the motes', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NIGHT, palette: 'paper' }, BIG);
  // Motes and floor caustics share the light glyphs; only the motes thin.
  const marks = (c: Cells) => c.mat.filter((m, k) => m === M_WATER && c.glyph[k] !== G_SPACE).length;
  const on = await cells(page, i);
  await setSky(page, i, { stars: false });
  const off = await cells(page, i);
  expect(starCount(on)).toBeGreaterThan(0);
  expect(marks(on)).toBeLessThan(marks(off));
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test.beforeEach(({ page }) => page.setViewportSize({ width: BIG.width, height: BIG.height }));

  test('stars hold still', async ({ page }) => {
    const i = await pond(page, { time: NIGHT }, BIG);
    await stillWater(page, i);
    const a = await cells(page, i);
    await page.evaluate((i) => {
      for (let f = 0; f < 90; f++) window.koiTest.ponds[i].core!.step(1 / 60);
    }, i);
    const b = await cells(page, i);
    expect(starCount(a)).toBeGreaterThan(0);
    expect(moved(a, b)).toBe(0);
    a.mat.forEach((m, k) => {
      if (m !== M_STAR) return;
      expect(b.rgba.slice(k * 4, k * 4 + 4)).toEqual(a.rgba.slice(k * 4, k * 4 + 4));
      expect(b.glyph[k]).toBe(a.glyph[k]);
    });
  });

  test("a tap's ring makes the stars jump cells, and they settle back", async ({ page }) => {
    const i = await pond(page, { time: NIGHT }, BIG);
    await stillWater(page, i);
    const still = await cells(page, i);
    await page.evaluate((i) => {
      const core = window.koiTest.ponds[i].core!;
      // A few taps, so the rings cross enough of the sparse stars.
      for (let x = 160; x < 1280; x += 320) {
        for (let y = 130; y < 800; y += 270) core.pond.pointerDown(x, y, performance.now() / 1000);
      }
      for (let f = 0; f < 30; f++) core.step(1 / 60);
    }, i);
    const ring = await cells(page, i);
    await page.evaluate((i) => {
      for (let f = 0; f < 900; f++) window.koiTest.ponds[i].core!.step(1 / 60);
    }, i);
    const settled = await cells(page, i);
    expect(moved(still, ring)).toBeGreaterThan(10);
    expect(moved(still, settled)).toBeLessThanOrEqual(1);
  });
});
