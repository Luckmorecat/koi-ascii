// Checks that package.json's version can be released: package-lock.json
// matches it and CHANGELOG.md has an entry for it. Exits 1 with the
// problems otherwise. Runs on every PR (.github/workflows/release-check.yml)
// and before each publish (release.yml).
//
//   npm run release:check
//   npm run release:check -- --notes notes.md   also writes the entry's text
import { readFileSync, writeFileSync } from 'node:fs';
import { releaseNotes, releaseProblems } from './release-notes.ts';

const read = (file) => readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const changelog = read('CHANGELOG.md');
const problems = releaseProblems(pkg, JSON.parse(read('package-lock.json')), changelog);
if (problems.length > 0) {
  console.error(`Can't release ${pkg.version}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
const notes = process.argv.indexOf('--notes');
if (notes >= 0) writeFileSync(process.argv[notes + 1], releaseNotes(changelog, pkg.version) + '\n');
console.log(`${pkg.version} can be released.`);
