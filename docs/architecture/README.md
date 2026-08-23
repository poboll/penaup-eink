# Penaup-Eink 架构

## 运行拓扑

```text
Web / 微信小程序 / 后续 iOS
              │ HTTPS / BLE
       Fastify Node.js 24
              │
 SQLite WAL + 本地媒体目录 + 进程内任务队列
       │                    │
      SSE             可选 MQTT 5 桥
                              │
                         Penaup Wi-Fi 设备
```

这是面向少量设备和单人维护的模块化单体，而不是提前拆分的微服务。SQLite、媒体目录和事件表可以完整备份；当规模需要时，媒体可迁移到对象存储，任务队列可迁移到独立 worker，但 HTTP 契约和 `packages/film-core` 不变。API 突发保护使用有界的进程内固定窗口限流，不依赖 Redis；设备心跳单独保留，避免网络设备因用户 API 峰值被误伤。`/health` 只表示进程存活，`/readyz` 会额外检查 SQLite 与媒体目录的读写能力。

## 单向依赖

```text
apps / server transports
        ↓
server modules → packages/film-core
        ↓
SQLite / media / MQTT adapter
```

固件维持 `film_service → film_hal → film_sys → ESP-IDF`。MQTT 只传状态与命令，照片仍由 HTTP 下载或端侧 BLE 发送；不要把 MQTT 当照片队列。

## 目录真源

```text
apps/web/              Web 产品故事页与 BLE 工作台
apps/wechat/           微信小程序
firmware/penaup/       三机型单固件真源
hardware/penaup/       硬件资料迁移入口
packages/film-core/    film、六色、Profile、transfer 契约
server/src/            Node 模块与传输层
server/admin/          管理台静态资源
server/migrations/     FastAPI 导入与校验
legacy/fastapi/        只读回滚材料
compat/framefilm/      旧名、路径、广播名和协议兼容说明
```

Web 工作台的照片缩放、抖动和 `.film` 像素打包优先经过
`apps/web/js/image-worker.js`，主线程只负责交互画布和状态展示。Worker 使用
`OffscreenCanvas`（浏览器支持时）完成缩放，复用 `convert.js` 的六色量化算法；不支持
Worker 的浏览器会回退到同步路径，不改变文件格式或颜色索引。快速拖动/调参时由
`image-worker-client.js` 合并旧任务，避免把大图渲染请求堆在内存中。

## 失败模式

- MQTT 离线：HTTP 心跳、BLE、上传和本地任务继续工作；健康检查标记 broker 状态；
- SSE 断开：客户端重新连接并以 transfer 查询接口补齐状态；
- SQLite/媒体目录损坏：停止写入，恢复最近每日备份；目标 RPO 24 小时、RTO 4 小时；
- BLE 在 STOP 后没有刷新回执：进入 `device_state_uncertain`，保留原始 film 和可重试草稿；
- 未知机型或非法 film：在进入设备队列前拒绝，不让固件收到猜测格式。

重要取舍记录见 `docs/adr/`。

## 浏览器维护边界

`apps/web/device/` 是独立的维护入口，与 `/studio/` 的创作流程分开。它只通过 Web Bluetooth 访问当前设备，读取状态并执行已核实的 `0x3B` 网络清除、`0x22` 恢复出厂、`0x24` 重启和 `0x10 → 0x11 → 0x13` BLE OTA。命令写入后统一进入 `device_state_uncertain`，直到重新广播并成功回读。

浏览器固件包必须是 `manifest.json + .bin`，在本地完成型号、长度和 SHA-256 检查；正式发布还需要受网页固定的 poboll Ed25519 公钥。没有公钥或正式发布包时，刷写按钮保持锁定。Web Serial 只做能力提示，不猜测 bootloader 协议。
