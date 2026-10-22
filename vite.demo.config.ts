import { defineConfig } from 'vite';
import { stripGlslComments } from './vite.lib.config';

// The demo page (GitHub Pages builds it with `--base /koi-ascii/`), with the
// shaders as the package ships them.
export default defineConfig({
  root: 'demo',
  publicDir: false,
  plugins: [stripGlslComments()],
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
  },
});
