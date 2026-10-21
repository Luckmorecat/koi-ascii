// Public entry. Every public type lives in this file so the build can ship
// its declarations as a single self-contained dist/index.d.ts (see
// scripts/copy-types.mjs); the implementation is in mount.ts.
import { mount } from './mount';

/**
 * Time of day. Phase runs over [0, 1): 0 midnight, 0.25 sunrise, 0.5 noon,
 * 0.75 sunset.
 * - `loop`: a whole day every `cycle` seconds (default 600, accepted 1 to
 *   86 400), starting at `phase` (default 0).
 * - `fixed`: stays at `phase`.
 * - `clock`: the visitor's local time, local hours / 24 (06:00 is sunrise,
 *   18:00 sunset).
 * Invalid values fall back to the defaults instead of throwing.
 */
export type KoiPondTime =
  | { mode: 'loop'; cycle?: number; phase?: number }
  | { mode: 'fixed'; phase: number }
  | { mode: 'clock' };

/**
 * Where pointer input comes from.
 * - `window`: passive listeners on `window`, mapped into the pond's rect, so
 *   the fish react even when the pond sits behind page content.
 * - `canvas`: listeners on the pond's own canvas (which then also blocks
 *   touch scrolling over it).
 * - `none`: no pointer input.
 */
export type KoiPondInteractive = 'window' | 'canvas' | 'none';

export type KoiPondErrorCode = 'webgl2-unavailable' | 'renderer-failed';

/** Passed to `onError` when the pond can't run; the container then shows `background`. */
export interface KoiPondError extends Error {
  readonly name: 'KoiPondError';
  readonly code: KoiPondErrorCode;
}

export interface KoiPondOptions {
  /** Default `{ mode: 'loop', cycle: 600, phase: 0 }`. */
  time?: KoiPondTime;
  /** Default `'window'`. */
  interactive?: KoiPondInteractive;
  /** Same seed, same fish. Omitted: random on every mount. */
  seed?: number;
  /**
   * CSS font-family for the glyphs. The library loads no fonts; load the
   * face yourself. Default `'"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'`.
   */
  fontFamily?: string;
  /** CSS colour shown before the first frame and if the pond fails. Default `'#06131a'`. */
  background?: string;
  /** Called (asynchronously) when WebGL2 is missing or the renderer fails. */
  onError?: (error: KoiPondError) => void;
}

export interface KoiPond {
  /** Changes the time of day live. A loop without `phase` carries on from the current phase. */
  setTime(time: KoiPondTime): void;
  /** Stops simulating and drawing until `resume()`; combines with the off-screen pause. */
  pause(): void;
  resume(): void;
  /** Stops the pond, removes its canvas and listeners and frees the WebGL context. Safe to call twice. */
  destroy(): void;
}

/**
 * Mounts a koi pond into `container`: appends a canvas that fills it (100% ×
 * 100%) and starts once the font is ready. Size and position the container
 * yourself. Only call this in the browser; importing the module is safe
 * anywhere.
 */
export function createKoiPond(container: HTMLElement, options?: KoiPondOptions | null): KoiPond {
  return mount(container, options ?? {});
}
