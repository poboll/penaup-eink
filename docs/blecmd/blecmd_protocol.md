# 花生片 Penaup BLE 通信协议

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

这是花生片 Penaup 当前固件、Web 工具和微信小程序共同使用的 BLE GATT 协议。命令值已经被设备和历史客户端使用；除非新增命令，否则不得重排或改值。

## 1. GATT 入口

| 项目 | 值 |
|---|---|
| Service UUID | `00002000-0000-1000-8000-00805f9b34fb` |
| Characteristic UUID | `00002001-0000-1000-8000-00805f9b34fb` |
| 设备名称 | `PENAUP` / `PENAUPPRO` / `PENAUPMAX` |
| 历史名称 | `FRAMEFILM` / `FRAMEFILMPRO` / `FRAMEFILMMAX` |
| 帧头 | `0x55` |
| 客户端 film 数据块 | `192` B |

Web Bluetooth 和微信小程序都应同时接受 `PENAUP*` 与 `FRAMEFILM*`，但新 UI 只显示“花生片 Penaup”。

## 2. 帧结构

每次写入或通知都是一帧：

```text
┌──────┬────┬─────┬──────────────┬─────┐
│ HEAD │ CH │ LEN │ DATA[LEN]    │ SUM │
│ 1 B  │1 B │1 B  │ 0..255 B     │1 B  │
└──────┴────┴─────┴──────────────┴─────┘
```

`LEN` 只表示 `DATA` 长度，整帧长度为 `LEN + 4`。校验和计算整帧中除 `SUM` 外的所有字节：

```text
SUM = (HEAD + CH + LEN + DATA[0] + ... + DATA[LEN-1]) & 0xFF
```

固件收到数据后先检查帧头、长度和校验和，再把 `CH/LEN/DATA` 交给服务层。无效帧应丢弃，不得执行命令。

### 2.1 字节序与字符串

- `uint8` 按单字节传输；
- 文件长度和睡眠时间使用大端序；
- `.film` 文件内部的头部整数使用小端序，见 [film 格式](../film/film.md)；
- BLE 设置类字符串使用 ASCII 字节并带结尾 `0x00`，不能直接发送中文或 UTF-8 多字节文本；
- 查询类字符串的当前固件响应按实际字符串长度返回，客户端应按 `LEN` 读取并去掉可能的 `0x00`；
- `FILE_NAME` 也应使用 ASCII 文件名，例如 `shot_01.film`。

### 2.2 客户端节奏

三端当前公共常量：

```text
BLE_CMD_HEAD  = 0x55
BLE_CHUNK_SIZE = 192   // FILE_DATA / OTA_DATA 的 DATA 长度
BLE_CTRL_DELAY = 50ms  // 小程序控制命令间隔
BLE_DATA_DELAY = 2ms   // 小程序数据包间隔
```

`192` 是 DATA 大小，不是整帧大小；整帧最多比它多 4 字节。实际 MTU、平台写入限制和错误重试仍应以连接协商结果为准。

## 3. 命令总表

方向：`↓` 表示客户端写入设备，`↑` 表示设备通知客户端。

### 3.1 文件传输与管理（`0x00..0x08`）

| CH | 名称 | 方向 | DATA |
|---:|---|:---:|---|
| `0x00` | `FILE_NAME` | ↓ | ASCII 文件名（含 `0x00`） |
| `0x01` | `FILE_LEN` | ↓ | `uint32_be`，完整 `.film` 文件长度 |
| `0x02` | `FILE_DATA` | ↓ | 原始文件数据块 |
| `0x03` | `FILE_START` | ↓ | 空 |
| `0x04` | `FILE_STOP` | ↓ | 空，或 `01` 静默保存 |
| `0x05` | `FILE_DELETE` | ↓ | 文件 ID，`uint8` |
| `0x06` | `FILE_LIST` | ↑ / ↓ | 下行空；上行文件项 |
| `0x07` | `FILE_DISPLAY` | ↓ | 文件 ID，`uint8` |
| `0x08` | `FILE_DISPLAY_GET` | ↑ / ↓ | 下行空；上行当前 ID |

### 3.2 OTA（`0x10..0x13`）

| CH | 名称 | 方向 | DATA |
|---:|---|:---:|---|
| `0x10` | `OTA_LEN` | ↓ | `uint32_be`，固件长度；同时启动 OTA |
| `0x11` | `OTA_DATA` | ↓ | 固件数据块 |
| `0x12` | `OTA_START` | ↓ | 空，允许无长度启动 |
| `0x13` | `OTA_STOP` | ↓ | 空，结束并交给 OTA 服务验证 |

