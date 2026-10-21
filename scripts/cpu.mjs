// CPU cost per frame of the demo, optionally against a base revision: "did
// this change cost main-thread time compared with main?". Where `npm run perf`
// redraws one frozen frame, this advances time with koi.step, so the fish
// simulation, the CPU uploads and the ripple pass (only drawn when time
// advances) are all in it. Each run loads the page with ?debug, pins the
// viewport, reseeds with seed 42 and steps 120 untimed frames, then measures.
// Starts its own Vite server(s) and stops them on exit. Prints tables on
// stderr and one JSON report on stdout; exits 1 on page errors. Run it with
// `node --experimental-strip-types scripts/cpu.mjs` (see shot.mjs for why).
//
//   node --experimental-strip-types scripts/cpu.mjs [query…] [--base rev] [--head dir]
//        [--runs 7] [--frames 600] [--batches 20] [--size 1280x800] [--dpr 1]
//        [--no-step] [--gpu] [--profile] [--alloc] [--long 3000] [--top 30]
//        [--out test-results/cpu] [--no-isolate]
//
//   query      demo URL query, one set of tables per query, e.g. '?debug&time=fixed&phase=0.83'
//              (default '?debug'; debug is added if missing)
//   --base     also measure this revision (a branch, tag or sha) and print the delta.
//              It is checked out as a detached worktree in .claude/worktrees/base-<sha>-<pid>
//              of the current checkout (scripts/lib/base-worktree.mjs; node_modules
//              hard-linked), served by its own Vite server and removed afterwards, also on
//              error or Ctrl-C. Base and head runs alternate in one browser, and which side
//              goes first alternates per run. The base needs koi.step and koi.on('frame').
//   --head     the checkout to measure as head (default: the toplevel of the current
//              directory), uncommitted changes included, so one copy of this script can
//              measure any worktree. It needs its own node_modules.
//   --runs     page loads per side and per mode; tables show the median of the runs' values
//              and their spread (max − min)
//   --frames   timed frames per run of the step and --gpu modes, in --batches batches
//              (frames / batches frames per koi.step call, 2…3600)
//   --size, --dpr  koi.setViewport({width, height, dpr}); the page is the same size
//   --out      where --profile and --alloc save each run's raw profile:
//              <out>/q<n>-<query>/<side>-run<i>.cpuprofile (CDP Profiler.stop's profile;
//              DevTools Performance panel → Load profile) and .heapprofile
//              (HeapProfiler.stopSampling's call tree with selfSize per node; the per-sample
//              list is left out, it runs to tens of MB)
//   --top      functions listed by --profile and --alloc (files: all)
//   --long     frames of the koi.step run that --profile and --alloc record, per run (in
//              batches of frames / batches, rounded to whole batches)
//   --no-isolate  serve the page as is. By default the Vite server adds COOP + COEP headers,
//              so the page is cross-origin isolated and performance.now() steps by 5 µs instead
//              of 100 µs; it loads nothing cross-origin, so nothing else changes. The step
//              table prints the timer step it found.
//
// Modes; each is its own page load per run, so no mode's instrumentation reaches another's:
//
//   step       (default; --no-step skips it) CPU ms per frame on the main thread: simulate +
//              render submit. koi.step({frames: frames / batches}) per batch, with a
//              setTimeout(0) between batches (untimed) so the GPU process drains and the page
//              presents. A batch's time is taken between its first and last 'frame' event
//              (single frames are never timed: even isolated, performance.now() steps by 5 µs);
//              a run's value is the median of its batch means. `call ms` times the whole
//              koi.step call instead, so its per-call overhead (argument check, JSON copy of
//              the result, the 'change' event the panel syncs on) is spread over the frames.
//   --gpu      GPU µs per pass of advancing frames: every gl.drawArrays during the koi.step
//              batches is wrapped in a TIME_ELAPSED query (EXT_disjoint_timer_query_webgl2,
//              as demo/debug/perf.ts does for koi.profile) and named by its program, found
//              from a declaration only that fragment shader has (ripple, scene, fly, glow,
//              emission, ascii; 'other' if none matches) by an init script that wraps getContext,
//              createShader, shaderSource, attachShader and linkProgram. Per pass: the median
//              over frames of its per-frame sum (ripple: all its steps in the frame), plus
//              ripple steps per frame; `frame` is all draws together. Only draws are timed,
//              not clears or uploads. A run with missing results or a GPU disjoint event is
//              retried, up to 3 tries.
//   --profile  V8 CPU profile (CDP Profiler, 50 µs sampling interval asked for; Linux timer
//              slack stretches it to ≈105 µs, the table prints the real one) of a --long frame
//              koi.step run: self time per function (name, file, line in the source via
//              Vite's inline source maps) and per source file, in ms per frame, idle
//              excluded. Totals:
//              all samples, the per-frame path (src/mount.ts advance and below), GC and
//              (program) (native work outside JS: task scheduling, the panel's rAF, …).
//   --alloc    bytes allocated per frame: CDP HeapProfiler.startSampling (256 B interval,
//              objects later collected by minor and major GC included, so it is everything
//              allocated, not what survives) around a --long frame koi.step run; total,
//              per-frame path, top files and functions. Plus GC on the main thread: a
//              second --long frame run in the same page, traced (CDP Tracing: devtools.timeline,
//              v8, disabled-by-default-v8.gc), counts MinorGC and MajorGC events and their
//              time between console.timeStamp markers. Separate from the sampled run, since
//              the heap sampler's bookkeeping slows each GC.
//
// koi.step and the real frame loop (src/mount.ts): both run prepare() (a pending resize) and
// advance(r, dt) (pond.update, renderer.render, the sky), so the simulate + render work is
// the same code. What differs:
//   - dt is a fixed 1/60 s (koi.step's default); the loop measures it (capped at 0.1 s).
//     At 60 Hz they agree: one ripple step per frame on average.
//   - Frames run back to back in one task per batch: no requestAnimationFrame scheduling, no
//     present or compositor commit between frames, and caches and CPU clocks stay warm.
//     The number is the pond's own main-thread cost, not a whole browser frame.
//   - Under ?debug the loop also brackets each frame with the debug GPU timer (one
//     TIME_ELAPSED query, polled each frame: demo/debug/perf.ts); koi.step doesn't. Without
//     ?debug the loop has no hooks at all.
//   - koi.step emits a 'frame' event per frame (the panel's graph listener and this
//     script's own: a few array writes) and calls performance.now() once per frame.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchGpu, startDemo } from './demo.mjs';
import { withBaseWorktree } from './lib/base-worktree.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    runs: { type: 'string', default: '7' },
    frames: { type: 'string', default: '600' },
    batches: { type: 'string', default: '20' },
    size: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1' },
    step: { type: 'boolean', default: true },
    isolate: { type: 'boolean', default: true },
    gpu: { type: 'boolean', default: false },
    profile: { type: 'boolean', default: false },
    alloc: { type: 'boolean', default: false },
    long: { type: 'string', default: '3000' },
    top: { type: 'string', default: '30' },
    out: { type: 'string', default: 'test-results/cpu' },
  },
});
const [width, height] = opt.size.split('x').map(Number);
const dpr = +opt.dpr;
const runs = +opt.runs;
const frames = +opt.frames;
const batches = +opt.batches;
const perBatch = Math.floor(frames / batches);
const long = +opt.long;
const longBatches = Math.max(1, Math.round(long / perBatch));
const topN = +opt.top;
const outDir = path.resolve(opt.out);
const modes = ['step', 'gpu', 'profile', 'alloc'].filter((m) => opt[m]);
const queries = (positionals.length ? positionals : ['?debug']).map((q) => {
  const bare = q.replace(/^\?/, '');
  return /(^|&)debug(=|&|$)/.test(bare) ? `?${bare}` : `?debug${bare ? `&${bare}` : ''}`;
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const top = opt.head ? path.resolve(opt.head) : git(process.cwd(), 'rev-parse', '--show-toplevel');

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (v, d) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);

const report = {
  renderer: '',
  viewport: { width, height, dpr },
  runs,
  frames,
  batch: perBatch,
  long: modes.some((m) => m === 'profile' || m === 'alloc') ? longBatches * perBatch : null,
  modes,
  head: null,
  base: null,
  queries: [],
  errors: [],
};

/**
 * Runs in the page before its scripts (page.addInitScript): window.__koiCpu with
 * the setup and the timed koi.step loop, and with `wrapGl` the context capture and
 * program names the --gpu mode needs. Self-contained: Playwright sends its source.
 */
function pageInit(wrapGl) {
  const S = { contexts: [], names: new WeakMap(), programs: [], frame: 0, pending: [] };
  window.__koiCpu = S;
  const call = async (name, args) => {
    const r = await window.koi.call(name, args);
    if (!r.ok) throw new Error(`koi.${name}: ${r.error.code}: ${r.error.message}`);
    return r.result;
  };

  /** The reproducible start every mode shares, as npm run perf does it. */
  S.setup = async ({ width, height, dpr }) => {
    for (const fn of ['step', 'on', 'reseed', 'setViewport']) {
      if (typeof window.koi[fn] !== 'function') throw new Error(`koi.${fn} is missing: this revision predates it`);
    }
    await call('setViewport', { width, height, dpr });
    await call('reseed', { seed: 42 });
    await call('step', { frames: 120 });
  };

  /** `batches` koi.step calls of `per` frames; per batch the mean ms per frame between its first and last frame event, and of the whole call. */
  S.run = async ({ per, batches, mark }) => {
    const frameMs = [];
    const callMs = [];
    let n = 0;
    let first = 0;
    let last = 0;
    const off = window.koi.on('frame', () => {
      last = performance.now();
      if (n++ === 0) first = last;
    });
    if (mark) console.timeStamp('koi-cpu:start');
    try {
      for (let b = 0; b < batches; b++) {
        // Untimed: the GPU process drains and the page presents, as between real frames.
        await new Promise((ok) => setTimeout(ok, 0));
        n = 0;
        const t0 = performance.now();
        await call('step', { frames: per });
        const t1 = performance.now();
        if (n !== per) throw new Error(`koi.step emitted ${n} frame events for ${per} frames`);
        frameMs.push((last - first) / (per - 1));
        callMs.push((t1 - t0) / per);
      }
    } finally {
      if (mark) console.timeStamp('koi-cpu:end');
      off();
    }
    return { frames: per * batches, frameMs, callMs };
  };

  /** Grid, canvas, frame counter and phase after a run (koi.profile is the one tool that reports the grid). */
  S.info = async () => {
    const s = await call('getState');
    const p = typeof window.koi.profile === 'function' ? await call('profile', { frames: 1 }) : null;
    // performance.now()'s step: the smallest non-zero difference between back-to-back reads.
    let step = Infinity;
    for (let i = 0, t = performance.now(); i < 200_000 && step > 0.001; i++) {
      const u = performance.now();
      if (u > t) step = Math.min(step, u - t);
      t = u;
    }
    return {
      cells: p?.cells ?? null,
      canvas: s.canvas,
      frame: s.frame,
      phase: s.time.phase,
      timer: { isolated: window.crossOriginIsolated, stepUs: Math.round(step * 1e4) / 10 },
    };
  };

  if (!wrapGl) return;
  // Program names from a declaration only that fragment shader has: not its header comment, since the
  // shipped bundle strips // comments from the GLSL. The emission pass exists only on some revisions.
  const MARKERS = [
    ['ripple', /uniform float uDamping;/],
    ['scene', /uniform int uOrder\[/],
    ['fly', /uniform vec3 uFlyCol;/],
    ['glow', /out vec4 oGlow;/],
    ['emission', /out vec4 oEmit;/],
    ['ascii', /uniform sampler2D uAtlas;/],
  ];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (type === 'webgl2' && ctx && !S.contexts.includes(ctx)) S.contexts.push(ctx);
    return ctx;
  };
  const P = WebGL2RenderingContext.prototype;
  const types = new WeakMap();
  const sources = new WeakMap();
  const attached = new WeakMap();
  const { createShader, shaderSource, attachShader, linkProgram } = P;
  P.createShader = function (type) {
    const s = createShader.call(this, type);
    if (s) types.set(s, type);
    return s;
  };
  P.shaderSource = function (shader, src) {
    sources.set(shader, src);
    return shaderSource.call(this, shader, src);
  };
  P.attachShader = function (program, shader) {
    if (!attached.has(program)) attached.set(program, []);
    attached.get(program).push(shader);
    return attachShader.call(this, program, shader);
  };
  P.linkProgram = function (program) {
    const shaders = attached.get(program) ?? [];
    const src = (type) => shaders.filter((s) => types.get(s) === type).map((s) => sources.get(s) ?? '').join('\n');
    const frag = src(this.FRAGMENT_SHADER);
    const name = MARKERS.find(([, re]) => re.test(frag))?.[0] ?? 'other';
    S.names.set(program, name);
    // The first comment of the shader's own source (after the version line and generated defines).
    S.programs.push({ name, frag });
    return linkProgram.call(this, program);
  };

  /** Wraps drawArrays on the live context in timer queries; false without the extension. */
  S.gpuBegin = () => {
    // A reseed mounts a new canvas: the live pond's context is the newest one still in the page.
    const gl = (S.gl = S.contexts.filter((c) => c.canvas.isConnected && !c.isContextLost()).pop());
    if (!gl) throw new Error('no live WebGL2 context was captured');
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return false;
    // Reading the flag clears it, so what it says afterwards covers this run only.
    gl.getParameter(ext.GPU_DISJOINT_EXT);
    S.ext = ext;
    S.frame = 0;
    S.pending = [];
    S.offFrame = window.koi.on('frame', () => S.frame++);
    const draw = gl.drawArrays;
    gl.drawArrays = (mode, first, count) => {
      const q = gl.createQuery();
      if (!q) return draw.call(gl, mode, first, count);
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      draw.call(gl, mode, first, count);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      const p = gl.getParameter(gl.CURRENT_PROGRAM);
      S.pending.push([S.frame, (p && S.names.get(p)) ?? 'other', q]);
    };
    S.gpuStop = () => {
      // The prototype's again (the instance property only shadowed it).
      delete gl.drawArrays;
      S.offFrame();
    };
    return true;
  };

  /** Per pass: per-frame GPU µs summed over its draws → n, median, p90, mean over all frames, draws per frame and their histogram. */
  S.gpuCollect = async () => {
    const gl = S.gl;
    const ext = S.ext;
    const total = S.frame;
    const deadline = performance.now() + 2000;
    const sums = new Map();
    const draws = new Map();
    const add = (map, pass, f, v) => {
      if (!map.has(pass)) map.set(pass, new Map());
      const byFrame = map.get(pass);
      byFrame.set(f, (byFrame.get(f) ?? 0) + v);
    };
    let missing = 0;
    for (const [f, pass, q] of S.pending) {
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && performance.now() < deadline) {
        await new Promise((ok) => setTimeout(ok, 10));
      }
      add(draws, pass, f, 1);
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        const us = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e3;
        add(sums, pass, f, us);
        add(sums, 'frame', f, us);
      } else missing++;
      gl.deleteQuery(q);
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const passes = {};
    for (const [pass, byFrame] of sums) {
      const t = [...byFrame.values()].sort((a, b) => a - b);
      const hist = {};
      if (pass !== 'frame') {
        const per = draws.get(pass);
        for (let f = 0; f < total; f++) hist[per.get(f) ?? 0] = (hist[per.get(f) ?? 0] ?? 0) + 1;
      }
      passes[pass] = {
        n: t.length,
        median: q(t, 0.5),
        p90: q(t, 0.9),
        mean: t.reduce((s, v) => s + v, 0) / total,
        drawsPerFrame: pass === 'frame' ? S.pending.length / total : [...draws.get(pass).values()].reduce((s, v) => s + v, 0) / total,
        hist,
      };
    }
    S.pending = [];
    // Every fragment shader starts with the same version line, defines and common.glsl;
    // the first comment after that shared prefix is the shader's own header.
    const frags = S.programs.map((p) => p.frag);
    let shared = frags[0]?.length ?? 0;
    for (const f of frags) {
      let i = 0;
      while (i < shared && f.charCodeAt(i) === frags[0].charCodeAt(i)) i++;
      shared = i;
    }
    shared = frags.length > 1 ? frags[0].lastIndexOf('\n', shared) + 1 : 0;
    // Each mount (the first pond, the reseeded one) links its own: list each once.
    const programs = [
      ...new Map(
        S.programs.map(({ name, frag }) => {
          const header = (frag.slice(shared).split('\n').find((l) => l.startsWith('//')) ?? '').slice(0, 100);
          return [`${name} ${header}`, { name, header }];
        }),
      ).values(),
    ];
    return { frames: total, passes, disjoint, missing, programs };
  };
}

