import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('local icon map covers static and dynamic studio icons', () => {
  const markup = read('studio/index.html');
  const dynamicMarkup = read('js/weread-wallpaper.js');
  const iconSource = read('js/icons.js');
  const names = new Set([
    ...Array.from(markup.matchAll(/class="material-icons(?:[^"]*)">([^<]+)</g), (match) => match[1].trim()),
    ...Array.from(dynamicMarkup.matchAll(/material-icons">([^<]+)</g), (match) => match[1].trim())
  ]);

  for (const name of names) assert.match(iconSource, new RegExp(`\\b${name}:`), `missing local icon: ${name}`);
  assert.match(iconSource, /scope\.matches\('\.material-icons/);
});
