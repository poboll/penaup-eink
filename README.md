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
apps/web/                 产品故事页 /studio/ BLE 创作工作台
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
npm run check  # 76 个 JS 文件 + Node/film-core 语法检查
npm run audit  # 官方 npm registry 依赖审计
npm start      # 启动 server/，默认 127.0.0.1:8787
```

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

发布前分别使用 `sdkconfig_std`、`sdkconfig_pro`、`sdkconfig_max` 构建 STD、Pro、Max。当前机器若缺少 ESP-IDF/`idf.py`，只能记录为待验证门，不能声称三机型构建通过。

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
