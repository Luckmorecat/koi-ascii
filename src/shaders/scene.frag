// Scene pass: one fragment per character cell. Decides what the cell shows
// (water, ripple, trail, fin, body outline, body, eye), its colour and which
// glyph draws it. The ASCII pass only copies that glyph from the atlas.
// World space is CSS pixels with y pointing down; cell (0, 0) is top-left.

uniform sampler2D uFish;
uniform sampler2D uRipple;
uniform ivec2 uRippleSize;
uniform float uRipplePx;
uniform int uFishCount;
uniform int uOrder[MAX_FISH];
uniform vec2 uCell;
uniform vec2 uOriginCss; // world position of the grid's top-left corner
uniform float uTime;
// Time-of-day lighting, derived on the CPU from the phase (lighting.ts).
// Light space: x right, y down the screen, z up toward the viewer.
uniform vec3 uLightDir;  // unit, toward the sun or moon
uniform vec3 uLightCol;  // direct light, intensity included
uniform vec3 uAmbient;   // sky light on the fish
uniform vec3 uWaterTint; // water, ripples and trails
uniform vec3 uSky;       // sky reflection added to lit water
uniform float uGlint;
uniform float uCaustic;
uniform float uFloor;    // minimum light per channel on fish (night legibility)
uniform vec2 uShadow;    // shadow offset, px, away from the light
uniform float uShadowAlpha;
uniform float uCalm;     // 1 under reduced motion: flicker slows further

layout(location = 0) out vec4 oColor; // rgb colour, a density (for the raw view)
layout(location = 1) out vec4 oInfo;  // r glyph index, g cell class

// Colours, set by the renderer (look.ts): today's pond, or the palette's
// roles (Q1). Outside roles mode they hold the pond's original constants.
uniform vec3 uWaterDim;
uniform vec3 uWaterLit;
uniform vec3 uRippleCol;
uniform vec3 uKohakuWhite;
uniform vec3 uHiRed;
uniform vec3 uSumi;
uniform vec3 uShowaWhite;
uniform vec3 uOgonGold;
uniform vec3 uOgonShade; // Ogon's flank
uniform vec3 uOgonGlint;
uniform vec3 uEyeCol;
// Light rim drawn over sumi so the Showa's black flank keeps its silhouette.
uniform vec3 uSumiRim;
uniform vec3 uKohakuFin;
uniform vec3 uKohakuTail;
uniform vec3 uOgonFin;
uniform vec3 uOgonTail;  // tail tip; the root is uOgonGold
uniform vec3 uSilk;
uniform vec3 uBubble;
uniform vec3 uGoldDust;
uniform vec3 uGlintCol;  // water glints in roles mode (the highlight)
uniform vec3 uAddTint;   // multiplies light added on a fish: specular, rim, caustics
uniform float uRoles;    // 1 in roles mode: glints take uGlintCol, not the light's hue

// Ripple slope (height per px) that reads as a full-strength crest.
const float RIPPLE_GAIN = 28.0;
// Refraction offset (px) per unit of surface slope.
const float REFRACT = 220.0;
// Surface tilt (normal.xy / normal.z) per unit of RIPPLE_GAIN-scaled slope.
// A full crest tilts ~63°, so a sun ~6° above the horizon is mirrored
// (half vector ~42° off vertical) at about half a crest; noon needs only
// ~13°, the rings' soft flanks.
const float GLINT_TILT = 2.0;
// Flicker rate under reduced motion, on top of the pond's own 0.75 slowdown.
const float CALM_FLICKER = 0.3;
// Body specular: broad, so the highlight runs along the back.
const float SPEC_POW = 18.0;

float flicker() { return mix(1.0, CALM_FLICKER, uCalm); }

// Seen from above, a fish is mostly back: a sun near the horizon would barely
// reach it. Diffuse light and glyph weight therefore use the light's azimuth
// at no less than ~30° elevation; the highlight and glints keep the true
// direction, so they still slide to the lit edge as the sun sinks.
vec3 diffuseDir() {
  return normalize(vec3(uLightDir.xy, max(uLightDir.z, 0.5)));
}

