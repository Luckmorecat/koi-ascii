// Prints what release.yml still has to do for package.json's version, as
// key=value lines for $GITHUB_OUTPUT. The workflow looks the facts up and
// passes them in the environment; releasePlan() in release-notes.ts decides.
import { readFileSync } from 'node:fs';
import { releasePlan } from './release-notes.ts';

const env = process.env;
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const plan = releasePlan({
  version,
  sha: env.SHA,
  onNpm: env.ON_NPM === 'true',
  tagSha: env.TAG_SHA || null,
  hasRelease: env.HAS_RELEASE === 'true',
  distTags: JSON.parse(env.DIST_TAGS),
});
for (const [key, value] of Object.entries({ version, ...plan })) console.log(`${key}=${value}`);
