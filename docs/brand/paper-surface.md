# 花生片 Penaup 类纸表面

> Copyright (c) 2026 poboll · `LicenseRef-Poboll-NonCommercial`

花生片的网页背景采用偏白的糙米纸，而不是压暗的灰麻色。它只负责承接内容，不抢走标题、六色显影和设备预览的注意力。

## 视觉规则

- 页面底色以 `#FAF7EF` 为中心，顶部保留 `#FFFDF8` 的纸面高光，底部落到很浅的 `#F5EFE5`；
- 纹理由横纵低对比纤维和 CSS 噪点组成，不加载外部图片、不依赖第三方纹理包；
- 纸面纹理的透明度保持在低位，正文与按钮的对比度优先于“看起来像纸”；
- 相纸预览单独增加细纤维层，显影扫描线只在生成/显影期间出现；
- 六色只作为小面积提示色：墨黑、纸白、红、黄、蓝、绿；“最多 48 种色彩观感”来自叠色、网点和抖动，不表示有 48 种独立墨水；
- 汇文明朝体 Web 子集用于标题和屏保排版，技术信息使用等宽字体，正文使用系统无衬线字体。

## 跨页面 token

| Token | 值 | 用途 |
| --- | --- | --- |
| `--penaup-paper-white` | `#FFFDF8` | 纸面高光、主要卡片 |
| `--penaup-paper-ivory` | `#FAF7EF` | 页面主背景 |
| `--penaup-paper-rice` | `#F5EFE5` | 纸面阴影与预览底 |
| `--penaup-paper-ink` | `#292722` | 正文与主要操作 |
| `--penaup-paper-blue` | `#416F99` | 进行中、链接、状态 |
| `--penaup-paper-yellow` | `#D4A52E` | 显影、提醒、重点 |

Web 的真源是 `apps/web/css/paper-surface.css`。它在故事页、工作台和设备工具上最后加载，统一覆盖背景、焦点轮廓、标题字体、触控尺寸和相纸纹理；减少动态时关闭噪点和扫描动画。微信小程序对应真源是 `apps/wechat/miniprogram/styles/paper-surface.wxss`，由 `app.wxss` 全局引入；它使用同一组浅糙米色与纤维渐变，不把模板页退回旧的灰麻色。

## 参考边界

视觉研究参考了 [Sodamax778/expert-eureka](https://github.com/Sodamax778/expert-eureka) 的浅纸面方向和“阅读数据 → 固定模板 → 导出”的流程。Penaup 只吸收可泛化的产品语言，没有复制其代码、素材或依赖；上游项目许可证变化不能替代本仓库的版权与来源核验。

## 验收

- 360、390、768、1440px 页面不出现横向滚动；
- 主要按钮高度不小于 50px，移动端读书实验室操作按钮不小于 54px；
- `prefers-reduced-motion: reduce` 下不显示持续噪点和扫描动画；
- 视觉纹理不进入 `film-core` 的颜色协议，屏保仍固定使用六色索引。
