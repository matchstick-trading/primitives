#!/usr/bin/env node
// Post-build step for the package: put 'use client'; first in each dist module whose source imports a value from
// react (state, context, effects), so a Next.js App Router server component can import the parts. dist/core stays plain.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTIVE = "'use client';\n";
// A value import from react: `import { useState } from 'react'`, not `import type { ... } from 'react'`.
const usesReact = (source) => /^import\s+(?!type\b)[^;]*from\s+['"]react['"]/m.test(source);

for (const file of readdirSync(join(pkg, 'src')).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
  if (!usesReact(readFileSync(join(pkg, 'src', file), 'utf8'))) continue;
  const out = join(pkg, 'dist', file.replace(/\.tsx?$/, '.js'));
  const js = readFileSync(out, 'utf8');
  if (!js.startsWith(DIRECTIVE)) writeFileSync(out, DIRECTIVE + js);
}
