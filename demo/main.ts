import '@fontsource/jetbrains-mono/latin-600.css';
import './style.css';
import { createKoiPond, type KoiPondTime } from '../src/index';
import { attachHooks, type PondCore } from '../src/internal';
import { PerfMonitor } from './perf';

const container = document.getElementById('pond') as HTMLDivElement;
const fallback = document.getElementById('fallback') as HTMLPreElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

function fail(message: string): void {
  container.hidden = true;
  fallback.hidden = false;
  fallback.textContent = `><(((o>\n\n${message}`;
}

/** Number param, or NaN when missing or blank (Number('') would be 0). */
function num(key: string): number {
  const v = params.get(key);
  return v === null || v.trim() === '' ? NaN : Number(v);
}

/**
 * `?sky=slider&phase=0.8` holds the sky at 0.8; `?sky=loop&cycle=600` loops
 * every 600 s. Anything missing or invalid falls back to the library's 600 s
 * loop from midnight (phase 0, so the pond opens dark and brightens).
 */
function timeFromParams(): KoiPondTime {
  const phase = num('phase');
  if (params.get('sky') === 'slider') return { mode: 'fixed', phase };
  return { mode: 'loop', cycle: num('cycle'), phase };
}

const koi = createKoiPond(container, {
  time: timeFromParams(),
  // Input on the canvas only, so dragging the overlay's slider never steers the fish.
  interactive: 'canvas',
  seed: Number(params.get('seed')) >>> 0 || undefined,
  onError: (error) => {
    console.error(error);
    fail(
      error.code === 'webgl2-unavailable'
        ? 'This pond needs WebGL2, which this browser does not provide.'
        : 'The pond could not start its renderer.',
    );
  },
});

// Keys typed into the overlay's day-length box are its own, not shortcuts.
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement && e.target.type !== 'range';
let perf: PerfMonitor | null = null;
let pondCore: PondCore | null = null;

attachHooks(koi, {
  ready: (core) => {
    pondCore = core;
    const { gl, sky, stats } = core;
    // ?perf (or ?debug) shows the overlay from the start; P toggles it.
    perf = new PerfMonitor(gl, stats, sky, params.has('perf') || debug);
    if (debug) {
      Object.assign(window, {
        __koi: {
          pond: core.pond,
          stats,
          sky,
          get renderer() {
            return core.renderer;
          },
        },
      });
    }
  },
  frame: (intervalMs, now) => perf?.frame(intervalMs, now),
  begin: () => perf?.begin(),
  end: (cpuMs) => perf?.end(cpuMs),
  restored: () => perf?.resetGpu(),
});

window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  if ((e.key === 'p' || e.key === 'P') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) perf?.toggle();
  const renderer = pondCore?.renderer;
  if (debug && e.key === 'r' && renderer) renderer.raw = !renderer.raw;
});
