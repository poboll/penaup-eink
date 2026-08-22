# 发布前权利与安全检查

- [ ] 外包合同、交付验收和源码权利转让/许可逐文件归档；
- [ ] `firmware/penaup/` 中历史 `kiritro / GPL-3.0-or-later` 文件和第三方驱动未被根许可证覆盖；
- [ ] 图片、摄影、字体、图标、SDK、数据手册和 npm 依赖清单有作者/来源/版本/许可；
- [ ] 新增 `poboll` 内容使用 `LICENSE` 的非商业许可，产品和仓库没有宣称商业授权；
- [ ] 根目录 `npm run check`、`npm test` 和官方 registry `npm run audit` 均通过；
- [ ] `npm run check:contracts` 通过；发布机再运行 `npm run release:gate`，并解决所有 pending 外部工具项；
- [ ] 原图 EXIF 清理、文件魔数、路径穿越、用户归属和 512 MiB 配额测试通过；
- [ ] 生产环境关闭 dev code，配置真实邮件 provider、HttpOnly Secure Cookie、Caddy TLS、CORS allowlist 和限流；
- [ ] `/health` 与 `/readyz` 已接入部署探针，并验证 SQLite/媒体目录不可写时会阻止就绪；
- [ ] SQLite 与媒体每日备份，至少演练一次恢复并记录 RPO/RTO；
- [ ] 三机型 film 尺寸、BLE 192B 分块和三端协议常量一致；
- [ ] Web/小程序/iOS 对 `device_state_uncertain` 不显示成功；
- [ ] 法律顾问完成最终组合许可和商业发布复核。
