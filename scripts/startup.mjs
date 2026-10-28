// Start-up cost of the demo on the GPU, optionally against a base revision:
// "does this change make the pond slower to show its first frame?". Each run
// loads the page in up to four cache states and times, from inside the page,
// the WebGL2 compile + link of every program, the glyph atlas, the font wait
// and the first frame. Starts its own servers and browsers and stops them on
// exit. Prints a table per query and variant on stderr and one JSON report on
// stdout (per-run raw figures under queries[].raw); exits 1 on page errors.
// Run it through `npm run startup` (it imports test/browser/gpu.ts, hence
// --experimental-strip-types), and never beside another GPU tool:
//
//   npm run startup -- [query…] [--base rev] [--head dir]
//        [--runs 7] [--size 1280x800] [--dpr 1] [--serve build|dev]
//        [--mesa-cache fresh|off] [--no-prime] [--browser-arg flag]… [--bundle]
//
//   query   demo URL query, one set of tables per query (default '?debug'). Used as
//           given: without debug there is no window.koi, so no koi.ready row. ?debug also
//           builds the debug panel while mount() waits for the font; its first raster
//           keeps the GPU process busy, which adds ≈ 20 ms to font wait and to webgl2
//           context when cold. For the library alone, measure a query without debug
//           (e.g. '?seed=7').
//   --base  also measure this revision (a branch, tag or sha) and print the delta.
//           It is checked out as a detached worktree (scripts/lib/base-worktree.mjs)
//           and removed afterwards. Base and head runs alternate, each in its own browsers.
//   --head  the checkout measured as head (default: this one, uncommitted changes included)
//   --runs  runs per side; the tables show the median and spread (max − min) over them
//   --serve build (default): `vite build` of the demo into a temp dir, served by
//           `vite preview` cross-origin isolated (so performance.now() ticks in 5 µs, not
//           100 µs): one bundled script plus the lazy ?debug chunk, as deployed.
//           dev: the Vite dev server (scripts/demo.mjs): unbundled modules, so the
//           nav → … rows measure module loading, and 100 µs timer ticks.
//   --mesa-cache  fresh (default): each run's browsers get MESA_SHADER_CACHE_DIR = a new
//           empty temp dir; the cold table's footer says what Mesa put there (it is an
//           error if Mesa did not even create its index there). off: MESA_SHADER_CACHE_DISABLE
//           =true for every browser; an error if Mesa still writes the dir. No mesa-warm.
//           Seen with Mesa 26.2 + ANGLE GL-EGL: both are honoured, but Mesa only creates its
//           index and stores no shader in its disk cache under Chrome, so mesa-warm ≈ cold.
//   --no-prime  skip priming (see cold): the cold figures then include the browser's own
//           first WebGL use (compositor and driver start-up), not just the pond's.
//   --browser-arg  an extra Chromium flag, repeatable (e.g. --browser-arg=--disable-gpu-program-cache)
//   --bundle  also build the library (vite.lib.config.ts) of head (and base) into a temp
//           dir, no browser: dist/index.js raw / gzip -9 / brotli bytes, the share that is
//           GLSL text, and the same with GLSL comments and indentation stripped (an estimate).
//
// Variants, per run and side:
//   cold      a fresh browser on a fresh temp profile (empty Chrome caches) and an empty
//             Mesa cache dir. Unless --no-prime, it first shows a throwaway WebGL2 page with
//             its own trivial shaders, so the figures are a first visit in a browser that is
//             already up, not a browser cold start.
//   warm      a second page in the same browser: the GPU process's in-memory caches and
//             the HTTP cache are warm
//   mesaWarm  a fresh browser and profile on the cold run's Mesa cache dir (mesa-warm,
//             chrome-cold); only with --mesa-cache fresh
//   diskWarm  the cold run's profile in a restarted browser: Chrome's on-disk caches warm,
//             in-memory ones cold (a returning visitor after a browser restart)
// One unrecorded load per side comes first, so the OS file cache favours neither side.
//
// How it measures: an init script wraps page APIs before any page script runs; every
// figure is the page's performance.now(), in ms (absolute marks are since navigation start).
//   programs  WebGL2RenderingContext.prototype compileShader / getShaderParameter /
//             getShaderInfoLog / linkProgram / getProgramParameter / getProgramInfoLog /
//             useProgram / getUniformLocation. Chrome runs them in the GPU process: a call
//             returns at once and the page blocks at the first status query, so a program's
//             compile = its two shaders' compile calls + status queries, link = link call +
//             status query, first use = its first useProgram + getUniformLocation calls
//             before frame 1. A program is named by a declaration only its fragment source has
//             (MARKERS). programs (wall) runs from the first createShader to the last
//             link status query (the Renderer constructor's program builds).
//   mount     mount() is timed from when it puts its canvas into the page (the first canvas
//             appended to an element in the document; mount() does that right after parsing
//             its options); koi.ready from a setter on window.koi (the debug layer assigns it).
//   frame     first draw = end of the first drawArrays into the default framebuffer (frame 1's
//             ASCII pass); presented = the next requestAnimationFrame callback; gpu done = the
//             first rAF that sees a fence placed right after that draw signalled, i.e. the GPU
//             finished frame 1 (rAF granularity; vsync is off). Driver work the GPU process
//             does without blocking the page (shader variants built at the first draw) shows
//             only in gpu done.
//   atlas     buildAtlas: from its probe getContext('2d') to the end of the texImage2D that
//             uploads the atlas canvas; font wait = mount()'s document.fonts.load.
// Each load must report a hardware GL renderer (as gpu.ts refuses SwiftShader).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { startDemo } from './demo.mjs';
import { withBaseWorktree } from './lib/base-worktree.mjs';
import { assertGpu, gpuLaunchOptions } from '../test/browser/gpu.ts';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    runs: { type: 'string', default: '7' },
    size: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1' },
    serve: { type: 'string', default: 'build' },
    'mesa-cache': { type: 'string', default: 'fresh' },
    prime: { type: 'boolean', default: true },
    bundle: { type: 'boolean', default: false },
    'browser-arg': { type: 'string', multiple: true, default: [] },
  },
});
const [width, height] = opt.size.split('x').map(Number);
const dpr = +opt.dpr;
const runs = +opt.runs;
const mesaMode = opt['mesa-cache'];
if (!['build', 'dev'].includes(opt.serve)) throw new Error(`--serve ${opt.serve}: expected build or dev`);
if (!['fresh', 'off'].includes(mesaMode)) throw new Error(`--mesa-cache ${mesaMode}: expected fresh or off`);
if (!(runs >= 1) || !(width > 0) || !(height > 0) || !(dpr > 0)) throw new Error('--runs, --size and --dpr must be positive');
const queries = (positionals.length ? positionals : ['?debug']).map((q) => `?${q.replace(/^\?/, '')}`);

