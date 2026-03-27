/**
 * Social Post Notification Service — Yoga Bible
 * Sends Telegram notifications for social post workflow events.
 *
 * Runs every 15 minutes. Checks for:
 * 1. Posts awaiting approval (status: pending_review)
 * 2. Failed published posts (status: failed)
 * 3. Evergreen candidates ready for recycling
 *
 * Configured in netlify.toml:
 *   [functions."social-notify"]
 *     schedule = "*/15 * * * *"
 */

const https = require('https');
const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || '';
const POSTS_COLLECTION = 'social_posts';
const NOTIFY_COLLECTION = 'social_notifications';

exports.handler = async () => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return jsonResponse(200, { ok: true, skipped: true, reason: 'Telegram not configured' });
  }

  const db = getDb();
  let sent = 0;

  try {
    // ── 1. Posts pending review ──────────────────────────────────
    const pendingSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'pending_review')
      .limit(10)
      .get();

    if (!pendingSnap.empty) {
      // Check which ones we've already notified about
      const notifiedIds = await getNotifiedIds(db, 'pending_review');

      const newPending = [];
      pendingSnap.forEach(doc => {
        if (!notifiedIds.has(doc.id)) newPending.push({ id: doc.id, ...doc.data() });
      });

      if (newPending.length > 0) {
        let msg = '📋 *Social: Posts awaiting approval*\n\n';
        newPending.forEach(p => {
          const caption = (p.caption || '').substring(0, 60).replace(/[*_`\[]/g, '');
          const platforms = (p.platforms || []).join(', ');
          msg += `• "${caption}..." → ${platforms}\n`;
        });
        msg += `\n${newPending.length} post${newPending.length > 1 ? 's' : ''} need${newPending.length === 1 ? 's' : ''} review.`;
        msg += '\n\n👉 Open /admin/ → Social → Posts';

        await sendTelegram(msg);
        await markNotified(db, newPending.map(p => p.id), 'pending_review');
        sent++;
      }
    }

    // ── 2. Failed posts ─────────────────────────────────────────
    const failedSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'failed')
      .limit(10)
      .get();

    if (!failedSnap.empty) {
      const notifiedIds = await getNotifiedIds(db, 'failed');

      const newFailed = [];
      failedSnap.forEach(doc => {
        if (!notifiedIds.has(doc.id)) newFailed.push({ id: doc.id, ...doc.data() });
      });

      if (newFailed.length > 0) {
        let msg = '⚠️ *Social: Failed posts*\n\n';
        newFailed.forEach(p => {
          const caption = (p.caption || '').substring(0, 40).replace(/[*_`\[]/g, '');
          const reason = (p.failReason || 'Unknown error').substring(0, 80);
          msg += `• "${caption}..." — ${reason}\n`;
        });
        msg += '\n\n👉 Check /admin/ → Social → Posts';

        await sendTelegram(msg);
        await markNotified(db, newFailed.map(p => p.id), 'failed');
        sent++;
      }
    }

    // ── 3. Evergreen candidates ─────────────────────────────────
    const evergreenSnap = await db.collection(POSTS_COLLECTION)
      .where('evergreenCandidate', '==', true)
      .limit(20)
      .get();

    if (!evergreenSnap.empty) {
      const notifiedIds = await getNotifiedIds(db, 'evergreen');

      const newEvergreen = [];
      evergreenSnap.forEach(doc => {
        if (!notifiedIds.has(doc.id)) newEvergreen.push({ id: doc.id, ...doc.data() });
      });

      // Only notify once per day about evergreen candidates (batch them)
      if (newEvergreen.length >= 3) {
        let msg = '♻️ *Social: Evergreen candidates*\n\n';
        msg += `${newEvergreen.length} top-performing posts are ready for recycling:\n\n`;
        newEvergreen.slice(0, 5).forEach(p => {
          const caption = (p.caption || '').substring(0, 50).replace(/[*_`\[]/g, '');
          const score = p.evergreenScore || 0;
          msg += `• "${caption}..." (score: ${score})\n`;
        });
        if (newEvergreen.length > 5) {
          msg += `\n...and ${newEvergreen.length - 5} more.`;
        }
        msg += '\n\n👉 Open posts and click Recycle to schedule re-posting.';

        await sendTelegram(msg);
        await markNotified(db, newEvergreen.map(p => p.id), 'evergreen');
        sent++;
      }
    }

    return jsonResponse(200, { ok: true, sent });
  } catch (err) {
    console.error('[social-notify] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Helpers ─────────────────────────────────────────────────────

async function getNotifiedIds(db, type) {
  const ids = new Set();
  try {
    const snap = await db.collection(NOTIFY_COLLECTION)
      .where('type', '==', type)
      .limit(200)
      .get();
    snap.forEach(doc => ids.add(doc.data().postId));
  } catch (e) { /* empty */ }
  return ids;
}

async function markNotified(db, postIds, type) {
  const batch = db.batch();
  postIds.forEach(postId => {
    const ref = db.collection(NOTIFY_COLLECTION).doc(`${type}_${postId}`);
    batch.set(ref, {
      postId,
      type,
      notifiedAt: serverTimestamp()
    });
  });
  await batch.commit();
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });

    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
