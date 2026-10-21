# Checks

Every change passes the default check: `npm run typecheck && npm test` (vitest, under a second).

The browser suite `npm run test:browser` (Playwright on the GPU, ~30 s including a full build) is the browser-setup check. Run it when a change touches `test/browser/`, `playwright.config.ts`, `scripts/shot.mjs` or a `vite*.config.ts`. Specs live in `test/browser/`; `debug.spec.ts` covers `?debug` on `/demo/index.html`.

# Colour

Before adding or changing a colour the pond draws (a shader colour, a palette slot or preset, a new scene object), read `docs/colour-slots.md`.

# Browser checks

All browser runs use the GPU, launched only through `test/browser/gpu.ts` (it refuses to run on SwiftShader). The tools below start and stop their own Vite servers.

- **See a change:** `npm run shot -- '?seed=7&phase=0.5'` prints a JSON report (renderer, errors, PNG paths) and exits 1 on page errors. Options are listed at the top of `scripts/shot.mjs`.
- **Drive the demo:** `?debug` defines `window.koi`, a tool API (start with `await koi.help()`; README "Demo debug mode"). `npm run shot -- '?debug' --eval '…'` runs it before the shots, e.g. `koi.setViewport({width:800,height:600,dpr:1}).then(() => koi.reseed({seed:42})).then(() => koi.step({frames:120}))` for a reproducible frame; `--perf` then also reports `koi.getPerf()`.
- **Measure GPU cost:** `npm run perf -- '?debug' --base main` prints GPU µs per pass (scene, glow, ascii, …) for main and the working tree, with the delta. Options are at the top of `scripts/perf.mjs`.
