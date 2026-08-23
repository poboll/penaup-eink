# Changelog

## Unreleased · 2026-08-23

### Added

- 新增微信读书屏保整合：支持周报/月报摘要、3.68 英寸 Pro（792 × 528）预览、PNG/.film 下载和已连接 Pro 发送。
- 新增微信小程序“读书屏保”实验室：四种阅读场景、三种六色显影方式、示例预览、PNG 保存和 Pro BLE 发送；Skill Key 仅走请求头且不写入本机。
- 新增 `POST /api/v1/integrations/weread/snapshot` 临时转发接口；Key 不落库、不进 URL、响应或日志，支持带中文单位的阅读统计归一化。
- 新增 `/device/` 浏览器设备工具：BLE 连接、型号/分辨率/电量/Wi-Fi 状态回读、网络配置、网络清除、重启和恢复出厂。
- 新增 BLE OTA 发布清单 schema、草稿清单生成脚本和固件升级边界文档。
- 新增响应式设备工具设计：纸白编辑式布局、48px 操作目标、键盘焦点、Reduced Motion 和状态留痕。

### Changed

- 设备维护命令统一经过 `device_state_uncertain`；重新广播并成功回读前不显示成功。
- 固件升级入口校验产品、发布状态、型号、BLE 协议、文件名、长度、SHA-256 和 Ed25519 签名。
- `/docs/` 由 Node Runtime 提供只读静态文档入口，便于设备工具打开维护说明。
- 工作台在桌面、平板和手机端统一主要按钮栅格与字号；网络面板同步 `aria-expanded` / `aria-hidden`，768px 顶部状态栏不再横向溢出。
- Web 与小程序壁纸实验室统一偏白糙米纸背景、汇文明朝体/衬线层级和较大的触控按钮；更新跨端文档与验证矩阵，明确 DevTools AppID 权限仍是外部门禁。

### Safety

- 当前仓库没有正式发布 `.bin` 与固定发布公钥，刷写按钮默认锁定；ESP-IDF 构建目录产物不作为发布包。
- Web Serial 只做能力探测，不猜测 USB bootloader 协议或分区地址。
