// How a resolved palette reaches the shaders: the scene pass's colour table
// (roles replace it, Q1), its lighting (brightness only in roles, Q14) and
// the ascii pass's background and recolouring (ramp, filter). Pure, so the
// renderer only uploads what this returns.
import type { Lighting } from './lighting';
import { mix, POND_ACCENT, POND_BG, POND_METALLIC, WHITE, type ResolvedPalette, type ResolvedRoles, type RGB } from './palette';

type Vec3 = [number, number, number];

/** Every colour the scene pass draws with (scene.frag uniforms of the same names). */
export interface SceneColors {
  uWaterDim: RGB;
  uWaterLit: RGB;
  uRippleCol: RGB;
  uKohakuWhite: RGB;
  uHiRed: RGB;
  uSumi: RGB;
  uShowaWhite: RGB;
  uOgonGold: RGB;
  /** Ogon's flank, darker than its back. */
  uOgonShade: RGB;
  uOgonGlint: RGB;
  uEyeCol: RGB;
  /** Light rim drawn over sumi so the Showa's black flank keeps its silhouette. */
  uSumiRim: RGB;
  uKohakuFin: RGB;
  uKohakuTail: RGB;
  uOgonFin: RGB;
  /** Colour at the tip of an Ogon's tail; the root is uOgonGold. */
  uOgonTail: RGB;
  uSilk: RGB;
  uBubble: RGB;
  uGoldDust: RGB;
  /** Water glints. Pond: unused (the light's own hue); roles: the highlight. */
  uGlintCol: RGB;
  /** Multiplies light added on top of a fish (specular, rim, caustics). */
  uAddTint: RGB;
  /** Reflected stars (light): the coolest; each star mixes toward uStarWarm. */
  uStarCool: RGB;
  /** The warmest reflected star. */
  uStarWarm: RGB;
  /** The moon's reflection (light), at full strength; it dims with its alpha. */
  uMoonCol: RGB;
}

const OGON_GOLD = POND_METALLIC;

/** Today's pond, exactly as the constants scene.frag had before palettes (A3). */
const pondScene: SceneColors = {
  uWaterDim: [0.1, 0.27, 0.31],
  uWaterLit: [0.27, 0.58, 0.61],
  uRippleCol: [0.66, 0.89, 0.9],
  uKohakuWhite: [0.96, 0.94, 0.89],
  uHiRed: POND_ACCENT,
  uSumi: [0.3, 0.33, 0.4],
  uShowaWhite: [0.93, 0.91, 0.86],
  uOgonGold: OGON_GOLD,
  uOgonShade: [OGON_GOLD[0] * 0.86, OGON_GOLD[1] * 0.8, OGON_GOLD[2] * 0.72],
  uOgonGlint: [1.0, 0.96, 0.8],
  uEyeCol: [1.0, 0.97, 0.86],
  uSumiRim: [0.74, 0.77, 0.82],
  uKohakuFin: [0.82, 0.9, 0.92],
  uKohakuTail: [0.84, 0.91, 0.93],
  uOgonFin: [0.98, 0.84, 0.48],
  uOgonTail: [1.0, 0.9, 0.62],
  uSilk: [0.95, 0.86, 0.8],
  uBubble: [0.82, 0.93, 0.95],
  uGoldDust: [1.0, 0.85, 0.45],
  uGlintCol: WHITE,
  uAddTint: WHITE,
  uStarCool: [0.72, 0.8, 1.0],
  uStarWarm: [1.0, 0.92, 0.78],
  uMoonCol: [0.86, 0.9, 0.98],
};
export const POND_SCENE: Readonly<SceneColors> = Object.freeze(pondScene);

function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/**
 * Roles → scene colours (the issue's mapping table). "Lighter variants" move
 * toward the highlight, so they gain contrast on a light background too;
 * deep water and ripples come from water, highlight and background only (Q11).
 */
