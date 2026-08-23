# Penaup 固件发布目录

这个目录有意不包含任何 `.bin`。`build/` 里的 ESP-IDF 构建产物不是发布固件，也不能直接被浏览器刷写。

正式包必须成对提供：

```text
penaup-pro-v1.0.0.bin
penaup-pro-v1.0.0.manifest.json
```

清单必须符合 [manifest.schema.json](./manifest.schema.json)，并由发布流程补充 `published` 状态、Ed25519 签名和受网页固定的 `poboll` 公钥。只有型号、BLE 协议、文件长度、SHA-256 和签名都通过，浏览器设备工具才会开启刷写按钮。

本目录不把本地构建结果伪装成正式发布包。生成草稿清单：

```bash
node scripts/create-firmware-manifest.mjs \
  --file firmware/penaup/build/penaup.bin \
  --model PENAUP_PRO \
  --version v0.1.0 \
  --output /tmp/penaup-pro.manifest.json
```

草稿只用于核对长度和哈希，不能直接刷写。
