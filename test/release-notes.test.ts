import { describe, expect, it } from 'vitest';
import { compareVersions, releaseNotes, releasePlan, releaseProblems, type ReleaseFacts } from '../scripts/release-notes';

const changelog = `# Changelog

## [Unreleased]

## [0.3.1] - 2026-10-21

### Added
- Stars.

## 0.1.0

First release.
`;

describe('releaseNotes', () => {
  it('returns the body under the version heading, up to the next one', () => {
    expect(releaseNotes(changelog, '0.3.1')).toBe('### Added\n- Stars.');
  });

  it('reads a heading without brackets', () => {
    expect(releaseNotes(changelog, '0.1.0')).toBe('First release.');
  });

  it('is null for a missing version, an empty entry, or a version that only prefixes another', () => {
    expect(releaseNotes(changelog, '0.2.0')).toBeNull();
    expect(releaseNotes(changelog, 'Unreleased')).toBeNull();
    expect(releaseNotes(changelog, '0.3')).toBeNull();
  });
});

describe('releaseProblems', () => {
  const lock = (v: string) => ({ version: v, packages: { '': { version: v } } });

  it('passes when the lockfile matches and the changelog has an entry', () => {
    expect(releaseProblems({ version: '0.3.1' }, lock('0.3.1'), changelog)).toEqual([]);
  });

  it('names a stale lockfile and a missing entry', () => {
    const problems = releaseProblems({ version: '0.4.0' }, lock('0.3.1'), changelog);
    expect(problems).toHaveLength(3);
    expect(problems[2]).toContain('no entry for 0.4.0');
  });
});

describe('compareVersions', () => {
  it('orders by semver precedence', () => {
    const ordered = ['0.3.1', '0.3.10', '0.4.0-alpha', '0.4.0-alpha.1', '0.4.0-alpha.beta', '0.4.0-beta.2', '0.4.0-beta.11', '0.4.0', '1.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(ordered[i - 1], ordered[i])).toBeLessThan(0);
      expect(compareVersions(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
    }
    expect(compareVersions('0.4.0+build', '0.4.0')).toBe(0);
  });
});

describe('releasePlan', () => {
  const fresh: ReleaseFacts = {
    version: '0.3.1',
    sha: 'abc',
    onNpm: false,
    tagSha: null,
    hasRelease: false,
    distTags: { latest: '0.1.0' },
  };

  it('does every step for a new version, under latest, and deploys', () => {
    expect(releasePlan(fresh)).toEqual({ publish: true, tag: true, release: true, distTag: 'latest', latest: true, deploy: true });
  });

  it('redeploys on a full re-run once everything else is done', () => {
    const done = { ...fresh, onNpm: true, tagSha: 'abc', hasRelease: true, distTags: { latest: '0.3.1' } };
    expect(releasePlan(done)).toMatchObject({ publish: false, tag: false, release: false, deploy: true });
  });

  it("doesn't deploy for a later push that leaves the released version", () => {
    const later = { ...fresh, sha: 'def', onNpm: true, tagSha: 'abc', hasRelease: true, distTags: { latest: '0.3.1' } };
    expect(releasePlan(later).deploy).toBe(false);
  });

  it('completes an older version without moving latest or the demo back', () => {
    const retry = { ...fresh, distTags: { latest: '0.4.0' } };
    expect(releasePlan(retry)).toEqual({ publish: true, tag: true, release: true, distTag: 'previous', latest: false, deploy: false });
  });

  it('sends a prerelease to next and leaves the demo and latest alone', () => {
    const beta = { ...fresh, version: '0.4.0-beta.1', distTags: { latest: '0.3.1', next: '0.4.0-beta.0' } };
    expect(releasePlan(beta)).toMatchObject({ distTag: 'next', latest: false, deploy: false });
    expect(releasePlan({ ...beta, distTags: { next: '0.4.0-beta.2' } }).distTag).toBe('previous');
  });
});
