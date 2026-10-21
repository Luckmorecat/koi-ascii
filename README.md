# koi-ascii

Three koi swimming in a pond, drawn with ASCII characters, as a background for
your page. WebGL2, a day/night cycle, ripples and wakes that follow the
pointer. Plain JavaScript, ESM only, TypeScript declarations included, no
runtime dependencies.

**Demo:** https://luckmorecat.github.io/koi-ascii/

## Install

```sh
npm install koi-ascii
```

## Quick start

```js
import { createKoiPond } from 'koi-ascii';

const pond = createKoiPond(document.getElementById('pond'));
```

The pond appends one `<canvas>` to the container and fills it (100% × 100%).
You position and size the container; the library adds no global CSS and
doesn't touch `html`, `body`, the URL, keys or `window` globals.

A full-screen backdrop behind your content:

```html
<div id="pond" aria-hidden="true"></div>
<main>…your page…</main>
```

```css
#pond {
  position: fixed;
  inset: 0;
  z-index: -1;
}
```

## Options

```ts
const pond = createKoiPond(container, {
  time: { mode: 'loop', cycle: 600, phase: 0 }, // see "Time of day"
  interactive: 'window', // 'window' | 'canvas' | 'none'
  seed: 42, // same seed, same fish; omit for a random pond on every mount
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
  background: '#06131a', // CSS colour before the first frame and on failure
  onError: (error) => console.warn(error.code),
});
```

| Option        | Default                                                       | Notes                                              |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `time`        | `{ mode: 'loop', cycle: 600, phase: 0 }`                      | Can change later with `setTime`.                   |
| `interactive` | `'window'`                                                    | See "Interaction".                                 |
| `seed`        | random                                                        | Any number; the same seed gives the same fish.     |
| `fontFamily`  | `'"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'` | The glyph font. See "Fonts".                       |
| `background`  | `'#06131a'`                                                   | Shown until the first frame and if the pond fails. |
| `onError`     | logs to the console                                           | See "Failure".                                     |

Only the time can change after creation. For anything else, `destroy()` the
pond and create a new one.

### Handle

| Method          | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `setTime(time)` | Switches the time of day live. `{ mode: 'loop' }` without a phase carries on from the current one. |
| `pause()`       | Stops simulating and drawing. The last frame stays on screen.                                    |
| `resume()`      | Carries on from where it paused, without jumping ahead.                                          |
| `destroy()`     | Stops the pond, removes its canvas, listeners and observers and frees its WebGL context. Safe to call twice, and safe before the pond has started. |

Exported types: `KoiPond`, `KoiPondOptions`, `KoiPondTime`,
`KoiPondInteractive`, `KoiPondError`, `KoiPondErrorCode`.

## Time of day

The lighting follows a phase from 0 to 1: 0 is midnight, 0.25 sunrise, 0.5
noon, 0.75 sunset.

- `{ mode: 'loop', cycle?, phase? }`: a whole day every `cycle` seconds
  (default 600, accepted 1 to 86 400), starting at `phase` (default 0).
- `{ mode: 'fixed', phase }`: stays at `phase`.
- `{ mode: 'clock' }`: the visitor's local time, local hours / 24. Sunrise is
  at 06:00 and sunset at 18:00 everywhere; there is no latitude or season.

Invalid values fall back to the defaults instead of throwing: a cycle outside
[1, 86 400] becomes 600, a phase outside [0, 1] becomes 0.

```js
pond.setTime({ mode: 'fixed', phase: 0.5 }); // noon
pond.setTime({ mode: 'loop', cycle: 120 }); // a 2-minute day from here
pond.setTime({ mode: 'clock' });
```

## Interaction

- `'window'` (default): passive pointer listeners on `window`, mapped into the
  pond's rectangle. The fish follow the pointer and wakes form even when the
  pond sits behind your page content, and page scrolling is never blocked.
- `'canvas'`: listeners on the pond's own canvas, which only receives input
  where nothing covers it. The canvas gets `touch-action: none`, so touch
  drags over it steer the fish instead of scrolling.
- `'none'`: no pointer listeners at all.

Several ponds on one page each map the pointer into their own rectangle.

## Fonts

