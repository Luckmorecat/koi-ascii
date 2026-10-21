import { defineConfig, devices } from '@playwright/test';

// The repo has no @types/node; this is all the config needs of it.
declare const process: { env: Record<string, string | undefined> };

const port = Number(process.env.KOI_TEST_PORT) || 4179;

// Browser tests for the library (test/browser/). Playwright builds the
// package, starts Vite and stops it again; nothing needs killing by hand.
export default defineConfig({
  testDir: 'test/browser',
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
        // Software WebGL2, so the suite runs on machines and CI runners without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
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
