import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  koiPalettes,
  type KoiPondFilterPalette,
  type KoiPondOptions,
  type KoiPondPalette,
  type KoiPondPaletteName,
} from '../src/index';
import {
  POND,
  POND_BACKGROUND,
  isLight,
  relativeLuminance,
  resolveIntensity,
  resolvePalette,
  type ParseColor,
  type RGB,
} from '../src/palette';

// vitest runs without a DOM, so the browser's colour parser is stood in for by
// a hex-only one (null = rejected, like the real one does for junk and var()).
const parse: ParseColor = (css) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgb = (hex: string): RGB => parse(hex)!;
const HI_RED: RGB = [0.95, 0.31, 0.17];
const OGON_GOLD: RGB = [0.97, 0.72, 0.24];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('koiPalettes', () => {
  it('has the six presets with their modes; pond changes nothing', () => {
    expect(Object.keys(koiPalettes).sort()).toEqual(['amber', 'brand', 'mono', 'paper', 'phosphor', 'pond']);
    expect(koiPalettes.pond).toEqual({ mode: 'filter' });
    for (const name of ['mono', 'phosphor', 'amber'] as const) expect(koiPalettes[name].mode).toBe('ramp');
    for (const name of ['paper', 'brand'] as const) expect(koiPalettes[name].mode).toBe('roles');
  });

  it('is frozen all the way down', () => {
    expect(() => {
      (koiPalettes.paper.fish as { accent?: string }).accent = '#000';
    }).toThrow(TypeError);
    expect(() => {
      (koiPalettes.mono.colors as string[]).push('#fff');
    }).toThrow(TypeError);
    expect(() => {
      (koiPalettes as unknown as Record<string, unknown>).pond = {};
    }).toThrow(TypeError);
  });

  it('every preset resolves without a warning', () => {
    for (const name of Object.keys(koiPalettes) as KoiPondPaletteName[]) {
      expect(resolvePalette(name, parse).mode).toBe(koiPalettes[name].mode);
      expect(resolvePalette(koiPalettes[name], parse)).toEqual(resolvePalette(name, parse));
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("supports the issue's copy-and-tweak example (and its declared type)", () => {
    const options: KoiPondOptions = {
      palette: { ...koiPalettes.paper, fish: { ...koiPalettes.paper.fish, accent: '#0a7' } },
    };
    const issueType: Readonly<Record<KoiPondPaletteName, Exclude<KoiPondPalette, string>>> = koiPalettes;
    const r = resolvePalette(options.palette, parse);
    expect(r.mode === 'roles' && r.roles.accent).toEqual(rgb('#0a7'));
    expect(issueType.pond).toBe(koiPalettes.pond);
  });
});

describe('resolvePalette', () => {
  it('treats no palette as pond, silently', () => {
    expect(resolvePalette(undefined, parse)).toBe(POND);
    expect(resolvePalette(null, parse)).toBe(POND);
    expect(warn).not.toHaveBeenCalled();
  });

  it('pond is a filter with no background (time-of-day graded) and no change', () => {
    expect(POND).toEqual({
      mode: 'filter',
      background: null,
      css: POND_BACKGROUND,
      light: false,
      tint: [1, 1, 1],
      saturation: 1,
      invert: false,
    });
    expect(resolvePalette('pond', parse)).toEqual(POND);
  });

  it('falls back to pond on an unknown preset, mode or shape, with a warning', () => {
    for (const bad of ['sepia', { mode: 'gradient' }, {}, 42, [], true]) {
      warn.mockClear();
      expect(resolvePalette(bad, parse)).toEqual(POND);
      expect(warn).toHaveBeenCalledOnce();
    }
  });

  it('never throws, even on a palette whose fields throw', () => {
    const trap = new Proxy({}, { get: () => { throw new Error('trap'); } });
    expect(resolvePalette(trap, parse)).toEqual(POND);
    expect(resolvePalette({ mode: 'roles', background: '#fff' }, () => { throw new Error('parser'); })).toMatchObject({ mode: 'roles' });
    expect(warn).toHaveBeenCalled();
  });

  describe('ramp', () => {
    it('keeps 2 to 5 stops, background first', () => {
      const r = resolvePalette({ mode: 'ramp', colors: ['#000', '#808080', '#fff'] }, parse);
      expect(r).toMatchObject({ mode: 'ramp', background: [0, 0, 0], css: '#000000', light: false });
      expect(r.mode === 'ramp' && r.stops).toEqual([[0, 0, 0], rgb('#808080'), [1, 1, 1]]);
      for (const n of [2, 5]) {
        const colors = Array.from({ length: n }, () => '#123456');
        expect(resolvePalette({ mode: 'ramp', colors }, parse).mode).toBe('ramp');
      }
      expect(warn).not.toHaveBeenCalled();
    });

    it('falls back to pond on a wrong stop count or an invalid stop', () => {
      for (const colors of [['#000'], Array(6).fill('#000'), [], 'nope', ['#000', 'var(--x)'], ['#000', 7]]) {
        warn.mockClear();
        expect(resolvePalette({ mode: 'ramp', colors }, parse)).toEqual(POND);
        expect(warn).toHaveBeenCalledOnce();
      }
    });

    it('is light when the first stop is', () => {
      expect(resolvePalette({ mode: 'ramp', colors: ['#fff', '#000'] }, parse)).toMatchObject({ light: true });
    });
  });

  describe('roles', () => {
    it('keeps every slot that is given', () => {
      const r = resolvePalette(
        {
          mode: 'roles',
          background: '#102030',
          water: '#203040',
          highlight: '#eeeeee',
          fish: { pale: '#dddddd', ink: '#333333', accent: '#ff0000', metallic: '#ffcc00' },
        },
        parse,
      );
      expect(r).toEqual({
        mode: 'roles',
        background: rgb('#102030'),
        css: '#102030',
        light: false,
        roles: {
          background: rgb('#102030'),
          water: rgb('#203040'),
          highlight: rgb('#eeeeee'),
          pale: rgb('#dddddd'),
          ink: rgb('#333333'),
          accent: rgb('#ff0000'),
          metallic: rgb('#ffcc00'),
        },
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('derives missing slots: white highlight on dark, pond red and gold', () => {
      const r = resolvePalette({ mode: 'roles', background: '#000' }, parse);
      if (r.mode !== 'roles') throw new Error('roles expected');
      expect(r.roles.highlight).toEqual([1, 1, 1]);
      expect(r.roles.accent).toEqual(HI_RED);
      expect(r.roles.metallic).toEqual(OGON_GOLD);
      // Mixed from background toward highlight: water dimmest, pale brightest.
      const lum = (c: RGB) => relativeLuminance(c);
      expect(lum(r.roles.water)).toBeGreaterThan(0);
      expect(lum(r.roles.water)).toBeLessThan(lum(r.roles.ink));
      expect(lum(r.roles.ink)).toBeLessThan(lum(r.roles.pale));
      expect(lum(r.roles.pale)).toBeLessThan(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('derives a near-black highlight on a light background, and slots from the given highlight', () => {
      const light = resolvePalette({ mode: 'roles', background: '#fff' }, parse);
      if (light.mode !== 'roles') throw new Error('roles expected');
      expect(light.light).toBe(true);
      expect(relativeLuminance(light.roles.highlight)).toBeLessThan(0.05);
      expect(relativeLuminance(light.roles.pale)).toBeLessThan(relativeLuminance(light.roles.water));

      const given = resolvePalette({ mode: 'roles', background: '#000', highlight: '#ff0000' }, parse);
      if (given.mode !== 'roles') throw new Error('roles expected');
      expect(given.roles.pale[1]).toBe(0);
      expect(given.roles.pale[0]).toBeGreaterThan(0.5);
    });

    it('falls back field by field, with a warning each', () => {
      const r = resolvePalette(
        { mode: 'roles', background: '#000', water: 'oops', fish: { accent: 12, metallic: '#ffcc00' } },
        parse,
      );
      expect(warn).toHaveBeenCalledTimes(2);
      const derived = resolvePalette({ mode: 'roles', background: '#000', fish: { metallic: '#ffcc00' } }, parse);
      expect(r).toEqual(derived);
    });

    it('uses the pond background when the background is missing or invalid', () => {
      for (const background of [undefined, 'nope']) {
        warn.mockClear();
        const r = resolvePalette({ mode: 'roles', background }, parse);
        expect(r).toMatchObject({ mode: 'roles', css: POND_BACKGROUND });
        // The shaders' own pond background: #06131a to within a byte.
        if (r.mode === 'roles') r.background.forEach((v, c) => expect(Math.abs(v - rgb(POND_BACKGROUND)[c])).toBeLessThan(0.5 / 255));
        expect(warn).toHaveBeenCalledOnce();
      }
    });

    it('ignores a fish field that is not an object, with a warning', () => {
      expect(resolvePalette({ mode: 'roles', background: '#000', fish: 'red' }, parse)).toEqual(
        resolvePalette({ mode: 'roles', background: '#000' }, parse),
      );
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe('filter', () => {
    it('defaults to no change over the graded pond background', () => {
      expect(resolvePalette({ mode: 'filter' }, parse)).toEqual(POND);
    });

    it('keeps a background, tint, saturation and invert', () => {
      const p: KoiPondFilterPalette = { mode: 'filter', background: '#f0f0f0', tint: '#ff8000', saturation: 0.25, invert: true };
      expect(resolvePalette(p, parse)).toEqual({
        mode: 'filter',
        background: rgb('#f0f0f0'),
        css: '#f0f0f0',
        light: true,
        tint: rgb('#ff8000'),
        saturation: 0.25,
        invert: true,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('falls back field by field, with a warning each', () => {
      const r = resolvePalette({ mode: 'filter', background: 'nope', tint: 'var(--brand)', saturation: Number.NaN, invert: 'yes' }, parse);
      expect(r).toEqual(POND);
      expect(warn).toHaveBeenCalledTimes(4);
    });

    it('clamps saturation into [0, 1]', () => {
      expect(resolvePalette({ mode: 'filter', saturation: 3 }, parse)).toMatchObject({ saturation: 1 });
      expect(resolvePalette({ mode: 'filter', saturation: -1 }, parse)).toMatchObject({ saturation: 0 });
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});

describe('light backgrounds', () => {
  it('uses WCAG relative luminance with a 0.4 threshold', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1);
    // sRGB 0.6656 grey ≈ luminance 0.4; mid-grey #808080 ≈ 0.216 (dark).
    expect(isLight([0.67, 0.67, 0.67])).toBe(true);
    expect(isLight([0.66, 0.66, 0.66])).toBe(false);
    expect(isLight(rgb('#808080'))).toBe(false);
    expect(isLight(rgb(POND_BACKGROUND))).toBe(false);
    expect(isLight(rgb('#f3efe6'))).toBe(true);
  });
});

describe('resolveIntensity', () => {
  it('defaults an omitted option to 1, silently', () => {
    expect(resolveIntensity(undefined, 1, true)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps values in [0, 1]', () => {
    for (const v of [0, 0.35, 1]) expect(resolveIntensity(v, 1, false)).toBe(v);
    expect(warn).not.toHaveBeenCalled();
  });

  it('clamps out-of-range numbers with a warning', () => {
    expect(resolveIntensity(1.5, 0.3, false)).toBe(1);
    expect(resolveIntensity(-2, 0.3, false)).toBe(0);
    expect(resolveIntensity(Number.POSITIVE_INFINITY, 0.3, false)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('falls back on NaN or a non-number with a warning', () => {
    expect(resolveIntensity(Number.NaN, 1, true)).toBe(1);
    expect(resolveIntensity('0.5', 0.3, false)).toBe(0.3);
    expect(resolveIntensity(undefined, 0.3, false)).toBe(0.3);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
