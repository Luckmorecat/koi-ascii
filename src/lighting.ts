// Time of day → lighting. Pure: one call per frame on the CPU, and the
// result goes to the scene pass as uniforms. The shaders keep no clock of
// their own for the time of day, so any time source (slider, loop, a real
// clock later) drives the lighting through the phase alone.
//
// Phase: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset (see sky.ts).
// World axes: x right, y down the screen, z up out of the water toward the
// viewer, who looks straight down.

export type Vec3 = [number, number, number];

/** A body's reflection on the water: the moon by night, the sun's glitter by day. */
export interface Body {
  /** Centre as a share of the pond's width and height, y down. */
  pos: [number, number];
  /** Radius as a share of the pond's shorter side. */
  radius: number;
  /** 0 hidden … 1 fully out. */
  alpha: number;
}

export interface Lighting {
  /** Unit vector toward the sun (day) or moon (night). */
  dir: Vec3;
  /** Direct light colour with its intensity folded in. */
  color: Vec3;
  /** Light reaching the fish from the whole sky. */
  ambient: Vec3;
  /** Multiplies water, ripples and trails; never below `floor` per channel. */
  water: Vec3;
  /** Added to water and ripple colours: the sky's reflection (warm at dawn and dusk). */
  sky: Vec3;
  /** Water glint brightness; 0 hides glints. */
  glint: number;
  /** Floor-caustic and fish-caustic strength. */
  caustic: number;
  /**
   * Minimum light per channel on fish, so glyphs stay readable at night.
   * Applied per channel, so it also pulls the moon's blue toward neutral and
   * keeps kohaku red reading as red.
   */
  floor: number;
  /** Fish shadow offset on the pond floor, in pond units (×unit for CSS px). */
  shadow: [number, number];
  /** Shadow darkness multiplier, 0..1. */
  shadowAlpha: number;
  /**
   * Halo strength for the glow pass, 0..1 (the renderer feeds it to glow.frag;
   * the scene pass does not read it). Higher at dusk and night, where halos read best.
   */
  glowStrength: number;
  /**
   * Darker night (the `darkNight` sky feature): multiplies flat water and a
   * time-of-day graded background. 1 by day and whenever the feature is off.
   */
  darkWater: number;
  /** Darker night: multiplies the density of flat water (floor caustics and motes), so fewer show. 1 by day or when off. */
  darkCaustic: number;
  /** The moon's reflection (the `moon` sky feature draws it), on its own arc: see moonAt(). */
  moon: Body;
  /** The sun's glitter (the `sun` sky feature draws it), on the same path: see sunAt(). */
  sun: Body;
}

// Everything except the direction, keyed by phase.
interface Key {
  at: number;
  color: Vec3;
  ambient: Vec3;
  water: Vec3;
  sky: Vec3;
  glint: number;
  caustic: number;
  floor: number;
  shadowAlpha: number;
  glow: number;
}

// Moon and sky keep a fair share of red: under a pure blue light kohaku red
// would go maroon and ogon gold olive (D3). The blue lives in the water tint.
const NIGHT: Omit<Key, 'at'> = {
  color: [0.36, 0.4, 0.58],
  ambient: [0.36, 0.35, 0.44],
  water: [0.58, 0.7, 1.0],
  sky: [0.0, 0.01, 0.04],
  glint: 0.6,
  caustic: 0.25,
  floor: 0.5,
  shadowAlpha: 0.4,
  glow: 0.55,
};

// Blue hour, either side of the handoff between moon and sun (see HANDOFF).
// The direct light dips here so the swap of direction is not seen.
const BLUE: Omit<Key, 'at'> = {
  color: [0.1, 0.11, 0.18],
  ambient: [0.36, 0.36, 0.48],
  water: [0.62, 0.68, 0.95],
  sky: [0.03, 0.02, 0.06],
  glint: 0.3,
  caustic: 0.2,
  floor: 0.48,
  shadowAlpha: 0.1,
  glow: 0.5,
};

// Low warm sun: orange key light, mauve fill, warm sky on the water.
const GOLDEN: Omit<Key, 'at'> = {
  color: [1.0, 0.6, 0.3],
  ambient: [0.46, 0.36, 0.4],
  water: [0.8, 0.72, 0.7],
  sky: [0.2, 0.09, 0.02],
  glint: 1.5,
  caustic: 0.55,
  floor: 0.3,
  shadowAlpha: 0.75,
  glow: 0.65,
};

