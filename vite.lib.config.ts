import { defineConfig, type Plugin } from 'vite';

/**
 * Ships the `?raw` shaders without their `//` comments, a third of the GLSL
 * text. GLSL reads a comment as whitespace, so the compiled shaders are
 * unchanged, and every line break stays, so compile errors still name
 * `file:line` (src/shaders/scene/index.ts). The demo serves them the same
 * way; the unit tests read the files as written (test/shader-size.test.ts
 * checks the chunk headers).
 */
export function stripGlslComments(): Plugin {
  return {
    name: 'strip-glsl-comments',
    transform(code, id) {
      if (!/\.(?:glsl|frag|vert)\?raw$/.test(id)) return null;
      const fail = (why: string) => new Error(`strip-glsl-comments: ${id}: ${why}`);
      // What Vite's `?raw` loader emits: one JSON string literal.
      const literal = /^export default (".*")$/.exec(code)?.[1];
      if (literal === undefined) throw fail('not a `?raw` string module');
      const src: string = JSON.parse(literal);
      // Line by line is exact for `//` comments only: a /* */ one can span
      // lines, and one ending in `\` runs on into the next.
      if (src.includes('/*')) throw fail('has a /* */ comment');
      const stripped = src.replace(/[ \t]*\/\/.*$/gm, (comment) => {
        if (comment.endsWith('\\')) throw fail('has a // comment ending in \\');
        return '';
      });
      return { code: `export default ${JSON.stringify(stripped)}`, map: null };
    },
  };
}

// The npm package: one ESM file with the shaders inlined (`?raw`) and no
// runtime imports. Declarations come from tsc (see package.json "build").
export default defineConfig({
  publicDir: false,
  plugins: [stripGlslComments()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    // No `//#region src/…?raw` source comments in the published file.
    rolldownOptions: { experimental: { attachDebugInfo: 'none' } },
  },
});
