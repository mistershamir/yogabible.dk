/**
 * Social Engagement Notifications — Yoga Bible
 * Scheduled function that checks for notable social media events
 * and sends Telegram notifications to Shamir.
 *
 * Runs every 2 hours. Checks:
 * - Posts with unusually high engagement (viral detection)
 * - New comments that may need urgent replies
 * - Failed posts that need attention
 *
 * Configured in netlify.toml:
 *   [functions."social-notifications"]
 *     schedule = "0 */2 * * *"
 */

const https = require('https');
const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || '';

exports.handler = async () => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[social-notifications] Telegram not configured, skipping');
    return jsonResponse(200, { ok: true, skipped: true });
  }

  const db = getDb();
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const alerts = [];

  try {
    // 1. Check for failed posts in the last 2 hours
    const failedSnap = await db.collection('social_posts')
      .where('status', '==', 'failed')
      .where('updatedAt', '>=', twoHoursAgo)
      .limit(5)
      .get();

    failedSnap.forEach(doc => {
      const p = doc.data();
      alerts.push(`❌ *Failed post:* ${(p.caption || '').substring(0, 50)}...\nPlatforms: ${(p.platforms || []).join(', ')}`);
    });

    // 2. Check for pending review posts (reminder)
    const pendingSnap = await db.collection('social_posts')
      .where('status', '==', 'pending_review')
      .limit(10)
      .get();

    if (pendingSnap.size > 0) {
      alerts.push(`📋 *${pendingSnap.size} posts awaiting review* — check the Social module`);
    }

    // 3. Check for high-engagement posts (viral detection)
    const recentPublished = await db.collection('social_posts')
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get();

    recentPublished.forEach(doc => {
      const p = doc.data();
      const results = p.publishResults || {};
      Object.keys(results).forEach(platform => {
        const m = (results[platform] || {}).metrics || {};
        const engagement = (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
        // Alert if engagement > 50 in a single post (adjust threshold as needed)
        if (engagement > 50 && !p._notifiedViral) {
          alerts.push(`🔥 *Viral alert!* ${platform} post with ${engagement} engagements:\n"${(p.caption || '').substring(0, 60)}..."\n❤️ ${m.likes || 0} 💬 ${m.comments || 0} 🔄 ${m.shares || 0}`);
          // Mark as notified to avoid repeat alerts
          db.collection('social_posts').doc(doc.id).update({ _notifiedViral: true }).catch(() => {});
        }
      });
    });

    // 4. Check for posts scheduled in the next 2 hours (heads up)
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const upcomingSnap = await db.collection('social_posts')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '>=', now)
      .where('scheduledAt', '<=', twoHoursFromNow)
      .limit(5)
      .get();

    if (upcomingSnap.size > 0) {
      const titles = [];
      upcomingSnap.forEach(doc => {
        const p = doc.data();
        const time = p.scheduledAt?.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt);
        titles.push(`• ${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')} — ${(p.caption || '').substring(0, 40)}...`);
      });
      alerts.push(`📅 *${upcomingSnap.size} posts going out soon:*\n${titles.join('\n')}`);
    }

    // Send consolidated alert if there are any
    if (alerts.length > 0) {
      const message = `📱 *Social Media Update*\n\n${alerts.join('\n\n')}`;
      await sendTelegram(message);
      console.log(`[social-notifications] Sent ${alerts.length} alerts`);
    } else {
      console.log('[social-notifications] No alerts');
    }

    return jsonResponse(200, { ok: true, alertCount: alerts.length });
  } catch (err) {
    console.error('[social-notifications] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


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