const MORNING: Omit<Key, 'at'> = {
  color: [0.78, 0.7, 0.58],
  ambient: [0.42, 0.42, 0.46],
  water: [0.98, 0.96, 0.96],
  sky: [0.03, 0.02, 0.01],
  glint: 1.1,
  caustic: 0.85,
  floor: 0.25,
  shadowAlpha: 0.9,
  glow: 0.45,
};

// Bright and neutral; water a touch above the original fixed colours.
const NOON: Omit<Key, 'at'> = {
  color: [0.72, 0.71, 0.67],
  ambient: [0.44, 0.46, 0.5],
  water: [1.08, 1.08, 1.04],
  sky: [0.0, 0.0, 0.0],
  glint: 1.0,
  caustic: 1.0,
  floor: 0.25,
  shadowAlpha: 1.0,
  glow: 0.35,
};

const KEYS: (Key & { part: string })[] = [
  { at: 0.0, part: 'night', ...NIGHT },
  { at: 0.21, part: 'blue hour', ...BLUE },
  { at: 0.265, part: 'golden hour', ...GOLDEN },
  { at: 0.34, part: 'morning', ...MORNING },
  { at: 0.5, part: 'noon', ...NOON },
  { at: 0.66, part: 'afternoon', ...MORNING },
  { at: 0.745, part: 'golden hour', ...GOLDEN },
  { at: 0.79, part: 'blue hour', ...BLUE },
  { at: 1.0, part: 'night', ...NIGHT },
];

export interface DayPart {
  /** Phase where this part's keyframe sits; the part lasts until the next one. */
  at: number;
  name: string;
}

/** The lighting keyframes as named parts of the day, for the debug overlay. */
export const DAY_PARTS: readonly DayPart[] = KEYS.slice(0, -1).map(({ at, part }) => ({ at, name: part }));

/** The part of the day whose keyframe was passed last. */
export function dayPartAt(phase: number): DayPart {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < DAY_PARTS.length - 1 && p >= DAY_PARTS[i + 1].at) i++;
  return DAY_PARTS[i];
}

/** The moon hands over to the sun across [a, b] and back across [1 - b, 1 - a]. */
const HANDOFF: [number, number] = [0.19, 0.23];
/**
 * The sun's path is tilted on screen so the noon light still comes from one
 * side: a fish swimming any way but along that diagonal shows a lit flank.
 */
const PATH_TILT = -0.45;
/** Sun elevation (rad) at sunrise/sunset and at noon; never 0 so it always lights something. */
const SUN_LOW = 0.1;
const SUN_HIGH = 1.0;
const MOON_LOW = 0.25;
const MOON_HIGH = 0.95;
/** Shadow length per unit of cot(elevation), in pond units, and its cap for a low sun. */
const SHADOW_PER_COT = 0.16;
const SHADOW_MAX = 0.24;

const TAU = Math.PI * 2;
/** GLSL smoothstep. */
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/**
 * Direction toward a body on an arc that rises at angle 0 (screen left) and
 * sets at π (screen right), with elevation lo..hi following sin(angle).
 */
function arcDir(angle: number, lo: number, hi: number): Vec3 {
  const el = mix(lo, hi, Math.max(0, Math.sin(angle)));
  const { x, y, length } = azimuth(angle);
  const h = Math.cos(el) / length;
  return [x * h, y * h, Math.sin(el)];
}

/** A body's azimuth on screen at `angle` (see arcDir), tilted; its length is the same before and after. */
function azimuth(angle: number): { x: number; y: number; length: number } {
  // Before tilt: rises left, crosses the top of the screen, sets right.
  const ax = -Math.cos(angle);
  const ay = -0.8 * Math.sin(angle);
  const c = Math.cos(PATH_TILT);
  const s = Math.sin(PATH_TILT);
  return { x: ax * c - ay * s, y: ax * s + ay * c, length: Math.hypot(ax, ay) || 1 };
}

