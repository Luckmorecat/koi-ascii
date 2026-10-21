import { describe, expect, it } from 'vitest';
import { lightingAt, moonAt, nightWeight, starWeight, sunAt, type Body, type Lighting } from '../src/lighting';
import { asciiLook, graded } from '../src/look';
import { POND, POND_BG, type ResolvedPalette } from '../src/palette';
import before from './fixtures/lighting-0.2.json';

// test/fixtures/lighting-0.2.json is lightingAt() as it was at f374243 (0.2),
// sampled every 0.05 and around each keyframe and handoff.
const BASELINE = before as unknown as Record<string, Omit<Lighting, 'darkWater' | 'darkCaustic' | 'moon' | 'sun'>>;
const PHASES = Object.keys(BASELINE).map(Number);

describe('lightingAt without the darker night', () => {
  it('equals the 0.2 lighting at every sampled phase (D4)', () => {
    expect(PHASES.length).toBeGreaterThan(30);
    for (const p of PHASES) {
      for (const light of [lightingAt(p), lightingAt(p, {}), lightingAt(p, { darkNight: false })]) {
        const { darkWater, darkCaustic, moon: _moon, sun: _sun, ...rest } = light;
        expect(rest, `phase ${p}`).toEqual(BASELINE[String(p)]);
        expect([darkWater, darkCaustic], `phase ${p}`).toEqual([1, 1]);
      }
    }
  });
});

describe('the darker night', () => {
  const dark = (p: number) => lightingAt(p, { darkNight: true });

  it('changes nothing else in the lighting', () => {
    for (const p of PHASES) {
      const { darkWater, darkCaustic, moon, sun, ...rest } = dark(p);
      expect(moon, `phase ${p}`).toEqual(lightingAt(p).moon);
      expect(sun, `phase ${p}`).toEqual(lightingAt(p).sun);
      expect(rest, `phase ${p}`).toEqual(BASELINE[String(p)]);
      expect(darkWater).toBeLessThanOrEqual(1);
      expect(darkCaustic).toBeLessThanOrEqual(1);
    }
  });

  it('at full night: water and background ×0.7, caustics halved', () => {
    for (const p of [0, 0.05, 0.1, 0.15, 0.85, 0.9, 0.95, 0.999]) {
      expect(dark(p).darkWater, `phase ${p}`).toBeCloseTo(0.7, 10);
      expect(dark(p).darkCaustic, `phase ${p}`).toBeCloseTo(0.5, 10);
    }
  });

  it('is exactly off by day, golden hours included', () => {
    for (const p of [0.24, 0.265, 0.34, 0.5, 0.66, 0.74, 0.745, 0.76]) {
      expect([dark(p).darkWater, dark(p).darkCaustic], `phase ${p}`).toEqual([1, 1]);
    }
  });

  it('fades smoothly through both blue hours', () => {
    let prev = dark(0.16).darkWater;
    for (let p = 0.16; p <= 0.25; p += 0.001) {
      const w = dark(p).darkWater;
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(w - prev)).toBeLessThan(0.007);
      prev = w;
    }
    prev = dark(0.75).darkWater;
    for (let p = 0.75; p <= 0.84; p += 0.001) {
      const w = dark(p).darkWater;
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      expect(Math.abs(w - prev)).toBeLessThan(0.007);
      prev = w;
    }
  });
});

describe('nightWeight', () => {
  it('is 1 at night, 0 by day and halfway mid blue hour', () => {
    expect(nightWeight(0)).toBe(1);
    expect(nightWeight(0.95)).toBe(1);
    expect(nightWeight(0.5)).toBe(0);
    expect(nightWeight(0.74)).toBe(0);
    expect(nightWeight(0.205)).toBeCloseTo(0.5, 10);
    expect(nightWeight(0.795)).toBeCloseTo(0.5, 10);
    expect(nightWeight(1.95)).toBe(nightWeight(0.95));
    expect(nightWeight(-0.05)).toBe(nightWeight(0.95));
  });
});

