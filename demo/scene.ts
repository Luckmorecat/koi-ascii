// The scene the demo shows, as URL params. Shared by the page (seed and time
// work without ?debug too) and the debug layer, which writes changes back.
//
//   seed=<0…4294967295>   fish; omitted: random on every load
//   time=loop|fixed|clock  default loop
//   phase=<0…1>           fixed: the held phase; loop: where it starts (default 0)
//   cycle=<1…86400>       loop length in seconds (default 600)
//   view=final|raw        debug only; default final
//   glow=on|off           debug only; default on
//   palette=<preset>      a koiPalettes name (pond, mono, phosphor, amber, paper, brand); default pond
//   intensity=<0…1>       default 1
//   sky=<features>        the sky features that are on, comma-separated (stars,fireflies,darkNight,moon,sun),
//                         or all / none; default stars,fireflies,darkNight (left out of the URL)
import { koiPalettes, type KoiPondPaletteName, type KoiPondTime } from '../src/index';
import { ALL_SKY, DEFAULT_SKY, isSkyFeature, NO_SKY, SKY_FEATURES, type SkyFeatures } from '../src/sky-features';

export type TimeMode = 'loop' | 'fixed' | 'clock';
export type View = 'final' | 'raw';

export interface SceneState {
  seed: number | null;
  time: TimeMode;
  /** Null: never set explicitly (a loop then starts at 0). Always null for a clock. */
  phase: number | null;
  /** Null: the library default. Always null unless the time loops. */
  cycle: number | null;
  view: View;
  glow: boolean;
  /** Preset names only: a URL can't carry a custom palette object. */
  palette: KoiPondPaletteName;
  intensity: number;
  /** Every sky feature, on or off. */
  sky: SkyFeatures;
}

/** The pond's look: a preset palette, an intensity and the sky features. */
export interface PondLook {
  palette: KoiPondPaletteName;
  intensity: number;
  sky: SkyFeatures;
}

export const DEFAULT_SCENE: Readonly<SceneState> = {
  seed: null,
  time: 'loop',
  phase: null,
  cycle: null,
  view: 'final',
  glow: true,
  palette: 'pond',
  intensity: 1,
  sky: DEFAULT_SKY,
};

const KEYS = ['seed', 'time', 'phase', 'cycle', 'view', 'glow', 'palette', 'intensity', 'sky'] as const;

/** `sky` param → features: all, none, or a list of the features that are on. Anything unreadable: the defaults. */
function readSky(value: string | null): SkyFeatures {
  if (value === null) return DEFAULT_SKY;
  const v = value.trim();
  if (['all', 'on', 'true', '1'].includes(v)) return ALL_SKY;
  if (['none', 'off', 'false', '0'].includes(v)) return NO_SKY;
  const on = v.split(',').filter(isSkyFeature);
  if (!on.length) return DEFAULT_SKY;
  return Object.fromEntries(SKY_FEATURES.map((f) => [f, on.includes(f)])) as unknown as SkyFeatures;
}

/** Features → `sky` param; null for the defaults, which stay out of the URL. */
function writeSky(sky: SkyFeatures): string | null {
  const on = SKY_FEATURES.filter((f) => sky[f]);
  if (SKY_FEATURES.every((f) => sky[f] === DEFAULT_SKY[f])) return null;
  if (!on.length) return 'none';
  return on.length === SKY_FEATURES.length ? 'all' : on.join(',');
}

const isPreset = (v: string | null): v is KoiPondPaletteName => v !== null && Object.hasOwn(koiPalettes, v);
export const MAX_SEED = 2 ** 32 - 1;

/** Number param, or NaN when missing or blank (Number('') would be 0). */
function num(params: URLSearchParams, key: string): number {
  const v = params.get(key);
  return v === null || v.trim() === '' ? NaN : Number(v);
}

function inRange(v: number, min: number, max: number): number | null {
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** Reads the scene from a query string. Never throws: invalid values fall back to the defaults. */
export function readScene(search: string): SceneState {
  const params = new URLSearchParams(search);
  const seedText = params.get('seed') ?? '';
  const seed = /^\d+$/.test(seedText) ? inRange(Number(seedText), 0, MAX_SEED) : null;
  const t = params.get('time');
  const time: TimeMode = t === 'fixed' || t === 'clock' ? t : 'loop';
  let phase = inRange(num(params, 'phase'), 0, 1);
  let cycle = inRange(num(params, 'cycle'), 1, 86_400);
  if (time !== 'loop') cycle = null;
  if (time === 'clock') phase = null;
  if (time === 'fixed') phase ??= 0;
  const palette = params.get('palette');
  return {
    seed,
    time,
    phase,
    cycle,
    view: params.get('view') === 'raw' ? 'raw' : 'final',
    glow: !['off', '0', 'false'].includes(params.get('glow') ?? ''),
    palette: isPreset(palette) ? palette : 'pond',
    intensity: inRange(num(params, 'intensity'), 0, 1) ?? 1,
    sky: readSky(params.get('sky')),
  };
}

/** A param value with at most 4 decimals. */
const decimals4 = (v: number) => String(Number(v.toFixed(4)));

/**
 * Writes `scene` into a query string, replacing its own params and keeping
 * every other one (`debug` among them). Defaults are left out.
 */
export function writeScene(search: string, scene: SceneState): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) params.delete(key);
  if (scene.seed !== null) params.set('seed', String(scene.seed));
  if (scene.time !== 'loop') params.set('time', scene.time);
  if (scene.time !== 'clock' && scene.phase !== null) params.set('phase', decimals4(scene.phase));
  if (scene.time === 'loop' && scene.cycle !== null) params.set('cycle', decimals4(scene.cycle));
  if (scene.view !== 'final') params.set('view', scene.view);
  if (!scene.glow) params.set('glow', 'off');
  if (scene.palette !== 'pond') params.set('palette', scene.palette);
  if (scene.intensity !== 1) params.set('intensity', decimals4(scene.intensity));
  const sky = writeSky(scene.sky);
  if (sky !== null) params.set('sky', sky);
  // A flag like `debug` stays bare instead of becoming `debug=`. Commas are
  // legal in a query and keep `sky=stars,moon` readable.
  const parts = [...params].map(([k, v]) =>
    v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ',')}`,
  );
  return parts.length ? `?${parts.join('&')}` : '';
}

/** The scene's time as the library's `time` option. */
export function sceneTime(scene: SceneState): KoiPondTime {
  if (scene.time === 'clock') return { mode: 'clock' };
  if (scene.time === 'fixed') return { mode: 'fixed', phase: scene.phase ?? 0 };
  return { mode: 'loop', cycle: scene.cycle ?? undefined, phase: scene.phase ?? undefined };
}
