import { describe, expect, it } from 'vitest';
import { POND_SCENE } from '../src/look';
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
