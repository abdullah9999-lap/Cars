const admin = require('firebase-admin');
admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db = admin.firestore();
const ADMIN = 'abdullah@cars.family', MILEAGE_DAY = +(process.env.MILEAGE_DAY ?? 5);
const now = new Date(Date.now() + 3 * 3600e3), today = now.toISOString().slice(0, 10);
const days = d => d ? Math.round((Date.parse(d) - Date.parse(today)) / 864e5) : null;
const addMo = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const N = n => Number(n || 0).toLocaleString('en-US');

function dueLines(c, within) {
  const nm = `${c.make} ${c.model}`, out = [];
  for (const s of c.services || []) {
    const nk = s.km ? s.lastKm + s.km : null, nd = s.mo ? addMo(s.lastDate, s.mo) : null;
    const kl = nk === null ? null : nk - (c.odo || 0), dl = days(nd);
    if ((kl !== null && kl <= 500) || (dl !== null && dl <= within)) {
      const late = (kl !== null && kl < 0) || (dl !== null && dl < 0);
      out.push(`${nm}: ${s.n} ` + (late ? 'متأخرة' : kl !== null && kl <= 500 ? `باقي ${N(kl)} كم` : `باقي ${dl} يوم`));
    }
  }
  [['الاستمارة', c.regExp], ['التأمين', c.insExp]].forEach(([n, d]) => {
    const x = days(d); if (d && x <= within) out.push(`${nm}: ${n} ` + (x < 0 ? `منتهية منذ ${-x} يوم` : `تنتهي بعد ${x} يوم`));
  });
  (c.warranties || []).forEach(w => { const x = days(w.until); if (x !== null && x >= 0 && x <= within) out.push(`${nm}: ضمان ${w.part} ينتهي بعد ${x} يوم`); });
  return out;
}

(async () => {
  const [cs, us] = await Promise.all([db.collection('cars').get(), db.collection('users').get()]);
  const cars = cs.docs.map(d => ({id: d.id, ...d.data()}));
  for (const u of us.docs) {
    const p = u.data(), tokens = p.tokens || [];
    if (!tokens.length || !p.email) continue;
    const mine = cars.filter(c => p.email === ADMIN || c.ownerEmail === p.email), msgs = [];
    const lines = mine.flatMap(c => dueLines(c, +p.alertDays || 14));
    if (lines.length) msgs.push({title: '🔧 تنبيه صيانة', body: lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n+${lines.length - 6} أخرى` : '')});
    if (p.odoRemind && now.getUTCDay() === MILEAGE_DAY) {
      const own = cars.filter(c => c.ownerEmail === p.email);
      if (own.length) msgs.push({title: '📍 تحديث الممشى', body: own.map(c => `${c.make} ${c.model}: آخر ممشى ${N(c.odo)} كم`).join('\n')});
    }
    for (const m of msgs) {
      const r = await admin.messaging().sendEachForMulticast({tokens, data: {title: m.title, body: m.body, url: './'}, webpush: {headers: {Urgency: 'high', TTL: '86400'}}});
      const bad = tokens.filter((_, i) => !r.responses[i].success && /not-registered|invalid-argument|invalid-registration/.test(r.responses[i].error?.code || ''));
      if (bad.length) await u.ref.update({tokens: admin.firestore.FieldValue.arrayRemove(...bad)});
      console.log(p.name, m.title, r.successCount, 'sent,', r.failureCount, 'failed');
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
