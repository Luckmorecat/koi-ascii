import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KoiPond, KoiPondError } from '../src/index';
import { createApi, type KoiApi } from '../demo/debug/api';
import { DEFAULT_SCENE } from '../demo/scene';
import type { PondCore, PondHooks } from '../src/internal';

// Captures the API's hooks so a test can bring a stand-in pond up.
const hooks: PondHooks[] = [];
vi.mock('../src/internal', async (actual) => ({
  ...(await actual<typeof import('../src/internal')>()),
  attachHooks: (_handle: unknown, h: PondHooks) => void hooks.push(h),
}));

// The API with a stand-in for the page's mount: ponds that never come up
// unless a test fails them, which is all call() and reseed need here.
let failers: ((e: KoiPondError) => void)[];
let destroyed: number;
let koi: KoiApi;

beforeEach(() => {
  hooks.length = 0;
  failers = [];
  destroyed = 0;
  vi.stubGlobal('location', { search: '?debug', pathname: '/', hash: '' });
  vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const handle = (): KoiPond => ({ setTime() {}, pause() {}, resume() {}, destroy: () => void destroyed++ });
  koi = createApi({
    container: { getBoundingClientRect: () => ({ width: 800, height: 600 }), style: {} } as unknown as HTMLElement,
    scene: { ...DEFAULT_SCENE },
    mount: (_seed, _time, onError) => {
      failers.push(onError);
      return handle();
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const failure = (code: string) => Object.assign(new Error(`${code} happened`), { name: 'KoiPondError' as const, code }) as KoiPondError;

describe('koi.call', () => {
  it('resolves for odd names and args instead of rejecting', async () => {
    expect(await koi.call(1n as never)).toMatchObject({ ok: false, error: { code: 'unknown-tool', message: 'No tool 1; koi.tools() lists them.' } });
    expect(await koi.call(undefined as never)).toMatchObject({ ok: false, error: { code: 'unknown-tool' } });
    const trap = new Proxy({}, { ownKeys: () => { throw new Error('trap'); } });
    expect(await koi.call('step', trap)).toEqual({ ok: false, error: { code: 'internal', message: 'trap' } });
    expect(await koi.call('step', { frames: 1n })).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
  });

  it('reports a pond that is not up yet', async () => {
    expect(await koi.call('capture')).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    expect(await koi.call('getState')).toMatchObject({ ok: true, result: { ready: false } });
  });
});

describe('reseed', () => {
  it('settles a reseed that a later one supersedes before its pond is up', async () => {
    const first = koi.call('reseed', { seed: 1 });
    const second = koi.call('reseed', { seed: 2 });
    // The second pond fails, so its call can settle in this test.
    failers[2](failure('renderer-failed'));
    expect(await first).toEqual({
      ok: false,
      error: { code: 'not-ready', message: 'Superseded by a later reseed before it was up.' },
    });
    expect(await second).toMatchObject({ ok: false, error: { code: 'pond-failed' } });
    expect(destroyed).toBe(2);
  });

  it('rejects koi.ready of a pond replaced before it was up', async () => {
    const ready = koi.ready;
    void koi.call('reseed', { seed: 3 });
    await expect(ready).rejects.toMatchObject({ code: 'not-ready' });
  });
});

describe('a manual draw that draws nothing', () => {
  /** Brings the first pond up with a core whose draws return `drawn()`. */
  const up = (drawn: () => boolean) => {
    const core = {
      gl: { getExtension: () => null },
      renderer: {},
      stats: { frames: 0 },
      sky: { phase: 0 },
      pond: { time: 0 },
      canvas: {},
      step: drawn,
      redraw: drawn,
      setDpr() {},
    } as unknown as PondCore;
    hooks[0].ready?.(core);
  };

  it('reports pond-failed when the draw failed the pond', async () => {
    // The library fails the pond (calling onError) before step()/redraw() return false.
    up(() => {
      failers[0](failure('renderer-failed'));
      return false;
    });
    expect(await koi.call('step')).toMatchObject({ ok: false, error: { code: 'pond-failed' } });
  });

  it('reports pond-failed from capture too', async () => {
    up(() => {
      failers[0](failure('renderer-failed'));
      return false;
    });
    expect(await koi.call('capture')).toMatchObject({ ok: false, error: { code: 'pond-failed' } });
  });

  it('reports not-ready, not context-lost, for a collapsed pond', async () => {
    up(() => false);
    expect(await koi.call('capture')).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  });
});
