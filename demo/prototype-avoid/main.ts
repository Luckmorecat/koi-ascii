// PROTOTYPE — throwaway, see the comment in index.html. Feeds element rects
// to the pond every frame through the source-only debug hooks; the library
// side is the `PROTOTYPE avoid-zones` blocks in koi.ts, pond.ts, renderer.ts
// and scene.frag.
import '@fontsource/jetbrains-mono/latin-600.css';
import './style.css';
import { createKoiPond, type KoiPondPaletteName } from '../../src/index';
import { attachHooks, type PondCore } from '../../src/internal';
import { profileDraws } from '../debug/perf';
import { rectSdf, type AvoidZone } from '../../src/koi/koi';

interface Knobs {
  /** Global steer strength; 0 turns steering off for every zone. */
  push: number;
  /** Which data-avoid kinds the fish steer around. */
  steer: 'all' | 'marked' | 'none';
  waterThin: number;
  waterDim: number;
  fishDim: number;
  feather: number;
  /** Zone grows by this many px past the element box. */
  pad: number;
}

const VARIANTS: Record<string, { name: string; zones: boolean; knobs: Knobs }> = {
  A: { name: 'none (today)', zones: false, knobs: { push: 0, steer: 'none', waterThin: 0, waterDim: 0, fishDim: 0, feather: 24, pad: 0 } },
  B: { name: 'steer around', zones: true, knobs: { push: 1, steer: 'all', waterThin: 0.7, waterDim: 0.5, fishDim: 0, feather: 28, pad: 12 } },
  C: { name: 'fade under', zones: true, knobs: { push: 0, steer: 'none', waterThin: 0.8, waterDim: 0.6, fishDim: 0.75, feather: 28, pad: 12 } },
  D: { name: 'mixed: hero steer, cards under', zones: true, knobs: { push: 1, steer: 'marked', waterThin: 0.7, waterDim: 0.5, fishDim: 0.6, feather: 28, pad: 12 } },
  E: { name: 'css scrim only', zones: false, knobs: { push: 0, steer: 'none', waterThin: 0, waterDim: 0, fishDim: 0, feather: 24, pad: 0 } },
};
const KEYS = Object.keys(VARIANTS);
const params = new URLSearchParams(location.search);
const variant = KEYS.includes(params.get('variant') ?? '') ? (params.get('variant') as string) : 'B';
const v = VARIANTS[variant];
const knobs: Knobs = { ...v.knobs };
// Panel tweaks live in the URL so a tuned view is shareable and reload-stable.
for (const k of Object.keys(knobs) as (keyof Knobs)[]) {
  const raw = params.get(k);
  if (raw === null) continue;
  if (k === 'steer') knobs.steer = raw as Knobs['steer'];
  else (knobs[k] as number) = Number(raw);
}
let show = params.has('show');
document.body.classList.add(`v-${variant}`);
document.body.classList.toggle('show', show);

const container = document.getElementById('pond') as HTMLDivElement;
const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
const palette = (params.get('palette') ?? undefined) as KoiPondPaletteName | undefined;
const handle = createKoiPond(container, { seed, palette, time: { mode: 'fixed', phase: Number(params.get('phase') ?? 0.5) } });

const elements = [...document.querySelectorAll<HTMLElement>('[data-avoid]')];
const stats = { measureMs: 0, inSteer: 0, inUnder: 0, samples: 0, zones: 0 };
let core: PondCore | null = null;

function measure(): AvoidZone[] {
  if (!v.zones || !core) return [];
  const t0 = performance.now();
  const origin = core.canvas.getBoundingClientRect();
  const out: AvoidZone[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    // Off-screen zones are skipped (scroll), so the 8-slot uniform holds what's visible.
    if (r.bottom < origin.top - 50 || r.top > origin.bottom + 50 || r.width === 0) continue;
    const kind = el.dataset.avoid;
    const steers = knobs.steer === 'all' || (knobs.steer === 'marked' && kind === 'steer');
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    out.push({
      x: r.left - origin.left - knobs.pad,
      y: r.top - origin.top - knobs.pad,
      w: r.width + knobs.pad * 2,
      h: r.height + knobs.pad * 2,
      r: radius + knobs.pad,
      push: steers ? 1 : 0,
    });
  }
  stats.measureMs += (performance.now() - t0 - stats.measureMs) * 0.05;
  return out.slice(0, 8);
}

attachHooks(handle, {
  ready(c) {
    core = c;
  },
  begin() {
    if (!core) return;
    const pond = core.pond;
    pond.avoid = measure();
    pond.avoidPush = knobs.push;
    pond.avoidLook = { waterThin: knobs.waterThin, waterDim: knobs.waterDim, fishDim: knobs.fishDim, feather: knobs.feather, show };
    stats.zones = pond.avoid.length;
    // How much of the time fish heads spend under each kind of zone.
    let s = 0;
    let u = 0;
    for (const f of pond.fish) {
      const z = pond.avoid.find((z) => rectSdf(z, f.x, f.y)[0] < 0);
      if (z) (z.push > 0 ? s++ : u++);
    }
    const n = pond.fish.length || 1;
    stats.inSteer += (s / n - stats.inSteer) * 0.002;
    stats.inUnder += (u / n - stats.inUnder) * 0.002;
    stats.samples++;
  },
});

