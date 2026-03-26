/**
 * Resend Webhook — Bounce & Complaint Handler
 *
 * Receives webhook events from Resend (email.bounced, email.complained)
 * and flags the affected email addresses in Firestore so they are
 * automatically skipped in future campaigns, sequences, and bulk sends.
 *
 * POST /.netlify/functions/resend-webhook
 *
 * Setup:
 *   1. Resend Dashboard → Webhooks → Add endpoint:
 *      URL: https://www.yogabible.dk/.netlify/functions/resend-webhook
 *      Events: email.bounced, email.complained
 *   2. Copy the signing secret → Netlify env var RESEND_WEBHOOK_SECRET
 *
 * Firestore updates:
 *   - leads: sets email_bounced, bounce_count, last_bounce_at, last_bounce_type
 *   - email_list_contacts: sets status = 'bounced'
 *   - email_bounces: audit log of every bounce/complaint event
 */

const crypto = require('crypto');
const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

// ─── Signature verification ─────────────────────────────────────────────────
// Resend uses Svix for webhooks. The signature header is `svix-signature`.
// Format: v1,<base64-signature>
// Payload to sign: <svix-id>.<svix-timestamp>.<body>

function verifySignature(body, headers) {
  var secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // Skip in dev if no secret configured

  var svixId = headers['svix-id'];
  var svixTimestamp = headers['svix-timestamp'];
  var svixSignature = headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject timestamps older than 5 minutes
  var age = Math.abs(Date.now() / 1000 - parseInt(svixTimestamp, 10));
  if (age > 300) return false;

  // Resend/Svix secret starts with "whsec_" — strip it and decode base64
  var secretBytes;
  if (secret.startsWith('whsec_')) {
    secretBytes = Buffer.from(secret.slice(6), 'base64');
  } else {
    secretBytes = Buffer.from(secret, 'base64');
  }

  var payload = svixId + '.' + svixTimestamp + '.' + body;
  var computed = crypto.createHmac('sha256', secretBytes).update(payload).digest('base64');

  // svix-signature can contain multiple signatures separated by spaces: "v1,sig1 v1,sig2"
  var signatures = svixSignature.split(' ');
  for (var i = 0; i < signatures.length; i++) {
    var parts = signatures[i].split(',');
    if (parts.length === 2 && parts[0] === 'v1') {
      try {
        if (crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(parts[1]))) {
          return true;
        }
      } catch (e) {
        // Length mismatch — not a match
      }
    }
  }

  return false;
}

