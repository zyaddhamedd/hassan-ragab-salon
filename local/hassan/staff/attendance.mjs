import {identifier, requireSecure} from './proof.mjs';
import {StaffError} from './client.mjs';
export function freshLocation(environment = globalThis) {
  requireSecure(environment);
  if (environment.navigator.onLine === false) return Promise.reject(new StaffError('OFFLINE'));
  if (!environment.navigator.geolocation) return Promise.reject(new StaffError('GPS_UNAVAILABLE'));
  return new Promise((resolve, reject) => environment.navigator.geolocation.getCurrentPosition(position => {
    const {latitude, longitude, accuracy} = position.coords;
    if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite)) return reject(new StaffError('GPS_UNAVAILABLE'));
    resolve({latitude, longitude, accuracy_m: accuracy, captured_at: new Date(position.timestamp).toISOString()});
  }, error => reject(new StaffError(error.code === 1 ? 'GPS_PERMISSION_DENIED' : error.code === 3 ? 'GPS_TIMEOUT' : 'GPS_UNAVAILABLE')),
  {enableHighAccuracy: true, maximumAge: 0, timeout: 15000}));
}
export function validateReceipt(receipt, action, attendanceId = null) {
  if (receipt?.confirmed !== true || receipt.action !== action || !Number.isSafeInteger(receipt.attendance_id) || receipt.attendance_id <= 0 ||
      (action === 'CHECK_OUT' && receipt.attendance_id !== attendanceId) || !Number.isFinite(Date.parse(receipt.confirmed_at)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(receipt.business_date || '') || !Number.isFinite(Date.parse(receipt.check_in_time)) ||
      (action === 'CHECK_OUT' && !Number.isFinite(Date.parse(receipt.check_out_time))) ||
      !['SCHEDULED', 'REST', 'UNASSIGNED'].includes(receipt.shift?.state) || receipt.shift.frozen !== true) {
    throw new StaffError('UNCONFIRMED_RESPONSE');
  }
  return {attendance_id: receipt.attendance_id, action: receipt.action, confirmed: true,
    confirmed_at: receipt.confirmed_at, business_date: receipt.business_date,
    check_in_time: receipt.check_in_time, check_out_time: receipt.check_out_time,
    shift: Object.fromEntries(['shift_date', 'state', 'start_at', 'end_at', 'timezone', 'frozen',
      'source', 'template_name', 'grace_minutes', 'branch_id'].map(key => [key, receipt.shift[key]]))};
}
export function validateCurrent(state) {
  if (!state || !['NONE', 'OPEN', 'CLOSED', 'REVIEW_REQUIRED', 'BLOCKED_LEGACY'].includes(state.state) ||
      typeof state.checkout_eligible !== 'boolean' || typeof state.check_in_eligible !== 'boolean' ||
      !Number.isFinite(Date.parse(state.observed_at))) throw new StaffError('UNCONFIRMED_RESPONSE');
  const row = state.attendance;
  if (state.state === 'OPEN' && (!state.checkout_eligible || state.check_in_eligible || !Number.isSafeInteger(row?.attendance_id) ||
      !Number.isFinite(Date.parse(row.check_in_time)) || row.check_out_time !== null || row.shift?.frozen !== true)) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (state.state !== 'OPEN' && state.checkout_eligible) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (row && (!Number.isSafeInteger(row.attendance_id) || row.attendance_id <= 0 ||
      !Number.isFinite(Date.parse(row.check_in_time)) || !/^\d{4}-\d{2}-\d{2}$/.test(row.business_date || ''))) throw new StaffError('UNCONFIRMED_RESPONSE');
  if ((state.state === 'NONE' || state.state === 'BLOCKED_LEGACY') && row !== null) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (state.state === 'BLOCKED_LEGACY' && state.check_in_eligible) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (state.state === 'CLOSED' && (!row || !Number.isFinite(Date.parse(row.check_out_time)))) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (state.state === 'REVIEW_REQUIRED' && (state.check_in_eligible || state.checkout_eligible)) throw new StaffError('UNCONFIRMED_RESPONSE');
  const recovery = state.recovery;
  if (recovery && (recovery.committed !== true || !['CHECK_IN', 'CHECK_OUT'].includes(recovery.action) || !Number.isSafeInteger(recovery.attendance_id))) throw new StaffError('UNCONFIRMED_RESPONSE');
  return {state: state.state, check_in_eligible: state.check_in_eligible, checkout_eligible: state.checkout_eligible,
    observed_at: state.observed_at, recovery: recovery ? {action: recovery.action, attendance_id: recovery.attendance_id, committed: true} : null,
    attendance: row ? {attendance_id: row.attendance_id, business_date: row.business_date, check_in_time: row.check_in_time,
      check_out_time: row.check_out_time, closure: row.closure,
      shift: row.shift ? Object.fromEntries(['shift_date','state','start_at','end_at','timezone','frozen','source','template_name','grace_minutes','branch_id'].map(key => [key,row.shift[key]])) : null} : null};
}
export class AttendanceAction {
  constructor({client, vault, environment = globalThis, locate = () => freshLocation(environment), notify = () => {}}) {
    Object.assign(this, {client, vault, environment, locate, notify});
    this.phase = 'idle'; this.pending = null; this.receipt = null; this.busy = false; this.error = null;
  }
  set(phase, error = null) { this.phase = phase; this.error = error; this.notify(this); }
  async perform(action, attendanceId, ownerUserId) {
    if (this.busy || this.pending) throw new StaffError('PENDING_ACTION');
    if (!['CHECK_IN', 'CHECK_OUT'].includes(action) || !Number.isSafeInteger(ownerUserId) ||
        (action === 'CHECK_OUT' && (!Number.isSafeInteger(attendanceId) || attendanceId <= 0))) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
    if (action === 'CHECK_OUT' && (this.current?.state !== 'OPEN' || this.current.checkout_eligible !== true || this.current.attendance?.attendance_id !== attendanceId)) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
    this.busy = true; this.set('locating');
    try {
      const location = await this.locate();
      const raw = JSON.stringify({idempotency_key: identifier(this.environment.crypto), location,
        ...(action === 'CHECK_OUT' ? {attendance_id: attendanceId} : {})});
      // Exact bytes and raw GPS exist ONLY in volatile memory until resolution.
      this.pending = {action, attendanceId, ownerUserId, raw, operation: JSON.parse(raw).idempotency_key};
      try { await this.vault.savePending(this.pending); } catch (error) { this.pending = null; throw error; }
      return await this.submit();
    } catch (error) {
      if (this.phase !== 'failure' && this.phase !== 'uncertain') this.set('failure', error);
      throw error;
    } finally { this.busy = false; this.notify(this); }
  }
  async retry(ownerUserId) {
    if (this.busy || !this.pending) throw new StaffError('NO_PENDING_ACTION');
    if (ownerUserId !== this.pending.ownerUserId) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
    if (!this.pending.raw) throw new StaffError('RETRY_BODY_UNAVAILABLE');
    this.busy = true;
    try { return await this.submit(); } finally { this.busy = false; this.notify(this); }
  }
  async submit() {
    this.set('verifying');
    const pending = this.pending;
    let receipt;
    try {
      receipt = validateReceipt(await this.client.attendance(pending.action, pending.raw), pending.action, pending.attendanceId);
    } catch (error) {
      const rejected = error.status >= 400 && error.status < 500;
      pending.uncertain = pending.uncertain === true || !rejected;
      pending.rejectionStatus = rejected && !pending.uncertain ? error.status : null;
      try { await this.vault.savePending(pending); } catch { /* Keep the volatile request; no replacement is allowed. */ }
      this.set(rejected && !pending.uncertain ? 'failure' : 'uncertain', error);
      throw error;
    }
    this.pending = null; this.receipt = receipt;
    let storageError = null;
    try { await this.vault.clearPending(); await this.vault.saveConfirmation(pending.ownerUserId, receipt); } catch { storageError = new StaffError('CONFIRMATION_STORAGE_FAILED'); }
    this.set('confirmed', storageError);
    return receipt;
  }
  async recover(ownerUserId) {
    if (this.busy) throw new StaffError('PENDING_ACTION');
    if (!this.pending) {
      const saved = await this.vault.pending();
      if (saved?.ownerUserId === ownerUserId) this.pending = saved;
    }
    if (this.pending && this.pending.ownerUserId !== ownerUserId) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
    this.current = null;
    const state = validateCurrent(await this.client.current(this.pending?.operation || null));
    const pending = this.pending;
    const matched = pending && state.recovery?.committed === true && state.recovery.action === pending.action &&
      (pending.action !== 'CHECK_OUT' || state.recovery.attendance_id === pending.attendanceId);
    const closedTarget = pending?.action === 'CHECK_OUT' && state.state === 'CLOSED' && state.attendance?.attendance_id === pending.attendanceId;
    if (matched || closedTarget) {
      await this.vault.clearPending(); this.pending = null; this.receipt = null; this.set('reconciled');
    } else if (pending) {
      if (!pending.uncertain && pending.rejectionStatus >= 400 && pending.rejectionStatus < 500) this.set('failure', new StaffError('SERVER_REJECTED', pending.rejectionStatus));
      else this.set('uncertain', new StaffError(pending.raw ? 'NETWORK_FAILURE' : 'RETRY_BODY_UNAVAILABLE'));
    }
    this.current = state;
    return state;
  }
  async discardRejected() {
    if (this.busy || this.phase !== 'failure' || !this.pending || this.pending.uncertain || !this.error?.status || this.error.status >= 500) throw new StaffError('PENDING_ACTION');
    await this.vault.clearPending(); this.pending = null; this.set('idle'); // Never discard an uncertain committed request implicitly.
  }
}

// Same 1400ms physical hold, pointer capture and keyboard semantics as prototype.
export function bindHold(button, {begin, progress, release, complete, frame = requestAnimationFrame, cancel = cancelAnimationFrame,
  clock = () => performance.now(), document = globalThis.document}) {
  let active = false, started = 0, raf = 0, pointer = null, key = null;
  const stop = () => { active = false; pointer = key = null; cancel(raf); release(); };
  const start = () => {
    if (active || button.disabled || begin() === false) return false;
    active = true; started = clock();
    const tick = now => {
      if (!active) return;
      const amount = Math.min((now - started) / 1400, 1); progress(amount);
      if (amount < 1) raf = frame(tick);
      else { active = false; pointer = key = null; complete(); }
    };
    raf = frame(tick); return true;
  };
  const listeners = [];
  const listen = (target, name, handler) => { target.addEventListener(name, handler); listeners.push(() => target.removeEventListener(name, handler)); };
  listen(button, 'pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || active) return;
    event.preventDefault(); button.focus({preventScroll: true});
    if (start()) { pointer = event.pointerId; try { button.setPointerCapture(pointer); } catch { stop(); } }
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, name, event => { if (event.pointerId === pointer) stop(); });
  listen(button, 'contextmenu', event => event.preventDefault());
  listen(button, 'keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat && !active && start()) key = event.key; } });
  listen(button, 'keyup', event => { if (event.key === key) { event.preventDefault(); stop(); } });
  listen(button, 'blur', stop);
  listen(document, 'visibilitychange', () => { if (document.hidden) stop(); });
  return () => { stop(); listeners.forEach(remove => remove()); };
}