### 3.3 设备控制（`0x20..0x2B`）

| CH | 名称 | 方向 | DATA |
|---:|---|:---:|---|
| `0x20` | `CTRL_MODE` | ↓ | `0` 手动、`1` 本地轮播、`2` Wi-Fi 轮播 |
| `0x21` | `CTRL_MODE_GET` | ↑ / ↓ | 上行当前模式 |
| `0x22` | `CTRL_RESET` | ↓ | 空，恢复出厂并重启 |
| `0x23` | `CTRL_PWRREAD` | ↑ / ↓ | 上行 `0..100` 电量百分比 |
| `0x24` | `CTRL_REBOOT` | ↓ | 空，重启 |
| `0x25` | `CTRL_SLEEPONOFF` | ↓ | 休眠开关 `0/1` |
| `0x26` | `CTRL_SLEEPONOFF_GET` | ↑ / ↓ | 上行 `0/1` |
| `0x27` | `CTRL_SLEEPMODE` | ↓ | 自动唤醒开关 `0/1` |
| `0x28` | `CTRL_SLEEPMODE_GET` | ↑ / ↓ | 上行 `0/1` |
| `0x29` | `CTRL_SLEEPMODE_TIME` | ↓ | `uint16_be`，分钟，`10..2880` |
| `0x2A` | `CTRL_SLEEPMODE_TIME_GET` | ↑ / ↓ | 上行 `uint16_be` |
| `0x2B` | `CTRL_SDRESET` | ↑ / ↓ | 下行空；上行 `0` 成功、`1` 失败 |

### 3.4 Wi-Fi、下载与心跳（`0x30..0x41`）

| CH | 名称 | 方向 | DATA |
|---:|---|:---:|---|
| `0x30` | `WIFI_ENABLE` | ↓ | `0/1` |
| `0x31` | `WIFI_ENABLE_GET` | ↑ / ↓ | 上行 `0/1` |
| `0x32` | `WIFI_SSID` | ↓ | ASCII，最多 63 字节 |
| `0x33` | `WIFI_SSID_GET` | ↑ / ↓ | ASCII |
| `0x34` | `WIFI_PASSWORD` | ↓ | ASCII，最多 63 字节 |
| `0x35` | `WIFI_PASSWORD_GET` | ↑ / ↓ | ASCII |
| `0x36` | `FILM_API_URL` | ↓ | ASCII，最多 127 字节 |
| `0x37` | `FILM_API_URL_GET` | ↑ / ↓ | ASCII |
| `0x38` | `WIFI_CONNECT` | ↓ | 空 |
| `0x39` | `WIFI_DISCONNECT` | ↓ | 空 |
| `0x3A` | `WIFI_CONNECT_GET` | ↑ / ↓ | 上行 `0/1` |
| `0x3B` | `WIFI_CLEAR` | ↓ | 空 |
| `0x3C` | `FILM_DOWNLOAD` | ↓ | 空，触发下载 |
| `0x3D` | `FILM_DOWNLOAD_STATE` | ↑ / ↓ | 上行 `[state, progress]` |
| `0x3E` | `FILM_HEARTBEAT_URL` | ↓ | ASCII，最多 127 字节 |
| `0x3F` | `FILM_HEARTBEAT_URL_GET` | ↑ / ↓ | ASCII |
| `0x40` | `FILM_HEARTBEAT_INTERVAL` | ↓ | `uint8`，`5..180` 秒 |
| `0x41` | `FILM_HEARTBEAT_INTERVAL_GET` | ↑ / ↓ | `uint8` |

新增命令从 `0x42` 起。已经发布的值不能被重用。

## 4. FILM 传输

### 4.1 正常流程

```text
FILE_START → FILE_NAME → FILE_LEN → FILE_DATA × N → FILE_STOP
```

`FILE_LEN` 是完整文件长度，包括 32 字节头；例如 STD 的 `.film` 应发送 `120032`。设备在 `FILE_LEN` 后创建保存任务，在每个 `FILE_DATA` 后累计接收字节，在 `FILE_STOP` 后完成保存。

### 4.2 静默保存

批量上传时，`FILE_STOP` 可以使用 `DATA=[0x01]`：

```text
55 04 01 01 5B
```

