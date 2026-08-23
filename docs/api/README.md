# Penaup API

花生片服务端是 Node.js 24 + Fastify 单体。HTTP 是照片和兼容固件的可靠入口；SSE 只推送状态事件；MQTT 只承载已登记设备的状态和指令，不承载照片。

## 用户接口

```text
GET  /health
GET  /readyz

POST /api/v1/auth/challenges
POST /api/v1/auth/verify
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/me

GET  /api/v1/devices
POST /api/v1/devices/:id/claim
POST /api/v1/devices/:id/commands
POST /api/v1/devices/:id/sync

POST /api/v1/media
GET  /api/v1/media
GET  /api/v1/media/:id/download

POST /api/v1/albums
GET  /api/v1/albums
GET  /api/v1/albums/:id
PUT  /api/v1/albums/:id
PATCH /api/v1/albums/:id
DELETE /api/v1/albums/:id
GET  /api/v1/albums/:id/photos
POST /api/v1/albums/:id/photos
GET  /api/v1/albums/:id/photos/:photoId/file
DELETE /api/v1/albums/:id/photos/:photoId
POST /api/v1/albums/:id/photos/sort
PUT  /api/v1/albums/:id/photos/:photoId/layout
PATCH /api/v1/albums/:id/photos/:photoId/layout

POST /api/v1/templates
GET  /api/v1/templates
GET  /api/v1/templates/:id
PUT  /api/v1/templates/:id
PATCH /api/v1/templates/:id
DELETE /api/v1/templates/:id
GET  /api/v1/templates/:id/preview

POST /api/v1/streams
GET  /api/v1/streams
GET  /api/v1/streams/:id
PUT  /api/v1/streams/:id
PATCH /api/v1/streams/:id
DELETE /api/v1/streams/:id
POST /api/v1/streams/:id/items
PUT  /api/v1/streams/:id/items/:itemId
PATCH /api/v1/streams/:id/items/:itemId
DELETE /api/v1/streams/:id/items/:itemId
POST /api/v1/streams/:id/items/sort
POST /api/v1/streams/:id/devices
POST /api/v1/streams/:id/push
GET  /api/v1/streams/:id/timeline
GET  /api/v1/streams/:id/pushes
GET  /api/v1/pushes

POST /api/v1/transfers
GET  /api/v1/transfers
GET  /api/v1/transfers/:id
POST /api/v1/transfers/:id/retry
POST /api/v1/transfers/:id/events
GET  /api/v1/events/stream

GET  /api/v1/settings
PUT  /api/v1/settings
GET  /api/v1/ai/providers
GET  /api/v1/ai/settings
PUT  /api/v1/ai/settings
POST /api/v1/ai/generate

POST /api/v1/integrations/weread/snapshot
```

用户只能读取自己拥有的设备、媒体、相册、模板、片单和 transfer。浏览器使用 HttpOnly Cookie 时，所有写请求（包括 refresh/logout）都需要 `X-CSRF-Token`；小程序和未来 iOS 使用短期 Bearer access token，并以 refresh token 换新令牌。失败 transfer 可创建新的 retry transfer；`device_state_uncertain` 不允许自动重发，必须先确认设备画面。

## 请求限流

所有 `/api/` 请求都会按客户端 IP 使用进程内固定窗口限流，设备心跳
`/api/v1/device/heartbeat` 保留独立通道，不消耗用户 API 配额。默认窗口为 60 秒、每个
IP 120 次请求，可通过 `PENAUP_RATE_LIMIT_WINDOW_MS`、`PENAUP_RATE_LIMIT_MAX` 和
`PENAUP_RATE_LIMIT_MAX_KEYS` 调整；服务重启后计数清零。被限制时返回 `429`，响应包含
`Retry-After`（秒）、`X-RateLimit-Limit`、`X-RateLimit-Remaining`，JSON 为：

```json
{
  "ok": false,
  "error": "rate_limited",
  "retry_after_seconds": 12
}
```

生产环境只有在 Caddy 是唯一可信反向代理时才启用 `PENAUP_TRUST_PROXY=1`，否则限流按
代理地址计数。客户端应遵守 `Retry-After`，使用指数退避；不要为了重试 `device_state_uncertain`
而自动重复发送照片。

## 设备兼容接口

```text
GET /api/v1/device/heartbeat
GET /api/v1/device/status
GET /api/v1/device/film/:filename
GET /api/v1/device/film/latest.film
```

