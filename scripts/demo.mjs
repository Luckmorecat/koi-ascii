// Shared by shot.mjs and perf.mjs: the demo's Vite server and a GPU browser.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import path from 'node:path';
import { assertGpu, gpuLaunchOptions } from '../test/browser/gpu.ts';

/**
 * Starts the demo of the checkout at `dir` on a free port. `url(query)` gives
 * the page URL for a query such as '?seed=7' (the leading ? may be left out).
 */
export async function startDemo(dir = process.cwd()) {
  const server = await createServer({
    configFile: path.join(dir, 'vite.demo.config.ts'),
    // The config's root is relative to the working directory, not the config file.
    root: path.join(dir, 'demo'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  return {
    server,
    url: (query) => new URL(query.replace(/^(?=[^?/])/, '?'), server.resolvedUrls.local[0]).href,
    close: () => server.close(),
  };
}

/** Chromium on the GPU; throws if it would render on the CPU. */
export async function launchGpu() {
  const browser = await chromium.launch(gpuLaunchOptions);
  try {
    return { browser, renderer: await assertGpu(browser) };
  } catch (e) {
    await browser.close();
    throw e;
  }
}