/**
 * First match wins. Each is a declaration only that fragment shader has (the fragment source also holds
 * common.glsl), not its header comment: the shipped bundle strips // comments from the GLSL.
 */
const MARKERS = [
  ['ripple', 'uniform float uDamping;'],
  ['scene', 'uniform int uOrder['],
  ['fly', 'uniform vec3 uFlyCol;'],
  ['glow', 'out vec4 oGlow;'],
  ['emission', 'out vec4 oEmit;'],
  ['ascii', 'uniform sampler2D uAtlas;'],
];
const VARIANTS = mesaMode === 'fresh' ? ['cold', 'warm', 'mesaWarm', 'diskWarm'] : ['cold', 'warm', 'diskWarm'];
const VARIANT_TITLE = {
  cold: `cold: fresh browser and profile, ${mesaMode === 'off' ? 'Mesa cache off' : 'empty Mesa cache dir'}`,
  warm: 'warm: second page in the same browser',
  mesaWarm: 'mesa-warm, chrome-cold: fresh browser and profile, Mesa cache dir of the cold run',
  diskWarm: "disk-warm: the cold run's profile in a restarted browser",
};
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** Table rows (and JSON metric keys), in order; per-program rows go after 'use'. */
const METRICS = [
  ['navDcl', 'nav → DOMContentLoaded'],
  ['navMount', 'nav → mount()'],
  ['navFirstDraw', 'nav → first draw'],
  ['navPresented', 'nav → presented'],
  ['navGpuDone', 'nav → gpu done'],
  ['mountFirstDraw', 'mount → first draw'],
  ['mountPresented', 'mount → presented'],
  ['mountKoiReady', 'mount → koi.ready'],
  ['fontWait', 'font wait'],
  ['context', 'webgl2 context'],
  ['programsWall', 'programs (wall)'],
  ['compile', '  Σ compile'],
  ['link', '  Σ link'],
  ['use', '  Σ first use'],
  ['atlas', 'glyph atlas'],
  ['atlasUpload', '  atlas upload'],
  ['programsFirstDraw', 'programs → first draw'],
  ['drawPresented', 'first draw → presented'],
  ['drawGpuDone', 'first draw → gpu done'],
];

const ISOLATED = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const headDir = git(path.resolve(opt.head ?? '.'), 'rev-parse', '--show-toplevel');

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

