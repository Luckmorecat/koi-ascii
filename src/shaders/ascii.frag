// ASCII pass: each output pixel finds its character cell and copies the
// cell's glyph (picked by the scene pass) texel-for-texel from the atlas.

uniform sampler2D uScene0;
uniform sampler2D uScene1;
uniform sampler2D uAtlas;
uniform ivec2 uCellPx;
uniform ivec2 uOrigin; // grid top-left, device px from the canvas top-left
uniform ivec2 uGrid;   // cols, rows
uniform int uCanvasH;
uniform vec3 uBg;      // what glyphs are composited over: pond graded by the time of day, or the roles background
uniform vec3 uRawBg;   // the raw view keeps the plain background
uniform int uRaw;
// Palette (look.ts). Outside #ifdef GLOW, so the software path has it too.
uniform int uLook;          // 0 as composited, 1 ramp, 2 filter
uniform vec3 uOutBg;        // the background as drawn; intensity fades toward it
uniform vec3 uStops[5];     // ramp, background first
uniform int uStopCount;     // 2..5, evenly spaced
uniform vec3 uTint;         // filter: multiplies the pond's colours
uniform float uSaturation;  // filter: 0 grey … 1 original
uniform int uInvert;        // filter: dark glyphs, hues kept
uniform float uIntensity;   // 0 only the background … 1 the full pond
#ifdef GLOW
uniform sampler2D uGlow; // cell-resolution halo, linear filtered (see glow.frag)
uniform vec2 uGlowScale;  // grid px → glow texture coordinates
#endif

out vec4 fragColor;

// Rec.601 luma on sRGB values: what the ramp and filter were tuned with (from
// the prototype). look.ts greys lighting with Rec.709 and palette.ts tests
// "light" with WCAG luminance (Q13); each suits its use, so they differ.
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Ramp: brightness above the pond's background picks a colour along the stops.
vec3 ramp(vec3 pix) {
  float t = clamp((lum(pix) - lum(uBg)) / (0.9 - lum(uBg)), 0.0, 1.0);
  float x = t * float(uStopCount - 1);
  int i = min(int(x), uStopCount - 2);
  return mix(uStops[i], uStops[i + 1], x - float(i));
}

// Filter: the pond's signal above its own background, laid over the new one
// with its hues (scaled by saturation) kept.
vec3 filtered(vec3 pix) {
  vec3 d = pix - uBg;
  float y = lum(d);
  vec3 chroma = (d - vec3(y)) * uSaturation;
  // Inverted: the signal darkens the background. The tint steers the ink's
  // hue (channels the tint lacks are taken away harder; white = even) and its
  // brightness scales the ink, so a grey tint softens it as it dims glyphs
  // when not inverted.
  float tl = lum(uTint);
  if (uInvert == 1) return uOutBg - y * 1.25 * tl * (vec3(1.0 + tl) - uTint) + chroma * 0.9;
  return uOutBg + (vec3(y) + chroma) * uTint;
}

void main() {
  ivec2 q = ivec2(int(gl_FragCoord.x), uCanvasH - 1 - int(gl_FragCoord.y)) - uOrigin;
  if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, uGrid * uCellPx))) {
    fragColor = vec4(uRaw == 1 ? uRawBg : uOutBg, 1.0);
    return;
  }
  // Divided in float (RDNA has no integer divide). Exact for 0 <= q < 2^20:
  // (q + 0.5) / c = k + (r + 0.5) / c keeps 0.5 / c from an integer, so floor is k.
  ivec2 cell = ivec2(floor((vec2(q) + 0.5) / vec2(uCellPx)));
  ivec2 local = q - cell * uCellPx;
  vec4 s0 = texelFetch(uScene0, cell, 0);
  if (uRaw == 1) {
    fragColor = vec4(mix(uRawBg, s0.rgb, s0.a), 1.0);
    return;
  }
  int glyph = int(texelFetch(uScene1, cell, 0).r * 255.0 + 0.5);
  float ink = texelFetch(uAtlas, ivec2(glyph * uCellPx.x + local.x, local.y), 0).r;
  vec3 bg = uBg;
#ifdef GLOW
  // The halo lights only the background between strokes; ink keeps the
  // glyph's own colour, so shapes stay crisp under the glow.
  bg += texture(uGlow, (vec2(q) + 0.5) * uGlowScale).rgb;
#endif
  vec3 c = mix(bg, s0.rgb, ink);
  if (uLook == 1) c = ramp(c);
  else if (uLook == 2) c = clamp(filtered(c), 0.0, 1.0);
  if (uIntensity < 1.0) c = mix(uOutBg, c, uIntensity);
  fragColor = vec4(c, 1.0);
}
