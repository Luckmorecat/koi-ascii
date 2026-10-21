/** Loop length when the URL gives none (or an invalid one), in seconds. */
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
 * source (e.g. the real local clock) only has to implement this.
 */
export interface TimeSource {
  readonly kind: string;
  /** Advances by dt seconds of rendered time and returns the current phase. */
  tick(dt: number): number;
  /** Moves the source to a phase, if it can be moved (a real clock can't). */
  seek?(phase: number): void;
}

/** Stays at whatever phase it was last set to. */
export class SliderSource implements TimeSource {
  readonly kind = 'slider';
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
 * The pond's clock: a time source plus a manual override. While the overlay
 * slider is held the phase follows it; on release the source continues from
 * there (a loop resumes from the released phase, a slider stays put).
 */
export class Sky {
  /** Phase used for the current frame. */
  phase: number;
  private held: number | null = null;

  constructor(readonly source: TimeSource) {
    this.phase = source.tick(0);
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

/** Number param, or NaN when missing or blank (Number('') would be 0). */
function num(params: URLSearchParams, key: string): number {
  const v = params.get(key);
  return v === null || v.trim() === '' ? NaN : Number(v);
}

/**
 * `?sky=slider&phase=0.8` starts paused at 0.8; `?sky=loop&cycle=600` loops
 * every 600 s. Anything missing or invalid falls back to a 600 s loop from
 * midnight (phase 0, so the pond opens dark and brightens).
 */
export function skyFromParams(params: URLSearchParams): Sky {
  const p = num(params, 'phase');
  const phase = p >= 0 && p <= 1 ? wrapPhase(p) : 0;
  if (params.get('sky') === 'slider') return new Sky(new SliderSource(phase));
  return new Sky(new LoopSource(num(params, 'cycle'), phase));
}
