# Checks

Every change passes the default check: `npm run typecheck && npm test` (vitest, under a second).

The browser suite `npm run test:browser` (Playwright on the GPU, ~30 s including a full build) is the browser-setup check. Run it when a change touches `test/browser/`, `playwright.config.ts`, `scripts/shot.mjs` or a `vite*.config.ts`. Specs live in `test/browser/`; `debug.spec.ts` covers `?debug` on `/demo/index.html`.

# Browser checks

All browser runs use the GPU, launched only through `test/browser/gpu.ts` (it refuses to run on SwiftShader). Both tools below start and stop their own Vite server.

- **See a change:** `npm run shot -- '?seed=7&phase=0.5'` prints a JSON report (renderer, errors, PNG paths) and exits 1 on page errors. Options (size, DPR, several shots, `--eval`, `--perf` frame timings) are listed at the top of `scripts/shot.mjs`.
- **Drive the demo:** `?debug` defines `window.koi`, a tool API (start with `await koi.help()`; README "Demo debug mode"). `npm run shot -- '?debug' --eval '…'` runs it before the shots, e.g. `koi.setViewport({width:800,height:600,dpr:1}).then(() => koi.reseed({seed:42})).then(() => koi.step({frames:120}))` for a reproducible frame; `--perf` then also reports `koi.getPerf()`.