import { describe, expect, it } from 'vitest';
import { sceneChunks } from '../src/shaders/scene';

// Shader files stay small enough to read whole (docs/scene-features.md): a new
// feature gets its own chunk rather than growing one.
const LIMIT = 250;

// Files still over LIMIT, at their line count when they were listed. They may
// shrink (lower the number) but never grow. Empty since scene.frag's split.
const ALLOWANCE: Record<string, number> = {};

// Every shader file, keyed by its path under src/shaders/.
const SHADERS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../src/shaders/**/*.{glsl,frag,vert}', { query: '?raw', import: 'default', eager: true }),
  ).map(([file, src]) => [file.replace('../src/shaders/', ''), src]),
);
const files = Object.keys(SHADERS).sort();
const lines = (file: string) => SHADERS[file].split('\n').length - 1;

describe('shader size', () => {
  it('finds the shaders, scene chunks included', () => {
    expect(files).toContain('common.glsl');
    expect(files).toContain('scene/main.frag');
  });

  it.each(files)(`%s stays within ${LIMIT} lines`, (file: string) => {
    const n = lines(file);
    const cap = ALLOWANCE[file];
    if (cap === undefined) {
      expect(n, `${file} has ${n} lines, over ${LIMIT}: split it by domain (a new scene feature gets its own chunk, docs/scene-features.md)`).toBeLessThanOrEqual(LIMIT);
    } else {
      expect(n, `${file} has ${n} lines, over its allowance of ${cap}: a file on the allowance may shrink but never grow`).toBeLessThanOrEqual(cap);
    }
  });

  it('keeps each allowance at its file\'s line count, and only while it is over the limit', () => {
    for (const [file, cap] of Object.entries(ALLOWANCE)) {
      expect(files, `${file} is gone: remove its allowance`).toContain(file);
      expect(lines(file), `${file} is back within ${LIMIT} lines: remove its allowance`).toBeGreaterThan(LIMIT);
      expect(lines(file), `${file} shrank: lower its allowance to its line count`).toBe(cap);
    }
  });
});

describe('scene chunks', () => {
  const chunks = files.filter((f) => f.startsWith('scene/')).map((f) => f.slice('scene/'.length));

  it('index.ts joins every chunk in src/shaders/scene/', () => {
    expect(sceneChunks.map(([name]) => name).sort()).toEqual(chunks);
  });

  it.each(chunks)('%s opens with a header: what it draws, the uniforms it reads, the chunks it depends on', (file: string) => {
    const src = SHADERS[`scene/${file}`];
    const header = src.slice(0, src.search(/^(?!\/\/)/m));
    expect(header, `${file} must open with a // comment`).toMatch(/^\/\/ \S/);
    if (file !== 'uniforms.glsl') {
      expect(header, `${file}: name the uniforms it reads ("// Uniforms …")`).toMatch(/^\/\/ Uniforms\b/m);
      expect(header, `${file}: name the chunks it depends on ("// Depends on: …")`).toMatch(/^\/\/ Depends on: /m);
    }
  });
});