// Light falling on a surface with unit normal n: sky + sun/moon, never below
// the night floor (per channel, which also neutralises the moon's blue).
vec3 lightOn(vec3 n) {
  return max(uAmbient + uLightCol * max(dot(n, diffuseDir()), 0.0), vec3(uFloor));
}

// The light's own hue at full brightness, for glints and highlights.
vec3 lightHue() {
  return uLightCol / max(max(uLightCol.r, max(uLightCol.g, uLightCol.b)), 1e-3);
}

struct Cell {
  vec3 col;
  float dens;
  int mat;
  vec2 dir; // cell space: outward normal for edges, line direction otherwise
  float aux;
  float style;
};

struct Hit {
  float d; // signed distance, px
  float u; // 0..1 along the polyline
  float v; // -1..1 across it
  vec2 n;  // outward normal, world
};

vec4 F(int f, int i) { return texelFetch(uFish, ivec2(i, f), 0); }

// Directions are converted to cell space so glyph slopes match on screen.
vec2 lineDir(vec2 d) {
  vec2 c = d / uCell;
  float l = length(c);
  return l > 1e-6 ? c / l : vec2(1.0, 0.0);
}

vec2 cellNormal(vec2 n) {
  vec2 c = n * uCell;
  float l = length(c);
  return l > 1e-6 ? c / l : vec2(1.0, 0.0);
}

// Fraction of the cell covered, estimated from the distance along the normal.
float coverage(float d, vec2 n) {
  float span = abs(n.x) * uCell.x + abs(n.y) * uCell.y;
  return clamp(0.5 - d / span, 0.0, 1.0);
}

float sq(float x) { return x * x; }

// ---------------------------------------------------------------- glyphs

const int BODY_N = 6;
const int BODY_RAMP[BODY_N] = int[BODY_N](G_EQUALS, G_PLUS, G_STAR, G_HASH, G_PERCENT, G_AT);

float bayer4(ivec2 c) {
  const int B[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(B[(c.x & 3) + (c.y & 3) * 4]) + 0.5) / 16.0;
}

// Sign-free line direction (y down) → horizontal, '\', vertical or '/'.
int lineGlyph(vec2 d, int horizontal, int vertical) {
  float a = atan(d.y, d.x);
  if (a < 0.0) a += PI;
  int s = int(floor(a / (PI * 0.25) + 0.5)) % 4;
  if (s == 0) return horizontal;
  if (s == 1) return G_BSLASH;
  if (s == 2) return vertical;
  return G_SLASH;
}

// Outward normal (y down) of a silhouette → outline glyph. `cov` says whether
// the boundary sits in the upper or lower half of the cell.
int edgeGlyph(vec2 n, float cov) {
  int o = int(floor((atan(n.y, n.x) + TAU) / (PI * 0.25) + 0.5)) % 8;
  if (o == 0) return G_RPAREN;
  if (o == 4) return G_LPAREN;
  if (o == 1 || o == 5) return G_SLASH;
  if (o == 3 || o == 7) return G_BSLASH;
  if (o == 2) return cov > 0.5 ? G_UNDERSCORE : G_MINUS; // bottom edge
  return cov > 0.5 ? G_MINUS : G_UNDERSCORE;             // top edge
}

bool inBox(vec2 p, vec4 box, float pad) {
  return all(greaterThanEqual(p, box.xy - pad)) && all(lessThanEqual(p, box.zw + pad));
}

// ---------------------------------------------------------------- ripples

float rippleTexel(ivec2 c) {
  c = clamp(c, ivec2(0), uRippleSize - 1);
#ifdef RIPPLE_PACKED
  return dec16(texelFetch(uRipple, c, 0).rg);
#else
  return texelFetch(uRipple, c, 0).r;
#endif
}

float rippleAt(vec2 p) {
  vec2 t = p / uRipplePx - 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  ivec2 c = ivec2(i);
  return mix(mix(rippleTexel(c), rippleTexel(c + ivec2(1, 0)), f.x),
             mix(rippleTexel(c + ivec2(0, 1)), rippleTexel(c + ivec2(1, 1)), f.x), f.y);
}

// ---------------------------------------------------------------- water

