import '@fontsource/jetbrains-mono/latin-600.css';
import './style.css';
import { createKoiPond, koiPalettes, type KoiPondError, type KoiPondPaletteName, type KoiPondTime } from '../src/index';
import { readScene, sceneTime, type PondLook } from './scene';

const container = document.getElementById('pond') as HTMLDivElement;
const fallback = document.getElementById('fallback') as HTMLPreElement;

function fail(message: string): void {
  container.hidden = true;
  fallback.hidden = false;
  fallback.textContent = `><(((o>\n\n${message}`;
}

// ?avoid puts a headline over the pond and lists it as a readability zone, so
// the pond fades under it. Made once here, not in mountPond, so a debug reseed
// doesn't add a second one; pointer-events: none keeps the fish steerable
// through it (input is on the canvas).
const headline = new URLSearchParams(location.search).has('avoid') ? makeHeadline() : null;

function makeHeadline(): HTMLElement {
  const box = document.createElement('header');
  box.id = 'headline';
  const title = document.createElement('h1');
  title.textContent = 'Still water, slow fish';
  const line = document.createElement('p');
  line.textContent = 'The pond fades under this text so it stays readable, and carries on everywhere else.';
  box.append(title, line);
  document.body.append(box);
  return box;
}

/** A text colour that reads on the palette's background: its brightest ink. */
function inkOf(name: KoiPondPaletteName): string {
  const p = koiPalettes[name];
  if (p.mode === 'ramp') return p.colors[p.colors.length - 1];
  if (p.mode === 'roles') return p.highlight ?? '#dcecee';
  return '#dcecee';
}

/** The page's one set of pond options; the debug layer remounts with it on reseed. */
function mountPond(seed: number | undefined, time: KoiPondTime, look: PondLook, onError?: (error: KoiPondError) => void) {
  // A reseed after a failure gets a fresh chance: undo what fail() did.
  container.hidden = false;
  fallback.hidden = true;
  // On every mount so a reseed (which carries the palette) recolours it.
  headline?.style.setProperty('--ink', inkOf(look.palette));
  const pond = createKoiPond(container, {
    time,
    // Input on the canvas only, so using the debug panel never steers the fish.
    interactive: 'canvas',
    seed,
    palette: look.palette,
    intensity: look.intensity,
    sky: look.sky,
    avoid: headline ? [headline] : undefined,
    onError: (error) => {
      console.error(error);
      fail(
        error.code === 'webgl2-unavailable'
          ? 'This pond needs WebGL2, which this browser does not provide.'
          : 'The pond could not start its renderer.',
      );
      onError?.(error);
    },
  });
  if (!headline) return pond;
  // The debug palette switch goes through the handle, so recolour it there too.
  const setPalette = pond.setPalette;
  pond.setPalette = (next) => {
    if (typeof next === 'string') headline.style.setProperty('--ink', inkOf(next));
    setPalette(next);
  };
  return pond;
}

// Seed, time, palette, intensity and sky come from the URL (see scene.ts). ?debug is the only gate for
// the tooling: without it none of the debug code is even downloaded.
const scene = readScene(location.search);
if (new URLSearchParams(location.search).has('debug')) {
  import('./debug/index')
    .then(({ startDebug }) => startDebug({ container, scene, mount: mountPond }))
    .catch((err) => {
      // The debug chunk didn't load (or broke before mounting): show the pond anyway.
      console.error(err);
      if (!container.querySelector('canvas')) mountPond(scene.seed ?? undefined, sceneTime(scene), scene);
    });
} else {
  mountPond(scene.seed ?? undefined, sceneTime(scene), scene);
}
