/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('all web surfaces load one final pale paper finish layer', async () => {
  const [story, studio, device, finish] = await Promise.all([
    read('index.html'),
    read('studio/index.html'),
    read('device/index.html'),
    read('css/penaup-paper-finish.css')
  ]);

  assert.match(story, /href="css\/penaup-paper-finish\.css"/);
  assert.match(studio, /href="\.\.\/css\/penaup-paper-finish\.css"/);
  assert.match(device, /href="\.\.\/css\/penaup-paper-finish\.css"/);
  assert.match(finish, /--penaup-paper-base:\s*#fafaf7/);
  assert.match(finish, /repeating-linear-gradient\(106deg/);
  assert.match(finish, /body \.story-shell \.color-mode\[aria-pressed="true"\]/);
  assert.match(finish, /body \.story-shell \.color-mode \{[\s\S]*?background:\s*transparent/);
  assert.match(finish, /white grass-paper finish v2/);
  assert.match(finish, /Hero object: paper board \+ registration marks/);
  assert.match(finish, /color-matrix-row\[data-pigment="green"\] > span:nth-child\(9\)/);
  assert.match(finish, /body \.creation-font-fieldset/);
  assert.match(finish, /body \.weread-polaroid-inner[\s\S]*?aspect-ratio:\s*2 \/ 3/);
  assert.match(finish, /@media \(max-width: 720px\)[\s\S]*?body \.frame-tab[\s\S]*?font-size:\s*14px/);
  assert.match(finish, /@media \(max-width: 720px\)[\s\S]*?body \.weread-actions > \*/);
  assert.match(finish, /prefers-reduced-motion/);
});

test('homepage color study keeps six physical rows and eight visual levels', async () => {
  const [story, finish] = await Promise.all([
    read('index.html'),
    read('css/penaup-paper-finish.css')
  ]);
  const rows = story.split('\n').filter((line) => line.includes('class="color-matrix-row"'));

  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((line) => (line.match(/<span><\/span>/g) || []).length), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(rows.map((line) => line.match(/data-pigment="([^"]+)"/)?.[1]), [
    'ink', 'paper', 'red', 'yellow', 'blue', 'green'
  ]);
  assert.match(story, /data-mode="layer"/);
  assert.match(story, /data-mode="dots"/);
  assert.match(story, /data-mode="dither"/);
  assert.match(finish, /grid-template-columns:\s*54px repeat\(8, minmax\(0, 1fr\)\)/);
  assert.match(finish, /\.color-matrix-row > span::after/);
  assert.match(story, /class="color-lab-grid" role="img" aria-label="六行八列/);
});

test('mini program keeps the Pro visual paper and pale navigation surface', async () => {
  const [app, paper, template, home] = await Promise.all([
    read('../wechat/miniprogram/app.json'),
    read('../wechat/miniprogram/styles/paper-surface.wxss'),
    read('../wechat/miniprogram/pages/template/index.wxml'),
    read('../wechat/miniprogram/pages/home/index.wxss')
  ]);

  assert.match(app, /"backgroundColor": "#FAFAF7"/);
  assert.match(app, /"navigationBarBackgroundColor": "#FAFAF7"/);
  assert.match(app, /"backgroundColor": "#FFFEFA"/);
  assert.match(paper, /background-color: #fafaf7/);
  assert.match(template, /3\.68″/);
  assert.match(template, /528 × 792/);
  assert.match(home, /background: rgba\(255, 255, 252, \.88\)/);
});

test('Runtime admin console shares the pale paper finish and touch-safe actions', async () => {
  const adminStyle = await fs.readFile(path.join(root, '..', '..', 'server/admin/dist/style.css'), 'utf8');

  assert.match(adminStyle, /--paper:\s*#fafaf7/);
  assert.match(adminStyle, /--surface:\s*#fffefa/);
  assert.match(adminStyle, /2026-08-24 Penaup paper finish/);
  assert.match(adminStyle, /\.btn\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(adminStyle, /prefers-reduced-motion/);
});
