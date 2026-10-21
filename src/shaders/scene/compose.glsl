// Draws the fish over the water: their shadows, then each fish's fins, body
// (lit, specular, rim, caustics) and eyes, refracted by the surface.
//
// Uniforms (own): uShadow, uShadowAlpha, uEyeCol, uSumiRim, uAddTint.
// Uniforms (uniforms.glsl): uCaustic, uCell, uLightCol, uLightDir, uOgonGold,
//   uRipplePx, uTime, uWaterDim, uWaterTint.
// Depends on: common.glsl, light.glsl, cell.glsl, ripples.glsl, water.glsl, fish.glsl,
//   markings.glsl.

uniform vec2 uShadow;    // shadow offset, px, away from the light
uniform float uShadowAlpha;
uniform vec3 uEyeCol;

// Light rim drawn over sumi so the Showa's black flank keeps its silhouette.
uniform vec3 uSumiRim;
uniform vec3 uAddTint;   // multiplies light added on a fish: specular, rim, caustics

// Body specular: broad, so the highlight runs along the back.
const float SPEC_POW = 18.0;

float shadow(int f, vec2 p) {
  float lift = 1.25 - F(f, T_P0).w;
  vec2 q = p - uShadow * lift;
  float blur = max(uCell.x, uCell.y) * (0.5 + 1.5 * lift);
  if (!inBox(q, F(f, T_BBOX), blur)) return 0.0;
  float d = min(polyline(f, 0, J_BODY - 1, q).d,
                polyline(f, J_BODY - 1, J_TAIL, q).d + max(uCell.x, uCell.y) * 0.5);
  return (1.0 - smoothstep(-blur, blur, d)) * (0.95 - 0.35 * lift) * uShadowAlpha;
}

// Surface refraction at one point, as main() takes it per cell.
vec2 refrAt(vec2 x) {
  float e = uRipplePx;
  return vec2(rippleAt(x + vec2(e, 0.0)) - rippleAt(x - vec2(e, 0.0)),
              rippleAt(x + vec2(0.0, e)) - rippleAt(x - vec2(0.0, e))) / (2.0 * e) * REFRACT;
}

