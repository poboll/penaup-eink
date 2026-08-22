# Penaup MQTT 部署模板

> Copyright (c) 2026 poboll · 示例不包含真实密码或生产证书。

这里提供 Mosquitto 的最小生产边界：本机 Node bridge 使用回环 listener，设备使用 TLS listener；
桥接账号可以读所有设备状态并写所有设备指令，设备账号只能访问自己的两个 topic。HTTP 心跳返回的
device token 仍然是设备身份的第二层校验，MQTT ACL 不能替代它。

## 部署顺序

1. 安装 Mosquitto，把 [`mosquitto.conf.example`](mosquitto.conf.example) 合并到 `/etc/mosquitto/`；
2. 为 Node bridge 和每台设备分别创建密码：

   ```bash
   sudo mosquitto_passwd -c /etc/mosquitto/passwd penaup-bridge
   sudo mosquitto_passwd /etc/mosquitto/passwd penaup-device-EXAMPLE
   ```

3. 将 [`penaup.acl.example`](penaup.acl.example) 复制为 `/etc/mosquitto/penaup.acl`，把示例设备名替换成真实设备 ID；
4. 为公网 TLS listener 配置真实证书，并确认 8883 只接受 TLS；
5. 服务端使用回环地址时配置 `PENAUP_MQTT_URL=mqtt://127.0.0.1:1883`、bridge 用户名和密码；
6. 每次新增设备都新增一条精确 ACL，禁止把 `penaup/device/+/state` 或 `penaup/device/+/command` 授予设备账号。

照片和原图不进入 MQTT。状态 payload 仍必须携带 HTTP 心跳返回的 token；设备 token 失效时，Node bridge
丢弃 MQTT 状态并保留最后一个可信状态。
