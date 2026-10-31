// window.koi: the demo's debug API. A registry of self-describing tools (an
// MCP-like name / description / inputSchema each) that agents drive through
// browser JS eval and the panel drives through the same calls. The registry
// is the source of truth: koi.tools(), koi.help(), the ergonomic methods, the
// shortcuts and the panel's controls are all generated from it.
import { koiPalettes, type KoiPond, type KoiPondError, type KoiPondPaletteName, type KoiPondTime } from '../../src/index';
import { attachHooks, DAY_PARTS, dayPartAt, LoopSource, MAX_CYCLE_S, MIN_CYCLE_S, type PondCore } from '../../src/internal';
import { SKY_FEATURES, type SkyFeature } from '../../src/sky-features';
import { MAX_SEED, sceneTime, writeScene, type PondLook, type SceneState } from '../scene';
import { PerfRecorder, profileDraws, type PassTiming } from './perf';
import { describeProp, validate, type ObjectSchema } from './schema';

export type ErrorCode = 'unknown-tool' | 'invalid-args' | 'not-ready' | 'context-lost' | 'pond-failed' | 'internal';

export interface ToolError {
  code: ErrorCode;
  message: string;
}

export type CallResult = { ok: true; result: unknown } | { ok: false; error: ToolError };

export type Section = 'perf' | 'time' | 'render' | 'scene' | 'capture' | 'panel';

export interface ToolAnnotations {
  /** Panel section the tool's controls go in. */
  section: Section;
  /** Only reads; calling it changes nothing. */
  readOnly?: boolean;
  /** Each argument applies on its own, so the panel applies controls as they change. */
  live?: boolean;
  /** `getState()[reflects]` holds the current value of each argument, for the panel. */
  reflects?: 'time' | 'render' | 'sky' | 'scene' | 'viewport';
  /** Key (KeyboardEvent.key, any case) and what pressing it does. */
  shortcut?: { key: string; does: string };
}

/** What koi.tools() lists for each tool. */
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: ObjectSchema;
  annotations: ToolAnnotations;
}

export interface ToolDef extends ToolInfo {
  /** What must be up before the tool runs (default 'pond'). */
  needs?: 'nothing' | 'pond' | 'renderer';
  run(args: Record<string, unknown>): unknown;
  /** The args the shortcut calls this tool with (default none), or another tool to call instead. */
  shortcutCall?(): { tool?: string; args?: Record<string, unknown> };
  /** Held keys repeat the shortcut (default: only the first press counts). */
  shortcutRepeats?: boolean;
}

export interface ChangeEvent {
  /** The tool whose call caused it, or null (pond up, context lost or restored). */
  tool: string | null;
  state: DebugState;
}

export interface FrameEvent {
  /** Since the previous frame; for a stepped frame, its dt. */
  intervalMs: number;
  cpuMs: number;
  frame: number;
  /** Drawn by step() rather than the frame loop (getPerf doesn't count those). */
  stepped: boolean;
}

type Events = { change: ChangeEvent; frame: FrameEvent };

export interface DebugState {
  ready: boolean;
  /** Why the pond can't run, or null. */
  failed: string | null;
  contextLost: boolean;
  paused: boolean;
  /** Frames simulated since this pond was mounted. */
  frame: number;
  time: {
    mode: SceneState['time'];
    phase: number;
    /** The loop length in seconds; null unless the time loops. */
    cycle: number | null;
    part: string;
    clock: string;
    /** The phase is held (the panel's slider is being dragged). */
    held: boolean;
  };
  render: {
    view: SceneState['view'];
    glow: boolean;
    glowAvailable: boolean;
    palette: SceneState['palette'];
    intensity: number;
  };
  /** Every sky feature, on or off. */
  sky: Record<SkyFeature, boolean>;
  scene: { seed: number | null; fish: number };
  viewport: { pinned: boolean; width: number; height: number; dpr: number };
  /** Drawing buffer size in device px. */
  canvas: { width: number; height: number };
}

/** A tool's own refusal; call() turns it into `{ ok: false, error }`. */
export class ToolFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const invalid = (path: string, why: string) => new ToolFailure('invalid-args', `${path}: ${why}`);
/** The tools that change state yet may run during koi.profile: they don't change what it measures. */
const WHILE_PROFILING = new Set(['pause', 'resume', 'setPanel']);
const NO_ARGS: ObjectSchema = { type: 'object', properties: {}, additionalProperties: false };

