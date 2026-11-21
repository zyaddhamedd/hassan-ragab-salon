import {DeviceVault} from './vault.mjs';
import {StaffClient, StaffError} from './client.mjs';
import {AttendanceAction, bindHold} from './attendance.mjs';
import {icon} from './icons.mjs';

const vault = new DeviceVault();
const client = new StaffClient({vault});
const content = document.querySelector('#content'), nav = document.querySelector('.navigation');
let attendanceState = null, stateReading = false;
let profile = null, shifts = [], historical = null, screen = 'auth', authMode = 'login', secure = false;
let cleanup = () => {}, animationTimer = 0, animatedReceipt = null;
const messages = {
  SECURE_CONTEXT_REQUIRED: 'يلزم فتح التطبيق عبر HTTPS موثوق. لم يتم إرسال بيانات أو طلب موقع.',
  DEVICE_LOCK_UNAVAILABLE: 'هذا المتصفح لا يدعم قفل عمليات الجهاز والجلسة بين الصفحات. استخدم متصفحًا حديثًا يدعم Web Locks؛ لم نتجاوز متطلبات الأمان.',
  DEVICE_STORAGE_UNAVAILABLE: 'تعذر حفظ مفتاح الجهاز بأمان. اسمح بتخزين الموقع في هذا المتصفح؛ لن نستخدم تخزينًا بديلًا للمفتاح.',
  DEVICE_KEY_UNAVAILABLE: 'مفتاح الجهاز غير متاح. لا تمسح بيانات المتصفح؛ راجع الإدارة لإجراء استعادة معتمدة.',
  DEVICE_REQUIRED: 'فعّل الحساب وسجّل جهازك ثم انتظر اعتماده من الإدارة قبل الدخول.',
  DEVICE_PENDING: 'لم تعتمد الإدارة هذا الجهاز بعد. لا توجد جلسة دخول أو حضور مؤكد.',
  DEVICE_INACTIVE: 'الجهاز غير نشط أو تم استبداله. راجع الإدارة.',
  ENROLLMENT_REVIEW_REQUIRED: 'يلزم استكمال أو مراجعة سجل الجهاز الحالي لدى الإدارة. لن ننشئ جهازًا بديلًا تلقائيًا.',
  SESSION_EXPIRED: 'انتهت الجلسة أو تم إلغاؤها. سجّل الدخول مجددًا، ثم أعد العملية المعلّقة نفسها إن وجدت.',
  STAFF_UNAVAILABLE: 'خدمة الموظفين غير متاحة أو غير مفعّلة. لا تغيّر إعدادات الجهاز؛ راجع الإدارة.',
  GEOFENCE_UNCONFIGURED: 'موقع الفرع غير مهيّأ أو غير مفعّل لدى الإدارة. لم يُؤكَّد تسجيل هذه العملية.',
  GPS_PERMISSION_DENIED: 'لم يُسمح بالوصول إلى الموقع. اسمح بالموقع ثم ابدأ العملية بضغط مطوّل جديد.',
  GPS_TIMEOUT: 'انتهت مهلة تحديد الموقع. انتقل لمكان بإشارة أفضل وحاول مجددًا.',
  GPS_UNAVAILABLE: 'تعذر الحصول على موقع حديث. تحقق من خدمات الموقع في الجهاز.',
  GPS_STALE: 'الموقع قديم أو وقت الجهاز غير دقيق. تحقق من الساعة وابدأ عملية جديدة بموقع حديث.',
  GPS_INACCURATE: 'دقة الموقع غير كافية. حسّن إشارة الموقع ثم ابدأ عملية جديدة.',
  GPS_OUTSIDE: 'رفض الخادم الموقع لأنه خارج النطاق المسموح أو دقته تتجاوز حدوده.',
  OFFLINE: 'لا يوجد اتصال. لا يُقبل الحضور دون اتصال ولا تُرسل العمليات تلقائيًا لاحقًا.',
  NETWORK_FAILURE: 'تعذر تأكيد الرد. إذا أُرسل الحضور فقد يكون وصل؛ أبقِ الصفحة مفتوحة وأعد نفس العملية بدل إنشاء أخرى.',
  UNCONFIRMED_RESPONSE: 'لم يصل تأكيد صالح من الخادم. لا يوجد نجاح مؤكد في الواجهة؛ أعد نفس العملية المعلّقة.',
  ATTENDANCE_ALREADY_OPEN: 'يوجد سجل حضور مفتوح بالفعل. استخدم معرّف تأكيدك السابق للانصراف، أو راجع الإدارة إذا لم يكن متاحًا.',
  ATTENDANCE_CHANGED: 'السجل غير مفتوح لهذا الحساب والفرع، أو تم إغلاقه إداريًا. لم نغيّر الإغلاق؛ راجع الإدارة.',
  SHIFT_REVIEW_REQUIRED: 'تحتاج الوردية إلى مراجعة الإدارة بعد تغيير الفرع.',
  RETRY_BODY_UNAVAILABLE: 'العملية المعلقة تحتاج مراجعة الحالة. أُغلقت الصفحة وفُقدت بيانات الموقع المؤقتة؛ لا ننشئ تسجيلًا بديلًا. حدّث الحالة أو راجع الإدارة إذا لم يظهر التأكيد.',
  ATTENDANCE_STATE_UNKNOWN: 'لا تتوفر حالة حضور حالية موثقة لهذا الحساب. لا يمكن اختيار موظف أو سجل بديل يدويًا.',
  PENDING_ACTION: 'هناك عملية معلّقة. أعد نفس العملية قبل بدء أي تسجيل جديد.',
  CONFIRMATION_STORAGE_FAILED: 'أكد الخادم العملية، لكن تعذر حفظ مرجعها في المتصفح. احتفظ بمعرّف التأكيد المعروض.',
};
function message(error) { return messages[error?.code || error?.message] || (error?.status === 403 ? 'رفض الخادم إثبات الجهاز أو الطلب. تحقق من اعتماد الجهاز وإعداداته لدى الإدارة.' : error?.status === 400 ? 'رفض الخادم بيانات العملية. راجع الإدخال والوقت ثم حاول مجددًا.' : error?.status === 409 ? 'تغيّرت البيانات أو الحالة. راجع التأكيد السابق والإدارة قبل إنشاء عملية جديدة.' : error?.status >= 500 ? 'تعذر تأكيد العملية بسبب خطأ بالخادم. لا تفترض نجاح الحضور؛ أعد نفس الطلب المعلّق.' : 'تعذر إتمام الخطوة بأمان. حاول مجددًا أو راجع الإدارة.'); }
function notice(text = '') { const el = document.querySelector('#notice'); el.textContent = text; el.hidden = !text; }
function failure(error) { notice(message(error)); }
function text(selector, value) { content.querySelectorAll(selector).forEach(el => { el.textContent = value ?? '—'; }); }
const time = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ar-EG', {timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit'}).format(new Date(value)) : '—';
function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}
function dateOffset(day, offset) { const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
const stateName = state => ({SCHEDULED: 'وردية محددة', REST: 'يوم راحة', UNASSIGNED: 'لا توجد وردية مسندة'}[state] || 'تعذرت قراءة الوردية');
function decorate() {
  content.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  document.querySelectorAll('.theme-toggle').forEach(el => { if (el.classList.contains('icon-button')) el.innerHTML = icon(document.body.dataset.theme === 'dark' ? 'sun' : 'moon'); });
  text('#theme-name', document.body.dataset.theme === 'dark' ? 'منتصف الليل' : 'العاجي الدافئ');
}
const action = new AttendanceAction({client, vault, notify: () => {
  nav.querySelectorAll('button').forEach(button => { button.disabled = action.busy; });
  if (screen === 'attendance') updateAttendance();
}});
function render(next) {
  if (action.busy || stateReading) return;
  cleanup(); cleanup = () => {}; clearTimeout(animationTimer); animationTimer = 0;
  if (!profile && !['auth', 'pending'].includes(next)) next = 'auth';
  screen = next; document.body.dataset.screen = next;
  content.replaceChildren(document.querySelector('#' + next).content.cloneNode(true));
  content.setAttribute('aria-busy', 'false');
  nav.hidden = !profile; nav.replaceChildren();
  for (const [key, label, symbol] of [['home', 'الرئيسية', 'home'], ['attendance', 'الحضور', 'finger'], ['requests', 'طلباتي', 'requests'], ['profile', 'حسابي', 'profile']]) {
    const button = document.createElement('button'); button.dataset.go = key; button.innerHTML = icon(symbol);
    const span = document.createElement('span'); span.textContent = label; button.append(span);
    if (key === next || next === 'shifts' && key === 'home') button.setAttribute('aria-current', 'page'); nav.append(button);
  }
  if (profile) {
    text('[data-name]', profile.full_name); text('[data-role]', {BARBER: 'حلاق', ASSISTANT: 'مساعد', CASHIER: 'كاشير', STAFF: 'موظف', ADMIN: 'إدارة'}[profile.employee_type] || 'موظف');
    text('[data-initials]', profile.full_name.split(/\s+/).slice(0, 2).map(v => v[0]).join(' ')); text('[data-branch]', 'الفرع ' + profile.branch_id);
  }
  if (next === 'auth') bindAuth();
  if (next === 'pending') bindPending();
  if (next === 'home') home();
  if (next === 'shifts') shiftList();
  if (next === 'attendance') attendance();
  if (next === 'profile') {
    content.querySelector('#reload-profile').onclick = () => guarded(async () => { await dashboard(); render('profile'); });
    content.querySelector('#logout').onclick = () => guarded(async () => {
      if (action.pending) throw new StaffError('PENDING_ACTION');
      let failed = false; try { await client.logout(); } catch { failed = true; }
      profile = null; attendanceState = null; action.current = null; historical = null; action.receipt = null; action.phase = 'idle'; animatedReceipt = null; render('auth');
      notice(failed ? 'خرجت من الواجهة، لكن تعذر تأكيد إنهاء جلسة الخادم. أعد المحاولة عند عودة الاتصال؛ قد تبقى جلسة المتصفح قابلة للاستعادة.' : 'تم تسجيل الخروج من الخادم.');
    });
  }
  decorate(); window.scrollTo({top: 0, behavior: 'instant'});
}
async function guarded(task) { try { notice(); await task(); } catch (error) { failure(error); } }
function bindAuth() {
  const form = content.querySelector('#auth-form');
  const configure = () => {
    content.querySelectorAll('[data-auth-mode]').forEach(button => { button.classList.toggle('selected', button.dataset.authMode === authMode); });
    text('#auth-title', {login: 'أهلًا بعودتك', activate: 'تفعيل حسابك', recover: 'استعادة آمنة'}[authMode]);
    const codeField = content.querySelector('#code-field'); codeField.hidden = authMode === 'login';
    form.elements.code.required = authMode !== 'login'; form.elements.password.minLength = authMode === 'login' ? 1 : 12;
    form.elements.password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    form.querySelector('button[type=submit]').textContent = authMode === 'login' ? 'دخول آمن' : authMode === 'recover' ? 'تأكيد الاستعادة وطلب اعتماد الجهاز' : 'تفعيل الحساب وطلب اعتماد الجهاز';
    text('#auth-help', authMode === 'login' ? 'بعد إعادة الفتح تُستعاد الجلسة بملف ارتباط آمن إن كان صالحًا. لا تُحفظ كلمة المرور أو رمز الدخول في التطبيق.' : 'استخدم رمزًا صادرًا من الإدارة. يتطلب الجهاز الجديد موافقة مستقلة؛ لا تمسح بيانات المتصفح.');
  };
  content.querySelectorAll('[data-auth-mode]').forEach(button => { button.disabled = !secure; button.onclick = () => { authMode = button.dataset.authMode; configure(); }; });
  form.querySelectorAll('input,button').forEach(el => { el.disabled = !secure; });
  form.onsubmit = event => {
    event.preventDefault();
    const values = new FormData(form); const username = String(values.get('username') || ''), password = String(values.get('password') || ''), code = String(values.get('code') || '');
    form.elements.password.value = ''; form.elements.code.value = '';
    form.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    content.querySelectorAll('[data-auth-mode]').forEach(el => { el.disabled = true; });
    guarded(async () => {
      if (authMode === 'login') { await client.login(username, password); await dashboard(); render(action.pending ? 'attendance' : 'home'); }
      else { await client.provision(authMode, username, code, password); render('pending'); }
    }).finally(() => {
      if (screen === 'auth') { form.querySelectorAll('input,button').forEach(el => { el.disabled = !secure; }); content.querySelectorAll('[data-auth-mode]').forEach(el => { el.disabled = !secure; }); }
      if (client.candidate?.state === 'enrolling' && screen === 'auth') render('pending');
    });
  };
  configure();
}
function bindPending() {
  const candidate = client.candidate;
  text('#pending-message', candidate?.deviceId ? 'شارك معرّف هذا السجل مع الإدارة. اضغط للتحقق بعد موافقتها، مع إثبات المفتاح المحفوظ في هذا المتصفح.' : 'قد يكون تسجيل الجهاز انقطع قبل وصول المعرّف. راجع الإدارة لاستعادة مرجع السجل، ولا تُنشئ مفتاحًا آخر تلقائيًا.');
  text('#device-reference', candidate?.deviceId || '');
  const button = content.querySelector('#check-approval'); button.disabled = !candidate?.deviceId;
  button.onclick = () => { button.disabled = true; guarded(async () => { await client.finalize(); render('auth'); notice('أكد الخادم تفعيل الجهاز. يمكنك الدخول الآن.'); }).finally(() => { if (screen === 'pending') button.disabled = false; }); };
  const form = content.querySelector('#attach-device'); form.hidden = !!candidate?.deviceId;
  form.onsubmit = event => { event.preventDefault(); guarded(async () => { await client.attachReviewedDevice(form.elements.deviceId.value.trim()); render('pending'); }); };
}
async function dashboard() {
  const result = await client.profile();
  if (!result.identity || !Number.isSafeInteger(result.identity.user_id) || typeof result.identity.full_name !== 'string' || !result.identity.employee_eligible) throw new StaffError('UNCONFIRMED_RESPONSE');
  if (profile?.user_id !== result.identity.user_id) { action.receipt = null; animatedReceipt = null; if (!action.pending) action.phase = 'idle'; }
  profile = result.identity;
  const saved = await vault.confirmation(); historical = saved?.ownerUserId === profile.user_id ? saved.receipt : null;
  await refreshAttendance();
  const day = cairoDate();
  try { const data = await client.shifts(dateOffset(day, -1), dateOffset(day, 7)); shifts = Array.isArray(data.shifts) ? data.shifts : []; }
  catch (error) { shifts = []; failure(error); }
}
async function refreshAttendance() {
  if (stateReading) throw new StaffError('PENDING_ACTION');
  const owner = profile.user_id;
  attendanceState = null; action.current = null; stateReading = true;
  if (screen === 'attendance') updateAttendance();
  try {
    const state = await action.recover(owner);
    if (profile?.user_id !== owner) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
    attendanceState = state; return state;
  } catch (error) { action.current = null; throw error; }
  finally { stateReading = false; if (screen === 'attendance') updateAttendance(); }
}
function currentLabel() { return ({NONE: 'لا يوجد حضور مفتوح', OPEN: 'حضور مفتوح من الخادم', CLOSED: attendanceState?.attendance?.closure === 'ADMIN_UNVERIFIED' ? 'لا حضور مفتوح · آخر سجل مغلق إداريًا دون تحقق موقع' : 'لا حضور مفتوح · آخر سجل مغلق', REVIEW_REQUIRED: 'تحتاج الحالة إلى مراجعة الإدارة', BLOCKED_LEGACY: 'يوجد حضور كاشير مفتوح'})[attendanceState?.state] || 'تعذرت قراءة الحالة الحالية'; }
function home() {
  const today = new Date(), day = cairoDate(), shift = attendanceState?.state === 'OPEN' ? attendanceState.attendance.shift : shifts.find(value => value.shift_date === day);
  const shiftDay = shift?.shift_date || day, shiftDate = new Date(shiftDay + 'T12:00:00Z');
  text('[data-today]', new Intl.DateTimeFormat('ar-EG', {timeZone: 'Africa/Cairo', dateStyle: 'full'}).format(today));
  text('[data-month]', new Intl.DateTimeFormat('en', {timeZone: 'Africa/Cairo', month: 'short'}).format(shiftDate).toUpperCase());
  text('[data-day]', shiftDay.slice(-2)); text('[data-weekday]', new Intl.DateTimeFormat('ar', {timeZone: 'Africa/Cairo', weekday: 'long'}).format(shiftDate));
  text('[data-shift-start]', time(shift?.start_at)); text('[data-shift-end]', time(shift?.end_at)); text('[data-shift-state]', stateName(shift?.state));
  text('[data-attendance-state]', currentLabel());
  const receipt = action.receipt || historical;
  text('#last-confirmation', receipt ? `آخر تأكيد ${action.receipt ? 'وصل في هذه الجلسة' : 'محفوظ سابقًا، وليس حالة حالية'}: ${receipt.action === 'CHECK_IN' ? 'حضور' : 'انصراف'} · ${receipt.business_date} · ${time(receipt.confirmed_at)} · السجل ${receipt.attendance_id}` : 'لا يوجد تأكيد محفوظ لهذا الحساب.');
}
function shiftList() {
  const list = content.querySelector('#shift-list');
  if (!shifts.length) { list.textContent = 'تعذرت قراءة الورديات. أعد التحديث من الملف الشخصي.'; return; }
  for (const shift of shifts) {
    const article = document.createElement('article'); article.className = 'shift-item';
    const heading = document.createElement('strong'); heading.textContent = shift.shift_date + ' · ' + stateName(shift.state);
    const schedule = document.createElement('p'); schedule.textContent = shift.state === 'SCHEDULED' ? time(shift.start_at) + ' — ' + time(shift.end_at) : 'لا توجد أوقات وردية مسندة لهذا اليوم.';
    const note = document.createElement('p'); note.textContent = shift.frozen ? 'توقع محفوظ من الخادم' : 'خطة الإدارة؛ تُثبت عند العملية'; article.append(heading, schedule, note); list.append(article);
  }
}
function attendance() {
  const hold = content.querySelector('#hold'), mode = content.querySelector('#attendance-mode');
  const known = action.receipt || historical;
  mode.options[1].disabled = attendanceState?.checkout_eligible !== true;
  mode.options[0].disabled = attendanceState?.check_in_eligible !== true;
  if (attendanceState?.checkout_eligible) mode.value = 'CHECK_OUT';
  if (action.pending) mode.value = action.pending.action;
  text('#attendance-context', currentLabel() + (attendanceState?.attendance ? ' · السجل ' + attendanceState.attendance.attendance_id + ' · ' + attendanceState.attendance.business_date : '') + ' · هذه قراءة حالية؛ يعيد الخادم التحقق عند العملية.');
  cleanup = bindHold(hold, {
    begin: () => { if (action.busy || action.pending) return false; content.querySelector('.mechanical-control').dataset.stage = 'holding'; content.querySelector('.mechanical-control').dataset.pressed = 'true'; text('#orb-title', 'استمر بالضغط'); text('#orb-caption', 'حتى اكتمال الحلقة'); return true; },
    progress: amount => { content.querySelector('.progress-ring circle').style.strokeDashoffset = String(754 * (1 - amount)); },
    release: () => { if (screen !== 'attendance') return; content.querySelector('.mechanical-control').dataset.pressed = 'false'; if (!action.busy && !action.pending && action.phase !== 'confirmed') { content.querySelector('.progress-ring circle').style.strokeDashoffset = '754'; content.querySelector('.mechanical-control').dataset.stage = 'idle'; text('#orb-title', 'اضغط مطولًا'); } },
    complete: () => guarded(async () => {
      notice(); const chosen = mode.value;
      const state = await refreshAttendance();
      if (chosen === 'CHECK_OUT' ? !state.checkout_eligible : !state.check_in_eligible) throw new StaffError('ATTENDANCE_STATE_UNKNOWN');
      await action.perform(chosen, chosen === 'CHECK_OUT' ? state.attendance.attendance_id : null, profile.user_id);
      try { await refreshAttendance(); } catch (error) { failure(error); }
    }),
  });
  content.querySelector('#retry-attendance').onclick = () => guarded(async () => { await action.retry(profile.user_id); try { await refreshAttendance(); } catch (error) { failure(error); } });
  content.querySelector('#recover-attendance').onclick = () => guarded(async () => { await refreshAttendance(); render('attendance'); });
  content.querySelector('#new-attendance').onclick = () => guarded(async () => { if (action.phase === 'confirmed' && !action.pending) action.set('idle'); else await action.discardRejected(); render('attendance'); });
  mode.onchange = () => { if (!action.busy && !action.pending) { action.phase = 'idle'; updateAttendance(); } };
  updateAttendance();
}
function updateAttendance() {
  nav.querySelectorAll('button').forEach(button => { button.disabled = action.busy || stateReading; });
  const control = content.querySelector('.mechanical-control'); if (!control) return;
  const hold = content.querySelector('#hold'), mode = content.querySelector('#attendance-mode');
  hold.disabled = stateReading || action.busy || !!action.pending || action.phase === 'confirmed' || !(attendanceState?.checkout_eligible || attendanceState?.check_in_eligible); mode.disabled = action.busy || !!action.pending || action.phase === 'confirmed';
  control.dataset.pressed = 'false';
  const retry = content.querySelector('#retry-attendance'), fresh = content.querySelector('#new-attendance');
  retry.hidden = !action.pending || !['failure', 'uncertain'].includes(action.phase); retry.disabled = action.busy || !action.pending?.raw;
  content.querySelector('#recover-attendance').disabled = stateReading || action.busy;
  fresh.hidden = action.phase !== 'confirmed' && (!action.pending || action.phase !== 'failure');
  fresh.textContent = action.phase === 'confirmed' ? 'متابعة الحضور والانصراف' : 'موقع حديث لعملية جديدة';
  content.querySelector('#reauthenticate').hidden = action.error?.status !== 401;
  if (action.phase === 'locating' || action.phase === 'verifying') {
    control.dataset.stage = action.phase; text('#orb-title', action.phase === 'locating' ? 'تحديد الموقع' : 'جارٍ التحقق'); text('#orb-caption', 'لم يصل تأكيد بعد');
    text('#attendance-status', action.phase === 'locating' ? 'نطلب موقعًا حديثًا لهذه العملية فقط…' : 'ننتظر التحقق وتأكيد الخادم…');
  } else if (action.phase === 'confirmed' && action.receipt) {
    // The only ignition/success entry: an actually validated backend receipt.
    const receipt = action.receipt;
    control.dataset.confirmation = receipt.action === 'CHECK_OUT' ? 'checkout' : 'checkin';
    text('#orb-title', 'تأكيد الخادم'); text('#orb-caption', 'وصل تأكيد العملية'); hold.querySelector('[data-icon]').innerHTML = icon('check');
    const status = content.querySelector('#attendance-status'); status.replaceChildren();
    const title = document.createElement('strong'); title.className = 'ignition-title'; title.textContent = receipt.action === 'CHECK_OUT' ? 'تم تأكيد انصرافك' : 'تم تأكيد حضورك';
    const timestamp = document.createElement('time'); timestamp.className = 'ignition-time'; timestamp.textContent = receipt.business_date + ' · ' + time(receipt.confirmed_at) + ' · السجل ' + receipt.attendance_id;
    status.append(title, timestamp);
    if (animatedReceipt !== receipt) {
      animatedReceipt = receipt; control.dataset.stage = 'igniting';
      animationTimer = setTimeout(() => { if (screen === 'attendance') control.dataset.stage = 'success'; }, receipt.action === 'CHECK_OUT' ? 1400 : 2600);
    } else if (!animationTimer) control.dataset.stage = 'success';
    if (action.error) failure(action.error);
    historical = receipt;
  } else if (action.phase === 'reconciled') {
    control.dataset.stage = 'idle'; text('#orb-title', 'تم تحديث الحالة'); text('#orb-caption', 'ليست عملية تسجيل جديدة'); text('#attendance-status', currentLabel() + ' · تم حل العملية المعلقة بقراءة الخادم دون إنشاء تأكيد جديد.');
  } else if (action.phase === 'failure' || action.phase === 'uncertain') {
    control.dataset.stage = 'failure'; text('#orb-title', action.phase === 'uncertain' ? 'النتيجة غير مؤكدة' : 'لم يُؤكَّد التسجيل');
    text('#orb-caption', action.pending ? 'احتفظ بالعملية للمراجعة أو الإعادة' : 'يمكن المحاولة مجددًا'); text('#attendance-status', message(action.error));
  } else { control.dataset.stage = 'idle'; text('#orb-title', 'اضغط مطولًا'); text('#orb-caption', mode.value === 'CHECK_OUT' ? 'لإرسال طلب الانصراف' : 'لإرسال طلب الحضور'); }
}
document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]'); if (go && !go.disabled) render(go.dataset.go);
  if (event.target.closest('.theme-toggle')) { const dark = document.body.dataset.theme !== 'dark'; document.body.dataset.theme = dark ? 'dark' : 'light'; const logo = document.querySelector('.logo'); logo.src = dark ? logo.dataset.darkSrc : logo.dataset.lightSrc; document.querySelector('meta[name=theme-color]').content = dark ? '#101d23' : '#f5f1e9'; decorate(); }
});
window.addEventListener('beforeunload', event => { if (action.pending || action.busy) { event.preventDefault(); event.returnValue = ''; } });
async function start() {
  try {
    await client.initialize(); secure = true;
    if (client.candidate && client.candidate.state !== 'prepared') { render('pending'); return; }
    if (client.binding?.state === 'active' && client.csrf()) { await client.refresh(); await dashboard(); render('home'); }
    else render('auth');
  } catch (error) { render('auth'); failure(error); }
}
start();
