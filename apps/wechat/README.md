# 花生片 Penaup 微信小程序

这是花生片的移动端创作入口：先用故事化首页了解设备状态，再进入“拍一张 / 传照片 / 模板 / 片单”，最后通过 BLE 把六色 `.film` 写入电子纸。

## 开发者工具

在微信开发者工具中打开本目录 `apps/wechat/`（项目根目录，不是 `miniprogram/` 子目录）。

不要只打开 `miniprogram/` 子目录；`project.config.json` 在本目录。当前 AppID 保留为项目原登记值，提交或预览前请在开发者工具中确认账号、AppID 和合法域名属于花生片项目。

## 体验与状态

页面统一使用 `styles/penaup-pages.wxss` 的纸白、墨黑、六色 token。传图流程显示：

```text
准备相纸 → 发送开始指令 → 发送文件名/长度 → 192B 分块写入
→ 发送结束指令 → 电子纸刷新待确认
```

动效只能表达等待和进度，不能代替 BLE 回调。断联或 STOP 后没有可信刷新回执时，保持 `device_state_uncertain` 语义，保留本地草稿并提供重试。原图和 film 不再长期保存为 base64：Storage 只保存轻量元数据，二进制放在 `wx.env.USER_DATA_PATH/penaup-film-cache/`。

## 共享契约

- `utils/film-core.js` 由 `packages/film-core/dist/film-core.umd.js` 生成，不手改；
- `utils/film-utils.js` 负责 ES5/小程序 canvas 兼容和六色转换；
- `utils/ble-utils.js` 保留历史 BLE 命令值和 192 字节分块；
- `recent-utils.js` 只保存路径、文件名和时间，清理记录时同步删除缓存文件。

真实 BLE、相册、三机型 film、断联重试和真机耗电需要已登录的微信开发者工具/设备；静态 Node 语法检查不能替代这些验证。

## 云函数边界

旧云开发 quickstart 已移至 [`legacy/wechat/quickstartFunctions`](../../legacy/wechat/quickstartFunctions)，不再属于微信开发者工具项目，也不参与 Penaup Node 服务端部署。新的认证、媒体、相册、模板、片单和设备 API 统一走 `server/`；如果未来确实需要云函数，必须先建立独立权限、数据迁移说明和发布审计，不得把 quickstart 示例当成生产后端。
