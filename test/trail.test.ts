import { describe, expect, it } from 'vitest';
import { FISH_TEXELS, T_CBOX, T_P1, T_TBOX, T_TRAIL, TRAIL_CHUNK, TRAIL_CHUNKS, TRAIL_N } from '../src/koi/layout';
import { Pond } from '../src/pond';

const EMPTY = [1e9, 1e9, -1e9, -1e9];

describe('trail chunk boxes', () => {
  // The scene shader skips a chunk's segments when the cell is outside its box
  // padded by the cell term of their width, so a box must hold every sample its
  // segments join grown by the rest of that width at their oldest, + 1 px. It
  // skips a whole fish outside the trail box, which must be their union (empty
  // when the trail has no segment). Segments past the first sample 0.85 old
  // never show, so the trail ends there (Koi TRAIL_CUT).
  it('bound the samples their segments join grown by their width, unite into the trail box, and end 0.85 old', () => {
    const pond = new Pond(1280, 800, 7);
    const counts = new Set<number>();
    const bad: string[] = [];
    for (let frame = 0; frame <= 600; frame++) {
      // Frame 0 packs the pond before its first step, with no trail yet.
      if (frame > 0) pond.update(1 / 60);
      const fish = pond.pack();
      const d = pond.data;
      for (let f = 0; f < fish; f++) {
        const row = f * FISH_TEXELS * 4;
        const n = d[row + T_P1 * 4];
        const w0 = pond.fish[f].variety.trailWidth * pond.fish[f].length;
        counts.add(n);
        const sampleAges = Array.from({ length: n }, (_, i) => d[row + (T_TRAIL + i) * 4 + 2]);
        const recorded = (pond.fish[f] as unknown as { trailLen: number }).trailLen;
        if (sampleAges.slice(0, -1).some((a) => a >= 0.85) || (sampleAges[n - 1] < 0.85 && n - 1 < recorded)) {
          bad.push(`frame ${frame} fish ${f}: ${n} of ${recorded + 1} samples, ages ${sampleAges} do not end at the first 0.85 old`);
        }
        const union = [...EMPTY];
        for (let c = 0; c < TRAIL_CHUNKS; c++) {
          const o = row + (T_CBOX + c) * 4;
          const box = [d[o], d[o + 1], d[o + 2], d[o + 3]];
          union[0] = Math.min(union[0], box[0]);
          union[1] = Math.min(union[1], box[1]);
          union[2] = Math.max(union[2], box[2]);
          union[3] = Math.max(union[3], box[3]);
          const first = c * TRAIL_CHUNK;
          const xs: number[] = [];
          const ys: number[] = [];
          const ages: number[] = [];
          for (let i = first; first + 1 < n && i <= Math.min(first + TRAIL_CHUNK, n - 1); i++) {
            xs.push(d[row + (T_TRAIL + i) * 4]);
            ys.push(d[row + (T_TRAIL + i) * 4 + 1]);
            ages.push(d[row + (T_TRAIL + i) * 4 + 2]);
          }
          if (!xs.length) {
            if (box.some((v, i) => v !== EMPTY[i])) bad.push(`frame ${frame} fish ${f} n ${n} chunk ${c}: ${box} not empty`);
            continue;
          }
          const g = w0 * (0.5 + 1.4 * Math.max(...ages)) + 1;
          // Rounded to f32 as the box is stored.
          const want = [Math.min(...xs) - g, Math.min(...ys) - g, Math.max(...xs) + g, Math.max(...ys) + g].map(Math.fround);
          if (!(box[0] <= want[0] && box[1] <= want[1] && box[2] >= want[2] && box[3] >= want[3])) {
            bad.push(`frame ${frame} fish ${f} n ${n} chunk ${c}: ${box} does not hold ${want}`);
          }
        }
        const o = row + T_TBOX * 4;
        const tbox = [d[o], d[o + 1], d[o + 2], d[o + 3]];
        if (tbox.some((v, i) => v !== union[i])) bad.push(`frame ${frame} fish ${f} n ${n}: trail box ${tbox} != ${union}`);
      }
    }
    expect(bad).toEqual([]);
    // Trails grew one sample at a time from none, so chunks were seen just full
    // and just started, and the trail box empty.
    for (let n = 1; n <= 3 * TRAIL_CHUNK + 2; n++) expect(counts).toContain(n);
    // trails.glsl walks chunks while one starts below n, so n past TRAIL_N would read past the fish row.
    expect(Math.max(...counts)).toBeLessThanOrEqual(TRAIL_N);
  });
});
