import { expect, test, type Page } from '@playwright/test';
import { mount, open, running } from './helpers';
import type { KoiPondOptions, KoiPondSky } from '../../src/index';
import { GLYPHS } from '../../src/glyphs';

// The `sky` option and setSky(): the darker night, the stars, the moon, the
// fireflies and the sun; each check redraws the current state (nothing advances), so two
// samples of one pond differ only by what changed in between.

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

test('by day every feature but the sun, and on a light palette at night the darker night, change nothing', async ({ page }) => {
  for (const [name, options, sky] of [
    ['pond at noon', { time: NOON }, { stars: true, fireflies: true, darkNight: true, moon: true, sun: false }],
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

// ---------------------------------------------------------------- moon

const M_MOON = 9; // common.glsl
const M_BODY = 5; // common.glsl
const FISH = [2, 3, 4, 5, 6]; // M_TRAIL … M_EYE: what a fish draws
const glyphOf = (key: keyof typeof GLYPHS) => Object.keys(GLYPHS).indexOf(key);
const MOON_ON = { moon: true } as const;

const moonCells = (c: Cells) => c.mat.flatMap((m, k) => (m === M_MOON ? [k] : []));

/**
 * The moon's (or the sun patch's) centre in cells, its radius in cell
 * heights and the grid size, from the lighting the frame was drawn with (dpr 1).
 */
function bodyInCells(page: Page, i: number, body: 'moon' | 'sun' = 'moon'): Promise<{ x: number; y: number; r: number; cols: number; rows: number }> {
  return page.evaluate(([i, body]) => {
    const core = window.koiTest.ponds[i].core!;
    const r = core.renderer! as unknown as { cols: number; rows: number; info: { cellW: number; cellH: number }; light: Record<'moon' | 'sun', { pos: number[]; radius: number }> };
    const w = core.gl.drawingBufferWidth;
    const h = core.gl.drawingBufferHeight;
    const cw = r.info.cellW;
    const ch = r.info.cellH;
    const ox = (w - r.cols * cw) >> 1;
    const oy = (h - r.rows * ch) >> 1;
    const m = r.light[body];
    return {
      x: (m.pos[0] * w - ox) / cw,
      y: (m.pos[1] * h - oy) / ch,
      r: (m.radius * Math.min(w, h)) / ch,
      cols: r.cols,
      rows: r.rows,
    };
  }, [i, body] as const);
}

test('at full night with sky.moon a disc with maria and a rim shows, clear of the centre', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NIGHT, sky: MOON_ON }, BIG);
  const c = await cells(page, i);
  const moon = moonCells(c);
  const m = await bodyInCells(page, i);
  // About the disc's area in cells (cells are about twice as tall as wide).
  const area = Math.PI * m.r * m.r * (BIG.height / m.rows / (BIG.width / m.cols));
  expect(moon.length).toBeGreaterThan(area * 0.7);
  expect(moon.length).toBeLessThan(area * 1.5);
  // Every moon cell out of the middle 40 % (P1).
  for (const k of moon) {
    // Row 0 of the scene target is the top of the pond.
    const [x, y] = [(k % m.cols) + 0.5, Math.floor(k / m.cols) + 0.5];
    const inside = x > 0.3 * m.cols && x < 0.7 * m.cols && y > 0.3 * m.rows && y < 0.7 * m.rows;
    expect(inside, `cell ${k}`).toBe(false);
  }
  const glyphs = moon.map((k) => c.glyph[k]);
  const count = (key: keyof typeof GLYPHS) => glyphs.filter((g) => g === glyphOf(key)).length;
  const face = ['DOT', 'COLON', 'O', 'BIG_O'] as const;
  const faces = face.reduce((n, g) => n + count(g), 0);
  // The face is mostly o and :, with maria; O is rare.
  expect(count('O') + count('COLON')).toBeGreaterThan(faces * 0.6);
  expect(count('COLON')).toBeGreaterThan(0);
  expect(count('BIG_O')).toBeGreaterThan(0);
  expect(count('BIG_O')).toBeLessThan(faces * 0.1);
  // The rim: outline glyphs, as a fish's.
  const rim = (['LPAREN', 'RPAREN', 'SLASH', 'BSLASH', 'UNDERSCORE', 'MINUS'] as const).reduce((n, g) => n + count(g), 0);
  expect(rim).toBeGreaterThan(8);
  // Still water: no shards.
  expect(count('EQUALS') + count('PIPE')).toBe(0);
});

test('the moon is off by default, shows with sky true, and only at night', async ({ page }) => {
  for (const [time, sky, on] of [
    [NIGHT, undefined, false],
    [NIGHT, true, true],
    [{ mode: 'fixed', phase: 0.05 }, MOON_ON, true],
    [{ mode: 'fixed', phase: 0.19 }, MOON_ON, false],
    [NOON, true, false],
    [{ mode: 'fixed', phase: 0.81 }, MOON_ON, false],
  ] as const) {
    const i = await pond(page, { time, sky });
    expect(moonCells(await cells(page, i)).length > 0, `phase ${time.phase}, sky ${JSON.stringify(sky)}`).toBe(on);
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

/** Swims every fish into the moon's or the sun's reflection, keeping its pose and trail. */
async function swimInto(page: Page, i: number, body: 'moon' | 'sun'): Promise<void> {
  await page.evaluate(
    ([i, body]) => {
      const core = window.koiTest.ponds[i].core!;
      const r = core.renderer! as unknown as { light: Record<'moon' | 'sun', { pos: number[] }> };
      core.redraw();
      const [mx, my] = [r.light[body].pos[0] * 1280, r.light[body].pos[1] * 800];
      core.pond.fish.forEach((f, n) => {
        const k = f as unknown as { x: number; y: number; spine: Float32Array; trail: Float32Array; posed: boolean };
        const dx = mx + (n - 1) * 40 - k.x;
        const dy = my - k.y;
        k.x += dx;
        k.y += dy;
        for (let j = 0; j < k.spine.length; j += 2) {
          k.spine[j] += dx;
          k.spine[j + 1] += dy;
        }
        for (let j = 0; j < k.trail.length; j += 3) {
          k.trail[j] += dx;
          k.trail[j + 1] += dy;
        }
        k.posed = false;
      });
      // One step poses them there (joints, fins, eyes).
      core.step(1 / 60);
    },
    [i, body] as const,
  );
}

test('the moon never draws over a fish, and covers the stars', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NIGHT, sky: { moon: false } }, BIG);
  await swimInto(page, i, 'moon');
  const off = await cells(page, i);
  await setSky(page, i, MOON_ON);
  const on = await cells(page, i);
  const moon = moonCells(on);
  const overFish = moon.filter((k) => FISH.includes(off.mat[k]));
  expect(moon.length).toBeGreaterThan(0);
  expect(overFish).toEqual([]);
  // The fish did end up in the moon's disc, and kept those cells.
  const m = await bodyInCells(page, i);
  const [cw, ch] = [BIG.width / m.cols, BIG.height / m.rows];
  const inDisc = (k: number) => Math.hypot((k % m.cols) + 0.5 - m.x, (Math.floor(k / m.cols) + 0.5 - m.y) * (ch / cw)) < m.r * (ch / cw);
  const fishInMoon = off.mat.filter((f, k) => FISH.includes(f) && inDisc(k));
  expect(fishInMoon.length).toBeGreaterThan(20);
  off.mat.forEach((f, k) => {
    if (FISH.includes(f)) expect(on.mat[k], `cell ${k}`).toBe(f);
  });
  // Outside the moon nothing changed; inside it, it replaced water, ripples and stars only.
  on.mat.forEach((m, k) => {
    if (m !== M_MOON) expect(m, `cell ${k}`).toBe(off.mat[k]);
  });
});

test.describe('the moon under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a tap breaks it into = and | shards that settle back', async ({ page }) => {
    await page.setViewportSize({ width: BIG.width, height: BIG.height });
    const i = await pond(page, { time: NIGHT, sky: MOON_ON }, BIG);
    await stillWater(page, i);
    const shards = (c: Cells) => moonCells(c).filter((k) => c.glyph[k] === glyphOf('EQUALS') || c.glyph[k] === glyphOf('PIPE')).length;
    const still = await cells(page, i);
    expect(shards(still)).toBe(0);
    await page.evaluate((i) => {
      const core = window.koiTest.ponds[i].core!;
      const r = core.renderer! as unknown as { light: { moon: { pos: number[] } } };
      core.pond.pointerDown(r.light.moon.pos[0] * 1280 + 20, r.light.moon.pos[1] * 800, performance.now() / 1000);
      for (let f = 0; f < 20; f++) core.step(1 / 60);
    }, i);
    const torn = await cells(page, i);
    expect(shards(torn)).toBeGreaterThan(5);
    await page.evaluate((i) => {
      for (let f = 0; f < 900; f++) window.koiTest.ponds[i].core!.step(1 / 60);
    }, i);
    const settled = await cells(page, i);
    expect(shards(settled)).toBe(0);
    expect(Math.abs(moonCells(settled).length - moonCells(still).length)).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- fireflies

const M_FLY = 10; // common.glsl
const DUSK = { mode: 'fixed', phase: 0.83 } as const;
const FIREFLY_COUNT = 14; // fireflies.ts
const flyCells = (c: Cells) => c.mat.flatMap((m, k) => (m === M_FLY ? [k] : []));

/** Runs pond `i` for `frames` frames of 1/60 s. */
function stepFrames(page: Page, i: number, frames: number): Promise<void> {
  return page.evaluate(
    ([i, frames]) => {
      for (let f = 0; f < frames; f++) window.koiTest.ponds[i].core!.step(1 / 60);
    },
    [i, frames] as const,
  );
}

test('at dusk a few fireflies show, each a single . + or * cell', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: DUSK, seed: 42 }, BIG);
  const glyphs = [glyphOf('DOT'), glyphOf('PLUS'), glyphOf('STAR')];
  const cols = await page.evaluate((i) => (window.koiTest.ponds[i].core!.renderer as unknown as { cols: number }).cols, i);
  let seen = 0;
  // Sample a few seconds apart: they blink, so any one frame shows only some.
  for (let s = 0; s < 6; s++) {
    const c = await cells(page, i);
    const k = flyCells(c);
    seen += k.length;
    expect(k.length).toBeLessThanOrEqual(FIREFLY_COUNT);
    for (const cell of k) expect(glyphs).toContain(c.glyph[cell]);
    // Single cells: no firefly has another beside it or below it (no clumps).
    const set = new Set(k);
    const touching = k.filter((cell) => (set.has(cell + 1) && (cell + 1) % cols !== 0) || set.has(cell + cols));
    expect(touching).toEqual([]);
    await stepFrames(page, i, 60);
  }
  expect(seen).toBeGreaterThan(6);
});