// Voronoi edge network, animated: bright where two cells meet.
float caustic(vec2 x, float t) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int k = -1; k <= 1; k++) {
      vec2 b = vec2(float(k), float(y));
      vec2 o = 0.5 + 0.42 * sin(t + TAU * hash22(i + b));
      float d = length(b + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return 1.0 - smoothstep(0.0, 0.22, f2 - f1);
}

Cell water(vec2 p, float h, vec2 g) {
  Cell c;
  // Motes drifting with a slow current.
  vec2 mp = floor((p + vec2(7.0, -4.0) * uTime) / uCell);
  float mote = step(0.96, hash12(mp)) * (0.4 + 0.6 * hash12(mp + 17.0));
  // Caustic light on the pond floor, bent a little by the surface. fbm spans
  // only about ±0.3 across a screen, so shimmer stays within ~[0.62, 0.98];
  // the smoothstep's low edge must stay below that range's top.
  float shimmer = 0.8 + 0.6 * fbm(p * 0.0016 + vec2(uTime * 0.012, -uTime * 0.008));
  float lit = smoothstep(0.45, 0.95, caustic(p * 0.011 + g * 3.0, uTime * 0.45) * shimmer);
  c.mat = M_WATER;
  // Fewer floor caustics as the light weakens; motes stay.
  c.dens = max(mote * 0.5, lit * mix(0.6, 1.0, uCaustic));
  // Kept dimmer than ripples and trails, which share the light glyphs.
  c.col = mix(uWaterDim, uWaterLit, 0.6 * lit * min(uCaustic, 1.0)) * uWaterTint + uSky;
  c.aux = hash12(mp + 3.1);
  c.dir = vec2(1.0, 0.0);
  c.style = 0.0;

  float rip = smoothstep(0.15, 0.6, length(g) * RIPPLE_GAIN);
  if (rip > 0.25) {
    c.mat = M_RIPPLE;
    c.dens = rip;
    c.col = mix(uWaterLit, uRippleCol, rip) * uWaterTint + uSky;
    c.dir = lineDir(vec2(-g.y, g.x)); // along the crest
    c.aux = h > 0.0 ? 1.0 : 0.0;
  }

  // Glints: the cell mirrors the sun/moon to the viewer (looking straight
  // down) when its surface tilt matches the half vector's. Flat water never
  // glints; only ripples do.
  vec3 H = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
  vec2 az = normalize(uLightDir.xy + vec2(1e-5, 0.0));
  vec2 across = vec2(-az.y, az.x);
  float low = 1.0 - uLightDir.z; // ~0.1 at noon, ~0.9 for a setting sun
  vec2 e = -g * RIPPLE_GAIN * GLINT_TILT - H.xy / H.z;
  float ea = dot(e, az);
  float ec = dot(e, across);
  // A low light is mirrored by a wider spread of slopes across its direction,
  // so glints run further along the crests that face it.
  float gl = exp(-sq(ea / (0.3 + 0.4 * low)) - sq(ec / (0.3 + 0.8 * low)));
  gl *= smoothstep(0.06, 0.25, length(g) * RIPPLE_GAIN);
  // Twinkle on a grid stretched along the light: with a low sun neighbouring
  // cells in that direction flash together, so glints read as long dashes.
  vec2 r = vec2(dot(p, az), dot(p, across)) / (max(uCell.x, uCell.y) * vec2(1.0 + 5.0 * low, 1.0));
  float tw = hash12(floor(r) + floor(uTime * 6.0 * flicker()) * 0.613);
  gl *= uGlint * (0.45 + 1.1 * tw);
  if (gl > 0.45) {
    c.mat = M_GLINT;
    c.dens = min(gl, 1.0);
    // Full brightness in the light's hue whatever the hour: a mirror image of
    // the sun or moon, not lit water.
    vec3 gc = uRoles > 0.5 ? uGlintCol : mix(lightHue(), vec3(1.0), 0.4);
    c.col = gc * mix(0.8, 1.0, smoothstep(0.45, 1.0, gl));
    c.dir = lineDir(az);
    c.aux = low;
  }
  return c;
}

// ---------------------------------------------------------------- fish geometry

// Closest point on the joint polyline [i0, i0 + count] with linearly
// interpolated radius: a chain of tapered capsules.
Hit polyline(int f, int i0, int count, vec2 p) {
  Hit h;
  h.d = 1e9;
  h.u = 0.0;
  h.v = 0.0;
  h.n = vec2(1.0, 0.0);
  vec4 A = F(f, i0);
  for (int k = 0; k < count; k++) {
    vec4 B = F(f, i0 + k + 1);
    vec2 ab = B.xy - A.xy;
    vec2 ap = p - A.xy;
    float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 dq = ap - ab * t;
    float dist = length(dq);
    float r = mix(A.z, B.z, t);
    float d = dist - r;
    if (d < h.d) {
      h.d = d;
      h.u = (float(k) + t) / float(count);
      float side = ab.x * ap.y - ab.y * ap.x < 0.0 ? -1.0 : 1.0;
      h.v = side * dist / max(r, 1e-3);
      h.n = dist > 1e-4 ? dq / dist : normalize(vec2(-ab.y, ab.x) + 1e-6);
    }
    A = B;
  }
  return h;
}

// Pectoral fin: a blade that widens from the root and rounds off at the tip.
float finDist(vec2 p, vec2 a, vec2 b, float r0, float r1, out float t) {
  vec2 ab = b - a;
  vec2 ap = p - a;
  t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float r = mix(r0, r1, smoothstep(0.0, 0.5, t)) * (1.0 - 0.45 * smoothstep(0.55, 1.0, t));
  return length(ap - ab * t) - r;
}

// Caudal fin: the tail polyline with a forked notch cut into its end and the
// tip capped flat, so the rim is a closed outline.
float tailSD(int f, vec2 q, vec4 fin) {
  Hit th = polyline(f, J_BODY - 1, J_TAIL, q);
  vec2 tip = F(f, J_TOTAL - 1).xy;
  vec2 tdir = normalize(tip - F(f, J_TOTAL - 2).xy + 1e-6);
  return max(max(th.d, (th.u - 1.0 + fin.w * (1.0 - min(abs(th.v), 1.0))) * fin.z), dot(q - tip, tdir));
}

// ---------------------------------------------------------------- markings

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

// ---------------------------------------------------------------- composition

float shadow(int f, vec2 p) {
  float lift = 1.25 - F(f, T_P0).w;
  vec2 q = p - uShadow * lift;
  float blur = max(uCell.x, uCell.y) * (0.5 + 1.5 * lift);
  if (!inBox(q, F(f, T_BBOX), blur)) return 0.0;
  float d = min(polyline(f, 0, J_BODY - 1, q).d,
                polyline(f, J_BODY - 1, J_TAIL, q).d + max(uCell.x, uCell.y) * 0.5);
  return (1.0 - smoothstep(-blur, blur, d)) * (0.95 - 0.35 * lift) * uShadowAlpha;
}

void trails(vec2 p, inout Cell c) {
  float best = 0.0;
  vec2 bestDir = vec2(1.0, 0.0);
  int bestVariety = 0;
  for (int f = 0; f < MAX_FISH; f++) {
    if (f >= uFishCount) break;
    vec4 P1 = F(f, T_P1);
    int n = int(P1.x + 0.5);
    float w0 = P1.y;
    if (n < 2 || !inBox(p, F(f, T_TBOX), w0 * 2.5 + uCell.y)) continue;
    int variety = int(F(f, T_P0).x + 0.5);
    vec4 A = F(f, T_TRAIL);
    for (int k = 1; k < TRAIL_N; k++) {
      if (k >= n) break;
      vec4 B = F(f, T_TRAIL + k);
      vec2 ab = B.xy - A.xy;
      vec2 ap = p - A.xy;
      float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float dist = length(ap - ab * t);
      float age = mix(A.z, B.z, t);
      float w = w0 * (0.5 + 1.4 * age) + 0.3 * min(uCell.x, uCell.y);
      float I = pow(1.0 - age, 1.3) * (1.0 - smoothstep(w * 0.35, w, dist));
      if (I > best) {
        best = I;
        bestDir = ab;
        bestVariety = variety;
      }
      A = B;
    }
  }
  if (best < 0.05) return;

  vec2 cell = floor(p / uCell);
  vec3 col;
  if (bestVariety == V_KOHAKU) {
    // Silk: a smooth warm-white ribbon that frays as it fades.
    best *= 0.7 + 0.6 * gnoise(p * 0.035 - uTime * 0.5);
    col = uSilk;
  } else if (bestVariety == V_SHOWA) {
    // Bubbles: sparse dots that stay put while the trail fades.
    float hb = hash12(cell * 1.37 + 5.0);
    best *= step(0.62, hb) * (0.7 + 0.6 * hb);
    col = uBubble;
  } else {
    // Gold dust that twinkles.
    float tw = hash12(cell + floor(uTime * 7.0 * flicker()) * 0.731);
    best *= step(0.5, tw) * 1.2;
    col = uGoldDust;
  }
  if (best < 0.12) return;
  c.mat = M_TRAIL;
  c.dens = min(best, 1.0);
  // Silk keeps its warm hue and only dims as it fades; the others fade into the water.
  c.col = (bestVariety == V_KOHAKU ? col * (0.6 + 0.4 * smoothstep(0.1, 0.6, best)) : mix(uWaterLit, col, smoothstep(0.1, 0.6, best))) * uWaterTint;
  c.dir = lineDir(bestDir);
  c.aux = 0.0;
  c.style = float(bestVariety);
}

// Surface refraction at one point, as main() takes it per cell.
vec2 refrAt(vec2 x) {
  float e = uRipplePx;
  return vec2(rippleAt(x + vec2(e, 0.0)) - rippleAt(x - vec2(e, 0.0)),
              rippleAt(x + vec2(0.0, e)) - rippleAt(x - vec2(0.0, e))) / (2.0 * e) * REFRACT;
}

void drawFish(int f, vec2 p, vec2 refr, inout Cell c) {
  vec4 P0 = F(f, T_P0);
  int variety = int(P0.x + 0.5);
  float seed = P0.y;
  float depth = P0.w;
  // Deeper fish are displaced more by the moving surface.
  vec2 q = p + refr * (0.5 + depth);
  if (!inBox(q, F(f, T_BBOX), max(uCell.x, uCell.y) * 1.5)) return;
  float fog = 0.55 * depth;
  vec3 fogCol = uWaterDim * uWaterTint;
  float fade = 1.0 - 0.3 * depth;
  float style = float(variety);
  vec4 fin = F(f, T_FIN);
  // Fins are thin and lie nearly flat: lit as if facing straight up.
  vec3 flatLight = lightOn(vec3(0.0, 0.0, 1.0));

  // Fin normals come from a numeric gradient over half a cell, so outline
  // glyphs follow the fin's actual rim (fork and tip included).
  float reach = max(uCell.x, uCell.y);
  vec2 ex = vec2(uCell.x * 0.5, 0.0);
  vec2 ey = vec2(0.0, uCell.y * 0.5);

  // Pectoral fins sit beneath the body: outline on the rim, rays inside.
  for (int s = 0; s < 2; s++) {
    vec4 pf = F(f, T_PEC_L + s);
    float t, t2;
    float d = finDist(q, pf.xy, pf.zw, fin.x, fin.y, t);
    if (d > reach) continue;
    vec2 gr = vec2(finDist(q + ex, pf.xy, pf.zw, fin.x, fin.y, t2) - finDist(q - ex, pf.xy, pf.zw, fin.x, fin.y, t2),
                   finDist(q + ey, pf.xy, pf.zw, fin.x, fin.y, t2) - finDist(q - ey, pf.xy, pf.zw, fin.x, fin.y, t2)) / uCell;
    vec2 n = normalize(gr + 1e-6);
    float cv = coverage(d, n);
    if (cv > 0.25) {
      c.col = mix(pectoralColor(variety, t) * flatLight, fogCol, fog);
      c.aux = 0.0;
      c.style = style;
      if (cv < 0.8) {
        c.mat = M_EDGE;
        c.dens = cv;
        c.dir = cellNormal(n);
      } else {
        c.mat = M_FIN;
        c.col *= 0.75;
        c.dens = 0.6 * fade;
        c.dir = lineDir(q - pf.xy);
      }
    }
  }

  // Caudal fin with a forked notch: outline on the rim, rays fanning out from
  // the peduncle inside.
  float td = tailSD(f, q, fin);
  if (td < reach) {
    vec2 gr = vec2(tailSD(f, q + ex, fin) - tailSD(f, q - ex, fin),
                   tailSD(f, q + ey, fin) - tailSD(f, q - ey, fin)) / uCell;
    vec2 n = normalize(gr + 1e-6);
    float tcv = coverage(td, n);
    if (tcv > 0.25) {
      Hit th = polyline(f, J_BODY - 1, J_TAIL, q);
      c.col = mix(tailColor(variety, th.u, th.v, seed) * flatLight, fogCol, fog);
      c.aux = 0.0;
      c.style = style;
      if (tcv < 0.8) {
        c.mat = M_EDGE;
        c.dens = tcv;
        c.dir = cellNormal(n);
      } else {
        c.mat = M_FIN;
        c.col *= 0.75;
        c.dens = (0.65 - 0.2 * th.u) * fade;
        c.dir = lineDir(q - F(f, J_BODY - 1).xy);
      }
    }
  }

  // Body: dense fill inside, outline glyphs along the silhouette.
  Hit bh = polyline(f, 0, J_BODY - 1, q);
  float bcv = coverage(bh.d, bh.n);
  if (bcv > 0.18) {
    float glint = 0.0;
    float sumiAmt = 0.0;
    vec3 bc = variety == V_KOHAKU ? kohaku(bh.u, bh.v, seed)
            : variety == V_SHOWA ? showa(bh.u, bh.v, seed, sumiAmt)
            : ogon(bh.u, bh.v, seed, glint);
    // The body as a cylinder seen from above: |v| = 1 at the silhouette.
    // 0.92 keeps the edge from turning fully sideways (a koi's back is broad).
    float a = min(abs(bh.v), 1.0) * 0.92;
    vec3 N = vec3(bh.n * a, sqrt(1.0 - a * a));
    float ndl = dot(N, diffuseDir());
    vec3 lit = lightOn(N);
    // Highlight along the back where the normal meets the half vector; it
    // slides across the back as the light moves. Sumi is lacquer-glossy and
    // ogon metallic (tinted gold).
    vec3 H = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(N, H), 0.0), SPEC_POW);
    vec3 hue = lightHue() * length(uLightCol) * 0.82 * uAddTint; // ~1 at noon, dim at night
    vec3 hi = variety == V_OGON ? hue * uOgonGold * 0.9 : hue * (variety == V_SHOWA ? 0.32 + 0.25 * sumiAmt : 0.3);
    // Rim on the flank away from the light, lit by the light wrapping round.
    vec2 az = normalize(uLightDir.xy + vec2(1e-5, 0.0));
    float rim = a * a * a * max(-dot(bh.n, az), 0.0) * (0.35 + 0.65 * (1.0 - uLightDir.z));
    // Caustics on the back, only for cells this fish covers. Shallower fish
    // catch sharper, brighter ones; the pattern slides as the fish swims.
    float cst = smoothstep(0.5, 0.95, caustic(q * 0.014 + refr * 0.012 + seed, uTime * 0.45));
    vec3 caust = uLightCol * uAddTint * cst * uCaustic * 0.4 * max(ndl, 0.0) * (1.0 - depth);
    c.col = mix(bc * lit + hi * spec + uLightCol * uAddTint * rim * 0.6 + caust, fogCol, fog);
    // Glyph weight follows the light too, so the lit flank is heavier.
    float shade = mix(0.58, 1.05, smoothstep(-0.2, 0.9, ndl)) + 0.25 * spec;
    c.style = style;
    if (bcv > 0.8) {
      // Glyph weight follows perceived lightness, so markings read as texture
      // and not only as colour: white scales are heavier than sumi.
      float Yl = dot(bc * bc, vec3(0.2126, 0.7152, 0.0722));
      float Ls = 1.16 * pow(Yl, 1.0 / 3.0) - 0.16;
      c.mat = M_BODY;
      c.dens = mix(0.6, 1.0, Ls) * shade * fade;
      c.aux = glint;
    } else {
      c.mat = M_EDGE;
      c.dens = bcv;
      c.dir = cellNormal(bh.n);
      c.aux = 0.0;
      c.col = mix(c.col, mix(uSumiRim * lit, fogCol, fog), 0.65 * sumiAmt);
    }
  }

  // Eyes: always claim the cell nearest their centre so they never vanish.
  vec4 E = F(f, T_EYE);
  for (int s = 0; s < 2; s++) {
    vec2 e = s == 0 ? E.xy : E.zw;
    // Refraction taken at the eye, not per cell: adjacent cells refract by different
    // amounts, so per-cell offsets can leave the eye with no cell (or two).
    vec2 de = abs(p + refrAt(e) * (0.5 + depth) - e);
    if (length(q - e) < P0.z || (de.x < uCell.x * 0.5 && de.y < uCell.y * 0.5)) {
      c.mat = M_EYE;
      c.col = mix(uEyeCol * max(flatLight, vec3(0.75)), fogCol, fog * 0.5);
      c.dens = 1.0;
      c.aux = 0.0;
      c.style = style;
    }
  }
}

