// The one way to launch Chromium for this repo: hardware WebGL on the GPU,
// never SwiftShader. Used by playwright.config.ts, gpu-setup.ts and
// scripts/demo.mjs (which imports this file directly, so keep it to
// erasable TypeScript: type-only imports, no enums).
import type { Browser, LaunchOptions } from '@playwright/test';

// The repo has no @types/node; this is all this file needs of it.
declare const process: { platform: string };

// ANGLE backend that reaches the hardware driver in headless mode. Verified on
// Linux (Mesa); macOS only allows Metal, Windows defaults to D3D11.
const ANGLE_BACKEND: Record<string, string> = { linux: 'gl-egl', darwin: 'metal', win32: 'd3d11' };

export const gpuLaunchOptions: LaunchOptions = {
  args: [
    '--use-gl=angle',
    `--use-angle=${ANGLE_BACKEND[process.platform] ?? 'default'}`,
    '--ignore-gpu-blocklist',
    // No CPU fallback: with a bad setup WebGL2 is missing and runs fail loudly.
    '--disable-software-rasterizer',
    // Uncapped rAF, so frame timings measure the GPU rather than vsync.
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
  // Playwright adds this by default; it lets Chromium fall back to SwiftShader.
  ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
};

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** Returns the GL renderer string; throws if WebGL is off or runs on the CPU. */
export async function assertGpu(browser: Browser): Promise<string> {
  const cdp = await browser.newBrowserCDPSession();
  const { gpu } = (await cdp.send('SystemInfo.getInfo')) as {
    gpu: { featureStatus: Record<string, string>; auxAttributes?: { glRenderer?: string } };
  };
  await cdp.detach();
  const renderer = gpu.auxAttributes?.glRenderer ?? '';
  const webgl = gpu.featureStatus.webgl2 ?? gpu.featureStatus.webgl ?? 'unknown';
  if (SOFTWARE.test(renderer) || !webgl.startsWith('enabled')) {
    throw new Error(`Refusing to run on software GL: renderer="${renderer}" webgl2=${webgl}`);
  }
  return renderer;
}
