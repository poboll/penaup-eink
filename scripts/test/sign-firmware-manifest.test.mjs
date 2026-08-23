/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const script = path.join(root, 'scripts/sign-firmware-manifest.mjs');

async function run(args) {
  return execFileAsync(process.execPath, [script, ...args], { cwd: root, maxBuffer: 1024 * 1024 });
}

test('sign-firmware-manifest signs a draft without reading a firmware binary', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-manifest-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privateKeyPath = path.join(directory, 'release-key.pem');
    const draftPath = path.join(directory, 'draft.json');
    const outputPath = path.join(directory, 'published.json');
    const sha256 = 'a'.repeat(64);
    const message = `penaup-firmware-v1:${sha256}`;
    const draft = {
      schema: 'penaup-firmware-manifest/v1',
      product: 'penaup',
      release_status: 'draft',
      version: 'v1.0.0',
      models: ['PENAUP_PRO'],
      protocol: 'ble-v1',
      filename: 'penaup-pro-v1.0.0.bin',
      size: 1234,
      sha256,
      created_at: '2026-08-23T00:00:00.000Z'
    };
    await fs.writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await fs.writeFile(draftPath, `${JSON.stringify(draft)}\n`);

    await run(['--manifest', draftPath, '--private-key', privateKeyPath, '--key-id', 'poboll-release-2026', '--output', outputPath]);
    const published = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(published.release_status, 'published');
    assert.equal(published.signature.algorithm, 'Ed25519');
    assert.equal(published.signature.key_id, 'poboll-release-2026');
    assert.equal(published.signature.message, message);
    assert.equal(
      crypto.verify(null, Buffer.from(message), publicKey, Buffer.from(published.signature.value, 'base64')),
      true
    );
    assert.equal((await fs.readFile(outputPath, 'utf8')).includes('BEGIN PRIVATE KEY'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('sign-firmware-manifest refuses to overwrite an existing output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'penaup-manifest-'));
  try {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const privateKeyPath = path.join(directory, 'release-key.pem');
    const draftPath = path.join(directory, 'draft.json');
    const outputPath = path.join(directory, 'published.json');
    await fs.writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await fs.writeFile(draftPath, JSON.stringify({
      schema: 'penaup-firmware-manifest/v1',
      product: 'penaup',
      release_status: 'draft',
      version: 'v1.0.0',
      models: ['PENAUP_STD'],
      protocol: 'ble-v1',
      filename: 'penaup-std.bin',
      size: 1,
      sha256: 'b'.repeat(64)
    }));
    await fs.writeFile(outputPath, 'keep me\n');
    await assert.rejects(
      run(['--manifest', draftPath, '--private-key', privateKeyPath, '--key-id', 'poboll-release-2026', '--output', outputPath]),
      /already exists|EEXIST/
    );
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'keep me\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
