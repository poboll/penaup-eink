/*
 * Copyright (c) 2026 poboll
 * SPDX-License-Identifier: LicenseRef-Poboll-NonCommercial
 */

export class TaskQueue {
  constructor({ concurrency = 1, maxSize = 100 } = {}) {
    this.concurrency = Math.max(1, Math.trunc(Number(concurrency) || 1));
    this.maxSize = Math.max(1, Math.trunc(Number(maxSize) || 100));
    this.active = 0;
    this.closed = false;
    this.pending = [];
  }

  get size() { return this.pending.length + this.active; }

  add(task, label = 'task') {
    if (this.closed) return Promise.reject(new Error('task_queue_closed'));
    if (this.size >= this.maxSize) return Promise.reject(new Error('task_queue_full'));
    if (typeof task !== 'function') return Promise.reject(new TypeError('task_function_required'));
    return new Promise((resolve, reject) => {
      this.pending.push({ task, label, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (!this.closed && this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(() => item.task())
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        })
        .catch(() => {});
    }
  }

  close() {
    this.closed = true;
    const error = new Error('task_queue_closed');
    while (this.pending.length) this.pending.shift().reject(error);
  }
}
