// PROTOTYPE (issue #1, palette and intensity) — throwaway switcher bar.
// URL: ?variant=A|B|C&palette=<name>&intensity=0..1&text=1
// Keys: ←/→ model, ↑/↓ palette, T text overlay.
import { PRESETS, VARIANTS, proto } from '../src/prototype-palette';

const params = new URLSearchParams(location.search);
const vIndex = () => VARIANTS.findIndex((v) => v.key === proto.variant);
const pIndex = () => PRESETS.indexOf(proto.preset);

proto.variant = VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A';
proto.preset = PRESETS.find((p) => p.name === params.get('palette')) ?? PRESETS[0];
const i = Number(params.get('intensity'));
proto.intensity = params.has('intensity') && i >= 0 && i <= 1 ? i : 1;
let text = params.get('text') === '1';

const style = document.createElement('style');
style.textContent = `
#proto-bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 1000;
  display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-radius: 999px;
  background: #ff2bd6; color: #111; font: 600 13px/1 system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0,0,0,.45); white-space: nowrap; max-width: calc(100vw - 32px); flex-wrap: wrap; justify-content: center; }
#proto-bar button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 6px; background: rgba(0,0,0,.12); }
#proto-bar button:hover { background: rgba(0,0,0,.25); }
#proto-bar .group { display: flex; gap: 6px; align-items: center; }
#proto-bar .label { min-width: 92px; text-align: center; }
#proto-bar input { width: 110px; accent-color: #111; }
#proto-text { position: fixed; left: 50%; top: 38%; transform: translate(-50%, -50%); z-index: 10;
  width: min(560px, calc(100vw - 32px)); pointer-events: none; font: 16px/1.55 system-ui, sans-serif; }
#proto-text h1 { font-size: clamp(28px, 6vw, 48px); line-height: 1.1; margin: 0 0 12px; }
#proto-text p { margin: 0; }
`;
document.head.append(style);

const overlay = document.createElement('div');
overlay.id = 'proto-text';
overlay.innerHTML = `<h1>A calmer backdrop</h1><p>Body copy on top of the pond. If this is hard to read at the
default intensity, the palette or the intensity knob has to fix it. The quick brown fox jumps over the lazy dog.</p>`;
document.body.append(overlay);

const bar = document.createElement('div');
bar.id = 'proto-bar';
bar.innerHTML = `
<span class="group"><button data-v="-1">‹</button><span class="label" id="pv"></span><button data-v="1">›</button></span>
<span class="group"><button data-p="-1">‹</button><span class="label" id="pp"></span><button data-p="1">›</button></span>
<label class="group">intensity <input id="pi" type="range" min="0" max="1" step="0.05"><span id="pin"></span></label>
<button id="pt"></button>`;
document.body.append(bar);

function apply(): void {
  const v = VARIANTS[vIndex()];
  bar.querySelector('#pv')!.textContent = `${v.key} (${v.name})`;
  bar.querySelector('#pp')!.textContent = proto.preset.name;
  (bar.querySelector('#pi') as HTMLInputElement).value = String(proto.intensity);
  bar.querySelector('#pin')!.textContent = proto.intensity.toFixed(2);
  bar.querySelector('#pt')!.textContent = text ? 'text: on' : 'text: off';
  overlay.hidden = !text;
  overlay.style.color = proto.preset.text;
  document.body.style.background = proto.preset.bg;
  const canvas = document.querySelector<HTMLCanvasElement>('#pond canvas');
  if (canvas) canvas.style.backgroundColor = proto.preset.bg;
  const p = new URLSearchParams(location.search);
  p.set('variant', v.key);
  p.set('palette', proto.preset.name);
  if (proto.intensity === 1) p.delete('intensity');
  else p.set('intensity', String(proto.intensity));
  if (text) p.set('text', '1');
  else p.delete('text');
  history.replaceState(null, '', `${location.pathname}?${p}`.replace(/=(?=&|$)/g, ''));
  // Full state, for the console and for screenshots.
  console.info('[proto-palette]', JSON.stringify({ variant: v.key, palette: proto.preset.name, intensity: proto.intensity, text }));
}

const wrap = (n: number, len: number) => (n + len) % len;
const stepVariant = (d: number) => (proto.variant = VARIANTS[wrap(vIndex() + d, VARIANTS.length)].key);
const stepPalette = (d: number) => (proto.preset = PRESETS[wrap(pIndex() + d, PRESETS.length)]);

bar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.v) stepVariant(Number(b.dataset.v));
  if (b.dataset.p) stepPalette(Number(b.dataset.p));
  if (b.id === 'pt') text = !text;
  apply();
});
bar.querySelector('#pi')!.addEventListener('input', (e) => {
  proto.intensity = Number((e.target as HTMLInputElement).value);
  apply();
});
addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') stepVariant(e.key === 'ArrowLeft' ? -1 : 1);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') stepPalette(e.key === 'ArrowUp' ? -1 : 1);
  else if (e.key === 't' || e.key === 'T') text = !text;
  else return;
  e.preventDefault();
  apply();
});

apply();
// The canvas appears after mount; paint its CSS background once it does.
new MutationObserver(apply).observe(document.getElementById('pond')!, { childList: true });
