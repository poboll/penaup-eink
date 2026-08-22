# Transfer State Contract

> Copyright (c) 2026 poboll · 供 Web、微信小程序、Node 和未来 `PeanupApp` 共用。

## 阶段

```text
idle
preparing
discovering
connecting
handshaking
transferring
refreshing
succeeded
failed
device_state_uncertain
```

`device_state_uncertain` 是有意保留的终态：数据可能已经写入设备，但客户端没有拿到可信的电子纸刷新确认。任何端都不能把它显示成“成功”。用户应看到“已写入，等待刷新确认”，可以重新连接或查询设备；不能在没有观察设备画面前自动重发同一张相纸。只有明确的 `failed` 状态才允许通过 retry API 创建新的传输。

## 事件格式

```json
{
  "transfer_id": "tr_01",
  "device_id": "penaup-pro-01",
  "phase": "transferring",
  "completed_bytes": 98304,
  "total_bytes": 209120,
  "progress_hint": 0.47,
  "outcome": "pending",
  "detail": "正在写入六色相纸",
  "updated_at": "2026-08-22T12:00:00.000Z",
  "card_title": "花生片正在显影",
  "rendering_detail": "黑、白、红、黄、蓝、绿"
}
```

`progress_hint` 是 UI 提示值，不是设备确认；`completed_bytes` 在协议能计算时使用实际已发送字节；`updated_at` 由服务端写入最终持久化记录。`outcome` 使用 `pending`、`success`、`failure`、`uncertain`；`device_state_uncertain` 必须映射为 `uncertain`，不能沿用普通进行中的 `pending`。

当前用户侧 `POST /api/v1/transfers/:id/events` 不接受直接写入 `succeeded`，会返回 `device_confirmation_required`。只有未来设备桥接层拿到可信 EPD 刷新回执后，才能进入 `succeeded`；客户端不能靠进度值或 `FILE_STOP` 自行伪造成功。

## Swift 映射建议

```swift
enum TransferState: String, Codable {
    case idle, preparing, discovering, connecting, handshaking
    case transferring, refreshing, succeeded, failed
    case deviceStateUncertain = "device_state_uncertain"
}
```

Live Activity 的锁屏卡片只显示 `card_title`、阶段文案和 `progress_hint`。进入 `succeeded` 前必须同时满足：BLE/HTTP 写入完成、设备刷新确认可用、`device_id` 仍属于当前用户。断联、超时、未知固件回执统一进入 `device_state_uncertain`，而不是猜测成功。
