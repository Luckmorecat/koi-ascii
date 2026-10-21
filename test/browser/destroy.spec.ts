import { expect, test, type Page, type Route } from '@playwright/test';
import { framesDuring, mount, open, running } from './helpers';

interface Live {
  listeners: string[];
  observed: number;
  webglContexts: number;
}

declare global {
  interface Window {
    koiLive: () => Live;
  }
}

/**
 * Runs before any page script: tracks every listener still attached (removed
 * by removeEventListener or by its AbortSignal), every element an observer
 * still watches, and every WebGL context asked for.
 */
function instrument(): void {
  type Entry = { target: EventTarget; type: string; listener: unknown; capture: boolean };
  const listeners = new Set<Entry>();
  const observed = new Map<object, Set<Element>>();
  let webglContexts = 0;

  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const captures = (options?: boolean | EventListenerOptions) =>
    typeof options === 'boolean' ? options : !!options?.capture;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const signal = typeof options === 'object' ? options.signal : undefined;
    if (listener && !signal?.aborted) {
      const capture = captures(options);
      const dup = [...listeners].some(
        (e) => e.target === this && e.type === type && e.listener === listener && e.capture === capture,
      );
      if (!dup) {
        const entry = { target: this, type, listener, capture };
        listeners.add(entry);
        if (signal) add.call(signal, 'abort', () => listeners.delete(entry), { once: true });
      }
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = captures(options);
    for (const e of listeners) {
      if (e.target === this && e.type === type && e.listener === listener && e.capture === capture) listeners.delete(e);
    }
    return remove.call(this, type, listener, options);
  };

  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    const Base = window[name] as unknown as new (...args: any[]) => ResizeObserver & IntersectionObserver;
    const Tracked = class extends Base {
      observe(target: Element, options?: any) {
        if (!observed.has(this)) observed.set(this, new Set());
        observed.get(this)!.add(target);
        super.observe(target, options);
      }
      unobserve(target: Element) {
        observed.get(this)?.delete(target);
        super.unobserve(target);
      }
      disconnect() {
        observed.delete(this);
        super.disconnect();
      }
    };
    Object.defineProperty(window, name, { value: Tracked, configurable: true, writable: true });
  }

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
    if (id === 'webgl2' || id === 'webgl') webglContexts++;
    return (getContext as (...a: unknown[]) => RenderingContext | null).call(this, id, ...rest);
  } as typeof getContext;

  const describe = (t: EventTarget) =>
    t === window ? 'window' : t === document ? 'document' : t instanceof Element ? t.tagName.toLowerCase() : String(t);
  window.koiLive = () => ({
    listeners: [...listeners].map((e) => `${describe(e.target)} ${e.type}`),
    observed: [...observed.values()].reduce((n, s) => n + s.size, 0),
    webglContexts,
  });
}

const live = (page: Page) => page.evaluate(() => window.koiLive());

test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrument);
});

test('destroy removes every listener, observer, frame and the canvas', async ({ page }) => {
  await open(page);
  const baseline = await live(page);
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 }, { interactive: 'window' });
  await running(page, i);

  const mounted = await live(page);
  // Sanity: the instrumentation sees what the pond adds.
  expect(mounted.listeners.length).toBeGreaterThan(baseline.listeners.length);
  expect(mounted.observed).toBeGreaterThan(baseline.observed);

  await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  expect(await live(page)).toEqual({ ...baseline, webglContexts: mounted.webglContexts });
  expect(await framesDuring(page, i)).toBe(0);
  const after = await page.evaluate((i) => {
    const { container, core } = window.koiTest.ponds[i];
    return { children: container.childNodes.length, contextLost: core!.gl.isContextLost() };
  }, i);
  expect(after).toEqual({ children: 0, contextLost: true });
  // Twice is safe.
  await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
});

test('destroy with canvas input removes the canvas listeners too', async ({ page }) => {
  await open(page);
  const baseline = await live(page);
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 }, { interactive: 'canvas' });
  await running(page, i);
  expect((await live(page)).listeners).toContain('canvas pointermove');
  await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  expect((await live(page)).listeners).toEqual(baseline.listeners);
  expect((await live(page)).observed).toBe(baseline.observed);
});

test('destroy before the font has loaded never starts the pond', async ({ page }) => {
  let held: Route | null = null;
  await page.route('**/__slow-font.woff2', (route) => {
    held = route;
  });
  await open(page);
  const baseline = await live(page);
  const fontRequested = page.waitForRequest('**/__slow-font.woff2');
  const i = await mount(page, { left: 0, top: 0, width: 400, height: 300 }, { fontFamily: 'KoiSlowFont' });
  await fontRequested;
  await page.evaluate((i) => window.koiTest.ponds[i].handle.destroy(), i);
  expect(held).not.toBeNull();
  await held!.fulfill({ status: 404 });
  // Give the font promise and any would-be start time to settle.
  await page.waitForTimeout(500);

  expect(await live(page)).toEqual(baseline);
  const state = await page.evaluate((i) => {
    const { container, core, frames, errors } = window.koiTest.ponds[i];
    return { children: container.childNodes.length, ready: !!core, frames, errors };
  }, i);
  expect(state).toEqual({ children: 0, ready: false, frames: 0, errors: [] });
});
