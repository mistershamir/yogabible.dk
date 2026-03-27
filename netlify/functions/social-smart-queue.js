/**
 * Social Smart Queue API — Yoga Bible
 * Auto-schedules posts into optimal time slots based on best-times analytics.
 *
 * POST /.netlify/functions/social-smart-queue  { action: 'auto-schedule', postIds: [...] }
 * POST /.netlify/functions/social-smart-queue  { action: 'suggest-slots', count: 5 }
 * GET  /.netlify/functions/social-smart-queue?action=queue
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const POSTS_COLLECTION = 'social_posts';
const ANALYTICS_COLLECTION = 'social_analytics';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'queue';
      if (action === 'queue') return getQueue(db);
      if (action === 'suggest-slots') return suggestSlots(db, params);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'auto-schedule': return autoSchedule(db, body);
        case 'suggest-slots': return suggestSlots(db, body);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-smart-queue] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Get queued (scheduled) posts ──────────────────────────────────

async function getQueue(db) {
  const now = new Date();
  let snap;
  try {
    snap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '>=', now)
      .orderBy('scheduledAt', 'asc')
      .limit(50)
      .get();
  } catch (err) {
    snap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'scheduled')
      .orderBy('scheduledAt', 'asc')
      .limit(50)
      .get();
  }

  const queue = [];
  snap.forEach(doc => {
    const d = doc.data();
    queue.push({
      id: doc.id,
      caption: (d.caption || '').substring(0, 80),
      platforms: d.platforms || [],
      scheduledAt: d.scheduledAt?.toDate?.() || d.scheduledAt,
      status: d.status
    });
  });

  return jsonResponse(200, { ok: true, queue });
}


// ── Suggest optimal time slots ─────────────────────────────────────

async function suggestSlots(db, params) {
  const count = parseInt(params.count) || 7;
  const bestTimes = await calculateBestTimes(db);

  // Get already-scheduled posts to avoid conflicts
  const now = new Date();
  const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  let scheduledSnap;
  try {
    scheduledSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '>=', now)
      .where('scheduledAt', '<=', twoWeeksOut)
      .limit(100)
      .get();
  } catch (err) {
    scheduledSnap = { docs: [], empty: true };
  }

  const takenSlots = new Set();
  if (!scheduledSnap.empty) {
    scheduledSnap.forEach(doc => {
      const d = doc.data();
      const ts = d.scheduledAt?.toDate?.() || (d.scheduledAt ? new Date(d.scheduledAt) : null);
      if (ts) {
        // Block a 2-hour window around each scheduled post
        takenSlots.add(ts.toISOString().substring(0, 13)); // YYYY-MM-DDTHH
      }
    });
  }

  // Build ranked hour slots for the next 14 days
  const slots = [];
  const topHours = bestTimes.byHour
    .filter(h => h.posts > 0)
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 6);

  const topDays = bestTimes.byDay
    .filter(d => d.posts > 0)
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // If no data, use sensible defaults (weekday mornings 9-11, evenings 18-20)
  const fallbackHours = [9, 10, 18, 19, 11, 20];
  const hours = topHours.length >= 3
    ? topHours.map(h => h.hour)
    : fallbackHours;

  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    const dayOfWeek = date.getDay();

    // Score this day
    const dayData = topDays.find(d => d.day === dayOfWeek);
    const dayScore = dayData ? dayData.avgEngagement : 1;

    for (const hour of hours) {
      const slotDate = new Date(date);
      slotDate.setHours(hour, 0, 0, 0);

      if (slotDate <= now) continue;

      const slotKey = slotDate.toISOString().substring(0, 13);
      if (takenSlots.has(slotKey)) continue;

      const hourData = topHours.find(h => h.hour === hour);
      const hourScore = hourData ? hourData.avgEngagement : 1;

      slots.push({
        datetime: slotDate.toISOString(),
        date: slotDate.toISOString().split('T')[0],
        time: `${String(hour).padStart(2, '0')}:00`,
        dayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek],
        score: dayScore + hourScore,
        reason: hourData && dayData
          ? `${dayData.label} at ${hourData.label} — avg ${hourScore} engagement`
          : 'Default optimal slot'
      });
    }
  }

  // Sort by score descending, return top N
  slots.sort((a, b) => b.score - a.score);

  return jsonResponse(200, {
    ok: true,
    slots: slots.slice(0, count),
    bestTimes: {
      bestHour: bestTimes.bestHour,
      bestDay: bestTimes.bestDay
    }
  });
}


// ── Auto-schedule posts into optimal slots ──────────────────────────

async function autoSchedule(db, body) {
  const { postIds } = body;
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing postIds array' });
  }

  // Get suggested slots (enough for all posts)
  const slotsResult = await suggestSlots(db, { count: postIds.length + 5 });
  const slotsData = JSON.parse(slotsResult.body);
  const availableSlots = slotsData.slots || [];

  if (availableSlots.length === 0) {
    return jsonResponse(400, { ok: false, error: 'No available time slots found' });
  }

  const scheduled = [];
  const errors = [];

  for (let i = 0; i < postIds.length; i++) {
    const postId = postIds[i];
    const slot = availableSlots[i];

    if (!slot) {
      errors.push({ id: postId, error: 'No more available slots' });
      continue;
    }

    try {
      const docRef = db.collection(POSTS_COLLECTION).doc(postId);
      const doc = await docRef.get();

      if (!doc.exists) {
        errors.push({ id: postId, error: 'Post not found' });
        continue;
      }

      const post = doc.data();
      if (post.status === 'published') {
        errors.push({ id: postId, error: 'Already published' });
        continue;
      }

      await docRef.update({
        status: 'scheduled',
        scheduledAt: new Date(slot.datetime),
        updatedAt: serverTimestamp(),
        _smartQueued: true
      });

      scheduled.push({
        id: postId,
        scheduledAt: slot.datetime,
        slot: slot.time,
        day: slot.dayLabel,
        reason: slot.reason
      });
    } catch (err) {
      errors.push({ id: postId, error: err.message });
    }
  }

  console.log('[social-smart-queue] Auto-scheduled:', scheduled.length, 'errors:', errors.length);

  return jsonResponse(200, { ok: true, scheduled, errors });
}


// ── Calculate best times from analytics ────────────────────────────

async function calculateBestTimes(db) {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  let postsSnap;
  try {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .where('publishedAt', '>=', since)
      .limit(200)
      .get();
  } catch (err) {
    postsSnap = await db.collection(POSTS_COLLECTION)
      .where('status', '==', 'published')
      .limit(200)
      .get();
  }

  const postTimestamps = {};
  if (!postsSnap.empty) {
    postsSnap.forEach(doc => {
      const data = doc.data();
      const ts = data.publishedAt?.toDate?.() || (data.publishedAt ? new Date(data.publishedAt) : null);
      if (ts) postTimestamps[doc.id] = ts;
    });
  }

  const analyticsSnap = await db.collection(ANALYTICS_COLLECTION)
    .where('fetchedAt', '>=', since)
    .limit(500)
    .get();

  const hourBuckets = Array.from({ length: 24 }, () => ({ count: 0, engagement: 0, reach: 0 }));
  const dayBuckets = Array.from({ length: 7 }, () => ({ count: 0, engagement: 0, reach: 0 }));
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  analyticsSnap.forEach(doc => {
    const d = doc.data();
    const ts = postTimestamps[d.postId];
    if (!ts) return;

    const m = d.metrics || {};
    const eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saved || 0);
    const reach = m.reach || m.post_reach || 0;

    hourBuckets[ts.getHours()].count++;
    hourBuckets[ts.getHours()].engagement += eng;
    hourBuckets[ts.getHours()].reach += reach;

    dayBuckets[ts.getDay()].count++;
    dayBuckets[ts.getDay()].engagement += eng;
    dayBuckets[ts.getDay()].reach += reach;
  });

  const byHour = hourBuckets.map((b, i) => ({
    hour: i,
    label: `${String(i).padStart(2, '0')}:00`,
    posts: b.count,
    avgEngagement: b.count > 0 ? Math.round(b.engagement / b.count) : 0,
    avgReach: b.count > 0 ? Math.round(b.reach / b.count) : 0
  }));

  const byDay = dayBuckets.map((b, i) => ({
    day: i,
    label: dayNames[i],
    posts: b.count,
    avgEngagement: b.count > 0 ? Math.round(b.engagement / b.count) : 0,
    avgReach: b.count > 0 ? Math.round(b.reach / b.count) : 0
  }));

  const bestHour = byHour.reduce((best, h) => h.avgEngagement > best.avgEngagement ? h : best, byHour[0]);
  const bestDay = byDay.reduce((best, d) => d.avgEngagement > best.avgEngagement ? d : best, byDay[0]);

  return { byHour, byDay, bestHour, bestDay };
}
