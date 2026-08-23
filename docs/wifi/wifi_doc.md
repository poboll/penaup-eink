# 花生片 Penaup Wi-Fi 与心跳

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

Wi-Fi 是 BLE 本地传图之外的可选路径：设备连接家庭网络，周期性向 Penaup Runtime 上报状态，并按响应中的命令拉取最新 `.film`。照片本体仍通过 HTTP 下载，不经过 MQTT；BLE 仍是首次配网和近场控制的主要入口。

浏览器配网与维护入口为运行时的 `/device/`。它只在当前 BLE 会话中写入网络配置；清除网络使用 `0x3B`，不会把密码发送到 Runtime。

## 1. 功能边界

```text
手机 / Web ── BLE ──> Penaup ── Wi-Fi STA ──> Penaup Runtime
                                      │
                                      └── GET /api/v1/device/film/latest.film
```

- Wi-Fi 默认关闭，只有用户在 BLE 设置中开启后才初始化 ESP-IDF Wi-Fi；
- `film_api_url` 可以填写 Runtime 根地址，例如 `http://192.168.1.20:8787`，固件会补上 `/api/v1/device/heartbeat`；
- `film_heartbeat_url` 也可以直接填写完整心跳地址；
- 设备第一次心跳由服务端生成 token，之后持久化并带 token 上报；
- 没有 Wi-Fi、服务端或 MQTT 时，BLE 传图和 SD 卡本地播放不应被阻断。

当前固件服务层没有把 Wi-Fi 逻辑限制在某个 `FRAMEFILM_*` 宏分支；是否在某块实际硬件上接出 Wi-Fi、是否完成天线和功耗验证，必须以对应 PCB、样机测试和 `sdkconfig_{std,pro,max}` 为准，不能仅凭本文宣称量产能力。

## 2. NVS 参数

参数结构位于 `film_service/inc/service_param.h`，默认值在 `service_param.c` 设置：

| 字段 | 类型 / 上限 | 默认值 | 作用 |
|---|---|---|---|
| `wifi_enable` | `uint8` | `0` | Wi-Fi 总开关 |
| `wifi_ssid` | ASCII 字符串，最多 63 字节 | 空 | 路由器 SSID |
| `wifi_password` | ASCII 字符串，最多 63 字节 | 空 | 路由器密码 |
| `film_api_url` | ASCII 字符串，最多 127 字节 | 空 | Runtime 根地址或 film API |
| `film_heartbeat_url` | ASCII 字符串，最多 127 字节 | 空 | 可选完整心跳 URL |
| `film_device_id` | 最多 31 字节 | 设备派生 ID | 服务端设备 ID |
| `film_token` | 最多 63 字节 | 空 | 服务端首次心跳下发的 token |
| `film_heartbeat_interval` | `5..180` 秒 | `5` | 心跳周期 |

Wi-Fi 密码和设备 token 不应写入日志、截图、文档样例或 Git。BLE 字符串遵循 [协议约束](../blecmd/blecmd_protocol.md)：设置值使用 ASCII 字节并带 `0x00` 结尾；查询响应按长度读取并在客户端自行去除结尾零字节。

## 3. BLE 配置命令

| 通道 | 名称 | 方向 | 数据 |
|---:|---|---|---|
| `0x30` | `WIFI_ENABLE` | 下行 | `uint8`，`0/1` |
| `0x31` | `WIFI_ENABLE_GET` | 上行 | `uint8` |
| `0x32` | `WIFI_SSID` | 下行 | ASCII，最多 63 字节 |
| `0x33` | `WIFI_SSID_GET` | 上行 | ASCII |
| `0x34` | `WIFI_PASSWORD` | 下行 | ASCII，最多 63 字节 |
| `0x35` | `WIFI_PASSWORD_GET` | 上行 | ASCII |
| `0x36` | `FILM_API_URL` | 下行 | ASCII，最多 127 字节 |
| `0x37` | `FILM_API_URL_GET` | 上行 | ASCII |
| `0x38` | `WIFI_CONNECT` | 下行 | 无 |
| `0x39` | `WIFI_DISCONNECT` | 下行 | 无 |
| `0x3A` | `WIFI_CONNECT_GET` | 上行 | `uint8`，`0/1` |
| `0x3B` | `WIFI_CLEAR` | 下行 | 无 |
| `0x3C` | `FILM_DOWNLOAD` | 下行 | 无，立即开始下载 |
| `0x3D` | `FILM_DOWNLOAD_STATE` | 上行 | `[state, progress]` |
| `0x3E` | `FILM_HEARTBEAT_URL` | 下行 | ASCII，最多 127 字节 |
| `0x3F` | `FILM_HEARTBEAT_URL_GET` | 上行 | ASCII |
| `0x40` | `FILM_HEARTBEAT_INTERVAL` | 下行 | `uint8`，`5..180` |
| `0x41` | `FILM_HEARTBEAT_INTERVAL_GET` | 上行 | `uint8` |

命令值已经发布，新增命令从 `0x42` 起，并且必须同步 C、小程序、Web 和协议文档。

## 4. 配网与心跳流程

```text
小程序 / Web                         Penaup                         Runtime
    │                                   │                               │
    │ WIFI_ENABLE(1)                   │                               │
    │ WIFI_SSID / PASSWORD              │                               │
    │ FILM_API_URL                      │                               │
    │ WIFI_CONNECT                      │── STA 连接路由器              │
    │                                   │── GET /heartbeat?device_id… ──>│
    │                                   │<── token / interval / commands │
    │ WIFI_CONNECT_GET                 │                               │
```

