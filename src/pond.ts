import { Koi, type Pointer, type Tap, type World } from './koi/koi';
import {
  FISH_TEXELS,
  J_TOTAL,
  MAX_FISH,
  T_BBOX,
  T_EYE,
  T_FIN,
  T_P0,
  T_P1,
  T_PEC_L,
  T_PEC_R,
  T_TBOX,
  T_TRAIL,
} from './koi/layout';
import { VARIETIES } from './koi/varieties';
import { Rng } from './rng';

export interface Drop {
  x: number;
  y: number;
  /** Radius in world px. */
  r: number;
  /** Height impulse; negative pushes the surface down. */
  a: number;
}

const MAX_PENDING_DROPS = 256;
/** Fixed simulation step (s), so a seed replays the same pond at any frame rate. */
const SIM_DT = 1 / 120;
/** Most simulated time a single frame may catch up on. */
const MAX_CATCH_UP = 0.25;
/** Depth gap past which overlapping fish are re-ordered anyway (see pack()). */
const ORDER_GAP = 0.15;
/** Below this many CSS px the pond is treated as collapsed and keeps its last size. */
export const MIN_POND_PX = 16;

// Pointer wake: impulses spaced along the stroke, stronger with speed.
const STROKE_SPACING = 7;
const WAKE_RADIUS = 12;
const WAKE_MIN = 0.15;
const WAKE_MAX = 0.3;
const WAKE_PER_SPEED = 1 / 4000;

/**
 * Reference length that fish sizes scale with. Leans on the short side but
 * keeps fish from shrinking to nothing on tall phone screens.
 */
export function pondUnit(width: number, height: number): number {
  return Math.max(Math.min(width, height), 0.55 * Math.max(width, height));
}

/** World state in CSS pixels, y pointing down. */
export class Pond implements World {
  width: number;
  height: number;
  unit: number;
  time = 0;
  calm = false;
  readonly fish: Koi[] = [];
  readonly pointer: Pointer = { x: 0, y: 0, inside: false, lastMove: -Infinity, speed: 0, linger: false };
  readonly taps: Tap[] = [];
  /** Ripple impulses waiting for the next simulation step. */
  readonly drops: Drop[] = [];
  /** Fish data texture contents, see koi/layout.ts. */
  readonly data = new Float32Array(MAX_FISH * FISH_TEXELS * 4);
  /** Fish rows in draw order, deepest first. */
  readonly order = new Int32Array(MAX_FISH);

  private orderN = 0;
  private acc = 0;
  private lastPtrStamp = 0;
  private strokeX = 0;
  private strokeY = 0;

