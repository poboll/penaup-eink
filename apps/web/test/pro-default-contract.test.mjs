import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('the primary no-device Web path starts on the Pro portrait paper', () => {
  const utils = read('js/utils.js');
  const studio = read('studio/index.html');
  const style = read('css/style.css');
  const paper = read('css/studio-paper.css');

  assert.match(utils, /var DEFAULT_DEVICE_TYPE = 'PENAUPPRO';/);
  assert.match(studio, /PRIMARY PAPER \/ E6 PRO/);
  assert.match(studio, /3\.68 英寸 · 528 × 792 竖向视觉/);
  assert.equal((studio.match(/width="792" height="528"/g) || []).length, 4);
  assert.match(studio, /id="weread-canvas" width="528" height="792"/);
  assert.match(style, /\.polaroid-inner \{[^\n]*aspect-ratio: 2 \/ 3/);
  assert.match(style, /\.polaroid-inner canvas \{[^\n]*width: 792px; height: 528px/);
  assert.match(paper, /\.weread-polaroid-inner \{\n    aspect-ratio: 2 \/ 3/);
});

test('the mini program defaults templates to the Pro visual canvas', () => {
  const app = read('../wechat/miniprogram/app.js');
  const utils = read('../wechat/miniprogram/utils/film-utils.js');
  const quote = read('../wechat/miniprogram/pages/frame/quote/index.js');

  assert.match(app, /deviceType: 'PENAUPPRO'/);
  assert.match(utils, /var DEFAULT_DEVICE_TYPE = 'PENAUPPRO';/);
  assert.match(utils, /const CANVAS_WIDTH = FilmCore\.PROFILES\.PENAUP_PRO\.canvasWidth;/);
  assert.match(utils, /const CANVAS_HEIGHT = FilmCore\.PROFILES\.PENAUP_PRO\.canvasHeight;/);
  assert.match(quote, /var w = CW;\n    var h = CH;/);
  assert.doesNotMatch(quote, /if \(cfg\.isPortraitPanel\)/);
});
