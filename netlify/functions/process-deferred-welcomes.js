// Scheduled function — drains the deferred_welcomes queue every 5 minutes.
//
// Runs on a tighter schedule than process-sequences (every 30 min) so the
// welcome ice breaker arrives close to its 10-minute target instead of
// waiting up to 30 minutes for the next sequence cron tick.
//
// The same processDeferredWelcomes pass also runs inside process-sequences
// as a safety net — if this function fails for a tick, the 30-min cron
// picks up the leftover. Both are idempotent (sent: false → sent: true
// atomic write + 24h email_log dedup in sendWelcomeEmail).
//
// Schedule is configured in netlify.toml.

const { processDeferredWelcomes } = require('./shared/deferred-welcomes');

exports.handler = async () => {
  const summary = await processDeferredWelcomes();
  if (summary.fired || summary.failed) {
    console.log('[deferred-welcomes-cron]', JSON.stringify(summary));
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) };
};