服务端首次响应的 JSON 形状：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "server_time": 1780000000,
    "heartbeat_interval": 60,
    "token": "首次注册时才返回",
    "commands": []
  }
}
```

设备会保存非空 token，并把它放入下一次心跳。token 不要放到 URL 日志或调试截图中；当前固件为了兼容既有实现使用 GET 查询参数，生产部署应限制在可信局域网或 HTTPS 反向代理内。

## 5. Runtime 设备接口

新入口是 `server/` 的 Node.js 24 运行时：

### 5.1 心跳

```text
GET /api/v1/device/heartbeat
```

常用查询字段：

| 字段 | 示例 | 说明 |
|---|---|---|
| `device_id` | `A1B2C3` | 必填，设备唯一 ID |
| `token` | `…` | 首次可空，后续必填 |
| `battery` | `87` | `0..100`，未知为 `-1` |
| `voltage_mv` | `4100` | 可选，毫伏 |
| `state` | `idle` | 当前状态 |
| `wifi_connected` | `1` | Wi-Fi 连接标记 |
| `heartbeat_interval` | `60` | `5..180` 秒 |

服务端会自动登记设备、返回待下发命令，并在连续约 3 个心跳周期没有请求时把设备视为离线。

### 5.2 下载最新 film

```text
GET /api/v1/device/film/latest.film?device_id=…&token=…
```

该固定别名选择 Runtime 本地媒体目录中最近上传的 `.film`。也可使用指定文件名接口：

```text
GET /api/v1/device/film/:filename?device_id=…&token=…
```

服务端不会把原始照片自动转成 film；转换应在 Web / 小程序端完成，上传接口只保存已转换的显示帧。

### 5.3 心跳下发命令

Runtime 管理端可以排队以下与固件已实现的命令：

```json
{
  "cmd": "download_film",
  "params": { "url": "http://192.168.1.20:8787/api/v1/device/film/latest.film" }
}
```

固件当前执行 `download_film`、`set_config`、`set_heartbeat`、`sync_time`、`reboot`；未知命令安全忽略。`set_config` 支持播放模式、Wi-Fi、休眠、自动唤醒和 BLE 开关等字段，具体以 `wifi_heartbeat_exec_cmd()` 为准。

## 6. 下载状态

| 值 | 名称 | 含义 |
|---:|---|---|
| `0` | `IDLE` | 没有下载任务 |
| `1` | `DOWNLOADING` | 正在接收 HTTP 数据 |
| `2` | `DONE` | 下载并写入 SD 成功 |
| `3` | `ERROR` | 网络、内存或文件写入失败 |

`0x3D` 响应的数据为两个字节：`state`、`progress`。进度为 `0..100`；未知长度下载可能在完成前保持 `0`。

## 7. MQTT 边界

MQTT 是可选桥，不是照片存储，也不是设备唯一真相：

```text
penaup/device/<device_id>/state   设备 → Runtime
penaup/device/<device_id>/command Runtime → 设备
```

Runtime 只有配置 `PENAUP_MQTT_URL` 才连接 broker。状态 payload 应至少包含 `token`、`battery`、`state` 和 `wifiConnected`；token 校验失败时不能覆盖已有设备状态。照片仍走 HTTP `latest.film`，断开 MQTT 时 HTTP 心跳和 BLE 路径继续工作。

## 8. 固件实现与故障排查

| 层 | 文件 | 责任 |
|---|---|---|
| BLE 命令 | `film_service/src/service_ble.c` | 参数写入、查询和命令分发 |
| Wi-Fi | `film_service/src/service_wifi.c` | STA、HTTP 下载、心跳、命令执行 |
| 参数 | `film_service/src/service_param.c` | NVS 持久化与默认值 |
| 服务启动 | `film_service/src/service_init.c` | 按顺序初始化 Wi-Fi、BLE、文件和监控 |
| Node 运行时 | `server/src/app.js` | 心跳、媒体、命令、事件流 |

排查顺序：

1. 用 `WIFI_ENABLE_GET` 确认开关；
2. 用 `WIFI_CONNECT_GET` 确认 STA 是否拿到连接；
3. 确认 `FILM_API_URL` 不含尾部错误路径，或显式配置完整 `FILM_HEARTBEAT_URL`；
4. 查看 Runtime `/health`、设备列表和最近事件；
5. 再用 `FILM_DOWNLOAD` 触发一次，轮询 `FILM_DOWNLOAD_STATE`；
6. 若返回 401，检查 device token 是否是首次心跳返回并已持久化。

## 9. 安全和资源限制

- 默认 Runtime 只监听 `127.0.0.1`；开放局域网前设置 `PENAUP_ADMIN_TOKEN`，并使用可信网络或 HTTPS；
- 固件下载使用固定大小上限和 SD 文件服务，不要把任意 URL 当成公开代理；
- Wi-Fi 心跳周期保持在 `5..180` 秒，避免无意义唤醒和路由器压力；
- MQTT broker 凭据只放环境变量，不写进仓库；
- 设备 token、Wi-Fi 密码、私有 IP 和原始照片不进入文档、日志或测试夹具。

## 10. 相关文档

- [BLE 完整协议](../blecmd/blecmd_protocol.md)
- [`.film` 格式](../film/film.md)
- [Node Runtime README](../../server/README.md)
- [ADR-0001：轻量 Node Runtime](../adr/0001-penaup-node-runtime.md)
