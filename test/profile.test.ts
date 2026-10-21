import { describe, expect, it } from 'vitest';
import { profileDraws } from '../demo/debug/perf';

/** Just enough WebGL2 for profileDraws: every query reports `ns` nanoseconds. */
function fakeGl(ns = 1000) {
  const program = {} as WebGLProgram;
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    CURRENT_PROGRAM: 3,
    QUERY_RESULT_AVAILABLE: 4,
    QUERY_RESULT: 5,
    queries: 0,
    getExtension: () => ext,
    createQuery() {
      this.queries++;
      return {} as WebGLQuery;
    },
    deleteQuery() {},
    beginQuery() {},
    endQuery() {},
    getParameter: (p: number) => (p === 3 ? program : false),
    getQueryParameter: (_q: WebGLQuery, p: number) => (p === 4 ? true : ns),
    drawArrays(_mode: number, _first: number, _count: number) {},
  };
  return { gl, names: new Map([[program, 'scene']]) };
}

describe('profileDraws', () => {
  it('times its own redraws per pass, with a frame total', async () => {
    const { gl, names } = fakeGl();
    const p = await profileDraws(gl as unknown as WebGL2RenderingContext, names, () => gl.drawArrays(4, 0, 3), 40);
    expect(p?.passes.scene).toEqual({ n: 40, median: 1, p90: 1 });
    expect(p?.passes.frame).toEqual({ n: 40, median: 1, p90: 1 });
  });

  it("doesn't time draws made by anything else between its yields", async () => {
    const { gl, names } = fakeGl();
    // A capture() landing in every yield.
    const outside = setInterval(() => gl.drawArrays(4, 0, 3), 0);
    try {
      await profileDraws(gl as unknown as WebGL2RenderingContext, names, () => gl.drawArrays(4, 0, 3), 200);
    } finally {
      clearInterval(outside);
    }
    expect(gl.queries).toBe(200);
  });

  it('restores drawArrays when a redraw throws', async () => {
    const { gl, names } = fakeGl();
    const draw = gl.drawArrays;
    let calls = 0;
    const redraw = () => {
      if (++calls > 25) throw new Error('nothing drawn');
      gl.drawArrays(4, 0, 3);
    };
    await expect(profileDraws(gl as unknown as WebGL2RenderingContext, names, redraw, 40)).rejects.toThrow('nothing drawn');
    expect(gl.drawArrays).toBe(draw);
  });
});
