# Penaup Runtime

花生片 Penaup 的轻量设备运行时。它是一个可独立启动的 Node.js 24 单体，不依赖 Redis、PostgreSQL 或必须在线的 MQTT broker。

## 组件

- Fastify：健康检查、设备心跳、媒体上传、设备命令、Runtime 控制台和静态 Web 工具；
- SQLite：设备、媒体索引、待下发命令和状态事件；
- 本地文件：保存已由端侧转换好的 `.film`；
- MQTT：可选的 Wi-Fi 状态/指令桥，设置 `PENAUP_MQTT_URL` 后启用；
- SSE：管理端实时接收心跳、命令和媒体事件。

运行时默认不启动 broker，也不会因为 MQTT 暂时离线而阻塞 BLE、本地上传或
HTTP 心跳。`GET /health` 会同时返回 `mqtt_connected` 和 `mqtt_status`，便于
监控页面区分“已配置”和“当前已连上 broker”。

## 启动

```bash
nvm use 24
npm install
npm test
npm start
```

默认地址：`http://127.0.0.1:8787`。

- 产品故事页：`http://127.0.0.1:8787/`
- 创作工作台：`http://127.0.0.1:8787/studio/`
- 微信读书屏保：进入工作台的“读书”标签；接口只做一次性摘要转发，不保存 Skill Key
- Runtime 控制台：`http://127.0.0.1:8787/admin/`（管理令牌由环境变量提供）
- 存活探针：`GET /health`；就绪探针：`GET /readyz`（SQLite 和媒体目录不可用时返回 `503`）

可选配置：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PENAUP_HOST` | `127.0.0.1` | 监听地址；局域网部署需明确改为 `0.0.0.0` |
| `PENAUP_PORT` | `8787` | HTTP 端口 |
| `PENAUP_DATA_DIR` | `server/data` | SQLite 和媒体目录 |
| `PENAUP_ADMIN_TOKEN` | 空 | 仅非 production 的 loopback 开发运行可留空；生产或非回环监听必须设置，否则管理 API 返回 503 |
| `PENAUP_MQTT_URL` | 空 | MQTT broker URL，例如 `mqtt://127.0.0.1:1883` |
| `PENAUP_MQTT_TOPIC_PREFIX` | `penaup/device` | 设备状态和命令 topic 前缀 |
| `PENAUP_WEREAD_GATEWAY_URL` | 微信读书 HTTPS gateway | 微信读书临时转发地址；必须是 HTTPS |
| `PENAUP_WEREAD_SKILL_VERSION` | `1.0.4` | 上游 Skill 版本，不是用户 Key |
| `PENAUP_WEREAD_TIMEOUT_MS` | `15000` | 微信读书请求超时，范围 3000–60000ms |

## 设备兼容接口

```text
GET /api/v1/device/heartbeat?device_id=...&token=...
GET /api/v1/device/status?device_id=...&token=...
GET /api/v1/device/film/:filename?device_id=...&token=...
GET /api/v1/device/film/latest.film?device_id=...&token=...
```

首次心跳会注册设备并返回 token；后续心跳带 token。token 不写入日志，不通过管理端列表或事件返回。设备状态和媒体下载都需要 device token。上传接口只接受当前三机型的合法 `.film` 文件：STD `120032B`、Pro `209120B`、Max `960032B`，并校验 32B 头部的尺寸、主体长度和六色标记。`latest.film` 会从本地媒体索引中选择最近上传的 `.film`，用于兼容固件固定下载地址。模板、相册、轮播和设备管理的 Node 兼容路由已经覆盖旧管理台；复杂像素渲染仍由端侧 `film-core` 完成，旧 FastAPI 只作为回滚、来源核对和 SQLite 导入参考。

MQTT 只接受已登记设备发布到
`<PENAUP_MQTT_TOPIC_PREFIX>/<device_id>/state` 的 JSON 状态，并要求 payload
携带该设备首次 HTTP 心跳返回的 `token`。运行时向
`<PENAUP_MQTT_TOPIC_PREFIX>/<device_id>/command` 发布 JSON 指令；设备 ID 会
按 MQTT topic 进行 URL 编码。照片本体不进入 MQTT。

## 旧 FastAPI 数据迁移

迁移器以只读方式打开旧 SQLite 和媒体目录，先执行 dry-run，再执行正式导入。它会输出表计数、用户/设备/相册/模板/轮播映射、模板结构、原图与 `.film` 的 SHA-256，以及三机型 `.film` 头部和尺寸校验。照片同时有原图和合法 `.film` 时，会写成两条独立媒体记录，并在目标 `photos.film_path` 保留对应关系；非法 `.film` 只记录警告，不进入目标媒体目录。

```bash
cd server
npm run migrate:fastapi -- \
  --source-db /path/to/filmhub.db \
  --source-data /path/to/legacy-data \
  --target-data ./data \
  --dry-run --json

npm run migrate:fastapi -- \
  --source-db /path/to/filmhub.db \
  --source-data /path/to/legacy-data \
  --target-data ./data \
  --json
```

源库与目标库必须是不同文件；导入器不会删除源库或旧媒体。正式导入后，应根据报告核对 `media_imported`、`photos_imported`、`film.valid`、SHA-256 和 warnings，再执行独立备份与恢复演练。

## 安全边界

- 新部署默认只监听回环地址；暴露到局域网前要设置管理 token，并通过 HTTPS 或可信内网保护上传接口；
- 非 production 的 loopback 开发运行可不设置管理 token；生产环境即使通过 Caddy 反代到 loopback，也必须设置管理 token；非回环监听同样必须设置，否则管理 API 会主动拒绝请求；
- 媒体文件名经过净化，不能通过 `../` 访问任意路径；
- MQTT 只传设备事件和命令，不传照片本体；
- 本地运行数据在 `server/data/`，不会加入 Git；
- 新部署已锁定 `@fastify/static >= 10.1.3`，用于修复已知路径穿越/授权绕过问题；
  发布前应在可访问官方 npm audit 服务的环境再次执行 `npm audit --omit=dev`。
- 本仓库用 `.node-version` 固定 Node.js 24.19.0；切换到其他大版本前必须重新安装原生依赖并重新跑完整测试。

## 本地验收

```bash
npm run check
npm test
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Web 故事页位于 `/`，BLE 创作工具位于 `/studio/`，兼容管理台位于 `/admin/`。真机 BLE、微信开发者工具、ESP-IDF 三机型构建、Caddy HTTPS、真实邮件 provider、MQTT broker ACL 和备份恢复不由本地 Node 测试替代，发布前必须单独完成。
