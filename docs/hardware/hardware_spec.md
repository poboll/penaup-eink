# 花生片 Penaup 硬件规格与启动边界

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

本文是当前固件和仓库资料的硬件地图。标为“当前实现”的内容来自源码；标为“需实测”的内容不能仅凭 PCB、数据手册或渲染图宣称已经量产验证。

## 1. 产品硬件身份

花生片 Penaup 是 ESP32-S3 + 彩色 E6 电子纸 + BLE/Wi-Fi + SD 卡的电子纸拍立得。一个固件工程通过 `sys_cfg.h` 的机型宏和对应 `sdkconfig` 编译三种硬件：

| 用户名称 | 历史编译宏 | `sdkconfig` | EPD | 输入 | Flash / PSRAM |
|---|---|---|---|---|---|
| Penaup / STD | `FRAMEFILM_STD` | `sdkconfig_std` | E6 3.6"，600 × 400，WFT | 旋转编码器 + 按键 | 16 MB / Octal SPI |
| Penaup Pro | `FRAMEFILM_PRO` | `sdkconfig_pro` | E6 3.68"，792 × 528，SE0368-C | 上 / 下 / 确认三按键 | 4 MB / Quad SPI |
| Penaup Max | `FRAMEFILM_MAX` | `sdkconfig_max` | E6 7.09"，固件 1200 × 1600，GDEB0709E01 双面板 | 上 / 下 / 确认三按键 | 16 MB / Octal SPI |

用户-facing 文案使用“花生片 Penaup”。`FrameFilm`、`frame_film` 和 `FRAMEFILM_*` 是旧硬件、NVS 与协议的兼容面，不能因为换品牌就删除。

## 2. 主控与无线

当前实现使用 ESP32-S3，ESP-IDF 版本为 **5.5.2**。固件服务包含：

- BLE GATT 自定义服务，用于本地传输 `.film`、OTA 和设备控制；
- Wi-Fi STA，可选初始化，用于 HTTP 心跳和下载；
- FreeRTOS 任务和队列，服务层不直接碰 GPIO 或 ESP-IDF 外设；
- NVS 参数保存设备、播放、睡眠、Wi-Fi 和 BLE 设置；
- SDMMC 文件服务保存 film 文件。

Wi-Fi、蓝牙共存、天线距离、下载功耗和三机型的射频表现需要在真实 PCB 上复测，不能从 `sdkconfig` 的 `CONFIG_SOC_*_SUPPORTED` 推导量产结论。

## 3. EPD 与显示数据

| 机型 | 固件 EPD 宽 × 高 | 驱动 | SPI / 面板 | Film 主体 |
|---|---:|---|---|---:|
| STD | 600 × 400 | `hal_epd_360.c` | SPI2 四线 | 120,000 B |
| Pro | 792 × 528 | `hal_epd_368.c` | SPI2 四线 | 209,088 B |
| Max | 1200 × 1600 | `hal_epd_709.c` | 双 CS，双面板 | 960,000 B |

EPD 输出使用 4-bit 成对色码：

| 颜色 | 输出色码 |
|---|---:|
| 黑 | `0x00` |
| 白 | `0x11` |
| 黄 | `0x22` |
| 红 | `0x33` |
| 蓝 | `0x55` |
| 绿 | `0x66` |

`.film` 主体并不直接保存这些色码，而是保存 4-bit 索引；固件从头部 `color_table` 查表后再输出。完整格式见 [`docs/film/film.md`](../film/film.md)。

### Max 双面板边界

Max 驱动按 1200 × 1600 的每行数据工作：每行前半部分发送到 `CS0`，后半部分发送到 `CS1`。两个面板必须共享复位、BUSY 和负载开关时序；任一面板初始化或 BUSY 判断失败，都不能宣称全屏刷新成功。

## 4. GPIO 对照表

### 4.1 外设差异