test('fireflies show at dusk only, and sky.fireflies or sky false turns them off', async ({ page }) => {
  const seen = async (i: number) => {
    let n = 0;
    for (let s = 0; s < 8; s++) {
      n += flyCells(await cells(page, i)).length;
      await stepFrames(page, i, 45);
    }
    return n;
  };
  for (const [time, on] of [
    [DUSK, true],
    [{ mode: 'fixed', phase: 0.78 }, true],
    [{ mode: 'fixed', phase: 0.9 }, true],
    [NOON, false],
    [{ mode: 'fixed', phase: 0.21 }, false], // dawn
    [NIGHT, false],
    [{ mode: 'fixed', phase: 0.74 }, false], // golden hour
  ] as const) {
    const i = await pond(page, { time, seed: 42 });
    expect((await seen(i)) > 0, `phase ${time.phase}`).toBe(on);
    for (const sky of [{ fireflies: false }, false] as const) {
      await setSky(page, i, sky);
      expect(await seen(i), `phase ${time.phase}, sky ${JSON.stringify(sky)}`).toBe(0);
    }
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

test('a firefly draws over a fish, and changes nothing else', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: DUSK, sky: { fireflies: false } }, BIG);
  const off = await cells(page, i);
  const fishCell = off.mat.findIndex((m) => m === M_BODY);
  expect(fishCell).toBeGreaterThanOrEqual(0);
  // Every firefly at full brightness on that fish cell's centre.
  await page.evaluate(
    ([i, fishCell, count]) => {
      const core = window.koiTest.ponds[i].core!;
      // dpr 1: device px are CSS px.
      const r = core.renderer! as unknown as { cols: number; originX: number; originY: number; info: { cellW: number; cellH: number } };
      const x = r.originX + ((fishCell % r.cols) + 0.5) * r.info.cellW;
      const y = r.originY + (Math.floor(fishCell / r.cols) + 0.5) * r.info.cellH;
      const data = new Float32Array(count * 4);
      for (let f = 0; f < count; f++) data.set([x, y, 1, 0.5], f * 4);
      (core.pond as unknown as { packFireflies: () => Float32Array }).packFireflies = () => data;
    },
    [i, fishCell, FIREFLY_COUNT] as const,
  );
  await setSky(page, i, undefined);
  const on = await cells(page, i);
  expect(flyCells(on)).toEqual([fishCell]);
  expect(on.glyph[fishCell]).toBe(glyphOf('STAR'));
  on.mat.forEach((m, k) => {
    if (k !== fishCell) expect(m, `cell ${k}`).toBe(off.mat[k]);
  });
});

