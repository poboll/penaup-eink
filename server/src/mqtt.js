import mqtt from 'mqtt';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMqttBridge(config, options = {}) {
  const onState = typeof options === 'function' ? options : options.onState;
  if (!config.mqttUrl) {
    return {
      enabled: false,
      connected: false,
      getStatus: () => ({ enabled: false, connected: false, lastError: '' }),
      publishCommand: async () => false,
      close: async () => undefined
    };
  }

  const client = mqtt.connect(config.mqttUrl, {
    username: config.mqttUsername || undefined,
    password: config.mqttPassword || undefined,
    reconnectPeriod: 3000,
    clientId: `penaup-runtime-${process.pid}`
  });
  const stateTopic = `${config.mqttTopicPrefix}/+/state`;
  const topicPattern = new RegExp(`^${escapeRegExp(config.mqttTopicPrefix)}/([^/]+)/state$`);
  let connected = false;
  let lastError = '';

  client.on('connect', () => {
    connected = true;
    lastError = '';
    client.subscribe(stateTopic);
  });
  client.on('close', () => {
    connected = false;
  });
  client.on('error', (error) => {
    connected = false;
    lastError = error instanceof Error ? error.message : String(error || 'mqtt_error');
  });
  client.on('message', (topic, message) => {
    const match = topic.match(topicPattern);
    if (!match || typeof onState !== 'function') return;
    try {
      onState(decodeURIComponent(match[1]), JSON.parse(message.toString('utf8')));
    } catch {
      // 忽略损坏的设备事件，HTTP 心跳仍然是可靠状态来源。
    }
  });

  return {
    enabled: true,
    get connected() {
      return connected;
    },
    getStatus() {
      return { enabled: true, connected, lastError };
    },
    publishCommand(deviceId, command) {
      const topic = `${config.mqttTopicPrefix}/${encodeURIComponent(deviceId)}/command`;
      return new Promise((resolve) => {
        client.publish(topic, JSON.stringify(command), { qos: 1 }, (error) => resolve(!error));
      });
    },
    close() {
      return new Promise((resolve) => client.end(false, {}, resolve));
    }
  };
}
