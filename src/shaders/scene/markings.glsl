// Fish colours by variety: Kohaku, Showa and Ogon bodies, their pectoral
// fins and tails.
//
// Uniforms (own): uKohakuWhite, uHiRed, uSumi, uShowaWhite, uOgonShade, uOgonGlint,
//   uKohakuFin, uKohakuTail, uOgonFin, uOgonTail.
// Uniforms (uniforms.glsl): uOgonGold, uTime.
// Depends on: common.glsl, light.glsl, cell.glsl.

uniform vec3 uKohakuWhite;
uniform vec3 uHiRed;
uniform vec3 uSumi;
uniform vec3 uShowaWhite;
uniform vec3 uOgonShade; // Ogon's flank
uniform vec3 uOgonGlint;
uniform vec3 uKohakuFin;
uniform vec3 uKohakuTail;
uniform vec3 uOgonFin;
uniform vec3 uOgonTail;  // tail tip; the root is uOgonGold

// Kohaku: porcelain white with large hi (red) patches over the back, a red
// head patch, clean white nose and tail root.
vec3 kohaku(float u, float v, float seed) {
  float n = fbm(vec2(u * 3.0, v * 0.8) + seed)
          + 0.08
          + 0.35 * exp(-sq((u - 0.14) / 0.08))
          - 0.45 * v * v
          - 0.7 * smoothstep(0.75, 0.92, u)
          - 0.8 * (1.0 - smoothstep(0.02, 0.07, u));
  return mix(uKohakuWhite, uHiRed, smoothstep(-0.02, 0.04, n));
}

// Showa: sumi (black) bands wrapping the body, big red patches, some white.
vec3 showa(float u, float v, float seed, out float sumiAmt) {
  float s = fbm(vec2(u * 3.5 + v * 0.9, v * 1.4) + seed * 1.7) + 0.04;
  float r = fbm(vec2(u * 2.6, v * 0.9) + seed * 2.3 + 31.0)
          + 0.06 - 0.3 * v * v + 0.2 * exp(-sq((u - 0.12) / 0.1));
  float sumi = smoothstep(0.0, 0.04, s);
  float hi = smoothstep(0.0, 0.04, r);
  sumiAmt = sumi * (1.0 - 0.5 * hi);
  return mix(mix(uShowaWhite, uHiRed, hi), uSumi, sumiAmt);
}

// Ogon: metallic gold; individual scales catch the light and a soft
// highlight band rolls along the flank.
vec3 ogon(float u, float v, float seed, out float glint) {
  vec2 sc = vec2(u * 26.0, v * 4.0 + 4.0);
  vec2 id = floor(vec2(sc.x + 0.5 * mod(floor(sc.y), 2.0), sc.y));
  float ph = hash12(id + seed);
  float twinkle = pow(0.5 + 0.5 * sin(uTime * 2.3 * flicker() + ph * TAU + u * 7.0), 14.0) * step(0.55, ph);
  float band = exp(-sq((v - 0.35 * sin(uTime * 0.6 + u * 4.0 + seed)) * 2.2));
  glint = max(twinkle, band * 0.6);
  vec3 base = mix(uOgonShade, uOgonGold, 1.0 - abs(v));
  return mix(base, uOgonGlint, glint);
}

vec3 pectoralColor(int variety, float t) {
  if (variety == V_KOHAKU) return uKohakuFin;
  if (variety == V_SHOWA) return mix(uSumi, uShowaWhite, smoothstep(0.15, 0.45, t)); // motoguro
  return uOgonFin;
}

vec3 tailColor(int variety, float u, float v, float seed) {
  if (variety == V_KOHAKU) return uKohakuTail;
  if (variety == V_SHOWA) {
    float streak = smoothstep(0.1, 0.2, gnoise(vec2(v * 3.0, u * 1.5) + seed));
    return mix(uShowaWhite, uSumi, streak * (1.0 - u * 0.6));
  }
  return mix(uOgonGold, uOgonTail, u);
}
