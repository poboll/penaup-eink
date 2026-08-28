# Penaup 纸膜与工作台收口 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将花生片首页与工作台统一为浅白纸膜视觉，修正 Hero 三层机械拆解在短桌面视口的裁切，并让手机与桌面端的按钮、滚动和工作流保持一致。

**Architecture:** 保留现有静态 HTML、原生 JavaScript、CSS 多页面架构与 Penaup film/BLE 契约。新增一层最终视觉覆盖，集中修正已存在的历史样式冲突；页面用 CSS 纤维线稿与渐变绘制纸面，不新增远程资源。桌面端由 `#page-content` 承担唯一内容滚动，移动端回到页面自然滚动，滚动条仅视觉隐藏。

**Tech Stack:** HTML5, CSS3, 原生 ES6, Node.js 24, Playwright in-app browser, npm test/check/audit.

---

### Task 1: 固化增量设计与参考边界

**Files:**
- Create: `docs/plans/2026-08-28-paper-film-workbench-closure.md`
- Reference: `apps/web/css/penaup-paper-finish.css`, `apps/web/css/studio-responsive.css`

**Step 1:** 记录本轮视觉目标、参考站点提取的白色面板/细边线/轻阴影原则，以及不复制第三方资源的边界。

**Step 2:** 在当前分支提交计划文档，并推送到 `codex/penaup-eink-rebuild`。

### Task 2: 重做纸膜表面与滚动层

**Files:**
- Modify: `apps/web/css/penaup-paper-finish.css`
- Modify: `apps/web/css/studio-responsive.css`

**Step 1:** 移除最终级联中的高频圆点/高对比 fractal 噪声，改为低对比度、低频的纤维曲线与方向性压纹。

**Step 2:** 隐藏 `html`、`body`、`#page-content` 与调试滚动容器的滚动条，同时保留键盘、触控板和触摸滚动；取消会制造额外横向空白的稳定滚动槽。

**Step 3:** 统一纸面面板的白度、边线、阴影、按钮圆角和 focus ring，确保文本仍达到可读对比度。

### Task 3: 收紧 Hero 机械式三层拆解

**Files:**
- Modify: `apps/web/css/penaup-paper-finish.css`

**Step 1:** 将桌面 Hero 结构板压缩到 480px 左右，并把底部说明纳入绘图区的安全区域。

**Step 2:** 分别增强显影面、控制层、背板的边缘/线稿/阴影层级，保持 528:792 竖向比例且不恢复实物图或圆形光环。

**Step 3:** 给 1280×720、1024×768、390×844、360×800 配置独立安全间距与缩放规则，避免标签、引导线和底部说明互相覆盖。

### Task 4: 打磨工作台桌面与手机布局

**Files:**
- Modify: `apps/web/css/penaup-paper-finish.css`
- Modify: `apps/web/css/studio-responsive.css`

**Step 1:** 统一顶部栏、进度条、工作台页签、预览纸张、表单、网络配置和设备工具入口的面板语言。

**Step 2:** 修正按钮在 grid/flex 中的 `min-width: 0`、伸展、换行与图标基线，保证英文协议标签不会撑破中文按钮。

**Step 3:** 桌面端维持单一内容滚动区，手机端保持自然页面滚动与底部导航安全区，覆盖 360/390px 窄屏。

### Task 5: 浏览器与自动化验证

**Files:**
- Modify: `apps/web/test/paper-finish-contract.test.mjs`（仅在契约缺口时）

**Step 1:** 在 1280×720、1024×768、390×844、360×800 视口重新加载首页和工作台，检查 DOM、截图、横向溢出、关键按钮 bounding box 与控制台日志。

**Step 2:** 验证开屏跳过、工作台四页签、读书入口、字体选择仍可用；验证 `prefers-reduced-motion` 与键盘 focus。

**Step 3:** 运行 `npm test`、`npm run check`、`npm run audit`，提交实现并推送当前分支；不修改 `main`。
