// PROTOTYPE avoid-zones: the mask under page content (rounded rects with a
// feathered edge), and the thin and dim step applied to a Cell before glyph
// choice.
//
// Uniforms (own): uAvoidN, uAvoid, uAvoidR, uAvoidLook, uAvoidFeather.
// Depends on: common.glsl, cell.glsl.

uniform int uAvoidN;
uniform vec4 uAvoid[8];      // x, y, w, h in world px
uniform vec4 uAvoidR[8];     // x: corner radius
uniform vec4 uAvoidLook;     // water thin, water dim, fish dim (0..1), show outlines
uniform float uAvoidFeather; // px

float avoidMask(vec2 p) {
  float m = 0.0;
  float f = max(uAvoidFeather, 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= uAvoidN) break;
    vec2 hs = uAvoid[i].zw * 0.5;
    float r = min(uAvoidR[i].x, min(hs.x, hs.y));
    vec2 q = abs(p - uAvoid[i].xy - hs) - hs + r;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    m = max(m, 1.0 - smoothstep(0.0, f, d));
  }
  return m;
}

// Thins and dims what is under page content; returns the mask.
float avoidFade(vec2 p, inout Cell c) {
  float am = uAvoidN > 0 ? avoidMask(p) : 0.0;
  if (am > 0.0) {
    bool waterish = c.mat <= M_TRAIL || c.mat == M_GLINT;
    if (waterish) {
      c.dens *= 1.0 - uAvoidLook.x * am;
      c.col *= 1.0 - uAvoidLook.y * am;
    } else {
      c.dens *= 1.0 - 0.6 * uAvoidLook.z * am;
      c.col *= 1.0 - uAvoidLook.z * am;
    }
  }
  return am;
}
