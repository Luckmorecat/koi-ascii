import { J_BODY, J_TAIL, J_TOTAL, TRAIL_CHUNK, TRAIL_CHUNKS, TRAIL_N } from './layout';
import type { Variety } from './varieties';
import { Rng, noise1 } from '../rng';

const TAU = Math.PI * 2;

/** Body half-width along the length (u = 0 nose, 1 peduncle), seen from above. */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.5],
  [0.04, 0.72],
  [0.1, 0.88],
  [0.2, 0.98],
  [0.3, 1.0],
  [0.42, 0.95],
  [0.55, 0.82],
  [0.68, 0.62],
  [0.8, 0.42],
  [0.9, 0.28],
  [1.0, 0.2],
];

function profile(u: number): number {
  for (let i = 1; i < PROFILE.length; i++) {
    const [u1, w1] = PROFILE[i];
    if (u <= u1) {
      const [u0, w0] = PROFILE[i - 1];
      return w0 + ((w1 - w0) * (u - u0)) / (u1 - u0);
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/** profile() at each body joint, u = i / (J_BODY - 1); the same for every fish and frame. */
const JOINT_PROFILE = Float64Array.from({ length: J_BODY }, (_, i) => profile(i / (J_BODY - 1)));
const PEDUNCLE_PROFILE = profile(1);

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** How far tail joint J_BODY + n has spread from the peduncle width to the full tail width. */
const TAIL_SPREAD = Float64Array.from({ length: J_TAIL }, (_, n) => Math.pow(smoothstep(0, 0.85, (n + 1) / J_TAIL), 0.75));

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

/** Frame-rate independent smoothing factor. */
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * Math.hypot(x, y) to the bit, but inlinable: V8 never inlines its builtin, so
 * each call boxes both arguments and the result as heap numbers. For two
 * arguments the builtin's normalised Kahan sum comes down to this. The NaN case
 * returns ax + ay, not the global NaN: that load never runs, so TurboFan leaves
 * it untyped and would box every inlined call's result.
 */
function hypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return ax + ay;
  const hi = ax > ay ? ax : ay;
  if (hi === 0) return 0;
  const q = (ax > ay ? ay : ax) / hi;
  return Math.sqrt(1 + q * q) * hi;
}

/**
 * Age at which writeTrail ends a trail. Ages only grow along it, so a segment
 * cut off joins samples at least this old, where trails.glsl's I is at most
 * 0.15^1.3 < 0.085; even times the largest variety factor, 1.3 (gnoise stays
 * within [-1, 1]), that is under the 0.12 a trail cell needs. So the strongest
 * segment of any cell drawn is kept, and is still the first that strong.
 */
const TRAIL_CUT = 0.85;

export type Mode = 'cruise' | 'burst' | 'glide' | 'hover' | 'flee';

export interface Pointer {
  x: number;
  y: number;
  inside: boolean;
  /** Pond time of the last move. */
  lastMove: number;
  /** Smoothed speed in px/s. */
  speed: number;
  /** A touch or pen just lifted here; the spot stays interesting for a while. */
  linger: boolean;
}

export interface Tap {
  x: number;
  y: number;
  t: number;
}

export interface World {
  readonly width: number;
  readonly height: number;
  readonly unit: number;
  readonly time: number;
  readonly pointer: Pointer;
  readonly taps: readonly Tap[];
  readonly fish: readonly Koi[];
  /** Reduced motion: no bursts, startles or splashes. */
  readonly calm: boolean;
  drop(x: number, y: number, radius: number, amount: number): void;
}

export class Koi {
  readonly variety: Variety;
  /** Small offset into pattern noise space; gives each fish its own markings. */
  readonly patternSeed: number;
  private readonly rng: Rng;
  private readonly noiseSeed: number;
  /** cos and sin of +maxBend, then of -maxBend: body joints from 0, tail joints from 4. */
  private readonly bendTrig: Float64Array;

  length = 1;
  x = 0;
  y = 0;
  heading = 0;
  speed = 0;
  depth = 0.3;
  mode: Mode = 'cruise';

  private angVel = 0;
  /** Slowly eased heading that wander is relative to, so wander can't become a sustained turn. */
  private course = 0;
  /** Heading a dart is snapping to, while one is under way. */
  private dartTo: number | null = null;
  /** Side (+1/-1) a turn toward a target behind is committed to; 0 when none. */
  private behindSide = 0;
  private modeUntil = 0;
  private nextBurst = 0;
  private fleeX = 0;
  private fleeY = 0;
  private poi: { x: number; y: number } | null = null;
  private poiUntil = 0;
  private nextPoi = 0;
  private phase = 0;
  private amp = 0;
  private lastTap = -Infinity;
  private nextRipple = 0;
  private nextGulp = 0;
  private posed = false;

  /** Spine centreline that follows the head's path: x, y per joint. */
  private readonly spine = new Float32Array(J_TOTAL * 2);
  /** Joints with the swimming wave applied: x, y, radius. */
  readonly joints = new Float32Array(J_TOTAL * 3);
  /** Pectoral fins: root.xy, tip.xy. */
  readonly pecL = new Float32Array(4);
  readonly pecR = new Float32Array(4);
  pecRoot = 1;
  pecMax = 1;
  readonly eyes = new Float32Array(4);
  eyeRadius = 1;
  /** Bounds of body and fins: min.xy, max.xy. */
  readonly bbox = new Float32Array(4);
  /** Bounds of the trail written by the last writeTrail call: the union of trailChunks. */
  readonly trailBox = new Float32Array(4);
  /** Bounds of each chunk of that trail: min.xy, max.xy per chunk (see writeTrail). */
  readonly trailChunks = new Float32Array(TRAIL_CHUNKS * 4);

  /** Ring buffer of trail samples: x, y, time. */
  private readonly trail = new Float32Array((TRAIL_N - 1) * 3);
  private trailHead = 0;
  private trailLen = 0;
  private nextTrail = 0;

  constructor(variety: Variety, seed: number, world: World) {
    this.variety = variety;
    this.bendTrig = Float64Array.from(
      [variety.bodyBend, variety.tailBend].flatMap((m) => [Math.cos(m), Math.sin(m), Math.cos(-m), Math.sin(-m)]),
    );
    this.rng = new Rng(seed);
    this.noiseSeed = this.rng.range(0, 100);
    this.patternSeed = this.rng.range(0, 40);
    this.place(world);
  }

  private place(w: World): void {
    const v = this.variety;
    this.length = v.length * w.unit;
    // Centre the whole fish (nose to tail tip) near the middle, then nudge it
    // so both ends start inside the pond.
    const total = this.length * (1 + v.tailLength);
    // Start along the pond's long axis, so a fish never begins nose-first at a near wall.
    const r = this.rng.range(-Math.PI, Math.PI);
    const along = w.height > w.width ? Math.PI / 2 : 0;
    this.heading = along + (r > 0 ? 0 : Math.PI) + 0.4 * Math.sin(r * 3);
    this.course = this.heading;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    let x = w.width * this.rng.range(0.3, 0.7) + (c * total) / 2;
    let y = w.height * this.rng.range(0.3, 0.7) + (s * total) / 2;
    const tx = x - c * total;
    const ty = y - s * total;
    const m = 8;
    x += Math.max(0, m - Math.min(x, tx)) - Math.max(0, Math.max(x, tx) - (w.width - m));
    y += Math.max(0, m - Math.min(y, ty)) - Math.max(0, Math.max(y, ty) - (w.height - m));
    this.x = x;
    this.y = y;
    this.speed = v.cruise * this.length;
    this.depth = lerp(v.depth[0], v.depth[1], this.rng.next());
    this.nextBurst = this.rng.range(v.burstEvery[0], v.burstEvery[1]);
    const back = this.length / (J_BODY - 1);
    for (let i = 0; i < J_TOTAL; i++) {
      this.spine[i * 2] = this.x - Math.cos(this.heading) * back * i;
      this.spine[i * 2 + 1] = this.y - Math.sin(this.heading) * back * i;
    }
    this.followSpine(this.length);
    this.pose(this.length, v.cruise * this.length, 0, 0);
  }

  /** Keeps the fish in the same relative spot when the pond is resized. */
  rescale(sx: number, sy: number): void {
    this.x *= sx;
    this.y *= sy;
    for (let i = 0; i < J_TOTAL; i++) {
      this.spine[i * 2] *= sx;
      this.spine[i * 2 + 1] *= sy;
    }
    for (let i = 0; i < this.trailLen; i++) {
      this.trail[i * 3] *= sx;
      this.trail[i * 3 + 1] *= sy;
    }
    if (this.poi) {
      this.poi.x *= sx;
      this.poi.y *= sy;
    }
    this.posed = false;
  }

  /**
   * Moves the fish (body and trail together) so its head is at least `margin`
   * inside a w × h pond. A negative margin allows it that far outside.
   */
  confine(w: number, h: number, margin: number): void {
    if (this.poi) {
      this.poi.x = clamp(this.poi.x, 0, w);
      this.poi.y = clamp(this.poi.y, 0, h);
    }
    const m = Math.min(margin, w * 0.25, h * 0.25);
    const dx = clamp(this.x, m, w - m) - this.x;
    const dy = clamp(this.y, m, h - m) - this.y;
    if (dx === 0 && dy === 0) return;
    this.x += dx;
    this.y += dy;
    for (let i = 0; i < J_TOTAL; i++) {
      this.spine[i * 2] += dx;
      this.spine[i * 2 + 1] += dy;
    }
    for (let i = 0; i < this.trailLen; i++) {
      this.trail[i * 3] += dx;
      this.trail[i * 3 + 1] += dy;
    }
    this.posed = false;
  }

  /** +1 if a positive (clockwise on screen) turn heads toward the pond centre, else -1. */
  private openSide(w: World): number {
    const cx = w.width / 2 - this.x;
    const cy = w.height / 2 - this.y;
    return Math.cos(this.heading) * cy - Math.sin(this.heading) * cx >= 0 ? 1 : -1;
  }

  update(dt: number, w: World): void {
    const v = this.variety;
    const L = (this.length = v.length * w.unit);
    const cruise = v.cruise * L;
    const t = w.time;
    const ptr = w.pointer;
    const ptrActive = (ptr.inside || ptr.linger) && t - ptr.lastMove < v.attention;
    const pd = ptrActive ? hypot(ptr.x - this.x, ptr.y - this.y) : Infinity;

    // --- reactions to taps and sudden pointer motion
    for (const tap of w.taps) {
      if (tap.t <= this.lastTap) continue;
      this.lastTap = tap.t;
      const d = hypot(tap.x - this.x, tap.y - this.y);
      if (!w.calm && d < w.unit * 0.55 * v.skittish) {
        this.startle(tap.x, tap.y, t, w);
      } else if (v.roams && d < w.unit * 1.5) {
        this.poi = { x: tap.x, y: tap.y };
        this.poiUntil = t + 8;
        if (this.mode === 'hover') this.mode = 'cruise';
      }
    }
    if (!w.calm && v.skittish > 0.5 && this.mode !== 'flee' && ptr.speed > 1100 && pd < L * 1.4) {
      this.startle(ptr.x, ptr.y, t, w);
    }

    // --- gait: cruise → burst → glide → cruise (bursts only for darting varieties)
    if (this.mode !== 'cruise' && t >= this.modeUntil) {
      if (this.mode === 'burst' || this.mode === 'flee') {
        this.mode = 'glide';
        this.modeUntil = t + this.rng.range(0.8, 1.6);
      } else {
        this.mode = 'cruise';
        this.nextBurst = t + this.rng.range(v.burstEvery[0], v.burstEvery[1]);
      }
    }
    // Not while it is holding still at something it is watching: a dart from rest only spins it on the spot.
    if (!w.calm && this.mode === 'cruise' && v.burst > 1 && t >= this.nextBurst && this.speed > cruise * 0.5) {
      // A burst opens with a sharp dart toward open water.
      this.mode = 'burst';
      this.modeUntil = t + this.rng.range(v.burstTime[0], v.burstTime[1]);
      this.dartTo = wrapAngle(this.heading + this.openSide(w) * this.rng.range(0.9, 1.7));
      if (this.depth < 0.35) this.splash(w, 0.3);
    }

    // --- steering
    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    this.course = wrapAngle(this.course + wrapAngle(this.heading - this.course) * ease(0.5, dt));
    const wander = this.dartTo ?? this.course + noise1(t * v.wanderFreq, this.noiseSeed) * v.wanderAmp;
    let sx = Math.cos(wander);
    let sy = Math.sin(wander);

    // Pond edges: look ahead and turn back toward open water.
    const margin = Math.min(L * 0.55, w.width * 0.2, w.height * 0.2);
    const look = L * 0.6 + this.speed * 1.2;
    const ax = this.x + fx * look;
    const ay = this.y + fy * look;
    const sx0 = sx;
    const sy0 = sy;
    if (ax < margin) sx += ((margin - ax) / margin) * 3;
    else if (ax > w.width - margin) sx -= ((ax - (w.width - margin)) / margin) * 3;
    if (ay < margin) sy += ((margin - ay) / margin) * 3;
    else if (ay > w.height - margin) sy -= ((ay - (w.height - margin)) / margin) * 3;
    const wallK = hypot(sx - sx0, sy - sy0);

    // Personal space from fish at a similar depth; deeper/shallower ones can pass over.
    for (const o of w.fish) {
      if (o === this) continue;
      const dx = this.x - o.x;
      const dy = this.y - o.y;
      const d = hypot(dx, dy);
      const range = (L + o.length) * 0.5;
      const dz = Math.abs(this.depth - o.depth);
      if (d > 1e-3 && d < range && dz < 0.3) {
        const k = (1 - d / range) * (1 - dz / 0.3) * 1.6;
        sx += (dx / d) * k;
        sy += (dy / d) * k;
      }
    }

    // Interest: the pointer, or for roamers a spot in the pond worth inspecting.
    // Positive weight attracts; negative (shy fish too close) eases away.
    let tx = 0;
    let ty = 0;
    let tw = 0;
    let seekingPoi = false;
    if (ptrActive && v.curiosity > 0) {
      const reach = w.unit * (0.3 + 1.2 * v.curiosity);
      const calm = v.skittish > 0.5 ? clamp(1 - ptr.speed / 500, 0, 1) : 1;
      const k = v.curiosity * calm * smoothstep(reach, reach * 0.5, pd);
      const so = v.standOff * L;
      if (v.skittish > 0.5 && pd < so * 0.75) {
        tx = ptr.x;
        ty = ptr.y;
        tw = -(1 - pd / (so * 0.75)) * 0.8;
      } else if (k > 0.01) {
        // Approach to a point `so` short of the pointer, on this fish's side.
        tx = ptr.x + (so > 0 && pd > 1e-3 ? ((this.x - ptr.x) / pd) * so : 0);
        ty = ptr.y + (so > 0 && pd > 1e-3 ? ((this.y - ptr.y) / pd) * so : 0);
        tw = k;
      }
    }
    if (tw === 0 && v.roams) {
      if (this.poi && t > this.poiUntil) {
        this.poi = null;
        this.nextPoi = t + this.rng.range(1, 3);
      }
      if (!this.poi && t >= this.nextPoi && this.mode !== 'hover') {
        // Somewhere worth swimming to, not right under its nose.
        const pick = () => ({ x: w.width * this.rng.range(0.15, 0.85), y: w.height * this.rng.range(0.15, 0.85) });
        let poi = pick();
        for (let k = 0; k < 6 && hypot(poi.x - this.x, poi.y - this.y) < 0.35 * w.unit; k++) poi = pick();
        this.poi = poi;
        this.poiUntil = t + this.rng.range(8, 14);
      }
      if (this.poi) {
        tx = this.poi.x;
        ty = this.poi.y;
        tw = 0.9;
        seekingPoi = true;
      }
    }
    let td = Infinity;
    if (tw !== 0) {
      const dx = tx - this.x;
      const dy = ty - this.y;
      td = hypot(dx, dy);
      if (td > 1e-3) {
        // Stop chasing a target that is already under the nose, or the fish coils around it.
        const near = tw > 0 ? smoothstep(L * 0.25, L * 0.6, td) : 1;
        sx += (dx / td) * tw * 2.2 * near;
        sy += (dy / td) * tw * 2.2 * near;
      }
      if (seekingPoi && td < L * 0.45 && this.mode === 'cruise') {
        this.mode = 'hover';
        this.modeUntil = t + this.rng.range(1.5, 3);
        this.poi = null;
        this.nextPoi = this.modeUntil + this.rng.range(0.5, 2);
      }
    }
    if (this.mode === 'flee') {
      // Flee away from the scare, but bounce off walls rather than into them.
      let ex = this.fleeX;
      let ey = this.fleeY;
      const r = L * 1.2;
      if ((this.x + ex * r < margin && ex < 0) || (this.x + ex * r > w.width - margin && ex > 0)) ex = -ex * 0.3;
      if ((this.y + ey * r < margin && ey < 0) || (this.y + ey * r > w.height - margin && ey > 0)) ey = -ey * 0.3;
      sx += ex * 4;
      sy += ey * 4;
    }

    // --- turn toward the desired heading with some angular inertia
    let err = wrapAngle(Math.atan2(sy, sx) - this.heading);
    // Target nearly behind: which way round is a coin toss, so turn toward open water.
    // Chasing the pointer or fleeing, hold the side picked until the turn is done:
    // re-picked every step it flips once the fish faces the centre, and the fish
    // swims straight away. Wander still re-picks, so a wall turn cannot latch into a circle.
    const commit = (tw > 0.5 && !seekingPoi) || this.mode === 'flee';
    if (Math.abs(err) <= 2 || !commit) this.behindSide = 0;
    else if (!this.behindSide) this.behindSide = this.openSide(w);
    if (Math.abs(err) > 2) err = Math.abs(err) * (this.behindSide || this.openSide(w));
    // Unhurried fish keep to their turning circle; walls, fright and a distant
    // pointer let them turn as hard as they can.
    const urgent = wallK > 0.6 || this.mode === 'flee' || (tw > 0 && !seekingPoi && td > L * 1.2);
    const cap = urgent ? v.turnRate : Math.min(v.turnRate, this.speed / (v.minTurnRadius * L));
    let rate = clamp(err * 2.2, -cap, cap);
    let easeRate = 6;
    if (this.dartTo !== null) {
      rate = clamp(err * 6, -7, 7);
      easeRate = 25;
      if (Math.abs(err) < 0.15 || this.mode !== 'burst') {
        this.dartTo = null;
        this.course = this.heading;
        this.angVel *= 0.25;
      }
    }
    this.angVel += (rate - this.angVel) * ease(easeRate, dt);
    this.heading = wrapAngle(this.heading + this.angVel * dt);

    // --- speed
    let target = cruise * (1 + 0.15 * Math.sin(t * 0.9 + this.noiseSeed * 3));
    let accel = 1.5;
    switch (this.mode) {
      case 'burst':
        target = cruise * v.burst;
        accel = 7;
        break;
      case 'flee':
        target = cruise * Math.max(v.burst, 2.4) * 1.1;
        accel = 8;
        break;
      case 'glide':
        target = cruise * 0.5;
        accel = 0.9;
        break;
      case 'hover':
        target = cruise * 0.08;
        accel = 2;
        break;
      case 'cruise':
        break;
    }
    if (tw > 0 && this.mode !== 'flee') {
      target = Math.min(target, cruise * (0.06 + 0.94 * smoothstep(L * 0.15, L * 1.3, td)));
    }
    this.speed += (target - this.speed) * ease(accel, dt);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    // --- depth drifts; curious fish rise to meet the pointer, frightened ones dive
    let depthTarget = lerp(v.depth[0], v.depth[1], 0.5 + 0.5 * noise1(t * v.depthFreq, this.noiseSeed + 7.7));
    if (tw > 0 && td < L * 1.2 && v.skittish <= 0.5) depthTarget = Math.min(depthTarget, v.depth[0] * 0.5);
    if (this.mode === 'flee') depthTarget = v.depth[1];
    this.depth += (depthTarget - this.depth) * ease(0.8, dt);

    // --- swimming wave: amplitude follows thrust, frequency follows speed
    const sp = this.speed / cruise;
    const thrust = this.mode === 'glide' ? 0.3 : this.mode === 'hover' ? 0.35 : 1;
    const ampTarget = v.beatAmp * L * clamp(0.3 + 0.7 * sp, 0.25, 1.5) * thrust;
    this.amp += (ampTarget - this.amp) * ease(4, dt);
    const fast = this.mode === 'burst' || this.mode === 'flee' ? 1.35 : 1;
    const freq = v.beatFreq * clamp(0.5 + 0.5 * sp, 0.4, 2.4) * fast;
    this.phase = (this.phase + TAU * freq * dt) % TAU;

    this.followSpine(L);
    this.pose(L, cruise, t, dt);
    this.recordTrail(t);
    this.emitRipples(w, t, cruise, L, tw > 0 ? td : Infinity);
    // Backstop for tiny ponds: never stray more than half a length outside.
    this.confine(w.width, w.height, -0.5 * L);
  }

  private startle(x: number, y: number, t: number, w: World): void {
    const dx = this.x - x;
    const dy = this.y - y;
    const d = hypot(dx, dy) || 1;
    this.fleeX = dx / d;
    this.fleeY = dy / d;
    this.mode = 'flee';
    this.modeUntil = t + this.rng.range(0.5, 0.85);
    this.dartTo = null;
    this.behindSide = 0;
    if (this.depth < 0.4) this.splash(w, 0.45);
  }

  private splash(w: World, amount: number): void {
    if (w.calm) return;
    const i = (J_BODY - 1) * 3;
    w.drop(this.joints[i], this.joints[i + 1], this.length * 0.12, -amount);
  }

  /** Follow-the-leader spine with a per-joint bend limit. */
  private followSpine(L: number): void {
    const v = this.variety;
    const s = this.spine;
    const segBody = L / (J_BODY - 1);
    const segTail = (L * v.tailLength) / J_TAIL;
    s[0] = this.x;
    s[1] = this.y;
    let px = -Math.cos(this.heading);
    let py = -Math.sin(this.heading);
    for (let i = 1; i < J_TOTAL; i++) {
      const seg = i < J_BODY ? segBody : segTail;
      const maxBend = i < J_BODY ? v.bodyBend : v.tailBend;
      let dx = s[i * 2] - s[i * 2 - 2];
      let dy = s[i * 2 + 1] - s[i * 2 - 1];
      const d = hypot(dx, dy);
      if (d < 1e-6) {
        dx = px;
        dy = py;
      } else {
        dx /= d;
        dy /= d;
      }
      const cross = px * dy - py * dx;
      const dot = px * dx + py * dy;
      // For these unit vectors past = sin(|bend| - maxBend), which has the sign of
      // |bend| - maxBend. Only a joint within rounding of the limit needs atan2 to
      // decide as before; the rest skip it.
      const t = i < J_BODY ? 0 : 4;
      const past = Math.abs(cross) * this.bendTrig[t] - dot * this.bendTrig[t + 1];
      let side = 0;
      if (past > 1e-9 && cross !== 0) side = cross > 0 ? 1 : -1;
      else if (past >= -1e-9) {
        const bend = Math.atan2(cross, dot);
        if (Math.abs(bend) > maxBend) side = Math.sign(bend);
      }
      if (side !== 0) {
        // cos and sin of side * maxBend, the same values Math.cos/sin give for it.
        const c = this.bendTrig[side > 0 ? t : t + 2];
        const sn = this.bendTrig[side > 0 ? t + 1 : t + 3];
        dx = px * c - py * sn;
        dy = px * sn + py * c;
      }
      s[i * 2] = s[i * 2 - 2] + dx * seg;
      s[i * 2 + 1] = s[i * 2 - 1] + dy * seg;
      px = dx;
      py = dy;
    }
  }

  /** Applies the travelling body wave and derives fins, eyes and bounds. */
  private pose(L: number, cruise: number, t: number, dt: number): void {
    const v = this.variety;
    const s = this.spine;
    const j = this.joints;
    const tailLen = L * v.tailLength;
    const total = L + tailLen;
    const maxR = v.radius * L;
    const pedR = maxR * PEDUNCLE_PROFILE;

    for (let i = 0; i < J_TOTAL; i++) {
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, J_TOTAL - 1);
      let tx = s[i1 * 2] - s[i0 * 2];
      let ty = s[i1 * 2 + 1] - s[i0 * 2 + 1];
      const tl = hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      let a: number;
      let r: number;
      let lag = 0;
      if (i < J_BODY) {
        const u = i / (J_BODY - 1);
        a = (u * L) / total;
        r = maxR * JOINT_PROFILE[i];
      } else {
        const k = (i - J_BODY + 1) / J_TAIL;
        a = (L + k * tailLen) / total;
        r = pedR + (maxR * v.tailSpread - pedR) * TAIL_SPREAD[i - J_BODY];
        lag = k * v.tailBend * 1.6;
      }
      const off = this.amp * (0.1 + 0.9 * a * a) * Math.sin(TAU * v.waveK * a - this.phase - lag);
      j[i * 3] = s[i * 2] - ty * off;
      j[i * 3 + 1] = s[i * 2 + 1] + tx * off;
      j[i * 3 + 2] = r;
    }

    // Pectoral fins: tucked when fast, sculling when slow, tips trail behind.
    const sp = this.speed / cruise;
    const slow = 1 - smoothstep(0.25, 0.7, sp);
    let sweep = v.finSweep * (0.8 + 0.2 * slow);
    if (this.mode === 'burst' || this.mode === 'flee') sweep = 0.22;
    const finLen = v.finLength * L;
    this.pecMax = v.finWidth * L;
    this.pecRoot = this.pecMax * 0.4;
    const root = this.sampleBody(0.2);
    for (let side = -1; side <= 1; side += 2) {
      const out = side > 0 ? this.pecL : this.pecR;
      const ang = sweep + slow * 0.35 * Math.sin(t * 3.4 + (side > 0 ? 0 : Math.PI));
      const c = Math.cos(ang);
      const sn = Math.sin(ang) * side;
      const dx = root.bx * c + root.nx * sn;
      const dy = root.by * c + root.ny * sn;
      const rx = root.x + root.nx * side * root.r * 0.85;
      const ry = root.y + root.ny * side * root.r * 0.85;
      let tipX = rx + dx * finLen;
      let tipY = ry + dy * finLen;
      if (this.posed) {
        const k = ease(v.finStiffness, dt);
        tipX = lerp(out[2], tipX, k);
        tipY = lerp(out[3], tipY, k);
        const lx = tipX - rx;
        const ly = tipY - ry;
        const ll = hypot(lx, ly) || 1;
        tipX = rx + (lx / ll) * finLen;
        tipY = ry + (ly / ll) * finLen;
      }
      out[0] = rx;
      out[1] = ry;
      out[2] = tipX;
      out[3] = tipY;
    }

    const head = this.sampleBody(0.075);
    this.eyeRadius = Math.max(head.r * 0.17, 1);
    for (let side = 1, o = 0; side >= -1; side -= 2, o += 2) {
      this.eyes[o] = head.x + head.nx * side * head.r * 0.55;
      this.eyes[o + 1] = head.y + head.ny * side * head.r * 0.55;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < J_TOTAL; i++) {
      const r = j[i * 3 + 2];
      minX = Math.min(minX, j[i * 3] - r);
      minY = Math.min(minY, j[i * 3 + 1] - r);
      maxX = Math.max(maxX, j[i * 3] + r);
      maxY = Math.max(maxY, j[i * 3 + 1] + r);
    }
    for (let f = 0; f < 2; f++) {
      const fin = f ? this.pecR : this.pecL;
      for (let k = 0; k < 4; k += 2) {
        minX = Math.min(minX, fin[k] - this.pecMax);
        minY = Math.min(minY, fin[k + 1] - this.pecMax);
        maxX = Math.max(maxX, fin[k] + this.pecMax);
        maxY = Math.max(maxY, fin[k + 1] + this.pecMax);
      }
    }
    this.bbox[0] = minX;
    this.bbox[1] = minY;
    this.bbox[2] = maxX;
    this.bbox[3] = maxY;
    this.posed = true;
  }

  /** Point on the rendered body centreline at u (0 nose .. 1 peduncle). */
  private sampleBody(u: number) {
    const j = this.joints;
    const f = u * (J_BODY - 1);
    const i = Math.min(Math.floor(f), J_BODY - 2);
    const k = f - i;
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 2, J_BODY - 1);
    let bx = j[b * 3] - j[a * 3];
    let by = j[b * 3 + 1] - j[a * 3 + 1];
    const bl = hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    return {
      x: lerp(j[i * 3], j[(i + 1) * 3], k),
      y: lerp(j[i * 3 + 1], j[(i + 1) * 3 + 1], k),
      r: lerp(j[i * 3 + 2], j[(i + 1) * 3 + 2], k),
      /** backward (head → tail) axis */
      bx,
      by,
      /** fish's left in y-down screen space */
      nx: -by,
      ny: bx,
    };
  }

  /**
   * Where the trail is laid: 35% of the way from the spine's tail tip to the
   * waved tail tip, so the trail follows the body line and the beat doesn't
   * zigzag it.
   */
  private trailPoint(): [number, number] {
    const si = (J_TOTAL - 1) * 2;
    const ji = (J_TOTAL - 1) * 3;
    return [lerp(this.spine[si], this.joints[ji], 0.35), lerp(this.spine[si + 1], this.joints[ji + 1], 0.35)];
  }

  private recordTrail(t: number): void {
    if (t < this.nextTrail) return;
    const v = this.variety;
    const cap = TRAIL_N - 1;
    this.nextTrail = t + Math.max(1 / 30, v.trailTime / (cap - 2));
    const [x, y] = this.trailPoint();
    const o = this.trailHead * 3;
    this.trail[o] = x;
    this.trail[o + 1] = y;
    this.trail[o + 2] = t;
    this.trailHead = (this.trailHead + 1) % cap;
    this.trailLen = Math.min(this.trailLen + 1, cap);
  }

  /**
   * Writes trail samples newest-first as texels (x, y, age, 0) starting at
   * `base`, beginning with the live tail-tip position and ending with the
   * first sample TRAIL_CUT old. Returns the count.
   * Chunk c of trailChunks bounds segments 1 + c * TRAIL_CHUNK to
   * (c + 1) * TRAIL_CHUNK (segment k joins samples k - 1 and k), grown by the
   * width they draw at the chunk's oldest sample (trails.glsl trailSeg, less
   * its cell term, which the shader adds) and 1 px for rounding; a chunk past
   * the last segment is empty. trailBox is their union, empty with no segments.
   */
  writeTrail(out: Float32Array, base: number, t: number): number {
    const cap = TRAIL_N - 1;
    const life = this.variety.trailTime;
    const [x, y] = this.trailPoint();
    out[base] = x;
    out[base + 1] = y;
    out[base + 2] = 0;
    out[base + 3] = 0;
    let n = 1;
    for (let k = 0; k < this.trailLen; k++) {
      const idx = (this.trailHead - 1 - k + cap) % cap;
      const age = (t - this.trail[idx * 3 + 2]) / life;
      const o = base + n * 4;
      out[o] = this.trail[idx * 3];
      out[o + 1] = this.trail[idx * 3 + 1];
      out[o + 2] = Math.min(age, 1);
      out[o + 3] = 0;
      n++;
      if (age >= TRAIL_CUT) break;
    }
    const boxes = this.trailChunks;
    const w0 = this.variety.trailWidth * this.length;
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (let c = 0; c < TRAIL_CHUNKS; c++) {
      const first = c * TRAIL_CHUNK;
      const last = first + 1 < n ? Math.min(first + TRAIL_CHUNK, n - 1) : -1;
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      let maxAge = 0;
      for (let i = first; i <= last; i++) {
        const o = base + i * 4;
        x0 = Math.min(x0, out[o]);
        y0 = Math.min(y0, out[o + 1]);
        x1 = Math.max(x1, out[o]);
        y1 = Math.max(y1, out[o + 1]);
        maxAge = Math.max(maxAge, out[o + 2]);
      }
      const g = last < 0 ? 0 : w0 * (0.5 + 1.4 * maxAge) + 1;
      boxes[c * 4] = x0 - g;
      boxes[c * 4 + 1] = y0 - g;
      boxes[c * 4 + 2] = x1 + g;
      boxes[c * 4 + 3] = y1 + g;
      minX = Math.min(minX, boxes[c * 4]);
      minY = Math.min(minY, boxes[c * 4 + 1]);
      maxX = Math.max(maxX, boxes[c * 4 + 2]);
      maxY = Math.max(maxY, boxes[c * 4 + 3]);
    }
    this.trailBox[0] = minX;
    this.trailBox[1] = minY;
    this.trailBox[2] = maxX;
    this.trailBox[3] = maxY;
    return n;
  }

  private emitRipples(w: World, t: number, cruise: number, L: number, interestDist: number): void {
    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    // A fish swimming just under the surface pushes a faint bow wave.
    const shallow = 1 - this.depth / 0.3;
    if (shallow > 0 && t >= this.nextRipple) {
      this.nextRipple = t + 0.09;
      const k = clamp(this.speed / cruise, 0, 3) * shallow;
      if (k > 0.05) w.drop(this.x + fx * L * 0.04, this.y + fy * L * 0.04, L * 0.07, -0.05 * k);
    }
    // Curious fish nosing the surface at the pointer gulp at it.
    if (interestDist < L * 0.4 && this.depth < 0.12 && t >= this.nextGulp) {
      this.nextGulp = t + this.rng.range(0.6, 1.2);
      w.drop(this.x + fx * L * 0.02, this.y + fy * L * 0.02, L * 0.05, -0.35);
    }
  }
}