/**
 * COOP + COEP on every response of the demo's Vite server (a middleware first in its
 * connect stack), so its pages are cross-origin isolated and performance.now() steps by
 * 5 µs instead of 100 µs. The page loads nothing cross-origin, so nothing else changes.
 * (Headers added by page.route or CDP Fetch don't do it: Chromium takes COOP/COEP from the
 * network response, and a fulfilled one trips its local network access checks.)
 */
function isolate(demo) {
  const stack = demo.server.middlewares.stack;
  if (!Array.isArray(stack)) throw new Error("can't isolate the page: Vite's middlewares have no connect stack; use --no-isolate");
  stack.unshift({
    route: '',
    handle: (req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    },
  });
}

/** Measures every mode of every query on head, and on the base checkout at `baseDir` if given. */
async function measureAll(baseDir) {
  const demos = {};
  const dirs = { head: top };
  let browser;
  try {
    if (baseDir) {
      demos.base = await startDemo(baseDir);
      dirs.base = baseDir;
    }
    demos.head = await startDemo(top);
    if (opt.isolate) Object.values(demos).forEach(isolate);
    ({ browser, renderer: report.renderer } = await launchGpu());
    const sides = Object.keys(demos).sort(); // base, head

    /** A page of `side` at `url`, set up: viewport pinned, reseeded, 120 frames stepped. */
    async function open(side, url, wrapGl) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      page.on('console', (m) => m.type() === 'error' && report.errors.push(`${side}: ${m.text()}`));
      page.on('pageerror', (e) => report.errors.push(`${side}: ${e.message}`));
      try {
        await page.addInitScript(pageInit, wrapGl);
        await page.goto(url);
        await page.waitForFunction(() => !!window.koi, null, { timeout: 15_000 });
        await page.evaluate(() => window.koi.ready.catch((e) => Promise.reject(new Error(e.message))));
        await page.evaluate((v) => window.__koiCpu.setup(v), { width, height, dpr });
        if (opt.isolate && !(await page.evaluate(() => window.crossOriginIsolated))) {
          throw new Error(`${side}: the page is not cross-origin isolated (performance.now() steps by 100 µs); --no-isolate accepts that`);
        }
        return page;
      } catch (e) {
        await page.close();
        throw e;
      }
    }
    const run = (page, n) => page.evaluate((v) => window.__koiCpu.run(v), { per: perBatch, batches: n });
    const info = (page) => page.evaluate(() => window.__koiCpu.info());
    const slug = (qi, query) => `q${qi + 1}-${query.replace(/^\?/, '').replace(/[^\w.=-]+/g, '_').replace(/=/g, '-').slice(0, 60)}`;

    const PASSES = {
      async step({ side, url }) {
        const page = await open(side, url, false);
        try {
          const r = await run(page, batches);
          return { value: median(r.frameMs), call: median(r.callMs), info: await info(page) };
        } finally {
          await page.close();
        }
      },

      async gpu({ side, url }) {
        for (let attempt = 1; ; attempt++) {
          const page = await open(side, url, true);
          let r;
          try {
            r = await page.evaluate(
              async (v) => {
                const S = window.__koiCpu;
                if (!S.gpuBegin()) return null;
                try {
                  await S.run(v);
                } finally {
                  S.gpuStop();
                }
                return S.gpuCollect();
              },
              { per: perBatch, batches },
            );
            if (!r) throw new Error('no EXT_disjoint_timer_query_webgl2 on this GPU: nothing to time');
            r.info = await info(page);
          } finally {
            await page.close();
          }
          if (!r.missing && !r.disjoint) return r;
          if (attempt === 3) {
            const why = r.missing ? `${r.missing} timer results still missing` : 'the last try hit a GPU disjoint event';
            throw new Error(`${side}: ${why} after 3 tries; is the GPU busy?`);
          }
        }
      },

      async profile({ side, url, qi, query, i }) {
        const page = await open(side, url, false);
        try {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
          await cdp.send('Profiler.start');
          let r;
          let profile;
          try {
            r = await run(page, longBatches);
          } finally {
            ({ profile } = await cdp.send('Profiler.stop'));
          }
          const file = path.join(outDir, slug(qi, query), `${side}-run${i + 1}.cpuprofile`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(profile));
          return { ...(await cpuProfile(profile, r.frames, dirs[side])), file, info: await info(page) };
        } finally {
          await page.close();
        }
      },

      async alloc({ side, url, qi, query, i }) {
        const page = await open(side, url, false);
        try {
          // GC first, traced without the heap sampler (its bookkeeping slows every GC).
          await browser.startTracing(page, { categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc'] });
          let trace;
          try {
            await page.evaluate((v) => window.__koiCpu.run(v), { per: perBatch, batches: longBatches, mark: true });
          } finally {
            trace = await browser.stopTracing();
          }
          const gc = gcFromTrace(trace, longBatches * perBatch);

          const cdp = await page.context().newCDPSession(page);
          await cdp.send('HeapProfiler.enable');
          await cdp.send('HeapProfiler.startSampling', {
            samplingInterval: 256,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
          });
          let r;
          let profile;
          try {
            r = await run(page, longBatches);
          } finally {
            ({ profile } = await cdp.send('HeapProfiler.stopSampling'));
          }
          const file = path.join(outDir, slug(qi, query), `${side}-run${i + 1}.heapprofile`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          // The call tree (selfSize per node) without the per-sample list, which runs to tens of MB.
          fs.writeFileSync(file, JSON.stringify({ head: profile.head }));
          return { ...(await heapProfile(profile, r.frames, dirs[side])), gc, file, info: await info(page) };
        } finally {
          await page.close();
        }
      },
    };

    for (const [qi, query] of queries.entries()) {
      const q = { query, urls: {}, cells: null, canvas: null, timer: null };
      report.queries.push(q);
      for (const side of sides) q.urls[side] = demos[side].url(query);
      for (const mode of modes) {
        const results = Object.fromEntries(sides.map((s) => [s, []]));
        for (let i = 0; i < runs; i++) {
          // Alternate which side goes first, so a clock ramping up favours neither.
          for (const side of i % 2 ? [...sides].reverse() : sides) {
            if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${query}  ${mode}  run ${i + 1}/${runs} ${side}`);
            const r = await PASSES[mode]({ side, url: q.urls[side], qi, query, i });
            results[side].push(r);
            q.cells = r.info.cells ?? q.cells;
            q.canvas = r.info.canvas;
            q.timer = r.info.timer;
          }
        }
        if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
        q[mode] = SUMMARY[mode](results, sides);
        q[mode].endState = Object.fromEntries(sides.map((s) => [s, results[s].map((r) => ({ frame: r.info.frame, phase: r.info.phase }))]));
        process.stderr.write(TABLE[mode](q) + '\n');
      }
    }
  } finally {
    await browser?.close();
    for (const d of Object.values(demos)) await d.close();
  }
}

// ---- Profiles: self time and allocations per function and file ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Source map v3 mappings → per generated line, [generated column, original line] segments. */
function decodeMappings(mappings) {
  let src = 0;
  let line = 0;
  let col = 0;
  return mappings.split(';').map((group) => {
    const segs = [];
    let gen = 0;
    for (const seg of group ? group.split(',') : []) {
      const v = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          v.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      gen += v[0];
      if (v.length >= 4) {
        src += v[1];
        line += v[2];
        col += v[3];
        segs.push([gen, line]);
      }
    }
    return segs;
  });
}

/** Served module URL → decoded inline source map (Vite dev serves one per module), or null. */
const sourceMaps = new Map();
async function sourceMap(url) {
  if (!sourceMaps.has(url)) {
    sourceMaps.set(
      url,
      (async () => {
        try {
          const text = await (await fetch(url)).text();
          const m = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(text);
          return m ? decodeMappings(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')).mappings) : null;
        } catch {
          return null;
        }
      })(),
    );
  }
  return sourceMaps.get(url);
}

/** A served URL as a repo path (src/koi/koi.ts, demo/debug/api.ts), the same for base and head. */
function repoFile(url, dir) {
  if (!url) return null;
  let p;
  try {
    p = decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
  if (p.startsWith('/@fs/')) p = p.slice(4);
  if (p.startsWith(`${dir}/`)) return p.slice(dir.length + 1);
  // The demo's Vite root is demo/: its own files are served from /.
  return fs.existsSync(path.join(dir, 'demo', p)) ? `demo${p}` : p.replace(/^\//, '');
}

/** A V8 call frame → { fn, file, line } with the original 1-based line where a source map has it. */
async function locate(cf, dir) {
  const fn = cf.functionName || '(anonymous)';
  const file = repoFile(cf.url, dir);
  // V8's own nodes ((program), (garbage collector), (V8 API) …) by name; other URL-less frames are native code.
  if (!file) return { fn, file: /^\(.+\)$/.test(cf.functionName) ? cf.functionName : '(native)', line: null };
  let line = cf.lineNumber >= 0 ? cf.lineNumber + 1 : null;
  const map = /^https?:/.test(cf.url) && line ? await sourceMap(cf.url) : null;
  const segs = map?.[cf.lineNumber];
  if (segs?.length) {
    let hit = segs[0];
    for (const s of segs) if (s[0] <= cf.columnNumber) hit = s;
    line = hit[1] + 1;
  }
  return { fn, file, line };
}

const keyOf = (l) => `${l.fn}  ${l.file}${l.line ? `:${l.line}` : ''}`;
/** src/mount.ts's advance(): the simulate + render path of every frame. */
const isAdvance = (cf) => cf.functionName === 'advance' && /\/src\/mount\.ts(\?|$)/.test(cf.url);

/** Self ms per frame by function and by file, idle left out, from a CDP .cpuprofile. */
async function cpuProfile(profile, nFrames, dir) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const inAdvance = new Map();
  const under = (id) => {
    if (!inAdvance.has(id)) {
      const n = nodes.get(id);
      inAdvance.set(id, isAdvance(n.callFrame) || (parent.has(id) && under(parent.get(id))));
    }
    return inAdvance.get(id);
  };
  // A sample lasts until the next one.
  const self = new Map();
  let t = profile.startTime;
  const ts = profile.timeDeltas.map((d) => (t += d));
  for (let i = 0; i < profile.samples.length; i++) {
    const us = Math.max(0, (i + 1 < ts.length ? ts[i + 1] : profile.endTime) - ts[i]);
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + us);
  }
  const perFrame = (us) => us / 1000 / nFrames;
  const fns = new Map();
  const files = new Map();
  const totals = { all: 0, advance: 0, gc: 0, program: 0 };
  let idle = 0;
  for (const [id, us] of self) {
    const cf = nodes.get(id).callFrame;
    if (cf.functionName === '(idle)') {
      idle += us;
      continue;
    }
    totals.all += us;
    if (cf.functionName === '(garbage collector)') totals.gc += us;
    if (cf.functionName === '(program)') totals.program += us;
    if (under(id)) totals.advance += us;
    const l = await locate(cf, dir);
    const k = keyOf(l);
    fns.set(k, (fns.get(k) ?? 0) + us);
    files.set(l.file, (files.get(l.file) ?? 0) + us);
  }
  const conv = (m) => new Map([...m].map(([k, us]) => [k, perFrame(us)]));
  return {
    frames: nFrames,
    samples: profile.samples.length,
    sampleUs: median(profile.timeDeltas.slice(1)),
    idleMs: idle / 1000,
    totals: Object.fromEntries(Object.entries(totals).map(([k, us]) => [k, perFrame(us)])),
    fns: conv(fns),
    files: conv(files),
  };
}

/** Bytes allocated per frame by function and by file, from a CDP sampling heap profile. */
async function heapProfile(profile, nFrames, dir) {
  const fns = new Map();
  const files = new Map();
  const totals = { all: 0, advance: 0 };
  const walk = async (node, adv) => {
    const a = adv || isAdvance(node.callFrame);
    if (node.selfSize) {
      totals.all += node.selfSize;
      if (a) totals.advance += node.selfSize;
      const l = await locate(node.callFrame, dir);
      const k = keyOf(l);
      fns.set(k, (fns.get(k) ?? 0) + node.selfSize);
      files.set(l.file, (files.get(l.file) ?? 0) + node.selfSize);
    }
    for (const c of node.children ?? []) await walk(c, a);
  };
  await walk(profile.head, false);
  const conv = (m) => new Map([...m].map(([k, b]) => [k, b / nFrames]));
  return {
    frames: nFrames,
    samples: profile.samples?.length ?? null,
    totals: { all: totals.all / nFrames, advance: totals.advance / nFrames },
    fns: conv(fns),
    files: conv(files),
  };
}

/** MinorGC / MajorGC on the main thread between the koi-cpu:start and :end markers of a trace. */
function gcFromTrace(buf, nFrames) {
  const events = JSON.parse(buf.toString('utf8')).traceEvents ?? [];
  const mark = (m) => events.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === m);
  const start = mark('koi-cpu:start');
  const end = mark('koi-cpu:end');
  if (!start || !end) throw new Error('trace: no koi-cpu TimeStamp markers (is devtools.timeline traced?)');
  const gc = { minor: { count: 0, ms: 0 }, major: { count: 0, ms: 0 } };
  /** Every GC-looking event name on the thread, for checking what the trace holds. */
  const seen = {};
  const open = {};
  for (const e of events) {
    if (e.pid !== start.pid || e.tid !== start.tid || e.ts < start.ts || e.ts > end.ts) continue;
    if (/GC|Scavenge|MarkCompact|Sweep|Mark/i.test(e.name)) seen[e.name] = (seen[e.name] ?? 0) + 1;
    const kind = e.name === 'MinorGC' ? 'minor' : e.name === 'MajorGC' ? 'major' : null;
    if (!kind) continue;
    if (e.ph === 'X') {
      gc[kind].count++;
      gc[kind].ms += (e.dur ?? 0) / 1000;
    } else if (e.ph === 'B') open[kind] = e.ts;
    else if (e.ph === 'E' && open[kind] != null) {
      gc[kind].count++;
      gc[kind].ms += (e.ts - open[kind]) / 1000;
      open[kind] = null;
    }
  }
  return {
    frames: nFrames,
    windowMs: (end.ts - start.ts) / 1000,
    minorCount: gc.minor.count,
    minorMs: gc.minor.ms,
    majorCount: gc.major.count,
    majorMs: gc.major.ms,
    usPerFrame: ((gc.minor.ms + gc.major.ms) * 1000) / nFrames,
    events: seen,
  };
}

// ---- Summaries: per side median, spread and runs; with a base the delta ----

/** One figure from every run of each side. */
function metric(results, sides, pick, digits) {
  const m = {};
  for (const side of sides) {
    const v = results[side].map(pick);
    m[side] = v.length && v.every((x) => x != null) ? { median: round(median(v), digits), spread: round(Math.max(...v) - Math.min(...v), digits), runs: v.map((x) => round(x, digits)) } : null;
  }
  if (m.base && m.head) {
    m.delta = round(m.head.median - m.base.median, digits);
    m.deltaPct = m.base.median ? round((m.delta / m.base.median) * 100, 2) : null;
  }
  return m;
}

/** Named figures (functions, files) from every run's map: a name missing from a run counts 0 there. Largest first. */
function ranked(results, sides, field, digits, limit) {
  const names = new Set(sides.flatMap((s) => results[s].flatMap((r) => [...r[field].keys()])));
  const rows = [...names].map((name) => ({ name, ...metric(results, sides, (r) => r[field].get(name) ?? 0, digits) }));
  const size = (r) => Math.max(...sides.map((s) => r[s]?.median ?? 0));
  rows.sort((a, b) => size(b) - size(a));
  return limit ? rows.slice(0, limit) : rows;
}

const SUMMARY = {
  step: (results, sides) => ({
    frames: perBatch * batches,
    batch: perBatch,
    cpuMs: metric(results, sides, (r) => r.value, 4),
    callMs: metric(results, sides, (r) => r.call, 4),
  }),
  gpu: (results, sides) => {
    const names = [...new Set(sides.flatMap((s) => results[s].flatMap((r) => Object.keys(r.passes))))];
    // Frame (all passes) last; the rest in draw order as first seen.
    names.sort((a, b) => (a === 'frame') - (b === 'frame'));
    const passes = {};
    for (const name of names) {
      passes[name] = metric(results, sides, (r) => r.passes[name]?.median ?? null, 2);
      passes[name].meanPerFrame = metric(results, sides, (r) => r.passes[name]?.mean ?? null, 2);
    }
    const ripple = (r) => r.passes.ripple ?? { drawsPerFrame: 0, hist: {} };
    return {
      frames: perBatch * batches,
      passes,
      rippleSteps: metric(results, sides, (r) => ripple(r).drawsPerFrame, 3),
      rippleHist: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => ripple(r).hist)])),
      programs: Object.fromEntries(sides.map((s) => [s, results[s][0].programs])),
    };
  },
  profile: (results, sides) => ({
    frames: results[sides[0]][0].frames,
    sampleUs: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => round(r.sampleUs, 1))])),
    samples: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => r.samples)])),
    totals: Object.fromEntries(['all', 'advance', 'gc', 'program'].map((k) => [k, metric(results, sides, (r) => r.totals[k], 4)])),
    files: ranked(results, sides, 'files', 4),
    functions: ranked(results, sides, 'fns', 4, topN),
    raw: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => r.file)])),
  }),
  alloc: (results, sides) => ({
    frames: results[sides[0]][0].frames,
    samplingInterval: 256,
    bytesPerFrame: metric(results, sides, (r) => r.totals.all, 0),
    advanceBytesPerFrame: metric(results, sides, (r) => r.totals.advance, 0),
    files: ranked(results, sides, 'files', 0),
    functions: ranked(results, sides, 'fns', 0, topN),
    gc: Object.fromEntries(
      ['minorCount', 'minorMs', 'majorCount', 'majorMs', 'usPerFrame'].map((k) => [k, metric(results, sides, (r) => r.gc[k], k.endsWith('Count') ? 0 : 3)]),
    ),
    gcEvents: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => r.gc.events)])),
    raw: Object.fromEntries(sides.map((s) => [s, results[s].map((r) => r.file)])),
  }),
};

// ---- Tables on stderr ----

function header(q, what) {
  const lines = [`${q.query}  ${q.canvas.width}×${q.canvas.height} px${q.cells ? `, ${q.cells.cols}×${q.cells.rows} cells` : ''}, ${what}`];
  if (report.base) {
    lines.push(`base ${report.base.rev} (${report.base.sha.slice(0, 9)})  vs  head ${report.head.sha.slice(0, 9)}${report.head.dirty ? ' + uncommitted' : ''}${opt.head ? ` (${top})` : ''}`);
  } else if (opt.head) lines.push(`head ${report.head.sha.slice(0, 9)}${report.head.dirty ? ' + uncommitted' : ''} (${top})`);
  return lines;
}

/** Rows of [label, metric] → aligned columns; `fmt` prints one value. */
function table(head, rows, fmt, footer = []) {
  const base = !!report.base;
  const cols = base ? ['', 'base', '±', 'head', '±', 'Δ', 'Δ %'] : ['', 'median', '±'];
  const sign = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));
  const val = (t) => (t ? [fmt(t.median), fmt(t.spread)] : ['—', '']);
  const pct = (m) => (m.deltaPct == null ? '—' : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%`);
  const cells = rows.map(([label, m]) =>
    m === null ? [label, ...cols.slice(1).map(() => '')] : base ? [label, ...val(m.base), ...val(m.head), m.delta === undefined ? '—' : sign(m.delta), pct(m)] : [label, ...val(m.head)],
  );
  const w = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  return ['', ...head, '', line(cols), ...cells.map(line), ...footer].join('\n');
}

const SPREAD = '(± is the spread of the per-run values, max − min)';
/** A path relative to the working directory when it is inside it. */
const shown = (p) => (path.relative(process.cwd(), p).startsWith('..') ? p : path.relative(process.cwd(), p));
const TABLE = {
  step: (q) =>
    table(
      header(
        q,
        `${runs} runs × ${q.step.frames} frames (batches of ${q.step.batch}), CPU ms per frame, timer step ${q.timer.stepUs} µs${q.timer.isolated ? ' (isolated)' : ''}`,
      ),
      [
        ['cpu ms', q.step.cpuMs],
        ['call ms', q.step.callMs],
      ],
      (v) => v.toFixed(4),
      ['(cpu: between the first and last frame event of each koi.step batch; call: the whole call, its overhead included)', SPREAD],
    ),
  gpu: (q) =>
    table(
      header(q, `${runs} runs × ${q.gpu.frames} advancing frames, GPU µs per frame`),
      [...Object.entries(q.gpu.passes), ['ripple steps', q.gpu.rippleSteps]],
      (v) => v.toFixed(2),
      ['(per pass: median over frames of its per-frame sum; ripple steps: draws per frame, mean)', SPREAD],
    ),
  profile: (q) => {
    const p = q.profile;
    const rows = [
      ['all (idle excluded)', p.totals.all],
      ['  per-frame path (advance)', p.totals.advance],
      ['  (garbage collector)', p.totals.gc],
      ['  (program)', p.totals.program],
      ['files', null],
      ...p.files.map((f) => [`  ${f.name}`, f]),
      [`top ${p.functions.length} functions (self)`, null],
      ...p.functions.map((f) => [`  ${f.name}`, f]),
    ];
    return table(header(q, `${runs} runs × ${p.frames} frames, CPU profile (${p.sampleUs.head[0]} µs samples), self ms per frame`), rows, (v) => v.toFixed(4), [
      `(raw profiles: ${shown(path.dirname(p.raw.head[0]))}/)`,
      SPREAD,
    ]);
  },
  alloc: (q) => {
    const a = q.alloc;
    const rows = [
      ['allocated B/frame', a.bytesPerFrame],
      ['  per-frame path (advance)', a.advanceBytesPerFrame],
      [`GC on the main thread, per ${a.frames} frames`, null],
      ['  minor GCs', a.gc.minorCount],
      ['  minor GC ms', a.gc.minorMs],
      ['  major GCs', a.gc.majorCount],
      ['  major GC ms', a.gc.majorMs],
      ['  GC µs per frame', a.gc.usPerFrame],
      ['files (B/frame)', null],
      ...a.files.map((f) => [`  ${f.name}`, f]),
      [`top ${a.functions.length} functions (B/frame)`, null],
      ...a.functions.map((f) => [`  ${f.name}`, f]),
    ];
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
    return table(header(q, `${runs} runs × ${a.frames} frames, allocation (sampling every ${a.samplingInterval} B) and GC`), rows, fmt, [
      `(raw profiles: ${shown(path.dirname(a.raw.head[0]))}/)`,
      SPREAD,
    ]);
  },
};

// ---- Main (last: the tables and summaries above are consts) ----

try {
  if (!(width > 0 && height > 0 && dpr > 0)) throw new Error(`bad --size ${opt.size} or --dpr ${opt.dpr}`);
  if (!(runs >= 1 && batches >= 1 && perBatch >= 2 && perBatch <= 3600 && long >= 2 && topN >= 1)) {
    throw new Error('--runs, --batches, --long and --top must be ≥ 1, and --frames / --batches within 2…3600 (koi.step frames)');
  }
  if (!modes.length) throw new Error('nothing to measure: --no-step without --gpu, --profile or --alloc');
  if (!fs.existsSync(path.join(top, 'vite.demo.config.ts'))) throw new Error(`--head ${top}: not a checkout of this repo (no vite.demo.config.ts)`);
  report.head = { dir: top, sha: git(top, 'rev-parse', 'HEAD'), dirty: git(top, 'status', '--porcelain', '--untracked-files=no') !== '' };
  if (opt.base) {
    await withBaseWorktree(opt.base, (dir) => {
      report.base = { rev: opt.base, sha: git(process.cwd(), 'rev-parse', `${opt.base}^{commit}`) };
      return measureAll(dir);
    });
  } else await measureAll(null);
} catch (e) {
  report.errors.push(`cpu: ${e.message}`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
