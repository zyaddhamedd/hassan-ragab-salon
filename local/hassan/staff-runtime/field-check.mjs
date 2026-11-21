// Calibration only: no API writes, raw coordinate display, storage or location watch.
import {freshLocation} from '/attendance.mjs';
import {createDevice, bytes} from '/proof.mjs';
const result = document.querySelector('#result');
document.querySelector('#security').onclick = async () => {
  const target = document.querySelector('#security-result');
  try {
    if (!isSecureContext || location.protocol !== 'https:') throw Error('افتح اتصال HTTPS موثوقًا أولًا.');
    const device = await createDevice(crypto);
    const signature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, device.privateKey, bytes('isolated-field-readiness'));
    const pub = await crypto.subtle.importKey('jwk', device.publicJwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, pub, signature, bytes('isolated-field-readiness'))) throw Error('تعذر التحقق من توقيع الاختبار.');
    let denied = false; try { await crypto.subtle.exportKey('jwk', device.privateKey); } catch { denied = true; }
    if (!denied || !indexedDB || !navigator.locks) throw Error('المفتاح غير قابل للحماية أو متطلبات المتصفح غير متاحة.');
    target.textContent = 'HTTPS وسياق آمن وتوقيع ECDSA ناجح؛ تصدير المفتاح الخاص مرفوض. IndexedDB وWeb Locks متاحان. تأكيد حفظ المفتاح والجلسة يتم بالتفعيل والدخول ثم إعادة فتح التطبيق.';
  } catch (error) { target.textContent = error.message || 'فشل فحص الأمان؛ لا تتجاوز تحذير الشهادة.'; }
};
const el = id => document.querySelector('#' + id);
let muted = false;
let measuring = false;
let sampleCount = 0;
const speech = globalThis.speechSynthesis;
function speak(message) {
  if (muted) return;
  try {
    if (!speech || !globalThis.SpeechSynthesisUtterance) throw Error();
    const voice = speech.getVoices().find(item => /^ar(?:-|_|$)/i.test(item.lang));
    if (!voice) { el('voice-note').textContent = 'لا يتوفر صوت عربي حاليًا؛ النتيجة مكتوبة بالكامل أدناه.'; return; }
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = voice.lang; utterance.voice = voice; utterance.rate = 0.93;
    utterance.onerror = () => { el('voice-note').textContent = 'تعذر تشغيل الصوت؛ راجع النتيجة المكتوبة. قد يتطلب Safari تفاعلًا جديدًا.'; };
    speech.speak(utterance);
  } catch { el('voice-note').textContent = 'الإعلان الصوتي غير متاح؛ راجع النتيجة المكتوبة.'; }
}
el('voice').onclick = () => {
  muted = !muted;
  el('voice').textContent = muted ? 'الصوت مكتوم' : 'الصوت مفعّل';
  el('voice').setAttribute('aria-pressed', String(!muted));
  if (muted) { try { speech?.cancel(); } catch {} }
  el('voice-note').textContent = muted ? 'الصوت مكتوم؛ ستظهر النتيجة مكتوبة.' : 'سيُعلن الفحص التالي صوتيًا عند توفر صوت عربي.';
};
function state(name, title, hint) {
  document.body.dataset.state = name;
  el('state-code').textContent = {ready:'READY',scanning:'SCANNING',accepted:'ACCEPTED',rejected:'REJECTED',error:'GPS ERROR'}[name];
  el('state-title').textContent = title; el('state-hint').textContent = hint;
  el('scan-symbol').textContent = name === 'accepted' ? '✓' : name === 'rejected' || name === 'error' ? '!' : '⌖';
}
el('measure').onclick = async event => {
  if (measuring) return;
  measuring = true;
  const button = event.currentTarget; button.disabled = true;
  const place = el('place').value; el('place').disabled = true;
  el('result-panel').hidden = true;
  el('measure-label').textContent = 'جارٍ اكتساب إشارة GPS…';
  state('scanning', 'نبحث عن إشارة دقيقة', 'أبقِ الصفحة مفتوحة حتى تكتمل قراءة الموقع.');
  // Speech is initiated only from the explicit measurement gesture.
  speak('جارٍ فحص الموقع.');
  try {
    const reading = await freshLocation(globalThis);
    const radians = degrees => degrees * Math.PI / 180;
    const p1 = radians(30.032083486995774), p2 = radians(reading.latitude);
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(radians(reading.longitude - 30.987334731699523) / 2) ** 2;
    const distance = 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.max(0, Math.min(1, a))), Math.sqrt(Math.max(0, 1 - a)));
    const age = (Date.now() - Date.parse(reading.captured_at)) / 1000;
    const accepted = distance + reading.accuracy_m <= 100 && reading.accuracy_m <= 25 && age >= 0 && age <= 30;
    const reason = accepted ? 'تم التحقق من الموقع بنجاح. أنت داخل النطاق الجغرافي المعتمد.' : reading.accuracy_m > 25 ? 'فشل التحقق من الموقع. دقة القراءة غير كافية؛ حاول من نقطة أوضح.' : age < 0 || age > 30 ? 'فشل التحقق من الموقع. قراءة الموقع غير حديثة؛ أعد الفحص.' : 'فشل التحقق من الموقع. أنت خارج النطاق المسموح بعد احتساب هامش الدقة.';
    const label = `${place} — المسافة ${distance.toFixed(1)}م، هامش الدقة ${reading.accuracy_m.toFixed(1)}م، عمر القراءة ${age.toFixed(1)}ث. ${reason} نتيجة معايرة فقط؛ ليس تأكيد حضور.`;
    state(accepted ? 'accepted' : 'rejected', accepted ? 'داخل نطاق الاختبار' : 'لم يجتز معيار الاختبار', 'تشخيص محلي وفق حدود الاختبار المعتمدة، وليس تأكيد حضور.');
    el('distance').textContent = distance.toFixed(1); el('accuracy').textContent = reading.accuracy_m.toFixed(1); el('age').textContent = age.toFixed(1);
    el('verdict').textContent = accepted ? 'PASS' : 'FAIL';
    result.textContent = label; el('result-panel').hidden = false;
    const row = document.createElement('li'); row.textContent = label; el('samples').append(row);
    sampleCount++; el('sample-count').textContent = `${sampleCount} قياسات`;
    speak(reason);
  } catch {
    state('error', 'تعذر تحديد الموقع', 'تحقق من صلاحية الموقع الدقيق واتصال HTTPS ثم أعد الفحص.');
    for (const id of ['distance','accuracy','age']) el(id).textContent = '—';
    el('verdict').textContent = 'GPS ERROR';
    result.textContent = 'تعذر القياس. اسمح بالموقع الدقيق، وتحقق من HTTPS والاتصال، ثم حاول مجددًا. لم يُسجّل حضور.';
    el('result-panel').hidden = false;
    speak('تعذر تحديد الموقع. يرجى التحقق من صلاحيات الموقع.');
  } finally {
    measuring = false; button.disabled = false; el('place').disabled = false;
    el('measure-label').textContent = 'بدء فحص الموقع';
  }
};