/** Half-extents of the path reflections follow, as a share of the pond's width and height. */
const BODY_BAND: readonly [number, number] = [0.38, 0.36];
/** Superellipse exponent of that path: high enough to hug the edges, low enough to round the corners. */
const BODY_ROUND = 6;
/** The moon's radius as a share of the pond's shorter side. */
const MOON_RADIUS = 0.065;
/** The moon fades in after the evening handoff and out before the morning one (D6). */
const MOON_RISE: readonly [number, number] = [1 - HANDOFF[0], 1 - HANDOFF[0] + 0.05];
const MOON_SET: readonly [number, number] = [HANDOFF[0] - 0.05, HANDOFF[0]];
/** The sun's glitter patch: its outer edge as a share of the pond's shorter side. */
const SUN_RADIUS = 0.1;
/** The sun fades in after the morning handoff and out before the evening one (D6). */
const SUN_RISE: readonly [number, number] = [HANDOFF[1], HANDOFF[1] + 0.05];
const SUN_SET: readonly [number, number] = [1 - HANDOFF[1] - 0.05, 1 - HANDOFF[1]];
/**
 * The sun's path runs at this share of its light's pace, so its visible day
 * (HANDOFF[1] … 1 − HANDOFF[1]) covers exactly the moon's visible night: up
 * the left side, over the top, out near the top-right corner. At the light's
 * own pace it would also run down the right side (P1: the top edge and one side).
 */
const SUN_PACE = (2 * HANDOFF[0]) / (1 - 2 * HANDOFF[1]);

/**
 * Where a body's reflection sits: toward its azimuth from the pond's centre,
 * out on a rounded rectangle near the edges (half-extents BODY_BAND, as a
 * share of width and height). Every point of it is at least 0.89 of the way
 * out in one axis, so with a radius under 0.12 of the shorter side the disc
 * keeps clear of the middle 40 % of the pond at any aspect (P1).
 */
function bodyPos(angle: number): [number, number] {
  const { x, y } = azimuth(angle);
  const n = (Math.abs(x) / BODY_BAND[0]) ** BODY_ROUND + (Math.abs(y) / BODY_BAND[1]) ** BODY_ROUND;
  const k = n ** (-1 / BODY_ROUND);
  return [0.5 + x * k, 0.5 + y * k];
}

/**
 * The moon's reflection at `phase`, from the phase alone (not the blended
 * light direction, which swings to the sun at the handoff). It follows the
 * moon's own azimuth: up the left side after dusk, over the top through the
 * night, and gone before either handoff starts, so it never jumps.
 */
export function moonAt(phase: number): Body {
  const p = ((phase % 1) + 1) % 1;
  const alpha = 1 - smooth(MOON_SET[0], MOON_SET[1], p) * (1 - smooth(MOON_RISE[0], MOON_RISE[1], p));
  return { pos: bodyPos(TAU * (p - 0.75)), radius: MOON_RADIUS, alpha };
}

/**
 * The sun's glitter at `phase`, from the phase alone, on the moon's path
 * (see moonAt and SUN_PACE): rises on the left after the morning handoff,
 * over the top at noon, gone near the top-right corner before the evening
 * handoff, so it never jumps and never shares the sky with the moon.
 */
export function sunAt(phase: number): Body {
  const p = ((phase % 1) + 1) % 1;
  const alpha = smooth(SUN_RISE[0], SUN_RISE[1], p) * (1 - smooth(SUN_SET[0], SUN_SET[1], p));
  return { pos: bodyPos(TAU * (0.25 + (p - 0.5) * SUN_PACE)), radius: SUN_RADIUS, alpha };
}

/** Flat water and a graded background at full night with `darkNight` on. */
const DARK_WATER = 0.7;
/** Flat-water density at full night with `darkNight` on: about half the caustics show. */
const DARK_CAUSTIC = 0.5;
/** The blue hours the night fades across: out at dawn, back in at dusk. */
const NIGHT_DAWN: readonly [number, number] = [0.17, 0.24];
const NIGHT_DUSK: readonly [number, number] = [0.76, 0.83];

/**
 * How much of the night shows at a phase: 1 from the end of the evening blue
 * hour to the start of the morning one, 0 by day, a smooth fade across each
 * blue hour (so golden hour is still pure day).
 */
