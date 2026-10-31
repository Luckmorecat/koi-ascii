import type { KoiPond, KoiPondError, KoiPondErrorCode, KoiPondOptions } from './index';
import { AvoidZones, resolveAvoidFade } from './avoid';
import { FONT_WEIGHT } from './glyphs';
import { register, type PondCore, type PondStats } from './internal';
import { parseCssColor, resolveIntensity, resolvePalette } from './palette';
import { MIN_POND_PX, Pond } from './pond';
import { Renderer } from './renderer';
import { Sky, timeSource } from './sky';
import { resolveSky } from './sky-features';

const DEFAULT_FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
/** Backing-store budget (device px) when WebGL runs on a CPU rasteriser. */
const SOFTWARE_MAX_PIXELS = 2_100_000;

/** Resolves once the glyph font is usable (or can't be); never rejects. */
async function fontReady(family: string): Promise<void> {
  try {
    await document.fonts?.load(`${FONT_WEIGHT} 16px ${family}`);
  } catch {
    // A family the browser can't parse or fetch still renders in a fallback.
  }
}

function koiPondError(code: KoiPondErrorCode, message: string, cause?: unknown): KoiPondError {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  return Object.assign(error, { name: 'KoiPondError' as const, code });
}

export function mount(container: HTMLElement, options: KoiPondOptions): KoiPond {
  const fontFamily = options.fontFamily || DEFAULT_FONT_FAMILY;
  const interactive = options.interactive === 'canvas' || options.interactive === 'none' ? options.interactive : 'window';
  const seed =
    typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? options.seed >>> 0
      : (Math.random() * 2 ** 32) >>> 0;
  const sky = new Sky(timeSource(options.time, 0));
  // The look lives here, not in the Renderer, so it survives a lost context
  // (a restored context builds a fresh Renderer) and a setter called before
  // the renderer is up.
  let palette = resolvePalette(options.palette, parseCssColor);
  let intensity = resolveIntensity(options.intensity, 1, true);
  let skyFeatures = resolveSky(options.sky);
  // Readability zones, held here like the look. Their border radii are first
  // read on the first frame's resize (applySize), which is the mount's.
  const zones = new AvoidZones();
  zones.set(options.avoid, false);
  let avoidFade = resolveAvoidFade(options.avoidFade);

  // The canvas is the only thing added to the page. Its own background paints
  // the box before the first frame and after a failure, so the container's
  // styles are never touched.
  let canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // An explicit background keeps this colour; otherwise it follows the palette.
  canvas.style.backgroundColor = options.background || palette.css;
  // Only a pond that takes input on its own canvas may block touch scrolling.
  if (interactive === 'canvas') canvas.style.touchAction = 'none';
  container.append(canvas);

  // Every listener goes through this signal, so teardown removes them all.
  const listeners = new AbortController();
  const signal = listeners.signal;
  let gl: WebGL2RenderingContext | null = null;
  let renderer: Renderer | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let visibility: IntersectionObserver | null = null;
  let raf = 0;
  let destroyed = false;
  let failed = false;
  let paused = false;
  // Without IntersectionObserver the pond counts as always on-screen. With
  // it, the first observation (always delivered) decides.
  let onScreen = typeof IntersectionObserver === 'undefined';
  /** Starts the frame loop; set once the pond is up. */
  let startLoop: (() => void) | null = null;

  /** Runs the frame loop exactly when nothing is holding it back. */
  const schedule = () => {
    const run = !!startLoop && !!renderer && !destroyed && !failed && !paused && onScreen;
    if (run && !raf) startLoop?.();
    if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const teardown = () => {
    // Listeners first: losing the context below must not reach our handler.
    listeners.abort();
    resizeObserver?.disconnect();
    visibility?.disconnect();
    cancelAnimationFrame(raf);
    raf = 0;
    renderer = null;
    // The page's elements are let go with the pond (A8).
    zones.clear();
    // Free the GPU side now rather than at GC; browsers cap live contexts
    // per page (about 16) and drop the oldest past that.
    if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  const fail = (code: KoiPondErrorCode, message: string, cause?: unknown) => {
    if (destroyed || failed) return;
    failed = true;
    teardown();
    // A WebGL canvas that hasn't drawn (or lost its context) can show opaque
    // black; a canvas without a context shows only its CSS background.
    if (gl) {
      const blank = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(blank);
      canvas = blank;
    }
    const error = koiPondError(code, message, cause);
    if (!options.onError) {
      console.error(error);
      return;
    }
    // A throwing handler must neither vanish nor escape into a frame callback.
    try {
      options.onError(error);
    } catch (err) {
      console.error(err);
    }
  };

  const handle: KoiPond = {
    setTime(time) {
      if (!destroyed) sky.setSource(timeSource(time, sky.phase));
    },
    setPalette(next) {
      if (destroyed) return;
      palette = resolvePalette(next, parseCssColor);
      if (!options.background) canvas.style.backgroundColor = palette.css;
      renderer?.setLook(palette, intensity);
    },
    setIntensity(next) {
      if (destroyed) return;
      intensity = resolveIntensity(next, intensity, false);
      renderer?.setLook(palette, intensity);
    },
    setSky(next) {
      if (destroyed) return;
      skyFeatures = resolveSky(next);
      renderer?.setSky(skyFeatures);
    },
    setAvoid(list) {
      // A failed pond accepts the call and keeps nothing (A3).
      if (destroyed || failed) return;
      zones.set(list);
    },
    setAvoidFade(next) {
      // Like setAvoid: a failed pond accepts the call and does nothing (A3).
      if (destroyed || failed) return;
      avoidFade = resolveAvoidFade(next, avoidFade);
      renderer?.setAvoidFade(avoidFade);
    },
    pause() {
      paused = true;
      schedule();
    },
    resume() {
      paused = false;
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardown();
      canvas.remove();
    },
  };
  const slot = register(handle);

  const start = async (): Promise<void> => {
    await fontReady(fontFamily);
    // destroy() during the font load: never start.
    if (destroyed) return;

    const ctx = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!ctx) {
      fail('webgl2-unavailable', 'The koi pond needs WebGL2, which this browser does not provide.');
      return;
    }
    gl = ctx;

    // CPU rasterisers (SwiftShader, llvmpipe, WARP) can't push a full-resolution
    // pond at 60 fps; they get a smaller backing store that CSS scales up.
    const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(ctx.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : ctx.RENDERER));
    const software = /SwiftShader|llvmpipe|softpipe|Basic Render|WARP|Software/i.test(gpu);

    const rect = canvas.getBoundingClientRect();
    // A canvas that starts hidden gets a nominal pond until it has a real size.
    let collapsed = rect.width < MIN_POND_PX || rect.height < MIN_POND_PX;
    const pond = collapsed
      ? new Pond(Math.max(window.innerWidth, MIN_POND_PX), Math.max(window.innerHeight, MIN_POND_PX), seed)
      : new Pond(rect.width, rect.height, seed);

    // Debug override of the device pixel ratio (PondCore.setDpr).
    let dprOverride: number | null = null;
    const deviceRatio = () => dprOverride ?? (window.devicePixelRatio || 1);
    // Canvas size in device pixels, applied at the start of a frame.
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = deviceRatio();
      return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)), dpr };
    };
    let size = measure();
    let sizeDirty = true;
    resizeObserver = new ResizeObserver(([entry]) => {
      // Collapsed (display: none, a zero-height container): keep the last good
      // size and pause, rather than squeezing the fish into a 1 px pond.
      if (entry.contentRect.width < MIN_POND_PX || entry.contentRect.height < MIN_POND_PX) {
        collapsed = true;
        return;
      }
      collapsed = false;
      const dpr = deviceRatio();
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
      resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      resizeObserver.observe(canvas);
    }

    const createRenderer = (): boolean => {
      try {
        renderer = new Renderer(ctx, fontFamily, software);
        renderer.setLook(palette, intensity);
        renderer.setSky(skyFeatures);
        renderer.setAvoidFade(avoidFade);
        sizeDirty = true;
        return true;
      } catch (err) {
        fail('renderer-failed', 'The koi pond could not start its renderer.', err);
        return false;
      }
    };
    if (!createRenderer()) return;

    const local = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    // Demo/debug hooks run apart from the renderer, so a bug in them is
    // logged instead of failing the pond.
    const hook = (call: () => void) => {
      try {
        call();
      } catch (err) {
        console.error(err);
      }
    };
    // Touch and pen fire pointerleave as soon as they lift; the fish should
    // stay curious about that spot, so only a mouse truly leaves.
    const leave = (e: PointerEvent) => (e.pointerType === 'mouse' ? pond.pointerLeave() : pond.pointerLift());
    if (interactive === 'canvas') {
      // Only the first finger steers: two fingers would read as one pointer
      // jumping between them, drawing a wake across the gap.
      canvas.addEventListener(
        'pointermove',
        (e) => {
          if (!e.isPrimary) return;
          const [x, y] = local(e);
          pond.pointerMove(x, y, e.timeStamp / 1000);
        },
        { signal },
      );
      canvas.addEventListener(
        'pointerdown',
        (e) => {
          if (!e.isPrimary) return;
          const [x, y] = local(e);
          pond.pointerDown(x, y, e.timeStamp / 1000);
        },
        { signal },
      );
      canvas.addEventListener('pointerleave', leave, { signal });
      canvas.addEventListener('pointercancel', () => pond.pointerLeave(), { signal });
    } else if (interactive === 'window') {
      // The pond may sit behind page content, so listen on the window and map
      // into this canvas's rect. Passive: the page's scrolling stays its own.
      // Capture: content that stops propagation still can't hide the pointer.
      // `inside` stands in for the canvas's enter/leave events.
      const opts = { passive: true, capture: true, signal };
      let inside = false;
      /** Last primary pointer still over the page, for re-mapping on scroll. */
      let hover: { x: number; y: number; type: string } | null = null;
      const exit = (pointerType: string) => {
        if (!inside) return;
        inside = false;
        if (pointerType === 'mouse') pond.pointerLeave();
        else pond.pointerLift();
      };
      const point = (cx: number, cy: number, type: string, stamp: number, down: boolean) => {
        const r = canvas.getBoundingClientRect();
        const x = cx - r.left;
        const y = cy - r.top;
        if (x >= 0 && y >= 0 && x < r.width && y < r.height) {
          inside = true;
          if (down) pond.pointerDown(x, y, stamp);
          else pond.pointerMove(x, y, stamp);
        } else {
          exit(type);
        }
      };
      const track = (e: PointerEvent, down: boolean) => {
        if (!e.isPrimary) return;
        hover = { x: e.clientX, y: e.clientY, type: e.pointerType };
        point(e.clientX, e.clientY, e.pointerType, e.timeStamp / 1000, down);
      };
      window.addEventListener('pointermove', (e) => track(e, false), opts);
      window.addEventListener('pointerdown', (e) => track(e, true), opts);
      // A window has no pointerleave for a lifted finger or pen; this is it.
      window.addEventListener(
        'pointerup',
        (e) => {
          if (!e.isPrimary || e.pointerType === 'mouse') return;
          hover = null;
          exit(e.pointerType);
        },
        opts,
      );
      // The browser took a touch over for scrolling: as good as a lift.
      window.addEventListener(
        'pointercancel',
        (e) => {
          hover = null;
          exit(e.pointerType);
        },
        opts,
      );
      // No related target: the pointer left the document (a mouse leaving the window).
      window.addEventListener(
        'pointerout',
        (e) => {
          if (e.relatedTarget || !e.isPrimary) return;
          hover = null;
          exit(e.pointerType);
        },
        opts,
      );
      // The page (or any scroller) moving under a still pointer moves the pond
      // relative to it: re-map, so the fish follow the right spot and the
      // pointer leaves when the pond scrolls out from under it.
      window.addEventListener(
        'scroll',
        (e) => {
          if (hover) point(hover.x, hover.y, hover.type, e.timeStamp / 1000, false);
        },
        opts,
      );
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stats: PondStats = { fps: 0, frameMs: 0, frames: 0, seed, gpu, software };
    let last = performance.now();

    const applySize = (r: Renderer) => {
      const budget = software ? Math.min(1, Math.sqrt(SOFTWARE_MAX_PIXELS / (size.w * size.h))) : 1;
      canvas.width = Math.max(1, Math.floor(size.w * budget));
      canvas.height = Math.max(1, Math.floor(size.h * budget));
      // The browser may give a smaller drawing buffer than asked for (max
      // texture size); shrink uniformly so cells stay square to the screen.
      let bw = ctx.drawingBufferWidth;
      let bh = ctx.drawingBufferHeight;
      if (bw !== canvas.width || bh !== canvas.height) {
        const k = Math.min(bw / canvas.width, bh / canvas.height);
        canvas.width = Math.max(1, Math.floor(canvas.width * k));
        canvas.height = Math.max(1, Math.floor(canvas.height * k));
        bw = ctx.drawingBufferWidth;
        bh = ctx.drawingBufferHeight;
      }
      // The pond stays in CSS px, so pointer mapping is unaffected.
      pond.resize(size.w / size.dpr, size.h / size.dpr);
      r.resize(bw, bh, (size.dpr * bw) / size.w);
      // The one place besides setAvoid that reads styles (A6).
      zones.readRadii();
    };

    /** Applies a pending resize; false while there is nothing to draw into. */
    const prepare = (): Renderer | null => {
      if (!renderer || collapsed || failed || destroyed) return null;
      // Moving to another monitor or zooming changes the ratio without always
      // resizing the content box (and Safari has no device-pixel box at all).
      if (deviceRatio() !== size.dpr) {
        size = measure();
        sizeDirty = true;
      }
      if (sizeDirty) {
        sizeDirty = false;
        applySize(renderer);
      }
      measureZones(renderer);
      return renderer;
    };

    /**
     * Measures the readability zones for the draw about to happen. On every
     * drawn frame and manual draw (D8), never while the loop is stopped: the
     * page's elements move without telling anyone (scroll, transforms,
     * animations), so a fresh read is the only way to be right. No zones, no
     * reads.
     */
    const measureZones = (r: Renderer) => {
      let count = 0;
      if (zones.size > 0) {
        const c = canvas.getBoundingClientRect();
        count = zones.measure(c, window.innerWidth, window.innerHeight, avoidFade.feather);
      }
      r.setAvoid(zones.rects, zones.radii, count);
    };

    /** Simulates `dt` seconds and draws; shared by the frame loop and step(). */
    const advance = (r: Renderer, dt: number) => {
      pond.calm = reduceMotion.matches;
      const step = dt * (pond.calm ? 0.75 : 1);
      pond.update(step);
      // The day runs on unscaled time: reduced motion slows the pond, not the sky.
      r.render(pond, step, sky.update(dt));
      stats.frames++;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!renderer) return;
      if (collapsed) {
        last = now;
        return;
      }
      const hooks = slot.hooks;
      try {
        const r = prepare();
        if (!r) return;
        if (hooks.frame) hook(() => hooks.frame?.(now - last, now));
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        const t0 = performance.now();
        if (hooks.begin) hook(() => hooks.begin?.());
        advance(r, dt);
        const cpuMs = performance.now() - t0;
        if (hooks.end) hook(() => hooks.end?.(cpuMs));
        stats.frameMs += (cpuMs - stats.frameMs) * 0.05;
        if (dt > 0) stats.fps += (1 / dt - stats.fps) * 0.05;
      } catch (err) {
        fail('renderer-failed', 'The koi pond renderer stopped working.', err);
      }
    };

    /** Runs a manual draw like a frame: a throw fails the pond instead of escaping. */
    const manual = (draw: (r: Renderer) => void): boolean => {
      try {
        const r = prepare();
        if (!r) return false;
        draw(r);
        return true;
      } catch (err) {
        fail('renderer-failed', 'The koi pond renderer stopped working.', err);
        return false;
      }
    };
    // (Re)starting never replays the pause as one long frame.
    startLoop = () => {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        renderer = null;
        hook(() => slot.hooks.lost?.());
        schedule();
      },
      { signal },
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        // Input that arrived while the context was gone would replay all at once.
        pond.drops.length = 0;
        pond.taps.length = 0;
        if (!createRenderer()) return;
        hook(() => slot.hooks.restored?.());
        schedule();
      },
      { signal },
    );

    // Off-screen ponds stop drawing; rAF already stops in hidden tabs.
    if (typeof IntersectionObserver !== 'undefined') {
      visibility = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        schedule();
      });
      visibility.observe(canvas);
    }

    const core: PondCore = {
      gl: ctx,
      pond,
      sky,
      stats,
      get renderer() {
        return renderer;
      },
      get canvas() {
        return canvas;
      },
      step: (dt) => manual((r) => advance(r, dt)),
      redraw: () => manual((r) => r.render(pond, 0, sky.phase)),
      setDpr(dpr) {
        dprOverride = dpr !== null && Number.isFinite(dpr) && dpr > 0 ? dpr : null;
        size = measure();
        sizeDirty = true;
      },
    };
    slot.core = core;
    hook(() => slot.hooks.ready?.(core));
    schedule();
  };

  start().catch((err) => fail('renderer-failed', 'The koi pond could not start.', err));
  return handle;
}
