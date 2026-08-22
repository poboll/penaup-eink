# 发布前权利与安全检查

## 本机验证记录（2026-08-23）

- Node.js `v24.19.0` 已确认；根包与服务端均限制在 `24.x`。
- `npm run test:server`：26 passed；`npm run test:film-core`：7 passed；`npm run test:wechat`：8 passed。
- 默认 shell 的 `npm run check:contracts`：163 passed，1 pending；加载 ESP-IDF 后执行 `source /Users/Apple/.espressif/frameworks/esp-idf-v5.5.2/export.sh && npm run release:gate -- --strict-external`：164 passed，0 pending，0 failed。
- `npm --prefix server run check`、定向 JavaScript 语法检查和 `git diff --check` 已通过。
- 重启后的 8787 实例已加载当前代码；`/`、`/studio/`、`/health`、`/readyz` 均返回 200，默认限流第 121 次 API 请求返回 `429 + Retry-After: 60`，设备心跳仍返回 200。
- Playwright 已验证首页在 390/768/1440px 下渲染、Studio 上传、三种显影模式切换、无横向溢出和无页面异常；真实 BLE 设备、键盘/VoiceOver 和 Reduced Motion 仍需发布机做最终验收。
- 微信 DevTools 编译、真实 AppID、真机 BLE、三机型耗电/刷新、Caddy 公网 TLS、真实邮件和恢复演练仍属于发布前外部门禁。

- [ ] 外包合同、交付验收和源码权利转让/许可逐文件归档；
- [ ] `firmware/penaup/` 中历史 `kiritro / GPL-3.0-or-later` 文件和第三方驱动未被根许可证覆盖；
- [ ] 图片、摄影、字体、图标、SDK、数据手册和 npm 依赖清单有作者/来源/版本/许可；
- [ ] 新增 `poboll` 内容使用 `LICENSE` 的非商业许可，产品和仓库没有宣称商业授权；
- [ ] 根目录 `npm run check`、`npm test` 和官方 registry `npm run audit` 均通过；
- [ ] `npm run check:contracts` 通过；发布机再运行 `npm run release:gate`，并解决所有 pending 外部工具项；
- [ ] 原图 EXIF 清理、文件魔数、路径穿越、用户归属和 512 MiB 配额测试通过；
- [ ] 生产环境关闭 dev code，配置真实邮件 provider、HttpOnly Secure Cookie、Caddy TLS、CORS allowlist 和限流；
- [ ] 生产环境设置 `PENAUP_TRUST_PROXY=1` 仅在 Caddy 为唯一可信反代时启用，并验证 API `429` 的 `Retry-After`；设备心跳不因用户 API 限流中断；
- [ ] `/health` 与 `/readyz` 已接入部署探针，并验证 SQLite/媒体目录不可写时会阻止就绪；
- [ ] SQLite 与媒体每日备份，至少演练一次恢复并记录 RPO/RTO；
- [ ] 三机型 film 尺寸、BLE 192B 分块和三端协议常量一致；
- [ ] Web/小程序/iOS 对 `device_state_uncertain` 不显示成功；
- [ ] 法律顾问完成最终组合许可和商业发布复核。
