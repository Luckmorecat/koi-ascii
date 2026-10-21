// Frame timing for the debug API: rolling FPS, 1 % low, CPU submit time and
// GPU time where the timer extension exists. Recorded every drawn frame while
// ?debug is on, whether or not the panel shows it.

/** Frames kept for the 1 % low (and the panel's graph). */
export const HISTORY = 240;

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

export interface PerfSnapshot {
  /** Mean over the recorded frames; 0 before any frame. */
  fps: number;
  /** FPS of the slowest 1 % of the recorded frames. */
  low1Fps: number;
  frameMs: number;
  maxFrameMs: number;
  cpuMs: number;
  /** Null without the timer extension, or until its first result lands. */
  gpuMs: number | null;
  gpuTimer: boolean;
  /** Frames the figures above are taken over (up to HISTORY). */
  samples: number;
}

export class PerfRecorder {
  private frames = new Float32Array(HISTORY);
  private head = 0;
  private filled = 0;
  private cpuMs = 0;
  private gpu: GpuTimer | null = null;

  /** A new pond, or its context restored: query objects die with the context. */
  attach(gl: WebGL2RenderingContext): void {
    this.gpu = GpuTimer.create(gl);
    this.head = 0;
    this.filled = 0;
    this.cpuMs = 0;
  }

  /** Records the interval since the previous frame, in ms. */
  frame(intervalMs: number): void {
    this.gpu?.poll();
    this.frames[this.head] = intervalMs;
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(this.filled + 1, HISTORY);
  }

  /** Brackets the GPU work of one frame. */
  begin(): void {
    this.gpu?.begin();
  }

  end(cpuMs: number): void {
    this.gpu?.end();
    this.cpuMs += (cpuMs - this.cpuMs) * 0.05;
  }

  snapshot(): PerfSnapshot {
    const n = this.filled;
    const gpuMs = this.gpu && !Number.isNaN(this.gpu.ms) ? this.gpu.ms : null;
    const base = { cpuMs: this.cpuMs, gpuMs, gpuTimer: !!this.gpu, samples: n };
    if (!n) return { fps: 0, low1Fps: 0, frameMs: 0, maxFrameMs: 0, ...base };
    const recent = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b);
    const mean = recent.reduce((s, v) => s + v, 0) / n;
    const worst = recent.slice(Math.floor(n * 0.99));
    const low = worst.reduce((s, v) => s + v, 0) / worst.length;
    return { fps: 1000 / mean, low1Fps: 1000 / low, frameMs: mean, maxFrameMs: recent[n - 1], ...base };
  }
}