int pickGlyph(Cell c, ivec2 cell) {
  float dens = clamp(c.dens, 0.0, 1.0);
  float aux = clamp(c.aux, 0.0, 1.0);
  int style = int(c.style + 0.5);
  if (c.mat == M_WATER) {
    if (dens < 0.12) return G_SPACE;
    if (dens < 0.6) return aux < 0.4 ? G_DOT : aux < 0.65 ? G_COMMA : aux < 0.85 ? G_BACKTICK : G_QUOTE;
    return G_COLON;
  }
  if (c.mat == M_RIPPLE) {
    if (dens < 0.45) return G_DOT;
    return lineGlyph(c.dir, aux > 0.5 ? G_TILDE : G_MINUS, G_PIPE);
  }
  if (c.mat == M_TRAIL) {
    if (style == V_SHOWA) return dens > 0.55 ? G_O : G_DOT;
    if (style == V_OGON) return dens > 0.65 ? G_STAR : dens > 0.35 ? G_QUOTE : G_DOT;
    if (dens < 0.3) return G_DOT;
    if (dens < 0.55) return G_MINUS;
    return lineGlyph(c.dir, G_TILDE, G_COLON);
  }
  if (c.mat == M_FIN) {
    if (dens < 0.3) return G_DOT;
    if (dens < 0.45) return G_QUOTE;
    return lineGlyph(c.dir, style == V_OGON ? G_TILDE : G_MINUS, G_PIPE);
  }
  if (c.mat == M_EDGE) return edgeGlyph(c.dir, dens);
  if (c.mat == M_BODY) {
    if (aux > 0.75) return G_STAR;
    float x = smoothstep(0.3, 0.95, dens) * float(BODY_N - 1) + (bayer4(cell) - 0.5) * 0.5;
    return BODY_RAMP[clamp(int(floor(x + 0.5)), 0, BODY_N - 1)];
  }
  if (c.mat == M_EYE) return G_O;
  if (c.mat == M_GLINT) {
    // High light: star bursts. Low light: dashes along its direction.
    if (aux > 0.55) return dens > 0.6 ? lineGlyph(c.dir, dens > 0.85 ? G_EQUALS : G_MINUS, G_PIPE) : G_DOT;
    return dens > 0.75 ? G_STAR : G_PLUS;
  }
  return G_SPACE;
}

