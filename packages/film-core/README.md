# `@penaup/film-core`

花生片 Penaup 的 `.film` 唯一 JavaScript 契约源。

这里集中维护：

- STD / Pro / Max 的文件尺寸、画布尺寸和像素布局；
- 32 字节头、六色表、像素 nibble 打包与严格校验；
- BLE 192 字节分块常量；
- Web、小程序、Node 和未来 `PeanupApp` 共用的传输状态事件。

固件仍以 `firmware/penaup/components/film_hal/inc/hal_epd.h` 和三份驱动为 C 侧真源；修改 `.film` 时必须同步更新固件、本文包和回归测试。

小程序使用 `dist/film-core.umd.js` 的 ES5 生成产物。生成产物由同一份契约源构建，不能直接手工修改。
