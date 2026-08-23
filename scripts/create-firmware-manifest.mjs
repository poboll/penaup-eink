/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedModels = new Set(['PENAUP_STD', 'PENAUP_PRO', 'PENAUP_MAX']);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error('用法: node scripts/create-firmware-manifest.mjs --file <firmware.bin> --model <PENAUP_STD|PENAUP_PRO|PENAUP_MAX> --version <vX.Y.Z> [--output <manifest.json>]');
}

const input = argument('--file');
const model = argument('--model');
const version = argument('--version');
const output = argument('--output');

if (!input || !model || !version || !allowedModels.has(model) || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  usage();
  process.exitCode = 2;
} else {
  const inputPath = path.resolve(root, input);
  const stat = await fs.stat(inputPath);
  if (!stat.isFile()) throw new Error(`firmware file is not a regular file: ${input}`);
  if (!/^[A-Za-z0-9._-]+\.bin$/.test(path.basename(inputPath))) throw new Error('firmware filename must be a safe .bin name');
  const buffer = await fs.readFile(inputPath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const manifest = {
    schema: 'penaup-firmware-manifest/v1',
    product: 'penaup',
    release_status: 'draft',
    version,
    models: [model],
    protocol: 'ble-v1',
    filename: path.basename(inputPath),
    size: buffer.byteLength,
    sha256,
    created_at: new Date().toISOString()
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (output) {
    const outputPath = path.resolve(root, output);
    await fs.writeFile(outputPath, json, { encoding: 'utf8', flag: 'wx' });
    console.log(`wrote draft manifest ${path.relative(root, outputPath)}`);
  } else {
    process.stdout.write(json);
  }
}
