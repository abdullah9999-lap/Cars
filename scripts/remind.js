const admin = require('firebase-admin');
admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db = admin.firestore();
const ADMIN = 'abdullah@cars.family', MILEAGE_DAY = +(process.env.MILEAGE_DAY ?? 5), TEST = process.env.TEST === 'true';
const mailer = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? require('nodemailer').createTransport({service: 'gmail', auth: {user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD}}) : null;
const now = new Date(Date.now() + 3 * 3600e3), today = now.toISOString().slice(0, 10);
const days = d => d ? Math.round((Date.parse(d) - Date.parse(today)) / 864e5) : null;
const addMo = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const N = n => Number(n || 0).toLocaleString('en-US');

const K = x => String(x).replace(/[\/.\[\]*~`]/g, '_');
function dueLines(c, within) {
  const nm = `${c.make} ${c.model}`, out = [], add = (n, t) => out.push({k: K(c.id + '|' + n), t: `${nm}: ${t}`});
  for (const s of c.services || []) {
    const nk = s.km ? s.lastKm + s.km : null, nd = s.mo ? addMo(s.lastDate, s.mo) : null;
    const kl = nk === null ? null : nk - (c.odo || 0), dl = days(nd);
    if ((kl !== null && kl <= 500) || (dl !== null && dl <= within)) {
      const late = (kl !== null && kl < 0) || (dl !== null && dl < 0);
      add(s.n, `${s.n} ` + (late ? 'متأخرة' : kl !== null && kl <= 500 ? `باقي ${N(kl)} كم` : `باقي ${dl} يوم`));
    }
  }
  [['الاستمارة', c.regExp], ['التأمين', c.insExp]].forEach(([n, d]) => {
    const x = days(d); if (d && x <= within) add(n, `${n} ` + (x < 0 ? `منتهية منذ ${-x} يوم` : `تنتهي بعد ${x} يوم`));
  });
  (c.warranties || []).forEach(w => { const x = days(w.until); if (x !== null && x >= 0 && x <= within) add('ضمان ' + w.part, `ضمان ${w.part} ينتهي بعد ${x} يوم`); });
  return out;
}

(async () => {
  const [cs, us] = await Promise.all([db.collection('cars').get(), db.collection('users').get()]);
  const cars = cs.docs.map(d => ({id: d.id, ...d.data()}));
  console.log(`cars: ${cars.length}, users: ${us.size}, test mode: ${TEST}, email configured: ${!!mailer}`);
  for (const u of us.docs) {
    const p = u.data(), tokens = p.tokens || [], who = p.name || p.email;
    const mail = p.emailOn && p.alertEmail && !p.alertEmail.endsWith('@cars.family') ? p.alertEmail : null;
    console.log(who, `- phones registered: ${tokens.length}, email alerts: ${mail ? 'on' : 'off'}`);
    if (!p.email) { console.log(who, '- skipped: no email field'); continue; }
    if (!tokens.length && !mail) { console.log(who, '- skipped: no phone registered and no email alerts on'); continue; }
    const mine = cars.filter(c => p.email === ADMIN || c.ownerEmail === p.email), msgs = [];
    const dis = p.dismissed || {};
    const lines = mine.flatMap(c => dueLines(c, +p.alertDays || 14)).filter(x => !(dis[x.k] >= today)).map(x => x.t);
    if (lines.length) msgs.push({title: '🔧 تنبيه صيانة', body: lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n+${lines.length - 6} أخرى` : '')});
    if (p.odoRemind && now.getUTCDay() === MILEAGE_DAY) {
      const own = cars.filter(c => c.ownerEmail === p.email);
      if (own.length) msgs.push({title: '📍 تحديث الممشى', body: own.map(c => `${c.make} ${c.model}: آخر ممشى ${N(c.odo)} كم`).join('\n')});
    }
    if (!msgs.length && TEST) msgs.push({title: '✅ اختبار الإشعارات', body: 'الإشعارات تعمل بشكل صحيح'});
    if (!msgs.length) { console.log(who, '- nothing due today'); continue; }
    for (const m of msgs) {
      if (tokens.length) {
        const r = await admin.messaging().sendEachForMulticast({tokens, data: {title: m.title, body: m.body, url: './'}, webpush: {headers: {Urgency: 'high', TTL: '86400'}}});
        const bad = tokens.filter((_, i) => !r.responses[i].success && /not-registered|invalid-argument|invalid-registration/.test(r.responses[i].error?.code || ''));
        if (bad.length) await u.ref.update({tokens: admin.firestore.FieldValue.arrayRemove(...bad)});
        r.responses.forEach(x => !x.success && console.log('  push error:', x.error?.code, x.error?.message));
        console.log(who, '- push', m.title, r.successCount, 'sent,', r.failureCount, 'failed');
      }
      if (mail) {
        if (!mailer) console.log(who, '- email skipped: GMAIL_USER / GMAIL_APP_PASSWORD secrets missing');
        else { await mailer.sendMail({from: `Family Cars <${process.env.GMAIL_USER}>`, to: mail, subject: m.title, text: m.body}); console.log(who, '- email sent to', mail); }
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
