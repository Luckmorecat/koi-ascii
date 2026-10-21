import { defineConfig } from 'vite';

// Dev server for the browser tests, started and stopped by Playwright's
// `webServer`, which runs it from the repo root: the root is served, so the
// fixture can import src/ and the built dist/index.js by URL.
export default defineConfig({
  publicDir: false,
  clearScreen: false,
  // The fixture has no bare imports; skip the dep scan so no mid-test reload.
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { hmr: false, watch: null },
});
