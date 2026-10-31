import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVOID_MAX,
  AvoidZones,
  avoidAmounts,
  buildZones,
  CULL_MARGIN,
  DEFAULT_FADE,
  parseRadius,
  resolveAvoidFade,
  resolveAvoidList,
  type Box,
  type ZoneSource,
} from '../src/avoid';

let warnings: string[];
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((m: string) => void warnings.push(m));
});
afterEach(() => vi.unstubAllGlobals());

/** A stand-in element: a box, a border radius, attached or not. */
interface Fake {
  rect: Box;
  radius: string;
  isConnected: boolean;
  getBoundingClientRect(): Box;
}
function el(rect: Box, radius = '0px', connected = true): Fake {
  const f: Fake = { rect, radius, isConnected: connected, getBoundingClientRect: () => ({ ...f.rect }) };
  return f;
}
const asEl = (f: Fake) => f as unknown as Element;

describe('avoidFade resolution (A2, D9)', () => {
  it('defaults to strength 1 and feather 56', () => {
    expect(resolveAvoidFade(undefined)).toEqual({ strength: 1, feather: 56 });
    expect(resolveAvoidFade({})).toEqual({ strength: 1, feather: 56 });
    expect(warnings).toEqual([]);
  });

  it('takes valid values, feather 0 included', () => {
    expect(resolveAvoidFade({ strength: 0.4, feather: 0 })).toEqual({ strength: 0.4, feather: 0 });
    expect(warnings).toEqual([]);
  });

  it('clamps strength to [0, 1] with a warning', () => {
    expect(resolveAvoidFade({ strength: 2 }).strength).toBe(1);
    expect(resolveAvoidFade({ strength: -0.5 }).strength).toBe(0);
    expect(warnings).toHaveLength(2);
  });

  it('a non-finite strength or a bad feather warns and takes the default', () => {
    for (const strength of [NaN, Infinity, '0.5', null]) {
      expect(resolveAvoidFade({ strength } as never, { strength: 0.3, feather: 20 }).strength).toBe(1);
    }
    for (const feather of [-1, NaN, Infinity, '8']) {
      expect(resolveAvoidFade({ feather } as never, { strength: 0.3, feather: 20 }).feather).toBe(56);
    }
    expect(warnings).toHaveLength(8);
    expect(warnings.every((w) => w.startsWith('koi-ascii: '))).toBe(true);
  });

  it('fields left out keep the current fade, so animating strength keeps the feather', () => {
    const current = { strength: 1, feather: 80 };
    expect(resolveAvoidFade({ strength: 0.5 }, current)).toEqual({ strength: 0.5, feather: 80 });
    expect(resolveAvoidFade({}, current)).toBe(current);
  });

  it('a non-object warns and keeps the fade', () => {
    expect(resolveAvoidFade(3)).toBe(DEFAULT_FADE);
    expect(resolveAvoidFade([])).toBe(DEFAULT_FADE);
    expect(warnings).toHaveLength(2);
  });
});

describe('strength mapping (A4)', () => {
  it('at 1: fish thin 0.6 x 0.85 and dim 0.85, water thins 0.8 and dims 0.6', () => {
    const a = avoidAmounts(1);
    expect(a.fishThin).toBeCloseTo(0.51, 12);
    expect(a.fishDim).toBe(0.85);
    expect(a.waterThin).toBe(0.8);
    expect(a.waterDim).toBe(0.6);
  });

  it('scales linearly, 0 is no fade', () => {
    const half = avoidAmounts(0.5);
    const one = avoidAmounts(1);
    for (const k of Object.keys(one) as (keyof typeof one)[]) expect(half[k]).toBeCloseTo(one[k] / 2, 12);
    expect(Object.values(avoidAmounts(0))).toEqual([0, 0, 0, 0]);
  });
});

