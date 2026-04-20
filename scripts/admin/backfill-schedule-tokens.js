/**
 * Backfill Schedule Tokens — Generate tracking tokens for all existing leads
 *
 * POST /.netlify/functions/backfill-schedule-tokens
 * Auth: X-Internal-Secret header
 *
 * Generates HMAC schedule tokens for every lead in Firestore that doesn't
 * already have one stored. Uses Firestore batched writes (500 per batch)
 * to stay within Netlify function timeout.
 *
 * ?dry=1 — preview only (no writes)
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';
const BATCH_SIZE = 450; // Firestore max is 500, leave headroom

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

  // Collect all updates first
  var updates = [];

  for (var i = 0; i < leadsSnap.docs.length; i++) {
    var doc = leadsSnap.docs[i];
    var lead = doc.data();
    total++;

    if (lead.schedule_token) {
      alreadyHaveToken++;
      continue;
    }

    if (!lead.email) {
      noEmail++;
      continue;
    }

    updates.push({
      id: doc.id,
      token: generateScheduleToken(doc.id, lead.email)
    });
  }

  if (!dryRun && updates.length > 0) {
    // Write in batches of 450
    for (var b = 0; b < updates.length; b += BATCH_SIZE) {
      var chunk = updates.slice(b, b + BATCH_SIZE);
      var batch = db.batch();

      for (var j = 0; j < chunk.length; j++) {
        batch.update(db.collection('leads').doc(chunk[j].id), {
          schedule_token: chunk[j].token
        });
      }

      try {
        await batch.commit();
        generated += chunk.length;
      } catch (err) {
        errors.push({ batch: Math.floor(b / BATCH_SIZE) + 1, count: chunk.length, error: err.message });
      }
    }
  } else {
    generated = updates.length;
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
