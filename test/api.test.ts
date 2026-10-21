import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KoiPond, KoiPondError } from '../src/index';
import { createApi, type KoiApi } from '../demo/debug/api';
import { DEFAULT_SCENE, type PondLook, type SceneState } from '../demo/scene';
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
/** What each mount was given, and what each pond's setters were called with. */
let mounts: { seed: number; look: PondLook }[];
let calls: string[];
let replaceState: ReturnType<typeof vi.fn>;

/** Starts the API on `scene` (the default scene unless a test starts its own). */
function start(scene: SceneState = { ...DEFAULT_SCENE }): void {
  failers = [];
  mounts = [];
  const handle = (): KoiPond => ({
    setTime() {},
    setPalette: (p) => void calls.push(`palette ${String(p)}`),
    setIntensity: (i) => void calls.push(`intensity ${i}`),
    pause() {},
    resume() {},
    destroy: () => void destroyed++,
  });
  koi = createApi({
    container: { getBoundingClientRect: () => ({ width: 800, height: 600 }), style: {} } as unknown as HTMLElement,
    scene,
    mount: (seed, _time, look, onError) => {
      mounts.push({ seed, look });
      failers.push(onError);
      return handle();
    },
  });
}

beforeEach(() => {
  hooks.length = 0;
  destroyed = 0;
  calls = [];
  replaceState = vi.fn();
  vi.stubGlobal('location', { search: '?debug', pathname: '/', hash: '' });
  vi.stubGlobal('history', { state: null, replaceState });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  start();
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
  const up = (drawn: () => boolean, renderer: object | null = {}) => {
    const core = {
      gl: { getExtension: () => null },
      renderer,
      stats: { frames: 0 },
      sky: { phase: 0 },
      pond: { time: 0, fish: [] },
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

  it('does not report a failed pond as context-lost in getState', async () => {
    up(() => false, null);
    failers[0](failure('renderer-failed'));
    expect(await koi.call('getState')).toMatchObject({
      ok: true,
      result: { ready: false, failed: 'renderer-failed happened', contextLost: false },
    });
  });

  it('reports not-ready, not context-lost, for a collapsed pond', async () => {
    up(() => false);
    expect(await koi.call('capture')).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  });
});

describe('palette and intensity', () => {
  /** Brings pond `i` up with a minimal core. */
  const up = (i = 0) =>
    hooks[i].ready?.({
      gl: { getExtension: () => null },
      renderer: {},
      stats: { frames: 0 },
      sky: { phase: 0 },
      pond: { time: 0, fish: [] },
      canvas: {},
      setDpr() {},
    } as unknown as PondCore);

  it('mounts with the scene palette and intensity', () => {
    start({ ...DEFAULT_SCENE, palette: 'paper', intensity: 0.35 });
    expect(mounts.at(-1)!.look).toEqual({ palette: 'paper', intensity: 0.35 });
  });

  it('sets them on the pond, reports them in getState and saves them in the URL', async () => {
    up();
    expect(await koi.call('setPalette', { palette: 'amber' })).toEqual({ ok: true, result: { view: 'final', glow: true, glowAvailable: true, palette: 'amber', intensity: 1 } });
    expect(await koi.call('setIntensity', { intensity: 0.35 })).toMatchObject({ ok: true, result: { palette: 'amber', intensity: 0.35 } });
    expect(calls).toEqual(['palette amber', 'intensity 0.35']);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/?debug&palette=amber&intensity=0.35');
    expect(await koi.call('getState')).toMatchObject({ ok: true, result: { render: { palette: 'amber', intensity: 0.35 } } });
  });

  it('carries them over a reseed', async () => {
    up();
    await koi.call('setPalette', { palette: 'mono' });
    await koi.call('setIntensity', { intensity: 0.5 });
    void koi.call('reseed', { seed: 9 });
    expect(mounts.at(-1)).toEqual({ seed: 9, look: { palette: 'mono', intensity: 0.5 } });
  });

  it('accepts only preset names and intensities in [0, 1]', async () => {
    up();
    expect(await koi.call('setPalette', { palette: 'neon' })).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
    expect(await koi.call('setPalette', { palette: { mode: 'ramp', colors: ['#000', '#fff'] } })).toMatchObject({
      ok: false,
      error: { code: 'invalid-args' },
    });
    expect(await koi.call('setIntensity', { intensity: 1.5 })).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
    expect(await koi.call('setIntensity', {})).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
    expect(calls).toEqual([]);
  });

  it('are listed by help()', () => {
    const help = koi.help();
    expect(help).toContain('setPalette(args)');
    expect(help).toContain('setIntensity(args)');
  });
});
