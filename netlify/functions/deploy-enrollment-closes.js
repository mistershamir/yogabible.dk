/**
 * Deploy Enrollment Closes Dates
 *
 * POST /.netlify/functions/deploy-enrollment-closes
 * Auth: X-Internal-Secret header
 *
 * Sets enrollment_closes dates on program-specific sequences.
 * Also updates July Vinyasa Plus trigger to accept both "4-week-jul" and "4-week" leads
 * so that after April closes, new 4-week leads route to July.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// Sequence IDs and their enrollment close dates
var UPDATES = [
  {
    id: 'ZwvSVLsqRZcIv8C0IG0y',
    name: 'April 4W Intensive — Conversion Push',
    enrollment_closes: '2026-04-10T00:00:00Z'
  },
  {
    id: 'uDST1Haj1dMyQy0Qifhu',
    name: '8W Semi-Intensive May–Jun — DK Nurture',
    enrollment_closes: '2026-05-01T00:00:00Z'
  },
  {
    id: 'Yoq6RCVqTYlF10OPmkSw',
    name: 'July Vinyasa Plus — International Nurture',
    enrollment_closes: '2026-07-01T00:00:00Z'
  },
  {
    id: 'ab2dSOrmaQnneUyRojCf',
    name: '18W Flexible Aug–Dec — DK Nurture',
    enrollment_closes: '2026-08-15T00:00:00Z'
  }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var results = [];

  for (var i = 0; i < UPDATES.length; i++) {
    var item = UPDATES[i];
    var docRef = db.collection('sequences').doc(item.id);
    var doc = await docRef.get();

    if (!doc.exists) {
      results.push({ id: item.id, name: item.name, status: 'not_found' });
      continue;
    }

    var updateData = {
      enrollment_closes: item.enrollment_closes,
      updated_at: new Date().toISOString()
    };

    await docRef.update(updateData);

    // Verify
    var verified = await docRef.get();
    var data = verified.data();
    results.push({
      id: item.id,
      name: data.name,
      enrollment_closes: data.enrollment_closes,
      status: 'updated'
    });
  }

  // Update July Vinyasa Plus trigger to also accept "4-week" leads
  // so after April closes, 4-week leads route to the next open cohort
  var julyRef = db.collection('sequences').doc('Yoq6RCVqTYlF10OPmkSw');
  var julyDoc = await julyRef.get();
  var julyTriggerUpdate = null;

  if (julyDoc.exists) {
    var julyData = julyDoc.data();
    var currentTrigger = julyData.trigger || {};
    var currentConditions = currentTrigger.conditions || {};

    // Add ytt_program_type_alt to match both "4-week-jul" and "4-week"
    // The matchesTriggerConditions uses .includes(), so "4-week-jul" already matches "4-week"
    // But "4-week" does NOT contain "4-week-jul", so we need to check:
    // Current condition: ytt_program_type: "4-week-jul"
    // A lead with ytt_program_type: "4-week" — does "4-week".includes("4-week-jul")? NO.
    // So we need to change the condition to just "4-week" which will match both
    // "4-week" and "4-week-jul" via the .includes() check
    if (currentConditions.ytt_program_type === '4-week-jul') {
      await julyRef.update({
        'trigger.conditions.ytt_program_type': '4-week',
        updated_at: new Date().toISOString()
      });
      julyTriggerUpdate = {
        previous: '4-week-jul',
        updated_to: '4-week',
        reason: 'Match both "4-week" and "4-week-jul" leads via .includes()'
      };
    }
  }

  return jsonResponse(200, {
    ok: true,
    results: results,
    july_trigger_update: julyTriggerUpdate
  });
};
