/**
 * One-off maintenance: exclude 4 specific leads before the July last-call send.
 *
 * GET  /.netlify/functions/fix-july-lead-statuses              → dry-run (show matches + planned changes)
 * POST /.netlify/functions/fix-july-lead-statuses  { "confirm": "YES" } → apply
 *
 * Auth: X-Internal-Secret header (AI_INTERNAL_SECRET env var).
 *
 * Matches leads by exact email (case-insensitive) and applies the
 * per-email update below. notes are appended (never overwritten).
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// email → { status, [unsubscribed], [appendNote] }
const UPDATES = {
  'tina.woehrle@gmx.de':    { status: 'Not too keen' },
  'dambiz66@yahoo.co.uk':   { status: 'Not too keen' },
  'annemarit78@hotmail.com':{ status: 'Not too keen' },
  'cuellegaard@gmail.com':  {
    status: 'Unsubscribed',
    unsubscribed: true,
    appendNote: 'Requested data deletion June 6 2026'
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var apply = false;
  if (event.httpMethod === 'POST') {
    var body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) { /* ignore */ }
    if (body.confirm !== 'YES') {
      return jsonResponse(400, { ok: false, error: 'Refusing to apply without { "confirm": "YES" }' });
    }
    apply = true;
  }

  var db = getDb();
  var report = [];

  for (var email in UPDATES) {
    if (!UPDATES.hasOwnProperty(email)) continue;
    var spec = UPDATES[email];

    var snap = await db.collection('leads').where('email', '==', email).get();
    var matches = [];

    for (var i = 0; i < snap.docs.length; i++) {
      var doc = snap.docs[i];
      var d = doc.data();

      var update = { status: spec.status, updated_at: new Date() };
      if (spec.unsubscribed) update.unsubscribed = true;

      var newNotes = d.notes || '';
      if (spec.appendNote && newNotes.indexOf(spec.appendNote) === -1) {
        newNotes = newNotes ? (newNotes + '\n' + spec.appendNote) : spec.appendNote;
        update.notes = newNotes;
      }

      matches.push({
        id: doc.id,
        before: { status: d.status || '(none)', unsubscribed: !!d.unsubscribed, notes: d.notes || '' },
        after: { status: update.status, unsubscribed: update.unsubscribed === true ? true : !!d.unsubscribed, notes: update.notes !== undefined ? update.notes : (d.notes || '') }
      });

      if (apply) {
        await doc.ref.update(update);
      }
    }

    report.push({ email: email, matched: matches.length, docs: matches });
  }

  return jsonResponse(200, {
    ok: true,
    mode: apply ? 'applied' : 'dry-run',
    note: apply ? 'Updates written to Firestore.' : 'Dry-run only. POST with { "confirm": "YES" } to apply.',
    results: report
  });
};
