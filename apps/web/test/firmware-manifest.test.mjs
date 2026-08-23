import assert from 'node:assert/strict';
import test from 'node:test';

import manifestContract from '../js/firmware-manifest.js';

const { validate } = manifestContract;

function publishedManifest() {
  const hash = 'a'.repeat(64);
  return {
    schema: 'penaup-firmware-manifest/v1',
    product: 'penaup',
    release_status: 'published',
    version: 'v1.0.0',
    models: ['PENAUP_PRO'],
    protocol: 'ble-v1',
    filename: 'penaup-pro.bin',
    size: 64,
    sha256: hash,
    created_at: '2026-08-23T00:00:00.000Z',
    signature: {
      algorithm: 'Ed25519',
      key_id: 'poboll-release-2026',
      message: `penaup-firmware-v1:${hash}`,
      value: Buffer.alloc(64).toString('base64')
    }
  };
}

test('firmware manifest validator accepts a bound published package', () => {
  const result = validate(publishedManifest(), {
    profileKey: 'PENAUP_PRO',
    firmwareName: 'penaup-pro.bin',
    firmwareSize: 64,
    maxImageBytes: 1536 * 1024
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('firmware manifest validator rejects schema type coercion and unknown fields', () => {
  const manifest = publishedManifest();
  manifest.size = '64';
  manifest.extra = 'unexpected';
  manifest.signature.extra = 'unexpected';
  const result = validate(manifest, { profileKey: 'PENAUP_PRO', firmwareName: 'penaup-pro.bin', firmwareSize: 64 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('；'), /未允许的字段/);
  assert.match(result.errors.join('；'), /签名包含未允许的字段/);
  assert.match(result.errors.join('；'), /size/);
});

test('firmware manifest validator requires a signed release and matching device', () => {
  const manifest = publishedManifest();
  manifest.signature = undefined;
  manifest.models = ['PENAUP_STD'];
  manifest.filename = 'unsafe/penaup-pro.bin';
  const result = validate(manifest, { profileKey: 'PENAUP_PRO', firmwareName: 'penaup-pro.bin', firmwareSize: 64 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('；'), /必须包含签名/);
  assert.match(result.errors.join('；'), /型号与当前设备不匹配/);
  assert.match(result.errors.join('；'), /filename/);
});

test('firmware manifest validator keeps a draft useful for the signing pipeline', () => {
  const manifest = publishedManifest();
  manifest.release_status = 'draft';
  delete manifest.signature;
  const result = validate(manifest, { profileKey: 'PENAUP_PRO', firmwareName: 'penaup-pro.bin', firmwareSize: 64 });
  assert.deepEqual(result, { ok: true, errors: [] });
});
