# Penaup API

花生片服务端是 Node.js 24 + Fastify 单体。HTTP 是照片和兼容固件的可靠入口；SSE 只推送状态事件；MQTT 只承载已登记设备的状态和指令，不承载照片。

## 用户接口

```text
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
POST /api/v1/templates
POST /api/v1/streams

POST /api/v1/transfers
GET  /api/v1/transfers/:id
POST /api/v1/transfers/:id/retry
POST /api/v1/transfers/:id/events
GET  /api/v1/events/stream
```

用户只能读取自己拥有的设备、媒体、相册、模板、片单和 transfer。浏览器使用 HttpOnly Cookie 时，所有写请求（包括 refresh/logout）都需要 `X-CSRF-Token`；小程序和未来 iOS 使用短期 Bearer access token，并以 refresh token 换新令牌。失败 transfer 可创建新的 retry transfer；`device_state_uncertain` 不允许自动重发，必须先确认设备画面。

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
