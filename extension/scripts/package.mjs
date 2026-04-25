#!/usr/bin/env node
// scripts/package.mjs — produce a Web Store / Edge Add-ons zip.
//
// Run from the extension/ root:
//   node scripts/package.mjs
//
// Output:
//   dist/sentrixai-time-tracker-v<version>.zip

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(HERE, '..');
const DIST_DIR = join(EXT_ROOT, 'dist');

// Files/dirs that go INTO the zip. Anything outside this list is skipped.
const INCLUDE = [
  'manifest.json',
  'background',
  'content',
  'options',
  'popup',
  'shared',
  'icons',
];

// Files explicitly excluded even within INCLUDE'd dirs.
const EXCLUDE_PATTERNS = [
  /\/\.DS_Store$/,
  /\/Thumbs\.db$/,
  /\.swp$/,
];

function loadManifest() {
  const path = join(EXT_ROOT, 'manifest.json');
  if (!existsSync(path)) {
    console.error('manifest.json not found at', path);
    process.exit(1);
  }
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('manifest.json is not valid JSON:', e.message);
    process.exit(1);
  }
  if (!parsed.version) {
    console.error('manifest.json is missing the "version" field');
    process.exit(1);
  }
  if (!parsed.icons?.['16'] || !parsed.icons?.['48'] || !parsed.icons?.['128']) {
    console.error('manifest.json must declare icons at sizes 16, 48, 128');
    process.exit(1);
  }
  return parsed;
}

function checkIcons() {
  const required = ['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];
  const missing = required.filter((p) => !existsSync(join(EXT_ROOT, p)));
  if (missing.length) {
    console.error('Missing icon files:', missing.join(', '));
    process.exit(1);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function gatherFiles() {
  const files = [];
  for (const item of INCLUDE) {
    const full = join(EXT_ROOT, item);
    if (!existsSync(full)) continue;
    const s = statSync(full);
    if (s.isFile()) {
      files.push(relative(EXT_ROOT, full));
    } else if (s.isDirectory()) {
      for (const f of walk(full)) {
        const rel = relative(EXT_ROOT, f);
        if (EXCLUDE_PATTERNS.some((p) => p.test('/' + rel))) continue;
        files.push(rel);
      }
    }
  }
  return files.sort();
}

function main() {
  const manifest = loadManifest();
  checkIcons();

  const files = gatherFiles();
  if (files.length === 0) {
    console.error('No files to package.');
    process.exit(1);
  }

  mkdirSync(DIST_DIR, { recursive: true });
  const slug = manifest.name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const zipName = `${slug}-v${manifest.version}.zip`;
  const zipPath = join(DIST_DIR, zipName);

  if (existsSync(zipPath)) rmSync(zipPath);

  // Use the system zip binary — present on macOS/Linux. CI/Windows users
  // can run this in WSL or install zip via the Windows store.
  try {
    execFileSync('zip', ['-q', '-X', zipPath, ...files], {
      cwd: EXT_ROOT,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('Failed to invoke zip:', e.message);
    console.error('Install zip (apt: zip, brew: zip, or use 7-Zip on Windows).');
    process.exit(1);
  }

  const size = statSync(zipPath).size;
  console.log(`✓ ${relative(EXT_ROOT, zipPath)}  (${(size / 1024).toFixed(1)} KB, ${files.length} files)`);
}

main();
