export class EventHub {
  constructor() {
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, payload) {
    const event = { type, payload, at: new Date().toISOString() };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 一个断开的 SSE 客户端不能影响设备状态广播。
      }
    }
    return event;
  }
}
