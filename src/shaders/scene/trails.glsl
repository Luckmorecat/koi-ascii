// The wake each fish leaves: Kohaku silk, Showa bubbles, Ogon gold dust.
//
// Uniforms (own): uSilk, uBubble, uGoldDust.
// Uniforms (uniforms.glsl): uCell, uFishCount, uTime, uWaterLit, uWaterTint.
// Depends on: common.glsl, light.glsl, cell.glsl, fish.glsl.

uniform vec3 uSilk;
uniform vec3 uBubble;
uniform vec3 uGoldDust;

void trails(vec2 p, inout Cell c) {
  float best = 0.0;
  vec2 bestDir = vec2(1.0, 0.0);
  int bestVariety = 0;
  for (int f = 0; f < MAX_FISH; f++) {
    if (f >= uFishCount) break;
    vec4 P1 = F(f, T_P1);
    int n = int(P1.x + 0.5);
    float w0 = P1.y;
    if (n < 2 || !inBox(p, F(f, T_TBOX), w0 * 2.5 + uCell.y)) continue;
    int variety = int(F(f, T_P0).x + 0.5);
    vec4 A = F(f, T_TRAIL);
    for (int k = 1; k < TRAIL_N; k++) {
      if (k >= n) break;
      vec4 B = F(f, T_TRAIL + k);
      vec2 ab = B.xy - A.xy;
      vec2 ap = p - A.xy;
      float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float dist = length(ap - ab * t);
      float age = mix(A.z, B.z, t);
      float w = w0 * (0.5 + 1.4 * age) + 0.3 * min(uCell.x, uCell.y);
      float I = pow(1.0 - age, 1.3) * (1.0 - smoothstep(w * 0.35, w, dist));
      if (I > best) {
        best = I;
        bestDir = ab;
        bestVariety = variety;
      }
      A = B;
    }
  }
  if (best < 0.05) return;

  vec2 cell = floor(p / uCell);
  vec3 col;
  if (bestVariety == V_KOHAKU) {
    // Silk: a smooth warm-white ribbon that frays as it fades.
    best *= 0.7 + 0.6 * gnoise(p * 0.035 - uTime * 0.5);
    col = uSilk;
  } else if (bestVariety == V_SHOWA) {
    // Bubbles: sparse dots that stay put while the trail fades.
    float hb = hash12(cell * 1.37 + 5.0);
    best *= step(0.62, hb) * (0.7 + 0.6 * hb);
    col = uBubble;
  } else {
    // Gold dust that twinkles.
    float tw = hash12(cell + floor(uTime * 7.0 * flicker()) * 0.731);
    best *= step(0.5, tw) * 1.2;
    col = uGoldDust;
  }
  if (best < 0.12) return;
  c.mat = M_TRAIL;
  c.dens = min(best, 1.0);
  // Silk keeps its warm hue and only dims as it fades; the others fade into the water.
  c.col = (bestVariety == V_KOHAKU ? col * (0.6 + 0.4 * smoothstep(0.1, 0.6, best)) : mix(uWaterLit, col, smoothstep(0.1, 0.6, best))) * uWaterTint;
  c.dir = lineDir(bestDir);
  c.aux = 0.0;
  c.style = float(bestVariety);
}
