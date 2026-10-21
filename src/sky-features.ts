// The `sky` option: which night-sky features a pond draws. Pure and
// DOM-free (SSR-safe); mount() resolves the option once and on every setSky().
// Not to be confused with sky.ts, the time-of-day source.
import type { KoiPondSkyFeatures } from './index';
import { starWeight } from './lighting';
import { warn } from './palette';

/** Every sky feature, decided. */
export type SkyFeatures = Readonly<Required<KoiPondSkyFeatures>>;

/** The feature names, in the order the docs and the demo list them. */
export const SKY_FEATURES = ['stars', 'fireflies', 'darkNight', 'moon', 'sun'] as const;
export type SkyFeature = (typeof SKY_FEATURES)[number];

/** `sky` omitted: stars, fireflies and the darker night on; moon and sun opt-in (D1). */
export const DEFAULT_SKY: SkyFeatures = Object.freeze({
  stars: true,
  fireflies: true,
  darkNight: true,
  moon: false,
  sun: false,
});
/** `sky: false`: today's (0.2) pond (D4). */
export const NO_SKY: SkyFeatures = Object.freeze({ stars: false, fireflies: false, darkNight: false, moon: false, sun: false });
/** `sky: true`: every feature. */
export const ALL_SKY: SkyFeatures = Object.freeze({ stars: true, fireflies: true, darkNight: true, moon: true, sun: true });

/** A known feature name. */
export function isSkyFeature(name: string): name is SkyFeature {
  return (SKY_FEATURES as readonly string[]).includes(name);
}

/** A value for a warning message; never throws. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' && value ? 'an object' : String(value);
}

/**
 * Resolves the `sky` option (D3). Never throws. `undefined`/`null` are the
 * defaults, silently; `true` turns every feature on and `false` every one
 * off; an object overrides the defaults one field at a time. Anything else,
 * a non-boolean field or an unknown field warns and falls back on its own.
 */
export function resolveSky(input: unknown): SkyFeatures {
  if (input === undefined || input === null) return DEFAULT_SKY;
  if (input === true) return ALL_SKY;
  if (input === false) return NO_SKY;
  if (typeof input !== 'object' || Array.isArray(input)) {
    warn(`sky must be true, false or an object of features; got ${show(input)}, using the defaults.`);
    return DEFAULT_SKY;
  }
  const out: Record<SkyFeature, boolean> = { ...DEFAULT_SKY };
  let keys: string[];
  try {
    keys = Object.keys(input);
  } catch (err) {
    warn(`could not read the sky option (${String(err)}); using the defaults.`);
    return DEFAULT_SKY;
  }
  for (const key of keys) {
    if (!isSkyFeature(key)) {
      warn(`unknown sky feature '${key}' (expected ${SKY_FEATURES.join(', ')}); ignoring it.`);
      continue;
    }
    let value: unknown;
    try {
      value = (input as Record<string, unknown>)[key];
    } catch {
      warn(`could not read sky.${key}; using ${DEFAULT_SKY[key]}.`);
      continue;
    }
    if (value === undefined) continue;
    if (typeof value === 'boolean') out[key] = value;
    else warn(`sky.${key} must be true or false; got ${show(value)}, using ${DEFAULT_SKY[key]}.`);
  }
  return Object.freeze(out);
}

/** What the scene pass draws for the stars at one phase. */
export interface StarsFrame {
  /** Star strength, 0 (none) … 1 (full night). */
  stars: number;
  /** Share of the motes taken away, 0 … 1: only on a light palette, so its stars read among them (D10). */
  moteThin: number;
}

/** Stars at `phase` for a pond with these features, on a light palette or not. 0 for both when off. */
export function starsAt(phase: number, sky: SkyFeatures, light: boolean): StarsFrame {
  const stars = sky.stars ? starWeight(phase) : 0;
  return { stars, moteThin: light ? stars : 0 };
}
