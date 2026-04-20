/**
 * Populate July International Content — Utility Function
 *
 * Reads email content from data/july-international-content.json and updates
 * the corresponding sequence steps in Firestore.
 *
 * Query params:
 *   ?dry_run=true  — preview changes without writing to Firestore
 *   ?steps=1-4     — only update steps 1 through 4 (1-indexed)
 *
 * Protected by X-Internal-Secret header.
 */

const { getDb } = require('./shared/firestore');
const content = require('./data/july-international-content.json');

exports.handler = async (event) => {
  // Auth check
  const secret = event.headers['x-internal-secret'];
  if (secret !== process.env.AI_INTERNAL_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const params = event.queryStringParameters || {};
  const dryRun = params.dry_run === 'true';
  const sequenceId = content.sequence_id;

  if (!sequenceId || sequenceId === 'REPLACE_WITH_FIRESTORE_SEQUENCE_ID') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Set sequence_id in july-international-content.json' }) };
  }

  // Parse step range filter (1-indexed)
  let stepFilter = null;
  if (params.steps) {
    const parts = params.steps.split('-').map(Number);
    stepFilter = { from: parts[0] - 1, to: (parts[1] || parts[0]) - 1 };
  }

  const db = getDb();
  const seqRef = db.collection('sequences').doc(sequenceId);
  const seqDoc = await seqRef.get();

  if (!seqDoc.exists) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Sequence not found: ' + sequenceId }) };
  }

  const steps = seqDoc.data().steps || [];
  const updates = [];

  const fields = ['email_subject', 'email_body', 'email_subject_en', 'email_body_en', 'email_subject_de', 'email_body_de', 'country_blocks'];

  for (const entry of content.steps) {
    const idx = entry.step_index;
    if (idx < 0 || idx >= steps.length) continue;
    if (stepFilter && (idx < stepFilter.from || idx > stepFilter.to)) continue;

    const changed = {};
    for (const f of fields) {
      if (entry[f] !== undefined) {
        steps[idx][f] = entry[f];
        changed[f] = true;
      }
    }
    updates.push({ step: idx + 1, fields: Object.keys(changed) });
  }

  if (!dryRun && updates.length > 0) {
    await seqRef.update({ steps });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      dry_run: dryRun,
      sequence_id: sequenceId,
      steps_updated: updates,
      total: updates.length
    }, null, 2)
  };
};
