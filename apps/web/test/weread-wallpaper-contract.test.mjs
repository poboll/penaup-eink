import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('WeRead wallpaper lab keeps the Pro screen and local-font contract', async () => {
  const [html, script, styles, responsiveStyles, paperSurface] = await Promise.all([
    read('studio/index.html'),
    read('js/weread-wallpaper.js'),
    read('css/studio-paper.css'),
    read('css/studio-responsive.css'),
    read('css/paper-surface.css')
  ]);

  assert.match(html, /id="weread-preview-panel"/);
  assert.match(html, /canvas id="weread-canvas" width="528" height="792"/);
  assert.match(html, /id="weread-month-field"[^>]*hidden/);
  assert.match(html, /data-weread-period="weekly"/);
  assert.match(html, /data-weread-period="monthly"/);
  assert.match(html, /id="weread-phase-indicator"/);
  assert.match(html, /id="weread-demo"/);
  assert.match(html, /href="\.\.\/css\/paper-surface\.css"/);
  assert.match(html, /id="weread-download-jpg"/);
  assert.match(html, /data-weread-phase-step="typesetting"/);
  assert.match(script, /document\.fonts\.load/);
  assert.match(script, /PENAUP_PRO/);
  assert.match(script, /createDemoSnapshot/);
  assert.match(script, /loadDemoSnapshot/);
  assert.match(script, /setDevelopmentPhase\('pending'/);
  assert.match(script, /item\.classList\.toggle\('is-failed'/);
  assert.match(script, /function syncPeriodUi\(\)/);
  assert.match(script, /function syncSceneForPeriod\(mode\)/);
  assert.match(script, /syncSceneForPeriod\(state\.mode\)/);
  assert.match(script, /function localReadingCard\(bookId\)/);
  assert.match(script, /function clearWallpaperPreview\(message\)/);
  assert.match(script, /Math\.ceil\(\(firstDay \+ totalDays\) \/ 7\)/);
  assert.match(script, /state\.source === 'demo'/);
  assert.match(script, /X-Penaup-WeRead-Key/);
  assert.match(script, /downloadJpg/);
  assert.doesNotMatch(script, /localStorage\.(?:getItem|setItem|removeItem)/);
  assert.doesNotMatch(script, /safeText\(error && error\.message/);
  assert.match(html, /当前页面临时使用/);
  assert.match(styles, /font-family:\s*"Huiwen Mincho"/);
  assert.match(styles, /--paper:\s*#f8f8f4/);
  assert.match(styles, /repeating-linear-gradient\(90deg/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(responsiveStyles, /\.weread-phase-trail/);
  assert.match(responsiveStyles, /\.weread-key-row \.text-button/);
  assert.match(responsiveStyles, /min-width:\s*44px/);
  assert.match(responsiveStyles, /@media \(max-width: 420px\)/);
  assert.match(responsiveStyles, /@media \(min-width: 721px\)[\s\S]*?\.container[\s\S]*?height:\s*100vh/);
  assert.match(responsiveStyles, /@media \(min-width: 721px\)[\s\S]*?\.bottom-nav[\s\S]*?position:\s*static/);
  assert.match(responsiveStyles, /\.bottom-nav\s*\{[\s\S]*?background:\s*var\(--paper-bright\)/);
  assert.match(responsiveStyles, /\.weread-section-title small[\s\S]*?font-size:\s*13px/);
  assert.match(responsiveStyles, /scroll-padding-bottom:\s*calc\(176px/);
  assert.match(styles, /\.weread-preview-panel\s*\{[\s\S]*?position:\s*static/);
  assert.match(paperSurface, /--penaup-paper-ivory:\s*#f8f8f4/);
  assert.match(paperSurface, /--penaup-paper-rice:\s*#f2f2ee/);
  assert.match(paperSurface, /aspect-ratio:\s*2 \/ 3/);
  assert.match(paperSurface, /body::after\s*\{/);
  assert.match(paperSurface, /\.weread-preview-panel\[aria-busy="true"\]/);
  assert.match(paperSurface, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(paperSurface, /body \.story-nav \.nav-cta \{\n    color: var\(--penaup-paper-white\) !important;/);
  assert.match(paperSurface, /body \.story-nav \.nav-cta:hover[\s\S]*?color: var\(--penaup-paper-ink\) !important;/);
  const convert = await read('js/convert.js');
  assert.match(convert, /\.polaroid-inner:not\(\.weread-polaroid-inner\)/);
  assert.match(styles, /\.weread-polaroid-inner canvas\s*\{[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;/);
});

test('BLE transfer exposes an uncertain-device result instead of false success', async () => {
  const source = await read('js/frame.js');
  assert.match(source, /state:\s*'device_state_uncertain'/);
  assert.match(source, /return \{ ok: false, code: 'transfer_failed'/);
});

test('paper story exposes a direct reading-wallpaper entry point', async () => {
  const [html, main, frame, styles, paperSurface, deviceHtml] = await Promise.all([
    read('index.html'),
    read('js/main.js'),
    read('js/frame.js'),
    read('css/story.css'),
    read('css/paper-surface.css'),
    read('device/index.html')
  ]);

  assert.match(html, /href="\/studio\/\?mode=weread"/);
  assert.match(html, /class="section reading-section"/);
  assert.match(html, /PRO \/ 528 × 792/);
  assert.match(main, /initDeepLink/);
  assert.match(main, /frame-weread/);
  assert.match(main, /resetPageContentScroll/);
  assert.match(frame, /scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.match(styles, /whole narrative stays on a pale rice/);
  assert.match(styles, /\.feature-section\s*\{[\s\S]*?background:/);
  assert.match(html, /href="css\/paper-surface\.css"/);
  assert.match(deviceHtml, /href="\.\.\/css\/paper-surface\.css"/);
  assert.match(paperSurface, /font-family: "Huiwen Mincho"/);
});
