/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */

export function ownedDevice(database, deviceId, userId) {
  const device = database.getDevice(deviceId);
  return device && device.ownerId === userId ? device : null;
}

export function claimableDevice(database, deviceId) {
  const device = database.getDevice(deviceId);
  return device && device.ownerId == null ? device : null;
}

export const DEVICE_STATES = Object.freeze(['idle', 'preparing', 'transferring', 'refreshing', 'succeeded', 'failed', 'unknown']);
