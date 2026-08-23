# 微信读书屏保整合

> Copyright (c) 2026 poboll · `LicenseRef-Poboll-NonCommercial`

花生片 Penaup 可以把微信读书的书架、周报或月报排成 Pro 版电子纸屏保。它不是把阅读数据做成手机截图，而是先取回最小统计摘要，再在浏览器本地排版、六色显影并生成 `.film`。

## 用户流程

```text
输入临时 Skill Key → 连接书架 → 选择本周 / 本月与场景
（或先用示例数据预览）→ 浏览器本地排版 → 选择叠色 / 网点 / 抖动 → 六色显影
→ 下载 PNG / JPG / .film 或发送到 Pro
```

网页入口是 `/studio/?mode=weread`；微信小程序入口是 `apps/wechat/miniprogram/pages/weread/index`。两端共享 `PENAUP_PRO`、`792 × 528`、三种显影方式和 `device_state_uncertain` 传输语义，但小程序使用自己的 Canvas 2D 和临时文件路径，不把 PNG 或 `.film` 长期转成 base64 存储。小程序的服务地址可以保存在本机设置中，Skill Key 只在当前页面内存中使用。

“用示例数据预览”完全在浏览器内生成三本虚构书籍和一段虚构阅读轨迹，不会发送请求，也不会把示例当作微信读书数据。它与真实流程共用同一套汇文明朝体、本地 Worker、Pro 尺寸和状态提示，适合第一次打开页面时先体验。

固定输出契约为 `PENAUP_PRO`、`792 × 528`、`E6 3.68 inch`。物理屏幕仍然只有六种基础墨水；叠色、抖动和相邻像素共同形成更多色彩观感，页面文案使用“最多 48 种色彩观感”，不把它描述成 48 种原生墨水。

## 四种壁纸场景

- **本周小票**：阅读分钟、阅读天数、书名和一段摘录排成一张周阅读小票；
- **本月日历**：把每天的阅读分钟放进周一开始的月历，并用短线串起阅读线程；
- **书架标本**：把归一化书架书名排成三层书脊，只显示服务端允许的最小字段；
- **我的读书卡**：选择一本书，补充简介、进度和最多两条最近划线/批注。

本周小票与本月日历会在选择场景时自动切换到对应的时间范围，避免拿周数据填充整月日历。手动改变时间范围会清空当前可下载的 PNG/JPG/`.film`，必须重新取回并显影；这样不会把上一张纸误当成新的时间范围。书架标本和读书卡可以继续使用当前选定的周报或月报数据。

网页四种场景使用仓库内的 `apps/web/fonts/huiwen-mincho.woff2` 排版；小程序使用系统中文衬线回退，以避免把未经核实授权的 OTF 放进小程序包。Web 字体是将用户提供的汇文明朝体字体转换成网页可加载格式后的资源；原始 OTF 不进入 Git，字体的再分发权利仍需在公开发布前单独核对。

## HTTP 接口

```text
POST /api/v1/integrations/weread/connect
POST /api/v1/integrations/weread/bookshelf
POST /api/v1/integrations/weread/reading-card
```

`connect` 只返回书架总数、电子书和有声书数量；`bookshelf` 返回有限数量的书名、作者、完成状态、最近阅读时间和安全的 HTTPS 封面地址；`reading-card` 根据书籍编号取回简介、进度以及最多两条划线/批注。所有返回都是归一化字段，不把微信读书原始 JSON 交给网页。

```text
POST /api/v1/integrations/weread/snapshot
Header: X-Penaup-WeRead-Key: <临时 Skill Key>
Body: { "mode": "weekly" | "monthly", "month": "YYYY-MM"?, "week_start": "YYYY-MM-DD"?, "enrich": true? }
```

服务端向微信读书 gateway 发起一次 `POST`，请求体使用：

```json
{
  "api_name": "/readdata/detail",
  "mode": "monthly",
  "skill_version": "1.0.4"
}
```

月报可额外传 `month`，周报可传周一 `week_start`，服务端会转换为上游需要的 `baseTime`。`enrich: true` 时服务端还会读取书架，并对最多五本书补充进度和最新划线；任何补充请求失败只会把 `enrichment` 标记为 `partial`，不会把统计摘要伪装成完整成功。返回值只包含屏保需要的字段：阅读分钟、阅读天数、读过的书数、笔记数、最多十二本书、每日阅读柱状数据和时间范围标签；不会把微信读书原始响应转发给页面。

