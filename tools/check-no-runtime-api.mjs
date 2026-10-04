// Post-build guard: fail the build if any Google generative API host leaks into dist/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com', '@google/genai'];
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|json|css)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const b of BANNED) if (text.includes(b)) hits.push(`${p}: ${b}`);
    }
  }
}
walk('dist');
if (hits.length) {
  console.error('Runtime API references found in build output:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('check-no-runtime-api: OK (no generative API hosts in dist/)');
