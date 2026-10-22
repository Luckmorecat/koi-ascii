// Glow pass: one fragment per character cell. Gathers the light the
// neighbouring cells give off (bright glyph colours, weighted by class) with a
// small Gaussian, so the ASCII pass can read a soft halo with one linear
// texture fetch. Cells are about twice as tall as wide, so the kernel spans
// twice as many columns as rows to stay round on screen.

uniform ivec2 uGrid;   // cols, rows
uniform float uAspect; // cell width / cell height
uniform float uGain;   // time-of-day glow strength × overall gain

out vec4 oGlow;

#define RX 4
#define RY 2

#ifdef EMIT_TEX
// Each cell's emission() (emission.glsl), stored by the emission pass.
// Without EMIT_TEX the renderer puts emission.glsl in front of this file.
uniform sampler2D uEmit;
vec4 emission(ivec2 cell) { return texelFetch(uEmit, cell, 0); }
#endif

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int y = -RY; y <= RY; y++) {
    for (int x = -RX; x <= RX; x++) {
      // Distance in cell heights; sigma ≈ one row.
      vec2 d = vec2(float(x) * uAspect, float(y));
      float k = exp(-dot(d, d) * 0.6);
      wsum += k;
      ivec2 n = cell + ivec2(x, y);
      // Fetch every tap, clamped into the grid, and drop the off-grid ones at
      // the add: skipping before the fetches would keep them from batching.
      ivec2 nc = clamp(n, ivec2(0), uGrid - 1);
      vec4 e = emission(nc);
      if (all(equal(n, nc))) sum += e.rgb * e.a * k;
    }
  }
  // Soft knee: dense glints (a dusk crest) saturate toward ~0.4 instead of
  // lighting the gaps between strokes as bright as the strokes themselves.
  vec3 halo = sum * (uGain / wsum);
  oGlow = vec4(halo / (1.0 + 2.5 * max(halo.r, max(halo.g, halo.b))), 1.0);
}
