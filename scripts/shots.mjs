// A reproducible screenshot matrix of the demo on the GPU: palettes × sky
// settings × phases, optionally against a base revision ("is sky=none
// byte-identical to main?"). One Vite server per side and one Chromium for the
// whole matrix. Each cell loads ?debug&time=fixed&phase=…&palette=…&sky=…,
// pins the viewport, reseeds, steps and calls koi.capture. Prints a short
// table on stderr and one JSON report on stdout; exits 1 on page errors (cells
// that differ from the base don't count). Run it through `npm run shots` (see
// shot.mjs for why --experimental-strip-types).
//
//   npm run shots -- [--phases 0.05,0.5,0.8] [--palettes pond] [--sky default]
//                    [--query params] [--seed 42] [--frames 120] [--size 800x600]
//                    [--dpr 1] [--base rev] [--sheet] [--reduced-motion]
//                    [--out test-results/shots-matrix]
//
//   --phases    fixed phases, comma-separated (0 → midnight, 0.5 → noon)
//   --palettes  koiPalettes names, comma-separated (pond, mono, phosphor, amber, paper, brand)
//   --sky       sky settings, comma-separated: none, all, default (the page's own, left
//               out of the URL) or features joined with + (stars+moon)
//   --query     extra demo params added to every cell, e.g. 'intensity=0.5&glow=off'
//   --seed, --frames  koi.reseed({seed}) and koi.step({frames}) before each capture
//   --size, --dpr     koi.setViewport({width, height, dpr}); the page is the same size
//   --base      also render every cell from this revision (a branch, tag or sha) and
//               report SAME or DIFF per cell: same bytes, or else same decoded pixels.
//               A DIFF gets its changed-pixel count, bounding box and a diff image
//               (changed pixels red over a dimmed head). The base is checked out as a
//               detached worktree in .claude/worktrees/ (scripts/lib/base-worktree.mjs)
//               and removed afterwards, also on error or Ctrl-C. Head is the working
//               tree, uncommitted changes included. The base needs koi.capture.
//   --sheet     one labelled contact sheet per palette: columns are phases, rows are sky
//               settings (with --base, a base and a head row for each, DIFF cells
//               outlined in red). Drawn on a canvas in the browser.
//   --reduced-motion  emulates prefers-reduced-motion: reduce, as in shot.mjs
//   --out       writes <out>/<palette>/<phase>-<sky>.png, and with --base also
//               …-<sky>.base.png and, for a DIFF, …-<sky>.diff.png; --sheet writes
//               <out>/<palette>/sheet.png. Old PNGs in those folders are removed first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchGpu, startDemo } from './demo.mjs';
import { withBaseWorktree } from './lib/base-worktree.mjs';

const { values: opt } = parseArgs({
  options: {
    phases: { type: 'string', default: '0.05,0.5,0.8' },
    palettes: { type: 'string', default: 'pond' },
    sky: { type: 'string', default: 'default' },
    query: { type: 'string', default: '' },
    seed: { type: 'string', default: '42' },
    frames: { type: 'string', default: '120' },
    size: { type: 'string', default: '800x600' },
    dpr: { type: 'string', default: '1' },
    base: { type: 'string' },
    sheet: { type: 'boolean', default: false },
    'reduced-motion': { type: 'boolean', default: false },
    out: { type: 'string', default: 'test-results/shots-matrix' },
  },
});
const list = (s) => s.split(',').map((v) => v.trim()).filter(Boolean);
const phases = list(opt.phases);
const palettes = list(opt.palettes);
const skies = list(opt.sky);
const [width, height] = opt.size.split('x').map(Number);
const dpr = +opt.dpr;
const seed = +opt.seed;
const frames = +opt.frames;
const extra = opt.query.replace(/^[?&]+/, '');
const reducedMotion = opt['reduced-motion'];
const out = path.resolve(opt.out);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const top = git('rev-parse', '--show-toplevel');
const started = Date.now();

const report = {
  renderer: '',
  viewport: { width, height, dpr },
  seed,
  frames,
  reducedMotion,
  head: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' },
  base: null,
  cells: [],
  sheets: {},
  summary: null,
  wallSeconds: 0,
  errors: [],
};

function cellQuery(palette, phase, sky) {
  const params = ['debug', 'time=fixed', `phase=${phase}`, `palette=${palette}`];
  if (sky !== 'default') params.push(`sky=${sky.replaceAll('+', ',')}`);
  if (extra) params.push(extra);
  return `?${params.join('&')}`;
}

