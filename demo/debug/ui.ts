// The debug panel. Its controls are generated from the tools' input schemas
// (number → slider or number box, boolean → checkbox, enum → select, no args
// → button) and it acts only through koi.call, so it shows calls made by
// agents too (via 'change' events). The panel sits outside the canvas, which
// is the only place the pond takes pointer input, so using it never steers
// the fish.
import './ui.css';
import { clock, DAY_PART_IDS, keyName, type DebugState, type KoiApi, type Section, type ToolInfo } from './api';
import { HISTORY } from './perf';
import { describeProp, type PropSchema } from './schema';

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'perf', title: 'Perf' },
  { id: 'time', title: 'Time' },
  { id: 'render', title: 'Render' },
  { id: 'scene', title: 'Scene' },
  { id: 'capture', title: 'Capture' },
];
/** Graph ceiling in ms; slower frames are clipped to the top. */
const GRAPH_MS = 50;
/** Text refresh interval, so the readouts are legible and don't churn layout. */
const TEXT_MS = 250;
/** A range slider only where the span is small enough to pick a value by dragging. */
const MAX_RANGE_SPAN = 10;
/** Arguments a richer control drives instead of a generated one: the phase slider holds while dragged. */
const DRIVEN: Record<string, string[]> = { setTime: ['hold'] };

type Control = {
  el: HTMLInputElement | HTMLSelectElement;
  /** Value to call with; undefined leaves the argument out. */
  read(): unknown;
  write(v: unknown): void;
  /** Mid-edit (focused number box, dragged slider): don't overwrite. */
  busy(): boolean;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button whose click doesn't leave focus on it, so Space stays a shortcut. */
function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    if (e.detail > 0) b.blur();
    onClick();
  });
  return b;
}

/** Keep a drag's pointer on the control even when it strays over the canvas. */
function capturePointer(input: HTMLElement): void {
  input.addEventListener('pointerdown', (e) => input.setPointerCapture(e.pointerId));
}

/** One generated control for a schema property. */
function control(name: string, prop: PropSchema, optional: boolean): Control {
  if (prop.type === 'boolean') {
    const box = el('input');
    box.type = 'checkbox';
    if (prop.default !== undefined) box.checked = prop.default;
    return { el: box, read: () => box.checked, write: (v) => (box.checked = !!v), busy: () => false };
  }
  if (prop.type === 'string') {
    const select = el('select');
    if (optional) select.append(new Option('—', ''));
    for (const v of prop.enum) select.append(new Option(v, v));
    if (prop.default !== undefined) select.value = prop.default;
    return {
      el: select,
      read: () => (select.value === '' ? undefined : select.value),
      write: (v) => (select.value = typeof v === 'string' ? v : ''),
      busy: () => false,
    };
  }
  const input = el('input');
  const { minimum: min, maximum: max } = prop;
  const range = prop.type === 'number' && min !== undefined && max !== undefined && max - min <= MAX_RANGE_SPAN;
  input.type = range ? 'range' : 'number';
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = prop.type === 'integer' ? '1' : range ? String((max! - min!) / 1000) : 'any';
  if (prop.default !== undefined) input.value = String(Number(prop.default.toFixed(4)));
  else if (!range) input.placeholder = name;
  let dragging = false;
  if (range) {
    capturePointer(input);
    input.addEventListener('pointerdown', () => (dragging = true));
    for (const ev of ['pointerup', 'lostpointercapture', 'blur'] as const) input.addEventListener(ev, () => (dragging = false));
  }
  return {
    el: input,
    read: () => (input.value === '' ? undefined : Number(input.value)),
    write: (v) => (input.value = typeof v === 'number' ? String(v) : ''),
    busy: () => dragging || (!range && document.activeElement === input),
  };
}

