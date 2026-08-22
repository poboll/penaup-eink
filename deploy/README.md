# Linux VPS 部署模板

默认部署是一台 Linux VPS：Caddy 负责 TLS，systemd 运行 `server/src/server.js`，SQLite WAL 和媒体文件位于受限的 `/var/lib/penaup/data`。运行时固定 Node.js 24（仓库 `.node-version` 为 `24.19.0`）；安装依赖后必须让 `better-sqlite3` 按目标 Node 版本完成安装。先复制 `.env.example` 到 `/etc/penaup/penaup.env`，替换所有 token、域名和邮件 provider，再安装依赖并执行 `npm test`。

```bash
sudo useradd --system --home /var/lib/penaup --shell /usr/sbin/nologin penaup
sudo install -d -o penaup -g penaup -m 700 /var/lib/penaup/data /var/backups/penaup
sudo cp deploy/penaup.service /etc/systemd/system/penaup.service
sudo systemctl daemon-reload
sudo systemctl enable --now penaup
```

把 `Caddyfile` 中的 `PENAUP_DOMAIN` 设置为实际域名后加载 Caddy。`/api/v1/events/stream` 使用禁缓冲反向代理；健康检查用 `GET /health`。每日运行 `backup.sh`，备份同时包含 SQLite 一致性副本和 `media/`，保留 14 天，目标 RPO 24 小时、RTO 4 小时。

MQTT broker 必须启用用户名/密码和 ACL：设备只能发布自己的 `penaup/device/<id>/state`、订阅自己的 `.../command`，禁止匿名连接和自动注册；设备首次登记仍以 HTTP 心跳 token 为准。
