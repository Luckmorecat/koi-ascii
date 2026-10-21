// Ships the library's declarations as the single file dist/index.d.ts.
// src/index.ts holds every public type, so its declaration file must not
// import anything; if it does, a type leaked out of index.ts and the
// published package would reference files that aren't in it.
import { copyFileSync, readFileSync } from 'node:fs';

const from = 'node_modules/.cache/koi-ascii-types/index.d.ts';
const dts = readFileSync(from, 'utf8');
const imports = dts.match(/^\s*(import|export)\b[^;]*\bfrom\s+['"][^'"]+['"]/gm);
if (imports) {
  console.error(`${from} must be self-contained, but has:\n${imports.join('\n')}`);
  process.exit(1);
}
copyFileSync(from, 'dist/index.d.ts');
