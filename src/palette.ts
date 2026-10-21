// Palette presets and resolution: turns a public `KoiPondPalette` (preset
// name or object, any CSS colours) into a `ResolvedPalette` of linear numbers
// the renderer can upload. Pure apart from `parseCssColor`, which needs a DOM;
// the resolver takes the parser as a parameter so it runs (and is tested)
// without one. Nothing here touches the DOM at import time (SSR-safe).
import type {
  KoiPondFilterPalette,
  KoiPondPaletteName,
  KoiPondRampPalette,
  KoiPondRolesPalette,
} from './index';

/** sRGB colour, each channel 0..1 (the same space as the shaders' colour constants). */
export type RGB = readonly [number, number, number];

/** Parses one CSS colour to sRGB, alpha dropped; null when the browser rejects it. */
export type ParseColor = (css: string) => RGB | null;

/** Every role slot, filled (given or derived). */
export interface ResolvedRoles {
  background: RGB;
  water: RGB;
  highlight: RGB;
  pale: RGB;
  ink: RGB;
  accent: RGB;
  metallic: RGB;
}

interface ResolvedBase {
  /** CSS colour for the canvas element when the `background` option is unset (`#rrggbb`). */
  css: string;
  /** Background relative luminance above `LIGHT_LUMINANCE`: stays light at night, no glow (Q5, Q6, Q13). */
  light: boolean;
}

/**
 * What the renderer draws with. Every field is valid: invalid input was
 * already replaced (with a warning) during resolution.
 * - `ramp`: brightness → colour along `stops` (2 to 5, evenly spaced);
 *   `background` is `stops[0]`.
 * - `roles`: `roles` replace the scene's colour constants; `background` is
 *   `roles.background`.
 * - `filter`: a filter over the pond's own colours. `background` null means
 *   "today's time-of-day graded pond background" (pond, or a filter without
 *   `background`), which keeps `pond` pixel-identical to the unpaletted pond.
 */
export type ResolvedPalette =
  | (ResolvedBase & { mode: 'ramp'; background: RGB; stops: RGB[] })
  | (ResolvedBase & { mode: 'roles'; background: RGB; roles: ResolvedRoles })
  | (ResolvedBase & {
      mode: 'filter';
      background: RGB | null;
      /** Multiplies the pond's colours; white = unchanged. */
      tint: RGB;
      /** 0 grey … 1 original. */
      saturation: number;
      /** Dark glyphs on a light background, hues kept. */
      invert: boolean;
    });

/** The pond's own background (`#06131a`), before time-of-day grading. */
export const POND_BACKGROUND = '#06131a';
/**
 * The same background as the shaders take it (`#06131a` to the byte). These
 * exact values have fed the shaders since before palettes; keep them so the
 * default pond stays pixel-identical.
 */
export const POND_BG: RGB = [0.024, 0.075, 0.102];
/** Pond's red markings and Ogon gold (the scene's colours, look.ts): the role defaults for accent and metallic. */
export const POND_ACCENT: RGB = [0.95, 0.31, 0.17];
export const POND_METALLIC: RGB = [0.97, 0.72, 0.24];
export const WHITE: RGB = [1, 1, 1];
/** Derived highlight on a light background. */
const NEAR_BLACK: RGB = [0.08, 0.09, 0.1];
/** Q13: a background brighter than this (WCAG relative luminance) is light. */
export const LIGHT_LUMINANCE = 0.4;
/** Missing role slots sit this far from background toward highlight (Q12). */
const DERIVE = { water: 0.3, ink: 0.45, pale: 0.85 } as const;

export const POND: ResolvedPalette = Object.freeze({
  mode: 'filter',
  background: null,
  css: POND_BACKGROUND,
  light: false,
  tint: WHITE,
  saturation: 1,
  invert: false,
});

