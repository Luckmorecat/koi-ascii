import { describe, expect, it } from 'vitest';
import { POND_SCENE, rolesScene } from '../src/look';
import type { ResolvedRoles } from '../src/palette';
import scene from '../src/shaders/scene.frag?raw';
import fly from '../src/shaders/fly.frag?raw';

// scene.frag, and fly.frag for the fireflies, draw only with colours fed from
// look.ts, so every palette reaches every object (docs/colour-slots.md).
const SHADERS = { 'scene.frag': scene, 'fly.frag': fly };

// Number-only vec3s that are maths or light, not an object's colour.
const ALLOWED = new Set([
  'vec3(0.0, 0.0, 1.0)', // up: the flat-water normal and the half vector toward the viewer
  'vec3(1.0)', // glints, moon shards and the sun's glitter whiten toward white (light, not pigment)
  'vec3(0.2126, 0.7152, 0.0722)', // Rec.709 luminance weights
  'vec3(0.75)', // eyes never darker than this share of the light
]);

// The time-of-day lighting (lighting.ts); every other vec3 uniform is a colour.
const LIGHTING = ['uLightDir', 'uLightCol', 'uAmbient', 'uWaterTint', 'uSky'];

// Any GLSL float or int literal: 1, 1.0, .5, 1., 1e0, +1.0, -2.5e-3.
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LITERAL = new RegExp(String.raw`vec3\(\s*${NUM}(?:\s*,\s*${NUM})*\s*\)`, 'g');

describe('scene colours in the shaders', () => {
  it.each(Object.entries(SHADERS))('%s has no colour literals: every number-only vec3 is maths or light', (_, src) => {
    const literals = src.match(LITERAL) ?? [];
    expect(literals.filter((l) => !ALLOWED.has(l))).toEqual([]);
  });

  it('declare between them exactly the colour uniforms look.ts uploads', () => {
    // Both ways: a colour look.ts doesn't upload stays black on every palette.
    const colours = Object.values(SHADERS).flatMap((src) =>
      [...src.matchAll(/^\s*uniform\s+vec3\s+(\w+)\s*;/gm)].map((m) => m[1]).filter((name) => !LIGHTING.includes(name)),
    );
    expect([...new Set(colours)].sort()).toEqual(Object.keys(POND_SCENE).sort());
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

describe('moon colour (D11)', () => {
  it('pond keeps a fixed blue-white of its own', () => {
    const [r, g, b] = POND_SCENE.uMoonCol;
    expect(b).toBeGreaterThan(r);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.8);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
  });

  it('roles take the highlight, a quarter toward pale', () => {
    const r: ResolvedRoles = {
      background: [0.08, 0.06, 0.16],
      water: [0.2, 0.25, 0.4],
      highlight: [0.95, 0.92, 1.0],
      pale: [0.7, 0.6, 0.9],
      ink: [0.1, 0.1, 0.12],
      accent: [0.9, 0.3, 0.5],
      metallic: [0.8, 0.7, 0.3],
    };
    rolesScene(r).uMoonCol.forEach((v, i) => expect(v).toBeCloseTo(r.highlight[i] + (r.pale[i] - r.highlight[i]) * 0.25, 12));
  });
});

describe('firefly colour (D11)', () => {
  it('pond keeps a fixed yellow-green of its own', () => {
    const [r, g, b] = POND_SCENE.uFlyCol;
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
  });

  it('roles take the metallic, about a third toward the highlight', () => {
    const r: ResolvedRoles = {
      background: [0.96, 0.94, 0.9],
      water: [0.7, 0.75, 0.78],
      highlight: [0.11, 0.15, 0.16],
      pale: [0.3, 0.32, 0.34],
      ink: [0.2, 0.2, 0.22],
      accent: [0.7, 0.2, 0.15],
      metallic: [0.6, 0.5, 0.2],
    };
    rolesScene(r).uFlyCol.forEach((v, i) => expect(v).toBeCloseTo(r.metallic[i] + (r.highlight[i] - r.metallic[i]) * 0.32, 12));
  });
});

describe('sun colour (D11)', () => {
  it('pond keeps a gold of its own', () => {
    const [r, g, b] = POND_SCENE.uSunCol;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0.4);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
  });

  it("roles: the sun's glitter takes the highlight, like the glints", () => {
    const r: ResolvedRoles = {
      background: [0.96, 0.94, 0.9],
      water: [0.7, 0.75, 0.78],
      highlight: [0.11, 0.15, 0.16],
      pale: [0.3, 0.32, 0.34],
      ink: [0.2, 0.2, 0.22],
      accent: [0.7, 0.2, 0.15],
      metallic: [0.6, 0.5, 0.2],
    };
    expect(rolesScene(r).uSunCol).toEqual(r.highlight);
    // scene.frag's sun() tints uSunCol by the light's hue in the pond only.
    const sun = scene.slice(scene.indexOf('void sun('), scene.indexOf('// ----', scene.indexOf('void sun(')));
    expect(sun).toContain('uSunCol * mirrorHue()');
  });
});
