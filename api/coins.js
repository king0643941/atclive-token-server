const admin = require('firebase-admin');

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

const GIFTS = [
  { label: '❤️ Heart', price: 10 },
  { label: '🌹 Rose', price: 20 },
  { label: '⭐ Star', price: 50 },
  { label: '🎁 Gift Box', price: 100 },
  { label: '👑 Crown', price: 200 },
];

async function getUid(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (e) {
    return null;
  }
}

async function ensureWallet(uid) {
  const ref = db.ref('wallets/' + uid);
  const snap = await ref.once('value');
  const wallet = snap.val() || {};
  if (wallet.shortId) {
    return { shortId: wallet.shortId, coins: wallet.coins || 0, earned: wallet.earned || 0 };
  }
  const counter = await db
    .ref('counters/shortId')
    .transaction((c) => (c || 10000) + 1);
  const newId = String(counter.snapshot.val());
  const res = await ref.child('shortId').transaction((cur) => cur || newId);
  const finalId = res.snapshot.val();
  if (finalId === newId) {
    await db.ref('shortIds/' + newId).set(uid);
  }
  if (wallet.coins === undefined) {
    await ref.child('coins').transaction((c) => c || 0);
  }
  const again = (await ref.once('value')).val() || {};
  return { shortId: again.shortId, coins: again.coins || 0, earned: again.earned || 0 };
}

// Take `amount` coins from a wallet. Returns true only if really taken.
async function takeCoins(uid, amount) {
  let taken = false;
  const tx = await db.ref('wallets/' + uid + '/coins').transaction((cur) => {
    taken = false;
    if (cur === null) return 0; // not known yet, forces a retry with real value
    if (typeof cur !== 'number' || cur < amount) return; // abort
    taken = true;
    return cur - amount;
  });
  return tx.committed && taken;
}

async function addCoins(uid, amount) {
  await db
    .ref('wallets/' + uid + '/coins')
    .transaction((cur) => (typeof cur === 'number' ? cur : 0) + amount);
}

function cleanName(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return (s || 'Guest').slice(0, 30);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const body = req.body || {};
  const uid = await getUid(body.idToken);
  if (!uid) return res.status(401).json({ error: 'login required' });

  try {
    if (body.action === 'register') {
      const wallet = await ensureWallet(uid);
      const reseller = (await db.ref('resellers/' + uid).once('value')).val() === true;
      return res.status(200).json({ ok: true, ...wallet, reseller });
    }

    if (body.action === 'gift') {
      const gift = GIFTS[parseInt(body.giftIndex, 10)];
      const hostId = typeof body.hostId === 'string' ? body.hostId : '';
      if (!gift) return res.status(400).json({ error: 'bad gift' });
      if (!hostId || hostId === uid) {
        return res.status(400).json({ error: 'bad host' });
      }
      const live = await db.ref('live_hosts/' + hostId).once('value');
      if (!live.exists()) {
        return res.status(400).json({ error: 'host not live' });
      }
      if (!(await takeCoins(uid, gift.price))) {
        return res.status(402).json({ error: 'not enough coins' });
      }
      await db
        .ref('wallets/' + hostId + '/earned')
        .transaction((cur) => (typeof cur === 'number' ? cur : 0) + gift.price);
      await db.ref('live_gifts/' + hostId).push({
        name: cleanName(body.name),
        gift: gift.label,
        ts: admin.database.ServerValue.TIMESTAMP,
      });
      const coins = (await db.ref('wallets/' + uid + '/coins').once('value')).val() || 0;
      return res.status(200).json({ ok: true, coins });
    }

    if (body.action === 'transfer') {
      const isReseller = (await db.ref('resellers/' + uid).once('value')).val() === true;
      if (!isReseller) return res.status(403).json({ error: 'not a reseller' });

      const amount = parseInt(body.amount, 10);
      const toShortId = String(body.toShortId || '').trim();
      if (!(amount >= 1 && amount <= 1000000)) {
        return res.status(400).json({ error: 'bad amount' });
      }
      if (!/^\d{3,12}$/.test(toShortId)) {
        return res.status(400).json({ error: 'bad user id' });
      }
      const toUid = (await db.ref('shortIds/' + toShortId).once('value')).val();
      if (!toUid) return res.status(404).json({ error: 'user not found' });
      if (toUid === uid) return res.status(400).json({ error: 'same user' });

      if (!(await takeCoins(uid, amount))) {
        return res.status(402).json({ error: 'not enough coins' });
      }
      try {
        await addCoins(toUid, amount);
      } catch (e) {
        await addCoins(uid, amount); // give back
        throw e;
      }
      await db.ref('txlog').push({
        type: 'transfer',
        from: uid,
        to: toUid,
        amount,
        ts: admin.database.ServerValue.TIMESTAMP,
      });
      const coins = (await db.ref('wallets/' + uid + '/coins').once('value')).val() || 0;
      return res.status(200).json({ ok: true, coins });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
};
