/**
 * SMS Webhook — Yoga Bible
 * Receives inbound SMS from GatewayAPI EU.
 *
 * GatewayAPI sends POST with JSON body containing the SMS details.
 * We match the sender phone to a lead and store the message.
 *
 * GET  /.netlify/functions/sms-webhook  — Verification (return 200)
 * POST /.netlify/functions/sms-webhook  — Inbound SMS handler
 */

const { getDb } = require('./shared/firestore');
const { normalizePhone } = require('./shared/sms-service');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // GET — webhook verification (GatewayAPI pings to check endpoint is alive)
  if (event.httpMethod === 'GET') {
    return jsonResponse(200, { ok: true, status: 'SMS webhook active' });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    console.log('[sms-webhook] Inbound SMS payload:', JSON.stringify(payload));

    // GatewayAPI sends: { id, msisdn, receiver, message, senttime, ... }
    const senderMsisdn = payload.msisdn || payload.sender || '';
    const message = payload.message || payload.text || '';
    const timestamp = payload.senttime
      ? new Date(payload.senttime * 1000)
      : new Date();

    if (!senderMsisdn || !message) {
      console.log('[sms-webhook] Missing msisdn or message');
      return jsonResponse(200, { ok: true, note: 'No msisdn or message' });
    }

    // Normalize the sender phone
    const normalizedPhone = normalizePhone(senderMsisdn);
    if (!normalizedPhone) {
      console.log('[sms-webhook] Could not normalize phone:', senderMsisdn);
      return jsonResponse(200, { ok: true, note: 'Invalid phone' });
    }

    const db = getDb();

    // Find lead by phone number — try multiple formats
    const phoneVariants = [
      normalizedPhone,                           // +4512345678
      normalizedPhone.replace('+', ''),           // 4512345678
      normalizedPhone.replace('+45', ''),          // 12345678 (DK local)
      normalizedPhone.replace('+45', '0045'),      // 004512345678
    ];

    let matchedLeadId = null;
    let matchedLead = null;

    // Query leads by phone field
    for (const variant of phoneVariants) {
      const snap = await db.collection('leads')
        .where('phone', '==', variant)
        .limit(1)
        .get();

      if (!snap.empty) {
        matchedLeadId = snap.docs[0].id;
        matchedLead = snap.docs[0].data();
        break;
      }
    }

    // Also try with spaces/dashes removed from stored phones
    if (!matchedLeadId) {
      // Broader search — get recent leads and match manually
      const recentSnap = await db.collection('leads')
        .orderBy('created_at', 'desc')
        .limit(500)
        .get();

      recentSnap.forEach(doc => {
        if (matchedLeadId) return;
        const leadPhone = normalizePhone(doc.data().phone);
        if (leadPhone && phoneVariants.includes(leadPhone)) {
          matchedLeadId = doc.id;
          matchedLead = doc.data();
        }
      });
    }

    if (matchedLeadId) {
      // Store inbound message in subcollection
      await db.collection('leads').doc(matchedLeadId)
        .collection('sms_messages').add({
          direction: 'inbound',
          message: message,
          phone: normalizedPhone,
          timestamp: timestamp,
          read: false
        });

      // Update lead doc with unread flag
      await db.collection('leads').doc(matchedLeadId).update({
        has_unread_sms: true,
        last_sms_at: timestamp,
        last_contact: timestamp,
        updated_at: new Date()
      });

      console.log(`[sms-webhook] Stored inbound SMS for lead ${matchedLeadId} from ${normalizedPhone}`);
    } else {
      // No matching lead — log to sms_log as unmatched
      await db.collection('sms_log').add({
        direction: 'inbound',
        phone: normalizedPhone,
        message: message,
        timestamp: timestamp,
        unmatched: true,
        raw_payload: JSON.stringify(payload).substring(0, 500)
      });

      console.log(`[sms-webhook] Unmatched inbound SMS from ${normalizedPhone}`);
    }

    // Always return 200 — GatewayAPI expects quick success response
    return jsonResponse(200, { ok: true });

  } catch (error) {
    console.error('[sms-webhook] Error:', error);
    // Still return 200 to prevent GatewayAPI retries
    return jsonResponse(200, { ok: true, note: 'Error processing' });
  }
};
