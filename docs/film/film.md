# 花生片 Penaup `.film` 文件格式

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

本文描述固件当前读取的 `.film` 二进制格式。`.film` 是已经完成裁切、六色量化和像素打包的显示帧；手机和 Web 工具在本地生成它，设备端只负责校验、解码和刷新电子纸。

## 1. 格式概览

文件由固定 32 字节头和像素主体组成：

```text
┌──────────────────────────────┐
│ header · 32 bytes            │
├──────────────────────────────┤
│ packed pixels · width×height/2 │
└──────────────────────────────┘
```

每个像素使用一个 4-bit 调色板索引，因此一个字节存两个像素。所有多字节整数均为小端序；这与 BLE 的文件长度字段（大端序）不同，不能混用。

### 当前三机型尺寸

| 用户-facing 机型 | 视觉创作画布 | 文件头宽 × 高 | 像素主体 | 完整文件 | 像素布局 |
|---|---:|---:|---:|---:|---|
| 花生片 Penaup / STD | 400 × 600 竖向 | 600 × 400 | 120,000 B | 120,032 B | 视觉转协议后列优先并翻转 |
| 花生片 Penaup Pro | 528 × 792 竖向 | 792 × 528 | 209,088 B | 209,120 B | 视觉转协议后行优先 |
| 花生片 Penaup Max | 1,200 × 1,600 竖向 | 1,200 × 1,600 | 960,000 B | 960,032 B | 行优先，双面板分半发送 |

Max 的外形描述可以使用“1600 × 1200 竖向屏幕”，但固件 `EPD_WIDTH/EPD_HEIGHT` 和 `.film` 头使用 `1200 × 1600`；生成器应以文件头约定为准。

## 2. 32 字节文件头

| 偏移 | 长度 | 字段 | 类型 | 当前含义 |
|---:|---:|---|---|---|
| `0x00` | 4 | `file_size` | `uint32_le` | 像素主体字节数，不含头 |
| `0x04` | 2 | `screen_width` | `uint16_le` | 文件目标宽度 |
| `0x06` | 2 | `screen_height` | `uint16_le` | 文件目标高度 |
| `0x08` | 1 | `color_count` | `uint8` | 当前为 `6`，固件接受 `2..6` |
| `0x09` | 7 | `reserved` | bytes | 当前填 `0x00`，不得写入业务数据 |
| `0x10` | 16 | `color_table` | bytes | 4-bit 索引到 film 颜色值的映射 |

### 2.1 `file_size`

`file_size` 必须等于 `screen_width × screen_height / 2`，完整文件长度必须等于 `32 + file_size`。三种当前值为：

```text
STD  = 0x0001D4C0 = 120000
Pro  = 0x000330C0 = 209088
Max  = 0x000EA600 = 960000
```

对应固件会再次按编译时 EPD 尺寸校验主体长度；尺寸错配不会刷新。

### 2.2 `color_table`

当前生成器写入前 6 个表项，其余 10 个字节为 `0x00`：

| 调色板索引 | 头部值 | 颜色 | EPD 输出色码 |
|---:|---:|---|---:|
| `0` | `0x00` | 黑 | `0x00` |
| `1` | `0xFF` | 白 | `0x11` |
| `2` | `0xFC` | 黄 | `0x22` |
| `3` | `0xE0` | 红 | `0x33` |
| `4` | `0x03` | 蓝 | `0x55` |
| `5` | `0x1C` | 绿 | `0x66` |

这里有两套故意分开的编码：文件主体存的是 `0..5` 的索引，固件 HAL 再依据 `color_table` 转成屏幕的 `0x00/0x11/0x22/0x33/0x55/0x66`。不要把 `0x66` 直接当成主体中的一个 4-bit 像素值。

### 2.3 六色基底与 48 种显影观感

六色色表是文件格式的兼容边界，不是创作端的色彩表达上限。Web、小程序或未来 iOS 可以在生成 `.film` 前使用相邻像素叠色、网点和抖动，把黑、白、红、黄、蓝、绿六种基础颜料组合成 48 种显影色彩观感。这里的“48 色”描述的是空间组合后的显示结果，不代表新增 42 个固件色码；主体仍然只能写入 `0..5` 的六色索引，固件协议和 EPD 输出色码不变。

## 3. 像素主体

主体从偏移 `0x20` 开始，按字节连续存放：

```text
byte = (pixel_even << 4) | pixel_odd
```

例如两个像素索引 `[3, 5]` 写成 `0x35`。屏幕像素总数均为偶数，因此不需要行尾填充。超出调色板 `0..5` 的索引没有定义，解析器应拒绝或显示为白色，而不能猜测颜色。

