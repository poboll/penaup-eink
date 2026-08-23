# Penaup Runtime 技术设计

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

## 1. 设计结论

花生片第一阶段使用“单进程、模块化边界”的轻量 Node.js 运行时：

```text
Web / 小程序 ── BLE ────────────────> Penaup 设备
     │                                  │
     │ HTTP（管理 / 媒体）              │ Wi-Fi HTTP 心跳与下载
     ▼                                  ▼
┌─────────────────────────────────────────────┐
│ Node.js 24 + Fastify                        │
│  HTTP API · 静态工具 · SSE · 可选 MQTT bridge│
├─────────────────────────────────────────────┤
│ SQLite WAL                                   │
│ devices · media · commands · events          │
├─────────────────────────────────────────────┤
│ data/media/*.film                            │
└─────────────────────────────────────────────┘
```

照片转换留在端侧；MQTT 只传状态和命令；SQLite 是本机状态索引；本地文件是 `.film` 的事实存储。当前不引入 Redis、PostgreSQL、任务队列或微服务。

## 2. 模块边界

`server/src/` 的职责拆成四个逻辑模块，仍由一个 Fastify 进程部署：

| 模块 | 文件 | 责任 |
|---|---|---|
| 配置 | `src/config.js` | 环境变量、路径、限制和默认监听地址 |
| 数据 | `src/db.js` | SQLite schema、设备心跳、命令、媒体索引、事件 |
| 事件 | `src/events.js` | 进程内订阅、SSE 广播，不持有持久状态 |
| 传输 | `src/mqtt.js` | 可选 MQTT 状态订阅和命令发布 |
| HTTP | `src/app.js` | 鉴权、静态托管、API、文件流和生命周期 |

依赖方向保持单向：HTTP / MQTT → 数据与事件；媒体不通过事件表传输本体；设备 BLE 不进入服务端进程。

## 3. 运行时配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PENAUP_HOST` | `127.0.0.1` | 默认仅本机监听 |
| `PENAUP_PORT` | `8787` | HTTP 端口 |
| `PENAUP_DATA_DIR` | `server/data` | 数据根目录 |
| `PENAUP_ADMIN_TOKEN` | 空 | 管理 API Bearer token；开放网络前必须设置 |
| `PENAUP_HEARTBEAT_INTERVAL` | `60` | 默认设备心跳秒数，限制 `5..180` |
| `PENAUP_MQTT_URL` | 空 | 为空时不连接 broker |
| `PENAUP_MQTT_USERNAME` | 空 | MQTT 用户名，仅环境变量 |
| `PENAUP_MQTT_PASSWORD` | 空 | MQTT 密码，仅环境变量 |
| `PENAUP_MQTT_TOPIC_PREFIX` | `penaup/device` | topic 前缀 |
| `PENAUP_LOG_LEVEL` | `info` | Fastify 日志级别 |

管理令牌为空是本机开发便利，不是生产安全配置。不要把真实令牌写入 `.env`、测试快照、浏览器截图或 Git。

## 4. 数据模型

SQLite 启动时幂等创建以下表。时间统一保存 ISO 8601 UTC 字符串。

### 4.1 `devices`

```text
id                 INTEGER PRIMARY KEY
device_id          TEXT UNIQUE NOT NULL
token              TEXT NOT NULL
name               TEXT NOT NULL DEFAULT ''
model              TEXT NOT NULL DEFAULT 'unknown'
battery_percent    INTEGER NOT NULL DEFAULT -1
voltage_mv         INTEGER NOT NULL DEFAULT 0
state              TEXT NOT NULL DEFAULT 'unknown'
wifi_connected     INTEGER NOT NULL DEFAULT 0
heartbeat_interval INTEGER NOT NULL DEFAULT 60
last_seen_at       TEXT
last_ip            TEXT NOT NULL DEFAULT ''
created_at         TEXT NOT NULL
```

token 只在首次心跳响应中返回；管理设备列表不返回 token。在线状态按 `last_seen_at <= heartbeat_interval × 3` 计算，不落一份容易漂移的 `online` 字段。

### 4.2 `media`

```text
id          INTEGER PRIMARY KEY
name        TEXT NOT NULL
stored_path TEXT UNIQUE NOT NULL
mime        TEXT NOT NULL
size        INTEGER NOT NULL
created_at  TEXT NOT NULL
```

文件落在 `PENAUP_DATA_DIR/media/`，数据库只保存相对路径。写入时使用随机 UUID 前缀，展示名只允许安全文件名。上传上限为 16 MiB，远高于 Max 当前约 0.96 MiB 的 `.film`，但可以防止意外上传大文件。

### 4.3 `commands`

```text
id           INTEGER PRIMARY KEY
device_id    TEXT NOT NULL
command      TEXT NOT NULL
params_json  TEXT NOT NULL DEFAULT '{}'
status       TEXT NOT NULL DEFAULT 'pending'
created_at   TEXT NOT NULL
delivered_at TEXT
```

心跳在一个 SQLite transaction 中读取单设备最多 20 条 pending 命令并标记 delivered，避免同一命令在连续心跳重复返回。设备执行失败的业务结果仍由设备下一次状态上报或事件观察；第一阶段不伪造 ACK。

### 4.4 `events`

事件表存小型 JSON 摘要：心跳、状态、命令和媒体创建。不得把照片 bytes、Wi-Fi 密码或 token 放入 payload。SSE 断开时，管理端可以从事件表重新查询最近记录。

## 5. HTTP API

### 5.1 公开 / 设备接口