| 外设 | STD | Pro | Max |
|---|---|---|---|
| EPD | `SCK48 / MOSI47`, `CS14 / DC13 / RST12 / BUSY11`，SPI2 四线 | 同 STD | `SCK9 / SDIN41 / SDIO40`, `CS0=18 / CS1=17 / RST6 / BUSY7`，无 DC，`LOAD_SW45` |
| TF 卡 | `CLK40 / CMD41 / D0-3=39/38/2/42`, `DET45` | 同 STD | `CLK8 / CMD3 / D0-3=5/4/16/15`，无检测 |
| 输入 | 编码器 A=`6`、B=`4`、确认键=`5` | 上=`4`、下=`6`、确认=`5`，低有效 | 上=`12`、下=`14`、确认=`13`，高有效 |
| 唤醒 | GPIO5，低电平 | GPIO5，低电平 | GPIO13，高电平 |
| RGB LED | WS2812，GPIO17 | WS2812，GPIO17 | 无 |
| 电池 | ADC 使能 GPIO8，ADC_CH0 GPIO1 | 同 STD | 无电池检测 |
| 外设供电 | GPIO21 | GPIO21 | 无 |

这些引脚来自当前工程的机型约束。若 PCB 修订改变引脚，应同时更新 HAL、`sys_cfg.h`、sdkconfig、原理图和本文，不能只改一张表。

### 4.2 输入电平

- STD 编码器按旋转方向产生事件，确认键和唤醒使用低电平语义；
- Pro 按键为低有效；
- Max 按键和唤醒为高有效；
- 去抖、长按和休眠唤醒由 `film_hal` / `film_service` 处理，应用层不得直接读取 GPIO。

## 5. 存储与电源

### SD / 文件

SD 卡保存 `.film` 文件和本地播放索引。BLE `0x2B` 可请求格式化，属于不可逆操作；UI 必须二次确认并显示明确的“会清空设备内容”文案。下载和 BLE 写入要避免同时操作同一文件，保存流程统一走 `service_file`。

### 电池

STD/Pro 通过 HAL 读取电池 ADC 并以百分比响应 BLE `0x23`；Max 当前没有电池检测引脚。电量百分比是估算值，不应当作为精确电压或剩余时间承诺。

### 低功耗

休眠、自动唤醒和唤醒间隔由设备控制命令管理：

- 休眠开关：`0x25/0x26`；
- 自动唤醒：`0x27/0x28`；
- 唤醒间隔：`0x29/0x2A`，固件限制为 10 分钟至 48 小时。

EPD 在显示后可以保持静态画面而不持续刷新；刷新波形、写屏峰值电流、Wi-Fi 心跳功耗和电池续航必须通过样机测试记录。

## 6. 启动顺序

当前固件入口为 `main/main.c`，服务初始化遵循：

```text
app_main
  ↓
film_sys_init
  ↓
film_hal_init（EPD / SD / 输入 / LED 等 HAL）
  ↓
service_param_init（NVS 参数）
  ↓
service_wifi_init（仅在参数开启时真正启动）
  ↓
service_ble_init
  ↓
service_monitor_init
  ↓
service_file_init
  ↓
service_film_init
```

启动检查重点：

1. 三个机型宏之和必须为 1；
2. 宏与复制的 sdkconfig 必须属于同一机型；
3. EPD RST、BUSY、CS/DC 或双 CS 时序必须完成；
4. SD 初始化失败不能让 BLE 服务悄悄宣称文件已保存；
5. Max 需分别验证 CS0、CS1、LOAD_SW 和双面板全刷；
6. 进入休眠前停止不必要的网络任务，唤醒后重新确认设备状态。

## 7. 构建矩阵

每次发布至少执行三次干净构建：

```bash
cd firmware/penaup

cp sdkconfig_std sdkconfig
# sys_cfg.h 只打开 FRAMEFILM_STD
idf.py build

cp sdkconfig_pro sdkconfig
# sys_cfg.h 只打开 FRAMEFILM_PRO
idf.py build

cp sdkconfig_max sdkconfig
# sys_cfg.h 只打开 FRAMEFILM_MAX
idf.py build
```

刷写前还应核对 `sdkconfig` 没有把上一次机型的缓存带入；必要时用独立构建目录或清理后重新配置。`idf.py flash monitor` 只在确认端口和目标板之后执行。

## 8. 资料与证据边界

- `docs/datasheet/`：厂商数据手册，仅作为设计依据；
- `hardware/pcb/`：原理图 PDF 和历史板卡资料；
- `hardware/model/`：外壳、面板和机械工程；
- `assets/pic/model/`：展示渲染图，不是尺寸或性能证明；
- 本文的“当前实现”来自源码静态核对，刷新质量、功耗、无线距离和结构强度仍需样机验收。

第三方数据手册、厂商示例、EDA 工程和外包交付材料保留原始许可与合同边界，不因仓库品牌改成 Penaup 或版权头改成 `poboll` 而自动转移权利。