  constructor(width: number, height: number, seed: number) {
    this.width = width;
    this.height = height;
    this.unit = pondUnit(width, height);
    const rng = new Rng(seed);
    for (const v of VARIETIES.slice(0, MAX_FISH)) {
      this.fish.push(new Koi(v, Math.floor(rng.next() * 2 ** 32), this));
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    if (width < MIN_POND_PX || height < MIN_POND_PX) return;
    const sx = width / this.width;
    const sy = height / this.height;
    this.width = width;
    this.height = height;
    this.unit = pondUnit(width, height);
    for (const f of this.fish) {
      f.rescale(sx, sy);
      f.confine(width, height, f.length * 0.3);
    }
    for (const d of this.drops) {
      d.x *= sx;
      d.y *= sy;
    }
  }

  drop(x: number, y: number, r: number, a: number): void {
    this.drops.push({ x, y, r, a });
    if (this.drops.length > MAX_PENDING_DROPS) this.drops.splice(0, this.drops.length - MAX_PENDING_DROPS);
  }

  /** `stamp` is the event time in seconds. */
  pointerMove(x: number, y: number, stamp: number): void {
    const p = this.pointer;
    if (!p.inside) {
      this.strokeX = x;
      this.strokeY = y;
    } else {
      const dt = Math.max(stamp - this.lastPtrStamp, 1 / 1000);
      const inst = Math.min(Math.hypot(x - p.x, y - p.y) / dt, 6000);
      p.speed += (inst - p.speed) * 0.5;
    }
    p.x = x;
    p.y = y;
    p.inside = true;
    p.linger = false;
    p.lastMove = this.time;
    this.lastPtrStamp = stamp;

    // Drag a wake behind the pointer: impulses spaced along the stroke.
    const dx = x - this.strokeX;
    const dy = y - this.strokeY;
    const len = Math.hypot(dx, dy);
    if (len >= STROKE_SPACING) {
      const n = Math.min(Math.floor(len / STROKE_SPACING), 8);
      const a = -Math.min(WAKE_MIN + p.speed * WAKE_PER_SPEED, WAKE_MAX);
      for (let k = 1; k <= n; k++) {
        this.drop(this.strokeX + (dx * k) / n, this.strokeY + (dy * k) / n, WAKE_RADIUS, a);
      }
      this.strokeX = x;
      this.strokeY = y;
    }
  }

  pointerDown(x: number, y: number, stamp: number): void {
    this.pointerMove(x, y, stamp);
    this.drop(x, y, 16, -0.9);
    this.taps.push({ x, y, t: this.time });
    if (this.taps.length > 8) this.taps.shift();
  }

  /** The pointer left the pond (a mouse moved off it). */
  pointerLeave(): void {
    this.pointer.inside = false;
    this.pointer.linger = false;
    this.pointer.speed = 0;
  }

  /** A touch or pen lifted: the spot stays interesting, but the next touch starts a new stroke. */
  pointerLift(): void {
    this.pointer.inside = false;
    this.pointer.linger = true;
    this.pointer.speed = 0;
  }

  update(dt: number): void {
    this.acc = Math.min(this.acc + dt, MAX_CATCH_UP);
    while (this.acc >= SIM_DT) {
      this.time += SIM_DT;
      for (const f of this.fish) f.update(SIM_DT, this);
      this.acc -= SIM_DT;
    }
    this.pointer.speed *= Math.exp(-dt * 6);
  }

  /** Packs fish state into `data`/`order`; returns the fish count. */
  pack(): number {
    const d = this.data;
    const n = Math.min(this.fish.length, MAX_FISH);
    for (let f = 0; f < n; f++) {
      const k = this.fish[f];
      const row = f * FISH_TEXELS * 4;
      for (let i = 0; i < J_TOTAL; i++) {
        const o = row + i * 4;
        d[o] = k.joints[i * 3];
        d[o + 1] = k.joints[i * 3 + 1];
        d[o + 2] = k.joints[i * 3 + 2];
        d[o + 3] = 0;
      }
      d.set(k.pecL, row + T_PEC_L * 4);
      d.set(k.pecR, row + T_PEC_R * 4);
      d.set([k.pecRoot, k.pecMax, k.length * k.variety.tailLength, k.variety.tailFork], row + T_FIN * 4);
      d.set(k.eyes, row + T_EYE * 4);
      d.set([k.variety.id, k.patternSeed, k.eyeRadius, k.depth], row + T_P0 * 4);
      d.set(k.bbox, row + T_BBOX * 4);
      const count = k.writeTrail(d, row + T_TRAIL * 4, this.time);
      d.set(k.trailBox, row + T_TBOX * 4);
      d.set([count, k.variety.trailWidth * k.length, 0, 0], row + T_P1 * 4);
    }
    // Deepest first. Two fish normally swap only while their bounds are apart,
    // so one doesn't pop over the other mid-overlap; a clearly deeper fish
    // (gap > ORDER_GAP) is moved under at once rather than stay drawn on top.
    if (this.orderN !== n) {
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.fish[b].depth - this.fish[a].depth);
      this.order.fill(0);
      idx.forEach((f, i) => (this.order[i] = f));
      this.orderN = n;
    }
    const ord = this.order;
    for (let pass = 0; pass < n; pass++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = this.fish[ord[i]];
        const b = this.fish[ord[i + 1]];
        if (a.depth < b.depth && (!overlaps(a.bbox, b.bbox) || b.depth - a.depth > ORDER_GAP)) {
          const tmp = ord[i];
          ord[i] = ord[i + 1];
          ord[i + 1] = tmp;
        }
      }
    }
    return n;
  }
}

function overlaps(a: Float32Array, b: Float32Array): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}
