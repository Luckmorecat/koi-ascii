// Mounts ponds for the Playwright specs. Everything goes through
// `window.koiTest` so the specs drive it with page.evaluate.
import { createKoiPond, type KoiPond, type KoiPondOptions } from '../../../src/index';
import { attachHooks, type PondCore } from '../../../src/internal';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Mounted {
  container: HTMLDivElement;
  handle: KoiPond;
  core: PondCore | null;
  frames: number;
  restored: number;
  errors: string[];
  /** Pond-space (CSS px) points the pond received, newest last. */
  moves: [number, number][];
}

/** Absolutely positioned container at `box` (CSS px), appended to body. */
function container(box: Box): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pond';
  Object.assign(el.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  document.body.append(el);
  return el;
}

const ponds: Mounted[] = [];

function mount(box: Box, options: KoiPondOptions = {}): number {
  const el = container(box);
  const m: Mounted = { container: el, handle: null!, core: null, frames: 0, restored: 0, errors: [], moves: [] };
  m.handle = createKoiPond(el, {
    seed: 1,
    ...options,
    onError: (error) => m.errors.push(`${error.code}: ${error.message}`),
  });
  attachHooks(m.handle, {
    ready: (core) => {
      m.core = core;
      const move = core.pond.pointerMove.bind(core.pond);
      core.pond.pointerMove = (x, y, stamp) => {
        m.moves.push([x, y]);
        move(x, y, stamp);
      };
    },
    frame: () => m.frames++,
    restored: () => m.restored++,
  });
  ponds.push(m);
  return ponds.length - 1;
}

const koiTest = { container, mount, ponds };
declare global {
  interface Window {
    koiTest: typeof koiTest;
  }
}
window.koiTest = koiTest;
