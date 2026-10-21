import { describe, expect, it } from 'vitest';
import { sourceLine } from '../src/gl/program';
import { sceneChunks, sceneLines, sceneSrc } from '../src/shaders/scene';

describe('compile errors name the scene chunk', () => {
  it('sceneLines puts each chunk at its first line in sceneSrc', () => {
    const lines = sceneSrc.split('\n');
    sceneChunks.forEach(([name, src], i) => {
      expect(sceneLines[i].name).toBe(name);
      expect(lines.slice(sceneLines[i].line - 1, sceneLines[i].line - 1 + src.split('\n').length - 1).join('\n') + '\n').toBe(src);
    });
  });

  it('sourceLine maps a compiled line to file:line, and leaves lines before the first file as numbers', () => {
    const files = [
      { name: 'a.glsl', line: 5 },
      { name: 'b.glsl', line: 9 },
    ];
    expect(sourceLine(files, 4)).toBe('4');
    expect(sourceLine(files, 5)).toBe('a.glsl:1');
    expect(sourceLine(files, 8)).toBe('a.glsl:4');
    expect(sourceLine(files, 12)).toBe('b.glsl:4');
    expect(sourceLine([], 12)).toBe('12');
  });
});
