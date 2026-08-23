# Penaup 固件发布目录

这个目录有意不包含任何 `.bin`。`build/` 里的 ESP-IDF 构建产物不是发布固件，也不能直接被浏览器刷写。

正式包必须成对提供：

```text
penaup-pro-v1.0.0.bin
penaup-pro-v1.0.0.manifest.json
```

清单必须符合 [manifest.schema.json](./manifest.schema.json)，并由发布流程补充 `published` 状态、Ed25519 签名和受网页固定的 `poboll` 公钥。只有型号、BLE 协议、文件长度、SHA-256 和签名都通过，浏览器设备工具才会开启刷写按钮。
网页还会用 `apps/web/js/firmware-manifest.js` 重新执行字段类型、版本、机型、文件名和签名形状校验；不能只依赖发布人本地的 JSON Schema 检查。

本目录不把本地构建结果伪装成正式发布包。生成草稿清单：

```bash
node scripts/create-firmware-manifest.mjs \
  --file firmware/penaup/build/penaup.bin \
  --model PENAUP_PRO \
  --version v0.1.0 \
  --output /tmp/penaup-pro.manifest.json
```

草稿只用于核对长度和哈希，不能直接刷写。

签名必须在受保护的发布环境中完成。私钥放在仓库之外（或由密钥管理器临时提供），签名脚本只读取它，默认不覆盖任何文件：

```bash
node scripts/sign-firmware-manifest.mjs \
  --manifest /tmp/penaup-pro.manifest.json \
  --private-key /secure/poboll/penaup-release-ed25519.pem \
  --key-id poboll-release-2026 \
  --output /tmp/penaup-pro-v1.0.0.manifest.json
```

脚本把 `draft` 转为 `published`，签署固定消息
`penaup-firmware-v1:<sha256>`，并使用 `flag: wx` 防止误覆盖输入或既有发布清单。
它不会读取、复制或生成 `.bin`，也不会把私钥、公钥写入仓库；签名之前应由发布人确认
清单中的固件 SHA-256 与待发布镜像一致。