test.describe('fireflies under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('breathe instead of blinking: every one stays lit', async ({ page }) => {
    await page.setViewportSize({ width: BIG.width, height: BIG.height });
    const i = await pond(page, { time: DUSK, seed: 42 }, BIG);
    // A breath dips under the 0.22 cut only at its faintest (0.2 of full);
    // blinking leaves about half of them dark at any time.
    const counts: number[] = [];
    for (let s = 0; s < 6; s++) {
      counts.push(flyCells(await cells(page, i)).length);
      await stepFrames(page, i, 60);
    }
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------- sun

const M_SUN = 11; // common.glsl
const SUN_ON = { sun: true } as const;
const sunCells = (c: Cells) => c.mat.flatMap((m, k) => (m === M_SUN ? [k] : []));
/** Rec.601 luminance of cell `k`'s scene colour, 0…255 (as glow.frag weighs it). */
const lumAt = (c: Cells, k: number) => 0.299 * c.rgba[k * 4] + 0.587 * c.rgba[k * 4 + 1] + 0.114 * c.rgba[k * 4 + 2];

/** Sun cells over `samples` frames `every` frames apart. */
async function sunSamples(page: Page, i: number, samples: number, every: number): Promise<Cells[]> {
  const out: Cells[] = [];
  for (let s = 0; s < samples; s++) {
    out.push(await cells(page, i));
    await stepFrames(page, i, every);
  }
  return out;
}

test('at noon with sky.sun a patch of . + * glitter flashes, clear of the centre, no brighter than an Ogon glint', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NOON, sky: SUN_ON, seed: 42 }, BIG);
  // Only the Ogon stays, so the brightest fish cell is its glint.
  await page.evaluate((i) => {
    const fish = window.koiTest.ponds[i].core!.pond.fish;
    const ogon = fish.filter((f) => (f as unknown as { variety: { name: string } }).variety.name === 'ogon');
    fish.splice(0, fish.length, ...ogon);
  }, i);
  expect(await page.evaluate((i) => window.koiTest.ponds[i].core!.pond.fish.length, i)).toBe(1);
  const m = await bodyInCells(page, i, 'sun');
  const tall = BIG.height / m.rows / (BIG.width / m.cols); // cell height over width
  const glyphs = [glyphOf('DOT'), glyphOf('PLUS'), glyphOf('STAR')];
  let sun = 0;
  let ogon = 0;
  const counts: number[] = [];
  // Every 7 frames, so most samples catch a new flash (5 a second).
  for (const c of await sunSamples(page, i, 24, 7)) {
    const k = sunCells(c);
    counts.push(k.length);
    for (const cell of k) {
      expect(glyphs).toContain(c.glyph[cell]);
      const [x, y] = [(cell % m.cols) + 0.5, Math.floor(cell / m.cols) + 0.5];
      // Every glitter cell out of the middle 40 % (P1), within the patch (cells are about twice as tall as wide).
      expect(x > 0.3 * m.cols && x < 0.7 * m.cols && y > 0.3 * m.rows && y < 0.7 * m.rows, `cell ${cell}`).toBe(false);
      expect(Math.hypot(x - m.x, (y - m.y) * tall), `cell ${cell}`).toBeLessThan(m.r * tall + 2);
      sun = Math.max(sun, lumAt(c, cell));
    }
    c.mat.forEach((mat, k) => {
      if (mat === M_BODY) ogon = Math.max(ogon, lumAt(c, k));
    });
  }
  // A sparse patch: some glitter in every frame, a small share of its area.
  const area = Math.PI * m.r * m.r * tall;
  expect(Math.min(...counts)).toBeGreaterThan(3);
  expect(Math.max(...counts)).toBeLessThan(area * 0.35);
  // The glitter changes from flash to flash.
  expect(new Set(counts).size).toBeGreaterThan(3);
  // Brightness: the scene colour of the brightest glitter cell against the Ogon's brightest cell (D8).
  expect(ogon).toBeGreaterThan(150);
  expect(sun).toBeGreaterThan(80);
  expect(sun).toBeLessThanOrEqual(ogon);
});

