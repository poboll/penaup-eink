# Penaup 固件

花生片 Penaup 固件使用 ESP-IDF v5.5.2，统一源码通过机型宏编译 STD、Pro、Max 三种硬件。

## 编译前检查

1. 复制对应的 `sdkconfig_std`、`sdkconfig_pro` 或 `sdkconfig_max` 为 `sdkconfig`；
2. 在 `components/film_sys/inc/sys_cfg.h` 只启用一个 `FRAMEFILM_*` 宏；
3. 确认屏幕驱动、输入和 SD/电池/LED 引脚与机型一致；
4. 构建后检查设备广播名和 BLE 兼容行为。

仓库根目录的 `npm run firmware:build:matrix` 会在系统临时目录复制源码，自动配对三套 `sdkconfig_*` 与机型宏，适合发布前做干净构建；它不会修改本目录的 `sdkconfig` 或 `sys_cfg.h`。

```bash
cd firmware/penaup
cp sdkconfig_pro sdkconfig
idf.py build
idf.py flash monitor
```

## 分层

- `film_sys`：系统启动、配置和日志；
- `film_hal`：EPD、SD、电池、电源、LED、编码器和按键；
- `film_service`：BLE、film 文件、播放、参数、OTA、Wi-Fi。

`FrameFilm` 宏和旧 BLE 名称属于兼容层，不要因为改品牌就擅自修改 BLE 命令值、NVS key 或 film 颜色编码。硬件功能声称必须有对应的实测或数据手册证据。
