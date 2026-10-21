import { describe, expect, it } from 'vitest';
import { lightingAt, nightWeight, starWeight, type Lighting } from '../src/lighting';
import { asciiLook, graded } from '../src/look';
import { POND, POND_BG, type ResolvedPalette } from '../src/palette';
import before from './fixtures/lighting-0.2.json';

// test/fixtures/lighting-0.2.json is lightingAt() as it was at f374243 (0.2),
// sampled every 0.05 and around each keyframe and handoff.
const BASELINE = before as unknown as Record<string, Omit<Lighting, 'darkWater' | 'darkCaustic'>>;
const PHASES = Object.keys(BASELINE).map(Number);

describe('lightingAt without the darker night', () => {
  it('equals the 0.2 lighting at every sampled phase (D4)', () => {
    expect(PHASES.length).toBeGreaterThan(30);
    for (const p of PHASES) {
      for (const light of [lightingAt(p), lightingAt(p, {}), lightingAt(p, { darkNight: false })]) {
        const { darkWater, darkCaustic, ...rest } = light;
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
      const { darkWater, darkCaustic, ...rest } = dark(p);
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