// --- prototype chrome: switcher bar + knob panel
function go(key: string) {
  const p = new URLSearchParams(location.search);
  p.set('variant', key);
  for (const k of Object.keys(knobs)) p.delete(k);
  location.search = p.toString();
}
const bar = document.getElementById('proto-bar') as HTMLDivElement;
bar.innerHTML = `<button aria-label="previous">←</button><span>${variant} · ${v.name}</span><button aria-label="next">→</button>`;
const step = (d: number) => go(KEYS[(KEYS.indexOf(variant) + d + KEYS.length) % KEYS.length]);
bar.querySelectorAll('button')[0].onclick = () => step(-1);
bar.querySelectorAll('button')[1].onclick = () => step(1);
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

const panel = document.getElementById('proto-panel') as HTMLDivElement;
const sliders: [keyof Knobs, number, number, number][] = [
  ['push', 0, 2, 0.05],
  ['waterThin', 0, 1, 0.05],
  ['waterDim', 0, 1, 0.05],
  ['fishDim', 0, 1, 0.05],
  ['feather', 0, 120, 2],
  ['pad', 0, 60, 2],
];
panel.innerHTML = `<div class="head"><span>PROTOTYPE knobs</span><span>–</span></div><div class="body">
  ${
    v.zones
      ? sliders
          .map(
            ([k, lo, hi, st]) =>
              `<label>${k}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${st}" value="${knobs[k]}"><output>${knobs[k]}</output></label>`,
          )
          .join('') +
        `<label>steer<select data-k="steer">${['all', 'marked', 'none'].map((o) => `<option ${o === knobs.steer ? 'selected' : ''}>${o}</option>`).join('')}</select><span></span></label>
         <label>outlines<input type="checkbox" data-k="show" ${show ? 'checked' : ''}><span></span></label>`
      : '<div>No zones in this variant.</div>'
  }<pre></pre></div>`;
panel.querySelector('.head')!.addEventListener('click', () => panel.classList.toggle('min'));
const syncUrl = () => {
  const p = new URLSearchParams(location.search);
  for (const [k, val] of Object.entries(knobs)) {
    if (val === (v.knobs as unknown as Record<string, unknown>)[k]) p.delete(k);
    else p.set(k, String(val));
  }
  if (show) p.set('show', '');
  else p.delete('show');
  history.replaceState(null, '', `?${p.toString().replace(/show=(&|$)/, 'show$1')}`);
};
panel.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.k;
  if (!k) return;
  if (k === 'show') {
    show = el.checked;
    document.body.classList.toggle('show', show);
  } else if (k === 'steer') knobs.steer = el.value as Knobs['steer'];
  else {
    (knobs[k as keyof Knobs] as number) = Number(el.value);
    (el.nextElementSibling as HTMLOutputElement).value = el.value;
  }
  syncUrl();
});
const pre = panel.querySelector('pre') as HTMLPreElement;
setInterval(() => {
  const z = core?.pond.avoid ?? [];
  pre.textContent =
    `zones ${stats.zones} (steer ${z.filter((q) => q.push > 0).length})\n` +
    `measure ${stats.measureMs.toFixed(3)} ms/frame\n` +
    `fish under steer ${(stats.inSteer * 100).toFixed(1)}%\n` +
    `fish under fade  ${(stats.inUnder * 100).toFixed(1)}%\n` +
    `fps ${core ? core.stats.fps.toFixed(0) : '–'}`;
}, 250);

// Shot/eval hook: lets scripts/shot.mjs read the state.
(window as unknown as { proto: unknown }).proto = {
  knobs,
  stats,
  get zones() {
    return core?.pond.avoid;
  },
  /** GPU µs per pass over `frames` redraws of the paused frame, plus CPU ms per sim step and per zone measure. */
  async profile(frames = 400) {
    const c = core!;
    const r = c.renderer!;
    const names = new Map<WebGLProgram, string>();
    for (const [key, value] of Object.entries(r)) {
      const h = (value as { handle?: unknown } | null)?.handle;
      if (key.endsWith('Prog') && h instanceof WebGLProgram) names.set(h, key.slice(0, -4));
    }
    handle.pause();
    try {
      const gpu = await profileDraws(c.gl, names, () => c.redraw(), frames);
      // Sim only: 1/60 s = 2 fixed steps of 1/120 s, zones as they are now.
      const n = 2000;
      let t0 = performance.now();
      for (let i = 0; i < n; i++) c.pond.update(1 / 60);
      const simMs = (performance.now() - t0) / n;
      t0 = performance.now();
      for (let i = 0; i < n; i++) measure();
      const measureMs = (performance.now() - t0) / n;
      return { gpu, simMs, measureMs, zones: c.pond.avoid.length };
    } finally {
      handle.resume();
    }
  },
};
