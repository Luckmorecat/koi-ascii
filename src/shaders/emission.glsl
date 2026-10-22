// The light each cell gives off, which the glow pass blurs into the halo.
// Compiled into the emission pass (emission.frag) where float targets exist,
// otherwise into the glow pass itself (glow.frag), once per tap.

uniform sampler2D uScene0;
uniform sampler2D uScene1;

// Light a cell gives off: only its brightest colours, scaled by how much ink
// the glyph puts down, with glints and eyes counting most. Plain water gives
// none, so the halo marks highlights rather than lifting the whole pond.
// As colour (rgb) and scale (a): the glow pass multiplies them where it sums,
// so stored or not, the halo is rounded the same way.
vec4 emission(ivec2 cell) {
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
  return vec4(s0.rgb, w * s0.a * smoothstep(0.3, 0.85, lum));
}
