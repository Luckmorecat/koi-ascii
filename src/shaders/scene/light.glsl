// The light falling on the pond: diffuse light on a surface, the light's hue,
// its mirror image on the water, and the flicker rate under reduced motion.
//
// Uniforms (own): uAmbient, uFloor.
// Uniforms (uniforms.glsl): uCalm, uLightCol, uLightDir.
// Depends on: nothing.

uniform vec3 uAmbient;   // sky light on the fish
uniform float uFloor;    // minimum light per channel on fish (night legibility)

// Flicker rate under reduced motion, on top of the pond's own 0.75 slowdown.
const float CALM_FLICKER = 0.3;

float flicker() { return mix(1.0, CALM_FLICKER, uCalm); }

// Seen from above, a fish is mostly back: a sun near the horizon would barely
// reach it. Diffuse light and glyph weight therefore use the light's azimuth
// at no less than ~30° elevation; the highlight and glints keep the true
// direction, so they still slide to the lit edge as the sun sinks.
vec3 diffuseDir() {
  return normalize(vec3(uLightDir.xy, max(uLightDir.z, 0.5)));
}

// Light falling on a surface with unit normal n: sky + sun/moon, never below
// the night floor (per channel, which also neutralises the moon's blue).
vec3 lightOn(vec3 n) {
  return max(uAmbient + uLightCol * max(dot(n, diffuseDir()), 0.0), vec3(uFloor));
}

// The light's own hue at full brightness, for glints and highlights.
vec3 lightHue() {
  return uLightCol / max(max(uLightCol.r, max(uLightCol.g, uLightCol.b)), 1e-3);
}

// The sun or moon mirrored on the water (glints, the sun's glitter): the
// light's hue, part way to white.
vec3 mirrorHue() {
  return mix(lightHue(), vec3(1.0), 0.4);
}
