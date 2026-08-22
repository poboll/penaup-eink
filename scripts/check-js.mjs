/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const ignored = new Set(['node_modules', 'dist', 'data']);
const extensions = new Set(['.cjs', '.js', '.mjs']);

async function collect(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

const files = (await collect(root))
  .filter((file) => !file.includes(`${path.sep}.git${path.sep}`))
  .sort();

for (const file of files) {
  await execFileAsync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`JavaScript syntax OK: ${files.length} files`);
