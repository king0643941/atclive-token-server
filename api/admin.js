const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    databaseURL:
      process.env.FIREBASE_DB_URL ||
      'https://atclive-a97a3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const db = admin.database();

function keyOk(key) {
  const expected = process.env.ADMIN_KEY;
  if (!expected || typeof key !== 'string') return false;
  const a = crypto.createHash('sha256').update(key).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const PAGE = `<!DOCTYPE html>
<html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ATCLIVE Admin</title>
<style>
body{font-family:sans-serif;max-width:480px;margin:20px auto;padding:0 14px}
input,button{width:100%;padding:12px;margin:6px 0;font-size:16px;box-sizing:border-box}
button{background:#168a40;color:#fff;border:0;border-radius:6px}
button.b{background:#444}
pre{background:#eee;padding:10px;white-space:pre-wrap}
</style></head><body>
<h2>ATCLIVE Admin</h2>
<input id="key" type="password" placeholder="মালিকের পাসওয়ার্ড (ADMIN_KEY)">
<input id="sid" inputmode="numeric" placeholder="ইউজার ID (যেমন 10001)">
<input id="amt" inputmode="numeric" placeholder="কয়েনের সংখ্যা">
<button onclick="go('add')">কয়েন যোগ করুন</button>
<button class="b" onclick="go('lookup')">ব্যালেন্স দেখুন</button>
<button class="b" onclick="go('reseller_on')">রিসেলার বানান</button>
<button class="b" onclick="go('reseller_off')">রিসেলার বাতিল</button>
<pre id="out"></pre>
<script>
async function go(action){
  const out=document.getElementById('out');
  out.textContent='...';
  try{
    const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:action,key:key.value,shortId:sid.value.trim(),amount:amt.value.trim()})});
    out.textContent=JSON.stringify(await r.json(),null,2);
  }catch(e){out.textContent='Error: '+e;}
}
</script></body></html>`;

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(PAGE);
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  const body = req.body || {};
  if (!keyOk(body.key)) {
    return res.status(401).json({ error: 'wrong password' });
  }

  try {
    const shortId = String(body.shortId || '').trim();
    if (!/^\d{3,12}$/.test(shortId)) {
      return res.status(400).json({ error: 'bad user id' });
    }
    const uid = (await db.ref('shortIds/' + shortId).once('value')).val();
    if (!uid) return res.status(404).json({ error: 'user not found' });

    if (body.action === 'lookup') {
      const w = (await db.ref('wallets/' + uid).once('value')).val() || {};
      const reseller = (await db.ref('resellers/' + uid).once('value')).val() === true;
      return res.status(200).json({ ok: true, shortId, coins: w.coins || 0, earned: w.earned || 0, reseller });
    }

    if (body.action === 'add') {
      const amount = parseInt(body.amount, 10);
      if (!(amount >= 1 && amount <= 10000000)) {
        return res.status(400).json({ error: 'bad amount' });
      }
      await db
        .ref('wallets/' + uid + '/coins')
        .transaction((cur) => (typeof cur === 'number' ? cur : 0) + amount);
      await db.ref('txlog').push({
        type: 'mint',
        to: uid,
        amount,
        ts: admin.database.ServerValue.TIMESTAMP,
      });
      const coins = (await db.ref('wallets/' + uid + '/coins').once('value')).val();
      return res.status(200).json({ ok: true, shortId, coins });
    }

    if (body.action === 'reseller_on') {
      await db.ref('resellers/' + uid).set(true);
      return res.status(200).json({ ok: true, shortId, reseller: true });
    }
    if (body.action === 'reseller_off') {
      await db.ref('resellers/' + uid).remove();
      return res.status(200).json({ ok: true, shortId, reseller: false });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
};
