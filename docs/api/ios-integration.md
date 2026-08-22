# Penaup iOS 接入契约

> Copyright (c) 2026 poboll · 这是 API、BLE 和 Live Activity 的接入说明，不是当前仓库内的 iOS 工程。

## 1. 接入边界

`PenaupApp`（或其他原生客户端）与 Web、微信小程序共用同一套服务端 transfer 状态。照片优先在 iOS 端裁切、六色化和生成 `.film`，BLE 直连设备；只有用户选择 Wi-Fi 相册、跨设备同步或历史记录时，才上传经过授权的媒体或 `.film`。

六色是文件和 EPD 的基础索引，不是最终画面的颜色上限。叠色、网点和抖动可以让六种基础颜料形成最多 48 种色彩观感；iOS 预览应复用同一套六色契约，不能新增固件色码或把 48 种观感写成 48 种独立墨水。

当前服务端没有 APNs 远程 Live Activity 更新桥。应用在前台或有活动的连接时，可以用 SSE 驱动本地 Live Activity；进入后台后必须依靠系统允许的活动生命周期，并在恢复时重新查询 transfer。未来接入 APNs 时，推送 payload 仍必须遵守本文件的字段和隐私边界。

## 2. API 基础约定

生产地址由部署环境提供，例如 `https://penaup.example.com`；本地开发使用 `http://127.0.0.1:8787`。完整请求/响应定义见 [openapi.yaml](openapi.yaml)。所有时间使用 ISO 8601 UTC 字符串，所有 `*_bytes` 是非负整数，`progress_hint` 范围为 `0...1`。

### 登录与令牌

1. `POST /api/v1/auth/challenges` 提交邮箱和可选邀请令牌。challenge 默认 10 分钟过期、最多尝试 5 次，并按邮箱/IP 限流。
2. `POST /api/v1/auth/verify` 提交 `challenge_id` 和六位验证码。响应返回 `access_token`（默认 15 分钟）与 `refresh_token`（默认 30 天）。
3. iOS 将 refresh token 放进 Keychain；access token 只放内存或受保护的短期会话对象，不写日志、不放 URL、不放 Live Activity。
4. access token 失效时调用 `POST /api/v1/auth/refresh`。原生 Bearer 请求可以直接携带 refresh token；不要为了 iOS 接入浏览器 Cookie 或 CSRF token。
5. refresh token 轮换成功后立即替换 Keychain 中的旧值。注销调用 `POST /api/v1/auth/logout`，随后清理本地令牌和活动状态。

Swift 请求骨架：

```swift
struct TokenResponse: Decodable {
    let access_token: String
    let refresh_token: String
    let token_type: String
    let expires_at: Date
    let refresh_expires_at: Date
}

func makeRequest(_ url: URL, accessToken: String, method: String = "GET") -> URLRequest {
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    return request
}
```

实际工程应使用 `JSONDecoder.dateDecodingStrategy` 解析服务端时间，并对 401 做一次受控 refresh 重试；不能无限重试，也不能把验证码或令牌放进错误消息。

## 3. Transfer 生命周期

客户端状态枚举必须保持原始字符串：

```swift
enum TransferPhase: String, Codable {
    case idle, preparing, discovering, connecting, handshaking
    case transferring, refreshing, succeeded, failed
    case deviceStateUncertain = "device_state_uncertain"
}

enum TransferOutcome: String, Codable {
    case pending, success, failure, uncertain
}

struct TransferEvent: Codable, Identifiable {
    let transfer_id: String
    let device_id: String
    let phase: TransferPhase
    let completed_bytes: Int
    let total_bytes: Int
    let progress_hint: Double
    let outcome: TransferOutcome
    let detail: String
    let updated_at: Date
    let card_title: String
    let rendering_detail: String

    var id: String { transfer_id }
}
```

推荐的用户旅程是：

```text
idle → preparing → discovering → connecting → handshaking
     → transferring → refreshing → succeeded
                                      ↘ device_state_uncertain
任意非终态 ─────────────────────────→ failed
```

- `preparing`：相纸已经落入画布，开始准备 `.film`。
- `discovering` / `connecting` / `handshaking`：扫描、连接和协议握手。
- `transferring`：按设备协议写入；BLE 分块固定为 192 字节。
- `refreshing`：写入结束，等待 EPD 刷新确认。
- `succeeded`：只有可信设备桥接层确认刷新后才能进入。
- `device_state_uncertain`：写入可能完成但没有可信刷新回执。界面必须显示“已写入，等待刷新确认”，不能显示成功或自动重发。
- `failed`：保留原图、`.film` 和草稿；只有这个状态可以调用 retry API 创建新的 transfer。

服务端的 `POST /api/v1/transfers/:id/events` 适合上报客户端能证明的阶段，例如本地裁切、扫描、连接和传输进度。客户端不能用这个接口把状态写成 `succeeded`；服务端会返回 `device_confirmation_required`。

## 4. SSE 实时状态

使用带 Bearer header 的 `GET /api/v1/events/stream`。不要使用把 token 拼到 URL 的 `EventSource`，因为 URL 容易进入代理、历史和日志；iOS 应使用 `URLSession` 请求流，或在旧系统上使用 `URLSessionDataDelegate`。

服务端连接成功后先发送注释：

```text
: penaup connected

```

事件格式：

