// A throwaway checkout of another revision, for comparing it with the working
// tree (npm run perf --base, npm run shots --base).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function remove(dir) {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' });
  }
}

/**
 * Checks `rev` out as a detached worktree in .claude/worktrees/base-<sha>-<pid>
 * of this checkout, runs `fn(dir, { sha })` and returns its result. The
 * worktree is removed afterwards, also when fn throws or on Ctrl-C / SIGTERM
 * (which then exit 130). node_modules is hard-linked from this checkout: a
 * symlink makes Vite answer 403 Forbidden.
 */
export async function withBaseWorktree(rev, fn) {
  let sha;
  try {
    sha = git('rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  } catch {
    throw new Error(`--base ${rev} is not a revision of this repo`);
  }
  const top = git('rev-parse', '--show-toplevel');
  const dir = path.join(top, '.claude', 'worktrees', `base-${sha.slice(0, 9)}-${process.pid}`);
  const onSignal = () => {
    remove(dir);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'ignore' });
    execFileSync('cp', ['-al', path.join(top, 'node_modules'), path.join(dir, 'node_modules')]);
    // Vite's dep cache is written in place; the base gets its own.
    fs.rmSync(path.join(dir, 'node_modules', '.vite'), { recursive: true, force: true });
    return await fn(dir, { sha });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (fs.existsSync(dir)) remove(dir);
  }
}
