// Source-only hooks for the demo's perf overlay and debug tools. Not part of
// the package's exports or its declarations: the library build only reaches
// `register`, and nothing here is re-exported from index.ts.
import type { KoiPond } from './index';
import type { Pond } from './pond';
import type { Renderer } from './renderer';
import type { Sky } from './sky';

export { DAY_PARTS, dayPartAt, type DayPart } from './lighting';
export { LoopSource, MAX_CYCLE_S, MIN_CYCLE_S, type Sky } from './sky';

export interface PondStats {
  fps: number;
  frameMs: number;
  /** Frames simulated and drawn so far, by the frame loop and by step(). */
  frames: number;
  seed: number;
  gpu: string;
  software: boolean;
}

/** A running pond's internals, available once its renderer is up. */
export interface PondCore {
  readonly gl: WebGL2RenderingContext;
  readonly pond: Pond;
  readonly sky: Sky;
  /** Null while the WebGL context is lost. */
  readonly renderer: Renderer | null;
  readonly stats: PondStats;
  /** The pond's canvas (replaced by a blank one if the pond fails). */
  readonly canvas: HTMLCanvasElement;
  /**
   * Simulates and draws one frame of `dt` seconds now, outside the frame
   * loop, so it works while paused or in a background tab. Returns false
   * when nothing could be drawn (context lost, pond collapsed or failed).
   */
  step(dt: number): boolean;
  /**
   * Draws the current state again without advancing anything. The drawing
   * buffer stays readable (toDataURL) until the task ends, so a capture needs
   * no preserveDrawingBuffer. Returns false like step().
   */
  redraw(): boolean;
  /** Overrides window.devicePixelRatio for sizing the canvas (null restores it) and re-measures the canvas now. */
  setDpr(dpr: number | null): void;
}

/** Called from the pond's frame loop at the points the perf overlay measures. */
export interface PondHooks {
  /** Once, when the renderer first comes up. */
  ready?(core: PondCore): void;
  /** Start of a drawn frame: interval since the previous one, in ms. */
  frame?(intervalMs: number, now: number): void;
  /** Brackets the simulation + GPU submit of a frame. */
  begin?(): void;
  end?(cpuMs: number): void;
  /** After a lost WebGL context came back with a new renderer. */
  restored?(): void;
}

export interface PondSlot {
  hooks: PondHooks;
  core: PondCore | null;
}

const slots = new WeakMap<KoiPond, PondSlot>();

/** Called by createKoiPond for every instance. */
export function register(handle: KoiPond): PondSlot {
  const slot: PondSlot = { hooks: {}, core: null };
  slots.set(handle, slot);
  return slot;
}

/** Attaches the demo's hooks; `ready` runs now if the pond is already up. */
export function attachHooks(handle: KoiPond, hooks: PondHooks): void {
  const slot = slots.get(handle);
  if (!slot) return;
  slot.hooks = hooks;
  if (slot.core) hooks.ready?.(slot.core);
}
