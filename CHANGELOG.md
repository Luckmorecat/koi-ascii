# Changelog

Each release's entry becomes its GitHub Release. A version bump needs an
entry here before it can merge (`npm run release:check`).

## [0.4.0] - 2026-10-31

Page content stays readable over the pond. List the elements that carry
text, such as a hero headline, cards or prose, and the pond fades
everything it draws under them with a soft edge, while it carries on
everywhere else. A pond with no zones draws exactly as 0.3.2 does.

### Added
- The `avoid` option and `setAvoid()` list elements (or
  `{ element, pad }`) to fade under. Each zone follows its element through
  scrolling, resizing, sticky positioning, transforms and animations, with
  the element's `border-radius` plus `pad` (default 12 px) as its corners.
- The `avoidFade` option and `setAvoidFade()` set the fade's `strength`
  (0 off … 1, the default) and `feather` (the soft edge, default 56 px).
  Fields left out of `setAvoidFade()` keep their current values, so
  `strength` can be animated to fade zones in or out.
- Fish, water, trails, fireflies, moon, sun and glow all fade toward the
  palette's own background, so the fade is correct on light palettes
  such as `paper` too.
- Up to 16 zones are visible at once; past that, the first 16 in list
  order are kept, with a warning. Hidden, detached and off-canvas elements
  don't count.
- In demo debug mode, `koi.showAvoid()` outlines the zones, and `?avoid`
  puts a sample headline over the pond.

### Performance
- Each frame reads the layout of every listed element (about 5 µs for 8
  elements, 9 µs for 16). Nothing is read while the pond is paused,
  off-screen or at `strength: 0`. See "Readable content" in the README
  for when this can force an extra layout.
- With a zone, a frame takes about 1 µs more GPU time (+3.6% at
  1280×800).

## [0.3.2] - 2026-10-31

The same pond, drawn faster, with no API or option changes. On the test
GPU, 147 checked frames across the six palette presets, three sky
settings, six times of day and three canvas sizes match 0.3.1 pixel for
pixel. The timings below were measured in Chromium on Linux with a
Radeon RX 9060 XT.

### Changed
- A compile error in the scene shader names its source file and line,
  such as `sky.glsl:73`, instead of a line in the joined source. It is the
  `cause` of the `'renderer-failed'` error.
- In demo debug mode, `koi.profile()` lists the new `emission` pass.

### Performance
- A frame takes about half the GPU time: 51% less at 1280×800 and 55%
  less on a 2560×1440 canvas at 2× pixel ratio. At the larger size nearly
  all of the saving is in the ASCII pass, which shades every device pixel;
  at 1280×800 the ASCII, scene and glow passes share it about equally.
- 83–86% less JavaScript heap allocated per frame, and about a third as
  many garbage collections.
- The first frame finishes about 46 ms sooner on a cold load, mostly from
  faster shader linking.
- `dist/index.js` is 5% smaller gzipped (45,546 → 43,248 bytes): the
  shipped GLSL drops its comments and indentation.

## [0.3.1] - 2026-10-21

The first release since 0.1.0. Versions 0.2.0 and 0.3.0 were never
published; their changes are here.

### Changed
- Nights are darker on dark palettes: the water and graded background dim
  and the floor caustics thin out, fading through the blue hours. Stars and
  dusk fireflies show by default. `sky: false` renders the pond as 0.1 did.

### Added
- `palette` and `intensity` options, with `setPalette()` and
  `setIntensity()` on the handle. A palette is a preset name, a ramp, a
  roles object or a filter; `koiPalettes` exports the six presets (`pond`,
  `mono`, `phosphor`, `amber`, `paper`, `brand`).
- A warning when a filter's `invert` doesn't match its background, which
  leaves the glyphs barely visible.
- The `sky` option and `setSky()` choose the night-sky features: `stars`,
  `fireflies` and `darkNight` (on by default), and `moon` and `sun` (off by
  default).
- Reflected stars on flat water at night.
- Fireflies that drift and blink over the pond from late golden hour into
  early night.
- The moon's reflection at night (`sky.moon`), torn into shards by ripples.
- The sun's gold glitter on the water by day (`sky.sun`).

### Fixed
- Colours outside sRGB (`oklch()`, `color(display-p3 …)`) with zero alpha
  kept their hue instead of turning black.
- A grey tint on an inverted filter softens the ink in proportion to its
  brightness; before, every grey drew like white.

### Performance
- Scene colours upload only when they change, not every frame.

## [0.1.0] - 2026-10-21

First release.
