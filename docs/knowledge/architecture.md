# Penaup 架构设计

> Copyright (c) 2026 poboll · 当前部署架构。`FrameFilm / film-hub` 仅作为旧硬件、旧协议和迁移资料中的兼容名。

花生片 Penaup 采用“端侧优先、单体运行时、可选事件桥”的结构。照片在手机或桌面 Web 端转换为 `.film`，BLE 直连是最短路径；只有支持 Wi-Fi 的设备才需要访问 Runtime。

## 跨端数据流

```text
小程序 / Web 工具 -- 本地六色转换 + BLE --> Penaup 设备
                                      |
                         Wi-Fi 心跳 + latest.film
                                      v
                         Node.js 24 + Fastify
                           | SQLite WAL / 本地媒体
                           +-- 可选 MQTT 状态桥
                           +-- SSE /admin 管理端
```

Runtime 不保存原始照片，不承担 BLE 分包，也不要求 Redis、PostgreSQL 或必须在线的 MQTT broker。MQTT 只承载 Wi-Fi 设备状态和指令，不替代 HTTP 心跳。

## 运行时边界

| 层 | 当前职责 | 不应承担 |
|---|---|---|
| 端侧 | 裁剪、六色映射、抖动、BLE 分包、EPD 刷新 | 把原始照片上传到服务端 |
| `server/src` | 设备注册/心跳、token、媒体索引、命令队列、SSE | 模板大平台、用户账号体系、照片云存储 |
| SQLite + 文件 | 设备/事件/媒体元数据与 `.film` 文件 | MQTT 消息持久化 |
| MQTT bridge | Wi-Fi 状态和命令转发 | 图片传输与唯一状态来源 |
| `legacy/fastapi` | 旧 FastAPI 迁移参考 | 新部署入口 |

## 固件三层

```text
film_service → film_hal → film_sys → ESP-IDF
  服务层        硬件层       系统层
```

服务层只编排 BLE、文件、播放、OTA、监控和 Wi-Fi；GPIO、SPI、SD、LED、电池、EPD 和按键全部经 `film_hal`；系统层负责初始化、配置、日志与错误。新代码不得反向依赖上层，也不得在 service 层直接调用 ESP-IDF driver。

## 三机型编译边界

统一源码位于 `firmware/penaup/`，由 `sys_cfg.h` 与对应 `sdkconfig` 选择 `FRAMEFILM_STD`、`FRAMEFILM_PRO` 或 `FRAMEFILM_MAX`。EPD、输入、SD、电源和 LED 相关分支必须逐机型核对；协议命令值、NVS key 和 film 颜色编码不因品牌改名而变化。

## 迁移原则

1. 先以 BLE 和本地文件链路交付最小可用体验，再启用 Wi-Fi / MQTT。
2. 所有新增状态都能从 HTTP 心跳恢复；MQTT 断线不能让设备失联。
3. 所有媒体路径必须经过净化和设备 token 鉴权；固定 `latest.film` 只解析为索引中的最新 `.film`。
4. 用户界面统一使用“花生片 Penaup”，历史兼容名只保留在协议、目录、扫描过滤器和迁移说明中。
