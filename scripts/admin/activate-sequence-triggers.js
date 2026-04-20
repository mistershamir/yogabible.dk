/**
 * Activate Sequence Auto-Enrollment — One-time Migration
 *
 * POST /.netlify/functions/activate-sequence-triggers
 *
 * Auth: X-Internal-Secret header
 *
 * Updates the 4 program-specific sequences from trigger.type:'manual'
 * to trigger.type:'new_lead' with ytt_program_type conditions,
 * enabling auto-enrollment for matching new leads.
 *
 * Safe to run multiple times — idempotent (overwrites trigger field).
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { optionsResponse } = require('./shared/utils');

const TRIGGER_UPDATES = [
  {
    name: 'April 4W Intensive — Conversion Push',
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '4-week' } }
  },
  {
    name: 'July Vinyasa Plus — International Nurture',
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '4-week-jul' } }
  },
  {
    name: '8W Semi-Intensive May–Jun — DK Nurture',
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '8-week' } }
  },
  {
    name: '18W Flexible Aug–Dec — DK Nurture',
    trigger: { type: 'new_lead', conditions: { ytt_program_type: '18-week-aug' } }
  }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST only' }) };
  }

  // Auth
  var secret = (event.headers || {})['x-internal-secret'] || (event.headers || {})['X-Internal-Secret'] || '';
  if (!secret || secret !== process.env.AI_INTERNAL_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true';

  try {
    var db = getDb();
    var results = [];

    for (var i = 0; i < TRIGGER_UPDATES.length; i++) {
      var update = TRIGGER_UPDATES[i];

      // Find sequence by name
      var snap = await db.collection('sequences')
        .where('name', '==', update.name)
        .limit(1)
        .get();

      if (snap.empty) {
        results.push({ name: update.name, status: 'not_found' });
        continue;
      }

      var doc = snap.docs[0];
      var current = doc.data().trigger || {};

      if (!dryRun) {
        await doc.ref.update({
          trigger: update.trigger,
          updated_at: serverTimestamp()
        });
      }

      results.push({
        name: update.name,
        id: doc.id,
        status: dryRun ? 'would_update' : 'updated',
        from: current,
        to: update.trigger
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, dry_run: dryRun, results: results })
    };
  } catch (err) {
    console.error('[activate-sequence-triggers] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
