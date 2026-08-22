# Penaup 编码与协作约定

## 品牌和版权

- 用户界面、文档和新代码使用 `花生片 Penaup`；
- `FrameFilm` 只用于旧设备名、旧路径、旧协议兼容和迁移搜索；
- 新重写内容使用 `Copyright (c) 2026 poboll`；
- 未完成外包合同和第三方依赖核对前，不覆盖原作者和第三方许可声明；
- 根许可证禁止商业使用，发布时不得称为 GPL 或 OSI 开源。

## 语言与命名

| 端 | 语言 | 文件/函数 | 常量 |
|---|---|---|---|
| 固件 | C | `snake_case` | `UPPER_CASE`，全局变量 `g_` |
| 小程序 | ES5 JS | `camelCase`，文件 `kebab-case` | `UPPER_CASE` |
| Web | ES6 JS | `camelCase` | `UPPER_CASE` |
| Node 运行时 | Node.js ESM | `camelCase`，模块按职责拆分 | `UPPER_CASE` |

## 固件分层

```text
film_service -> film_hal -> film_sys -> ESP-IDF
```

禁止 service 直接操作 GPIO，禁止在 service 层直接初始化 ESP-IDF driver。机型差异必须覆盖 `FRAMEFILM_STD`、`FRAMEFILM_PRO` 和 `FRAMEFILM_MAX`，除非文档明确说明某项硬件不存在。

## 跨端协议

修改 BLE 命令、film 颜色、屏幕尺寸或文件头时，必须同步检查：

- `service_ble.h`；
- `apps/wechat/miniprogram/utils/ble-utils.js`；
- `apps/web/js/frame.js`；
- `apps/wechat/miniprogram/utils/film-utils.js`；
- `apps/web/js/convert.js`；
- `docs/blecmd/blecmd_protocol.md` 和 `docs/film/film.md`。

## UI 设计约定

使用“纸张 × 六色电子纸”设计系统：暖白背景、墨黑文字、六色强调、细线、章节号、等宽规格标记。交互状态必须有空态、加载态、失败态、重试动作和成功反馈；动画需尊重减少动态偏好，传图进度不能只靠动画伪造。

## Git

提交使用中文：`type(scope): 描述`。提交前检查完整 diff、协议三端一致性、密钥和私有文件，并按改动范围运行构建、测试和视觉检查。
