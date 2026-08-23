# 花生片 Penaup

> 一个把照片显影到彩色电子纸上的拍立得。推荐仓库名：`penaup-eink`。

花生片不是把照片变成一块需要一直点亮的屏幕，而是让一张照片经过六色显影，成为桌面、墙面或冰箱门上的一小块日常。

![花生片产品图](assets/pic/model/rendering2.png)

## 一次显影

```text
选择照片 → 相纸落入画布 → 六色显影扫描 → BLE / Wi-Fi 写入
→ 电子纸刷新 → 完成或等待确认
```

Web 和微信小程序优先在端侧处理原图；BLE 继续使用 192 字节分块。服务端只在用户明确使用 Wi-Fi/相册能力时保存被授权的媒体和 `.film` 文件，MQTT 只承载设备状态与指令，不传照片本体。

## 仓库结构

```text
apps/web/                 产品故事页 /studio/ BLE 创作工作台 /device/ 设备工具
apps/wechat/              微信小程序（ES5 兼容）
firmware/penaup/          ESP-IDF v5.5.2 三机型单固件真源
hardware/penaup/          PCB、外壳和历史硬件资料迁移入口
packages/film-core/       film、六色、Profile、transfer 状态契约
server/src/               Fastify + SQLite + SSE + 可选 MQTT
server/admin/             Runtime 管理台
server/migrations/        旧 FastAPI SQLite dry-run / 导入器
legacy/fastapi/           只读回滚与迁移参考，不是新部署入口
compat/framefilm/         旧设备名、广播名、协议和路径兼容说明
docs/                     API、架构、品牌、硬件、协议、法律文档
deploy/                   Caddy、systemd、备份和环境模板
```

源码真源只有新路径一份，不复制第二套固件或 film 实现。`FrameFilm`、`frame_film` 和 `FRAMEFILM_*` 只作为旧设备、旧协议、旧文件和迁移检索词保留。

## 快速开始

仓库根目录提供统一的 Node.js 24 命令入口：

```bash
npm test       # Node 服务、film-core、微信协议测试
npm run check  # JavaScript、Node/film-core 语法与跨端契约检查
npm run check:contracts # 三端 BLE/film、三机型配置、许可证和目录契约
npm run audit  # 官方 npm registry 依赖审计
npm start      # 启动 server/，默认 127.0.0.1:8787
```

固件发布清单由 `npm run firmware:manifest:sign -- --manifest … --private-key … --key-id …`
签名；私钥必须在仓库外的受保护路径，脚本默认只写新文件，不覆盖既有清单。

GitHub Actions 会在 `main` 和审阅分支上重复执行 Node 24 的可复现检查、跨端测试和生产依赖审计；需要本机 ESP-IDF、真实微信 AppID、Caddy、Mosquitto 或设备的严格门禁仍由发布机执行。

发布机器使用 `npm run release:gate`。严格门禁会在本地契约、测试和依赖审计之后继续检查
ESP-IDF `idf.py`、Caddy、Mosquitto 和微信开发者工具；缺少工具、硬件或微信 AppID 权限时会失败，
不会把静态检查当成真机发布证据。

### Web

```bash
cd server
npm install
npm test
npm start
```

Node 运行时固定在 24.x（见 `.node-version`）。如果修改 `packages/film-core/src/`，先运行
`npm run film-core:sync`，再运行 Web/小程序测试；`apps/web/js/film-core.js`、小程序构建文件
和 `packages/film-core/dist/` 都是生成物，不能手工分叉维护。

打开 `http://127.0.0.1:8787/` 查看产品故事页，打开 `/studio/` 进入创作工作台。Web Bluetooth 需要 HTTPS 或 localhost，并需要支持 Web Bluetooth 的 Chromium 系浏览器。部署探针使用 `GET /health`（进程存活）和 `GET /readyz`（SQLite 与媒体目录可读写）。

工作台的“读书”入口是一间小型壁纸实验室：可以把微信读书的本周小票、本月日历、书架标本或单本读书卡排成花生片 Pro 的 3.68 英寸屏保。页面采用偏白糙米色的类纸背景，使用汇文明朝体做本地排版；服务端只做一次性数据转发，浏览器本地完成纸面排版和六色显影。叠色、网点和抖动会让六种物理墨水形成最多 48 种色彩观感，但不会改变 `.film` 的六色协议。Key 不写入仓库或服务端存储。使用前请阅读 [微信读书屏保整合说明](docs/integrations/weread-wallpaper.md) 和 [壁纸实验室设计](docs/plans/2026-08-23-weread-wallpaper-lab-design.md)。