The library loads no fonts. It draws its glyphs with `fontFamily` and falls
back to the system monospace font. For the intended look, load JetBrains Mono
(weight 600) yourself, for example with
[`@fontsource/jetbrains-mono`](https://www.npmjs.com/package/@fontsource/jetbrains-mono):

```js
import '@fontsource/jetbrains-mono/latin-600.css';
```

The pond waits for the font to load (or fail) before it starts.

## Server-side rendering

Importing `koi-ascii` touches neither `window` nor `document`, so it is safe
in SSR builds. Call `createKoiPond` only in the browser, in a client-side
effect. With React:

```jsx
import { useEffect, useRef } from 'react';
import { createKoiPond } from 'koi-ascii';

export function KoiBackground() {
  const ref = useRef(null);
  useEffect(() => {
    const pond = createKoiPond(ref.current, { time: { mode: 'clock' } });
    return () => pond.destroy();
  }, []);
  return <div ref={ref} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1 }} />;
}
```

## Failure

If the browser has no WebGL2, or the renderer can't start, `createKoiPond`
still returns a handle and throws nothing. The container shows the
`background` colour and `onError` is called with an `Error` whose `code` is
`'webgl2-unavailable'` or `'renderer-failed'`. Without `onError` the error is
logged to the console. Show your own fallback from `onError` if you want one.

## Good to know

- Each pond uses one WebGL context. Browsers allow about 16 live contexts per
  page and drop the oldest beyond that, so keep the number of ponds small and
  `destroy()` the ones you no longer show.
- A pond pauses itself while its container is off-screen and while the tab is
  hidden, and continues without a jump when it comes back. `pause()` and the
  automatic pause combine: either one keeps it paused.
- While a pond is paused (by `pause()` or because it is off-screen), it draws
  nothing: a `setTime` or a resize of the container shows when it resumes.
- With `prefers-reduced-motion: reduce`, the fish swim slower and the water
  flickers less.
- On software WebGL (SwiftShader, llvmpipe and the like) the pond renders at
  a lower resolution to stay smooth.

## Demo debug mode

The demo page (not the package) has debug tooling behind one query flag,
`?debug`, on every build including the hosted demo. Without it the page
loads none of the debug code: no global, no panel, no shortcuts.

```
https://luckmorecat.github.io/koi-ascii/?debug
http://localhost:5173/?debug&seed=42&time=fixed&phase=0.8&view=raw
```

### URL params

The scene lives in the URL next to `?debug`. Changes made from the panel or
the API are written back (`history.replaceState`), so a reload or a shared
link shows the same scene. Defaults are left out of the URL.

| Param   | Values                    | Notes                                                                          |
| ------- | ------------------------- | ------------------------------------------------------------------------------ |
| `seed`  | `0` … `4294967295`        | Same seed, same fish. Omitted: random on every load.                           |
| `time`  | `loop`, `fixed`, `clock`  | Default `loop`.                                                                |
| `phase` | `0` … `1`                 | `fixed`: the phase shown. `loop`: where the day starts (default 0). A running loop never rewrites it; only an explicit set (slider, day-part tick, API) does. |
| `cycle` | `1` … `86400`             | Loop length in seconds, default 600.                                           |
| `view`  | `final`, `raw`            | `raw`: glyphs on the plain background, without lighting grade or glow. Needs `?debug`. |
| `glow`  | `on`, `off`               | The halo around bright cells. Needs `?debug`.                                  |

`seed`, `time`, `phase` and `cycle` also work without `?debug`. Pause and
viewport size are not kept in the URL. The older `?perf` and `?sky=slider|loop`
params are gone: an old `?sky=slider&phase=0.8` link now loops from 0.8;
use `?time=fixed&phase=0.8` to hold it.

### Panel and shortcuts

`?debug` opens a panel (Perf, Time, Render, Scene, Capture) whose controls are
generated from the API's tools, so everything it does an agent can do too,
and it follows changes made through the API. Shortcuts work only with
`?debug`, without modifier keys, and not while typing in a text or number box:

| Key     | Does                 |
| ------- | -------------------- |
| `P`     | show / hide the panel |
| `R`     | toggle the raw view  |
| `Space` | pause / resume       |
| `.`     | step one frame       |

### `window.koi` for agents and humans

With `?debug` the page defines `window.koi`, a self-describing tool registry
in the style of MCP, meant to be driven through browser JS evaluation (for
example Playwright's `page.evaluate`). The console prints a pointer to
`await koi.help()` on load.

```js
await page.waitForFunction(() => window.koi); // the debug chunk loads on demand
await page.evaluate(() => koi.ready); // the pond is up
console.log(await page.evaluate(() => koi.help()));
```

- `koi.tools()`: every tool as `{ name, description, inputSchema, annotations }`.
  `inputSchema` is a JSON Schema subset: `type: 'object'` with `properties`,
  an optional `required` list and `additionalProperties: false` (unknown
  arguments are rejected). Each property has a `description` and is a
  `number` / `integer` (optional `minimum`, `maximum`), a `boolean` or a
  `string` with an `enum`, with an optional `default` (the value used when
  the argument is left out). `annotations` holds:
  `section` (the panel section), `readOnly` (the call changes nothing),
  `live` (each argument applies on its own, so the panel applies controls
  as they change), `reflects` (the `getState()` key that holds each
  argument's current value) and `shortcut` (`{ key, does }`).
- `koi.call(name, args)`: always resolves, never rejects, with
  `{ ok: true, result }` or `{ ok: false, error: { code, message } }`. Codes:
  `unknown-tool`, `invalid-args` (the message names the path, e.g.
  `args.phase: must be at most 1, got 2`), `not-ready`, `context-lost`,
  `pond-failed`, `internal`. Results are plain JSON.
- `koi.<tool>(args)`: the same call, resolving to `result` and rejecting
  with the error object.
- `koi.ready`: resolves once the current pond is up. It rejects with
  `{ code, message }`: `pond-failed` if the pond can't start, `not-ready`
  if a `reseed` replaced it before it was up. Each `reseed` gives a new
  promise, so read `koi.ready` again after one.
- `koi.on('change', fn)` after any call that changes state, with
  `{ tool, state }`; `koi.on('frame', fn)` per drawn frame, including frames
  drawn by `step` (marked `stepped: true`, and left out of `getPerf`). Both return an
  unsubscribe function; `koi.off(event, fn)` works too. The last write wins.
- `koi.help()`: every tool with its description, arguments and shortcut.

| Tool          | Args                          | Does                                                                   |
| ------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `getState`    |                               | The whole state: ready, paused, frame counter, time, render, seed, viewport, canvas size. |
| `setTime`     | `mode?`, `phase?`, `cycle?`, `hold?` | Time of day; `hold` keeps the phase until a call with `hold: false`. |
| `setDayPart`  | `part`                        | Jumps to a lighting keyframe (`night`, `blue-hour-am`, … `noon` …).    |
| `getPerf`     |                               | fps, 1% low, frame / CPU / GPU ms (GPU `null` without the timer extension), canvas size, GPU string, software flag, seed. |
| `setRender`   | `view?`, `glow?`              | `final` / `raw` view and the glow halo.                                |
| `reseed`      | `seed?`                       | Remounts the pond with a seed (random if omitted), as on a fresh load of the URL. |
| `getFish`     |                               | Each fish's variety, position, heading, speed, depth, behaviour.      |
| `pause`, `resume` |                           | Stops and restarts the frame loop (no catch-up after a pause).        |
| `step`        | `frames?` (1), `dt?` (1/60)   | Pauses, then simulates and draws the frames synchronously, so it works in a background tab. |
| `capture`     |                               | Redraws the current state and returns `{ dataUrl, width, height }` (PNG). |
| `setViewport` | `width?`, `height?`, `dpr?`   | Pins the pond to a size in CSS px (and a pixel ratio); no args fills the window again. |
| `setPanel`    | `visible?`                    | Shows or hides the panel; no args toggles.                             |

A reproducible frame, identical on every run on the same machine:

```js
await koi.setViewport({ width: 800, height: 600, dpr: 1 });
await koi.setTime({ mode: 'fixed', phase: 0.5 });
await koi.reseed({ seed: 42 });
await koi.step({ frames: 120 });
const { dataUrl } = await koi.capture();
```

## License

[MIT](./LICENSE)
