# koi-ascii

Three koi swimming in a pond, drawn with ASCII characters, as a background for
your page. WebGL2, a day/night cycle, ripples and wakes that follow the
pointer, palettes to match your site and an intensity to keep text on top
readable. Plain JavaScript, ESM only, TypeScript declarations included, no
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
  palette: 'pond', // a preset name or a palette object; see "Palettes"
  intensity: 1, // 0 background only … 1 full pond; see "Intensity"
  sky: { moon: true }, // night-sky features; see "Night sky"
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
| `palette`     | `'pond'`                                                      | Can change later with `setPalette`. See "Palettes". |
| `intensity`   | `1`                                                           | Can change later with `setIntensity`. See "Intensity". |
| `sky`         | stars, fireflies and `darkNight` on; moon and sun off         | Can change later with `setSky`. See "Night sky".   |
| `background`  | the palette's background                                      | Shown until the first frame and if the pond fails. |
| `onError`     | logs to the console                                           | See "Failure".                                     |

The time, palette, intensity and sky can change after creation. For anything else,
`destroy()` the pond and create a new one.

Without `background`, the container shows the palette's background (and
follows `setPalette`), so a light palette never flashes dark before the first
frame. An explicit `background` only sets that colour; the pond itself is
always drawn on the palette's background.

### Handle

| Method          | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `setTime(time)` | Switches the time of day live. `{ mode: 'loop' }` without a phase carries on from the current one. |
| `setPalette(palette)` | Recolours the pond from the next frame on; the fish carry on. |
| `setIntensity(intensity)` | Fades the pond towards its background from the next frame on. Animate it for a fade. |
| `setSky(sky)`   | Turns night-sky features on or off from the next frame on, with the same values as the `sky` option; the fish carry on. |
| `pause()`       | Stops simulating and drawing. The last frame stays on screen.                                    |
| `resume()`      | Carries on from where it paused, without jumping ahead.                                          |
| `destroy()`     | Stops the pond, removes its canvas, listeners and observers and frees its WebGL context. Safe to call twice, and safe before the pond has started. |

Exported types: `KoiPond`, `KoiPondOptions`, `KoiPondTime`,
`KoiPondInteractive`, `KoiPondError`, `KoiPondErrorCode`, `KoiPondPalette`,
`KoiPondPaletteName`, `KoiPondRampPalette`, `KoiPondRolesPalette`,
`KoiPondFilterPalette`, `KoiPondColor`, `KoiPondSky`, `KoiPondSkyFeatures`.
Exported value besides `createKoiPond`: `koiPalettes`.

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

## Night sky