// Temp dirs (builds, Mesa caches) go when the process does, also on error.
const temps = new Set();
const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.add(dir);
  return dir;
};
const removeTemp = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  temps.delete(dir);
};
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
// Ctrl-C: exit through the 'exit' handlers (these and withBaseWorktree's).
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(130));

const report = {
  renderer: '',
  viewport: { width, height, dpr },
  runs,
  serve: opt.serve,
  mesaCache: mesaMode,
  primed: opt.prime,
  browserArgs: opt['browser-arg'],
  head: { dir: headDir, sha: git(headDir, 'rev-parse', 'HEAD'), dirty: git(headDir, 'status', '--porcelain', '--untracked-files=no') !== '' },
  base: null,
  queries: [],
  bundle: null,
  errors: [],
};
try {
  if (opt.base) {
    await withBaseWorktree(opt.base, (dir) => {
      report.base = { rev: opt.base, sha: git(dir, 'rev-parse', 'HEAD') };
      return measureAll(dir);
    });
  } else await measureAll(null);
} catch (e) {
  report.errors.push(`startup: ${e.message}`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;

async function measureAll(baseDir) {
  const dirs = baseDir ? { base: baseDir, head: headDir } : { head: headDir };
  const sides = Object.keys(dirs).sort(); // base, head
  if (opt.bundle) {
    report.bundle = {};
    for (const side of sides) report.bundle[side] = await bundleSize(dirs[side]);
    process.stderr.write(bundleTable(report.bundle) + '\n');
  }
  const servers = {};
  try {
    for (const side of sides) servers[side] = await serve(dirs[side]);
    for (const query of queries) {
      const urls = Object.fromEntries(sides.map((s) => [s, servers[s].url(query)]));
      const q = { query, urls, canvas: null, atlas: null, mesaCacheWritten: {}, variants: {}, raw: {} };
      report.queries.push(q);
      const progress = (s) => process.stderr.isTTY && process.stderr.write(`\r\x1b[K${query}  ${s}`);
      progress('warm-up');
      await warmUp(sides.map((s) => urls[s]));
      const results = Object.fromEntries(sides.map((s) => [s, []]));
      for (let i = 0; i < runs; i++) {
        // Alternate which side goes first, so drift over the session favours neither.
        for (const side of i % 2 ? [...sides].reverse() : sides) {
          progress(`run ${i + 1}/${runs} ${side}`);
          const r = await runOnce(side, urls[side]);
          results[side].push(r);
          q.canvas = r.cold.canvas;
          q.atlas = r.cold.atlas && { width: r.cold.atlas.width, height: r.cold.atlas.height };
        }
      }
      if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
      q.raw = results;
      for (const side of sides) {
        const written = results[side].map((r) => r.mesaCache);
        q.mesaCacheWritten[side] = Object.fromEntries(['files', 'entries', 'bytes'].map((k) => [k, median(written.map((w) => w[k]))]));
        if (mesaMode === 'fresh' && written.some((w) => !w.files)) {
          report.errors.push(`${side}: Mesa wrote nothing into MESA_SHADER_CACHE_DIR in some runs; it is not using that cache dir, so "cold" may not be cold`);
        }
        if (mesaMode === 'off' && written.some((w) => w.files)) {
          report.errors.push(`${side}: Mesa wrote ${written.map((w) => w.files).join('/')} files with MESA_SHADER_CACHE_DISABLE=true; it ignores the switch`);
        }
      }
      for (const variant of VARIANTS) {
        q.variants[variant] = summarize(sides, variant, results);
        process.stderr.write(table(q, variant) + '\n');
      }
    }
  } finally {
    for (const s of Object.values(servers)) await s.close();
  }
}

/** The demo of the checkout at `dir`, built and previewed, or on the dev server. */
async function serve(dir) {
  if (opt.serve === 'dev') return startDemo(dir);
  const outDir = tempDir('koi-startup-demo-');
  const configFile = path.join(dir, 'vite.demo.config.ts');
  const root = path.join(dir, 'demo');
  await build({ configFile, root, logLevel: 'error', build: { outDir, emptyOutDir: true } });
  const server = await preview({
    configFile,
    root,
    logLevel: 'error',
    build: { outDir },
    // Cross-origin isolated, so performance.now() ticks in 5 µs rather than 100 µs.
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false, headers: ISOLATED },
  });
  return {
    url: (query) => new URL(query.replace(/^(?=[^?/])/, '?'), server.resolvedUrls.local[0]).href,
    close: async () => {
      await server.close();
      removeTemp(outDir);
    },
  };
}

/** Chromium launch options (gpu.ts) with Mesa's disk cache in `mesaDir` (or off). */
function launchOptions(mesaDir) {
  const env = { ...process.env, MESA_SHADER_CACHE_DIR: mesaDir };
  for (const k of ['MESA_SHADER_CACHE_DISABLE', 'MESA_GLSL_CACHE_DISABLE', 'MESA_GLSL_CACHE_DIR']) delete env[k];
  if (mesaMode === 'off') env.MESA_SHADER_CACHE_DISABLE = 'true';
  return { ...gpuLaunchOptions, args: [...gpuLaunchOptions.args, ...opt['browser-arg']], env };
}

/** A fresh browser (temp profile, incognito contexts) on the GPU; throws if it renders on the CPU. */
async function launch(mesaDir) {
  const browser = await chromium.launch(launchOptions(mesaDir));
  try {
    report.renderer ||= await assertGpu(browser);
    if (opt.prime) await prime(browser);
    return browser;
  } catch (e) {
    await browser.close();
    throw e;
  }
}

/**
 * A browser on the profile in `profile`, as one persistent context (so the profile keeps
 * Chrome's on-disk caches for a restart). It has no Browser object for assertGpu: load()
 * checks the renderer the pond itself reports.
 */
async function launchProfile(profile, mesaDir) {
  const context = await chromium.launchPersistentContext(profile, { ...launchOptions(mesaDir), viewport: { width, height }, deviceScaleFactor: dpr });
  try {
    if (opt.prime) await prime(context);
    return context;
  } catch (e) {
    await context.close();
    throw e;
  }
}

/** A throwaway WebGL2 page (own trivial shaders) in `target` (a browser or context): the browser's first WebGL use is not charged to the pond. */
async function prime(target) {
  const page = await target.newPage();
  try {
    await page.setContent(`<p>prime</p><canvas width="64" height="64"></canvas><script>
      const gl = document.querySelector('canvas').getContext('webgl2');
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, '#version 300 es\\n' + s); gl.compileShader(x); return x; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, 'void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0, 0.0, 1.0); }'));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; out vec4 o; void main() { o = vec4(0.2, 0.4, 0.6, 1.0); }'));
      gl.linkProgram(p);
      gl.useProgram(p);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(() => requestAnimationFrame(() => (window.primed = gl.getProgramParameter(p, gl.LINK_STATUS))));
    </script>`);
    await page.waitForFunction(() => window.primed, null, { timeout: 15_000 });
  } finally {
    await page.close();
  }
}

/** Files and bytes under a Mesa cache dir; entries = files other than its index (cached shaders). */
function dirSize(dir) {
  let files = 0;
  let bytes = 0;
  let entries = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    files++;
    if (e.name !== 'index') entries++;
    bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
  }
  return { files, entries, bytes };
}

