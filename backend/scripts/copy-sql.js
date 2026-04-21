#!/usr/bin/env node
// Copy src/db/*.sql into dist/db/ after tsc runs.
//
// Why this exists: TypeScript's compiler only emits .js/.d.ts/.map files
// and ignores non-source assets like our SQL migration files. At runtime
// the server reads from dist/db/*.sql (because __dirname resolves to
// dist/ in production). Without this step, every migration silently
// "skips" because the file doesn't exist, leaving prod with a broken or
// partial schema.
//
// Cross-platform (pure Node, no shell cp). Safe to re-run.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src', 'db');
const DST_DIR = path.join(__dirname, '..', 'dist', 'db');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`[copy-sql] Source dir missing: ${SRC_DIR}`);
  process.exit(1);
}
fs.mkdirSync(DST_DIR, { recursive: true });

let count = 0;
for (const entry of fs.readdirSync(SRC_DIR)) {
  if (!entry.endsWith('.sql')) continue;
  const src = path.join(SRC_DIR, entry);
  const dst = path.join(DST_DIR, entry);
  fs.copyFileSync(src, dst);
  count++;
}

console.log(`[copy-sql] Copied ${count} SQL file(s) -> ${DST_DIR}`);