test('the sun is off by default, shows with sky true, and only by day', async ({ page }) => {
  for (const [phase, sky, on] of [
    [0.5, undefined, false],
    [0.5, true, true],
    [0.35, SUN_ON, true],
    [0.74, SUN_ON, true],
    [0.21, SUN_ON, false], // dawn: the prototype's sun sat on the fish here
    [0.23, SUN_ON, false],
    [0.77, SUN_ON, false],
    [0.95, true, false],
  ] as const) {
    const i = await pond(page, { time: { mode: 'fixed', phase }, sky });
    const seen = (await sunSamples(page, i, 6, 7)).reduce((n, c) => n + sunCells(c).length, 0);
    expect(seen > 0, `phase ${phase}, sky ${JSON.stringify(sky)}`).toBe(on);
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

test('the glitter is warm at 0.35 and 0.74 and white at noon on the pond', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const blueOverRed: Record<number, number> = {};
  for (const phase of [0.35, 0.5, 0.74]) {
    const i = await pond(page, { time: { mode: 'fixed', phase }, sky: SUN_ON }, BIG);
    let [r, b] = [0, 0];
    for (const c of await sunSamples(page, i, 6, 7)) {
      for (const k of sunCells(c)) {
        r += c.rgba[k * 4];
        b += c.rgba[k * 4 + 2];
      }
    }
    expect(r, `phase ${phase}`).toBeGreaterThan(0);
    blueOverRed[phase] = b / r;
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
  expect(blueOverRed[0.5]).toBeGreaterThan(0.93);
  expect(blueOverRed[0.35]).toBeLessThan(0.9);
  expect(blueOverRed[0.74]).toBeLessThan(0.8);
});

test('the sun never draws over a fish', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NOON, sky: { sun: false } }, BIG);
  await swimInto(page, i, 'sun');
  const m = await bodyInCells(page, i, 'sun');
  const tall = BIG.height / m.rows / (BIG.width / m.cols);
  const inPatch = (k: number) => Math.hypot((k % m.cols) + 0.5 - m.x, (Math.floor(k / m.cols) + 0.5 - m.y) * tall) < m.r * tall;
  let glitter = 0;
  // A few flashes, each drawn without and with the sun.
  for (let s = 0; s < 8; s++) {
    await setSky(page, i, { sun: false });
    const off = await cells(page, i);
    await setSky(page, i, SUN_ON);
    const on = await cells(page, i);
    if (s === 0) expect(off.mat.filter((f, k) => FISH.includes(f) && inPatch(k)).length).toBeGreaterThan(20);
    glitter += sunCells(on).length;
    // Fish keep every cell; the glitter only replaces water and ripples.
    expect(off.mat.flatMap((f, k) => (FISH.includes(f) && on.mat[k] !== f ? [k] : []))).toEqual([]);
    expect(on.mat.flatMap((f, k) => (f !== M_SUN && f !== off.mat[k] ? [k] : []))).toEqual([]);
    await stepFrames(page, i, 7);
  }
  expect(glitter).toBeGreaterThan(0);
});

