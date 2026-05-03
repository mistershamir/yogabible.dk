/**
 * Deferred Welcome Emails
 *
 * Welcome emails arrive 30 minutes after a lead submits a form (instead of
 * instantly) so they read as written by a human, not fired by a bot.
 *
 * Producers (lead.js, facebook-leads-webhook.js) call scheduleDeferredWelcome
 * which writes a row to the `deferred_welcomes` Firestore collection.
 * The process-sequences cron fires processDeferredWelcomes at the start of
 * each tick: it reads rows where send_at <= now AND sent === false, calls
 * sendWelcomeEmail, then marks the row sent.
 *
 * Failure handling: a failed send leaves sent=false so the next cron tick
 * retries automatically. Five consecutive failures mark the row as failed
 * to stop the retry loop.
 */

const { getDb } = require('./firestore');

const COL = 'deferred_welcomes';
const DELAY_MS = 30 * 60 * 1000;          // 30 minutes
const MAX_ATTEMPTS = 5;
const PROCESS_BATCH = 25;                  // safety cap per cron tick

/**
 * Producer: write a row that the cron will pick up later.
 * Non-throwing — logs and returns false on error so callers can ignore.
 *
 * @param {Object} args
 * @param {Object} args.lead          — full lead doc data (passed to sendWelcomeEmail)
 * @param {string} args.action        — 'lead_schedule_4w-jun', etc. (router action key)
 * @param {string} args.leadId        — Firestore lead doc id
 * @param {string} args.scheduleToken — HMAC token for tokenised schedule URLs
 */
async function scheduleDeferredWelcome({ lead, action, leadId, scheduleToken }) {
  if (!lead || !lead.email) return false;
  try {
    const db = getDb();
    await db.collection(COL).add({
      lead_id: leadId || null,
      email: (lead.email || '').toLowerCase().trim(),
      action: action || 'lead_meta',
      lead_data: lead,
      token_data: { leadId: leadId, token: scheduleToken },
      send_at: new Date(Date.now() + DELAY_MS),
      sent: false,
      attempts: 0,
      created_at: new Date()
    });
    return true;
  } catch (err) {
    console.error('[deferred-welcomes] Failed to schedule welcome for ' + (lead.email || 'unknown') + ':', err.message);
    return false;
  }
}

/**
 * Cron pass: fire every deferred welcome whose send_at is in the past.
 * Called from sequences.js handleProcess. Does not throw; returns a summary.
 *
 * sendWelcomeEmail is required lazily to avoid a circular import
 * (lead-emails.js → resend-service.js → ... → no cycle yet, but defensive).
 */
async function processDeferredWelcomes() {
  const summary = { fired: 0, failed: 0, skipped: 0 };
  try {
    const db = getDb();
    const now = new Date();
    const dueSnap = await db.collection(COL)
      .where('sent', '==', false)
      .where('send_at', '<=', now)
      .limit(PROCESS_BATCH)
      .get();

    if (dueSnap.empty) return summary;

    const { sendWelcomeEmail } = require('./lead-emails');

    for (const doc of dueSnap.docs) {
      const data = doc.data();
      const attempts = (data.attempts || 0) + 1;

      if (data.attempts >= MAX_ATTEMPTS) {
        await doc.ref.update({ sent: true, status: 'failed', failed_at: new Date(), reason: 'max_attempts_exceeded' }).catch(() => {});
        summary.skipped++;
        continue;
      }

      try {
        const result = await sendWelcomeEmail(data.lead_data || {}, data.action || 'lead_meta', data.token_data || {});
        if (result && result.success) {
          await doc.ref.update({
            sent: true,
            status: 'sent',
            sent_at: new Date(),
            attempts,
            send_result: { subject: result.subject || null, reason: result.reason || null }
          });
          summary.fired++;
        } else {
          // already_sent (within 24h dedup) counts as success — don't retry
          if (result && (result.reason === 'already_sent' || result.reason === 'unsubscribed' || result.reason === 'no_email')) {
            await doc.ref.update({ sent: true, status: 'skipped', sent_at: new Date(), attempts, reason: result.reason });
            summary.skipped++;
          } else {
            await doc.ref.update({ attempts, last_attempt_at: new Date(), last_error: (result && result.error) || 'unknown' });
            summary.failed++;
          }
        }
      } catch (err) {
        console.error('[deferred-welcomes] Send error for ' + data.email + ':', err.message);
        await doc.ref.update({ attempts, last_attempt_at: new Date(), last_error: err.message }).catch(() => {});
        summary.failed++;
      }
    }
  } catch (err) {
    console.error('[deferred-welcomes] Process error:', err.message);
  }
  return summary;
}

module.exports = { scheduleDeferredWelcome, processDeferredWelcomes };
