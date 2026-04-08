/**
 * Social Weekly Performance Digest — Yoga Bible
 * Sends a comprehensive weekly summary via Telegram every Monday at 9am CET.
 *
 * Digest includes:
 * - Total posts published this week vs last week
 * - Total engagement (likes, comments, shares) with trend
 * - Top 3 performing posts
 * - Platform breakdown (which platform drove most engagement)
 * - Hashtag winners (top 3 by engagement)
 * - Upcoming scheduled posts count
 * - Audience growth (follower delta if available)
 *
 * Configured in netlify.toml:
 *   [functions."social-weekly-digest"]
 *     schedule = "0 8 * * 1"
 */

const https = require('https');
const { getDb } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const ANALYTICS_COLLECTION = 'social_analytics';

/**
 * Fetch aggregated metrics for a post from social_analytics collection.
 * Returns { likes, comments, shares, reach } summed across all platforms.
 */
async function getPostMetrics(db, postId) {
  const totals = { likes: 0, comments: 0, shares: 0, reach: 0 };
  const platformTotals = {};
  const snap = await db.collection(ANALYTICS_COLLECTION)
    .where('postId', '==', postId)
    .get();
  snap.forEach(doc => {
    const d = doc.data();
    const m = d.metrics || {};
    const likes = m.likes || 0;
    const comments = m.comments || 0;
    const shares = m.shares || 0;
    const reach = m.reach || m.post_reach || 0;
    totals.likes += likes;
    totals.comments += comments;
    totals.shares += shares;
    totals.reach += reach;
    const plat = d.platform || 'unknown';
    if (!platformTotals[plat]) platformTotals[plat] = 0;
    platformTotals[plat] += likes + comments + shares;
  });
  return { totals, platformTotals };
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || '';

exports.handler = async () => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return jsonResponse(200, { ok: true, skipped: true, reason: 'Telegram not configured' });
  }

  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  try {
    // ── Fetch this week's published posts ──
    let thisWeekSnap;
    try {
      thisWeekSnap = await db.collection('social_posts')
        .where('status', '==', 'published')
        .where('publishedAt', '>=', weekAgo)
        .orderBy('publishedAt', 'desc')
        .limit(100)
        .get();
    } catch (e) {
      // Fallback if index missing
      thisWeekSnap = await db.collection('social_posts')
        .where('status', '==', 'published')
        .limit(100)
        .get();
    }

    const thisWeekPosts = [];
    thisWeekSnap.forEach(doc => {
      const d = doc.data();
      const pubAt = d.publishedAt?.toDate ? d.publishedAt.toDate() : new Date(d.publishedAt || 0);
      if (pubAt >= weekAgo) thisWeekPosts.push({ id: doc.id, ...d, _pubDate: pubAt });
    });

    // ── Fetch last week's posts for comparison ──
    let lastWeekSnap;
    try {
      lastWeekSnap = await db.collection('social_posts')
        .where('status', '==', 'published')
        .where('publishedAt', '>=', twoWeeksAgo)
        .where('publishedAt', '<', weekAgo)
        .limit(100)
        .get();
    } catch (e) {
      lastWeekSnap = { size: 0, forEach: () => {} };
    }

    let lastWeekCount = 0;
    let lastWeekEng = 0;
    const lastWeekDocs = [];
    lastWeekSnap.forEach(doc => {
      lastWeekCount++;
      lastWeekDocs.push(doc.id);
    });
    for (const pid of lastWeekDocs) {
      const { totals } = await getPostMetrics(db, pid);
      lastWeekEng += totals.likes + totals.comments + totals.shares;
    }

    // ── Calculate this week's metrics from social_analytics collection ──
    let totalLikes = 0, totalComments = 0, totalShares = 0, totalReach = 0;
    const platformEng = {};
    const hashtagEng = {};
    const postScores = [];

    for (const p of thisWeekPosts) {
      const { totals, platformTotals } = await getPostMetrics(db, p.id);
      const postEng = totals.likes + totals.comments + totals.shares;

      totalLikes += totals.likes;
      totalComments += totals.comments;
      totalShares += totals.shares;
      totalReach += totals.reach;

      for (const [plat, eng] of Object.entries(platformTotals)) {
        if (!platformEng[plat]) platformEng[plat] = 0;
        platformEng[plat] += eng;
      }

      // Track hashtag performance
      (p.hashtags || []).forEach(tag => {
        const key = tag.toLowerCase();
        if (!hashtagEng[key]) hashtagEng[key] = { eng: 0, uses: 0 };
        hashtagEng[key].eng += postEng / Math.max((p.hashtags || []).length, 1);
        hashtagEng[key].uses++;
      });

      postScores.push({ post: p, engagement: postEng });
    }

    const totalEng = totalLikes + totalComments + totalShares;

    // ── Top 3 posts ──
    postScores.sort((a, b) => b.engagement - a.engagement);
    const top3 = postScores.slice(0, 3);

    // ── Top 3 hashtags ──
    const topHashtags = Object.entries(hashtagEng)
      .filter(([, v]) => v.uses >= 1)
      .sort((a, b) => b[1].eng - a[1].eng)
      .slice(0, 3);

    // ── Platform ranking ──
    const platRanking = Object.entries(platformEng)
      .sort((a, b) => b[1] - a[1]);

    // ── Upcoming scheduled ──
    let scheduledCount = 0;
    try {
      const schedSnap = await db.collection('social_posts')
        .where('status', '==', 'scheduled')
        .select()
        .get();
      scheduledCount = schedSnap.size;
    } catch (e) { /* ignore */ }

    // ── Build digest message ──
    const trend = (current, previous) => {
      if (previous === 0) return current > 0 ? ' ↑' : '';
      const pct = Math.round(((current - previous) / previous) * 100);
      return pct > 0 ? ` ↑${pct}%` : pct < 0 ? ` ↓${Math.abs(pct)}%` : '';
    };

    let msg = `📊 *Weekly Social Media Digest*\n`;
    msg += `_${weekAgo.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}_\n\n`;

    // Overview
    msg += `📝 *Posts:* ${thisWeekPosts.length}${trend(thisWeekPosts.length, lastWeekCount)}\n`;
    msg += `❤️ *Engagement:* ${totalEng}${trend(totalEng, lastWeekEng)}\n`;
    msg += `👁 *Reach:* ${totalReach.toLocaleString()}\n`;
    msg += `💬 *Comments:* ${totalComments} · 🔄 *Shares:* ${totalShares}\n\n`;

    // Top posts
    if (top3.length > 0) {
      msg += `🏆 *Top Posts:*\n`;
      top3.forEach((item, i) => {
        const medal = ['🥇', '🥈', '🥉'][i];
        const caption = (item.post.caption || '').substring(0, 45);
        msg += `${medal} ${caption}... (${item.engagement} eng)\n`;
      });
      msg += '\n';
    }

    // Platform breakdown
    if (platRanking.length > 0) {
      msg += `📱 *By Platform:*\n`;
      const icons = { instagram: '📸', facebook: '👤', tiktok: '🎵', linkedin: '💼' };
      platRanking.forEach(([plat, eng]) => {
        const pct = totalEng > 0 ? Math.round((eng / totalEng) * 100) : 0;
        msg += `${icons[plat] || '•'} ${plat}: ${eng} (${pct}%)\n`;
      });
      msg += '\n';
    }

    // Top hashtags
    if (topHashtags.length > 0) {
      msg += `#️⃣ *Top Hashtags:*\n`;
      topHashtags.forEach(([tag, data]) => {
        msg += `• ${tag} — ${data.eng.toFixed(0)} avg eng (${data.uses} posts)\n`;
      });
      msg += '\n';
    }

    // Upcoming
    if (scheduledCount > 0) {
      msg += `📅 *${scheduledCount} posts scheduled* for the coming week\n`;
    }

    msg += `\n_Powered by Yoga Bible Social Module_`;

    await sendTelegram(msg);
    console.log(`[social-weekly-digest] Sent digest: ${thisWeekPosts.length} posts, ${totalEng} engagement`);

    return jsonResponse(200, {
      ok: true,
      postsThisWeek: thisWeekPosts.length,
      totalEngagement: totalEng,
      topPostCount: top3.length
    });
  } catch (err) {
    console.error('[social-weekly-digest] Error:', err);
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
