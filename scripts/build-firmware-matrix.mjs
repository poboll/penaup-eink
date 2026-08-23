#!/usr/bin/env node
/* Copyright (c) 2026 poboll · LicenseRef-Poboll-NonCommercial */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'firmware', 'penaup');
const modelDefinitions = Object.freeze({
  std: Object.freeze({ macro: 'FRAMEFILM_STD', sdkconfig: 'sdkconfig_std', profile: 'PENAUP_STD' }),
  pro: Object.freeze({ macro: 'FRAMEFILM_PRO', sdkconfig: 'sdkconfig_pro', profile: 'PENAUP_PRO' }),
  max: Object.freeze({ macro: 'FRAMEFILM_MAX', sdkconfig: 'sdkconfig_max', profile: 'PENAUP_MAX' })
});

function usage() {
  return `用法：node scripts/build-firmware-matrix.mjs [选项]

选项：
  --models=std,pro,max  只构建指定机型，默认全部
  --build-root=PATH     指定隔离构建根目录，默认创建在系统临时目录
  --idf=PATH            指定 idf.py 路径，默认从 PATH 查找
  --dry-run             只输出计划，不运行 idf.py
  --help                显示帮助

脚本会把 firmware/penaup 复制到隔离目录，分别写入 sdkconfig_<model> 和
sys_cfg.h 机型宏；不会修改仓库内的源码、sdkconfig 或任何 build* 构建产物。`;
}

function parseArgs(argv) {
  const result = { models: ['std', 'pro', 'max'], buildRoot: '', idf: '', dryRun: false };
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (argument.startsWith('--models=')) {
      result.models = argument.slice('--models='.length).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    if (argument.startsWith('--build-root=')) {
      result.buildRoot = argument.slice('--build-root='.length);
      continue;
    }
    if (argument.startsWith('--idf=')) {
      result.idf = argument.slice('--idf='.length);
      continue;
    }
    throw new Error(`未知选项：${argument}`);
  }
  if (!result.models.length || result.models.some((model) => !modelDefinitions[model])) {
    throw new Error(`机型必须是 std、pro 或 max：${result.models.join(', ')}`);
  }
  return result;
}

function patchModelConfig(configPath, model) {
  const selected = modelDefinitions[model];
  const source = fs.readFileSync(configPath, 'utf8');
  const lines = source.split(/\r?\n/);
  const selectionStart = lines.findIndex((line) => line.includes('// SYS CONFIG'));
  const fallbackStart = lines.findIndex((line, index) => index > selectionStart && /^\s*#ifndef\s+FRAMEFILM_STD\b/.test(line));
  if (selectionStart < 0 || fallbackStart < 0) throw new Error(`找不到机型选择区：${configPath}`);
  let selectionCount = 0;
  const patched = lines.map((line, index) => {
    if (index <= selectionStart || index >= fallbackStart) return line;
    const match = line.match(/^(\s*)(\/\/\s*)?#define\s+(FRAMEFILM_(?:STD|PRO|MAX))\s+(\d+)\b(.*)$/);
    if (!match) return line;
    selectionCount += 1;
    const macro = match[3];
    const value = macro === selected.macro ? '1' : '0';
    const comment = macro === selected.macro ? '' : '// ';
    return `${match[1]}${comment}#define ${macro.padEnd(20, ' ')} ${value}${match[5]}`;
  });
  if (selectionCount !== 3) throw new Error(`无法安全切换机型宏：${configPath}`);
  fs.writeFileSync(configPath, patched.join('\n'));
}

function copyProject(destination, model) {
  fs.cpSync(sourceRoot, destination, {
    recursive: true,
    filter(sourcePath) {
      const relative = path.relative(sourceRoot, sourcePath);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      // ESP-IDF leaves build/ and the local build_gate_* evidence directories
      // beside the source. Copying either into every isolated model would
      // waste hundreds of megabytes and can exhaust a small CI/VPS volume.
      if (first === 'build' || first.startsWith('build_gate_') || first === 'sdkconfig' || first === '.git') return false;
      return !/^sdkconfig(?:\.old)?$/.test(path.basename(relative));
    }
  });
  const selected = modelDefinitions[model];
  fs.copyFileSync(path.join(destination, selected.sdkconfig), path.join(destination, 'sdkconfig'));
  patchModelConfig(path.join(destination, 'components', 'film_sys', 'inc', 'sys_cfg.h'), model);
}

function findIdf(explicit) {
  if (explicit) return path.resolve(explicit);
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return pathEntries.map((entry) => path.join(entry, 'idf.py')).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || '';
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function prepareBuildRoot(candidate) {
  const buildRoot = path.resolve(candidate);
  const projectRoot = fs.realpathSync(root);

  // The matrix script intentionally replaces temporary model directories. Do
  // not allow an explicit output root to be the repository, its source tree,
  // or an ancestor of either one. This turns a typo such as
  // --build-root=firmware/penaup into a clear error instead of a deletion.
  if (buildRoot === path.parse(buildRoot).root || isSameOrInside(projectRoot, buildRoot) || isSameOrInside(buildRoot, projectRoot)) {
    throw new Error(`隔离构建根目录必须位于仓库之外：${buildRoot}`);
  }

  if (fs.existsSync(buildRoot)) {
    const stat = fs.lstatSync(buildRoot);
    if (!stat.isDirectory()) throw new Error(`隔离构建根目录不是目录：${buildRoot}`);
    if (fs.readdirSync(buildRoot).length > 0) {
      throw new Error(`隔离构建根目录必须为空，为避免覆盖现有文件：${buildRoot}`);
    }
  } else {
    fs.mkdirSync(buildRoot, { recursive: true });
  }
  return buildRoot;
}

function runBuild(idfPath, projectPath, model, dryRun) {
  const command = `${idfPath || 'idf.py'} build`;
  console.log(`[${model}] ${command}  (cwd: ${projectPath})`);
  if (dryRun) return { model, status: 'planned', projectPath, profile: modelDefinitions[model].profile };
  try {
    execFileSync(idfPath, ['build'], { cwd: projectPath, env: process.env, stdio: 'inherit' });
    const binaryPath = path.join(projectPath, 'build', 'penaup.bin');
    const stat = fs.statSync(binaryPath);
    return { model, status: 'passed', projectPath, binaryPath, binaryBytes: stat.size, profile: modelDefinitions[model].profile };
  } catch (error) {
    return { model, status: 'failed', projectPath, error: error?.status || error?.message || 'idf.py failed', profile: modelDefinitions[model].profile };
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (!fs.existsSync(sourceRoot)) throw new Error(`固件目录不存在：${sourceRoot}`);
  const idfPath = findIdf(options.idf);
  if (!options.dryRun && !idfPath) {
    throw new Error('没有找到 idf.py；请先导出 ESP-IDF 5.5.2 环境，或传入 --idf=/absolute/path/idf.py。');
  }
  if (idfPath && !fs.existsSync(idfPath)) throw new Error(`idf.py 不存在：${idfPath}`);

  const buildRoot = options.buildRoot
    ? path.resolve(options.buildRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'penaup-firmware-matrix-'));
  prepareBuildRoot(buildRoot);
  console.log(`隔离构建根目录：${buildRoot}`);
  const results = [];
  for (const model of options.models) {
    const projectPath = path.join(buildRoot, model);
    if (fs.existsSync(projectPath)) throw new Error(`机型构建目录已存在，为避免覆盖：${projectPath}`);
    copyProject(projectPath, model);
    results.push(runBuild(idfPath, projectPath, model, options.dryRun));
  }
  console.log(JSON.stringify({ buildRoot, results }, null, 2));
  if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