/** Frames, out of `frames` consecutive ones, whose glitter differs from the frame before. */
async function flashes(page: Page, i: number, frames: number): Promise<number> {
  let prev = sunCells(await cells(page, i)).join();
  let n = 0;
  for (let f = 0; f < frames; f++) {
    await stepFrames(page, i, 1);
    const now = sunCells(await cells(page, i)).join();
    if (now !== prev) n++;
    prev = now;
  }
  return n;
}

test('the glitter flashes about 5 times a second', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NOON, sky: SUN_ON }, BIG);
  await stillWater(page, i);
  const n = await flashes(page, i, 60);
  expect(n).toBeGreaterThanOrEqual(4);
  expect(n).toBeLessThanOrEqual(6);
});

test.describe('the sun under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the glitter flashes slower', async ({ page }) => {
    await page.setViewportSize({ width: BIG.width, height: BIG.height });
    const i = await pond(page, { time: NOON, sky: SUN_ON }, BIG);
    await stillWater(page, i);
    expect(await flashes(page, i, 60)).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- whole day

interface DaySample {
  phase: number;
  /** Cells of each feature: stars, moon, fireflies, sun. */
  cells: [number, number, number, number];
  /** Summed brightness × density of those cells. */
  light: [number, number, number, number];
  /** Mean brightness of the drawn frame, 0…255. */
  mean: number;
}

/**
 * Redraws pond `i` (paused, so only the phase changes) at `steps` phases
 * across the day and measures what each frame shows.
 */
function day(page: Page, i: number, steps: number): Promise<DaySample[]> {
  return page.evaluate(
    ([i, steps, mats]) => {
      const core = window.koiTest.ponds[i].core!;
      const gl = core.gl;
      const r = core.renderer! as unknown as { cols: number; rows: number; scene: { fbo: WebGLFramebuffer } };
      const info = new Uint8Array(r.cols * r.rows * 4);
      const col = new Uint8Array(r.cols * r.rows * 4);
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      const out: DaySample[] = [];
      try {
        for (let s = 0; s < steps; s++) {
          const phase = s / steps;
          core.sky.hold(phase);
          if (!core.redraw()) throw new Error('nothing drawn');
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.scene.fbo);
          gl.readBuffer(gl.COLOR_ATTACHMENT1);
          gl.readPixels(0, 0, r.cols, r.rows, gl.RGBA, gl.UNSIGNED_BYTE, info);
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.readPixels(0, 0, r.cols, r.rows, gl.RGBA, gl.UNSIGNED_BYTE, col);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const sample: DaySample = { phase, cells: [0, 0, 0, 0], light: [0, 0, 0, 0], mean: 0 };
          for (let k = 0; k < info.length; k += 4) {
            const f = mats.indexOf(info[k + 1]);
            if (f < 0) continue;
            sample.cells[f]++;
            sample.light[f] += ((col[k] + col[k + 1] + col[k + 2]) / 3) * (col[k + 3] / 255);
          }
          let sum = 0;
          for (let p = 0; p < px.length; p += 4) sum += px[p] + px[p + 1] + px[p + 2];
          sample.mean = sum / ((px.length / 4) * 3);
          out.push(sample);
        }
      } finally {
        core.sky.release();
      }
      return out;
    },
    [i, steps, [M_STAR, M_MOON, M_FLY, M_SUN] as number[]] as const,
  );
}

/** The largest change of `value` between neighbouring samples. */
const biggestStep = (samples: DaySample[], value: (s: DaySample) => number) =>
  Math.max(...samples.slice(1).map((s, k) => Math.abs(value(s) - value(samples[k]))));

test('a whole day with every feature: nothing pops, the moon and sun never share the sky, fireflies only at dusk', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  // 1/800 of a day apart: under 5 frames of a 60 s loop (?cycle=60).
  const STEPS = 800;
  const all = await day(page, await pond(page, { time: NIGHT, sky: true, seed: 42 }, BIG), STEPS);
  const none = await day(page, await pond(page, { time: NIGHT, sky: false, seed: 42 }, BIG), STEPS);

  // Each feature fades: no step moves more than 15 % of its brightest frame
  // (measured: about 7 % stars, 7 % moon, 9 % fireflies, 10 % sun glitter).
  for (let f = 0; f < 4; f++) {
    const peak = Math.max(...all.map((s) => s.light[f]));
    expect(peak).toBeGreaterThan(0);
    expect(biggestStep(all, (s) => s.light[f]) / peak).toBeLessThan(0.15);
  }
  // The whole frame changes no faster than the 0.2 pond's own lighting does.
  expect(biggestStep(all, (s) => s.mean)).toBeLessThanOrEqual(biggestStep(none, (s) => s.mean) * 1.25);

  for (const s of all) {
    const [, moon, flies, sun] = s.cells;
    expect(moon === 0 || sun === 0, `moon and sun at ${s.phase}`).toBe(true);
    // The firefly window, fireflyWeight() in lighting.ts.
    if (flies > 0) expect(s.phase, 'fireflies outside dusk').toBeGreaterThan(0.745);
    if (flies > 0) expect(s.phase, 'fireflies outside dusk').toBeLessThan(0.95);
  }
  expect(all[Math.round(0.83 * STEPS)].cells[2]).toBeGreaterThan(0);
});