export function rolesScene(r: ResolvedRoles): SceneColors {
  const ripple = mix(r.water, r.highlight, 0.6);
  return {
    uWaterDim: mix(r.background, r.water, 0.37),
    uWaterLit: r.water,
    uRippleCol: ripple,
    uKohakuWhite: r.pale,
    uHiRed: r.accent,
    uSumi: r.ink,
    uShowaWhite: mix(r.pale, r.background, 0.05),
    uOgonGold: r.metallic,
    uOgonShade: scale(r.metallic, 0.8),
    uOgonGlint: mix(r.metallic, r.highlight, 0.6),
    uEyeCol: r.highlight,
    uSumiRim: mix(r.ink, r.pale, 0.7),
    uKohakuFin: mix(r.pale, r.water, 0.15),
    uKohakuTail: mix(r.pale, r.water, 0.12),
    uOgonFin: mix(r.metallic, r.highlight, 0.25),
    uOgonTail: mix(r.metallic, r.highlight, 0.45),
    uSilk: r.pale,
    uBubble: mix(r.water, r.highlight, 0.6),
    uGoldDust: mix(r.metallic, r.highlight, 0.15),
    uGlintCol: r.highlight,
    uAddTint: r.highlight,
    // Stars are light: the highlight, some a little toward the water (D11).
    uStarCool: r.highlight,
    uStarWarm: mix(r.highlight, r.water, 0.25),
    // The moon is light too: the highlight, a quarter toward pale (D11).
    uMoonCol: mix(r.highlight, r.pale, 0.25),
  };
}

// Rec.709 weights, for greying light colours. Not the shader's Rec.601 lum()
// or palette.ts's WCAG luminance: see the note on lum() in ascii.frag.
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const grey = (c: readonly number[]): Vec3 => {
  const y = luma(c);
  return [y, y, y];
};

/**
 * Roles keep their hues at every hour (Q14): the lighting keeps its
 * brightness but loses its colour, and the sky's tint on the water goes.
 */
export function brightnessOnly(light: Lighting): Lighting {
  return {
    ...light,
    color: grey(light.color),
    ambient: grey(light.ambient),
    water: grey(light.water),
    sky: [0, 0, 0],
  };
}

/** Ascii pass recolouring (ascii.frag uLook). */
export const LOOK_PLAIN = 0;
export const LOOK_RAMP = 1;
export const LOOK_FILTER = 2;

/** Share of the sky's reflection (warm at dawn and dusk) laid over the background. */
const BG_SKY = 0.15;

/**
 * A dark background graded by the time of day, the way the pond's own is,
 * and darker at night with the `darkNight` sky feature.
 */
export function graded(bg: RGB, light: Lighting): RGB {
  const c = [0, 1, 2].map((i) => bg[i] * light.water[i] + light.sky[i] * BG_SKY) as Vec3;
  // Skipped at 1, so a pond without the darker night keeps 0.2's exact values (D4).
  return light.darkWater === 1 ? c : (c.map((v) => v * light.darkWater) as Vec3);
}

export interface AsciiLook {
  look: number;
  /** What the glyphs are composited over (before ramp/filter). */
  bg: RGB;
  /** The background as drawn: margins, and what intensity fades to. */
  outBg: RGB;
}

/** Ascii-pass uniforms for a frame lit by `light`. */
export function asciiLook(p: ResolvedPalette, light: Lighting): AsciiLook {
  const pondBg = graded(POND_BG, light);
  if (p.mode === 'roles') return { look: LOOK_PLAIN, bg: p.background, outBg: p.background };
  if (p.mode === 'ramp') return { look: LOOK_RAMP, bg: pondBg, outBg: p.stops[0] };
  const identity = !p.background && !p.invert && p.saturation === 1 && p.tint.every((v) => v === 1);
  if (identity) return { look: LOOK_PLAIN, bg: pondBg, outBg: pondBg };
  // Filter keeps the time-of-day grading on a dark background; a light one stays put (Q5, Q14).
  const outBg = !p.background ? pondBg : p.light ? p.background : graded(p.background, light);
  return { look: LOOK_FILTER, bg: pondBg, outBg };
}
