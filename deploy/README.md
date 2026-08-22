# Linux VPS 部署模板

默认部署是一台 Linux VPS：Caddy 负责 TLS，systemd 运行 `server/src/server.js`，SQLite WAL 和媒体文件位于受限的 `/var/lib/penaup/data`。运行时固定 Node.js 24（仓库 `.node-version` 为 `24.19.0`）；安装依赖后必须让 `better-sqlite3` 按目标 Node 版本完成安装。先复制 `.env.example` 到 `/etc/penaup/penaup.env`，替换所有 token、域名和邮件 provider，再安装依赖并执行 `npm test`。

```bash
sudo useradd --system --home /var/lib/penaup --shell /usr/sbin/nologin penaup
sudo install -d -o penaup -g penaup -m 700 /var/lib/penaup/data /var/backups/penaup
sudo cp deploy/penaup.service /etc/systemd/system/penaup.service
sudo systemctl daemon-reload
sudo systemctl enable --now penaup
```

用环境变量提供实际域名后加载 Caddy：`PENAUP_DOMAIN=penaup.example.com caddy validate --config deploy/Caddyfile --adapter caddyfile`。`/api/v1/events/stream` 使用禁缓冲反向代理；负载均衡或 systemd 存活检查用 `GET /health`，只有 `GET /readyz` 返回 200 才允许接收用户流量。生产环境把 `PENAUP_TRUST_PROXY=1` 交给 Caddy 后面的 Node 运行时，让进程内限流按真实客户端 IP 计数；限流响应带有 `Retry-After`，设备心跳不受用户 API 突发限流影响。每日运行 `backup.sh`，备份同时包含 SQLite 一致性副本和 `media/`，保留 14 天，目标 RPO 24 小时、RTO 4 小时。

恢复必须指向一个明确的新目录，默认不会覆盖已有数据：

```bash
deploy/restore.sh /var/backups/penaup/20260823T000000Z /var/lib/penaup/data
```

需要替换现有运行目录时显式使用 `--force`；脚本会先将旧目录移动为
`data.before-restore-<timestamp>`，校验 SQLite integrity、限制 tar 归档只能写入
`media/`，并拒绝符号链接和特殊文件。切换 systemd 前，应停止服务、核对恢复目录中的
`penaup.db` 与媒体 SHA-256，确认 `GET /readyz` 返回 200 后再恢复流量。

MQTT broker 必须启用用户名/密码和 ACL：设备只能发布自己的 `penaup/device/<id>/state`、订阅自己的 `.../command`，禁止匿名连接和自动注册；设备首次登记仍以 HTTP 心跳 token 为准。Mosquitto 的 listener、TLS 和最小 ACL 示例见 [`mqtt/README.md`](mqtt/README.md)。