/** One unrecorded cold load per side. */
async function warmUp(urls) {
  const mesaDir = tempDir('koi-startup-mesa-');
  const browser = await launch(mesaDir);
  try {
    for (const url of urls) await load(browser, null, url);
  } finally {
    await browser.close();
    removeTemp(mesaDir);
  }
}

/** One run of one side: cold and warm, mesa-warm (with a Mesa cache), disk-warm. */
async function runOnce(side, url) {
  const mesaDir = tempDir('koi-startup-mesa-');
  const profile = tempDir('koi-startup-profile-');
  try {
    const out = {};
    let context = await launchProfile(profile, mesaDir);
    try {
      out.cold = await load(context, side, url);
      out.warm = await load(context, side, url);
    } finally {
      await context.close();
    }
    out.mesaCache = dirSize(mesaDir);
    if (mesaMode === 'fresh') {
      const browser = await launch(mesaDir);
      try {
        out.mesaWarm = await load(browser, side, url);
      } finally {
        await browser.close();
      }
    }
    context = await launchProfile(profile, mesaDir);
    try {
      out.diskWarm = await load(context, side, url);
    } finally {
      await context.close();
    }
    for (const v of VARIANTS) out[v].metrics = derive(out[v]);
    return out;
  } finally {
    removeTemp(mesaDir);
    removeTemp(profile);
  }
}

/**
 * One page load in `target` (a browser context, or a browser: then a new context of
 * its own), instrumented from before the first script runs. `side` null: unrecorded.
 */
