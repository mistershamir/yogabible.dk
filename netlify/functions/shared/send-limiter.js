/**
 * Send Limiter — Per-recipient daily cap for emails and SMS.
 * Prevents any bug or runaway process from spamming a single person.
 *
 * Usage:
 *   const { checkDailySendLimit } = require('./send-limiter');
 *   if (!await checkDailySendLimit(email)) return;
 */

const { getDb } = require('./firestore');

/**
 * Check if a recipient has exceeded their daily send limit.
 * @param {string} recipient - Email address or phone number
 * @param {'email'|'sms'} type - Message type
 * @param {number} maxPerDay - Maximum sends per 24 hours (default: 8)
 * @returns {Promise<boolean>} true if under limit, false if limit reached
 */
async function checkDailySendLimit(recipient, type, maxPerDay) {
  if (!recipient) return true;
  if (!type) type = 'email';
  if (!maxPerDay) maxPerDay = 8;

  try {
    const db = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const collection = type === 'sms' ? 'sms_log' : 'email_log';
    const field = type === 'sms' ? 'to' : 'to';

    const snap = await db.collection(collection)
      .where(field, '==', recipient)
      .where('sent_at', '>=', since)
      .get();

    if (snap.size >= maxPerDay) {
      console.warn('[send-limiter] Daily ' + type + ' limit reached for ' + recipient + ': ' + snap.size + '/' + maxPerDay);
      return false;
    }
    return true;
  } catch (err) {
    // On error, allow the send (fail open) but log it
    console.error('[send-limiter] Check failed (allowing send):', err.message);
    return true;
  }
}

module.exports = { checkDailySendLimit };
