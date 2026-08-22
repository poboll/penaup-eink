/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
/* Generated CommonJS bridge. Do not edit by hand. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, 'film-core.umd.js');
const moduleShim = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: moduleShim, exports: moduleShim.exports }, { filename });
module.exports = moduleShim.exports;
