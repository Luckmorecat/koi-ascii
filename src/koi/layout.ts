// Layout of the per-fish data texture shared by the simulation (writer) and
// the scene shader (reader). One RGBA32F row per fish, one texel per entry.

export const MAX_FISH = 4;

/** Spine joints from nose (0) to the caudal peduncle (J_BODY - 1). */
export const J_BODY = 16;
/** Caudal-fin joints that continue the spine past the peduncle. */
export const J_TAIL = 6;
export const J_TOTAL = J_BODY + J_TAIL;

/** Trail samples per fish, newest first. */
export const TRAIL_N = 40;

/** joint i: x, y, radius, 0 */
export const T_PEC_L = J_TOTAL; // root.xy, tip.xy
export const T_PEC_R = J_TOTAL + 1; // root.xy, tip.xy
export const T_FIN = J_TOTAL + 2; // pectoral root radius, pectoral max radius, tail length, tail fork
export const T_EYE = J_TOTAL + 3; // left.xy, right.xy
export const T_P0 = J_TOTAL + 4; // variety id, pattern seed, eye radius, depth
export const T_BBOX = J_TOTAL + 5; // body + fins bounds: min.xy, max.xy
export const T_TBOX = J_TOTAL + 6; // trail bounds: min.xy, max.xy
export const T_P1 = J_TOTAL + 7; // trail sample count, trail width, 0, 0
export const T_TRAIL = J_TOTAL + 8; // x, y, age (0 = fresh, 1 = gone), 0
export const FISH_TEXELS = T_TRAIL + TRAIL_N;

/** Ripple impulses accepted per simulation step. */
export const MAX_DROPS = 32;

export function layoutDefines(): string {
  const defs: Record<string, number> = {
    MAX_FISH,
    J_BODY,
    J_TAIL,
    J_TOTAL,
    TRAIL_N,
    T_PEC_L,
    T_PEC_R,
    T_FIN,
    T_EYE,
    T_P0,
    T_BBOX,
    T_TBOX,
    T_P1,
    T_TRAIL,
    MAX_DROPS,
  };
  return Object.entries(defs)
    .map(([k, v]) => `#define ${k} ${v}\n`)
    .join('');
}