打开 `/device/` 进入浏览器设备工具：它可以读取型号、电量和 Wi-Fi 状态，使用已核实的 BLE 命令清除网络、重启或恢复出厂。命令发送后页面会进入“状态待确认”，只有设备重新广播并成功回读才会结束。固件升级入口会校验 manifest、型号、长度、SHA-256 和签名；当前仓库没有正式 `.bin`，不会把本地构建产物伪装成可刷写发布包。详见 [浏览器固件升级边界](docs/device-tool/firmware-updates.md)。

也可以只托管 `apps/web/`：

```bash
cd apps/web
python3 -m http.server 8080
```

### 微信小程序

在微信开发者工具中打开仓库内的 `apps/wechat/`（项目根目录，不是 `miniprogram/` 子目录）。真实 BLE、相册、真机和上传验证需要已登录的微信开发者工具环境；本地静态检查不能替代真机结论。

### 固件

```bash
cd firmware/penaup
cp sdkconfig_pro sdkconfig
# 编辑 components/film_sys/inc/sys_cfg.h，只启用一个 FRAMEFILM_* 宏
idf.py build
idf.py flash monitor
```

发布前分别使用 `sdkconfig_std`、`sdkconfig_pro`、`sdkconfig_max` 构建 STD、Pro、Max。本机最近一次 ESP-IDF 5.5.2 构建证据与剩余硬件门禁见 [`docs/ops/verification-matrix.md`](docs/ops/verification-matrix.md)。

## 运行时架构

花生片服务端采用面向少量设备和单人维护的模块化单体：Node.js 24、Fastify、SQLite WAL、本地媒体目录、进程内任务队列、SSE 和可选 MQTT 5 桥。它不需要 Redis、PostgreSQL 或必须在线的 broker 才能运行。

认证是邀请制邮箱 challenge；浏览器使用 HttpOnly Secure Cookie + CSRF，小程序/iOS 使用短期 Bearer + refresh token。原图默认私有，单用户媒体配额默认 512 MiB，图片入库前清理 EXIF/文本元数据；生产环境需配置真实邮件 provider、Caddy TLS、明确 CORS、限流、MQTT ACL 和每日备份。

API 与 iOS/Live Activity 状态契约见 [docs/api/README.md](docs/api/README.md) 和 [docs/api/transfer-state.md](docs/api/transfer-state.md)。

## 兼容常量

- BLE 帧头：`0x55`；
- BLE 分块：`192` 字节；
- `.film`：32 字节头 + 每字节两个像素；
- 六色文件值：`00 FF FC E0 03 1C`；EPD 色码：`00 11 22 33 55 66`；
- 文件大小：STD `120032B`、Pro `209120B`、Max `960032B`；
- 已占用命令值不可改；新增命令按协议文档分配；字符串一律 ASCII + `\0`。

## 迁移旧库

先 dry-run，再导入；源库永不删除：

```bash
cd server
npm run migrate:fastapi -- --source-db /path/to/filmhub.db --source-data /path/to/legacy-data --dry-run --json
npm run migrate:fastapi -- --source-db /path/to/filmhub.db --source-data /path/to/legacy-data --target-data ./data --json
```

报告包含表计数、媒体 SHA-256、film 尺寸校验、模板 JSON 和找不到的文件。导入完成并独立验收前，不得删除旧库或旧媒体。

## 许可和权利边界

根目录 [LICENSE](LICENSE) 是 `Poboll Non-Commercial License v1.0`：禁止商业使用、商业部署、收费服务和商业组织内部运营。它只覆盖明确由 `poboll` 新增且没有第三方权利冲突的材料；历史外包代码、`kiritro / GPL-3.0-or-later` 固件、SDK、数据手册、字体、图标和图片不因改名自动归属于 `poboll`。详情见 [docs/legal/provenance.md](docs/legal/provenance.md)，发布前必须完成 [release-checklist.md](docs/legal/release-checklist.md)。

## 提交约定

```text
feat(web): 打磨照片显影流程
fix(firmware): 修复 Pro 版唤醒状态
docs(license): 更新版权来源说明
```
