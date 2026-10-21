// Each variety differs in body shape, fins, gait, temperament and the trace
// it leaves. Lengths are fractions of the pond unit; most other sizes are
// fractions of the fish's own body length.

export const KOHAKU_ID = 0;
export const SHOWA_ID = 1;
export const OGON_ID = 2;

export interface Variety {
  id: number;
  name: string;
  /** Body length (nose to peduncle) as a fraction of the pond unit. */
  length: number;
  /** Max body half-width as a fraction of body length. */
  radius: number;
  /** Caudal fin length as a fraction of body length. */
  tailLength: number;
  /** Caudal half-width at its widest, as a multiple of the max body half-width. */
  tailSpread: number;
  /** Depth of the fork notch, 0..1 of the tail length. */
  tailFork: number;
  /** Max bend per body joint (rad); higher lets the body curl through tighter turns. */
  bodyBend: number;
  /** Max bend per tail joint (rad); higher is floppier and more flowing. */
  tailBend: number;
  /** Pectoral fin length and max half-width as fractions of body length. */
  finLength: number;
  finWidth: number;
  /** Pectoral rest angle away from the body axis (rad). */
  finSweep: number;
  /** How quickly the pectoral tips follow their target (1/s); low = trailing. */
  finStiffness: number;
  /** Cruise speed in body lengths per second. */
  cruise: number;
  /** Burst speed multiplier; 1 disables bursts. */
  burst: number;
  burstEvery: [number, number];
  burstTime: [number, number];
  /** Max yaw rate (rad/s). */
  turnRate: number;
  /** Tightest turn radius when not in a hurry, in body lengths. */
  minTurnRadius: number;
  wanderFreq: number;
  /** Wander heading offset (rad). */
  wanderAmp: number;
  /** Tail beats per second at cruise. */
  beatFreq: number;
  /** Lateral tail amplitude as a fraction of body length. */
  beatAmp: number;
  /** Body waves along the length. */
  waveK: number;
  /** Attraction to the pointer, 0..1. */
  curiosity: number;
  /** How long (s) the pointer stays interesting after it last moved. */
  attention: number;
  /** Distance kept from the pointer, in body lengths; 0 swims right up to it. */
  standOff: number;
  /** Startle response to taps and fast pointer motion, 0..1. */
  skittish: number;
  /** Picks its own points of interest and goes to inspect them. */
  roams: boolean;
  depth: [number, number];
  depthFreq: number;
  /** Trail lifetime (s) and width (fraction of body length). */
  trailTime: number;
  trailWidth: number;
}

/** Big white body with red patches: slow, graceful, long silky trail. */
export const KOHAKU: Variety = {
  id: KOHAKU_ID,
  name: 'kohaku',
  length: 0.36,
  radius: 0.118,
  tailLength: 0.3,
  tailSpread: 0.95,
  tailFork: 0.42,
  bodyBend: 0.13,
  tailBend: 0.3,
  finLength: 0.19,
  finWidth: 0.055,
  finSweep: 1.0,
  finStiffness: 10,
  cruise: 0.22,
  burst: 1,
  burstEvery: [0, 0],
  burstTime: [0, 0],
  turnRate: 0.8,
  minTurnRadius: 0.75,
  wanderFreq: 0.09,
  wanderAmp: 0.4,
  beatFreq: 0.9,
  beatAmp: 0.085,
  waveK: 0.85,
  curiosity: 0.3,
  attention: 4,
  standOff: 0.6,
  skittish: 0.15,
  roams: false,
  depth: [0.25, 0.55],
  depthFreq: 0.05,
  trailTime: 4.5,
  trailWidth: 0.05,
};

/** Black with red and white: small, compact, darting bursts, shy, bubbly trail. */
export const SHOWA: Variety = {
  id: SHOWA_ID,
  name: 'showa',
  length: 0.25,
  radius: 0.125,
  tailLength: 0.26,
  tailSpread: 0.9,
  tailFork: 0.5,
  bodyBend: 0.2,
  tailBend: 0.24,
  finLength: 0.2,
  finWidth: 0.062,
  finSweep: 1.0,
  finStiffness: 16,
  cruise: 0.7,
  burst: 3.4,
  burstEvery: [1.8, 4.5],
  burstTime: [0.35, 0.6],
  turnRate: 3.4,
  minTurnRadius: 0.3,
  wanderFreq: 0.32,
  wanderAmp: 0.75,
  beatFreq: 2,
  beatAmp: 0.09,
  waveK: 0.95,
  curiosity: 0.45,
  attention: 5,
  standOff: 1.1,
  skittish: 1,
  roams: false,
  depth: [0.05, 0.6],
  depthFreq: 0.13,
  trailTime: 1.1,
  trailWidth: 0.07,
};

/** Metallic gold butterfly koi: long flowing fins, curious, sparkling trail. */
export const OGON: Variety = {
  id: OGON_ID,
  name: 'ogon',
  length: 0.29,
  radius: 0.1,
  tailLength: 0.52,
  tailSpread: 1.3,
  tailFork: 0.32,
  bodyBend: 0.13,
  tailBend: 0.5,
  finLength: 0.27,
  finWidth: 0.06,
  finSweep: 0.95,
  finStiffness: 4,
  cruise: 0.42,
  burst: 1,
  burstEvery: [0, 0],
  burstTime: [0, 0],
  turnRate: 1.7,
  minTurnRadius: 0.6,
  wanderFreq: 0.18,
  wanderAmp: 0.5,
  beatFreq: 1.3,
  beatAmp: 0.08,
  waveK: 0.9,
  curiosity: 1,
  attention: 20,
  standOff: 0,
  skittish: 0,
  roams: true,
  depth: [0.08, 0.35],
  depthFreq: 0.08,
  trailTime: 1.8,
  trailWidth: 0.055,
};

export const VARIETIES: readonly Variety[] = [KOHAKU, SHOWA, OGON];

/** `#define V_<NAME> <id>` for each variety, so shaders share the ids. */
export function varietyDefines(): string {
  return VARIETIES.map((v) => `#define V_${v.name.toUpperCase()} ${v.id}\n`).join('');
}
