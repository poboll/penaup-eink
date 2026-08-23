# Penaup-Eink 安全审计记录

更新时间：2026-08-24
审计范围：server/ Node.js 运行时、旧 /api/v1/admin/* 兼容层、server/admin/dist/ 管理台、Web 设备工具、媒体上传与发布门禁。

## 审计方法

- 按 OWASP Top 10 关注认证、越权、注入、主动内容、上传、资源路径、限流和敏感信息泄露。
- 对数据库查询、设备心跳、SSE、媒体下载、BLE/OTA 门禁做源码检查。
- 对管理台动态 HTML 做静态输出规则检查；动态字符串必须使用页面 esc() / escapeHtml()，图片资源必须通过 FH.safeAssetUrl() 或鉴权 object URL。
- 通过 Node.js node:test 覆盖安全回归；真实公网 TLS、邮件 provider、MQTT ACL、实体设备仍属于部署验收门禁。

## 本轮已修复

### 上传与媒体

- .film 不信任 multipart MIME，经过 film 头部、尺寸和颜色校验后统一保存并返回 application/octet-stream。
- JPEG APP1/APP13/COM、PNG 文本元数据和 WebP EXIF/XMP/ICCP 在用户图片上传与管理台批量导入时移除。
- 图片和 film 下载均通过数据目录内的真实路径检查；符号链接不能逃逸 media/。
- 用户媒体按用户范围查询，默认配额为 512 MiB；文件名只保留安全字符。

### 设备与接口

- 管理 API 需要管理员令牌或用户会话；Cookie 写入需要 CSRF token。
- 设备首次心跳只允许按受控路径注册；同一 IP 的心跳有独立限流，默认上限为 60 次/分钟，并保留 5 秒设备心跳的最低兼容余量。
- SSE 只向普通用户发送其拥有设备或资源产生的事件；管理员才可读取全量事件。
- 通用 API 限流、请求体限制、CORS 明确来源、日志脱敏和基础安全响应头已启用。

### 管理台与设备工具

- 管理台输出设备名、相册描述、模板名、动态事件、文件名和图层字段前统一转义。
- 管理台资源地址仅允许当前 origin 的 /api/ 和 /assets/ 路径，拒绝 javascript:、外部 origin 和路径型资源注入。
- 模板颜色只接受十六进制颜色；图层坐标、控件属性和参数 key 不再直接拼接为未转义 HTML。
- Web OTA 仅接受匹配 Penaup BLE Service UUID 的设备；镜像不得超过 1536 KiB，签名 key_id 必须匹配固定发布密钥，且必须通过 SHA-256 与 Ed25519 校验。
- OTA、重启、恢复出厂和网络清除都要求设备重新广播并回读确认，不把 BLE 写入成功误报为完成。
- 备份脚本与 systemd timer 使用 `penaup` 受限用户、`ProtectSystem=strict` 和明确的可写目录；本机 fixture 已验证 SQLite、媒体归档和恢复回滚。
- FastAPI 迁移 fixture 覆盖设备、模板、片单、设置和推送关系，并确认源库只读且导入前后表计数不变。

## 当前残余风险

- 真实固件 bootloader、OTA 公钥配置、STD/Pro/Max 实体设备刷新和功耗尚未在本机完成；仓库不包含可直接刷写的正式发布包。
- Caddy 公网 TLS、邮件 provider、Mosquitto 用户/ACL、备份恢复演练需要部署机证据。
- 历史 FastAPI 数据库尚未找到并完成 dry-run 导入；外包合同、字体、摄影、图标和第三方代码的最终权利仍需法律复核。
- 管理台为兼容旧接口保留，正式公网部署仍应优先使用用户作用域 API，并将管理令牌放在 HttpOnly/受控运维环境中。
- AI provider 的远程内容不能被视为可信 HTML；管理台只显示经过本站资源白名单的图片结果，外部结果未通过校验时保留安全占位。

## 验收命令

~~~bash
npm run check
npm test
npm run audit
npm ci --dry-run
npm --prefix server ci --dry-run
git diff --check
npm run release:gate -- --strict-external
~~~

本文件只记录源码与本机可复现门禁，不替代公网、邮箱、MQTT、真机和法律发布验收。
