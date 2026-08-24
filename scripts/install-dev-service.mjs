/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.env.PENAUP_LAUNCHD_LABEL || 'com.poboll.penaup-eink.dev';
const launchAgents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgents, `${label}.plist`);
const runtimeData = path.join(repositoryRoot, 'server', 'data');
const nodePath = process.execPath;
const serverEntry = path.join(repositoryRoot, 'server', 'src', 'server.js');
const stdoutPath = path.join(runtimeData, 'launchd-stdout.log');
const stderrPath = path.join(runtimeData, 'launchd-stderr.log');

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function launchctl(args, options = {}) {
  return spawnSync('/bin/launchctl', args, {
    encoding: 'utf8',
    stdio: options.stdio || 'ignore'
  });
}

if (process.platform !== 'darwin') {
  throw new Error('花生片本地常驻服务安装器只支持 macOS launchd');
}

await mkdir(launchAgents, { recursive: true });
await mkdir(runtimeData, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(serverEntry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repositoryRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>development</string>
    <key>PENAUP_HOST</key>
    <string>127.0.0.1</string>
    <key>PENAUP_PORT</key>
    <string>8787</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;

await writeFile(plistPath, plist, { encoding: 'utf8', mode: 0o600 });
const domain = `gui/${process.getuid()}`;
launchctl(['bootout', domain, plistPath]);
const loaded = launchctl(['bootstrap', domain, plistPath], { stdio: 'inherit' });
if (loaded.error || loaded.status !== 0) {
  throw loaded.error || new Error(`launchctl bootstrap 失败，退出码 ${loaded.status}`);
}

const printed = launchctl(['print', `${domain}/${label}`]);
if (printed.error || printed.status !== 0) {
  throw printed.error || new Error('launchd 已加载但无法读取服务状态');
}

console.log(`已安装并启动 ${label}`);
console.log(`地址: http://127.0.0.1:8787/`);
console.log(`配置: ${plistPath}`);
console.log(`日志: ${stdoutPath}`);
