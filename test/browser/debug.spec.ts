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
  for (const n of ['getState', 'setTime', 'reseed', 'step', 'capture', 'setViewport', 'getPerf', 'setRender']) {
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
