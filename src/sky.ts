import type { KoiPondTime } from './index';

/** Loop length when none (or an invalid one) is given, in seconds. */
export const DEFAULT_CYCLE_S = 600;
/** Accepted loop lengths; outside this the default is used. */
export const MIN_CYCLE_S = 1;
export const MAX_CYCLE_S = 86_400;

/** Wraps any number into [0, 1). */
export function wrapPhase(p: number): number {
  return p - Math.floor(p);
}

/**
 * Supplies the time of day as a phase in [0, 1): 0 midnight, 0.25 sunrise,
 * 0.5 noon, 0.75 sunset. The lighting only ever sees the phase, so a new
 * source only has to implement this.
 */
export interface TimeSource {
  readonly kind: string;
  /** Advances by dt seconds of rendered time and returns the current phase. */
  tick(dt: number): number;
  /** Moves the source to a phase, if it can be moved (a real clock can't). */
  seek?(phase: number): void;
}

/** Stays at whatever phase it was last set to. */
export class FixedSource implements TimeSource {
  readonly kind = 'fixed';
  private phase: number;

  constructor(phase: number) {
    this.phase = wrapPhase(phase);
  }

  tick(): number {
    return this.phase;
  }

  seek(phase: number): void {
    this.phase = wrapPhase(phase);
  }
}

/** Runs through a whole day every `cycle` seconds. */
export class LoopSource implements TimeSource {
  readonly kind = 'loop';
  private phase: number;
  private cycleS: number;

  constructor(cycle: number, phase: number) {
    this.cycleS = validCycle(cycle) ?? DEFAULT_CYCLE_S;
    this.phase = wrapPhase(phase);
  }

  get cycle(): number {
    return this.cycleS;
  }

  /** Ignores lengths outside [MIN_CYCLE_S, MAX_CYCLE_S]; keeps the phase. */
  set cycle(s: number) {
    this.cycleS = validCycle(s) ?? this.cycleS;
  }

  tick(dt: number): number {
    this.phase = wrapPhase(this.phase + dt / this.cycleS);
    return this.phase;
  }

  seek(phase: number): void {
    this.phase = wrapPhase(phase);
  }
}

/**
 * The visitor's local time of day: 06:00 is 0.25 (sunrise), 18:00 is 0.75
 * (sunset). Fixed hours, no latitude; rendered time and seeks are ignored.
 */
export class ClockSource implements TimeSource {
  readonly kind = 'clock';

  constructor(private now: () => Date = () => new Date()) {}

  tick(): number {
    const d = this.now();
    const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3_600_000;
    return wrapPhase(hours / 24);
  }
}

/**
 * The pond's clock: a time source plus a manual override. While the overlay
 * slider is held the phase follows it; on release the source continues from
 * there (a loop resumes from the released phase, a slider stays put).
 */
export class Sky {
  /** Phase used for the current frame. */
  phase: number;
  private held: number | null = null;
  private src: TimeSource;

  constructor(source: TimeSource) {
    this.src = source;
    this.phase = source.tick(0);
  }

  get source(): TimeSource {
    return this.src;
  }

  /** Swaps the source (setTime); a held phase still wins until release. */
  setSource(source: TimeSource): void {
    this.src = source;
    this.phase = this.held ?? source.tick(0);
  }

  get holding(): boolean {
    return this.held !== null;
  }

  /** Call once per rendered frame with unscaled dt; returns the phase. */
  update(dt: number): number {
    this.phase = this.held ?? this.source.tick(dt);
    return this.phase;
  }

  /** Takes over from the source (slider drag); applies immediately. */
  hold(phase: number): void {
    this.held = wrapPhase(phase);
    this.phase = this.held;
  }

  release(): void {
    if (this.held === null) return;
    this.source.seek?.(this.held);
    this.held = null;
  }
}

function validCycle(s: number): number | null {
  return Number.isFinite(s) && s >= MIN_CYCLE_S && s <= MAX_CYCLE_S ? s : null;
}

/** A phase in [0, 1] (1 wraps to 0), or null for anything else. */
function validPhase(p: unknown): number | null {
  return typeof p === 'number' && p >= 0 && p <= 1 ? wrapPhase(p) : null;
}

/**
 * Turns a `time` option into a source. Never throws: an unknown mode is a
 * loop, a cycle outside [MIN_CYCLE_S, MAX_CYCLE_S] is DEFAULT_CYCLE_S and a
 * phase outside [0, 1] is 0. A loop without a phase starts from `current`,
 * so switching to it carries on from the phase on screen.
 */
export function timeSource(time: KoiPondTime | undefined, current: number): TimeSource {
  const t = (time ?? {}) as Partial<{ mode: string; cycle: unknown; phase: unknown }>;
  if (t.mode === 'clock') return new ClockSource();
  if (t.mode === 'fixed') return new FixedSource(validPhase(t.phase) ?? 0);
  const phase = t.phase === undefined ? current : (validPhase(t.phase) ?? 0);
  return new LoopSource(typeof t.cycle === 'number' ? t.cycle : NaN, phase);
}
