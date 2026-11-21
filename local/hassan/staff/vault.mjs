import {validateDevice} from './proof.mjs';
// Only nonextractable keys, device IDs and safe confirmations. Never tokens/GPS.
export class DeviceVault {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  async database() {
    if (!this.indexedDB) throw new Error('DEVICE_STORAGE_UNAVAILABLE');
    if (!this.opening) this.opening = new Promise((resolve, reject) => {
      const request = this.indexedDB.open('omar-staff-private-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries');
      request.onerror = request.onblocked = () => { this.opening = null; reject(new Error('DEVICE_STORAGE_UNAVAILABLE')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.opening = null; };
        resolve(db);
      };
    });
    return this.opening;
  }
  async operation(key, value, remove = false) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      let result;
      const transaction = db.transaction('entries', value === undefined && !remove ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('entries');
      const request = remove ? store.delete(key) : value === undefined ? store.get(key) : store.put(value, key);
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result ?? null);
      transaction.onerror = transaction.onabort = () => reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
    });
  }
  async device(slot = 'current') { const item = await this.operation(slot); return item ? validateDevice(item) : null; }
  async saveDevice(slot, device) {
    validateDevice(device);
    await this.operation(slot, {privateKey: device.privateKey, publicJwk: device.publicJwk,
      deviceId: device.deviceId || null, state: device.state});
  }
  async promote(device) { await this.saveDevice('current', {...device, state: 'active'}); await this.operation('candidate', undefined, true); }
  async pending() { return this.operation('pending-operation'); }
  async savePending({action, attendanceId, ownerUserId, operation, uncertain, rejectionStatus}) {
    await this.operation('pending-operation', {action, attendanceId, ownerUserId, operation, uncertain: uncertain === true, rejectionStatus: Number.isInteger(rejectionStatus) ? rejectionStatus : null});
  }
  async clearPending() { await this.operation('pending-operation', undefined, true); }
  async confirmation() { return this.operation('confirmation'); }
  async saveConfirmation(ownerUserId, receipt) {
    // Explicit allowlist excludes raw request/location, tokens and proof evidence.
    await this.operation('confirmation', {ownerUserId, receipt: {
      attendance_id: receipt.attendance_id, action: receipt.action, confirmed: receipt.confirmed,
      confirmed_at: receipt.confirmed_at, business_date: receipt.business_date,
      check_in_time: receipt.check_in_time, check_out_time: receipt.check_out_time,
      shift: {shift_date: receipt.shift?.shift_date, state: receipt.shift?.state,
        start_at: receipt.shift?.start_at, end_at: receipt.shift?.end_at, timezone: 'Africa/Cairo', frozen: receipt.shift?.frozen},
    }});
  }
}