test('intensity 0.35 subdues every feature with the rest of the pond', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  // Night (stars, moon), dusk (fireflies), noon (sun glitter).
  for (const phase of [0.95, 0.83, 0.5]) {
    const i = await pond(page, { time: { mode: 'fixed', phase }, sky: true, seed: 42 }, BIG);
    const feature = { 0.95: [M_STAR, M_MOON], 0.83: [M_FLY], 0.5: [M_SUN] }[phase]!;
    const shown = await cells(page, i);
    for (const m of feature) expect(shown.mat.includes(m), `material ${m} at ${phase}`).toBe(true);
    const worst = await page.evaluate((i) => {
      const { core, handle } = window.koiTest.ponds[i];
      const gl = core!.gl;
      const frame = (intensity: number) => {
        handle.setIntensity(intensity);
        if (!core!.redraw()) throw new Error('nothing drawn');
        const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const [full, bg, part] = [frame(1), frame(0), frame(0.35)];
      let worst = 0;
      for (let p = 0; p < full.length; p++) {
        if (p % 4 === 3) continue;
        worst = Math.max(worst, Math.abs(part[p] - (bg[p] + 0.35 * (full[p] - bg[p]))));
      }
      return worst;
    }, i);
    // Every pixel, features included, is 35 % of the way from the background.
    expect(worst, `phase ${phase}`).toBeLessThanOrEqual(1.5);
    await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  }
});