async function load(target, side, url) {
  const own = typeof target.newContext === 'function';
  const context = own ? await target.newContext({ viewport: { width, height }, deviceScaleFactor: dpr }) : target;
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(instrument);
    await page.goto(url);
    const debug = new URL(url).searchParams.has('debug');
    await page.waitForFunction(
      (debug) => {
        const m = window.__startup.marks;
        const failed = document.getElementById('fallback')?.hidden === false || 'koiFailed' in m;
        return failed || ('presented' in m && 'gpuDone' in m && (!debug || 'koiReady' in m));
      },
      debug,
      { timeout: 30_000 },
    );
    if (await page.evaluate(() => document.getElementById('fallback')?.hidden === false)) {
      throw new Error(`the pond did not start (fallback shown): ${errors.join(' | ') || 'no error logged'}`);
    }
    const result = await page.evaluate((markers) => {
      const S = window.__startup;
      const FRAGMENT_SHADER = 0x8b30;
      const seen = {};
      const programs = S.programs.map((p, i) => {
        const fs = p.shaders.find((s) => s.type === FRAGMENT_SHADER);
        let label = (fs && markers.find(([, m]) => fs.src.includes(m))?.[0]) ?? `program${i}`;
        seen[label] = (seen[label] ?? 0) + 1;
        if (seen[label] > 1) label += `#${seen[label]}`;
        const compileCallMs = p.shaders.reduce((s, x) => s + x.compileMs, 0);
        const compileStatusMs = p.shaders.reduce((s, x) => s + x.statusMs, 0);
        return {
          label,
          compileMs: compileCallMs + compileStatusMs,
          compileCallMs,
          compileStatusMs,
          linkMs: p.linkMs + p.statusMs,
          linkCallMs: p.linkMs,
          linkStatusMs: p.statusMs,
          useMs: p.useMs + p.uniformMs,
          useProgramMs: p.useMs,
          uniformMs: p.uniformMs,
          uniforms: p.uniforms,
          firstDrawCallMs: p.drawMs,
          fragmentChars: fs?.src.length ?? 0,
        };
      });
      const nav = performance.getEntriesByType('navigation')[0];
      const res = performance.getEntriesByType('resource');
      const scripts = res.filter((r) => r.initiatorType === 'script' || /\.(m?[jt]s)(\?|$)/.test(r.name));
      const canvas = document.querySelector('#pond canvas');
      return {
        marks: S.marks,
        renderer: S.renderer,
        font: S.font,
        atlas: S.atlas,
        programs,
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        // performance.now() resolution: 5 µs cross-origin isolated, else 100 µs.
        timerMs: crossOriginIsolated ? 0.005 : 0.1,
        nav: {
          responseEnd: nav?.responseEnd ?? null,
          domInteractive: nav?.domInteractive ?? null,
          domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
          load: nav?.loadEventEnd ?? null,
          resources: res.length,
          scripts: scripts.length,
          scriptBytes: scripts.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
          transferBytes: res.reduce((s, r) => s + (r.transferSize || 0), 0),
        },
      };
    }, MARKERS);
    // The same refusal as gpu.ts, from what the pond itself was given.
    if (!result.renderer || SOFTWARE.test(result.renderer)) throw new Error(`Refusing to measure software GL: renderer="${result.renderer}"`);
    report.renderer ||= result.renderer;
    return result;
  } finally {
    await page.close();
    if (own) await context.close();
    if (side) report.errors.push(...errors.map((e) => `${side}: ${e}`));
  }
}

