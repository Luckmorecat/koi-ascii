// Screenshots and frame timings of the demo on the GPU, for checking a change
// by eye. Starts its own Vite server on a free port and stops it on exit, so
// nothing is left running. Prints one JSON report; exits 1 on page errors.
// Run it through `npm run shot`, which passes --experimental-strip-types so
// Node 22 releases before 22.18 can import gpu.ts too.
//
//   npm run shot -- [query] [--size 1280x800] [--dpr 1] [--wait 2500]
//                   [--shots 1] [--every 700] [--eval js] [--perf secs] [--out dir]
//
//   query   demo URL query, e.g. '?seed=7&phase=0.5' or '?debug&time=fixed&phase=0.5'
//   --eval  JS run in the page after --wait, before the shots; its result is reported.
//           With ?debug it can drive window.koi, e.g. for a reproducible shot:
//           --eval 'koi.setViewport({width:800,height:600,dpr:1}).then(() => koi.reseed({seed:42})).then(() => koi.step({frames:120}))'
//   --perf  samples requestAnimationFrame for N seconds (vsync is off, so this is
//           real throughput); with ?debug `await koi.getPerf()` is reported too
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assertGpu, gpuLaunchOptions } from '../test/browser/gpu.ts';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1' },
    wait: { type: 'string', default: '2500' },
    shots: { type: 'string', default: '1' },
    every: { type: 'string', default: '700' },
    eval: { type: 'string' },
    perf: { type: 'string' },
    out: { type: 'string', default: 'test-results/shots' },
  },
});
const [width, height] = opt.size.split('x').map(Number);
const query = positionals[0] ?? '';
const out = path.resolve(opt.out);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^shot-\d+\.png$/.test(f)) fs.rmSync(path.join(out, f));

const server = await createServer({
  configFile: 'vite.demo.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
});
let browser;
const report = { url: '', renderer: '', viewport: { width, height, dpr: +opt.dpr }, shots: [], errors: [] };
try {
  await server.listen();
  report.url = new URL(query.replace(/^(?=[^?/])/, '?'), server.resolvedUrls.local[0]).href;

  browser = await chromium.launch(gpuLaunchOptions);
  report.renderer = await assertGpu(browser);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: +opt.dpr });
  page.on('console', (m) => m.type() === 'error' && report.errors.push(m.text()));
  page.on('pageerror', (e) => report.errors.push(e.message));

  await page.goto(report.url);
  await page.waitForSelector('canvas', { timeout: 15_000 });
  await page.waitForTimeout(+opt.wait);
  await page.evaluate(() => window.koi?.ready); // ?debug: the pond is up
  if (opt.eval) report.eval = await page.evaluate(opt.eval);

  for (let i = 0; i < +opt.shots; i++) {
    if (i) await page.waitForTimeout(+opt.every);
    const file = path.join(out, `shot-${i}.png`);
    await page.screenshot({ path: file });
    report.shots.push(file);
  }

  if (opt.perf) {
    report.perf = await page.evaluate(async (ms) => {
      const dts = [];
      await new Promise((done) => {
        const end = performance.now() + ms;
        let last = performance.now();
        requestAnimationFrame(function tick(now) {
          dts.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else done();
        });
      });
      dts.shift();
      dts.sort((a, b) => a - b);
      const at = (q) => +dts[Math.min(dts.length - 1, Math.floor(q * dts.length))].toFixed(2);
      const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { frames: dts.length, fps: +(1000 / mean).toFixed(1), p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
    }, +opt.perf * 1000);
    report.perf.koi = await page.evaluate(() => window.koi?.getPerf());
  }
} catch (e) {
  report.errors.push(`shot: ${e.message}`);
} finally {
  await browser?.close();
  await server.close();
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
