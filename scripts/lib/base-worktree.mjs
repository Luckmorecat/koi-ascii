// A throwaway checkout of another revision, for tools that compare against a
// base (`npm run shots -- --base`, `npm run perf -- --base`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** `cp -al` in Node, so it works on Windows too: hard links, copies where linking fails. */
function linkTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip?.includes(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) linkTree(src, dst);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else {
      try {
        fs.linkSync(src, dst);
      } catch {
        fs.copyFileSync(src, dst);
      }
    }
  }
}

/**
 * Checks `rev` out as a detached worktree in .claude/worktrees/base-<sha>-<pid>,
 * runs `fn(dir)` and removes the worktree again, also on error and Ctrl-C.
 * node_modules is hard-linked from this checkout (linkTree): a symlink outside the
 * worktree makes Vite answer 403. Resolves to what `fn` resolves to.
 */
export async function withBaseWorktree(rev, fn) {
  let sha;
  try {
    sha = git('rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  } catch {
    throw new Error(`can't check out --base ${rev}: not a revision of this repo?`);
  }
  const top = git('rev-parse', '--show-toplevel');
  const dir = path.join(top, '.claude', 'worktrees', `base-${sha.slice(0, 9)}-${process.pid}`);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' });
    }
  };
  const onSignal = () => {
    remove();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', remove);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'ignore' });
    // Vite's dep cache is written in place; the base gets its own.
    linkTree(path.join(top, 'node_modules'), path.join(dir, 'node_modules'), ['.vite']);
    return await fn(dir);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', remove);
    remove();
  }
}