/** Runs in the page before any of its scripts (addInitScript); records into window.__startup. */
function instrument() {
  const now = () => performance.now();
  const S = { marks: {}, programs: [], font: null, atlas: null, renderer: null };
  Object.defineProperty(window, '__startup', { value: S });
  const mark = (k, t = now()) => {
    if (!(k in S.marks)) S.marks[k] = t;
  };
  const wrap = (proto, name, make) => {
    const orig = proto?.[name];
    if (typeof orig === 'function') proto[name] = make(orig);
  };
  const timed = (orig, self, args) => {
    const t = now();
    const r = orig.apply(self, args);
    return [r, now() - t];
  };
  const framed = () => 'firstDraw' in S.marks;

  // mount(): the first canvas put into an element of the document.
  const inserted = (parent, nodes) => {
    if (!('mount' in S.marks) && parent.isConnected && nodes.some((n) => n instanceof HTMLCanvasElement)) mark('mount');
  };
  wrap(Element.prototype, 'append', (o) => function (...a) {
    inserted(this, a);
    return o.apply(this, a);
  });
  wrap(Node.prototype, 'appendChild', (o) => function (n) {
    inserted(this, [n]);
    return o.call(this, n);
  });

  // mount()'s font wait.
  wrap(globalThis.FontFaceSet?.prototype, 'load', (o) => function (...a) {
    const t = now();
    const p = o.apply(this, a);
    if (!S.font) {
      const f = (S.font = { spec: String(a[0]), start: t, end: null });
      const done = () => (f.end = now());
      p.then(done, done);
    }
    return p;
  });

  // ?debug: koi.ready.
  let koi;
  Object.defineProperty(window, 'koi', {
    configurable: true,
    enumerable: true,
    get: () => koi,
    set(v) {
      koi = v;
      mark('koiSet');
      Promise.resolve(v?.ready).then(
        () => mark('koiReady'),
        () => mark('koiFailed'),
      );
    },
  });

  // Contexts: the WebGL2 one, and the 2D ones buildAtlas makes (probe, then the atlas).
  const ctx2d = [];
  wrap(HTMLCanvasElement.prototype, 'getContext', (o) => function (type, ...a) {
    const t = now();
    const c = o.call(this, type, ...a);
    if (type === 'webgl2' && !('contextEnd' in S.marks)) {
      S.marks.contextStart = t;
      mark('contextEnd');
    } else if (type === '2d') ctx2d.push(t);
    return c;
  });

  const P = WebGL2RenderingContext.prototype;
  // The GL renderer the pond reads (mount() asks for it), to refuse software GL.
  wrap(P, 'getParameter', (o) => function (pname) {
    const v = o.call(this, pname);
    if (pname === 0x9246 /* UNMASKED_RENDERER_WEBGL */ || (pname === this.RENDERER && !S.renderer)) S.renderer = String(v);
    return v;
  });
  const shaders = new WeakMap();
  const programs = new WeakMap();
  const states = new WeakMap();
  const state = (gl) => {
    let s = states.get(gl);
    if (!s) states.set(gl, (s = { fb: null, prog: null }));
    return s;
  };
  wrap(P, 'createShader', (o) => function (type) {
    mark('firstShader');
    const sh = o.call(this, type);
    if (sh) shaders.set(sh, { type, src: '', compileMs: 0, statusMs: 0 });
    return sh;
  });
  wrap(P, 'shaderSource', (o) => function (sh, src) {
    const r = shaders.get(sh);
    if (r) r.src = String(src);
    return o.call(this, sh, src);
  });
  wrap(P, 'compileShader', (o) => function (sh) {
    const [res, dt] = timed(o, this, [sh]);
    const r = shaders.get(sh);
    if (r) r.compileMs += dt;
    return res;
  });
  for (const name of ['getShaderParameter', 'getShaderInfoLog']) {
    wrap(P, name, (o) => function (sh, ...a) {
      const [res, dt] = timed(o, this, [sh, ...a]);
      const r = shaders.get(sh);
      if (r) r.statusMs += dt;
      return res;
    });
  }
  wrap(P, 'createProgram', (o) => function () {
    const p = o.call(this);
    if (p) {
      const rec = { shaders: [], linkMs: 0, statusMs: 0, useMs: 0, used: false, uniformMs: 0, uniforms: 0, drawMs: null };
      programs.set(p, rec);
      S.programs.push(rec);
    }
    return p;
  });
  wrap(P, 'attachShader', (o) => function (p, sh) {
    const rec = programs.get(p);
    const r = shaders.get(sh);
    if (rec && r) rec.shaders.push(r);
    return o.call(this, p, sh);
  });
  wrap(P, 'linkProgram', (o) => function (p) {
    const [res, dt] = timed(o, this, [p]);
    const rec = programs.get(p);
    if (rec) rec.linkMs += dt;
    return res;
  });
  for (const name of ['getProgramParameter', 'getProgramInfoLog']) {
    wrap(P, name, (o) => function (p, ...a) {
      const [res, dt] = timed(o, this, [p, ...a]);
      const rec = programs.get(p);
      if (rec) rec.statusMs += dt;
      if (rec && !framed()) S.marks.programsDone = now();
      return res;
    });
  }
  wrap(P, 'useProgram', (o) => function (p) {
    const [res, dt] = timed(o, this, [p]);
    state(this).prog = p;
    const rec = p && programs.get(p);
    if (rec && !rec.used && !framed()) {
      rec.used = true;
      rec.useMs += dt;
    }
    return res;
  });
  wrap(P, 'getUniformLocation', (o) => function (p, name) {
    const [res, dt] = timed(o, this, [p, name]);
    const rec = programs.get(p);
    if (rec && !framed()) {
      rec.uniformMs += dt;
      rec.uniforms++;
    }
    return res;
  });
  wrap(P, 'bindFramebuffer', (o) => function (target, fb) {
    if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) state(this).fb = fb;
    return o.call(this, target, fb);
  });
  wrap(P, 'texImage2D', (o) => function (...a) {
    const src = a[a.length - 1];
    if (S.atlas || !(src instanceof HTMLCanvasElement)) return o.apply(this, a);
    // buildAtlas is synchronous: its two getContext('2d') calls are the last two.
    const t = now();
    const res = o.apply(this, a);
    S.atlas = { start: ctx2d.length >= 2 ? ctx2d[ctx2d.length - 2] : t, uploadStart: t, uploadEnd: now(), width: src.width, height: src.height };
    return res;
  });
  wrap(P, 'drawArrays', (o) => function (...a) {
    const s = state(this);
    const [res, dt] = timed(o, this, a);
    const rec = s.prog && programs.get(s.prog);
    if (rec && rec.drawMs === null) rec.drawMs = dt;
    if (s.fb === null && !framed()) {
      mark('firstDraw');
      requestAnimationFrame(() => mark('presented'));
      const gl = this;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      const poll = () => {
        if (!sync || gl.isContextLost()) return mark('gpuDone', NaN);
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) return requestAnimationFrame(poll);
        mark('gpuDone');
        gl.deleteSync(sync);
      };
      requestAnimationFrame(poll);
    }
    return res;
  });
}

