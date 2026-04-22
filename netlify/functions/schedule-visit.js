/**
 * Schedule Visit Tracker — Yoga Bible
 * Logs tokenized schedule page visits to Firestore for lead engagement tracking.
 *
 * POST /.netlify/functions/schedule-visit
 * Body: { tid, tok, page, event, scrollDepth?, timeOnPage? }
 *
 * Events:
 *   "pageview"  — first load (creates/updates visit doc)
 *   "heartbeat" — periodic ping with scrollDepth + timeOnPage
 *   "leave"     — page unload beacon with final metrics
 *
 * Firestore: schedule_visits/{tid}_{page_slug}
 *   - lead_id, page, first_visit, last_visit, visit_count,
 *     max_scroll_depth, total_time_seconds, visits[]
 *
 * Also updates lead doc: schedule_engagement { last_page, last_visit, total_visits, pages{} }
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { createScheduleRetargetPost } = require('./shared/social-sync');
const admin = require('firebase-admin');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

function verifyToken(leadId, email, token) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + email.toLowerCase().trim());
  return hmac.digest('hex') === token;
}

// Slug from page path: "/en/schedule/4-weeks-july/" → "4-weeks-july"
function pageSlug(page) {
  return (page || '').replace(/^\/+|\/+$/g, '').split('/').pop() || 'unknown';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  const { tid, tok, page, event: evt, scrollDepth, timeOnPage } = body;

  if (!tid || !tok || !page || !evt) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  try {
    const db = getDb();

    // Validate token against lead
    const leadDoc = await db.collection('leads').doc(tid).get();
    if (!leadDoc.exists) {
      return jsonResponse(200, { ok: false, error: 'Invalid token' });
    }
    const lead = leadDoc.data();
    if (!verifyToken(tid, lead.email || '', tok)) {
      return jsonResponse(200, { ok: false, error: 'Invalid token' });
    }

    const slug = pageSlug(page);
    const visitDocId = tid + '_' + slug;
    const now = admin.firestore.Timestamp.now();
    const visitRef = db.collection('schedule_visits').doc(visitDocId);
    const visitDoc = await visitRef.get();

    if (evt === 'pageview') {
      if (visitDoc.exists) {
        // Revisit — increment count, add visit entry
        const data = visitDoc.data();
        const visitCount = (data.visit_count || 0) + 1;
        await visitRef.update({
          last_visit: now,
          visit_count: visitCount,
          updated_at: now,
          visits: admin.firestore.FieldValue.arrayUnion({
            at: now.toDate().toISOString(),
            ua: (event.headers || {})['user-agent'] || ''
          })
        });
      } else {
        // First visit
        await visitRef.set({
          lead_id: tid,
          page: page,
          slug: slug,
          first_visit: now,
          last_visit: now,
          visit_count: 1,
          max_scroll_depth: 0,
          total_time_seconds: 0,
          visits: [{
            at: now.toDate().toISOString(),
            ua: (event.headers || {})['user-agent'] || ''
          }],
          created_at: now,
          updated_at: now
        });
      }

      // Update lead doc with engagement summary
      await db.collection('leads').doc(tid).update({
        ['schedule_engagement.last_page']: page,
        ['schedule_engagement.last_visit']: now,
        ['schedule_engagement.total_visits']: admin.firestore.FieldValue.increment(1),
        ['schedule_engagement.pages.' + slug + '.visit_count']: admin.firestore.FieldValue.increment(1),
        ['schedule_engagement.pages.' + slug + '.last_visit']: now,
        updated_at: now
      });

      // Check if this slug has enough unique visits to trigger a social retarget post
      // Map schedule page slugs to social-sync format keys
      const SLUG_TO_FORMAT = {
        '4-weeks': '4w', '4-week': '4w', '4w': '4w',
        '8-weeks': '8w', '8-week': '8w', '8w': '8w',
        '18-weeks': '18w', '18-week': '18w', '18w': '18w',
        '4-weeks-july': '4w-jul', '4-week-jul': '4w-jul', '4w-jul': '4w-jul',
        '4-weeks-june': '4w-jun', '4-week-jun': '4w-jun', '4w-jun': '4w-jun', '4-uger-juni': '4w-jun'
      };
      const formatKey = SLUG_TO_FORMAT[slug];
      if (formatKey) {
        // Count unique visits for this slug in the last 7 days
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const slugVisits = await db.collection('schedule_visits')
          .where('slug', '==', slug)
          .where('last_visit', '>=', admin.firestore.Timestamp.fromDate(weekAgo))
          .get();
        const uniqueVisitors = slugVisits.size;
        // Trigger at 10+ unique visitors per week
        if (uniqueVisitors >= 10 && uniqueVisitors % 5 === 0) {
          createScheduleRetargetPost(formatKey, uniqueVisitors).catch(err =>
            console.error('[schedule-visit] Social retarget error:', err.message)
          );
        }
      }

    } else if (evt === 'heartbeat' || evt === 'leave') {
      // Update metrics
      const updates = { updated_at: now };
      if (typeof scrollDepth === 'number') {
        const currentMax = visitDoc.exists ? (visitDoc.data().max_scroll_depth || 0) : 0;
        if (scrollDepth > currentMax) {
          updates.max_scroll_depth = scrollDepth;
        }
      }
      if (typeof timeOnPage === 'number' && timeOnPage > 0) {
        updates.total_time_seconds = admin.firestore.FieldValue.increment(timeOnPage);
      }

      if (visitDoc.exists) {
        await visitRef.update(updates);
      }

      // Also update lead engagement summary with max scroll
      const leadUpdates = { updated_at: now };
      if (typeof scrollDepth === 'number') {
        const currentLeadData = lead.schedule_engagement || {};
        const currentPageData = (currentLeadData.pages || {})[slug] || {};
        if (scrollDepth > (currentPageData.max_scroll || 0)) {
          leadUpdates['schedule_engagement.pages.' + slug + '.max_scroll'] = scrollDepth;
        }
      }
      if (typeof timeOnPage === 'number' && timeOnPage > 0) {
        leadUpdates['schedule_engagement.pages.' + slug + '.total_seconds'] = admin.firestore.FieldValue.increment(timeOnPage);
      }
      await db.collection('leads').doc(tid).update(leadUpdates);
    }

    return jsonResponse(200, { ok: true });

  } catch (err) {
    console.error('[schedule-visit] Error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Server error' });
  }
};
