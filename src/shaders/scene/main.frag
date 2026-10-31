// Scene pass: one fragment per character cell. Decides what the cell shows
// (water, ripple, trail, fin, body outline, body, eye), its colour and which
// glyph draws it. The ASCII pass only copies that glyph from the atlas.
// World space is CSS pixels with y pointing down; cell (0, 0) is top-left.
// src/shaders/scene/index.ts joins the chunks in declare-before-use order.
// The renderer draws it twice: the water and all on it (uLayer 0), then the
// fish over that (uLayer 1), which keeps only the cells a fish claims.
//
// Uniforms (own): uOrder, uOriginCss, uLayer, uFishDraw.
// Uniforms (uniforms.glsl): uCell, uFishCount, uRipplePx.
// Uniforms (other chunks): uAvoidN, uAvoidFade (avoid.glsl), uHiRed (markings.glsl).
// Depends on: cell.glsl, ripples.glsl, water.glsl, sky.glsl, markings.glsl,
//   trails.glsl, compose.glsl, glyphs.glsl, avoid.glsl.

uniform int uOrder[MAX_FISH];
uniform vec2 uOriginCss; // world position of the grid's top-left corner
uniform int uLayer;      // 0 the water and all on it, 1 the fish
uniform int uFishDraw;   // fish drawn: 0 in layer 0, uFishCount in layer 1

layout(location = 0) out vec4 oColor; // rgb colour, a density (for the raw view)
layout(location = 1) out vec4 oInfo;  // r glyph index, g cell class, b readability mask (avoid.glsl)

void main() {
  vec2 p = (floor(gl_FragCoord.xy) + 0.5) * uCell + uOriginCss;

  float e = uRipplePx;
  float h = rippleAt(p);
  vec2 g = vec2(rippleAt(p + vec2(e, 0.0)) - rippleAt(p - vec2(e, 0.0)),
                rippleAt(p + vec2(0.0, e)) - rippleAt(p - vec2(0.0, e))) / (2.0 * e);

  Cell c;
  if (uLayer == 0) {
    c = water(p, h, g);
    stars(p, g, c);
    moon(p, g, c);
    sun(p, g, c);

    float sh = 0.0;
    // Bounded by the count, not MAX_FISH and a break: a constant bound lets
    // the driver unroll shadow() four times, and the three extra copies are a
    // seventh of the program it compiles and links at startup.
    for (int f = 0; f < uFishCount; f++) {
      sh = max(sh, shadow(f, p));
    }
    c.dens *= clamp(1.0 - 1.4 * sh, 0.0, 1.0);
    c.col *= 1.0 - 0.5 * sh;

    trails(p, c);
  } else {
    // No claim yet. A fish claim writes every field pickGlyph reads for its
    // material and never reads the cell under it, so this start never shows.
    c = Cell(vec3(0.0), 0.0, -1, vec2(1.0, 0.0), 0.0, 0.0);
  }

  vec2 refr = g * REFRACT;
  for (int k = 0; k < MAX_FISH; k++) {
    if (k >= uFishDraw) break;
    drawFish(uOrder[k], p, refr, c);
  }
  // Unclaimed: layer 0 already drew this cell.
  if (uLayer == 1 && c.mat < 0) discard;

  // Under page content: fewer, lighter glyphs here; ascii.frag dims them. No
  // zones (or the raw view) skips it all, so the pond draws bit for bit as
  // without them.
  float m = 0.0;
  bool outline = false;
  if (uAvoidN > 0) {
    float d = avoidDist(p);
    m = avoidMask(d);
    if (m > 0.0) c.dens *= avoidThin(m, c.mat);
    // Debug: a dotted line in an existing colour on each zone's edge, unfaded.
    outline = uAvoidFade.w > 0.5 && abs(d) < 0.5 * max(uCell.x, uCell.y);
  }

  int glyph = pickGlyph(c, ivec2(gl_FragCoord.xy));
  if (outline) {
    c.col = uHiRed;
    glyph = G_DOT;
    m = 0.0;
  }
  oColor = vec4(c.col, clamp(c.dens, 0.0, 1.0));
  oInfo = vec4(float(glyph) / 255.0, float(c.mat) / 255.0, m, 0.0);
}
