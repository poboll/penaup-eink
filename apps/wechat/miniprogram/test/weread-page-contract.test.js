const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('WeRead mini program page keeps the Pro wallpaper and key boundary', () => {
  const app = JSON.parse(read('app.json'));
  const page = read('pages/weread/index.wxml');
  const script = read('pages/weread/index.js');
  const styles = read('pages/weread/index.wxss');

  assert.ok(app.pages.includes('pages/weread/index'));
  assert.match(page, /PENAUP_PRO|792 × 528/);
  assert.match(page, /saveApiBase/);
  assert.match(page, /clearApiBase/);
  assert.match(page, /device_state_uncertain|发送到 Pro/);
  assert.match(script, /normalizeSkillKey/);
  assert.match(script, /hasFilm/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(script, /wrk-[A-Za-z0-9]{12,}/);
});
