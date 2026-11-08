#!/usr/bin/env node
// Checks what `npm pack` would put in the @matchstick-trading/primitives tarball. Publishes nothing.
// Build first:  npm run build
// Run:          npm run check:pack            (file list, size, exports, 'use client' rule, licence)
//               node scripts/check-pack.mjs --install  (also installs the tarball in an empty dir and runs the examples; needs the npm registry for react)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = root;
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
const problems = [];

function npm(args, cwd) {
  try {
    return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`npm ${args.join(' ')} failed in ${cwd}:\n${e.stderr || e.message}\nDid you build first? (npm run build)`);
    process.exit(1);
  }
}

const info = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], pkgDir))[0];
const files = info.files.map((f) => f.path);

// 1. The file list equals an allowlist. Source ships (Apache-2.0, with the LICENSE); tests, maps and env files do not.
const allowed = [
  /^package\.json$/, /^README\.md$/, /^CHANGELOG\.md$/, /^AGENTS\.md$/, /^llms\.txt$/, /^LICENSE$/, /^src\/.+\.(ts|tsx|css)$/,
  /^dist\/.+\.(js|d\.ts)$/, /^examples\/.+\.(mjs|js|ts|tsx|json|csv|md)$/, // example data must be synthetic; this check cannot tell
];
const forbidden = [/\.test\./, /\.map$/, /(^|\/)\.env/];
for (const f of files) {
  if (forbidden.some((re) => re.test(f))) problems.push(`forbidden file in the tarball: ${f}`);
  else if (!allowed.some((re) => re.test(f))) problems.push(`not on the allowlist: ${f}`);
}
for (const must of ['LICENSE', 'README.md', 'src/index.ts', 'AGENTS.md', 'llms.txt', 'src/tokens.css', 'dist/index.js', 'dist/index.d.ts', 'dist/core/index.js', 'dist/core/index.d.ts']) {
  if (!files.includes(must)) problems.push(`missing from the tarball: ${must} (build first)`);
}

// 1b. The licence is declared.
if (pkg.license !== 'Apache-2.0') problems.push(`package.json license is ${pkg.license}, expected Apache-2.0`);

// 2. Size budget, about 1.5x what it measured on 2026-11-08 with src/ shipped (1,067 kB unpacked, 289 kB packed). Raise it on purpose when features land.
const MAX_UNPACKED = 1600 * 1024;
const MAX_PACKED = 440 * 1024;
if (info.unpackedSize > MAX_UNPACKED) problems.push(`unpacked size ${info.unpackedSize} is over the budget ${MAX_UNPACKED}`);
if (info.size > MAX_PACKED) problems.push(`packed size ${info.size} is over the budget ${MAX_PACKED}`);

// 3. Every export path resolves to a file in the tarball.
const targets = new Set();
const walk = (v) => (typeof v === 'string' ? targets.add(v.replace(/^\.\//, '')) : v && typeof v === 'object' && Object.values(v).forEach(walk));
walk(pkg.exports); for (const k of ['main', 'module', 'types']) if (pkg[k]) walk(pkg[k]);
for (const t of targets) if (!files.includes(t)) problems.push(`package.json points at ${t}, which is not in the tarball`);

// 3b. The interactive modules start with 'use client'; (so a Next.js server component can import them) and dist/core never does.
// The list is the source files that import a value from react, the same rule scripts/add-use-client.mjs builds with.
const usesReact = (source) => /^import\s+(?!type\b)[^;]*from\s+['"]react['"]/m.test(source);
for (const f of readdirSync(resolve(pkgDir, 'src')).filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
  const dist = `dist/${f.replace(/\.tsx?$/, '.js')}`;
  if (!files.includes(dist)) continue;
  const first = readFileSync(resolve(pkgDir, dist), 'utf8').split('\n', 1)[0];
  const wants = usesReact(readFileSync(resolve(pkgDir, 'src', f), 'utf8'));
  if (wants && first !== "'use client';") problems.push(`${dist} must start with 'use client'; (found: ${first.slice(0, 40)})`);
  if (!wants && first === "'use client';") problems.push(`${dist} has 'use client'; but its source imports no react value`);
}
for (const f of files.filter((x) => /^dist\/core\/.+\.js$/.test(x))) {
  if (readFileSync(resolve(pkgDir, f), 'utf8').startsWith("'use client'")) problems.push(`${f} must stay free of 'use client'`);
}

console.log(`tarball: ${files.length} files, ${info.size} bytes packed, ${info.unpackedSize} unpacked`);

// 5. (--install) Pack for real, install into an empty directory with react, import every entry point and run every example.
if (process.argv.includes('--install')) {
  const tmp = mkdtempSync(join(tmpdir(), 'primitives-pack-'));
  try {
    npm(['pack', '--ignore-scripts', '--pack-destination', tmp], pkgDir);
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    writeFileSync(join(tmp, 'package.json'), '{"name":"smoke","private":true,"type":"module"}\n');
    npm(['install', '--no-audit', '--no-fund', '--silent', `./${tgz}`, 'react@19', 'react-dom@19'], tmp);
    const imports = [pkg.name, `${pkg.name}/core`].map((s) => `await import('${s}');`).join('');
    execFileSync('node', ['--input-type=module', '-e', imports], { cwd: tmp, stdio: 'inherit' });
    const exDir = join(tmp, 'node_modules', pkg.name, 'examples');
    for (const ex of readdirSync(exDir).filter((f) => f.endsWith('.mjs'))) {
      mkdirSync(join(tmp, 'run'), { recursive: true });
      writeFileSync(join(tmp, 'run', ex), readFileSync(join(exDir, ex)));
      try {
        execFileSync('node', [join('run', ex)], { cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
      } catch (e) { problems.push(`example ${ex} failed from the installed tarball:\n${e.stderr}`); }
    }
    console.log('clean install: imports and examples ran');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (problems.length) { console.error(problems.map((p) => `FAIL ${p}`).join('\n')); process.exit(1); }
console.log('pack check passed');
