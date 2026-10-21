// Uniforms and constants that more than one scene chunk reads. One that only
// one chunk reads is declared at the top of that chunk instead.

uniform float uRipplePx;
uniform int uFishCount;
uniform vec2 uCell;
uniform float uTime;

// Time-of-day lighting, derived on the CPU from the phase (lighting.ts).
// Light space: x right, y down the screen, z up toward the viewer.
uniform vec3 uLightDir;  // unit, toward the sun or moon
uniform vec3 uLightCol;  // direct light, intensity included
uniform vec3 uWaterTint; // water, ripples and trails
uniform float uCaustic;
uniform float uCalm;     // 1 under reduced motion: flicker slows further

// Colours, set by the renderer (look.ts): today's pond, or the palette's
// roles (Q1). Outside roles mode they hold the pond's original constants.
uniform vec3 uWaterDim;
uniform vec3 uWaterLit;
uniform vec3 uOgonGold;
uniform vec3 uGlintCol;  // water glints in roles mode (the highlight)
uniform float uRoles;    // 1 in roles mode: glints take uGlintCol, not the light's hue

// Ripple slope (height per px) that reads as a full-strength crest.
const float RIPPLE_GAIN = 28.0;

// Refraction offset (px) per unit of surface slope.
const float REFRACT = 220.0;