## Key 与隐私边界

- Key 只从 `X-Penaup-WeRead-Key` 请求头读取，不接受 URL 参数，不写 SQLite，不写 local server 日志，也不进入响应正文。连接、书架、快照和读书卡路由都检查来源并使用独立的每 IP 20 次/分钟限流。
- 默认请求和响应均为 `no-store`；上游请求使用 HTTPS，超时默认 15 秒。
- 页面只在当前工作台内存中保留 Key；不会提供“记住 Key”选项，也不会写入 `localStorage`、IndexedDB、Cookie 或 URL。刷新页面即自动清除，使用后也可以点击“清除”。
- 生产反向代理必须继续脱敏 `X-Penaup-WeRead-Key`，并限制该路由的请求体、频率和来源。微信读书账号数据不会进入 MQTT、SSE、相册或媒体目录。
- 用户曾经在开发对话中暴露过 Key；上线前应立即在微信读书侧轮换该 Key，并只把新 Key 放在本地输入框或受保护的运行环境里。

## 本地配置

通常不需要配置 gateway。需要切换上游或调整超时时，在服务端环境设置：

```text
PENAUP_WEREAD_GATEWAY_URL=https://i.weread.qq.com/api/agent/gateway
PENAUP_WEREAD_GATEWAY_ALLOWED_HOSTS=i.weread.qq.com
PENAUP_WEREAD_SKILL_VERSION=1.0.4
PENAUP_WEREAD_TIMEOUT_MS=15000
```

gateway 必须是 HTTPS 地址，默认只允许 `i.weread.qq.com`；如果部署到经过审核的自有转发域名，必须同时把该域名加入 `PENAUP_WEREAD_GATEWAY_ALLOWED_HOSTS`，否则服务会拒绝启动。不要把 Skill Key 放进 `.env`、Git、部署模板或客户端构建产物。

## 字体与生成

屏保排版优先使用 `apps/web/fonts/huiwen-mincho.woff2`（汇文明朝体的 Web 子集），正文和技术标签使用系统无衬线/等宽字体。该字体由本机 `/Users/Apple/Downloads/Huiwenmingchaoti/汇文明朝体.otf` 生成，仓库只提交 Web 所需子集，不提交原始 OTF；字体授权和再分发边界仍要在发布前逐项复核，见 [权利与来源说明](../legal/provenance.md)。

浏览器会明确展示“取回 → 排版 → 显影 → 留下”四个阶段：先生成普通画布预览，再复用 `PenaupImageWorker` 的 `PENAUP_PRO` 配置生成 `.film`。Worker 不可用时可以看预览，但下载和发送按钮不会伪造一个未经显影的 `.film`。PNG / JPG / `.film` 下载会短暂进入“准备下载”状态；BLE 写入后保持“待确认”，不会把写入进度当成刷新成功。

Canvas 会在首次绘制前等待 `Huiwen Mincho` WebFont 加载，避免首张屏保因为字体竞态回退到系统字体。BLE 写入完成后页面使用“等待电子纸刷新确认”状态；写入进度不等同于设备已经刷新成功。

## 外部流程参考

本轮视觉与流程研究参考了 [Sodamax778/expert-eureka](https://github.com/Sodamax778/expert-eureka) 在 2026-08-23 可见的“阅读数据归一化 → 固定模板 → 本地导出”流程，以及它的浅色纸面方向。Penaup 没有复制该仓库的代码、素材或运行时依赖；当时的浅克隆未发现可见 `LICENSE` 文件，因此外部项目不作为本仓库的版权来源。公开发布前仍应重新核对上游仓库的许可证和变更。

## 失败与恢复

| 情况 | 页面行为 |
|---|---|
| Key 缺失或格式错误 | 不访问上游，保留输入焦点并提示修正 |
| Key 被拒绝 | 显示 Key 失效，不显示上游原文 |
| 上游超时/不可用 | 显示可重试状态，不保存阅读数据 |
| 本地显影失败 | 保留已取回摘要，禁止下载/发送伪造文件 |
| Pro 未连接 | 保留 PNG、JPG 与 `.film` 下载，发送按钮提示先连接 Pro |

所有生成状态都属于当前页面草稿；离开页面后服务端不会自动保留阅读摘要。
