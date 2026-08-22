# server/AGENTS.md

花生片 Penaup 服务端维护指南。

## 身份与边界

- 新入口：Node.js 24 + Fastify + SQLite WAL + 本地媒体 + SSE + 可选 MQTT，源码位于 `server/src/`；
- 旧入口：`legacy/fastapi/`，只读迁移参考和回滚材料，不作为新部署入口；
- 管理台静态资源：`server/admin/dist/`；
- 统一 film 与 transfer 契约：`packages/film-core/`；
- 新增代码/文档可标注 `Copyright (c) 2026 poboll`，混合历史文件不得覆盖原作者和第三方来源，见 `docs/legal/provenance.md`。

## 目录

```text
server/
├── src/
│   ├── app.js              Fastify 组装、静态资源、安全头、设备兼容接口
│   ├── db.js               SQLite WAL schema、迁移、ownership 查询
│   ├── events.js           进程内事件总线
│   ├── mqtt.js             可选 MQTT 5 状态/指令桥
│   ├── modules/            auth/devices/media/albums/templates/streams/ai/transfer
│   └── transports/http.js  用户 API 与兼容 HTTP 路由
├── admin/dist/             Runtime 管理台
├── migrations/             FastAPI SQLite dry-run/导入器
├── test/                   node:test、鉴权、归属、film、安全测试
└── data/                   本地运行数据，不提交 Git
```

## API 规则

- 用户资源所有查询必须带 `user_id` ownership 条件；
- 设备 token 校验必须先于 `latest.film` 或按文件名查询，设备只能读取公共媒体或自身 owner 的媒体；
- 浏览器 Cookie 写请求（包括 refresh/logout）必须通过 `X-CSRF-Token`，Bearer 请求供小程序/iOS 使用；
- 邮箱 challenge 默认 10 分钟、单次使用、哈希存储，生产必须配置真实 email provider，不能开启 dev code；
- `.film` 必须交给 `packages/film-core` 校验，不重复实现尺寸/颜色协议；
- MQTT 不传照片，不自动注册设备，payload 必须携带首次 HTTP 心跳建立的 token；
- SSE 连接必须根据 `userId` 或设备 owner 过滤事件，断开时清理订阅和心跳计时器。

## 修改约束

1. 不使用字符串拼接 SQL；limit 等结构化值先转为受限整数；
2. 不把原图、token、验证码或 MQTT 密码写入日志和事件；
3. 新媒体上传同时校验 MIME、魔数、大小、用户配额、相册归属和路径；
4. 设置使用 `(user_id, key)` 范围隔离，不能恢复成全局 key 主键；
5. transfer 的 `device_state_uncertain` 不能改写成 `succeeded`；
6. 旧库先 `--dry-run`，核对表计数、SHA-256、film 尺寸和模板 JSON 后再导入，不删除源库。

## 运行与验证

```bash
cd server
npm install
npm run check
npm test
npm audit --omit=dev
npm start
```

默认只监听 `127.0.0.1:8787`。网络监听必须设置 `PENAUP_ADMIN_TOKEN`，公网部署再接 Caddy TLS、明确 CORS、限流、邮件 provider、MQTT ACL 和每日 SQLite/媒体备份。

部署模板见 `deploy/`；API 与 iOS 状态契约见 `docs/api/`；架构取舍见 `docs/architecture/` 和 `docs/adr/`。
