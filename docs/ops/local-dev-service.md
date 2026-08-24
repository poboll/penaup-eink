# 本地 8787 常驻服务

Copyright (c) 2026 poboll · `LicenseRef-Poboll-NonCommercial`

`npm run dev` 使用的是临时的 Node watch 进程。它适合修改代码时看即时重载，但如果由临时终端或开发会话托管，终端结束后进程也可能退出。需要让 `http://127.0.0.1:8787/` 在 Codex、编辑器或终端关闭后仍保持运行时，使用 macOS 的用户级 `launchd`。

## 安装与检查

在仓库根目录执行：

```bash
npm run service:install
npm run service:status
curl http://127.0.0.1:8787/health
```

安装器使用当前 Node 24 的绝对路径，不依赖之后打开的 shell 是否加载 nvm；服务默认只监听 `127.0.0.1`，不会把本地开发页面暴露到局域网。配置文件写入：

```text
~/Library/LaunchAgents/com.poboll.penaup-eink.dev.plist
```

日志写入 `server/data/launchd-stdout.log` 和 `server/data/launchd-stderr.log`，运行数据本身仍受 `.gitignore` 保护。

## 停止

只有在明确不需要本地常驻服务时执行：

```bash
npm run service:uninstall
```

这只停止并移除 LaunchAgent 配置，不会删除 SQLite、媒体或仓库文件。
