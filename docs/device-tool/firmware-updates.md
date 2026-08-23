# 花生片 Penaup 浏览器固件升级边界

> Copyright (c) 2026 poboll
> SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial

## 目标

设备工具为第一版固件预留了浏览器 BLE OTA。它只使用已经在固件中核实的链路：

```text
OTA_LEN (0x10) → OTA_DATA (0x11 × N) → OTA_STOP (0x13)
```

`OTA_LEN` 的 DATA 是大端序 `uint32`，`OTA_DATA` 每块最多 192 字节。`OTA_STOP` 会把镜像交给设备 OTA 服务校验并触发重启；网页写入完成不等于设备升级完成。

固件端还会拒绝零长度、超过 OTA 分区、超过声明长度或少于声明长度的镜像；不满足长度契约时会中止当前 OTA 并重启，不会把不完整镜像设为启动分区。

## 浏览器行为

`/device/` 设备工具会依次检查：

1. 清单 schema、产品名、`published` 状态、型号和 `ble-v1` 协议；
2. `.bin` 文件名、实际长度和清单中的长度；
3. 浏览器本地计算的 SHA-256；
4. 清单中的 Ed25519 签名、`key_id` 和签名消息；
5. 当前设备重新广播后，至少成功回读一次电量响应。

第 5 步之前，页面只能显示“固件已写入，等待重新广播与状态确认”，不能显示“升级成功”。传输中断、设备断开或回读超时都进入 `device_state_uncertain`，用户可以重新连接并确认。

## 发布包格式

正式发布包由一个 `.bin` 和一个清单组成，清单遵循 [manifest.schema.json](../../firmware/penaup/releases/manifest.schema.json)。草稿可以由仓库脚本生成：

```bash
node scripts/create-firmware-manifest.mjs \
  --file firmware/penaup/build/penaup.bin \
  --model PENAUP_PRO \
  --version v0.1.0 \
  --output /tmp/penaup-pro.manifest.json
```

脚本只生成 `release_status: draft` 和 SHA-256，不负责签名。仓库当前没有真实的正式 `.bin`，也没有把构建目录产物宣称为可发布固件。

签名由仓库内的独立脚本完成，但私钥必须来自仓库之外的受保护路径；脚本不会覆盖输入清单：

```bash
node scripts/sign-firmware-manifest.mjs \
  --manifest /tmp/penaup-pro.manifest.json \
  --private-key /secure/poboll/penaup-release-ed25519.pem \
  --key-id poboll-release-2026 \
  --output /tmp/penaup-pro-v1.0.0.manifest.json
```

它只签署清单声明的 `sha256`，固定消息为 `penaup-firmware-v1:<sha256>`，不会读取或复制
`.bin`，也不会把私钥、公钥写入仓库。签名环境必须先独立核对清单哈希与目标 app image；
没有真实固件、受保护私钥和三机型真机验收时，不能把清单标成可发布。

发布系统需要在脱离网页的受控环境中：

- 固定三机型构建配置和 ESP-IDF 版本；
- 校验构建产物确实是目标 app image，而不是 bootloader、partition table 或测试文件；
- 由受保护的 poboll 发布密钥签署 `penaup-firmware-v1:<sha256>` 消息；
- 将清单从 `draft` 改为 `published`，并记录 key id；
- 将公钥固定到发布网页构建配置，不能从用户上传的清单中读取公钥；
- 在真实 STD / Pro / Max 样机上完成重连、版本回读、启动和 EPD 刷新验收。

当前静态网页没有配置发布公钥，因此即使用户选择了一个自制 `published` 清单，刷写按钮仍保持锁定。这是安全门禁，不是缺失功能。

## USB / Web Serial

页面只探测浏览器是否提供 Web Serial，不执行串口刷写。仓库没有被核实的 USB bootloader 地址、握手、分区布局或恢复协议；猜测这些值可能造成不可逆的砖机风险。等硬件和 bootloader 资料完整后，应另立协议实现和真机验收，不要把 Web Serial 当成 BLE OTA 的替代品。

## 失败处理

- 不要在 OTA 过程中切换设备、刷新页面或断电；
- `OTA_STOP` 后设备可能暂时不可见，等待自动重连或点击“重新连接并确认”；
- 只有型号、电量回读和连接都恢复，才结束状态待确认；
- 微信小程序设置页使用同一状态语义：`OTA_STOP` 后保留待确认会话，断开期间不清空状态，重新连接后以电量回读完成确认；
- 任何“不确定”都不应被 iOS Live Activity、微信小程序或 Web 传输卡片渲染成成功；
- 如果刷写中途断开，不要连续重复写入同一个镜像，先确认设备是否已回到正常固件或进入恢复模式。

## 相关协议

- [BLE 完整协议](../blecmd/blecmd_protocol.md)
- [设备硬件规格](../hardware/hardware_spec.md)
- [发布前检查](../legal/release-checklist.md)
