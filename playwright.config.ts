import { defineConfig, devices } from '@playwright/test';
import { gpuLaunchOptions } from './test/browser/gpu';

// The repo has no @types/node; this is all the config needs of it.
declare const process: { env: Record<string, string | undefined> };

const port = Number(process.env.KOI_TEST_PORT) || 4179;

// Browser tests for the library (test/browser/). Playwright builds the
// package, starts Vite and stops it again; nothing needs killing by hand.
export default defineConfig({
  testDir: 'test/browser',
  globalSetup: './test/browser/gpu-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // GPU only; gpu-setup.ts aborts the run if Chromium falls back to the CPU.
        launchOptions: gpuLaunchOptions,
      },
    },
  ],
  webServer: {
    // The dist test needs a fresh build of the package.
    command: `npm run build && vite --config test/browser/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/test/browser/fixture/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
