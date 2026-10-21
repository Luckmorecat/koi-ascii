precision highp float;
precision highp int;
precision highp sampler2D;

// Glyph classes written by the scene pass and read by the ASCII pass.
#define M_WATER 0
#define M_RIPPLE 1
#define M_TRAIL 2
#define M_FIN 3
#define M_EDGE 4
#define M_BODY 5
#define M_EYE 6
#define M_GLINT 7
#define M_STAR 8  // a reflected star (sky feature `stars`)
#define M_MOON 9  // the moon's reflection (sky feature `moon`)
#define M_FLY 10  // a firefly, over everything (sky feature `fireflies`; fly.frag)

#define PI 3.14159265
#define TAU 6.28318531

// Hash without sine (Dave Hoskins).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Gradient noise, roughly [-0.7, 0.7].
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * gnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}

#ifdef RIPPLE_PACKED
// Ripple state packed into RGBA8 when float render targets are unavailable:
// each of (height, previous height) in [-1, 1] uses two bytes.
vec2 enc16(float v) {
  float x = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(x / 256.0);
  return vec2(hi, x - hi * 256.0) / 255.0;
}

float dec16(vec2 e) {
  vec2 b = floor(e * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0 * 2.0 - 1.0;
}
#endif