### 3.1 像素坐标

用户创作画布与文件主体的坐标转换由机型配置决定。STD 和 Pro 的视觉画布都是竖向，只有在打包 `.film` 时才旋转到历史文件头方向；Max 的视觉和协议同向：

- STD：视觉 `(x, y)` 先映射到协议 `(screen_x, screen_y) = (y, 399 - x)`，再使用固件兼容的列优先翻转索引；
- Pro：视觉 `(x, y)` 先映射到协议 `(screen_x, screen_y) = (y, 527 - x)`，再使用行优先索引 `(screen_y × 792) + screen_x`；
- Max：直接使用行优先，固件把每行前半发送给 CS0、后半发送给 CS1。

因此 Web 和微信小程序的 Pro Canvas 应始终创建为 `528 × 792`，而 `.film` 头仍必须写 `792 × 528`。`packages/film-core` 的 `canvasPixelIndex()` 是跨端唯一适配入口，不能在端内重新实现一套旋转公式。

因此，不能用 STD 的缩略图布局去解释 Pro 或 Max 的主体数据。预览解码应读取头部尺寸，并采用同一机型的 `pixel_layout`。

## 4. 解析与验证顺序

实现一个新的 `.film` 读写器时，按下面顺序验证：

1. 文件至少有 32 字节；
2. 按小端序读取 `file_size/width/height`；
3. 检查 `color_count` 在 `2..6`；
4. 检查实际文件长度为 `32 + file_size`；
5. 检查尺寸属于已知机型，或由调用方显式提供目标机型；
6. 检查主体字节数与目标 EPD 的编译尺寸一致；
7. 逐字节拆分高、低 nibble，使用 `color_table[index]` 查表；
8. 按机型布局恢复预览或写入 EPD。

不应通过直接把二进制缓冲区强转为 C 结构体来读取多字节字段；使用 `memcpy` 或显式小端序解析更安全，也便于在非 ESP32 工具上复用。

## 5. 最小读写示例

### 5.1 JavaScript 生成头部

```js
function writeFilmHeader(width, height) {
  const bodySize = (width * height) / 2;
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  view.setUint32(0, bodySize, true);
  view.setUint16(4, width, true);
  view.setUint16(6, height, true);
  header[8] = 6;
  header.set([0x00, 0xff, 0xfc, 0xe0, 0x03, 0x1c], 0x10);
  return header;
}
```

### 5.2 C 语言按小端序读取

```c
uint32_t file_size;
uint16_t width;
uint16_t height;

memcpy(&file_size, film + 0x00, sizeof(file_size));
memcpy(&width,     film + 0x04, sizeof(width));
memcpy(&height,    film + 0x06, sizeof(height));

if (file_size != ((uint32_t)width * height) / 2) {
    return ESP_ERR_INVALID_SIZE;
}
```

固件的具体 EPD 解析与刷新实现位于：

- `firmware/penaup/components/film_hal/src/hal_epd_360.c`
- `firmware/penaup/components/film_hal/src/hal_epd_368.c`
- `firmware/penaup/components/film_hal/src/hal_epd_709.c`

## 6. 跨端实现位置

| 端 | 文件 | 作用 |
|---|---|---|
| 固件 | `film_hal/src/hal_epd_*.c` | 校验头、查色表、刷新 EPD |
| Web | `apps/web/js/utils.js`、`js/convert.js` | 裁切、量化、打包、预览 |
| 小程序 | `utils/film-utils.js` | 本地转换、缩略图和回显 |
| 文档 | 本文 | 规范与回归依据 |

修改颜色、尺寸或像素布局时，必须同时更新三端和测试样例。BLE 文件传输的长度字段是另一个协议层，见 [BLE 协议](../blecmd/blecmd_protocol.md)。

## 7. 版本与兼容

当前格式没有独立 magic number 或版本字段，兼容性依赖固定头布局、尺寸和色表。因此：

- 不要改变头部字段偏移；
- 不要把 `color_table` 改成网络字节序；
- 不要在 `reserved` 写入未同步的新语义；
- 新格式若需要破坏兼容，应新增文件扩展名或在协议层增加明确版本协商。

历史名称 `FrameFilm` 仍可能出现在旧文件名和旧设备中，但不改变 `.film` 的二进制格式。

## 8. 版权与第三方边界

本文和本仓库新增实现按根目录 `LICENSE` 的 Poboll Non-Commercial License v1.0 提供。屏幕数据手册、厂商示例驱动、外包交付代码和第三方依赖不因本文重写而自动变成 `poboll` 的独占版权；发布前请以 [provenance.md](../legal/provenance.md) 和合同/许可记录为准。
