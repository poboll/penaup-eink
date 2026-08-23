/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const adminRoot = path.join(root, 'server', 'admin', 'dist');

function read(relativePath) {
  return fs.readFileSync(path.join(adminRoot, relativePath), 'utf8');
}

test('admin image fetches keep resource URLs on the Penaup origin', () => {
  const common = read('js/common.js');
  assert.match(common, /function safeAssetUrl\s*\(/);
  assert.match(common, /url\.origin === origin/);
  assert.match(common, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(common, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.match(common, /fetch\(endpoint,/);
  assert.doesNotMatch(common, /fetch\(url,/);

  const pages = ['albums.html', 'streams.html', 'ai.html', 'templates.html', 'dashboard.html'];
  for (const page of pages) assert.match(read(page), /FH\.safeAssetUrl|FH\.authImg/);
  assert.match(read('albums.html'), /FH\.safeAssetUrl\(p\.thumb_url\)/);
  assert.match(read('streams.html'), /FH\.safeAssetUrl\(t\.thumb_url\)/);
  assert.match(read('ai.html'), /FH\.safeAssetUrl\(res\.thumb_url\)/);
});

test('admin dynamic HTML uses escaping at high-risk data boundaries', () => {
  const escapedPages = ['albums.html', 'dashboard.html', 'devices.html', 'streams.html', 'templates.html', 'template-editor.html', 'ai.html', 'settings.html'];
  for (const page of escapedPages) {
    const source = read(page);
    assert.match(source, /function esc\s*\(/, page + ' must define its HTML escaper');
    assert.match(source, /replace\(\/\[&<>"'\]\//, page + ' escaper must cover apostrophes');
  }
  assert.match(read('runtime.html'), /function escapeHtml\s*\(/);
  assert.match(read('runtime.html'), /escapeHtml\(device\.name/);

  const ai = read('ai.html');
  assert.doesNotMatch(ai, /src="' \+ res\.thumb_url/);
  assert.match(ai, /esc\(albumName\)/);

  const templateEditor = read('template-editor.html');
  assert.match(templateEditor, /esc\(type\)/);
  assert.match(templateEditor, /esc\(l\.x \|\| 0\)/);

  const templates = read('templates.html');
  assert.match(templates, /function safeColor\s*\(/);
  assert.match(templates, /safeColor\(s\.accent\)/);
  assert.doesNotMatch(templates, /background:' \+ \(s\.accent/);
});

test('legacy admin asset serialization rejects traversal and active URL syntax', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'src', 'transports', 'legacy-admin.js'), 'utf8');
  assert.match(source, /function adminAssetUrl\s*\(/);
  assert.match(source, /segments\.includes\('\.\.'\)/);
  assert.match(source, /thumb_url: adminAssetUrl\(template\.thumbPath\)/);
});

test('device maintenance keeps OTA image and release-key gates', () => {
  const source = fs.readFileSync(path.join(root, 'apps', 'web', 'js', 'device-tool.js'), 'utf8');
  assert.match(source, /MAX_OTA_IMAGE_BYTES = 1536 \* 1024/);
  assert.match(source, /signature\.key_id !== PINNED_FIRMWARE_KEY_ID/);
  assert.match(source, /M\.validate\(manifest/);
  assert.match(source, /state\.ota\.started \|\| state\.ota\.bytesSent > 0/);
  assert.match(source, /services: \[P\.SERVICE_UUID\]/);
});