void main() {
  vec2 p = (floor(gl_FragCoord.xy) + 0.5) * uCell + uOriginCss;

  float e = uRipplePx;
  float h = rippleAt(p);
  vec2 g = vec2(rippleAt(p + vec2(e, 0.0)) - rippleAt(p - vec2(e, 0.0)),
                rippleAt(p + vec2(0.0, e)) - rippleAt(p - vec2(0.0, e))) / (2.0 * e);

  Cell c = water(p, h, g);

  float sh = 0.0;
  for (int f = 0; f < MAX_FISH; f++) {
    if (f >= uFishCount) break;
    sh = max(sh, shadow(f, p));
  }
  c.dens *= clamp(1.0 - 1.4 * sh, 0.0, 1.0);
  c.col *= 1.0 - 0.5 * sh;

  trails(p, c);

  vec2 refr = g * REFRACT;
  for (int k = 0; k < MAX_FISH; k++) {
    if (k >= uFishCount) break;
    drawFish(uOrder[k], p, refr, c);
  }

  int glyph = pickGlyph(c, ivec2(gl_FragCoord.xy));
  oColor = vec4(c.col, clamp(c.dens, 0.0, 1.0));
  oInfo = vec4(float(glyph) / 255.0, float(c.mat) / 255.0, 0.0, 0.0);
}
