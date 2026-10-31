// A firefly's cell: its glyph by brightness (. + *) and its colour, written
// over whatever the scene pass put there (fish included). Blending is off.
// Its halo comes from the glow pass (M_FLY), which light palettes skip, so
// there it is the glyph alone, ink like the rest of the pond.
// The renderer puts scene/avoid.glsl before this file: a firefly over page
// content thins like a fish and writes the mask too, or it would cover the
// cell's mask and come through unfaded.

uniform vec3 uFlyCol;   // look.ts: the pond's yellow-green, or the palette's metallic toward the highlight
uniform vec3 uWaterDim; // roles fade toward the deep water, not toward black
uniform float uRoles;
uniform vec2 uCell;      // as fly.vert: cell size, CSS px
uniform vec2 uOriginCss; // world position of the grid's top-left corner

in float vBright;

layout(location = 0) out vec4 oColor; // as scene/main.frag: rgb colour, a density
layout(location = 1) out vec4 oInfo;  // r glyph index, g cell class, b readability mask

void main() {
  float v = min(vBright, 1.0);
  // The cell centre as the scene pass works it out (scene/main.frag).
  float m = uAvoidN > 0 ? avoidMask(avoidDist((floor(gl_FragCoord.xy) + 0.5) * uCell + uOriginCss)) : 0.0;
  // Thinned like the scene's density: the glyph by brightness, not the colour.
  float vt = m > 0.0 ? v * avoidThin(m, M_FLY) : v;
  int glyph = vt > 0.7 ? G_STAR : vt > 0.45 ? G_PLUS : G_DOT;
  float k = min(0.45 + 0.6 * v, 1.0);
  vec3 col = uRoles > 0.5 ? mix(uWaterDim, uFlyCol, k) : uFlyCol * k;
  oColor = vec4(col, vt);
  oInfo = vec4(float(glyph) / 255.0, float(M_FLY) / 255.0, m, 0.0);
}
