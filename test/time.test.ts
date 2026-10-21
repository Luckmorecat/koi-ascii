import { describe, expect, it } from 'vitest';
import { ClockSource, DEFAULT_CYCLE_S, FixedSource, LoopSource, Sky, timeSource, type TimeSource } from '../src/sky';

const at = (h: number, m = 0, s = 0) => () => new Date(2026, 0, 1, h, m, s);

describe('timeSource', () => {
  it('defaults to a 600 s loop from midnight', () => {
    const src = timeSource(undefined, 0);
    expect(src).toBeInstanceOf(LoopSource);
    expect((src as LoopSource).cycle).toBe(DEFAULT_CYCLE_S);
    expect(src.tick(0)).toBe(0);
  });

  it('loops through a day every cycle seconds from phase', () => {
    const src = timeSource({ mode: 'loop', cycle: 100, phase: 0.5 }, 0);
    expect(src.tick(0)).toBe(0.5);
    expect(src.tick(25)).toBeCloseTo(0.75);
    expect(src.tick(50)).toBeCloseTo(0.25);
  });

  it('continues from the current phase when a loop gives none', () => {
    expect(timeSource({ mode: 'loop' }, 0.4).tick(0)).toBeCloseTo(0.4);
    expect(timeSource({ mode: 'loop', cycle: 60 }, 0.9).tick(0)).toBeCloseTo(0.9);
  });

  it('falls back to defaults for invalid values instead of throwing', () => {
    for (const cycle of [0, 0.5, 86_401, NaN, Infinity, -5]) {
      expect((timeSource({ mode: 'loop', cycle }, 0) as LoopSource).cycle).toBe(DEFAULT_CYCLE_S);
    }
    expect((timeSource({ mode: 'loop', cycle: 1 }, 0) as LoopSource).cycle).toBe(1);
    expect((timeSource({ mode: 'loop', cycle: 86_400 }, 0) as LoopSource).cycle).toBe(86_400);
    for (const phase of [-0.1, 1.5, NaN]) {
      expect(timeSource({ mode: 'loop', phase }, 0.6).tick(0)).toBe(0);
      expect(timeSource({ mode: 'fixed', phase }, 0.6).tick(0)).toBe(0);
    }
    // Plain JS callers can pass anything.
    expect(timeSource({ mode: 'nope' } as never, 0.3)).toBeInstanceOf(LoopSource);
    expect(timeSource(null as never, 0).tick(0)).toBe(0);
    expect(timeSource({ mode: 'fixed' } as never, 0.3).tick(0)).toBe(0);
  });

  it('keeps a fixed phase however much time passes', () => {
    const src = timeSource({ mode: 'fixed', phase: 0.8 }, 0);
    expect(src).toBeInstanceOf(FixedSource);
    expect(src.tick(0)).toBeCloseTo(0.8);
    expect(src.tick(1000)).toBeCloseTo(0.8);
    expect(timeSource({ mode: 'fixed', phase: 1 }, 0).tick(0)).toBe(0);
  });

  it('gives clock mode as a ClockSource', () => {
    expect(timeSource({ mode: 'clock' }, 0)).toBeInstanceOf(ClockSource);
  });
});

describe('ClockSource', () => {
  it('follows local hours / 24', () => {
    expect(new ClockSource(at(0)).tick()).toBe(0);
    expect(new ClockSource(at(6)).tick()).toBe(0.25);
    expect(new ClockSource(at(12)).tick()).toBe(0.5);
    expect(new ClockSource(at(18)).tick()).toBe(0.75);
    expect(new ClockSource(at(18, 30, 36)).tick()).toBeCloseTo(18.51 / 24, 10);
  });

  it('ignores rendered time', () => {
    const src: TimeSource = new ClockSource(at(9));
    expect(src.tick(5000)).toBe(src.tick(0));
  });
});

describe('Sky.setSource', () => {
  it('switches sources live and keeps a held phase', () => {
    const sky = new Sky(new LoopSource(100, 0.1));
    expect(sky.update(10)).toBeCloseTo(0.2);
    sky.setSource(timeSource({ mode: 'fixed', phase: 0.7 }, sky.phase));
    expect(sky.phase).toBeCloseTo(0.7);
    expect(sky.update(10)).toBeCloseTo(0.7);
    sky.setSource(timeSource({ mode: 'loop', cycle: 100 }, sky.phase));
    expect(sky.update(10)).toBeCloseTo(0.8);

    sky.hold(0.3);
    sky.setSource(new FixedSource(0.9));
    expect(sky.phase).toBeCloseTo(0.3);
    sky.release();
    expect(sky.update(1)).toBeCloseTo(0.3);
  });
});
