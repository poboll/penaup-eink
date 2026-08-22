import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = path.join(root, 'packages', 'film-core', 'dist', 'film-core.umd.js');
const wechatTarget = path.join(root, 'apps', 'wechat', 'miniprogram', 'utils', 'film-core.js');
const webTarget = path.join(root, 'apps', 'web', 'js', 'film-core.js');

const generated = await fs.readFile(source, 'utf8');
const banner = '/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */\n// Generated from packages/film-core/dist/film-core.umd.js. Do not edit by hand.\n';
const browserOutput = generated.startsWith('/* Copyright (c) 2026 poboll') ? generated : banner + generated;
await fs.writeFile(wechatTarget, browserOutput, 'utf8');
await fs.writeFile(webTarget, browserOutput, 'utf8');
await fs.writeFile(path.join(root, 'packages', 'film-core', 'dist', 'film-core.umd.cjs'), `/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */\n/* Generated CommonJS bridge. Do not edit by hand. */\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst vm = require('node:vm');\nconst filename = path.join(__dirname, 'film-core.umd.js');\nconst moduleShim = { exports: {} };\nvm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: moduleShim, exports: moduleShim.exports }, { filename });\nmodule.exports = moduleShim.exports;\n`, 'utf8');
console.log(`synced ${path.relative(root, wechatTarget)} and ${path.relative(root, webTarget)}`);
