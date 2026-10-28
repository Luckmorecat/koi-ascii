// The wake each fish leaves: Kohaku silk, Showa bubbles, Ogon gold dust.
//
// Uniforms (own): uSilk, uBubble, uGoldDust.
// Uniforms (uniforms.glsl): uCell, uFishCount, uTime, uWaterLit, uWaterTint.
// Depends on: common.glsl, light.glsl, cell.glsl, fish.glsl.

uniform vec3 uSilk;
uniform vec3 uBubble;
uniform vec3 uGoldDust;

// One trail segment A -> B: keeps it when it is live and the strongest so far.
void trailSeg(vec2 p, vec4 A, vec4 B, float w0, bool live, int variety,
              inout float best, inout vec2 bestDir, inout int bestVariety) {
  vec2 ab = B.xy - A.xy;
  vec2 ap = p - A.xy;
  float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float dist = length(ap - ab * t);
  float age = mix(A.z, B.z, t);
  float w = w0 * (0.5 + 1.4 * age) + 0.3 * min(uCell.x, uCell.y);
  float I = pow(1.0 - age, 1.3) * (1.0 - smoothstep(w * 0.35, w, dist));
  if (live && I > best) {
    best = I;
    bestDir = ab;
    bestVariety = variety;
  }
}

// trails() walks a chunk's segments four per trip. The last chunk's last trip
// fetches T_TRAIL + TRAIL_CHUNKS * TRAIL_CHUNK, which must stay in the fish row.
#if TRAIL_CHUNK % 4 != 0
#error trails.glsl unrolls by 4
#endif
#if TRAIL_CHUNKS * TRAIL_CHUNK > TRAIL_N + TRAIL_CHUNKS - 1
#error trails.glsl fetches past the fish row
#endif

void trails(vec2 p, inout Cell c) {
  float best = 0.0;
  vec2 bestDir = vec2(1.0, 0.0);
  int bestVariety = 0;
  for (int f = 0; f < MAX_FISH; f++) {
    if (f >= uFishCount) break;
    vec4 P1 = F(f, T_P1);
    int n = int(P1.x + 0.5);
    float w0 = P1.y;
    // Past the widest a segment draws: w below tops out at w0 * 1.9 + 0.3 * cell.
    float pad = w0 * 2.5 + uCell.y;
    if (n < 2 || !inBox(p, F(f, T_TBOX), pad)) continue;
    int variety = int(F(f, T_P0).x + 0.5);
    // Segments come TRAIL_CHUNK to a box (Koi.writeTrail); p outside a box is out
    // of reach of all its segments, so the chunk is skipped. writeTrail keeps
    // n <= TRAIL_N, so this runs at most TRAIL_CHUNKS times. Bounded by n, not
    // TRAIL_CHUNKS and a break: a constant bound lets the driver unroll every
    // chunk body into the program it compiles and links at startup.
    for (int ch = 0; 1 + ch * TRAIL_CHUNK < n; ch++) {
      int k0 = 1 + ch * TRAIL_CHUNK;
      if (!inBox(p, F(f, T_CBOX + ch), pad)) continue;
      vec4 A = F(f, T_TRAIL + k0 - 1);
      for (int j = 0; j < TRAIL_CHUNK; j += 4) {
        int k = k0 + j;
        if (k >= n) break;
        // Four independent fetches per trip let their latency overlap. Texels
        // past n are stale samples or chunk boxes, finite, and their segments
        // are discarded.
        vec4 B0 = F(f, T_TRAIL + k), B1 = F(f, T_TRAIL + k + 1);
        vec4 B2 = F(f, T_TRAIL + k + 2), B3 = F(f, T_TRAIL + k + 3);
        trailSeg(p, A, B0, w0, true, variety, best, bestDir, bestVariety);
        trailSeg(p, B0, B1, w0, k + 1 < n, variety, best, bestDir, bestVariety);
        trailSeg(p, B1, B2, w0, k + 2 < n, variety, best, bestDir, bestVariety);
        trailSeg(p, B2, B3, w0, k + 3 < n, variety, best, bestDir, bestVariety);
        A = B3;
      }
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
