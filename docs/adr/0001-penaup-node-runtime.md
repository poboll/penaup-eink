# ADR-0001：采用 Node.js 轻量单体运行时

## Status

Accepted

## Context

花生片是单人维护、以 BLE 本地传图为主、Wi-Fi 设备同步为辅的电子纸产品。现有服务端包含 FastAPI、SQLite、Pillow、模板编排和 AI 接口，运行能力较多，但对首个可上线版本来说运维边界偏重。新的服务端需要保存媒体和设备状态，提供兼容设备心跳的 HTTP 接口，并能把 Wi-Fi 设备状态实时反馈给 Web 管理界面。

## Decision

采用 Node.js 24 + Fastify + SQLite + 本地文件存储的单体运行时；MQTT 使用客户端桥接且为可选能力，SSE 用于管理端实时状态。BLE 仍由端侧直连设备，服务端不介入 BLE 数据包生成。新的运行时代码位于 `server/src/`，以 `/api/v1/device/heartbeat` 保持与固件现有 Wi-Fi 逻辑兼容。

## Consequences

### Positive

- 单一进程、单一数据库和少量依赖，适合个人维护。
- Web、小程序和设备 API 可共享 TypeScript/JavaScript 生态，减少跨语言边界。
- MQTT broker 可外置也可暂时关闭，不把消息系统变成必需依赖。
- SQLite WAL + 文件存储足以覆盖个人设备和局域网相册规模。

### Negative

- 单体进程中的 HTTP、事件桥和业务代码共享故障域。
- SQLite 不适合多地域高并发，规模上升时需要迁移到 PostgreSQL。
- 端侧 film 转换仍由 Web/小程序完成，服务端暂时不提供完整模板渲染替代。

## Alternatives Considered

### 继续扩展 FastAPI

实现成本最低，但会继续维护两套前端语言和既有服务边界，不能达到收敛运行时的目标；保留为回滚参考，不作为新入口。

### Node.js + 微服务 + Redis + MQTT

拒绝。对单人产品早期阶段增加部署、监控和故障排查成本，不能改善照片从手机到电子纸的核心体验。

### 纯 MQTT 后端

拒绝。MQTT 适合设备事件和指令，不适合作为媒体上传、管理查询和权限边界的唯一协议。

## References

- `docs/plans/2026-08-22-penaup-product-reframe-design.md`
- `docs/blecmd/blecmd_protocol.md`
- `firmware/penaup/components/film_service/src/service_wifi.c`
