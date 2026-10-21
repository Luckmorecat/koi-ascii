// Scene pass: one fragment per character cell. Decides what the cell shows
// (water, ripple, trail, fin, body outline, body, eye), its colour and which
// glyph draws it. The ASCII pass only copies that glyph from the atlas.
// World space is CSS pixels with y pointing down; cell (0, 0) is top-left.
// src/shaders/scene/index.ts joins the chunks in declare-before-use order.
//
// Uniforms (own): uOrder, uOriginCss.
// Uniforms (uniforms.glsl): uCell, uFishCount, uRipplePx.
// Depends on: cell.glsl, ripples.glsl, water.glsl, sky.glsl, trails.glsl,
//   compose.glsl, glyphs.glsl, avoid.glsl.

uniform int uOrder[MAX_FISH];
uniform vec2 uOriginCss; // world position of the grid's top-left corner

layout(location = 0) out vec4 oColor; // rgb colour, a density (for the raw view)
layout(location = 1) out vec4 oInfo;  // r glyph index, g cell class

void main() {
  vec2 p = (floor(gl_FragCoord.xy) + 0.5) * uCell + uOriginCss;

  float e = uRipplePx;
  float h = rippleAt(p);
  vec2 g = vec2(rippleAt(p + vec2(e, 0.0)) - rippleAt(p - vec2(e, 0.0)),
                rippleAt(p + vec2(0.0, e)) - rippleAt(p - vec2(0.0, e))) / (2.0 * e);

  Cell c = water(p, h, g);
  stars(p, g, c);
  moon(p, g, c);
  sun(p, g, c);

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

  float am = avoidFade(p, c); // PROTOTYPE avoid-zones
  int glyph = pickGlyph(c, ivec2(gl_FragCoord.xy));
  if (uAvoidLook.w > 0.5 && am > 0.02 && am < 0.98 && abs(am - 0.5) < 0.08) { c.col = uHiRed; glyph = G_DOT; }
  oColor = vec4(c.col, clamp(c.dens, 0.0, 1.0));
  oInfo = vec4(float(glyph) / 255.0, float(c.mat) / 255.0, 0.0, 0.0);
}
