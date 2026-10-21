import { describe, expect, it } from 'vitest';
import { releaseNotes, releaseProblems } from '../scripts/release-notes';

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
