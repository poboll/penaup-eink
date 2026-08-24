/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const label = process.env.PENAUP_LAUNCHD_LABEL || 'com.poboll.penaup-eink.dev';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);

if (process.platform !== 'darwin') {
  throw new Error('花生片本地常驻服务卸载器只支持 macOS launchd');
}

const domain = `gui/${process.getuid()}`;
spawnSync('/bin/launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
await rm(plistPath, { force: true });
console.log(`已停止并移除 ${label}`);