```text
event: transfer.updated
data: {"type":"transfer.updated","payload":{"transfer":{...},"userId":7},"at":"2026-08-22T12:00:00.000Z"}

```

只消费 `payload.transfer`，并校验 `transfer_id`、`device_id` 和当前用户归属。服务端每 15 秒发送 `: keep-alive` 注释；注释不是业务事件。服务端当前不提供 `Last-Event-ID` 重放，因此断线恢复必须执行：

1. 以指数退避重连（建议 1、2、4、8、16、30 秒，网络恢复后归零）。
2. 对本地仍在进行的每个 transfer 调用 `GET /api/v1/transfers/:id`。
3. 以服务端 `updated_at` 较新的状态覆盖本地状态。
4. 如果本地停在 `refreshing` 且查询仍没有可信确认，保持 `device_state_uncertain` 的谨慎文案，不猜测成功。

流解析应按空行切分 SSE record，支持多行 `data:` 拼接，并忽略未知事件类型。不要把大图、原图 URL、令牌、Wi-Fi 地址或 MQTT payload 放进事件或本地 Live Activity。

## 5. Live Activity 映射

Live Activity 只展示脱敏的阶段信息：设备显示名、阶段短文案、进度和“重新连接/查看详情”入口。照片本体与 access/refresh token 永远不进入 `ActivityAttributes`、推送 payload、日志或锁屏快照。

一个最小的 ActivityKit 模型可以保持如下字段：

```swift
struct PenaupTransferAttributes: ActivityAttributes {
    public let transferID: String
    public let deviceLabel: String

    public struct ContentState: Codable, Hashable {
        public let phase: TransferPhase
        public let outcome: TransferOutcome
        public let progress: Double
        public let detail: String
        public let updatedAt: Date
    }
}
```

映射规则：

| 阶段 | Activity 表现 | 可执行动作 |
|---|---|---|
| `preparing` 至 `handshaking` | 准备中 / 连接中 | 查看工作台、取消本地任务 |
| `transferring` | 写入相纸 + 进度 | 查看详情 |
| `refreshing` | 电子纸正在刷新 | 等待，不显示完成 |
| `succeeded` | 已完成 | 查看相纸 |
| `failed` | 显影失败，原稿仍在 | 返回工作台重试 |
| `device_state_uncertain` | 已写入，等待刷新确认 | 重新连接、查看设备；禁止直接重发 |

进度只使用 `progress_hint` 作为视觉提示，不把它当作硬件确认。`total_bytes == 0` 时显示阶段文案而不是除零或虚假的百分比；进度应限制在 `0...1`。活动内容过期后仍要通过 transfer 查询接口恢复，而不是依赖锁屏卡片本身。

## 6. BLE 与 film 兼容

原生 BLE 端必须以 [BLE 协议](../blecmd/blecmd_protocol.md) 和 [film 格式](../film/film.md) 为准：

- 帧头 `0x55`，已有命令值不可改；新增命令从协议文档分配；
- 数据分块 `BLE_CHUNK_SIZE = 192`；
- film 头为 32 字节，像素每字节两个四位索引；
- 文件索引只允许 0..5，基础色为黑、白、黄、红、蓝、绿；
- STD / Pro / Max 的尺寸、旋转规则和总大小必须按 profile 选择；
- 48 种色彩观感来自端侧算法的叠色、网点和抖动，不能把额外颜色写进 film nibble。

建议把 `packages/film-core/test/` 的 profile、颜色表、尺寸和非法 nibble 用例移植为 Swift fixture。每次协议改动必须同时更新固件、Web、小程序和 iOS fixture，并在真实设备上覆盖三种机型。

## 7. 错误与恢复

| HTTP / 状态 | 客户端处理 |
|---|---|
| `401 authentication_required` | refresh 一次；失败则清理会话并回登录页 |
| `403 csrf_required` | 说明请求误用了 Cookie；iOS 改用 Bearer，不要复制浏览器 CSRF 流程 |
| `404 device_not_found` / `media_not_found` | 清理失效选择，不重试原请求 |
| `409 device_confirmation_required` | 保留 `device_state_uncertain`，要求用户重新连接或查看设备 |
| `409 transfer_not_retryable` | 先查询最新 transfer，再决定动作 |
| `429 challenge_rate_limited` | 显示冷却时间，不循环请求验证码 |
| `5xx` / 网络断开 | 保留本地 `.film` 草稿，退避重试；恢复后查询服务端状态 |

本地 BLE 在 `FILE_STOP` 后没有拿到刷新确认时，必须落到 `device_state_uncertain`。只有设备状态回执、设备 ID 归属和当前 transfer 三者都匹配，才允许结束 Live Activity 为 `succeeded`。

## 8. 接入验收

- Keychain 中只保存 refresh token，日志、URL、Activity 和截图中没有令牌或原图。
- 断网、SSE 断开、杀掉并重启 App 后，能够用 transfer 查询恢复状态。
- `device_state_uncertain` 在 Web、微信和 iOS 都不显示成功，并且不会自动重发。
- 同一张照片在 STD、Pro、Max 上都生成合法 film；192 字节分块与 BLE 校验通过。
- Reduced Motion 开启时，Live Activity 和 App 内显影仍提供阶段、进度、错误和可恢复动作，只减少非必要动画。
- 真实设备验证完成前，不把模拟器或 SSE 收到的 `refreshing` 当成硬件刷新成功。
