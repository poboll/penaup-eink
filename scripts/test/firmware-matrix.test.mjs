import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'build-firmware-matrix.mjs');

function outputBuildRoot(output) {
  const match = output.match(/隔离构建根目录：([^\n]+)/);
  assert.ok(match, 'matrix output should include its build root');
  return match[1].trim();
}

test('firmware matrix dry-run is isolated and does not change source config', () => {
  const configPath = path.join(root, 'firmware', 'penaup', 'components', 'film_sys', 'inc', 'sys_cfg.h');
  const before = fs.readFileSync(configPath, 'utf8');
  const output = execFileSync(process.execPath, [script, '--models=pro', '--dry-run'], { cwd: root }).toString('utf8');
  const after = fs.readFileSync(configPath, 'utf8');
  assert.equal(after, before);
  assert.match(output, /隔离构建根目录/);
  assert.match(output, /PENAUP_PRO/);
  assert.match(output, /\"status\": \"planned\"/);
  assert.equal(fs.existsSync(outputBuildRoot(output)), false);
});

test('firmware matrix can keep an auto-created root for artifact review', () => {
  const output = execFileSync(process.execPath, [script, '--models=pro', '--dry-run', '--keep-build-root'], { cwd: root }).toString('utf8');
  const buildRoot = outputBuildRoot(output);
  try {
    assert.equal(fs.existsSync(buildRoot), true);
    assert.match(output, /\"buildRootKept\": true/);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
});

test('firmware matrix excludes repository build evidence from isolated copies', () => {
  const buildRoot = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'penaup-firmware-copy-'));
  try {
    execFileSync(process.execPath, [script, `--build-root=${buildRoot}`, '--models=pro', '--dry-run'], { cwd: root });
    assert.equal(fs.existsSync(path.join(buildRoot, 'pro', 'build')), false);
    assert.equal(fs.existsSync(path.join(buildRoot, 'pro', 'build_gate_pro')), false);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
});

test('firmware matrix rejects an unknown model before building', () => {
  assert.throws(
    () => execFileSync(process.execPath, [script, '--models=ultra', '--dry-run'], { cwd: root, stdio: 'pipe' }),
    /status: 2|机型必须是/
  );
});

test('firmware matrix refuses repository and non-empty output roots', () => {
  const sourceRoot = path.join(root, 'firmware', 'penaup');
  assert.throws(
    () => execFileSync(process.execPath, [script, `--build-root=${sourceRoot}`, '--models=pro', '--dry-run'], { cwd: root, stdio: 'pipe' }),
    (error) => /仓库之外/.test(String(error.stderr || ''))
  );

  const externalRoot = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'penaup-firmware-guard-'));
  const sentinel = path.join(externalRoot, 'keep.txt');
  fs.writeFileSync(sentinel, 'keep');
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script, `--build-root=${externalRoot}`, '--models=pro', '--dry-run'], { cwd: root, stdio: 'pipe' }),
      (error) => /必须为空/.test(String(error.stderr || ''))
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  } finally {
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});
