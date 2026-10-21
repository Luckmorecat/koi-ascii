import { DAY_PARTS, dayPartAt, type DayPart } from './lighting';
import { LoopSource, MAX_CYCLE_S, MIN_CYCLE_S, type Sky } from './sky';

/** Frames kept for the graph and the 1 % low. */
const HISTORY = 240;
/** Graph ceiling in ms; slower frames are clipped to the top. */
const GRAPH_MS = 50;
/** Text refresh interval, so the readout is legible and doesn't churn layout. */
const TEXT_MS = 250;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * Measures GPU time with EXT_disjoint_timer_query_webgl2. Results arrive a
 * few frames late, so queries are kept in flight and drained each frame.
 */
class GpuTimer {
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Latest smoothed GPU time in ms, or NaN until a result lands. */
  ms = NaN;

  private constructor(
    private gl: WebGL2RenderingContext,
    private ext: TimerExt,
  ) {}

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    // Don't pile up queries if the driver stops answering.
    if (this.active || this.pending.length > 8) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll(): void {
    const gl = this.gl;
    // A disjoint event (clock change, power state) invalidates everything in flight.
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        this.ms = Number.isNaN(this.ms) ? ms : this.ms + (ms - this.ms) * 0.1;
      }
      gl.deleteQuery(q);
    }
  }
}

