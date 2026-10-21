import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only; test/browser/ is Playwright's (npm run test:browser).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/browser/**'],
  },
});
