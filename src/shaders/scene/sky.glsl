// The sky reflected on the water (sky features stars, moon, sun): reflected
// stars, the moon's disc and the sun's glitter, over the water and under the fish.
//
// Uniforms (own): uStars, uView, uMoon, uSun, uStarCool, uStarWarm, uMoonCol, uSunCol.
// Uniforms (uniforms.glsl): uCalm, uCell, uGlintCol, uRoles, uTime, uWaterDim.
// Depends on: common.glsl, light.glsl, cell.glsl.

uniform float uStars;    // reflected stars (sky feature stars): 0 none … 1 full night
uniform vec2 uView;      // the pond's size, CSS px

// The moon's reflection (sky feature moon; lighting.ts moonAt): xy centre as
// a share of uView, y down; z radius as a share of its shorter side; w alpha, 0 off.
uniform vec4 uMoon;

// The sun's glitter (sky feature sun; lighting.ts sunAt), as uMoon; z is the
// patch's outer edge.
uniform vec4 uSun;
uniform vec3 uStarCool;  // reflected stars, coolest …
uniform vec3 uStarWarm;  // … to warmest
uniform vec3 uMoonCol;   // the moon's reflection at full strength
uniform vec3 uSunCol;    // the sun's glitter at full strength

// The moon's brightness at full night (D7): dimmer than full strength, so it
// reads as a reflection rather than an icon.
const float MOON_GAIN = 0.85;

// The sun's glitter, half the prototype's density (D8): the share of would-be
// flashes dropped each flash, and the brightness of the faintest and brightest,
// below the Ogon's glints.
const float SUN_THIN = 0.5;
const vec2 SUN_GAIN = vec2(0.6, 0.9);

// Glitter strength below which a cell shows plain water, and the share of the
// patch's radius at its full-strength core.
const float SUN_MIN = 0.45;
const float SUN_CORE = 0.115;

// A sparse field of reflected stars on flat water: fixed to the screen (the
// sky does not drift with the current, unlike the motes), but ripples shift
// which cell each star lands in, so a passing ring makes them jump.
void stars(vec2 p, vec2 g, inout Cell c) {
  if (uStars < 0.02 || c.mat != M_WATER) return;
  vec2 cell = floor((p + g * REFRACT * 2.0) / uCell);
  // 1.6 % of cells; the faintest drop out below, leaving about 1.4 %.
  if (hash12(cell * 0.917 + 41.0) < 0.984) return;
  float mag = hash12(cell + 7.7);
  float ph = hash12(cell + 2.3) * TAU;
  // Twinkle: slow breathing plus a rare sharp scintillation. Calm holds
  // each star still at about its average, so the field looks the same.
  float tw = 0.75 + 0.25 * sin(uTime * (0.8 + 1.6 * mag) + ph);
  tw += 0.5 * pow(max(sin(uTime * 0.37 + ph * 3.0), 0.0), 40.0);
  tw = mix(tw, 0.8, uCalm);
  float v = mag * tw * uStars;
  if (v < 0.15) return;
  c.mat = M_STAR;
  c.dens = v;
  c.aux = hash12(cell + 9.1);
  c.style = 0.0;
  // Brighter stars stand out more. The pond dims toward black; roles fade
  // toward the deep water, so on a light palette a faint star is light grey.
  float k = 0.35 + 0.6 * min(v, 1.0);
  vec3 col = mix(uStarCool, uStarWarm, c.aux);
  c.col = uRoles > 0.5 ? mix(uWaterDim, col, k) : col * k;
}

// The moon's reflection: a full disc with maria and a drawn rim. Ripple
// slopes shift where each cell looks, so a passing ring tears it into
// shards; steep cells inside become bright crest dashes. Drawn over the
// water and stars, under everything else.
void moon(vec2 p, vec2 g, inout Cell c) {
  float a = uMoon.w;
  if (a < 0.02) return;
  float R = uMoon.z * min(uView.x, uView.y);
  // A slow sideways wobble, as on moving water; slower under reduced motion.
  vec2 wob = vec2(sin(p.y * 0.21 + uTime * 1.3 * flicker()) * 1.2, 0.0);
  vec2 dq = p + g * REFRACT * 3.0 + wob - uMoon.xy * uView;
  float dist = length(dq);
  if (dist > R * 1.4) return;
  vec2 n = dist > 1e-3 ? dq / dist : vec2(1.0, 0.0);
  float cv = coverage(dist - R, n);
  if (cv < 0.25) return;
  float r = dist / R;
  float maria = smoothstep(-0.05, 0.2, fbm(dq / R * 1.7 + 5.0));
  float lum = (0.95 - 0.45 * maria) * (1.0 - 0.25 * r * r);
  c.mat = M_MOON;
  c.aux = 0.0;
  // The pond dims toward black; roles fade toward the deep water, so on a
  // light palette the moon is an ink drawing that fades out to the water.
  float k = (0.35 + 0.5 * lum) * MOON_GAIN * a;
  c.col = uRoles > 0.5 ? mix(uWaterDim, uMoonCol, k) : uMoonCol * k;
  if (length(g) * RIPPLE_GAIN > 0.35) {
    c.style = 2.0; // a shard along the crest
    c.dens = a;
    c.dir = lineDir(vec2(-g.y, g.x));
    c.col = mix(c.col, uRoles > 0.5 ? uGlintCol : vec3(1.0), 0.3 * a);
  } else if (cv < 0.8) {
    c.style = 1.0; // rim
    c.dens = cv;
    c.dir = cellNormal(n);
  } else {
    c.style = 0.0; // face: o and : mostly, O only at the brightest centre
    c.dens = 0.72 * lum * a;
  }
}

// The sun's reflection by day: a patch of glitter, densest at the centre,
// that flashes cell by cell. Ripple slopes shift where each cell looks, so a
// ring spreads it. Gold at noon, amber with a low sun, never as bright as an
// Ogon's glint. Drawn over the water and stars, under everything else; the
// water's own glints keep their cells.
void sun(vec2 p, vec2 g, inout Cell c) {
  float a = uSun.w;
  if (a < 0.02 || c.mat == M_GLINT) return;
  float R = uSun.z * min(uView.x, uView.y);
  vec2 dq = p + g * REFRACT * 3.0 - uSun.xy * uView;
  float r = length(dq) / R;
  if (r > 1.0) return;
  vec2 cell = floor(p / uCell);
  // Flashes 5 times a second; reduced motion slows that and holds most of
  // each cell's brightness still.
  float flash = floor(uTime * 5.0 * flicker());
  // Rising and setting, the patch thins out rather than shrinking.
  if (hash12(cell * 1.31 + flash * 0.29 + 3.0) > (1.0 - SUN_THIN) * a) return;
  float tw = hash12(cell + flash * 0.613);
  tw = mix(tw, hash12(cell + 0.37), uCalm * 0.7);
  float v = (1.0 - smoothstep(SUN_CORE, 1.0, r)) * (0.35 + 0.9 * tw);
  if (v < SUN_MIN) return;
  c.mat = M_SUN;
  c.dens = min(v, 1.0);
  c.aux = 0.0;
  c.style = 0.0;
  // The pond tints its gold by the light's hue, so it deepens with a low sun;
  // roles take the highlight and fade toward the deep water.
  float k = mix(SUN_GAIN.x, SUN_GAIN.y, smoothstep(SUN_MIN, 1.0, v));
  c.col = uRoles > 0.5 ? mix(uWaterDim, uSunCol, k) : uSunCol * mirrorHue() * k;
}
