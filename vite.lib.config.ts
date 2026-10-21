import { defineConfig } from 'vite';

// The npm package: one ESM file with the shaders inlined (`?raw`) and no
// runtime imports. Declarations come from tsc (see package.json "build").
export default defineConfig({
  publicDir: false,
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