describe('starWeight', () => {
  it('is 0 by day, golden hours and the start of each blue hour included', () => {
    for (const p of [0.215, 0.22, 0.24, 0.265, 0.34, 0.5, 0.66, 0.745, 0.76, 0.78]) {
      expect(starWeight(p), `phase ${p}`).toBe(0);
    }
  });

  it('is 1 at full night', () => {
    for (const p of [0, 0.05, 0.1, 0.15, 0.17, 0.83, 0.9, 0.95, 0.999]) expect(starWeight(p), `phase ${p}`).toBe(1);
  });

  it('arrives after the night and leaves before it: smoothstep(0.35, 1, night)', () => {
    for (let p = 0; p < 1; p += 0.0025) {
      const night = nightWeight(p);
      const t = Math.min(1, Math.max(0, (night - 0.35) / 0.65));
      expect(starWeight(p), `phase ${p}`).toBeCloseTo(t * t * (3 - 2 * t), 12);
      if (night <= 0.35) expect(starWeight(p), `phase ${p}`).toBe(0);
    }
    // Mid evening blue hour: the night is half in, the stars barely.
    expect(starWeight(0.795)).toBeGreaterThan(0);
    expect(starWeight(0.795)).toBeLessThan(0.2);
  });

  it('fades in through the evening blue hour and out through the morning one', () => {
    let prev = starWeight(0.76);
    for (let p = 0.76; p <= 0.84; p += 0.001) {
      const w = starWeight(p);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(w - prev)).toBeLessThan(0.05);
      prev = w;
    }
    prev = starWeight(0.16);
    for (let p = 0.16; p <= 0.25; p += 0.001) {
      const w = starWeight(p);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });
});

describe('graded backgrounds at night', () => {
  const night = lightingAt(0.95);
  const darkNight = lightingAt(0.95, { darkNight: true });

  it('keeps the 0.2 values without the darker night', () => {
    const want = [0, 1, 2].map((i) => POND_BG[i] * night.water[i] + night.sky[i] * 0.15);
    expect(graded(POND_BG, night)).toEqual(want);
  });

  it('darkens the pond background ×0.7 at full night', () => {
    const plain = graded(POND_BG, night);
    graded(POND_BG, darkNight).forEach((v, i) => expect(v).toBeCloseTo(plain[i] * 0.7, 12));
    const look = asciiLook(POND, darkNight);
    look.outBg.forEach((v, i) => expect(v).toBeCloseTo(plain[i] * 0.7, 12));
  });

  it("leaves a roles background as given (it is never graded)", () => {
    const brand = { mode: 'roles', background: [0.08, 0.06, 0.16], css: '#14102a', light: false } as unknown as ResolvedPalette;
    expect(asciiLook(brand, darkNight).outBg).toEqual([0.08, 0.06, 0.16]);
  });
});

const ASPECTS = [
  [1920, 1080],
  [1280, 800],
  [1024, 768],
  [800, 800],
  [1080, 1920],
  [390, 844],
] as const;

/** P1: wherever `body` shows, its whole disc is on the canvas and clear of the middle 40 % of the pond. */
function expectClearOfCentre(body: (phase: number) => Body, phases: number[]): void {
  for (const [w, h] of ASPECTS) {
    for (const p of phases) {
      const m = body(p);
      if (m.alpha === 0) continue;
      const r = m.radius * Math.min(w, h);
      const [x, y] = [m.pos[0] * w, m.pos[1] * h];
      const clear = x + r < 0.3 * w || x - r > 0.7 * w || y + r < 0.3 * h || y - r > 0.7 * h;
      expect(clear, `${w}×${h} at phase ${p}`).toBe(true);
      // …and on the canvas.
      expect(x - r, `${w}×${h} at phase ${p}`).toBeGreaterThan(0);
      expect(y - r, `${w}×${h} at phase ${p}`).toBeGreaterThan(0);
      expect(x + r, `${w}×${h} at phase ${p}`).toBeLessThan(w);
    }
  }
}

describe('the moon (D6, D7, P1)', () => {
  // Every phase on a 0.001 grid, plus both handoff edges.
  const grid = Array.from({ length: 1000 }, (_, k) => k / 1000);

  it('is the lighting\'s moon, from the phase alone', () => {
    for (const p of [0, 0.05, 0.5, 0.9, 0.95]) {
      expect(lightingAt(p).moon).toEqual(moonAt(p));
      expect(lightingAt(p, { darkNight: true }).moon).toEqual(moonAt(p));
    }
    expect(moonAt(1.95)).toEqual(moonAt(0.95));
    expect(moonAt(-0.05)).toEqual(moonAt(0.95));
  });

  it('is gone from the morning handoff to the evening one, [0.19, 0.81]', () => {
    for (const p of grid.filter((p) => p >= 0.19 && p <= 0.81)) expect(moonAt(p).alpha, `phase ${p}`).toBe(0);
    expect(moonAt(0.19).alpha).toBe(0);
    expect(moonAt(0.81).alpha).toBe(0);
  });

  it('is fully out at full night', () => {
    for (const p of [0, 0.05, 0.1, 0.9, 0.95, 0.999]) expect(moonAt(p).alpha, `phase ${p}`).toBe(1);
  });

  it('fades in and out smoothly, within the night', () => {
    for (let k = 0; k < grid.length; k++) {
      const p = grid[k];
      const next = moonAt((k + 1) / 1000).alpha;
      expect(Math.abs(next - moonAt(p).alpha), `phase ${p}`).toBeLessThan(0.04);
      expect(moonAt(p).alpha, `phase ${p}`).toBeLessThanOrEqual(nightWeight(p) + 1e-12);
    }
  });

  it('moves continuously across its whole window, midnight included', () => {
    const visible = [...grid, 1].filter((p) => p > 0.8 || p < 0.2);
    let moved = 0;
    for (const p of visible) {
      const a = moonAt(p).pos;
      const b = moonAt(p + 0.001).pos;
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(step, `phase ${p}`).toBeLessThan(0.006);
      moved += step;
    }
    // It travels: from one side, over the top.
    expect(moved).toBeGreaterThan(0.6);
    expect(moonAt(0.82).pos[0]).toBeLessThan(0.3);
    expect(moonAt(0).pos[1]).toBeLessThan(0.3);
  });

  it('keeps its whole disc out of the middle 40 % of the pond, at any aspect (P1)', () => {
    expectClearOfCentre(moonAt, grid);
  });
});

