#!/usr/bin/env node
// Fails if a file under src/core imports react or react-dom, or names a DOM type or global.
// The core is plain TypeScript so it can run without React or a browser. Run: npm run check:core
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '../src/core');
const rules = [
  [/from\s+['"]react(-dom)?(\/[^'"]*)?['"]|require\(\s*['"]react/, 'imports react or react-dom'],
  [/\b(HTMLElement|SVGElement|SVGSVGElement|HTMLInputElement|PointerEvent|KeyboardEvent|MouseEvent|WheelEvent|DOMRect|document|navigator|localStorage)\b|(?<![.\w'])window\b(?!\??\s*:)/, 'names a DOM type or global'],
];
// Known exception: the ladder row helpers take DOM rows by design and are public from ./core. Remove this when they move out (a later step).
const DOM_ALLOWED = new Set(['ladder-keys.ts']);
const problems = [];
for (const f of readdirSync(core).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
  readFileSync(join(core, f), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/^\s*\/\*.*$/, '');
    for (const [re, why] of rules) if (!(DOM_ALLOWED.has(f) && why.startsWith('names a DOM')) && re.test(code)) problems.push(`core/${f}:${i + 1} ${why}: ${line.trim()}`);
  });
}
if (problems.length) { console.error(problems.map((p) => `FAIL ${p}`).join('\n')); process.exit(1); }
console.log('core check passed');
