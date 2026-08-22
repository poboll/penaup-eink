/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BLE_CHUNK_SIZE,
  COLOR_TABLE,
  EPD_COLOR_CODES,
  FILM_COLOR_COUNT,
  TRANSFER_PHASES,
  createFilmFile,
  getProfile,
  validateFilmBuffer
} from '../packages/film-core/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strictExternal = process.argv.includes('--strict-external');
const passed = [];
const failed = [];
const pending = [];

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(filePath(relativePath), 'utf8');
}

function pass(label) {
  passed.push(label);
}

function fail(label, detail) {
  failed.push(`${label}: ${detail}`);
}

function waitForExternal(label, available, detail) {
  if (available) pass(`${label} available${detail ? ` (${detail})` : ''}`);
  else pending.push(`${label}: ${detail || 'not found'}`);
}

function executableOnPath(command) {
  const entries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return entries.map((entry) => path.join(entry, command)).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function requirePaths(paths) {
  for (const relativePath of paths) {
    if (fs.existsSync(filePath(relativePath))) pass(`required path ${relativePath}`);
    else fail(`required path ${relativePath}`, 'missing');
  }
}

function assertMatch(label, value, pattern) {
  if (pattern.test(value)) pass(label);
  else fail(label, `pattern ${pattern} not found`);
}

function assertEqual(label, left, right) {
  if (left === right) pass(label);
  else fail(label, `expected ${JSON.stringify(right)}, received ${JSON.stringify(left)}`);
}

const requiredPaths = [
  'apps/web/index.html',
  'apps/wechat/project.config.json',
  'firmware/penaup/CMakeLists.txt',
  'firmware/penaup/components/film_service/inc/service_ble.h',
  'firmware/penaup/components/film_hal/inc/hal_epd.h',
  'hardware/penaup',
  'packages/film-core/src/index.js',
  'server/src/modules',
  'server/src/transports',
  'server/migrations/import-fastapi.mjs',
  'server/admin/dist',
  'legacy/fastapi',
  'compat/framefilm/README.md',
  'deploy/mqtt/README.md',
  'deploy/mqtt/mosquitto.conf.example',
  'deploy/mqtt/penaup.acl.example',
  'docs/api/transfer-state.md',
  'docs/legal/provenance.md'
];
requirePaths(requiredPaths);

const rootPackage = json('package.json');
const serverPackage = json('server/package.json');
assertEqual('root package name', rootPackage.name, 'penaup-eink');
assertEqual('root package license', rootPackage.license, 'LicenseRef-Poboll-NonCommercial');
assertEqual('server package license', serverPackage.license, 'LicenseRef-Poboll-NonCommercial');
assertEqual('root Node engine', rootPackage.engines?.node, '>=24.0.0 <25.0.0');
assertEqual('server Node engine', serverPackage.engines?.node, '>=24.0.0 <25.0.0');
assertMatch('root LICENSE ownership', read('LICENSE'), /Copyright \(c\) 2026 poboll/);
assertMatch('root LICENSE non-commercial restriction', read('LICENSE'), /non-commercial purposes/);
assertEqual('runtime Node major', Number(process.versions.node.split('.')[0]), 24);

if (fs.existsSync(filePath('NOTICE.md'))) fail('legacy NOTICE.md removal', 'file still exists');
else pass('legacy NOTICE.md removal');

const tracked = trackedFiles();
if (tracked.includes('NOTICE.md')) fail('legacy NOTICE.md tracking', 'still tracked by Git');
else pass('legacy NOTICE.md tracking');
const trackedRuntimeData = tracked.filter((file) => file.startsWith('server/data/'));
if (trackedRuntimeData.length) fail('runtime data exclusion', trackedRuntimeData.join(', '));
else pass('runtime data exclusion');

const filmCoreBrowser = read('apps/web/js/film-core.js');
const filmCoreWechat = read('apps/wechat/miniprogram/utils/film-core.js');
assertEqual('Web and WeChat film-core generated source', filmCoreWechat, filmCoreBrowser);
assertEqual('film color count', FILM_COLOR_COUNT, 6);
assertEqual('BLE chunk size', BLE_CHUNK_SIZE, 192);
assertEqual('film color table', JSON.stringify(Array.from(COLOR_TABLE)), JSON.stringify([0x00, 0xff, 0xfc, 0xe0, 0x03, 0x1c]));
assertEqual('EPD color codes', JSON.stringify(Array.from(EPD_COLOR_CODES)), JSON.stringify([0x00, 0x11, 0x22, 0x33, 0x55, 0x66]));
assertEqual('transfer state contract', JSON.stringify(TRANSFER_PHASES), JSON.stringify([
  'idle', 'preparing', 'discovering', 'connecting', 'handshaking',
  'transferring', 'refreshing', 'succeeded', 'failed', 'device_state_uncertain'
]));

for (const [key, totalSize] of [['PENAUP_STD', 120032], ['PENAUP_PRO', 209120], ['PENAUP_MAX', 960032]]) {
  const profile = getProfile(key);
  if (!profile) {
    fail(`film profile ${key}`, 'missing');
    continue;
  }
  const film = createFilmFile(profile, new Uint8Array(profile.bodySize));
  const checked = validateFilmBuffer(film, key);
  assertEqual(`film profile ${key} total size`, film.byteLength, totalSize);
  assertEqual(`film profile ${key} validation`, checked.valid, true);
}

assertMatch('C BLE frame head', read('firmware/penaup/components/film_service/inc/service_ble.h'), /#define\s+BLE_CMD_HEAD\s+\(0x55\)/);
assertMatch('Web BLE frame head', read('apps/web/js/bluetooth.js'), /const\s+BLE_CMD_HEAD\s*=\s*0x55/);
assertMatch('WeChat BLE frame head', read('apps/wechat/miniprogram/utils/ble-utils.js'), /const\s+BLE_CMD_HEAD\s*=\s*0x55/);
assertMatch('Web BLE chunk size', read('apps/web/js/bluetooth.js'), /(?:const|var)\s+BLE_CHUNK_SIZE\s*=\s*192/);
assertMatch('WeChat BLE chunk size', read('apps/wechat/miniprogram/utils/ble-utils.js'), /const\s+BLE_CHUNK_SIZE\s*=\s*192/);
const epdHeader = read('firmware/penaup/components/film_hal/inc/hal_epd.h');
for (const [name, value] of [['BLACK', '00'], ['WHITE', '11'], ['YELLOW', '22'], ['RED', '33'], ['BLUE', '55'], ['GREEN', '66']]) {
  assertMatch(`C EPD color ${name}`, epdHeader, new RegExp(`#define\\s+EPD_COLOR_${name}\\s+0x${value}\\b`));
}

const sysConfig = read('firmware/penaup/components/film_sys/inc/sys_cfg.h');
const activeModels = [...sysConfig.matchAll(/^\s*#define\s+(FRAMEFILM_(?:STD|PRO|MAX))\s+1\b/gm)].map((match) => match[1]);
assertEqual('firmware default selects one model', JSON.stringify(activeModels), JSON.stringify(['FRAMEFILM_PRO']));
const sdkconfigs = [
  ['std', '16MB', 'CONFIG_SPIRAM_MODE_OCT=y'],
  ['pro', '4MB', 'CONFIG_SPIRAM_MODE_QUAD=y'],
  ['max', '16MB', 'CONFIG_SPIRAM_MODE_OCT=y']
];
for (const [model, flash, psram] of sdkconfigs) {
  const config = read(`firmware/penaup/sdkconfig_${model}`);
  assertMatch(`sdkconfig_${model} ESP-IDF version`, config, /\(ESP-IDF\) 5\.5\.2 Project Configuration/);
  assertMatch(`sdkconfig_${model} ESP32-S3 target`, config, /CONFIG_IDF_TARGET="esp32s3"/);
  assertMatch(`sdkconfig_${model} flash size`, config, new RegExp(`CONFIG_ESPTOOLPY_FLASHSIZE="${flash}"`));
  assertMatch(`sdkconfig_${model} PSRAM mode`, config, new RegExp(`^${psram}$`, 'm'));
}

const mqttConfig = read('deploy/mqtt/mosquitto.conf.example');
const mqttAcl = read('deploy/mqtt/penaup.acl.example');
assertMatch('MQTT disables anonymous access', mqttConfig, /allow_anonymous false/);
assertMatch('MQTT exposes a TLS listener', mqttConfig, /listener 8883 0\.0\.0\.0/);
assertMatch('MQTT bridge state wildcard', mqttAcl, /topic read penaup\/device\/\+\/state/);
assertMatch('MQTT bridge command wildcard', mqttAcl, /topic write penaup\/device\/\+\/command/);
assertMatch('MQTT device state is exact', mqttAcl, /topic write penaup\/device\/EXAMPLE\/state/);
assertMatch('MQTT device command is exact', mqttAcl, /topic read penaup\/device\/EXAMPLE\/command/);

const externalTools = [
  ['ESP-IDF idf.py', Boolean(executableOnPath('idf.py')), 'install ESP-IDF 5.5.2 and export its environment'],
  ['Caddy', Boolean(executableOnPath('caddy')), 'install Caddy on the deployment host'],
  ['Mosquitto', Boolean(executableOnPath('mosquitto')), 'install/configure the MQTT broker with ACL'],
  ['WeChat DevTools CLI', fs.existsSync('/Applications/wechatwebdevtools.app/Contents/MacOS/cli'), 'open apps/wechat with an AppID-authorized account']
];
for (const [label, available, detail] of externalTools) waitForExternal(label, available, detail);

for (const message of passed) console.log(`[pass] ${message}`);
for (const message of pending) console.log(`[pending] ${message}`);
for (const message of failed) console.error(`[fail] ${message}`);
console.log(`Contract gate: ${passed.length} passed, ${pending.length} pending, ${failed.length} failed`);

if (failed.length || (strictExternal && pending.length)) process.exitCode = 1;
