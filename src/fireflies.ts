// Fireflies (the `fireflies` sky feature): simulated here on the CPU, drawn
// by the renderer as one point per firefly over the scene pass (D9). They
// drift and blink only; nothing they do reacts to the fish or the pointer.
import { smooth } from './lighting';
import { Rng } from './rng';

export const FIREFLY_COUNT = 14;

/**
 * Packed state, one vec4 per firefly (`Fireflies.data`, the renderer's
 * vertex buffer, `aFly` in fly.vert):
 *
 *   x, y   position in CSS px, y down (the pond's world space)
 *   z      flash, 0 dark … 1 full: the blink pulse, or the breath when calm
 *   w      the firefly's own seed in [0, 1), constant
 *
 * Kept to one vec4 so a later GPU update pass could take the simulation over.
 */
export const FIREFLY_FLOATS = 4;

/** Drift amplitude as a share of the pond's shorter side; the paths reach 1.5× this. */
const SPAN = 0.07;
/** Room left between the farthest drift and the pond's edge, as a share of the shorter side. */
const EDGE = 0.03;
/** Drift speed under reduced motion. */
const CALM_DRIFT = 0.35;
/** Seconds between blinks: 3 … 6. */
const PERIOD_MIN = 3;
const PERIOD_SPREAD = 3;
/** Breathing under reduced motion: flash 0.55 ± 0.35 at this rate (rad/s). */
const BREATH_RATE = 0.5;
/** Mixed into the pond's seed, so the fish draw the same numbers as without fireflies. */
const SEED_SALT = 0x5f1ef1e5;

interface Fly {
  /** Home position as a share of the room inside the margins. */
  hx: number;
  hy: number;
  /** Drift rates (rad per drift second) and phases of the two terms on each axis. */
  rx: number;
  ry: number;
  px: number;
  py: number;
  qx: number;
  qy: number;
  /** Seconds per blink, and where in its cycle the blink is (0 … 1). */
  period: number;
  blink: number;
  breath: number;
  seed: number;
}

/** A short pulse at the start of each blink cycle: up fast, fading over a third of it. */
function pulse(cycle: number): number {
  return smooth(0, 0.06, cycle) * (1 - smooth(0.1, 0.5, cycle));
}

export class Fireflies {
  /** See FIREFLY_FLOATS for the layout; filled by pack(). */
  readonly data = new Float32Array(FIREFLY_COUNT * FIREFLY_FLOATS);

  private readonly flies: Fly[] = [];
  /** Drift time: runs at CALM_DRIFT under reduced motion, so the paths only slow down. */
  private drift = 0;
  private time = 0;
  private calm = false;

  constructor(seed: number) {
    const rng = new Rng((seed ^ SEED_SALT) >>> 0);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      this.flies.push({
        hx: rng.next(),
        hy: rng.next(),
        rx: 0.21 * (0.7 + rng.next()),
        ry: 0.17 * (0.7 + rng.next()),
        px: rng.next() * Math.PI * 2,
        py: rng.next() * Math.PI * 2,
        qx: rng.next() * Math.PI * 2,
        qy: rng.next() * Math.PI * 2,
        period: PERIOD_MIN + PERIOD_SPREAD * rng.next(),
        blink: rng.next(),
        breath: rng.next() * Math.PI * 2,
        seed: rng.next(),
      });
    }
  }

  /** Advances by one fixed step of `dt` seconds. */
  step(dt: number, calm: boolean): void {
    this.calm = calm;
    this.time += dt;
    this.drift += dt * (calm ? CALM_DRIFT : 1);
    for (const f of this.flies) f.blink = (f.blink + dt / f.period) % 1;
  }

  /** Writes the state for a `width` × `height` pond into `data` and returns it. */
  pack(width: number, height: number): Float32Array {
    const span = SPAN * Math.min(width, height);
    // Homes keep 1.5 spans plus EDGE from each edge, so no path leaves the pond.
    const margin = 1.5 * span + EDGE * Math.min(width, height);
    const t = this.drift;
    const d = this.data;
    this.flies.forEach((f, i) => {
      const o = i * FIREFLY_FLOATS;
      d[o] = margin + f.hx * (width - 2 * margin) + span * (Math.sin(t * f.rx + f.px) + 0.5 * Math.sin(t * 0.53 + f.qx));
      d[o + 1] = margin + f.hy * (height - 2 * margin) + span * (Math.cos(t * f.ry + f.py) + 0.5 * Math.sin(t * 0.41 + f.qy));
      d[o + 2] = this.calm ? 0.55 + 0.35 * Math.sin(this.time * BREATH_RATE + f.breath) : pulse(f.blink);
      d[o + 3] = f.seed;
    });
    return d;
  }
}
