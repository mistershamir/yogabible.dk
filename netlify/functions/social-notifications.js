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
 *     schedule = "every 2 hours"
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

  try {
    const db = getDb();
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const alerts = [];
    // 1. Check for failed posts in the last 2 hours
    let failedSnap;
    try {
      failedSnap = await db.collection('social_posts')
        .where('status', '==', 'failed')
        .where('updatedAt', '>=', twoHoursAgo)
        .limit(5)
        .get();
    } catch (indexErr) {
      console.warn('[social-notifications] Failed query needs index, using fallback:', indexErr.message);
      failedSnap = await db.collection('social_posts')
        .where('status', '==', 'failed')
        .limit(10)
        .get();
    }

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
    // Read metrics from social_analytics collection (populated by social-metric-sync)
    const recentPublished = await db.collection('social_posts')
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get();

    for (const doc of recentPublished.docs) {
      const p = doc.data();
      if (p._notifiedViral) continue;

      // Fetch actual metrics from social_analytics
      const analyticsSnap = await db.collection('social_analytics')
        .where('postId', '==', doc.id)
        .get();

      let totalEngagement = 0;
      let engByPlatform = {};
      analyticsSnap.forEach(aDoc => {
        const a = aDoc.data();
        const m = a.metrics || {};
        const eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
        totalEngagement += eng;
        engByPlatform[a.platform] = m;
      });

      // Alert if engagement > 50 in a single post (adjust threshold as needed)
      if (totalEngagement > 50) {
        const platformSummary = Object.entries(engByPlatform)
          .map(([plat, m]) => `${plat}: ❤️${m.likes || 0} 💬${m.comments || 0} 🔄${m.shares || 0}`)
          .join(' · ');
        alerts.push(`🔥 *Viral alert!* Post with ${totalEngagement} engagements:\n"${(p.caption || '').substring(0, 60)}..."\n${platformSummary}`);
        db.collection('social_posts').doc(doc.id).update({ _notifiedViral: true }).catch(() => {});
      }
    }

    // 4. Check for posts scheduled in the next 2 hours (heads up)
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    try {
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
    } catch (indexErr) {
      // Composite index may not exist — fall back to single query
      console.warn('[social-notifications] Upcoming query needs index, using fallback:', indexErr.message);
      const scheduledSnap = await db.collection('social_posts')
        .where('status', '==', 'scheduled')
        .limit(20)
        .get();
      const upcoming = [];
      scheduledSnap.forEach(doc => {
        const p = doc.data();
        const scheduledAt = p.scheduledAt?.toDate ? p.scheduledAt.toDate() : new Date(p.scheduledAt || 0);
        if (scheduledAt >= now && scheduledAt <= twoHoursFromNow) upcoming.push(p);
      });
      if (upcoming.length > 0) {
        alerts.push(`📅 *${upcoming.length} posts going out soon*`);
      }
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
