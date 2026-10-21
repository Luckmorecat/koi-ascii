import '@fontsource/jetbrains-mono/latin-600.css';
import './style.css';
import { MIN_POND_PX, Pond } from './pond';
import { Renderer } from './renderer';
import { FONT_WEIGHT } from './glyphs';
import { PerfMonitor } from './perf';

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
/** Backing-store budget (device px) when WebGL runs on a CPU rasteriser. */
const SOFTWARE_MAX_PIXELS = 2_100_000;

const canvas = document.getElementById('pond') as HTMLCanvasElement;
const fallback = document.getElementById('fallback') as HTMLPreElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

function fail(message: string): void {
  canvas.hidden = true;
  fallback.hidden = false;
  fallback.textContent = `><(((o>\n\n${message}`;
}

async function main(): Promise<void> {
  await document.fonts.load(`${FONT_WEIGHT} 16px "JetBrains Mono"`).catch(() => undefined);

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    fail('This pond needs WebGL2, which this browser does not provide.');
    return;
  }

  // CPU rasterisers (SwiftShader, llvmpipe, WARP) can't push a full-resolution
  // pond at 60 fps; they get a smaller backing store that CSS scales up.
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const software = /SwiftShader|llvmpipe|softpipe|Basic Render|WARP|Software/i.test(gpu);

  const seed = Number(params.get('seed')) >>> 0 || (Math.random() * 2 ** 32) >>> 0;
  const rect = canvas.getBoundingClientRect();
  // A canvas that starts hidden gets a nominal pond until it has a real size.
  let collapsed = rect.width < MIN_POND_PX || rect.height < MIN_POND_PX;
  const pond = collapsed
    ? new Pond(Math.max(window.innerWidth, MIN_POND_PX), Math.max(window.innerHeight, MIN_POND_PX), seed)
    : new Pond(rect.width, rect.height, seed);

  // Canvas size in device pixels, applied at the start of a frame.
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)), dpr };
  };
  let size = measure();
  let sizeDirty = true;
  const observer = new ResizeObserver(([entry]) => {
    // Collapsed (display: none, a zero-height container): keep the last good
    // size and pause, rather than squeezing the fish into a 1 px pond.
    if (entry.contentRect.width < MIN_POND_PX || entry.contentRect.height < MIN_POND_PX) {
      collapsed = true;
      return;
    }
    collapsed = false;
    const dpr = window.devicePixelRatio || 1;
    let w = Math.round(entry.contentRect.width * dpr);
    let h = Math.round(entry.contentRect.height * dpr);
    // Exact device pixels when the browser reports them. Emulated DPRs can
    // report CSS px here, so only trust it when it agrees with the estimate.
    const box = entry.devicePixelContentBoxSize?.[0];
    if (box && Math.abs(box.inlineSize - w) <= 2 && Math.abs(box.blockSize - h) <= 2) {
      w = box.inlineSize;
      h = box.blockSize;
    }
    size = { w: Math.max(1, w), h: Math.max(1, h), dpr };
    sizeDirty = true;
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }

  let renderer: Renderer | null = null;
  const createRenderer = (): boolean => {
    try {
      renderer = new Renderer(gl, FONT_FAMILY);
      sizeDirty = true;
      return true;
    } catch (err) {
      console.error(err);
      fail('The pond could not start its renderer.');
      return false;
    }
  };
  if (!createRenderer()) return;

  const local = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  // Only the first finger steers: two fingers would read as one pointer
  // jumping between them, drawing a wake across the gap.
  canvas.addEventListener('pointermove', (e) => {
    if (!e.isPrimary) return;
    const [x, y] = local(e);
    pond.pointerMove(x, y, e.timeStamp / 1000);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    const [x, y] = local(e);
    pond.pointerDown(x, y, e.timeStamp / 1000);
  });
  // Touch and pen fire pointerleave as soon as they lift; the fish should
  // stay curious about that spot, so only a mouse truly leaves.
  canvas.addEventListener('pointerleave', (e) => (e.pointerType === 'mouse' ? pond.pointerLeave() : pond.pointerLift()));
  canvas.addEventListener('pointercancel', () => pond.pointerLeave());

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stats = { fps: 0, frameMs: 0, seed, gpu, software };
  // ?perf (or ?debug) shows the overlay from the start; P toggles it.
  const perf = new PerfMonitor(gl, { gpu, seed, software }, params.has('perf') || debug);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'p' || e.key === 'P') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) perf.toggle();
  });
  let raf = 0;
  let last = performance.now();

  const applySize = (r: Renderer) => {
    const budget = software ? Math.min(1, Math.sqrt(SOFTWARE_MAX_PIXELS / (size.w * size.h))) : 1;
    canvas.width = Math.max(1, Math.floor(size.w * budget));
    canvas.height = Math.max(1, Math.floor(size.h * budget));
    // The browser may give a smaller drawing buffer than asked for (max
    // texture size); shrink uniformly so cells stay square to the screen.
    let bw = gl.drawingBufferWidth;
    let bh = gl.drawingBufferHeight;
    if (bw !== canvas.width || bh !== canvas.height) {
      const k = Math.min(bw / canvas.width, bh / canvas.height);
      canvas.width = Math.max(1, Math.floor(canvas.width * k));
      canvas.height = Math.max(1, Math.floor(canvas.height * k));
      bw = gl.drawingBufferWidth;
      bh = gl.drawingBufferHeight;
    }
    // The pond stays in CSS px, so pointer mapping is unaffected.
    pond.resize(size.w / size.dpr, size.h / size.dpr);
    r.resize(bw, bh, (size.dpr * bw) / size.w);
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!renderer) return;
    if (collapsed) {
      last = now;
      return;
    }
    // Moving to another monitor or zooming changes the ratio without always
    // resizing the content box (and Safari has no device-pixel box at all).
    if ((window.devicePixelRatio || 1) !== size.dpr) {
      size = measure();
      sizeDirty = true;
    }
    if (sizeDirty) {
      sizeDirty = false;
      applySize(renderer);
    }
    perf.frame(now - last, now);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    pond.calm = reduceMotion.matches;
    const step = dt * (pond.calm ? 0.75 : 1);
    const t0 = performance.now();
    perf.begin();
    pond.update(step);
    renderer.render(pond, step);
    const cpuMs = performance.now() - t0;
    perf.end(cpuMs);
    stats.frameMs += (cpuMs - stats.frameMs) * 0.05;
    if (dt > 0) stats.fps += (1 / dt - stats.fps) * 0.05;
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    renderer = null;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // Input that arrived while the context was gone would replay all at once.
    pond.drops.length = 0;
    pond.taps.length = 0;
    if (!createRenderer()) return;
    perf.resetGpu();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  });

  if (debug) {
    Object.assign(window, { __koi: { pond, stats, get renderer() { return renderer; } } });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' && renderer) renderer.raw = !renderer.raw;
    });
  }

  raf = requestAnimationFrame(frame);
}

void main();
