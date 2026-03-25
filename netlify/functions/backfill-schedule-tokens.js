/**
 * Backfill Schedule Tokens — Generate tracking tokens for all existing leads
 *
 * POST /.netlify/functions/backfill-schedule-tokens
 * Auth: X-Internal-Secret header
 *
 * Generates HMAC schedule tokens for every lead in Firestore that doesn't
 * already have one stored. This enables schedule URL tracking for leads
 * who signed up before tokenized links were implemented.
 *
 * GET /.netlify/functions/backfill-schedule-tokens?dry=1 — preview only (no writes)
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

function generateScheduleToken(leadId, email) {
  var hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry === '1' || params.dry === 'true';

  var db = getDb();
  var leadsSnap = await db.collection('leads').get();

  var total = 0;
  var alreadyHaveToken = 0;
  var noEmail = 0;
  var generated = 0;
  var errors = [];

  for (var i = 0; i < leadsSnap.docs.length; i++) {
    var doc = leadsSnap.docs[i];
    var lead = doc.data();
    total++;

    // Skip leads that already have a stored token
    if (lead.schedule_token) {
      alreadyHaveToken++;
      continue;
    }

    // Skip leads without email (can't generate token)
    if (!lead.email) {
      noEmail++;
      continue;
    }

    var token = generateScheduleToken(doc.id, lead.email);

    if (!dryRun) {
      try {
        await db.collection('leads').doc(doc.id).update({
          schedule_token: token
        });
        generated++;
      } catch (err) {
        errors.push({ id: doc.id, error: err.message });
      }
    } else {
      generated++;
    }
  }

  return jsonResponse(200, {
    ok: true,
    dry_run: dryRun,
    total_leads: total,
    already_have_token: alreadyHaveToken,
    no_email: noEmail,
    generated: generated,
    errors: errors.length > 0 ? errors : undefined
  });
};
