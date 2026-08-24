/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('studio creation tabs keep keyboard focus and panel state synchronized', async () => {
  const [html, frame, main] = await Promise.all([
    read('studio/index.html'),
    read('js/frame.js'),
    read('js/main.js')
  ]);

  assert.match(html, /id="frame-tab-upload"[\s\S]*role="tab"[\s\S]*tabindex="0"/);
  assert.match(html, /id="frame-tab-camera"[\s\S]*role="tab"[\s\S]*tabindex="-1"/);
  assert.match(html, /id="frame-upload"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="frame-tab-upload"[\s\S]*aria-hidden="false"/);
  assert.match(html, /id="frame-weread"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="frame-tab-weread"[\s\S]*aria-hidden="true"/);
  assert.match(frame, /event\.key === 'ArrowRight'/);
  assert.match(frame, /event\.key === 'ArrowLeft'/);
  assert.match(frame, /event\.key === 'Home'/);
  assert.match(frame, /event\.key === 'End'/);
  assert.match(frame, /setAttribute\('tabindex', active \? '0' : '-1'\)/);
  assert.match(frame, /setAttribute\('aria-hidden', active \? 'false' : 'true'\)/);
  assert.match(main, /page\.setAttribute\('aria-hidden', active \? 'false' : 'true'\)/);
  assert.match(html, /data-frame-font="system"[^>]*aria-pressed="true"/);
  assert.match(html, /data-frame-font="huiwen"[^>]*aria-pressed="false"/);
  assert.match(frame, /frameQuoteFontFamily\(\)/);
  assert.match(frame, /document\.querySelectorAll\('\[data-frame-font\]'\)/);
});
