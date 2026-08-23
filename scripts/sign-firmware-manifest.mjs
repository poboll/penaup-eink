/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MANIFEST_BYTES = 256 * 1024;
const KEY_ID_PATTERN = /^poboll-[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MODEL_SET = new Set(['PENAUP_STD', 'PENAUP_PRO', 'PENAUP_MAX']);
const TOP_LEVEL_KEYS = new Set([
  'schema',
  'product',
  'release_status',
  'version',
  'models',
  'protocol',
  'filename',
  'size',
  'sha256',
  'created_at'
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error('用法: node scripts/sign-firmware-manifest.mjs --manifest <draft.json> --private-key <ed25519-private.pem> --key-id <poboll-key-id> [--output <published.json>]');
  console.error('说明: 不提供 --output 时只输出已签名清单；脚本不会覆盖输入文件。');
}

function fail(message) {
  throw new Error(message);
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value) fail(`${label} 无效`);
}

function validateDraftManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest 必须是 JSON 对象');
  for (const key of Object.keys(manifest)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(`manifest 含有未允许的字段: ${key}`);
  }
  if (manifest.schema !== 'penaup-firmware-manifest/v1') fail('manifest schema 不匹配');
  if (manifest.product !== 'penaup') fail('manifest product 必须是 penaup');
  if (manifest.release_status !== 'draft') fail('只允许为 draft 清单签名');
  if (!VERSION_PATTERN.test(String(manifest.version || ''))) fail('manifest version 必须类似 v1.0.0');
  if (!Array.isArray(manifest.models) || manifest.models.length === 0 || new Set(manifest.models).size !== manifest.models.length || manifest.models.some((model) => !MODEL_SET.has(model))) {
    fail('manifest models 必须包含一个或多个有效 Penaup 机型');
  }
  if (manifest.protocol !== 'ble-v1') fail('manifest protocol 必须是 ble-v1');
  if (typeof manifest.filename !== 'string' || !/^[A-Za-z0-9._-]+\.bin$/.test(manifest.filename)) fail('manifest filename 必须是安全的 .bin 文件名');
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 1) fail('manifest size 必须是正整数');
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) fail('manifest sha256 必须是 64 位十六进制');
  if (manifest.created_at !== undefined && (typeof manifest.created_at !== 'string' || Number.isNaN(Date.parse(manifest.created_at)))) fail('manifest created_at 必须是有效时间');
}

async function readJson(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) fail(`manifest 不是普通文件: ${filePath}`);
  if (stat.size > MAX_MANIFEST_BYTES) fail('manifest 文件过大');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('manifest 不是有效 JSON');
    throw error;
  }
}

async function writeNewFile(filePath, content) {
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const manifestArgument = argument('--manifest');
  const privateKeyArgument = argument('--private-key');
  const keyId = argument('--key-id');
  const outputArgument = argument('--output');
  if (!manifestArgument || !privateKeyArgument || !keyId) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (!KEY_ID_PATTERN.test(keyId)) fail('key id 必须匹配 poboll-<name>');

  const manifestPath = path.resolve(root, manifestArgument);
  const privateKeyPath = path.resolve(root, privateKeyArgument);
  const manifest = await readJson(manifestPath);
  validateDraftManifest(manifest);

  const privateKey = crypto.createPrivateKey(await fs.readFile(privateKeyPath));
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') fail('private key 必须是 Ed25519 私钥 PEM');

  const sha256 = manifest.sha256.toLowerCase();
  const message = `penaup-firmware-v1:${sha256}`;
  const signature = crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
  const published = {
    ...manifest,
    release_status: 'published',
    sha256,
    signature: {
      algorithm: 'Ed25519',
      key_id: keyId,
      message,
      value: signature
    }
  };
  const json = `${JSON.stringify(published, null, 2)}\n`;
  if (outputArgument) {
    const outputPath = path.resolve(root, outputArgument);
    await writeNewFile(outputPath, json);
    console.log(`wrote published manifest ${path.relative(root, outputPath)}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error) => {
  console.error(`固件清单签名失败: ${error.message || error}`);
  process.exitCode = 1;
});