void drawFish(int f, vec2 p, vec2 refr, inout Cell c) {
  vec4 P0 = F(f, T_P0);
  int variety = int(P0.x + 0.5);
  float seed = P0.y;
  float depth = P0.w;
  // Deeper fish are displaced more by the moving surface.
  vec2 q = p + refr * (0.5 + depth);
  if (!inBox(q, F(f, T_BBOX), max(uCell.x, uCell.y) * 1.5)) return;
  float fog = 0.55 * depth;
  vec3 fogCol = uWaterDim * uWaterTint;
  float fade = 1.0 - 0.3 * depth;
  float style = float(variety);
  vec4 fin = F(f, T_FIN);
  // Fins are thin and lie nearly flat: lit as if facing straight up.
  vec3 flatLight = lightOn(vec3(0.0, 0.0, 1.0));

  // Fin normals come from a numeric gradient over half a cell, so outline
  // glyphs follow the fin's actual rim (fork and tip included).
  float reach = max(uCell.x, uCell.y);
  vec2 ex = vec2(uCell.x * 0.5, 0.0);
  vec2 ey = vec2(0.0, uCell.y * 0.5);

  // Pectoral fins sit beneath the body: outline on the rim, rays inside.
  for (int s = 0; s < 2; s++) {
    vec4 pf = F(f, T_PEC_L + s);
    float t, t2;
    float d = finDist(q, pf.xy, pf.zw, fin.x, fin.y, t);
    if (d > reach) continue;
    vec2 gr = vec2(finDist(q + ex, pf.xy, pf.zw, fin.x, fin.y, t2) - finDist(q - ex, pf.xy, pf.zw, fin.x, fin.y, t2),
                   finDist(q + ey, pf.xy, pf.zw, fin.x, fin.y, t2) - finDist(q - ey, pf.xy, pf.zw, fin.x, fin.y, t2)) / uCell;
    vec2 n = normalize(gr + 1e-6);
    float cv = coverage(d, n);
    if (cv > 0.25) {
      c.col = mix(pectoralColor(variety, t) * flatLight, fogCol, fog);
      c.aux = 0.0;
      c.style = style;
      if (cv < 0.8) {
        c.mat = M_EDGE;
        c.dens = cv;
        c.dir = cellNormal(n);
      } else {
        c.mat = M_FIN;
        c.col *= 0.75;
        c.dens = 0.6 * fade;
        c.dir = lineDir(q - pf.xy);
      }
    }
  }

  // Caudal fin with a forked notch: outline on the rim, rays fanning out from
  // the peduncle inside.
  float td = tailSD(f, q, fin);
  if (td < reach) {
    vec2 gr = vec2(tailSD(f, q + ex, fin) - tailSD(f, q - ex, fin),
                   tailSD(f, q + ey, fin) - tailSD(f, q - ey, fin)) / uCell;
    vec2 n = normalize(gr + 1e-6);
    float tcv = coverage(td, n);
    if (tcv > 0.25) {
      Hit th = polyline(f, J_BODY - 1, J_TAIL, q);
      c.col = mix(tailColor(variety, th.u, th.v, seed) * flatLight, fogCol, fog);
      c.aux = 0.0;
      c.style = style;
      if (tcv < 0.8) {
        c.mat = M_EDGE;
        c.dens = tcv;
        c.dir = cellNormal(n);
      } else {
        c.mat = M_FIN;
        c.col *= 0.75;
        c.dens = (0.65 - 0.2 * th.u) * fade;
        c.dir = lineDir(q - F(f, J_BODY - 1).xy);
      }
    }
  }

  // Body: dense fill inside, outline glyphs along the silhouette.
  Hit bh = polyline(f, 0, J_BODY - 1, q);
  float bcv = coverage(bh.d, bh.n);
  if (bcv > 0.18) {
    float glint = 0.0;
    float sumiAmt = 0.0;
    vec3 bc = variety == V_KOHAKU ? kohaku(bh.u, bh.v, seed)
            : variety == V_SHOWA ? showa(bh.u, bh.v, seed, sumiAmt)
            : ogon(bh.u, bh.v, seed, glint);
    // The body as a cylinder seen from above: |v| = 1 at the silhouette.
    // 0.92 keeps the edge from turning fully sideways (a koi's back is broad).
    float a = min(abs(bh.v), 1.0) * 0.92;
    vec3 N = vec3(bh.n * a, sqrt(1.0 - a * a));
    float ndl = dot(N, diffuseDir());
    vec3 lit = lightOn(N);
    // Highlight along the back where the normal meets the half vector; it
    // slides across the back as the light moves. Sumi is lacquer-glossy and
    // ogon metallic (tinted gold).
    vec3 H = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(N, H), 0.0), SPEC_POW);
    vec3 hue = lightHue() * length(uLightCol) * 0.82 * uAddTint; // ~1 at noon, dim at night
    vec3 hi = variety == V_OGON ? hue * uOgonGold * 0.9 : hue * (variety == V_SHOWA ? 0.32 + 0.25 * sumiAmt : 0.3);
    // Rim on the flank away from the light, lit by the light wrapping round.
    vec2 az = normalize(uLightDir.xy + vec2(1e-5, 0.0));
    float rim = a * a * a * max(-dot(bh.n, az), 0.0) * (0.35 + 0.65 * (1.0 - uLightDir.z));
    // Caustics on the back, only for cells this fish covers. Shallower fish
    // catch sharper, brighter ones; the pattern slides as the fish swims.
    float cst = smoothstep(0.5, 0.95, caustic(q * 0.014 + refr * 0.012 + seed, uTime * 0.45));
    vec3 caust = uLightCol * uAddTint * cst * uCaustic * 0.4 * max(ndl, 0.0) * (1.0 - depth);
    c.col = mix(bc * lit + hi * spec + uLightCol * uAddTint * rim * 0.6 + caust, fogCol, fog);
    // Glyph weight follows the light too, so the lit flank is heavier.
    float shade = mix(0.58, 1.05, smoothstep(-0.2, 0.9, ndl)) + 0.25 * spec;
    c.style = style;
    if (bcv > 0.8) {
      // Glyph weight follows perceived lightness, so markings read as texture
      // and not only as colour: white scales are heavier than sumi.
      float Yl = dot(bc * bc, vec3(0.2126, 0.7152, 0.0722));
      float Ls = 1.16 * pow(Yl, 1.0 / 3.0) - 0.16;
      c.mat = M_BODY;
      c.dens = mix(0.6, 1.0, Ls) * shade * fade;
      c.aux = glint;
    } else {
      c.mat = M_EDGE;
      c.dens = bcv;
      c.dir = cellNormal(bh.n);
      c.aux = 0.0;
      c.col = mix(c.col, mix(uSumiRim * lit, fogCol, fog), 0.65 * sumiAmt);
    }
  }

  // Eyes: always claim the cell nearest their centre so they never vanish.
  vec4 E = F(f, T_EYE);
  for (int s = 0; s < 2; s++) {
    vec2 e = s == 0 ? E.xy : E.zw;
    // Refraction taken at the eye, not per cell: adjacent cells refract by different
    // amounts, so per-cell offsets can leave the eye with no cell (or two).
    vec2 de = abs(p + refrAt(e) * (0.5 + depth) - e);
    if (length(q - e) < P0.z || (de.x < uCell.x * 0.5 && de.y < uCell.y * 0.5)) {
      c.mat = M_EYE;
      c.col = mix(uEyeCol * max(flatLight, vec3(0.75)), fogCol, fog * 0.5);
      c.dens = 1.0;
      c.aux = 0.0;
      c.style = style;
    }
  }
}
