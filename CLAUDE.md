# Checks

Every change passes the default check: `npm run typecheck && npm test` (under a second).

The browser suite `npm run test:browser` (~30 s, including a full build) is the browser-setup check. Run it when a change touches `test/browser/`, `playwright.config.ts`, `scripts/shot.mjs` or a `vite.*.config.ts`.

# Releasing

Merging a new `package.json` version to `main` publishes it to npm (`.github/workflows/release.yml` header has the details). Bump with `npm version <x.y.z> --no-git-tag-version` and add its `CHANGELOG.md` entry in the same PR, which must pass `npm run release:check`.

# Colour

Before adding or changing a colour the pond draws (a shader colour, a palette slot or preset, a new scene object), read `docs/colour-slots.md`.

# Browser checks

All browser runs use the GPU via `test/browser/gpu.ts` (refuses SwiftShader); the tools start and stop their own Vite server. Options and examples sit at the top of each script.

- **See a change:** `npm run shot -- '?seed=7&phase=0.5'` prints a JSON report and exits 1 on page errors.
- **Drive the demo:** `?debug` defines `window.koi` (`await koi.help()`; README "Demo debug mode"); `--eval` runs it before the shots, e.g. seed and step for a reproducible frame.
