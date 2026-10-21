import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only; test/browser/ is Playwright's (npm run test:browser).
export default defineConfig({
  test: {
    // .claude/ holds agent worktrees with their own copies of test/.
    exclude: [...configDefaults.exclude, 'test/browser/**', '.claude/**'],
  },
});
