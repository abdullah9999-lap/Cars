const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db = admin.firestore();
const MAX = 20 * 1024 * 1024; // Gmail limit is 25 MB

(async () => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD secrets are missing');
  const cars = [];
  for (const c of (await db.collection('cars').get()).docs) {
    const logs = (await c.ref.collection('logs').get()).docs.map(l => ({id: l.id, data: l.data()}));
    cars.push({id: c.id, data: c.data(), logs});
  }
  const users = (await db.collection('users').get()).docs.map(u => {
    const {tokens, ...rest} = u.data();   // device tokens are not backed up; people re-enable notifications
    return {id: u.id, data: rest};
  });
  const date = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  let json = JSON.stringify({exportedAt: date, cars, users});
  let note = 'Full backup including invoice and warranty photos.';
  if (Buffer.byteLength(json) > MAX) {
    cars.forEach(c => c.logs.forEach(l => { delete l.data.photo; if (l.data.warranty) delete l.data.warranty.photo; }));
    json = JSON.stringify({exportedAt: date, cars, users, photosRemoved: true});
    note = 'The file was too large for email, so photos were left out. Cars, records and settings are included.';
  }
  const nLogs = cars.reduce((n, c) => n + c.logs.length, 0);
  const to = process.env.BACKUP_TO || process.env.GMAIL_USER;
  await nodemailer.createTransport({service: 'gmail', auth: {user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD}}).sendMail({
    from: `Family Cars <${process.env.GMAIL_USER}>`, to,
    subject: `Cars backup ${date}`,
    text: `Backup of the family cars app.\n\nCars: ${cars.length}\nMaintenance records: ${nLogs}\nUsers: ${users.length}\n\n${note}\n\nKeep this email. It is the only copy outside Firebase.`,
    attachments: [{filename: `cars-backup-${date}.json`, content: json, contentType: 'application/json'}]
  });
  console.log(`backup sent to ${to}: ${cars.length} cars, ${nLogs} records, ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
