# Penaup 硬件资料

本目录保存花生片的 PCB 原理图、外壳模型、面板工程和芯片/屏幕数据手册。

## 目录

- `penaup/legacy/pcb/`：接管时收到的 STD、Pro 与历史 FrameFilm 板卡资料；
- `penaup/legacy/model/`：接管时收到的外壳、按键、面板和 3D 打印模型；
- `../docs/datasheet/`：仅作设计参考，不能替代样机实测；
- `../docs/hardware/hardware_spec.md`：当前机型和引脚对照。

## 交付边界

当前仓库没有把历史 CAD/EDA 文件宣称为新的 `poboll` 原创设计。发布硬件文件前要核对：屏幕型号、双面板 CS、BUSY 时序、供电、磁吸结构和连接器规格。外部 EDA 工程、厂商模型和数据手册按原始许可分发，不自动归入 `poboll` 版权。

`hardware/penaup/legacy/` 只保存历史交付材料，不是固件、film 或生产 PCB 的源码真源；物理目录迁移记录见 [`compat/framefilm/README.md`](../compat/framefilm/README.md)。
