// PROTOTYPE (issue #1, palette and intensity) — throwaway, lives only on the
// prototype/palette-intensity branch. Three models for what a palette *is*,
// all applied in the ascii pass so scene.frag stays untouched:
//
//   A  Ramp   — a palette is a list of colours from background to highlight;
//               the final pixel's brightness picks a colour on it (gradient map).
//   B  Roles  — a palette names a colour per job: water, highlight, and fish
//               pale / ink / accent; glyph classes pick their role.
//   C  Filter — the pond keeps its own art; a palette is a background, a tint,
//               a saturation and an invert switch (like a CSS filter).
//
// 'pond' is today's look in every model. `intensity` dims and desaturates
// toward the background the same way in all three.

export type ProtoVariant = 'A' | 'B' | 'C';
export const VARIANTS: { key: ProtoVariant; name: string }[] = [
  { key: 'A', name: 'Ramp' },
  { key: 'B', name: 'Roles' },
  { key: 'C', name: 'Filter' },
];

type Hex = string;

/** Everything any model needs; each model reads only its own fields. */
export interface ProtoPreset {
  name: string;
  /** Page/body colour too, so the margins and the text overlay match. */
  bg: Hex;
  // A: ramp stops at brightness 0, ~0.4 and 1.
  ramp: [Hex, Hex, Hex];
  // B: roles.
  water: Hex;
  hi: Hex;
  pale: Hex;
  ink: Hex;
  accent: Hex;
  // C: filter.
  tint: Hex;
  saturation: number;
  invert: boolean;
  /** Text overlay colour for the readability check. */
  text: Hex;
}

export const PRESETS: ProtoPreset[] = [
  {
    name: 'pond',
    bg: '#06131a',
    ramp: ['#06131a', '#3f8a90', '#f4f0e4'],
    water: '#3f8a90',
    hi: '#f4f0e4',
    pale: '#f4f0e4',
    ink: '#4d5466',
    accent: '#f24f2b',
    tint: '#ffffff',
    saturation: 1,
    invert: false,
    text: '#e8f1f2',
  },
  {
    name: 'mono',
    bg: '#0b0b0b',
    ramp: ['#0b0b0b', '#5c5c5c', '#f2f2f2'],
    water: '#4a4a4a',
    hi: '#f2f2f2',
    pale: '#d6d6d6',
    ink: '#5a5a5a',
    accent: '#a8a8a8',
    tint: '#ffffff',
    saturation: 0,
    invert: false,
    text: '#f2f2f2',
  },
  {
    name: 'phosphor',
    bg: '#020a04',
    ramp: ['#020a04', '#1b7a35', '#b6ffbf'],
    water: '#14612b',
    hi: '#b6ffbf',
    pale: '#6dff8a',
    ink: '#1f6b33',
    accent: '#3dff6a',
    tint: '#4dff70',
    saturation: 0,
    invert: false,
    text: '#9dffad',
  },
  {
    name: 'amber',
    bg: '#0c0600',
    ramp: ['#0c0600', '#8a4f00', '#ffe2a8'],
    water: '#6e3e00',
    hi: '#ffe2a8',
    pale: '#ffc75a',
    ink: '#7a4300',
    accent: '#ff9a00',
    tint: '#ffb02e',
    saturation: 0,
    invert: false,
    text: '#ffd38a',
  },
  {
    name: 'paper',
    bg: '#f3efe6',
    ramp: ['#f3efe6', '#a9b3b2', '#1d2629'],
    water: '#b3bcbb',
    hi: '#1d2629',
    pale: '#4c5759',
    ink: '#111416',
    accent: '#c8452c',
    tint: '#ffffff',
    saturation: 0.9,
    invert: true,
    text: '#1d2629',
  },
  {
    // A made-up brand, to see how custom colours behave.
    name: 'brand',
    bg: '#14102a',
    ramp: ['#14102a', '#5b47b8', '#ffd6e4'],
    water: '#3b2f6e',
    hi: '#f1edff',
    pale: '#c8c2ff',
    ink: '#5a4a9a',
    accent: '#ff5c8a',
    tint: '#c9b8ff',
    saturation: 0.55,
    invert: false,
    text: '#f1edff',
  },
];

export const proto = {
  variant: 'A' as ProtoVariant,
  preset: PRESETS[0],
  /** 1 = full pond, 0 = nearly gone. */
  intensity: 1,
};

/** sRGB hex → linear-ish 0..1 floats, matching how the shaders use colour constants. */
export function rgb(hex: Hex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
