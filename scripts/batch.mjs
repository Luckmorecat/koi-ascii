// Whole-batch GPU time per advancing frame of the demo, optionally against a
// base revision: "did the whole frame get cheaper, not just the timed draws?".
// `npm run perf` times each draw on its own, so its frame row is a sum of draws:
// it misses GPU time between and around them (target switches, clears, resolves)
// and can count overlapping draws twice. Here one timer query spans a whole
// batch of koi.step frames instead. Each run loads the page with ?debug, pins
// the viewport, reseeds with seed 42 and steps 120 untimed frames, then times
// --batches batches of koi.step({frames: per}), each inside one TIME_ELAPSED
// query, with a setTimeout(0) between batches (untimed). A run's value is the
// median over its batches of batch µs / per. Starts its own Vite server(s) and
// stops them on exit. Prints a table on stderr and one JSON report on stdout,
// shaped like perf's with one pass, 'batch'; exits 1 on page errors. Run it
// through `npm run batch` (see shot.mjs for why --experimental-strip-types).
//
//   npm run batch -- [query…] [--base rev] [--runs 7] [--batches 20] [--per 30]
//                    [--size 1280x800] [--dpr 1]
//
//   query      demo URL query, one table per query (default '?debug'; debug is added if missing)
//   --base     also measure this revision and print the delta, checked out and served as
//              `npm run perf --base` does. Base and head runs alternate in one browser, and
//              which side goes first alternates per run. The base needs koi.step.
//   --runs     page loads per side; the table shows the median of the runs' values and their
//              spread (max − min). A run with missing results, a disjoint event or a GL error
//              is retried, up to 3 tries.
//   --batches  timed batches per run
//   --per      koi.step frames per batch
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchGpu, startDemo } from './demo.mjs';
import { withBaseWorktree } from './lib/base-worktree.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    runs: { type: 'string', default: '7' },
    batches: { type: 'string', default: '20' },
    per: { type: 'string', default: '30' },
    size: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1' },
  },
});
const [width, height] = opt.size.split('x').map(Number);
const dpr = +opt.dpr;
const runs = +opt.runs;
const batches = +opt.batches;
const per = +opt.per;
const queries = (positionals.length ? positionals : ['?debug']).map((q) => {
  const bare = q.replace(/^\?/, '');
  return /(^|&)debug(=|&|$)/.test(bare) ? `?${bare}` : `?debug${bare ? `&${bare}` : ''}`;
});

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const top = git('rev-parse', '--show-toplevel');

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r2 = (v) => Math.round(v * 100) / 100;

const report = {
  renderer: '',
  viewport: { width, height, dpr },
  runs,
  batches,
  per,
  head: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' },
  base: null,
  queries: [],
  errors: [],
  retries: [],
};
try {
  if (opt.base) {
    await withBaseWorktree(opt.base, (dir) => {
      report.base = { rev: opt.base, sha: git('rev-parse', `${opt.base}^{commit}`) };
      return measureAll(dir);
    });
  } else await measureAll(null);
} catch (e) {
  report.errors.push(`batch: ${e.message}`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;

async function measureAll(baseDir) {
  const demos = {};
  let browser;
  try {
    if (baseDir) demos.base = await startDemo(baseDir);
    demos.head = await startDemo(top);
    ({ browser, renderer: report.renderer } = await launchGpu());
    const sides = Object.keys(demos);

    async function measure(side, url) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      page.on('console', (m) => m.type() === 'error' && report.errors.push(`${side}: ${m.text()}`));
      page.on('pageerror', (e) => report.errors.push(`${side}: ${e.message}`));
      try {
        await page.goto(url);
        await page.waitForFunction(() => !!window.koi, null, { timeout: 15_000 });
        await page.evaluate(() => window.koi.ready);
        return await page.evaluate(
          async ({ width, height, dpr, batches, per }) => {
            await koi.setViewport({ width, height, dpr });
            await koi.reseed({ seed: 42 });
            await koi.step({ frames: 120 });
            const canvas = document.querySelector('#pond canvas') ?? document.querySelector('canvas');
            const gl = canvas.getContext('webgl2');
            const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if (!ext) return { gpuTimer: false };
            const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
            await sleep(0);
            gl.getError();
            gl.getParameter(ext.GPU_DISJOINT_EXT); // reading clears it
            const qs = [];
            for (let b = 0; b < batches; b++) {
              const q = gl.createQuery();
              gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
              await koi.step({ frames: per });
              gl.endQuery(ext.TIME_ELAPSED_EXT);
              qs.push(q);
              await sleep(0);
            }
            const glError = gl.getError();
            const deadline = performance.now() + 3000;
            const us = [];
            for (const q of qs) {
              while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && performance.now() < deadline) await sleep(10);
              if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) us.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e3 / per);
              gl.deleteQuery(q);
            }
            const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
            return { gpuTimer: true, us, disjoint, glError, canvas: { width: canvas.width, height: canvas.height } };
          },
          { width, height, dpr, batches, per },
        );
      } finally {
        await page.close();
      }
    }

    async function measureComplete(side, url) {
      for (let attempt = 1; ; attempt++) {
        const r = await measure(side, url);
        if (!r.gpuTimer) throw new Error('no EXT_disjoint_timer_query_webgl2');
        const bad = r.us.length < batches ? `missing ${batches - r.us.length}` : r.disjoint ? 'disjoint' : r.glError ? `glError ${r.glError}` : '';
        if (!bad) return r;
        report.retries.push(`${side} ${url}: ${bad} (attempt ${attempt})`);
        if (attempt === 3) throw new Error(`${side}: ${bad} after 3 tries`);
      }
    }

    for (const query of queries) {
      const q = { query, urls: {}, canvas: null, passes: {}, perBatch: {} };
      report.queries.push(q);
      const results = Object.fromEntries(sides.map((side) => [side, []]));
      for (const side of sides) q.urls[side] = demos[side].url(query);
      for (let i = 0; i < runs; i++) {
        for (const side of i % 2 ? [...sides].reverse() : sides) {
          const r = await measureComplete(side, q.urls[side]);
          results[side].push(r);
          q.canvas = r.canvas;
        }
      }
      const entry = {};
      for (const side of sides) {
        const meds = results[side].map((r) => median(r.us));
        entry[side] = { median: r2(median(meds)), spread: r2(Math.max(...meds) - Math.min(...meds)), runs: meds.map(r2) };
        q.perBatch[side] = results[side].map((r) => r.us.map(r2));
      }
      q.passes.batch = entry;
      const h = entry.head;
      let text = `${query}  ${q.canvas.width}x${q.canvas.height}  whole-batch GPU µs/frame (${runs} runs × ${batches} batches × ${per} frames)\n`;
      if (entry.base) {
        const b = entry.base;
        entry.deltaUs = r2(h.median - b.median);
        entry.deltaPct = r2((entry.deltaUs / b.median) * 100);
        text += `  base ${b.median.toFixed(2)} ±${b.spread.toFixed(2)}  head ${h.median.toFixed(2)} ±${h.spread.toFixed(2)}  Δ ${entry.deltaUs.toFixed(2)} (${entry.deltaPct}%)\n` +
          `  base runs ${b.runs.join(' ')}\n`;
      } else text += `  head ${h.median.toFixed(2)} ±${h.spread.toFixed(2)}\n`;
      process.stderr.write(`${text}  head runs ${h.runs.join(' ')}\n`);
    }
  } finally {
    await browser?.close();
    for (const d of Object.values(demos)) await d.close();
  }
}