describe('avoid list resolution (A1, A2, M4)', () => {
  const a = el({ left: 0, top: 0, width: 10, height: 10 });

  it('takes elements and { element, pad }, pad 12 by default', () => {
    expect(resolveAvoidList([asEl(a), { element: asEl(a), pad: 4 }, { element: asEl(a) }])).toEqual([
      { element: a, pad: 12 },
      { element: a, pad: 4 },
      { element: a, pad: 12 },
    ]);
    expect(resolveAvoidList(undefined)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('a bad pad warns and falls back to 12; pad 0 is valid', () => {
    for (const pad of [-1, NaN, Infinity, '4', null]) {
      expect(resolveAvoidList([{ element: asEl(a), pad } as never])[0].pad).toBe(12);
    }
    expect(resolveAvoidList([{ element: asEl(a), pad: 0 }])[0].pad).toBe(0);
    expect(warnings).toHaveLength(5);
  });

  it('a non-array warns and avoids nothing', () => {
    expect(resolveAvoidList(asEl(a))).toEqual([]);
    expect(resolveAvoidList('#hero')).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('skips entries that are not elements, DOMRects included, with a warning each', () => {
    const domRect = { x: 0, y: 0, left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, toJSON() {} };
    const list = resolveAvoidList([null, domRect, '#hero', { element: domRect }, {}, asEl(a)]);
    expect(list).toEqual([{ element: a, pad: 12 }]);
    expect(warnings).toHaveLength(5);
  });
});

describe('border radius parsing (M13)', () => {
  it('px, %, an ellipse (its first radius) and nothing', () => {
    expect(parseRadius('8px')).toEqual({ px: 8, frac: 0 });
    expect(parseRadius('50%')).toEqual({ px: 0, frac: 0.5 });
    expect(parseRadius('12px 4px')).toEqual({ px: 12, frac: 0 });
    expect(parseRadius('0px')).toEqual({ px: 0, frac: 0 });
    expect(parseRadius('')).toEqual({ px: 0, frac: 0 });
    expect(parseRadius(undefined)).toEqual({ px: 0, frac: 0 });
  });
});

describe('zone building (A5, A8–A10)', () => {
  const CANVAS: Box = { left: 0, top: 0, width: 800, height: 600 };
  const rects = new Float32Array(AVOID_MAX * 4);
  const radii = new Float32Array(AVOID_MAX);
  const zone = (rect: Box, pad = 12, radius = { px: 0, frac: 0 }): ZoneSource => ({ rect, pad, radius });
  const build = (sources: ZoneSource[], canvas = CANVAS, viewW = 800, viewH = 600, feather = 56) =>
    buildZones(sources, canvas, viewW, viewH, feather, rects, radii);
  const rect = (i: number) => [...rects.slice(i * 4, i * 4 + 4)];

  it('grows the box by pad and rounds by border radius plus pad', () => {
    expect(build([zone({ left: 100, top: 50, width: 200, height: 40 }, 12, { px: 8, frac: 0 })])).toBe(1);
    expect(rect(0)).toEqual([88, 38, 224, 64]);
    expect(radii[0]).toBe(20);
  });

  it('resolves a % radius against the box each time', () => {
    build([zone({ left: 0, top: 0, width: 100, height: 60 }, 0, { px: 0, frac: 0.5 })]);
    expect(radii[0]).toBe(30);
    build([zone({ left: 0, top: 0, width: 40, height: 60 }, 4, { px: 0, frac: 0.5 })]);
    expect(radii[0]).toBe(24);
  });

  it('is canvas-relative in CSS px, whatever the device pixel ratio', () => {
    // getBoundingClientRect is CSS px at any DPR or backing-store size, and so
    // is the scene's world space (uView, uOriginCss): no ratio goes in.
    const canvas = { left: 30, top: -200, width: 1000, height: 1400 };
    build([zone({ left: 130, top: 100, width: 50, height: 20 }, 0)], canvas, 1200, 900);
    expect(rect(0)).toEqual([100, 300, 50, 20]);
  });

  it('skips zero-size boxes', () => {
    const r = build([
      zone({ left: 10, top: 10, width: 0, height: 0 }),
      zone({ left: 10, top: 10, width: 50, height: 0 }),
      zone({ left: 10, top: 10, width: NaN, height: 5 }),
      zone({ left: 10, top: 10, width: 5, height: 5 }),
    ]);
    expect(r).toBe(1);
    expect(rect(0)).toEqual([-2, -2, 29, 29]);
  });

  it('culls against the visible part of the canvas, grown by the margin plus the feather', () => {
    // Canvas taller than the viewport: only its top 600 px are visible.
    const canvas = { left: 0, top: 0, width: 800, height: 3000 };
    const reach = CULL_MARGIN + 56;
    const at = (top: number) => zone({ left: 100, top, width: 100, height: 40 }, 0);
    expect(build([at(600 + reach)], canvas)).toBe(1);
    expect(build([at(600 + reach + 1)], canvas)).toBe(0);
    expect(build([at(2000)], canvas)).toBe(0);
    expect(build([at(-40 - reach)], canvas)).toBe(1);
    expect(build([at(-40 - reach - 1)], canvas)).toBe(0);
    // Pad counts toward reaching in.
    expect(build([zone({ left: 100, top: 600 + reach + 10, width: 100, height: 40 }, 12)], canvas)).toBe(1);
    // The viewport crops the canvas sideways too.
    const wide = { left: -500, top: 0, width: 2000, height: 600 };
    expect(build([zone({ left: 800 + reach + 1, top: 0, width: 10, height: 10 }, 0)], wide)).toBe(0);
    expect(build([zone({ left: -10 - reach - 1, top: 0, width: 10, height: 10 }, 0)], wide)).toBe(0);
    // A zone over a canvas that sits wholly below the fold.
    const below = { left: 0, top: 900, width: 800, height: 600 };
    expect(build([zone({ left: 0, top: 950, width: 10, height: 10 }, 0)], below)).toBe(0);
  });

  it('keeps the first 16 visible zones in list order and counts every visible one', () => {
    const hidden = zone({ left: 0, top: 5000, width: 10, height: 10 }, 0);
    const list = [hidden, ...Array.from({ length: 20 }, (_, i) => zone({ left: i, top: 0, width: 10, height: 10 }, 0))];
    expect(build(list)).toBe(20);
    expect(rect(0)[0]).toBe(0);
    expect(rect(15)[0]).toBe(15);
  });
});

describe('AvoidZones (A6, A8, A9, R1)', () => {
  const CANVAS: Box = { left: 0, top: 0, width: 800, height: 600 };
  let styleReads: number;
  beforeEach(() => {
    styleReads = 0;
    vi.stubGlobal('getComputedStyle', (e: Fake) => {
      styleReads++;
      return { borderTopLeftRadius: e.isConnected ? e.radius : '' };
    });
  });

  it('reads border-radius at set and readRadii, never per frame', () => {
    const a = el({ left: 10, top: 10, width: 100, height: 40 }, '6px');
    const zones = new AvoidZones();
    zones.set([asEl(a)]);
    expect(styleReads).toBe(1);
    for (let f = 0; f < 5; f++) expect(zones.measure(CANVAS, 800, 600, 56)).toBe(1);
    expect(styleReads).toBe(1);
    expect(zones.radii[0]).toBe(18);
    a.radius = '10px';
    zones.readRadii();
    expect(styleReads).toBe(2);
    zones.measure(CANVAS, 800, 600, 56);
    expect(zones.radii[0]).toBe(22);
  });

  it('skips a zero-size element and re-reads its radius once when it comes back (R1)', () => {
    // Detached when listed: no computed style, so no radius yet.
    const a = el({ left: 10, top: 10, width: 0, height: 0 }, '6px', false);
    const zones = new AvoidZones();
    zones.set([asEl(a)]);
    expect(zones.measure(CANVAS, 800, 600, 56)).toBe(0);
    const reads = styleReads;
    a.isConnected = true;
    a.rect = { left: 10, top: 10, width: 100, height: 40 };
    expect(zones.measure(CANVAS, 800, 600, 56)).toBe(1);
    expect(zones.radii[0]).toBe(18);
    zones.measure(CANVAS, 800, 600, 56);
    expect(styleReads).toBe(reads + 1);
  });

  it('warns once per list past 16 visible zones', () => {
    const list = Array.from({ length: 18 }, (_, i) => asEl(el({ left: i, top: 0, width: 10, height: 10 })));
    const zones = new AvoidZones();
    zones.set(list);
    for (let f = 0; f < 3; f++) expect(zones.measure(CANVAS, 800, 600, 56)).toBe(16);
    expect(warnings).toHaveLength(1);
    zones.set(list);
    zones.measure(CANVAS, 800, 600, 56);
    expect(warnings).toHaveLength(2);
  });

  it('clear() drops the references', () => {
    const zones = new AvoidZones();
    zones.set([asEl(el({ left: 0, top: 0, width: 10, height: 10 }))]);
    expect(zones.size).toBe(1);
    zones.clear();
    expect(zones.size).toBe(0);
    expect(zones.measure(CANVAS, 800, 600, 56)).toBe(0);
  });
});
