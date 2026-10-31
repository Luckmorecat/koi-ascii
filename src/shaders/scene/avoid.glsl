// Readability zones (the `avoid` option): the mask under page content, rounded
// rects with a soft edge, and how much it thins a cell's glyph density. The
// colour fade toward the background happens in ascii.frag, from the mask the
// scene pass writes to oInfo.b, so light and inverted palettes fade toward
// their own background. The renderer also puts this chunk before fly.frag,
// so it reads none of the other chunks' uniforms or functions.
//
// Uniforms (own): uAvoidN, uAvoid, uAvoidR, uAvoidFade.
// Depends on: nothing (common.glsl's material classes only).

#define AVOID_MAX 16

uniform int uAvoidN;                  // zones in use; 0 draws exactly as without zones
uniform vec4 uAvoid[AVOID_MAX];       // x, y, w, h in world px
uniform vec4 uAvoidR[AVOID_MAX / 4];  // corner radius per zone, four to a vec4
uniform vec4 uAvoidFade;              // water thin, fish thin, feather px, 1 = outline zones (debug)

// Signed distance (world px) from p to the nearest zone, negative inside.
float avoidDist(vec2 p) {
  float d = 1e9;
  // Bounded by the count, as main.frag's loops are (startup cost).
  for (int i = 0; i < uAvoidN; i++) {
    vec2 hs = uAvoid[i].zw * 0.5;
    float r = min(uAvoidR[i >> 2][i & 3], min(hs.x, hs.y));
    vec2 q = abs(p - uAvoid[i].xy - hs) - hs + r;
    d = min(d, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r);
  }
  return d;
}

// 1 inside a zone, falling to 0 across the feather outside it. A feather of 0
// is valid; smoothstep needs a positive width.
float avoidMask(float d) {
  return 1.0 - smoothstep(0.0, max(uAvoidFade.z, 0.5), d);
}

// What a cell's density is multiplied by under mask m: water and what is on
// it thin by one amount, everything else (fish, sky, fireflies) by another.
float avoidThin(float m, int mat) {
  return 1.0 - (avoidWater(mat) ? uAvoidFade.x : uAvoidFade.y) * m;
}
