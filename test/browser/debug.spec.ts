import { expect, test, type Page } from '@playwright/test';
import type { CallResult } from '../../demo/debug/api';

// The demo's ?debug layer (demo/debug/): window.koi and its panel.
const DEMO = '/demo/index.html';

/** window.koi's generated methods, which its type only knows as `unknown`. */
type Tools = Record<string, (args?: unknown) => Promise<any>>;

/** Opens the demo with ?debug (plus `query`) and waits until koi's pond is up. */
async function openDebug(page: Page, query = ''): Promise<void> {
  await page.goto(`${DEMO}?debug${query}`);
  await page.waitForFunction(() => !!window.koi); // the debug chunk loads on demand
  await page.evaluate(() => window.koi!.ready);
}

/** Largest per-channel distance of any pixel of a PNG data URL from `rgb`. */
function farthestFrom(page: Page, dataUrl: string, rgb: [number, number, number]): Promise<number> {
  return page.evaluate(
    async ([dataUrl, rgb]) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      let far = 0;
      for (let p = 0; p < px.length; p += 4) {
        for (let k = 0; k < 3; k++) far = Math.max(far, Math.abs(px[p + k] - rgb[k]));
      }
      return far;
    },
    [dataUrl, rgb] as const,
  );
}

const PAPER: [number, number, number] = [0xf3, 0xef, 0xe6];
const MONO_BG: [number, number, number] = [0x0b, 0x0b, 0x0b];