这表示保存文件但不自动刷新 EPD。所有文件发送完成后，再发送 `FILE_DISPLAY` 显示目标文件，避免每一张都触发全屏刷新。空 DATA 的旧流程仍表示保存并自动加载。

### 4.3 状态约束

```text
IDLE / STOPPED
       │ FILE_START
       ▼
STARTED ── FILE_NAME ──> RECV_NAME
                              │ FILE_LEN
                              ▼
                         RECV_LEN
                              │ FILE_DATA × N
                              ▼
                         RECV_DATA ── FILE_STOP ──> STOPPED
```

乱序命令会被忽略并写入固件日志。客户端失败重试时应从 `FILE_START` 重新开始，不要在未知状态中盲目补发数据块。

### 4.4 文件列表响应

下行发送空 DATA 的 `0x06` 后，设备对每个文件发送一帧 `0x06`：

```text
DATA = [FILE_ID, NAME_LEN, NAME_BYTES...]
```

其中 `NAME_LEN` 包含文件名末尾 `0x00`。客户端应按 `LEN` 做边界检查，不要相信文件名内容或把它拼接为本地路径。

## 5. OTA

推荐流程：

```text
OTA_LEN → OTA_DATA × N → OTA_STOP
```

`OTA_LEN` 会设置固件长度并调用 OTA start。兼容旧客户端也支持：

```text
OTA_START → OTA_DATA × N → OTA_STOP
```

无长度流程无法在协议层校验完整大小，只有在底层 OTA 服务允许时才使用。OTA 期间不得断电、切换设备或发送 film 命令；`OTA_STOP` 后设备可能重启，客户端必须等待重新广播。

## 6. 设备控制响应

查询类命令的响应继续使用相同帧格式，响应 `CH` 等于请求 `CH`：

```text
// CTRL_PWRREAD，电量 87%
55 23 01 57 D0

// CTRL_SLEEPMODE_TIME_GET，返回 60 分钟
55 2A 02 00 3C BD
```

控制命令可能引起重启、格式化或 EPD 刷新。UI 必须在发送前解释影响，并在发送后显示“设备可能暂时无响应”的状态。

## 7. Wi-Fi 状态与下载

`0x3D` 返回两个 DATA 字节：

| `state` | 含义 |
|---:|---|
| `0` | `IDLE` |
| `1` | `DOWNLOADING` |
| `2` | `DONE` |
| `3` | `ERROR` |

`progress` 为 `0..100`。Wi-Fi 心跳、HTTP 下载、token 和命令 JSON 的完整约定见 [Wi-Fi 文档](../wifi/wifi_doc.md)。

## 8. 校验和实现

### JavaScript

```js
function checksum(bytes, length = bytes.length) {
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += bytes[i];
  return sum & 0xff;
}
```

### C

```c
static uint8_t ble_checksum(uint8_t *bytes, int length)
{
    uint8_t sum = 0;
    for (int i = 0; i < length; i++) sum += bytes[i];
    return sum;
}
```

构造 `SUM` 时传入的长度必须是整帧长度减 1；校验时也必须包含 `HEAD`、`CH` 和 `LEN`。

## 9. 跨端实现清单

| 端 | 文件 | 约束 |
|---|---|---|
| C 固件 | `firmware/penaup/components/film_service/inc/service_ble.h` | 命令常量唯一来源之一；不要改值 |
| C 固件 | `.../src/service_ble.c` | 状态机、数据校验和命令处理 |
| 微信小程序 | `apps/wechat/miniprogram/utils/ble-utils.js` | ES5/小程序兼容封装 |
| Web | `apps/web/js/bluetooth.js`、`js/frame.js` | Web Bluetooth 发送与状态 |
| 文档 | 本文 | 每次命令变更必须同步 |

修改命令时按以下顺序验收：

1. 先在 C 头文件定义未占用的 `0x42+`；
2. 在固件 `switch` 中处理无效长度、状态和校验；
3. 同步小程序和 Web 常量、构造、解析；
4. 更新本文和 `docs/knowledge/ble_commands.md`；
5. 做一个 C/JS/小程序一致的十六进制夹具测试；
6. 再做真实设备的写入、通知、断连和重连验证。

## 10. 版权与兼容边界

协议实现和本文的新增部分按根目录 `LICENSE` 的 Poboll Non-Commercial License v1.0 提供。历史 `FrameFilm` 命令值、外包代码和第三方 BLE 示例的权利范围仍以原合同和原许可为准；改名不等于权利转让。详情见 [provenance.md](../legal/provenance.md)。