设备 token 由首次 HTTP 心跳建立，后续请求必须带 token。film 下载在 token 校验之后再按设备归属筛选：未认领设备只能读取管理员导入的公共 film，已认领设备只能读取公共 film 或该设备所属用户的 film。

## 上传边界

- 允许 `image/jpeg`、`image/png`、`image/webp` 和合法 `.film`；文件魔数和 film 头部都会复核；
- 图片写入媒体目录前清理 JPEG APP1/APP13/COM、PNG 文本/EXIF 和 WebP EXIF/XMP/ICCP 元数据；
- 单用户媒体配额默认 512 MiB，检查包含本次文件大小；原图不会公开直链；
- 文件名只保留 ASCII 安全字符，存储路径必须落在 `PENAUP_DATA_DIR/media` 内；
- 原图处理失败时保留草稿/客户端数据，不将失败状态伪装为成功。

完整 transfer 字段和跨端状态约束见 [transfer-state.md](transfer-state.md)；原生客户端的令牌、SSE、BLE 和 Live Activity 接入见 [ios-integration.md](ios-integration.md)。机器可读接口见 [openapi.yaml](openapi.yaml)。

## 微信读书屏保

`POST /api/v1/integrations/weread/snapshot` 使用一次性请求头
`X-Penaup-WeRead-Key` 临时访问微信读书数据，支持 `weekly` / `monthly`，返回
`PENAUP_PRO` 的 `792 × 528` 屏保摘要。Key 不进 URL、数据库、响应或 MQTT；路由返回
`Cache-Control: no-store`。完整字段、字体和隐私边界见
[微信读书屏保整合](../integrations/weread-wallpaper.md)。

## 旧管理接口兼容面

`/api/v1/admin/*` 只为既有管理台和迁移期脚本保留，全部要求管理员 token，不向 Web、微信小程序或 iOS 客户端开放。新客户端不得依赖这些路径；管理台当前使用的兼容面如下：

```text
POST     /api/v1/admin/invites
GET      /api/v1/admin/invites/list
GET      /api/v1/admin/transfers
GET      /api/v1/admin/stats/dashboard
GET      /api/v1/admin/system/info
GET      /api/v1/admin/devices
GET      /api/v1/admin/devices/:deviceId
POST     /api/v1/admin/devices/:deviceId/claim
PUT      /api/v1/admin/devices/:deviceId
DELETE   /api/v1/admin/devices/:deviceId
POST     /api/v1/admin/devices/:deviceId/commands
POST     /api/v1/admin/devices/:deviceId/reset-token
POST     /api/v1/admin/devices/:deviceId/set-config
POST     /api/v1/admin/devices/:deviceId/sync-film
GET      /api/v1/admin/devices/:deviceId/preview
GET/POST /api/v1/admin/albums
GET/PUT/DELETE /api/v1/admin/albums/:albumId
POST     /api/v1/admin/albums/:albumId/photos/batch
PUT      /api/v1/admin/albums/:albumId/photos/sort
PUT      /api/v1/admin/albums/:albumId/photos/:photoId/layout
GET      /api/v1/admin/photos/:photoId/file
DELETE   /api/v1/admin/photos/:photoId
GET/POST /api/v1/admin/templates
GET/PUT/DELETE /api/v1/admin/templates/:templateId
GET/POST /api/v1/admin/templates/:templateId/preview
GET/POST /api/v1/admin/streams
GET/PUT/DELETE /api/v1/admin/streams/:streamId
POST     /api/v1/admin/streams/:streamId/items
PUT/DELETE /api/v1/admin/streams/:streamId/items/:itemId
POST     /api/v1/admin/streams/:streamId/items/sort
POST     /api/v1/admin/streams/:streamId/devices
GET      /api/v1/admin/streams/:streamId/timeline
GET/PUT  /api/v1/admin/settings/ui
GET/PUT  /api/v1/admin/settings/ai
POST     /api/v1/admin/settings/ai/test
GET      /api/v1/admin/ai/providers
POST     /api/v1/admin/ai/template
POST     /api/v1/admin/ai/image
POST/PUT /api/v1/admin/auth/password (已退役，仅返回兼容错误)
GET      /api/v1/admin/events
GET      /api/v1/admin/media
POST     /api/v1/admin/media
```

这组路径的实现位于 `server/src/transports/legacy-admin.js` 和 `server/src/app.js`，任何新增管理能力应优先进入用户作用域模块，并同步更新 `openapi.yaml` 与本清单。
