import { chromium } from '@playwright/test';
import { assertGpu, gpuLaunchOptions } from './gpu';

// Fails the whole run up front if Chromium would render on the CPU.
export default async function gpuSetup(): Promise<void> {
  const browser = await chromium.launch(gpuLaunchOptions);
  try {
    console.log(`GPU: ${await assertGpu(browser)}`);
  } finally {
    await browser.close();
  }
}
