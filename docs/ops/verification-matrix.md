# Penaup-Eink 完成度与验证矩阵

> 更新时间：2026-08-23。本文只记录本机实际执行过的证据；“可执行文件存在”不等于“公网部署、微信真机或硬件已经验收”。

## 结论先看

当前 `codex/penaup-eink-rebuild` 分支已经完成 Node 24 运行时、Web/微信读书壁纸实验室、设备工具、数据迁移器、备份脚本和三端 film 契约的本地代码门禁。当前本机结果如下：

| 领域 | 本机状态 | 证据 |
| --- | --- | --- |
| Node 运行时 | PASS | `node --version` = `v24.19.0`；根包和 `server` 都限制 `24.x` |
| JavaScript / 契约 | PASS | Node 24 环境下 `npm run check` 通过；加载 ESP-IDF 后严格门禁为 `205 passed / 0 pending / 0 failed` |
| 自动化测试 | PASS | `npm test`：server 36、film-core 7、微信 12、发布工具 3 全部通过 |
| 依赖安全 | PASS | `npm run audit`：官方 registry 生产依赖 `0 vulnerabilities` |
| 安装可重复性 | PASS | 根目录和 `server/` 的 `npm ci --dry-run` 均通过；原生 `better-sqlite3` 安装脚本仍需在部署机按 Node 24 审批 |
| 运行时探针 | PASS | 8787 实例的 `/`、`/studio/`、`/health`、`/readyz` 均返回 200 |
| Caddy 配置 | PASS | `PENAUP_DOMAIN=penaup.example.com caddy validate --config deploy/Caddyfile --adapter caddyfile` |
| Mosquitto 配置语法 | PASS | `mosquitto --test-config -c deploy/mqtt/mosquitto.conf.example` 报告配置文件有效；未启动公网 broker |
| 微信开发者工具登录 | PARTIAL | CLI `islogin` 返回 `login: true`；打开当前项目被微信返回 code 10：登录用户不是该小程序开发者 |
| ESP-IDF 三机型构建 | PASS | ESP-IDF v5.5.2；`build_gate_std` 应用余量 13%（0x30b30），`build_gate_pro` 余量 12%（0x2fe80），`build_gate_max` 余量 14%（0x33ef0）；实体刷写仍 pending |
| 旧 FastAPI 正式导入 | PENDING | 本机未找到旧 `filmhub.db`；不能用当前 Penaup 目标库冒充旧源库 |
| 真实 BLE / OTA / 刷屏 | PENDING | 需要实体 STD、Pro、Max 和重新广播后的状态回读 |
| 正式邮件、Caddy 公网 TLS、MQTT ACL | PENDING | 需要部署机、真实域名/证书、邮件 provider 和设备账号 |
| 合同/字体/图片/第三方资产权利 | PENDING | 需要逐文件来源和外包权利转让材料复核 |

严格发布门禁（2026-08-23，本机）已经通过：

```text
npm run release:gate -- --strict-external
Contract gate: 205 passed, 0 pending, 0 failed
server 36 passed · film-core 7 passed · 微信 12 passed · Web/release 6 passed
npm audit --omit=dev: 0 vulnerabilities
```

## 可重复命令

```bash
node --version
npm run check
npm test
npm run audit
npm ci --dry-run
npm --prefix server ci --dry-run
PENAUP_DOMAIN=penaup.example.com caddy validate --config deploy/Caddyfile --adapter caddyfile
mosquitto --test-config -c deploy/mqtt/mosquitto.conf.example
node server/migrations/import-fastapi.mjs --help
```

严格门禁应在装好 ESP-IDF 并导出环境后执行；本机已用同一环境完成三机型构建：

```bash
source /Users/Apple/.espressif/frameworks/esp-idf-v5.5.2/export.sh
npm run release:gate -- --strict-external
```

如果另一台机器的 `idf.py` 未出现在 `PATH`，命令失败仍属于环境门禁失败，不能用本机缓存替代该机器的构建证据。

## 数据迁移证据

本机探测到的与 Penaup 相关 SQLite 只有当前 `server/data/penaup.db`；`/Users/Apple/Developer/art/peanup` 中的 SQLite 文件属于 Swift 构建缓存或包管理缓存，不是旧 FastAPI 数据库。为验证迁移器不会读取/修改目标库，本轮用 `better-sqlite3` 对当前数据库做了一份只读一致性副本，再以 `--dry-run --json` 运行：

```text
tables: devices=3, events=4, schema_meta=1, 其余旧业务表=0
users=0 devices=3 albums=0 photos=0 media_imported=0 warnings=0
dry_run_target_entries=legacy-data
```

这只证明迁移器能安全处理一个没有旧 FastAPI 业务表的 SQLite 副本；正式导入前仍必须拿到真实旧库和媒体目录，先运行：

```bash
npm run migrate:fastapi -- \
  --source-db /absolute/path/to/filmhub.db \
  --source-data /absolute/path/to/legacy-data \
  --target-data /absolute/path/to/penaup-data \
  --dry-run --json
```

迁移器会拒绝未知选项、默认路径不再依赖当前 shell 目录，并且始终要求源库和目标库是不同文件。源库和旧媒体不会被删除；正式导入前必须保留原始备份。

## 外部/硬件门禁

以下项目没有用静态文件存在、浏览器能力探测或 BLE 写入回执替代真实验收：

- 微信开发者工具需要登录账号属于 `wxbc2a896cc86ce8f2` 的开发者；当前 CLI 已登录但无该 AppID 权限。
- Web Serial 只有能力说明，不开放未知 bootloader 地址、分区或协议。
- OTA 写完 `OTA_STOP` 后必须等待设备重新广播并回读状态；页面显示 `device_state_uncertain` 时不能显示成功。
- 三机型必须分别用 `sdkconfig_std`、`sdkconfig_pro`、`sdkconfig_max` 构建，并在实体设备上完成完整刷新、断连/重连、耗电和失败恢复测试。
- Caddy/Mosquitto 示例只代表配置模板；公网 TLS、证书、ACL、systemd 权限和备份恢复必须在部署机上执行。

## 密钥与权利边界

- 微信读书 Skill Key 不进入仓库、测试、日志、截图或环境示例。用户曾在开发对话中粘贴过一个真实 Key，正式上线前必须在微信读书侧立即轮换；自动化测试只使用假的测试值。
- 新写内容使用 `Copyright (c) 2026 poboll` 与非商业许可；历史外包代码、GPL 固件、第三方字体、图片、图标、SDK 和依赖仍按 [`docs/legal/provenance.md`](../legal/provenance.md) 逐项复核，不能因为目录迁移就宣称为 poboll 独占原创。
