// Fish geometry from the fish texture: the body and tail polylines,
// pectoral fins and the forked caudal fin, as signed distances.
//
// Uniforms (own): uFish.
// Depends on: nothing.

uniform sampler2D uFish;

struct Hit {
  float d; // signed distance, px
  float u; // 0..1 along the polyline
  float v; // -1..1 across it
  vec2 n;  // outward normal, world
};

vec4 F(int f, int i) { return texelFetch(uFish, ivec2(i, f), 0); }

// Closest point on the joint polyline [i0, i0 + count] with linearly
// interpolated radius: a chain of tapered capsules.
Hit polyline(int f, int i0, int count, vec2 p) {
  Hit h;
  h.d = 1e9;
  h.u = 0.0;
  h.v = 0.0;
  h.n = vec2(1.0, 0.0);
  vec4 A = F(f, i0);
  for (int k = 0; k < count; k++) {
    vec4 B = F(f, i0 + k + 1);
    vec2 ab = B.xy - A.xy;
    vec2 ap = p - A.xy;
    float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 dq = ap - ab * t;
    float dist = length(dq);
    float r = mix(A.z, B.z, t);
    float d = dist - r;
    if (d < h.d) {
      h.d = d;
      h.u = (float(k) + t) / float(count);
      float side = ab.x * ap.y - ab.y * ap.x < 0.0 ? -1.0 : 1.0;
      h.v = side * dist / max(r, 1e-3);
      h.n = dist > 1e-4 ? dq / dist : normalize(vec2(-ab.y, ab.x) + 1e-6);
    }
    A = B;
  }
  return h;
}

// Pectoral fin: a blade that widens from the root and rounds off at the tip.
float finDist(vec2 p, vec2 a, vec2 b, float r0, float r1, out float t) {
  vec2 ab = b - a;
  vec2 ap = p - a;
  t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float r = mix(r0, r1, smoothstep(0.0, 0.5, t)) * (1.0 - 0.45 * smoothstep(0.55, 1.0, t));
  return length(ap - ab * t) - r;
}

// Caudal fin: the tail polyline with a forked notch cut into its end and the
// tip capped flat, so the rim is a closed outline.
float tailSD(int f, vec2 q, vec4 fin) {
  Hit th = polyline(f, J_BODY - 1, J_TAIL, q);
  vec2 tip = F(f, J_TOTAL - 1).xy;
  vec2 tdir = normalize(tip - F(f, J_TOTAL - 2).xy + 1e-6);
  return max(max(th.d, (th.u - 1.0 + fin.w * (1.0 - min(abs(th.v), 1.0))) * fin.z), dot(q - tip, tdir));
}
