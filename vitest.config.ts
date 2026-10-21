import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only; test/browser/ is Playwright's (npm run test:browser).
export default defineConfig({
  test: {
    // .claude/ holds agent worktrees with their own copies of test/.
    exclude: [...configDefaults.exclude, 'test/browser/**', '.claude/**'],
    // The on-disk cache keeps a test's import.meta.glob results, so a new
    // shader would slip past test/shader-size.test.ts. Off costs ~0.1 s.
    fsModuleCache: false,
  },
});