/** One load's figures in ms (null where it has none, e.g. koi.ready without ?debug). */
function derive(load) {
  const m = load.marks;
  const at = (k) => (Number.isFinite(m[k]) ? m[k] : null);
  const span = (a, b) => (a == null || b == null ? null : b - a);
  const sum = (k) => load.programs.reduce((s, p) => s + p[k], 0);
  const out = {
    navDcl: load.nav.domContentLoaded,
    navMount: at('mount'),
    navFirstDraw: at('firstDraw'),
    navPresented: at('presented'),
    navGpuDone: at('gpuDone'),
    mountFirstDraw: span(at('mount'), at('firstDraw')),
    mountPresented: span(at('mount'), at('presented')),
    mountKoiReady: span(at('mount'), at('koiReady')),
    fontWait: load.font ? span(load.font.start, load.font.end) : null,
    context: span(at('contextStart'), at('contextEnd')),
    programsWall: span(at('firstShader'), at('programsDone')),
    compile: sum('compileMs'),
    link: sum('linkMs'),
    use: sum('useMs'),
    atlas: load.atlas ? load.atlas.uploadEnd - load.atlas.start : null,
    atlasUpload: load.atlas ? load.atlas.uploadEnd - load.atlas.uploadStart : null,
    programsFirstDraw: span(at('programsDone'), at('firstDraw')),
    drawPresented: span(at('firstDraw'), at('presented')),
    drawGpuDone: span(at('firstDraw'), at('gpuDone')),
  };
  for (const p of load.programs) out[`prog:${p.label}`] = p.compileMs + p.linkMs + p.useMs;
  for (const k of Object.keys(out)) out[k] = r3(out[k]);
  return out;
}

/** Per metric and side: median, spread and the runs; with a base, the delta. */
function summarize(sides, variant, results) {
  const keys = [];
  for (const side of sides) for (const r of results[side]) for (const k of Object.keys(r[variant].metrics)) if (!keys.includes(k)) keys.push(k);
  const progs = keys.filter((k) => k.startsWith('prog:'));
  const order = METRICS.flatMap(([k]) => (k === 'use' ? [k, ...progs] : [k]));
  const out = {};
  for (const k of order) {
    const entry = {};
    for (const side of sides) {
      const vals = results[side].map((r) => r[variant].metrics[k]).filter((v) => v != null);
      entry[side] = vals.length ? { median: r3(median(vals)), spread: r3(Math.max(...vals) - Math.min(...vals)), runs: vals } : null;
    }
    if (entry.base && entry.head) {
      entry.deltaMs = r3(entry.head.median - entry.base.median);
      entry.deltaPct = entry.base.median ? Math.round((entry.deltaMs / entry.base.median) * 1000) / 10 : null;
    }
    out[k] = entry;
  }
  return out;
}

