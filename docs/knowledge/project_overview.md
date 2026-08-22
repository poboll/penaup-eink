# Penaup 项目总览

> 供 Codex、OpenCode 和维护者使用的全局地图。产品展示名是“花生片 Penaup”，历史目录和协议兼容名仍可能出现 FrameFilm。

## 产品事实

花生片是一台 ESP32-S3 彩色电子纸拍立得：手机选择或拍摄照片，端侧生成 `.film`，通过 BLE 直接传输；支持网络能力的设备可以通过 Wi-Fi 向轻量服务端拉取文件。电子纸的价值是低静态功耗、户外可读和画面能够长期保留。

## 三个端

| 端 | 技术 | 主要职责 |
|---|---|---|
| 固件 | C / ESP-IDF 5.5.2 | EPD、输入、电池、SD、BLE、Wi-Fi、OTA |
| 微信小程序 | ES5 JavaScript / WXML / WXSS | 手机相册、相机、模板、BLE 发送 |
| Web 工具 | ES6 / HTML / CSS / Web Bluetooth | 桌面端预览、转换、设备管理、OTA |

## 固件分层

```text
film_service  ->  film_hal  ->  film_sys  ->  ESP-IDF
```

服务层负责 BLE 命令、文件传输、播放、参数和 Wi-Fi；硬件层负责 EPD、SD、LED、输入和电池；系统层负责启动、配置和日志。服务层禁止直接调用 GPIO 或 ESP-IDF driver。

## 关键文件

| 工作 | 文件 |
|---|---|
| 机型宏 | `firmware/penaup/components/film_sys/inc/sys_cfg.h` |
| BLE 命令 | `firmware/penaup/components/film_service/inc/service_ble.h` |
| Wi-Fi 心跳 | `firmware/penaup/components/film_service/src/service_wifi.c` |
| film 颜色 | `firmware/penaup/components/film_hal/inc/hal_epd.h` |
| Web BLE | `apps/web/js/frame.js`、`bluetooth.js` |
| 小程序 BLE | `apps/wechat/miniprogram/utils/ble-utils.js` |
| 小程序 film | `apps/wechat/miniprogram/utils/film-utils.js` |
| 新服务端 | `server/src/` |

## 不能破坏的事实

- `BLE_CHUNK_SIZE = 192`；
- 帧头 `0x55`，校验和为包内字节之和低八位；
- film 文件为 32 字节头加半字节像素；
- 六色编码为黑 `0x00`、白 `0x11`、绿 `0x66`、蓝 `0x55`、红 `0x33`、黄 `0x22`；
- 新命令从 `0x3E` 起；
- 三机型宏与 `sdkconfig_std/pro/max` 必须成对验证。
