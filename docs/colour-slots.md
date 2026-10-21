# Colour slots

Every colour the pond draws comes from a palette **slot**. A user's palette sets the slots (README "Palettes" has the public side); this page is the contributor side: how a colour gets from a slot into a shader, and how to add one without breaking existing palettes.

## Where colour lives

- `src/palette.ts`: presets (`PRESETS`, public as `koiPalettes`) and resolution of user input into `ResolvedRoles`: the seven slots, given or derived.
- `src/look.ts`: the single source of truth for scene colours.
  - `SceneColors` lists every colour uniform `scene.frag` draws with.
  - `POND_SCENE` holds the pond's own values. Every mode except roles, and the raw view, draw with it.
  - `rolesScene()` derives each scene colour from the slots: a slot itself, a shade of one (`scale`), or a mix of two (`mix`).
  - `brightnessOnly()` strips hue from the lighting in roles mode.
- `src/shaders/scene.frag`: reads the colours as `uniform vec3` and holds no colour of its own. `test/scene-colours.test.ts` keeps it that way.
- `src/shaders/ascii.frag`: ramp and filter recolour the finished image here, so they need nothing per object.

## Light and pigment

Classify every new colour as one of two kinds before choosing its slot.

- **Light** is the sun or moon reflected: water glints, crests, eyes, the moon's disc. It derives from `highlight`. In filter mode (and so `pond`) it also takes the light's hue (`lightHue()` in `scene.frag`); in roles it keeps the palette's hue and only its brightness follows the time of day. Stars and the moon's disc are exceptions: they derive from `highlight` in roles but keep their own pond hues (`uStarCool`, `uStarWarm`, `uMoonCol`) instead of the light's, since they are the sky's own colours rather than the light falling on the water.
- **Pigment** is an object's own colour: scales, markings, plants, pebbles. It derives from `pale`, `ink`, `accent` or `metallic`, or from a new slot.

`highlight` is the colour with the most contrast against the background, so on a light palette (`paper`) it is near-black. Light objects flip to dark ink there: decide whether that reads right for the new object.

## Adding a colour

1. Add the uniform to `SceneColors` in `look.ts`, its pond value to `POND_SCENE`, and its derivation to `rolesScene()`. TypeScript fails until all three exist.
2. Declare it as `uniform vec3` in the colour block of `scene.frag` and use it in place of a literal. The renderer uploads every `SceneColors` key by name.
3. Reuse an existing slot when a shade or mix of it reads right on all six presets. Otherwise add a new slot (next section).
4. Shoot noon (`phase=0.5`) and midnight (`phase=0`) on `pond`, `paper`, `phosphor` and `brand`, for example `npm run shot -- '?seed=7&time=fixed&phase=0.5&palette=paper'`. `pond` must look exactly as before; on the other three, the new colour must read against its background.

The step is done when `npm run typecheck && npm test` passes and all eight shots are checked.

## Adding a slot

A new slot is optional and additive, so existing palettes, including user copies of `koiPalettes`, keep their look:

- Give it a derived default in `resolveRoles()` (`palette.ts`), from existing slots or the pond's own colour, the way `accent` and `metallic` fall back to `POND_ACCENT` and `POND_METALLIC`.
- Group it by object, the way `fish` groups the fish pigments: `plants: { leaf, flower }`, `floor: { pebble }`.
- Add it to `KoiPondRolesPalette` in `index.ts`, to the `paper` and `brand` presets when the default reads wrong on them, to the README "Your own palette" text, and to `test/palette.test.ts`.

## Rules that outlive the code

- **Derivations are public behaviour.** A user who leaves a slot out sees what `resolveRoles()` and `rolesScene()` derive. Change a released derivation in a minor version with a changelog line, never silently.
- **A light background has no glow pass** (`palette.light` in `renderer.ts`). An effect built mostly from halo, such as fireflies, needs a glyph-only look to stay visible on `paper`.
- **Intensity applies itself** in `ascii.frag`, after every mode. Draw new objects at full strength.
- **Three luminance functions, on purpose:** Rec.601 `lum()` in `ascii.frag` (ramp and filter were tuned on it), Rec.709 in `look.ts` (greying the light) and WCAG in `palette.ts` (the 0.4 light threshold). Pick the one matching the job you are touching, rather than unifying them.

The plan for future objects (lily pads, seasons) and their likely slots is in the [colour rules comment on #4](https://github.com/Luckmorecat/koi-ascii/issues/4#issuecomment-6319060599).
