// What a release needs, as pure functions for scripts/release-check.mjs,
// scripts/release-plan.mjs and their tests.

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

/** Semver precedence: negative when `a` comes before `b`, 0 when equal, positive after. Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('+')[0].split(/-(.*)/s);
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A release comes after its prereleases.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

/** What release.yml found out about `version` before doing anything. */
export interface ReleaseFacts {
  version: string;
  /** The commit this run releases. */
  sha: string;
  onNpm: boolean;
  /** The commit tag v<version> points at, or null when there is no tag. */
  tagSha: string | null;
  hasRelease: boolean;
  /** npm's dist-tags for the package, such as { latest: '0.3.1' }. */
  distTags: Record<string, string>;
}

/** What release.yml still has to do for `version`. */
export interface ReleasePlan {
  publish: boolean;
  tag: boolean;
  release: boolean;
  /** The dist-tag to publish under: its channel, or `previous` when the channel already has a newer version. */
  distTag: string;
  /** Whether the GitHub Release is a prerelease, whatever the dist-tag. */
  prerelease: boolean;
  /** Whether the GitHub Release is marked latest. */
  latest: boolean;
  deploy: boolean;
}

/**
 * Each step runs only when its work is missing, so re-running finishes a
 * release. A version older than its channel's (a retry after a newer
 * release) completes without moving `latest`, `next` or the demo back. The
 * demo deploys for the newest release when this run is that release's
 * commit, so a full re-run redeploys it but a later push to package.json
 * doesn't.
 */
export function releasePlan(facts: ReleaseFacts): ReleasePlan {
  const prerelease = facts.version.includes('-');
  const channel = prerelease ? 'next' : 'latest';
  const head = facts.distTags[channel];
  const current = head === undefined || compareVersions(facts.version, head) >= 0;
  return {
    publish: !facts.onNpm,
    tag: facts.tagSha === null,
    release: !facts.hasRelease,
    distTag: current ? channel : 'previous',
    prerelease,
    latest: current && channel === 'latest',
    deploy: current && channel === 'latest' && (facts.tagSha ?? facts.sha) === facts.sha,
  };
}
