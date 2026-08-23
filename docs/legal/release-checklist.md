# 发布前权利与安全检查

## 本机验证记录（2026-08-24）

- Node.js `v24.19.0` 已确认；根包与服务端均限制在 `24.x`。
- `npm test`：server 43、film-core 8、微信 19、Web/发布工具 22，全部通过。
- `npm run check`：106 个 JavaScript 文件语法通过；在已导出 ESP-IDF 5.5.2 + Python 3.14.2 的严格环境中，契约门禁为 `235 passed / 0 pending / 0 failed`。基于 `00bdb65` 构建隔离修复提交的源码副本已完成 STD/Pro/Max 三机型构建，应用分区余量为 13%/12%/14%。构建不等于实体刷写验收，完整证据见 [`docs/ops/verification-matrix.md`](../ops/verification-matrix.md)。
- `npm run audit`：官方 registry 的生产依赖 `0 vulnerabilities`；`git diff --check` 通过。
- 根目录和 `server/` 的 `npm ci --dry-run` 均通过；`better-sqlite3` 的原生安装脚本需在部署机按 Node 24 的脚本审批策略执行。
- 8787 实例当前 `/`、`/studio/`、`/health`、`/readyz` 均返回 200；Caddy `validate` 通过；Mosquitto `--test-config` 退出码为 0 并报告模板配置有效，本机仅出现缺少 `/var/lib/mosquitto/` 的非致命持久化提示，没有启动公网 broker。
- `node server/migrations/import-fastapi.mjs --help` 和未知选项回归测试通过；本机未找到旧 `filmhub.db`，只对当前目标库的只读副本做了 dry-run，未执行正式导入。
- 微信 DevTools CLI `islogin` 返回已登录，但打开仓库项目被微信返回 code 10（账号不是当前 AppID 的开发者）；因此没有把 DevTools 编译、真实 AppID、真机 BLE、三机型耗电/刷新写成通过。
- IAB 已验证首页、工作台和设备工具的桌面渲染、三种显影模式切换、Pro 竖向纸面和无页面异常；响应式 CSS 契约覆盖 420/560/720/820/1024px 断点，但当前 IAB 未提供稳定的移动模拟视口，因此 390/768px 截图、真实 BLE 设备、键盘/VoiceOver 和 Reduced Motion 仍需发布机做最终验收。

完整的命令、输出摘要和外部门禁见 [`docs/ops/verification-matrix.md`](../ops/verification-matrix.md)。

- [ ] 外包合同、交付验收和源码权利转让/许可逐文件归档；
- [ ] `firmware/penaup/` 中历史 `kiritro / GPL-3.0-or-later` 文件和第三方驱动未被根许可证覆盖；
- [ ] 图片、摄影、字体、图标、SDK、数据手册和 npm 依赖清单有作者/来源/版本/许可；
- [ ] 新增 `poboll` 内容使用 `LICENSE` 的非商业许可，产品和仓库没有宣称商业授权；
- [x] 根目录 `npm run check`、`npm test` 和官方 registry `npm run audit` 均通过；
- [x] `npm run check:contracts` 与本机严格发布门禁通过（`235 passed / 0 pending / 0 failed`）；公网部署、微信 AppID 权限和实体硬件门禁仍需在对应环境完成；
- [ ] 原图 EXIF 清理、文件魔数、路径穿越、用户归属和 512 MiB 配额测试通过；
- [ ] 生产环境关闭 dev code，配置真实邮件 provider、HttpOnly Secure Cookie、Caddy TLS、CORS allowlist 和限流；
- [ ] 生产环境设置 `PENAUP_TRUST_PROXY=1` 仅在 Caddy 为唯一可信反代时启用，并验证 API `429` 的 `Retry-After`；设备心跳不因用户 API 限流中断；
- [ ] `/health` 与 `/readyz` 已接入部署探针，并验证 SQLite/媒体目录不可写时会阻止就绪；
- [x] 本机 fixture 已完成 SQLite 与媒体备份、恢复和 `--force` 回滚演练；
- [ ] Linux systemd 已启用 `penaup-backup.timer`，并完成生产备份恢复演练与 RPO/RTO 记录；
- [ ] 三机型 film 尺寸、BLE 192B 分块和三端协议常量一致；
- [ ] Web/小程序/iOS 对 `device_state_uncertain` 不显示成功；
- [ ] `/studio/` 不包含直接 `.bin` OTA 上传入口；Web 固件升级只从 `/device/` 进入，并在重新广播与状态回读前保持待确认；
- [ ] 法律顾问完成最终组合许可和商业发布复核。
- [ ] `apps/web/device/` 的 BLE 重置、恢复出厂、重启和 OTA 在真实设备上完成断连/重连验收；没有把写入完成冒充为升级成功；
- [ ] 正式固件清单处于 `published`，型号、长度、SHA-256、Ed25519 签名和网页固定公钥全部可独立复核；仓库不提交未授权的 `.bin` 构建产物；
- [ ] Web Serial 仅在 bootloader 协议、分区、恢复流程和真机门禁形成证据后再开放，不以浏览器能力探测替代硬件验证；
