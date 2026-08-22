# FrameFilm 兼容面

`FrameFilm` 不是花生片 Penaup 的新产品展示名。本目录只记录升级时不可随意删除的兼容检索词：

- 固件宏：`FRAMEFILM_STD`、`FRAMEFILM_PRO`、`FRAMEFILM_MAX`；
- 历史 BLE 广播名与 GATT 服务/特征 UUID；
- 已发布 BLE 命令值、NVS key 和 `.film` 32B 头部；
- 旧目录、外包交付和历史协议文档中的搜索线索。

物理源码真源只有 `firmware/penaup/`，不要在这里复制固件或 film 实现。修改协议或颜色时，必须同步 C 固件、`apps/wechat/`、`apps/web/`、`packages/film-core/` 和 `docs/blecmd/`。

历史权利边界见 [docs/legal/provenance.md](../../docs/legal/provenance.md)。
