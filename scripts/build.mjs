#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function build() {
  const start = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Copy manifest & generated PNG icons
  copyFile(path.join(ROOT, 'public/manifest.json'), path.join(DIST, 'manifest.json'));
  copyDir(path.join(ROOT, 'public/icons'), path.join(DIST, 'icons'));

  // 2. Copy HTML & CSS assets
  copyFile(path.join(ROOT, 'src/shared/styles.css'), path.join(DIST, 'shared/styles.css'));
  copyFile(path.join(ROOT, 'src/popup/popup.html'), path.join(DIST, 'popup/popup.html'));
  copyFile(path.join(ROOT, 'src/popup/popup.css'), path.join(DIST, 'popup/popup.css'));
  copyFile(path.join(ROOT, 'src/sidepanel/sidepanel.html'), path.join(DIST, 'sidepanel/sidepanel.html'));
  copyFile(path.join(ROOT, 'src/sidepanel/sidepanel.css'), path.join(DIST, 'sidepanel/sidepanel.css'));

  // 3. Bundle content script as classic IIFE (Chrome MV3 requirement)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/content/content.ts')],
    bundle: true,
    format: 'iife',
    target: 'chrome116',
    minify: true,
    outfile: path.join(DIST, 'content/content.js'),
  });

  // 4. Bundle Service Worker, Popup, and Side Panel as ES modules
  await esbuild.build({
    entryPoints: {
      'background/service-worker': path.join(ROOT, 'src/background/service-worker.ts'),
      'popup/popup': path.join(ROOT, 'src/popup/popup.ts'),
      'sidepanel/sidepanel': path.join(ROOT, 'src/sidepanel/sidepanel.ts'),
    },
    bundle: true,
    format: 'esm',
    splitting: false,
    target: 'chrome116',
    minify: true,
    outdir: DIST,
  });

  let totalBytes = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else totalBytes += fs.statSync(full).size;
    }
  }
  walk(DIST);

  console.log(
    `Built Lumina Bulk Exporter into dist/ in ${Date.now() - start}ms (${(totalBytes / 1024).toFixed(1)} KB total — zero AI bloat!).`
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
