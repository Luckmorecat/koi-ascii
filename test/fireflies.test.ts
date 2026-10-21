import { describe, expect, it } from 'vitest';
import { FIREFLY_COUNT, Fireflies } from '../src/fireflies';
import { fireflyWeight } from '../src/lighting';
import { Pond } from '../src/pond';
import { DEFAULT_SKY, firefliesAt, NO_SKY, resolveSky } from '../src/sky-features';

const STEP = 1 / 120;

/** Steps `f` for `seconds` in fixed steps and returns a copy of its packed state at `w` × `h`. */
function run(f: Fireflies, seconds: number, calm: boolean, w = 1280, h = 800): Float32Array {
  for (let n = Math.round(seconds / STEP); n > 0; n--) f.step(STEP, calm);
  return f.pack(w, h).slice();
}

/** Flash (vec4 .z) of every firefly over `seconds`, sampled each step. */
function flashes(f: Fireflies, seconds: number, calm: boolean): number[][] {
  const out: number[][] = Array.from({ length: FIREFLY_COUNT }, () => []);
  for (let n = Math.round(seconds / STEP); n > 0; n--) {
    f.step(STEP, calm);
    const d = f.pack(1280, 800);
    for (let i = 0; i < FIREFLY_COUNT; i++) out[i].push(d[i * 4 + 2]);
  }
  return out;
}

describe('fireflies', () => {
  it('pack one vec4 per firefly: x, y, flash, seed', () => {
    const f = new Fireflies(7);
    const d = f.pack(1280, 800);
    expect(d).toBeInstanceOf(Float32Array);
    expect(d.length).toBe(FIREFLY_COUNT * 4);
    expect(FIREFLY_COUNT).toBe(14);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      expect(d[i * 4 + 2]).toBeGreaterThanOrEqual(0);
      expect(d[i * 4 + 2]).toBeLessThanOrEqual(1);
      expect(d[i * 4 + 3]).toBeGreaterThanOrEqual(0);
      expect(d[i * 4 + 3]).toBeLessThan(1);
    }
  });

  it('are deterministic for a seed and differ between seeds', () => {
    expect(run(new Fireflies(42), 30, false)).toEqual(run(new Fireflies(42), 30, false));
    expect(run(new Fireflies(42), 30, false)).not.toEqual(run(new Fireflies(43), 30, false));
  });

  it('spread over the pond and stay inside it at any size', () => {
    for (const [w, h] of [
      [1280, 800],
      [390, 844],
      [1920, 1080],
      [120, 90],
    ]) {
      const f = new Fireflies(3);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let t = 0; t < 600; t += 0.25) {
        const d = run(f, 0.25, false, w, h);
        for (let i = 0; i < FIREFLY_COUNT; i++) {
          xs.push(d[i * 4] / w);
          ys.push(d[i * 4 + 1] / h);
        }
      }
      for (const v of [...xs, ...ys]) {
        if (!(v > 0 && v < 1)) expect.fail(`${w}×${h}: ${v} of the pond is outside it`);
      }
      // Not bunched: they cover most of the width over time.
      expect(Math.max(...xs) - Math.min(...xs), `${w}×${h}`).toBeGreaterThan(0.6);
    }
  });

  it('drift slowly: a few cells a second at most', () => {
    const f = new Fireflies(9);
    let prev = run(f, STEP, false);
    for (let s = 0; s < 1200; s++) {
      const d = run(f, STEP, false);
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        // Under 40 px/s at 1280×800.
        expect(Math.hypot(d[i * 4] - prev[i * 4], d[i * 4 + 1] - prev[i * 4 + 1])).toBeLessThan(40 * STEP);
      }
      prev = d;
    }
  });

  it('blink in short pulses, dark in between', () => {
    for (const series of flashes(new Fireflies(5), 20, false)) {
      expect(Math.max(...series)).toBeGreaterThan(0.95);
      // Dark at least half the time.
      expect(series.filter((v) => v < 0.05).length / series.length).toBeGreaterThan(0.45);
    }
  });

  describe('under reduced motion (calm)', () => {
    it('drift at 0.35× the speed', () => {
      // The same path: T calm seconds go as far as 0.35 T normal ones.
      const normal = run(new Fireflies(11), 7, false);
      const calm = run(new Fireflies(11), 20, true);
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        expect(calm[i * 4]).toBeCloseTo(normal[i * 4], 1);
        expect(calm[i * 4 + 1]).toBeCloseTo(normal[i * 4 + 1], 1);
      }
    });

    it('breathe instead of blinking: always lit, changing slowly', () => {
      for (const series of flashes(new Fireflies(5), 30, true)) {
        expect(Math.min(...series)).toBeGreaterThan(0.15);
        expect(Math.max(...series)).toBeLessThan(0.95);
        expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(0.4);
        const steps = series.slice(1).map((v, k) => Math.abs(v - series[k]));
        expect(Math.max(...steps)).toBeLessThan(0.01);
      }
    });
  });

  describe('in a pond', () => {
    it('advance with the pond in fixed steps, whatever the frame rate', () => {
      const a = new Pond(1280, 800, 42);
      const b = new Pond(1280, 800, 42);
      for (let k = 0; k < 240; k++) a.update(1 / 60);
      for (let k = 0; k < 120; k++) b.update(1 / 30);
      expect(a.time).toBeCloseTo(b.time, 9);
      expect(a.packFireflies()).toEqual(b.packFireflies());
    });

    it('are seeded from the pond: same seed, same fireflies', () => {
      const pond = (seed: number) => {
        const p = new Pond(1280, 800, seed);
        for (let k = 0; k < 120; k++) p.update(1 / 60);
        return p.packFireflies().slice();
      };
      expect(pond(42)).toEqual(pond(42));
      expect(pond(42)).not.toEqual(pond(7));
    });

    it('follow a resize', () => {
      const p = new Pond(1280, 800, 1);
      p.update(1);
      p.resize(400, 300);
      const d = p.packFireflies();
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        expect(d[i * 4]).toBeLessThan(400);
        expect(d[i * 4 + 1]).toBeLessThan(300);
      }
    });

    it('take the calm drift from the pond', () => {
      const a = new Pond(1280, 800, 3);
      const b = new Pond(1280, 800, 3);
      b.calm = true;
      for (let k = 0; k < 60; k++) {
        a.update(1 / 60);
        b.update(1 / 60);
      }
      expect(b.packFireflies()).not.toEqual(a.packFireflies());
    });
  });
});

