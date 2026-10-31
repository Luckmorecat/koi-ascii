// Readability zones (`avoid`, `avoidFade`): page elements the pond fades
// under, so text over it stays readable. The pond measures each element every
// drawn frame (mount.ts) and the shaders thin glyphs under the zones (scene
// pass, scene/avoid.glsl) and dim them toward the background (ascii.frag).
// Option resolution and zone building are pure; AvoidZones holds the list and
// does the DOM reads.
import type { KoiPondAvoid, KoiPondAvoidFade } from './index';
import { warn } from './palette';

/** Zone slots in the shaders (AVOID_MAX there). */
export const AVOID_MAX = 16;
export const DEFAULT_PAD = 12;
export const DEFAULT_FEATHER = 56;
/** Zones this far (CSS px, plus pad and feather) outside the visible canvas still count. */
export const CULL_MARGIN = 50;

/** The fade, decided. */
export interface AvoidFade {
  readonly strength: number;
  readonly feather: number;
}

export const DEFAULT_FADE: AvoidFade = Object.freeze({ strength: 1, feather: DEFAULT_FEATHER });

/**
 * What `strength` does, split by material (A4): water (with ripples, trails
 * and glints) and everything else. Thinning lowers glyph density in the scene
 * pass; dimming fades colour toward the background in the ascii pass. Linear
 * in strength, so 0 is no fade at all.
 */
export interface AvoidAmounts {
  waterThin: number;
  fishThin: number;
  waterDim: number;
  fishDim: number;
}

export function avoidAmounts(strength: number): AvoidAmounts {
  return {
    waterThin: 0.8 * strength,
    fishThin: 0.6 * 0.85 * strength,
    waterDim: 0.6 * strength,
    fishDim: 0.85 * strength,
  };
}

/** A value for a warning message; never throws. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' && value ? 'an object' : String(value);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Resolves `avoidFade` (D9). Fields left out keep `current` (the defaults for
 * the option, the fade in use for setAvoidFade), so animating `strength`
 * keeps a custom feather. `strength` clamps to [0, 1]; a non-finite one, a
 * negative or non-finite feather, or a non-object warn and fall back to the
 * defaults (1 and 56).
 */
export function resolveAvoidFade(input: unknown, current: AvoidFade = DEFAULT_FADE): AvoidFade {
  if (input === undefined || input === null) return current;
  if (typeof input !== 'object' || Array.isArray(input)) {
    warn(`avoidFade must be an object; got ${show(input)}, keeping the fade as it is.`);
    return current;
  }
  const fade = input as KoiPondAvoidFade;
  let { strength, feather } = current;
  if (fade.strength !== undefined) {
    if (!isNumber(fade.strength)) {
      warn(`avoidFade.strength must be a number from 0 to 1; got ${show(fade.strength)}, using ${DEFAULT_FADE.strength}.`);
      strength = DEFAULT_FADE.strength;
    } else {
      strength = Math.min(1, Math.max(0, fade.strength));
      if (strength !== fade.strength) warn(`avoidFade.strength ${fade.strength} is outside [0, 1]; using ${strength}.`);
    }
  }
  if (fade.feather !== undefined) {
    if (!isNumber(fade.feather) || fade.feather < 0) {
      warn(`avoidFade.feather must be a number of CSS px, 0 or more; got ${show(fade.feather)}, using ${DEFAULT_FEATHER}.`);
      feather = DEFAULT_FEATHER;
    } else {
      feather = fade.feather;
    }
  }
  return strength === current.strength && feather === current.feather ? current : { strength, feather };
}

/** An element's border radius as cached: CSS px, or a fraction of the box (`50%`). */
export interface Radius {
  px: number;
  frac: number;
}

export const NO_RADIUS: Radius = Object.freeze({ px: 0, frac: 0 });

/**
 * Parses a computed `border-top-left-radius` ("8px", "50%", "8px 4px" for an
 * ellipse, whose horizontal radius it takes). One radius per zone (M13).
 */
export function parseRadius(css: string | undefined | null): Radius {
  const first = (css ?? '').trim().split(/\s+/)[0] ?? '';
  const n = parseFloat(first);
  if (!Number.isFinite(n) || n <= 0) return NO_RADIUS;
  return first.endsWith('%') ? { px: 0, frac: n / 100 } : { px: n, frac: 0 };
}

/** A box in CSS px, as getBoundingClientRect gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One listed element as measured this frame. */
export interface ZoneSource {
  rect: Box;
  pad: number;
  radius: Radius;
}

/**
 * Builds the frame's zones (A5, A8–A10): each element's box, canvas-relative
 * and grown by its pad, with a corner radius of its border radius plus the
 * pad. Zero-size boxes are skipped, and so are zones outside the visible part
 * of the canvas (its rect ∩ the viewport, `viewW` × `viewH`) grown by
 * CULL_MARGIN plus the feather. Past AVOID_MAX zones, the first in list
 * order win. Writes `rects` (x, y, w, h per zone) and `radii` (one per zone),
 * all in world px: the canvas's CSS px, whatever the device pixel ratio or
 * backing-store size. Returns the zones written and the visible ones dropped.
 */
