// Samples the ripple height field the ripple pass simulates.
//
// Uniforms (own): uRipple, uRippleSize.
// Uniforms (uniforms.glsl): uRipplePx.
// Depends on: common.glsl.

uniform sampler2D uRipple;
uniform ivec2 uRippleSize;

float rippleTexel(ivec2 c) {
  c = clamp(c, ivec2(0), uRippleSize - 1);
#ifdef RIPPLE_PACKED
  return dec16(texelFetch(uRipple, c, 0).rg);
#else
  return texelFetch(uRipple, c, 0).r;
#endif
}

float rippleAt(vec2 p) {
  vec2 t = p / uRipplePx - 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  ivec2 c = ivec2(i);
  return mix(mix(rippleTexel(c), rippleTexel(c + ivec2(1, 0)), f.x),
             mix(rippleTexel(c + ivec2(0, 1)), rippleTexel(c + ivec2(1, 1)), f.x), f.y);
}