describe('the firefly window', () => {
  it('is zero by day, at dawn and at full night', () => {
    for (const p of [0, 0.05, 0.21, 0.3, 0.5, 0.7, 0.74, 0.95, 0.97, 1]) {
      expect(fireflyWeight(p), `phase ${p}`).toBe(0);
    }
  });

  it('opens after the golden hour and closes into the night', () => {
    expect(fireflyWeight(0.78)).toBeGreaterThan(0.3);
    expect(fireflyWeight(0.83)).toBe(1);
    expect(fireflyWeight(0.87)).toBe(1);
    expect(fireflyWeight(0.9)).toBeGreaterThan(0.5);
    expect(fireflyWeight(0.9)).toBeLessThan(1);
    expect(fireflyWeight(1.83)).toBe(fireflyWeight(0.83));
  });

  it('is smooth: no jump between neighbouring phases', () => {
    for (let p = 0.7; p < 1; p += 0.001) {
      expect(Math.abs(fireflyWeight(p + 0.001) - fireflyWeight(p))).toBeLessThan(0.05);
    }
  });

  it('applies only with sky.fireflies on', () => {
    expect(firefliesAt(0.83, DEFAULT_SKY)).toBe(1);
    expect(firefliesAt(0.83, resolveSky(true))).toBe(1);
    expect(firefliesAt(0.83, NO_SKY)).toBe(0);
    expect(firefliesAt(0.83, resolveSky({ fireflies: false }))).toBe(0);
    expect(firefliesAt(0.5, DEFAULT_SKY)).toBe(0);
  });
});