export function buildZones(
  sources: readonly ZoneSource[],
  canvas: Box,
  viewW: number,
  viewH: number,
  feather: number,
  rects: Float32Array,
  radii: Float32Array,
): { count: number; dropped: number } {
  const reach = CULL_MARGIN + feather;
  const x0 = Math.max(canvas.left, 0) - reach;
  const y0 = Math.max(canvas.top, 0) - reach;
  const x1 = Math.min(canvas.left + canvas.width, viewW) + reach;
  const y1 = Math.min(canvas.top + canvas.height, viewH) + reach;
  let count = 0;
  let dropped = 0;
  for (const { rect, pad, radius } of sources) {
    // Hidden (display: none) or detached: zero size. NaN fails too.
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const left = rect.left - pad;
    const top = rect.top - pad;
    const w = rect.width + 2 * pad;
    const h = rect.height + 2 * pad;
    if (left + w < x0 || left > x1 || top + h < y0 || top > y1) continue;
    if (count === AVOID_MAX) {
      dropped++;
      continue;
    }
    rects[count * 4] = left - canvas.left;
    rects[count * 4 + 1] = top - canvas.top;
    rects[count * 4 + 2] = w;
    rects[count * 4 + 3] = h;
    radii[count] = radius.px + radius.frac * Math.min(rect.width, rect.height) + pad;
    count++;
  }
  return { count, dropped };
}

/** A listed element, resolved, with what the pond caches about it. */
interface Entry extends ZoneSource {
  element: Element;
  /**
   * Zero size (or detached) when last seen: its radius is re-read once it
   * has a size again (R1), since a detached element has no computed style.
   */
  zero: boolean;
}

const isElement = (v: unknown): v is Element =>
  !!v && typeof v === 'object' && typeof (v as Element).getBoundingClientRect === 'function' && 'isConnected' in v;

/**
 * Validates an `avoid` list (M4): not an array warns and is empty; an entry
 * that is neither an Element nor `{ element, pad? }` (null, a DOMRect, a
 * string) warns and is skipped. A bad pad warns and falls back to 12 (D9).
 */
export function resolveAvoidList(input: unknown): { element: Element; pad: number }[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    warn(`avoid must be an array of elements; got ${show(input)}, avoiding nothing.`);
    return [];
  }
  const out: { element: Element; pad: number }[] = [];
  input.forEach((item: unknown, i) => {
    if (isElement(item)) {
      out.push({ element: item, pad: DEFAULT_PAD });
      return;
    }
    const entry = item as Exclude<KoiPondAvoid, Element> | null;
    if (!entry || typeof entry !== 'object' || !isElement(entry.element)) {
      warn(`avoid[${i}] must be an Element or { element, pad }; got ${show(item)}, skipping it.`);
      return;
    }
    let pad = DEFAULT_PAD;
    if (entry.pad !== undefined) {
      if (isNumber(entry.pad) && entry.pad >= 0) pad = entry.pad;
      else warn(`avoid[${i}].pad must be a number of CSS px, 0 or more; got ${show(entry.pad)}, using ${DEFAULT_PAD}.`);
    }
    out.push({ element: entry.element, pad });
  });
  return out;
}

const readRadius = (el: Element): Radius => parseRadius(getComputedStyle(el).borderTopLeftRadius);

/**
 * The pond's zone list. Holds its elements until set() replaces them or
 * clear() (destroy, failure) drops them. Reads `border-radius` only in
 * set() and readRadii() (mount and pond resize), and once more for an
 * element coming back from zero size (R1); never per frame otherwise.
 */
export class AvoidZones {
  readonly rects = new Float32Array(AVOID_MAX * 4);
  readonly radii = new Float32Array(AVOID_MAX);
  private entries: Entry[] = [];
  /** The cap warning has been given for this list. */
  private warned = false;

  get size(): number {
    return this.entries.length;
  }

  /** Replaces the list; `read`: read the radii now (setAvoid), not at the next resize (mount). */
  set(list: unknown, read = true): void {
    this.entries = resolveAvoidList(list).map(({ element, pad }) => ({
      element,
      pad,
      rect: { left: 0, top: 0, width: 0, height: 0 },
      radius: NO_RADIUS,
      zero: false,
    }));
    this.warned = false;
    if (read) this.readRadii();
  }

  clear(): void {
    this.entries = [];
  }

  /** Re-reads every element's border radius (mount, pond resize). */
  readRadii(): void {
    for (const e of this.entries) {
      e.radius = readRadius(e.element);
      e.zero = !e.element.isConnected;
    }
  }

  /**
   * Measures every element against the canvas's rect, writes `rects` and
   * `radii`, and returns the zone count. Warns once per list when visible
   * zones were dropped past AVOID_MAX.
   */
  measure(canvas: Box, viewW: number, viewH: number, feather: number): number {
    for (const e of this.entries) {
      e.rect = e.element.getBoundingClientRect();
      const zero = !(e.rect.width > 0 && e.rect.height > 0);
      if (!zero && e.zero) e.radius = readRadius(e.element);
      e.zero = zero;
    }
    const { count, dropped } = buildZones(this.entries, canvas, viewW, viewH, feather, this.rects, this.radii);
    if (dropped > 0 && !this.warned) {
      this.warned = true;
      warn(`avoid: ${count + dropped} zones are visible but the pond has ${AVOID_MAX} slots; the first ${AVOID_MAX} in list order are used.`);
    }
    return count;
  }
}
