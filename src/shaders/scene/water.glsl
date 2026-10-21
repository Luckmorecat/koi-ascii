// The water: motes, floor caustics, ripple crests and glints. Every cell
// starts here; later chunks draw over it.
//
// Uniforms (own): uSky, uGlint, uDarkWater, uDarkCaustic, uMoteThin, uRippleCol.
// Uniforms (uniforms.glsl): uCaustic, uCell, uGlintCol, uLightDir, uRoles, uTime,
//   uWaterDim, uWaterLit, uWaterTint.
// Depends on: common.glsl, light.glsl, cell.glsl.

uniform vec3 uSky;       // sky reflection added to lit water
uniform float uGlint;
uniform float uDarkWater;   // darker night: flat water colour ×, 1 when off or by day
uniform float uDarkCaustic; // darker night: flat water density × (fewer caustics), 1 when off or by day
uniform float uMoteThin; // share of motes taken away (light palettes with stars); 0 keeps every mote
uniform vec3 uRippleCol;

// Surface tilt (normal.xy / normal.z) per unit of RIPPLE_GAIN-scaled slope.
// A full crest tilts ~63°, so a sun ~6° above the horizon is mirrored
// (half vector ~42° off vertical) at about half a crest; noon needs only
// ~13°, the rings' soft flanks.
const float GLINT_TILT = 2.0;

// Voronoi edge network, animated: bright where two cells meet.
float caustic(vec2 x, float t) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int k = -1; k <= 1; k++) {
      vec2 b = vec2(float(k), float(y));
      vec2 o = 0.5 + 0.42 * sin(t + TAU * hash22(i + b));
      float d = length(b + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return 1.0 - smoothstep(0.0, 0.22, f2 - f1);
}

Cell water(vec2 p, float h, vec2 g) {
  Cell c;
  // Motes drifting with a slow current.
  vec2 mp = floor((p + vec2(7.0, -4.0) * uTime) / uCell);
  // On a light palette at night, a quarter of them, so the stars read (D10).
  float mote = step(mix(0.96, 0.99, uMoteThin), hash12(mp)) * (0.4 + 0.6 * hash12(mp + 17.0));
  // Caustic light on the pond floor, bent a little by the surface. fbm spans
  // only about ±0.3 across a screen, so shimmer stays within ~[0.62, 0.98];
  // the smoothstep's low edge must stay below that range's top.
  float shimmer = 0.8 + 0.6 * fbm(p * 0.0016 + vec2(uTime * 0.012, -uTime * 0.008));
  float lit = smoothstep(0.45, 0.95, caustic(p * 0.011 + g * 3.0, uTime * 0.45) * shimmer);
  c.mat = M_WATER;
  // Fewer floor caustics as the light weakens; motes stay.
  c.dens = max(mote * 0.5, lit * mix(0.6, 1.0, uCaustic));
  // Kept dimmer than ripples and trails, which share the light glyphs.
  c.col = mix(uWaterDim, uWaterLit, 0.6 * lit * min(uCaustic, 1.0)) * uWaterTint + uSky;
  // The darker night (sky feature darkNight). Each is skipped at 1, so
  // without it the water is exactly 0.2's (D4).
  if (uDarkWater < 1.0) c.col *= uDarkWater;
  if (uDarkCaustic < 1.0) c.dens *= uDarkCaustic;
  c.aux = hash12(mp + 3.1);
  c.dir = vec2(1.0, 0.0);
  c.style = 0.0;

  float rip = smoothstep(0.15, 0.6, length(g) * RIPPLE_GAIN);
  if (rip > 0.25) {
    c.mat = M_RIPPLE;
    c.dens = rip;
    c.col = mix(uWaterLit, uRippleCol, rip) * uWaterTint + uSky;
    c.dir = lineDir(vec2(-g.y, g.x)); // along the crest
    c.aux = h > 0.0 ? 1.0 : 0.0;
  }

  // Glints: the cell mirrors the sun/moon to the viewer (looking straight
  // down) when its surface tilt matches the half vector's. Flat water never
  // glints; only ripples do.
  vec3 H = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
  vec2 az = normalize(uLightDir.xy + vec2(1e-5, 0.0));
  vec2 across = vec2(-az.y, az.x);
  float low = 1.0 - uLightDir.z; // ~0.1 at noon, ~0.9 for a setting sun
  vec2 e = -g * RIPPLE_GAIN * GLINT_TILT - H.xy / H.z;
  float ea = dot(e, az);
  float ec = dot(e, across);
  // A low light is mirrored by a wider spread of slopes across its direction,
  // so glints run further along the crests that face it.
  float gl = exp(-sq(ea / (0.3 + 0.4 * low)) - sq(ec / (0.3 + 0.8 * low)));
  gl *= smoothstep(0.06, 0.25, length(g) * RIPPLE_GAIN);
  // Twinkle on a grid stretched along the light: with a low sun neighbouring
  // cells in that direction flash together, so glints read as long dashes.
  vec2 r = vec2(dot(p, az), dot(p, across)) / (max(uCell.x, uCell.y) * vec2(1.0 + 5.0 * low, 1.0));
  float tw = hash12(floor(r) + floor(uTime * 6.0 * flicker()) * 0.613);
  gl *= uGlint * (0.45 + 1.1 * tw);
  if (gl > 0.45) {
    c.mat = M_GLINT;
    c.dens = min(gl, 1.0);
    // Full brightness in the light's hue whatever the hour: a mirror image of
    // the sun or moon, not lit water.
    vec3 gc = uRoles > 0.5 ? uGlintCol : mirrorHue();
    c.col = gc * mix(0.8, 1.0, smoothstep(0.45, 1.0, gl));
    c.dir = lineDir(az);
    c.aux = low;
  }
  return c;
}
