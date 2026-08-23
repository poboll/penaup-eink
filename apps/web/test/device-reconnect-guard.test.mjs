/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function loadGuard() {
  const source = await fs.readFile(path.join(root, 'apps/web/js/device-reconnect-guard.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'device-reconnect-guard.js' });
  return context.window.PenaupReconnectGuard;
}

test('reconnect guard requires both an expected and observed disconnect', async () => {
  const guard = await loadGuard();
  const assertState = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  assertState(guard.clear(), { expected: false, observed: false });
  assertState(guard.begin(), { expected: true, observed: false });
  assert.equal(guard.canConfirm(true, false), false);
  assert.equal(guard.canConfirm(false, true), false);
  assert.equal(guard.canConfirm(true, true), true);
  assertState(guard.observe(false), { expected: false, observed: false });
  assertState(guard.observe(true), { expected: true, observed: true });
});
