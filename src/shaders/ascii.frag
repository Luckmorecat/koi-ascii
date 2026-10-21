// ASCII pass: each output pixel finds its character cell and copies the
// cell's glyph (picked by the scene pass) texel-for-texel from the atlas.
// PROTOTYPE (issue #1): the uP* uniforms and palette() below remap the
// final colour; see src/prototype-palette.ts.

uniform sampler2D uScene0;
uniform sampler2D uScene1;
uniform sampler2D uAtlas;
uniform ivec2 uCellPx;
uniform ivec2 uOrigin; // grid top-left, device px from the canvas top-left
uniform ivec2 uGrid;   // cols, rows
uniform int uCanvasH;
uniform vec3 uBg;      // background graded by the time of day
uniform vec3 uRawBg;   // the raw view keeps the plain background
uniform int uRaw;
#ifdef GLOW
uniform sampler2D uGlow; // cell-resolution halo, linear filtered (see glow.frag)
uniform vec2 uGlowScale;  // grid px → glow texture coordinates
#endif

// PROTOTYPE palette uniforms.
uniform int uPModel;      // 0 identity (pond), 1 ramp, 2 roles, 3 filter
uniform vec3 uPBg;
uniform vec3 uPRamp0;
uniform vec3 uPRamp1;
uniform vec3 uPRamp2;
uniform vec3 uPWater;
uniform vec3 uPHi;
uniform vec3 uPPale;
uniform vec3 uPInk;
uniform vec3 uPAccent;
uniform vec3 uPTint;
uniform float uPSat;
uniform int uPInvert;
uniform float uPIntensity;

out vec4 fragColor;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Background after time-of-day grading: dark palettes follow the pond's own
// day/night dimming, light ones stay put.
vec3 gradedBg() {
  float grade = lum(uBg) / lum(uRawBg);
  return uPBg * mix(grade, 1.0, smoothstep(0.3, 0.6, lum(uPBg)));
}

// A: brightness above the background → a 3-stop ramp.
vec3 ramp(vec3 pix) {
  float t = clamp((lum(pix) - lum(uBg)) / (0.9 - lum(uBg)), 0.0, 1.0);
  return t < 0.4 ? mix(uPRamp0, uPRamp1, t / 0.4) : mix(uPRamp1, uPRamp2, (t - 0.4) / 0.6);
}

// B: the glyph's class picks a role colour; brightness picks how far from the background.
vec3 roleInk(vec3 col, int mat) {
  vec3 bg = gradedBg();
  float L = lum(col);
  if (mat == M_GLINT || mat == M_EYE) return uPHi;
  if (mat == M_WATER || mat == M_RIPPLE || mat == M_TRAIL) {
    return L < 0.5 ? mix(bg, uPWater, L / 0.5) : mix(uPWater, uPHi, min((L - 0.5) / 0.4, 1.0));
  }
  // Fish: pale ↔ ink by brightness, accent by how saturated the original is
  // (kohaku red, ogon gold), so varieties stay apart.
  float chroma = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  vec3 base = mix(uPInk, uPPale, smoothstep(0.2, 0.85, L));
  return mix(base, uPAccent * (0.55 + 0.6 * L), smoothstep(0.15, 0.45, chroma));
}

// C: keep the pond's hues, measured as the signal above its background.
vec3 filtered(vec3 pix) {
  vec3 d = pix - uBg;
  float y = lum(d);
  vec3 chroma = (d - vec3(y)) * uPSat;
  vec3 bg = gradedBg();
  if (uPInvert == 1) return bg - vec3(y * 1.25) + chroma * 0.9; // dark ink, hue kept
  return bg + (vec3(y) + chroma) * uPTint;
}

vec3 finish(vec3 c, vec3 bg) {
  float s = uPIntensity;
  c = mix(vec3(lum(c)), c, mix(0.25, 1.0, s));
  return clamp(mix(bg, c, mix(0.1, 1.0, s)), 0.0, 1.0);
}

void main() {
  ivec2 q = ivec2(int(gl_FragCoord.x), uCanvasH - 1 - int(gl_FragCoord.y)) - uOrigin;
  vec3 pbg = uPModel == 0 ? uBg : uPModel == 1 ? uPRamp0 : gradedBg();
  if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, uGrid * uCellPx))) {
    fragColor = vec4(uRaw == 1 ? uRawBg : pbg, 1.0);
    return;
  }
  ivec2 cell = q / uCellPx;
  ivec2 local = q - cell * uCellPx;
  vec4 s0 = texelFetch(uScene0, cell, 0);
  if (uRaw == 1) {
    fragColor = vec4(mix(uRawBg, s0.rgb, s0.a), 1.0);
    return;
  }
  vec4 s1 = texelFetch(uScene1, cell, 0);
  int glyph = int(s1.r * 255.0 + 0.5);
  int mat = int(s1.g * 255.0 + 0.5);
  float ink = texelFetch(uAtlas, ivec2(glyph * uCellPx.x + local.x, local.y), 0).r;
  vec3 halo = vec3(0.0);
#ifdef GLOW
  // The halo lights only the background between strokes; ink keeps the
  // glyph's own colour, so shapes stay crisp under the glow.
  halo = texture(uGlow, (vec2(q) + 0.5) * uGlowScale).rgb;
#endif
  vec3 pix = mix(uBg + halo, s0.rgb, ink);
  vec3 c = pix;
  if (uPModel == 1) c = ramp(pix);
  else if (uPModel == 3) c = filtered(pix);
  else if (uPModel == 2) {
    vec3 hb = mix(pbg, uPHi, clamp(lum(halo) * 2.5, 0.0, 1.0) * 0.6);
    c = mix(hb, roleInk(s0.rgb, mat), ink);
  }
  fragColor = vec4(finish(c, pbg), 1.0);
}
