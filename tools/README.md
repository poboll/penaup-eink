# Penaup 工具

## ForFilm Web

`apps/web/` 是桌面端 Web 产品故事页与 BLE 工作台，负责连接设备、选择照片、预览六色转换、发送 film、配置 Wi-Fi 和 OTA。新版视觉使用“纸张显影”叙事，但保留旧 DOM id 和协议调用，保证已有功能不被样式重构破坏。

启动本地预览：

```bash
cd apps/web
python3 -m http.server 8080
```

## 微信小程序

`apps/wechat/` 包含手机端创作、片单、模板、设置和 BLE 传输。小程序不能把动画当作传输成功证据，进度必须来自真实 BLE 队列回调；断联时显示可重试状态并保留本地草稿。film 二进制放在用户数据目录，Storage 只保存路径和轻量元数据。

微信开发者工具应打开 `apps/wechat/`（不是其下的 `miniprogram/`，项目配置在上一级），
CLI 预览命令为：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli preview \
  --project ./apps/wechat
```

## 转换工具

`tools/convert/` 用于离线检查和生成 film。颜色表、头格式、屏幕尺寸以 `docs/film/film.md` 为准。

## 维护规则

- Web、小程序和固件共享协议值，不在单端创建私有命令；
- 不提交用户照片、浏览器导出的凭证或本地测试设备信息；
- 新 UI 使用 Penaup 语言，旧 FrameFilm 只留兼容提示；
- 版权和第三方资源边界见 `docs/legal/provenance.md`。
