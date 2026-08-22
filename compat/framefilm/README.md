# FrameFilm 兼容面

`FrameFilm` 不是花生片 Penaup 的新产品展示名。本目录只记录升级时不可随意删除的兼容检索词：

- 固件宏：`FRAMEFILM_STD`、`FRAMEFILM_PRO`、`FRAMEFILM_MAX`；
- 历史 BLE 广播名与 GATT 服务/特征 UUID；
- 已发布 BLE 命令值、NVS key 和 `.film` 32B 头部；
- 旧目录、外包交付和历史协议文档中的搜索线索。

物理源码真源只有 `firmware/penaup/`，不要在这里复制固件或 film 实现。修改协议或颜色时，必须同步 C 固件、`apps/wechat/`、`apps/web/`、`packages/film-core/` 和 `docs/blecmd/`。

历史权利边界见 [docs/legal/provenance.md](../../docs/legal/provenance.md)。

## 物理目录迁移

历史硬件资料已经移入新仓库的明确回滚边界，避免与花生片的新设计混在同一层：

| 旧路径 | 当前路径 | 处理方式 |
|---|---|---|
| `hardware/penaup/model/FrameFilm/` | `hardware/penaup/legacy/model/framefilm/` | 保留原始 CAD/面板文件名与来源 |
| `hardware/penaup/model/FrameFilmPro/` | `hardware/penaup/legacy/model/framefilm-pro/` | 保留原始 Pro 交付材料 |
| `hardware/penaup/pcb/FrameFilm/` | `hardware/penaup/legacy/pcb/framefilm/` | 保留历史原理图 PDF |
| `hardware/penaup/pcb/FrameFilmPro/` | `hardware/penaup/legacy/pcb/framefilm-pro/` | 保留历史 Pro 原理图 PDF |

这些文件的移动不改变协议、固件或硬件权利边界；引用旧路径的脚本和交付记录应按上表更新，用户-facing 产品文案仍只使用“花生片 Penaup”。
