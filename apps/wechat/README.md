# 花生片 Penaup 微信小程序

这是花生片的移动端创作入口：先用故事化首页了解设备状态，再进入“拍一张 / 传照片 / 模板 / 片单”，最后通过 BLE 把六色 `.film` 写入电子纸。

无设备连接时，普通相册、拍照、绘梦和模板默认使用花生片 Pro 的 E6 3.68 英寸 `528 × 792` 竖向视觉相纸；连接 STD 或 Max 后，页面会按设备广播名切换对应 Profile。历史 `PENAUP` / `FRAMEFILM` 名称仍保留为兼容入口。

## 开发者工具

在微信开发者工具中打开本目录 `apps/wechat/`（项目根目录，不是 `miniprogram/` 子目录）。

不要只打开 `miniprogram/` 子目录；`project.config.json` 在本目录。当前 AppID 保留为项目原登记值，提交或预览前请在开发者工具中确认账号、AppID 和合法域名属于花生片项目。

`project.private.config.json` 只用于本机微信开发者工具覆盖项，已加入 Git 忽略规则；请不要把它作为发布配置或提交到仓库。需要共享的项目设置只写入 `project.config.json`。

## 微信读书壁纸实验室

首页的“读书屏保”入口打开 `pages/weread/index`：它把微信读书的周报、月报、书架或单本读书卡排成花生片 Pro 的 `528 × 792` 竖向屏保，发送时由共享 film-core 转为 `792 × 528` 协议。页面先用示例数据完成一次本地预览，也可以填写花生片服务地址后，通过 `X-Penaup-WeRead-Key` 请求头临时取回数据。

小程序只保存服务地址；Skill Key 仅存在当前页面内存，不写入 Storage、URL、日志或 film 文件。服务端不会把 Key、阅读原文或书架数据写入 SQLite。发布前应在微信读书侧轮换曾经在开发对话中暴露过的 Key，并在微信开发者工具中配置实际的合法域名。

壁纸固定面向 `PENAUP_PRO` / E6 3.68 英寸屏幕，支持本周小票、本月日历、书架标本和我的读书卡四种场景，以及叠色、网点、抖动三种六色显影方式。BLE 写入后仍保持 `device_state_uncertain`，只有设备重新连接并完成可信状态回读，才允许进入成功状态。

## 体验与状态

页面统一使用 `styles/paper-surface.wxss` 的浅糙米纸面，再叠加 `styles/penaup-pages.wxss` 的纸白、墨黑、六色 token。模板预览不再覆盖成旧的灰麻色；小屏读书页会把地址操作和主按钮堆叠，避免输入框被挤压。传图流程显示：

```text
准备相纸 → 发送开始指令 → 发送文件名/长度 → 192B 分块写入
→ 发送结束指令 → 电子纸刷新待确认
```

动效只能表达等待和进度，不能代替 BLE 回调。断联或 STOP 后没有可信刷新回执时，保持 `device_state_uncertain` 语义，保留本地草稿并提供重试。原图和 film 不再长期保存为 base64：Storage 只保存轻量元数据，二进制放在 `wx.env.USER_DATA_PATH/penaup-film-cache/`。

设置页的 OTA 同样遵守这条边界：`OTA_STOP` 后只显示“固件已写入，等待重新连接并回读确认”；重新连接后通过电量回读确认设备仍能运行，才进入 `succeeded`。小程序只持久化文件名、大小和状态，不把固件二进制或密码写入 Storage；确认失败时可重新连接并再次回读。

## 共享契约

- `utils/film-core.js` 由 `packages/film-core/dist/film-core.umd.js` 生成，不手改；
- `utils/film-utils.js` 负责 ES5/小程序 canvas 兼容和六色转换；
- `utils/ble-utils.js` 保留历史 BLE 命令值和 192 字节分块；
- `recent-utils.js` 只保存路径、文件名和时间，清理记录时同步删除缓存文件。

真实 BLE、相册、三机型 film、断联重试和真机耗电需要已登录的微信开发者工具/设备；静态 Node 语法检查不能替代这些验证。

## 云函数边界

旧云开发 quickstart 已移至 [`legacy/wechat/quickstartFunctions`](../../legacy/wechat/quickstartFunctions)，不再属于微信开发者工具项目，也不参与 Penaup Node 服务端部署。新的认证、媒体、相册、模板、片单和设备 API 统一走 `server/`；如果未来确实需要云函数，必须先建立独立权限、数据迁移说明和发布审计，不得把 quickstart 示例当成生产后端。
