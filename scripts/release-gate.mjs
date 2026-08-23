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
  COLOR_RENDERING_MODE_DEFINITIONS,
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

function normalizeRuntimeRoute(route) {
  return route
    .replace('/devices/:id', '/devices/{deviceId}')
    .replace('/media/:id', '/media/{mediaId}')
    .replace('/albums/:id', '/albums/{albumId}')
    .replace('/templates/:id', '/templates/{templateId}')
    .replace('/streams/:id', '/streams/{streamId}')
    .replace('/transfers/:id', '/transfers/{transferId}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function documentedOpenApiOperations(document) {
  const pathsSection = `${document.slice(document.indexOf('\npaths:\n') + 8, document.indexOf('\ncomponents:\n'))}\n  /__openapi_end__:\n`;
  const operations = new Set();
  for (const match of pathsSection.matchAll(/^  (\/[^:]+):\n([\s\S]*?)(?=^  \/\S)/gm)) {
    const route = match[1];
    for (const method of match[2].matchAll(/^    (get|post|put|patch|delete):/gm)) operations.add(`${method[1].toUpperCase()} ${route}`);
  }
  return operations;
}

const requiredPaths = [
  'apps/web/index.html',
  'apps/web/device/index.html',
  'apps/web/css/device-tool.css',
  'apps/web/js/ble-protocol.js',
  'apps/web/js/device-reconnect-guard.js',
  'apps/web/js/device-tool.js',
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
  'hardware/penaup/legacy/README.md',
  'hardware/penaup/legacy/model',
  'hardware/penaup/legacy/pcb',
  'deploy/mqtt/README.md',
  'deploy/mqtt/mosquitto.conf.example',
  'deploy/mqtt/penaup.acl.example',
  'deploy/backup.sh',
  'deploy/restore.sh',
  'deploy/penaup.service',
  'deploy/penaup-backup.service',
  'deploy/penaup-backup.timer',
  'deploy/Caddyfile',
  'deploy/.env.example',
  'docs/api/openapi.yaml',
  'docs/api/ios-integration.md',
  'docs/api/transfer-state.md',
  'docs/legal/provenance.md'
  , 'docs/ops/verification-matrix.md'
  , 'docs/ops/security-audit.md'
  , 'package-lock.json'
  , 'server/package-lock.json'
  , 'docs/integrations/weread-wallpaper.md'
  , 'apps/web/fonts/huiwen-mincho.woff2'
  , 'apps/web/css/studio-responsive.css'
  , 'server/src/modules/weread.js'
  , 'docs/device-tool/firmware-updates.md'
  , 'apps/wechat/miniprogram/pages/weread/index.js'
  , 'apps/wechat/miniprogram/pages/weread/index.wxml'
  , 'apps/wechat/miniprogram/pages/weread/index.wxss'
  , 'apps/wechat/miniprogram/utils/weread-api.js'
  , 'apps/wechat/miniprogram/test/weread-page-contract.test.js'
  , 'firmware/penaup/releases/manifest.schema.json'
  , 'firmware/penaup/releases/README.md'
  , 'apps/web/js/firmware-manifest.js'
  , 'scripts/create-firmware-manifest.mjs'
  , 'scripts/sign-firmware-manifest.mjs'
  , 'scripts/build-firmware-matrix.mjs'
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
const trackedPrivateWechatConfig = tracked.filter((file) => file === 'apps/wechat/project.private.config.json');
if (trackedPrivateWechatConfig.length) fail('WeChat private config exclusion', trackedPrivateWechatConfig.join(', '));
else pass('WeChat private config exclusion');

const filmCoreBrowser = read('apps/web/js/film-core.js');
const filmCoreWechat = read('apps/wechat/miniprogram/utils/film-core.js');
assertEqual('Web and WeChat film-core generated source', filmCoreWechat, filmCoreBrowser);
const webStorySurface = read('apps/web/index.html');
const webStudioSurface = read('apps/web/studio/index.html');
const webStudioBleSurface = read('apps/web/js/bluetooth.js');
const webWereadSurface = read('apps/web/js/weread-wallpaper.js');
const webDeviceSurface = read('apps/web/device/index.html');
const webDeviceToolSurface = read('apps/web/js/device-tool.js');
const webFirmwareManifestSurface = read('apps/web/js/firmware-manifest.js');
const wechatSettingsSurface = read('apps/wechat/miniprogram/pages/settings/index.js');
const webProductSurface = `${webStorySurface}\n${webStudioSurface}\n${webDeviceSurface}`;
assertEqual('shared rendering mode count', COLOR_RENDERING_MODE_DEFINITIONS.length, 3);
const wechatUploadSurface = [
  read('apps/wechat/miniprogram/pages/home/index.wxml'),
  read('apps/wechat/miniprogram/pages/frame/upload/index.wxml'),
  read('apps/wechat/miniprogram/pages/frame/upload/index.js'),
  read('apps/wechat/miniprogram/utils/film-utils.js')
].join('\n');
const wechatWereadSurface = [
  JSON.stringify(json('apps/wechat/miniprogram/app.json')),
  read('apps/wechat/miniprogram/pages/weread/index.wxml'),
  read('apps/wechat/miniprogram/pages/weread/index.js'),
  read('apps/wechat/miniprogram/utils/weread-api.js')
].join('\n');
assertMatch('WeChat WeRead page route', wechatWereadSurface, /pages\/weread\/index/);
assertMatch('WeChat WeRead Pro output', wechatWereadSurface, /PENAUP_PRO|792 × 528/);
assertMatch('WeChat WeRead key header boundary', wechatWereadSurface, /X-Penaup-WeRead-Key/);
if (/wrk-[A-Za-z0-9_-]{32,}/.test(wechatWereadSurface)) fail('WeChat WeRead secret hygiene', 'a long Skill Key appears in source');
else pass('WeChat WeRead secret hygiene');
assertMatch('Web WeRead key header boundary', webWereadSurface, /X-Penaup-WeRead-Key/);
if (/localStorage\.(?:getItem|setItem|removeItem)\([^)]*(?:weread|skill-key)/i.test(webWereadSurface)) fail('Web WeRead secret storage hygiene', 'Skill Key is persisted in browser storage');
else pass('Web WeRead secret storage hygiene');
for (const mode of COLOR_RENDERING_MODE_DEFINITIONS) {
  assertMatch(`Web rendering mode ${mode.id}`, webStudioSurface, new RegExp(`data-rendering-mode="${mode.id}"`));
  assertMatch(`WeChat rendering mode ${mode.id}`, wechatUploadSurface, new RegExp(`['"]${mode.id}['"]|data-mode="\\{\\{item.id\\}\\}"`));
}
assertMatch('WeChat rendering mode selector', wechatUploadSurface, /chooseRenderingMode/);
assertMatch('WeChat Bayer rendering', wechatUploadSurface, /case 'bayer'/);
if (/FrameFilm/i.test(webProductSurface)) fail('Web product copy brand boundary', 'legacy FrameFilm name is visible on a product surface');
else pass('Web product copy brand boundary');
assertMatch('Web product copy explains 48 color feels', webProductSurface, /48[^\n]{0,24}(?:种|色)/);
assertMatch('Web product copy explains e-ink power behavior', webProductSurface, /不需要[^\n]{0,20}持续点亮/);
assertMatch('Studio brand returns to story home', webStudioSurface, /class="app-brand" href="\.\.\/"/);
assertMatch('Studio keeps browser zoom available', webStudioSurface, /name="viewport" content="width=device-width, initial-scale=1"/);
assertMatch('Studio delegates firmware maintenance to device tool', webStudioSurface, /class="secondary-button maintenance-link" href="\.\.\/device\//);
const studioMaintenanceSurface = `${webStudioSurface}\n${webStudioBleSurface}`;
if (/(?:ota-file-input|startOtaUpgrade|sendBleOta|OTA升级文件传输成功)/.test(studioMaintenanceSurface)) fail('Studio direct OTA surface removal', 'legacy direct OTA upload remains in the creative workbench');
else pass('Studio direct OTA surface removal');
assertMatch('Studio maintenance uses uncertain state copy', studioMaintenanceSurface, /markMaintenancePending\(|状态待确认/);
if (/showMessage\([^)]*(?:重启|恢复出厂|SD 卡格式化)[^)]*['"]success['"]/.test(studioMaintenanceSurface)) fail('Studio maintenance false success copy', 'maintenance write is still rendered as success');
else pass('Studio maintenance false success copy');
if (/sendBleCmdString:[^\n]*str=' \+ str/.test(webStudioBleSurface)) fail('Studio Wi-Fi password log redaction', 'password value is still written to the debug log');
else pass('Studio Wi-Fi password log redaction');
assertMatch('Device tool exposes BLE maintenance path', webDeviceSurface, /0x3B[\s\S]*0x22[\s\S]*0x10/);
assertMatch('Device tool preserves uncertain state copy', webDeviceSurface, /状态待确认/);
assertMatch('Device tool loads reconnect confirmation guard', webDeviceSurface, /device-reconnect-guard\.js/);
assertMatch('Device tool loads strict firmware manifest validator', webDeviceSurface, /firmware-manifest\.js/);
assertMatch('Device tool binds manifest to current file and model', webDeviceToolSurface, /M\.validate\(manifest, \{[\s\S]*profileKey:[\s\S]*firmwareName:[\s\S]*firmwareSize:/);
assertMatch('Firmware manifest validator keeps Ed25519 signature shape strict', webFirmwareManifestSurface, /hasOnlySignatureKeys\(signature\)[\s\S]*base64ByteLength\(signature\.value\) !== 64/);
assertMatch('Device tool does not claim a release binary', webDeviceSurface, /没有真实的正式发布包/);
assertMatch('Device tool documents Web Serial boundary', webDeviceSurface, /Web Serial/);
assertMatch('Device tool serves docs link', read('server/src/app.js'), /prefix: '\/docs\/'/);
assertMatch('WeChat OTA enters uncertain state after STOP', wechatSettingsSurface, /afterStop\(\)[\s\S]*otaState: pending\.state/);
assertMatch('WeChat OTA confirms after battery read', wechatSettingsSurface, /_markOtaConfirmed\(\)/);
if (/otaTransferStatus\s*:\s*['"]升级完成['"]/.test(wechatSettingsSurface)) fail('WeChat OTA false success copy', 'OTA_STOP still maps directly to success');
else pass('WeChat OTA false success copy');
const firmwareManifest = json('firmware/penaup/releases/manifest.schema.json');
assertEqual('firmware manifest schema id', firmwareManifest.$id, 'https://penaup.local/schemas/firmware-manifest-v1.json');
assertEqual('firmware release directory contains no binary', fs.readdirSync(filePath('firmware/penaup/releases')).some((name) => name.endsWith('.bin')), false);
const firmwareSigningTool = read('scripts/sign-firmware-manifest.mjs');
assertMatch('firmware signing tool uses Ed25519', firmwareSigningTool, /crypto\.sign\(null/);
assertMatch('firmware signing tool reads external private key', firmwareSigningTool, /--private-key/);
assertMatch('firmware signing tool refuses overwrite', firmwareSigningTool, /flag: 'wx'/);
if (/writeFile\([^\n]*privateKey|writeFile\([^\n]*privateKeyPath/.test(firmwareSigningTool)) fail('firmware signing key handling', 'private key appears to be written by the signer');
else pass('firmware signing key handling');
const publicRouteSources = ['server/src/app.js', 'server/src/modules/auth.js', 'server/src/modules/weread.js', 'server/src/transports/http.js']
  .map((relativePath) => read(relativePath)).join('\n');
const documentedPublicOperations = documentedOpenApiOperations(read('docs/api/openapi.yaml'));
const runtimePublicOperations = new Set();
for (const match of publicRouteSources.matchAll(/app\.(get|post|put|patch|delete)\(['"]([^'"]+)/g)) {
  const route = match[2];
  if (!route.startsWith('/api/v1/admin/')) runtimePublicOperations.add(`${match[1].toUpperCase()} ${normalizeRuntimeRoute(route)}`);
}
for (const method of ['PUT', 'PATCH']) {
  for (const route of [
    '/api/v1/albums/:id',
    '/api/v1/albums/:id/photos/:photoId/layout',
    '/api/v1/templates/:id',
    '/api/v1/streams/:id',
    '/api/v1/streams/:id/items/:itemId'
  ]) runtimePublicOperations.add(`${method} ${normalizeRuntimeRoute(route)}`);
}
for (const operation of runtimePublicOperations) {
  if (documentedPublicOperations.has(operation)) pass(`OpenAPI route ${operation}`);
  else fail(`OpenAPI route ${operation}`, 'runtime route is not documented');
}

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
const backupService = read('deploy/penaup-backup.service');
const backupTimer = read('deploy/penaup-backup.timer');
assertMatch('backup service uses the restricted runtime user', backupService, /^User=penaup$/m);
assertMatch('backup service writes only data and backup roots', backupService, /^ReadWritePaths=\/var\/lib\/penaup\/data \/var\/backups\/penaup$/m);
assertMatch('backup service uses the repository backup script', backupService, /ExecStart=\/opt\/penaup-eink\/deploy\/backup\.sh/);
assertMatch('backup timer is persistent', backupTimer, /^Persistent=true$/m);
assertMatch('backup timer has a daily UTC schedule', backupTimer, /^OnCalendar=\*-\*-\* 03:20:00 UTC$/m);
assertMatch('MQTT bridge pins MQTT 5', read('server/src/mqtt.js'), /protocolVersion:\s*5/);
assertMatch('MQTT disables anonymous access', mqttConfig, /listener_allow_anonymous false/);
if (/per_listener_settings\s+true/.test(mqttConfig)) fail('MQTT avoids deprecated listener setting', 'per_listener_settings is deprecated in Mosquitto 2.x');
else pass('MQTT avoids deprecated listener setting');
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
