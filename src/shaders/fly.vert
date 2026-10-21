// Fireflies: one point per firefly, drawn into the scene target after the
// scene pass (one fragment per character cell), so each covers exactly the
// cell its centre falls in. State comes packed from the CPU (fireflies.ts).

layout(location = 0) in vec4 aFly; // x, y (CSS px, y down), flash 0…1, seed

uniform vec2 uCell;      // cell size, CSS px
uniform vec2 uOriginCss; // world position of the grid's top-left corner
uniform ivec2 uGrid;     // cols, rows
uniform float uFlies;    // the dusk window (lighting.ts fireflyWeight), 0 … 1

out float vBright;

// Dimmer than this, a firefly draws nothing: it is between blinks.
const float FLY_MIN = 0.22;

void main() {
  float v = aFly.z * uFlies;
  vBright = v;
  gl_PointSize = 1.0;
  // Cell rows run down from the top of the pond, as in scene.frag.
  vec2 cell = floor((aFly.xy - uOriginCss) / uCell);
  vec2 ndc = (cell + 0.5) / vec2(uGrid) * 2.0 - 1.0;
  // Too faint: outside the clip volume, so the point is dropped.
  gl_Position = v < FLY_MIN ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(ndc, 0.0, 1.0);
}
