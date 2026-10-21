# Browser checks

All browser runs use the GPU, launched only through `test/browser/gpu.ts` (it refuses to run on SwiftShader). Both tools below start and stop their own Vite server.

- **See a change:** `npm run shot -- '?seed=7&phase=0.5'` prints a JSON report (renderer, errors, PNG paths) and exits 1 on page errors. Options (size, DPR, several shots, `--eval`, `--perf` frame timings) are listed at the top of `scripts/shot.mjs`.
- **Behaviour tests:** `npm run test:browser` (specs in `test/browser/`).
