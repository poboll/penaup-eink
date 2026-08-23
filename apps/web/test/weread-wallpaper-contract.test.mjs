import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('WeRead wallpaper lab keeps the Pro screen and local-font contract', async () => {
  const [html, script, styles, responsiveStyles] = await Promise.all([
    read('studio/index.html'),
    read('js/weread-wallpaper.js'),
    read('css/studio-paper.css'),
    read('css/studio-responsive.css')
  ]);

  assert.match(html, /id="weread-preview-panel"/);
  assert.match(html, /canvas id="weread-canvas" width="792" height="528"/);
  assert.match(html, /id="weread-phase-indicator"/);
  assert.match(html, /id="weread-demo"/);
  assert.match(html, /data-weread-phase-step="typesetting"/);
  assert.match(script, /document\.fonts\.load/);
  assert.match(script, /PENAUP_PRO/);
  assert.match(script, /createDemoSnapshot/);
  assert.match(script, /loadDemoSnapshot/);
  assert.match(script, /setDevelopmentPhase\('pending'/);
  assert.match(styles, /font-family:\s*"Huiwen Mincho"/);
  assert.match(styles, /--paper:\s*#f8f4eb/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(responsiveStyles, /\.weread-phase-trail/);
  assert.match(responsiveStyles, /@media \(max-width: 420px\)/);
});

test('BLE transfer exposes an uncertain-device result instead of false success', async () => {
  const source = await read('js/frame.js');
  assert.match(source, /state:\s*'device_state_uncertain'/);
  assert.match(source, /return \{ ok: false, code: 'transfer_failed'/);
});

test('paper story exposes a direct reading-wallpaper entry point', async () => {
  const [html, main, styles] = await Promise.all([
    read('index.html'),
    read('js/main.js'),
    read('css/story.css')
  ]);

  assert.match(html, /href="\/studio\/\?mode=weread"/);
  assert.match(html, /class="section reading-section"/);
  assert.match(html, /PRO \/ 792 × 528/);
  assert.match(main, /initDeepLink/);
  assert.match(main, /frame-weread/);
  assert.match(styles, /whole narrative stays on a pale rice/);
  assert.match(styles, /\.feature-section\s*\{[\s\S]*?background:/);
});
