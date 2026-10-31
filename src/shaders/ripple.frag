// One step of the surface wave equation. State: (height, previous height).

uniform sampler2D uState;
uniform ivec2 uSize;
uniform float uDamping;
uniform vec4 uDrops[MAX_DROPS]; // xy centre and z radius in texels, w impulse
uniform int uDropCount;

in vec2 vPx; // gl_FragCoord.xy, from pixel.vert
out vec4 fragColor;

vec2 state(ivec2 c) {
  c = clamp(c, ivec2(0), uSize - 1);
  vec4 s = texelFetch(uState, c, 0);
#ifdef RIPPLE_PACKED
  return vec2(dec16(s.rg), dec16(s.ba));
#else
  return s.rg;
#endif
}

void main() {
  // vPx is off texel centres by far less than the 0.5 px int() would need to
  // land on another texel, so c is the texel gl_FragCoord would give.
  ivec2 c = ivec2(vPx);
  vec2 s = state(c);
  float lap = state(c + ivec2(1, 0)).x + state(c - ivec2(1, 0)).x
            + state(c + ivec2(0, 1)).x + state(c - ivec2(0, 1)).x - 4.0 * s.x;
  float h = 2.0 * s.x - s.y + 0.3 * lap;

  // Soak up waves near the borders instead of reflecting them.
  vec2 fc = vec2(c) + 0.5; // exactly gl_FragCoord.xy, unlike vPx
  float edge = min(min(fc.x, fc.y), min(float(uSize.x) - fc.x, float(uSize.y) - fc.y));
  h *= uDamping * mix(0.86, 1.0, smoothstep(0.0, 8.0, edge));

  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrops[i];
    float x = length(fc - d.xy) / d.z;
    if (x < 1.0) {
      float k = 1.0 - x * x;
      h += d.w * k * k;
    }
  }
  h = clamp(h, -1.0, 1.0);

#ifdef RIPPLE_PACKED
  fragColor = vec4(enc16(h), enc16(s.x));
#else
  fragColor = vec4(h, s.x, 0.0, 1.0);
#endif
}
