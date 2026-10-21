import { defineConfig } from 'vite';

// The demo page (GitHub Pages builds it with `--base /koi-ascii/`).
export default defineConfig({
  root: 'demo',
  publicDir: false,
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
  },
});
