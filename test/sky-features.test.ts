import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SKY, DEFAULT_SKY, NO_SKY, resolveSky, starsAt } from '../src/sky-features';
import { starWeight } from '../src/lighting';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const ON_BY_DEFAULT = { stars: true, fireflies: true, darkNight: true, moon: false, sun: false };

describe('resolveSky', () => {
  it('omitted: stars, fireflies and the darker night on, moon and sun off (D1)', () => {
    expect(resolveSky(undefined)).toEqual(ON_BY_DEFAULT);
    expect(resolveSky(null)).toEqual(ON_BY_DEFAULT);
    expect(DEFAULT_SKY).toEqual(ON_BY_DEFAULT);
    expect(warn).not.toHaveBeenCalled();
  });

  it('true turns everything on, false everything off', () => {
    expect(resolveSky(true)).toEqual({ stars: true, fireflies: true, darkNight: true, moon: true, sun: true });
    expect(resolveSky(false)).toEqual({ stars: false, fireflies: false, darkNight: false, moon: false, sun: false });
    expect(resolveSky(true)).toBe(ALL_SKY);
    expect(resolveSky(false)).toBe(NO_SKY);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an object overrides the defaults one field at a time', () => {
    expect(resolveSky({ moon: true })).toEqual({ ...ON_BY_DEFAULT, moon: true });
    expect(resolveSky({ darkNight: false })).toEqual({ ...ON_BY_DEFAULT, darkNight: false });
    expect(resolveSky({ stars: false, sun: true })).toEqual({ ...ON_BY_DEFAULT, stars: false, sun: true });
    expect(resolveSky({})).toEqual(ON_BY_DEFAULT);
    expect(resolveSky({ moon: undefined })).toEqual(ON_BY_DEFAULT);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once for a non-boolean field and keeps its default', () => {
    expect(resolveSky({ stars: 'yes' })).toEqual(ON_BY_DEFAULT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('koi-ascii: sky.stars must be true or false; got "yes", using true.');
    warn.mockClear();
    expect(resolveSky({ moon: 1, sun: true })).toEqual({ ...ON_BY_DEFAULT, sun: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns for an unknown field and ignores it', () => {
    expect(resolveSky({ comets: true, moon: true })).toEqual({ ...ON_BY_DEFAULT, moon: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^koi-ascii: unknown sky feature 'comets'/);
  });

  it('warns and uses the defaults for anything that is not a boolean or an object', () => {
    for (const input of [3, 'on', [], () => true, Symbol('x'), 0n]) {
      warn.mockClear();
      expect(resolveSky(input)).toEqual(ON_BY_DEFAULT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/^koi-ascii: sky must be true, false or an object/);
    }
  });

  it('never throws, even for hostile objects', () => {
    const trap = new Proxy({}, { ownKeys: () => { throw new Error('trap'); } });
    expect(resolveSky(trap)).toEqual(ON_BY_DEFAULT);
    const getter = { get moon(): boolean { throw new Error('boom'); } };
    expect(resolveSky(getter)).toEqual(ON_BY_DEFAULT);
  });

  it('returns frozen results', () => {
    expect(Object.isFrozen(resolveSky({ moon: true }))).toBe(true);
    expect(Object.isFrozen(resolveSky(undefined))).toBe(true);
  });
});

describe('starsAt', () => {
  it('draws stars with their weight only while sky.stars is on', () => {
    for (const p of [0, 0.5, 0.8, 0.95]) {
      expect(starsAt(p, DEFAULT_SKY, false).stars).toBe(starWeight(p));
      expect(starsAt(p, { ...DEFAULT_SKY, stars: false }, false).stars).toBe(0);
      expect(starsAt(p, NO_SKY, false)).toEqual({ stars: 0, moteThin: 0 });
    }
  });

  it('thins the motes only on a light palette with stars showing (D10)', () => {
    expect(starsAt(0.95, DEFAULT_SKY, false).moteThin).toBe(0);
    expect(starsAt(0.95, DEFAULT_SKY, true).moteThin).toBe(1);
    expect(starsAt(0.95, { ...DEFAULT_SKY, stars: false }, true).moteThin).toBe(0);
    expect(starsAt(0.5, DEFAULT_SKY, true).moteThin).toBe(0);
    expect(starsAt(0.82, ALL_SKY, true).moteThin).toBe(starWeight(0.82));
  });
});
