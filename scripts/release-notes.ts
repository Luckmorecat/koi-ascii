// What a release needs from the repo, as pure functions for
// scripts/release-check.mjs and its tests.

/** The body of `version`'s CHANGELOG.md entry, or null when there is none or it is empty. */
export function releaseNotes(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const heading = /^##\s+\[?([^\]\s]+)\]?(\s|$)/;
  const start = lines.findIndex((line) => heading.exec(line)?.[1] === version);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? null : body;
}

/** Why the repo can't release `pkg.version`, or an empty list when it can. */
export function releaseProblems(
  pkg: { version: string },
  lock: { version?: string; packages?: Record<string, { version?: string }> },
  changelog: string,
): string[] {
  const v = pkg.version;
  const problems: string[] = [];
  if (lock.version !== v) problems.push(`package-lock.json has version ${lock.version}, package.json ${v}`);
  const root = lock.packages?.['']?.version;
  if (root !== v) problems.push(`package-lock.json's root package has version ${root}, package.json ${v}`);
  if (releaseNotes(changelog, v) === null) problems.push(`CHANGELOG.md has no entry for ${v} (a "## [${v}]" heading with text under it)`);
  return problems;
}
