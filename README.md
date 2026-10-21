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

## License

[MIT](./LICENSE)
