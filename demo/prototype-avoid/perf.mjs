// PROTOTYPE: GPU/CPU cost per avoid-zones variant. Run: node --experimental-strip-types demo/prototype-avoid/perf.mjs
import { startDemo, launchGpu } from '../../scripts/demo.mjs';
const VARIANTS = ['A', 'B', 'C', 'D', 'E'];
const SIZES = [[1280, 800, 1], [390, 844, 3]];
const RUNS = 5;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const demo = await startDemo(process.cwd());
const { browser, renderer } = await launchGpu();
const out = { renderer, results: [] };
try {
  for (const [w, h, dpr] of SIZES) {
    const acc = Object.fromEntries(VARIANTS.map((v) => [v, []]));
    for (let run = 0; run < RUNS; run++) {
      for (const v of VARIANTS) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
        await page.goto(demo.url(`/prototype-avoid/?variant=${v}&seed=42`));
        await page.waitForFunction(() => window.proto?.zones !== undefined || document.querySelector('canvas'), null, { timeout: 15000 });
        await page.waitForTimeout(2500);
        const r = await page.evaluate(async () => {
          const p = await window.proto.profile(400);
          return p;
        });
        acc[v].push(r);
        await page.close();
      }
    }
    for (const v of VARIANTS) {
      const rs = acc[v];
      out.results.push({
        size: `${w}x${h}@${dpr}`, variant: v, zones: rs[0].zones,
        frameUs: med(rs.map((r) => r.gpu.passes.frame.median)),
        sceneUs: med(rs.map((r) => r.gpu.passes.scene.median)),
        sceneSpread: Math.max(...rs.map((r) => r.gpu.passes.scene.median)) - Math.min(...rs.map((r) => r.gpu.passes.scene.median)),
        simUs: med(rs.map((r) => r.simMs * 1000)),
        measureUs: med(rs.map((r) => r.measureMs * 1000)),
        disjoint: rs.some((r) => r.gpu.disjoint),
      });
    }
  }
} finally {
  await browser.close();
  await demo.close();
}
for (const r of out.results) for (const k of ['frameUs', 'sceneUs', 'sceneSpread', 'simUs', 'measureUs']) r[k] = Math.round(r[k] * 100) / 100;
console.log(renderer);
console.table(out.results);