describe('the sun (D6, D8, P1)', () => {
  const grid = Array.from({ length: 1000 }, (_, k) => k / 1000);

  it("is the lighting's sun, from the phase alone", () => {
    for (const p of [0, 0.3, 0.5, 0.74, 0.95]) {
      expect(lightingAt(p).sun).toEqual(sunAt(p));
      expect(lightingAt(p, { darkNight: true }).sun).toEqual(sunAt(p));
    }
    expect(sunAt(1.5)).toEqual(sunAt(0.5));
    expect(sunAt(-0.5)).toEqual(sunAt(0.5));
  });

  it('is gone through the night and both handoffs, [0.77, 0.23]', () => {
    for (const p of grid.filter((p) => p <= 0.23 || p >= 0.77)) expect(sunAt(p).alpha, `phase ${p}`).toBe(0);
    expect(sunAt(0.21).alpha).toBe(0); // dawn: the prototype drew it on the fish here
  });

  it('is fully out all day, and still out at the golden hours', () => {
    for (const p of [0.28, 0.35, 0.5, 0.66, 0.72]) expect(sunAt(p).alpha, `phase ${p}`).toBe(1);
    expect(sunAt(0.26).alpha).toBeGreaterThan(0.3);
    expect(sunAt(0.74).alpha).toBeGreaterThan(0.3);
  });

  it('fades smoothly and never shares the sky with the moon', () => {
    for (let k = 0; k < grid.length; k++) {
      const p = grid[k];
      const next = sunAt((k + 1) / 1000).alpha;
      expect(Math.abs(next - sunAt(p).alpha), `phase ${p}`).toBeLessThan(0.04);
      expect(sunAt(p).alpha + moonAt(p).alpha, `phase ${p}`).toBeLessThanOrEqual(1);
      expect(Math.min(sunAt(p).alpha, moonAt(p).alpha), `phase ${p}`).toBe(0);
    }
  });

  it('moves continuously from the left side over the top, out near the top-right corner', () => {
    let moved = 0;
    for (const p of grid.filter((p) => p >= 0.22 && p <= 0.78)) {
      const a = sunAt(p).pos;
      const b = sunAt(p + 0.001).pos;
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(step, `phase ${p}`).toBeLessThan(0.006);
      moved += step;
    }
    expect(moved).toBeGreaterThan(0.6);
    expect(sunAt(0.25).pos[0]).toBeLessThan(0.3); // morning: the left side
    expect(sunAt(0.5).pos[1]).toBeLessThan(0.3); // noon: the top edge
    // It rises where the moon rises and sets where the moon sets, in the
    // top-right corner: never down the right side (P1: the top edge and one side).
    for (const [sun, moon] of [
      [0.23, 0.81],
      [0.77, 0.19],
    ]) {
      expect(sunAt(sun).pos[0]).toBeCloseTo(moonAt(moon).pos[0], 9);
      expect(sunAt(sun).pos[1]).toBeCloseTo(moonAt(moon).pos[1], 9);
    }
    for (const p of grid.filter((p) => sunAt(p).alpha > 0 && sunAt(p).pos[0] > 0.7)) {
      expect(sunAt(p).pos[1], `phase ${p}`).toBeLessThan(0.3);
    }
  });

  it('keeps its whole glitter patch out of the middle 40 % of the pond, at any aspect (P1)', () => {
    expectClearOfCentre(sunAt, grid);
  });
});
