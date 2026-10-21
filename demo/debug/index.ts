// The ?debug entry point, loaded on demand by main.ts so a page without
// ?debug never downloads any of it: the window.koi API, the panel and the
// keyboard shortcuts the tools declare.
import { createApi, type ApiOptions, type KoiApi } from './api';
import { createPanel } from './ui';

declare global {
  interface Window {
    koi?: KoiApi;
  }
}

/** Input types where keys are text, not shortcuts. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password', 'date', 'time']);

function typing(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** Space already activates these; it must not also pause. */
function activates(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return target.type === 'checkbox' || target.type === 'radio' || target.type === 'button';
  return target instanceof HTMLButtonElement || (target instanceof HTMLElement && target.tagName === 'SUMMARY');
}

export function startDebug(options: ApiOptions): KoiApi {
  const koi = createApi(options);
  window.koi = koi;
  createPanel(koi);

  window.addEventListener('keydown', (e) => {
    // No modifiers at all: Shift+P is not P (Caps Lock still is, keys are matched in any case).
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (typing(e.target) || (e.key === ' ' && activates(e.target))) return;
    // Handled: no page scroll on Space, no find-as-you-type.
    if (koi.shortcut(e.key, e.repeat)) e.preventDefault();
  });

  console.info('koi debug: window.koi is ready for tools — start with `await koi.help()`');
  return koi;
}