`sky` picks what the night (and the day's sky) adds to the pond. Stars,
fireflies and a darker night are on by default; the moon and the sun are
opt-in:

```js
createKoiPond(el, { sky: { moon: true } }); // the defaults plus the moon
```

| Feature     | Default | What it does |
| ----------- | ------- | ------------ |
| `darkNight` | on      | At night, darker water and background and about half the floor caustics, so the night reads as night rather than a tinted day. Fades in and out through the blue hours; by day nothing changes. Dark palettes only: a light background stays light at night. |
| `stars`     | on      | Reflected stars at night: a sparse field of small points (`.` `'` `` ` `` `+`, a rare `*`) that twinkle slowly. Fixed to the screen, so they don't drift with the water, but a passing ripple makes them jump. They arrive after dusk and leave before dawn, and never cover a fish. On a light palette they are dark ink, and the motes thin out at night so the stars read. |
| `fireflies` | on      | Fireflies at dusk: 14 points (`.` `+` `*` by brightness) that drift slowly and blink in short pulses, each a single character with a soft glow, drawn over the fish. They come out after the golden hour and are gone by full night; never at dawn. The same `seed` gives the same fireflies. On a light palette there is no glow, so they are the glyph alone. |
| `moon`      | off     | The moon's reflection at night: a full disc with darker maria (`.` `:` `o`, a rare `O`) and a drawn rim, dimmer than the fish so it reads as a reflection. It rises up the left side after dusk, crosses the top through the night and is gone before dawn, always clear of the middle of the pond. A ripple through it tears it into `=` and `\|` shards that settle back. Fish swim over it. Opt-in; see "Placement" below. |
| `sun`       | off     | The sun's reflection by day: a patch of glitter (`.` `+` `*`) that flashes cell by cell, densest at its centre, gold at noon and amber with a low sun, never brighter than the Ogon's glints. It follows the moon's path: up the left side after dawn, over the top at noon, gone near the top-right corner before dusk, always clear of the middle of the pond. Ripples spread it; fish swim over it. Opt-in, like the moon; it is up all day. See "Placement" below. |

- Omitted: the defaults above.
- `true`: every feature on. `false`: every feature off, which is the pond
  exactly as it looked in 0.1.
- An object changes only the features it names: `{ moon: true }` adds the
  moon to the defaults, `{ darkNight: false }` keeps the 0.1 night water.

Invalid values never throw: a feature that is not `true` or `false` keeps its
default, an unknown feature is ignored, and anything that is neither a
boolean nor an object gives the defaults, each with a
`console.warn('koi-ascii: …')`.

```js
createKoiPond(el, { sky: false }); // the 0.1 pond
pond.setSky({ sun: true }); // defaults plus the sun, from the next frame
```

**Placement.** The moon and the sun are the only large shapes the sky draws,
and you can't place them. Both keep clear of the middle 40 % of the pond (in
each axis), where a headline usually sits, and travel along the left side and
the top edge, ending near the top-right corner. If your content sits there,
leave them off. Stars and fireflies are single characters spread over the
whole pond.

The features follow the palette (on a light palette they are dark ink and
have no glow), the `intensity` (they fade with the rest of the pond) and
reduced motion (see "Good to know").

## Palettes

A palette is a preset name or an object whose `mode` picks how it recolours
the pond:

- **`ramp`**: a gradient map. Each glyph's brightness picks a colour along
  `colors` (2 to 5 evenly spaced stops, background first). Suits single-hue
  looks; fish of the same brightness come out the same colour.
- **`roles`**: named colour slots. Each glyph takes the colour of what it
  draws: `background`, `water` (deep water and ripples are derived from it),
  `highlight` (glints, crests, eyes, stars, the sun's glitter) and, under `fish`, `pale` (white
  scales), `ink` (black patches), `accent` (red markings) and `metallic`
  (Ogon gold). The most control.
- **`filter`**: today's pond with a filter on top: `background`, `tint`
  (multiplies, default `'#ffffff'`), `saturation` (0 grey … 1 original,
  default 1) and `invert` (dark glyphs on light, hues kept). Keeps the
  pond's own hues, but can't add new ones.

### Presets

| Name       | Mode     | Look                                                       |
| ---------- | -------- | ---------------------------------------------------------- |
| `pond`     | `filter` | The default: today's pond, `{ mode: 'filter' }` with nothing changed. |
| `mono`     | `ramp`   | Greys on near-black.                                       |
| `phosphor` | `ramp`   | Green phosphor terminal.                                   |
| `amber`    | `ramp`   | Amber terminal.                                            |
| `paper`    | `roles`  | Dark ink on off-white, vermilion accent, ochre metallic. Light. |
| `brand`    | `roles`  | Indigo, lavender and pink.                                 |

```js
createKoiPond(el, { palette: 'paper' });
pond.setPalette('phosphor');
```

`koiPalettes` holds the preset definitions, frozen (nested objects too), for
copying and tweaking:

```js
import { createKoiPond, koiPalettes } from 'koi-ascii';

createKoiPond(el, {
  palette: { ...koiPalettes.paper, fish: { ...koiPalettes.paper.fish, accent: '#0a7' } },
});
```

### Your own palette

For your own brand colours, write a `roles` palette. The `brand` preset is
one; swap in your colours:

```js
createKoiPond(el, {
  palette: {
    mode: 'roles',
    background: '#14102a', // indigo
    water: '#3b2f6e',
    highlight: '#f1edff',
    fish: { pale: '#c8c2ff', ink: '#5a4a9a', accent: '#ff5c8a', metallic: '#ffc2d6' },
  },
});
```

Only `background` is required. A missing `highlight` is white on a dark
background and near-black on a light one; missing `water`, `pale` and `ink`
are mixed from the background and the highlight; `accent` and `metallic`
default to the pond's red and gold.

### Colours

Every colour is a CSS colour string, parsed by the browser: `'#0a7'`,
`'rgb(20 16 42)'`, `'hsl(250 45% 11%)'`, `'oklch(0.7 0.15 30)'`, `'teal'`
and so on. Alpha is ignored. `var()` is not supported: read the custom
property yourself (`getComputedStyle(document.documentElement).getPropertyValue('--brand')`)
and pass the value.

### Invalid input

A palette never throws and never calls `onError`. Invalid input falls back
field by field, with a `console.warn` for each:

- An unknown preset name or `mode` uses `'pond'`.
- An invalid colour field is ignored: a `roles` slot is derived as above, a
  filter `tint` is white, a filter `background` is the pond's own.
- A `roles` palette without a valid `background` uses `'#06131a'`.
- A `ramp` with fewer than 2 or more than 5 colours, or an invalid one, uses
  `'pond'`.
- A filter `saturation` outside [0, 1] is clamped; a non-number is 1. A
  non-boolean `invert` is false.

### Light backgrounds and time of day

A background whose relative luminance is above 0.4 counts as light. A light
background stays light at night: the night shows only in the glyphs. The
glow halo is skipped on a light background.

On a dark palette the night is darker by default (the `darkNight` sky
feature, see "Night sky"): the water and a time-of-day graded background (`pond`, or a
`filter` with a dark `background`) at about ×0.7, and fewer caustics. A
`roles` background and a `ramp`'s first stop are never graded, so they keep
their colour; the water drawn on them still darkens. Turn it
off with `sky: { darkNight: false }`, or `sky: false` for the 0.1 look.

In `ramp` and `roles`, the time of day changes only brightness, so the hues
stay on your palette. `filter` (and so `pond`) keeps the full sky colours:
dusk warmth and night blue. A filter without `background` keeps the pond's
dark, time-of-day background, so `invert` needs a light `background` to read
as dark glyphs on light:

```js
pond.setPalette({ mode: 'filter', background: '#f5f2ea', invert: true });
```

## Intensity

`intensity` mixes the pond with its background, linearly: 0 leaves only the
background, 1 is the full pond. For text on top, 0.2 to 0.5 keeps body text
readable with every palette (0.35 is a good start). Values outside [0, 1] are
clamped with a warning; a non-number is ignored with a warning (the option
then uses 1, the setter keeps the current value).

```js
const pond = createKoiPond(el, { palette: 'paper', intensity: 0.35 });

// A one-second fade-out:
const start = performance.now();
requestAnimationFrame(function fade(now) {
  const t = Math.min(1, (now - start) / 1000);
  pond.setIntensity(0.35 * (1 - t));
  if (t < 1) requestAnimationFrame(fade);
  else pond.pause(); // a fully faded pond keeps rendering until paused
});
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
  nothing: a `setTime`, `setPalette`, `setIntensity`, `setSky` or a resize of the
  container shows when it resumes.
- With `prefers-reduced-motion: reduce`, the fish swim slower, the water
  flickers less, the stars hold still, the moon's reflection sways slower, the
  sun's glitter flashes slower and the fireflies drift slower and glow softly
  up and down instead of blinking.
- On software WebGL (SwiftShader, llvmpipe and the like) the pond renders at
  a lower resolution to stay smooth.

## Demo debug mode

The demo page (not the package) has debug tooling behind one query flag,
`?debug`, on every build including the hosted demo. Without it the page
loads none of the debug code: no global, no panel, no shortcuts.

```
https://luckmorecat.github.io/koi-ascii/?debug
http://localhost:5173/?debug&seed=42&time=fixed&phase=0.8&view=raw
http://localhost:5173/?palette=paper&intensity=0.35
http://localhost:5173/?time=fixed&phase=0.95&sky=none
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
| `palette` | `pond`, `mono`, `phosphor`, `amber`, `paper`, `brand` | A preset (custom palettes can't go in the URL). Default `pond`; anything else is `pond`. |
| `intensity` | `0` … `1`               | Default 1.                                                                     |
| `sky`   | `all` (or `on`), `none` (or `off`), or the features that are on, comma-separated: `stars,fireflies,darkNight,moon,sun` | Default `stars,fireflies,darkNight` (left out of the URL); `none` is the 0.1 pond. Anything unreadable gives the defaults. |

`seed`, `time`, `phase`, `cycle`, `palette`, `intensity` and `sky` also work without
`?debug`. Pause and
viewport size are not kept in the URL. The older `?perf` param is gone, and
`sky` no longer takes `slider|loop`: an old `?sky=slider&phase=0.8` link now
loops from 0.8 with the default sky; use `?time=fixed&phase=0.8` to hold it.

### Panel and shortcuts

`?debug` opens a panel (Perf, Time, Render, Scene, Capture) whose controls are
generated from the API's tools, so everything it does an agent can do too,
and it follows changes made through the API. The Render section has a preset
dropdown, an intensity slider and a toggle per sky feature. Shortcuts work only with
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
| `getState`    |                               | The whole state: ready, paused, frame counter, time, render (view, glow, palette, intensity), sky (each feature), seed, viewport, canvas size. |
| `setTime`     | `mode?`, `phase?`, `cycle?`, `hold?` | Time of day; `hold` keeps the phase until a call with `hold: false`. |
| `setDayPart`  | `part`                        | Jumps to a lighting keyframe (`night`, `blue-hour-am`, … `noon` …).    |
| `getPerf`     |                               | fps, 1% low, frame / CPU / GPU ms (GPU `null` without the timer extension), canvas size, GPU string, software flag, seed. |
| `profile`     | `frames?` (400)               | GPU µs per pass (`scene`, `emission`, `glow`, `ascii`, `fly`; `frame` is all of them), median and p90, from timer queries around each draw over `frames` redraws of the paused frame. `{ gpuTimer: false }` without the timer extension. |
| `setRender`   | `view?`, `glow?`              | `final` / `raw` view and the glow halo. The raw view ignores the palette and intensity. |
| `setPalette`  | `palette`                     | Switches to a preset (`pond`, `mono`, `phosphor`, `amber`, `paper`, `brand`). |
| `setIntensity` | `intensity`                  | 0 background only … 1 full pond.                                       |
| `setSky`      | `stars?`, `fireflies?`, `darkNight?`, `moon?`, `sun?` | Turns sky features on or off; omitted ones keep their value. |
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

Two tools measure speed. `getPerf` is throughput of the running loop:
requestAnimationFrame fps and frame ms, with GPU ms for the whole frame.
`profile` is GPU time per pass: it pauses, redraws the same frame with a
timer query around every draw and gives the median and p90 per pass, so it
shows which pass a change made slower. To compare a change with another
revision, `npm run perf -- '?debug' --base main` profiles both side by side
(options at the top of `scripts/perf.mjs`).

## License

[MIT](./LICENSE)
