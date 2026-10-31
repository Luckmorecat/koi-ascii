// Public entry. Every public type lives in this file so the build can ship
// its declarations as a single self-contained dist/index.d.ts (see
// scripts/copy-types.mjs); the implementation is in mount.ts.
import { mount } from './mount';
import { PRESETS } from './palette';

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

/** Any CSS colour, parsed by the browser. Alpha is ignored; `var()` is not supported. */
export type KoiPondColor = string;

export type KoiPondPaletteName = 'pond' | 'mono' | 'phosphor' | 'amber' | 'paper' | 'brand';

/** Gradient map: brightness picks a colour along `colors`, background first. */
export interface KoiPondRampPalette {
  mode: 'ramp';
  /** 2 to 5 stops, evenly spaced. */
  colors: KoiPondColor[];
}

/** Named slots: each glyph takes the colour of what it draws. */
export interface KoiPondRolesPalette {
  mode: 'roles';
  background: KoiPondColor;
  /** Deep water and ripples are derived from it. */
  water?: KoiPondColor;
  /** Glints, crests, eyes. */
  highlight?: KoiPondColor;
  fish?: {
    /** White scales. */
    pale?: KoiPondColor;
    /** Black patches (Showa sumi). */
    ink?: KoiPondColor;
    /** Red markings (Kohaku/Showa hi). */
    accent?: KoiPondColor;
    /** Ogon gold. */
    metallic?: KoiPondColor;
  };
}

/** Colour filter over today's pond; keeps its hues. */
export interface KoiPondFilterPalette {
  mode: 'filter';
  background?: KoiPondColor;
  /** Default `'#ffffff'`. */
  tint?: KoiPondColor;
  /** 0 grey … 1 original (default). */
  saturation?: number;
  /** Dark glyphs on light, hues kept. */
  invert?: boolean;
}

/**
 * A preset name or a palette object; `mode` picks how it recolours the pond.
 * Invalid fields fall back one by one with a `console.warn` (never a throw);
 * an unknown preset or mode falls back to `'pond'`.
 */
export type KoiPondPalette = KoiPondPaletteName | KoiPondRampPalette | KoiPondRolesPalette | KoiPondFilterPalette;

/**
 * Night-sky features, each on or off. Omitted fields keep their defaults:
 * `stars`, `fireflies` and `darkNight` on, `moon` and `sun` off.
 */
export interface KoiPondSkyFeatures {
  /** Reflected stars at night. */
  stars?: boolean;
  /** Fireflies at dusk, over the fish. */
  fireflies?: boolean;
  /** Darker water, fewer caustics and a darker background at night, on dark palettes only. */
  darkNight?: boolean;
  /** The moon's reflection at night. */
  moon?: boolean;
  /** The sun's reflection on the water by day, as glitter. */
  sun?: boolean;
}

/**
 * The night sky. `true` turns every feature on, `false` every one off (the
 * pond as it was in 0.1); an object changes only the features it names.
 * Invalid values fall back one by one with a `console.warn` (never a throw).
 */
export type KoiPondSky = boolean | KoiPondSkyFeatures;

/**
 * A page element the pond fades under, so content over it stays readable:
 * the element itself, or `{ element, pad }` with `pad` the CSS px the zone
 * extends past the element's box on every side (default 12). The zone's
 * corners follow the element's `border-radius` plus `pad`. The pond measures
 * every listed element on each frame it draws, so scrolling, resizing,
 * transforms and animations need nothing more; an element that measures zero
 * size (hidden, detached) is skipped until it has a size again. The pond
 * keeps its references until `setAvoid` replaces the list or `destroy()`.
 */
export type KoiPondAvoid = Element | { element: Element; pad?: number };

/** How the pond fades under the `avoid` zones. */
export interface KoiPondAvoidFade {
  /** 0 off … 1 the tuned look (default). Scales every fade amount together. */
  strength?: number;
  /** Width of the soft edge in CSS px. Default 56. */
  feather?: number;
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
  /** Default `'pond'`. */
  palette?: KoiPondPalette;
  /** 0 leaves only the background, 1 is the full pond (linear). Default 1. */
  intensity?: number;
  /** Default: stars, fireflies and the darker night on; moon and sun off. */
  sky?: KoiPondSky;
  /**
   * Page elements to fade under (hero text, cards), up to 16 visible at once:
   * past that the first 16 in list order are used. Default none.
   * Invalid entries are skipped with a `console.warn`.
   */
  avoid?: KoiPondAvoid[];
  /** Default `{ strength: 1, feather: 56 }`; invalid values fall back with a `console.warn`. */
  avoidFade?: KoiPondAvoidFade;
  /**
   * CSS colour shown before the first frame and if the pond fails. Default:
   * the palette's background (and it follows `setPalette`).
   */
  background?: string;
  /** Called (asynchronously) when WebGL2 is missing or the renderer fails. */
  onError?: (error: KoiPondError) => void;
}

export interface KoiPond {
  /** Changes the time of day live. A loop without `phase` carries on from the current phase. */
  setTime(time: KoiPondTime): void;
  /** Changes the palette from the next frame on; the fish carry on. */
  setPalette(palette: KoiPondPalette): void;
  /** Changes the intensity from the next frame on; animate it for a fade. */
  setIntensity(intensity: number): void;
  /** Changes the night-sky features from the next frame on, as the `sky` option would; the fish carry on. */
  setSky(sky: KoiPondSky): void;
  /** Replaces the zone list from the next frame on. */
  setAvoid(list: KoiPondAvoid[]): void;
  /**
   * Changes the fade from the next frame on; animate `strength` to fade it in
   * or out. Fields left out keep their current values.
   */
  setAvoidFade(fade: KoiPondAvoidFade): void;
  /** Stops simulating and drawing until `resume()`; combines with the off-screen pause. */
  pause(): void;
  resume(): void;
  /** Stops the pond, removes its canvas and listeners and frees the WebGL context. Safe to call twice. */
  destroy(): void;
}

/**
 * A roles preset as frozen in `koiPalettes`, `fish` included. Still assignable
 * to `KoiPondRolesPalette`. (A ramp's `colors` stays typed as a plain array so
 * a preset can be passed as a palette, but it is frozen too.)
 */
type FrozenRoles = Readonly<KoiPondRolesPalette> & { readonly fish?: Readonly<NonNullable<KoiPondRolesPalette['fish']>> };

/**
 * Frozen preset definitions, for copying and tweaking:
 * `{ ...koiPalettes.paper, fish: { ...koiPalettes.paper.fish, accent: '#0a7' } }`.
 * Each preset keeps its own palette type, so its fields can be spread.
 */
export const koiPalettes: {
  readonly pond: Readonly<KoiPondFilterPalette>;
  readonly mono: Readonly<KoiPondRampPalette>;
  readonly phosphor: Readonly<KoiPondRampPalette>;
  readonly amber: Readonly<KoiPondRampPalette>;
  readonly paper: FrozenRoles;
  readonly brand: FrozenRoles;
} = PRESETS;

/**
 * Mounts a koi pond into `container`: appends a canvas that fills it (100% ×
 * 100%) and starts once the font is ready. Size and position the container
 * yourself. Only call this in the browser; importing the module is safe
 * anywhere.
 */
export function createKoiPond(container: HTMLElement, options?: KoiPondOptions | null): KoiPond {
  return mount(container, options ?? {});
}