/** Phase as a clock time, 0 → 00:00, 0.5 → 12:00. */
function clock(phase: number): string {
  const m = Math.floor(phase * 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Time-of-day controls: phase slider, loop length and phase readout. Only
 * this row takes pointer events; the rest of the overlay stays click-through.
 * It sits outside the canvas, so using it never reaches the pond's listeners.
 */
class SkyControls {
  readonly root: HTMLDivElement;
  private slider: HTMLInputElement;
  private readout: HTMLDivElement;
  private ticks: HTMLButtonElement[];
  private part: DayPart | null = null;

  constructor(private sky: Sky) {
    this.root = document.createElement('div');
    this.root.className = 'sky';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1';
    this.slider.step = '0.001';
    this.slider.setAttribute('aria-label', 'Time of day');
    // Hold the phase while dragging, hand it back to the source on release.
    // 'change' covers key steps, but a drag that ends where it started fires
    // no 'change', so pointer release and blur also let go (release() is a
    // no-op when nothing is held).
    this.slider.addEventListener('input', () => {
      sky.hold(Number(this.slider.value));
      this.sync();
    });
    this.slider.addEventListener('change', () => sky.release());
    this.slider.addEventListener('pointerup', () => sky.release());
    // Also fires after pointercancel, when the browser takes the drag away.
    this.slider.addEventListener('lostpointercapture', () => sky.release());
    this.slider.addEventListener('blur', () => sky.release());
    // Keep the drag's pointer events on the slider even when it strays over
    // the canvas, so dragging never steers the fish.
    this.slider.addEventListener('pointerdown', (e) => this.slider.setPointerCapture(e.pointerId));

    const cycle = document.createElement('input');
    cycle.type = 'number';
    cycle.min = String(MIN_CYCLE_S);
    cycle.max = String(MAX_CYCLE_S);
    cycle.step = '10';
    cycle.setAttribute('aria-label', 'Day length in seconds');
    const loop = sky.source instanceof LoopSource ? sky.source : null;
    if (loop) {
      cycle.value = String(loop.cycle);
      cycle.addEventListener('change', () => {
        loop.cycle = Number(cycle.value);
        cycle.value = String(loop.cycle);
      });
    } else {
      cycle.disabled = true;
      cycle.title = 'Only a looping sky has a day length (?sky=loop)';
    }

    // One tick per lighting keyframe, under the slider; clicking one jumps
    // there (a loop carries on from it).
    const ticks = document.createElement('div');
    ticks.className = 'ticks';
    this.ticks = DAY_PARTS.map((part) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.textContent = part.name === 'noon' ? '12' : part.name === 'afternoon' ? 'a' : part.name[0];
      tick.title = `${part.name}  ${part.at.toFixed(3)}  ${clock(part.at)}`;
      tick.setAttribute('aria-label', `Jump to ${part.name} (${clock(part.at)})`);
      tick.style.left = `${part.at * 100}%`;
      tick.addEventListener('click', () => {
        sky.hold(part.at);
        sky.release();
        this.sync();
      });
      ticks.append(tick);
      return tick;
    });
    const track = document.createElement('div');
    track.className = 'track';
    track.append(this.slider, ticks);

    this.readout = document.createElement('div');
    // A div, not a label: clicking a tick must not also activate the slider.
    const phaseRow = document.createElement('div');
    phaseRow.className = 'row';
    phaseRow.append('phase ', track);
    const cycleRow = document.createElement('label');
    cycleRow.append('day ', cycle, ' s');
    this.root.append(phaseRow, cycleRow, this.readout);
    this.sync();
  }

  /** Mirrors the current phase into the slider, ticks and readout. */
  sync(): void {
    const phase = this.sky.phase;
    if (!this.sky.holding) this.slider.value = String(phase);
    const part = dayPartAt(phase);
    if (part !== this.part) {
      this.part = part;
      this.ticks.forEach((t, i) => t.classList.toggle('on', DAY_PARTS[i] === part));
    }
    this.readout.textContent = `${phase.toFixed(3)} ${clock(phase)} ${part.name} · ${this.sky.source.kind}`;
  }
}

/**
 * On-screen FPS / frame-time overlay: rolling FPS, 1 % low, CPU submit time,
 * GPU time (where the timer extension exists), a frame-time graph and the
 * time-of-day controls.
 */
export class PerfMonitor {
  private root: HTMLDivElement;
  private text: HTMLPreElement;
  private graph: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frames = new Float32Array(HISTORY);
  private head = 0;
  private filled = 0;
  private cpuMs = 0;
  private lastText = 0;
  private gpu: GpuTimer | null = null;
  private sky: SkyControls;

  constructor(
    private gl: WebGL2RenderingContext,
    private info: { gpu: string; software: boolean; seed: number },
    sky: Sky,
    visible: boolean,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'perf';
    this.root.hidden = !visible;
    this.text = document.createElement('pre');
    this.graph = document.createElement('canvas');
    this.graph.width = HISTORY;
    this.graph.height = 48;
    this.ctx = this.graph.getContext('2d')!;
    this.sky = new SkyControls(sky);
    this.root.append(this.text, this.graph, this.sky.root);
    document.body.append(this.root);
    this.resetGpu();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  /** Query objects die with the context; call after it is restored. */
  resetGpu(): void {
    this.gpu = GpuTimer.create(this.gl);
  }

  /** Brackets the GPU work of one frame. */
  begin(): void {
    if (this.visible) this.gpu?.begin();
  }

  end(cpuMs: number): void {
    if (!this.visible) return;
    this.gpu?.end();
    this.cpuMs += (cpuMs - this.cpuMs) * 0.05;
  }

  /** Records the interval since the previous frame, in ms. */
  frame(intervalMs: number, now: number): void {
    if (!this.visible) return;
    this.gpu?.poll();
    this.frames[this.head] = intervalMs;
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(this.filled + 1, HISTORY);
    this.drawGraph();
    if (now - this.lastText >= TEXT_MS) {
      this.lastText = now;
      this.drawText();
      this.sky.sync();
    }
  }

  private drawText(): void {
    const n = this.filled;
    if (!n) return;
    const recent = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b);
    const mean = recent.reduce((s, v) => s + v, 0) / n;
    // 1 % low: the FPS of the slowest 1 % of frames.
    const worst = recent.slice(Math.floor(n * 0.99));
    const low = worst.reduce((s, v) => s + v, 0) / worst.length;
    const gpuMs = this.gpu ? this.gpu.ms : NaN;
    const { width, height } = this.gl.canvas;
    this.text.textContent = [
      `${(1000 / mean).toFixed(0).padStart(3)} fps   1% low ${(1000 / low).toFixed(0)}`,
      `frame ${mean.toFixed(2)} ms  max ${recent[n - 1].toFixed(1)}`,
      `cpu   ${this.cpuMs.toFixed(2)} ms`,
      `gpu   ${this.gpu ? (Number.isNaN(gpuMs) ? '…' : `${gpuMs.toFixed(2)} ms`) : 'n/a'}`,
      `${width}×${height}${this.info.software ? '  (software)' : ''}`,
      this.info.gpu,
      `seed ${this.info.seed}`,
    ].join('\n');
  }

  private drawGraph(): void {
    const { ctx, graph } = this;
    const w = graph.width;
    const h = graph.height;
    const y = (ms: number) => h - Math.min(ms / GRAPH_MS, 1) * h;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < this.filled; i++) {
      const ms = this.frames[(this.head - this.filled + i + HISTORY) % HISTORY];
      ctx.fillStyle = ms > 33.4 ? '#e5484d' : ms > 17.5 ? '#f0b429' : '#4cc38a';
      const top = y(ms);
      ctx.fillRect(w - this.filled + i, top, 1, h - top);
    }
    // 60 and 30 fps reference lines.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, Math.round(y(1000 / 60)), w, 1);
    ctx.fillRect(0, Math.round(y(1000 / 30)), w, 1);
  }
}
