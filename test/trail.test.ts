import { describe, expect, it } from 'vitest';
import { FISH_TEXELS, T_CBOX, T_P1, T_TRAIL, TRAIL_CHUNK, TRAIL_CHUNKS } from '../src/koi/layout';
import { Pond } from '../src/pond';

describe('trail chunk boxes', () => {
  // The scene shader skips a chunk's segments when the cell is outside its box,
  // so a box must hold every sample its segments join.
  it('bound the samples their segments join, and are empty past the last segment', () => {
    const pond = new Pond(1280, 800, 7);
    const counts = new Set<number>();
    const bad: string[] = [];
    for (let frame = 0; frame < 600; frame++) {
      pond.update(1 / 60);
      const fish = pond.pack();
      const d = pond.data;
      for (let f = 0; f < fish; f++) {
        const row = f * FISH_TEXELS * 4;
        const n = d[row + T_P1 * 4];
        counts.add(n);
        for (let c = 0; c < TRAIL_CHUNKS; c++) {
          const o = row + (T_CBOX + c) * 4;
          const box = [d[o], d[o + 1], d[o + 2], d[o + 3]];
          const first = c * TRAIL_CHUNK;
          const xs: number[] = [];
          const ys: number[] = [];
          for (let i = first; first + 1 < n && i <= Math.min(first + TRAIL_CHUNK, n - 1); i++) {
            xs.push(d[row + (T_TRAIL + i) * 4]);
            ys.push(d[row + (T_TRAIL + i) * 4 + 1]);
          }
          const want = xs.length
            ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
            : [1e9, 1e9, -1e9, -1e9];
          if (box.some((v, i) => v !== want[i])) bad.push(`frame ${frame} fish ${f} n ${n} chunk ${c}: ${box} != ${want}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // Trails grew one sample at a time, so chunks were seen just full and just started.
    for (let n = 2; n <= 3 * TRAIL_CHUNK + 2; n++) expect(counts).toContain(n);
  });
});
