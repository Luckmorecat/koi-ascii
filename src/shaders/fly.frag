// A firefly's cell: its glyph by brightness (. + *) and its colour, written
// over whatever the scene pass put there (fish included). Blending is off.
// Its halo comes from the glow pass (M_FLY), which light palettes skip, so
// there it is the glyph alone, ink like the rest of the pond.

uniform vec3 uFlyCol;   // look.ts: the pond's yellow-green, or the palette's metallic toward the highlight
uniform vec3 uWaterDim; // roles fade toward the deep water, not toward black
uniform float uRoles;

in float vBright;

layout(location = 0) out vec4 oColor; // as scene/main.frag: rgb colour, a density
layout(location = 1) out vec4 oInfo;  // r glyph index, g cell class

void main() {
  float v = min(vBright, 1.0);
  int glyph = v > 0.7 ? G_STAR : v > 0.45 ? G_PLUS : G_DOT;
  float k = min(0.45 + 0.6 * v, 1.0);
  vec3 col = uRoles > 0.5 ? mix(uWaterDim, uFlyCol, k) : uFlyCol * k;
  oColor = vec4(col, v);
  oInfo = vec4(float(glyph) / 255.0, float(M_FLY) / 255.0, 0.0, 0.0);
}
