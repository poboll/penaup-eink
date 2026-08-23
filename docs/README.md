# 花生片 Penaup 文档中心

这里记录花生片从照片进入手机、转换为 film、通过 BLE/Wi-Fi 写入电子纸，到设备刷新和长期显示的完整链路。

## 先读这些

1. [产品重构设计](plans/2026-08-22-penaup-product-reframe-design.md)：品牌、体验和迁移边界；
2. [BLE 协议](blecmd/blecmd_protocol.md)：命令值、包结构和三端同步要求；
3. [film 文件格式](film/film.md)：32 字节头和像素编码；
4. [硬件规格](hardware/hardware_spec.md)：三机型、电源、EPD 和启动流程；
5. [Node 运行时 ADR](adr/0001-penaup-node-runtime.md)：为什么选择轻量单体；
6. [版权与许可 ADR](adr/0002-poboll-noncommercial-license.md)：非商业使用和历史来源边界。
7. [Runtime 安全边界 ADR](adr/0003-runtime-security-boundary.md)：令牌、上传、MQTT 和静态文件保护。
8. [API 索引](api/README.md)：用户、设备、媒体、片单、传输和 SSE 接口。
9. [Transfer 状态契约](api/transfer-state.md)：Web、小程序和未来 iOS 共用的状态与 Live Activity 映射。
10. [品牌与体验](brand/README.md)：花生片的故事线、六色 token 和状态文案。
11. [设备工具与固件升级](device-tool/firmware-updates.md)：浏览器 BLE 维护、OTA 门禁和 Web Serial 边界。
12. [运行时需求](architecture/runtime-requirements.md) 与 [技术设计](architecture/runtime-design.md)：Node 单体、SQLite、SSE 和 MQTT 边界。
13. [微信读书屏保整合](integrations/weread-wallpaper.md)：Key 边界、3.68 英寸 Pro 输出和本地六色显影。

## 文档分区

- `adr/`：已经作出的架构和法律策略决定；
- `blecmd/`：设备通信规范，命令值一旦发布不得随意修改；
- `film/`：film 文件和颜色编码；
- `hardware/`：屏幕、引脚、机械和启动限制；
- `knowledge/`：给开发者和 AI 工具使用的项目地图；
- `plans/`：产品、交互和迁移设计；
- `wifi/`：设备 Wi-Fi 心跳与拉取流程。
- `device-tool/`：浏览器设备维护、固件清单和刷写验收。
- `architecture/`：当前运行拓扑、目录真源和失败模式。
- `legal/`：来源、组合许可和发布前法律/安全检查。

## 文档写作约束

- 用户-facing 文案使用“花生片 Penaup”；`FrameFilm / 帧影` 只用于兼容说明；
- 所有规格标注“当前实现”“目标值”或“硬件待验证”中的一种，不把目标当成实测；
- 协议变更必须同时更新固件、Web、小程序和本文档；
- 设备工具写入命令必须使用已核实的 BLE 值；写入完成、重启或 `OTA_STOP` 都不能直接渲染成成功；
- 不在文档中放入密码、Token、私有照片、私有地址或外包合同内容；
- 新文档版权标注 `Copyright (c) 2026 poboll`，第三方材料保留原始许可。

## 可执行验证

```bash
cd packages/film-core && npm test && npm run check
cd ../../server && npm test && npm run check && npm audit --omit=dev
cd .. && node --test apps/wechat/miniprogram/test/*.test.js
```

微信开发者工具打开 `apps/wechat/`；旧云函数 quickstart 只在 `legacy/wechat/` 作为只读材料保存。真实邮箱、MQTT ACL、Caddy HTTPS、三机型固件编译、真机 BLE 和远程仓库迁移仍是发布前门禁，不由静态测试代替。
