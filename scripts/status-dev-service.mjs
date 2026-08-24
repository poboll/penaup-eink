/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const label = process.env.PENAUP_LAUNCHD_LABEL || 'com.poboll.penaup-eink.dev';

if (process.platform !== 'darwin') {
  throw new Error('花生片本地常驻服务状态检查只支持 macOS launchd');
}

const domain = `gui/${process.getuid()}`;
const result = spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], {
  encoding: 'utf8'
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exitCode = result.status || 0;