function table(q, variant) {
  const base = !!report.base;
  const metrics = q.variants[variant];
  const label = (k) => (k.startsWith('prog:') ? `    ${k.slice(5)}` : METRICS.find(([m]) => m === k)[1]);
  const head = [
    `${q.query}  ${VARIANT_TITLE[variant]}`,
    `${q.canvas ? `${q.canvas.width}×${q.canvas.height} px canvas, ` : ''}${runs} runs, serve ${opt.serve}, ms`,
  ];
  if (base) head.push(`base ${report.base.rev} (${report.base.sha.slice(0, 9)})  vs  head ${report.head.sha.slice(0, 9)}${report.head.dirty ? ' + uncommitted' : ''}`);
  const cols = base ? ['', 'base', '±', 'head', '±', 'Δ ms', 'Δ %'] : ['', 'median', '±'];
  const ms = (t) => (t ? [t.median.toFixed(2), t.spread.toFixed(2)] : ['—', '']);
  const sign = (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const pct = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);
  const rows = Object.entries(metrics)
    .filter(([, e]) => e.base || e.head)
    .map(([k, e]) => (base ? [label(k), ...ms(e.base), ...ms(e.head), e.deltaMs == null ? '—' : sign(e.deltaMs), pct(e.deltaPct)] : [label(k), ...ms(e.head)]));
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  const foot = ['(± is the spread over the runs, max − min; "first use" is useProgram + getUniformLocation before frame 1)'];
  if (variant === 'cold') {
    const w = Object.entries(q.mesaCacheWritten).map(([s, v]) => `${s} ${v.files} files, ${v.entries} shader entries, ${(v.bytes / 1024).toFixed(0)} KiB`);
    const none = mesaMode === 'fresh' && Object.values(q.mesaCacheWritten).every((v) => !v.entries);
    foot.push(`Mesa disk cache dir after the cold + warm loads (median): ${w.join('; ')}${mesaMode === 'off' ? ' (MESA_SHADER_CACHE_DISABLE=true)' : ''}`);
    if (none) foot.push('(Mesa stored no shaders on disk: its disk cache is not in play under Chrome, so mesa-warm is a second cold sample)');
  }
  return ['', ...head, '', line(cols), ...rows.map(line), ...foot].join('\n');
}

/** The library build of the checkout at `dir`: sizes, and how much of it is GLSL. */
async function bundleSize(dir) {
  const outDir = tempDir('koi-startup-lib-');
  try {
    await build({ configFile: path.join(dir, 'vite.lib.config.ts'), root: dir, logLevel: 'error', build: { outDir, emptyOutDir: true } });
    const js = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
    // Each ?raw shader is inlined as one JSON-style string literal.
    const shaderDir = path.join(dir, 'src', 'shaders');
    const files = fs
      .readdirSync(shaderDir, { recursive: true })
      .filter((f) => /\.(frag|vert|glsl)$/.test(f))
      .map((f) => fs.readFileSync(path.join(shaderDir, f), 'utf8'));
    const literals = files.map((src) => ({ src, lit: JSON.stringify(src) })).filter(({ lit }) => js.includes(lit));
    const swap = (fn) => literals.reduce((s, { src, lit }) => s.replace(lit, () => JSON.stringify(fn(src))), js);
    const sizes = (text) => {
      const buf = Buffer.from(text);
      return {
        raw: buf.length,
        gzip: zlib.gzipSync(buf, { level: 9 }).length,
        brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
      };
    };
    const all = sizes(js);
    const noGlsl = sizes(swap(() => ''));
    // What-if: GLSL with comments, indentation and blank lines removed (line structure kept for #defines).
    const strip = (src) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
    const stripped = sizes(swap(strip));
    const share = (k) => Math.round(((all[k] - noGlsl[k]) / all[k]) * 1000) / 10;
    return {
      file: 'dist/index.js',
      ...all,
      glsl: {
        files: files.length,
        inlined: literals.length,
        rawBytes: literals.reduce((s, { lit }) => s + Buffer.byteLength(lit), 0),
        sharePct: { raw: share('raw'), gzip: share('gzip'), brotli: share('brotli') },
      },
      withoutGlsl: noGlsl,
      glslCommentsStripped: stripped,
    };
  } finally {
    removeTemp(outDir);
  }
}

function bundleTable(b) {
  const sides = Object.keys(b);
  const kb = (v) => (v / 1024).toFixed(1);
  const rows = [['', ...sides.flatMap((s) => [`${s} raw`, 'gzip -9', 'brotli'])]];
  const add = (name, pick) => rows.push([name, ...sides.flatMap((s) => ['raw', 'gzip', 'brotli'].map((k) => kb(pick(b[s])[k])))]);
  add('dist/index.js', (x) => x);
  add('  without GLSL', (x) => x.withoutGlsl);
  add('  GLSL stripped', (x) => x.glslCommentsStripped);
  rows.push(['  GLSL share %', ...sides.flatMap((s) => ['raw', 'gzip', 'brotli'].map((k) => b[s].glsl.sharePct[k].toFixed(1)))]);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  const cover = sides.map((s) => `${s} ${b[s].glsl.inlined}/${b[s].glsl.files}`).join(', ');
  return ['', 'library bundle, KiB (no browser)', '', ...rows.map(line), `(shader files found inlined: ${cover}; "GLSL stripped" = comments and indentation removed, an estimate)`].join('\n');
}
