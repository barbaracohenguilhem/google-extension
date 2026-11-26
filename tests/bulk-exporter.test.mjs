import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { unzipSync, zipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function loadModule(relPath) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, relPath)],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

const filenames = await loadModule('src/shared/filename.ts');
const upgrader = await loadModule('src/shared/url-upgrader.ts');

test('CDN URL Upgrader resolves full-res originals while always preserving safe DOM fallback', () => {
  const tw = upgrader.getUpgradedImageCandidates('https://pbs.twimg.com/media/XYZ?format=jpg&name=small');
  assert.ok(tw[0].includes('name=orig') && tw.at(-1).includes('name=small'));

  const pin = upgrader.getUpgradedImageCandidates('https://i.pinimg.com/236x/aa/bb/cc/photo.jpg');
  assert.equal(pin[0], 'https://i.pinimg.com/originals/aa/bb/cc/photo.jpg');

  const wiki = upgrader.getUpgradedImageCandidates(
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/320px-Cat.jpg'
  );
  assert.equal(wiki[0], 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat.jpg');

  const amz = upgrader.getUpgradedImageCandidates('https://m.media-amazon.com/images/I/71xyz._AC_SX300_.jpg');
  assert.equal(amz[0], 'https://m.media-amazon.com/images/I/71xyz.jpg');

  const shop = upgrader.getUpgradedImageCandidates('https://cdn.shopify.com/s/files/1/photo_400x400.webp?width=400');
  assert.equal(shop[0], 'https://cdn.shopify.com/s/files/1/photo.webp');

  const wp = upgrader.getUpgradedImageCandidates('https://blog.example.com/wp-content/uploads/2026/05/foto-300x200.jpg');
  assert.equal(wp[0], 'https://blog.example.com/wp-content/uploads/2026/05/foto.jpg');
});

test('Filename builder deduplicates cleanly and maps MIME types to proper extensions', () => {
  const used = new Set();
  const f1 = filenames.buildImageFilename({
    index: 0,
    srcUrl: 'https://cdn.example.com/hero-shot',
    siteHost: 'www.example.com',
    mimeType: 'image/webp',
    usedNames: used,
  });
  const f2 = filenames.buildImageFilename({
    index: 0,
    srcUrl: 'https://cdn.example.com/hero-shot',
    siteHost: 'www.example.com',
    mimeType: 'image/webp',
    usedNames: used,
  });
  assert.equal(f1, '001_hero-shot.webp');
  assert.equal(f2, '001_hero-shot_2.webp');

  const zipName = filenames.buildBatchArchiveName('www.pinterest.com', 42);
  assert.match(zipName, /^Lumina_pinterest-com_42imgs_\d{8}-\d{4}\.zip$/);
});

test('fflate store-mode ZIP packing round-trips multiple binary images losslessly', () => {
  const fakeJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
  const zipped = zipSync({ '001_a.jpg': fakeJpg, '002_b.png': fakePng }, { level: 0 });
  const unpacked = unzipSync(zipped);

  assert.deepEqual(unpacked['001_a.jpg'], fakeJpg);
  assert.deepEqual(unpacked['002_b.png'], fakePng);
});

test('MV3 dist/ audit: lightweight bundle, valid manifest v3, exact PNG icons, zero inline scripts', () => {
  const manifestPath = path.join(DIST, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);

  const verifyPngSize = (relFile, expectedSize) => {
    const full = path.join(DIST, relFile);
    assert.ok(fs.existsSync(full), `Missing icon ${relFile}`);
    const buf = fs.readFileSync(full);
    assert.deepEqual(buf.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(buf.readUInt32BE(16), expectedSize);
    assert.equal(buf.readUInt32BE(20), expectedSize);
  };

  for (const [sz, rel] of Object.entries(manifest.icons)) verifyPngSize(rel, Number(sz));
  for (const [sz, rel] of Object.entries(manifest.action.default_icon)) verifyPngSize(rel, Number(sz));

  for (const rel of [
    manifest.action.default_popup,
    manifest.side_panel.default_path,
    manifest.background.service_worker,
    manifest.content_scripts[0].js[0],
    'popup/popup.js',
    'sidepanel/sidepanel.js',
  ]) {
    assert.ok(fs.existsSync(path.join(DIST, rel)), `Missing dist/${rel}`);
  }

  // Ensure heavy browser AI models are gone (dist/ should be tiny & instant!)
  assert.ok(!fs.existsSync(path.join(DIST, 'models')), 'Heavy local models should be removed');
  assert.ok(!fs.existsSync(path.join(DIST, 'offscreen')), 'Offscreen doc should be removed');

  for (const htmlRel of ['popup/popup.html', 'sidepanel/sidepanel.html']) {
    const html = fs.readFileSync(path.join(DIST, htmlRel), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `Inline <script> forbidden in ${htmlRel}`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `Inline handler forbidden in ${htmlRel}`);
  }
});