export function createPanel(koi: KoiApi): void {
  const root = el('aside');
  root.id = 'koi-debug';
  root.setAttribute('aria-label', 'Debug panel');
  const out = el('pre', 'out');
  out.hidden = true;
  const syncs: ((s: DebugState) => void)[] = [];
  /** Day-part ticks under the phase slider (see ENHANCE). */
  const ticks: HTMLButtonElement[] = [];

  koi.register({
    name: 'setPanel',
    description: 'Shows or hides the debug panel. Omit `visible` to toggle it.',
    inputSchema: {
      type: 'object',
      properties: { visible: { type: 'boolean', description: 'Panel shown.' } },
      additionalProperties: false,
    },
    annotations: { section: 'panel', live: true, shortcut: { key: 'p', does: 'show / hide this panel' } },
    needs: 'nothing',
    run: (args) => {
      root.hidden = typeof args.visible === 'boolean' ? !args.visible : !root.hidden;
      if (visibleBox) visibleBox.checked = !root.hidden;
      return { visible: !root.hidden };
    },
  });

  /** Shows a call's result or error under the panel; captures as a thumbnail. */
  const show = (name: string, r: Awaited<ReturnType<KoiApi['call']>>) => {
    out.hidden = false;
    out.classList.toggle('error', !r.ok);
    out.replaceChildren();
    if (!r.ok) {
      out.textContent = `${name}: ${r.error.code}\n${r.error.message}`;
      return;
    }
    const result = r.result as { dataUrl?: string } | null;
    if (typeof result?.dataUrl === 'string') {
      const link = el('a');
      link.href = result.dataUrl;
      link.download = `koi-${Date.now()}.png`;
      link.title = 'Download the PNG';
      const img = el('img');
      img.src = result.dataUrl;
      img.alt = 'Captured frame';
      link.append(img);
      out.append(link);
      return;
    }
    const text = JSON.stringify(r.result, null, 1);
    out.textContent = `${name} → ${text.length > 4000 ? `${text.slice(0, 4000)}…` : text}`;
  };

  const run = (name: string, args?: Record<string, unknown>, quiet = false) =>
    koi.call(name, args).then((r) => {
      // Live controls only report failures; buttons always show what came back.
      if (!quiet || !r.ok) show(name, r);
      return r;
    });

  /** The controls of one tool, generated from its schema. */
  const toolRow = (tool: ToolInfo): HTMLElement => {
    const row = el('div', 'tool');
    const props = Object.entries(tool.inputSchema.properties).filter(([p]) => !DRIVEN[tool.name]?.includes(p));
    const key = tool.annotations.shortcut;
    const head = el('div', 'head');
    head.title = tool.description;
    head.append(el('span', 'name', tool.name));
    if (key) head.append(el('kbd', undefined, keyName(key.key)));
    if (!props.length) {
      row.classList.add('bare');
      const b = button(tool.name, () => void run(tool.name));
      b.title = tool.description;
      row.append(b);
      if (key) row.append(el('kbd', undefined, keyName(key.key)));
      return row;
    }
    row.append(head);
    const controls = new Map<string, Control>();
    for (const [prop, schema] of props) {
      const c = control(prop, schema, !tool.inputSchema.required?.includes(prop));
      controls.set(prop, c);
      const label = el('label');
      label.title = `${describeProp(schema)} — ${schema.description}`;
      label.append(el('span', 'prop', prop), c.el);
      if (c.el instanceof HTMLInputElement && c.el.type === 'range') {
        const value = el('span', 'value');
        const update = () => (value.textContent = Number((c.el as HTMLInputElement).value).toFixed(3));
        c.el.addEventListener('input', update);
        const write = c.write;
        c.write = (v) => {
          write(v);
          update();
        };
        label.append(value);
        update();
      }
      row.append(label);
      const enhanced = ENHANCE[`${tool.name}.${prop}`]?.(c, label, run, ticks) ?? false;
      if (tool.annotations.live && !enhanced) {
        const isRange = c.el instanceof HTMLInputElement && c.el.type === 'range';
        c.el.addEventListener(isRange ? 'input' : 'change', () => {
          const v = c.read();
          if (v !== undefined) void run(tool.name, { [prop]: v }, true);
        });
      }
    }
    if (!tool.annotations.live) {
      // All arguments optional: calling with none means something (a random seed, the full window).
      if (!tool.inputSchema.required?.length) {
        const bare = button('run()', () => void run(tool.name, {}));
        bare.title = `${tool.name} with no arguments`;
        row.append(bare);
      }
      const b = button('run', () => {
        const args: Record<string, unknown> = {};
        for (const [prop, c] of controls) {
          const v = c.read();
          if (v !== undefined) args[prop] = v;
        }
        void run(tool.name, args);
      });
      b.title = tool.description;
      row.append(b);
    }
    const reflects = tool.annotations.reflects;
    if (reflects) {
      syncs.push((s) => {
        const values = s[reflects] as Record<string, unknown>;
        for (const [prop, c] of controls) if (prop in values && !c.busy()) c.write(values[prop]);
      });
    }
    return row;
  };

  // Header: title, the panel's own tool and every shortcut.
  const header = el('div', 'header');
  header.append(el('strong', undefined, 'koi debug'));
  const tools = koi.tools();
  for (const t of tools.filter((t) => t.annotations.section === 'panel')) header.append(toolRow(t));
  // The panel's visibility isn't scene state, so setPanel's own checkbox is kept in step here.
  const visibleBox = header.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (visibleBox) visibleBox.checked = true;
  const keys = el('div', 'keys');
  keys.textContent = tools
    .filter((t) => t.annotations.shortcut)
    .map((t) => `${keyName(t.annotations.shortcut!.key)} ${t.annotations.shortcut!.does}`)
    .join(' · ');
  root.append(header, keys);

  // Perf: live text and frame graph, fed through the API.
  const perfText = el('pre', 'perf');
  const graph = el('canvas');
  graph.width = HISTORY;
  graph.height = 48;
  const frames = new Float32Array(HISTORY);
  let head = 0;
  let filled = 0;
  const readout = el('div', 'readout');

  for (const section of SECTIONS) {
    const details = el('details');
    details.open = true;
    details.append(el('summary', undefined, section.title));
    if (section.id === 'perf') details.append(perfText, graph);
    for (const t of tools.filter((t) => t.annotations.section === section.id)) {
      details.append(toolRow(t));
      if (t.name === 'setTime') details.append(readout);
    }
    root.append(details);
  }
  root.append(out);
  document.body.append(root);

  const ctx = graph.getContext('2d')!;
  const drawGraph = () => {
    const w = graph.width;
    const h = graph.height;
    const y = (ms: number) => h - Math.min(ms / GRAPH_MS, 1) * h;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < filled; i++) {
      const ms = frames[(head - filled + i + HISTORY) % HISTORY];
      ctx.fillStyle = ms > 33.4 ? '#e5484d' : ms > 17.5 ? '#f0b429' : '#4cc38a';
      const top = y(ms);
      ctx.fillRect(w - filled + i, top, 1, h - top);
    }
    // 60 and 30 fps reference lines.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, Math.round(y(1000 / 60)), w, 1);
    ctx.fillRect(0, Math.round(y(1000 / 30)), w, 1);
  };
  let graphQueued = false;
  koi.on('frame', (f) => {
    frames[head] = f.intervalMs;
    head = (head + 1) % HISTORY;
    filled = Math.min(filled + 1, HISTORY);
    // At most one redraw per animation frame: step({ frames: 3600 }) emits 3600 events in one task.
    if (graphQueued) return;
    graphQueued = true;
    requestAnimationFrame(() => {
      graphQueued = false;
      if (!root.hidden) drawGraph();
    });
  });

  const sync = (s: DebugState) => {
    for (const fn of syncs) fn(s);
    const t = s.time;
    readout.textContent = `${t.phase.toFixed(3)} ${t.clock} ${t.part} · ${t.mode}${t.held ? ' (held)' : ''}`;
    const part = [...DAY_PART_IDS].reverse().find((p) => p.at <= t.phase) ?? DAY_PART_IDS[0];
    for (const tick of ticks) tick.classList.toggle('on', tick.dataset.part === part.id);
  };
  koi.on('change', (e) => sync(e.state));

  const perfLine = (p: Record<string, number | string | boolean | null>) =>
    [
      `${Number(p.fps).toFixed(0).padStart(3)} fps   1% low ${Number(p.low1Fps).toFixed(0)}`,
      `frame ${Number(p.frameMs).toFixed(2)} ms  max ${Number(p.maxFrameMs).toFixed(1)}`,
      `cpu   ${Number(p.cpuMs).toFixed(2)} ms`,
      `gpu   ${p.gpuTimer ? (p.gpuMs === null ? '…' : `${Number(p.gpuMs).toFixed(2)} ms`) : 'n/a'}`,
      `${p.width}×${p.height}${p.software ? '  (software)' : ''}`,
      String(p.gpu),
      `seed ${p.seed}`,
    ].join('\n');

  // The running phase and the perf figures change without any call: poll them.
  const poll = async () => {
    if (!root.hidden) {
      const s = await koi.call('getState');
      if (s.ok) sync(s.result as DebugState);
      const p = await koi.call('getPerf');
      perfText.textContent = p.ok ? perfLine(p.result as Record<string, number>) : p.error.message;
    }
    setTimeout(poll, TEXT_MS);
  };
  void poll();
}

