# Checks

Every change passes the default check: `npm run typecheck && npm test` (under a second).

The browser suite `npm run test:browser` (~30 s, including a full build) is the browser-setup check. Run it when a change touches `test/browser/`, `playwright.config.ts`, `scripts/shot.mjs` or a `vite.*.config.ts`.

# Releasing

Merging a new `package.json` version to `main` publishes it to npm (`.github/workflows/release.yml` header has the details). Bump with `npm version <x.y.z> --no-git-tag-version` and add its `CHANGELOG.md` entry in the same PR, which must pass `npm run release:check`.

# Scene

Before adding something the pond draws (a scene object, sky feature or material), read `docs/scene-features.md`; before adding or changing a colour (a shader colour, a palette slot or preset), read `docs/colour-slots.md`.

# Browser checks

All browser runs use the GPU via `test/browser/gpu.ts` (refuses SwiftShader); the tools start and stop their own Vite server. Options and examples sit at the top of each script.

- **See a change:** `npm run shot -- '?seed=7&phase=0.5'` prints a JSON report and exits 1 on page errors.
- **Drive the demo:** `?debug` defines `window.koi` (`await koi.help()`; README "Demo debug mode"); `--eval` runs it before the shots, e.g. seed and step for a reproducible frame.
- **Compare across revisions:** `npm run shots -- --base main --sheet` reports `SAME`/`DIFF` per matrix cell and draws contact sheets.
- **Measure GPU cost:** `npm run perf -- '?debug' --base main` prints GPU µs per pass for main and the working tree, with the delta.
- **Measure the whole frame:** `npm run batch -- '?debug' --base main` times whole batches of advancing frames. perf's per-pass rows miss GPU time between draws, so confirm a change to draws, targets or clears here.
- **Measure CPU cost:** `npm run cpu -- '?debug' --base main --alloc` advances time, so the fish sim, the uploads and the ripple pass are in it; `--gpu` adds per-pass GPU time.
- **Measure start-up:** `npm run startup -- '?seed=7' --base main` times shader compile and link and the first frame; check it when a shader grows or its loops change.