async function run(baseDir) {
  const demos = {};
  let browser;
  try {
    if (baseDir) demos.base = await startDemo(baseDir);
    demos.head = await startDemo(top);
    ({ browser, renderer: report.renderer } = await launchGpu());
    const sides = Object.keys(demos).sort(); // base, head

    /** The cell being rendered, so page errors say where they came from. */
    let current = '';
    const pages = {};
    for (const side of sides) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      page.on('console', (m) => m.type() === 'error' && report.errors.push(`${side} ${current}: ${m.text()}`));
      page.on('pageerror', (e) => report.errors.push(`${side} ${current}: ${e.message}`));
      await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
      pages[side] = page;
    }
    // Compares and composes images; no demo on it.
    const tool = await browser.newPage();

    async function render(side, query) {
      const page = pages[side];
      await page.goto(demos[side].url(query));
      await page.waitForFunction(() => !!window.koi, null, { timeout: 15_000 });
      const shot = await page.evaluate(
        async (steps) => {
          await window.koi.ready;
          let result;
          for (const [name, args] of steps) {
            const r = await window.koi.call(name, args);
            if (!r.ok) throw new Error(`koi.${name}: ${r.error.message}`);
            result = r.result;
          }
          return result;
        },
        [
          ['setViewport', { width, height, dpr }],
          ['reseed', { seed }],
          ['step', { frames }],
          ['capture', {}],
        ],
      );
      return Buffer.from(shot.dataUrl.slice(shot.dataUrl.indexOf(',') + 1), 'base64');
    }

    for (const palette of palettes) {
      const dir = path.join(out, palette);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.rmSync(path.join(dir, f));
    }

    for (const palette of palettes) {
      for (const sky of skies) {
        for (const phase of phases) {
          const query = cellQuery(palette, phase, sky);
          const stem = path.join(out, palette, `${phase}-${sky}`);
          const cell = { palette, phase, sky, query, head: `${stem}.png` };
          report.cells.push(cell);
          current = `${palette} ${phase} ${sky}`;
          if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${current}`);
          const png = {};
          for (const side of sides) {
            try {
              png[side] = await render(side, query);
            } catch (e) {
              report.errors.push(`${side} ${current}: ${e.message}`);
            }
          }
          if (png.head) fs.writeFileSync(cell.head, png.head);
          else cell.head = null;
          if (!baseDir) continue;
          cell.base = png.base ? `${stem}.base.png` : null;
          if (png.base) fs.writeFileSync(cell.base, png.base);
          if (!png.base || !png.head) {
            cell.status = 'ERROR';
            continue;
          }
          if (png.base.equals(png.head)) {
            cell.status = 'SAME';
            cell.bytesEqual = true;
            continue;
          }
          const d = await tool.evaluate(comparePixels, { a: png.base.toString('base64'), b: png.head.toString('base64') });
          cell.status = d.changedPixels ? 'DIFF' : 'SAME';
          cell.bytesEqual = false;
          if (!d.changedPixels) continue;
          cell.changedPixels = d.changedPixels;
          cell.bbox = d.bbox;
          if (d.sizes) cell.sizes = d.sizes;
          cell.diff = `${stem}.diff.png`;
          fs.writeFileSync(cell.diff, Buffer.from(d.png, 'base64'));
        }
      }
    }
    if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

    if (opt.sheet) {
      for (const palette of palettes) {
        const rows = [];
        for (const sky of skies) {
          for (const side of sides) {
            rows.push({
              label: baseDir ? `${sky} · ${side}` : sky,
              cells: phases.map((phase) => {
                const c = report.cells.find((x) => x.palette === palette && x.sky === sky && x.phase === phase);
                const file = c[side];
                return {
                  png: file ? fs.readFileSync(file).toString('base64') : null,
                  diff: side === 'head' && c.status === 'DIFF',
                };
              }),
            });
          }
        }
        const sheet = await tool.evaluate(composeSheet, {
          title: `${palette}  seed ${seed}  ${frames} frames  ${width}×${height}@${dpr}${extra ? `  ${extra}` : ''}`,
          columns: phases.map((p) => `phase ${p}`),
          rows,
        });
        const file = path.join(out, palette, 'sheet.png');
        fs.writeFileSync(file, Buffer.from(sheet, 'base64'));
        report.sheets[palette] = file;
      }
    }
  } finally {
    await browser?.close();
    for (const d of Object.values(demos)) await d.close();
  }
}

/** In the browser: base64 PNGs a and b, pixel by pixel. */
async function comparePixels({ a, b }) {
  const decode = async (s) => {
    const blob = await (await fetch(`data:image/png;base64,${s}`)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  };
  const [x, y] = await Promise.all([decode(a), decode(b)]);
  const w = Math.max(x.width, y.width);
  const h = Math.max(x.height, y.height);
  const diff = new ImageData(w, h);
  let changedPixels = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const inX = i < x.width && j < x.height;
      const inY = i < y.width && j < y.height;
      const p = (j * x.width + i) * 4;
      const q = (j * y.width + i) * 4;
      const o = (j * w + i) * 4;
      // Outside both images (one is wider, the other taller): nothing to compare.
      if (!inX && !inY) {
        diff.data.set([0, 0, 0, 255], o);
        continue;
      }
      // Only read a buffer inside its own image: past its width, an index aliases the next row.
      const changed =
        inX !== inY ||
        x.data[p] !== y.data[q] ||
        x.data[p + 1] !== y.data[q + 1] ||
        x.data[p + 2] !== y.data[q + 2] ||
        x.data[p + 3] !== y.data[q + 3];
      if (changed) {
        changedPixels++;
        if (i < x0) x0 = i;
        if (j < y0) y0 = j;
        if (i > x1) x1 = i;
        if (j > y1) y1 = j;
        diff.data.set([255, 0, 0, 255], o);
      } else {
        const g = (y.data[q] * 0.3 + y.data[q + 1] * 0.59 + y.data[q + 2] * 0.11) * 0.3;
        diff.data.set([g, g, g, 255], o);
      }
    }
  }
  const result = { changedPixels };
  if (x.width !== y.width || x.height !== y.height) {
    result.sizes = { base: [x.width, x.height], head: [y.width, y.height] };
  }
  if (!changedPixels) return result;
  result.bbox = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').putImageData(diff, 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  result.png = btoa(bin);
  return result;
}

/** In the browser: a grid of base64 PNGs with column and row labels, as base64 PNG. */
async function composeSheet({ title, columns, rows }) {
  const images = await Promise.all(
    rows.map((r) =>
      Promise.all(
        r.cells.map(async (c) => (c.png ? createImageBitmap(await (await fetch(`data:image/png;base64,${c.png}`)).blob()) : null)),
      ),
    ),
  );
  const first = images.flat().find(Boolean);
  const scale = first ? Math.min(1, 480 / first.width) : 1;
  const cw = Math.round((first?.width ?? 480) * scale);
  const ch = Math.round((first?.height ?? 360) * scale);
  const gap = 8;
  const font = '14px ui-monospace, monospace';
  const measure = new OffscreenCanvas(1, 1).getContext('2d');
  measure.font = font;
  const labelW = Math.ceil(Math.max(...rows.map((r) => measure.measureText(r.label).width))) + 2 * gap;
  const titleH = 28;
  const headH = 24;
  const W = labelW + columns.length * (cw + gap) + gap;
  const H = titleH + headH + rows.length * (ch + gap) + gap;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16181c';
  ctx.fillRect(0, 0, W, H);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText(title, gap, titleH / 2 + 2);
  ctx.fillStyle = '#a8adb5';
  columns.forEach((c, i) => ctx.fillText(c, labelW + i * (cw + gap), titleH + headH / 2));
  rows.forEach((r, j) => {
    const y = titleH + headH + j * (ch + gap);
    ctx.fillStyle = '#a8adb5';
    ctx.fillText(r.label, gap, y + ch / 2);
    r.cells.forEach((c, i) => {
      const x = labelW + i * (cw + gap);
      const img = images[j][i];
      if (img) ctx.drawImage(img, x, y, cw, ch);
      else {
        ctx.fillStyle = '#3a1f1f';
        ctx.fillRect(x, y, cw, ch);
      }
      if (c.diff) {
        ctx.strokeStyle = '#ff3b3b';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
      }
    });
  });
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function table() {
  const base = !!report.base;
  const lines = [];
  if (base) {
    lines.push(
      `base ${report.base.rev} (${report.base.sha.slice(0, 9)})  vs  head ${report.head.sha.slice(0, 9)}${report.head.dirty ? ' + uncommitted' : ''}`,
    );
  }
  const cols = base ? ['palette', 'phase', 'sky', 'status', 'pixels', 'bbox'] : ['palette', 'phase', 'sky', 'png'];
  const rows = report.cells.map((c) =>
    base
      ? [c.palette, c.phase, c.sky, c.status, c.changedPixels ? String(c.changedPixels) : '', c.bbox ? `${c.bbox.width}×${c.bbox.height}+${c.bbox.x}+${c.bbox.y}` : '']
      : [c.palette, c.phase, c.sky, c.head ? path.relative(process.cwd(), c.head) : 'ERROR'],
  );
  const w = cols.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  for (const r of [cols, ...rows]) lines.push(r.map((v, i) => v.padEnd(w[i])).join('  ').trimEnd());
  if (report.summary) lines.push(Object.entries(report.summary).map(([k, v]) => `${v} ${k}`).join(', '));
  for (const s of Object.values(report.sheets)) lines.push(`sheet ${path.relative(process.cwd(), s)}`);
  if (report.errors.length) lines.push(`${report.errors.length} error(s), see the JSON report`);
  return lines.join('\n');
}

try {
  if (opt.base) {
    await withBaseWorktree(opt.base, (dir) => {
      report.base = { rev: opt.base, sha: git('-C', dir, 'rev-parse', 'HEAD') };
      return run(dir);
    });
    report.summary = { SAME: 0, DIFF: 0, ERROR: 0 };
    for (const c of report.cells) report.summary[c.status]++;
  } else {
    await run(null);
  }
} catch (e) {
  report.errors.push(`shots: ${e.message}`);
}
report.wallSeconds = +((Date.now() - started) / 1000).toFixed(1);
process.stderr.write(`${table()}\n${report.wallSeconds} s\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
