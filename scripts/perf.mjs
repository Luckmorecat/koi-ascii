// GPU time per render pass of the demo, optionally against a base revision:
// "did this change cost GPU time compared with main?". Each run loads the page
// with ?debug, pins the viewport, reseeds with seed 42, steps 120 frames and
// calls koi.profile (timer queries around every draw). Starts its own Vite
// server(s) and stops them on exit. Prints a table on stderr and one JSON
// report on stdout; exits 1 on page errors. Run it through `npm run perf`
// (see shot.mjs for why --experimental-strip-types).
//
//   npm run perf -- [query…] [--base rev] [--runs 5] [--frames 400]
//                   [--size 1280x800] [--dpr 1]
//
//   query     demo URL query, one table per query, e.g. '?debug&time=fixed&phase=0.83'
//             (default '?debug'; debug is added if missing)
//   --base    also measure this revision (a branch, tag or sha) and print the delta.
//             It is checked out as a detached worktree in .claude/worktrees/base-<sha>-<pid>
//             (scripts/lib/base-worktree.mjs; node_modules hard-linked), served by
//             its own Vite server and removed afterwards, also on error or Ctrl-C.
//             Base and head runs alternate in one browser. The base needs koi.profile;
//             an older one fails with a message. Head is the working tree, uncommitted
//             changes included.
//   --runs    page loads per side; the table shows the median of the runs' medians
//             and their spread (max − min). A run with missing timer results or a
//             GPU disjoint event is retried, up to 3 tries.
//   --frames  timed redraws per run (koi.profile's frames)
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchGpu, startDemo } from './demo.mjs';
import { withBaseWorktree } from './lib/base-worktree.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    runs: { type: 'string', default: '5' },
    frames: { type: 'string', default: '400' },
    size: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1' },
  },
});
const [width, height] = opt.size.split('x').map(Number);
const dpr = +opt.dpr;
const runs = +opt.runs;
const frames = +opt.frames;
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
  frames,
  head: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' },
  base: null,
  queries: [],
  errors: [],
};
try {
  if (opt.base) {
    await withBaseWorktree(opt.base, (dir) => {
      report.base = { rev: opt.base, sha: git('rev-parse', `${opt.base}^{commit}`) };
      return measureAll(dir);
    });
  } else await measureAll(null);
} catch (e) {
  report.errors.push(`perf: ${e.message}`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;

/** Profiles every query on head, and on the base checkout at `baseDir` if given. */
async function measureAll(baseDir) {
  const demos = {};
  let browser;
  try {
    if (baseDir) demos.base = await startDemo(baseDir);
    demos.head = await startDemo(top);
    ({ browser, renderer: report.renderer } = await launchGpu());
    const sides = Object.keys(demos).sort(); // base, head

    /** One page load: the reproducible setup, then koi.profile. */
    async function measure(side, url) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      page.on('console', (m) => m.type() === 'error' && report.errors.push(`${side}: ${m.text()}`));
      page.on('pageerror', (e) => report.errors.push(`${side}: ${e.message}`));
      try {
        await page.goto(url);
        await page.waitForFunction(() => !!window.koi, null, { timeout: 15_000 });
        await page.evaluate(() => window.koi.ready);
        if (!(await page.evaluate(() => typeof window.koi.profile === 'function'))) {
          throw new Error(`${side} has no koi.profile (${side === 'base' ? `${opt.base} predates it; pick a newer --base` : 'stale page?'})`);
        }
        const r = await page.evaluate(
          async ({ width, height, dpr, frames }) => {
            await koi.setViewport({ width, height, dpr });
            await koi.reseed({ seed: 42 });
            await koi.step({ frames: 120 });
            return koi.profile({ frames });
          },
          { width, height, dpr, frames },
        );
        if (!r.gpuTimer) throw new Error('no EXT_disjoint_timer_query_webgl2 on this GPU: nothing to time');
        return r;
      } finally {
        await page.close();
      }
    }

    /**
     * measure(), retried while some timer results never came back (a busy GPU) or
     * a disjoint event (a clock or power-state change) made the times unreliable:
     * either would skew the medians.
     */
    async function measureComplete(side, url) {
      for (let attempt = 1; ; attempt++) {
        const r = await measure(side, url);
        const short = Object.entries(r.passes).filter(([, t]) => t.n < frames);
        if (!short.length && !r.disjoint) return r;
        if (attempt === 3) {
          const why = short.length
            ? `timer results still missing (${short.map(([pass, t]) => `${pass} ${t.n}/${frames}`).join(', ')})`
            : 'the last try hit a GPU disjoint event';
          throw new Error(`${side}: ${why} after 3 tries; is the GPU busy?`);
        }
      }
    }

    for (const query of queries) {
      const q = { query, urls: {}, cells: null, canvas: null, cpuMs: {}, passes: {} };
      report.queries.push(q);
      const results = Object.fromEntries(sides.map((s) => [s, []]));
      for (const side of sides) q.urls[side] = demos[side].url(query);
      for (let i = 0; i < runs; i++) {
        // Alternate which side goes first, so a clock ramping up favours neither.
        for (const side of i % 2 ? [...sides].reverse() : sides) {
          if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${query}  run ${i + 1}/${runs} ${side}`);
          const r = await measureComplete(side, q.urls[side]);
          results[side].push(r);
          q.cells = r.cells;
          q.canvas = { width: r.width, height: r.height };
        }
      }
      if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

      const names = [...new Set(sides.flatMap((s) => results[s].flatMap((r) => Object.keys(r.passes))))];
      // Frame (all passes) last; the rest in draw order as first seen.
      names.sort((a, b) => (a === 'frame') - (b === 'frame'));
      for (const name of names) {
        const entry = {};
        for (const side of sides) {
          // Every run of a side draws the same frame, so a pass is in all of its runs or none (a pass only one side has).
          const medians = results[side].flatMap((r) => (r.passes[name] ? [r.passes[name].median] : []));
          if (medians.length && medians.length < results[side].length) throw new Error(`${side}: pass ${name} is missing from some runs`);
          entry[side] = medians.length ? { median: r2(median(medians)), spread: r2(Math.max(...medians) - Math.min(...medians)), runs: medians } : null;
        }
        if (entry.base && entry.head) {
          entry.deltaUs = r2(entry.head.median - entry.base.median);
          entry.deltaPct = entry.base.median ? r2((entry.deltaUs / entry.base.median) * 100) : null;
        }
        q.passes[name] = entry;
      }
      for (const side of sides) q.cpuMs[side] = +median(results[side].map((r) => r.cpuMs)).toFixed(4);
      process.stderr.write(table(q) + '\n');
    }
  } finally {
    await browser?.close();
    for (const d of Object.values(demos)) await d.close();
  }
}

function table(q) {
  const base = !!report.base;
  const head = [
    `${q.query}  ${q.canvas.width}×${q.canvas.height} px, ${q.cells.cols}×${q.cells.rows} cells, ${runs} runs × ${frames} frames, GPU µs per frame`,
  ];
  if (base) head.push(`base ${report.base.rev} (${report.base.sha.slice(0, 9)})  vs  head ${report.head.sha.slice(0, 9)}${report.head.dirty ? ' + uncommitted' : ''}`);
  const cols = base ? ['pass', 'base', '±', 'head', '±', 'Δ µs', 'Δ %'] : ['pass', 'median', '±'];
  const sign = (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  // A pass only one side draws shows — on the other.
  const us = (t) => (t ? [t.median.toFixed(2), t.spread.toFixed(2)] : ['—', '']);
  const pct = (p) => (p.deltaPct == null ? '—' : `${p.deltaPct > 0 ? '+' : ''}${p.deltaPct.toFixed(1)}%`);
  const rows = Object.entries(q.passes).map(([name, p]) =>
    base ? [name, ...us(p.base), ...us(p.head), p.deltaUs === undefined ? '—' : sign(p.deltaUs), pct(p)] : [name, ...us(p.head)],
  );
  rows.push(base ? ['cpu ms', String(q.cpuMs.base), '', String(q.cpuMs.head), '', '', ''] : ['cpu ms', String(q.cpuMs.head), '']);
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  return ['', ...head, '', line(cols), ...rows.map(line), '(± is the spread of the per-run medians, max − min)'].join('\n');
}
