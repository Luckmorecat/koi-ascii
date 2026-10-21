// Glow pass: one fragment per character cell. Gathers the light the
// neighbouring cells give off (bright glyph colours, weighted by class) with a
// small Gaussian, so the ASCII pass can read a soft halo with one linear
// texture fetch. Cells are about twice as tall as wide, so the kernel spans
// twice as many columns as rows to stay round on screen.

uniform sampler2D uScene0;
uniform sampler2D uScene1;
uniform ivec2 uGrid;   // cols, rows
uniform float uAspect; // cell width / cell height
uniform float uGain;   // time-of-day glow strength × overall gain

out vec4 oGlow;

#define RX 4
#define RY 2

// Light a cell gives off: only its brightest colours, scaled by how much ink
// the glyph puts down, with glints and eyes counting most. Plain water gives
// none, so the halo marks highlights rather than lifting the whole pond.
vec3 emission(ivec2 cell) {
  vec4 s0 = texelFetch(uScene0, cell, 0);
  int mat = int(texelFetch(uScene1, cell, 0).g * 255.0 + 0.5);
  float w = mat == M_FLY ? 1.3
          : mat == M_GLINT ? 1.0
          : mat == M_SUN ? 1.2
          : mat == M_EYE ? 0.7
          : mat == M_MOON ? 0.5
          : mat == M_STAR ? 0.35
          : mat == M_RIPPLE ? 0.45
          : mat == M_BODY || mat == M_EDGE || mat == M_FIN ? 0.4
          : 0.0;
  float lum = dot(s0.rgb, vec3(0.299, 0.587, 0.114));
  return s0.rgb * (w * s0.a * smoothstep(0.3, 0.85, lum));
}

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
      if (any(lessThan(n, ivec2(0))) || any(greaterThanEqual(n, uGrid))) continue;
      sum += emission(n) * k;
    }
  }
  // Soft knee: dense glints (a dusk crest) saturate toward ~0.4 instead of
  // lighting the gaps between strokes as bright as the strokes themselves.
  vec3 halo = sum * (uGain / wsum);
  oGlow = vec4(halo / (1.0 + 2.5 * max(halo.r, max(halo.g, halo.b))), 1.0);
}
