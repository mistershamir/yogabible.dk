/**
 * Anonymous Visit Tracker — Yoga Bible
 * Stores pre-lead browsing behavior for anonymous visitors (yb_vid cookie).
 * Data is stitched to the lead record when they submit a form (see lead.js).
 *
 * POST /.netlify/functions/anon-visit
 * Body: { vid, page, title?, event, scrollDepth?, timeOnPage?, session?, referrer?, attribution? }
 *
 * Events:
 *   "pageview" — page load (creates/updates visitor doc + adds to visit timeline)
 *   "leave"    — page unload with scroll depth + time on page
 *   "cta_click" — CTA button click
 *
 * Firestore: anonymous_visits/{vid} (single doc per visitor, 90-day lifecycle)
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const admin = require('firebase-admin');

const SESSION_GAP_MINUTES = 30;

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

  var vid = body.vid;
  var page = body.page;
  var evt = body.event;

  if (!vid || !page || !evt) {
    return jsonResponse(400, { ok: false, error: 'Missing required fields' });
  }

  try {
    var db = getDb();
    var now = admin.firestore.Timestamp.now();
    var docRef = db.collection('anonymous_visits').doc(vid);
    var doc = await docRef.get();
    var slug = pageSlug(page);

    if (evt === 'pageview') {
      if (!doc.exists) {
        // First visit — create the visitor doc
        var newDoc = {
          vid: vid,
          created_at: now,
          last_visit: now,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          total_sessions: 1,
          total_pageviews: 1,
          current_session: body.session || null,
          pages: {},
          visits: [{
            path: page,
            title: body.title || '',
            at: now.toDate().toISOString(),
            session: body.session || null
          }]
        };
        // Store first-visit attribution
        if (body.attribution) {
          newDoc.attribution = body.attribution;
        }
        if (body.referrer) {
          newDoc.first_referrer = body.referrer;
        }
        // Initialize per-page data
        newDoc.pages[slug] = {
          views: 1,
          path: page,
          title: body.title || '',
          last_visit: now,
          max_scroll: 0,
          total_seconds: 0
        };
        await docRef.set(newDoc);
      } else {
        // Return visit — update doc
        var data = doc.data();
        var updates = {
          last_visit: now,
          total_pageviews: admin.firestore.FieldValue.increment(1),
          ['pages.' + slug + '.views']: admin.firestore.FieldValue.increment(1),
          ['pages.' + slug + '.path']: page,
          ['pages.' + slug + '.title']: body.title || '',
          ['pages.' + slug + '.last_visit']: now
        };

        // Check for new session
        if (body.session && body.session !== data.current_session) {
          updates.current_session = body.session;
          updates.total_sessions = admin.firestore.FieldValue.increment(1);
        }

        // Append to visit timeline (cap at 200 entries)
        var visits = data.visits || [];
        if (visits.length < 200) {
          updates.visits = admin.firestore.FieldValue.arrayUnion({
            path: page,
            title: body.title || '',
            at: now.toDate().toISOString(),
            session: body.session || null
          });
        }

        // Update attribution if not set yet
        if (!data.attribution && body.attribution) {
          updates.attribution = body.attribution;
        }

        // Initialize page entry if first view of this page
        if (!data.pages || !data.pages[slug]) {
          updates['pages.' + slug + '.max_scroll'] = 0;
          updates['pages.' + slug + '.total_seconds'] = 0;
        }

        await docRef.update(updates);
      }

    } else if (evt === 'leave') {
      if (!doc.exists) return jsonResponse(200, { ok: true });

      var leaveUpdates = {};
      if (typeof body.scrollDepth === 'number') {
        var currentData = doc.data();
        var pageData = (currentData.pages || {})[slug];
        var existingScroll = pageData ? (pageData.max_scroll || 0) : 0;
        if (body.scrollDepth > existingScroll) {
          leaveUpdates['pages.' + slug + '.max_scroll'] = body.scrollDepth;
        }
      }
      if (typeof body.timeOnPage === 'number' && body.timeOnPage > 0) {
        leaveUpdates['pages.' + slug + '.total_seconds'] = admin.firestore.FieldValue.increment(body.timeOnPage);
      }
      if (Object.keys(leaveUpdates).length > 0) {
        await docRef.update(leaveUpdates);
      }

    } else if (evt === 'cta_click') {
      if (!doc.exists) return jsonResponse(200, { ok: true });

      await docRef.update({
        cta_clicks: admin.firestore.FieldValue.arrayUnion({
          text: body.ctaText || '',
          href: body.ctaHref || '',
          page: page,
          at: now.toDate().toISOString()
        })
      });
    }

    return jsonResponse(200, { ok: true });
  } catch (err) {
    console.error('[anon-visit] Error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Server error' });
  }
};
