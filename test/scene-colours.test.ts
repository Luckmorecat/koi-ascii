import { describe, expect, it } from 'vitest';
import { POND_SCENE, rolesScene } from '../src/look';
import type { ResolvedRoles } from '../src/palette';
import scene from '../src/shaders/scene.frag?raw';

// scene.frag draws only with colours fed from look.ts, so every palette
// reaches every object (docs/colour-slots.md).

// Number-only vec3s that are maths or light, not an object's colour.
const ALLOWED = new Set([
  'vec3(0.0, 0.0, 1.0)', // up: the flat-water normal and the half vector toward the viewer
  'vec3(1.0)', // glints whiten the light's hue (light, not pigment)
  'vec3(0.2126, 0.7152, 0.0722)', // Rec.709 luminance weights
  'vec3(0.75)', // eyes never darker than this share of the light
]);

// The time-of-day lighting (lighting.ts); every other vec3 uniform is a colour.
const LIGHTING = ['uLightDir', 'uLightCol', 'uAmbient', 'uWaterTint', 'uSky'];

// Any GLSL float or int literal: 1, 1.0, .5, 1., 1e0, +1.0, -2.5e-3.
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LITERAL = new RegExp(String.raw`vec3\(\s*${NUM}(?:\s*,\s*${NUM})*\s*\)`, 'g');

describe('scene.frag colours', () => {
  it('has no colour literals: every number-only vec3 is maths or light', () => {
    const literals = scene.match(LITERAL) ?? [];
    expect(literals.filter((l) => !ALLOWED.has(l))).toEqual([]);
  });

  it('declares exactly the colour uniforms look.ts uploads', () => {
    // Both ways: a colour look.ts doesn't upload stays black on every palette.
    const colours = [...scene.matchAll(/^\s*uniform\s+vec3\s+(\w+)\s*;/gm)]
      .map((m) => m[1])
      .filter((name) => !LIGHTING.includes(name));
    expect(colours.sort()).toEqual(Object.keys(POND_SCENE).sort());
  });
});

describe('star colours (D11)', () => {
  it('pond keeps fixed star hues of its own, from cool to warm', () => {
    const [cool, warm] = [POND_SCENE.uStarCool, POND_SCENE.uStarWarm];
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect([...cool, ...warm].every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('roles take the highlight, the warmest a quarter toward the water', () => {
    // Paper-like: dark ink highlight on a light background.
    const r: ResolvedRoles = {
      background: [0.96, 0.94, 0.9],
      water: [0.7, 0.75, 0.78],
      highlight: [0.11, 0.15, 0.16],
      pale: [0.3, 0.32, 0.34],
      ink: [0.2, 0.2, 0.22],
      accent: [0.7, 0.2, 0.15],
      metallic: [0.6, 0.5, 0.2],
    };
    const scene = rolesScene(r);
    expect(scene.uStarCool).toEqual(r.highlight);
    scene.uStarWarm.forEach((v, i) => expect(v).toBeCloseTo(r.highlight[i] + (r.water[i] - r.highlight[i]) * 0.25, 12));
  });
});
