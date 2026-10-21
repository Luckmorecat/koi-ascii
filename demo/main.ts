import '@fontsource/jetbrains-mono/latin-600.css';
import './style.css';
import { createKoiPond, type KoiPondError, type KoiPondTime } from '../src/index';
import { readScene, sceneTime, type PondLook } from './scene';

const container = document.getElementById('pond') as HTMLDivElement;
const fallback = document.getElementById('fallback') as HTMLPreElement;

function fail(message: string): void {
  container.hidden = true;
  fallback.hidden = false;
  fallback.textContent = `><(((o>\n\n${message}`;
}

/** The page's one set of pond options; the debug layer remounts with it on reseed. */
function mountPond(seed: number | undefined, time: KoiPondTime, look: PondLook, onError?: (error: KoiPondError) => void) {
  // A reseed after a failure gets a fresh chance: undo what fail() did.
  container.hidden = false;
  fallback.hidden = true;
  return createKoiPond(container, {
    time,
    // Input on the canvas only, so using the debug panel never steers the fish.
    interactive: 'canvas',
    seed,
    palette: look.palette,
    intensity: look.intensity,
    sky: look.sky,
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