test('setSky and setPalette together, and a context restore, keep the sky', async ({ page }) => {
  await page.setViewportSize({ width: BIG.width, height: BIG.height });
  const i = await pond(page, { time: NIGHT, seed: 42 }, BIG);
  await page.evaluate((i) => {
    const { handle } = window.koiTest.ponds[i];
    handle.setSky({ moon: true, stars: false });
    handle.setPalette('brand');
  }, i);
  const before = await cells(page, i);
  expect(moonCells(before).length).toBeGreaterThan(50);
  expect(starCount(before)).toBe(0);

  await page.evaluate((i) => {
    const ext = window.koiTest.ponds[i].core!.gl.getExtension('WEBGL_lose_context')!;
    Object.assign(window, { koiLoseContext: ext });
    ext.loseContext();
  }, i);
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].core!.renderer === null, i)).toBe(true);
  await page.evaluate(() => (window as unknown as { koiLoseContext: WEBGL_lose_context }).koiLoseContext.restoreContext());
  await expect.poll(() => page.evaluate((i) => window.koiTest.ponds[i].restored, i)).toBe(1);
  await page.evaluate((i) => window.koiTest.ponds[i].handle.pause(), i);
  expect(await page.evaluate((i) => ({ ...window.koiTest.ponds[i].core!.renderer!.sky }), i)).toEqual({
    stars: false,
    fireflies: true,
    darkNight: true,
    moon: true,
    sun: false,
  });
  const after = await cells(page, i);
  expect(moonCells(after).length).toBeGreaterThan(50);
  expect(starCount(after)).toBe(0);
  // Still brand: the moon's commonest colour is the same as before the loss.
  const moonColour = (c: Cells) => {
    const seen = new Map<string, number>();
    for (const k of moonCells(c)) {
      const rgb = c.rgba.slice(k * 4, k * 4 + 3).join();
      seen.set(rgb, (seen.get(rgb) ?? 0) + 1);
    }
    return [...seen].sort((a, b) => b[1] - a[1])[0][0];
  };
  expect(moonColour(after)).toBe(moonColour(before));
  expect(await page.evaluate((i) => window.koiTest.ponds[i].errors, i)).toEqual([]);
});