const presets: {
  pond: KoiPondFilterPalette;
  mono: KoiPondRampPalette;
  phosphor: KoiPondRampPalette;
  amber: KoiPondRampPalette;
  paper: KoiPondRolesPalette;
  brand: KoiPondRolesPalette;
} = {
  pond: { mode: 'filter' },
  mono: { mode: 'ramp', colors: ['#0b0b0b', '#5c5c5c', '#f2f2f2'] },
  phosphor: { mode: 'ramp', colors: ['#020a04', '#1b7a35', '#b6ffbf'] },
  amber: { mode: 'ramp', colors: ['#0c0600', '#8a4f00', '#ffe2a8'] },
  // Dark ink on off-white, vermilion accent, ochre metallic.
  paper: {
    mode: 'roles',
    background: '#f3efe6',
    water: '#b3bcbb',
    highlight: '#1d2629',
    fish: { pale: '#4c5759', ink: '#111416', accent: '#c8452c', metallic: '#b5832a' },
  },
  // Indigo, lavender, pink.
  brand: {
    mode: 'roles',
    background: '#14102a',
    water: '#3b2f6e',
    highlight: '#f1edff',
    fish: { pale: '#c8c2ff', ink: '#5a4a9a', accent: '#ff5c8a', metallic: '#ffc2d6' },
  },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The presets behind the public `koiPalettes`, frozen all the way down. */
export const PRESETS = deepFreeze(presets);

function warn(message: string): void {
  console.warn(`koi-ascii: ${message}`);
}

/** WCAG 2 relative luminance of an sRGB colour. */
export function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isLight(color: RGB): boolean {
  return relativeLuminance(color) > LIGHT_LUMINANCE;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function toCss(c: RGB): string {
  return `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Resolves a palette. Never throws: an invalid field falls back on its own,
 * an unknown preset/mode (or anything unreadable) falls back to `pond`, each
 * with a `console.warn` (Q8). `undefined`/`null` is `pond`, silently.
 */
export function resolvePalette(input: unknown, parse: ParseColor): ResolvedPalette {
  if (input === undefined || input === null) return POND;
  try {
    return resolve(input, parse);
  } catch (err) {
    warn(`could not read the palette (${String(err)}); using 'pond'.`);
    return POND;
  }
}

function resolve(input: unknown, parse: ParseColor): ResolvedPalette {
  if (typeof input === 'string') {
    if (Object.hasOwn(PRESETS, input)) return resolve(PRESETS[input as KoiPondPaletteName], parse);
    warn(`unknown palette '${input}'; using 'pond'.`);
    return POND;
  }
  const p = (typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode = p.mode;
  if (mode === 'ramp') return resolveRamp(p, parse);
  if (mode === 'roles') return resolveRoles(p, parse);
  if (mode === 'filter') return resolveFilter(p, parse);
  warn(`unknown palette mode '${String(mode)}' (expected 'ramp', 'roles' or 'filter'); using 'pond'.`);
  return POND;
}

/** A colour field: undefined when absent (no warning), null when invalid (warned). */
function color(value: unknown, field: string, parse: ParseColor): RGB | null | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? safeParse(value, parse) : null;
  if (!parsed) warn(`palette ${field} ${show(value)} is not a CSS colour (var() is not supported); ignoring it.`);
  return parsed;
}

function resolveRamp(p: Record<string, unknown>, parse: ParseColor): ResolvedPalette {
  const colors = p.colors;
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 5) {
    warn(`a ramp palette needs 2 to 5 colors; using 'pond'.`);
    return POND;
  }
  const stops: RGB[] = [];
  for (let i = 0; i < colors.length; i++) {
    const c = typeof colors[i] === 'string' ? safeParse(colors[i], parse) : null;
    if (!c) {
      warn(`ramp colors[${i}] ${show(colors[i])} is not a CSS colour; using 'pond'.`);
      return POND;
    }
    stops.push(c);
  }
  const background = stops[0];
  return { mode: 'ramp', background, css: toCss(background), light: isLight(background), stops };
}

/** A value for a warning message; never throws. */
function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : typeof value === 'object' && value ? 'object' : String(value);
}

function safeParse(css: string, parse: ParseColor): RGB | null {
  try {
    return parse(css);
  } catch {
    return null;
  }
}

function resolveRoles(p: Record<string, unknown>, parse: ParseColor): ResolvedPalette {
  let background = color(p.background, 'background', parse);
  if (background === undefined) warn(`a roles palette needs a background; using ${POND_BACKGROUND}.`);
  background ??= POND_BG;
  const light = isLight(background);
  const highlight = color(p.highlight, 'highlight', parse) ?? (light ? NEAR_BLACK : WHITE);
  const toward = (t: number) => mix(background, highlight, t);
  const water = color(p.water, 'water', parse) ?? toward(DERIVE.water);

  let fish: Record<string, unknown> = {};
  if (p.fish !== undefined) {
    if (p.fish && typeof p.fish === 'object') fish = p.fish as Record<string, unknown>;
    else warn(`palette fish must be an object; deriving the fish colours.`);
  }
  const roles: ResolvedRoles = {
    background,
    water,
    highlight,
    pale: color(fish.pale, 'fish.pale', parse) ?? toward(DERIVE.pale),
    ink: color(fish.ink, 'fish.ink', parse) ?? toward(DERIVE.ink),
    accent: color(fish.accent, 'fish.accent', parse) ?? POND_ACCENT,
    metallic: color(fish.metallic, 'fish.metallic', parse) ?? POND_METALLIC,
  };
  return { mode: 'roles', background, css: toCss(background), light, roles };
}

function resolveFilter(p: Record<string, unknown>, parse: ParseColor): ResolvedPalette {
  const background = color(p.background, 'background', parse) ?? null;
  const tint = color(p.tint, 'tint', parse) ?? WHITE;

  let saturation = 1;
  const s = p.saturation;
  if (typeof s === 'number' && !Number.isNaN(s)) {
    saturation = Math.min(1, Math.max(0, s));
    if (saturation !== s) warn(`palette saturation ${s} is outside [0, 1]; using ${saturation}.`);
  } else if (s !== undefined) {
    warn(`palette saturation must be a number from 0 to 1; using 1.`);
  }

  let invert = false;
  if (typeof p.invert === 'boolean') invert = p.invert;
  else if (p.invert !== undefined) warn(`palette invert must be true or false; using false.`);

  return {
    mode: 'filter',
    background,
    css: background ? toCss(background) : POND_BACKGROUND,
    light: background ? isLight(background) : false,
    tint,
    saturation,
    invert,
  };
}

/**
 * Validates an intensity (Q9, R3): a number in [0, 1]. Out-of-range numbers
 * clamp, anything else (NaN, a string, a missing setter argument) keeps
 * `fallback`; both with a warning. `optional`: undefined is the omitted
 * option, which takes `fallback` silently.
 */
export function resolveIntensity(value: unknown, fallback: number, optional: boolean): number {
  if (value === undefined && optional) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    warn(`intensity must be a number from 0 to 1; keeping ${fallback}.`);
    return fallback;
  }
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped !== value) warn(`intensity ${value} is outside [0, 1]; using ${clamped}.`);
  return clamped;
}

let parserCtx: CanvasRenderingContext2D | null | undefined;

/**
 * The browser's own colour parser (Q7): any CSS colour a canvas accepts, in
 * sRGB, alpha dropped. `var()` and junk are rejected by `fillStyle`. Needs a
 * DOM; call it only when a palette is set, never at import.
 */
export const parseCssColor: ParseColor = (css) => {
  if (parserCtx === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    parserCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = parserCtx;
  if (!ctx) return null;
  // fillStyle ignores a value it can't parse. Two different sentinels tell a
  // rejected value (the sentinel survives) from one equal to a sentinel.
  ctx.fillStyle = '#000000';
  ctx.fillStyle = css;
  const a = String(ctx.fillStyle);
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = css;
  if (String(ctx.fillStyle) !== a) return null;

  // sRGB colours serialise as #rrggbb or rgba(r, g, b, a): exact, alpha dropped.
  const hex = /^#([0-9a-f]{6})$/i.exec(a);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(a);
  if (rgba) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255];

  // Other spaces (oklch(), color(display-p3 …)) keep their own syntax: let the
  // canvas convert by drawing a pixel. Their serialisation puts alpha last as
  // `/ a`; strip it so the pixel is opaque, since a transparent pixel reads
  // back as black and a faint one loses precision.
  ctx.fillStyle = a.replace(/\s*\/\s*[^/)]+\)$/, ')');
  ctx.globalCompositeOperation = 'copy';
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
};