/** Phase as a clock time, 0 → 00:00, 0.5 → 12:00. */
export function clock(phase: number): string {
  const m = Math.floor(phase * 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Day parts by id. The lighting reuses names (a blue and a golden hour each
 * side of the day), so repeats get -am / -pm.
 */
export const DAY_PART_IDS: readonly { id: string; at: number; name: string }[] = DAY_PARTS.map((part) => {
  const slug = part.name.replace(/\s+/g, '-');
  const repeats = DAY_PARTS.filter((p) => p.name === part.name).length > 1;
  return { id: repeats ? `${slug}-${part.at < 0.5 ? 'am' : 'pm'}` : slug, at: part.at, name: part.name };
});

const round = (v: number, digits = 4) => Number(v.toFixed(digits));

/** Mounts a pond; supplied by the page so both share one set of options. */
export type MountPond = (seed: number, time: KoiPondTime, look: PondLook, onError: (error: KoiPondError) => void) => KoiPond;

const PALETTE_NAMES = Object.keys(koiPalettes) as KoiPondPaletteName[];

interface Mount {
  handle: KoiPond;
  core: PondCore | null;
  error: KoiPondError | null;
  ready: Promise<void>;
  /** Rejects `ready` if it is still pending (a no-op once settled). */
  abandon(e: ToolError): void;
}

/** A random seed, as the library would pick one. */
const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;

export interface KoiApi {
  /** Every tool with its name, description, inputSchema and annotations. */
  tools(): ToolInfo[];
  /** Runs a tool. Always resolves: `{ ok: true, result }` or `{ ok: false, error: { code, message } }`. */
  call(name: string, args?: unknown): Promise<CallResult>;
  /** Readable list of every tool, its arguments and shortcut. */
  help(): string;
  /**
   * Resolves once the current pond is up. Rejects with a `{ code, message }` error: 'pond-failed' if it
   * can't start, 'not-ready' if a reseed replaced it before it was up. Each reseed gives a new promise.
   */
  readonly ready: Promise<void>;
  /** 'change' after any call that changes state; 'frame' per drawn frame. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, fn: (e: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, fn: (e: Events[K]) => void): void;
  /** Adds a tool (the panel adds its own). */
  register(def: ToolDef): void;
  /** Runs the tool whose shortcut is `key`; true if one did. */
  shortcut(key: string, repeat: boolean): boolean;
  /** Generated: koi.<tool>(args) resolves to the result and rejects with the error object. */
  [tool: string]: unknown;
}

export interface ApiOptions {
  container: HTMLElement;
  scene: SceneState;
  mount: MountPond;
}

export function createApi({ container, scene: initial, mount }: ApiOptions): KoiApi {
  const scene: SceneState = { ...initial };
  const registry = new Map<string, ToolDef>();
  const listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = { change: new Set(), frame: new Set() };
  const perf = new PerfRecorder();
  let paused = false;
  let profiling = false;
  /** Zone outlines (showAvoid); a debug view, so not saved in the URL. */
  let showAvoid = false;
  let viewport: { width?: number; height?: number; dpr?: number } | null = null;
  let current: Mount;
  let interval = 0;

  const emit = <K extends keyof Events>(event: K, e: Events[K]) => {
    for (const fn of listeners[event]) {
      // One listener's bug must not stop the others or the call that emitted.
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const changed = (tool: string | null) => {
    if (listeners.change.size) emit('change', { tool, state: state() });
  };

  /** The URL carries the scene, so a reload (or a shared link) shows the same pond. */
  // A held phase never reaches scene.phase until release, so writing while
  // held keeps the last set phase and still records any other change.
  const writeUrl = () => {
    const search = writeScene(location.search, scene);
    if (search !== location.search) history.replaceState(history.state, '', location.pathname + search + location.hash);
  };

  const applyRender = (core: PondCore) => {
    const r = core.renderer;
    if (!r) return;
    r.raw = scene.view === 'raw';
    r.glow = scene.glow;
    r.showAvoid = showAvoid;
  };

  const mountPond = (seed: number): Mount => {
    let resolve!: () => void;
    let reject!: (e: ToolError) => void;
    const ready = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Nobody may be waiting on it; that must not count as an unhandled rejection.
    ready.catch(() => {});
    const m: Mount = { handle: null as unknown as KoiPond, core: null, error: null, ready, abandon: reject };
    current = m;
    // The look goes in at mount, so a reseed keeps it.
    m.handle = mount(seed, sceneTime(scene), { palette: scene.palette, intensity: scene.intensity, sky: scene.sky }, (error) => {
      m.error = error;
      reject({ code: 'pond-failed', message: error.message });
      if (m === current) changed(null);
    });
    // Paused across a reseed: the new pond never runs a frame of its own.
    if (paused) m.handle.pause();
    attachHooks(m.handle, {
      ready: (core) => {
        m.core = core;
        perf.attach(core.gl);
        applyRender(core);
        if (viewport?.dpr) core.setDpr(viewport.dpr);
        resolve();
        if (m === current) changed(null);
      },
      frame: (ms) => {
        interval = ms;
        perf.frame(ms);
      },
      begin: () => perf.begin(),
      end: (cpuMs) => {
        perf.end(cpuMs);
        if (listeners.frame.size) emit('frame', { intervalMs: interval, cpuMs, frame: m.core?.stats.frames ?? 0, stepped: false });
      },
      lost: () => {
        if (m === current) changed(null);
      },
      restored: () => {
        if (!m.core) return;
        // A new renderer starts with the library defaults.
        perf.attach(m.core.gl);
        applyRender(m.core);
        changed(null);
      },
    });
    return m;
  };

  /**
   * Why a manual draw drew nothing. A draw that throws fails the pond, and
   * onError has already run by the time step()/redraw() return.
   */
  const nothingDrawn = (c: PondCore): ToolFailure => {
    if (current.error) return new ToolFailure('pond-failed', `The pond can't run: ${current.error.message}`);
    if (!c.renderer) return new ToolFailure('context-lost', 'The WebGL context is lost; wait for it to be restored.');
    return new ToolFailure('not-ready', 'Nothing could be drawn: the pond is too small to draw (collapsed container).');
  };

  const core = (needs: ToolDef['needs'] = 'pond'): PondCore => {
    if (current.error) throw new ToolFailure('pond-failed', `The pond can't run: ${current.error.message}`);
    if (!current.core) throw new ToolFailure('not-ready', 'The pond is not up yet; await koi.ready first.');
    if (needs === 'renderer' && !current.core.renderer) {
      throw new ToolFailure('context-lost', 'The WebGL context is lost; wait for it to be restored.');
    }
    return current.core;
  };

  const state = (): DebugState => {
    const c = current.core;
    const phase = c?.sky.phase ?? scene.phase ?? 0;
    const loop = c?.sky.source instanceof LoopSource ? c.sky.source : null;
    const rect = container.getBoundingClientRect();
    const canvas = c?.canvas;
    return {
      ready: !!c && !current.error,
      failed: current.error?.message ?? null,
      // A failed pond drops its renderer too, but it will never be restored.
      contextLost: !!c && !c.renderer && !current.error,
      paused,
      frame: c?.stats.frames ?? 0,
      time: {
        mode: scene.time,
        phase: round(phase),
        cycle: scene.time === 'loop' ? (loop?.cycle ?? scene.cycle) : null,
        part: dayPartAt(phase).name,
        clock: clock(phase),
        held: c?.sky.holding ?? false,
      },
      render: {
        view: scene.view,
        glow: scene.glow,
        glowAvailable: !c?.stats.software,
        palette: scene.palette,
        intensity: scene.intensity,
      },
      sky: { ...scene.sky },
      scene: { seed: c?.stats.seed ?? scene.seed, fish: c?.pond.fish.length ?? 0 },
      viewport: {
        pinned: !!viewport,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        dpr: viewport?.dpr ?? (window.devicePixelRatio || 1),
      },
      canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
    };
  };

  /** Moves the time to `phase` (an explicit set: the URL gets it). */
  const seek = (c: PondCore, phase: number) => {
    if (c.sky.holding) c.sky.release();
    c.sky.hold(phase);
    c.sky.release();
    scene.phase = phase;
  };

  const tools: ToolDef[] = [
    {
      name: 'getState',
      description: 'The whole current state: readiness, pause and frame counter, time, render, sky, seed, viewport and canvas size.',
      inputSchema: NO_ARGS,
      annotations: { section: 'scene', readOnly: true },
      needs: 'nothing',
      run: () => state(),
    },
    {
      name: 'setTime',
      description:
        'Sets the time of day. Phase runs over [0, 1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. ' +
        'loop: a whole day every `cycle` seconds; fixed: stays at `phase`; clock: local time. Omitted args keep ' +
        'their current value. Saved in the URL (in a loop only an explicitly set phase, never the running one).',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['loop', 'fixed', 'clock'], description: 'Time mode.' },
          phase: { type: 'number', minimum: 0, maximum: 1, description: 'Time of day; a loop carries on from it.' },
          cycle: {
            type: 'number',
            minimum: MIN_CYCLE_S,
            maximum: MAX_CYCLE_S,
            description: 'Day length in seconds (loop only).',
          },
          hold: {
            type: 'boolean',
            description:
              'true: hold the phase (at `phase`, or where it is) until a call with hold false, which hands it ' +
              'back to the time mode from there. The panel slider holds while dragged.',
          },
        },
        additionalProperties: false,
      },
      annotations: { section: 'time', live: true, reflects: 'time' },
      run: (args) => {
        const c = core();
        const sky = c.sky;
        const mode = (args.mode as SceneState['time'] | undefined) ?? scene.time;
        const phase = args.phase as number | undefined;
        const cycle = args.cycle as number | undefined;
        if (mode === 'clock' && phase !== undefined) throw invalid('args.phase', 'a clock has no settable phase');
        if (mode === 'clock' && args.hold === true) throw invalid('args.hold', 'a clock has no settable phase');
        if (mode !== 'loop' && cycle !== undefined) throw invalid('args.cycle', 'only a loop has a day length');

        if (args.hold === false && sky.holding) {
          // Released: the held phase counts as set, and the mode carries on from it.
          scene.phase = sky.phase;
          sky.release();
        } else if (args.hold !== true && sky.holding) {
          // Another caller sets the time mid-drag: the last write wins.
          sky.release();
        }

        const modeChanged = mode !== scene.time;
        if (modeChanged || cycle !== undefined || (phase !== undefined && args.hold !== true)) {
          let time: KoiPondTime;
          const at = args.hold === true ? undefined : phase;
          if (mode === 'clock') {
            time = { mode: 'clock' };
            scene.phase = null;
            scene.cycle = null;
          } else if (mode === 'fixed') {
            const p = at ?? sky.phase;
            time = { mode: 'fixed', phase: p };
            scene.phase = p;
            scene.cycle = null;
          } else {
            const loop = sky.source instanceof LoopSource ? sky.source : null;
            const length = cycle ?? loop?.cycle ?? scene.cycle ?? undefined;
            // Switching into a loop starts it from the phase on screen; the URL records that start.
            if (at !== undefined) scene.phase = at;
            else if (modeChanged) scene.phase = sky.phase;
            time = { mode: 'loop', cycle: length, phase: at };
            scene.cycle = cycle ?? (scene.time === 'loop' ? scene.cycle : null);
          }
          scene.time = mode;
          current.handle.setTime(time);
        }
        if (args.hold === true) sky.hold(phase ?? sky.phase);
        writeUrl();
        return state().time;
      },
    },
    {
      name: 'setDayPart',
      description: `Jumps to the start of a part of the day (a lighting keyframe); a loop carries on from there. ${DAY_PART_IDS.map((p) => `${p.id} ${p.at}`).join(', ')}.`,
      inputSchema: {
        type: 'object',
        properties: {
          part: { type: 'string', enum: DAY_PART_IDS.map((p) => p.id), description: 'Part of the day.' },
        },
        required: ['part'],
        additionalProperties: false,
      },
      annotations: { section: 'time' },
      run: (args) => {
        const part = DAY_PART_IDS.find((p) => p.id === args.part)!;
        if (scene.time === 'clock') throw invalid('args.part', "a clock can't be moved; switch the time mode first");
        seek(core(), part.at);
        writeUrl();
        return state().time;
      },
    },
    {
      name: 'getPerf',
      description:
        'Frame timing over the last 240 drawn frames: fps, 1% low fps, frame ms, CPU submit ms, GPU ms (null ' +
        'without EXT_disjoint_timer_query_webgl2 or before its first result), canvas size, GPU string, software ' +
        'flag and seed. Paused or stepped frames are not counted.',
      inputSchema: NO_ARGS,
      annotations: { section: 'perf', readOnly: true },
      run: () => {
        const c = core();
        const p = perf.snapshot();
        return {
          fps: round(p.fps, 1),
          low1Fps: round(p.low1Fps, 1),
          frameMs: round(p.frameMs, 2),
          maxFrameMs: round(p.maxFrameMs, 2),
          cpuMs: round(p.cpuMs, 3),
          gpuMs: p.gpuMs === null ? null : round(p.gpuMs, 3),
          gpuTimer: p.gpuTimer,
          samples: p.samples,
          width: c.canvas.width,
          height: c.canvas.height,
          gpu: c.stats.gpu,
          software: c.stats.software,
          seed: c.stats.seed,
        };
      },
    },
    {
      name: 'profile',
      description:
        'GPU time per pass: pauses, redraws the current frame `frames` times with a timer query around every ' +
        'draw (EXT_disjoint_timer_query_webgl2), then restores the pause state. Returns per pass (scene, glow, ' +
        'ascii, fly …; frame is all of them) the median and p90 GPU µs per frame with n, plus disjoint (a GPU ' +
        'clock event spoiled the run), cells, canvas size, GPU string and cpuMs (mean submit time per redraw). A ' +
        "redraw doesn't advance time, so the ripple sim isn't in it. { gpuTimer: false } without the extension. " +
        'Compare revisions with `npm run perf`.',
      inputSchema: {
        type: 'object',
        properties: {
          frames: { type: 'integer', minimum: 1, maximum: 5000, default: 400, description: 'Timed redraws.' },
        },
        additionalProperties: false,
      },
      annotations: { section: 'perf', readOnly: true },
      needs: 'renderer',
      run: async (args) => {
        const c = core('renderer');
        const r = c.renderer!;
        // The renderer's programs, by field name: sceneProg → scene.
        const names = new Map<WebGLProgram, string>();
        for (const [key, value] of Object.entries(r)) {
          const handle = (value as { handle?: unknown } | null)?.handle;
          if (key.endsWith('Prog') && handle instanceof WebGLProgram) names.set(handle, key.slice(0, -4));
        }
        // Two at once would nest their timer queries and restore each other's drawArrays wrapper.
        if (profiling) throw new ToolFailure('not-ready', 'A profile is already running; await it first.');
        profiling = true;
        current.handle.pause();
        let profile;
        try {
          const redraw = () => {
            // A collapsed container draws nothing: no numbers rather than empty ones.
            if (!c.redraw()) throw nothingDrawn(c);
          };
          profile = await profileDraws(c.gl, names, redraw, (args.frames as number | undefined) ?? 400);
        } finally {
          profiling = false;
          // The pause state as it is now: a pause() or resume() may have come in meanwhile.
          if (!paused && current.core === c) current.handle.resume();
        }
        if (!profile) return { gpuTimer: false };
        if (c.renderer !== r) throw nothingDrawn(c);
        const passes: Record<string, PassTiming> = {};
        for (const [pass, t] of Object.entries(profile.passes)) passes[pass] = { n: t.n, median: round(t.median, 2), p90: round(t.p90, 2) };
        return {
          gpuTimer: true,
          passes,
          disjoint: profile.disjoint,
          cells: { cols: r.cols, rows: r.rows },
          width: c.canvas.width,
          height: c.canvas.height,
          gpu: c.stats.gpu,
          cpuMs: round(profile.cpuMs, 4),
        };
      },
    },
    {
      name: 'setRender',
      description:
        'What the pond draws: view final (the finished frame) or raw (glyphs on the plain background, no ' +
        'lighting grade or glow), and the glow halo on or off. Saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['final', 'raw'], description: 'Final frame or raw glyphs.' },
          glow: { type: 'boolean', description: 'The halo around bright cells (none on software WebGL).' },
        },
        additionalProperties: false,
      },
      annotations: { section: 'render', live: true, reflects: 'render', shortcut: { key: 'r', does: 'toggle the raw view' } },
      shortcutCall: () => ({ args: { view: scene.view === 'raw' ? 'final' : 'raw' } }),
      run: (args) => {
        const c = core();
        if (args.view !== undefined) scene.view = args.view as SceneState['view'];
        if (args.glow !== undefined) scene.glow = args.glow as boolean;
        // Applied again when a lost context comes back.
        applyRender(c);
        writeUrl();
        return state().render;
      },
    },
    {
      name: 'showAvoid',
      description:
        "Outlines the readability zones (the pond's avoid list, ?avoid in the demo) at their padded edge, in " +
        'the debug red; the fade itself is unchanged. No argument toggles. The raw view shows no zones. Not ' +
        'saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: { on: { type: 'boolean', description: 'Outlines on or off; leave out to toggle.' } },
        additionalProperties: false,
      },
      annotations: { section: 'render' },
      run: (args) => {
        const c = core();
        showAvoid = args.on === undefined ? !showAvoid : (args.on as boolean);
        // Applied again when a lost context comes back.
        applyRender(c);
        return { on: showAvoid };
      },
    },
    {
      name: 'setPalette',
      description:
        'Recolours the pond with a koiPalettes preset from the next frame on; the fish carry on. pond is the ' +
        'default look; paper is light. The raw view ignores the palette. Saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: {
          palette: { type: 'string', enum: PALETTE_NAMES, default: 'pond', description: 'Preset name.' },
        },
        required: ['palette'],
        additionalProperties: false,
      },
      annotations: { section: 'render', live: true, reflects: 'render' },
      run: (args) => {
        scene.palette = args.palette as KoiPondPaletteName;
        // Through the handle, which keeps it across a lost context.
        current.handle.setPalette(scene.palette);
        writeUrl();
        return state().render;
      },
    },
    {
      name: 'setIntensity',
      description:
        'How much of the pond shows over its background, linearly: 0 only the background, 1 the full pond. ' +
        '0.2–0.5 suits text on top. Saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: {
          intensity: { type: 'number', minimum: 0, maximum: 1, default: 1, description: '0 background only … 1 full pond.' },
        },
        required: ['intensity'],
        additionalProperties: false,
      },
      annotations: { section: 'render', live: true, reflects: 'render' },
      run: (args) => {
        scene.intensity = args.intensity as number;
        current.handle.setIntensity(scene.intensity);
        writeUrl();
        return state().render;
      },
    },
    {
      name: 'setSky',
      description:
        'Turns night-sky features on or off from the next frame on; the fish carry on. Omitted features keep ' +
        'their current value. Defaults: stars, fireflies and darkNight (darker water at night on dark ' +
        'palettes) on, moon and sun off; all off is the 0.1 pond. Saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: {
          stars: { type: 'boolean', description: 'Reflected stars at night.' },
          fireflies: { type: 'boolean', description: 'Fireflies at dusk.' },
          darkNight: { type: 'boolean', description: 'Darker water and background at night (dark palettes only).' },
          moon: { type: 'boolean', description: "The moon's reflection at night." },
          sun: { type: 'boolean', description: "The sun's glitter by day." },
        },
        additionalProperties: false,
      },
      annotations: { section: 'render', live: true, reflects: 'sky' },
      run: (args) => {
        const next = { ...scene.sky };
        for (const f of SKY_FEATURES) if (args[f] !== undefined) next[f] = args[f] as boolean;
        scene.sky = Object.freeze(next);
        // Through the handle, which keeps it across a lost context.
        current.handle.setSky(scene.sky);
        writeUrl();
        return state().sky;
      },
    },
    {
      name: 'reseed',
      description:
        'Remounts the pond with a new seed (same seed, same fish), as if the URL were loaded afresh: the time ' +
        'restarts from its saved phase. Omit `seed` for a random one. Resolves once the new pond is up; ' +
        'window.koi and its listeners carry over. Saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: { seed: { type: 'integer', minimum: 0, maximum: MAX_SEED, description: 'The new seed.' } },
        additionalProperties: false,
      },
      annotations: { section: 'scene', reflects: 'scene' },
      needs: 'nothing',
      run: async (args) => {
        const seed = (args.seed as number | undefined) ?? randomSeed();
        scene.seed = seed;
        // A pond destroyed before it is up (still loading its font) never calls
        // back, so whoever awaits it (an earlier reseed, koi.ready) is told here.
        current.abandon({ code: 'not-ready', message: 'Superseded by a later reseed before it was up.' });
        // The old pond's held phase dies with it.
        current.handle.destroy();
        const m = mountPond(seed);
        writeUrl();
        changed('reseed');
        try {
          await m.ready;
        } catch (e) {
          const err = e as ToolError;
          throw new ToolFailure(err.code, err.message);
        }
        return state();
      },
    },
    {
      name: 'getFish',
      description: 'Every fish: variety, position (CSS px from the top left), heading (rad), speed, depth, behaviour mode, length.',
      inputSchema: NO_ARGS,
      annotations: { section: 'scene', readOnly: true },
      run: () =>
        core().pond.fish.map((f) => ({
          variety: f.variety.name,
          x: round(f.x, 1),
          y: round(f.y, 1),
          heading: round(f.heading, 3),
          speed: round(f.speed, 1),
          depth: round(f.depth, 3),
          mode: f.mode,
          length: round(f.length, 1),
        })),
    },
    {
      name: 'pause',
      description: 'Stops the frame loop; the last frame stays on screen. step() and capture() still work.',
      inputSchema: NO_ARGS,
      annotations: { section: 'scene', shortcut: { key: ' ', does: 'pause / resume' } },
      needs: 'nothing',
      shortcutCall: () => (paused ? { tool: 'resume' } : {}),
      run: () => {
        paused = true;
        current.handle.pause();
        return { paused, frame: state().frame };
      },
    },
    {
      name: 'resume',
      description: 'Restarts the frame loop after pause() or step(), without catching up on the time spent paused.',
      inputSchema: NO_ARGS,
      annotations: { section: 'scene' },
      needs: 'nothing',
      run: () => {
        paused = false;
        // A running frame loop would draw through the profile's timer queries; it resumes once that ends.
        if (!profiling) current.handle.resume();
        return { paused, frame: state().frame };
      },
    },
    {
      name: 'step',
      description:
        'Pauses (if running), then simulates and draws `frames` frames of `dt` seconds each, synchronously: ' +
        'works in a background tab where animation frames are throttled. Returns the frame counter and phase.',
      inputSchema: {
        type: 'object',
        properties: {
          frames: { type: 'integer', minimum: 1, maximum: 3600, default: 1, description: 'Frames to advance.' },
          dt: { type: 'number', minimum: 0.001, maximum: 0.1, default: 1 / 60, description: 'Seconds per frame.' },
        },
        additionalProperties: false,
      },
      annotations: { section: 'scene', shortcut: { key: '.', does: 'step one frame' } },
      shortcutRepeats: true,
      needs: 'renderer',
      run: (args) => {
        const c = core('renderer');
        const frames = (args.frames as number | undefined) ?? 1;
        const dt = (args.dt as number | undefined) ?? 1 / 60;
        if (!paused) {
          paused = true;
          current.handle.pause();
        }
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          if (!c.step(dt)) throw nothingDrawn(c);
          if (listeners.frame.size) {
            emit('frame', { intervalMs: dt * 1000, cpuMs: performance.now() - t0, frame: c.stats.frames, stepped: true });
          }
        }
        return { frame: c.stats.frames, phase: round(c.sky.phase, 6), time: round(c.pond.time, 6), paused };
      },
    },
    {
      name: 'capture',
      description:
        'Draws the current state again (without advancing it) and returns it as a PNG data URL, with the ' +
        'image size in device px. Works while running, paused or in a background tab.',
      inputSchema: NO_ARGS,
      annotations: { section: 'capture', readOnly: true },
      needs: 'renderer',
      run: () => {
        const c = core('renderer');
        if (!c.redraw()) throw nothingDrawn(c);
        // Same task as the draw, so the buffer hasn't been presented and cleared yet.
        return { dataUrl: c.canvas.toDataURL('image/png'), width: c.canvas.width, height: c.canvas.height };
      },
    },
    {
      name: 'setViewport',
      description:
        'Pins the pond to width × height CSS px (and optionally a device pixel ratio), for reproducible frames ' +
        'and captures. No args: fill the window again at the real pixel ratio. Not saved in the URL.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 16, maximum: 8192, description: 'CSS px.' },
          height: { type: 'integer', minimum: 16, maximum: 8192, description: 'CSS px.' },
          dpr: { type: 'number', minimum: 0.25, maximum: 4, description: 'Device pixel ratio to render at.' },
        },
        additionalProperties: false,
      },
      annotations: { section: 'scene', reflects: 'viewport' },
      run: (args) => {
        const c = core();
        const { width, height, dpr } = args as { width?: number; height?: number; dpr?: number };
        if ((width === undefined) !== (height === undefined)) {
          throw invalid(width === undefined ? 'args.width' : 'args.height', 'width and height go together');
        }
        viewport = width === undefined && dpr === undefined ? null : { width, height, dpr };
        container.style.width = width === undefined ? '' : `${width}px`;
        container.style.height = height === undefined ? '' : `${height}px`;
        // Re-measures now, so a step() right after already draws at the new size.
        c.setDpr(dpr ?? null);
        return state().viewport;
      },
    },
  ];

  const api = {
    tools: (): ToolInfo[] =>
      [...registry.values()].map(({ name, description, inputSchema, annotations }) =>
        structuredClone({ name, description, inputSchema, annotations }),
      ),

    async call(name: string, args?: unknown): Promise<CallResult> {
      // Everything inside the try: odd input (a BigInt, a Proxy with a
      // throwing getter) must still resolve, never reject.
      let ran: ToolDef | null = null;
      try {
        const tool = typeof name === 'string' && registry.has(name) ? registry.get(name)! : null;
        if (!tool) {
          const shown = typeof name === 'string' ? `"${name}"` : String(name);
          return { ok: false, error: { code: 'unknown-tool', message: `No tool ${shown}; koi.tools() lists them.` } };
        }
        const checked = validate(tool.inputSchema, args);
        if (!checked.ok) return { ok: false, error: { code: 'invalid-args', message: checked.message } };
        if (profiling && !tool.annotations.readOnly && !WHILE_PROFILING.has(tool.name)) {
          return { ok: false, error: { code: 'not-ready', message: `A profile is running; call ${tool.name} once it ends.` } };
        }
        if (tool.needs !== 'nothing') core(tool.needs);
        ran = tool;
        const result = await tool.run(checked.value);
        // A plain JSON copy: no live objects, NaN as null.
        return { ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) };
      } catch (err) {
        if (err instanceof ToolFailure) return { ok: false, error: { code: err.code, message: err.message } };
        console.error(err);
        return { ok: false, error: { code: 'internal', message: errorText(err) } };
      } finally {
        // Also after a failure part-way (a step that lost the context after some frames).
        // Guarded on its own: nothing after the result may turn the call into a rejection.
        try {
          if (ran && !ran.annotations.readOnly) changed(ran.name);
        } catch (err) {
          console.error(err);
        }
      }
    },

    help(): string {
      const lines = [
        'window.koi — debug API of the koi pond demo (?debug).',
        '',
        '  await koi.call(name, args)  → { ok: true, result } | { ok: false, error: { code, message } }; never rejects',
        '  await koi.<name>(args)      → result; rejects with the error object',
        '  koi.tools()                 → [{ name, description, inputSchema, annotations }]',
        "  await koi.ready             → the pond is up (a reseed replaces it)",
        "  koi.on('change' | 'frame', fn) → unsubscribe function; koi.off(event, fn)",
        '  error codes: unknown-tool, invalid-args, not-ready, context-lost, pond-failed, internal',
        '',
        'Tools:',
      ];
      for (const t of registry.values()) {
        const key = t.annotations.shortcut;
        lines.push('', `${t.name}(${Object.keys(t.inputSchema.properties).length ? 'args' : ''})${key ? `   [${keyName(key.key)}: ${key.does}]` : ''}`);
        lines.push(`  ${t.description}`);
        for (const [prop, schema] of Object.entries(t.inputSchema.properties)) {
          const req = t.inputSchema.required?.includes(prop) ? '' : '?';
          lines.push(`    ${prop}${req}: ${describeProp(schema)} — ${schema.description}`);
        }
      }
      return lines.join('\n');
    },

    get ready(): Promise<void> {
      return current.ready;
    },

    on<K extends keyof Events>(event: K, fn: (e: Events[K]) => void): () => void {
      listeners[event].add(fn);
      return () => listeners[event].delete(fn);
    },

    off<K extends keyof Events>(event: K, fn: (e: Events[K]) => void): void {
      listeners[event].delete(fn);
    },

    register(def: ToolDef): void {
      if (registry.has(def.name) || def.name in api) throw new Error(`koi: tool name ${def.name} is taken`);
      registry.set(def.name, def);
      // Ergonomic form, generated per tool.
      (api as KoiApi)[def.name] = async (args?: unknown) => {
        const r = await api.call(def.name, args);
        if (r.ok) return r.result;
        throw r.error;
      };
    },

    shortcut(key: string, repeat: boolean): boolean {
      const k = key.toLowerCase();
      for (const t of registry.values()) {
        if (t.annotations.shortcut?.key !== k || (repeat && !t.shortcutRepeats)) continue;
        const { tool = t.name, args } = t.shortcutCall?.() ?? {};
        void api.call(tool, args).then((r) => {
          if (!r.ok) console.warn(`koi: ${tool}:`, r.error.message);
        });
        return true;
      }
      return false;
    },
  };

  for (const t of tools) api.register(t);
  mountPond(scene.seed ?? randomSeed());
  return api as KoiApi;
}

function errorText(err: unknown): string {
  try {
    return String((err as Error)?.message ?? err);
  } catch {
    return 'Unknown error';
  }
}

/** A shortcut key as printed in help and the panel. */
export function keyName(key: string): string {
  return key === ' ' ? 'Space' : key.toUpperCase();
}