let errors: string[];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('without ?debug: no window.koi, no panel, no debug code', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(DEMO);
  await page.waitForSelector('#pond canvas', { timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('p');
  expect(await page.evaluate(() => typeof window.koi)).toBe('undefined');
  await expect(page.locator('#koi-debug')).toHaveCount(0);
  expect(requests.filter((u) => u.includes('/demo/debug/'))).toEqual([]);
});

test('with ?debug: koi.ready resolves and tools() lists every tool with a schema', async ({ page }) => {
  await openDebug(page);
  await expect(page.locator('#koi-debug')).toBeVisible();
  const tools = await page.evaluate(() => window.koi!.tools());
  const names = tools.map((t) => t.name);
  for (const n of ['getState', 'setTime', 'reseed', 'step', 'capture', 'setViewport', 'getPerf', 'setRender', 'setPalette', 'setIntensity']) {
    expect(names).toContain(n);
  }
  for (const t of tools) {
    expect(t.description, t.name).toBeTruthy();
    expect(t.inputSchema.type, t.name).toBe('object');
    expect(t.inputSchema.additionalProperties, t.name).toBe(false);
    for (const r of t.inputSchema.required ?? []) expect(t.inputSchema.properties, t.name).toHaveProperty(r);
  }
  const help = await page.evaluate(() => window.koi!.help());
  for (const n of names) expect(help).toContain(`${n}(`);
});

test('call() resolves with errors instead of rejecting', async ({ page }) => {
  await openDebug(page);
  const r = await page.evaluate(async () => {
    const k = window.koi!;
    return {
      nope: await k.call('nope'),
      phase: await k.call('setTime', { phase: 2 }),
      type: await k.call('setRender', { glow: 'yes' }),
      extra: await k.call('step', { frame: 3 }),
      notObject: await k.call('step', 5),
    };
  });
  const error = (c: CallResult) => (c.ok ? null : c.error);
  expect(error(r.nope)?.code).toBe('unknown-tool');
  for (const [c, path] of [
    [r.phase, 'args.phase'],
    [r.type, 'args.glow'],
    [r.extra, 'args.frame'],
  ] as const) {
    expect(error(c)?.code).toBe('invalid-args');
    expect(error(c)?.message).toContain(path);
  }
  expect(error(r.notObject)?.code).toBe('invalid-args');
  // The generated methods reject with the same error object.
  const rejected = await page.evaluate(() => (window.koi as unknown as Tools).setTime({ phase: 2 }).catch((e) => e));
  expect(rejected).toEqual(error(r.phase));
});

test('setTime to a fixed phase writes the URL and survives a reload', async ({ page }) => {
  await openDebug(page);
  await page.evaluate(() => (window.koi as unknown as Tools).setTime({ mode: 'fixed', phase: 0.8 }));
  const search = new URL(page.url()).searchParams;
  expect(search.get('time')).toBe('fixed');
  expect(search.get('phase')).toBe('0.8');
  await page.reload();
  await page.waitForFunction(() => !!window.koi);
  await page.evaluate(() => window.koi!.ready);
  const time = await page.evaluate(async () => (await (window.koi as unknown as Tools).getState()).time);
  expect(time).toMatchObject({ mode: 'fixed', phase: 0.8 });
});

test('pinned viewport + reseed + step + capture is reproducible; another seed differs', async ({ page }) => {
  await openDebug(page, '&time=fixed&phase=0.5');
  const r = await page.evaluate(async () => {
    const k = window.koi as unknown as Tools;
    await k.setViewport({ width: 800, height: 600, dpr: 1 });
    const frame = async (seed: number) => {
      await k.reseed({ seed });
      await k.step({ frames: 120 });
      return (await k.capture()) as { dataUrl: string; width: number; height: number };
    };
    const a = await frame(77);
    const b = await frame(77);
    const c = await frame(78);
    return { a, same: a.dataUrl === b.dataUrl, otherSeedDiffers: a.dataUrl !== c.dataUrl };
  });
  expect(r.a.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  expect([r.a.width, r.a.height]).toEqual([800, 600]);
  expect(r.same).toBe(true);
  expect(r.otherSeedDiffers).toBe(true);
});

test('step pauses and advances the frame counter exactly', async ({ page }) => {
  await openDebug(page);
  const r = await page.evaluate(async () => {
    const k = window.koi as unknown as Tools;
    const wasPaused = (await k.getState()).paused as boolean;
    const first = await k.step(); // pauses a running loop, then draws one frame
    const paused = (await k.getState()).paused as boolean;
    const stepped = await k.step({ frames: 10 });
    const after = (await k.getState()).frame as number;
    await new Promise((done) => setTimeout(done, 300));
    const later = (await k.getState()).frame as number;
    return { wasPaused, paused, first, stepped, after, later };
  });
  expect(r.wasPaused).toBe(false);
  expect(r.paused).toBe(true);
  expect(r.stepped.frame).toBe(r.first.frame + 10);
  expect(r.after).toBe(r.stepped.frame);
  expect(r.later).toBe(r.stepped.frame); // still paused
  await page.evaluate(() => (window.koi as unknown as Tools).resume());
  await expect.poll(() => page.evaluate(async () => (await (window.koi as unknown as Tools).getState()).frame)).toBeGreaterThan(r.later);
});

test('context loss and restore each emit a change event', async ({ page }) => {
  await openDebug(page);
  await page.evaluate(() => {
    const seen: { tool: string | null; contextLost: boolean }[] = [];
    window.koi!.on('change', (e) => seen.push({ tool: e.tool, contextLost: e.state.contextLost }));
    const ext = document.querySelector<HTMLCanvasElement>('#pond canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    Object.assign(window, { koiSeen: seen, koiLoseContext: ext });
    ext.loseContext();
  });
  const seen = () => page.evaluate(() => (window as unknown as { koiSeen: unknown[] }).koiSeen);
  await expect.poll(seen).toEqual([{ tool: null, contextLost: true }]);
  await page.evaluate(() => (window as unknown as { koiLoseContext: WEBGL_lose_context }).koiLoseContext.restoreContext());
  await expect.poll(seen).toEqual([
    { tool: null, contextLost: true },
    { tool: null, contextLost: false },
  ]);
});

test('?palette and ?intensity work without ?debug', async ({ page }) => {
  await page.goto(`${DEMO}?palette=paper&intensity=0`);
  const canvas = page.locator('#pond canvas');
  await canvas.waitFor({ timeout: 15_000 });
  // Intensity 0: nothing but the paper background, once the first frame is up.
  await expect
    .poll(async () => farthestFrom(page, `data:image/png;base64,${(await canvas.screenshot()).toString('base64')}`, PAPER), {
      timeout: 15_000,
    })
    .toBeLessThanOrEqual(1);
});

test('setPalette and setIntensity: URL, state, panel controls and a reseed', async ({ page }) => {
  await openDebug(page, '&palette=paper&intensity=0');
  const capture = () => page.evaluate(async () => ((await (window.koi as unknown as Tools).capture()) as { dataUrl: string }).dataUrl);
  expect(await page.evaluate(async () => (await (window.koi as unknown as Tools).getState()).render)).toMatchObject({
    palette: 'paper',
    intensity: 0,
  });
  expect(await farthestFrom(page, await capture(), PAPER)).toBeLessThanOrEqual(1);

  // The panel's controls show the state and drive the tools.
  const select = page.locator('#koi-debug select').filter({ has: page.locator('option[value="phosphor"]') });
  await expect(select).toHaveValue('paper');
  await select.selectOption('mono');
  await expect.poll(() => new URL(page.url()).searchParams.get('palette')).toBe('mono');
  expect(await farthestFrom(page, await capture(), MONO_BG)).toBeLessThanOrEqual(1);

  // The panel's intensity slider drives setIntensity live.
  const slider = page.locator('#koi-debug label').filter({ hasText: 'intensity' }).locator('input[type=range]');
  await expect(slider).toHaveValue('0');
  await slider.fill('0.35');
  await expect.poll(() => new URL(page.url()).searchParams.get('intensity')).toBe('0.35');
  expect(await page.evaluate(async () => (await (window.koi as unknown as Tools).getState()).render)).toMatchObject({
    palette: 'mono',
    intensity: 0.35,
  });

  // Both survive a reseed, and a non-zero intensity draws the pond again.
  const r = await page.evaluate(async () => {
    const k = window.koi as unknown as Tools;
    await k.reseed({ seed: 5 });
    return (await k.getState()).render;
  });
  expect(r).toMatchObject({ palette: 'mono', intensity: 0.35 });
  expect(new URL(page.url()).searchParams.get('intensity')).toBe('0.35');
  expect(await farthestFrom(page, await capture(), MONO_BG)).toBeGreaterThan(10);
});
