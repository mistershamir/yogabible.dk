/**
 * Site Visit Tracker — Yoga Bible
 * Logs website browsing behavior for identified leads (via yb_lid cookie).
 *
 * POST /.netlify/functions/site-visit
 * Body: { lid, page, event, scrollDepth?, timeOnPage?, referrer? }
 *
 * Events:
 *   "pageview"  — page load
 *   "heartbeat" — periodic (30s) with scroll depth + time
 *   "leave"     — page unload with final metrics
 *   "cta_click" — CTA button click { ctaText, ctaHref }
 *
 * Firestore: leads/{lid}.site_engagement { total_pageviews, sessions, pages{}, last_visit, interests[] }
 * Re-engagement: flags lead if inactive > 7 days then returns
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const admin = require('firebase-admin');

const REENGAGEMENT_THRESHOLD_DAYS = 7;
const SESSION_GAP_MINUTES = 30; // New session if > 30 min since last pageview

// Map page paths to interest categories
var PAGE_INTERESTS = {
  '/om-200/': 'teacher-training',
  '/en/about-200/': 'teacher-training',
  '/p300/': 'advanced-training',
  '/en/p300/': 'advanced-training',
  '/4-ugers-yogauddannelse/': '4-week',
  '/en/4-week-yoga-teacher-training/': '4-week',
  '/8-ugers-yogauddannelse/': '8-week',
  '/en/8-week-yoga-teacher-training/': '8-week',
  '/18-ugers-yogauddannelse/': '18-week',
  '/en/18-week-yoga-teacher-training/': '18-week',
  '/4-ugers-vinyasa-plus/': '4-week-jul',
  '/en/4-week-vinyasa-plus/': '4-week-jul',
  '/skema/': 'schedule',
  '/en/schedule/': 'schedule',
  '/priser/': 'pricing',
  '/en/prices/': 'pricing',
  '/kurser/': 'courses',
  '/en/courses/': 'courses',
  '/mentorship/': 'mentorship',
  '/en/mentorship/': 'mentorship',
  '/kontakt/': 'contact',
  '/en/contact/': 'contact',
  '/ansoeg/': 'application',
  '/en/apply/': 'application',
  '/yoga-journal/': 'blog',
  '/en/yoga-journal/': 'blog'
};

function detectInterest(page) {
  if (!page) return null;
  // Exact match first
  if (PAGE_INTERESTS[page]) return PAGE_INTERESTS[page];
  // Prefix match (for schedule sub-pages, journal posts, etc.)
  for (var prefix in PAGE_INTERESTS) {
    if (page.startsWith(prefix)) return PAGE_INTERESTS[prefix];
  }
  // Schedule pages
  if (page.includes('/skema/') || page.includes('/schedule/') || page.includes('/tidsplan/')) return 'schedule';
  return null;
}

function pageSlug(page) {
  return (page || '').replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'home';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  var body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  var lid = body.lid;
  var page = body.page;
  var evt = body.event;

  if (!lid || !page || !evt) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  try {
    var db = getDb();
    var now = admin.firestore.Timestamp.now();
    var leadRef = db.collection('leads').doc(lid);
    var leadDoc = await leadRef.get();

    if (!leadDoc.exists) {
      return jsonResponse(200, { ok: false, error: 'Unknown lead' });
    }

    var lead = leadDoc.data();
    var slug = pageSlug(page);

    if (evt === 'pageview') {
      var updates = {
        'site_engagement.total_pageviews': admin.firestore.FieldValue.increment(1),
        'site_engagement.last_visit': now,
        ['site_engagement.pages.' + slug + '.views']: admin.firestore.FieldValue.increment(1),
        ['site_engagement.pages.' + slug + '.last_visit']: now,
        ['site_engagement.pages.' + slug + '.path']: page,
        last_activity: now,
        updated_at: now
      };

      // Set first_visit if not set
      var se = lead.site_engagement || {};
      if (!se.first_visit) {
        updates['site_engagement.first_visit'] = now;
      }

      // Detect new session (> 30 min gap)
      if (se.last_visit) {
        var lastMs = se.last_visit.toDate ? se.last_visit.toDate().getTime() : new Date(se.last_visit).getTime();
        var minutesSince = (Date.now() - lastMs) / (1000 * 60);
        if (minutesSince > SESSION_GAP_MINUTES) {
          updates['site_engagement.total_sessions'] = admin.firestore.FieldValue.increment(1);
        }
      } else {
        updates['site_engagement.total_sessions'] = admin.firestore.FieldValue.increment(1);
      }

      // Detect interest from page
      var interest = detectInterest(page);
      if (interest) {
        updates['site_engagement.interests'] = admin.firestore.FieldValue.arrayUnion(interest);
      }

      // Check re-engagement
      var reEngagement = checkReEngagement(lead, 'site_visit', page);
      if (reEngagement) {
        updates.re_engaged = true;
        updates.re_engaged_at = now;
        updates.re_engagement_events = admin.firestore.FieldValue.arrayUnion(reEngagement);
      }

      await leadRef.update(updates);

    } else if (evt === 'heartbeat' || evt === 'leave') {
      var hbUpdates = { updated_at: now };

      if (typeof body.scrollDepth === 'number') {
        var currentMax = ((lead.site_engagement || {}).pages || {})[slug];
        var existingScroll = currentMax ? (currentMax.max_scroll || 0) : 0;
        if (body.scrollDepth > existingScroll) {
          hbUpdates['site_engagement.pages.' + slug + '.max_scroll'] = body.scrollDepth;
        }
      }
      if (typeof body.timeOnPage === 'number' && body.timeOnPage > 0) {
        hbUpdates['site_engagement.pages.' + slug + '.total_seconds'] = admin.firestore.FieldValue.increment(body.timeOnPage);
        hbUpdates['site_engagement.total_time_seconds'] = admin.firestore.FieldValue.increment(body.timeOnPage);
      }

      await leadRef.update(hbUpdates);

    } else if (evt === 'cta_click') {
      await leadRef.update({
        'site_engagement.cta_clicks': admin.firestore.FieldValue.arrayUnion({
          text: body.ctaText || '',
          href: body.ctaHref || '',
          page: page,
          at: now.toDate().toISOString()
        }),
        last_activity: now,
        updated_at: now
      });
    }

    return jsonResponse(200, { ok: true });
  } catch (err) {
    console.error('[site-visit] Error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Server error' });
  }
};

function checkReEngagement(lead, trigger, detail) {
  var lastActivity = lead.last_activity;
  if (!lastActivity) return null;

  var lastMs = lastActivity.toDate ? lastActivity.toDate().getTime() : new Date(lastActivity).getTime();
  var daysSince = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);

  if (daysSince >= REENGAGEMENT_THRESHOLD_DAYS) {
    return {
      at: new Date().toISOString(),
      trigger: trigger,
      detail: detail || null,
      days_inactive: Math.round(daysSince)
    };
  }
  return null;
}