```text
GET /health
GET /api/v1/device/heartbeat
GET /api/v1/device/status?device_id=…
GET /api/v1/device/film/latest.film?device_id=…&token=…
GET /api/v1/device/film/:filename?device_id=…&token=…
```

`/health` 不返回密钥和设备列表。心跳首次按 `device_id` 注册并返回 token；已存在设备必须携带相同 token，否则 401。媒体下载每次都校验设备 token，并且通过路径约束防止 `../` 越界。

心跳成功响应保持固件当前解析的形状：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "server_time": 1780000000,
    "heartbeat_interval": 60,
    "commands": []
  }
}
```

首次注册会额外返回 `token`。这不是新的 BLE 协议，固件从 HTTP JSON 读取并持久化。

### 5.2 管理接口

当 `PENAUP_ADMIN_TOKEN` 非空时，以下接口必须携带 `Authorization: Bearer <token>`：

```text
GET  /api/v1/admin/devices
GET  /api/v1/admin/events?limit=50
GET  /api/v1/admin/media
POST /api/v1/admin/devices/:deviceId/commands
POST /api/v1/admin/media                multipart field: film
GET  /api/v1/events/stream               SSE
```

命令请求示例：

```json
{
  "cmd": "set_config",
  "params": { "play_mode": 1 }
}
```

上传服务端只接受 `.film` 后缀的显示帧，文件名会净化，文件以流方式落盘，成功后才插入 `media` 索引。数据库插入失败时应清理孤儿文件；媒体表和文件目录需在备份/恢复时一起处理。

## 6. MQTT 设计

MQTT 连接由 `src/mqtt.js` 创建，默认不启用。启用时订阅：

```text
<prefix>/+/state
```

并向以下 topic 发布命令：

```text
<prefix>/<device_id>/command
```

建议状态 payload：

```json
{
  "token": "device-token",
  "model": "PENAUPPRO",
  "battery": 87,
  "voltageMv": 4100,
  "state": "idle",
  "wifiConnected": true,
  "heartbeatInterval": 60
}
```

已有设备的 MQTT 状态仍要通过 token 校验；broker 只改变传输方式，不绕过设备认证。QoS 1 只保证 broker 的最低交付语义，不等于设备已经执行命令。照片禁止放进 MQTT payload。

## 7. SSE 实时状态

事件序列由 `EventHub` 广播，同时写入 SQLite：

```text
device.heartbeat
device.state
device.command
media.created
```

SSE 每 15 秒发送 keep-alive 注释，客户端断开后清除定时器和订阅。管理端连接 SSE 时应携带管理鉴权；若浏览器 API 无法设置自定义 header，应使用带 Authorization 的 `fetch` 流，而不是把令牌放在 URL 查询参数。

SSE 只负责即时体验，页面重新打开时仍必须调用设备、媒体和事件查询接口恢复完整状态。

## 8. 失败模式与处理

| 故障 | 影响 | 处理 |
|---|---|---|
| SQLite 无法打开 | API 无法读写 | 启动失败并保留原数据，不自动删除数据库 |
| MQTT broker 不可达 | MQTT 实时状态暂停 | 自动重连；HTTP 心跳、BLE 和管理查询继续 |
| 上传中断 | 产生不完整文件 | 流失败后删除临时目标，不写媒体索引 |
| 心跳 token 错误 | 设备不更新 | 返回 401；用户通过 BLE / 管理流程重新配置，不覆盖旧 token |
| latest 不存在 | 设备下载 404 | 管理端提示先上传 `.film`，不返回假文件 |
| SSE 客户端断开 | 一个页面失去即时更新 | 解除订阅，页面可轮询恢复 |
| 磁盘空间不足 | 新媒体无法保存 | 返回错误并保留已存在媒体；运维按 allowlist 清理 |

## 9. 安全设计

- 默认回环监听，局域网部署必须显式设置 host 和管理 token；
- 不记录 `token`、Wi-Fi password、MQTT password 和原始图片；
- 设备文件 API 同时校验 device ID 与 token；
- 文件名使用 basename + allowlist，数据库路径必须落在 media root；
- 管理命令不允许任意执行 shell，只接受 JSON command 名称和参数；
- MQTT topic 中的设备 ID 应 URL 编码，解析时严格匹配前缀；
- 许可证是非商业使用许可，不代表第三方代码、字体、数据手册或外包交付物自动归 `poboll` 所有。

## 10. 迁移策略

旧 `legacy/fastapi/` FastAPI 实现继续保留作迁移参考，不再作为新部署入口。迁移原则：

1. 先以真实设备心跳、媒体下载和命令消费验收 Node Runtime；
2. 再按模块迁移模板、轮播、相册和 AI 能力；
3. 每次迁移保留旧 API 对照测试，不删历史数据库或媒体；
4. 迁移期间不同时让两个服务写同一个生产 `data/` 目录；
5. 完成一项后更新 `server/AGENTS.md`、Runtime README 和本设计文档。

不通过“保留旧 FastAPI 入口但改一个标题”的方式假装迁移完成；未迁移的 API 必须明确标为历史范围。

## 11. 扩展门槛

只有出现以下真实信号，才考虑替换组件：

- 多台部署实例需要共享媒体和命令队列：迁移 PostgreSQL + 对象存储；
- 单机媒体量超过可靠备份或磁盘边界：引入兼容 S3 存储；
- 需要大量异步渲染任务：再引入队列和 worker；
- MQTT 状态量或多租户权限成为瓶颈：拆分设备网关；
- 有专门运维能力后：再评估容器编排。

在这些条件出现前，模块化单体的故障域、备份方式和调试路径都更适合一个人维护。
