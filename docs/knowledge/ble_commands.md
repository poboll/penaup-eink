# 花生片 Penaup BLE 命令速查

> Copyright (c) 2026 poboll
> 本表是开发速查，完整语义以 [`docs/blecmd/blecmd_protocol.md`](../blecmd/blecmd_protocol.md) 为准。

## 包格式

```text
55 CH LEN DATA... SUM
SUM = (所有除 SUM 外的字节之和) & 0xFF
```

```text
BLE_CMD_HEAD = 0x55
BLE_CHUNK_SIZE = 192
BLE_CTRL_DELAY = 50ms
BLE_DATA_DELAY = 2ms
```

文件长度和睡眠时间使用 Big-Endian；字符串设置值为 ASCII + `0x00`。`.film` 内部头部仍是 Little-Endian。

## 文件传输 / 管理

| CH | 常量 | 方向 | DATA |
|---:|---|---|---|
| `0x00` | `FILE_NAME` | ↓ | ASCII 文件名 + NUL |
| `0x01` | `FILE_LEN` | ↓ | `uint32_be`，完整文件长度 |
| `0x02` | `FILE_DATA` | ↓ | 数据块 |
| `0x03` | `FILE_START` | ↓ | 空 |
| `0x04` | `FILE_STOP` | ↓ | 空；`01` 为静默保存 |
| `0x05` | `FILE_DELETE` | ↓ | 文件 ID |
| `0x06` | `FILE_LIST` | ↑/↓ | 下行空；上行 `[id,nameLen,name]` |
| `0x07` | `FILE_DISPLAY` | ↓ | 文件 ID |
| `0x08` | `FILE_DISPLAY_GET` | ↑/↓ | 上行当前文件 ID |

流程：`START → NAME → LEN → DATA×N → STOP`。

## OTA

| CH | 常量 | DATA |
|---:|---|---|
| `0x10` | `OTA_LEN` | `uint32_be` |
| `0x11` | `OTA_DATA` | 固件数据块 |
| `0x12` | `OTA_START` | 空，可无长度启动 |
| `0x13` | `OTA_STOP` | 空 |

优先使用 `OTA_LEN → OTA_DATA×N → OTA_STOP`。

## 设备控制

| CH | 常量 | DATA |
|---:|---|---|
| `0x20` | `CTRL_MODE` | `0` 手动 / `1` 本地轮播 / `2` Wi-Fi 轮播 |
| `0x21` | `CTRL_MODE_GET` | 返回模式 |
| `0x22` | `CTRL_RESET` | 恢复出厂并重启 |
| `0x23` | `CTRL_PWRREAD` | 返回电量 `0..100` |
| `0x24` | `CTRL_REBOOT` | 重启 |
| `0x25/0x26` | `SLEEPONOFF(_GET)` | 休眠开关 |
| `0x27/0x28` | `SLEEPMODE(_GET)` | 自动唤醒开关 |
| `0x29/0x2A` | `SLEEPMODE_TIME(_GET)` | `uint16_be`，分钟 |
| `0x2B` | `CTRL_SDRESET` | SD 格式化；返回 `0/1` |

## Wi-Fi、下载与心跳

| CH | 常量 | DATA |
|---:|---|---|
| `0x30/0x31` | `WIFI_ENABLE(_GET)` | `0/1` |
| `0x32/0x33` | `WIFI_SSID(_GET)` | ASCII |
| `0x34/0x35` | `WIFI_PASSWORD(_GET)` | ASCII |
| `0x36/0x37` | `FILM_API_URL(_GET)` | ASCII |
| `0x38` | `WIFI_CONNECT` | 空 |
| `0x39` | `WIFI_DISCONNECT` | 空 |
| `0x3A` | `WIFI_CONNECT_GET` | 返回 `0/1` |
| `0x3B` | `WIFI_CLEAR` | 空 |
| `0x3C` | `FILM_DOWNLOAD` | 空 |
| `0x3D` | `FILM_DOWNLOAD_STATE` | `[state,progress]` |
| `0x3E/0x3F` | `FILM_HEARTBEAT_URL(_GET)` | ASCII |
| `0x40/0x41` | `FILM_HEARTBEAT_INTERVAL(_GET)` | `uint8`，`5..180` 秒 |

下载状态：`0 IDLE`、`1 DOWNLOADING`、`2 DONE`、`3 ERROR`。

## 三端代码位置

| 端 | 文件 |
|---|---|
| 固件 | `firmware/penaup/components/film_service/inc/service_ble.h` |
| 小程序 | `apps/wechat/miniprogram/utils/ble-utils.js` |
| Web | `apps/web/js/bluetooth.js`、`js/frame.js` |
| 规范 | `docs/blecmd/blecmd_protocol.md` |

修改命令值前必须先检查三端和历史设备兼容；已占用的值不能复用，新增命令从 `0x42` 起。
