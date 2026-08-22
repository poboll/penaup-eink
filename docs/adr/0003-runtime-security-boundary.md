# ADR-0003：Runtime 的本地优先安全边界

## Status

Accepted

## Context

Penaup Runtime 面向个人设备和局域网部署，仍然需要保护设备 token、媒体文件和
管理接口。早期版本不应引入完整账号系统、Redis 或复杂网关，但也不能把“只在
家里运行”当作鉴权和路径校验的替代品。

## Decision

- 默认只监听 `127.0.0.1`；非 production 的本地开发运行可以省略管理 token。需要
  局域网访问时由部署者显式改为 `0.0.0.0`，并设置 `PENAUP_ADMIN_TOKEN`；生产环境
  即使由 Caddy 反代到 loopback，也必须设置管理 token。缺少 token 时管理 API 直接
  返回 503，外层仍应通过 HTTPS 或可信内网保护管理入口；
- 设备首次 HTTP 心跳领取随机 token，后续心跳、状态查询和 film 下载都必须携带
  该 token；管理接口使用 Bearer token；比较令牌时使用常量时间比较；
- MQTT 只能接收已登记设备的带 token 状态，不允许凭 topic 自动注册设备，照片
  本体不经过 MQTT；
- 上传文件不仅检查扩展名，还检查 32 字节头、六色标记、三机型尺寸和完整文件
  长度；媒体路径必须落在 `data/media` 目录内；
- Fastify 静态服务使用已修复路径穿越问题的 `@fastify/static >= 10.1.3`，并统一
  返回 `nosniff`、禁止 iframe、无 referrer 和受限权限策略响应头。

## Consequences

### Positive

- 对单人维护规模保持低运维成本，同时覆盖最容易造成数据泄露的路径、文件和
  设备身份边界。
- BLE、本地 HTTP 和无 MQTT 模式继续可用；安全能力不依赖云端服务。

### Negative

- Bearer token 的管理体验仍适合局域网工具，不等同于多用户 SaaS 身份系统。
- 暴露到公网前仍需要反向代理、TLS、限流、日志轮转和更完整的账号/审计系统；
  本 Runtime 不声称已经达到公网生产级多租户标准。

## Verification

- `server/npm test` 覆盖首次/后续/错误 token、管理鉴权、三机型 film 校验、
  设备命令一次性交付和下载别名；
- 发布前执行 `npm audit --omit=dev --registry=https://registry.npmjs.org`，并做
  实际 HTTPS、反向代理和 MQTT broker 联调。