// ─── Handler ────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Verify webhook signature
  if (!verifySignature(event.body || '', event.headers || {})) {
    console.error('[resend-webhook] Invalid signature');
    return jsonResponse(401, { error: 'Invalid signature' });
  }

  var data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  var db = getDb();
  var eventType = data.type;
  var eventData = data.data || {};

  // ── Handle delivery events (email.delivered, email.opened, email.clicked) ──
  // These are tracked alongside the pixel-based system for better accuracy.
  // Resend open/click tracking works even when pixels are blocked.
  if (eventType === 'email.delivered' || eventType === 'email.opened' ||
      eventType === 'email.clicked') {
    // Only log if we can identify the campaign (via tags)
    // Resend sends tags as { name: value } in the webhook payload
    var tags = eventData.tags || {};
    var campaignId = tags.campaign_id || null;
    // Also check tags array format [{ name: 'campaign_id', value: 'xxx' }]
    if (!campaignId && Array.isArray(eventData.tags)) {
      var found = eventData.tags.find(function (t) { return t.name === 'campaign_id'; });
      if (found) campaignId = found.value;
    }
    var emailHash = null;

    if (eventData.to && eventData.to.length > 0) {
      var trackEmail = (eventData.to[0] || '').toLowerCase().trim();
      emailHash = crypto.createHash('sha256').update(trackEmail).digest('hex').slice(0, 12);
    }

    if (campaignId && emailHash) {
      var trackType = eventType === 'email.opened' ? 'open'
        : eventType === 'email.clicked' ? 'click'
        : 'delivered';

      try {
        await db.collection('email_tracking').add({
          campaign_id: campaignId,
          email_hash: emailHash,
          type: trackType,
          url: eventData.click && eventData.click.link ? eventData.click.link : null,
          timestamp: new Date().toISOString(),
          source: 'resend_webhook'
        });
      } catch (err) {
        console.error('[resend-webhook] Tracking log error:', err.message);
      }
    }

    return jsonResponse(200, { ok: true, tracked: eventType });
  }

  // ── Handle bounce and complaint events ──────────────────────────────────────
  if (eventType !== 'email.bounced' && eventType !== 'email.complained') {
    // Acknowledge other events silently
    return jsonResponse(200, { ok: true, ignored: true });
  }

  var recipients = [];

  // Resend sends `to` as array of emails
  if (Array.isArray(eventData.to)) {
    recipients = eventData.to;
  } else if (typeof eventData.to === 'string') {
    recipients = [eventData.to];
  }

  if (recipients.length === 0) {
    console.warn('[resend-webhook] No recipients in event:', eventType);
    return jsonResponse(200, { ok: true, no_recipients: true });
  }

  var now = new Date();
  var bounceType = eventType === 'email.complained' ? 'complaint' : 'hard';
  var processed = 0;

  for (var i = 0; i < recipients.length; i++) {
    var email = (recipients[i] || '').toLowerCase().trim();
    if (!email) continue;

    try {
      // 1. Log to email_bounces collection (audit trail)
      await db.collection('email_bounces').add({
        email: email,
        type: bounceType,
        event_type: eventType,
        resend_email_id: eventData.email_id || eventData.id || null,
        subject: eventData.subject || null,
        raw_data: eventData,
        created_at: now
      });

      // 2. Flag all leads with this email
      var leadsSnap = await db.collection('leads')
        .where('email', '==', email)
        .get();

      for (var j = 0; j < leadsSnap.docs.length; j++) {
        var leadDoc = leadsSnap.docs[j];
        var leadData = leadDoc.data();
        var bounceCount = (leadData.bounce_count || 0) + 1;

        var updates = {
          email_bounced: true,
          bounce_count: bounceCount,
          last_bounce_at: now,
          last_bounce_type: bounceType,
          updated_at: now
        };

        // Auto-unsubscribe on complaints or repeated bounces (3+)
        if (bounceType === 'complaint' || bounceCount >= 3) {
          updates.unsubscribed = true;
          updates.status = 'unsubscribed';
          var reason = bounceType === 'complaint'
            ? 'Marked as spam by recipient'
            : 'Email bounced ' + bounceCount + ' times';
          updates.notes = (reason + ' (' + now.toISOString() + ')\n' + (leadData.notes || '')).trim();
        }

        await leadDoc.ref.update(updates);
        console.log('[resend-webhook] Flagged lead ' + leadDoc.id + ' (' + email + ') — ' + bounceType);
      }

      // 3. Flag email_list_contacts with this email
      //    Complaints → 'unsubscribed' (user doesn't want emails)
      //    Bounces    → 'bounced' (email address is invalid)
      var contactsSnap = await db.collection('email_list_contacts')
        .where('email', '==', email)
        .get();

      var contactStatus = bounceType === 'complaint' ? 'unsubscribed' : 'bounced';
      for (var k = 0; k < contactsSnap.docs.length; k++) {
        await contactsSnap.docs[k].ref.update({
          status: contactStatus,
          bounce_type: bounceType,
          last_bounce_at: now
        });
      }

      // 4. Exit any active sequence enrollments for this email
      var enrollSnap = await db.collection('sequence_enrollments')
        .where('lead_email', '==', email)
        .where('status', '==', 'active')
        .get();

      for (var m = 0; m < enrollSnap.docs.length; m++) {
        await enrollSnap.docs[m].ref.update({
          status: 'exited',
          exit_reason: 'Email bounced (' + bounceType + ')',
          updated_at: now
        });
        console.log('[resend-webhook] Exited enrollment ' + enrollSnap.docs[m].id + ' — email bounced');
      }

      processed++;
    } catch (err) {
      console.error('[resend-webhook] Error processing ' + email + ':', err.message);
    }
  }

  console.log('[resend-webhook] Processed ' + eventType + ' for ' + processed + ' email(s)');
  return jsonResponse(200, { ok: true, processed: processed });
};