export function nightWeight(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return 1 - smooth(NIGHT_DAWN[0], NIGHT_DAWN[1], p) * (1 - smooth(NIGHT_DUSK[0], NIGHT_DUSK[1], p));
}

/** Night weight below which no star shows: they arrive after the night and leave before it. */
const STARS_FROM = 0.35;

/**
 * How strongly the reflected stars show at a phase (the `stars` sky
 * feature): `smoothstep(0.35, 1, nightWeight)`, so 0 through the golden
 * hours and the start of each blue hour, 1 at full night.
 */
export function starWeight(phase: number): number {
  return smooth(STARS_FROM, 1, nightWeight(phase));
}

/** The fireflies' dusk window: in after the golden hour, out into the night (never at dawn). */
const FIREFLIES_IN: readonly [number, number] = [0.745, 0.8];
const FIREFLIES_OUT: readonly [number, number] = [0.88, 0.95];

/**
 * How strongly the fireflies show at a phase (the `fireflies` sky feature):
 * 0 until the golden hour ends, 1 through the evening blue hour and early
 * night, 0 again from 0.95 through the night, the morning and the day.
 */
export function fireflyWeight(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return smooth(FIREFLIES_IN[0], FIREFLIES_IN[1], p) * (1 - smooth(FIREFLIES_OUT[0], FIREFLIES_OUT[1], p));
}

/** What the sky features change in the lighting itself. */
export interface LightingOptions {
  /** The darker night: on only for a pond with `darkNight` on and a dark background (D5). */
  darkNight?: boolean;
}

/** Lighting at `phase`; without options (or `darkNight` false) exactly the 0.2 lighting. */
export function lightingAt(phase: number, options: LightingOptions = {}): Lighting {
  const p = ((phase % 1) + 1) % 1;

  let i = 0;
  while (i < KEYS.length - 2 && p >= KEYS[i + 1].at) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(a.at, b.at, p);

  // Sun up from 0.25 to 0.75, moon from 0.75 to 0.25; both held at least at
  // their low elevation so the blend below never passes through the horizon.
  const sun = arcDir(TAU * (p - 0.25), SUN_LOW, SUN_HIGH);
  const moon = arcDir(TAU * (p - 0.75), MOON_LOW, MOON_HIGH);
  const w = smooth(HANDOFF[0], HANDOFF[1], p) * (1 - smooth(1 - HANDOFF[1], 1 - HANDOFF[0], p));
  const d = mix3(moon, sun, w);
  const dl = Math.hypot(d[0], d[1], d[2]);
  const dir: Vec3 = [d[0] / dl, d[1] / dl, d[2] / dl];

  // Shadows fall away from the light, longer as it sinks.
  const horiz = Math.hypot(dir[0], dir[1]);
  const len = Math.min(SHADOW_MAX, (SHADOW_PER_COT * horiz) / Math.max(dir[2], 1e-3));
  const shadow: [number, number] = horiz > 1e-6 ? [(-dir[0] / horiz) * len, (-dir[1] / horiz) * len] : [0, 0];

  const floor = mix(a.floor, b.floor, t);
  const water = mix3(a.water, b.water, t).map((v) => Math.max(v, floor)) as Vec3;

  return {
    dir,
    color: mix3(a.color, b.color, t),
    ambient: mix3(a.ambient, b.ambient, t),
    water,
    sky: mix3(a.sky, b.sky, t),
    glint: mix(a.glint, b.glint, t),
    caustic: mix(a.caustic, b.caustic, t),
    floor,
    shadow,
    shadowAlpha: mix(a.shadowAlpha, b.shadowAlpha, t),
    glowStrength: mix(a.glow, b.glow, t),
    ...darkNight(options.darkNight ? nightWeight(p) : 0),
    moon: moonAt(p),
    sun: sunAt(p),
  };
}

function darkNight(night: number): Pick<Lighting, 'darkWater' | 'darkCaustic'> {
  // Exactly 1 when off or by day, so the shaders leave everything untouched (D4).
  if (night <= 0) return { darkWater: 1, darkCaustic: 1 };
  return { darkWater: mix(1, DARK_WATER, night), darkCaustic: mix(1, DARK_CAUSTIC, night) };
}
