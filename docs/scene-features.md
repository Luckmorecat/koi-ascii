# Adding something the pond draws

A touch map for a new scene object or sky feature: the files it reaches, in the order its data flows. Each night-sky feature (`git log --oneline --grep 'feat: add'`: stars, moon, sun, fireflies) touched the same eleven or so files listed here.

## The option

A sky feature is an on/off field of the `sky` option.

- `src/index.ts`: the field on `KoiPondSkyFeatures`, with its doc comment.
- `src/sky-features.ts`: the name in `SKY_FEATURES`, its value in `DEFAULT_SKY`, `NO_SKY` and `ALL_SKY`. A feature whose strength needs more than one number gets a helper here, as the stars have `starsAt()`.

## The uniform flow

Values the shader needs per frame run CPU → GPU in one direction:

1. `src/lighting.ts`: derive it from the phase, as `starWeight()`, `moonAt()` and `sunAt()` do, and put it on `Lighting` in `lightingAt()` when it belongs to the light.
2. `src/renderer.ts`: upload it in the scene pass's uniform chain (`.float('uStars', …)`, `.vec4('uMoon', …)`), zeroed when the feature is off. `src/gl/program.ts` has one setter per uniform type; add one if the type is new.
3. The chunk that reads it declares it at its top. A uniform more than one chunk reads goes in `src/shaders/scene/uniforms.glsl` instead.

## The chunk

The scene pass is the chunks in `src/shaders/scene/`, joined in the order `index.ts` lists them, which is declare-before-use.

- A new feature gets a chunk of its own (or joins one of the same domain, as stars, moon and sun share `sky.glsl`), listed in `index.ts` after every chunk it depends on.
- Its header says what it draws, the uniforms it reads and the chunks it depends on; copy the form from a neighbour.
- `main.frag` calls it where it layers: after `water()` and before the fish for something on the water, after `drawFish()` for something over them.
- A compile error names the chunk and line (`sky.glsl:42`).
- `test/shader-size.test.ts` keeps every shader file within 250 lines and checks the headers.

Something drawn over everything at its own positions, like the fireflies, is a separate program instead: `fly.vert` and `fly.frag`, drawn into the scene target by `renderer.ts`.

## The material

- `src/shaders/common.glsl`: a new `M_*` material ID, which the scene pass writes and the glow and ASCII passes read.
- `src/shaders/emission.glsl`: its weight in `emission()`; leave it out and the material gives no glow.
- `src/shaders/scene/glyphs.glsl`: its glyphs in `pickGlyph()`. A new character goes last in `GLYPHS` (`src/glyphs.ts`), so every glyph before it keeps its atlas index.

## The colour

A colour is a `SceneColors` uniform in `src/look.ts`, never a literal; `docs/colour-slots.md` has the steps and the light-or-pigment choice.

## Docs and tests

- `README.md`: the feature under "Night sky", and anything new on `window.koi` under "Demo debug mode".
- `test/lighting.test.ts`: the weight or position across a whole day.
- `test/sky-features.test.ts`: the option's defaults and resolution.
- `test/scene-colours.test.ts`: the colour's pond value and roles derivation; the guard there already covers every chunk.
- `test/browser/sky.spec.ts`: the feature on the GPU, off by default where it is opt-in, and under reduced motion.
- Check behaviour with `npm run shots` against `main` (`sky=none` must stay `SAME`) and cost with `npm run perf`; both scripts' headers have the options.
