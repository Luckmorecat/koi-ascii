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

describe('scene.frag colours', () => {
  it('has no colour literals: every number-only vec3 is maths or light', () => {
    const literals = scene.match(/vec3\(\s*-?[\d.]+(?:\s*,\s*-?[\d.]+)*\s*\)/g) ?? [];
    expect(literals.filter((l) => !ALLOWED.has(l))).toEqual([]);
  });

  it('declares every colour uniform look.ts uploads', () => {
    const declared = [...scene.matchAll(/^uniform vec3 (u\w+);/gm)].map((m) => m[1]);
    for (const name of Object.keys(POND_SCENE)) expect(declared).toContain(name);
  });
});