type Run = (name: string, args?: Record<string, unknown>, quiet?: boolean) => Promise<unknown>;

/** Richer behaviour for particular generated controls; true when it replaces the live call. */
const ENHANCE: Record<string, (c: Control, label: HTMLElement, run: Run, ticks: HTMLButtonElement[]) => boolean> = {
  // The phase slider holds the phase while dragged and hands it back to the
  // time mode on release; day-part ticks under it jump there.
  'setTime.phase': (c, label, run, ticks) => {
    const slider = c.el as HTMLInputElement;
    let held = false;
    // A held set instead of the generic live handler's plain one.
    slider.addEventListener('input', () => {
      held = true;
      void run('setTime', { phase: Number(slider.value), hold: true }, true);
    });
    // 'change' covers key steps, but a drag that ends where it started fires
    // no 'change', so pointer release and blur also let go.
    const release = () => {
      if (!held) return;
      held = false;
      void run('setTime', { hold: false }, true);
    };
    for (const ev of ['change', 'pointerup', 'lostpointercapture', 'blur'] as const) slider.addEventListener(ev, release);

    const track = el('div', 'track');
    const marks = el('div', 'ticks');
    for (const part of DAY_PART_IDS) {
      const tick = button(part.name === 'noon' ? '12' : part.name === 'afternoon' ? 'a' : part.name[0], () => {
        void run('setDayPart', { part: part.id }, true);
      });
      tick.dataset.part = part.id;
      tick.title = `${part.id}  ${part.at.toFixed(3)}  ${clock(part.at)}`;
      tick.setAttribute('aria-label', `Jump to ${part.name} (${clock(part.at)})`);
      tick.style.left = `${part.at * 100}%`;
      marks.append(tick);
      ticks.push(tick);
    }
    slider.replaceWith(track);
    track.append(slider, marks);
    // A div, not a label: clicking a tick must not also activate the slider.
    const row = el('div', label.className);
    row.title = label.title;
    row.append(...label.childNodes);
    label.replaceWith(row);
    return true;
  },
};
