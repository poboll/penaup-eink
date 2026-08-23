# 微信读书屏保整合

> Copyright (c) 2026 poboll · `LicenseRef-Poboll-NonCommercial`

花生片 Penaup 可以把微信读书的一份周报或月报排成 Pro 版电子纸屏保。它不是把阅读数据做成手机截图，而是先取回最小统计摘要，再在浏览器本地排版、六色显影并生成 `.film`。

## 用户流程

```text
输入临时 Skill Key → 选择本周 / 本月 → 服务端临时转发
→ 浏览器本地排版 → 六色显影 → 下载 PNG / .film 或发送到 Pro
```

固定输出契约为 `PENAUP_PRO`、`792 × 528`、`E6 3.68 inch`。物理屏幕仍然只有六种基础墨水；叠色、抖动和相邻像素共同形成更多色彩观感，页面文案使用“最多 48 种色彩观感”，不把它描述成 48 种原生墨水。

## HTTP 接口

```text
POST /api/v1/integrations/weread/snapshot
Header: X-Penaup-WeRead-Key: <临时 Skill Key>
Body: { "mode": "weekly" | "monthly", "month": "YYYY-MM"? }
```

服务端向微信读书 gateway 发起一次 `POST`，请求体使用：

```json
{
  "api_name": "/readdata/detail",
  "mode": "monthly",
  "skill_version": "1.0.4"
}
```

月报可额外传 `month`，服务端会转换为上游需要的 `baseTime`。返回值只包含屏保需要的字段：阅读分钟、阅读天数、读过的书数、笔记数、最多八本书、每日阅读柱状数据和时间范围标签；不会把微信读书原始响应转发给页面。

## Key 与隐私边界

- Key 只从 `X-Penaup-WeRead-Key` 请求头读取，不接受 URL 参数，不写 SQLite，不写 local server 日志，也不进入响应正文。
- 默认请求和响应均为 `no-store`；上游请求使用 HTTPS，超时默认 15 秒。
- 页面默认只在内存中保留 Key；勾选“在这台浏览器记住 Key”才会写入浏览器 `localStorage`。共享电脑不要勾选，使用后可以点击“清除”。
- 生产反向代理必须继续脱敏 `X-Penaup-WeRead-Key`，并限制该路由的请求体、频率和来源。微信读书账号数据不会进入 MQTT、SSE、相册或媒体目录。
- 用户曾经在开发对话中暴露过 Key；上线前应立即在微信读书侧轮换该 Key，并只把新 Key 放在本地输入框或受保护的运行环境里。

## 本地配置

通常不需要配置 gateway。需要切换上游或调整超时时，在服务端环境设置：

```text
PENAUP_WEREAD_GATEWAY_URL=https://i.weread.qq.com/api/agent/gateway
PENAUP_WEREAD_SKILL_VERSION=1.0.4
PENAUP_WEREAD_TIMEOUT_MS=15000
```

gateway 必须是 HTTPS 地址；不要把 Skill Key 放进 `.env`、Git、部署模板或客户端构建产物。

## 字体与生成

屏保排版优先使用 `apps/web/fonts/huiwen-mincho.woff2`（汇文明朝体的 Web 子集），正文和技术标签使用系统无衬线/等宽字体。该字体由本机 `/Users/Apple/Downloads/Huiwenmingchaoti/汇文明朝体.otf` 生成，仓库只提交 Web 所需子集，不提交原始 OTF；字体授权和再分发边界仍要在发布前逐项复核，见 [权利与来源说明](../legal/provenance.md)。

浏览器先生成普通画布预览，再复用 `PenaupImageWorker` 的 `PENAUP_PRO` 配置生成 `.film`。Worker 不可用时可以看预览，但下载和发送按钮不会伪造一个未经显影的 `.film`。

## 失败与恢复

| 情况 | 页面行为 |
|---|---|
| Key 缺失或格式错误 | 不访问上游，保留输入焦点并提示修正 |
| Key 被拒绝 | 显示 Key 失效，不显示上游原文 |
| 上游超时/不可用 | 显示可重试状态，不保存阅读数据 |
| 本地显影失败 | 保留已取回摘要，禁止下载/发送伪造文件 |
| Pro 未连接 | 保留 PNG 与 `.film` 下载，发送按钮提示先连接 Pro |

所有生成状态都属于当前页面草稿；离开页面后服务端不会自动保留阅读摘要。
